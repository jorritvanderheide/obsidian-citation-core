import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { citationLink, isLocator, LOCATOR_TERMS, linkAt, linkName, toggleAuthor, typedLocator, withPage } from '../src/core/writing';

describe('LOCATOR_TERMS', () => {
	it('is the filter’s list, word for word', () => {
		const lua = readFileSync(new URL('../pandoc/wikilink-citations.lua', import.meta.url), 'utf8');
		const list = /for term in \(\[\[([\s\S]*?)\]\]\):gmatch/.exec(lua)?.[1] ?? '';
		expect(new Set(list.split(/\s+/).filter(Boolean))).toEqual(LOCATOR_TERMS);
	});
});

describe('isLocator', () => {
	it('reads a number, §, or a locator word', () => {
		expect(isLocator(' 12')).toBe(true);
		expect(isLocator('§ 2')).toBe(true);
		expect(isLocator('Ch. 3')).toBe(true);
		expect(isLocator('emphasis added')).toBe(false);
	});

	it('trims only the spaces the filter trims', () => {
		expect(isLocator(' 4\n')).toBe(true);
		expect(isLocator('\u00A04')).toBe(false);
	});
});

describe('typedLocator', () => {
	it('reads a bare number as a page', () => {
		expect(typedLocator('4')).toBe('p. 4');
		expect(typedLocator(' 12-14 ')).toBe('p. 12-14');
	});

	it('keeps anything else as typed', () => {
		expect(typedLocator('ch. 3')).toBe('ch. 3');
		expect(typedLocator('§ 2')).toBe('§ 2');
		expect(typedLocator('pp. 4, 6')).toBe('pp. 4, 6');
	});
});

describe('citationLink', () => {
	it('links the work, with the page in the label when there is one', () => {
		expect(citationLink('okafor2025')).toBe('[[okafor2025]]');
		expect(citationLink('okafor2025', '4')).toBe('[[okafor2025|okafor2025, p. 4]]');
		expect(citationLink('Okafor on authenticity', 'ch. 3')).toBe('[[Okafor on authenticity|Okafor on authenticity, ch. 3]]');
	});
});

describe('linkAt', () => {
	const line = 'as argued in [[okafor]] and [[marsh|Marsh]].';

	it('finds the link the cursor is inside', () => {
		expect(linkAt(line, 17)).toEqual({ from: 13, to: 23, target: 'okafor', label: null });
	});

	it('finds the link the cursor has just passed, where [[ leaves it', () => {
		expect(linkAt(line, 23)?.target).toBe('okafor');
	});

	it('reads the label', () => {
		expect(linkAt(line, 35)).toMatchObject({ target: 'marsh', label: 'Marsh' });
	});

	it('finds nothing away from a link', () => {
		expect(linkAt(line, 5)).toBeNull();
	});

	it('leaves an embed alone', () => {
		expect(linkAt('![[figure.png]]', 5)).toBeNull();
	});
});

describe('linkName', () => {
	it('is the target without its folder or heading', () => {
		expect(linkName(linkAt('[[Literature/a#Claim]]', 2)!)).toBe('a');
	});
});

describe('withPage', () => {
	const at = (text: string) => linkAt(text, 2)!;

	it('names the link by its key', () => {
		expect(withPage(at('[[a]]'), '4')).toBe('[[a|a, p. 4]]');
	});

	it('replaces a page rather than adding a second', () => {
		expect(withPage(at('[[a|a, p. 3]]'), '4')).toBe('[[a|a, p. 4]]');
	});

	it('keeps a label of your own', () => {
		expect(withPage(at('[[a|Marsh]]'), 'ch. 3')).toBe('[[a|Marsh, ch. 3]]');
		expect(withPage(at('[[a|Marsh, p. 3]]'), '4')).toBe('[[a|Marsh, p. 4]]');
		expect(withPage(at('[[a|Marsh, pp. 3, 6]]'), '4')).toBe('[[a|Marsh, p. 4]]');
	});

	it('keeps what surrounds the name in a label that repeats it', () => {
		expect(withPage(at('[[a|see a]]'), '4')).toBe('[[a|see a, p. 4]]');
		expect(withPage(at('[[a|see a, p. 3, emphasis added]]'), '4')).toBe('[[a|see a, p. 4, emphasis added]]');
		expect(withPage(at('[[a|a, pp. 3, 6, emphasis added]]'), '4')).toBe('[[a|a, p. 4, emphasis added]]');
		expect(withPage(at('[[a|a emphasis added]]'), '4')).toBe('[[a|a, p. 4 emphasis added]]');
	});

	it('keeps a citation that leaves the author out as it is, around its new page', () => {
		expect(withPage(at('[[a|-a]]'), '4')).toBe('[[a|-a, p. 4]]');
		expect(withPage(at('[[a|see -a, p. 3, emphasis added]]'), '4')).toBe('[[a|see -a, p. 4, emphasis added]]');
	});

	it('does not take a word that only starts with the name for it', () => {
		expect(withPage(at('[[a|about]]'), '4')).toBe('[[a|about, p. 4]]');
	});

	it('drops a heading, because a page is not a section', () => {
		expect(withPage(at('[[a#Claim]]'), '4')).toBe('[[a|a, p. 4]]');
	});

	it('keeps a folder in the target but not in the label', () => {
		expect(withPage(at('[[Literature/a]]'), '4')).toBe('[[Literature/a|a, p. 4]]');
	});
});

describe('toggleAuthor', () => {
	const toggled = (text: string) => toggleAuthor(linkAt(text, 2)!);

	it('leaves the author out, and names them again', () => {
		expect(toggled('[[a]]')).toBe('[[a|-a]]');
		expect(toggled('[[a|-a]]')).toBe('[[a]]');
	});

	it('keeps the page, and everything around the name', () => {
		expect(toggled('[[a|a, p. 4]]')).toBe('[[a|-a, p. 4]]');
		expect(toggled('[[a|-a, p. 4]]')).toBe('[[a|a, p. 4]]');
		expect(toggled('[[a|see a, p. 4, emphasis added]]')).toBe('[[a|see -a, p. 4, emphasis added]]');
		expect(toggled('[[a|see -a, p. 4, emphasis added]]')).toBe('[[a|see a, p. 4, emphasis added]]');
	});

	it('moves a page after # into the label', () => {
		expect(toggled('[[a#p. 12]]')).toBe('[[a|-a, p. 12]]');
		expect(toggled('[[a#Claim]]')).toBe('[[a|-a]]');
	});

	it('makes a label of your own the name, with its page', () => {
		expect(toggled('[[a|Marsh, p. 4]]')).toBe('[[a|-a, p. 4]]');
		expect(toggled('[[a|Marsh]]')).toBe('[[a|-a]]');
	});

	it('keeps a folder in the target but not in the label', () => {
		expect(toggled('[[Literature/a]]')).toBe('[[Literature/a|-a]]');
	});

	it('does not take a word that only starts with the name for it', () => {
		expect(toggled('[[a|about]]')).toBe('[[a|-a]]');
	});
});
