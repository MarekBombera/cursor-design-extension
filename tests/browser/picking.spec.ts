import { expect, type Locator, type Page, test } from '@playwright/test';

import {
	FRAME_HOVER_MESSAGE,
	FRAME_PICK_MESSAGE,
	type FramePickMessage,
	type FrameRect,
	parseFrameMessage,
} from '../../src/webview/frame/frameMessages';
import type { PostedCanvasFrame } from '../../src/webview/hostMessages';
import {
	type Box,
	boxOf,
	canvasUpdated,
	centerOf,
	clickAt,
	clickChrome,
	frameBox,
	frameOf,
	loadsOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	type Point,
	postToChrome,
	readPickingFixture,
	stageBox,
	untilHeightReported,
} from './harness';

const PICKING_FRAME: PostedCanvasFrame = {
	id: 'a',
	label: 'Picking',
	x: 0,
	y: 0,
	width: 800,
	generation: 1,
	html: readPickingFixture(),
};

const FRAME_B: PostedCanvasFrame = {
	id: 'b',
	label: 'Frame B',
	x: 1000,
	y: 0,
	width: 400,
	generation: 1,
	html: `<!doctype html><html><body><button id="b-target">B</button></body></html>`,
};

type FrameTarget = { page: Page; frameId: string; selector: string };

// Frame-local rect of the first match, from the frame's own layout.
const elementRect = async ({ page, frameId, selector }: FrameTarget): Promise<FrameRect> => {
	const frame = await frameOf(page, frameId);
	return frame.evaluate((wanted) => {
		const element = document.querySelector(wanted);
		if (element === null) {
			throw new Error(`No element matches ${wanted}.`);
		}
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height };
	}, selector);
};

// Screen box at zoom 1: frame box + element rect.
const screenBox = async (target: FrameTarget): Promise<Box> => {
	const frame = await frameBox(target.page, target.frameId);
	const rect = await elementRect(target);
	return { x: frame.x + rect.x, y: frame.y + rect.y, width: rect.width, height: rect.height };
};

// Through the chrome's own guard: a captured pick is a wire value.
const picksOf = async (page: Page, frameId: string): Promise<FramePickMessage[]> =>
	(await messagesOfType({ page, frameId, type: FRAME_PICK_MESSAGE }))
		.map((data) => parseFrameMessage(data))
		.filter((message): message is FramePickMessage => message?.type === FRAME_PICK_MESSAGE);

const openPickingStage = async (page: Page): Promise<Box> => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(page, canvasUpdated([PICKING_FRAME, FRAME_B]));
	await untilHeightReported(page, 'a');
	await untilHeightReported(page, 'b');
	return stageBox(page);
};

// A target outside the stage is brought into view by a wheel over the empty stage (between frame A,
// 0..800, and frame B, 1000..1400), never by scrolling into view.
const reveal = async ({ stage, ...target }: FrameTarget & { stage: Box }): Promise<Box> => {
	const { page } = target;
	const box = await screenBox(target);
	const middle = box.y + box.height / 2;
	if (middle > stage.y + 40 && stage.y + stage.height - 40 > middle) {
		return box;
	}
	const before = await frameBox(page, 'a');
	const deltaY = Math.round(middle - (stage.y + stage.height / 2));
	await page.mouse.move(stage.x + 900, stage.y + 100);
	await page.mouse.wheel(0, deltaY);
	await expect.poll(async () => (await frameBox(page, 'a')).y).toBeCloseTo(before.y - deltaY, 0);
	return screenBox(target);
};

const commentButton = (page: Page): Locator => page.getByRole('button', { name: 'Comment' });

const toggleComment = async (page: Page, pressed: boolean): Promise<void> => {
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', String(pressed));
};

const statusText = async (page: Page): Promise<string | null> =>
	(await frameOf(page, 'a')).locator('#status').textContent();

const detailsOpen = async (page: Page): Promise<boolean> =>
	(await frameOf(page, 'a')).evaluate(() => document.querySelector('details')?.open === true);

// Clicks the point and returns the cd:pick it caused.
const pickInFrame = async ({
	page,
	frameId,
	point,
}: {
	page: Page;
	frameId: string;
	point: Point;
}): Promise<FramePickMessage> => {
	const count = (await picksOf(page, frameId)).length;
	await clickAt(page, point);
	await expect.poll(async () => (await picksOf(page, frameId)).length).toBe(count + 1);
	const pick = (await picksOf(page, frameId)).at(-1);
	if (pick === undefined) {
		throw new Error('No cd:pick was captured.');
	}
	return pick;
};

// The selector of the last pick in frame A, once a step after `count` picks has posted.
const nextPickSelector = async (page: Page, count: number): Promise<string | null> => {
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBe(count + 1);
	return (await picksOf(page, 'a')).at(-1)?.selector ?? null;
};

// True when the selector matches exactly one element in frame A and it is the one `expected`
// finds (`expected` runs in the frame: a CSS selector, or `parent` for #change-button's parent).
const resolvesTo = async ({
	page,
	selector,
	expected,
}: {
	page: Page;
	selector: string | null;
	expected: string;
}): Promise<boolean> => {
	if (selector === null) {
		return false;
	}
	return (await frameOf(page, 'a')).evaluate(
		([picked, wanted]) => {
			const matches = document.querySelectorAll(picked);
			const target =
				wanted === 'parent'
					? document.getElementById('change-button')?.parentElement
					: document.querySelector(wanted);
			return matches.length === 1 && matches[0] === target;
		},
		[selector, expected],
	);
};

const expectBoxNear = (actual: Box, expected: Box): void => {
	expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.width - expected.width)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.height - expected.height)).toBeLessThanOrEqual(1);
};

const revealChangeButton = (page: Page, stage: Box): Promise<Box> =>
	reveal({ page, stage, frameId: 'a', selector: '#change-button' });

test('Interact mode: a click reaches the design', async ({ page }) => {
	const stage = await openPickingStage(page);
	const button = await revealChangeButton(page, stage);
	await clickAt(page, centerOf(button));
	await expect.poll(() => statusText(page)).toBe('Button handler fired.');

	// The control for the Comment-mode case below: a real click opens <details>.
	const summary = await reveal({ page, stage, frameId: 'a', selector: 'details > summary' });
	await clickAt(page, centerOf(summary));
	await expect.poll(() => detailsOpen(page)).toBe(true);
});

test('Comment mode: both frames hover, and the hover outline matches the element', async ({
	page,
}) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
	await expect
		.poll(
			async () => (await messagesOfType({ page, frameId: 'a', type: FRAME_HOVER_MESSAGE })).length,
		)
		.toBeGreaterThan(0);
	const outline = page.locator('.overlay .outline.hover');
	await expect(outline).toBeVisible();
	await expect.poll(async () => Math.abs((await boxOf(outline)).y - button.y)).toBeLessThan(1);
	expectBoxNear(await boxOf(outline), button);

	const target = await reveal({ page, stage, frameId: 'b', selector: '#b-target' });
	await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
	await expect
		.poll(
			async () => (await messagesOfType({ page, frameId: 'b', type: FRAME_HOVER_MESSAGE })).length,
		)
		.toBeGreaterThan(0);
});

test('Comment mode: clicks pick instead of acting', async ({ page }) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	const pick = await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	expect(pick.tagName).toBe('button');
	expect(await statusText(page)).toBe('Nothing fired yet.');
	await expect(page.locator('.overlay .outline.pick')).toBeVisible();
	await expect(page.locator('.bar .chip')).toBeVisible();

	// A default action, not a handler: only preventDefault keeps <details> shut (F-61). The
	// Interact-mode test proves the same click opens it.
	const summary = await reveal({ page, stage, frameId: 'a', selector: 'details > summary' });
	const summaryPick = await pickInFrame({ page, frameId: 'a', point: centerOf(summary) });
	expect(summaryPick.tagName).toBe('summary');
	expect(await detailsOpen(page)).toBe(false);
});

test('Comment mode: Parent, ↑/↓ with chrome focus, and ↑ with frame focus step the pick', async ({
	page,
}) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });

	let count = (await picksOf(page, 'a')).length;
	await clickChrome(page.getByRole('button', { name: 'Select parent element' }));
	expect(
		await resolvesTo({ page, selector: await nextPickSelector(page, count), expected: 'parent' }),
	).toBe(true);

	// Focus is on the toolbar button now: the chrome's own ↑/↓ handler steps the pick (F-63).
	count += 1;
	await page.keyboard.press('ArrowDown');
	expect(
		await resolvesTo({
			page,
			selector: await nextPickSelector(page, count),
			expected: '#change-button',
		}),
	).toBe(true);
	count += 1;
	await page.keyboard.press('ArrowUp');
	expect(
		await resolvesTo({ page, selector: await nextPickSelector(page, count), expected: 'parent' }),
	).toBe(true);

	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	expect((await picksOf(page, 'a')).at(-1)?.tagName).toBe('button');
	count = (await picksOf(page, 'a')).length;
	await page.keyboard.press('ArrowUp');
	expect(
		await resolvesTo({ page, selector: await nextPickSelector(page, count), expected: 'parent' }),
	).toBe(true);
});

test('Comment mode: a pick in another frame moves the one pick outline', async ({ page }) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(1);

	const target = await reveal({ page, stage, frameId: 'b', selector: '#b-target' });
	await pickInFrame({ page, frameId: 'b', point: centerOf(target) });
	const outlines = page.locator('.overlay .outline.pick');
	await expect(outlines).toHaveCount(1);
	await expect.poll(async () => Math.abs((await boxOf(outlines)).x - target.x)).toBeLessThan(1);
	expectBoxNear(await boxOf(outlines), target);
});

test('Comment mode off: outlines go and clicks act again', async ({ page }) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	await expect(page.locator('.overlay .outline')).toHaveCount(2);

	await toggleComment(page, false);
	await expect(page.locator('.overlay .outline')).toHaveCount(0);
	await clickAt(page, centerOf(button));
	await expect.poll(() => statusText(page)).toBe('Button handler fired.');
});

// F-65: the frame list changes under a pick.
test('Comment mode: a picked frame leaving takes its pick; an empty stage ends Comment mode', async ({
	page,
}) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	await expect(page.locator('.bar .chip')).toBeVisible();

	await postToChrome(page, canvasUpdated([FRAME_B]));
	await expect(page.locator('[data-cd-frame-id="a"]')).toHaveCount(0);
	await expect(page.locator('.overlay .outline')).toHaveCount(0);
	await expect(page.locator('.bar .chip')).toBeHidden();
	// Frame B is still live, so the mode stays on.
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');

	await postToChrome(page, canvasUpdated([]));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText('No artboard yet.')).toBeVisible();
});

test('Comment mode: an Agent edit reloads the picked frame once, drops the pick, and the reload picks again', async ({
	page,
}) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(1);

	// As after update_artboard: new html, generation + 1.
	await postToChrome(
		page,
		canvasUpdated([
			{ ...PICKING_FRAME, html: `${PICKING_FRAME.html}<!-- edited -->`, generation: 2 },
			FRAME_B,
		]),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(2);
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(0);
	expect(await loadsOf(page, 'b')).toBe(1);

	// A hover is only posted in Comment mode: proof the reload got cd:mode before the click.
	const hovers = (await messagesOfType({ page, frameId: 'a', type: FRAME_HOVER_MESSAGE })).length;
	const again = await revealChangeButton(page, stage);
	await page.mouse.move(again.x + 2, again.y + 2);
	await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
	await expect
		.poll(
			async () => (await messagesOfType({ page, frameId: 'a', type: FRAME_HOVER_MESSAGE })).length,
		)
		.toBeGreaterThan(hovers);
	const pick = await pickInFrame({ page, frameId: 'a', point: centerOf(again) });
	expect(pick.tagName).toBe('button');
	expect(await statusText(page)).toBe('Nothing fired yet.');
});

// F-69: a design's own script can post any cd:* message from its real window.
const FORGED_PICK = {
	type: FRAME_PICK_MESSAGE,
	selector: '#forged',
	tagName: 'div',
	text: 'Forged',
	rect: { x: 0, y: 0, width: 200, height: 100 },
	point: { x: 1, y: 1 },
	styles: {},
	isPage: false,
};

const postFromFrameA = async (page: Page, message: unknown): Promise<void> => {
	await (
		await frameOf(page, 'a')
	).evaluate((forged) => {
		window.parent.postMessage(forged, '*');
	}, message);
};

test('Interact mode: a forged cd:hover and cd:pick from the design draw nothing', async ({
	page,
}) => {
	await openPickingStage(page);
	// Well formed: only the Interact-mode guard can drop it.
	expect(parseFrameMessage(FORGED_PICK)).toBeDefined();
	await postFromFrameA(page, { type: FRAME_HOVER_MESSAGE, rect: FORGED_PICK.rect });
	await postFromFrameA(page, FORGED_PICK);
	await expect
		.poll(
			async () => (await messagesOfType({ page, frameId: 'a', type: FRAME_PICK_MESSAGE })).length,
		)
		.toBe(1);
	await nextAnimationFrame(page);
	await expect(page.locator('.overlay .outline')).toHaveCount(0);
	await expect(page.locator('.bar .chip')).toBeHidden();
});

test('Comment mode: a forged cd:pick with a control character changes nothing', async ({
	page,
}) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const button = await revealChangeButton(page, stage);
	await pickInFrame({ page, frameId: 'a', point: centerOf(button) });
	const chip = page.locator('.bar .chip');
	const chipText = (await chip.textContent()) ?? '';
	expect(chipText).not.toBe('');

	const picks = (await messagesOfType({ page, frameId: 'a', type: FRAME_PICK_MESSAGE })).length;
	await postFromFrameA(page, { ...FORGED_PICK, text: 'Forged\nline' });
	await expect
		.poll(
			async () => (await messagesOfType({ page, frameId: 'a', type: FRAME_PICK_MESSAGE })).length,
		)
		.toBe(picks + 1);
	await nextAnimationFrame(page);
	await expect(chip).toHaveText(chipText);
	expectBoxNear(await boxOf(page.locator('.overlay .outline.pick')), button);
});

// The nested window is not a registered frame, so its opaque-origin message is dropped. It is
// absolutely positioned, so frame A's own height does not change.
test('a nested iframe inside a design cannot post as its frame', async ({ page }) => {
	await openPickingStage(page);
	const before = await frameBox(page, 'a');
	await page.evaluate(() => {
		window.addEventListener('message', (event) => {
			const data: unknown = event.data;
			if (typeof data === 'object' && data !== null && 'height' in data && data.height === 5000) {
				document.documentElement.dataset.nestedPost = 'seen';
			}
		});
	});
	await (
		await frameOf(page, 'a')
	).evaluate(() => {
		const nested = document.createElement('iframe');
		nested.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;border:0';
		nested.srcdoc =
			'<script>window.top.postMessage({ type: "cd:frame-height", height: 5000 }, "*");</script>';
		document.body.append(nested);
	});
	await expect
		.poll(() => page.evaluate(() => document.documentElement.dataset.nestedPost))
		.toBe('seen');
	await nextAnimationFrame(page);
	expect((await frameBox(page, 'a')).height).toBeCloseTo(before.height, 0);
});

// Each case: where to click, and the element the selector must resolve to. Fixed locators, never
// recomputed from the click point. The pick caps are enforced by parseFrameMessage, which
// picksOf already runs, and are unit-tested there (F-68).
const SELECTOR_CASES: { name: string; click: string; expected: string }[] = [
	{
		name: 'identical cards',
		click: '.cards > .card:nth-child(3)',
		expected: '.cards > .card:nth-child(3)',
	},
	{ name: 'duplicate id', click: '.traps > p:nth-child(2)', expected: '.traps > p:nth-child(2)' },
	{ name: 'colon id', click: '[id="a:b"]', expected: '[id="a:b"]' },
	{ name: 'SVG internals', click: 'svg.icon-paths path', expected: 'svg.icon-paths' },
	{
		name: 'mutated list',
		click: '#mutated-list > li:nth-child(2)',
		expected: '#mutated-list > li:nth-child(2)',
	},
	{ name: 'hit-test trap', click: '.trap .covered', expected: '.trap .covered' },
];

for (const selectorCase of SELECTOR_CASES) {
	test(`selector: ${selectorCase.name}`, async ({ page }) => {
		const stage = await openPickingStage(page);
		await toggleComment(page, true);
		const box = await reveal({ page, stage, frameId: 'a', selector: selectorCase.click });
		const pick = await pickInFrame({ page, frameId: 'a', point: centerOf(box) });
		expect(pick.selector).not.toBeNull();
		expect(
			await resolvesTo({ page, selector: pick.selector, expected: selectorCase.expected }),
		).toBe(true);
	});
}

test('selector: an item of a scrolled box', async ({ page }) => {
	const stage = await openPickingStage(page);
	await toggleComment(page, true);
	const scrollBox = await reveal({ page, stage, frameId: 'a', selector: '.scroll-box' });
	// A real wheel over the box: the frame runtime lets an element that can scroll take it.
	await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
	await page.mouse.wheel(0, 1000);
	const frame = await frameOf(page, 'a');
	await expect
		.poll(() =>
			frame.evaluate(() => {
				const element = document.querySelector('.scroll-box');
				return element === null
					? false
					: element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
			}),
		)
		.toBe(true);
	const item = await screenBox({ page, frameId: 'a', selector: '.scroll-box > li:nth-child(12)' });
	const pick = await pickInFrame({ page, frameId: 'a', point: centerOf(item) });
	expect(
		await resolvesTo({ page, selector: pick.selector, expected: '.scroll-box > li:nth-child(12)' }),
	).toBe(true);
});
