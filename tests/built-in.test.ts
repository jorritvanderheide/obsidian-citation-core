import { posix, win32 } from 'path';
import { deflateRawSync, inflateRawSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import { cacheFolder, choosePandoc, findOnPath, Mounts, seen, seenArgs, zipEntry } from '../src/core/built-in';

describe('choosePandoc', () => {
	const none = () => null;
	const found = (name: string) => `/usr/bin/${name}`;

	it('runs an installed pandoc by default when there is one', () => {
		expect(choosePandoc('pandoc', found)).toEqual({ kind: 'installed', executable: '/usr/bin/pandoc' });
	});

	it('runs the built-in one by default when there is none', () => {
		expect(choosePandoc('pandoc', none)).toEqual({ kind: 'built-in' });
	});

	it('reads an empty setting as the default, as a blanked address is', () => {
		expect(choosePandoc('', found)).toEqual({ kind: 'installed', executable: '/usr/bin/pandoc' });
		expect(choosePandoc('  ', none)).toEqual({ kind: 'built-in' });
	});

	it('runs a pandoc of yours as given, found or not', () => {
		expect(choosePandoc('/opt/pandoc/bin/pandoc', none)).toEqual({ kind: 'installed', executable: '/opt/pandoc/bin/pandoc' });
		expect(choosePandoc('pandoc-3', none)).toEqual({ kind: 'installed', executable: 'pandoc-3' });
	});
});

describe('findOnPath', () => {
	it('finds a program in the first folder that has it', () => {
		const files = new Set(['/usr/local/bin/pandoc', '/usr/bin/pandoc']);
		expect(findOnPath('pandoc', { PATH: '/bin:/usr/local/bin:/usr/bin' }, posix, (file) => files.has(file))).toBe('/usr/local/bin/pandoc');
	});

	it('is null without it, or without a PATH', () => {
		expect(findOnPath('pandoc', { PATH: '/bin' }, posix, () => false)).toBeNull();
		expect(findOnPath('pandoc', {}, posix, () => true)).toBeNull();
	});

	it('tries the PATHEXT extensions on Windows', () => {
		const files = new Set(['C:\\Program Files\\Pandoc\\pandoc.exe']);
		const env = { Path: 'C:\\Windows;C:\\Program Files\\Pandoc', PATHEXT: '.COM;.EXE' };
		expect(findOnPath('pandoc', env, win32, (file) => files.has(file))).toBe('C:\\Program Files\\Pandoc\\pandoc.exe');
	});
});

describe('cacheFolder', () => {
	it("is the platform's cache folder for the user, outside every vault", () => {
		expect(cacheFolder('linux', {}, '/home/ann', posix)).toBe('/home/ann/.cache/obsidian-citation-core');
		expect(cacheFolder('linux', { XDG_CACHE_HOME: '/var/cache/ann' }, '/home/ann', posix)).toBe('/var/cache/ann/obsidian-citation-core');
		expect(cacheFolder('darwin', {}, '/Users/ann', posix)).toBe('/Users/ann/Library/Caches/obsidian-citation-core');
		expect(cacheFolder('win32', { LOCALAPPDATA: 'C:\\Users\\ann\\AppData\\Local' }, 'C:\\Users\\ann', win32)).toBe('C:\\Users\\ann\\AppData\\Local\\obsidian-citation-core\\Cache');
	});
});

describe('Mounts', () => {
	it('sees the vault as / and what is in it under its own path', () => {
		const mounts = new Mounts('/home/ann/Vault', posix);
		expect(mounts.see('/home/ann/Vault')).toBe('/');
		expect(mounts.see('/home/ann/Vault/Images/bed.png')).toBe('/Images/bed.png');
		expect(mounts.see('/home/ann/Vault/..draft.md')).toBe('/..draft.md');
		expect(mounts.preopens()).toEqual({ '/': '/home/ann/Vault' });
	});

	it('gives each folder outside the vault a name of its own, once', () => {
		const mounts = new Mounts('/home/ann/Vault', posix);
		expect(mounts.see('/tmp/run-1/obsidian.lua')).toBe('/.pandoc-1/obsidian.lua');
		expect(mounts.see('/home/ann/Zotero/library.bib')).toBe('/.pandoc-2/library.bib');
		expect(mounts.see('/tmp/run-1/metadata.json')).toBe('/.pandoc-1/metadata.json');
		expect(mounts.see('/home/ann/Vault-other/note.md')).toBe('/.pandoc-3/note.md');
		expect(mounts.preopens()).toEqual({
			'/': '/home/ann/Vault',
			'/.pandoc-1': '/tmp/run-1',
			'/.pandoc-2': '/home/ann/Zotero',
			'/.pandoc-3': '/home/ann/Vault-other',
		});
	});

	it('never shows pandoc a drive letter or a backslash', () => {
		const mounts = new Mounts('C:\\Users\\ann\\Vault', win32);
		expect(mounts.see('C:\\Users\\ann\\Vault\\Images\\bed.png')).toBe('/Images/bed.png');
		expect(mounts.see('D:\\Zotero\\library.bib')).toBe('/.pandoc-1/library.bib');
		expect(mounts.preopens()).toEqual({ '/': 'C:\\Users\\ann\\Vault', '/.pandoc-1': 'D:\\Zotero' });
	});
});

/** A ZIP archive with these files, deflated or stored, as `zip` writes one. */
function zip(files: { name: string; data: Uint8Array; deflate: boolean }[]): Uint8Array {
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = new TextEncoder().encode(file.name);
		const data = file.deflate ? new Uint8Array(deflateRawSync(file.data)) : file.data;
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034b50, true);
		local.setUint16(8, file.deflate ? 8 : 0, true);
		local.setUint32(18, data.length, true);
		local.setUint32(22, file.data.length, true);
		local.setUint16(26, name.length, true);
		parts.push(new Uint8Array(local.buffer), name, data);
		const entry = new DataView(new ArrayBuffer(46));
		entry.setUint32(0, 0x02014b50, true);
		entry.setUint16(10, file.deflate ? 8 : 0, true);
		entry.setUint32(20, data.length, true);
		entry.setUint32(24, file.data.length, true);
		entry.setUint16(28, name.length, true);
		entry.setUint32(42, offset, true);
		central.push(new Uint8Array(entry.buffer), name);
		offset += 30 + name.length + data.length;
	}
	const size = central.reduce((sum, part) => sum + part.length, 0);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054b50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, size, true);
	end.setUint32(16, offset, true);
	const all = [...parts, ...central, new Uint8Array(end.buffer)];
	const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of all) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

describe('zipEntry', () => {
	const text = new TextEncoder().encode('pandoc, again and again and again');
	const archive = zip([
		{ name: 'pandoc-3.13-wasm/COPYRIGHT', data: new TextEncoder().encode('GPL'), deflate: false },
		{ name: 'pandoc-3.13-wasm/pandoc.wasm', data: text, deflate: true },
	]);

	it('finds a deflated file by its name', () => {
		const { method, data } = zipEntry(archive, 'pandoc-3.13-wasm/pandoc.wasm');
		expect(method).toBe(8);
		expect(new TextDecoder().decode(inflateRawSync(data))).toBe('pandoc, again and again and again');
	});

	it('finds a stored one', () => {
		const { method, data } = zipEntry(archive, 'pandoc-3.13-wasm/COPYRIGHT');
		expect(method).toBe(0);
		expect(new TextDecoder().decode(data)).toBe('GPL');
	});

	it('says when a file is missing, or the bytes are no archive', () => {
		expect(() => zipEntry(archive, 'pandoc.wasm')).toThrow("pandoc.wasm isn't in the archive");
		expect(() => zipEntry(new Uint8Array(100), 'x')).toThrow('not a ZIP archive');
	});
});

describe('seen', () => {
	it('has every path of a run as pandoc sees it, and leaves the rest', () => {
		const mounts = new Mounts('/home/ann/Vault', posix);
		const run = { obsidian: '/tmp/r/obsidian.lua', bibliography: '/home/ann/Zotero/library.bib', csl: null, output: '/tmp/r/post.md', resourcePath: 'kept', hardLineBreaks: true };
		expect(seen(run, (host) => mounts.see(host))).toEqual({
			obsidian: '/.pandoc-1/obsidian.lua',
			bibliography: '/.pandoc-2/library.bib',
			csl: null,
			output: '/.pandoc-1/post.md',
			resourcePath: 'kept',
			hardLineBreaks: true,
		});
	});
});

describe('seenArgs', () => {
	it('has the paths in your arguments as pandoc sees them, and leaves the rest', () => {
		const mounts = new Mounts('/home/ann/Vault', posix);
		const files = new Set(['/home/ann/Templates/thesis.docx', '/home/ann/Vault/filters/crossref.lua']);
		expect(
			seenArgs(['--reference-doc=/home/ann/Templates/thesis.docx', '--lua-filter', '/home/ann/Vault/filters/crossref.lua', '-V', 'fontsize=12pt', '--toc', '--csl=apa.csl'], (host) => mounts.see(host), (value) => files.has(value)),
		).toEqual(['--reference-doc=/.pandoc-1/thesis.docx', '--lua-filter', '/filters/crossref.lua', '-V', 'fontsize=12pt', '--toc', '--csl=apa.csl']);
	});
});
