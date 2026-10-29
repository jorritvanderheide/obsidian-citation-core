# Changelog

What changed in each version of the core, newest first. A plugin's own
changelog says what of this its users notice, in the release that moves to it.
Each version is a tag, and a plugin pins only a tagged commit.

## 0.3.0

- A backslash before a word exports as written, `C:\path\x` and `Back\slash`,
  as Obsidian shows it. Pandoc read them as LaTeX commands and left them out of
  every export, words and all. LaTeX you wrote on purpose, like `\newpage`, now
  prints as text too: write it as a raw block, `` `\newpage`{=latex} ``, and
  it still reaches a PDF or LaTeX export.
- An entry with its key on the line after the brace is read, so citing it
  works. 0.2.0 turned an in-text citation of such an entry into plain text.
- Two bibliographies, the setting's and one under Pandoc arguments, are both
  read. Every wikilink citation came out as plain text with two.
- A citation key with a slash in it, like `[[jones/2019]]`, is a citation. A
  link read it as a folder and a name, so it came out as plain text, and the
  check before an export didn't say so.
- A Markdown export leaves an image and the line in italics under it as
  Obsidian shows them, the caption on its own line. 0.2.0 put a blank line
  between them, which made the caption a paragraph of its own.
- A Markdown link to a note, `[Smith](smith-2017.md)`, which Obsidian writes
  with "Use [[Wikilinks]]" off, is read as the wikilink it means. A link to a
  paper note under another name cites its key, a post links to a published
  note, and the check before an export lists one that won't cite.
- Pandoc arguments also turn down `+RTS`, which gives options to the runtime
  pandoc runs on, and one of those writes a file of its own.
- For the plugins: `bibliographiesIn` finds every `--bibliography` in Pandoc
  arguments, so a check can read their keys as well as the setting's.

## 0.2.0

- A Markdown export keeps an image's caption as the italic line under it, as
  written. A pandoc older than the one the tests expect left the caption out
  altogether.
- A citation key with a colon in it, `[[smith:2017]]`, is a citation. It used
  to be taken for a web address and exported as its words, and the check
  before an export didn't say so.
- A bare `@word` whose key isn't in the bibliography, a handle in your prose or
  in a passage you quoted, stays as written instead of becoming "(jack?)". In
  brackets, `[@typo]`, it's still a citation.
- An embed with alt text and a width, `![[figure.png|A chart|300]]`, keeps
  its width.
- Pandoc arguments refuse an option however it's written: run together after
  another, as in `-sd x.yaml`, or shortened, as in `--extr=dir`. Either could
  write a file into the vault.
- For the plugins: `stylePath`, `missingBibliography` and `missingStyle`, so
  the style folder and the messages for a missing file are written once, and
  the style message says a style can be a path. `keyPropertyStatus` and
  `papersFolderStatus`, for a settings tab to say when the citation key
  property or the papers folder matches no note.
- A post reads the note exactly as an export does, from one list of pandoc's
  arguments.
- The tests say first when they run against another pandoc than 3.13, and the
  checks run on every push to the GitHub mirror.

## 0.1.0

What Due Credit 1.6.0 and In the Open 1.3.0 bundle, the first commit with a
version.
