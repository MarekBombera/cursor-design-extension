import { expect, test } from '@playwright/test';

import { canvasUpdated, frameOf, openHarness, postToChrome, untilHeightReported } from './harness';

// FRAME_CSP (stampArtboardHtml.ts): inline artboard code runs, but nothing leaves the frame, not
// even a <script src> that carries the stamped nonce or one artboard JS adds at runtime with the
// nonce it read. The harness has no chrome CSP, so FRAME_CSP is the only policy proven here; any
// request it let through would reach the harness route and count as aborted.
const REMOTE = 'https://cdn.cd-remote.test';

// The first script sits before <meta charset>: it must still run under FRAME_CSP.
const PROBE_PAGE = `<!doctype html><html><head>
<script>
	window.__violations = [];
	document.addEventListener('securitypolicyviolation', (event) => {
		window.__violations.push(event.blockedURI);
	});
	window.__inlineRan = true;
	const early = document.createElement('script');
	early.nonce = document.currentScript.nonce;
	early.src = '${REMOTE}/early.js';
	document.head.append(early);
</script>
<meta charset="utf-8">
<style>.probe { color: rgb(1, 2, 3); }</style>
<script src="${REMOTE}/static.js"></script>
</head><body><p class="probe">probe</p>
<script>
	const injected = document.createElement('script');
	injected.nonce = document.currentScript.nonce;
	injected.src = '${REMOTE}/injected.js';
	document.head.append(injected);
</script>
</body></html>`;

test('an artboard runs its inline code but cannot load remote scripts, static, injected, or from a script before meta charset', async ({
	page,
}) => {
	const harness = await openHarness(page);
	// Chromium reports a CSP-blocked load as a failed request; only a sent one hits the route.
	const remoteFailures: string[] = [];
	page.on('requestfailed', (request) => {
		if (request.url().startsWith(REMOTE)) {
			remoteFailures.push(request.failure()?.errorText ?? '');
		}
	});
	await postToChrome(
		page,
		canvasUpdated([
			{ id: 'a', label: 'A', x: 0, y: 0, width: 400, generation: 1, html: PROBE_PAGE },
		]),
	);
	await untilHeightReported(page, 'a');
	const frame = await frameOf(page, 'a');

	expect(await frame.evaluate(() => (window as { __inlineRan?: boolean }).__inlineRan)).toBe(true);
	expect(
		await frame.evaluate(() => getComputedStyle(document.querySelector('.probe')!).color),
	).toBe('rgb(1, 2, 3)');
	await expect
		.poll(() => frame.evaluate(() => (window as { __violations?: string[] }).__violations ?? []))
		.toEqual([`${REMOTE}/early.js`, `${REMOTE}/static.js`, `${REMOTE}/injected.js`]);
	await expect.poll(() => remoteFailures).toEqual(['csp', 'csp', 'csp']);
	expect(harness.abortedRequests()).toBe(0);
});
