import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite-plus';

import { iifeStringPlugin } from './scripts/iifeStringPlugin';

export default defineConfig({
	plugins: [svelte(), iifeStringPlugin()],
	base: './',
	build: {
		outDir: 'dist/webview',
		emptyOutDir: true,
		sourcemap: true,
		modulePreload: false,
		cssCodeSplit: false,
		rollupOptions: {
			input: 'src/webview/main.ts',
			output: {
				entryFileNames: 'chrome.js',
				assetFileNames: 'chrome.css',
				codeSplitting: false,
			},
		},
	},
});
