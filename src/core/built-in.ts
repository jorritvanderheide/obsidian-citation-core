// The built-in pandoc: which pandoc runs, where the built-in one is kept, and
// the paths it sees. Nothing here touches the disk or the network.
import type { PlatformPath } from 'path';

/**
 * Pandoc's own WebAssembly build, from its release, pinned by hash. A plugin
 * downloads it once, when someone without pandoc agrees to, and keeps it
 * outside the vault, so it isn't synced with the notes.
 */
export const BUILT_IN = {
	version: '3.13',
	url: 'https://github.com/jgm/pandoc/releases/download/3.13/pandoc-3.13-wasm.zip',
	/** What the download weighs, for the question before it. */
	megabytes: 17,
	zipSha256: '234d2020a7f3a9aab387bd35df3c17ca2ba0078a82490e2b3ede890d648d64fe',
	entry: 'pandoc-3.13-wasm/pandoc.wasm',
	sha256: '6f4d43505a545fbfbe3ace4cd1204a7a5d5aea4a7a93c22f09056c0a9381bb4a',
	file: 'pandoc-3.13.wasm',
} as const;

/** The **Pandoc** setting's default: an installed pandoc if there is one, else the built-in one. */
export const DEFAULT_PANDOC = 'pandoc';

/** Which pandoc runs. */
export type Choice = { kind: 'installed'; executable: string } | { kind: 'built-in' };

/**
 * Which pandoc the **Pandoc** setting asks for. The default, `pandoc`, is an
 * installed one when `onPath` finds it, and the built-in one when it
 * doesn't, so a stranger without pandoc can still export; empty, or only
 * spaces, is the default too, as a blanked address is. Anything else is an
 * address of yours, used as given, trimmed: when nothing is there, running
 * it says so, rather than quietly running another pandoc.
 */
export function choosePandoc(setting: string, onPath: (name: string) => string | null): Choice {
	const value = setting.trim();
	if (value === '' || value === DEFAULT_PANDOC) {
		const found = onPath(DEFAULT_PANDOC);
		return found === null ? { kind: 'built-in' } : { kind: 'installed', executable: found };
	}
	return { kind: 'installed', executable: value };
}

/**
 * Where a program called `name` is on the PATH, as a shell finds it, or null.
 * Windows also tries the PATHEXT extensions. `exists` says whether a file is
 * there.
 */
export function findOnPath(name: string, env: Record<string, string | undefined>, path: PlatformPath, exists: (file: string) => boolean): string | null {
	const windows = path.sep === '\\';
	const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((dir) => dir !== '');
	const extensions = windows ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((ext) => ext.toLowerCase())] : [''];
	for (const dir of dirs) {
		for (const ext of extensions) {
			const file = path.join(dir, name + ext);
			if (exists(file)) return file;
		}
	}
	return null;
}

/**
 * Where the built-in pandoc is kept: the platform's cache folder for a user,
 * outside every vault, and shared by the plugins that use it.
 */
export function cacheFolder(platform: string, env: Record<string, string | undefined>, home: string, path: PlatformPath): string {
	const name = 'obsidian-citation-core';
	if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), name, 'Cache');
	if (platform === 'darwin') return path.join(home, 'Library', 'Caches', name);
	return path.join(env.XDG_CACHE_HOME ?? path.join(home, '.cache'), name);
}

/**
 * The paths the built-in pandoc sees. It has no disk of its own: it sees the
 * folders it is given, under names of its own, always with `/`. The vault is
 * `/`, so a relative path in your Pandoc arguments means what it does to an
 * installed pandoc, which runs in the vault. Any other folder a file is in,
 * the temporary one or a bibliography elsewhere, is given as `/.pandoc-<n>`.
 * Drive letters and `\` never reach it.
 */
export class Mounts {
	private readonly folders = new Map<string, string>();

	constructor(
		private readonly root: string,
		private readonly path: PlatformPath,
	) {}

	/** The name pandoc knows `host` by, a file or a folder on disk. */
	see(host: string): string {
		const inRoot = this.path.relative(this.root, host);
		if (inRoot === '') return '/';
		// `..draft.md` is a name in the vault, not a way out of it.
		const outside = inRoot === '..' || inRoot.startsWith(`..${this.path.sep}`) || this.path.isAbsolute(inRoot);
		if (!outside) return `/${inRoot.split(this.path.sep).join('/')}`;
		const folder = this.path.dirname(host);
		let guest = this.folders.get(folder);
		if (guest === undefined) {
			guest = `/.pandoc-${this.folders.size + 1}`;
			this.folders.set(folder, guest);
		}
		return `${guest}/${this.path.basename(host)}`;
	}

	/** Every folder pandoc sees, by its name there, for the WASI preopens. */
	preopens(): Record<string, string> {
		const preopens: Record<string, string> = { '/': this.root };
		for (const [host, guest] of this.folders) preopens[guest] = host;
		return preopens;
	}
}

/** The fields of a `Run` or `PostRun` that are paths on disk. */
const PATH_FIELDS = ['obsidian', 'filter', 'afterCiteproc', 'postReferences', 'template', 'fonts', 'metadata', 'references', 'bibliography', 'csl', 'referenceDoc', 'output'] as const;

/**
 * `run` with every path in it as pandoc sees it, through `see`. Its
 * `resourcePath` isn't touched: the plugin passes each folder through `see`
 * and joins them with `Pandoc.delimiter` first.
 */
export function seen<T extends object>(run: T, see: (host: string) => string): T {
	const out = { ...run } as Record<string, unknown>;
	for (const field of PATH_FIELDS) {
		const value = out[field];
		if (typeof value === 'string') out[field] = see(value);
	}
	return out as T;
}

/**
 * The bytes of one file in a ZIP archive, as stored (method 0) or deflated
 * (method 8), found through the archive's central directory. Inflating is the
 * caller's, so this stays free of the platform.
 */
export function zipEntry(zip: Uint8Array, name: string): { method: number; data: Uint8Array } {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	// The end of central directory record: its signature, searched for from the
	// end, past a comment of up to 64 KiB.
	let end = -1;
	for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error('not a ZIP archive');
	const count = view.getUint16(end + 10, true);
	let at = view.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	for (let n = 0; n < count; n++) {
		if (view.getUint32(at, true) !== 0x02014b50) throw new Error('a damaged ZIP archive');
		const method = view.getUint16(at + 10, true);
		const compressed = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const local = view.getUint32(at + 42, true);
		const entry = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
		if (entry === name) {
			if (view.getUint32(local, true) !== 0x04034b50) throw new Error('a damaged ZIP archive');
			const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
			return { method, data: zip.subarray(start, start + compressed) };
		}
		at += 46 + nameLength + extraLength + commentLength;
	}
	throw new Error(`${name} isn't in the archive`);
}

/**
 * Pandoc arguments of yours as pandoc sees them: each path `isPath` says is
 * one, alone or as an option's value (`--reference-doc=/home/ann/t.docx`),
 * through `see`. A plugin passes absolute paths to files that exist: a
 * relative one already means what it does to an installed pandoc, since the
 * vault is the built-in one's `/`.
 */
export function seenArgs(args: string[], see: (host: string) => string, isPath: (value: string) => boolean): string[] {
	return args.map((arg) => {
		const option = /^(--?[\w-]+=)(.+)$/.exec(arg);
		if (option?.[1] !== undefined && option[2] !== undefined && isPath(option[2])) return option[1] + see(option[2]);
		return isPath(arg) ? see(arg) : arg;
	});
}
