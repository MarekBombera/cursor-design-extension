import { expect, type Page, test } from '@playwright/test';

import { MIN_FRAME_WIDTH } from '../../src/disk/layout';
import { FRAME_WHEEL_MESSAGE } from '../../src/webview/frame/frameMessages';
import type { PostedCanvasFrame } from '../../src/webview/hostMessages';
import { parseSavedStageView } from '../../src/webview/hostMessages';
import { NUDGE_STEP, type StageView } from '../../src/webview/stageGeometry';
import {
	type Box,
	boxOf,
	canvasUpdated,
	centerOf,
	clickChrome,
	frameBox,
	isMessageOfType,
	loadsOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	type Point,
	posted,
	postToChrome,
	savedState,
	stageBox,
	untilHeightReported,
} from './harness';

// Frame A: a 1200 px tall body that never scrolls internally. Frame B: a short page.
const TALL_PAGE = `<!doctype html><html><head><style>body{margin:0;height:1200px;background:#eef}</style></head><body><p>Frame A</p></body></html>`;
const SHORT_PAGE = `<!doctype html><html><head><style>body{margin:0}</style></head><body><p>Frame B</p></body></html>`;

const frameA = (overrides: Partial<PostedCanvasFrame> = {}): PostedCanvasFrame => ({
	id: 'a',
	label: 'Frame A',
	x: 0,
	y: 0,
	width: 400,
	generation: 1,
	html: TALL_PAGE,
	...overrides,
});

const frameB = (overrides: Partial<PostedCanvasFrame> = {}): PostedCanvasFrame => ({
	id: 'b',
	label: 'Frame B',
	x: 1000,
	y: 0,
	width: 400,
	generation: 1,
	html: SHORT_PAGE,
	...overrides,
});

test('smoke: secure context, ready handshake, two frames load, network is blocked', async ({
	page,
}) => {
	const harness = await openHarness(page);
	expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
	expect((await posted(page))[0]).toEqual({ type: 'artboard:ready' });

	await postToChrome(page, canvasUpdated([frameA(), frameB()]));
	await expect(page.locator('[data-cd-frame-id="a"] iframe')).toHaveCount(1);
	await expect(page.locator('[data-cd-frame-id="b"] iframe')).toHaveCount(1);
	await expect.poll(() => loadsOf(page, 'a')).toBeGreaterThanOrEqual(1);
	await expect.poll(() => loadsOf(page, 'b')).toBeGreaterThanOrEqual(1);
	await expect(page.getByText('No artboard yet.')).toBeHidden();
	expect(harness.abortedRequests()).toBe(0);

	const probe = await page.evaluate(() =>
		fetch('https://example.invalid/').then(
			() => 'ok',
			() => 'blocked',
		),
	);
	expect(probe).toBe('blocked');
	expect(harness.abortedRequests()).toBe(1);
});

const SEEDED_VIEW: StageView = { x: 0, y: 0, zoom: 1 };

// ponytail: a fixed quiet window, not an event (a reload loop has no "done" signal). Raise it if
// it flakes; never remove it.
const QUIET_WINDOW_MS = 1000;

const savedView = async (page: Page): Promise<StageView | undefined> => {
	const state = await savedState(page);
	return parseSavedStageView(
		typeof state === 'object' && state !== null && 'stageView' in state
			? state.stageView
			: undefined,
	);
};

// Seeds the view, posts both frames, waits for both height reports, and checks the seeded view
// is what the stage shows. Returns the stage viewport's offset in the page.
const openSeededStage = async (page: Page): Promise<Point> => {
	await openHarness(page, { savedView: SEEDED_VIEW });
	await postToChrome(page, canvasUpdated([frameA(), frameB()]));
	await untilHeightReported(page, 'a');
	await untilHeightReported(page, 'b');
	const stage = await stageBox(page);
	await expect(page.locator('.bar .readout')).toHaveText('100%');
	const box = await frameBox(page, 'a');
	expect(box.x).toBeCloseTo(stage.x, 0);
	expect(box.y).toBeCloseTo(stage.y, 0);
	return { x: stage.x, y: stage.y };
};

const quietWindow = (page: Page): Promise<void> => page.waitForTimeout(QUIET_WINDOW_MS);

test('frames load once and reload only when their html changes (F-51)', async ({ page }) => {
	await openSeededStage(page);
	await quietWindow(page);
	expect(await loadsOf(page, 'a')).toBe(1);
	expect(await loadsOf(page, 'b')).toBe(1);

	await postToChrome(page, canvasUpdated([frameA(), frameB()]));
	await quietWindow(page);
	expect(await loadsOf(page, 'a')).toBe(1);
	expect(await loadsOf(page, 'b')).toBe(1);

	const edited = `${TALL_PAGE}<!-- edited -->`;
	await postToChrome(page, canvasUpdated([frameA({ html: edited, generation: 2 }), frameB()]));
	await quietWindow(page);
	expect(await loadsOf(page, 'a')).toBe(2);
	expect(await loadsOf(page, 'b')).toBe(1);

	await postToChrome(
		page,
		canvasUpdated([
			frameA({ html: edited, generation: 2, x: 40, label: 'Renamed', width: 480 }),
			frameB(),
		]),
	);
	await quietWindow(page);
	expect(await loadsOf(page, 'a')).toBe(2);
	expect(await loadsOf(page, 'b')).toBe(1);
});

test('a wheel over a frame pans like a wheel over the empty stage', async ({ page }) => {
	const stage = await openSeededStage(page);

	const panBy = async (pointer: Point): Promise<number> => {
		const before = await frameBox(page, 'a');
		await page.mouse.move(pointer.x, pointer.y);
		await page.mouse.wheel(0, 120);
		await expect.poll(async () => (await frameBox(page, 'a')).y).not.toBe(before.y);
		return (await frameBox(page, 'a')).y - before.y;
	};

	const overFrame = await panBy({ x: stage.x + 200, y: stage.y + 300 });
	expect(
		(await messagesOfType({ page, frameId: 'a', type: FRAME_WHEEL_MESSAGE })).length,
	).toBeGreaterThan(0);
	// Between frame A (0..400) and frame B (1000..1400): empty stage inside the 1280 px viewport.
	const overEmptyStage = await panBy({ x: stage.x + 700, y: stage.y + 300 });
	expect(Math.abs(overFrame - overEmptyStage)).toBeLessThanOrEqual(1);
	expect(overFrame).toBeLessThan(0);
});

// The point under the cursor, as a fraction of `frameId`'s box, stays under the cursor.
const zoomKeepsPointUnderCursor = async ({
	page,
	frameId,
	pointer,
}: {
	page: Page;
	frameId: string;
	pointer: Point;
}): Promise<void> => {
	const before = await frameBox(page, frameId);
	const fractionX = (pointer.x - before.x) / before.width;
	const fractionY = (pointer.y - before.y) / before.height;
	await page.mouse.move(pointer.x, pointer.y);
	await page.keyboard.down('Control');
	try {
		await page.mouse.wheel(0, -120);
	} finally {
		await page.keyboard.up('Control');
	}
	await expect(page.locator('.bar .readout')).not.toHaveText('100%');
	await expect.poll(async () => (await savedView(page))?.zoom).not.toBe(1);
	const after = await frameBox(page, frameId);
	expect(Math.abs(after.x + fractionX * after.width - pointer.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(after.y + fractionY * after.height - pointer.y)).toBeLessThanOrEqual(1);
};

// Frame B sits at stage x 1000, and a pan first moves the view off identity, so its frame-local
// wheel point differs from the viewport point: the anchor must add the frame offset and map
// through the view (F-62).
test('ctrl+wheel over a frame off the stage origin zooms at the cursor', async ({ page }) => {
	const stage = await openSeededStage(page);
	const panned = await frameBox(page, 'b');
	await page.mouse.move(stage.x + 700, stage.y + 300);
	await page.mouse.wheel(40, -60);
	await expect.poll(async () => (await frameBox(page, 'b')).y).toBeCloseTo(panned.y + 60, 0);
	expect((await frameBox(page, 'b')).x).toBeCloseTo(panned.x - 40, 0);
	const box = await frameBox(page, 'b');
	await zoomKeepsPointUnderCursor({
		page,
		frameId: 'b',
		pointer: { x: box.x + 140, y: box.y + box.height / 2 },
	});
	// The frame path, not the chrome's own wheel listener.
	expect(
		(await messagesOfType({ page, frameId: 'b', type: FRAME_WHEEL_MESSAGE })).length,
	).toBeGreaterThan(0);
});

test('ctrl+wheel over the empty stage zooms at the cursor', async ({ page }) => {
	const stage = await openSeededStage(page);
	await zoomKeepsPointUnderCursor({
		page,
		frameId: 'a',
		pointer: { x: stage.x + 700, y: stage.y + 300 },
	});
});

// mouse.wheel events are hit-tested one by one, so they pass with the sink removed. A synthesized
// precise-scroll gesture latches to the out-of-process frame it starts in, like a trackpad, and
// its remainder reaches the chrome only as root scroll. CDP distance sign is the reverse of wheel
// delta: -600 moves the content left.
test('a trackpad pan keeps panning after the pointer leaves the frame (F-52)', async ({ page }) => {
	await openSeededStage(page);
	const before = await frameBox(page, 'a');
	const viewBefore = await savedView(page);
	const session = await page.context().newCDPSession(page);
	await session.send('Input.synthesizeScrollGesture', {
		x: before.x + before.width - 50,
		y: before.y + before.height / 2,
		xDistance: -600,
		yDistance: 0,
		speed: 800,
		gestureSourceType: 'mouse',
	});
	await expect
		.poll(async () => (viewBefore?.x ?? 0) - ((await savedView(page))?.x ?? 0))
		.toBeGreaterThanOrEqual(590);
	expect(before.x - (await frameBox(page, 'a')).x).toBeGreaterThanOrEqual(590);
});

const isInside = (box: Box, stage: Box): boolean =>
	box.x >= stage.x - 1 &&
	box.y >= stage.y - 1 &&
	stage.x + stage.width + 1 >= box.x + box.width &&
	stage.y + stage.height + 1 >= box.y + box.height;

test('Fit all brings every frame into the viewport', async ({ page }) => {
	await openSeededStage(page);
	const stage = await stageBox(page);
	// At 100% frame A (1200 px tall) and frame B (stage x 1000..1400) leave the viewport.
	expect(isInside(await frameBox(page, 'b'), stage)).toBe(false);
	await clickChrome(page.getByRole('button', { name: 'Fit all' }));
	await expect.poll(async () => isInside(await frameBox(page, 'a'), stage)).toBe(true);
	expect(isInside(await frameBox(page, 'b'), stage)).toBe(true);
	expect(
		Number.parseInt((await page.locator('.bar .readout').textContent()) ?? '', 10),
	).toBeLessThanOrEqual(100);
});

const choosePreset = async (page: Page, zoom: number): Promise<void> => {
	await page.getByRole('combobox', { name: 'Zoom preset' }).selectOption(String(zoom));
	await expect.poll(async () => (await savedView(page))?.zoom).toBe(zoom);
};

test('a zoom preset sets the zoom about the viewport centre', async ({ page }) => {
	await openSeededStage(page);
	const stage = await stageBox(page);
	const centre = { x: stage.width / 2, y: stage.height / 2 };
	// The stage point under the viewport centre at the seeded view (x 0, y 0, zoom 1).
	const stagePoint = { x: centre.x, y: centre.y };
	await choosePreset(page, 1.5);
	await expect(page.locator('.bar .readout')).toHaveText('150%');
	const view = await savedView(page);
	expect(Math.abs((view?.x ?? 0) + stagePoint.x * 1.5 - centre.x)).toBeLessThanOrEqual(1);
	expect(Math.abs((view?.y ?? 0) + stagePoint.y * 1.5 - centre.y)).toBeLessThanOrEqual(1);
	// The drawn layer follows the saved view.
	expect((await frameBox(page, 'a')).x).toBeCloseTo(stage.x + (view?.x ?? 0), 0);
});

// Gestures land on whole stage px after a 3 px screen threshold (stageGeometry.ts); at zoom 1 a
// stage delta equals the screen delta.

const framePlaces = async (page: Page): Promise<unknown[]> =>
	(await posted(page)).filter((message) => isMessageOfType(message, 'frame:place'));

const labelOf = (frameId: string): string => `[data-cd-frame-label="${frameId}"]`;

// The frame's box relative to the stage viewport, which a banner above it pushes down.
const offsetInStage = async (page: Page, frameId: string): Promise<Point> => {
	const stage = await stageBox(page);
	const box = await frameBox(page, frameId);
	return { x: Math.round(box.x - stage.x), y: Math.round(box.y - stage.y) };
};

// The labels sit 24 px above the frames, so at the seeded view they are clipped by the stage top.
// A wheel over the empty stage pans the content down first.
const openDraggableStage = async (page: Page): Promise<Point> => {
	const stage = await openSeededStage(page);
	await page.mouse.move(stage.x + 700, stage.y + 300);
	await page.mouse.wheel(0, -60);
	await expect.poll(async () => (await frameBox(page, 'a')).y).toBeCloseTo(stage.y + 60, 0);
	return stage;
};

const startLabelDrag = async (page: Page, frameId = 'a'): Promise<void> => {
	const start = centerOf(await boxOf(page.locator(labelOf(frameId))));
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 53, start.y + 21, { steps: 10 });
};

test('dragging a label posts one whole-pixel frame:place; after the host answer the next drag posts again', async ({
	page,
}) => {
	const stage = await openDraggableStage(page);
	await startLabelDrag(page);
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	expect((await framePlaces(page))[0]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: 53,
		y: 21,
		width: 400,
		base: { x: 0, y: 0, width: 400 },
	});
	expect(await loadsOf(page, 'a')).toBe(1);

	await postToChrome(page, canvasUpdated([frameA({ x: 53, y: 21 }), frameB()]));
	await quietWindow(page);
	const box = await frameBox(page, 'a');
	expect(box.x).toBeCloseTo(stage.x + 53, 0);
	expect(box.y).toBeCloseTo(stage.y + 60 + 21, 0);
	expect(await loadsOf(page, 'a')).toBe(1);
	expect(await framePlaces(page)).toHaveLength(1);

	// The answer settled the gesture, so a second drag starts from the new disk placement (F-66).
	await startLabelDrag(page);
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(2);
	expect((await framePlaces(page))[1]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: 106,
		y: 42,
		width: 400,
		base: { x: 53, y: 21, width: 400 },
	});
});

test('resizing below the minimum clamps the width and keeps the position', async ({ page }) => {
	const stage = await openSeededStage(page);
	const handle = centerOf(await boxOf(page.locator('[data-cd-frame-resize="a"]')));
	await page.mouse.move(handle.x, stage.y + 300);
	await page.mouse.down();
	// More than A's width left of its right edge: the raw width is below MIN_FRAME_WIDTH.
	await page.mouse.move(1, stage.y + 300, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	expect((await framePlaces(page))[0]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: 0,
		y: 0,
		width: MIN_FRAME_WIDTH,
		base: { x: 0, y: 0, width: 400 },
	});
});

// At zoom 1 a constant view offset cancels out, so this pins the view the gesture maps through
// (F-67): 53 screen px at 50% are 106 stage px.
test('drag and resize at 50% zoom move by stage px, not screen px', async ({ page }) => {
	await openSeededStage(page);
	const zoom = 0.5;
	await choosePreset(page, zoom);
	await startLabelDrag(page);
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	const moved = { x: Math.round(53 / zoom), y: Math.round(21 / zoom), width: 400 };
	expect((await framePlaces(page))[0]).toEqual({
		type: 'frame:place',
		id: 'a',
		...moved,
		base: { x: 0, y: 0, width: 400 },
	});

	await postToChrome(page, canvasUpdated([frameA({ x: moved.x, y: moved.y }), frameB()]));
	const handle = centerOf(await boxOf(page.locator('[data-cd-frame-resize="a"]')));
	await page.mouse.move(handle.x, handle.y);
	await page.mouse.down();
	await page.mouse.move(handle.x + 100, handle.y, { steps: 10 });
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(2);
	expect((await framePlaces(page))[1]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: moved.x,
		y: moved.y,
		width: 400 + Math.round(100 / zoom),
		base: moved,
	});
});

test('Escape mid-drag returns the frame and posts nothing on release', async ({ page }) => {
	await openDraggableStage(page);
	const startBox = await frameBox(page, 'a');
	await startLabelDrag(page);
	await expect.poll(async () => (await frameBox(page, 'a')).x).toBeCloseTo(startBox.x + 53, 0);
	await page.keyboard.press('Escape');
	await expect.poll(() => frameBox(page, 'a')).toEqual(startBox);
	await page.mouse.up();
	// A frame:place would be posted synchronously in the pointerup handler.
	await nextAnimationFrame(page);
	expect(await framePlaces(page)).toHaveLength(0);
});

test('an Agent placement mid-drag wins and the release posts nothing', async ({ page }) => {
	const stage = await openDraggableStage(page);
	await startLabelDrag(page);
	// As after an MCP place_frame: canvas.json changed, the artboard (generation) did not.
	await postToChrome(page, canvasUpdated([frameA({ x: 200 }), frameB()]));
	await expect.poll(async () => (await frameBox(page, 'a')).x).toBeCloseTo(stage.x + 200, 0);
	await page.mouse.move(stage.x + 300, stage.y + 10, { steps: 5 });
	await page.mouse.up();
	await nextAnimationFrame(page);
	expect(await framePlaces(page)).toHaveLength(0);
	expect((await frameBox(page, 'a')).x).toBeCloseTo(stage.x + 200, 0);
});

// A failed write: the host answers with canvas:updated at base, then artboard:error (F-64).
test('a refused frame:place returns the frame, shows the error, and the next drag posts', async ({
	page,
}) => {
	await openDraggableStage(page);
	await startLabelDrag(page);
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	await postToChrome(page, canvasUpdated([frameA(), frameB()]));
	await postToChrome(page, { type: 'artboard:error', message: 'Could not move frame "a".' });
	await expect(page.getByRole('alert')).toHaveText('Could not move frame "a".');
	await expect.poll(() => offsetInStage(page, 'a')).toEqual({ x: 0, y: 60 });

	await startLabelDrag(page);
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(2);
	expect((await framePlaces(page))[1]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: 53,
		y: 21,
		width: 400,
		base: { x: 0, y: 0, width: 400 },
	});
});

// The host re-posts a standing error on every flush; only a committing gesture ends on it.
test('a standing artboard:error mid-drag keeps the drag preview', async ({ page }) => {
	await openDraggableStage(page);
	await startLabelDrag(page);
	await expect.poll(() => offsetInStage(page, 'a')).toEqual({ x: 53, y: 81 });
	await postToChrome(page, { type: 'artboard:error', message: 'Standing error.' });
	await expect(page.getByRole('alert')).toHaveText('Standing error.');
	expect((await offsetInStage(page, 'a')).x).toBe(53);
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	expect((await framePlaces(page))[0]).toMatchObject({
		id: 'a',
		x: 53,
		base: { x: 0, y: 0, width: 400 },
	});
});

test('ui:status shows the MCP banner and the stale-handoff marker', async ({ page }) => {
	await openSeededStage(page);
	const mcpBanner = page.getByText('MCP unavailable. Artboard still loads from disk.');
	const staleMarker = page.getByText('Handoff out of date. Re-export.');
	await expect(mcpBanner).toBeHidden();
	await expect(staleMarker).toBeHidden();
	await postToChrome(page, { type: 'ui:status', mcpAvailable: false, handoffStale: false });
	await expect(mcpBanner).toBeVisible();
	await expect(staleMarker).toBeHidden();
	await postToChrome(page, { type: 'ui:status', mcpAvailable: true, handoffStale: true });
	await expect(staleMarker).toBeVisible();
	await expect(mcpBanner).toBeHidden();
});

// Held arrows: the first keydown starts the nudge, Playwright sends the next two as auto-repeat,
// and one release commits.
test('arrow keys on a focused label nudge and commit once on release', async ({ page }) => {
	await openDraggableStage(page);
	await page.locator(labelOf('a')).focus();
	for (let press = 0; press < 3; press += 1) {
		await page.keyboard.down('ArrowRight');
	}
	await page.keyboard.up('ArrowRight');
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	expect((await framePlaces(page))[0]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: 3 * NUDGE_STEP,
		y: 0,
		width: 400,
		base: { x: 0, y: 0, width: 400 },
	});

	// Two arrows held: releasing one keeps the nudge open.
	await postToChrome(page, canvasUpdated([frameA({ x: 3 * NUDGE_STEP }), frameB()]));
	await page.keyboard.down('ArrowRight');
	await page.keyboard.down('ArrowDown');
	await page.keyboard.up('ArrowDown');
	await nextAnimationFrame(page);
	expect(await framePlaces(page)).toHaveLength(1);
	await page.keyboard.up('ArrowRight');
	await expect.poll(() => framePlaces(page)).toHaveLength(2);
	expect((await framePlaces(page))[1]).toEqual({
		type: 'frame:place',
		id: 'a',
		x: 4 * NUDGE_STEP,
		y: NUDGE_STEP,
		width: 400,
		base: { x: 3 * NUDGE_STEP, y: 0, width: 400 },
	});
});

test('Escape mid-nudge reverts and the release posts nothing', async ({ page }) => {
	await openDraggableStage(page);
	await page.locator(labelOf('a')).focus();
	await nextAnimationFrame(page);
	const startBox = await frameBox(page, 'a');
	await page.keyboard.down('ArrowRight');
	await expect
		.poll(async () => (await frameBox(page, 'a')).x)
		.toBeCloseTo(startBox.x + NUDGE_STEP, 0);
	await page.keyboard.press('Escape');
	await expect.poll(() => frameBox(page, 'a')).toEqual(startBox);
	await page.keyboard.up('ArrowRight');
	await nextAnimationFrame(page);
	expect(await framePlaces(page)).toHaveLength(0);
});

// The removed label or handle never sees its own lostpointercapture, so without the teardown in
// Stage every later drag stayed dead until Escape (F-26).
const expectNextDragOnB = async (page: Page): Promise<void> => {
	await expect(page.locator('[data-cd-frame-id="a"]')).toHaveCount(0);
	await page.mouse.up();
	await expect(page.locator('.viewport')).not.toHaveClass(/frame-gesture-/);
	await startLabelDrag(page, 'b');
	await page.mouse.up();
	await expect.poll(() => framePlaces(page)).toHaveLength(1);
	expect((await framePlaces(page))[0]).toMatchObject({
		id: 'b',
		x: 1053,
		y: 21,
		base: { x: 1000, y: 0, width: 400 },
	});
};

test('a frame removed mid-drag does not block the next drag', async ({ page }) => {
	await openDraggableStage(page);
	await startLabelDrag(page);
	await postToChrome(page, canvasUpdated([frameB()]));
	await expectNextDragOnB(page);
});

test('a frame removed mid-resize does not block the next drag', async ({ page }) => {
	const stage = await openDraggableStage(page);
	const handle = centerOf(await boxOf(page.locator('[data-cd-frame-resize="a"]')));
	await page.mouse.move(handle.x, stage.y + 300);
	await page.mouse.down();
	await page.mouse.move(handle.x + 40, stage.y + 300, { steps: 5 });
	await postToChrome(page, canvasUpdated([frameB()]));
	await expectNextDragOnB(page);
});
