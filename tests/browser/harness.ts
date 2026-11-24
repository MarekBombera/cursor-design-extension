import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { parseArtboardDocument } from '../../src/disk/commentTarget';
import { sourceTaggedHtml } from '../../src/disk/sourceTags';
import {
	FRAME_HEIGHT_MESSAGE,
	FRAME_PICK_MESSAGE,
	FRAME_READY_MESSAGE,
	type FramePickMessage,
	parseFrameMessage,
} from '../../src/webview/frame/frameMessages';
import type {
	CanvasUpdatedMessage,
	HostMessage,
	PostedCanvasFrame,
} from '../../src/webview/hostMessages';
import type { StageView } from '../../src/webview/stageGeometry';
import { DEFAULT_STYLES, VSCODE_THEME_VARIABLES, type VscodeTheme } from './vscodeHost';

// The chrome's top-level document with a stubbed VS Code host. The page mirrors
// buildArtboardChromeHtml (src/panel/artboardChromeHtml.ts) minus asWebviewUri, and its CSP is
// opt-in. Frames are the real sandboxed blob iframes the chrome creates.

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

const HARNESS_NONCE = 'harness-nonce';

// The policy buildArtboardChromeHtml sets (artboardChromeHtml.test.ts pins the original).
const CHROME_CSP = [
	"default-src 'none'",
	`style-src 'nonce-${HARNESS_NONCE}' ${HARNESS_ORIGIN}`,
	"style-src-attr 'unsafe-inline'",
	`script-src 'nonce-${HARNESS_NONCE}' ${HARNESS_ORIGIN}`,
	'frame-src blob:',
].join('; ');

const WEBVIEW_DIST = join(__dirname, '..', '..', 'dist', 'webview');

const CONTENT_TYPES: Record<string, string> = {
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.map': 'application/json',
};

// With a host theme, the page gets what Cursor gives a webview, in Cursor's order: its default
// styles ahead of chrome.css (after the metas, which must stay in the first 1024 bytes), the
// theme variables on <html>, the theme class on <body>.
const hostHead = (vscodeHost: VscodeTheme | undefined): string =>
	vscodeHost === undefined
		? ''
		: `<style id="_defaultStyles" nonce="${HARNESS_NONCE}">${DEFAULT_STYLES}</style>
	<script nonce="${HARNESS_NONCE}">
		for (const [name, value] of Object.entries(${JSON.stringify(VSCODE_THEME_VARIABLES[vscodeHost])})) {
			document.documentElement.style.setProperty(name, value);
		}
	</script>`;

// The stub runs before the chrome module. The message capture is observation only: it records
// window messages whose source is a frame iframe and never touches propagation.
const harnessPage = ({
	initialState,
	vscodeHost,
}: {
	initialState: unknown;
	vscodeHost: VscodeTheme | undefined;
}): string => `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	${hostHead(vscodeHost)}
	<title>Cursor Design</title>
	<link rel="stylesheet" nonce="${HARNESS_NONCE}" href="/chrome.css">
</head>
<body${vscodeHost === undefined ? '' : ` class="vscode-${vscodeHost}"`}>
	<div id="svelte-root"></div>
	<script nonce="${HARNESS_NONCE}">
		const record = { posted: [], state: ${JSON.stringify(initialState) ?? 'undefined'}, frameMessages: [] };
		window.__cdHarness = record;
		window.acquireVsCodeApi = () => ({
			postMessage: (message) => { record.posted.push(structuredClone(message)); },
			// VS Code serializes webview state as JSON, so a Map, undefined or proxy bug shows here too.
			getState: () => (record.state === undefined ? undefined : JSON.parse(JSON.stringify(record.state))),
			setState: (state) => { record.state = JSON.parse(JSON.stringify(state)); },
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
	<script type="module" nonce="${HARNESS_NONCE}" src="/chrome.js"></script>
</body>
</html>`;

export const posted = (page: Page): Promise<unknown[]> =>
	page.evaluate(() => window.__cdHarness.posted);

// The one wire-shape check the specs share: chrome → host posts and frame → chrome messages.
export const isMessageOfType = (data: unknown, type: string): data is Record<string, unknown> =>
	typeof data === 'object' && data !== null && 'type' in data && data.type === type;

// Chrome → host posts of one type, in order.
export const requestsOf = async (page: Page, type: string): Promise<Record<string, unknown>[]> =>
	(await posted(page)).filter((message): message is Record<string, unknown> =>
		isMessageOfType(message, type),
	);

// The latest post of one type, once there is one.
export const lastRequest = async (page: Page, type: string): Promise<Record<string, unknown>> => {
	await expect.poll(async () => (await requestsOf(page, type)).length).toBeGreaterThan(0);
	return (await requestsOf(page, type)).at(-1) as Record<string, unknown>;
};

// Routes the harness origin, aborts (and counts) every other request, opens the page and waits
// for artboard:ready, like createPanelOutbox. `state` is a whole saved webview state (`reload`
// passes what savedState returned); otherwise `savedView` seeds only the stage view. `vscodeHost`
// emulates Cursor's theme and default styles (vscodeHost.ts); without it the page has neither.
export const openHarness = async (
	page: Page,
	options: {
		savedView?: StageView;
		state?: unknown;
		chromeCsp?: boolean;
		vscodeHost?: VscodeTheme;
	} = {},
): Promise<{ abortedRequests: () => number }> => {
	let aborted = 0;
	const initialState =
		options.state ??
		(options.savedView === undefined
			? undefined
			: { stageView: { ...options.savedView, pageId: 'page-1' } });
	// A second open on the same page (a reload) replaces the first route.
	await page.context().unrouteAll();
	await page.context().route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== HARNESS_ORIGIN) {
			aborted += 1;
			await route.abort();
			return;
		}
		if (url.pathname === '/') {
			await route.fulfill({
				contentType: 'text/html',
				headers: options.chromeCsp === true ? { 'content-security-policy': CHROME_CSP } : {},
				body: harnessPage({ initialState, vscodeHost: options.vscodeHost }),
			});
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

// The saved state as a record ({} when nothing or a non-object was saved).
export const savedRecord = async (page: Page): Promise<Record<string, unknown>> => {
	const state = await savedState(page);
	return typeof state === 'object' && state !== null ? { ...state } : {};
};

// A tab switch: Cursor rebuilds the webview, which starts again from the saved state.
export const reload = async (page: Page): Promise<void> => {
	await openHarness(page, { state: await savedState(page) });
};

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

// Through the chrome's own guard: a captured pick is a wire value.
export const picksOf = async (page: Page, frameId: string): Promise<FramePickMessage[]> =>
	(await messagesOfType({ page, frameId, type: FRAME_PICK_MESSAGE }))
		.map((data) => parseFrameMessage(data))
		.filter((message): message is FramePickMessage => message?.type === FRAME_PICK_MESSAGE);

export const lastPick = async (page: Page, frameId: string): Promise<FramePickMessage> => {
	const pick = (await picksOf(page, frameId)).at(-1);
	if (pick === undefined) {
		throw new Error('No cd:pick was captured.');
	}
	return pick;
};

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

export const readEditFixture = (): string =>
	readFileSync(join(__dirname, '..', '..', 'fixtures', 'edit.html'), 'utf8');

// The edit fixture as one frame, tagged with source numbers as the host does.
export const editFrame = ({ id, label }: { id: string; label: string }): PostedCanvasFrame => {
	const html = readEditFixture();
	return {
		id,
		label,
		x: 0,
		y: 0,
		width: 800,
		generation: 1,
		hash: 'sha256:test',
		canUndo: false,
		canRedo: false,
		html: sourceTaggedHtml({ html, document: parseArtboardDocument(html) }),
	};
};

export const canvasUpdated = (frames: PostedCanvasFrame[]): CanvasUpdatedMessage => ({
	type: 'canvas:updated',
	pageId: 'page-1',
	activeArtboardId: frames[0]?.id ?? '',
	generation: 1,
	cspNonce: HARNESS_NONCE,
	frames,
	pages: [{ id: 'page-1', title: 'Page 1', updatedAt: null }],
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

// An element's screen box inside a frame, from its frame-local rect. The stage layer's CSS scale
// is the frame wrapper's drawn width over the frame's CSS width (1 at 100%).
export const frameElementBox = async ({
	page,
	frameId,
	selector,
}: {
	page: Page;
	frameId: string;
	selector: string;
}): Promise<Box> => {
	const box = await frameBox(page, frameId);
	const element = await (
		await frameOf(page, frameId)
	).evaluate((wanted) => {
		const target = document.querySelector(wanted);
		if (target === null) {
			throw new Error(`No element matches ${wanted}.`);
		}
		const { x, y, width, height } = target.getBoundingClientRect();
		return { x, y, width, height, frameWidth: window.innerWidth };
	}, selector);
	const scale = box.width / element.frameWidth;
	return {
		x: box.x + element.x * scale,
		y: box.y + element.y * scale,
		width: element.width * scale,
		height: element.height * scale,
	};
};

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

export const commentButton = (page: Page): Locator =>
	page.getByRole('button', { name: 'Comment', exact: true });

export const editButton = (page: Page): Locator =>
	page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Edit', exact: true });

export const inspector = (page: Page): Locator => page.locator('[data-cd-inspector]');

export const enterEditMode = async (page: Page): Promise<void> => {
	await clickChrome(editButton(page));
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
};

export const pinOf = (page: Page, id: string): Locator => page.locator(`[data-cd-pin="${id}"]`);

// The toolbar's page button and its Pages menu.
export const pageButton = (page: Page): Locator => page.locator('[data-cd-page-button]');

export const pagesMenu = (page: Page): Locator =>
	page.getByRole('dialog', { name: 'Pages', exact: true });

export const pageRow = (page: Page, id: string): Locator =>
	page.locator(`[data-cd-page-row="${id}"]`);

export const thread = (page: Page): Locator =>
	page.getByRole('dialog', { name: 'Comment', exact: true });

export const threadButton = (page: Page, name: string): Locator =>
	thread(page).getByRole('button', { name, exact: true });

export const openThread = async (page: Page, id: string): Promise<void> => {
	await expect(pinOf(page, id)).toBeVisible();
	await clickChrome(pinOf(page, id));
	await expect(thread(page)).toBeVisible();
	await expect(threadButton(page, 'Close')).toBeFocused();
};

export const popover = (page: Page): Locator =>
	page.getByRole('dialog', { name: 'Add comment', exact: true });

export const panelToggle = (page: Page): Locator => page.getByRole('button', { name: /^Comments/ });

export const panel = (page: Page): Locator =>
	page.getByRole('complementary', { name: 'Comments', exact: true });

export const panelItem = (page: Page, id: string): Locator =>
	panel(page).locator(`[data-cd-comment-item="${id}"]`);

export const panelButton = (page: Page, id: string, name: string): Locator =>
	panelItem(page, id).getByRole('button', { name, exact: true });

export const copyOpenButton = (page: Page): Locator => panel(page).locator('[data-cd-copy-open]');

// The toolbar's zoom <select>, and its shown option (which always names the current zoom).
export const zoomSelect = (page: Page): Locator => page.getByRole('combobox', { name: 'Zoom' });

export const zoomReadout = (page: Page): Locator => zoomSelect(page).locator('option:checked');

// The target chip inside the open Add comment popover.
export const popoverTarget = (page: Page): Locator =>
	page.locator('[data-cd-comment-popover] [data-cd-comment-target] .element');

export const expectBoxNear = (actual: Box, expected: Box): void => {
	expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(1);
};
