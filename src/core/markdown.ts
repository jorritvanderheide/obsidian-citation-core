// What a note has to lose before pandoc sees it.
//
// Pandoc reads markdown, not Obsidian: it does not know that `%%` hides text,
// that the H1 is the title, or where `![[image.png]]` lives. Everything here
// works on the text of the note and never looks inside code, where all of these
// are only characters.

import { keyOf, linkpathOf, renameInAlias } from './citations';
import type { Post } from './document';

/** A run of the note that is code, or that is not. */
export interface Segment {
	code: boolean;
	text: string;
}

/**
 * What a line of the note is, as CommonMark's blocks have it: the opening line
 * of a fenced block, a line inside one, a line whose spans are read, or any
 * other line. Spans are read across the lines that share a `unit`: those of a
 * paragraph, and those of an HTML or indented code block up to a blank line.
 */
type LineKind = 'fence' | 'in fence' | 'inline' | 'other';

// CommonMark's block starts, on a line from where its containers end.
const FENCE = /^(`{3,})(?=[^`]*$)|^(~{3,})/;
const CLOSING_FENCE = /^(`{3,}|~{3,})[ \t]*$/;
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const LIST_MARKER = /^(?:[*+-]|(\d{1,9})[.)])(?=[ \t]|$)/;
// The HTML blocks: each kind's start, and its end, on a line of its own or,
// for the last two, at a blank line. The last kind cannot interrupt a
// paragraph.
const HTML_TAG = String.raw`(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^"'=<>\x60\s]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)`;
const HTML_BLOCKS: [RegExp, RegExp | null][] = [
	[/^<(?:script|pre|textarea|style)(?:\s|>|$)/i, /<\/(?:script|pre|textarea|style)>/i],
	[/^<!--/, /-->/],
	[/^<\?/, /\?>/],
	[/^<![A-Za-z]/, />/],
	[/^<!\[CDATA\[/, /\]\]>/],
	[/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|\/?>|$)/i, null],
	[new RegExp(`^${HTML_TAG}\\s*$`), null],
];
// A line that started a block of its own before the core read CommonMark's
// blocks, and still breaks a span in an HTML block, as it did then.
const BLOCK_START = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+][ \t]|\d{1,9}[.)][ \t]|\|)/;

/** A line with each tab as the spaces up to the next multiple of four, as CommonMark counts columns. */
/**
 * For each place in a line, whether the line from there on is a thematic
 * break: three or more of one of `*`, `_` or `-`, with only spaces or tabs
 * between and after. Worked out once per line, from its end, because a list nested once
 * per `* ` asks at every level, and testing the rest of the line each time made
 * a long line quadratic.
 */
function thematicBreaks(line: string): boolean[] {
	const out = new Array<boolean>(line.length + 1).fill(false);
	let mark: string | null = null;
	let count = 0;
	let mixed = false;
	for (let at = line.length - 1; at >= 0; at--) {
		const char = line[at]!;
		if (char === ' ' || char === '\t') continue;
		if (char === '*' || char === '_' || char === '-') {
			if (mark === null) mark = char;
			if (char !== mark) mixed = true;
			count++;
			out[at] = !mixed && count >= 3;
		} else {
			mixed = true;
		}
	}
	return out;
}

function columns(line: string): string {
	let out = '';
	for (const char of line) out += char === '\t' ? ' '.repeat(4 - (out.length % 4)) : char;
	return out;
}

/**
 * Every line of the note read into CommonMark's blocks, as commonmark.js reads
 * them: quotes and list items, with lazy lines, around fenced and indented
 * code, HTML, headings and paragraphs. Only as far as telling code from text
 * needs, so a list is only its items, and a table row, which a span cannot
 * cross, is read on its own, as in GitHub's Markdown.
 */
function lineKinds(lines: string[]): { kind: LineKind; unit: number }[] {
	type Container = { quote: true } | { quote: false; width: number; content: boolean };
	type Leaf = { kind: 'paragraph'; unit: number } | { kind: 'fence'; char: string; length: number } | { kind: 'indented'; unit: number } | { kind: 'html'; end: RegExp | null; unit: number };
	const open: Container[] = [];
	let leaf: Leaf | null = null;
	let units = 0;

	return lines.map((raw) => {
		const line = columns(raw.replace(/\r?\n$/, ''));
		let offset = 0;
		// Where the spaces from `offset` end. Remembered, because `offset` only
		// moves on along a line, and scanning the same run of spaces again for
		// every container a deep list has open made a line quadratic.
		let scannedFrom = -1;
		let scannedTo = -1;
		const nonspace = () => {
			if (offset >= scannedFrom && offset <= scannedTo) return scannedTo;
			let at = offset;
			while (line[at] === ' ') at++;
			scannedFrom = offset;
			scannedTo = at;
			return at;
		};
		let breaks: boolean[] | null = null;
		const thematic = (at: number) => (breaks ??= thematicBreaks(line))[at] === true;
		// Blank from where the containers matched so far end: `>` alone is a blank
		// line in a quote.
		const blank = () => nonspace() >= line.length;

		// The containers the line continues.
		let matched = 0;
		for (const container of open) {
			const at = nonspace();
			if (container.quote) {
				if (at - offset > 3 || line[at] !== '>') break;
				offset = line[at + 1] === ' ' ? at + 2 : at + 1;
			} else if (blank()) {
				if (!container.content) break;
				offset = at;
			} else {
				if (at - offset < container.width) break;
				offset += container.width;
			}
			matched++;
		}
		const all = matched === open.length;

		// The leaf it continues, when it is in every container that leaf is in.
		if (all && leaf?.kind === 'fence') {
			const at = nonspace();
			const closing = CLOSING_FENCE.exec(line.slice(at));
			if (at - offset <= 3 && closing && closing[1]![0] === leaf.char && closing[1]!.length >= leaf.length) leaf = null;
			return { kind: 'in fence', unit: units++ };
		}
		// An HTML or indented code block is read for spans, as pandoc reads
		// Markdown in HTML, and as the core read both before it knew them: as
		// text, one lone `%%` would hide the rest of the note. A blank line
		// breaks them, and in HTML so does a line that looks like a block.
		if (all && ((leaf?.kind === 'indented' && (blank() || nonspace() - offset >= 4)) || (leaf?.kind === 'html' && !(blank() && leaf.end === null)))) {
			if (blank()) {
				leaf.unit = units++;
				return { kind: 'other', unit: units++ };
			}
			if (leaf.kind === 'html' && BLOCK_START.test(raw)) leaf.unit = units++;
			const unit = leaf.unit;
			if (leaf.kind === 'html' && leaf.end?.test(line)) leaf = null;
			return { kind: 'inline', unit };
		}
		// Any other leaf has ended, and so has a paragraph at a blank line. One
		// that goes on, in every container or lazily, a block start can still
		// interrupt.
		if (leaf !== null && (leaf.kind !== 'paragraph' || blank())) leaf = null;
		const inParagraph = () => leaf?.kind === 'paragraph';
		// Whether a block start would interrupt the paragraph in the innermost
		// container, which it may only do as CommonMark allows.
		const interrupting = () => all && inParagraph();
		const start = () => {
			open.length = matched;
			leaf = null;
			const inner = open[open.length - 1];
			if (inner && !inner.quote) inner.content = true;
		};
		for (;;) {
			const at = nonspace();
			const rest = line.slice(at);
			if (at - offset >= 4) {
				if (inParagraph() || blank()) break;
				start();
				leaf = { kind: 'indented', unit: units++ };
				return { kind: 'inline', unit: leaf.unit };
			}
			if (rest[0] === '>') {
				start();
				open.push({ quote: true });
				matched = open.length;
				offset = line[at + 1] === ' ' ? at + 2 : at + 1;
				continue;
			}
			if (ATX_HEADING.test(rest)) {
				start();
				return { kind: 'inline', unit: units++ };
			}
			const fence = FENCE.exec(rest);
			if (fence) {
				start();
				const marker = fence[1] ?? fence[2]!;
				leaf = { kind: 'fence', char: marker[0]!, length: marker.length };
				return { kind: 'fence', unit: units++ };
			}
			const html = HTML_BLOCKS.findIndex(([opening], kind) => opening.test(rest) && (kind < 6 || !inParagraph()));
			if (html !== -1) {
				start();
				const end = HTML_BLOCKS[html]![1];
				const unit = units++;
				if (!end?.test(rest)) leaf = { kind: 'html', end, unit };
				return { kind: 'inline', unit };
			}
			if (interrupting() && SETEXT_UNDERLINE.test(rest)) {
				leaf = null;
				return { kind: 'other', unit: units++ };
			}
			if (thematic(at)) {
				start();
				return { kind: 'other', unit: units++ };
			}
			// A list item, which can interrupt a paragraph only when it has
			// something in it, and when numbered, only from 1.
			const item = LIST_MARKER.exec(rest);
			const after = item ? line.slice(at + item[0].length) : '';
			const empty = after.trim() === '';
			if (item && !(interrupting() && (empty || (item[1] !== undefined && Number(item[1]) !== 1)))) {
				const spaces = /^ */.exec(after)![0].length;
				const padding = item[0].length + (spaces >= 5 || spaces < 1 || empty ? 1 : spaces);
				start();
				open.push({ quote: false, width: at - offset + padding, content: false });
				matched = open.length;
				offset = Math.min(at + padding, line.length);
				continue;
			}
			break;
		}

		if (blank()) {
			open.length = matched;
			leaf = null;
			return { kind: 'other', unit: units++ };
		}
		if (!inParagraph()) start();
		const paragraph = leaf ?? { kind: 'paragraph', unit: units++ };
		leaf = paragraph;
		if (!/^\|/.test(line.slice(nonspace()))) return { kind: 'inline', unit: paragraph.unit };
		// A table row is read on its own, and so is what follows it.
		const unit = units++;
		paragraph.unit = units++;
		return { kind: 'inline', unit };
	});
}

/**
 * The note cut into code and everything else, which concatenate back to it.
 *
 * Code is a fenced block, and with `inline` also a backtick span. Headings want
 * fences only, so that what is not code is always whole lines. Each fenced
 * block is a segment of its own, opening line first.
 *
 * What is a fenced block is read as CommonMark reads it, quotes, list items
 * and their lazy lines included, because every mistake there is a comment
 * kept: a fence indented four spaces past its container is no fence, a
 * closing fence is indented three at most, and a block ends with the quote or
 * the list item it is in, closed or not. `tests/commonmark.test.ts` holds it
 * to commonmark.js.
 *
 * A span can cross a line break, within a paragraph: read line by line, its
 * closing backtick would open a span on the next line, and a comment after it
 * would count as code and be kept. So spans are read over the lines of a
 * paragraph together, and never into the next block. A heading's spans are
 * read on its line. An HTML block's are read as in a paragraph, since pandoc
 * reads Markdown in it, and so are an indented code block's, which is text
 * here: a `%%` in its backticks stays, as Obsidian shows it.
 */
export function segments(text: string, inline = true): Segment[] {
	const out: Segment[] = [];
	const push = (code: boolean, part: string) => {
		if (part === '') return;
		const last = out[out.length - 1];
		if (last && last.code === code) last.text += part;
		else out.push({ code, text: part });
	};

	// The lines of the paragraph being read, for spans that cross a line break.
	let paragraph = '';
	let unit = -1;
	const flush = () => {
		spans(paragraph, push);
		paragraph = '';
	};
	const lines = text.split(/(?<=\n)/);
	lineKinds(lines).forEach(({ kind, unit: next }, i) => {
		const line = lines[i]!;
		if (kind !== 'inline' || next !== unit) flush();
		unit = next;
		if (kind === 'fence') {
			// A segment of its own, even right after another block, so that a
			// block can be told by its opening line.
			out.push({ code: true, text: line });
		} else if (kind === 'in fence') push(true, line);
		else if (kind === 'inline' && inline) paragraph += line;
		else push(false, line);
	});
	flush();
	return out;
}

/**
 * A paragraph's lines, with its backtick spans marked as code. An unmatched run of
 * backticks is text, and so is a backtick escaped with `\`, though the rest of
 * its run can still open a span, as in CommonMark.
 */
function spans(line: string, push: (code: boolean, part: string) => void): void {
	let start = 0;
	let i = 0;
	while (i < line.length) {
		if (line[i] !== '`') {
			i++;
			continue;
		}
		let slashes = 0;
		while (i - slashes > start && line[i - slashes - 1] === '\\') slashes++;
		if (slashes % 2 === 1) {
			i++;
			continue;
		}
		let n = 0;
		while (line[i + n] === '`') n++;

		// The span closes on a run of exactly as many backticks.
		const run = '`'.repeat(n);
		let close = -1;
		let j = i + n;
		while ((j = line.indexOf(run, j)) !== -1) {
			if (line[j + n] !== '`') {
				close = j;
				break;
			}
			while (line[j] === '`') j++;
		}

		if (close === -1) {
			i += n;
			continue;
		}
		push(false, line.slice(start, i));
		push(true, line.slice(i, close + n));
		i = start = close + n;
	}
	push(false, line.slice(start));
}

/** Apply `change` to everything that is not code. */
function outsideCode(text: string, change: (prose: string) => string, inline = true): string {
	return segments(text, inline)
		.map((segment) => (segment.code ? segment.text : change(segment.text)))
		.join('');
}

/** The frontmatter block, unparsed, and the note after it. */
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
	const match = /^---\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!match) return { yaml: null, body: text };
	return { yaml: match[1] ?? '', body: text.slice(match[0].length) };
}

const COMMENT = /%%|<!--/;

/**
 * The note without its `%%comments%%` and `<!-- HTML comments -->`.
 *
 * The one thing here that is about privacy rather than looks: a comment is what
 * you wrote for yourself, and pandoc would print it, or keep it as raw HTML in
 * a Markdown export. Obsidian hides both kinds. A comment runs across lines
 * and past code, only its own kind of marker closes it, and one left open runs
 * to the end of the note, the cautious reading of a comment nobody closed.
 */
export function stripComments(text: string): string {
	// What closes the comment we are in, or null outside one.
	let closer: string | null = null;
	let out = '';
	for (const segment of segments(text)) {
		if (segment.code) {
			if (closer === null) out += segment.text;
			continue;
		}
		let rest = segment.text;
		while (rest !== '') {
			if (closer === null) {
				const open = COMMENT.exec(rest);
				if (!open) {
					out += rest;
					break;
				}
				out += rest.slice(0, open.index);
				closer = open[0] === '%%' ? '%%' : '-->';
				rest = rest.slice(open.index + open[0].length);
			} else {
				const at = rest.indexOf(closer);
				if (at === -1) break;
				rest = rest.slice(at + closer.length);
				closer = null;
			}
		}
	}
	return out;
}

const PLUGIN_BLOCK = /^(?:[ \t]*>)*[ \t]*(?:`{3,}|~{3,})[ \t]*(?:dataview|dataviewjs|tasks|query|base)(?![\w-])/;

/**
 * The note without the code blocks that plugins draw: Dataview, Tasks, search
 * and Bases. Each is a view of the vault, and exported it is only its query.
 * The whole block goes, told by the language on its opening line, and nothing
 * inside it is read.
 */
export function dropPluginBlocks(text: string): string {
	return segments(text, false)
		.filter((segment) => !(segment.code && PLUGIN_BLOCK.test(segment.text)))
		.map((segment) => segment.text)
		.join('');
}

// A tag as Obsidian reads it: after a space or at the start of a line, of
// letters, digits, `_`, `-` and `/`, and not of digits alone.
const TAG_BODY = '[\\p{L}\\p{N}_/-]+';
const TAG = new RegExp(`(^|[ \\t])#(${TAG_BODY})`, 'gmu');
const TAG_LINE = new RegExp(`^[ \\t]*#${TAG_BODY}(?:[ \\t]+#${TAG_BODY})*[ \\t]*(?:\\r?\\n|$)`, 'gmu');
const isTag = (body: string) => !/^\p{N}+$/u.test(body);

/**
 * The note without its tags, which organise the vault and mean nothing to a
 * reader. A line of tags goes, line and all; a tag in a sentence stays as its
 * word, since the sentence may need it: `#project/alpha` is "project/alpha".
 * `#1`, and the `#` in `[[note#Heading]]`, `(#id)` or a URL, are no tags. The
 * lines are read whole, past backtick spans, since a line of tags has none.
 */
export function stripTags(text: string): string {
	const lines = outsideCode(text, (prose) => prose.replace(TAG_LINE, (line: string) => ([...line.matchAll(/#([^\s#]+)/g)].every((tag) => isTag(tag[1] ?? '')) ? '' : line)), false);
	return outsideCode(lines, (prose) => prose.replace(TAG, (tag: string, before: string, body: string) => (isTag(body) ? before + body : tag)));
}

const BLOCK_ID = /(?:^|[ \t]+)\^[A-Za-z0-9-]+[ \t]*(?=\r?$)/gm;

/**
 * The note without its block IDs: `^abc123` at the end of a line, or on a line
 * of its own after a table or a quote. They name a block for a link inside the
 * vault, and mean nothing to a reader. Fences only, so that the text is whole
 * lines, and an ID at the end of a line is never mistaken for the end of a
 * piece of it; a backtick span cannot end a line with an ID in it.
 */
export function stripBlockIds(text: string): string {
	return outsideCode(text, (prose) => prose.replace(BLOCK_ID, ''), false);
}

// A footnote's label, as in `[^label]`, and a line that defines one.
const FOOTNOTE = /\[\^([^[\]\n]+)\]/g;
const DEFINITION = /^ {0,3}\[\^([^[\]\n]+)\]:/;
// A label as CommonMark matches it: without regard to case or spacing.
const normal = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The footnotes as pandoc reads them, which is not always as Obsidian does.
 *
 * Obsidian follows CommonMark, where a definition can come right after a line
 * of text, a label can have spaces, `[^X]` is the note `[^x]` defines, and a
 * label defined twice is the first definition. Pandoc takes the first two for
 * text, the third for another note, and the fourth for the last definition.
 * So a definition gets a blank line before it, every reference the spelling
 * of the definition it points at, with a `-` for each run of spaces, and a
 * second definition of a label a name no reference has, which pandoc leaves
 * out, and names in a warning. A label pandoc reads already is kept, and a
 * reference to no definition is left as written.
 */
export function footnotes(text: string): string {
	// Every definition on a line of its own, after a blank line.
	const spaced = outsideCode(text, (prose) => prose.replace(/(?<=^[ \t]*\S[^\n]*\n)(?= {0,3}\[\^[^[\]\n]+\]:)/gm, '\n'), false);

	// The name each label goes by, from its first definition.
	const names = new Map<string, string>();
	const taken = new Set<string>();
	const unique = (base: string) => {
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
		taken.add(name);
		return name;
	};
	for (const segment of segments(spaced, false)) {
		if (segment.code) continue;
		for (const line of segment.text.split('\n')) {
			const label = DEFINITION.exec(line)?.[1];
			if (label !== undefined && !names.has(normal(label))) names.set(normal(label), unique(label.trim().replace(/\s+/g, '-').replace(/\^/g, '-')));
		}
	}
	if (names.size === 0) return spaced;

	const defined = new Set<string>();
	return outsideCode(spaced, (prose) =>
		prose.replace(FOOTNOTE, (footnote: string, label: string, at: number, whole: string) => {
			const name = names.get(normal(label));
			if (name === undefined) return footnote;
			const start = whole.lastIndexOf('\n', at - 1) + 1;
			const definition = whole[at + footnote.length] === ':' && /^ {0,3}$/.test(whole.slice(start, at));
			if (definition && defined.has(name)) return `[^${unique(`${name}-duplicate`)}]`;
			if (definition) defined.add(name);
			return `[^${name}]`;
		}),
	);
}

const LEADING_H1 =/^(?:[ \t]*\r?\n)*# +(.+?)(?:[ \t]+#+)?[ \t]*(?:\r?\n|$)/;

/**
 * The title the note opens with, and the note under it with its headings
 * promoted.
 *
 * An H1 on the first line is the title: it is what the note looks like it is
 * called, and it leaves the body for the document's title block. Under it,
 * `## Section` is a top-level section of the document, so every heading moves
 * up one level. Not when an H1 is left in the body, though: a note that uses H1
 * for its own sections has already said what its top level is, and promoting
 * would merge its `##` into them.
 *
 * Here rather than pandoc's `--shift-heading-level-by`, which also demotes the
 * References heading citeproc adds afterwards.
 */
export function liftHeadings(text: string): { title: string | null; body: string } {
	const match = LEADING_H1.exec(text);
	const title = match?.[1]?.trim() || null;
	const body = match ? text.slice(match[0].length) : text;

	const hasH1 = segments(body, false).some((segment) => !segment.code && /^#(?:[ \t]|$)/m.test(segment.text));
	if (hasH1) return { title, body };

	return { title, body: outsideCode(body, (prose) => prose.replace(/^#(#{1,5})(?=[ \t]|$)/gm, '$1'), false) };
}

const IMAGE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const EMBED = /!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;
const EMBED_LINE = new RegExp(`^[ \\t]*${EMBED.source}[ \\t]*(?:\\r?\\n|$)`, 'gm');

const isImage = (target: string) => IMAGE.test(linkpathOf(target.trim()));

/**
 * Every `![[image.png]]` as a markdown image of the file Obsidian would show,
 * and every other embed gone.
 *
 * Which file that is, is Obsidian's to say, so `resolve` asks it: a bare name
 * can live in any folder. An image it cannot resolve is left as written, so
 * pandoc's warning names it. `|300` is a width, as in Obsidian, alone or after
 * a description, `|A chart|300`; any other text after `|` is the description.
 *
 * An embedded note is for whoever wrote it, like the note linked, and so is a
 * PDF or a canvas: all of them are dropped, and one on a line of its own takes
 * its line with it. That pass reads whole lines, past backtick spans, since a
 * line with only an embed on it has none.
 */
export function imageEmbeds(text: string, resolve: (linkpath: string) => string | null): string {
	const lines = outsideCode(text, (prose) => prose.replace(EMBED_LINE, (line: string, target: string) => (isImage(target) ? line : '')), false);
	return outsideCode(lines, (prose) =>
		prose.replace(EMBED, (embed: string, target: string, label?: string) => {
			if (!isImage(target)) return '';
			const linkpath = linkpathOf(target.trim());
			const path = resolve(linkpath);
			if (path === null) return embed;

			const sized = /^(?:(.*?)\\?\|)?\s*(\d+)(?:x\d+)?\s*$/.exec(label ?? '');
			const width = sized?.[2];
			const alt = (sized ? (sized[1] ?? '') : (label ?? '')).trim();
			return `![${alt}](<${path}>)${width ? `{width=${width}px}` : ''}`;
		}),
	);
}

/** `![description](path "title")`, with the path in `<…>` or not. */
const MARKDOWN_IMAGE = /!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s)]+)(\s+"[^"\n]*")?\s*\)/g;
/** An address with a scheme, `https:` or `data:`, which is no file in the vault. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Every markdown image of a file in the vault, `![A bed](bed.png)`, as the
 * file Obsidian would show, the way `imageEmbeds` writes an embed.
 *
 * Obsidian finds the file as it finds a link, so `resolve` is asked, with the
 * path's `%20`s decoded: a bare name can live in any folder, which pandoc
 * wouldn't find. `|300` at the end of the description is a width, as in
 * Obsidian. An address on the web, an image Obsidian can't find, and code are
 * left as written.
 */
export function imageLinks(text: string, resolve: (linkpath: string) => string | null): string {
	return outsideCode(text, (prose) =>
		prose.replace(MARKDOWN_IMAGE, (image: string, description: string, target: string, title?: string) => {
			const written = target.startsWith('<') ? target.slice(1, -1) : target;
			if (written === '' || SCHEME.test(written) || written.startsWith('#')) return image;
			let linkpath = written;
			try {
				linkpath = decodeURI(written);
			} catch {
				// A lone % is part of the name.
			}
			if (!IMAGE.test(linkpath)) return image;
			const path = resolve(linkpath);
			if (path === null) return image;
			const sized = /^(.*?)\\?\|\s*(\d+)(?:x\d+)?\s*$/.exec(description);
			const alt = sized ? (sized[1] ?? '').trim() : description;
			return `![${alt}](<${path}>${title ?? ''})${sized ? `{width=${sized[2]}px}` : ''}`;
		}),
	);
}

const LINK = /(?<!!)\[\[([^\]|]+)(?:\|((?:[^\]]|\](?!\]))*))?\]\]/g;

/**
 * A Markdown link, not an image, a bracket escaped by an odd run of
 * backslashes, or a footnote: its words, with brackets in them one level
 * deep, and its target, bare, with parentheses that pair up, or in `<…>`,
 * then perhaps a title, which a wikilink has no room for.
 */
const MARKDOWN_LINK = /(?<!!)(?<!(?<!\\)(?:\\\\)*\\)\[(?!\^)((?:[^[\]]|\[[^[\]]*\])*)\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\))+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\)/g;

/** Not after an odd run of backslashes, which escapes what follows. */
const UNESCAPED = String.raw`(?<!(?<!\\)(?:\\\\)*\\)`;

/** A character of `$…$` on one line: anything but `$`, or what a backslash escapes. */
const IN_LINE = String.raw`(?:[^$\\\n]|\\[^\n])`;

/**
 * Math, `$$…$$` or `$…$`, which looks like Markdown and isn't, found as pandoc
 * finds it. A `$` that a backslash escapes opens and closes nothing, and
 * neither kind runs past a blank line. `$…$` holds one line break at most,
 * starts and ends on something other than a space, and isn't math when a
 * digit follows it: `$5 and $6`.
 */
const MATH = new RegExp(
	String.raw`(${UNESCAPED}\$\$(?:(?!\n[ \t]*\n)[^\\]|\\[^\n])*?\$\$|${UNESCAPED}\$(?=\S)${IN_LINE}*?(?:\n${IN_LINE}*?)?(?:[^\s$\\]|\\[^\n])\$(?!\d))`,
);

/** Prose without its math changed, the way `outsideCode` leaves code. */
function outsideMath(prose: string, change: (text: string) => string): string {
	return prose
		.split(MATH)
		.map((part, at) => (at % 2 === 1 ? part : change(part)))
		.join('');
}

/**
 * Every Markdown link to a note in the vault, as the wikilink Obsidian takes it
 * for: `[Smith](smith-2017.md)` is `[[smith-2017\|Smith]]`. Obsidian writes a
 * link either way, as its "Use [[Wikilinks]]" setting says, and reads both
 * alike, so from here on every step has one kind of link to know. A link to a
 * `.md` file is one, and so is a path without an extension, which Obsidian
 * reads as a note too: `[Smith](smith-2017)`. A web address, a folder, a file
 * with another extension, such as a PDF, and an anchor in the note are left as
 * they are, and so are code and math, words with an image in them, and a path
 * that decodes to what a wikilink can't hold. The wikilink's pipe is always
 * written `\|`, which pandoc, the filter and the check all read as `|`, so it
 * holds in a table row however the row is written. A title is dropped.
 */
export function wikilinked(text: string): string {
	return outsideCode(text, (prose) =>
		outsideMath(prose, (part) =>
			part.replace(MARKDOWN_LINK, (link: string, words: string, written: string) => {
				const bare = written.startsWith('<') ? written.slice(1, -1) : written;
				const hash = bare.indexOf('#');
				const rawPath = hash === -1 ? bare : bare.slice(0, hash);
				if (words.includes('![') || /^[a-z][\w+.-]*:/i.test(rawPath) || rawPath === '' || rawPath.endsWith('/')) return link;
				// A file with an extension other than .md is no note.
				const name = rawPath.slice(rawPath.lastIndexOf('/') + 1);
				if (/\.[A-Za-z0-9]+$/.test(name) && !/\.md$/i.test(name)) return link;
				let path: string;
				let fragment: string;
				try {
					path = decodeURIComponent(rawPath).replace(/\.md$/i, '');
					fragment = hash === -1 ? '' : decodeURIComponent(bare.slice(hash));
				} catch {
					return link;
				}
				if (/[|[\]#^]/.test(path) || /[|[\]]/.test(fragment)) return link;
				return words.trim() === '' ? `[[${path}${fragment}]]` : `[[${path}${fragment}\\|${words}]]`;
			}),
		),
	);
}

/**
 * Every link to a paper note, pointed at the paper's citation key.
 *
 * The filter only knows a link's name, and a note is not always named for its
 * key: a template can name it for its author and title, and Better BibTeX can
 * change a key long after the note was named. `keyFor` asks the note itself, so
 * `[[Marsh (2024) The Quiet Archive|see p. 4]]` exports as the citation
 * it is. A key the alias repeats changes with the target, so the alias still
 * spells the citation out. A link to anything without a key is left as written.
 */
export function citeByKey(text: string, keyFor: (linkpath: string) => string | null): string {
	return outsideCode(text, (prose) =>
		prose.replace(LINK, (link: string, target: string, alias?: string) => {
			const linkpath = linkpathOf(target);
			// A link within the note, `[[#Heading]]`, has no linkpath, and Obsidian
			// resolves that to the note itself: a paper note would cite itself.
			if (linkpath.trim() === '') return link;
			const key = keyFor(linkpath.trim());
			if (key === null) return link;
			const fragment = target.slice(linkpath.length);
			const label = alias === undefined ? '' : `|${renameInAlias(alias, keyOf(target), key)}`;
			return `[[${key}${fragment}${label}]]`;
		}),
	);
}

/**
 * Every link to a note that is a post on a website, as a link to that post: a
 * post In the Open sends links to the posts it links to. `urlFor` gives a
 * note's post's address, or null for a note that isn't one, whose link is left
 * as written, so the filter makes it its words. The link's words are its alias,
 * or the note's name, as Obsidian shows it; a heading in it is the note's, so
 * the link goes to the post.
 */
export function linkPosts(text: string, urlFor: (linkpath: string) => string | null): string {
	return outsideCode(text, (prose) =>
		prose.replace(LINK, (link: string, target: string, alias?: string) => {
			const linkpath = linkpathOf(target).trim();
			if (linkpath === '') return link;
			const url = urlFor(linkpath);
			if (url === null) return link;
			const name = linkpath.slice(linkpath.lastIndexOf('/') + 1).replace(/\.md$/, '');
			const words = (alias ?? name).trim() || name;
			return `[${words.replace(/[[\]\\]/g, '\\$&')}](<${url}>)`;
		}),
	);
}

/**
 * Every wikilink outside code: its target as written, and the words it shows,
 * as the filter writes a link it doesn't keep. Those are the alias, or without
 * one the target up to its heading, or the heading of a link within the note.
 * Embeds are not links.
 */
export function wikilinks(text: string): { target: string; words: string }[] {
	return segments(text)
		.filter((segment) => !segment.code)
		.flatMap((segment) =>
			[...segment.text.matchAll(LINK)].map((match) => {
				const target = (match[1] ?? '').trim();
				const [name = '', ref = ''] = target.split(/#(.*)/);
				return { target, words: match[2]?.trim() || name.trim() || ref.replace(/^\^/, '') };
			}),
		);
}

/** Something in a note that a post doesn't show as Obsidian does, of one of these kinds. */
export type UnshownKind = 'callout' | 'highlight' | 'width' | 'math' | 'mermaid' | 'embed' | 'plugin block' | 'link within';

export interface Unshown {
	kind: UnshownKind;
	/** Each one as written, once, in the order of the note. */
	written: string[];
}

const UNSHOWN_ORDER: UnshownKind[] = ['callout', 'highlight', 'width', 'math', 'mermaid', 'embed', 'plugin block', 'link within'];
// A callout's first line, from its marker, in any number of quotes.
const CALLOUT = /^(?:[ \t]*>)+[ \t]*(\[![^\]\n]+\][+-]?.*?)[ \t]*$/gm;
const HIGHLIGHT = /==(?=\S)(?:[^=\n]|=(?!=))*?\S==/g;
const MERMAID = /^(?:[ \t]*>)*[ \t]*(?:`{3,}|~{3,})[ \t]*mermaid(?![\w-])/;
// A width at the end of an embed's label or an image's description, `|300` or `|300x200`.
const WIDTH = /\|\s*\d+(?:x\d+)?\s*$/;

/**
 * What in `text`, a note without its comments, a post shows otherwise than
 * Obsidian does, or not at all, so that a plugin can say so before it sends
 * the post. Only the kinds the note has, in the order of `UnshownKind`.
 *
 * - A callout is a quote, its title in bold: its kind and its folding are
 *   lost (`obsidian.lua`).
 * - A highlight is plain text, and an image's width is lost, in Markdown,
 *   which has neither. HTML keeps both.
 * - Math, and a Mermaid diagram, are shown as written, as code: a site draws
 *   neither.
 * - An embedded note, PDF or canvas is left out (`imageEmbeds`), and so is a
 *   plugin's block (`dropPluginBlocks`).
 * - A link to a heading or a block in the note itself, `[[#Method]]`, is its
 *   words: a site gives its headings ids of its own.
 */
export function unshown(text: string, post: Post): Unshown[] {
	const found = new Map<UnshownKind, string[]>();
	const add = (kind: UnshownKind, written: string) => {
		const list = found.get(kind) ?? [];
		if (!list.includes(written)) list.push(written);
		found.set(kind, list);
	};
	const unquoted = (line: string) => line.replace(/^(?:[ \t]*>)*/, '').trim();

	for (const segment of segments(text, false)) {
		if (!segment.code) {
			for (const match of segment.text.matchAll(CALLOUT)) add('callout', match[1] ?? '');
			continue;
		}
		// A block by its first line inside, or its opening line when it has none.
		const [opening = '', ...lines] = segment.text.split('\n');
		const kind = MERMAID.test(opening) ? 'mermaid' : PLUGIN_BLOCK.test(opening) ? 'plugin block' : null;
		if (kind !== null) add(kind, lines.map(unquoted).find((line) => line !== '' && !/^(?:`{3,}|~{3,})$/.test(line)) ?? unquoted(opening));
	}
	for (const segment of segments(text)) {
		if (segment.code) continue;
		segment.text.split(MATH).forEach((part, at) => {
			if (at % 2 === 1) {
				add('math', part);
				return;
			}
			if (post === 'markdown') for (const match of part.matchAll(HIGHLIGHT)) add('highlight', match[0]);
			for (const [embed, target = '', label = ''] of part.matchAll(EMBED)) {
				if (!isImage(target)) add('embed', embed);
				else if (post === 'markdown' && WIDTH.test(`|${label}`)) add('width', embed);
			}
			if (post === 'markdown') for (const [image, description = ''] of part.matchAll(MARKDOWN_IMAGE)) if (WIDTH.test(description)) add('width', image);
			for (const [link, target = ''] of part.matchAll(LINK)) if (linkpathOf(target).trim() === '') add('link within', link);
		});
	}
	return UNSHOWN_ORDER.filter((kind) => found.has(kind)).map((kind) => ({ kind, written: found.get(kind) ?? [] }));
}
