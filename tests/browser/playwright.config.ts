import { defineConfig } from '@playwright/test';

// Local only (not Verify or CI): drives the built chrome bundle in tests/browser/harness.ts.
export default defineConfig({
	testDir: '.',
	fullyParallel: false,
	// One worker: the stability quiet window and the CDP pan gesture must not share CPU with
	// another spec.
	workers: 1,
	retries: 0,
	forbidOnly: true,
	reporter: 'list',
	projects: [
		{
			name: 'chromium',
			use: {
				browserName: 'chromium',
				headless: true,
				viewport: { width: 1280, height: 800 },
				deviceScaleFactor: 1,
				// Full Chromium in new headless mode, not the default headless shell: only here are the
				// sandboxed blob frames out of process, as in Cursor, which the trackpad pan test needs.
				channel: 'chromium',
			},
		},
	],
});
