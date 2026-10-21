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

// Libraries the rules say not to add (.claude/rules/00-cursor-design-core.md, 02, 06).
const bannedLibraries = [
	{
		name: '@modelcontextprotocol/sdk',
		message: 'Use @modelcontextprotocol/server (v2) in the MCP process.',
	},
	...['neverthrow', 'effect', 'fp-ts'].map((name) => ({
		name,
		message: 'Plain Error subclasses or a discriminated return (06-error-handling).',
	})),
	...['next', '@sveltejs/kit', 'react', 'react-dom'].map((name) => ({
		name,
		message: 'Chrome is Svelte 5 + Vite, no Kit / Next / React (00-cursor-design-core).',
	})),
];
const bannedPatterns = [
	{ group: ['@sentry/*'], message: 'No crash reporter in v1. Log to the OutputChannel.' },
];
const vscodeOnlyInHost = {
	name: 'vscode',
	message: 'Disk lib and MCP process run without VS Code. Only the extension host imports vscode.',
};

export default defineConfig({
	lint: {
		plugins: ['typescript', 'unicorn', 'import', 'node'],
		categories: { correctness: 'error' },
		rules: {
			// Arrows and full names (04-code-conventions). `z` is the zod/mini namespace, `T` a type parameter.
			'func-style': ['error', 'expression'],
			'prefer-arrow-callback': 'error',
			'unicorn/catch-error-name': ['error', { name: 'error' }],
			'id-length': ['error', { min: 2, exceptions: ['_', 'x', 'y', 'z', 'T'] }],
			'id-denylist': ['error', 'err', 'res', 'resp', 'req', 'opts', 'ctx', 'cb', 'val', 'abId'],

			// Errors (06-error-handling). MCP stdout is the protocol; log through the OutputChannel or stderr.
			'no-throw-literal': 'error',
			'no-empty': 'error',
			'no-console': 'error',
			'typescript/no-explicit-any': 'error',
			'typescript/ban-ts-comment': 'error',

			// Sacred constraints (00-cursor-design-core).
			'no-restricted-imports': ['error', { paths: bannedLibraries, patterns: bannedPatterns }],
			'no-restricted-properties': [
				'error',
				{
					object: 'vscode',
					property: 'lm',
					message: 'Brain = Cursor Agent only. Never vscode.lm.',
				},
			],

			curly: 'error',
			eqeqeq: ['error', 'smart'],
			'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
			'no-var': 'error',
			'object-shorthand': 'error',
			'prefer-template': 'error',
			'unicorn/prefer-node-protocol': 'error',
		},
		overrides: [
			{
				files: ['src/**/*.ts'],
				rules: { 'typescript/explicit-module-boundary-types': 'error' },
			},
			{
				files: ['src/disk/**', 'src/mcp/**'],
				rules: {
					'no-restricted-imports': [
						'error',
						{ paths: [...bannedLibraries, vscodeOnlyInHost], patterns: bannedPatterns },
					],
				},
			},
			{
				// Host side of MCP: registers the stdio server with VS Code.
				files: ['src/mcp/registerCursorDesignMcp.ts'],
				rules: {
					'no-restricted-imports': ['error', { paths: bannedLibraries, patterns: bannedPatterns }],
				},
			},
			{
				files: ['**/*.test.ts'],
				rules: { 'id-length': 'off', 'typescript/explicit-module-boundary-types': 'off' },
			},
			{ files: ['scripts/**'], rules: { 'no-console': 'off' } },
		],
		ignorePatterns: [
			'dist',
			'out',
			'coverage',
			'node_modules',
			'.vscode-test',
			'src/test',
			// Vendored Blueprint scripts follow upstream style.
			'.cursor',
			'.claude',
			'.agents',
		],
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
			'**/coverage/**',
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
		coverage: {
			provider: 'v8',
		},
	},
});
