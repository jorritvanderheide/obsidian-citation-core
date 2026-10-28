// Running pandoc: an installed one, or the built-in one, in the plugin.
import { execFile, spawn } from 'child_process';
import { closeSync, openSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path, { delimiter, join } from 'path';
import { WASI } from 'wasi';
import afterCiteproc from '../pandoc/after-citeproc.lua';
import obsidian from '../pandoc/obsidian.lua';
import postReferences from '../pandoc/post-references.lua';
import citations from '../pandoc/wikilink-citations.lua';
import bold from '../fonts/OpenSans-Bold.ttf';
import boldItalic from '../fonts/OpenSans-BoldItalic.ttf';
import italic from '../fonts/OpenSans-Italic.ttf';
import regular from '../fonts/OpenSans-Regular.ttf';
import { Mounts } from './core/built-in';
import { MARKDOWN_TEMPLATE } from './core/document';

/** A failure already written as a sentence for the person reading it. */
export class ExportError extends Error {}

/** Where pandoc's path is set, when the plugin doesn't say. */
const SETTINGS = "the plugin's settings";

/** What to say when pandoc stops and prints nothing: `code` is its exit code, null when it has none. */
const stopped = (code: number | null) =>
	code === null
		? 'Pandoc stopped before it finished, without saying why. Try again, and if it keeps happening, please open an issue.'
		: `Pandoc stopped without saying why (exit code ${code}). Try again, and if it keeps happening, please open an issue.`;

/**
 * Call `use` with the filters, the Markdown template, the PDF's font and the
 * document's metadata on disk, and clean up afterwards.
 *
 * Pandoc takes all of them as paths. A plugin ships as one `main.js`, so the
 * filters and the template are bundled into it as text, and the font as bytes,
 * and written out for each export. The metadata is JSON, which pandoc reads as
 * the YAML it is. A post's references come back in a file of their own, which
 * `references` names and pandoc writes (`post-references.lua`).
 */
export async function withFiles<T>(
	metadata: Record<string, unknown>,
	use: (files: { obsidian: string; filter: string; afterCiteproc: string; postReferences: string; template: string; fonts: string; metadata: string; references: string }) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), 'obsidian-due-credit-'));
	try {
		const files = {
			obsidian: join(dir, 'obsidian.lua'),
			filter: join(dir, 'wikilink-citations.lua'),
			afterCiteproc: join(dir, 'after-citeproc.lua'),
			postReferences: join(dir, 'post-references.lua'),
			template: join(dir, 'markdown.template'),
			fonts: join(dir, 'fonts'),
			metadata: join(dir, 'metadata.json'),
			references: join(dir, 'references.json'),
		};
		await writeFile(files.obsidian, obsidian);
		await writeFile(files.filter, citations);
		await writeFile(files.afterCiteproc, afterCiteproc);
		await writeFile(files.postReferences, postReferences);
		await writeFile(files.template, MARKDOWN_TEMPLATE);
		await mkdir(files.fonts);
		await writeFile(join(files.fonts, 'OpenSans-Regular.ttf'), regular);
		await writeFile(join(files.fonts, 'OpenSans-Italic.ttf'), italic);
		await writeFile(join(files.fonts, 'OpenSans-Bold.ttf'), bold);
		await writeFile(join(files.fonts, 'OpenSans-BoldItalic.ttf'), boldItalic);
		await writeFile(files.metadata, JSON.stringify(metadata));
		return await use(files);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/**
 * A pandoc to run: an installed one, or the built-in one (`builtInPandoc`).
 * Arguments are built from paths as `see` gives them, and the resource path
 * joined with `delimiter`, so the same arguments work for either.
 */
export interface Pandoc {
	/** Whether this is the built-in pandoc, which runs no other program: no PDF engine and no `--filter`. */
	readonly builtIn: boolean;
	/** The path pandoc opens a file or folder on disk by. */
	see(host: string): string;
	/** What joins the folders of `--resource-path`. */
	readonly delimiter: string;
	/** Run pandoc on `input`, the note: on stdin for an installed pandoc, as an input file for the built-in one (`runWasi`). Resolves to what it warned about, if anything. */
	run(args: string[], input: string): Promise<string>;
	/** What pandoc makes of arguments: where it would write, then what it would read, from `--dump-args`. */
	dumpArgs(args: string[]): Promise<string>;
}

/**
 * An installed pandoc, run in `cwd`, the vault. `settings` says where pandoc's
 * path is set, in the plugin that runs it, for the message when it isn't there.
 */
export function installedPandoc(executable: string, cwd: string, settings = SETTINGS): Pandoc {
	const missing = () => new ExportError(`Couldn't find pandoc at "${executable}". Check the path in ${settings}, or set it back to "pandoc".`);
	return {
		builtIn: false,
		see: (host) => host,
		delimiter,
		dumpArgs: (args) =>
			new Promise((resolve, reject) => {
				execFile(executable, ['--dump-args', ...args], { cwd }, (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => {
					if (error === null) resolve(stdout);
					else if (error.code === 'ENOENT') reject(missing());
					else reject(new ExportError(`Pandoc can't use your Pandoc arguments. It said: ${stderr.trim() || error.message}`));
				});
			}),
		run: (args, input) =>
			new Promise((resolve, reject) => {
				const child = spawn(executable, args, { cwd });
				let stderr = '';
				child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
				// A pandoc that exits before reading all of stdin closes the pipe on us,
				// and why it exited is in stderr, which `close` reports.
				child.stdin.on('error', () => {});
				child.on('error', (error: NodeJS.ErrnoException) => reject(error.code === 'ENOENT' ? missing() : error));
				child.on('close', (code) => {
					if (code === 0) resolve(stderr.trim());
					else reject(new ExportError(stderr.trim() || stopped(code)));
				});
				child.stdin.end(input);
			}),
	};
}

/**
 * The built-in pandoc, `module` from `loadBuiltIn`, with `vault` as its `/`.
 * It runs in the plugin, through WASI, and sees only the vault and the
 * folders `see` gives it (`Mounts`), never the rest of the disk. It runs no
 * other program, so a PDF engine or your own `--filter` stops it with
 * pandoc's own message.
 */
export function builtInPandoc(module: WebAssembly.Module, vault: string): Pandoc {
	const mounts = new Mounts(vault, path);
	const once = (args: string[], input: string | null) => runWasi(module, mounts.preopens(), args, input);
	return {
		builtIn: true,
		see: (host) => mounts.see(host),
		// The built-in pandoc's paths are a Unix one's, on every platform.
		delimiter: ':',
		dumpArgs: async (args) => {
			const { code, stdout, stderr } = await once(['--dump-args', ...args], null);
			if (code !== 0) throw new ExportError(`Pandoc can't use your Pandoc arguments. It said: ${stderr.trim()}`);
			return stdout;
		},
		run: async (args, input) => {
			const { code, stderr } = await once(args, input);
			if (code !== 0) throw new ExportError(stderr.trim() || stopped(code));
			return stderr.trim();
		},
	};
}

/**
 * One run of `pandoc.wasm`. WASI takes stdin, stdout and stderr as files, so
 * they go through a folder of their own, removed afterwards. The note is an
 * input file there, `/.pandoc-io/note`, rather than stdin: pandoc closes
 * stdin once it has read it, and the descriptor, closed under us, could be
 * another file's by the time we close it. Given a file, pandoc leaves all
 * three open for us to close. `input` null reads no note, for `--dump-args`.
 */
export async function runWasi(module: WebAssembly.Module, preopens: Record<string, string>, args: string[], input: string | null): Promise<{ code: number; stdout: string; stderr: string }> {
	const dir = await mkdtemp(join(tmpdir(), 'obsidian-pandoc-'));
	const files = { note: join(dir, 'note'), stdin: join(dir, 'stdin'), stdout: join(dir, 'stdout'), stderr: join(dir, 'stderr') };
	try {
		await writeFile(files.stdin, '');
		if (input !== null) await writeFile(files.note, input);
		const fds = { stdin: openSync(files.stdin, 'r'), stdout: openSync(files.stdout, 'w'), stderr: openSync(files.stderr, 'w') };
		let code: number;
		try {
			const wasi = new WASI({
				version: 'preview1',
				args: ['pandoc', ...args, ...(input === null ? [] : ['/.pandoc-io/note'])],
				env: {},
				preopens: { ...preopens, '/.pandoc-io': dir },
				...fds,
				returnOnExit: true,
			});
			// Instantiated asynchronously: Obsidian's Chromium refuses to do it
			// synchronously on the main thread for a module over 8 MB, which
			// pandoc's is. Node allows it, so the tests can't tell.
			const instance = await WebAssembly.instantiate(module, wasi.getImportObject() as WebAssembly.Imports);
			code = wasi.start(instance);
		} finally {
			closeSync(fds.stdin);
			closeSync(fds.stdout);
			closeSync(fds.stderr);
		}
		return { code, stdout: await readFile(files.stdout, 'utf8'), stderr: await readFile(files.stderr, 'utf8') };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
