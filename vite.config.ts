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
});
