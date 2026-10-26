import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { FRAME_HEIGHT_MESSAGE, FRAME_READY_MESSAGE } from '../../src/webview/frame/frameMessages';
import type {
	CanvasUpdatedMessage,
	HostMessage,
	PostedCanvasFrame,
} from '../../src/webview/hostMessages';
import type { StageView } from '../../src/webview/stageGeometry';

// The chrome's top-level document with a stubbed VS Code host. The page mirrors
// buildArtboardChromeHtml (src/panel/artboardChromeHtml.ts) minus the CSP, nonces and
// asWebviewUri. Frames are the real sandboxed blob iframes the chrome creates.

type FrameMessageRecord = { frameId: string; data: unknown };

type HarnessRecord = {
	posted: unknown[];
	state: unknown;
	frameMessages: FrameMessageRecord[];
};

declare global {
	interface Window {
		__cdHarness: HarnessRecord;
	}
}

// HTTPS so the page is a secure context, like the webview. `.test` is a reserved TLD.
const HARNESS_ORIGIN = 'https://cd-harness.test';

const WEBVIEW_DIST = join(__dirname, '..', '..', 'dist', 'webview');

const CONTENT_TYPES: Record<string, string> = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.map': 'application/json',
};

// The stub runs before the chrome module. The message capture is observation only: it records
// window messages whose source is a frame iframe and never touches propagation.
const harnessPage = (initialState: unknown): string => `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Cursor Design</title>
	<link rel="stylesheet" href="/chrome.css">
</head>
<body>
	<div id="svelte-root"></div>
	<script>
		const record = { posted: [], state: ${JSON.stringify(initialState) ?? 'undefined'}, frameMessages: [] };
		window.__cdHarness = record;
		window.acquireVsCodeApi = () => ({
			postMessage: (message) => { record.posted.push(structuredClone(message)); },
			getState: () => structuredClone(record.state),
			setState: (state) => { record.state = structuredClone(state); },
		});
		window.addEventListener('message', (event) => {
			for (const wrapper of document.querySelectorAll('[data-cd-frame-id]')) {
				const iframe = wrapper.querySelector('iframe');
				if (iframe !== null && iframe.contentWindow === event.source) {
					record.frameMessages.push({ frameId: wrapper.getAttribute('data-cd-frame-id'), data: event.data });
					return;
				}
			}
		});
	</script>
	<script type="module" src="/chrome.js"></script>
</body>
</html>`;

export const posted = (page: Page): Promise<unknown[]> =>
	page.evaluate(() => window.__cdHarness.posted);

// The one wire-shape check the specs share: chrome → host posts and frame → chrome messages.
export const isMessageOfType = (data: unknown, type: string): data is Record<string, unknown> =>
	typeof data === 'object' && data !== null && 'type' in data && data.type === type;

// Routes the harness origin, aborts (and counts) every other request, opens the page and waits
// for artboard:ready, like createPanelOutbox.
export const openHarness = async (
	page: Page,
	options: { savedView?: StageView } = {},
): Promise<{ abortedRequests: () => number }> => {
	let aborted = 0;
	const initialState =
		options.savedView === undefined ? undefined : { stageView: options.savedView };
	await page.context().route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== HARNESS_ORIGIN) {
			aborted += 1;
			await route.abort();
			return;
		}
		if (url.pathname === '/') {
			await route.fulfill({ contentType: 'text/html', body: harnessPage(initialState) });
			return;
		}
		const fileName = url.pathname.slice(1);
		const contentType = CONTENT_TYPES[extname(fileName)];
		if (fileName.includes('/') || fileName.includes('..') || contentType === undefined) {
			await route.fulfill({ status: 404 });
			return;
		}
		try {
			await route.fulfill({ contentType, body: readFileSync(join(WEBVIEW_DIST, fileName)) });
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
				throw error;
			}
			await route.fulfill({ status: 404 });
		}
	});
	await page.goto(`${HARNESS_ORIGIN}/`);
	await expect
		.poll(async () =>
			(await posted(page)).some((message) => isMessageOfType(message, 'artboard:ready')),
		)
		.toBe(true);
	return { abortedRequests: () => aborted };
};

// routeMessage sees a non-frame source with the harness origin, so this is a host message.
// Resolves once the chrome has handled it: listeners on one target run in registration order, so
// this one, added after the chrome's, runs after it.
export const postToChrome = async (page: Page, message: HostMessage): Promise<void> => {
	await page.evaluate(
		(hostMessage) =>
			new Promise<void>((resolve) => {
				const handled = (event: MessageEvent): void => {
					if (event.source === window) {
						window.removeEventListener('message', handled);
						resolve();
					}
				};
				window.addEventListener('message', handled);
				window.postMessage(hostMessage, '*');
			}),
		message,
	);
};

export const savedState = (page: Page): Promise<unknown> =>
	page.evaluate(() => window.__cdHarness.state);

// Raw captured frame → chrome messages of one type, in order (not run through parseFrameMessage).
export const messagesOfType = async ({
	page,
	frameId,
	type,
}: {
	page: Page;
	frameId: string;
	type: string;
}): Promise<Record<string, unknown>[]> =>
	(
		await page.evaluate(
			(wanted) =>
				window.__cdHarness.frameMessages
					.filter((entry: FrameMessageRecord) => entry.frameId === wanted)
					.map((entry: FrameMessageRecord) => entry.data),
			frameId,
		)
	).filter((data): data is Record<string, unknown> => isMessageOfType(data, type));

// A frame has laid out once it reports its height.
export const untilHeightReported = async (page: Page, frameId: string): Promise<void> => {
	await expect
		.poll(async () => (await messagesOfType({ page, frameId, type: FRAME_HEIGHT_MESSAGE })).length)
		.toBeGreaterThan(0);
};

// One cd:ready per document the frame loaded.
export const loadsOf = async (page: Page, frameId: string): Promise<number> =>
	(await messagesOfType({ page, frameId, type: FRAME_READY_MESSAGE })).length;

export const frameOf = async (page: Page, frameId: string): Promise<Frame> => {
	const handle = await page.locator(`[data-cd-frame-id="${frameId}"] iframe`).elementHandle();
	const frame = await handle?.contentFrame();
	if (frame === undefined || frame === null) {
		throw new Error(`Frame "${frameId}" has no iframe document.`);
	}
	return frame;
};

export const readPickingFixture = (): string =>
	readFileSync(join(__dirname, '..', '..', 'fixtures', 'picking.html'), 'utf8');

export const canvasUpdated = (frames: PostedCanvasFrame[]): CanvasUpdatedMessage => ({
	type: 'canvas:updated',
	activeArtboardId: frames[0]?.id ?? '',
	generation: 1,
	cspNonce: 'harness-nonce',
	frames,
});

export type Box = { x: number; y: number; width: number; height: number };

export type Point = { x: number; y: number };

export const boxOf = async (locator: Locator): Promise<Box> => {
	const box = await locator.boundingBox();
	if (box === null) {
		throw new Error('The element has no box.');
	}
	return box;
};

export const frameBox = (page: Page, frameId: string): Promise<Box> =>
	boxOf(page.locator(`[data-cd-frame-id="${frameId}"]`));

export const stageBox = (page: Page): Promise<Box> => boxOf(page.locator('.viewport'));

export const centerOf = (box: Box): Point => ({
	x: box.x + box.width / 2,
	y: box.y + box.height / 2,
});

// Clicks never use locator.click(): its scroll-into-view would scroll the root scroll sink and
// pan the stage.
export const clickAt = async (page: Page, point: Point): Promise<void> => {
	await page.mouse.move(point.x, point.y);
	await page.mouse.click(point.x, point.y);
};

export const clickChrome = async (locator: Locator): Promise<void> => {
	await clickAt(locator.page(), centerOf(await boxOf(locator)));
};

// Lets the chrome apply a message (Svelte flushes in a microtask) before asserting an absence.
export const nextAnimationFrame = (page: Page): Promise<void> =>
	page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
