import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores(['node_modules', 'package.json', 'package-lock.json', 'tsconfig.json']),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'vitest.config.ts', 'scripts/pandoc-wasm.mjs'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	...obsidianmd.configs.recommended,
	// What the Obsidian rules relax for a plugin whose manifest says it is
	// desktop only. There is no manifest here, and only such plugins bundle this.
	// The plugin says so on every run, with "Failed to load JSON file", and
	// lints all the same.
	{
		languageOptions: {
			globals: {
				...globals.node,
				NodeJS: 'readonly',
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/regex-lookbehind': 'off',
		},
	},
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', { brands: ['Zotero', 'Better BibTeX', 'Due Credit'] }],
		},
	},
);
