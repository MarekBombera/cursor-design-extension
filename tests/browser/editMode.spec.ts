import { expect, type Page, test } from '@playwright/test';

import { SOURCE_TAG_ATTRIBUTE } from '../../src/disk/layout';
import {
	FRAME_PICK_MESSAGE,
	type FramePickMessage,
	parseFrameMessage,
} from '../../src/webview/frame/frameMessages';
import {
	boxOf,
	canvasUpdated,
	centerOf,
	clickAt,
	clickChrome,
	commentButton,
	editButton,
	editFrame,
	enterEditMode,
	frameBox,
	frameElementBox,
	frameOf,
	inspector,
	loadsOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	type Point,
	popover,
	postToChrome,
	savedRecord,
	savedState,
	untilHeightReported,
} from './harness';

// 9d Edit mode + selection: the frame reports edit fields in Edit mode, and the inspector shows
// them in disabled fields.

const EDIT_FRAME = editFrame({ id: 'a', label: 'Edit' });

const openEditStage = async (page: Page): Promise<void> => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await untilHeightReported(page, 'a');
};

// Through the chrome's own guard: a captured pick is a wire value.
const picksOf = async (page: Page): Promise<FramePickMessage[]> =>
	(await messagesOfType({ page, frameId: 'a', type: FRAME_PICK_MESSAGE }))
		.map((data) => parseFrameMessage(data))
		.filter((message): message is FramePickMessage => message?.type === FRAME_PICK_MESSAGE);

const lastPick = async (page: Page): Promise<FramePickMessage | undefined> =>
	(await picksOf(page)).at(-1);

// Clicks a point inside the element; `at` picks a spot other than the centre (a fraction of the
// box), e.g. the right end of a button whose centre is over a child span.
const clickElement = async (
	page: Page,
	selector: string,
	at: Point = { x: 0.5, y: 0.5 },
): Promise<void> => {
	const picks = (await picksOf(page)).length;
	const box = await frameElementBox({ page, frameId: 'a', selector });
	await clickAt(page, { x: box.x + box.width * at.x, y: box.y + box.height * at.y });
	await expect.poll(async () => (await picksOf(page)).length).toBeGreaterThan(picks);
};

const sourceNumberOf = async (page: Page, selector: string): Promise<number> =>
	Number(await (await frameOf(page, 'a')).locator(selector).getAttribute(SOURCE_TAG_ATTRIBUTE));

const field = (page: Page, name: string) => inspector(page).getByLabel(name, { exact: true });

const selectParent = (page: Page) =>
	inspector(page).getByRole('button', { name: 'Select parent element' });

test('Edit mode shows the inspector and the hint, and only then does the frame pick', async ({
	page,
}) => {
	await openEditStage(page);
	await expect(inspector(page)).toHaveCount(0);
	const title = await frameElementBox({ page, frameId: 'a', selector: '#title' });
	await clickAt(page, centerOf(title));
	await nextAnimationFrame(page);
	expect(await picksOf(page)).toHaveLength(0);
	await enterEditMode(page);
	await expect(inspector(page)).toBeVisible();
	await expect(inspector(page).getByText('No element selected')).toBeVisible();
	await expect(page.locator('.mode-hint')).toContainText('Click an element to edit');
});

test('a plain-text pick reports its edit fields and fills disabled fields', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const pick = await lastPick(page);
	expect(pick?.edit).toEqual({
		sourceNumber: await sourceNumberOf(page, '#title'),
		sharedNumber: false,
		textState: 'plain',
		text: 'Title',
		style: 'font-size: 32px; color: #ff0000',
	});
	await expect(inspector(page).getByText('Edit › h1')).toBeVisible();
	await expect(field(page, 'Text')).toHaveValue('Title');
	await expect(field(page, 'Text')).toBeDisabled();
	await expect(field(page, 'Font size')).toHaveValue('32px');
	await expect(field(page, 'Font size')).toBeDisabled();
	await expect(field(page, 'Color')).toHaveValue('#ff0000');
	await expect(field(page, 'Color')).toBeDisabled();
	await expect(inspector(page).getByText('#ff0000', { exact: true })).toBeVisible();
	await expect(field(page, 'Padding')).toHaveValue('');
	await expect(field(page, 'Padding')).toHaveAttribute('placeholder', '0px');
	await expect(field(page, 'Margin')).toHaveValue('');
	await expect(field(page, 'Margin')).not.toHaveAttribute('placeholder', '');
});

test("Edit mode blocks the design's own clicks; Interact mode lets them through", async ({
	page,
}) => {
	await openEditStage(page);
	const clicks = (await frameOf(page, 'a')).locator('#clicks');
	await enterEditMode(page);
	await clickElement(page, '#mixed', { x: 0.9, y: 0.5 });
	await expect(clicks).toHaveText('0');
	await clickChrome(page.getByRole('button', { name: 'Interact', exact: true }));
	const button = await frameElementBox({ page, frameId: 'a', selector: '#mixed' });
	await clickAt(page, centerOf(button));
	await expect(clicks).toHaveText('1');
});

test('text: trimmed in the field, raw on the wire; mixed content and void elements get no field', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	expect((await lastPick(page))?.edit?.text).toBe('\n    Spaced text\n');
	await expect(field(page, 'Text')).toHaveValue('Spaced text');

	for (const selector of ['#mixed', '#commented']) {
		await clickElement(page, selector, { x: 0.9, y: 0.5 });
		expect((await lastPick(page))?.edit?.textState).toBe('children');
		await expect(
			inspector(page).getByText('Contains other elements: ask the Agent to change this text.'),
		).toBeVisible();
		await expect(field(page, 'Text')).toHaveCount(0);
	}

	await clickElement(page, '#picture');
	await expect(field(page, 'Font size')).toBeVisible();
	await expect(field(page, 'Text')).toHaveCount(0);
	await expect(inspector(page).getByText('Contains other elements')).toHaveCount(0);

	await clickElement(page, '#padded');
	await expect(field(page, 'Padding')).toHaveValue('8px 16px');
});

test('script-made and script-copied elements read not editable; a page click selects the page', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#made');
	expect((await lastPick(page))?.edit?.sourceNumber).toBeNull();
	await expect(
		inspector(page).getByText(
			"Not editable here: this element can't be matched to the artboard file.",
		),
	).toBeVisible();
	await expect(
		page.locator('[aria-live="polite"]').filter({ hasText: 'div element selected, not editable' }),
	).toHaveCount(1);
	for (const selector of ['#cloned', '#cloned-copy']) {
		await clickElement(page, selector);
		expect((await lastPick(page))?.edit?.sharedNumber).toBe(true);
		await expect(
			inspector(page).getByText('Not editable: a script copied this element'),
		).toBeVisible();
	}

	// Right of the button and its counter is the body's own line box: a page pick.
	const frame = await frameBox(page, 'a');
	const row = await frameElementBox({ page, frameId: 'a', selector: '#mixed' });
	const picks = (await picksOf(page)).length;
	await clickAt(page, { x: frame.x + 600, y: row.y + row.height / 2 });
	await expect.poll(async () => (await picksOf(page)).length).toBeGreaterThan(picks);
	const pagePick = await lastPick(page);
	expect(pagePick?.isPage).toBe(true);
	expect(pagePick?.edit?.textState).toBe('children');
	await expect(inspector(page).getByText('Edit › page')).toBeVisible();
});

test('↑ in the frame and Select parent step to the parent with fresh edit fields', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#go');
	expect((await lastPick(page))?.tagName).toBe('span');
	const picks = (await picksOf(page)).length;
	await page.keyboard.press('ArrowUp');
	await expect.poll(async () => (await picksOf(page)).length).toBeGreaterThan(picks);
	expect((await lastPick(page))?.tagName).toBe('button');
	expect((await lastPick(page))?.edit?.sourceNumber).toBe(await sourceNumberOf(page, '#mixed'));

	await clickElement(page, '#go');
	const before = (await picksOf(page)).length;
	await clickChrome(selectParent(page));
	await expect.poll(async () => (await picksOf(page)).length).toBeGreaterThan(before);
	expect((await lastPick(page))?.tagName).toBe('button');
	await expect(inspector(page).getByText('Edit › button')).toBeVisible();
});

test('Escape leaves Edit mode; from the inspector focus lands on the stage viewport', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await editButton(page).focus();
	await page.keyboard.press('Escape');
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(inspector(page)).toHaveCount(0);

	await enterEditMode(page);
	await clickElement(page, '#title');
	await selectParent(page).focus();
	await page.keyboard.press('Escape');
	await expect(inspector(page)).toHaveCount(0);
	await expect(page.locator('.viewport')).toBeFocused();
});

test('C in Edit mode enters Comment mode, whose picks carry no edit fields', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await editButton(page).focus();
	await page.keyboard.press('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(inspector(page)).toHaveCount(0);
	await clickElement(page, '#title');
	expect((await lastPick(page))?.edit).toBeUndefined();
	await expect(popover(page)).toBeVisible();
});

test('Comment mode: a forged pick carrying edit fields opens no popover and draws no outline', async ({
	page,
}) => {
	await openEditStage(page);
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	const forged = {
		type: FRAME_PICK_MESSAGE,
		selector: '#title',
		tagName: 'h1',
		text: 'Title',
		rect: { x: 0, y: 0, width: 200, height: 40 },
		point: { x: 1, y: 1 },
		box: { width: 200, height: 40 },
		styles: {},
		isPage: false,
		repost: false,
		edit: { sourceNumber: 1, sharedNumber: false, textState: 'plain', text: 'Title', style: null },
	};
	// Well formed: only the acceptance rule can drop it.
	expect(parseFrameMessage(forged)).toBeDefined();
	await (
		await frameOf(page, 'a')
	).evaluate((message) => {
		window.parent.postMessage(message, '*');
	}, forged);
	await expect.poll(async () => (await picksOf(page)).length).toBe(1);
	await nextAnimationFrame(page);
	await expect(popover(page)).toHaveCount(0);
	await expect(page.locator('.overlay .outline.pick')).toHaveCount(0);
});

test('a frame reload clears the pick and keeps focus on the Select parent button', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await expect(field(page, 'Text')).toHaveValue('Title');
	await selectParent(page).focus();
	const loads = await loadsOf(page, 'a');
	await postToChrome(
		page,
		canvasUpdated([{ ...EDIT_FRAME, html: `${EDIT_FRAME.html}<!-- v2 -->`, generation: 2 }]),
	);
	await expect.poll(async () => loadsOf(page, 'a')).toBeGreaterThan(loads);
	await expect(inspector(page).getByText('No element selected')).toBeVisible();
	await expect(selectParent(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(selectParent(page)).toBeFocused();
});

test('a tab switch keeps Edit mode; leaving it is saved too', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	expect((await savedRecord(page)).mode).toBe('edit');
	await openHarness(page, { state: await savedState(page) });
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await untilHeightReported(page, 'a');
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(inspector(page).getByText('No element selected')).toBeVisible();

	await clickChrome(page.getByRole('button', { name: 'Interact', exact: true }));
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'false');
	expect('mode' in (await savedRecord(page))).toBe(false);
	await openHarness(page, { state: await savedState(page) });
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await untilHeightReported(page, 'a');
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(inspector(page)).toHaveCount(0);
	await expect(boxOf(page.locator('.viewport'))).resolves.toBeDefined();
});
