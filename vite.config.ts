import { defineConfig, type Plugin } from 'vite-plus';
import pkg from './package.json' with { type: 'json' };
import { iifeStringPlugin } from './scripts/iifeStringPlugin';

// Outside `shared` so `as const` does not make the array readonly (tsdown wants Plugin[]).
const packPlugins: Plugin[] = [iifeStringPlugin()];

// The .vsix ships without node_modules, so runtime deps are bundled.
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
	plugins: packPlugins,
} as const;

// Regexes so subpath imports (`zod/mini`, `@modelcontextprotocol/server/stdio`) are bundled too.
const alwaysBundle = [/^@modelcontextprotocol\/server(\/|$)/, /^zod(\/|$)/, /^parse5(\/|$)/];

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
	// `?iife` imports for `vp test` (the pack entries register it in `shared`).
	plugins: [iifeStringPlugin()],
	lint: {
		plugins: ['typescript', 'unicorn', 'import', 'node'],
		categories: { correctness: 'error' },
		rules: {
			// `z` is the zod/mini namespace, `T` a type parameter.
			'func-style': ['error', 'expression'],
			'prefer-arrow-callback': 'error',
			'unicorn/catch-error-name': ['error', { name: 'error' }],
			'id-length': ['error', { min: 2, exceptions: ['_', 'x', 'y', 'z', 'T'] }],
			'id-denylist': ['error', 'err', 'res', 'resp', 'req', 'opts', 'ctx', 'cb', 'val', 'abId'],

			// MCP stdout is the protocol: log through the OutputChannel or stderr, never console.
			'no-throw-literal': 'error',
			'no-empty': 'error',
			'no-console': 'error',
			'typescript/no-explicit-any': 'error',
			'typescript/ban-ts-comment': 'error',

			'no-restricted-imports': ['error', { paths: bannedLibraries, patterns: bannedPatterns }],
			'no-restricted-properties': [
				'error',
				{
					object: 'vscode',
					property: 'lm',
					message: 'Brain = Cursor Agent only. Never vscode.lm.',
				},
			],

			// The resolver cannot see `?iife` default exports (scripts/iifeStringPlugin.ts); type-aware
			// checking already fails a default import the module does not have.
			'import/default': 'off',

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
				// Host side of MCP: it may import vscode.
				files: ['src/mcp/registerCursorDesignMcp.ts'],
				rules: {
					'no-restricted-imports': ['error', { paths: bannedLibraries, patterns: bannedPatterns }],
				},
			},
			{
				files: ['src/webview/**'],
				rules: {
					'no-restricted-imports': [
						'error',
						{
							paths: [...bannedLibraries, vscodeOnlyInHost],
							patterns: [
								...bannedPatterns,
								{
									group: ['node:*', 'fs', 'path', 'child_process', 'crypto'],
									message: 'Webview chrome cannot import vscode or Node built-ins.',
								},
							],
						},
					],
				},
			},
			{
				// Webview unit tests run in Node (Vitest), so Node built-ins are fine there.
				files: ['src/webview/**/*.test.ts'],
				rules: {
					'no-restricted-imports': [
						'error',
						{ paths: [...bannedLibraries, vscodeOnlyInHost], patterns: bannedPatterns },
					],
				},
			},
			{
				files: ['**/*.test.ts', 'tests/browser/**'],
				rules: { 'id-length': 'off', 'typescript/explicit-module-boundary-types': 'off' },
			},
			{ files: ['scripts/**'], rules: { 'no-console': 'off' } },
		],
		ignorePatterns: [
			'dist',
			'coverage',
			'node_modules',
			'test-results',
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
			'**/coverage/**',
			'**/node_modules/**',
			'**/test-results/**',
			'**/.agents/**',
			'**/.cursor/**',
			'**/.claude/**',
			'**/blueprint/**',
			'src/types/vscode.cursor.d.ts',
			'**/*.svelte',
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
		pool: 'forks',
		passWithNoTests: false,
		coverage: {
			provider: 'v8',
		},
	},
});
