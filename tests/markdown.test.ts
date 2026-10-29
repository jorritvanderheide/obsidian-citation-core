import { describe, expect, it } from 'vitest';
import { citeByKey, dropPluginBlocks, linkPosts, footnotes, imageEmbeds, imageLinks, liftHeadings, segments, splitFrontmatter, stripBlockIds, stripComments, stripTags, unshown, wikilinked, wikilinks } from '../src/core/markdown';

describe('segments', () => {
	it('concatenates back to the note', () => {
		const text = 'a `b` c\n```js\n%% x\n```\nd ``e ` f`` g\n';
		expect(segments(text).map((segment) => segment.text).join('')).toBe(text);
	});

	it('marks fenced blocks and backtick spans as code', () => {
		expect(segments('a `b` c\n~~~\nd\n~~~\ne')).toEqual([
			{ code: false, text: 'a ' },
			{ code: true, text: '`b`' },
			{ code: false, text: ' c\n' },
			{ code: true, text: '~~~\nd\n~~~\n' },
			{ code: false, text: 'e' },
		]);
	});

	it('closes a fence only on the same character, at least as long', () => {
		const text = '````\n```\n~~~~\n````\nafter';
		expect(segments(text).at(-1)).toEqual({ code: false, text: 'after' });
		expect(segments(text)[0]?.text).toBe('````\n```\n~~~~\n````\n');
	});

	it('reads a line that opens with inline code as a line, not a fence', () => {
		expect(segments('```npm i``` installs it.\n\nMy point.')).toEqual([
			{ code: true, text: '```npm i```' },
			{ code: false, text: ' installs it.\n\nMy point.' },
		]);
		expect(segments('```js\nx\n```\n')).toEqual([{ code: true, text: '```js\nx\n```\n' }]);
	});

	it('reads an escaped backtick as text, and the rest of its run as a run', () => {
		expect(segments('a \\`` b` c')).toEqual([
			{ code: false, text: 'a \\`' },
			{ code: true, text: '` b`' },
			{ code: false, text: ' c' },
		]);
		expect(segments('\\\\`code`')).toEqual([
			{ code: false, text: '\\\\' },
			{ code: true, text: '`code`' },
		]);
	});

	it('keeps each fenced block a segment of its own, even right after another', () => {
		expect(segments('```a\nx\n```\n~~~b\ny\n~~~\n')).toEqual([
			{ code: true, text: '```a\nx\n```\n' },
			{ code: true, text: '~~~b\ny\n~~~\n' },
		]);
	});

	it('reads a fence in a list item or a quote', () => {
		expect(segments('1. Run:\n\n    ```sh\n    npm i %%\n    ```\n\n    Then.\n').filter((segment) => segment.code)).toEqual([
			{ code: true, text: '    ```sh\n    npm i %%\n    ```\n' },
		]);
		expect(segments('> [!example]\n> ```js\n> x %%\n> ```\n> After.\n').filter((segment) => segment.code)).toEqual([
			{ code: true, text: '> ```js\n> x %%\n> ```\n' },
		]);
	});

	it('keeps a fence in its list item past a line of code that looks like a quote', () => {
		const text = '* `opts` - an option,\nand its lazy line.\n\n  ```\n  > require()\n  ```\n\n  After %%private%%.\n';
		expect(stripComments(text)).toBe('* `opts` - an option,\nand its lazy line.\n\n  ```\n  > require()\n  ```\n\n  After .\n');
	});

	it('does not take a fence indented a little for one in a list item', () => {
		const text = ' - an item\n\n ```jsonc\n// %%kept%%\n{}\n```\n\nText %%private%%.\n';
		expect(stripComments(text)).toBe(' - an item\n\n ```jsonc\n// %%kept%%\n{}\n```\n\nText .\n');
	});

	it('ends a fence with the quote or the list item it is in, closed or not', () => {
		expect(stripComments('> ```js\n> x\n\nOutside %%private%%.\n')).toBe('> ```js\n> x\n\nOutside .\n');
		expect(stripComments('- a\n\n  ```js\n  x\n\nOutside %%private%%.\n')).toBe('- a\n\n  ```js\n  x\n\nOutside .\n');
	});

	it('reads a span across a line break, within a paragraph', () => {
		expect(segments('A `multi\nline` then %% and `x`\n')).toEqual([
			{ code: false, text: 'A ' },
			{ code: true, text: '`multi\nline`' },
			{ code: false, text: ' then %% and ' },
			{ code: true, text: '`x`' },
			{ code: false, text: '\n' },
		]);
	});

	it('reads no span across a blank line or into a block of its own', () => {
		for (const text of ['a `x\n\nb` c', '- a `x\n- b` c', 'a `x\n# b` c', 'a `x\n> b` c', '| a `x |\n| b` c |']) {
			expect(segments(text).some((segment) => segment.code)).toBe(false);
		}
	});

	it('reads an unmatched backtick as text', () => {
		expect(segments('it`s')).toEqual([{ code: false, text: 'it`s' }]);
	});

	it('leaves backtick spans alone when asked for fences only', () => {
		expect(segments('a `b` c', false)).toEqual([{ code: false, text: 'a `b` c' }]);
	});
});

describe('splitFrontmatter', () => {
	it('splits the block off the top', () => {
		expect(splitFrontmatter('---\ntitle: A\n---\n# A\n')).toEqual({ yaml: 'title: A\n', body: '# A\n' });
	});

	it('reads an empty block', () => {
		expect(splitFrontmatter('---\n---\nbody')).toEqual({ yaml: '', body: 'body' });
	});

	it('finds none unless it opens the note', () => {
		expect(splitFrontmatter('text\n---\na: b\n---\n')).toEqual({ yaml: null, body: 'text\n---\na: b\n---\n' });
	});
});

describe('stripComments', () => {
	it('removes an inline comment', () => {
		expect(stripComments('a %%private%% b')).toBe('a  b');
	});

	it('removes a comment across lines, down to one line break', () => {
		expect(stripComments('before\n\n%%\nfor me\n[[key]]\n%%\n\nafter')).toBe('before\n\n\n\nafter');
	});

	it('runs an unclosed comment to the end of the note, as Obsidian does', () => {
		expect(stripComments('kept %% not kept\nnor this')).toBe('kept ');
	});

	it('leaves %% in code alone', () => {
		expect(stripComments('`a %% b` and\n```\n%%\n```\n')).toBe('`a %% b` and\n```\n%%\n```\n');
	});

	it('removes an HTML comment, inline or across lines', () => {
		expect(stripComments('a <!-- private --> b\n<!--\nfor me\n-->\nc')).toBe('a  b\n\nc');
	});

	it('closes a comment only with its own kind of marker', () => {
		expect(stripComments('a <!-- 50%% sure --> b %% x --> y %% c')).toBe('a  b  c');
	});

	it('runs an unclosed HTML comment to the end of the note', () => {
		expect(stripComments('kept <!-- not kept\nnor this')).toBe('kept ');
	});

	it('leaves <!-- in code alone', () => {
		expect(stripComments('`<!-- a -->` and\n```html\n<!-- b -->\n```\n')).toBe('`<!-- a -->` and\n```html\n<!-- b -->\n```\n');
	});

	it('hides a comment after a line that opens with inline code', () => {
		expect(stripComments('```npm i``` installs it.\n\nMy point. %%private%%\n')).toBe('```npm i``` installs it.\n\nMy point. \n');
	});

	it('hides a comment after an escaped backtick', () => {
		expect(stripComments('Escape \\`, like so. %%private `code` here%% after\n\nNext.')).toBe('Escape \\`, like so.  after\n\nNext.');
	});

	it('hides a comment after a code span across a line break', () => {
		expect(stripComments('A `multi\nline` then %%secret%% and `x`.')).toBe('A `multi\nline` then  and `x`.');
	});

	it('hides code inside a comment', () => {
		expect(stripComments('a %% `code` %% b')).toBe('a  b');
	});
});

describe('dropPluginBlocks', () => {
	it('drops a block in each plugin language, by either fence', () => {
		const blocks = ['dataview', 'dataviewjs', 'tasks', 'query', 'base'].map((language) => `\`\`\`${language}\nLIST FROM #x\n\`\`\`\n`).join('\nText.\n');
		expect(dropPluginBlocks(blocks)).toBe('\nText.\n'.repeat(4));
		expect(dropPluginBlocks('a\n~~~~ dataview\nTABLE x\n~~~~\nb')).toBe('a\nb');
		expect(dropPluginBlocks('> [!info]\n> ```dataview\n> LIST\n> ```\n')).toBe('> [!info]\n');
	});

	it('keeps the block after one it drops, and every other language', () => {
		expect(dropPluginBlocks('```tasks\nnot done\n```\n```js\nx()\n```\n')).toBe('```js\nx()\n```\n');
		const kept = '```dataviews\nx\n```\n```python\nquery = 1\n```\nA `dataview` query in prose.\n';
		expect(dropPluginBlocks(kept)).toBe(kept);
	});
});

describe('stripTags', () => {
	it('drops a line of tags, line and all', () => {
		expect(stripTags('Text.\n#todo #draft\r\n  #réflexion/deux  \nMore.\n#end')).toBe('Text.\nMore.\n');
	});

	it('keeps a tag in a sentence as its word', () => {
		expect(stripTags('About #project/alpha and #ideas.\n#first word')).toBe('About project/alpha and ideas.\nfirst word');
	});

	it('leaves what is no tag, and code, alone', () => {
		const text = '#1 in the list\n#1 #2\n[[note#Heading]] (#id) https://x.org/#top C# \n# Heading\n`#code` and\n```\n#tag\n```\n';
		expect(stripTags(text)).toBe(text);
	});
});

describe('stripBlockIds', () => {
	it('removes an ID at the end of a line', () => {
		expect(stripBlockIds('Paragraph. ^abc123\n- item ^li-1\r\nlast ^x')).toBe('Paragraph.\n- item\r\nlast');
	});

	it('empties a line that holds only an ID', () => {
		expect(stripBlockIds('| a |\n|---|\n\n^tbl\n\nafter')).toBe('| a |\n|---|\n\n\n\nafter');
	});

	it('leaves footnotes, IDs in links, mid-line carets and code alone', () => {
		const text = 'a[^1] and [[note#^abc]]\n2 ^ 3 is x^2^\n`code ^x`\n```\nline ^id\n```\n';
		expect(stripBlockIds(text)).toBe(text);
	});
});

describe('footnotes', () => {
	it('puts a blank line before a definition right after a line of text', () => {
		expect(footnotes('Text.[^1]\n[^1]: Below.\n[^2]: Next.\n')).toBe('Text.[^1]\n\n[^1]: Below.\n\n[^2]: Next.\n');
		expect(footnotes('Text.[^1]\r\n[^1]: Below.\r\n')).toBe('Text.[^1]\r\n\n[^1]: Below.\r\n');
		expect(footnotes('Text.[^1]\n\n[^1]: Below.\n')).toBe('Text.[^1]\n\n[^1]: Below.\n');
	});

	it('matches a reference to its definition without regard to case or spacing', () => {
		expect(footnotes('A[^my note] B[^X] C[^My  Note].\n\n[^my note]: Spaced.\n[^x]: Lower.\n')).toBe('A[^my-note] B[^x] C[^my-note].\n\n[^my-note]: Spaced.\n\n[^x]: Lower.\n');
	});

	it('keeps a label from taking the name of another', () => {
		expect(footnotes('A[^a b] B[^a-b].\n\n[^a b]: One.\n\n[^a-b]: Two.\n')).toBe('A[^a-b] B[^a-b-2].\n\n[^a-b]: One.\n\n[^a-b-2]: Two.\n');
	});

	it('keeps the first definition of a label, and gives the second a name no reference has', () => {
		expect(footnotes('C[^d].\n\n[^d]: First.\n[^D]: Second.\n')).toBe('C[^d].\n\n[^d]: First.\n\n[^d-duplicate]: Second.\n');
	});

	it('leaves a reference to no definition, a colon after a reference, and code alone', () => {
		expect(footnotes('A[^gone] and[^1]: said.\n\n[^1]: One.\n')).toBe('A[^gone] and[^1]: said.\n\n[^1]: One.\n');
		const code = 'Text `[^a b]`\n```\n[^a b]: x\n```\n\n[^a b]: Def.\n';
		expect(footnotes(code)).toBe('Text `[^a b]`\n```\n[^a b]: x\n```\n\n[^a-b]: Def.\n');
		expect(footnotes('No notes here.\n')).toBe('No notes here.\n');
	});
});

describe('liftHeadings', () => {
	it('takes the leading H1 as the title and promotes the rest', () => {
		expect(liftHeadings('# Title\n\n## Section\n\n### Sub\ntext')).toEqual({ title: 'Title', body: '\n# Section\n\n## Sub\ntext' });
	});

	it('finds the H1 after blank lines left by the frontmatter or a comment', () => {
		expect(liftHeadings('\n\n# Title\nbody').title).toBe('Title');
	});

	it('drops closing hashes from the title', () => {
		expect(liftHeadings('# Title ##\n').title).toBe('Title');
	});

	it('does not promote when an H1 is left in the body', () => {
		expect(liftHeadings('# Meeting\n\n## Notes\n\n# Tasks\n')).toEqual({ title: 'Meeting', body: '\n## Notes\n\n# Tasks\n' });
	});

	it('promotes without a title when the note has no H1 at all', () => {
		expect(liftHeadings('intro\n\n## A\n')).toEqual({ title: null, body: 'intro\n\n# A\n' });
	});

	it('only takes an H1 that opens the note', () => {
		expect(liftHeadings('intro\n# Late\n## A').title).toBeNull();
	});

	it('leaves tags and code alone', () => {
		expect(liftHeadings('#tag\n```\n## not a heading\n```\n## A').body).toBe('#tag\n```\n## not a heading\n```\n# A');
	});
});

describe('imageLinks', () => {
	const files: Record<string, string> = { 'bed.png': '/vault/Attachments/bed.png', 'Garden/my bed.jpg': '/vault/Garden/my bed.jpg', '../Attachments/bed.png': '/vault/Attachments/bed.png' };
	const resolve = (linkpath: string) => files[linkpath] ?? null;

	it('points a markdown image at the file Obsidian would show', () => {
		expect(imageLinks('![A raised bed](bed.png)', resolve)).toBe('![A raised bed](</vault/Attachments/bed.png>)');
		expect(imageLinks('![](../Attachments/bed.png)', resolve)).toBe('![](</vault/Attachments/bed.png>)');
	});

	it('decodes %20, and reads a path in <…>', () => {
		expect(imageLinks('![Mine](Garden/my%20bed.jpg) ![Mine](<Garden/my bed.jpg>)', resolve)).toBe('![Mine](</vault/Garden/my bed.jpg>) ![Mine](</vault/Garden/my bed.jpg>)');
	});

	it('keeps a title, and reads |300 as a width, in a table cell too', () => {
		expect(imageLinks('![A bed](bed.png "In March")', resolve)).toBe('![A bed](</vault/Attachments/bed.png> "In March")');
		expect(imageLinks('![A bed|300](bed.png) | ![A bed\\|640x480](bed.png) |', resolve)).toBe('![A bed](</vault/Attachments/bed.png>){width=300px} | ![A bed](</vault/Attachments/bed.png>){width=640px} |');
	});

	it('leaves web addresses, files that are no image, images it can\'t find, and code as written', () => {
		const text = '![Map](https://example.org/map.png) ![](data:image/png;base64,AAAA) ![Paper](paper.pdf) ![Gone](gone.png) `![A bed](bed.png)` [A link](bed.png)';
		expect(imageLinks(text, resolve)).toBe(text);
	});
});

describe('imageEmbeds', () => {
	const resolve = (linkpath: string) => (linkpath === 'missing.png' ? null : `/vault/Attachments/${linkpath}`);

	it('turns an image embed into a markdown image of the resolved file', () => {
		expect(imageEmbeds('![[diagram.png]]', resolve)).toBe('![](</vault/Attachments/diagram.png>)');
	});

	it('reads |300 as a width and other text as a description', () => {
		expect(imageEmbeds('![[a.png|300]] ![[b.jpg|640x480]] ![[c.svg|A chart]]', resolve)).toBe(
			'![](</vault/Attachments/a.png>){width=300px} ![](</vault/Attachments/b.jpg>){width=640px} ![A chart](</vault/Attachments/c.svg>)',
		);
	});

	it('reads a width after a description, |A chart|300', () => {
		expect(imageEmbeds('![[a.png|A chart|300]] ![[b.jpg|A bed|640x480]] ![[c.svg|300|A chart]]', resolve)).toBe(
			'![A chart](</vault/Attachments/a.png>){width=300px} ![A bed](</vault/Attachments/b.jpg>){width=640px} ![300|A chart](</vault/Attachments/c.svg>)',
		);
	});

	it('reads an embed whose pipe a table cell escaped', () => {
		expect(imageEmbeds('| ![[a.png\\|300]] |', resolve)).toBe('| ![](</vault/Attachments/a.png>){width=300px} |');
		expect(imageEmbeds('| ![[a.png\\|A chart\\|300]] |', resolve)).toBe('| ![A chart](</vault/Attachments/a.png>){width=300px} |');
	});

	it('leaves an unresolved image, for pandoc to name, and code as written', () => {
		const text = '![[missing.png]] `![[a.png]]` `![[Chapter 1]]`';
		expect(imageEmbeds(text, resolve)).toBe(text);
	});

	it('drops every other embed: a note, a section, a block, a PDF and a canvas', () => {
		expect(imageEmbeds('See ![[Chapter 1]], ![[Chapter 1#Method]], ![[Chapter 1#^abc]], ![[paper.pdf#page=3]] and ![[Map.canvas]].', resolve)).toBe('See , , ,  and .');
	});

	it('takes the line of an embed on a line of its own with it', () => {
		expect(imageEmbeds('Before.\n\n![[Chapter 1]]\n\n  ![[paper.pdf]]  \r\nAfter.\n![[Chapter 2]]', resolve)).toBe('Before.\n\n\nAfter.\n');
		expect(imageEmbeds('Before.\n![[a.png]]\n', resolve)).toBe('Before.\n![](</vault/Attachments/a.png>)\n');
	});
});

describe('wikilinks', () => {
	it('lists each link with the words it shows, without embeds or code', () => {
		expect(wikilinks('[[a]] [[b#p. 3|see]] ![[c.png]] `[[d]]` [[Literature/e.md]] [[f#Why]] [[#Top]] [[g| ]]')).toEqual([
			{ target: 'a', words: 'a' },
			{ target: 'b#p. 3', words: 'see' },
			{ target: 'Literature/e.md', words: 'Literature/e.md' },
			{ target: 'f#Why', words: 'f' },
			{ target: '#Top', words: 'Top' },
			{ target: 'g', words: 'g' },
		]);
	});
});

describe('citeByKey', () => {
	const keys: Record<string, string> = { 'Marsh (2024) The Quiet Archive': 'marsh2024', oldkey: 'newkey', '@oldkey': 'newkey', 'Literature/oldkey.md': 'newkey' };
	const keyFor = (linkpath: string) => keys[linkpath] ?? null;

	it('points a link to a note named for its title at the note’s key', () => {
		expect(citeByKey('as [[Marsh (2024) The Quiet Archive]] shows', keyFor)).toBe('as [[marsh2024]] shows');
	});

	it('follows a key Better BibTeX changed, keeping the page and the alias', () => {
		expect(citeByKey('[[oldkey#p. 12|label]] [[oldkey|see oldkey, p. 4]]', keyFor)).toBe('[[newkey#p. 12|label]] [[newkey|see newkey, p. 4]]');
	});

	it('keeps the pipe a table cell escaped', () => {
		expect(citeByKey('| [[oldkey\\|see oldkey, p. 4]] | [[oldkey#p. 12\\|x]] |', keyFor)).toBe('| [[newkey\\|see newkey, p. 4]] | [[newkey#p. 12\\|x]] |');
	});

	it('keeps the author left out when the key changes', () => {
		expect(citeByKey('[[oldkey|-oldkey, p. 4]]', keyFor)).toBe('[[newkey|-newkey, p. 4]]');
	});

	it('reads the target however Obsidian wrote it', () => {
		expect(citeByKey('[[@oldkey|@oldkey]] [[Literature/oldkey.md]]', keyFor)).toBe('[[newkey|@newkey]] [[newkey]]');
	});

	it('leaves a link within the note alone, which Obsidian resolves to the note itself', () => {
		const own = (linkpath: string) => (linkpath === '' ? 'ownkey' : null);
		expect(citeByKey('[[#Summary]] [[#Summary|the summary]]', own)).toBe('[[#Summary]] [[#Summary|the summary]]');
	});

	it('leaves links without a key, embeds and code as written', () => {
		const text = '[[My idea|this idea]] ![[oldkey]] `[[oldkey]]`';
		expect(citeByKey(text, keyFor)).toBe(text);
	});
});

describe('linkPosts', () => {
	const urlFor = (linkpath: string) => (linkpath === 'Notes/My idea' || linkpath === 'My idea' ? 'https://bw20.nl/log/my-idea/' : null);
	it('links a note with a post to the post, by its alias or its name', () => {
		expect(linkPosts('[[My idea]], [[Notes/My idea|that [idea]], [[My idea#Why]]', urlFor)).toBe(
			'[My idea](<https://bw20.nl/log/my-idea/>), [that \\[idea](<https://bw20.nl/log/my-idea/>), [My idea](<https://bw20.nl/log/my-idea/>)',
		);
	});
	it('leaves every other link, embed and code as written', () => {
		expect(linkPosts('[[Other]] ![[My idea]] `[[My idea]]` [[#Heading]]', urlFor)).toBe('[[Other]] ![[My idea]] `[[My idea]]` [[#Heading]]');
	});
});

describe('wikilinked', () => {
	// Obsidian writes a link to a note either way, as its "Use [[Wikilinks]]"
	// setting says, and reads both alike.
	it('makes a Markdown link to a file in the vault the wikilink Obsidian reads it as', () => {
		expect(wikilinked('See [Smith](smith-2017.md) and [the claim](Literature/a.md#Claim).')).toBe('See [[smith-2017\\|Smith]] and [[Literature/a#Claim\\|the claim]].');
		expect(wikilinked('[Lee](<Literature/Lee 2020.md>) and [Ann](Literature/Ann%20Marsh.md)')).toBe('[[Literature/Lee 2020\\|Lee]] and [[Literature/Ann Marsh\\|Ann]]');
	});

	it('reads a path without an extension as a note, as Obsidian does', () => {
		expect(wikilinked('[u](t) and [Lee](Literature/Lee%202020#Claim) and [v1](notes/v1.2%20draft)')).toBe('[[t\\|u]] and [[Literature/Lee 2020#Claim\\|Lee]] and [[notes/v1.2 draft\\|v1]]');
	});

	it('drops a title, and reads brackets in the words one level deep', () => {
		expect(wikilinked('[t](a.md "title") [s](b \'other\') [r](<c d.md> (third))')).toBe('[[a\\|t]] [[b\\|s]] [[c d\\|r]]');
		expect(wikilinked('[d [e] f](g.md) and [see [1]](h)')).toBe('[[g\\|d [e] f]] and [[h\\|see [1]]]');
	});

	it('reads a link after an escaped backslash, which an odd run of them escapes', () => {
		expect(wikilinked('\\\\[x](y.md) \\[x](y.md) \\\\\\[x](y.md)')).toBe('\\\\[[y\\|x]] \\[x](y.md) \\\\\\[x](y.md)');
	});

	it('leaves a web address, an anchor, an image and code alone', () => {
		const kept = '[site](https://example.org/a.md) [z](zotero://select/x) [up](#Intro) ![A chart](figure.png) `[x](y.md)`';
		expect(wikilinked(kept)).toBe(kept);
		expect(wikilinked('```\n[x](y.md)\n```\n')).toBe('```\n[x](y.md)\n```\n');
	});
});

describe('wikilinked, on what is no link to a note', () => {
	it('writes the pipe a table row needs, also in a row without a leading pipe, and reads parentheses in a path', () => {
		expect(wikilinked('| [Smith](smith-2017.md) | x |')).toBe('| [[smith-2017\\|Smith]] | x |');
		expect(wikilinked('a | [Smith](smith-2017.md)')).toBe('a | [[smith-2017\\|Smith]]');
		expect(wikilinked('[S](Literature/Smith%20(2017)%20Archive.md)')).toBe('[[Literature/Smith (2017) Archive\\|S]]');
	});

	it('leaves a link to anything but a note alone, so the check never lists it', () => {
		const kept = '[site](example.com) [d](folder/) [r](files/report.pdf) [p](scan.PNG#page=2)';
		expect(wikilinked(kept)).toBe(kept);
	});

	it('leaves an image inside a link, a footnote, an escaped bracket, and math alone', () => {
		const kept = '[![img](a.png)](b.md) Claim[^1](2019) \\[x](y.md) $f[x](y.md)$ $$E[X](t.md)$$';
		expect(wikilinked(kept)).toBe(kept);
	});

	it('leaves a link alone whose path decodes to what a wikilink can not hold', () => {
		const kept = '[a](x%7Cy.md) [b](x%5D.md) [c](a%23b.md) [d [e [f]]](g.md)';
		expect(wikilinked(kept)).toBe(kept);
	});
});

describe('wikilinked, around math', () => {
	// Math is found as pandoc finds it, so a link next to dollar signs that are
	// no math is still read, and one inside math is not.
	it('reads a link between escaped dollars, prices and math that a blank line ends', () => {
		expect(wikilinked('\\$5 for [x](y.md), \\$6')).toBe('\\$5 for [[y\\|x]], \\$6');
		expect(wikilinked('$5 for [x](y.md) or $6')).toBe('$5 for [[y\\|x]] or $6');
		expect(wikilinked('$$a\n\n[x](y.md) $$')).toBe('$$a\n\n[[y\\|x]] $$');
		expect(wikilinked('$a\nb\n[x](y.md) c$')).toBe('$a\nb\n[[y\\|x]] c$');
	});

	it('leaves a link in math alone, across one line break, and past an escaped dollar in it', () => {
		const kept = '$a +\n[x](y.md)$ and $a \\$ [x](y.md)$ and $$\n[x](y.md)\n$$ and $x$';
		expect(wikilinked(kept)).toBe(kept);
	});
});

describe('wikilinks, with a bracket in the alias', () => {
	it('reads a ] in an alias, as pandoc does, unless it closes the link', () => {
		expect(wikilinks('[[k|a [b] c]] and [[k2|x]y]]')).toEqual([
			{ target: 'k', words: 'a [b] c' },
			{ target: 'k2', words: 'x]y' },
		]);
		expect(citeByKey('[[Old name|see [the] book]]', (linkpath) => (linkpath === 'Old name' ? 'marsh2024' : null))).toBe('[[marsh2024|see [the] book]]');
	});
});

describe('unshown', () => {
	const note = [
		'> [!tip]- Fold me',
		'> A ==highlight== and $E=mc^2$, and ==another==.',
		'',
		'> [!warning]',
		'> > [!note] Inside',
		'',
		'![[bed.png|A bed|300]] ![[plan.png|200x100]] ![A chart|300](chart.png) ![[photo.png|A photo]]',
		'',
		'![[Other note]] ![[Other note#Why]] and [[#Method]], [[#^abc]], [[Other note#Why]].',
		'',
		'$$',
		'\\int_0^1 x\\,dx',
		'$$',
		'',
		'```mermaid',
		'graph TD; A-->B',
		'```',
		'',
		'> ```dataview',
		'> TABLE file.name',
		'> ```',
		'',
	].join('\n');

	it('lists each kind a post in Markdown shows otherwise, each as written, once, in order', () => {
		expect(unshown(note, 'markdown')).toEqual([
			{ kind: 'callout', written: ['[!tip]- Fold me', '[!warning]', '[!note] Inside'] },
			{ kind: 'highlight', written: ['==highlight==', '==another=='] },
			{ kind: 'width', written: ['![[bed.png|A bed|300]]', '![[plan.png|200x100]]', '![A chart|300](chart.png)'] },
			{ kind: 'math', written: ['$E=mc^2$', '$$\n\\int_0^1 x\\,dx\n$$'] },
			{ kind: 'mermaid', written: ['graph TD; A-->B'] },
			{ kind: 'embed', written: ['![[Other note]]', '![[Other note#Why]]'] },
			{ kind: 'plugin block', written: ['TABLE file.name'] },
			{ kind: 'link within', written: ['[[#Method]]', '[[#^abc]]'] },
		]);
	});

	it('leaves out highlights and widths for HTML, which keeps them', () => {
		expect(unshown(note, 'html').map((each) => each.kind)).toEqual(['callout', 'math', 'mermaid', 'embed', 'plugin block', 'link within']);
	});

	it('reads nothing in code, and lists nothing for a note with none of them', () => {
		expect(unshown('`==a==` and `[[#b]]`\n\n```\n> [!tip]\n$x$\n```\n\n> A quote, and a == b.\n', 'markdown')).toEqual([]);
	});

	it('names a block with nothing inside by its opening line', () => {
		expect(unshown('```mermaid\n```\n', 'markdown')).toEqual([{ kind: 'mermaid', written: ['```mermaid'] }]);
	});
});
