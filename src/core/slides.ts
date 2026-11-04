// A note read as slides: where one ends, and what you say over each.
import { segments, splitComments, splitFrontmatter } from './markdown';

/** What takes the place of a break for pandoc, which `slides.lua` splits the note at. */
const SLIDE_BREAK = '::: {.slide-break}\n:::';

export interface Deck {
	/** The note with its breaks marked and its comments gone, for `prepare`. */
	text: string;
	/** What you say over each slide, from its `%%comments%%`, and empty for a slide without. */
	notes: string[];
}

const LINE = /^.*$/gm;
const BREAK = /^-{3,}[ \t]*\r?$/;
const DIV_OPEN = /^:{3,}[ \t]*[^:\s]/;
const DIV_CLOSE = /^:{3,}[ \t]*\r?$/;
const BLANK = /^[ \t]*\r?$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|\r?$)/;

/**
 * Where each break starts in `text`. A break is `---` alone at the start of a
 * line, with a blank line or a heading above it, or nothing at all. Directly
 * under a line of text it makes that line a heading, indented it can belong to
 * a list, in code it is code, and in a `:::` block it stays a rule, because a
 * slide can't end inside one. `***` stays a rule on its slide. In an HTML block a
 * break is still read, and a plugin finds that pandoc made fewer slides.
 */
function breaksIn(text: string): { start: number; end: number }[] {
	const found: { start: number; end: number }[] = [];
	let offset = 0;
	let depth = 0;
	for (const segment of segments(text, false)) {
		if (!segment.code) {
			for (const match of segment.text.matchAll(LINE)) {
				if (DIV_CLOSE.test(match[0])) {
					depth = Math.max(0, depth - 1);
					continue;
				}
				if (DIV_OPEN.test(match[0])) {
					depth++;
					continue;
				}
				if (depth > 0 || !BREAK.test(match[0])) continue;
				const above = segment.text.slice(0, match.index).split('\n').at(-2);
				if (above === undefined || BLANK.test(above) || HEADING.test(above)) {
					found.push({ start: offset + match.index, end: offset + match.index + match[0].length });
				}
			}
		}
		offset += segment.text.length;
	}
	return found;
}

/**
 * The note as slides.
 *
 * This is the one place a note is split. The notes have to land on the right
 * slide, which pandoc can't help with because comments never reach it, so
 * pandoc is told where the breaks are and doesn't look for them itself. A
 * comment is taken out first: a `---` in one is no break, and a comment left
 * open hides the rest of the note, as Obsidian shows it.
 *
 * A slide with no words and no notes is dropped: that's a `---` at the very
 * end of a note, or two in a row. A note with nothing on it is still one slide,
 * as pandoc makes it. A slide meant to be blank is the slideshow's to show. At
 * the very top, `---` starts the properties, as it does in Obsidian.
 *
 * Notes leave here on their own and never go through pandoc, so they can't
 * end up on a slide or in a file.
 */
export function slidesOf(note: string): Deck {
	const { body } = splitFrontmatter(note);
	const properties = note.slice(0, note.length - body.length);
	const { visible, comments } = splitComments(body);

	const breaks = breaksIn(visible);
	const slides = [...breaks, null]
		.map((next, index) => ({
			text: visible.slice(breaks[index - 1]?.end ?? 0, next?.start ?? visible.length),
			notes: comments
				// One after a break on its line belongs to the slide that follows.
				.filter(({ at }) => breaks.filter(({ start }) => start < at).length === index)
				.map((comment) => comment.text.trim())
				.filter((words) => words !== '')
				.join('\n\n'),
		}))
		.filter((slide) => slide.text.trim() !== '' || slide.notes !== '');
	if (slides.length === 0) slides.push({ text: '', notes: '' });

	return {
		text: properties + slides.map((slide) => slide.text).join(`\n\n${SLIDE_BREAK}\n\n`),
		notes: slides.map((slide) => slide.notes),
	};
}
