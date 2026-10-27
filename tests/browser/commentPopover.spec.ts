import { expect, type Locator, type Page, test } from '@playwright/test';

import {
	FRAME_KEY_MESSAGE,
	FRAME_PICK_MESSAGE,
	type FramePickMessage,
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
	isMessageOfType,
	loadsOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	type Point,
	posted,
	postToChrome,
	stageBox,
	untilHeightReported,
} from './harness';

const FRAME_A: PostedCanvasFrame = {
	id: 'a',
	label: 'Frame A',
	x: 0,
	y: 0,
	width: 400,
	generation: 1,
	html: `<!doctype html><html><head><style>
		body { margin: 0; }
		#a-scroll { height: 80px; overflow: auto; }
		#a-scroll > div { height: 400px; }
	</style></head><body>
		<h1 id="a-title">Title A</h1>
		<input id="a-input" aria-label="Design input">
		<section><p id="a-text">Paragraph text</p></section>
		<div id="a-scroll"><div><p id="a-scroll-item">Scroll item</p></div></div>
		<div id="a-shadow"></div>
		<script>
			document.querySelector('#a-shadow').attachShadow({ mode: 'open' }).innerHTML =
				'<input id="a-shadow-input" aria-label="Shadow input">';
		</script>
	</body></html>`,
};

const FRAME_B: PostedCanvasFrame = {
	id: 'b',
	label: 'Frame B',
	x: 600,
	y: 0,
	width: 700,
	generation: 1,
	// A target in the frame's far corner, so its pick lands near the stage's right and bottom edges.
	html: `<!doctype html><html><head><style>
		body { margin: 0; height: 2000px; position: relative; }
		#b-corner { position: absolute; left: 640px; top: 680px; width: 40px; height: 40px; }
	</style></head><body><p>B</p><div id="b-corner">Corner</div></body></html>`,
};

test('a broken comments.json shows its own banner and never blanks the stage', async ({ page }) => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(page, canvasUpdated([FRAME_A, FRAME_B]));
	await untilHeightReported(page, 'a');
	await untilHeightReported(page, 'b');

	const banner = page.locator('[data-cd-comments-error]');
	await expect(banner).toBeHidden();
	const error = 'comments.json is not valid. Fix or delete .cursor-design/comments.json.';
	await postToChrome(page, { type: 'comments:updated', comments: [], error });
	await expect(banner).toBeVisible();
	await expect(banner).toHaveText(error);
	await expect(banner).toHaveAttribute('role', 'alert');
	await expect(page.locator('[data-cd-frame-id] iframe')).toHaveCount(2);
	await expect(page.locator('[data-cd-frame-id="a"] iframe')).toBeVisible();

	// A canvas refresh clears the artboard error line, not this one.
	await postToChrome(page, canvasUpdated([FRAME_A, FRAME_B]));
	await expect(banner).toHaveText(error);

	await postToChrome(page, { type: 'comments:updated', comments: [] });
	await expect(banner).toBeHidden();
});

const commentButton = (page: Page): Locator =>
	page.getByRole('button', { name: 'Comment', exact: true });

const openTwoFrames = async (page: Page): Promise<void> => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(page, canvasUpdated([FRAME_A, FRAME_B]));
	await untilHeightReported(page, 'a');
	await untilHeightReported(page, 'b');
};

// Screen point of an element's centre inside a frame at zoom 1.
const pointInFrame = async (page: Page, frameId: string, selector: string): Promise<Point> => {
	const frame = await frameBox(page, frameId);
	const rect = await (
		await frameOf(page, frameId)
	).evaluate((wanted) => {
		const element = document.querySelector(wanted);
		if (element === null) {
			throw new Error(`No element matches ${wanted}.`);
		}
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height };
	}, selector);
	return centerOf({
		x: frame.x + rect.x,
		y: frame.y + rect.y,
		width: rect.width,
		height: rect.height,
	});
};

test('C with chrome focus toggles Comment mode and Escape leaves it', async ({ page }) => {
	await openTwoFrames(page);
	await expect(commentButton(page)).toHaveAttribute('aria-keyshortcuts', 'c');
	await page.keyboard.press('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByText('Click to comment.')).toBeVisible();
	await page.keyboard.press('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
	await page.keyboard.press('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText('Click to comment.')).toBeHidden();
});

test('C and Escape with frame focus reach the chrome as cd:key', async ({ page }) => {
	await openTwoFrames(page);
	// An Interact-mode click moves focus into the frame.
	await clickAt(page, await pointInFrame(page, 'a', '#a-title'));
	await page.keyboard.press('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	expect(await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).toEqual([
		{ type: FRAME_KEY_MESSAGE, key: 'c' },
	]);
	await page.keyboard.press('Escape');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('C typed into a design input in Interact mode stays in the input', async ({ page }) => {
	await openTwoFrames(page);
	await clickAt(page, await pointInFrame(page, 'a', '#a-input'));
	await page.keyboard.type('cc');
	await expect((await frameOf(page, 'a')).locator('#a-input')).toHaveValue('cc');
	await nextAnimationFrame(page);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
	expect(await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).toEqual([]);
});

test('C with a modifier, a held C, or C in a shadow-root input never posts cd:key (F-82)', async ({
	page,
}) => {
	await openTwoFrames(page);
	await clickAt(page, await pointInFrame(page, 'a', '#a-title'));
	for (const chord of ['Meta+c', 'Control+c', 'Alt+c']) {
		await page.keyboard.press(chord);
	}
	await nextAnimationFrame(page);
	expect(await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).toEqual([]);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');

	// Held: the auto-repeat keydowns are not forwarded, so the mode toggles once.
	await page.keyboard.down('c');
	await page.keyboard.down('c');
	await page.keyboard.down('c');
	await page.keyboard.up('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await nextAnimationFrame(page);
	expect(await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).toEqual([
		{ type: FRAME_KEY_MESSAGE, key: 'c' },
	]);
	await page.keyboard.press('Escape');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');

	// composedPath: an input inside a shadow root is editable too.
	const shadowInput = (await frameOf(page, 'a')).locator('#a-shadow-input');
	await shadowInput.click();
	await page.keyboard.type('c');
	await expect(shadowInput).toHaveValue('c');
	await nextAnimationFrame(page);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
	expect(await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).toHaveLength(2);
});

test('a target taller than the coordinate cap still opens the popover (F-79)', async ({ page }) => {
	await openTwoFrames(page);
	await (
		await frameOf(page, 'a')
	).evaluate(() => {
		const title = document.querySelector<HTMLElement>('#a-title');
		if (title !== null) {
			title.style.height = '150000px';
		}
	});
	await clickChrome(commentButton(page));
	const frame = await frameBox(page, 'a');
	await clickAt(page, { x: frame.x + 40, y: frame.y + 20 });
	await expect(popover(page)).toBeVisible();
	expect((await lastPick(page, 'a')).box.height).toBe(100000);
});

test('C with no live frame does nothing', async ({ page }) => {
	await openHarness(page);
	await postToChrome(page, canvasUpdated([]));
	await page.keyboard.press('c');
	await nextAnimationFrame(page);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
});

const popover = (page: Page): Locator => page.getByRole('dialog', { name: 'Add comment' });
const commentBox = (page: Page): Locator => popover(page).getByRole('textbox', { name: 'Comment' });
const cancelButton = (page: Page): Locator => popover(page).getByRole('button', { name: 'Cancel' });
const addButton = (page: Page): Locator =>
	popover(page).getByRole('button', { name: 'Add comment' });

// Through the chrome's own guard: a captured pick is a wire value.
const picksOf = async (page: Page, frameId: string): Promise<FramePickMessage[]> =>
	(await messagesOfType({ page, frameId, type: FRAME_PICK_MESSAGE }))
		.map((data) => parseFrameMessage(data))
		.filter((message): message is FramePickMessage => message?.type === FRAME_PICK_MESSAGE);

const lastPick = async (page: Page, frameId: string): Promise<FramePickMessage> => {
	const pick = (await picksOf(page, frameId)).at(-1);
	if (pick === undefined) {
		throw new Error('No cd:pick was captured.');
	}
	return pick;
};

const creates = async (page: Page): Promise<Record<string, unknown>[]> =>
	(await posted(page)).filter((message): message is Record<string, unknown> =>
		isMessageOfType(message, 'comment:create'),
	);

const lastRequestId = async (page: Page): Promise<string> => {
	const requestId = (await creates(page)).at(-1)?.requestId;
	if (typeof requestId !== 'string') {
		throw new Error('No comment:create was posted.');
	}
	return requestId;
};

// Comment mode on, then a click on the element; resolves with the popover open on it.
const openPopoverOn = async ({
	page,
	frameId = 'a',
	selector,
}: {
	page: Page;
	frameId?: string;
	selector: string;
}): Promise<void> => {
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	const count = (await picksOf(page, frameId)).length;
	await clickAt(page, await pointInFrame(page, frameId, selector));
	await expect.poll(async () => (await picksOf(page, frameId)).length).toBe(count + 1);
	await expect(popover(page)).toBeVisible();
	await expect(commentBox(page)).toBeFocused();
};

// One step posts exactly one cd:pick; the positive control proves an earlier key posted none.
const expectOneStep = async (page: Page, before: number): Promise<void> => {
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBe(before + 1);
	await nextAnimationFrame(page);
	expect((await picksOf(page, 'a')).length).toBe(before + 1);
};

const focusedFrameId = (page: Page): Promise<string | null | undefined> =>
	page.evaluate(() =>
		document.activeElement?.closest('[data-cd-frame-id]')?.getAttribute('data-cd-frame-id'),
	);

const layerTransform = (page: Page): Promise<string | null> =>
	page.locator('.layer').getAttribute('style');

test('a click in Comment mode opens the popover on the element, with focus in the box', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	const chip = popover(page).locator('.chip');
	await expect(chip).toHaveText('Title A');
	await expect(chip).toHaveAttribute('title', (await lastPick(page, 'a')).selector ?? '');
	await expect(popover(page).getByText('↑ parent · ↓ child')).toBeVisible();
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(1);
});

test('↑ in the empty box steps to the parent; after typing it moves the caret', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-text' });
	let before = (await picksOf(page, 'a')).length;
	await page.keyboard.press('ArrowUp');
	await expectOneStep(page, before);
	expect((await lastPick(page, 'a')).tagName).toBe('section');
	await expect(popover(page).locator('.chip')).toHaveAttribute(
		'title',
		(await lastPick(page, 'a')).selector ?? '',
	);

	before = (await picksOf(page, 'a')).length;
	await page.keyboard.type('x');
	await page.keyboard.press('ArrowUp');
	await commentBox(page).fill('');
	await page.keyboard.press('ArrowDown');
	await expectOneStep(page, before);
	expect((await lastPick(page, 'a')).tagName).toBe('p');

	// From the Cancel button with an empty box, too.
	await cancelButton(page).focus();
	before = (await picksOf(page, 'a')).length;
	await page.keyboard.press('ArrowUp');
	await expectOneStep(page, before);
	expect((await lastPick(page, 'a')).tagName).toBe('section');
});

test('Enter posts one comment:create from the last pick; Shift+Enter is a newline', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await page.keyboard.press('Enter');
	await expect(addButton(page)).toHaveAttribute('aria-disabled', 'true');

	await page.keyboard.type('Make it');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('bolder');
	await expect(commentBox(page)).toHaveValue('Make it\nbolder');
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await creates(page)).length).toBe(1);
	const { type: _type, repost: _repost, ...pick } = await lastPick(page, 'a');
	const [create] = await creates(page);
	expect(create).toEqual({
		type: 'comment:create',
		requestId: expect.stringMatching(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		),
		frameId: 'a',
		generation: 1,
		...pick,
		body: 'Make it\nbolder',
	});

	// Pending: a second Enter posts nothing and Cancel cannot hide the comment being written.
	await page.keyboard.press('Enter');
	await expect(cancelButton(page)).toBeDisabled();
	await page.keyboard.press('Escape');
	await nextAnimationFrame(page);
	expect((await creates(page)).length).toBe(1);
	await expect(popover(page)).toBeVisible();
});

test('the host answers: an error keeps the text, a stale answer is ignored, added closes', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await page.keyboard.type('Bolder');
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await creates(page)).length).toBe(1);
	const message = 'This artboard changed since the element was picked. Pick it again.';
	await postToChrome(page, { type: 'ui:error', requestId: await lastRequestId(page), message });
	await expect(popover(page).getByRole('status')).toHaveText(message);
	await expect(commentBox(page)).toHaveValue('Bolder');
	await expect(cancelButton(page)).toBeEnabled();

	await commentBox(page).focus();
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await creates(page)).length).toBe(2);
	await postToChrome(page, { type: 'comment:added', requestId: 'another-request' });
	await nextAnimationFrame(page);
	await expect(popover(page)).toBeVisible();
	await postToChrome(page, { type: 'comment:added', requestId: await lastRequestId(page) });
	await expect(popover(page)).toHaveCount(0);
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(0);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	// The text went with the closed draft: the next pick starts empty.
	await clickAt(page, await pointInFrame(page, 'a', '#a-title'));
	await expect(popover(page)).toBeVisible();
	await expect(commentBox(page)).toHaveValue('');
});

test('Escape closes the popover and returns focus to the frame; a second Escape leaves the mode', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await page.keyboard.press('Escape');
	await expect(popover(page)).toHaveCount(0);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => focusedFrameId(page)).toBe('a');
	await page.keyboard.press('Escape');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');
	expect(await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).toContainEqual({
		type: FRAME_KEY_MESSAGE,
		key: 'Escape',
	});
});

test('Add pressed from the button keeps focus in the popover; on success focus goes to the frame (F-77)', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await page.keyboard.type('Bolder');
	await page.keyboard.press('Tab');
	await expect(addButton(page)).toBeFocused();
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await creates(page)).length).toBe(1);
	// Pending: Add is aria-disabled but keeps focus, so the popover's keys still work.
	await expect(addButton(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(addButton(page)).toBeFocused();
	const message = 'This artboard changed since the element was picked. Pick it again.';
	await postToChrome(page, { type: 'ui:error', requestId: await lastRequestId(page), message });
	await expect(popover(page).getByRole('status')).toHaveText(message);
	await expect(addButton(page)).toBeFocused();

	await page.keyboard.press('Enter');
	await expect.poll(async () => (await creates(page)).length).toBe(2);
	await postToChrome(page, { type: 'comment:added', requestId: await lastRequestId(page) });
	await expect(popover(page)).toHaveCount(0);
	await expect.poll(() => focusedFrameId(page)).toBe('a');
});

test('Escape with focus on Cancel closes only the popover', async ({ page }) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await cancelButton(page).focus();
	await page.keyboard.press('Escape');
	await expect(popover(page)).toHaveCount(0);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('an Agent edit to the picked frame keeps the popover and its text; steps are disabled', async ({
	page,
}) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await page.keyboard.type('Keep me');
	await postToChrome(
		page,
		canvasUpdated([{ ...FRAME_A, html: `${FRAME_A.html}<!-- edited -->`, generation: 2 }, FRAME_B]),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(2);
	await expect(popover(page)).toBeVisible();
	await expect(commentBox(page)).toHaveValue('Keep me');
	for (const name of ['Select parent element', 'Select child element']) {
		await expect(popover(page).getByRole('button', { name })).toHaveAttribute(
			'aria-disabled',
			'true',
		);
	}
});

test('scroll re-posts move an open popover and never open a closed one', async ({ page }) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-scroll-item' });
	const before = await boxOf(popover(page));
	const scrollBox = await pointInFrame(page, 'a', '#a-scroll');
	const scrollLeft = { x: scrollBox.x - 150, y: scrollBox.y };
	const count = (await picksOf(page, 'a')).length;
	await page.mouse.move(scrollLeft.x, scrollLeft.y);
	await page.mouse.wheel(0, 30);
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBeGreaterThan(count);
	expect((await lastPick(page, 'a')).repost).toBe(true);
	await expect.poll(async () => (await boxOf(popover(page))).y).toBeLessThan(before.y);

	await clickChrome(cancelButton(page));
	await expect(popover(page)).toHaveCount(0);
	const frame = await frameOf(page, 'a');
	const scrolled = await frame.evaluate(() => document.querySelector('#a-scroll')?.scrollTop ?? 0);
	await page.mouse.move(scrollLeft.x, scrollLeft.y);
	await page.mouse.wheel(0, 30);
	await expect
		.poll(() => frame.evaluate(() => document.querySelector('#a-scroll')?.scrollTop ?? 0))
		.toBeGreaterThan(scrolled);
	await nextAnimationFrame(page);
	await nextAnimationFrame(page);
	await expect(popover(page)).toHaveCount(0);
	// F-80: an in-flight re-post does not put the outline back either.
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(0);
});

const inside = (inner: Box, outer: Box): boolean =>
	inner.x >= outer.x &&
	inner.y >= outer.y &&
	inner.x + inner.width <= outer.x + outer.width &&
	inner.y + inner.height <= outer.y + outer.height;

test('a pick near the right and bottom edges keeps the popover inside the stage', async ({
	page,
}) => {
	await openTwoFrames(page);
	const stage = await stageBox(page);
	const corner = await pointInFrame(page, 'b', '#b-corner');
	expect(corner.x).toBeGreaterThan(stage.x + stage.width - 100);
	expect(corner.y).toBeGreaterThan(stage.y + stage.height - 100);
	await openPopoverOn({ page, frameId: 'b', selector: '#b-corner' });
	const box = await boxOf(popover(page));
	expect(inside(box, stage)).toBe(true);
	// Flipped to the left of and above the pick point.
	expect(box.x + box.width).toBeLessThan(corner.x);
	expect(box.y + box.height).toBeLessThan(corner.y);
});

test('a wheel or a drag on the popover never moves the stage', async ({ page }) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	const transform = await layerTransform(page);
	const hint = centerOf(await boxOf(popover(page).getByText('↑ parent · ↓ child')));
	await page.mouse.move(hint.x, hint.y);
	await page.mouse.wheel(0, 200);
	await page.mouse.down();
	await page.mouse.move(hint.x + 120, hint.y + 80);
	await page.mouse.up();
	await nextAnimationFrame(page);
	expect(await layerTransform(page)).toBe(transform);
});

test('a forged cd:key from the design never discards the open draft', async ({ page }) => {
	await openTwoFrames(page);
	await openPopoverOn({ page, selector: '#a-title' });
	await page.keyboard.type('Draft');
	const keys = (await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).length;
	await (
		await frameOf(page, 'a')
	).evaluate((type) => {
		window.parent.postMessage({ type, key: 'c' }, '*');
	}, FRAME_KEY_MESSAGE);
	await expect
		.poll(
			async () => (await messagesOfType({ page, frameId: 'a', type: FRAME_KEY_MESSAGE })).length,
		)
		.toBe(keys + 1);
	await nextAnimationFrame(page);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(commentBox(page)).toHaveValue('Draft');
});
