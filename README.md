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
| `src/pandoc.ts` | Running pandoc, an installed one or the built-in one, and writing its files to a temporary folder. |
| `src/wasm.ts` | The built-in pandoc on disk: loading it, checked against its pinned hash, and downloading it. |
| `src/index.ts` | Everything a plugin imports. |
| `src/modules.d.ts` | The declarations of the `.lua` and `.ttf` imports, which a plugin copies. |
| `pandoc/` | The Lua filters. |
| `fonts/` | Open Sans, for PDF. |
| `scripts/pandoc-wasm.mjs` | The built-in pandoc as a `pandoc` command, for running the tests against it. |
| `tests/` | A test for each file in `src/core/`, and `pandoc.test.ts` and `wasm.test.ts`, which run a real pandoc. |
| `vitest.config.ts` | The `.lua` and `.ttf` imports for the tests, as a plugin's esbuild has them, and a longer timeout for the built-in pandoc. |
| `flake.nix` | The pinned pandoc, as pandoc's static build and its WebAssembly build, and the checks. |
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

## The built-in pandoc

Pandoc's own WebAssembly build, which a plugin runs in itself, for whoever
has no pandoc installed or can't install one. `src/core/built-in.ts` pins it,
pandoc 3.13 from pandoc's release, by the hash of the archive and of the file;
`src/wasm.ts` downloads it once, when the person agrees, into the user's
cache folder (`cacheFolder`), outside every vault, where the plugins that
use it share it.

- **Which pandoc runs** is the **Pandoc** setting's (`choosePandoc`): its
  default, `pandoc`, is an installed one when the PATH has it and the
  built-in one when it doesn't, and so is a blanked setting; anything
  else is a pandoc of yours. `pandocFor` turns the setting into a `Pandoc`.
- **What it sees** is the vault, as `/`, and each folder a file it needs is
  in, under a name of its own (`Mounts`): nothing else on the disk. Paths
  go through `Pandoc.see`, a run's through `seen` and your Pandoc arguments
  through `seenArgs`, and the resource path is joined with
  `Pandoc.delimiter`, which is `:` for the built-in one on every platform. So
  the same arguments work for either pandoc, on Windows too.
- **What it can't do** is run another program: a PDF engine, or a
  `--filter` of yours. Those need an installed pandoc.
- It runs through Node's WASI, in the plugin, so it is desktop only, as the
  plugins are.

The plugin bundles the source, so its esbuild needs `'.lua': 'text'` and
`'.ttf': 'binary'` loaders, and declarations for both as in
[`src/modules.d.ts`](src/modules.d.ts).

## Development

```sh
nix develop     # Node.js, the pandoc the tests expect, and the built-in one (Linux)
npm install
npm run typecheck
npm run lint
npm test        # the filter tests need pandoc on the PATH
nix flake check # all three, then the tests again on the built-in pandoc
```

`tests/pandoc.test.ts` runs the filters and the pipeline through a real pandoc,
and skips what it can't run: everything without pandoc, and the PDF tests
without xelatex. `tests/wasm.test.ts` runs the built-in pandoc as a plugin
does, from `PANDOC_WASM`, which `nix develop` sets. `nix flake check` runs the
whole suite twice: on the pinned pandoc, and on the built-in one as `pandoc`
(`scripts/pandoc-wasm.mjs`); that run skips the PDF tests, since the built-in
pandoc runs no PDF engine. Citeproc's output changes between pandoc versions,
so the expected results are for one: 3.13, the built-in pandoc's version,
which this flake pins as pandoc's own static build for Linux, where CI runs.
Move them together, the hashes in `src/core/built-in.ts` too.

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
[SIL Open Font License 1.1](fonts/OFL.txt). The built-in pandoc isn't part of
this repository or of a plugin's `main.js`: a plugin downloads it from
pandoc's release, under pandoc's own license, the GPL-2.0-or-later.
