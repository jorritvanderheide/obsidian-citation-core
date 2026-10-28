# Citation core

**How a note becomes pandoc's input, with its links turned into real citations.**

The part of [Due Credit](https://codeberg.org/BW20/obsidian-due-credit) that
another plugin can use too: every decision about reading a note, what is a
citation and how one is written, the works a `.bib` holds, and what pandoc is
asked to make. It has no Obsidian UI and no settings. A plugin bundles it into
its own `main.js` and wires it to Obsidian.

## What's here

| Path | What it holds |
| --- | --- |
| `src/core/` | Every decision. Pure: no Obsidian imports except type-only ones, no filesystem. Every file has a test named after it. |
| `src/pandoc.ts` | Running pandoc, and writing its files to a temporary folder. |
| `src/index.ts` | Everything a plugin imports. |
| `pandoc/` | The Lua filters. |
| `fonts/` | Open Sans, for PDF. |
| `docs/pipeline.md` | Every step from a note to pandoc's input, in order. |

How a link becomes a citation, form by form, is in Due Credit's
[`docs/citations.md`](https://codeberg.org/BW20/obsidian-due-credit/src/branch/main/docs/citations.md).

## Using it in a plugin

A plugin depends on it twice, once for npm and once for Nix, both pointing at
the same code:

- **npm:** `"obsidian-citation-core": "file:../obsidian-citation-core"` in
  `devDependencies`, with this repository checked out next to the plugin's.
  A change here shows up in the plugin's next build, with nothing to link or
  publish.
- **Nix:** a flake input, which `flake.lock` pins. The plugin's package copies
  it next to its source before `npm ci`, and its `checks` run this
  repository's checks at the pinned commit. CI checks out the commit
  `flake.lock` names, so a release is built from the pinned core, not
  whatever is checked out.

The plugin bundles the source, so its esbuild needs `'.lua': 'text'` and
`'.ttf': 'binary'` loaders, and declarations for both as in
[`src/modules.d.ts`](src/modules.d.ts).

## Development

```sh
nix develop     # Node.js and the pandoc the tests expect
npm install
npm run typecheck
npm run lint
npm test        # the filter tests need pandoc on the PATH
nix flake check # all three, with nixpkgs' pandoc
```

`tests/pandoc.test.ts` runs the filters and the pipeline through a real pandoc,
and skips what it can't run: everything without pandoc, and the PDF tests
without xelatex. Citeproc's output changes between pandoc versions, so the
expected results are for one: 3.7.0.2, the one in this flake's nixpkgs and
the one Due Credit's CI pins. Move both together.

### The conformance check

Pandoc reads its own markdown, which isn't Obsidian's, and has to: its
CommonMark reader has no `[@key]` citations. To find where the two read your
notes differently, run the conformance check on a vault, or any folder of
markdown:

```sh
VAULT=~/path/to/vault npx vitest run tests/conformance.test.ts
```

It lists every note whose blocks pandoc reads unlike CommonMark, and any text
the plugin would take for code, where a comment would be kept. It isn't part of
the normal test run, because it needs notes.

## License

Copyright © 2026 Jorrit van der Heide. Licensed under the [EUPL-1.2](LICENSE).
Open Sans, in [`fonts/`](fonts), is under the
[SIL Open Font License 1.1](fonts/OFL.txt).
