// The bibliography's works, as a picker shows them: each one's key, who wrote
// it, when, and its title.
//
// Read from the same `.bib` the filter cites from, and only from entries it
// would read a key from (`bibKeys`), so a work that can be picked is a work
// that can be cited. Only what a person needs to recognise a work: citeproc
// formats it.

/** One work, as a picker lists it. */
export interface Entry {
	key: string;
	/** Its authors' family names, or its editors' when it has no authors. */
	names: string[];
	/** Whether the list of names was cut short, with `and others`. */
	more: boolean;
	/** The year, or empty when the entry has none. */
	year: string;
	title: string;
}

/** An entry's start, at the start of a line, as `bibKeys` reads it. */
const HEAD = /^[ \t]*@(\w+)\s*([{(])\s*([^,\s]+)\s*,/gm;

/** Entries that hold no work. */
const NOT_WORKS = new Set(['comment', 'string', 'preamble']);

/** Every work in a `.bib` file, in the file's order. */
export function bibEntries(bib: string): Entry[] {
	const text = bib.replace(/^\uFEFF/, '');
	const entries: Entry[] = [];
	for (const head of text.matchAll(HEAD)) {
		const [whole, type = '', open = '{', key = ''] = head;
		if (NOT_WORKS.has(type.toLowerCase())) continue;
		const start = head.index + whole.length;
		const fields = readFields(text.slice(start, closing(text, start, open === '{' ? '}' : ')')));
		const authors = names(fields.get('author') ?? '');
		const people = authors.names.length > 0 ? authors : names(fields.get('editor') ?? '');
		entries.push({
			key,
			names: people.names,
			more: people.more,
			year: /\d{4}/.exec(fields.get('year') ?? fields.get('date') ?? '')?.[0] ?? '',
			title: plain(fields.get('title') ?? ''),
		});
	}
	return entries;
}

/** Who and when, as a citation would say it: "Marsh 2024", "Marsh and Lee 2024", "Marsh et al. 2024". */
export function byline(entry: Entry): string {
	const [first, second] = entry.names;
	const who =
		first === undefined ? '' : entry.more || entry.names.length > 2 ? `${first} et al.` : second === undefined ? first : `${first} and ${second}`;
	return [who, entry.year].filter(Boolean).join(' ');
}

/** Where the entry that starts at `from` ends: its closing delimiter, outside any braces. */
function closing(text: string, from: number, close: '}' | ')'): number {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		const c = text[i];
		if (c === '\\') i++;
		else if (c === '{') depth++;
		else if (c === '}' && depth > 0) depth--;
		else if (c === close && depth === 0) return i;
	}
	return text.length;
}

/** An entry's fields, by lower-case name, each value as written, without its outer braces or quotes. */
function readFields(body: string): Map<string, string> {
	const fields = new Map<string, string>();
	const NAME = /[\s,]*([A-Za-z][\w-]*)\s*=\s*/y;
	let i = 0;
	while (i < body.length) {
		NAME.lastIndex = i;
		const name = NAME.exec(body);
		if (!name) break;
		i = NAME.lastIndex;
		let value = '';
		// Parts joined with `#`, as BibTeX writes a value made of several.
		for (;;) {
			const [part, next] = readValue(body, i);
			value += part;
			i = next;
			const joined = /\s*#\s*/y;
			joined.lastIndex = i;
			if (!joined.exec(body)) break;
			i = joined.lastIndex;
		}
		fields.set((name[1] ?? '').toLowerCase(), value);
	}
	return fields;
}

/** One value: `{…}`, `"…"` or a bare word, and where it ends. */
function readValue(body: string, from: number): [string, number] {
	const open = body[from];
	if (open === '{' || open === '"') {
		let depth = 0;
		for (let i = from + 1; i < body.length; i++) {
			const c = body[i];
			if (c === '\\') i++;
			else if (c === '{') depth++;
			else if (c === '}' && depth > 0) depth--;
			else if (depth === 0 && c === (open === '{' ? '}' : '"')) return [body.slice(from + 1, i), i + 1];
		}
		return [body.slice(from + 1), body.length];
	}
	const word = /[^,\s#}]*/y;
	word.lastIndex = from;
	const found = word.exec(body)?.[0] ?? '';
	return [found, from + found.length];
}

/** Splits at a separator outside braces. */
function splitOutside(text: string, separator: RegExp): string[] {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '{') depth++;
		else if (c === '}') depth--;
		else if (depth === 0) {
			separator.lastIndex = i;
			const match = separator.exec(text);
			if (match) {
				parts.push(text.slice(from, i));
				from = i + match[0].length;
				i = from - 1;
			}
		}
	}
	parts.push(text.slice(from));
	return parts.map((part) => part.trim()).filter(Boolean);
}

/** The family names in an `author` or `editor` field, and whether it ends `and others`. */
function names(field: string): { names: string[]; more: boolean } {
	const people = splitOutside(field, /\s+and\s+/iy);
	const more = people.at(-1)?.toLowerCase() === 'others';
	return { names: (more ? people.slice(0, -1) : people).map(family).filter(Boolean), more };
}

/**
 * A person's family name, as BibTeX writes one: before the comma in
 * "van der Heide, Jorrit", or from the first lower-case word on in "Jorrit van
 * der Heide". A name in braces, `{World Health Organization}`, is all of it.
 */
function family(name: string): string {
	const byComma = splitOutside(name, /,/y);
	if (byComma.length > 1) return plain(byComma[0] ?? '');
	const words = splitOutside(name, /\s+/y);
	const von = words.findIndex((word, i) => i > 0 && i < words.length - 1 && /^[a-z]/.test(word));
	return plain((von === -1 ? words.slice(-1) : words.slice(von)).join(' '));
}

/** The combining mark each LaTeX accent command stands for. */
const ACCENTS: Record<string, string> = {
	'"': '̈',
	"'": '́',
	'`': '̀',
	'^': '̂',
	'~': '̃',
	'=': '̄',
	'.': '̇',
	u: '̆',
	v: '̌',
	H: '̋',
	c: '̧',
	k: '̨',
	r: '̊',
};

/** Letters LaTeX writes as commands. */
const LETTERS: Record<string, string> = { ss: 'ß', aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'ı' };

/**
 * A field as plain text: LaTeX's accents and special letters as the
 * characters they are, its escapes as what they escape, other commands and
 * braces gone. Better BibTeX writes Unicode as it is, so this is for older
 * files and hand-written entries.
 */
function plain(text: string): string {
	return text
		.replace(/\\([`'^"~=.])\s*\{?\s*\\?([A-Za-z])\s*\}?/g, (_whole, accent: string, letter: string) => letter + (ACCENTS[accent] ?? ''))
		.replace(/\\([uvHckr])\s*\{\s*\\?([A-Za-z])\s*\}/g, (_whole, accent: string, letter: string) => letter + (ACCENTS[accent] ?? ''))
		.replace(/\\(ss|aa|AA|ae|AE|oe|OE|o|O|l|L|i)(?![A-Za-z])\s?/g, (_whole, letter: string) => LETTERS[letter] ?? letter)
		.replace(/\\([&%$#_])/g, '$1')
		.replace(/\\[A-Za-z]+\s*/g, '')
		.replace(/(?<!\\)~/g, ' ')
		.replace(/---/g, '—')
		.replace(/--/g, '–')
		.replace(/[{}]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.normalize('NFC');
}
