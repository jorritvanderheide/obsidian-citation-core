// The built-in pandoc on disk: kept in the user's cache folder, checked
// against its pinned hash every session, and downloaded once when someone
// agrees to.
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import path, { join } from 'path';
import { inflateRawSync } from 'zlib';
import { BUILT_IN, cacheFolder, choosePandoc, findOnPath, zipEntry } from './core/built-in';
import { builtInPandoc, ExportError, installedPandoc, type Pandoc } from './pandoc';

/** Compiled once a session: the file is 62 MB, and the same for every run. */
const compiled = new Map<string, WebAssembly.Module>();

/** The folder the built-in pandoc is kept in, on this computer. */
export function builtInFolder(): string {
	return cacheFolder(process.platform, process.env, homedir(), path);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * The built-in pandoc, compiled, or null when it hasn't been downloaded yet.
 * A file that doesn't match the pinned hash is taken away and is null too, so
 * it is downloaded again rather than run.
 */
export async function loadBuiltIn(folder = builtInFolder()): Promise<WebAssembly.Module | null> {
	const file = join(folder, BUILT_IN.file);
	const known = compiled.get(file);
	if (known) return known;
	if (!existsSync(file)) return null;
	const bytes = new Uint8Array(await readFile(file));
	if (sha256(bytes) !== BUILT_IN.sha256) {
		await rm(file, { force: true });
		return null;
	}
	const module = await WebAssembly.compile(bytes);
	compiled.set(file, module);
	return module;
}

/** What to say when the download doesn't match its pinned hashes. */
const MISMATCH = "The pandoc download didn't match the version this plugin was tested with, so it wasn't used. Try again later, or install pandoc yourself.";

/**
 * Download the built-in pandoc from pandoc's release, check the archive and
 * the file in it against their pinned hashes, and keep it. `fetch` is the
 * plugin's: Obsidian's `requestUrl`, which follows GitHub's redirect.
 */
export async function downloadBuiltIn(fetch: (url: string) => Promise<ArrayBuffer>, folder = builtInFolder()): Promise<WebAssembly.Module> {
	const zip = new Uint8Array(await fetch(BUILT_IN.url));
	if (sha256(zip) !== BUILT_IN.zipSha256) throw new ExportError(MISMATCH);
	const entry = zipEntry(zip, BUILT_IN.entry);
	const bytes = new Uint8Array(entry.method === 8 ? inflateRawSync(entry.data) : entry.data);
	if (sha256(bytes) !== BUILT_IN.sha256) throw new ExportError(MISMATCH);
	await mkdir(folder, { recursive: true });
	const file = join(folder, BUILT_IN.file);
	// Written whole, then moved into place, so a half-written file is never run.
	await writeFile(`${file}.part`, bytes);
	await rename(`${file}.part`, file);
	const module = await WebAssembly.compile(bytes);
	compiled.set(file, module);
	return module;
}

/**
 * The pandoc the **Pandoc** setting asks for (`choosePandoc`), run in `vault`.
 * The built-in one is downloaded first when it isn't there yet, if `agree`
 * says so; null when it doesn't. `settings` says where pandoc's path is set,
 * for the message when an installed one isn't there.
 */
export async function pandocFor(
	setting: string,
	vault: string,
	settings: string,
	agree: () => Promise<boolean>,
	fetch: (url: string) => Promise<ArrayBuffer>,
): Promise<Pandoc | null> {
	const choice = choosePandoc(setting, (name) => findOnPath(name, process.env, path, existsSync));
	if (choice.kind === 'installed') return installedPandoc(choice.executable, vault, settings);
	let module = await loadBuiltIn();
	if (module === null) {
		if (!(await agree())) return null;
		module = await downloadBuiltIn(fetch);
	}
	return builtInPandoc(module, vault);
}
