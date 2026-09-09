const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

let inflightBuildCount = 0;

/** @returns {import('esbuild').Plugin} */
const createEsbuildProblemMatcherPlugin = () => ({
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			if (watch && inflightBuildCount === 0) {
				console.log('[watch] build started');
			}
			inflightBuildCount += 1;
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			inflightBuildCount -= 1;
			if (watch && inflightBuildCount === 0) {
				console.log('[watch] build finished');
			}
		});
	},
});

const sharedBuildOptions = {
	bundle: true,
	format: 'cjs',
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	platform: 'node',
	logLevel: 'silent',
};

const main = async () => {
	const hostCtx = await esbuild.context({
		...sharedBuildOptions,
		entryPoints: ['src/extension.ts'],
		outfile: 'dist/extension.js',
		external: ['vscode'],
		plugins: [createEsbuildProblemMatcherPlugin()],
	});
	const mcpCtx = await esbuild.context({
		...sharedBuildOptions,
		entryPoints: ['src/mcp/server.ts'],
		outfile: 'dist/mcp.js',
		plugins: [createEsbuildProblemMatcherPlugin()],
	});
	if (watch) {
		await Promise.all([hostCtx.watch(), mcpCtx.watch()]);
		return;
	}
	await Promise.all([hostCtx.rebuild(), mcpCtx.rebuild()]);
	await Promise.all([hostCtx.dispose(), mcpCtx.dispose()]);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
