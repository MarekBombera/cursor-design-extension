import { defineConfig } from 'vite-plus';
import pkg from './package.json' with { type: 'json' };

// Two CJS bundles for VS Code. The .vsix ships without node_modules, so runtime deps are bundled.
// Production: `vp pack --minify --no-sourcemap`.
const shared = {
	format: 'cjs',
	platform: 'node',
	outDir: 'dist',
	fixedExtension: false,
	clean: false,
	dts: false,
	exports: false,
	hash: false,
	sourcemap: true,
	outputOptions: { sourcemapExcludeSources: true },
} as const;

// Regexes so subpath imports (`zod/mini`, `@modelcontextprotocol/server/stdio`) are bundled too.
const alwaysBundle = [/^@modelcontextprotocol\/server(\/|$)/, /^zod(\/|$)/];

export default defineConfig({
	lint: {
		plugins: ['typescript'],
		categories: { correctness: 'error' },
		rules: {
			curly: 'warn',
			eqeqeq: 'warn',
			'no-throw-literal': 'warn',
			// Type-aware rules stay off until 7e turns them on.
			'typescript/await-thenable': 'off',
			'typescript/no-array-delete': 'off',
			'typescript/no-base-to-string': 'off',
			'typescript/no-duplicate-type-constituents': 'off',
			'typescript/no-floating-promises': 'off',
			'typescript/no-for-in-array': 'off',
			'typescript/no-implied-eval': 'off',
			'typescript/no-meaningless-void-operator': 'off',
			'typescript/no-misused-spread': 'off',
			'typescript/no-redundant-type-constituents': 'off',
			'typescript/no-unsafe-unary-minus': 'off',
			'typescript/no-useless-default-assignment': 'off',
			'typescript/require-array-sort-compare': 'off',
			'typescript/restrict-template-expressions': 'off',
			'typescript/unbound-method': 'off',
		},
		ignorePatterns: ['dist', 'out', 'node_modules', '.vscode-test'],
		options: { typeAware: true, typeCheck: true },
	},
	fmt: {
		semi: true,
		singleQuote: true,
		useTabs: true,
		printWidth: 100,
		ignorePatterns: [
			'**/dist/**',
			'**/out/**',
			'**/node_modules/**',
			'**/.vscode-test/**',
			'**/.agents/**',
			'**/.cursor/**',
			'**/.claude/**',
			'**/blueprint/**',
			'src/types/vscode.cursor.d.ts',
		],
	},
	pack: [
		{
			...shared,
			entry: { extension: 'src/extension.ts' },
			deps: { neverBundle: ['vscode'], alwaysBundle },
		},
		{
			...shared,
			entry: { mcp: 'src/mcp/server.ts' },
			deps: { alwaysBundle },
			define: { 'process.env.CURSOR_DESIGN_VERSION': JSON.stringify(pkg.version) },
		},
	],
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['src/test/**'],
		pool: 'forks',
		passWithNoTests: false,
	},
});
