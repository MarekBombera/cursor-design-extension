import { basename, extname } from 'node:path';

import { build, type Plugin } from 'vite-plus';

// `import source from './runtime.ts?iife'` yields that module bundled as an IIFE string, so the
// iframe runtime and stage geometry have one TS source each but can still be inlined into
// documents (blob frames, exported canvas.html). The IIFE global is the file stem; a module
// with no exports is a bare IIFE. Unminified, so the export bytes do not depend on --minify.
const IIFE_SUFFIX = '?iife';
const VIRTUAL_PREFIX = '\0iife:';

export const iifeStringPlugin = (): Plugin => ({
	name: 'cursor-design:iife-string',
	enforce: 'pre',
	async resolveId(source, importer) {
		if (!source.endsWith(IIFE_SUFFIX)) {
			return null;
		}
		const resolved = await this.resolve(source.slice(0, -IIFE_SUFFIX.length), importer, {
			skipSelf: true,
		});
		if (resolved === null) {
			throw new Error(`Cannot resolve ${source} from ${importer ?? 'the entry'}`);
		}
		return `${VIRTUAL_PREFIX}${resolved.id}`;
	},
	async load(id) {
		if (!id.startsWith(VIRTUAL_PREFIX)) {
			return null;
		}
		const entry = id.slice(VIRTUAL_PREFIX.length);
		const globalName = basename(entry, extname(entry));
		if (!/^[A-Za-z_$][\w$]*$/.test(globalName)) {
			throw new Error(`?iife needs a file stem that is a JS identifier: ${entry}`);
		}
		const output = await build({
			configFile: false,
			logLevel: 'silent',
			build: {
				write: false,
				emptyOutDir: false,
				minify: false,
				sourcemap: false,
				lib: {
					entry,
					formats: ['iife'],
					name: globalName,
				},
			},
		});
		const [result] = Array.isArray(output) ? output : [output];
		if (result === undefined || !('output' in result)) {
			throw new Error(`?iife build of ${entry} returned no output`);
		}
		const [chunk] = result.output;
		if (chunk?.type !== 'chunk') {
			throw new Error(`?iife build of ${entry} produced no chunk`);
		}
		// Watch mode (pnpm watch) rebuilds when a module of the nested bundle changes.
		if (typeof this.addWatchFile === 'function') {
			for (const moduleId of chunk.moduleIds.filter((moduleId) => !moduleId.startsWith('\0'))) {
				this.addWatchFile(moduleId);
			}
		}
		// Inlined into <script> text, so it must never close the element.
		// ponytail: only `</` is escaped; a `<!--` + `<script` pair in source would need more.
		const code = chunk.code.replaceAll('</', '<\\/');
		return `export default ${JSON.stringify(code)};`;
	},
});
