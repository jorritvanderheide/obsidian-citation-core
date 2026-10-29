// Which wikilinks are citations, as the pandoc filter decides it.
//
// `pandoc/wikilink-citations.lua` makes a link a citation when the key it names
// is in the bibliography. These are its rules in TypeScript, `read_bib`,
// `key_of` and `spelled`, so the export can say which citations are about to
// be lost before pandoc loses them, and follow a key that changed. Change one
// side and the other has to follow; `tests/pandoc.test.ts` holds both to one
// table of cases.

import { inFolder } from './paths';

/**
 * `@article{key,` and every other entry type, as the filter's `read_bib` reads
 * it: the @ opens a line, after spaces or tabs, and the key can be on the next.
 * A line ends at \n alone, as it does for the filter.
 */
const ENTRY = /(?:^|\n)[ \t\uFEFF]*@\w+\s*[{(]\s*([^,\s]+)\s*,/g;

/** Every entry key in a `.bib` file. */
export function bibKeys(bib: string): Set<string> {
	const keys = new Set<string>();
	for (const match of bib.matchAll(ENTRY)) if (match[1]) keys.add(match[1]);
	return keys;
}

/**
 * A wikilink target without its heading or block reference, or the `\` that
 * Obsidian leaves at its end when it escapes the alias's pipe in a table cell,
 * as the filter's `link` drops it.
 */
export function linkpathOf(target: string): string {
	return target.replace(/[#^].*$/, '').replace(/\\$/, '');
}

/**
 * The key a wikilink target names, as the filter's `key_of` reads it: without a
 * heading or block reference, a folder, `.md`, or the `@` that the Citations
 * plugin puts in front of a literature note's name. Given the bibliography's
 * keys, the whole path is tried first, since a key can have a slash in it:
 * `[[jones/2019]]`.
 */
export function keyOf(target: string, keys?: Set<string>): string {
	const path = linkpathOf(target);
	const whole = path.replace(/\.md$/, '').replace(/^@/, '');
	if (keys?.has(whole)) return whole;
	return path
		.slice(path.lastIndexOf('/') + 1)
		.replace(/\.md$/, '')
		.replace(/^@/, '');
}

/** A note's citation key, from the named frontmatter property, or null when it has none. */
export function propertyKey(frontmatter: unknown, property: string): string | null {
	if (frontmatter === null || typeof frontmatter !== 'object') return null;
	const value = (frontmatter as Record<string, unknown>)[property];
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Lua's `%s`, which `spelled` splits words by: not JavaScript's `\s`, which also takes a non-breaking space. */
const SPACE = /[ \t\n\v\f\r]/;
const AFTER = /[ \t\n\v\f\r,;]/;

/**
 * The alias with the key it repeats, as a word, swapped for another: the same
 * rule the filter's `spelled` reads it by, so a citation whose target moves
 * keeps its page.
 */
export function renameInAlias(alias: string, from: string, to: string): string {
	// An empty key is found everywhere, and at the end of the alias for ever.
	if (from === '') return alias;
	let at = alias.indexOf(from);
	while (at !== -1) {
		// An `@` against the key, and a `-` that leaves the author out, stay
		// with the new key.
		let start = alias[at - 1] === '@' ? at - 1 : at;
		if (alias[start - 1] === '-') start--;
		const before = start === 0 || SPACE.test(alias[start - 1] ?? '');
		const end = at + from.length;
		const after = end === alias.length || AFTER.test(alias[end] ?? '');
		if (before && after) return alias.slice(0, at) + to + alias.slice(end);
		at = alias.indexOf(from, at + 1);
	}
	return alias;
}

/**
 * The keys of links to papers that the bibliography does not have, each once.
 *
 * `keyFor` says which key a link cites, or null when it links to something
 * that is not a paper, since every other link is meant to become its words. A
 * paper whose key is missing is almost always a key Better BibTeX changed, or
 * an auto-export that has not run yet, and the filter would print its name
 * where the citation should be.
 */
export function missingKeys<T>(targets: T[], keyFor: (target: T) => string | null, keys: Set<string>): string[] {
	const missing = new Set<string>();
	for (const target of targets) {
		const key = keyFor(target);
		if (key !== null && !keys.has(key)) missing.add(key);
	}
	return [...missing].sort();
}

/**
 * What to say under the citation key property setting when no note in the
 * vault has that property, or null when one does. Without it a link to a
 * paper note cites only by the note's name, so the setting is likely to be
 * misspelled, or the notes from somewhere that writes a property of its own.
 */
export function keyPropertyStatus(frontmatters: readonly unknown[], property: string): string | null {
	if (frontmatters.some((frontmatter) => propertyKey(frontmatter, property) !== null)) return null;
	return `No note in your vault has a ${property} property, so a link to a paper note only becomes a citation when the note is named for its key.`;
}

/** What to say under the papers folder setting when no note is in it, or null when one is. */
export function papersFolderStatus(paths: readonly string[], folder: string): string | null {
	if (paths.some((path) => inFolder(path, folder))) return null;
	return `There are no notes in ${folder.replace(/\/+$/, '')}. Check the folder's name.`;
}
