// The built-in pandoc as a plugin runs it, from PANDOC_WASM: skipped without
// it. The rest of the suite runs it too, as `pandoc`, through
// `scripts/pandoc-wasm.mjs` (`nix flake check` does both).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { seen } from '../src/core/built-in';
import { pandocArgs, postArgs, readReferences } from '../src/core/document';
import { builtInPandoc, withFiles } from '../src/pandoc';

const wasm = process.env.PANDOC_WASM;
const root = mkdtempSync(join(tmpdir(), 'built-in-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A vault, a bibliography outside it as Better BibTeX often keeps one, and
// an export saved somewhere else again.
const vault = join(root, 'Vault');
const zotero = join(root, 'Zotero');
const saved = join(root, 'Documents');
for (const dir of [vault, zotero, saved]) mkdirSync(dir);
const bibliography = join(zotero, 'library.bib');
writeFileSync(bibliography, '@book{a,\n  author = {A, Ann},\n  title = {First Things},\n  publisher = {Brill},\n  year = {2024},\n  doi = {10.1/a}\n}\n');

describe.skipIf(!wasm)('the built-in pandoc', () => {
	const pandoc = () => builtInPandoc(new WebAssembly.Module(readFileSync(wasm ?? '')), vault);

	it('exports a note to Word, with its citation, from files inside and outside the vault', async () => {
		const p = pandoc();
		const output = join(saved, 'chapter.docx');
		await withFiles({ title: 'A chapter' }, (files) =>
			p.run(
				pandocArgs(
					'docx',
					seen({ ...files, bibliography, csl: null, referenceDoc: null, hardLineBreaks: false, extra: [], resourcePath: [vault].map((dir) => p.see(dir)).join(p.delimiter), output }, (host) => p.see(host)),
				),
				'As shown [[a]].\n',
			),
		);
		const docx = readFileSync(output);
		expect(docx.subarray(0, 2).toString()).toBe('PK');
		expect(docx.length).toBeGreaterThan(5000);
	});

	it('makes a Markdown post, with its references apart', async () => {
		const p = pandoc();
		const { text, references } = await withFiles({ title: 'A post' }, async (files) => {
			const output = join(files.references, '..', 'post.md');
			await p.run(postArgs('markdown', seen({ ...files, bibliography, csl: null, hardLineBreaks: false, resourcePath: p.see(vault), output }, (host) => p.see(host))), 'As shown [[a]].\n');
			return { text: readFileSync(output, 'utf8'), references: readReferences(readFileSync(files.references, 'utf8')) };
		});
		expect(text).toBe('As shown ([A 2024](#ref-a)).\n');
		expect(references).toEqual([{ key: 'a', text: 'A, Ann. 2024. *First Things*. Brill. <https://doi.org/10.1/a>.', url: 'https://doi.org/10.1/a' }]);
	});

	it('reads a relative path in your arguments from the vault, as an installed pandoc does', async () => {
		writeFileSync(join(vault, 'shout.lua'), 'function Str(s) s.text = s.text:upper() return s end\n');
		const p = pandoc();
		const output = join(saved, 'shout.md');
		await p.run(['--lua-filter=shout.lua', '--to=plain', `--output=${p.see(output)}`], 'quiet words\n');
		expect(readFileSync(output, 'utf8')).toBe('QUIET WORDS\n');
	});

	it("says what pandoc said when it stops, and dumps your arguments", async () => {
		const p = pandoc();
		await expect(p.run(['--from=nonsense'], 'x')).rejects.toThrow(/nonsense/);
		expect(await p.dumpArgs(['--output=out.docx', 'chapter.md'])).toBe('out.docx\nchapter.md\n');
	});
});
