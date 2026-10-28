// The filters and the font, imported as the plugins' esbuild imports them:
// `.lua` as text and `.ttf` as bytes, for the tests that run `src/pandoc.ts`.
import { readFileSync } from 'fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// The built-in pandoc takes a second a run, where an installed one takes a
	// tenth, and some tests run it several times.
	test: { testTimeout: process.env.PANDOC_BUILT_IN === '1' ? 60_000 : 5_000 },
	plugins: [
		{
			name: 'bundled-files',
			enforce: 'pre',
			load(id) {
				if (id.endsWith('.lua')) return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
				if (id.endsWith('.ttf')) return `export default Uint8Array.from(atob(${JSON.stringify(readFileSync(id).toString('base64'))}), (c) => c.charCodeAt(0));`;
				return null;
			},
		},
	],
});
