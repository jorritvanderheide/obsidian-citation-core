// `segments` against the CommonMark reference parser, commonmark.js, on notes
// made up from the pieces that have leaked comments before.
//
// The question is the one `stripComments` answers: which `%%comments%%` are
// text, and go, and which are inside code, and stay. Every `%%` here has a tag
// right after it, `%%k0001z`, in the same piece of text or code as the marker,
// and so does every word, so where commonmark.js puts a tag says where the
// marker is. Pairing the markers that are text, as Obsidian does, says which
// tags a comment hides, and those are the tags that must be gone from what
// `stripComments` gives back, and no others.
//
// The notes come from fixed seeds, so a run finds what the last run found.
// To look further, `NOTES=100000 npx vitest run tests/commonmark.test.ts`. A
// failure prints the first notes that fail: copy one into a test of its own in
// `markdown.test.ts` with the fix.
//
// Two things the notes leave out, on purpose. A table row: Obsidian has
// GitHub's tables, which CommonMark doesn't, and `segments` reads a row on its
// own, as GitHub's Markdown does. And an HTML comment, which is a comment of
// its own kind, where the pairing here knows only `%%`.
import { Parser } from 'commonmark';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../src/core/markdown';
import { random } from './random';

const TAG = /(%%)?(k\d{4}z)/g;

/** A note made up of the tricky pieces, from a seed. */
function note(seed: number): string {
	const { int, chance, pick } = random(seed);
	let count = 0;
	const tag = () => `k${String(count++).padStart(4, '0')}z`;
	const marker = () => `%%${tag()}`;
	// Indentation, now and then with a tab, which counts to the next multiple of four.
	const spaces = (low: number, high: number) => (chance(0.1) ? '\t' : '') + ' '.repeat(int(low, high));

	const piece = (): string =>
		pick([
			tag,
			tag,
			() => `${marker()} ${tag()} ${marker()}`,
			marker,
			() => `\`${tag()} ${marker()}\``,
			() => `\`\`${tag()} \` ${marker()}\`\``,
			() => '`',
			() => '``',
			() => `\`\`\`${tag()}\`\`\``,
			() => '```',
			() => '~~~',
		]);
	const words = () => Array.from({ length: int(1, 4) }, piece).join(' ');
	// Mostly without a marker, for the blocks whose markers CommonMark can't
	// judge (`expected`), so that most notes still are judged.
	const quiet = () => (chance(0.2) ? words() : Array.from({ length: int(1, 3) }, () => pick([tag, () => `\`${tag()}\``, () => '`'])).join(' '));

	const fence = (): string[] => {
		const char = chance(0.6) ? '`' : '~';
		const length = int(3, 5);
		const info = pick([() => '', () => 'js', () => ` ${tag()}`, () => marker(), () => (char === '`' ? `a\`${tag()}` : `a~${tag()}`)]);
		const lines = [`${spaces(0, 6)}${char.repeat(length)}${info}`];
		for (let i = int(0, 3); i > 0; i--) {
			lines.push(
				pick([
					() => `${spaces(0, 6)}${words()}`,
					() => `${spaces(0, 6)}${marker()}`,
					() => '',
					() => `${spaces(0, 6)}${(char === '`' ? '~' : '`').repeat(int(3, 5))}`,
					() => `${spaces(0, 6)}${char.repeat(int(2, length - 1))}`,
				]),
			);
		}
		const closing = pick([
			() => null,
			() => char.repeat(length),
			() => char.repeat(length + int(1, 2)),
			() => char.repeat(int(2, length - 1)),
			() => (char === '`' ? '~' : '`').repeat(length),
			() => `${char.repeat(length)} ${tag()}`,
		]);
		if (closing !== null) lines.push(`${spaces(0, 6)}${closing}`);
		return lines;
	};

	const block = (depth: number): string[] =>
		pick<string[]>([
			() => Array.from({ length: int(1, 3) }, words),
			() => [`${'#'.repeat(int(1, 3))} ${words()}`],
			fence,
			fence,
			() => Array.from({ length: int(1, 2) }, () => `    ${spaces(0, 2)}${quiet()}`),
			() => [`${marker()}`, words(), `${marker()}`],
			// What ends a paragraph or turns it into a heading, and HTML, which
			// pandoc reads Markdown in.
			() => [words(), pick([() => '===', () => '---', () => '***', () => '- - -'])],
			() => [pick([() => '<div>', () => '<pre>', () => '<span class="a">', () => `<div> ${quiet()}`]), quiet(), pick([() => '</div>', () => '</pre>', () => ''])],
			() => {
				// A list item, with lines under it indented by about its content.
				const bullet = pick([() => '- ', () => '* ', () => '1. ', () => '10) ', () => '-   ', () => '-      ']);
				const lines = [`${spaces(0, 2)}${bullet}${chance(0.15) ? '' : words()}`];
				if (chance(0.3)) lines.push(words());
				if (depth < 2 && chance(0.8)) {
					if (chance(0.7)) lines.push('');
					const shift = Math.max(0, bullet.length + int(-2, 4));
					for (const line of block(depth + 1)) lines.push(line === '' ? '' : ' '.repeat(shift) + line);
				}
				return lines;
			},
			() => {
				// A quote, now and then with a lazy line that has no `>`.
				if (depth >= 2) return [words()];
				return block(depth + 1).map((line) => (chance(0.15) && line !== '' ? line : `>${chance(0.8) ? ' ' : ''}${line}`));
			},
		]);

	const lines: string[] = [];
	for (let i = int(2, 6); i > 0; i--) {
		lines.push(...block(0));
		if (chance(0.7)) lines.push('');
	}
	return lines.join('\n') + '\n';
}

type Where = 'code' | 'indented code' | 'html' | 'text';

/** Where commonmark.js puts each tag: in code, in an indented code block, in an HTML block, or in text. */
function placed(text: string): Map<string, Where> {
	const where = new Map<string, Where>();
	const mark = (literal: string | null, kind: Where) => {
		for (const match of (literal ?? '').matchAll(TAG)) where.set(match[2]!, kind);
	};
	const walker = new Parser().parse(text).walker();
	for (let event = walker.next(); event; event = walker.next()) {
		const node = event.node;
		if (!event.entering) continue;
		if (node.type === 'code_block') {
			mark(node.literal, node.info === null ? 'indented code' : 'code');
			// The info string is the block's language, which nobody reads as text.
			mark(node.info, 'code');
		} else if (node.type === 'code') mark(node.literal, 'code');
		else if (node.type === 'html_block') mark(node.literal, 'html');
		else mark(node.literal, 'text');
	}
	return where;
}

/**
 * The tags that should be left once the comments are gone: the markers that are
 * text pair up, as Obsidian pairs them, and a marker in code is only
 * characters, even inside a comment.
 *
 * Or null, for a note with a marker in an HTML or indented code block, where
 * CommonMark reads no spans and `segments` reads them anyway: pandoc reads
 * Markdown in HTML, and as text with no spans, one lone `%%` in either would
 * hide the rest of the note. CommonMark can't say what is right there.
 */
function expected(text: string): Set<string> | null {
	const where = placed(text);
	if ([...text.matchAll(TAG)].some((match) => match[1] && ['html', 'indented code'].includes(where.get(match[2]!) ?? ''))) return null;
	const kept = new Set<string>();
	let open = false;
	for (const match of text.matchAll(TAG)) {
		const tag = match[2]!;
		if (match[1] && where.get(tag) !== 'code') open = !open;
		if (!open) kept.add(tag);
	}
	return kept;
}

describe('segments, against commonmark.js', () => {
	it('keeps the comments CommonMark reads as code, and only those', () => {
		const failures: { note: string; leaked: string[]; lost: string[] }[] = [];
		let checked = 0;
		const notes = Number(process.env.NOTES ?? 5000);
		for (let seed = 0; seed < notes; seed++) {
			const text = note(seed);
			const out = stripComments(text);
			const want = expected(text);
			if (want === null) continue;
			checked++;
			const tags = [...text.matchAll(TAG)].map((match) => match[2]!);
			const leaked = tags.filter((tag) => !want.has(tag) && out.includes(tag));
			const lost = tags.filter((tag) => want.has(tag) && !out.includes(tag));
			if (leaked.length > 0 || lost.length > 0) failures.push({ note: text, leaked, lost });
		}
		expect(failures.slice(0, 3)).toEqual([]);
		// Most notes are held to CommonMark, not left out.
		expect(checked).toBeGreaterThan(notes / 2);
	});
});
