import { defineConfig } from 'oxlint'

import type { OxlintConfig } from 'oxlint'

export default defineConfig({
	plugins: ['typescript', 'import', 'unicorn'],
	env: {
		builtin: true,
		es2024: true,
	},
	ignorePatterns: ['coverage/**', 'dist/**', 'node_modules/**'],
	rules: {
		'@typescript-eslint/no-floating-promises': 'error',
		'import/no-named-as-default': 'error',
		'import/no-named-as-default-member': 'error',
		'import/no-duplicates': 'error',
		'no-var': 'error',
		'prefer-rest-params': 'error',
		'prefer-spread': 'error',
		'eslint/prefer-const': 'error',
		'@typescript-eslint/ban-ts-comment': 'error',
		'@typescript-eslint/no-empty-object-type': 'error',
		'@typescript-eslint/no-explicit-any': 'error',
		'typescript/await-thenable': 'error',
		'typescript/no-array-delete': 'error',
		'typescript/no-for-in-array': 'error',
		'typescript/no-implied-eval': 'error',
		'typescript/no-misused-promises': 'error',
		'typescript/no-unnecessary-type-assertion': 'error',
		'typescript/no-unsafe-argument': 'error',
		'typescript/no-unsafe-assignment': 'error',
		'typescript/no-unsafe-call': 'error',
		'typescript/no-unsafe-member-access': 'error',
		'typescript/no-unsafe-return': 'error',
		'typescript/only-throw-error': 'error',
		'typescript/prefer-promise-reject-errors': 'error',
		'typescript/require-await': 'error',
		'typescript/restrict-plus-operands': 'error',
		'typescript/unbound-method': 'error',
		'no-unused-vars': [
			'error',
			{
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			},
		],
		'@typescript-eslint/consistent-type-imports': [
			'error',
			{
				prefer: 'type-imports',
			},
		],
		'@typescript-eslint/explicit-function-return-type': 'off',
		'@typescript-eslint/array-type': [
			'error',
			{
				default: 'array-simple',
			},
		],
		'no-empty': 'error',
	},
} as const satisfies OxlintConfig)
