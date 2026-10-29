import { describe, expect, it } from 'vitest';
import { prepare, type Linked, type Vault } from '../src/core/prepare';

// A vault, as the note being exported sees it.
const notes: Record<string, Linked> = {
	'Marsh (2024) The Quiet Archive': { path: 'Literature/Marsh (2024) The Quiet Archive.md', file: '/v/Literature/Marsh (2024) The Quiet Archive.md', frontmatter: { citekey: 'marsh2024' } },
	okafor2019: { path: 'Literature/okafor2019.md', file: '/v/Literature/okafor2019.md', frontmatter: {} },
	'My idea': { path: 'Notes/My idea.md', file: '/v/Notes/My idea.md', frontmatter: { tags: ['idea'] } },
	'figure.png': { path: 'Attachments/figure.png', file: 'C:\\v\\Attachments\\figure.png', frontmatter: undefined },
	// Obsidian resolves an empty linkpath to the note itself: here, a paper note.
	'': { path: 'Literature/lindqvist2025.md', file: '/v/Literature/lindqvist2025.md', frontmatter: { citekey: 'lindqvist2025' } },
	// A note in the papers folder, named for a key with a slash, in a subfolder.
	'jones/2020': { path: 'Literature/jones/2020.md', file: '/v/Literature/jones/2020.md', frontmatter: {} },
	// Named by Paper Trail for a key a note's name can't have.
	'jones-2019': { path: 'Literature/jones-2019.md', file: '/v/Literature/jones-2019.md', frontmatter: { citekey: 'jones/2019' } },
};
const vault: Vault = {
	resolve: (linkpath) => notes[linkpath] ?? null,
	parseYaml: (yaml) => (yaml.includes('title: Old') ? { title: 'Old', tags: ['private'], author: 'Ann' } : {}),
};
const options = { name: 'note', papersFolder: 'Literature', keyProperty: 'citekey', keys: new Set(['marsh2024']), noteStyle: false };

describe('prepare', () => {
	it('makes the note pandoc input, every step in its order', () => {
		const note = [
			'---',
			'title: Old',
			'---',
			'# On archives',
			'',
			'## Argument',
			'',
			'As [[Marsh (2024) The Quiet Archive|Marsh, p. 4]] shows. %%not for you%% ^abc123',
			'',
			'![[figure.png|300]]',
			'',
		].join('\n');
		expect(prepare(note, vault, options)).toEqual({
			markdown: ['', '# Argument', '', 'As [[marsh2024|Marsh, p. 4]] shows.', '', '![](<C:/v/Attachments/figure.png>){width=300px}', ''].join('\n'),
			metadata: { title: 'On archives', 'reference-section-title': 'References', author: 'Ann' },
			missing: { papers: [], unresolved: [], unpublished: [] },
			unshown: [],
		});
	});

	it('lists a paper the bibliography lacks, by its key property or its name in the papers folder', () => {
		const { missing } = prepare('[[okafor2019#p. 3]] [[Marsh (2024) The Quiet Archive]]', vault, { ...options, keys: new Set() });
		expect(missing).toEqual({ papers: ['marsh2024', 'okafor2019'], unresolved: [], unpublished: [] });
	});

	it('lists a link to no note whose name the bibliography lacks, as the filter would read its key', () => {
		const { missing } = prepare('[[new2025|see new2025, p. 4]] [[@later2026]] [[marsh2024]] [[Idea to write]]', vault, options);
		expect(missing).toEqual({ papers: [], unresolved: ['Idea to write', 'later2026', 'new2025'], unpublished: [] });
	});

	it('lists no note of your own, nothing in a comment, and nothing without a bibliography', () => {
		expect(prepare('[[My idea]] %%[[okafor2019]] [[new2025]]%%', vault, options).missing).toEqual({ papers: [], unresolved: [], unpublished: [] });
		expect(prepare('[[okafor2019]] [[new2025]]', vault, { ...options, keys: null }).missing).toEqual({ papers: [], unresolved: [], unpublished: [] });
	});

	it('leaves an embedded note out, and keeps an embedded image', () => {
		expect(prepare('Intro.\n\n![[My idea]]\n\n![[figure.png]]\n', vault, options).markdown).toBe('Intro.\n\n\n![](<C:/v/Attachments/figure.png>)\n');
	});

	it('points a renamed note at a key with a slash, and finds that key and one linked by it in the bibliography', () => {
		const keys = new Set(['jones/2019']);
		const { markdown, missing } = prepare('Quoted [[jones-2019|jones-2019, p. 12]] and [[jones/2019]].\n', vault, { ...options, keys });
		expect(markdown).toContain('[[jones/2019|jones/2019, p. 12]]');
		expect(missing.papers).toEqual([]);
		expect(missing.unresolved).toEqual([]);
	});

	it('finds the key of a note in the papers folder named for a key with a slash', () => {
		const { missing } = prepare('See [[jones/2020]].\n', vault, { ...options, keys: new Set(['jones/2020']) });
		expect(missing.papers).toEqual([]);
	});

	it('points a Markdown link to a paper note at its key, and checks it, as a wikilink', () => {
		const keys = new Set(['jones/2019']);
		const { markdown, missing } = prepare('As [Jones](jones-2019.md) and [Lee](lee2020.md) show.\n', vault, { ...options, keys });
		expect(markdown).toContain('[[jones/2019|Jones]]');
		expect(missing.unresolved).toEqual(['lee2020']);
	});

	it('points only a link to a note with a key property at that key', () => {
		expect(prepare('[[Marsh (2024) The Quiet Archive#p. 4]] [[okafor2019|see okafor2019]]', vault, options).markdown).toBe('[[marsh2024#p. 4]] [[okafor2019|see okafor2019]]');
	});

	it('never takes a link within the note for a paper, though it resolves to one', () => {
		const prepared = prepare('[[#Summary]] [[#Summary|the summary]]', vault, { ...options, keys: new Set() });
		expect(prepared.markdown).toBe('[[#Summary]] [[#Summary|the summary]]');
		expect(prepared.missing).toEqual({ papers: [], unresolved: [], unpublished: [] });
	});
});

describe('a post', () => {
	const posts: Record<string, string> = { 'My idea': 'https://bw20.nl/log/my-idea/' };
	const post = { ...options, post: 'markdown' as const, postOf: (linkpath: string) => posts[linkpath] ?? null };
	const withDraft: Record<string, Linked> = { ...notes, Draft: { path: 'Notes/Draft.md', file: '/v/Notes/Draft.md', frontmatter: {} }, 'paper.pdf': { path: 'Attachments/paper.pdf', file: '/v/Attachments/paper.pdf', frontmatter: undefined } };
	const draftVault: Vault = { ...vault, resolve: (linkpath) => withDraft[linkpath] ?? null };

	it('links a note that is a post to the post, and leaves a paper a citation', () => {
		const { markdown } = prepare('See [[My idea|this idea]], [[My idea#Why]] and [[Marsh (2024) The Quiet Archive]].', draftVault, post);
		expect(markdown).toBe('See [this idea](<https://bw20.nl/log/my-idea/>), [My idea](<https://bw20.nl/log/my-idea/>) and [[marsh2024]].');
	});

	it('lists the notes it links to that have no post, by the words the post shows, each once, and not papers, files or posts', () => {
		const { missing } = prepare('[[Draft]], [[Draft|again]], [[Draft#Why]], [[Draft| again ]], [[My idea]], [[okafor2019]], [[paper.pdf]], [[Nowhere]].', draftVault, post);
		expect(missing.unpublished).toEqual([
			{ words: 'Draft', note: 'Draft' },
			{ words: 'again', note: 'Draft' },
		]);
	});

	it('gives pandoc a post\'s metadata', () => {
		expect(prepare('# Title\n\nText.', draftVault, post).metadata).toEqual({ title: 'Title' });
	});

	it('lists what it won\'t show as Obsidian does, from the note without its comments', () => {
		const note = '---\ntitle: Old\n---\n> [!tip] Title\n> ==Marked== %%==hidden== [[#Hidden]]%% and [[#Method]].\n';
		expect(prepare(note, draftVault, post).unshown).toEqual([
			{ kind: 'callout', written: ['[!tip] Title'] },
			{ kind: 'highlight', written: ['==Marked=='] },
			{ kind: 'link within', written: ['[[#Method]]'] },
		]);
		expect(prepare(note, draftVault, { ...post, post: 'html' }).unshown.map((each) => each.kind)).toEqual(['callout', 'link within']);
	});

	it('leaves links alone, and lists nothing, for a document', () => {
		const { markdown, missing } = prepare('[[My idea]] and [[Draft]].', draftVault, options);
		expect(markdown).toBe('[[My idea]] and [[Draft]].');
		expect(missing.unpublished).toEqual([]);
		expect(prepare('==Marked==', draftVault, options).unshown).toEqual([]);
	});
});
