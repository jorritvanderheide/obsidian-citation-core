// Writing a citation, in the forms the filter reads.
//
// Due Credit's Insert citation, Add page to citation and Toggle author in
// citation write these. The link is to the paper: its note by name when it
// has one, so the link resolves in the vault, opens the paper on hover, and
// lands in its backlinks; otherwise the key itself, which cites just the same
// and resolves once the paper has a note named for it. A page goes in the
// label, around the name the way pandoc writes it around the key:
// `[[a|a, p. 4]]` is `[@a, p. 4]`, and `[[a|-a, p. 4]]` is `[-@a, p. 4]`. Not
// after `#`: Obsidian takes `[[a#p. 4]]` for a heading.

/**
 * Every word that starts a locator: Better BibTeX's abbreviations, their
 * plurals, and the whole words. The filter reads a locator by the same words
 * and keeps its own copy, since it is Lua; `tests/writing.test.ts` holds the
 * two to one list.
 */
export const LOCATOR_TERMS = new Set(
	`p. pp. page pages
	ch. chap. chapter subch. subchapter
	sec. section subsec. subsection
	para. paragraph subpara. subparagraph
	fig. figure col. column l. ll. line
	n. note vol. volume no. issue
	art. article op. opus pt. part r. rule
	vrs. verse sv. sch. schedule tit. title
	book folio`.split(/\s+/),
);

/** Whether the text reads as a locator: a number, `§`, or a locator word first, as the filter's `as_locator` reads it. */
export function isLocator(text: string): boolean {
	const ref = text.trim();
	if (/^\d/.test(ref) || ref.startsWith('§')) return true;
	const term = /^\p{L}+\.?/u.exec(ref)?.[0];
	return term !== undefined && LOCATOR_TERMS.has(term.toLowerCase());
}

/**
 * What someone typed for a page, as a locator. A bare number is a page, "4" or
 * "12-14", because that is nearly always what it is; anything else, "ch. 3"
 * or "§ 2", is already a locator and stays as typed.
 */
export function typedLocator(typed: string): string {
	const text = typed.trim();
	return /^\d/.test(text) ? `p. ${text}` : text;
}

/** A citation of one work, by its note's name or its key, with the page someone typed, if any. */
export function citationLink(target: string, typed = ''): string {
	return typed.trim() === '' ? `[[${target}]]` : `[[${target}|${target}, ${typedLocator(typed)}]]`;
}

/** A wikilink in a line of text, and where it sits. */
export interface LinkSpan {
	from: number;
	to: number;
	target: string;
	label: string | null;
}

/**
 * The wikilink the cursor is on, or has just finished typing.
 *
 * Just after `]]` counts, because that is where the cursor is when Obsidian's
 * own `[[` suggester has written the link. An embed is not a citation, so `![[`
 * is left.
 */
export function linkAt(line: string, ch: number): LinkSpan | null {
	for (const match of line.matchAll(/(!?)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g)) {
		const from = match.index;
		const to = from + match[0].length;
		if (ch < from || ch > to) continue;
		if (match[1] || match[2] === undefined) return null;
		return { from, to, target: match[2], label: match[3] ?? null };
	}
	return null;
}

/** The name a link cites by: its target without a folder or a heading. */
export function linkName(link: LinkSpan): string {
	const target = link.target.replace(/#.*$/, '').trim();
	return target.split('/').pop() ?? target;
}

/**
 * Where a label repeats the name as a word, the way the filter's `spelled`
 * finds it: the index just past it, or -1. A `-` against the name, which
 * leaves the author out, still counts as the name standing alone.
 */
function pastName(label: string, name: string): number {
	for (let at = label.indexOf(name); at !== -1; at = label.indexOf(name, at + 1)) {
		const end = at + name.length;
		const start = label[at - 1] === '-' ? at - 1 : at;
		const before = start === 0 || /\s/.test(label[start - 1] ?? '');
		const after = end === label.length || /[\s,;]/.test(label[end] ?? '');
		if (before && after) return end;
	}
	return -1;
}

/**
 * The link rewritten to cite a page, read the way the filter reads it.
 *
 * A label that repeats the name keeps everything around it and has its page
 * replaced: `[[a|see a, p. 3, emphasis added]]` becomes `see a, p. 4, emphasis
 * added`. Any other label is yours, so it stays and the page goes after a
 * comma, which the filter reads too: `[[a|Marsh]]` becomes `Marsh, p. 4`, and
 * a page it had is replaced. Without a label the name is it. A heading after
 * `#` goes, because a citation with a page is not a link to a section.
 */
export function withPage(link: LinkSpan, typed: string): string {
	const target = link.target.replace(/#.*$/, '').trim();
	const name = linkName(link);
	const label = link.label ?? name;
	const at = typedLocator(typed);

	const end = pastName(label, name);
	if (end !== -1) {
		// A page already after the name goes, with any bare numbers that continue
		// it, "pp. 4, 6"; what follows that is the suffix, and stays.
		const rest = label.slice(end).replace(/^,\s*([^,]*)((?:,\s*\d[^,]*)*)/, (whole: string, first: string) => (isLocator(first) ? '' : whole));
		return `[[${target}|${label.slice(0, end)}, ${at}${rest}]]`;
	}

	const comma = label.indexOf(',');
	const own = comma !== -1 && isLocator(label.slice(comma + 1)) ? label.slice(0, comma) : label;
	return `[[${target}|${own.trim()}, ${at}]]`;
}

/**
 * The link with the author left out, or named again when it was: a `-`
 * against the name in its label, as `[-@a]` is in pandoc, for a sentence that
 * names the author already.
 *
 * A label that repeats the name keeps everything around it: `[[a|see a, p.
 * 4]]` becomes `see -a, p. 4`. Any other label is only what Obsidian shows,
 * and the filter reads nothing in it but a page, so it becomes the name, with
 * that page: `[[a|Marsh, p. 4]]` becomes `-a, p. 4`. A page after `#` moves
 * into the label, as it does for Add page to citation. Named again with
 * nothing else in the label, the link is just `[[a]]`.
 */
export function toggleAuthor(link: LinkSpan): string {
	const target = link.target.replace(/#.*$/, '').trim();
	const name = linkName(link);
	const heading = /#(.*)$/.exec(link.target)?.[1]?.trim() ?? '';
	let label = link.label ?? (isLocator(heading) ? `${name}, ${heading}` : name);

	const end = pastName(label, name);
	if (end === -1) {
		const comma = label.indexOf(',');
		const page = comma !== -1 && isLocator(label.slice(comma + 1)) ? label.slice(comma) : '';
		label = `-${name}${page}`;
	} else {
		const start = end - name.length;
		label = label[start - 1] === '-' ? label.slice(0, start - 1) + label.slice(start) : `${label.slice(0, start)}-${label.slice(start)}`;
	}
	return label === name ? `[[${target}]]` : `[[${target}|${label}]]`;
}
