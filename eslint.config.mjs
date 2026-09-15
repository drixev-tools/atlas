import typescriptEslint from 'typescript-eslint';

export default typescriptEslint.config(
	{
		ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**']
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: typescriptEslint.parser,
			ecmaVersion: 2022,
			sourceType: 'module'
		},
		plugins: {
			'@typescript-eslint': typescriptEslint.plugin
		},
		rules: {
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase']
				}
			],
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			semi: 'warn'
		}
	}
);
