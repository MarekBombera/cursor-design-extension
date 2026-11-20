import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, type Locator, type Page, test } from '@playwright/test';

import { FRAME_ANCHOR_RECTS_MESSAGE } from '../../src/webview/frame/frameMessages';
import type { PostedCanvasFrame, PostedComment } from '../../src/webview/hostMessages';
import {
	type Box,
	boxOf,
	canvasUpdated,
	centerOf,
	clickChrome,
	commentButton,
	copyOpenButton,
	expectBoxNear,
	frameBox,
	frameOf,
	isMessageOfType,
	messagesOfType,
	nextAnimationFrame,
	openHarness,
	panel,
	panelButton,
	panelItem,
	panelToggle,
	pinOf,
	posted,
	postToChrome,
	savedRecord,
	savedState,
	stageBox,
	thread,
	threadButton,
	untilHeightReported,
	zoomReadout,
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
const SENT = comment({
	id: 'c-mover',
	selector: '#mover',
	tagName: 'div',
	text: '',
	body: 'Mover',
	status: 'sent',
});

const replyBox = (page: Page): Locator => thread(page).getByRole('textbox', { name: 'Reply' });

// App's comments live region, a root node (Toolbar's pick region sits inside the header).
const liveRegion = (page: Page): Locator => page.locator('#svelte-root > [aria-live="polite"]');

const requestsOf = async (page: Page, type: string): Promise<Record<string, unknown>[]> =>
	(await posted(page)).filter((message): message is Record<string, unknown> =>
		isMessageOfType(message, type),
	);

// The last posted request of one type, after waiting for the expected count.
const nthRequest = async (
	page: Page,
	type: string,
	count: number,
): Promise<Record<string, unknown>> => {
	await expect.poll(async () => (await requestsOf(page, type)).length).toBe(count);
	const requests = await requestsOf(page, type);
	return requests[count - 1] ?? {};
};

const openStage = async (
	page: Page,
	comments: PostedComment[],
	savedView = { x: 40, y: 60, zoom: 1 },
): Promise<void> => {
	await openHarness(page, { savedView });
	await postToChrome(page, canvasUpdated([FRAME]));
	await untilHeightReported(page, 'a');
	await postToChrome(page, { type: 'comments:updated', comments });
	await expect
		.poll(
			async () =>
				(await messagesOfType({ page, frameId: 'a', type: FRAME_ANCHOR_RECTS_MESSAGE })).length,
		)
		.toBeGreaterThan(0);
};

const openThread = async (page: Page, id: string): Promise<void> => {
	await expect(pinOf(page, id)).toBeVisible();
	await clickChrome(pinOf(page, id));
	await expect(thread(page)).toBeVisible();
	await expect(threadButton(page, 'Close')).toBeFocused();
};

const openComposer = async (page: Page): Promise<void> => {
	await clickChrome(threadButton(page, 'Reply'));
	await expect(replyBox(page)).toBeFocused();
};

test('Resolve posts one set-status, and the saved answer turns it into a focused Reopen', async ({
	page,
}) => {
	await openStage(page, [TITLE, SENT]);
	await openThread(page, TITLE.id);
	const resolve = threadButton(page, 'Resolve');
	await clickChrome(resolve);
	const request = await nthRequest(page, 'comment:set-status', 1);
	expect(request).toMatchObject({ id: TITLE.id, status: 'resolved' });
	await expect(resolve).toHaveAttribute('aria-disabled', 'true');
	// A second click while pending posts nothing.
	await clickChrome(resolve);
	await nextAnimationFrame(page);
	expect(await requestsOf(page, 'comment:set-status')).toHaveLength(1);

	await postToChrome(page, { type: 'comment:saved', requestId: String(request.requestId) });
	await postToChrome(page, {
		type: 'comments:updated',
		comments: [{ ...TITLE, status: 'resolved' }, SENT],
	});
	const reopen = threadButton(page, 'Reopen');
	await expect(reopen).toBeFocused();
	await expect(reopen).toHaveAttribute('aria-disabled', 'false');
	await expect(liveRegion(page)).toContainText('Comment resolved.');

	await clickChrome(reopen);
	expect(await nthRequest(page, 'comment:set-status', 2)).toMatchObject({
		id: TITLE.id,
		status: 'open',
	});

	// A sent comment offers Resolve.
	await clickChrome(pinOf(page, SENT.id));
	await expect(thread(page)).toContainText('Mover');
	await expect(threadButton(page, 'Resolve')).toBeVisible();
});

test('Reply opens a focused composer; Enter posts the trimmed body and saved empties it', async ({
	page,
}) => {
	await openStage(page, [TITLE]);
	await openThread(page, TITLE.id);
	await openComposer(page);
	const box = replyBox(page);
	// Enter on blank text posts nothing.
	await page.keyboard.press('Enter');
	await nextAnimationFrame(page);
	expect(await requestsOf(page, 'comment:reply')).toHaveLength(0);
	await expect(box).toHaveValue('');

	await page.keyboard.type('  Make it ');
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('bolder  ');
	await expect(box).toHaveValue('  Make it \nbolder  ');
	await page.keyboard.press('Enter');
	const request = await nthRequest(page, 'comment:reply', 1);
	expect(request).toMatchObject({ id: TITLE.id, body: 'Make it \nbolder' });
	await expect(box).not.toBeEditable();
	// Pending: the primary says so in words and is busy.
	const pending = thread(page).getByRole('button', { name: 'Adding…', exact: true });
	await expect(pending).toHaveAttribute('aria-busy', 'true');

	await postToChrome(page, { type: 'comment:saved', requestId: String(request.requestId) });
	await expect(box).toHaveValue('');
	await expect(box).toBeEditable();
	await expect(box).toBeFocused();
	await expect(liveRegion(page)).toContainText('Reply added.');
});

test('a matching ui:error keeps the text and shows a linked, announced error', async ({ page }) => {
	await openStage(page, [TITLE]);
	await openThread(page, TITLE.id);
	await openComposer(page);
	await page.keyboard.type('One more');
	await page.keyboard.press('Enter');
	const request = await nthRequest(page, 'comment:reply', 1);

	// An answer to another request changes nothing.
	await postToChrome(page, {
		type: 'ui:error',
		message: 'Unrelated failure.',
		requestId: 'another-request',
	});
	await nextAnimationFrame(page);
	await expect(replyBox(page)).not.toBeEditable();
	await expect(page.getByText('Unrelated failure.')).toHaveCount(0);

	const message = 'This comment has the maximum number of replies.';
	await postToChrome(page, { type: 'ui:error', message, requestId: String(request.requestId) });
	await expect(replyBox(page)).toBeEditable();
	await expect(replyBox(page)).toHaveValue('One more');
	await expect(thread(page).getByText(message, { exact: true })).toHaveText(message);
	await expect(replyBox(page)).toHaveAccessibleDescription(message);
	await expect(liveRegion(page)).toContainText(message);
});

test('a failed Resolve is the accessible description of the status button', async ({ page }) => {
	await openStage(page, [TITLE]);
	await openThread(page, TITLE.id);
	const resolve = threadButton(page, 'Resolve');
	await clickChrome(resolve);
	const request = await nthRequest(page, 'comment:set-status', 1);
	const message = 'Could not resolve the comment.';
	await postToChrome(page, { type: 'ui:error', message, requestId: String(request.requestId) });
	await expect(thread(page).getByText(message, { exact: true })).toHaveText(message);
	await expect(resolve).toHaveAccessibleDescription(message);
});

test('the first Escape closes the composer, the second the thread; Cancel focuses Reply', async ({
	page,
}) => {
	await openStage(page, [TITLE]);
	await openThread(page, TITLE.id);
	await openComposer(page);
	await page.keyboard.press('Escape');
	await expect(replyBox(page)).toHaveCount(0);
	await expect(thread(page)).toBeVisible();
	await expect(threadButton(page, 'Reply')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(thread(page)).toHaveCount(0);

	await openThread(page, TITLE.id);
	await openComposer(page);
	await clickChrome(threadButton(page, 'Cancel'));
	await expect(replyBox(page)).toHaveCount(0);
	await expect(threadButton(page, 'Reply')).toBeFocused();
});

test('Escape on the composer Cancel button closes only the composer', async ({ page }) => {
	await openStage(page, [TITLE]);
	await openThread(page, TITLE.id);
	await openComposer(page);
	// Cancel comes right after the textarea, before Add reply.
	await page.keyboard.press('Tab');
	await expect(threadButton(page, 'Cancel')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(replyBox(page)).toHaveCount(0);
	await expect(thread(page)).toBeVisible();
	await expect(threadButton(page, 'Reply')).toBeFocused();
});

test('C and Escape typed in the composer leave Comment mode as it was', async ({ page }) => {
	await openStage(page, [TITLE]);
	await openThread(page, TITLE.id);
	await openComposer(page);
	await page.keyboard.type('c');
	await expect(replyBox(page)).toHaveValue('c');
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'false');

	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await clickChrome(replyBox(page));
	await expect(replyBox(page)).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(replyBox(page)).toHaveCount(0);
	await expect(thread(page)).toBeVisible();
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('a reply body with markup shows as literal text', async ({ page }) => {
	const body = '<img src=x onerror="document.title=1">';
	await openStage(page, [
		{
			...TITLE,
			replies: [{ id: 'r1', author: 'user', body, createdAt: '2026-10-27T10:01:00.000Z' }],
		},
	]);
	await openThread(page, TITLE.id);
	await expect(thread(page).locator('li .body')).toHaveText(body);
	await expect(thread(page).locator('img')).toHaveCount(0);
});

// Step 4: the Comments panel.

const panelReplyBox = (page: Page, id: string): Locator =>
	panelItem(page, id).getByRole('textbox', { name: 'Reply' });

const openPanel = async (page: Page): Promise<void> => {
	await clickChrome(panelToggle(page));
	await expect(panelToggle(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(panel(page)).toBeVisible();
};

const activeElementTag = (page: Page): Promise<string | undefined> =>
	page.evaluate(() => document.activeElement?.tagName);

test('the panel toggle keeps the saved view, narrows the stage, and both keys survive a reload', async ({
	page,
}) => {
	// With no frames posted the stage never commits a view, so only the toggle's save writes.
	const savedView = { x: 40, y: 60, zoom: 1 };
	await openHarness(page, { savedView });
	await openPanel(page);
	await expect
		.poll(async () => savedRecord(page))
		.toEqual({ stageView: savedView, commentsPanelOpen: true });

	await openStage(page, [TITLE]);
	await expect(panelToggle(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(panelToggle(page)).toHaveAttribute('aria-controls', 'cd-comments-panel');
	await expect(panel(page)).toBeHidden();
	const closedWidth = (await stageBox(page)).width;

	await openPanel(page);
	await expect.poll(async () => (await stageBox(page)).width).toBeLessThan(closedWidth);
	await expect
		.poll(async () => savedRecord(page))
		.toMatchObject({ stageView: expect.any(Object), commentsPanelOpen: true });

	await openHarness(page, { state: await savedState(page) });
	await expect(panelToggle(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(panel(page)).toBeVisible();
	expect(await savedRecord(page)).toMatchObject({ stageView: expect.any(Object) });
});

// A tab switch: Cursor rebuilds the webview, which starts again from the saved state.
const reload = async (page: Page): Promise<void> => {
	await openHarness(page, { state: await savedState(page) });
};

test('a tab switch reopens the open pin thread', async ({ page }) => {
	await openStage(page, [TITLE, SENT]);
	await openThread(page, TITLE.id);
	await expect.poll(async () => (await savedRecord(page)).openThreadId).toBe(TITLE.id);

	await reload(page);
	await postToChrome(page, { type: 'comments:updated', comments: [TITLE, SENT] });
	await postToChrome(page, canvasUpdated([FRAME]));
	await expect(thread(page)).toBeVisible();
	await expect(thread(page)).toContainText(TITLE.body);
	await expect(threadButton(page, 'Close')).toBeFocused();
});

test('a tab switch keeps reply text typed in a panel card and in a pin thread', async ({
	page,
}) => {
	await openStage(page, [TITLE, SENT]);
	await openPanel(page);
	await clickChrome(panelButton(page, SENT.id, 'Reply'));
	await page.keyboard.type('From the panel');
	await openThread(page, TITLE.id);
	await openComposer(page);
	await page.keyboard.type('From the thread');
	await expect
		.poll(async () => (await savedRecord(page)).replyDrafts)
		.toEqual({ [SENT.id]: 'From the panel', [TITLE.id]: 'From the thread' });

	await reload(page);
	await postToChrome(page, canvasUpdated([FRAME]));
	await postToChrome(page, { type: 'comments:updated', comments: [TITLE, SENT] });
	await expect(panelReplyBox(page, SENT.id)).toHaveValue('From the panel');
	await expect(replyBox(page)).toHaveValue('From the thread');
});

test('a restored thread whose comment is gone does not open, even when it comes back', async ({
	page,
}) => {
	await openStage(page, [TITLE, SENT]);
	await openThread(page, TITLE.id);
	await expect.poll(async () => (await savedRecord(page)).openThreadId).toBe(TITLE.id);

	await reload(page);
	await postToChrome(page, { type: 'comments:updated', comments: [SENT] });
	await postToChrome(page, canvasUpdated([FRAME]));
	await expect(pinOf(page, SENT.id)).toBeVisible();
	await expect.poll(async () => (await savedRecord(page)).openThreadId).toBeUndefined();
	await postToChrome(page, { type: 'comments:updated', comments: [TITLE, SENT] });
	await expect(pinOf(page, TITLE.id)).toBeVisible();
	await nextAnimationFrame(page);
	await expect(thread(page)).toHaveCount(0);
});

test('with the comment UI closed again, the saved record holds only the view and the panel', async ({
	page,
}) => {
	await openStage(page, [TITLE]);
	await openPanel(page);
	await clickChrome(commentButton(page));
	await clickChrome(commentButton(page));
	await openThread(page, TITLE.id);
	await openComposer(page);
	await page.keyboard.type('x');
	await expect
		.poll(async () => Object.keys(await savedRecord(page)).sort())
		.toEqual(['commentsPanelOpen', 'openThreadId', 'replyDrafts', 'stageView']);

	// The first Escape closes the composer (dropping its text), the second the thread.
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await expect(thread(page)).toHaveCount(0);
	await expect
		.poll(async () => savedRecord(page))
		.toEqual({ stageView: expect.any(Object), commentsPanelOpen: true });
});

test('the panel lists unresolved in file order, then resolved; the toggle counts them', async ({
	page,
}) => {
	const resolved = comment({ id: 'c-done', body: 'Done', status: 'resolved' });
	const open = comment({ id: 'c-late', body: 'Late' });
	await openStage(page, [TITLE, resolved, SENT, open]);
	await expect(panelToggle(page)).toHaveAccessibleName('Comments, 3 unresolved');
	// The icon button's only visible text is its count badge.
	await expect(panelToggle(page)).toHaveText('3');
	await openPanel(page);

	const unresolvedGroup = panel(page).locator('ol').nth(0);
	const resolvedGroup = panel(page).locator('ol').nth(1);
	await expect(panel(page).getByRole('heading')).toHaveText(['Unresolved · 3', 'Resolved · 1']);
	// The middle dot is aria-hidden: the headings read "Unresolved 3" / "Resolved 1".
	await expect(
		panel(page).getByRole('heading', { name: 'Unresolved 3', exact: true }),
	).toBeVisible();
	await expect(panel(page).getByRole('heading', { name: 'Resolved 1', exact: true })).toBeVisible();
	expect(
		await unresolvedGroup
			.locator('[data-cd-comment-item]')
			.evaluateAll((items) => items.map((item) => item.getAttribute('data-cd-comment-item'))),
	).toEqual([TITLE.id, SENT.id, open.id]);
	await expect(resolvedGroup.locator('[data-cd-comment-item]')).toHaveAttribute(
		'data-cd-status',
		'resolved',
	);
	await expect(resolvedGroup.locator('[data-cd-comment-item]')).toHaveAttribute(
		'data-cd-comment-item',
		resolved.id,
	);
});

test('a panel item shows author, time, target chip, badge and an Agent reply', async ({ page }) => {
	const stale = comment({
		id: 'c-stale',
		stale: true,
		replies: [
			{ id: 'r1', author: 'agent', body: 'Made it bolder.', createdAt: '2026-10-27T10:05:00.000Z' },
		],
	});
	await openStage(page, [stale]);
	await openPanel(page);
	const item = panelItem(page, stale.id);
	await expect(item.locator('time').first()).toHaveAttribute('datetime', stale.createdAt);
	await expect(item).toContainText('You');
	await expect(
		item.getByRole('button', { name: 'Show on canvas: Pins · Pins', exact: true }),
	).toHaveText('Pins Pins');
	await expect(item).toContainText('Target changed');
	// The flag's sentence is hidden text after its label, exposed to assistive tech, and its tooltip.
	const sentence = item.getByText('The element changed since this comment.', { exact: true });
	await expect(sentence).toHaveCount(1);
	expect(await sentence.evaluate((element) => element.closest('[aria-hidden="true"]'))).toBeNull();
	await expect(item.getByTitle('The element changed since this comment.')).toContainText(
		'Target changed',
	);
	const reply = item.locator('ol li');
	await expect(reply).toContainText('Agent');
	await expect(reply).toContainText('Made it bolder.');
});

test('keyboard Resolve in the panel lands on the Reopen of that comment in the Resolved group', async ({
	page,
}) => {
	await openStage(page, [TITLE, SENT]);
	await openPanel(page);
	await panelButton(page, TITLE.id, 'Resolve').focus();
	await page.keyboard.press('Enter');
	const request = await nthRequest(page, 'comment:set-status', 1);
	expect(request).toMatchObject({ id: TITLE.id, status: 'resolved' });

	await postToChrome(page, { type: 'comment:saved', requestId: String(request.requestId) });
	await postToChrome(page, {
		type: 'comments:updated',
		comments: [{ ...TITLE, status: 'resolved' }, SENT],
	});
	await expect(panelItem(page, TITLE.id)).toHaveAttribute('data-cd-status', 'resolved');
	await expect(panelButton(page, TITLE.id, 'Reopen')).toBeFocused();
});

test('the Agent resolving a comment while you type its panel reply keeps focus and text', async ({
	page,
}) => {
	await openStage(page, [TITLE, SENT]);
	await openPanel(page);
	await clickChrome(panelButton(page, TITLE.id, 'Reply'));
	await expect(panelReplyBox(page, TITLE.id)).toBeFocused();
	await page.keyboard.type('Half a thought');

	await postToChrome(page, {
		type: 'comments:updated',
		comments: [{ ...TITLE, status: 'resolved' }, SENT],
	});
	await expect(panelItem(page, TITLE.id)).toHaveAttribute('data-cd-status', 'resolved');
	await expect(panelReplyBox(page, TITLE.id)).toBeFocused();
	await expect(panelReplyBox(page, TITLE.id)).toHaveValue('Half a thought');
	// The caret is at the end: typing continues the text.
	await page.keyboard.type('!');
	await expect(panelReplyBox(page, TITLE.id)).toHaveValue('Half a thought!');
});

test('list updates never move focus that is outside the panel', async ({ page }) => {
	await openStage(page, [TITLE, SENT]);
	await openPanel(page);
	const frame = await frameOf(page, 'a');
	const updateList = async (status: PostedComment['status']): Promise<void> => {
		await frame.evaluate(
			({ type, id }) => {
				window.parent.postMessage(
					{
						type,
						anchors: [
							{
								id,
								box: { x: 24, y: 30, width: 500, height: 29 },
								visible: { x: 24, y: 30, width: 500, height: 29 },
							},
						],
					},
					'*',
				);
			},
			{ type: FRAME_ANCHOR_RECTS_MESSAGE, id: TITLE.id },
		);
		await postToChrome(page, { type: 'comments:updated', comments: [{ ...TITLE, status }, SENT] });
		await nextAnimationFrame(page);
	};

	await page.locator('.viewport').focus();
	await updateList('resolved');
	await expect(page.locator('.viewport')).toBeFocused();

	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	});
	expect(await activeElementTag(page)).toBe('BODY');
	await updateList('open');
	expect(await activeElementTag(page)).toBe('BODY');
});

test('a comments:updated with error keeps the text of an open composer', async ({ page }) => {
	await openStage(page, [TITLE]);
	await openPanel(page);
	await clickChrome(panelButton(page, TITLE.id, 'Reply'));
	await page.keyboard.type('Keep me');

	await postToChrome(page, {
		type: 'comments:updated',
		comments: [],
		error: 'Could not read comments.',
	});
	await expect(panel(page)).toContainText('Comments are unavailable');
	await expect(panelReplyBox(page, TITLE.id)).toHaveCount(0);

	await postToChrome(page, { type: 'comments:updated', comments: [TITLE] });
	await expect(panelReplyBox(page, TITLE.id)).toHaveValue('Keep me');
});

test('a pin and its panel card show the same number', async ({ page }) => {
	await openStage(page, [TITLE, SENT]);
	await openPanel(page);
	for (const [id, number] of [
		[TITLE.id, '1'],
		[SENT.id, '2'],
	] as const) {
		await expect(pinOf(page, id)).toHaveText(number);
		await expect(pinOf(page, id)).toHaveAccessibleName(new RegExp(`^\\w+ comment ${number}:`));
		await expect(panelItem(page, id).locator('.pin-chip')).toHaveText(`Comment ${number}`);
	}
});

test('with the panel open, the thread of a pin stays clear of the panel', async ({ page }) => {
	// The pin sits near the right edge of the narrowed stage, so an unplaced thread would overlap.
	await openStage(page, [TITLE], { x: 700, y: 60, zoom: 1 });
	await openPanel(page);
	await expect
		.poll(async () => (await stageBox(page)).width)
		.toBeLessThan(page.viewportSize()?.width ?? 0);
	await openThread(page, TITLE.id);
	const threadBox = await boxOf(thread(page));
	const panelBox = await boxOf(panel(page));
	expect(threadBox.x + threadBox.width).toBeLessThanOrEqual(panelBox.x);
});

// A frame wheel opens the scroll sink's 1 s gesture window (F-52), so a panel wheel that chained
// to the root scroller inside that window would pan the stage; the aside's overscroll-behavior
// stops it.
test('a wheel over the open panel right after a frame wheel leaves the saved stage view', async ({
	page,
}) => {
	await openStage(page, [TITLE]);
	await openPanel(page);
	await expect.poll(async () => (await savedRecord(page)).commentsPanelOpen).toBe(true);
	await nextAnimationFrame(page);
	const opened = (await savedRecord(page)).stageView;

	// Right of the fixture's .scroll-box, which would take the wheel itself.
	const frame = await frameBox(page, 'a');
	await page.mouse.move(frame.x + 450, frame.y + 250);
	await page.mouse.wheel(0, 40);
	await expect.poll(async () => (await savedRecord(page)).stageView).not.toEqual(opened);
	const before = (await savedRecord(page)).stageView;

	const center = centerOf(await boxOf(panel(page)));
	await page.mouse.move(center.x, center.y);
	await page.mouse.wheel(0, 400);
	await page.mouse.wheel(300, 0);
	await nextAnimationFrame(page);
	await nextAnimationFrame(page);
	expect((await savedRecord(page)).stageView).toEqual(before);
});

// F-94: the list scrolls under a header that is outside it, so the browser never scrolls a focused
// control behind the header.
test('Shift+Tab up a long list keeps every focused control below the panel header', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1000, height: 500 });
	const comments = Array.from({ length: 8 }, (_, index) =>
		comment({ id: `c-long-${String(index)}`, body: `Long ${String(index)}` }),
	);
	await openStage(page, comments);
	await openPanel(page);
	const head = await boxOf(panel(page).locator(':scope > .head'));
	await panelButton(page, 'c-long-7', 'Copy for Agent').focus();
	const inList = (): Promise<boolean> =>
		page.evaluate(() => document.activeElement?.closest('[data-cd-comment-item]') != null);
	let stops = 0;
	while (await inList()) {
		const focused = await boxOf(page.locator(':focus'));
		expect(focused.y).toBeGreaterThanOrEqual(head.y + head.height);
		stops += 1;
		await page.keyboard.press('Shift+Tab');
	}
	// Every card's jump, Reply, Resolve and Copy for Agent.
	expect(stops).toBe(32);
});

test('a comment whose frame is absent is listed without a jump', async ({ page }) => {
	const orphan = comment({ id: 'c-orphan', frameId: 'gone', body: 'Orphan' });
	await openStage(page, [TITLE, orphan]);
	await openPanel(page);
	await expect(panelItem(page, orphan.id)).toContainText('gone Pins');
	await expect(panelItem(page, orphan.id)).toContainText('Frame not shown.');
	await expect(panelItem(page, orphan.id).locator('[data-cd-focus="jump"]')).toHaveCount(0);
	await expect(panelItem(page, TITLE.id).locator('[data-cd-focus="jump"]')).toHaveCount(1);
});

test('the panel shows the empty state and the error state', async ({ page }) => {
	await openHarness(page);
	await postToChrome(page, { type: 'comments:updated', comments: [] });
	await expect(panelToggle(page)).toHaveAccessibleName('Comments');
	// No unresolved comments: no count badge.
	await expect(panelToggle(page)).toHaveText('');
	await openPanel(page);
	// The header stays; the empty state is its title, then the sentence with the C key.
	await expect(panel(page).getByText('Comments', { exact: true })).toBeVisible();
	await expect(panel(page).getByText('No comments yet', { exact: true })).toBeVisible();
	await expect(panel(page)).toContainText('Press C, then click an element to add one.');
	await postToChrome(page, {
		type: 'comments:updated',
		comments: [],
		error: 'Could not read comments.',
	});
	await expect(panel(page).getByText('Comments are unavailable', { exact: true })).toBeVisible();
	await expect(panel(page)).toContainText('The notice above the canvas says why.');
});

const JUMP_FRAME: PostedCanvasFrame = {
	id: 'j',
	label: 'Jump',
	x: 0,
	y: 0,
	width: 1400,
	generation: 1,
	hash: 'sha256:test',
	canUndo: false,
	canRedo: false,
	html: readFileSync(join(__dirname, '..', '..', 'fixtures', 'jump.html'), 'utf8'),
};

const JUMP_TARGET = comment({
	id: 'c-target',
	frameId: JUMP_FRAME.id,
	selector: '#target',
	tagName: 'p',
	text: 'Target',
	rect: { x: 600, y: 700, width: 200, height: 60 },
	body: 'Target',
});

const flashOutline = (page: Page): Locator => page.locator('[data-cd-flash]');

// Opens the jump fixture with the panel open, once the frame answered its element comments. The
// panel opens before the frame exists: an out-of-process frame that spanned the panel's area a
// moment ago can still take a click there until the compositor's hit-test data catches up.
const openJumpStage = async (
	page: Page,
	comments: PostedComment[],
	savedView: { x: number; y: number; zoom: number },
): Promise<void> => {
	await openHarness(page, { savedView });
	await openPanel(page);
	await postToChrome(page, canvasUpdated([JUMP_FRAME]));
	await untilHeightReported(page, JUMP_FRAME.id);
	await postToChrome(page, { type: 'comments:updated', comments });
	await expect
		.poll(
			async () =>
				(await messagesOfType({ page, frameId: JUMP_FRAME.id, type: FRAME_ANCHOR_RECTS_MESSAGE }))
					.length,
		)
		.toBeGreaterThan(0);
};

const jump = async (page: Page, id: string): Promise<void> => {
	await clickChrome(panelItem(page, id).locator('[data-cd-focus="jump"]'));
	await expect(flashOutline(page)).toBeVisible();
};

// A frame-local rect on screen: the wrapper's drawn scale applied to the frame-local offset.
const screenRectOf = async (page: Page, rect: Box): Promise<Box> => {
	const frame = await frameBox(page, JUMP_FRAME.id);
	const scale = frame.width / JUMP_FRAME.width;
	return {
		x: frame.x + rect.x * scale,
		y: frame.y + rect.y * scale,
		width: rect.width * scale,
		height: rect.height * scale,
	};
};

// The element's frame-local border box, read inside its own document.
const elementRect = async (page: Page, selector: string): Promise<Box> =>
	(await frameOf(page, JUMP_FRAME.id)).evaluate((wanted) => {
		const box = document.querySelector(wanted)?.getBoundingClientRect();
		return { x: box?.x ?? 0, y: box?.y ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 };
	}, selector);

test('jumping to a target that fits centers it, keeps the zoom and flashes its box', async ({
	page,
}) => {
	await openJumpStage(page, [JUMP_TARGET], { x: 40, y: 60, zoom: 1 });
	await expect(zoomReadout(page)).toHaveText('100%');
	await jump(page, JUMP_TARGET.id);

	await expect(zoomReadout(page)).toHaveText('100%');
	const target = await screenRectOf(page, await elementRect(page, '#target'));
	const stageCenter = centerOf(await stageBox(page));
	expect(Math.abs(centerOf(target).x - stageCenter.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(centerOf(target).y - stageCenter.y)).toBeLessThanOrEqual(1);
	expectBoxNear(await boxOf(flashOutline(page)), target);
	await expect(flashOutline(page)).toHaveCount(0, { timeout: 3000 });
});

test('jumping to a target taller than the stage at 200% zooms out until it fits', async ({
	page,
}) => {
	const tall = comment({
		id: 'c-tall',
		frameId: JUMP_FRAME.id,
		selector: '#tall',
		tagName: 'div',
		text: '',
		rect: { x: 100, y: 100, width: 100, height: 500 },
		body: 'Tall',
	});
	await openJumpStage(page, [tall], { x: 40, y: 60, zoom: 2 });
	await expect(zoomReadout(page)).toHaveText('200%');
	await jump(page, tall.id);

	await expect(zoomReadout(page)).not.toHaveText('200%');
	const target = await screenRectOf(page, await elementRect(page, '#tall'));
	const stage = await stageBox(page);
	expect(target.height).toBeLessThanOrEqual(stage.height);
	expect(target.y).toBeGreaterThanOrEqual(stage.y);
	expect(target.y + target.height).toBeLessThanOrEqual(stage.y + stage.height);
	expectBoxNear(await boxOf(flashOutline(page)), target);
});

test('jumping to a missing target flashes its stored rect', async ({ page }) => {
	const missing = comment({
		id: 'c-missing',
		frameId: JUMP_FRAME.id,
		selector: '#nowhere',
		tagName: 'div',
		text: '',
		rect: { x: 300, y: 300, width: 120, height: 40 },
		body: 'Missing',
	});
	await openJumpStage(page, [JUMP_TARGET, missing], { x: 40, y: 60, zoom: 1 });
	await expect(panelItem(page, missing.id)).toContainText('Target missing');
	await jump(page, missing.id);

	const stored = await screenRectOf(page, missing.rect ?? { x: 0, y: 0, width: 0, height: 0 });
	expectBoxNear(await boxOf(flashOutline(page)), stored);
	const stageCenter = centerOf(await stageBox(page));
	expect(Math.abs(centerOf(stored).x - stageCenter.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(centerOf(stored).y - stageCenter.y)).toBeLessThanOrEqual(1);
});

test('jumping to a page comment flashes the whole frame and keeps the zoom', async ({ page }) => {
	const whole = comment({
		id: 'c-page',
		frameId: JUMP_FRAME.id,
		selector: 'body',
		tagName: 'body',
		text: '',
		rect: null,
		pin: { x: 0.5, y: 0.5 },
		isPage: true,
		body: 'Whole page',
	});
	await openJumpStage(page, [JUMP_TARGET, whole], { x: 40, y: 60, zoom: 2 });
	await expect(zoomReadout(page)).toHaveText('200%');
	await jump(page, whole.id);

	await expect(zoomReadout(page)).toHaveText('200%');
	expectBoxNear(await boxOf(flashOutline(page)), await frameBox(page, JUMP_FRAME.id));
});

// 8h: Copy for Agent (one comment) and the copy-open button. The host side (clipboard, markCommentsSent) is unit-tested;
// here the chrome posts the requests, blocks a second copy and renders the answers.

const OPEN_SECOND = comment({ id: 'c-second', body: 'Second' });
const RESOLVED = comment({ id: 'c-done', body: 'Done', status: 'resolved' });

test('Copy for Agent posts one copy, blocks every other copy, and shows the answer', async ({
	page,
}) => {
	await page.clock.install();
	await openStage(page, [TITLE, OPEN_SECOND, SENT]);
	await openPanel(page);
	const copy = panelButton(page, TITLE.id, 'Copy for Agent');
	await clickChrome(copy);
	const request = await nthRequest(page, 'comment:copy', 1);
	expect(request).toMatchObject({ type: 'comment:copy', id: TITLE.id });
	await expect(copy).toHaveAttribute('aria-disabled', 'true');
	// One copy at a time: the same button, another card and the batch all post nothing.
	await clickChrome(copy);
	await clickChrome(panelButton(page, OPEN_SECOND.id, 'Copy for Agent'));
	await clickChrome(copyOpenButton(page));
	await nextAnimationFrame(page);
	expect(await requestsOf(page, 'comment:copy')).toHaveLength(1);
	expect(await requestsOf(page, 'comment:copy-open')).toHaveLength(0);

	await copy.focus();
	await postToChrome(page, {
		type: 'ui:copied',
		requestId: String(request.requestId),
		count: 1,
	});
	const copied = panelButton(page, TITLE.id, 'Copied');
	await expect(copied).toBeFocused();
	await expect(copied).not.toHaveAttribute('aria-disabled', 'true');
	await expect(liveRegion(page)).toContainText('Prompt copied. Comment marked sent.');
	await page.clock.fastForward(1500);
	await expect(panelButton(page, TITLE.id, 'Copy for Agent')).toBeVisible();
});

test('a copy answer keeps an open reply draft; a matching ui:error is linked to Copy for Agent', async ({
	page,
}) => {
	await openStage(page, [TITLE]);
	await openPanel(page);
	await clickChrome(panelButton(page, TITLE.id, 'Reply'));
	await page.keyboard.type('Half a thought');
	const copy = panelButton(page, TITLE.id, 'Copy for Agent');
	await clickChrome(copy);
	const first = await nthRequest(page, 'comment:copy', 1);
	await postToChrome(page, { type: 'ui:copied', requestId: String(first.requestId), count: 0 });
	await expect(liveRegion(page)).toContainText('Prompt copied.');
	await expect(panelReplyBox(page, TITLE.id)).toHaveValue('Half a thought');

	await clickChrome(panelButton(page, TITLE.id, 'Copied'));
	const second = await nthRequest(page, 'comment:copy', 2);
	// An answer to another request changes nothing.
	await postToChrome(page, { type: 'ui:error', message: 'Unrelated.', requestId: 'another' });
	await nextAnimationFrame(page);
	await expect(page.getByText('Unrelated.')).toHaveCount(0);
	const message = 'Could not copy the prompt. Check the Output panel: Cursor Design.';
	await postToChrome(page, { type: 'ui:error', message, requestId: String(second.requestId) });
	await expect(panelItem(page, TITLE.id).getByText(message, { exact: true })).toHaveText(message);
	await expect(panelButton(page, TITLE.id, 'Copy for Agent')).toHaveAccessibleDescription(message);
	await expect(liveRegion(page)).toContainText(message);
});

test('Copy for Agent shows in the pin thread and on sent and resolved cards', async ({ page }) => {
	await openStage(page, [TITLE, SENT, RESOLVED]);
	await openThread(page, TITLE.id);
	await expect(threadButton(page, 'Copy for Agent')).toBeVisible();
	await clickChrome(threadButton(page, 'Close'));
	await openPanel(page);
	await expect(panelButton(page, SENT.id, 'Copy for Agent')).toBeVisible();
	await expect(panelButton(page, RESOLVED.id, 'Copy for Agent')).toBeVisible();
});

test('Copy open counts open comments only, posts once, and announces the marked count', async ({
	page,
}) => {
	await page.clock.install();
	await openStage(page, [TITLE, OPEN_SECOND, SENT, RESOLVED]);
	await openPanel(page);
	const button = copyOpenButton(page);
	await expect(button).toHaveText('Copy 2 open comments for Agent');
	await clickChrome(button);
	const request = await nthRequest(page, 'comment:copy-open', 1);
	expect(request).toMatchObject({ type: 'comment:copy-open' });
	// The batch blocks card copies too.
	await clickChrome(panelButton(page, TITLE.id, 'Copy for Agent'));
	await nextAnimationFrame(page);
	expect(await requestsOf(page, 'comment:copy')).toHaveLength(0);

	await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 2 });
	await expect(liveRegion(page)).toContainText('Prompt copied. 2 comments marked sent.');
	await expect(button).toHaveText('Copied 2 comments');
	// The feedback is not drawn disabled, but a click on it copies nothing until it clears.
	await expect(button).not.toHaveAttribute('aria-disabled', 'true');
	await clickChrome(button);
	await nextAnimationFrame(page);
	expect(await requestsOf(page, 'comment:copy-open')).toHaveLength(1);
	await page.clock.fastForward(1500);
	await expect(button).toHaveText('Copy 2 open comments for Agent');

	await clickChrome(button);
	const retry = await nthRequest(page, 'comment:copy-open', 2);
	const message = 'Another Cursor Design write is in progress. Retry in a moment.';
	await postToChrome(page, { type: 'ui:error', message, requestId: String(retry.requestId) });
	await expect(button).toHaveAccessibleDescription(message);
});

test('Copy open says nothing new to send with no open comments and posts nothing', async ({
	page,
}) => {
	await openStage(page, [SENT, RESOLVED]);
	await openPanel(page);
	const button = copyOpenButton(page);
	await expect(button).toHaveText('Nothing new to send');
	await expect(panel(page)).toContainText('1 comment is with the Agent.');
	await expect(button).toHaveAttribute('aria-disabled', 'true');
	await clickChrome(button);
	await nextAnimationFrame(page);
	expect(await requestsOf(page, 'comment:copy-open')).toHaveLength(0);
});

test('the panel header sums the comments and copies 3 open, then says what was copied', async ({
	page,
}) => {
	await page.clock.install();
	const third = comment({ id: 'c-third', body: 'Third' });
	await openStage(page, [TITLE, OPEN_SECOND, third, SENT, RESOLVED]);
	await openPanel(page);
	await expect(panel(page).locator('.summary')).toHaveText('3 to send, 1 with Agent, 1 resolved');
	const button = copyOpenButton(page);
	await expect(button).toHaveText('Copy 3 open comments for Agent');
	await expect(button).not.toHaveAttribute('aria-disabled', 'true');
	await clickChrome(button);
	const request = await nthRequest(page, 'comment:copy-open', 1);
	await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 3 });
	await expect(button).toHaveText('Copied 3 comments');
	await expect(panel(page)).toContainText('Now paste into Cursor Agent chat.');
	await page.clock.fastForward(1500);
	await expect(button).toHaveText('Copy 3 open comments for Agent');
});

test('a list update that marks the comment sent keeps focus on its Copy for Agent', async ({
	page,
}) => {
	await openStage(page, [TITLE, SENT]);
	await openPanel(page);
	const copy = panelButton(page, TITLE.id, 'Copy for Agent');
	await clickChrome(copy);
	const request = await nthRequest(page, 'comment:copy', 1);
	await copy.focus();
	await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 1 });
	await postToChrome(page, {
		type: 'comments:updated',
		comments: [{ ...TITLE, status: 'sent' }, SENT],
	});
	await expect(panelItem(page, TITLE.id)).toHaveAttribute('data-cd-status', 'sent');
	await expect(panelItem(page, TITLE.id).locator('[data-cd-focus="copy"]')).toBeFocused();
});
