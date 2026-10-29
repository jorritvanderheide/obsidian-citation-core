# Citation core

**How a note becomes pandoc's input, with its links turned into real citations.**

This is the part of [Due Credit](https://codeberg.org/BW20/obsidian-due-credit)
that [In the Open](https://codeberg.org/BW20/obsidian-in-the-open) uses too. It
turns a note into pandoc's input, works out which links are citations and how
to write one, reads the works in a `.bib` file, and builds the arguments pandoc
runs with. It has no interface and no settings of its own. Each plugin bundles
it into its own `main.js` and connects it to Obsidian.

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
| `tests/` | A test for each file in `src/core/`; `pandoc.test.ts` and `wasm.test.ts`, which run a real pandoc; and `conformance.test.ts`, which runs only on a vault you point it at. |
| `vitest.config.ts` | The `.lua` and `.ttf` imports for the tests, as a plugin's esbuild has them, and a longer timeout for the built-in pandoc. |
| `flake.nix` | The pinned pandoc, as pandoc's static build and its WebAssembly build, and the checks. |
| `.forgejo/workflows/newest-pandoc.yml` | Once a month, the filter tests against the newest pandoc, on Codeberg. |
| `docs/pipeline.md` | Every step from a note to pandoc's input, in order. |

How a link becomes a citation, form by form, is in Due Credit's
[`docs/citations.md`](https://codeberg.org/BW20/obsidian-due-credit/src/branch/main/docs/citations.md).

## Using it in a plugin

A plugin depends on it once, as a git dependency on the GitHub mirror, at one
commit, in `devDependencies`:
`npm install git+https://github.com/jorritvanderheide/obsidian-citation-core.git#<commit>`,
which npm writes as `"obsidian-citation-core":
"github:jorritvanderheide/obsidian-citation-core#<commit>"`. A clean checkout
of the plugin builds with it, which the plugin directory's review needs, and
so does the plugin's flake. To work on the core and a plugin at once, run
`npm install --no-save ../obsidian-citation-core` in the plugin.

The commit a plugin pins is always a tagged version, so its release notes can
say what changed since the last: [`CHANGELOG.md`](CHANGELOG.md) has each
version. This repository's checks have passed on that commit before it is
tagged, so a plugin doesn't run them again. A plugin that moves to a new one
carries what its users notice into its own changelog.

## The built-in pandoc

The built-in pandoc is pandoc's own WebAssembly build, which a plugin runs
inside Obsidian for someone who has no pandoc installed or can't install one.
`src/core/built-in.ts` pins it, pandoc 3.13 from pandoc's release, by the hash
of the archive and of the file. `src/wasm.ts` downloads it once, when the user
agrees, into their cache folder (`cacheFolder`). That's outside every vault,
and the plugins that use it share it.

- **Which pandoc runs** depends on the **Pandoc** setting (`choosePandoc`).
  The default, `pandoc`, is an installed pandoc when one is on the PATH, and
  the built-in one when there isn't. An empty setting counts as the default.
  Anything else is the path to your own pandoc. `pandocFor` turns the setting
  into a `Pandoc`.
- **It sees only the vault and the folders it's given.** The vault is `/`, and
  each folder a file it needs is in gets a name of its own (`Mounts`). It
  can't see the rest of the disk. Paths go through `Pandoc.see`, a run's
  through `seen` and your Pandoc arguments through `seenArgs`. The resource
  path is joined with `Pandoc.delimiter`, which is `:` for the built-in one on
  every platform, so the same arguments work for either pandoc, on Windows
  too.
- **It can't run another program**, such as a PDF engine or your own
  `--filter`. Those need an installed pandoc.
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
npm run lint    # any warning fails it
npm test        # the filter tests need pandoc on the PATH
nix flake check # all three, then the tests again on the built-in pandoc
```

`tests/pandoc.test.ts` runs the filters and the pipeline through a real pandoc,
and skips what it can't run: everything without pandoc, and the PDF tests
without xelatex. `tests/wasm.test.ts` runs the built-in pandoc as a plugin
does, from `PANDOC_WASM`, which `nix develop` sets. `nix flake check` runs the
whole suite twice, once on the pinned pandoc and once on the built-in one as
`pandoc` (`scripts/pandoc-wasm.mjs`). The second run skips the PDF tests,
since the built-in pandoc runs no PDF engine.

Citeproc's output changes between pandoc versions, so the expected results are
for one version, 3.13. That's the built-in pandoc's version, and this flake
pins the same one as pandoc's own static build for Linux, where CI runs. Move
the two together, and the hashes in `src/core/built-in.ts` with them.

Once a month, Codeberg runs `tests/pandoc.test.ts` against the newest pandoc
(`.forgejo/workflows/newest-pandoc.yml`), with `PANDOC_OTHER_VERSION=1`,
which skips the test that the pandoc is 3.13. A failure emails the
repository's owner. It's either citeproc formatting something differently,
which moving to the newer pandoc fixes, or a real break, which wants a fix in
the filters. It runs on Codeberg because GitHub turns off a scheduled
workflow after 60 days without a commit.

### A new version

1. **Write the notes.** Rename `## Unreleased` in `CHANGELOG.md` to the new
   version. Before 1.0.0, a change in what a plugin's users get, or in what
   `src/index.ts` exports, raises the minor version, and anything else the
   patch.
2. **Bump it:** `npm version <x.y.z> --no-git-tag-version`, and the
   `npmDepsHash` in `flake.nix` that `nix flake check` then asks for.
3. **Push** the commit, and wait for CI on the GitHub mirror to pass on it,
   since the plugins don't run these checks again. Then tag it, without a
   `v`: `jj tag set <x.y.z> -r <commit>`, and `git push codeberg <x.y.z>`,
   since jj doesn't push tags. The tag reaches the GitHub mirror with it.
4. **In each plugin,** move the pin to the tagged commit (`npm install` at it,
   as the plugin's `docs/development.md` says), and write what its users
   notice under its own `## Unreleased`.

### The conformance check

Pandoc has to read notes as its own markdown, because its CommonMark reader
doesn't know `[@key]` citations. But pandoc's markdown isn't quite Obsidian's.
To find where the two read your notes differently, run the conformance check on
a vault, or any folder of markdown:

```sh
VAULT=~/path/to/vault npx vitest run tests/conformance.test.ts
```

It lists every note whose blocks pandoc reads unlike CommonMark, and any text
the plugin would mistake for code, which would let a comment end up in the
export. It isn't part of the normal test run, because it needs notes.

## License

Copyright © 2026 Jorrit van der Heide. Licensed under the [EUPL-1.2](LICENSE).
Open Sans, in [`fonts/`](fonts), is under the
[SIL Open Font License 1.1](fonts/OFL.txt). The built-in pandoc isn't part of
this repository or of a plugin's `main.js`: a plugin downloads it from
pandoc's release, under pandoc's own license, the GPL-2.0-or-later.
