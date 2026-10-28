#!/usr/bin/env node
// The built-in pandoc as a `pandoc` command, for running the whole suite
// against it: `PANDOC_WASM=<pandoc.wasm> PANDOC_BUILT_IN=1`, with this first
// on the PATH as `pandoc` (`nix flake check` does). It sees the whole disk as
// itself, `/`, which is enough for the tests' absolute paths on Linux; a
// plugin runs it through `builtInPandoc`, which sees only what it is given.
import { readFileSync } from 'node:fs';
import { WASI } from 'node:wasi';

const wasi = new WASI({ version: 'preview1', args: ['pandoc', ...process.argv.slice(2)], env: {}, preopens: { '/': '/' }, returnOnExit: true });
const module = new WebAssembly.Module(readFileSync(process.env.PANDOC_WASM));
process.exitCode = wasi.start(new WebAssembly.Instance(module, wasi.getImportObject()));
