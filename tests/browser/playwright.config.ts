import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

const use: PlaywrightTestConfig['use'] = {
	browserName: 'chromium',
	headless: true,
	viewport: { width: 1280, height: 800 },
	deviceScaleFactor: 1,
	// Full Chromium in new headless mode, not the default headless shell: only here are the
	// sandboxed blob frames out of process, as in Cursor, which the trackpad pan test needs.
	channel: 'chromium',
};

const SERIAL = /@serial/;

// Local only (not Verify or CI): drives the built chrome bundle in tests/browser/harness.ts.
// Tests tagged @serial (the stability quiet window, the CDP pan gesture, the gallery's shared
// output) run alone on one worker, after the parallel project, so they never share CPU with it.
// ponytail: a failing parallel test skips the serial project (Playwright's dependency rule).
export default defineConfig({
	testDir: '.',
	workers: Number(process.env.CD_BROWSER_WORKERS ?? 5),
	retries: 0,
	forbidOnly: true,
	reporter: 'list',
	projects: [
		{ name: 'parallel', grepInvert: SERIAL, fullyParallel: true, use },
		{
			name: 'serial',
			grep: SERIAL,
			fullyParallel: false,
			workers: 1,
			dependencies: ['parallel'],
			use,
		},
	],
});
