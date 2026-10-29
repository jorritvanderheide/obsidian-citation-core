// A note, made into what pandoc is given: every step, in its order.
import { inFolder } from './paths';
import { keyOf, linkpathOf, missingKeys, propertyKey } from './citations';
import { documentMetadata, postMetadata, type Post } from './document';
import { citeByKey, dropPluginBlocks, linkPosts, footnotes, imageEmbeds, imageLinks, liftHeadings, splitFrontmatter, stripBlockIds, stripComments, stripTags, literalBackslashes, wikilinked, wikilinks } from './markdown';

/** What a link resolves to, from the note being exported. */
export interface Linked {
	/** Its path in the vault. */
	path: string;
	/** Its path on disk. */
	file: string;
	/** Its frontmatter, when it is a note that has one. */
	frontmatter: unknown;
}

/** What the vault answers, for the note being exported. */
export interface Vault {
	/** The note or file a linkpath resolves to, or null. */
	resolve(linkpath: string): Linked | null;
	/** A frontmatter block, parsed. */
	parseYaml(yaml: string): unknown;
}

export interface Options {
	/** The note's file name, the title of last resort. */
	name: string;
	/** The folder of paper notes. */
	papersFolder: string;
	/** The frontmatter property holding a paper note's citation key. */
	keyProperty: string;
	/** The bibliography's keys, or null when there is none to check against. */
	keys: Set<string> | null;
	/** Whether the citation style puts citations in footnotes, from `noteStyle`. */
	noteStyle: boolean;
	/** A post for a website, as Markdown or HTML, rather than a document: its metadata is a post's (`postMetadata`). */
	post?: Post;
	/**
	 * For a post, the address of a linked note's own post, or null for a note
	 * that isn't one: a link to a note with a post goes to the post
	 * (`linkPosts`), and one without is listed in `missing.unpublished`.
	 */
	postOf?: (linkpath: string) => string | null;
}

export interface Prepared {
	/** The note as pandoc's markdown, for pandoc to read (`Pandoc.run`). */
	markdown: string;
	/** The document's metadata, for a file of its own. */
	metadata: Record<string, unknown>;
	/** Links about to lose their citation, as the keys they name. */
	missing: Missing;
}

export interface Missing {
	/** Links to paper notes whose key the bibliography does not have. */
	papers: string[];
	/**
	 * Links to no note at all whose name is not a key either: a paper cited by
	 * its key before it has a note, or a note not written yet.
	 */
	unresolved: string[];
	/**
	 * For a post, links to notes of your own that have no post, which go out
	 * as their words: the words the post shows, and the note the link is to,
	 * each pair once. Always empty for a document.
	 */
	unpublished: { words: string; note: string }[];
}

/**
 * The note, made into pandoc's input.
 *
 * First what never leaves: comments, then block IDs, plugins' code blocks and
 * tags, which mean nothing outside the vault, with Markdown links to the vault
 * made the wikilinks Obsidian reads them as. The check reads the note then,
 * before any link is pointed at its key. Then footnotes are written the
 * way pandoc reads them, links to paper notes are pointed at their keys, the
 * title is lifted, and images are resolved on what is left.
 *
 * A link is a paper when the note it resolves to has a key property, whatever
 * the note is called, or is in the papers folder, by its name; only the first
 * kind is pointed at its key, since the second is named for it already. A
 * link within the note, `[[#Heading]]`, is never one, though Obsidian resolves
 * it to the note itself.
 *
 * The bibliography decides what is a citation, not whether a paper has a note,
 * so the check lists a link to no note at all as well: Insert citation links a
 * paper that has no note by its key. Only a link to a note of your own is
 * never listed.
 */
export function prepare(text: string, vault: Vault, options: Options): Prepared {
	const resolve = (linkpath: string) => (linkpath === '' ? null : vault.resolve(linkpath));
	const propertyOf = (linkpath: string) => propertyKey(resolve(linkpath)?.frontmatter, options.keyProperty);
	const keyFor = (linkpath: string) => {
		const linked = resolve(linkpath);
		if (linked === null) return null;
		return propertyOf(linkpath) ?? (inFolder(linked.path, options.papersFolder) ? keyOf(linkpath) : null);
	};

	const { yaml, body } = splitFrontmatter(text);
	const prose = stripTags(dropPluginBlocks(stripBlockIds(wikilinked(literalBackslashes(stripComments(body))))));
	const targets = wikilinks(prose).map(({ target, words }) => ({ target, words, linkpath: linkpathOf(target).trim() }));
	const check = (named: (link: { target: string; linkpath: string }) => string | null) =>
		options.keys ? missingKeys(targets, named, options.keys) : [];
	const missing = {
		papers: check(({ linkpath }) => keyFor(linkpath)),
		unresolved: check(({ target, linkpath }) => (linkpath !== '' && vault.resolve(linkpath) === null ? keyOf(target, options.keys ?? undefined) : null)),
		unpublished: options.postOf ? unpublished(targets, resolve, keyFor, options.postOf) : [],
	};

	const cited = citeByKey(footnotes(prose), propertyOf);
	const { title, body: lifted } = liftHeadings(options.postOf ? linkPosts(cited, options.postOf) : cited);
	// Forward slashes, which pandoc reads on every platform.
	const file = (linkpath: string) => vault.resolve(linkpath)?.file.replace(/\\/g, '/') ?? null;
	const markdown = imageEmbeds(imageLinks(lifted, file), file);
	const frontmatter = yaml === null ? null : vault.parseYaml(yaml);
	const metadata = options.post
		? postMetadata(frontmatter, title, options.name, options.noteStyle, options.post)
		: documentMetadata(frontmatter, title, options.name, options.noteStyle);
	return { markdown, metadata, missing };
}

/**
 * The links of a post to notes of your own without a post: not a paper, which
 * is a citation, and not a file, such as a PDF, which is no note. Each one by
 * the words the post shows and the note it links to, once, in the order of the
 * note.
 */
function unpublished(
	targets: { words: string; linkpath: string }[],
	resolve: (linkpath: string) => Linked | null,
	keyFor: (linkpath: string) => string | null,
	postOf: (linkpath: string) => string | null,
): { words: string; note: string }[] {
	const found: { words: string; note: string }[] = [];
	for (const { words, linkpath } of targets) {
		const linked = resolve(linkpath);
		if (linked === null || !linked.path.endsWith('.md') || keyFor(linkpath) !== null || postOf(linkpath) !== null) continue;
		if (!found.some((link) => link.words === words && link.note === linkpath)) found.push({ words, note: linkpath });
	}
	return found;
}
