import { expect, type Page, test } from '@playwright/test';

import { parseArtboardDocument } from '../../src/disk/commentTarget';
import {
	MAX_EDIT_TEXT_CHARS,
	MAX_PICK_STYLE_CHARS,
	SOURCE_TAG_ATTRIBUTE,
} from '../../src/disk/layout';
import { sourceTaggedHtml } from '../../src/disk/sourceTags';
import { FIELD_ERROR_COPY } from '../../src/webview/editDrafts';
import { NOT_SAVED_COPY } from '../../src/webview/editRequests';
import { FRAME_PICK_MESSAGE, parseFrameMessage } from '../../src/webview/frame/frameMessages';
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
	isMessageOfType,
	lastPick,
	inspector,
	loadsOf,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	picksOf,
	type Point,
	popover,
	posted,
	postToChrome,
	readEditFixture,
	reload,
	savedRecord,
	untilHeightReported,
} from './harness';

const EDIT_FRAME = editFrame({ id: 'a', label: 'Edit' });

const openEditStage = async (page: Page): Promise<void> => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await untilHeightReported(page, 'a');
};

// Clicks a point inside the element; `at` picks a spot other than the centre (a fraction of the
// box), e.g. the right end of a button whose centre is over a child span.
const clickElement = async (
	page: Page,
	selector: string,
	at: Point = { x: 0.5, y: 0.5 },
): Promise<void> => {
	const picks = (await picksOf(page, 'a')).length;
	const box = await frameElementBox({ page, frameId: 'a', selector });
	await clickAt(page, { x: box.x + box.width * at.x, y: box.y + box.height * at.y });
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBeGreaterThan(picks);
};

const sourceNumberOf = async (page: Page, selector: string): Promise<number> =>
	Number(await (await frameOf(page, 'a')).locator(selector).getAttribute(SOURCE_TAG_ATTRIBUTE));

// By data-cd-field: a field's accessible name changes when it becomes set.
const field = (page: Page, name: string) => inspector(page).locator(`[data-cd-field="${name}"]`);

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
	expect(await picksOf(page, 'a')).toHaveLength(0);
	await enterEditMode(page);
	await expect(inspector(page)).toBeVisible();
	await expect(inspector(page).getByText('No element selected')).toBeVisible();
	await expect(page.locator('.mode-hint')).toContainText('Click an element to edit');
});

test('a plain-text pick reports its edit fields and fills enabled fields', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const pick = await lastPick(page, 'a');
	expect(pick?.edit).toEqual({
		sourceNumber: await sourceNumberOf(page, '#title'),
		sharedNumber: false,
		textState: 'plain',
		text: 'Title',
		style: 'font-size: 32px; color: #ff0000',
		computed: expect.any(Object),
	});
	await expect(inspector(page).getByText('Edit › h1')).toBeVisible();
	await expect(field(page, 'text')).toHaveValue('Title');
	await expect(field(page, 'text')).toBeEnabled();
	await expect(field(page, 'font-size')).toHaveValue('32px');
	await expect(field(page, 'font-size')).toBeEnabled();
	await expect(field(page, 'color')).toHaveValue('#ff0000');
	await expect(field(page, 'color')).toBeEnabled();
	await expect(field(page, 'padding')).toHaveValue('');
	await expect(field(page, 'padding')).toHaveAttribute('placeholder', '0px');
	await expect(field(page, 'margin')).toHaveValue('');
	await expect(field(page, 'margin')).not.toHaveAttribute('placeholder', '');
});

test("a pick reports the edit target's computed edit field values", async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const edit = (await lastPick(page, 'a'))?.edit;
	expect(edit?.textState).toBe('plain');
	expect(edit?.computed).toEqual(
		expect.objectContaining({ 'font-size': '32px', 'font-weight': '700', 'text-align': 'start' }),
	);
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

const MIXED_HINT = 'To change these words, ask the Agent or select a part that holds only text.';

const sectionTitles = (page: Page) => inspector(page).locator('section h3');

test('text: trimmed in the field, raw on the wire; mixed content and void elements get no field', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	expect((await lastPick(page, 'a'))?.edit?.text).toBe('\n    Spaced text\n');
	await expect(field(page, 'text')).toHaveValue('Spaced text');

	for (const selector of ['#mixed', '#commented']) {
		await clickElement(page, selector, { x: 0.9, y: 0.5 });
		expect((await lastPick(page, 'a'))?.edit?.textState).toBe('mixed');
		await expect(inspector(page).getByText(MIXED_HINT)).toBeVisible();
		await expect(field(page, 'text')).toHaveCount(0);
	}

	await clickElement(page, '#picture');
	await expect(field(page, 'font-size')).toHaveCount(0);
	await expect(field(page, 'text')).toHaveCount(0);
	await expect(inspector(page).getByText(MIXED_HINT)).toHaveCount(0);

	await clickElement(page, '#padded');
	await expect(field(page, 'padding')).toHaveValue('8px 16px');
});

test('each selection kind shows its sections', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await expect(sectionTitles(page)).toHaveText(['Text', 'Appearance', 'Spacing', 'Border']);
	await expect(field(page, 'text')).toHaveValue('Title');
	await expect(field(page, 'gap')).toHaveCount(0);

	await clickElement(page, '#mixed', { x: 0.9, y: 0.5 });
	await expect(sectionTitles(page)).toHaveText(['Typography', 'Appearance', 'Spacing', 'Border']);
	await expect(inspector(page).getByText(MIXED_HINT)).toBeVisible();
	await expect(field(page, 'text')).toHaveCount(0);
	await expect(field(page, 'font-size')).toBeVisible();

	// A flex container: no text section; Gap shows with its computed value.
	await clickElement(page, '#row');
	await expect(sectionTitles(page)).toHaveText(['Appearance', 'Spacing', 'Border']);
	await expect(field(page, 'gap')).toHaveAttribute('placeholder', '12px');

	// A void element: its background parent is not a set Background (D2), so the computed colour is
	// the placeholder.
	await clickElement(page, '#picture');
	await expect(sectionTitles(page)).toHaveText(['Appearance', 'Spacing', 'Border']);
	await expect(field(page, 'background-color')).toHaveValue('');
	await expect(field(page, 'background-color')).toHaveAttribute('placeholder', '#cccccc');
	await expect(field(page, 'background-color')).toHaveAccessibleName('Background');
});

test('too-long text with a too-long style shows the style message alone', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await (await frameOf(page, 'a')).locator('#spaced').evaluate(
		(element, { text, style }) => {
			element.textContent = 'a'.repeat(text + 1);
			element.setAttribute('style', `--x: ${'a'.repeat(style)}`);
		},
		{ text: MAX_EDIT_TEXT_CHARS, style: MAX_PICK_STYLE_CHARS },
	);
	await clickElement(page, '#spaced');
	await expect(inspector(page).getByText(/style attribute is too long/)).toBeVisible();
	await expect(inspector(page).getByText(/^This text is over/)).toHaveCount(0);
});

test('the field grid is one column when the inspector is under 260px', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const fieldBox = (name: string) =>
		boxOf(inspector(page).locator(`.field:has([data-cd-field="${name}"])`));
	// 296px: Size and Color side by side.
	expect((await fieldBox('color')).x).toBeGreaterThan((await fieldBox('font-size')).x);
	// 30% of 820px is about 246px.
	await page.setViewportSize({ width: 820, height: 720 });
	await expect.poll(async () => (await boxOf(inspector(page))).width).toBeLessThan(260);
	await expect.poll(async () => (await fieldBox('color')).x).toBe((await fieldBox('font-size')).x);
	expect((await fieldBox('color')).y).toBeGreaterThan((await fieldBox('font-size')).y);
});

test('script-made and script-copied elements read not editable; a page click selects the page', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#made');
	expect((await lastPick(page, 'a'))?.edit?.sourceNumber).toBeNull();
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
		expect((await lastPick(page, 'a'))?.edit?.sharedNumber).toBe(true);
		await expect(
			inspector(page).getByText('Not editable: a script copied this element'),
		).toBeVisible();
	}

	// Right of the button and its counter is the body's own line box: a page pick.
	const frame = await frameBox(page, 'a');
	const row = await frameElementBox({ page, frameId: 'a', selector: '#mixed' });
	const picks = (await picksOf(page, 'a')).length;
	await clickAt(page, { x: frame.x + 600, y: row.y + row.height / 2 });
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBeGreaterThan(picks);
	const pagePick = await lastPick(page, 'a');
	expect(pagePick?.isPage).toBe(true);
	expect(pagePick?.edit?.textState).toBe('elements');
	await expect(inspector(page).getByText('Edit › page')).toBeVisible();
});

test('↑ in the frame and Select parent step to the parent with fresh edit fields', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#go');
	expect((await lastPick(page, 'a'))?.tagName).toBe('span');
	const picks = (await picksOf(page, 'a')).length;
	await page.keyboard.press('ArrowUp');
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBeGreaterThan(picks);
	expect((await lastPick(page, 'a'))?.tagName).toBe('button');
	expect((await lastPick(page, 'a'))?.edit?.sourceNumber).toBe(
		await sourceNumberOf(page, '#mixed'),
	);

	await clickElement(page, '#go');
	const before = (await picksOf(page, 'a')).length;
	await clickChrome(selectParent(page));
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBeGreaterThan(before);
	expect((await lastPick(page, 'a'))?.tagName).toBe('button');
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
	expect((await lastPick(page, 'a'))?.edit).toBeUndefined();
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
		edit: {
			sourceNumber: 1,
			sharedNumber: false,
			textState: 'plain',
			text: 'Title',
			style: null,
			computed: { 'font-size': '32px' },
		},
	};
	// Well formed: only the acceptance rule can drop it.
	expect(parseFrameMessage(forged)).toBeDefined();
	await (
		await frameOf(page, 'a')
	).evaluate((message) => {
		window.parent.postMessage(message, '*');
	}, forged);
	await expect.poll(async () => (await picksOf(page, 'a')).length).toBe(1);
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
	await expect(field(page, 'text')).toHaveValue('Title');
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
	await reload(page);
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await untilHeightReported(page, 'a');
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(inspector(page).getByText('No element selected')).toBeVisible();

	await clickChrome(page.getByRole('button', { name: 'Interact', exact: true }));
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'false');
	expect('mode' in (await savedRecord(page))).toBe(false);
	await reload(page);
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await untilHeightReported(page, 'a');
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(inspector(page)).toHaveCount(0);
	await expect(boxOf(page.locator('.viewport'))).resolves.toBeDefined();
});

test('the first save drops the pre-9d commentMode key', async ({ page }) => {
	await openHarness(page, { state: { commentMode: true } });
	await expect.poll(async () => 'commentMode' in (await savedRecord(page))).toBe(false);
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'false');
});

const editsPosted = async (page: Page): Promise<Record<string, unknown>[]> =>
	(await posted(page)).filter((data): data is Record<string, unknown> =>
		isMessageOfType(data, 'artboard:edit'),
	);

// A field save posts its one change as `styles[0]`.
const firstStyle = (
	request: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined =>
	(request?.styles as Record<string, unknown>[] | undefined)?.[0];

// The host's answer: the fixture with `change` applied, tagged as panelFrameHtml tags it.
const editedAnswer = ({
	request,
	change,
	hash,
	generation,
}: {
	request: Record<string, unknown>;
	change: (html: string) => string;
	hash: string;
	generation: number;
}) => {
	const html = change(readEditFixture());
	return {
		type: 'artboard:edited' as const,
		requestId: String(request.requestId),
		frameId: 'a',
		hash,
		generation,
		html: sourceTaggedHtml({ html, document: parseArtboardDocument(html) }),
		canUndo: true,
		canRedo: false,
	};
};

const renamedTitle = (html: string): string => html.replace('>Title</h1>', '>New</h1>');

// An opening tag without its source number, as it reads in the disk HTML.
const stripTag = (tag: string): string => tag.replace(/ data-cd-src="\d+"/, '');

const inFrame = async (page: Page, selector: string) =>
	(await frameOf(page, 'a')).locator(selector);

// What the chrome would post to the frame, sent as the chrome (the frame's parent).
const postToFrame = (page: Page, message: unknown): Promise<void> =>
	page.evaluate((data) => {
		const iframe = document.querySelector<HTMLIFrameElement>('[data-cd-frame-id="a"] iframe');
		iframe?.contentWindow?.postMessage(data, '*');
	}, message);

test('cd:edit-apply previews text and style in Edit mode only, and re-posts the pick', async ({
	page,
}) => {
	await openEditStage(page);
	const title = await sourceNumberOf(page, '#title');
	await postToFrame(page, { type: 'cd:mode', mode: 'comment' });
	await postToFrame(page, { type: 'cd:edit-apply', sourceNumber: title, text: 'Ignored' });
	await nextAnimationFrame(page);
	await expect(await inFrame(page, '#title')).toHaveText('Title');
	await enterEditMode(page);
	await clickElement(page, '#title');
	const picks = (await picksOf(page, 'a')).length;
	await postToFrame(page, { type: 'cd:edit-apply', sourceNumber: title, text: 'Preview' });
	await postToFrame(page, { type: 'cd:edit-apply', sourceNumber: title, style: 'color: #00ff00' });
	await expect(await inFrame(page, '#title')).toHaveText('Preview');
	await expect(await inFrame(page, '#title')).toHaveAttribute('style', 'color: #00ff00');
	await expect.poll(async () => (await lastPick(page, 'a'))?.edit?.style).toBe('color: #00ff00');
	const after = await picksOf(page, 'a');
	expect(after.length).toBeGreaterThan(picks);
	expect(after.at(-1)?.repost).toBe(true);
	expect(after.at(-1)?.edit?.text).toBe('Preview');
	// An element without a style attribute reports '' (null means over the cap).
	await clickElement(page, '#spaced');
	expect((await lastPick(page, 'a'))?.edit?.style).toBe('');
});

test('a page pick refreshes after a preview of body', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await selectParent(page).click();
	await expect.poll(async () => (await lastPick(page, 'a'))?.isPage).toBe(true);
	const body = await sourceNumberOf(page, 'body');
	await postToFrame(page, { type: 'cd:edit-apply', sourceNumber: body, style: 'margin: 4px' });
	await expect.poll(async () => (await lastPick(page, 'a'))?.edit?.style).toBe('margin: 4px');
});

test('typing previews; blur saves once with the raw liveText; the answer and echo never reload', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const loads = await loadsOf(page, 'a');
	await field(page, 'text').fill('New');
	await expect(await inFrame(page, '#title')).toHaveText('New');
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'text').blur();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [request] = await editsPosted(page);
	expect(request).toMatchObject({
		frameId: 'a',
		sourceNumber: await sourceNumberOf(page, '#title'),
		hash: 'sha256:test',
		field: 'text',
		value: 'New',
		liveText: 'Title',
	});
	const answer = editedAnswer({
		request: request ?? {},
		change: renamedTitle,
		hash: 'sha256:new',
		generation: 2,
	});
	await postToChrome(page, answer);
	await postToChrome(
		page,
		canvasUpdated([{ ...EDIT_FRAME, html: answer.html, hash: 'sha256:new', generation: 2 }]),
	);
	// A refresh that read disk before the write: skipped.
	await postToChrome(page, canvasUpdated([EDIT_FRAME]));
	await nextAnimationFrame(page);
	expect(await loadsOf(page, 'a')).toBe(loads);
	await expect(await inFrame(page, '#title')).toHaveText('New');
	await expect(field(page, 'text')).toHaveValue('New');
	// An outside change still reloads.
	await postToChrome(
		page,
		canvasUpdated([
			{ ...EDIT_FRAME, html: `${answer.html}<p>agent</p>`, hash: 'sha256:agent', generation: 3 },
		]),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(loads + 1);
});

test('Enter commits font size and keeps focus; colour commits on change as #rrggbb', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await field(page, 'font-size').fill('16');
	await expect(await inFrame(page, '#title')).toHaveAttribute(
		'style',
		'font-size: 16px; color: #ff0000',
	);
	await field(page, 'font-size').press('Enter');
	await expect(field(page, 'font-size')).toBeFocused();
	await expect.poll(async () => firstStyle((await editsPosted(page)).at(-1))?.value).toBe('16');
	const [request] = await editsPosted(page);
	await postToChrome(
		page,
		editedAnswer({
			request: request ?? {},
			change: (html) => html.replace('font-size: 32px', 'font-size: 16px'),
			hash: 'sha256:size',
			generation: 2,
		}),
	);
	await expect(field(page, 'font-size')).toHaveValue('16px');
	await inspector(page).getByLabel('Color picker', { exact: true }).fill('#00ff00');
	await expect
		.poll(async () => firstStyle((await editsPosted(page)).at(-1))?.value)
		.toBe('#00ff00');
	expect((await editsPosted(page)).at(-1)?.hash).toBe('sha256:size');
});

test('an invalid value shows its error, posts nothing and restores the frame', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4');
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 4px');
	await field(page, 'padding').fill('4 apples;');
	await field(page, 'padding').blur();
	const error = inspector(page).getByText('Not saved: use a number');
	await expect(error).toBeVisible();
	await expect(field(page, 'padding')).toHaveAttribute('aria-invalid', 'true');
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 8px 16px');
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'padding').fill('4');
	await expect(error).toHaveCount(0);
});

test('a newline-only text change sends nothing; the next real edit saves', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	await field(page, 'text').fill('Spaced\ntext');
	await field(page, 'text').blur();
	await expect(await inFrame(page, '#spaced')).toHaveText('\n    Spaced text\n');
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'text').fill('Spaced!');
	await field(page, 'text').blur();
	await expect
		.poll(async () => (await editsPosted(page)).at(-1)?.liveText)
		.toBe('\n    Spaced text\n');
});

test('a refused save reloads once with the earlier adopted edit and shows the copy', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await field(page, 'text').fill('New');
	await field(page, 'text').blur();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [first] = await editsPosted(page);
	await postToChrome(
		page,
		editedAnswer({ request: first ?? {}, change: renamedTitle, hash: 'sha256:new', generation: 2 }),
	);
	await field(page, 'margin').fill('4');
	await field(page, 'margin').blur();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(2);
	const second = (await editsPosted(page)).at(-1);
	expect(second?.hash).toBe('sha256:new');
	const loads = await loadsOf(page, 'a');
	await postToChrome(page, {
		type: 'ui:error',
		requestId: String(second?.requestId),
		message: 'This artboard changed on disk. Make the edit again.',
	});
	await expect.poll(() => loadsOf(page, 'a')).toBe(loads + 1);
	await expect(await inFrame(page, '#title')).toHaveText('New');
	await expect(await inFrame(page, '#title')).not.toHaveAttribute('style', /margin/);
	await expect(inspector(page).getByText('This artboard changed on disk.')).toBeVisible();
});

test('two quick commits: one in flight, the second after the answer with its hash', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4');
	await field(page, 'margin').focus();
	await field(page, 'margin').fill('2');
	await field(page, 'margin').blur();
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(1);
	const [first] = await editsPosted(page);
	expect(firstStyle(first)?.field).toBe('padding');
	await postToChrome(
		page,
		editedAnswer({
			request: first ?? {},
			change: (html) => html.replace('padding: 8px 16px', 'padding: 4px'),
			hash: 'sha256:pad',
			generation: 2,
		}),
	);
	await expect.poll(async () => (await editsPosted(page)).length).toBe(2);
	expect((await editsPosted(page)).at(-1)).toMatchObject({
		styles: [{ field: 'margin', value: '2' }],
		hash: 'sha256:pad',
	});
});

test('a dirty field, then a click on another element, saves to the first element only', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await field(page, 'margin').fill('6');
	await clickElement(page, '#padded');
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	await nextAnimationFrame(page);
	const edits = await editsPosted(page);
	expect(edits).toHaveLength(1);
	expect(edits[0]).toMatchObject({
		sourceNumber: await sourceNumberOf(page, '#title'),
		styles: [{ field: 'margin', value: '6' }],
	});
	await expect(field(page, 'margin')).toHaveValue('');
});

test('an invalid value left by a click on another element names its own cause', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4 apples;');
	await clickElement(page, '#title');
	await expect(field(page, 'text')).toHaveValue('Title');
	await expect(
		inspector(page).locator('.request-error').getByText(FIELD_ERROR_COPY['invalid-length']),
	).toBeVisible();
	await expect(inspector(page).getByText(NOT_SAVED_COPY)).toHaveCount(0);
	expect(await editsPosted(page)).toHaveLength(0);
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 8px 16px');
});

test('a refused value, then a pick of another element, names its own cause', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4 apples;');
	await field(page, 'padding').press('Enter');
	await expect(inspector(page).getByText(FIELD_ERROR_COPY['invalid-length'])).toBeVisible();
	await clickElement(page, '#title');
	await expect(field(page, 'text')).toHaveValue('Title');
	await expect(
		inspector(page).locator('.request-error').getByText(FIELD_ERROR_COPY['invalid-length']),
	).toBeVisible();
	await expect(inspector(page).getByText(NOT_SAVED_COPY)).toHaveCount(0);
	expect(await editsPosted(page)).toHaveLength(0);
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 8px 16px');
});

test('an outside change while a field is dirty posts nothing and says Not saved', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await field(page, 'text').fill('Draft');
	await postToChrome(
		page,
		canvasUpdated([
			{
				...EDIT_FRAME,
				html: `${EDIT_FRAME.html}<p>agent</p>`,
				hash: 'sha256:agent',
				generation: 2,
			},
		]),
	);
	await expect(inspector(page).getByText(NOT_SAVED_COPY)).toBeVisible();
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(0);
});

test('C typed in a field stays in Edit mode', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'margin').focus();
	await page.keyboard.type('c');
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(inspector(page)).toBeVisible();
});

const historyPosted = async (page: Page): Promise<Record<string, unknown>[]> =>
	(await posted(page)).filter((data): data is Record<string, unknown> =>
		isMessageOfType(data, 'artboard:history'),
	);

const undoButton = (page: Page) => inspector(page).getByRole('button', { name: /^Undo/ });

const redoButton = (page: Page) => inspector(page).getByRole('button', { name: /^Redo/ });

const announcement = (page: Page) => inspector(page).locator('p.visually-hidden');

// One saved text edit on #title ("Title" → "New"), answered with canUndo.
const saveTitleEdit = async (page: Page): Promise<void> => {
	await clickElement(page, '#title');
	await field(page, 'text').fill('New');
	await field(page, 'text').blur();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [request] = await editsPosted(page);
	await postToChrome(
		page,
		editedAnswer({
			request: request ?? {},
			change: renamedTitle,
			hash: 'sha256:new',
			generation: 2,
		}),
	);
	await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'false');
};

// The host's answer to a step: the file it restored, and the flags after it.
const stepAnswer = ({
	request,
	html,
	hash,
	generation,
	canUndo,
	canRedo,
}: {
	request: Record<string, unknown> | undefined;
	html: string;
	hash: string;
	generation: number;
	canUndo: boolean;
	canRedo: boolean;
}) => ({
	type: 'artboard:edited' as const,
	requestId: String(request?.requestId),
	frameId: 'a',
	hash,
	generation,
	html,
	canUndo,
	canRedo,
});

test('Undo posts a step; its answer reloads the restored file, keeps the target and announces it', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await saveTitleEdit(page);
	await expect(undoButton(page)).toHaveAccessibleName('Undo in Edit');
	await expect(redoButton(page)).toHaveAttribute('aria-disabled', 'true');
	const loads = await loadsOf(page, 'a');
	await undoButton(page).click();
	await expect.poll(async () => (await historyPosted(page)).length).toBe(1);
	const [undo] = await historyPosted(page);
	expect(undo).toMatchObject({ type: 'artboard:history', frameId: 'a', step: 'undo' });
	expect(undo).not.toHaveProperty('hash');
	await postToChrome(
		page,
		stepAnswer({
			request: undo,
			html: EDIT_FRAME.html,
			hash: 'sha256:test',
			generation: 3,
			canUndo: false,
			canRedo: true,
		}),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(loads + 1);
	await expect(await inFrame(page, '#title')).toHaveText('Title');
	await expect(inspector(page).getByText('No element selected')).toBeVisible();
	// The pick dropped with the reload; the buttons still act on that frame.
	await expect(redoButton(page)).toHaveAccessibleName('Redo in Edit');
	await expect(redoButton(page)).toHaveAttribute('aria-disabled', 'false');
	await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(announcement(page)).toHaveText(/^Undone in Edit\.\s?$/);
	await redoButton(page).click();
	await expect.poll(async () => (await historyPosted(page)).length).toBe(2);
	expect((await historyPosted(page)).at(-1)).toMatchObject({ step: 'redo', frameId: 'a' });
});

test('a canvas:updated before the step answer reloads once; the answer still announces', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await saveTitleEdit(page);
	const loads = await loadsOf(page, 'a');
	await undoButton(page).click();
	await expect.poll(async () => (await historyPosted(page)).length).toBe(1);
	const [undo] = await historyPosted(page);
	// The watcher's refresh of the restored file wins the race and reloads the frame.
	await postToChrome(
		page,
		canvasUpdated([
			{ ...EDIT_FRAME, hash: 'sha256:restored', generation: 3, canUndo: false, canRedo: true },
		]),
	);
	await expect.poll(() => loadsOf(page, 'a')).toBe(loads + 1);
	await expect(await inFrame(page, '#title')).toHaveText('Title');
	// A reload is a new blob URL, set in the same flush as the announcement, so `src` sees it at once.
	const src = await page.locator('[data-cd-frame-id="a"] iframe').getAttribute('src');
	await postToChrome(
		page,
		stepAnswer({
			request: undo,
			html: EDIT_FRAME.html,
			hash: 'sha256:restored',
			generation: 3,
			canUndo: false,
			canRedo: true,
		}),
	);
	await expect(announcement(page)).toHaveText(/^Undone in Edit\.\s?$/);
	expect(await page.locator('[data-cd-frame-id="a"] iframe').getAttribute('src')).toBe(src);
	expect(await loadsOf(page, 'a')).toBe(loads + 1);
	await expect(redoButton(page)).toHaveAttribute('aria-disabled', 'false');
});

test('an open text draft is saved first; the step goes out only after that answer', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await saveTitleEdit(page);
	await clickElement(page, '#title');
	await field(page, 'text').fill('Newer');
	await undoButton(page).click();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(2);
	await nextAnimationFrame(page);
	expect(await historyPosted(page)).toHaveLength(0);
	const second = (await editsPosted(page)).at(-1);
	expect(second).toMatchObject({ field: 'text', value: 'Newer', hash: 'sha256:new' });
	await postToChrome(
		page,
		editedAnswer({
			request: second ?? {},
			change: (html) => html.replace('>Title</h1>', '>Newer</h1>'),
			hash: 'sha256:newer',
			generation: 3,
		}),
	);
	await expect.poll(async () => (await historyPosted(page)).length).toBe(1);
	expect((await historyPosted(page))[0]).toMatchObject({ step: 'undo', frameId: 'a' });
});

test('Undo without history ignores a click and keeps focus; a post without the flag disables it', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await expect(undoButton(page)).toHaveAccessibleName('Undo');
	await clickElement(page, '#title');
	await expect(undoButton(page)).toHaveAccessibleName('Undo in Edit');
	// Playwright refuses to click an aria-disabled button; Enter activates it the same way.
	await undoButton(page).focus();
	await page.keyboard.press('Enter');
	await nextAnimationFrame(page);
	expect(await historyPosted(page)).toHaveLength(0);
	await expect(undoButton(page)).toBeFocused();

	await saveTitleEdit(page);
	const [request] = await editsPosted(page);
	const answered = editedAnswer({
		request: request ?? {},
		change: renamedTitle,
		hash: 'sha256:new',
		generation: 2,
	});
	// The echo after an outside forget carries no undo step: the button follows the host.
	await postToChrome(
		page,
		canvasUpdated([
			{ ...EDIT_FRAME, html: answered.html, hash: 'sha256:new', generation: 2, canUndo: false },
		]),
	);
	await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');
});

// Keyboard steps: only the paths that work in Cursor under F5 are tested here.

const focusFrame = (page: Page, frameId: string): Promise<void> =>
	page.locator(`[data-cd-frame-id="${frameId}"] iframe`).focus();

// What a design's own script can do: post cd:key from its window, whatever has focus.
const forgeFrameKey = async (page: Page, frameId: string, key: string): Promise<void> => {
	const frame = await frameOf(page, frameId);
	await frame.evaluate(
		(data) => {
			window.parent.postMessage(data, '*');
		},
		{ type: 'cd:key', key },
	);
};

test('Cmd/Ctrl+Z steps from the Undo button and the focused history frame; forged keys do nothing', async ({
	page,
}) => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(
		page,
		canvasUpdated([EDIT_FRAME, { ...editFrame({ id: 'b', label: 'Other' }), x: 1000 }]),
	);
	await untilHeightReported(page, 'a');
	await untilHeightReported(page, 'b');
	await enterEditMode(page);
	await saveTitleEdit(page);
	// Forged: from the history frame without focus, and from another frame with focus.
	await undoButton(page).focus();
	await forgeFrameKey(page, 'a', 'undo');
	await focusFrame(page, 'b');
	await forgeFrameKey(page, 'b', 'undo');
	await nextAnimationFrame(page);
	expect(await historyPosted(page)).toHaveLength(0);

	await undoButton(page).focus();
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(async () => (await historyPosted(page)).length).toBe(1);
	const [undo] = await historyPosted(page);
	expect(undo).toMatchObject({ step: 'undo', frameId: 'a' });
	await postToChrome(
		page,
		stepAnswer({
			request: undo,
			html: EDIT_FRAME.html,
			hash: 'sha256:test',
			generation: 3,
			canUndo: false,
			canRedo: true,
		}),
	);
	await expect(redoButton(page)).toHaveAttribute('aria-disabled', 'false');
	await untilHeightReported(page, 'a');
	await focusFrame(page, 'a');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect.poll(async () => (await historyPosted(page)).length).toBe(2);
	expect((await historyPosted(page)).at(-1)).toMatchObject({ step: 'redo', frameId: 'a' });
});

test('Cmd/Ctrl+Z in the Text field stays the field’s own undo', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await saveTitleEdit(page);
	await field(page, 'text').focus();
	await page.keyboard.press('ControlOrMeta+z');
	await nextAnimationFrame(page);
	expect(await historyPosted(page)).toHaveLength(0);
});

test('a pick from a frame without focus never retargets Undo / Redo', async ({ page }) => {
	await openHarness(page, { savedView: { x: 0, y: 0, zoom: 1 } });
	await postToChrome(
		page,
		canvasUpdated([EDIT_FRAME, { ...editFrame({ id: 'b', label: 'Other' }), x: 1000 }]),
	);
	await untilHeightReported(page, 'a');
	await untilHeightReported(page, 'b');
	await enterEditMode(page);
	await saveTitleEdit(page);
	await expect(undoButton(page)).toHaveAccessibleName('Undo in Edit');
	// A design script in frame b replays a real Edit-mode pick from its own window.
	const [pickData] = (await messagesOfType({ page, frameId: 'a', type: FRAME_PICK_MESSAGE })).slice(
		-1,
	);
	const forgePick = async (): Promise<void> => {
		const frame = await frameOf(page, 'b');
		await frame.evaluate(
			(data) => {
				window.parent.postMessage(data, '*');
			},
			{ ...(pickData as Record<string, unknown>), repost: false },
		);
	};
	await undoButton(page).focus();
	await forgePick();
	await nextAnimationFrame(page);
	await expect(undoButton(page)).toHaveAccessibleName('Undo in Edit');
	// The same pick from the frame that holds focus moves the target (b has no history).
	await focusFrame(page, 'b');
	await forgePick();
	await expect(undoButton(page)).toHaveAccessibleName('Undo in Other');
	await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');
});

test('every text-box field previews and saves exactly one change', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	const cases = [
		{ selector: '#title', field: 'font-size', value: '20px' },
		{ selector: '#title', field: 'color', value: '#0000ff' },
		{ selector: '#title', field: 'line-height', value: '2' },
		{ selector: '#title', field: 'letter-spacing', value: '1px' },
		{ selector: '#title', field: 'background-color', value: 'transparent' },
		{ selector: '#title', field: 'border-radius', value: '4px' },
		{ selector: '#title', field: 'opacity', value: '0.5' },
		{ selector: '#title', field: 'padding', value: '4px' },
		{ selector: '#title', field: 'margin', value: '2px' },
		{ selector: '#row', field: 'gap', value: '6px' },
		{ selector: '#boxed', field: 'border-width', value: '2px' },
		{ selector: '#boxed', field: 'border-color', value: '#00ff00' },
	];
	let html = readEditFixture();
	let picked = '';
	for (const [index, { selector, field: name, value }] of cases.entries()) {
		if (picked !== selector) {
			await clickElement(page, selector);
			picked = selector;
		}
		const element = await inFrame(page, selector);
		const before = await element.evaluate((node) =>
			node.outerHTML.slice(0, node.outerHTML.indexOf('>') + 1),
		);
		await field(page, name).fill(value);
		await expect(element).toHaveAttribute('style', new RegExp(`${name}: ${value}`));
		await field(page, name).press('Enter');
		await expect.poll(async () => (await editsPosted(page)).length).toBe(index + 1);
		const request = (await editsPosted(page)).at(-1);
		expect(request?.styles).toEqual([{ field: name, value }]);
		// The host's answer holds the previewed element, so it adopts without a reload.
		const after = await element.evaluate((node) =>
			node.outerHTML.slice(0, node.outerHTML.indexOf('>') + 1),
		);
		html = html.replace(stripTag(before), stripTag(after));
		const written = html;
		await postToChrome(
			page,
			editedAnswer({
				request: request ?? {},
				change: () => written,
				hash: `sha256:${index}`,
				generation: index + 2,
			}),
		);
	}
});

test('a colour clears from its text box', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await field(page, 'color').fill('');
	await field(page, 'color').blur();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([{ field: 'color', value: '' }]);
	await expect(await inFrame(page, '#title')).toHaveAttribute('style', 'font-size: 32px;');
});

test('a refused value shows its own field copy, right after the field', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const cases = [
		{ name: 'opacity', value: '2', copy: FIELD_ERROR_COPY['invalid-opacity'] },
		{ name: 'color', value: 'red', copy: FIELD_ERROR_COPY['invalid-color'] },
		{ name: 'line-height', value: '-1', copy: FIELD_ERROR_COPY['invalid-leading'] },
	];
	for (const { name, value, copy } of cases) {
		await field(page, name).fill(value);
		await field(page, name).press('Enter');
		await expect(field(page, name)).toHaveAttribute('aria-invalid', 'true');
		const describedBy = await field(page, name).getAttribute('aria-describedby');
		await expect(inspector(page).locator(`[id="${describedBy}"]`)).toHaveText(copy);
		// One error at a time: the next field's draft ends this one silently.
		await expect(inspector(page).getByText(/^Not saved:/)).toHaveCount(1);
	}
	expect(await editsPosted(page)).toHaveLength(0);
});

test('a set field shows the dot, full text and the set name', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const size = field(page, 'font-size');
	await expect(size).toHaveValue('32px');
	await expect(size).toHaveAccessibleName('Size (set on this element)');
	await expect(size.locator('..')).toHaveClass(/\bis-set\b/);
	await expect(field(page, 'padding')).toHaveAccessibleName('Padding');
	await expect(field(page, 'padding').locator('..')).not.toHaveClass(/\bis-set\b/);
	// The computed value reads as secondary text, never the low-contrast global placeholder.
	const colours = await field(page, 'padding').evaluate((input) => {
		const probe = document.createElement('span');
		probe.style.color = 'var(--cd-fg-2)';
		input.parentElement?.append(probe);
		const expected = getComputedStyle(probe).color;
		probe.remove();
		return { placeholder: getComputedStyle(input, '::placeholder').color, expected };
	});
	expect(colours.placeholder).toBe(colours.expected);
});

test("a new draft ends the element's other open draft", async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4 apples;');
	await field(page, 'padding').press('Enter');
	const error = inspector(page).getByText(FIELD_ERROR_COPY['invalid-length']);
	await expect(error).toBeVisible();
	await field(page, 'margin').fill('2');
	await expect(error).toHaveCount(0);
	await expect(field(page, 'padding')).toHaveValue('8px 16px');
	await expect(field(page, 'padding')).toHaveAttribute('aria-invalid', 'false');
	await expect(inspector(page).locator('.request-error')).toHaveCount(0);
	expect(await editsPosted(page)).toHaveLength(0);
});

// The host's answer to the last edit: the fixture with `selector`'s opening tag as the frame now
// shows it, so the chrome adopts it without a reload.
const answerFromFrame = async ({
	page,
	selector,
	request,
	generation,
}: {
	page: Page;
	selector: `#${string}`;
	request: Record<string, unknown> | undefined;
	generation: number;
}): Promise<void> => {
	const tag = await (
		await inFrame(page, selector)
	).evaluate((node) => node.outerHTML.slice(0, node.outerHTML.indexOf('>') + 1));
	const opening = new RegExp(`<[^>]*\\bid="${selector.slice(1)}"[^>]*>`);
	const html = readEditFixture().replace(opening, stripTag(tag));
	await postToChrome(
		page,
		editedAnswer({
			request: request ?? {},
			change: () => html,
			hash: `sha256:${generation}`,
			generation,
		}),
	);
};

const sectionAction = (page: Page, name: string) =>
	inspector(page).getByRole('button', { name, exact: true });

test('a select saves one change, previews first, and always shows the computed option', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	const weight = field(page, 'font-weight');
	await expect(weight).toHaveValue('400');
	const loads = await loadsOf(page, 'a');
	await weight.selectOption('700');
	// The preview lands before any answer; the re-post moves the select to Bold.
	await expect(await inFrame(page, '#spaced')).toHaveAttribute('style', 'font-weight: 700');
	await expect(weight).toHaveValue('700');
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [request] = await editsPosted(page);
	expect(request?.styles).toEqual([{ field: 'font-weight', value: '700' }]);
	await answerFromFrame({ page, selector: '#spaced', request, generation: 2 });
	await nextAnimationFrame(page);
	expect(await loadsOf(page, 'a')).toBe(loads);
	await expect(weight).toHaveValue('700');
});

test('a choice equal to the inline value posts nothing and the select keeps the computed option', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	// font-weight: 700 inline, but 400 !important from the style block.
	await clickElement(page, '#heavy');
	const weight = field(page, 'font-weight');
	await expect(weight).toHaveValue('400');
	await weight.selectOption('700');
	await expect(weight).toHaveValue('400');
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(0);
});

test('an out-of-list value shows as an extra option and choosing it posts nothing', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#ruled');
	const style = field(page, 'border-style');
	const extra = await style.inputValue();
	expect(['none', 'solid', 'dashed', 'dotted', 'double']).not.toContain(extra);
	await style.selectOption('none');
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	await style.selectOption(extra);
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(1);
});

test('U then S combine; S again leaves underline; a pressed inherited Align saves', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	const textStyle = field(page, 'text-style');
	await expect(textStyle).toHaveRole('group');
	await expect(textStyle).toHaveAccessibleName('Text style');
	const underline = textStyle.getByRole('button', { name: 'Underline' });
	const strike = textStyle.getByRole('button', { name: 'Strikethrough' });
	const steps = [
		{ button: underline, value: 'underline' },
		{ button: strike, value: 'underline line-through' },
		{ button: strike, value: 'underline' },
	];
	for (const [index, { button, value }] of steps.entries()) {
		await button.click();
		await expect.poll(async () => (await editsPosted(page)).length).toBe(index + 1);
		const request = (await editsPosted(page)).at(-1);
		expect(request?.styles).toEqual([{ field: 'text-decoration-line', value }]);
		await expect(underline).toHaveAttribute('aria-pressed', 'true');
		await expect(strike).toHaveAttribute('aria-pressed', String(value.includes('line-through')));
		await answerFromFrame({ page, selector: '#spaced', request, generation: index + 2 });
	}
	await expect(textStyle).toHaveAccessibleName('Text style (set on this element)');
	// Left is pressed but inherited (start); clicking it still pins it.
	const left = field(page, 'align').getByRole('button', { name: 'Align left' });
	await expect(left).toHaveAttribute('aria-pressed', 'true');
	await left.click();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(4);
	expect((await editsPosted(page)).at(-1)?.styles).toEqual([
		{ field: 'text-align', value: 'left' },
	]);
});

test('a choice ends an invalid draft silently; the next draft keeps the choice in its baseline', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4 apples;');
	await field(page, 'padding').press('Enter');
	await expect(inspector(page).getByText(FIELD_ERROR_COPY['invalid-length'])).toBeVisible();
	await field(page, 'font-weight').selectOption('700');
	await expect(inspector(page).getByText(/^Not saved:/)).toHaveCount(0);
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([{ field: 'font-weight', value: '700' }]);
	await expect(field(page, 'font-weight')).toHaveValue('700');
	await field(page, 'padding').fill('4');
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', /font-weight: 700/);
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', /padding: 4/);
});

test('a choice saves a valid open draft first, then itself on top of it', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	// The swatch's input previews with no blur commit, so the colour draft stays open.
	await inspector(page)
		.getByLabel('Color picker', { exact: true })
		.evaluate((swatch: HTMLInputElement) => {
			swatch.value = '#00ff00';
			swatch.dispatchEvent(new Event('input', { bubbles: true }));
		});
	await expect
		.poll(async () => (await lastPick(page, 'a'))?.edit?.style)
		.toBe('font-size: 32px; color: #00ff00');
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'font-weight').selectOption('700');
	await expect(await inFrame(page, '#title')).toHaveAttribute(
		'style',
		'font-size: 32px; color: #00ff00; font-weight: 700',
	);
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [colour] = await editsPosted(page);
	expect(colour?.styles).toEqual([{ field: 'color', value: '#00ff00' }]);
	await answerFromFrame({ page, selector: '#title', request: colour, generation: 2 });
	await expect.poll(async () => (await editsPosted(page)).length).toBe(2);
	expect((await editsPosted(page))[1]?.styles).toEqual([{ field: 'font-weight', value: '700' }]);
});

test("a choice keeps a style change the design's script made after the pick", async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	const changed = 'font-size: 32px; color: #ff0000; margin: 7px';
	await (
		await inFrame(page, '#title')
	).evaluate((element, style) => {
		element.setAttribute('style', style);
	}, changed);
	// A click or Tab onto the select focuses it before the choice: the pick is re-described.
	await field(page, 'font-weight').focus();
	await expect.poll(async () => (await lastPick(page, 'a'))?.edit?.style).toBe(changed);
	await field(page, 'font-weight').selectOption('700');
	await expect(await inFrame(page, '#title')).toHaveAttribute(
		'style',
		`${changed}; font-weight: 700`,
	);
});

test('a choice whose style would pass the cap posts nothing and says why', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	const style = `--x: ${'a'.repeat(MAX_PICK_STYLE_CHARS - 6)}`;
	await (
		await inFrame(page, '#spaced')
	).evaluate((element, value) => {
		element.setAttribute('style', value);
	}, style);
	await clickElement(page, '#spaced');
	await field(page, 'font-weight').selectOption('700');
	await expect(inspector(page).getByText(FIELD_ERROR_COPY['complex-style'])).toBeVisible();
	await expect(await inFrame(page, '#spaced')).toHaveAttribute('style', style);
	expect(await editsPosted(page)).toHaveLength(0);
});

test('Reset Text clears the nine text fields in one save and one undo step', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#styled');
	await sectionAction(page, 'Reset Text').click();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [request] = await editsPosted(page);
	expect(request?.styles).toEqual(
		[
			'font-size',
			'color',
			'font-weight',
			'font-style',
			'text-decoration-line',
			'text-align',
			'line-height',
			'letter-spacing',
			'text-transform',
		].map((name) => ({ field: name, value: '' })),
	);
	await expect(announcement(page)).toHaveText(/^Text reset\.\s?$/);
	await expect(sectionAction(page, 'Reset Text')).toHaveAttribute('aria-disabled', 'true');
	await expect(sectionAction(page, 'Reset Text')).toBeFocused();
	await answerFromFrame({ page, selector: '#styled', request, generation: 2 });
	await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'false');
	await undoButton(page).click();
	await expect.poll(async () => (await historyPosted(page)).length).toBe(1);
	expect(await editsPosted(page)).toHaveLength(1);
});

test('a disabled Reset posts nothing and keeps focus', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#mixed', { x: 0.9, y: 0.5 });
	const reset = sectionAction(page, 'Reset Appearance');
	await expect(reset).toHaveText('Reset');
	await expect(reset).toHaveAttribute('aria-disabled', 'true');
	// Playwright refuses to click an aria-disabled button unless forced; the click is real.
	await reset.click({ force: true });
	await expect(reset).toBeFocused();
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(0);
});

test('Add border saves width and style once, focuses Width and announces it', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	await expect(field(page, 'border-width')).toHaveCount(0);
	// A double-click: the second click lands after the label flipped to Reset.
	await sectionAction(page, 'Add border').dblclick();
	await expect(field(page, 'border-width')).toBeFocused();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([
		{ field: 'border-width', value: '1px' },
		{ field: 'border-style', value: 'solid' },
	]);
	await expect(announcement(page)).toHaveText(/^Border added\.\s?$/);
	// One in flight: a second save would wait for this answer, then go out.
	const [request] = await editsPosted(page);
	await answerFromFrame({ page, selector: '#spaced', request, generation: 2 });
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(1);
});

test('Reset Border on a border shorthand clears all three and keeps focus on the button', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#boxed');
	const button = page.locator('[data-cd-section="border"] .section-head button');
	await expect(button).toHaveAccessibleName('Reset Border');
	await button.click();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([
		{ field: 'border-width', value: '' },
		{ field: 'border-style', value: '' },
		{ field: 'border-color', value: '' },
	]);
	await expect(button).toHaveAccessibleName('Add border');
	await expect(button).toHaveText('Add border');
	await expect(button).toBeFocused();
});

test('a held Enter on a segment button saves once', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	const underline = field(page, 'text-style').getByRole('button', { name: 'Underline' });
	await underline.focus();
	await page.keyboard.down('Enter');
	await expect(underline).toHaveAttribute('aria-pressed', 'true');
	// Key auto-repeat: keydown with repeat true, which Chromium activates buttons on.
	await page.keyboard.down('Enter');
	await page.keyboard.down('Enter');
	await page.keyboard.up('Enter');
	await nextAnimationFrame(page);
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [request] = await editsPosted(page);
	// A repeat's save would wait behind this one: it goes out on the answer.
	await answerFromFrame({ page, selector: '#spaced', request, generation: 2 });
	await nextAnimationFrame(page);
	await expect(underline).toHaveAttribute('aria-pressed', 'true');
	expect(await editsPosted(page)).toHaveLength(1);
});

test('a held Enter on Reset Border saves Reset only', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#boxed');
	const button = page.locator('[data-cd-section="border"] .section-head button');
	await button.focus();
	await page.keyboard.down('Enter');
	await expect(button).toHaveAccessibleName('Add border');
	// Key auto-repeat: keydown with repeat true, which Chromium activates buttons on.
	await page.keyboard.down('Enter');
	await page.keyboard.down('Enter');
	await page.keyboard.up('Enter');
	await nextAnimationFrame(page);
	await expect(button).toHaveAccessibleName('Add border');
	await expect(button).toBeFocused();
	await expect(announcement(page)).toHaveText(/^Border reset\.\s?$/);
	expect(await editsPosted(page)).toHaveLength(1);
});

// The emptied box's preview re-posts the pick without the declaration: the draft keeps the field.
const emptyWhileDrafted = async (page: Page, selector: string, name: string): Promise<void> => {
	await clickElement(page, selector);
	await field(page, name).fill('');
	await expect.poll(async () => (await lastPick(page, 'a'))?.edit?.style).toBe('');
	await nextAnimationFrame(page);
	await expect(field(page, name)).toBeFocused();
	expect(await editsPosted(page)).toHaveLength(0);
};

test('a click on another field after emptying Width keeps that focus', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await emptyWhileDrafted(page, '#widthonly', 'border-width');
	await field(page, 'font-size').click();
	await expect(field(page, 'border-width')).toHaveCount(0);
	await expect(field(page, 'font-size')).toBeFocused();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(1);
});

test('an emptied border field stays while drafted; Enter saves once and focuses Add border', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await emptyWhileDrafted(page, '#widthonly', 'border-width');
	await expect(field(page, 'border-style')).toHaveCount(1);
	await expect(field(page, 'border-color')).toHaveCount(1);
	await expect(sectionAction(page, 'Reset Border')).toHaveCount(1);
	await field(page, 'border-width').press('Enter');
	await expect(field(page, 'border-width')).toHaveCount(0);
	await expect(sectionAction(page, 'Add border')).toBeFocused();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([{ field: 'border-width', value: '' }]);
});

test('Tab out of an emptied border Width saves once and focuses Add border', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await emptyWhileDrafted(page, '#widthonly', 'border-width');
	// The blur commit unmounts the Style select Tab was heading for.
	await field(page, 'border-width').press('Tab');
	await expect(field(page, 'border-width')).toHaveCount(0);
	await expect(sectionAction(page, 'Add border')).toBeFocused();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
});

test('an emptied Gap on a block element stays while drafted, then leaves on Enter', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await emptyWhileDrafted(page, '#gapped', 'gap');
	await field(page, 'gap').press('Enter');
	await expect(field(page, 'gap')).toHaveCount(0);
	await expect(sectionAction(page, 'Reset Spacing')).toBeFocused();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([{ field: 'gap', value: '' }]);
});

test('Reset Spacing ends an invalid draft silently and posts one edit', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'padding').fill('4 apples;');
	await field(page, 'padding').press('Enter');
	await expect(inspector(page).getByText(FIELD_ERROR_COPY['invalid-length'])).toBeVisible();
	await sectionAction(page, 'Reset Spacing').click();
	await expect(inspector(page).getByText(/^Not saved:/)).toHaveCount(0);
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	expect((await editsPosted(page))[0]?.styles).toEqual([
		{ field: 'padding', value: '' },
		{ field: 'margin', value: '' },
		{ field: 'gap', value: '' },
	]);
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(1);
});
