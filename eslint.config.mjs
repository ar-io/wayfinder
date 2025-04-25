import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import header from 'eslint-plugin-header';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// workaround: https://github.com/Stuk/eslint-plugin-header/issues/57#issuecomment-2378485611
header.rules.header.meta.schema = false;
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

export default [
	...compat.extends(
		'eslint:recommended',
		'plugin:@typescript-eslint/eslint-recommended',
		'plugin:@typescript-eslint/recommended',
	),
	{
		plugins: {
			'@typescript-eslint': typescriptEslint,
			header,
		},
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module',
			parserOptions: {
				project: 'tsconfig.json',
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': ['off'],
			eqeqeq: ['error', 'smart'],
			'header/header': [2, './resources/license.header.js'],
		},
	},
];
