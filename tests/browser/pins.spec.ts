import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Page, test } from '@playwright/test';

import { FRAME_ANCHOR_RECTS_MESSAGE } from '../../src/webview/frame/frameMessages';
import type { PostedCanvasFrame, PostedComment } from '../../src/webview/hostMessages';
import { ICONS } from '../../src/webview/ui/icons';
import {
	type Box,
	boxOf,
	canvasUpdated,
	centerOf,
	clickAt,
	clickChrome,
	commentButton,
	frameBox,
	frameElementBox,
	frameOf,
	loadsOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	openThread,
	pinOf,
	popoverTarget,
	type Point,
	postToChrome,
	stageBox,
	thread,
	untilHeightReported,
	zoomReadout,
	zoomSelect,
} from './harness';

const PINS_HTML = readFileSync(join(__dirname, '..', '..', 'fixtures', 'pins.html'), 'utf8');

const FRAME: PostedCanvasFrame = {
	id: 'a',
	label: 'Pins',
	x: 0,
	y: 0,
	width: 600,
	generation: 1,
	hash: 'sha256:test',
	canUndo: false,
	canRedo: false,
	html: PINS_HTML,
};

const comment = (overrides: Partial<PostedComment> & { id: string }): PostedComment => ({
	frameId: 'a',
	selector: '#title',
	tagName: 'h1',
	text: 'Pins',
	rect: { x: 24, y: 24, width: 552, height: 29 },
	pin: { x: 0.25, y: 0.5 },
	body: 'Title',
	isPage: false,
	status: 'open',
	createdAt: '2026-10-27T10:00:00.000Z',
	replies: [],
	stale: false,
	targetMissing: false,
	...overrides,
});

const TITLE = comment({ id: 'c-title' });
const IN_BOX = comment({
	id: 'c-box',
	selector: '#in-box',
	tagName: 'p',
	text: 'In the box',
	pin: { x: 0.5, y: 0.5 },
	body: 'In the box',
});
const MOVER = comment({
	id: 'c-mover',
	selector: '#mover',
	tagName: 'div',
	text: '',
	body: 'Mover',
});
const SLIDER = comment({
	id: 'c-slider',
	selector: '#slider',
	tagName: 'div',
	text: '',
	body: 'Slider',
});
const DOOMED = comment({
	id: 'c-doomed',
	selector: '#doomed',
	tagName: 'div',
	text: 'Doomed',
	// The pick-time rect the missing pin falls back to: a corner no live pin shares (the mover's
	// pin tip is at 24,200, and coinciding tips line up side by side).
	rect: { x: 104, y: 200, width: 80, height: 24 },
	pin: { x: 0.5, y: 0.5 },
	body: 'Doomed',
});
const PAGE = comment({
	id: 'c-page',
	selector: 'body',
	tagName: 'body',
	text: '',
	rect: null,
	pin: { x: 0.5, y: 0.25 },
	isPage: true,
	body: 'Whole page',
});

const ALL = [TITLE, IN_BOX, MOVER, SLIDER, DOOMED, PAGE];

// A pin is a teardrop whose tip, the bottom-right corner of its box, sits on the comment's point.
const tipOf = (box: Box): Point => ({ x: box.x + box.width, y: box.y + box.height });

const pinTip = async (page: Page, id: string): Promise<Point> =>
	tipOf(await boxOf(pinOf(page, id)));

const withinOnePx = (actual: Point, expected: Point): boolean =>
	Math.abs(actual.x - expected.x) <= 1 && Math.abs(actual.y - expected.y) <= 1;

// "On its element": the pin's tip is within 1px of the element's top-left corner, so the body
// sits in the margin off its words. Polled: the frame answers asynchronously.
const expectPinOn = async ({
	page,
	id,
	selector,
}: {
	page: Page;
	id: string;
	selector: string;
}): Promise<void> => {
	await expect
		.poll(async () => {
			const element = await frameElementBox({ page, frameId: 'a', selector });
			return withinOnePx(await pinTip(page, id), { x: element.x, y: element.y });
		})
		.toBe(true);
};

const anchorAnswers = async (page: Page): Promise<number> =>
	(await messagesOfType({ page, frameId: 'a', type: FRAME_ANCHOR_RECTS_MESSAGE })).length;

const openPinStage = async (page: Page, comments: PostedComment[] = ALL): Promise<Box> => {
	await openHarness(page, { savedView: { x: 40, y: 60, zoom: 1 } });
	await postToChrome(page, canvasUpdated([FRAME]));
	await untilHeightReported(page, 'a');
	await postToChrome(page, { type: 'comments:updated', comments });
	await expect.poll(() => anchorAnswers(page)).toBeGreaterThan(0);
	return stageBox(page);
};

const inFrame = async (page: Page, script: string): Promise<void> => {
	await (await frameOf(page, 'a')).evaluate(script);
};

test('a pin sits on its element, and a page pin at its fraction of the frame', async ({ page }) => {
	await openPinStage(page);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await expectPinOn({ page, id: MOVER.id, selector: '#mover' });
	const frame = await frameBox(page, 'a');
	expect(
		withinOnePx(await pinTip(page, PAGE.id), {
			x: frame.x + PAGE.pin.x * frame.width,
			y: frame.y + PAGE.pin.y * frame.height,
		}),
	).toBe(true);
	// DOM order follows comments.json.
	expect(
		await page
			.locator('[data-cd-pin]')
			.evaluateAll((pins) => pins.map((pin) => pin.getAttribute('data-cd-pin'))),
	).toEqual(ALL.map((entry) => entry.id));
});

test('a target at the frame top-left puts the pin tip there and the pin inside the viewport', async ({
	page,
}) => {
	const corner = comment({
		id: 'c-corner',
		selector: 'body',
		tagName: 'body',
		text: '',
		rect: { x: 0, y: 0, width: 600, height: 400 },
		pin: { x: 0, y: 0 },
		body: 'Corner',
	});
	const stage = await openPinStage(page, [corner]);
	await expectPinOn({ page, id: corner.id, selector: 'body' });
	const frame = await frameBox(page, 'a');
	expect(withinOnePx(await pinTip(page, corner.id), { x: frame.x, y: frame.y })).toBe(true);
	// The body grows up and to the left of the tip, into the stage margin, not over the frame.
	const box = await boxOf(pinOf(page, corner.id));
	expect(box.x).toBeGreaterThanOrEqual(stage.x);
	expect(box.y).toBeGreaterThanOrEqual(stage.y);
	expect(box.x + box.width).toBeLessThanOrEqual(frame.x + 1);
	expect(box.y + box.height).toBeLessThanOrEqual(frame.y + 1);
});

test('a pin follows a scroll inside a box and hides when the box scrolls it out', async ({
	page,
}) => {
	await openPinStage(page);
	await expectPinOn({ page, id: IN_BOX.id, selector: '#in-box' });
	const before = await pinTip(page, IN_BOX.id);
	await inFrame(page, `document.getElementById('box').scrollTop = 20`);
	await expect.poll(async () => (await pinTip(page, IN_BOX.id)).y).toBeCloseTo(before.y - 20, 0);
	await expectPinOn({ page, id: IN_BOX.id, selector: '#in-box' });
	await inFrame(page, `document.getElementById('box').scrollTop = 300`);
	await expect(pinOf(page, IN_BOX.id)).toHaveCount(0);
});

test('a pin follows zoom, pan, a frame drag preview and a frame width resize', async ({ page }) => {
	const stage = await openPinStage(page);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });

	await zoomSelect(page).selectOption('0.5');
	await expect(zoomReadout(page)).toHaveText('50%');
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await zoomSelect(page).selectOption('1');
	await expect(zoomReadout(page)).toHaveText('100%');

	// A wheel over the empty stage (right of the 600 px frame) pans.
	const panned = await frameBox(page, 'a');
	await page.mouse.move(stage.x + 900, stage.y + 300);
	await page.mouse.wheel(0, 40);
	await expect.poll(async () => (await frameBox(page, 'a')).y).toBeCloseTo(panned.y - 40, 0);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });

	// Mid-drag: the preview moves the frame before any host answer.
	const label = centerOf(await boxOf(page.locator('[data-cd-frame-label="a"]')));
	await page.mouse.move(label.x, label.y);
	await page.mouse.down();
	await page.mouse.move(label.x + 70, label.y + 30, { steps: 8 });
	await expect.poll(async () => (await frameBox(page, 'a')).x).toBeCloseTo(panned.x + 70, 0);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect.poll(async () => (await frameBox(page, 'a')).x).toBeCloseTo(panned.x, 0);

	// A narrower frame reflows the title; the pin stays on its top-left corner.
	const handle = centerOf(await boxOf(page.locator('[data-cd-frame-resize="a"]')));
	const wide = await frameBox(page, 'a');
	await page.mouse.move(handle.x, handle.y);
	await page.mouse.down();
	await page.mouse.move(handle.x - 200, handle.y, { steps: 8 });
	await expect.poll(async () => (await frameBox(page, 'a')).width).toBeLessThan(wide.width - 20);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await page.mouse.up();
});

test('a pin moves when a script changes only an absolute target style.left', async ({ page }) => {
	await openPinStage(page);
	await expectPinOn({ page, id: MOVER.id, selector: '#mover' });
	const before = await pinTip(page, MOVER.id);
	await inFrame(page, `document.getElementById('mover').style.left = '200px'`);
	await expect.poll(async () => (await pinTip(page, MOVER.id)).x).toBeCloseTo(before.x + 200, 0);
	await expectPinOn({ page, id: MOVER.id, selector: '#mover' });
});

test('a pin moves after a transform-only transition ends', async ({ page }) => {
	await openPinStage(page);
	await expectPinOn({ page, id: SLIDER.id, selector: '#slider' });
	const before = await pinTip(page, SLIDER.id);
	await inFrame(page, `document.getElementById('slider').classList.add('moved')`);
	await expect.poll(async () => (await pinTip(page, SLIDER.id)).x).toBeCloseTo(before.x + 160, 0);
	await expectPinOn({ page, id: SLIDER.id, selector: '#slider' });
});

test('a removed target shows the missing badge at its stored rect', async ({ page }) => {
	await openPinStage(page);
	await expect(page.getByRole('button', { name: 'Open comment 5: Doomed' })).toBeVisible();
	await inFrame(page, `document.getElementById('doomed').remove()`);
	await expect(
		page.getByRole('button', { name: 'Open comment 5, target missing: Doomed' }),
	).toBeVisible();
	await expect(pinOf(page, DOOMED.id)).toHaveClass(/missing/);
	const frame = await frameBox(page, 'a');
	const rect = DOOMED.rect ?? { x: 0, y: 0, width: 0, height: 0 };
	expect(
		withinOnePx(await pinTip(page, DOOMED.id), { x: frame.x + rect.x, y: frame.y + rect.y }),
	).toBe(true);
});

test('stale, unchecked and resolved looks come from the comments:updated flags', async ({
	page,
}) => {
	await openPinStage(page, [
		{ ...TITLE, stale: true },
		{ ...MOVER, stale: null, targetMissing: null },
		{ ...SLIDER, status: 'resolved', stale: true },
		{ ...IN_BOX, status: 'sent' },
	]);
	await expect(
		page.getByRole('button', { name: 'Open comment 1, target changed: Title' }),
	).toBeVisible();
	await expect(pinOf(page, TITLE.id).locator('.badge.stale svg path')).toHaveAttribute(
		'd',
		ICONS.warning[0].path,
	);
	await expect(
		page.getByRole('button', { name: 'Open comment 2, not checked: Mover' }),
	).toBeVisible();
	await expect(pinOf(page, MOVER.id).locator('.badge.unchecked svg path')).toHaveAttribute(
		'd',
		ICONS.question[1].path,
	);
	await expect(page.getByRole('button', { name: 'Resolved comment 3: Slider' })).toBeVisible();
	await expect(pinOf(page, SLIDER.id)).toHaveClass(/resolved/);
	await expect(pinOf(page, SLIDER.id).locator('.badge')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Sent comment 4: In the box' })).toBeVisible();
	await expect(pinOf(page, IN_BOX.id)).toHaveClass(/sent/);
});

test('after a frame reload the frame answers again and the pin returns', async ({ page }) => {
	await openPinStage(page);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	const answers = await anchorAnswers(page);
	await postToChrome(
		page,
		canvasUpdated([{ ...FRAME, generation: 2, html: `${PINS_HTML}<!-- edited -->` }]),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(2);
	await expect.poll(() => anchorAnswers(page)).toBeGreaterThan(answers);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
});

test('a static page goes quiet after its forced answer', async ({ page }) => {
	await openPinStage(page);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	// A static page must schedule no measurement (picking schedules none in Interact mode). A
	// repeated observe() is a no-op in Chromium, so the observer test below covers the observed-set
	// diff.
	await inFrame(
		page,
		`(() => {
			const original = window.requestAnimationFrame.bind(window);
			window.__cdScheduled = 0;
			window.requestAnimationFrame = (callback) => {
				window.__cdScheduled += 1;
				return original(callback);
			};
		})()`,
	);
	const answers = await anchorAnswers(page);
	for (let frame = 0; frame < 10; frame += 1) {
		await nextAnimationFrame(page);
	}
	expect(await anchorAnswers(page)).toBe(answers);
	expect(await (await frameOf(page, 'a')).evaluate('window.__cdScheduled')).toBe(0);
});

// Departure from rule 09: a ResizeObserver's targets are invisible to the page, and Chromium makes
// a repeated observe() a no-op, so no message or box shows the observed-set diff. This wraps the
// prototype inside the frame after the height observer started and before the pin observer does.
const TRACK_RESIZE_OBSERVER = `(() => {
	const proto = ResizeObserver.prototype;
	const { observe, unobserve, disconnect } = proto;
	window.__cdObserved = new Set();
	window.__cdObserveCalls = 0;
	proto.observe = function (target, options) {
		window.__cdObserveCalls += 1;
		window.__cdObserved.add(target);
		return observe.call(this, target, options);
	};
	proto.unobserve = function (target) {
		window.__cdObserved.delete(target);
		return unobserve.call(this, target);
	};
	proto.disconnect = function () {
		window.__cdObserved.clear();
		return disconnect.call(this);
	};
})()`;

test('the pin observer watches only current targets and stops on empty anchors', async ({
	page,
}) => {
	await openPinStage(page, []);
	await inFrame(page, TRACK_RESIZE_OBSERVER);
	const frame = await frameOf(page, 'a');
	// Every comments:updated makes the frame answer once (a forced measurement).
	const sendComments = async (comments: PostedComment[]): Promise<void> => {
		const answers = await anchorAnswers(page);
		await postToChrome(page, { type: 'comments:updated', comments });
		await expect.poll(() => anchorAnswers(page)).toBeGreaterThan(answers);
	};
	const observed = (): Promise<unknown> =>
		frame.evaluate(
			`[...window.__cdObserved].map((element) => element.id || element.tagName).sort()`,
		);
	await sendComments([TITLE, MOVER]);
	expect(await observed()).toEqual(['HTML', 'mover', 'title']);
	// A measurement with the same targets observes nothing again.
	const calls = await frame.evaluate('window.__cdObserveCalls');
	await sendComments([TITLE, MOVER]);
	expect(await frame.evaluate('window.__cdObserveCalls')).toBe(calls);
	// A target that is no longer requested is unobserved.
	await sendComments([TITLE]);
	expect(await observed()).toEqual(['HTML', 'title']);
	// Empty anchors tear the observer down.
	await sendComments([]);
	expect(await observed()).toEqual([]);
});

test('a pointer drag starting on a pin does not pan', async ({ page }) => {
	await openPinStage(page);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	const before = await frameBox(page, 'a');
	const start = centerOf(await boxOf(pinOf(page, TITLE.id)));
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 80, start.y + 60, { steps: 8 });
	await page.mouse.up();
	await nextAnimationFrame(page);
	const after = await frameBox(page, 'a');
	expect(after.x).toBe(before.x);
	expect(after.y).toBe(before.y);
});

test('with a draft open, a click at a pin retargets the draft and keeps its text', async ({
	page,
}) => {
	await openPinStage(page);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	// Inside the doomed element, clear of its pin (above-left of its corner).
	const doomed = await frameElementBox({ page, frameId: 'a', selector: '#doomed' });
	await clickAt(page, { x: doomed.x + 6, y: doomed.y + doomed.height / 2 });
	const chip = popoverTarget(page);
	await expect(chip).toHaveText('Doomed');
	await page.getByRole('textbox', { name: 'Comment' }).fill('Kept text');
	// The title pin sits in the body's margin above-left of the title, so the click there
	// picks what is under it: the page.
	await clickAt(page, centerOf(await boxOf(pinOf(page, TITLE.id))));
	await expect(chip).toHaveText('Whole frame');
	await expect(page.getByRole('textbox', { name: 'Comment' })).toHaveValue('Kept text');
});

const THREADED = {
	...TITLE,
	body: 'Make the title bolder',
	replies: [
		{
			id: 'r1',
			author: 'user' as const,
			body: 'And darker',
			createdAt: '2026-10-27T10:01:00.000Z',
		},
		{ id: 'r2', author: 'agent' as const, body: 'Done', createdAt: '2026-10-27T10:02:00.000Z' },
	],
};

test('a pin click opens its thread with the body, reply authors and actions', async ({ page }) => {
	await openPinStage(page, [THREADED, MOVER]);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await openThread(page, TITLE.id);
	await expect(thread(page)).toContainText('Make the title bolder');
	await expect(thread(page)).toContainText('Open');
	// Each reply: its author, its relative time, then its body.
	await expect(thread(page).locator('li')).toHaveText([
		/^You\b[\s\S]*And darker$/,
		/^Agent\b[\s\S]*Done$/,
	]);
	// By name: Close is an icon button in the head, named by its label.
	const buttons = thread(page).getByRole('button');
	await expect(buttons).toHaveCount(4);
	for (const [index, name] of ['Close', 'Reply', 'Resolve', 'Copy for Agent'].entries()) {
		await expect(buttons.nth(index)).toHaveAccessibleName(name);
	}
});

test('two comments on one element get two pins side by side, each opening its own thread', async ({
	page,
}) => {
	const second = comment({ id: 'c-title-2', body: 'Second note' });
	await openPinStage(page, [TITLE, second]);
	// The first keeps the element corner; the second lines up to its left.
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	const first = await boxOf(pinOf(page, TITLE.id));
	const next = await boxOf(pinOf(page, second.id));
	expect(next.x + next.width).toBeLessThanOrEqual(first.x);
	expect(Math.abs(next.y - first.y)).toBeLessThanOrEqual(1);
	await openThread(page, TITLE.id);
	await expect(thread(page)).toContainText('Title');
	await page.keyboard.press('Escape');
	await expect(thread(page)).toBeHidden();
	await openThread(page, second.id);
	await expect(thread(page)).toContainText('Second note');
});

test('Escape closes the thread and focuses its pin', async ({ page }) => {
	await openPinStage(page, [THREADED, MOVER]);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await expect(pinOf(page, TITLE.id)).toHaveAttribute('aria-haspopup', 'dialog');
	await expect(pinOf(page, TITLE.id)).toHaveAttribute('aria-expanded', 'false');
	await openThread(page, TITLE.id);
	// Only the open thread's pin is expanded.
	await expect(pinOf(page, TITLE.id)).toHaveAttribute('aria-expanded', 'true');
	await expect(pinOf(page, MOVER.id)).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('Escape');
	await expect(thread(page)).toHaveCount(0);
	await expect(pinOf(page, TITLE.id)).toHaveAttribute('aria-expanded', 'false');
	await expect(pinOf(page, TITLE.id)).toBeFocused();
	// The prevented Escape never reached the mode-key rule.
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('a comments:updated without the open comment closes it and focuses the stage', async ({
	page,
}) => {
	await openPinStage(page, [THREADED, MOVER]);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await openThread(page, TITLE.id);
	await postToChrome(page, { type: 'comments:updated', comments: [MOVER] });
	await expect(thread(page)).toHaveCount(0);
	await expect(page.locator('.viewport')).toBeFocused();
});

test('a pick in Comment mode closes the thread and opens the draft', async ({ page }) => {
	await openPinStage(page, [THREADED, MOVER]);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await openThread(page, TITLE.id);
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	// Toggling the mode does not close it.
	await expect(thread(page)).toBeVisible();
	const doomed = await frameElementBox({ page, frameId: 'a', selector: '#doomed' });
	await clickAt(page, { x: doomed.x + 6, y: doomed.y + doomed.height / 2 });
	await expect(popoverTarget(page)).toHaveText('Doomed');
	await expect(thread(page)).toHaveCount(0);
});

test('a reload that unplaces the open pin closes its thread, and it does not come back', async ({
	page,
}) => {
	// The stored rect lies right of the 600 px frame: between cd:ready and the new answer the pin
	// falls back to it and is unplaced; the answer then places it on #title again.
	await openPinStage(page, [{ ...THREADED, rect: { x: 700, y: 24, width: 50, height: 29 } }]);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await openThread(page, TITLE.id);
	const answers = await anchorAnswers(page);
	await postToChrome(
		page,
		canvasUpdated([{ ...FRAME, generation: 2, html: `${PINS_HTML}<!-- edited -->` }]),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(2);
	await expect.poll(() => anchorAnswers(page)).toBeGreaterThan(answers);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await expect(thread(page)).toHaveCount(0);
	await expect(page.locator('.viewport')).toBeFocused();
});

test('a page shrink that unplaces the open pin closes its thread, and it does not come back', async ({
	page,
}) => {
	await openPinStage(page, [DOOMED]);
	await expectPinOn({ page, id: DOOMED.id, selector: '#doomed' });
	await openThread(page, DOOMED.id);
	// The target goes (box: null, so the pin falls back to the stored rect at y 200), then the page
	// shrinks to its padding. Only cd:frame-height reports the shrink; the frame's answer is unchanged.
	await inFrame(page, `document.body.replaceChildren()`);
	await expect(pinOf(page, DOOMED.id)).toHaveCount(0);
	await expect(thread(page)).toHaveCount(0);
	await expect(page.locator('.viewport')).toBeFocused();
	await inFrame(page, `document.body.style.height = '400px'`);
	await expect(
		page.getByRole('button', { name: 'Open comment 1, target missing: Doomed' }),
	).toBeVisible();
	await expect(thread(page)).toHaveCount(0);
});

test('a body with markup shows as literal text', async ({ page }) => {
	const body = '<img src=x onerror="document.title=1">';
	await openPinStage(page, [{ ...TITLE, body }]);
	await expectPinOn({ page, id: TITLE.id, selector: '#title' });
	await openThread(page, TITLE.id);
	await expect(thread(page).locator('.body')).toHaveText(body);
	await expect(thread(page).locator('img')).toHaveCount(0);
});
