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
		},
		ignorePatterns: ['dist', 'out', 'node_modules', '.vscode-test', 'src/test'],
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
