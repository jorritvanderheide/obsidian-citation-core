import { describe, expect, it } from 'vitest';
import { slidesOf } from '../src/core/slides';

const BREAK = '\n\n::: {.slide-break}\n:::\n\n';

describe('slidesOf', () => {
	it('splits at a --- with a blank line above it', () => {
		const { text, notes } = slidesOf('One\n\n---\n\nTwo\n');
		expect(text).toBe(`One\n\n${BREAK}\n\nTwo\n`);
		expect(notes).toEqual(['', '']);
	});

	it('keeps the properties in front, and a --- in them is no break', () => {
		const { text, notes } = slidesOf('---\ntitle: Talk\n---\nOne\n');
		expect(text).toBe('---\ntitle: Talk\n---\nOne\n');
		expect(notes).toEqual(['']);
	});

	it('splits under a heading, where --- can only be a rule', () => {
		expect(slidesOf('# One\n---\nTwo').notes).toHaveLength(2);
	});

	it.each([
		['under a line of text, which it makes a heading', 'A title\n---\nTwo'],
		['indented, which can belong to a list', '- Item\n\n  ---\n\n  More'],
		['in a quote', '> One\n>\n> ---\n>\n> Two'],
		['in a fenced code block', '```\n\n---\n\n```'],
		['in an unclosed code block', 'One\n\n```\n\n---\n\nStill code'],
		['in a comment', 'One\n\n%%\n\n---\n\n%%\n\nStill one'],
		['followed by words', 'One\n\n--- two'],
		['too short', 'One\n\n--\n\nTwo'],
		['spelled ***', 'One\n\n***\n\nStill one'],
		['spelled ___', 'One\n\n___\n\nStill one'],
		['spaced', 'One\n\n- - -\n\nStill one'],
		['in a ::: block', '::: note\n\nA\n\n---\n\nB\n\n:::'],
		['in an unclosed ::: block', '::: note\n\nA\n\n---\n\nB'],
	])('leaves a --- alone %s', (_, note) => {
		expect(slidesOf(note).notes).toHaveLength(1);
	});

	it('reads a longer break, and one with spaces after it', () => {
		expect(slidesOf('One\n\n-----\n\nTwo\n\n--- \n\nThree').notes).toHaveLength(3);
	});

	it('reads Windows line endings', () => {
		const { notes } = slidesOf('---\r\ntitle: Talk\r\n---\r\nOne %%first%%\r\n\r\n---\r\n\r\nTwo %%second%%\r\n');
		expect(notes).toEqual(['first', 'second']);
	});

	it('splits after a code block, right under its closing fence', () => {
		expect(slidesOf('```\ncode\n```\n---\nTwo').notes).toHaveLength(2);
	});

	it('reads breaks again after a ::: block', () => {
		expect(slidesOf('::: note\n\nA\n\n:::\n\n---\n\nB').notes).toHaveLength(2);
	});

	it.each([
		['empty', ''],
		['with only properties', '---\ntitle: Talk\n---\n'],
		['with only a comment of yours', '<!-- x -->'],
		['with only breaks', 'a\n\n---\n\n---\n'.replace('a', '')],
	])('is one slide when a note is %s, as pandoc makes it', (_, note) => {
		expect(slidesOf(note).notes).toEqual(['']);
	});

	it('drops a slide with nothing on it', () => {
		const { text, notes } = slidesOf('---\n\n---\n\nOne\n\n---\n\n---\n\nTwo\n\n---\n');
		expect(notes).toEqual(['', '']);
		expect(text.split(BREAK)).toHaveLength(2);
	});

	it('keeps a slide with only notes, to say something over', () => {
		expect(slidesOf('One\n\n---\n\n%%Pause here.%%\n\n---\n\nTwo').notes).toEqual(['', 'Pause here.', '']);
	});

	describe('notes', () => {
		it('come from the comments on each slide, and leave the text', () => {
			const { text, notes } = slidesOf('One %%say this%%\n\n---\n\nTwo\n\n%%say\nthat%%\n');
			expect(notes).toEqual(['say this', 'say\nthat']);
			expect(text).not.toContain('say');
		});

		it('are joined when a slide has several', () => {
			expect(slidesOf('%%a%% One %%b%%').notes).toEqual(['a\n\nb']);
		});

		it('keep links and code as written', () => {
			expect(slidesOf('One %%see [[marsh2024]] and `a %% b`%%').notes).toEqual(['see [[marsh2024]] and `a %% b`']);
		});

		it('run to the end of the note when left open, as a comment does', () => {
			const { notes, text } = slidesOf('One\n\n---\n\nTwo %%open\n\n---\n\nThree');
			expect(notes).toEqual(['', 'open\n\n---\n\nThree']);
			expect(text).not.toContain('Three');
		});

		it('are never an HTML comment, which is yours alone', () => {
			const { notes, text } = slidesOf('One <!-- private -->');
			expect(notes).toEqual(['']);
			expect(text).not.toContain('private');
		});

		it('leave a %% in code alone', () => {
			const { notes, text } = slidesOf('`%%code%%` and\n\n```\n%%more%%\n```\n');
			expect(notes).toEqual(['']);
			expect(text).toContain('%%code%%');
			expect(text).toContain('%%more%%');
		});

		it('go with the slide after a break on their own line', () => {
			expect(slidesOf('One %%first%%\n\n---%%second%%\n\nTwo').notes).toEqual(['first', 'second']);
		});
	});
});
