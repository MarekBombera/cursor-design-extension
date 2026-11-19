import { expect, test } from '@playwright/test';

import {
	canvasUpdated,
	centerOf,
	clickAt,
	frameElementBox,
	frameOf,
	openHarness,
	postToChrome,
	untilHeightReported,
} from './harness';

// FRAME_CSP (stampArtboardHtml.ts): inline artboard code runs, but nothing leaves the frame, not
// even a <script src> that carries the stamped nonce or one artboard JS adds at runtime with the
// nonce it read. This first test runs without the chrome CSP, so FRAME_CSP is the only policy
// proven there; any request it let through would reach the harness route and count as aborted.
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
			{
				id: 'a',
				label: 'A',
				x: 0,
				y: 0,
				width: 400,
				generation: 1,
				hash: 'sha256:test',
				html: PROBE_PAGE,
			},
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

// stampArtboardHtml parses untrusted HTML with innerHTML. Inside the frame FRAME_CSP stops this
// image before the route, so a request can only come from a parse in the live chrome document.
test('parsing an artboard loads nothing from the chrome document', async ({ page }) => {
	const harness = await openHarness(page);
	await postToChrome(
		page,
		canvasUpdated([
			{
				id: 'a',
				label: 'A',
				x: 0,
				y: 0,
				width: 400,
				generation: 1,
				hash: 'sha256:test',
				html: `<!doctype html><body><img src="${REMOTE}/chrome.png" alt=""></body>`,
			},
		]),
	);
	await untilHeightReported(page, 'a');
	expect(harness.abortedRequests()).toBe(0);
});

const STYLED_PAGE = `<!doctype html><html lang="cs"><head>
<style>.probe { color: rgb(1, 2, 3); }</style>
</head><body><p class="probe">probe</p></body></html>`;

// stampArtboardHtml's parse runs under this policy before the nonce is on the artboard's styles.
test('under the chrome CSP, a styled frame and its pin log no violation', async ({ page }) => {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('Content Security Policy')) {
			violations.push(message.text());
		}
	});
	await openHarness(page, { chromeCsp: true });
	await postToChrome(
		page,
		canvasUpdated([
			{
				id: 'a',
				label: 'A',
				x: 0,
				y: 0,
				width: 400,
				generation: 1,
				hash: 'sha256:test',
				html: STYLED_PAGE,
			},
		]),
	);
	await untilHeightReported(page, 'a');
	await postToChrome(page, {
		type: 'comments:updated',
		comments: [
			{
				id: 'c1',
				frameId: 'a',
				selector: '.probe',
				tagName: 'p',
				text: 'probe',
				rect: { x: 0, y: 0, width: 100, height: 20 },
				pin: { x: 0.5, y: 0.5 },
				body: 'Probe',
				isPage: false,
				status: 'open',
				createdAt: '2026-11-09T10:00:00.000Z',
				replies: [],
				stale: true,
				targetMissing: false,
			},
		],
	});
	await expect(page.locator('[data-cd-pin="c1"]')).toBeVisible();
	const frame = await frameOf(page, 'a');

	expect(
		await frame.evaluate(() => getComputedStyle(document.querySelector('.probe')!).color),
	).toBe('rgb(1, 2, 3)');
	expect(await frame.evaluate(() => document.documentElement.lang)).toBe('cs');
	expect(violations).toEqual([]);
});

// The chrome CSP's style-src-attr lets an artboard's style attributes render (Edit-lite writes
// them), whether written in the file or set by its script, while an inline on* handler stays
// blocked by script-src and a url() inside a style attribute stays blocked by FRAME_CSP.
const STYLE_ATTRIBUTE_PAGE = `<!doctype html><html><head>
<script>
	window.__violations = [];
	document.addEventListener('securitypolicyviolation', (event) => {
		window.__violations.push(event.violatedDirective);
	});
</script>
</head><body>
<p class="a" style="color: rgb(4, 5, 6)">a</p>
<p class="b">b</p>
<div class="bg" style="background-image: url(${REMOTE}/bg.png)">bg</div>
<button onclick="window.__inline = true">button</button>
<script>
	document.querySelector('.b').setAttribute('style', 'color: rgb(7, 8, 9)');
	document.querySelector('button').addEventListener('click', () => { window.__listener = true; });
</script>
</body></html>`;

test('under the chrome CSP, style attributes render, inline handlers and style urls stay blocked', async ({
	page,
}) => {
	const styleViolations: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('style-src')) {
			styleViolations.push(message.text());
		}
	});
	const remoteFailures: string[] = [];
	page.on('requestfailed', (request) => {
		if (request.url().startsWith(REMOTE)) {
			remoteFailures.push(request.failure()?.errorText ?? '');
		}
	});
	const harness = await openHarness(page, { chromeCsp: true });
	await postToChrome(
		page,
		canvasUpdated([
			{
				id: 'a',
				label: 'A',
				x: 0,
				y: 0,
				width: 400,
				generation: 1,
				hash: 'sha256:test',
				html: STYLE_ATTRIBUTE_PAGE,
			},
		]),
	);
	await untilHeightReported(page, 'a');
	const frame = await frameOf(page, 'a');

	expect(
		await frame.evaluate(() => [
			getComputedStyle(document.querySelector('.a')!).color,
			getComputedStyle(document.querySelector('.b')!).color,
		]),
	).toEqual(['rgb(4, 5, 6)', 'rgb(7, 8, 9)']);
	// clickAt, not frame.click: its scroll-into-view pans the stage (harness.ts). The stage fits
	// the frame at its zoom, so the button's box is scaled to screen px.
	await clickAt(page, centerOf(await frameElementBox({ page, frameId: 'a', selector: 'button' })));
	await expect
		.poll(() => frame.evaluate(() => (window as { __listener?: boolean }).__listener))
		.toBe(true);
	expect(await frame.evaluate(() => (window as { __inline?: boolean }).__inline)).toBeUndefined();
	// The background url() was attempted and blocked, not merely absent.
	await expect
		.poll(() => frame.evaluate(() => (window as { __violations?: string[] }).__violations ?? []))
		.toContain('img-src');
	const violations = await frame.evaluate(
		() => (window as { __violations?: string[] }).__violations ?? [],
	);
	expect(violations.some((directive) => directive.startsWith('script-src'))).toBe(true);
	expect(violations.filter((directive) => directive.startsWith('style-src'))).toEqual([]);
	expect(harness.abortedRequests()).toBe(0);
	expect(remoteFailures.every((errorText) => errorText === 'csp')).toBe(true);
	expect(styleViolations).toEqual([]);
});
