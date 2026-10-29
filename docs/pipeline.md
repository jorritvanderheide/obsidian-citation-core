# Pipeline

`prepare` in `src/core/prepare.ts` turns a note into what pandoc is given. A
new step goes there, in its place in the order.

## The steps, in order

1. **Split off the frontmatter** (`splitFrontmatter`). It becomes the
   document's metadata, never pandoc's input.
2. **Strip comments** (`stripComments`). `%%…%%` and `<!-- … -->`, across lines
   and past code, each closed only by its own marker. A comment left open runs
   to the end of the note, to be safe.
3. **Strip block IDs** (`stripBlockIds`). `^abc123` at the end of a line, or on
   a line of its own.
4. **Drop plugin blocks** (`dropPluginBlocks`). Fenced `dataview`,
   `dataviewjs`, `tasks`, `query` and `base` blocks, because an export would
   show only their query.
5. **Strip tags** (`stripTags`). A line of tags goes, line and all. A tag in a
   sentence stays as its word: `#project/alpha` is "project/alpha".
6. **Check the citations** (`missingKeys`), on the note as written, before any
   link is rewritten. See [Citations](https://codeberg.org/BW20/obsidian-due-credit/src/branch/main/docs/citations.md#the-check-before-an-export) in Due Credit.
7. **Rewrite footnotes** (`footnotes`) the way pandoc reads them, which isn't
   always how Obsidian does: a definition gets a blank line before it, a
   reference gets the spelling of its definition, and a label defined twice
   keeps its first definition.
8. **Point links to paper notes at their keys** (`citeByKey`).
9. **Lift headings** (`liftHeadings`). A leading H1 becomes the title and every
   other heading moves up a level, unless the note uses H1 for its own sections
   further down.
10. **Resolve images** (`imageLinks`, then `imageEmbeds`). A markdown image
    of a file in the vault, `![A chart](figure.png)`, and an embed,
    `![[figure.png|300]]`, both become a markdown image of the file Obsidian
    would show, the second 300 pixels wide; `![[figure.png|A chart|300]]` is
    both. Images on the web stay as they are.
    Other embeds, such as notes, PDFs and canvases, are dropped.

Then `documentMetadata` builds the metadata: the title (the lifted H1, the
`title` property, or the file name), the reference list's heading, and only the
properties in `DOCUMENT_KEYS`.

## Why the order matters

- **What never leaves goes first.** Comments are stripped before anything reads
  the note, so nothing in a comment can become a citation, a heading or an
  image.
- **The check reads the note before links are rewritten**, so it sees what you
  wrote, not what `citeByKey` made of it.
- **Headings are promoted here, not with `--shift-heading-level-by`,** which
  would also demote the References heading citeproc adds afterwards. Markdown
  output is the exception. There the title is a heading at the top, and
  pandoc's shift is what moves everything else under it, References included.

## Code is only characters

Every rewrite in `core/markdown.ts` goes through `segments`, and leaves fenced
code blocks and backtick spans alone. A comment marker, tag or link inside code
is text, and stays exactly as written.

`segments` is there to keep comments from leaking. Where it disagrees with
CommonMark about what is code, only one kind of mistake matters. That's text it
treats as code when CommonMark doesn't, because a comment in it would be kept.
The conformance check in the [README](../README.md#the-conformance-check) looks
for exactly that.

## What pandoc is told

`pandocArgs` in `core/document.ts` reads the note as pandoc's markdown with
Obsidian's habits switched on (wikilinks with a title after the pipe,
highlights, lists without a blank line before them, hard line breaks unless
strict line breaks are on) and pandoc's own table syntaxes and blank-line rules
switched off, because Obsidian doesn't have them.

Raw TeX is off as well. Obsidian shows a backslash before a word as it is,
`\slash` and `C:\path`, and pandoc read those as LaTeX commands and left them
out. A command meant for LaTeX goes in as a raw block, `` `\newpage`{=latex} ``.

Pandoc's implicit figures are off too. Pandoc would make an image alone in its
paragraph a figure, with its alt text as the caption, which Obsidian never
shows. A figure is an image with an italic line right under it instead:
`pandoc/obsidian.lua` makes the line its caption, and the image keeps its alt
text. Markdown, an export's or a post's, keeps the two as they were written,
the image and then its caption in italics: GitHub's Markdown has no figures,
and pandoc's own has them only since a pandoc newer than many people have
installed, where an older one left the caption out.

The tests expect the pandoc the core's flake pins, the built-in one's version
(`BUILT_IN` in `src/core/built-in.ts`), because citeproc formats some entries
differently from one version to the next. Run them in `nix develop`; against
another pandoc, the first test to fail says so.

Pandoc's own markdown has to be the reader, because its CommonMark reader has
no `[@key]` citations.

## A post

In the Open makes a note into a post for a website instead of a file. It runs
the same steps, with `post` in `prepare`'s options, which makes the metadata a
post's (`postMetadata`). The frontmatter keys that go along are `POST_KEYS`
(`postProperties`), in place of `DOCUMENT_KEYS`.

`postOf` says which notes are posts themselves. A link to one of them goes to
its post (`linkPosts`, after `citeByKey`). A link to a note of your own that
has no post is listed in `missing.unpublished`, which is read from the note as
written, like the other checks.

`postArgs` reads the note the same way. It moves every heading a level down,
because the site shows the title as the page's one level 1 heading, and makes
one of two things:

- **Markdown**, GitHub's without raw HTML, for a site that takes the
  references extension. With `link-citations`, each citation links to its
  entry, `#ref-<key>`, and `pandoc/post-references.lua` takes the entries out
  of the text into a file of their own, as JSON (`readReferences`). It runs
  after `--citeproc` and before `after-citeproc.lua`, which clears the
  bibliography it reads the works' DOIs from.
- **HTML**, finished, for any other site: citations as words, and the
  reference list at the end, under its heading.
