import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			/*
			 * Every internal URL in this app is built by `src/lib/nav/paths.ts`,
			 * which calls SvelteKit's `resolve()` against a typed route ID — so a
			 * renamed route fails the type check rather than 404ing at runtime, and
			 * a base path would land in one file. This rule looks for that call at
			 * the link itself and cannot see through a function, so it reports every
			 * `href` and `goto` in the app. Centralising URL construction is the
			 * stronger version of what it is asking for; `nav/paths.ts` is the file
			 * to check when reviewing a new link.
			 */
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
