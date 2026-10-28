// Everything a plugin takes from here. The plugin bundles it from source, so
// its esbuild needs a `text` loader for `.lua` and a `binary` one for `.ttf`,
// and its own declarations of both, as in `modules.d.ts` here.
export * from './core/bibliography';
export * from './core/citations';
export * from './core/document';
export * from './core/markdown';
export * from './core/paths';
export * from './core/prepare';
export * from './core/writing';
export * from './core/built-in';
export * from './pandoc';
export * from './wasm';
