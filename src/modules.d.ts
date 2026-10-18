// Bundled as text by the plugin's esbuild: a `.lua` loader of `text`. A plugin
// declares these itself, since a declaration file is not part of what it
// imports from here.
declare module '*.lua' {
	const source: string;
	export default source;
}

// Bundled as bytes the same way: a `.ttf` loader of `binary`.
declare module '*.ttf' {
	const bytes: Uint8Array;
	export default bytes;
}
