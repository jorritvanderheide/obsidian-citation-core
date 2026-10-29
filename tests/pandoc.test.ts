// The filter and the pipeline against a real pandoc, skipped where there is none.
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN } from '../src/core/built-in';
import { bibKeys, keyOf, renameInAlias } from '../src/core/citations';
import { inputFiles, MARKDOWN_TEMPLATE, pandocArgs, postArgs, readReferences, refused } from '../src/core/document';
import { footnotes, literalBackslashes } from '../src/core/markdown';
import { prepare } from '../src/core/prepare';

function installed(program = 'pandoc'): boolean {
	try {
		execFileSync(program, ['--version']);
		return true;
	} catch {
		return false;
	}
}

const dir = mkdtempSync(join(tmpdir(), 'due-credit-test-'));
const obsidian = join(process.cwd(), 'pandoc', 'obsidian.lua');
const filter = join(process.cwd(), 'pandoc', 'wikilink-citations.lua');
const afterCiteproc = join(process.cwd(), 'pandoc', 'after-citeproc.lua');
const template = join(dir, 'markdown.template');
const fonts = join(process.cwd(), 'fonts');
writeFileSync(template, MARKDOWN_TEMPLATE);
const metadata = join(dir, 'metadata.json');
writeFileSync(metadata, '{}');
const bib = join(dir, 'library.bib');
writeFileSync(bib, '@article{a,\n  author = {A, Ann},\n  title = {First},\n  year = {2024}\n}\n@article{b,\n  author = {B, Bob},\n  title = {Second},\n  year = {2025}\n}\n@article{smith:2017,\n  author = {Smith, Sam},\n  title = {Colons},\n  year = {2017}\n}\n@article{jones/2019,\n  author = {Jones, Jo},\n  title = {Slashes},\n  year = {2019}\n}\n');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every test here runs pandoc synchronously, a second at a time on the built-in
// one, which keeps vitest's worker from answering vitest for minutes on end.
// A turn of the event loop before each test lets it.
beforeEach(() => new Promise((resolve) => setImmediate(resolve)));

// The expected output is one pandoc's: citeproc formats some entries
// differently from one version to the next. A run against another pandoc says
// so here, before its differences turn up below looking like bugs.
describe.skipIf(!installed())('the pandoc these tests run against', () => {
	it(`is pandoc ${BUILT_IN.version}, the built-in pandoc's version and CI's`, () => {
		const found = execFileSync('pandoc', ['--version'], { encoding: 'utf8' }).split('\n')[0];
		expect(found, `Run the tests in nix develop, which has pandoc ${BUILT_IN.version}`).toBe(`pandoc ${BUILT_IN.version}`);
	});
});

describe.skipIf(!installed())('the options Due Credit refuses', () => {
	// A refused option is matched by any start of its name, the way pandoc reads
	// it. An option of pandoc's own whose whole name is such a start would be
	// turned down for nothing: pandoc's own list says there is none.
	it('include no other option pandoc has, by its whole name', () => {
		const ours = ['output', 'from', 'read', 'to', 'write', 'defaults', 'extract-media', 'log', 'help', 'version', 'print-default-template', 'print-default-data-file', 'print-highlight-style', 'list-input-formats', 'list-output-formats', 'list-extensions', 'list-highlight-languages', 'list-highlight-styles', 'dump-args', 'bash-completion'];
		const listed = [...execFileSync('pandoc', ['--help'], { encoding: 'utf8' }).matchAll(/--([a-z][a-z-]*)/g)].map((match) => match[1] ?? '');
		expect(listed.length).toBeGreaterThan(100);
		expect(listed.filter((name) => !ours.includes(name) && refused([`--${name}`]) !== null)).toEqual([]);
		const short = [...execFileSync('pandoc', ['--help'], { encoding: 'utf8' }).matchAll(/^\s+-([A-Za-z])\b/gm)].map((match) => match[1] ?? '');
		expect(short.filter((letter) => !'ofrtwdhvD'.includes(letter) && refused([`-${letter}`]) !== null)).toEqual([]);
		expect(short).toContain('M');
	});
});

/** The body of a one-paragraph note, cited and rendered to plain text. */
function cite(markdown: string): string {
	const output = join(dir, 'out.md');
	const args = pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output });
	execFileSync('pandoc', [...args.filter((arg) => !arg.startsWith('--to=')), '--to=plain', '--wrap=none'], { input: markdown });
	return readFileSync(output, 'utf8').split('\n')[0] ?? '';
}

describe.skipIf(!installed())('wikilink-citations.lua', () => {
	it.each([
		['[[a]]', '(A 2024)'],
		['[[Literature/a.md]]', '(A 2024)'],
		['[[@a]]', '(A 2024)'],
		['[[Literature/@a.md#p. 12]]', '(A 2024, 12)'],
		['[[a#p. 12]]', '(A 2024, 12)'],
		['[[a#pp. 12-14]]', '(A 2024, 12–14)'],
		['[[a#ch. 3]]', '(A 2024, ch. 3)'],
		['[[a#§ 3]]', '(A 2024, sec. 3)'],
		['[[a#p. 12|label]]', '(A 2024, 12)'],
		['[[a#Claim]]', '(A 2024)'],
		['[[a#p. 12]]; [[b#p. 3]]', '(A 2024, 12; B 2025, 3)'],
		['[[a]], [[b]]', '(A 2024), (B 2025)'],
		['[[a]] and [[b]]', '(A 2024) and (B 2025)'],
		['[[My idea|this idea]] holds', 'this idea holds'],
		// A note's headings are for whoever wrote it: a link to one is words.
		['[[Other note#Section]] says', 'Other note says'],
		['[[Other note#^abc123]] says', 'Other note says'],
		['[[Other note#Section|there]] it is', 'there it is'],
		['[[#Local heading]] above', 'Local heading above'],
		// An in-text citation does not swallow the wikilink after it, and keeps a page in brackets.
		['As @a [[b]] argues', 'As A (2024) (B 2025) argues'],
		['As @a [[My idea|this idea]] argues', 'As A (2024) this idea argues'],
		['@a [[b|see b, p. 3]]', 'A (2024) (see B 2025, 3)'],
		['@a [p. 4] says', 'A (2024, 4) says'],
		// A bare @word that names no entry is a handle or a quote's, not a
		// citation: it stays as written. In brackets it is still one.
		['As @jack wrote', 'As @jack wrote'],
		['@jack [p. 4] says', '@jack [p. 4] says'],
		['@jack [[b]] says', '@jack (B 2025) says'],
		['see [@typo]', 'see (typo?)'],
		// A web link stays one, even when its last part is a key.
		['[the page](https://example.org/a) says', 'the page says'],
		['<https://example.org/a>', 'https://example.org/a'],
		// A wikilink is never a web address, even with a colon in it: a key can
		// have one, as Better BibTeX allows, and a note's name never does.
		['[[smith:2017]] says', '(Smith 2017) says'],
		['[[smith:2017|smith:2017, p. 7]]', '(Smith 2017, 7)'],
		// A key can have a slash too, which a link reads as a folder: the whole
		// path is tried as a key first.
		['[[jones/2019|jones/2019, p. 12]]', '(Jones 2019, 12)'],
		['[[jones/2019]] says', '(Jones 2019) says'],
		// Paper Trail's form, from Insert annotation, and Due Credit's Insert citation: everything around the key, in the alias.
		['[[a|a, p. 4]]', '(A 2024, 4)'],
		['[[a|see a, p. 4, emphasis added]]', '(see A 2024, 4, emphasis added)'],
		['[[a|a, p. 4]]; [[b]]', '(A 2024, 4; B 2025)'],
		// A - against the key leaves the author out, as [-@a] does.
		['[[a|-a, p. 4]]', '(2024, 4)'],
		['[[a|see -a, p. 4]]', '(see 2024, 4)'],
		['[[a|-a]]; [[b]]', '(2024; B 2025)'],
		['[[a|re-a]]', '(A 2024)'],
		// An @ against the key, the way pandoc writes it, is read the same.
		['[[a|see @a, p. 4]]', '(see A 2024, 4)'],
		['[[a|-@a, p. 4]]', '(2024, 4)'],
		['[[@a|see @a, p. 4]]', '(see A 2024, 4)'],
		['[[a|me@a]]', '(A 2024)'],
		['[[a|about a, ch. 2]]', '(about A 2024, ch. 2)'],
		['[[a#p. 12|a]]', '(A 2024, 12)'],
		['[[a#p. 12|a, p. 4]]', '(A 2024, 4)'],
		['[[a|Ann’s paper]]', '(A 2024)'],
		// Due Credit's Add page to citation on a label you wrote: the page after its first comma.
		['[[a|Marsh, p. 4]]', '(A 2024, 4)'],
		['[[a|Marsh, pp. 4, 6]]', '(A 2024, 4, 6)'],
		['[[a|Smith, Jones]]', '(A 2024)'],
		// Every abbreviation Better BibTeX writes counts as a locator.
		['[[a|a, col. 2]]', '(A 2024, col. 2)'],
		['[[a|Marsh, art. 12]]', '(A 2024, art. 12)'],
	])('%s exports as %s', (written, exported) => {
		expect(cite(written)).toBe(exported);
	});
});

// The rules `core/citations.ts` repeats from the filter, held to one table.
type Inline = { t: string; c?: unknown };
type Citation = { citationId: string; citationPrefix: Inline[]; citationSuffix: Inline[]; citationMode: { t: string } };

/** The first citation the filter alone makes of a paragraph, or null. */
function filtered(markdown: string, bibliography = bib): { key: string; prefix: string; suffix: string; mode: string } | null {
	const args = ['--from=markdown+wikilinks_title_after_pipe', `--lua-filter=${filter}`, `--bibliography=${bibliography}`, '--to=json'];
	const json = JSON.parse(execFileSync('pandoc', args, { input: markdown }).toString()) as { blocks: { c: Inline[] }[] };
	const cite = json.blocks[0]?.c.find((inline) => inline.t === 'Cite');
	const first = (cite?.c as [Citation[]] | undefined)?.[0][0];
	if (!first) return null;
	const words = (inlines: Inline[]) => inlines.map((inline) => (inline.t === 'Str' ? (inline.c as string) : ' ')).join('');
	return { key: first.citationId, prefix: words(first.citationPrefix), suffix: words(first.citationSuffix), mode: first.citationMode.t };
}

describe.skipIf(!installed())('a bare @word', () => {
	it('stays a citation when the filter cannot read every key, from a bibliography that is not a .bib', () => {
		expect(filtered('As @jack wrote')).toBeNull();
		expect(filtered('As @jack wrote', join(dir, 'library.json'))?.key).toBe('jack');
	});

	it('goes back to its words with a .bibtex too, which is read like a .bib', () => {
		const bibtex = join(dir, 'library.bibtex');
		writeFileSync(bibtex, readFileSync(bib));
		expect(filtered('[[a]]', bibtex)?.key).toBe('a');
		expect(filtered('As @jack wrote', bibtex)).toBeNull();
	});
});

describe.skipIf(!installed())('one rule, written twice', () => {
	// An entry can have its key on the line after the brace, and pandoc can be
	// given a list of bibliographies: in pandoc 3 that list is no MetaList.
	it('reads an entry split over lines, and every bibliography given, as bibKeys and pandoc do', () => {
		const split = join(dir, 'split.bib');
		writeFileSync(split, '@article{\n  split,\n  author = {Split, Sam},\n  title = {T},\n  year = {2019}\n}\n');
		expect([...bibKeys(readFileSync(split, 'utf8'))]).toEqual(['split']);
		expect(filtered('[[split]]', split)?.key).toBe('split');
		expect(filtered('As @split says', split)?.key).toBe('split');
		const args = ['--from=markdown+wikilinks_title_after_pipe', `--lua-filter=${filter}`, `--bibliography=${bib}`, `--bibliography=${split}`, '--to=json'];
		const json = JSON.parse(execFileSync('pandoc', args, { input: '[[a]] and [[split]]' }).toString()) as { blocks: { c: Inline[] }[] };
		const cited = (json.blocks[0]?.c ?? []).filter((inline) => inline.t === 'Cite').map((inline) => (inline.c as [Citation[]])[0][0]?.citationId);
		expect(cited).toEqual(['a', 'split']);
	});

	it.each(['a', 'Literature/a', 'Literature/a.md', 'a#p. 12', 'a#^block', '@a', 'Literature/@a.md#Claim', '@@a', 'a.pdf', 'ab', 'a.md.md', 'Notes/b a'])(
		'[[%s]] is a citation in the filter exactly when keyOf names the key',
		(target) => {
			expect(filtered(`[[${target}]]`)?.key ?? null).toBe(keyOf(target) === 'a' ? 'a' : null);
		},
	);

	it('[[smith:2017]] is a citation in the filter, as keyOf names it, a colon and all', () => {
		expect(filtered('[[smith:2017]]')?.key).toBe(keyOf('smith:2017'));
	});

	it('[[jones/2019]] is a citation in the filter, as keyOf names it given the keys', () => {
		expect(filtered('[[jones/2019]]')?.key).toBe(keyOf('jones/2019', bibKeys(readFileSync(bib, 'utf8'))));
		expect(filtered('[[Literature/a]]')?.key).toBe(keyOf('Literature/a', bibKeys(readFileSync(bib, 'utf8'))));
	});

	// Where `renameInAlias` finds the key is where `spelled` splits the alias.
	it.each(['a', 'see a, p. 4', '-a, p. 4', 'see -a', '@a', 'see @a, p. 4', '-@a', 'about a; b', 'aa a', 're-a', 'me@a', 'ab', 'a.', 'see (a)', 'Smith and Jones', 'see\u00A0a'])(
		'[[a|%s]] is read around the key where renameInAlias finds it',
		(alias) => {
			const renamed = renameInAlias(alias, 'a', 'Z');
			let at = 0;
			while (at < alias.length && alias[at] === renamed[at]) at++;
			let start = alias[at - 1] === '@' ? at - 1 : at;
			const suppressed = renamed !== alias && alias[start - 1] === '-';
			if (suppressed) start--;
			expect(filtered(`[[a|${alias}]]`)).toEqual(
				renamed === alias
					? { key: 'a', prefix: '', suffix: '', mode: 'NormalCitation' }
					: { key: 'a', prefix: alias.slice(0, start).trim(), suffix: alias.slice(at + 1).trimEnd(), mode: suppressed ? 'SuppressAuthor' : 'NormalCitation' },
			);
		},
	);
});

describe.skipIf(!installed())('a bibliography with a byte order mark', () => {
	it('keeps its first entry', () => {
		const marked = join(dir, 'marked.bib');
		writeFileSync(marked, '\uFEFF@article{c,\n  author = {C, Cy},\n  title = {Third},\n  year = {2023}\n}\n');
		const output = join(dir, 'marked.txt');
		const args = pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: marked, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output });
		execFileSync('pandoc', [...args.filter((arg) => !arg.startsWith('--to=')), '--to=plain'], { input: '[[c]]\n' });
		expect(readFileSync(output, 'utf8')).toContain('(C 2023)');
	});
});

/** A note's body, exported as Markdown with the plugin's arguments. */
function markdown(input: string): string {
	const output = join(dir, 'export.md');
	execFileSync('pandoc', pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output }), { input });
	return readFileSync(output, 'utf8');
}

describe.skipIf(!installed())('obsidian.lua', () => {
	it('exports a callout as a quote under its title in bold', () => {
		expect(markdown('> [!note]- My *title*\n> Body [[a]].\n')).toBe('> **My *title***\\\n> Body (A 2024).\n\nA, Ann. 2024. *First*.\n');
	});

	it('keeps math in a document, which draws it', () => {
		expect(markdown('Inline $E=mc^2$.\n\n$$\n\\int_0^1 x\\,dx\n$$\n')).toBe('Inline $E=mc^2$.\n\n$$\\int_0^1 x\\,dx$$\n');
	});

	it('drops the marker of a callout without a title, and leaves a plain quote alone', () => {
		expect(markdown('> [!tip]\n> Untitled.\n\n> A quote.\n')).toBe('> Untitled.\n\n> A quote.\n');
		expect(markdown('> [!warning] Only a title\n')).toBe('> **Only a title**\n');
	});

	it('makes an image with an italic line under it a figure, with that caption, in every format but Markdown', () => {
		const output = join(dir, 'figure.html');
		const args = pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output });
		execFileSync('pandoc', [...args.filter((arg) => !arg.startsWith('--to=') && !arg.startsWith('--template=')), '--to=html'], { input: '![Wooden bed](bed.png)\n*A raised bed in March.*\n' });
		expect(readFileSync(output, 'utf8')).toContain('<figure>\n<img src="bed.png" alt="Wooden bed" />\n<figcaption>A raised bed in March.</figcaption>\n</figure>');
	});

	// Markdown has figures only in pandoc's own, and only since a pandoc newer
	// than many people have installed: an older one left the caption out
	// altogether. So a Markdown export leaves the paragraph as Obsidian shows it:
	// with strict line breaks on, as here, the caption runs on after the image.
	it('leaves the image and its caption in italics in a Markdown export as Obsidian shows them, and an image alone as it is', () => {
		expect(markdown('![Wooden bed](bed.png){width=300px}\n*A raised bed in March.*\n')).toBe('![Wooden bed](bed.png){width="300px"} *A raised bed in March.*\n');
		expect(markdown('Before.\n\n![Wooden bed](bed.png)\n\nAfter.\n')).toBe('Before.\n\n![Wooden bed](bed.png)\n\nAfter.\n');
		expect(markdown('![Wooden bed](bed.png) and *words*\n')).toBe('![Wooden bed](bed.png) and *words*\n');
	});

	it('keeps the line break before the caption in a Markdown export, as Obsidian has it with strict line breaks off', () => {
		const output = join(dir, 'caption.md');
		execFileSync('pandoc', pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: true, referenceDoc: null, extra: [], resourcePath: dir, output }), { input: '![Wooden bed](bed.png)\n*A raised bed.*\n' });
		expect(readFileSync(output, 'utf8')).toBe('![Wooden bed](bed.png)\\\n*A raised bed.*\n');
	});

	it('reads a callout inside a callout, without the blank line pandoc wants', () => {
		expect(markdown('> [!info|wide] Outer\n> > [!quote] Inner\n> > Said.\n')).toBe('> **Outer**\n>\n> > **Inner**\\\n> > Said.\n');
	});
});

describe.skipIf(!installed())('a heading', () => {
	it('is one right after a line of text, as in Obsidian', () => {
		expect(markdown('Text right before\n## Heading\n')).toMatch(/^Text right before\n\n#+ Heading\n$/);
	});
});

describe.skipIf(!installed())('a list', () => {
	it('is one right after a line of text, as in Obsidian', () => {
		expect(markdown('Some points:\n- one\n- two\n\nSteps:\n1. first\n2. second\n')).toBe('Some points:\n\n- one\n- two\n\nSteps:\n\n1.  first\n2.  second\n');
	});
});

describe.skipIf(!installed())('a line break', () => {
	it('is kept where Obsidian shows one, in a paragraph and a list item', () => {
		const output = join(dir, 'breaks.md');
		execFileSync('pandoc', pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: true, referenceDoc: null, extra: [], resourcePath: dir, output }), { input: 'line one\nline two\n\n- item\n  continued\n' });
		expect(readFileSync(output, 'utf8')).toBe('line one\\\nline two\n\n- item\\\n  continued\n');
	});
});

// Obsidian shows a backslash before a letter as it is, as CommonMark does.
// Read as raw TeX, `\slash` was a command and went missing from every export.
describe.skipIf(!installed())('a backslash', () => {
	const exported = (format: 'md' | 'tex', input: string) => {
		const output = join(dir, `backslash.${format}`);
		execFileSync('pandoc', pandocArgs(format, { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output }), { input });
		return readFileSync(output, 'utf8');
	};

	it('before a word or in a path exports as written', () => {
		expect(cite('Back\\slash and C:\\path\\x.')).toBe('Back\\slash and C:\\path\\x.');
		expect(cite(literalBackslashes('In C:\\temp\\ and a \\ b.'))).toBe('In C:\\temp\\ and a \\ b.');
		expect(exported('tex', 'See C:\\path\\x and \\newpage here.\n').replace(/\s+/g, ' ')).toBe('See C:\\textbackslash path\\textbackslash x and \\textbackslash newpage here. ');
	});

	it('still reaches LaTeX as a command in a raw block, which is how to write one now', () => {
		expect(exported('tex', 'Before.\n\n`\\newpage`{=latex}\n\nAfter.\n')).toBe('Before.\n\n\\newpage\n\nAfter.\n');
	});
});

describe.skipIf(!installed())('a highlight', () => {
	const exported = (format: 'md' | 'tex') => {
		const output = join(dir, `marked.${format}`);
		execFileSync('pandoc', pandocArgs(format, { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output }), { input: 'Some ==marked== text.\n' });
		return readFileSync(output, 'utf8');
	};

	it('stays one in Markdown', () => {
		expect(exported('md')).toBe('Some ==marked== text.\n');
	});

	it('is plain text in a LaTeX body, whose class need not load soul', () => {
		expect(exported('tex')).toBe('Some marked text.\n');
	});
});

describe.skipIf(!installed())('arguments of your own', () => {
	const dump = (args: string[]) => execFileSync('pandoc', ['--dump-args', ...args]).toString();

	it('are options and their values, which pandoc reads as no file', () => {
		expect(inputFiles(dump(['--toc', '-V', 'geometry:margin=1in', '--filter', 'x', '-N']))).toEqual([]);
	});

	it('give away a word pandoc would read in place of the note', () => {
		expect(inputFiles(dump(['--toc', 'notes.md']))).toEqual(['notes.md']);
	});
});

describe.skipIf(!installed())('a Word template', () => {
	it('is taken for a Word export', () => {
		const reference = join(dir, 'reference.docx');
		execFileSync('pandoc', ['-o', reference, '--print-default-data-file', 'reference.docx']);
		const output = join(dir, 'templated.docx');
		execFileSync('pandoc', pandocArgs('docx', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: reference, extra: [], resourcePath: dir, output }), { input: 'As shown [[a]].\n' });
		expect(readFileSync(output).subarray(0, 2).toString()).toBe('PK');
	});
});

// The built-in pandoc runs no PDF engine (`scripts/pandoc-wasm.mjs`).
describe.skipIf(!installed() || !installed('xelatex') || process.env.PANDOC_BUILT_IN === '1')('a PDF', () => {
	/** The fonts a PDF embeds, which it names when uncompressed. */
	const embedded = (extra: string[]) => {
		const output = join(dir, 'set.pdf');
		execFileSync('pandoc', pandocArgs('pdf', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [...extra, '--pdf-engine-opt=-output-driver=xdvipdfmx -z0'], resourcePath: dir, output }), { input: 'Plain, *italic*, **bold** and ***both***.\n', stdio: ['pipe', 'pipe', 'ignore'] });
		return [...readFileSync(output, 'latin1').matchAll(/\/FontName\s*\/[A-Z]{6}\+([\w-]+)/g)].map((match) => match[1]).sort();
	};

	it('is set in the bundled Open Sans', () => {
		expect(embedded([])).toEqual(['OpenSans-Bold', 'OpenSans-BoldItalic', 'OpenSans-Italic', 'OpenSans-Regular']);
	}, 60000);

	it('is set in a font of yours instead', () => {
		expect(embedded(['-V', 'mainfont=lmroman10-regular.otf'])).toEqual(['LMRoman10-Regular']);
	}, 60000);

	// Pandoc loads footnotehyper for a table, which reads how footnotes are set.
	it('has left-aligned footnotes, in a table too, under any class', () => {
		const output = join(dir, 'footnotes.pdf');
		for (const documentclass of ['article', 'scrartcl']) {
			const args = pandocArgs('pdf', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: ['-V', `documentclass=${documentclass}`], resourcePath: dir, output });
			execFileSync('pandoc', args, { input: 'Text.[^1]\n\n| a | b |\n|---|---|\n| cell[^2] | x |\n\n[^1]: A note.\n\n[^2]: In a table.\n', stdio: ['pipe', 'pipe', 'ignore'] });
			expect(readFileSync(output).subarray(0, 4).toString()).toBe('%PDF');
		}
	}, 60000);
});

describe.skipIf(!installed())('a markdown link', () => {
	it('to a heading by its pandoc ID stays a link', () => {
		const output = join(dir, 'anchor.md');
		const args = pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output });
		execFileSync('pandoc', args, { input: '# Intro {#intro}\n\n[back](#intro)\n' });
		expect(readFileSync(output, 'utf8')).toContain('[back](#intro)');
	});

	it('with a scheme stays a link, and a wikilink with a colon becomes its words', () => {
		expect(markdown('[zotero](zotero://select/items/ABC) and [[Meeting: notes]]\n')).toBe('[zotero](zotero://select/items/ABC) and Meeting: notes\n');
	});
});

describe.skipIf(!installed())('a table', () => {
	it('reads a citation whose pipe the cell escaped', () => {
		const output = join(dir, 'table.md');
		const args = pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output });
		const table = '| x | y |\n|---|---|\n| [[a\\|a, p. 4]] | [[a#p. 5\\|a]] |\n| [[b\\|Bob, p. 6]] | [[My idea\\|this idea]] |\n';
		execFileSync('pandoc', [...args.filter((arg) => !arg.startsWith('--to=')), '--to=plain'], { input: table });
		const exported = readFileSync(output, 'utf8');
		for (const cell of ['(A 2024, 4)', '(A 2024, 5)', '(B 2025, 6)', 'this idea']) expect(exported).toContain(cell);
		expect(exported).not.toContain('\\');
	});
});

describe.skipIf(!installed())('footnotes', () => {
	// A style that cites in footnotes, as Chicago's notes and MHRA do, with only what the tests read.
	const notes = join(dir, 'notes.csl');
	writeFileSync(
		notes,
		'<?xml version="1.0" encoding="utf-8"?>\n<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0">\n' +
			'  <info><title>Notes</title><id>notes</id><updated>2026-09-30T00:00:00+00:00</updated></info>\n' +
			'  <citation><layout suffix="." delimiter="; "><names variable="author"><name form="short"/></names><text variable="title" prefix=", "/><text variable="locator" prefix=", "/></layout></citation>\n' +
			'</style>\n',
	);

	/** A note with its footnotes, under a style or pandoc's author-date, as plain text. */
	const noted = (input: string, csl: string | null) => {
		const output = join(dir, 'noted.txt');
		const args = pandocArgs('md', { obsidian, filter, afterCiteproc, template, fonts, metadata, bibliography: bib, csl, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output });
		execFileSync('pandoc', [...args.filter((arg) => !arg.startsWith('--to=')), '--to=plain', '--wrap=none'], { input });
		return readFileSync(output, 'utf8').trim();
	};

	it('cite in one of yours without parentheses, under a style that cites in footnotes', () => {
		expect(noted('Text.[^1]\n\n[^1]: Compare [[a|a, p. 4]]; [[b]], and [[b|see b]].\n', notes)).toBe('Text.[1]\n\n[1] Compare A, First, 4; B, Second, and see B, Second.');
		expect(noted('Text.[^1]\n\n[^1]: [[a]].\n', notes)).toBe('Text.[1]\n\n[1] A, First.');
	});

	it('are one with the footnote a citation next to them becomes, in the order written', () => {
		expect(noted('A claim [[a]].[^1]\n\n[^1]: My aside.\n', notes)).toBe('A claim.[1]\n\n[1] A, First. My aside.');
		expect(noted('A claim [[a]][^1]. Next.\n\n[^1]: My aside.\n', notes)).toBe('A claim.[1] Next.\n\n[1] A, First. My aside.');
		expect(noted('A claim [[a]][^1][^2].\n\n[^1]: One.\n\n[^2]: Two.\n', notes)).toBe('A claim.[1]\n\n[1] A, First. One. Two.');
		expect(noted('A claim.[^1][[a]]\n\n[^1]: My aside.\n', notes)).toBe('A claim.[1]\n\n[1] My aside. A, First.');
		expect(noted('A claim [[a]].[^1]\n\n[^1]: My aside.\n\n    More.\n', notes)).toBe('A claim.[1]\n\n[1] A, First. My aside.\n\nMore.');
	});

	it('stay apart when you put two together, or apart from the citation', () => {
		expect(noted('A claim.[^1][^2]\n\n[^1]: One.\n\n[^2]: Two.\n', notes)).toBe('A claim.[1][2]\n\n[1] One.\n\n[2] Two.');
		expect(noted('A claim[^1] [[a]].\n\n[^1]: Mine.\n', notes)).toBe('A claim[1].[2]\n\n[1] Mine.\n\n[2] A, First.');
	});

	it('read as CommonMark reads them, once written the way pandoc does', () => {
		const note = 'Text.[^1] More[^my note], [^X] and [^d].\n[^1]: Right below.\ncontinued.\n[^my note]: Spaced.\n\n[^x]: Lower.\n\n[^d]: First.\n\n[^d]: Second.\n';
		const plain = (from: string, input: string) => execFileSync('pandoc', [`--from=${from}`, '--to=plain', '--wrap=none'], { input, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
		expect(plain('markdown', footnotes(note))).toBe(plain('commonmark+footnotes', note));
		expect(plain('markdown', footnotes(note))).toContain('[4] First.');
	});

	it('keep their citations in parentheses, apart from the text, under an author-date style', () => {
		const exported = noted('A claim [[a]].[^1]\n\n[^1]: Compare [[b]].\n', null);
		expect(exported).toMatch(/^A claim \(A 2024\)\.\[1\]\n/);
		expect(exported).toMatch(/\n\[1\] Compare \(B 2025\)\.$/);
	});
});

describe.skipIf(!installed())('a note, end to end', () => {
	it('exports without comments, titled by its H1, with sections and references under it', () => {
		const note = '---\ntitle: Old title\ntags: [private]\n---\n# On archives\n\n## Argument\n\nAs shown [[a]] and [[First paper]].%%not for you%%\n\n---\nTODO: ask supervisor\n---\n';
		// A paper note named for its title, whose key property says which paper it is.
		const vault = {
			resolve: (linkpath: string) => (linkpath === 'First paper' ? { path: 'Literature/First paper.md', file: join(dir, 'First paper.md'), frontmatter: { citekey: 'a' } } : null),
			parseYaml: () => ({ title: 'Old title', tags: ['private'] }),
		};
		const { markdown: input, metadata } = prepare(note, vault, { name: 'note', papersFolder: 'Literature', keyProperty: 'citekey', keys: null, noteStyle: false });
		const files = { obsidian, filter, afterCiteproc, template, fonts, metadata: join(dir, 'note.json'), bibliography: bib, csl: null, hardLineBreaks: false, referenceDoc: null, extra: [], resourcePath: dir, output: join(dir, 'note.md') };
		writeFileSync(files.metadata, JSON.stringify(metadata));

		execFileSync('pandoc', pandocArgs('md', files), { input });
		const exported = readFileSync(files.output, 'utf8');
		// A block between `---` lines in the body is text, as Obsidian shows it, and no metadata.
		expect(exported).toMatch(/^#+ TODO: ask supervisor$/m);
		const json = execFileSync('pandoc', [...pandocArgs('md', files).filter((arg) => !/^--(to|output|standalone|template|shift)/.test(arg)), '--to=json'], { input });
		const meta = (JSON.parse(json.toString()) as { meta: object }).meta;
		expect(meta).not.toHaveProperty('TODO');
		// Nor the paths citeproc needed, which the Word writer would keep as properties.
		expect(meta).not.toHaveProperty('bibliography');
		expect(meta).not.toHaveProperty('reference-section-title');
		expect(meta).toHaveProperty('title');

		expect(exported).toMatch(/^# On archives\n\n## Argument$/m);
		expect(exported).not.toContain('private');
		expect(exported).not.toContain('not for you');
		expect(exported).not.toContain(bib);
		expect(exported).toMatch(/^## References/m);
		expect(exported).toContain('As shown (A 2024) and (A 2024).');
	});
});

const postReferences = join(process.cwd(), 'pandoc', 'post-references.lua');

/** A note's body, as a post, with In the Open's arguments: the text, and the references apart. */
function post(format: 'markdown' | 'html', input: string): { text: string; references: string | null } {
	const output = join(dir, `post.${format}`);
	const references = join(dir, 'references.json');
	rmSync(references, { force: true });
	const withDoi = join(dir, 'doi.bib');
	writeFileSync(withDoi, '@book{a,\n  author = {A, Ann},\n  title = {First Things},\n  publisher = {Brill},\n  year = {2024},\n  doi = {10.1163/example}\n}\n@article{b,\n  author = {B, Bob},\n  title = {Second},\n  journal = {Notes},\n  year = {2025},\n  url = {https://example.org/b}\n}\n@article{c,\n  author = {C, Cy},\n  title = {Third},\n  year = {2023}\n}\n');
	const run = { obsidian, filter, postReferences, afterCiteproc, metadata, bibliography: withDoi, csl: null, hardLineBreaks: false, resourcePath: dir, references, output };
	execFileSync('pandoc', postArgs(format, run), { input });
	let written: string | null = null;
	try {
		written = readFileSync(references, 'utf8');
	} catch {
		written = null;
	}
	return { text: readFileSync(output, 'utf8'), references: written };
}

describe.skipIf(!installed())('a post', () => {
	const note = 'As [[a#p. 12]] and [[b]] say, not [[c]] [^1].\n\n# A section\n\n[^1]: A note.\n';

	it('as Markdown, links each citation to its entry, and takes the entries out, in order', () => {
		const { text, references } = post('markdown', note);
		expect(text).toContain('As ([A 2024, 12](#ref-a)) and ([B 2025](#ref-b)) say, not ([C 2023](#ref-c))');
		expect(text).toContain('## A section');
		expect(text).toContain('[^1]: A note.');
		expect(text).not.toContain('First Things');
		expect(readReferences(references ?? '')).toEqual([
			{ key: 'a', text: 'A, Ann. 2024. *First Things*. Brill. <https://doi.org/10.1163/example>.', url: 'https://doi.org/10.1163/example' },
			{ key: 'b', text: 'B, Bob. 2025. “Second.” *Notes*. <https://example.org/b>.', url: 'https://example.org/b' },
			{ key: 'c', text: 'C, Cy. 2023. *Third*.', url: null },
		]);
	});

	it('shows an image alone in its paragraph without its alt text as a caption, as Obsidian does', () => {
		const image = 'Before.\n\n![A raised bed](<https://bw20.nl/media/bed.png>)\n\nAfter.\n';
		expect(post('markdown', image).text).toBe('Before.\n\n![A raised bed](https://bw20.nl/media/bed.png)\n\nAfter.\n');
		const html = post('html', image).text;
		expect(html).toContain('<img src="https://bw20.nl/media/bed.png" alt="A raised bed" />');
		expect(html).not.toContain('figcaption');
	});

	it('makes an image with an italic line under it a figure: in HTML with its caption, in Markdown as the image and its caption in italics', () => {
		const figure = 'Before.\n\n![Wooden bed](<https://bw20.nl/media/bed.png>)\n*A raised bed in March.*\n\nAfter.\n';
		expect(post('markdown', figure).text).toBe('Before.\n\n![Wooden bed](https://bw20.nl/media/bed.png)\n\n*A raised bed in March.*\n\nAfter.\n');
		expect(post('html', figure).text).toContain('<figure>\n<img src="https://bw20.nl/media/bed.png" alt="Wooden bed" />\n<figcaption>A raised bed in March.</figcaption>\n</figure>');
	});

	it('shows math as written, in code, and math on its own as a code block', () => {
		const math = 'Inline $E=mc^2$, and $$x$$ in a sentence.\n\n$$\n\\int_0^1 x\\,dx\n$$\n';
		expect(post('markdown', math).text).toBe('Inline `$E=mc^2$`, and `$$x$$` in a sentence.\n\n    $$\\int_0^1 x\\,dx$$\n');
		const html = post('html', math).text;
		expect(html).toContain('<p>Inline <code>$E=mc^2$</code>, and <code>$$x$$</code> in a sentence.</p>\n<pre><code>$$\\int_0^1 x\\,dx$$</code></pre>');
	});

	it('as Markdown without citations, has none to take out', () => {
		const { text, references } = post('markdown', 'Just words.\n');
		expect(text).toBe('Just words.\n');
		expect(readReferences(references ?? '')).toEqual([]);
	});

	it('as HTML, is finished: citations as words, the reference list at the end, headed', () => {
		writeFileSync(metadata, JSON.stringify({ 'reference-section-title': 'References' }));
		try {
			const { text, references } = post('html', note);
			expect(text).toContain('As <span class="citation" data-cites="a">(A 2024, 12)</span> and');
			expect(text).not.toContain('href="#ref-a"');
			expect(text).toMatch(/<h2[^>]*>A section<\/h2>/);
			expect(text).toMatch(/<h2[^>]*>References<\/h2>/);
			expect(text).toContain('<em>First Things</em>');
			expect(references).toBeNull();
		} finally {
			writeFileSync(metadata, '{}');
		}
	});
});
