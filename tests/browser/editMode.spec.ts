import { expect, type Page, test } from '@playwright/test';

import { parseArtboardDocument } from '../../src/disk/commentTarget';
import { SOURCE_TAG_ATTRIBUTE } from '../../src/disk/layout';
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
	});
	await expect(inspector(page).getByText('Edit › h1')).toBeVisible();
	await expect(field(page, 'Text')).toHaveValue('Title');
	await expect(field(page, 'Text')).toBeEnabled();
	await expect(field(page, 'Font size')).toHaveValue('32px');
	await expect(field(page, 'Font size')).toBeEnabled();
	await expect(field(page, 'Color')).toHaveValue('#ff0000');
	await expect(field(page, 'Color')).toBeEnabled();
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
	expect((await lastPick(page, 'a'))?.edit?.text).toBe('\n    Spaced text\n');
	await expect(field(page, 'Text')).toHaveValue('Spaced text');

	for (const selector of ['#mixed', '#commented']) {
		await clickElement(page, selector, { x: 0.9, y: 0.5 });
		expect((await lastPick(page, 'a'))?.edit?.textState).toBe('children');
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
	expect(pagePick?.edit?.textState).toBe('children');
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
		edit: { sourceNumber: 1, sharedNumber: false, textState: 'plain', text: 'Title', style: null },
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
	await field(page, 'Text').fill('New');
	await expect(await inFrame(page, '#title')).toHaveText('New');
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'Text').blur();
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
	await expect(field(page, 'Text')).toHaveValue('New');
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
	await field(page, 'Font size').fill('16');
	await expect(await inFrame(page, '#title')).toHaveAttribute(
		'style',
		'font-size: 16px; color: #ff0000',
	);
	await field(page, 'Font size').press('Enter');
	await expect(field(page, 'Font size')).toBeFocused();
	await expect.poll(async () => (await editsPosted(page)).at(-1)?.value).toBe('16');
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
	await expect(field(page, 'Font size')).toHaveValue('16px');
	await field(page, 'Color').fill('#00ff00');
	await expect.poll(async () => (await editsPosted(page)).at(-1)?.value).toBe('#00ff00');
	expect((await editsPosted(page)).at(-1)?.hash).toBe('sha256:size');
});

test('an invalid value shows its error, posts nothing and restores the frame', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'Padding').fill('4');
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 4px');
	await field(page, 'Padding').fill('4 apples;');
	await field(page, 'Padding').blur();
	const error = inspector(page).getByText('Not saved: use a number');
	await expect(error).toBeVisible();
	await expect(field(page, 'Padding')).toHaveAttribute('aria-invalid', 'true');
	await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 8px 16px');
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'Padding').fill('4');
	await expect(error).toHaveCount(0);
});

test('a newline-only text change sends nothing; the next real edit saves', async ({ page }) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#spaced');
	await field(page, 'Text').fill('Spaced\ntext');
	await field(page, 'Text').blur();
	await expect(await inFrame(page, '#spaced')).toHaveText('\n    Spaced text\n');
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(0);
	await field(page, 'Text').fill('Spaced!');
	await field(page, 'Text').blur();
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
	await field(page, 'Text').fill('New');
	await field(page, 'Text').blur();
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	const [first] = await editsPosted(page);
	await postToChrome(
		page,
		editedAnswer({ request: first ?? {}, change: renamedTitle, hash: 'sha256:new', generation: 2 }),
	);
	await field(page, 'Margin').fill('4');
	await field(page, 'Margin').blur();
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
	await field(page, 'Padding').fill('4');
	await field(page, 'Margin').focus();
	await field(page, 'Margin').fill('2');
	await field(page, 'Margin').blur();
	await nextAnimationFrame(page);
	expect(await editsPosted(page)).toHaveLength(1);
	const [first] = await editsPosted(page);
	expect(first?.field).toBe('padding');
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
	expect((await editsPosted(page)).at(-1)).toMatchObject({ field: 'margin', hash: 'sha256:pad' });
});

test('a dirty field, then a click on another element, saves to the first element only', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#title');
	await field(page, 'Margin').fill('6');
	await clickElement(page, '#padded');
	await expect.poll(async () => (await editsPosted(page)).length).toBe(1);
	await nextAnimationFrame(page);
	const edits = await editsPosted(page);
	expect(edits).toHaveLength(1);
	expect(edits[0]).toMatchObject({
		sourceNumber: await sourceNumberOf(page, '#title'),
		value: '6',
	});
	await expect(field(page, 'Margin')).toHaveValue('');
});

test('an invalid value left by a click on another element names its own cause', async ({
	page,
}) => {
	await openEditStage(page);
	await enterEditMode(page);
	await clickElement(page, '#padded');
	await field(page, 'Padding').fill('4 apples;');
	await clickElement(page, '#title');
	await expect(field(page, 'Text')).toHaveValue('Title');
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
	await field(page, 'Padding').fill('4 apples;');
	await field(page, 'Padding').press('Enter');
	await expect(inspector(page).getByText(FIELD_ERROR_COPY['invalid-length'])).toBeVisible();
	await clickElement(page, '#title');
	await expect(field(page, 'Text')).toHaveValue('Title');
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
	await field(page, 'Text').fill('Draft');
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
	await field(page, 'Margin').focus();
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

const historyAnnouncement = (page: Page) => inspector(page).locator('p.visually-hidden');

// One saved text edit on #title ("Title" → "New"), answered with canUndo.
const saveTitleEdit = async (page: Page): Promise<void> => {
	await clickElement(page, '#title');
	await field(page, 'Text').fill('New');
	await field(page, 'Text').blur();
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
	await expect(historyAnnouncement(page)).toHaveText(/^Undone in Edit\.\s?$/);
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
	await expect(historyAnnouncement(page)).toHaveText(/^Undone in Edit\.\s?$/);
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
	await field(page, 'Text').fill('Newer');
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
	await field(page, 'Text').focus();
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
