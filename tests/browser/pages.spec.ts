import { expect, type Locator, type Page, test } from '@playwright/test';

import type { PostedComment } from '../../src/webview/hostMessages';
import {
	canvasUpdated,
	clickAt,
	clickChrome,
	commentButton,
	editButton,
	editFrame,
	enterEditMode,
	frameElementBox,
	frameOf,
	inspector,
	loadsOf,
	nextAnimationFrame,
	openHarness,
	openThread,
	panel,
	panelButton,
	panelItem,
	panelToggle,
	picksOf,
	pinOf,
	popover,
	postToChrome,
	reload,
	requestsOf,
	thread,
	threadButton,
} from './harness';

// Two pages, each holding an identical frame `artboard`: only the page id tells them apart, so
// anything that leaks across a switch lands on a same-id frame.
const FRAME = editFrame({ id: 'artboard', label: 'Artboard' });
const PAGE_A = 'page-1';
const PAGE_B = 'page-2';

const stageOf = (pageId: string) => ({
	...canvasUpdated([FRAME]),
	pageId,
	pages: [
		{ id: PAGE_A, title: 'Page A', updatedAt: null },
		{ id: PAGE_B, title: 'Page B', updatedAt: null },
	],
});

const comment = (id: string): PostedComment => ({
	id,
	frameId: FRAME.id,
	selector: '#title',
	tagName: 'h1',
	text: 'Title',
	rect: { x: 24, y: 24, width: 300, height: 40 },
	pin: { x: 0.25, y: 0.5 },
	body: id,
	isPage: false,
	status: 'open',
	createdAt: '2026-11-20T10:00:00.000Z',
	replies: [],
	stale: false,
	targetMissing: false,
});

const COMMENT_A = comment('c-on-a');
const COMMENT_B = comment('c-on-b');

const commentsOf = (pageId: string, comments: PostedComment[]) => ({
	type: 'comments:updated' as const,
	pageId,
	comments,
});

// Stages a page and waits for its frame's new document.
const stagePage = async (page: Page, pageId: string): Promise<void> => {
	const loads = await loadsOf(page, FRAME.id);
	await postToChrome(page, stageOf(pageId));
	await expect.poll(() => loadsOf(page, FRAME.id)).toBeGreaterThan(loads);
};

const openPageA = async (page: Page, comments: PostedComment[] = []): Promise<void> => {
	await openHarness(page, { savedView: { x: 40, y: 60, zoom: 1 } });
	await stagePage(page, PAGE_A);
	await postToChrome(page, commentsOf(PAGE_A, comments));
};

const clickTitle = async (page: Page): Promise<void> => {
	const picks = (await picksOf(page, FRAME.id)).length;
	const box = await frameElementBox({ page, frameId: FRAME.id, selector: '#title' });
	await clickAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
	await expect.poll(async () => (await picksOf(page, FRAME.id)).length).toBeGreaterThan(picks);
};

const commentBox = (page: Page): Locator => popover(page).getByRole('textbox', { name: 'Comment' });

const openDraft = async (page: Page, text: string): Promise<void> => {
	await clickTitle(page);
	await expect(popover(page)).toBeVisible();
	await commentBox(page).fill(text);
};

const outlines = (page: Page): Locator => page.locator('.overlay .outline');

const layerTransform = (page: Page): Promise<string | null> =>
	page.locator('.layer').getAttribute('style');

test('the first paint is unchanged: a disabled toolbar and the empty state', async ({ page }) => {
	await openHarness(page);
	await expect(page.getByText('No artboard yet', { exact: true })).toBeVisible();
	await expect(commentButton(page)).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Fit all' })).toBeDisabled();
});

test('switching drops the pins, the open thread and the reply composers', async ({ page }) => {
	await openPageA(page, [COMMENT_A]);
	await clickChrome(panelToggle(page));
	await clickChrome(panelButton(page, COMMENT_A.id, 'Reply'));
	await panelItem(page, COMMENT_A.id).getByRole('textbox', { name: 'Reply' }).fill('Half typed');
	await openThread(page, COMMENT_A.id);

	// B's list is the same comment under another id; A's composer and thread must not carry over.
	await postToChrome(page, commentsOf(PAGE_B, [COMMENT_B]));
	await stagePage(page, PAGE_B);
	await expect(thread(page)).toBeHidden();
	await expect(pinOf(page, COMMENT_A.id)).toHaveCount(0);
	await expect(pinOf(page, COMMENT_B.id)).toBeVisible();
	await expect(panel(page).getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
});

test('switching drops the pick, the inspector draft and the hover and pick outlines', async ({
	page,
}) => {
	await openPageA(page);
	await enterEditMode(page);
	await clickTitle(page);
	await inspector(page).locator('[data-cd-field="font-size"]').fill('12');
	await expect(outlines(page)).not.toHaveCount(0);

	await stagePage(page, PAGE_B);
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(inspector(page).getByText('No element selected')).toBeVisible();
	await expect(outlines(page)).toHaveCount(0);
	// The draft's preview never reaches B's document.
	await expect((await frameOf(page, FRAME.id)).locator('#title')).toHaveAttribute(
		'style',
		'font-size: 32px; color: #ff0000',
	);
	expect(await requestsOf(page, 'artboard:edit')).toHaveLength(0);
});

test('a comment draft on A is gone on B and comes back on A', async ({ page }) => {
	await openPageA(page);
	await clickChrome(commentButton(page));
	await openDraft(page, 'On A');

	await stagePage(page, PAGE_B);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(popover(page)).toBeHidden();

	await stagePage(page, PAGE_A);
	await expect(popover(page)).toBeVisible();
	await expect(commentBox(page)).toHaveValue('On A');
});

test('a new draft on B replaces A’s slot, and B’s request names B', async ({ page }) => {
	await openPageA(page);
	await clickChrome(commentButton(page));
	await openDraft(page, 'On A');
	await stagePage(page, PAGE_B);
	await openDraft(page, 'On B');

	await stagePage(page, PAGE_A);
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(popover(page)).toBeHidden();

	await stagePage(page, PAGE_B);
	await expect(commentBox(page)).toHaveValue('On B');
	await commentBox(page).press('Enter');
	await expect.poll(async () => (await requestsOf(page, 'comment:create')).length).toBe(1);
	expect((await requestsOf(page, 'comment:create'))[0]).toMatchObject({
		pageId: PAGE_B,
		body: 'On B',
	});
});

test('comments for A never draw on B, and B’s early list shows once B is staged', async ({
	page,
}) => {
	await openPageA(page, [COMMENT_A]);
	await clickChrome(panelToggle(page));
	await expect(pinOf(page, COMMENT_A.id)).toBeVisible();

	// B's list before B's canvas: held, never drawn on A.
	await postToChrome(page, commentsOf(PAGE_B, [COMMENT_B]));
	await nextAnimationFrame(page);
	await expect(pinOf(page, COMMENT_A.id)).toBeVisible();
	await expect(panelItem(page, COMMENT_B.id)).toHaveCount(0);

	await stagePage(page, PAGE_B);
	await expect(pinOf(page, COMMENT_B.id)).toBeVisible();
	await expect(panelItem(page, COMMENT_B.id)).toBeVisible();

	// A's list after B's canvas: never drawn on B.
	await postToChrome(page, commentsOf(PAGE_A, [COMMENT_A]));
	await nextAnimationFrame(page);
	await expect(pinOf(page, COMMENT_A.id)).toHaveCount(0);
	await expect(panelItem(page, COMMENT_A.id)).toHaveCount(0);
	await expect(pinOf(page, COMMENT_B.id)).toBeVisible();
});

test('an answer to an A edit arriving after the switch to B changes nothing on B', async ({
	page,
}) => {
	await openPageA(page);
	await enterEditMode(page);
	await clickTitle(page);
	const text = inspector(page).locator('[data-cd-field="text"]');
	await text.fill('New');
	await text.blur();
	await expect.poll(async () => (await requestsOf(page, 'artboard:edit')).length).toBe(1);
	const [request] = await requestsOf(page, 'artboard:edit');
	expect(request).toMatchObject({ pageId: PAGE_A });

	await stagePage(page, PAGE_B);
	const loads = await loadsOf(page, FRAME.id);
	// Counts every cd:edit-apply B's document receives from now on.
	const frame = await frameOf(page, FRAME.id);
	await frame.evaluate(() => {
		const counted = window as Window & { cdApplies?: number };
		counted.cdApplies = 0;
		window.addEventListener('message', (event) => {
			if ((event.data as { type?: unknown } | null)?.type === 'cd:edit-apply') {
				counted.cdApplies = (counted.cdApplies ?? 0) + 1;
			}
		});
	});
	const requestId = String(request?.requestId);
	await postToChrome(page, {
		type: 'artboard:edited',
		requestId,
		frameId: FRAME.id,
		hash: 'sha256:new',
		generation: 2,
		html: FRAME.html.replace('>Title</h1>', '>New</h1>'),
		canUndo: true,
		canRedo: false,
	});
	await postToChrome(page, { type: 'ui:error', requestId, message: 'Not saved.' });
	await nextAnimationFrame(page);
	await nextAnimationFrame(page);
	expect(await loadsOf(page, FRAME.id)).toBe(loads);
	expect(await frame.evaluate(() => (window as Window & { cdApplies?: number }).cdApplies)).toBe(0);
	await expect(frame.locator('#title')).toHaveText('Title');
	await expect(inspector(page).getByRole('alert')).toHaveCount(0);
});

test('a canvas:updated with no page while A is staged does not remount A', async ({ page }) => {
	await openPageA(page, [COMMENT_A]);
	await clickChrome(panelToggle(page));
	await clickChrome(panelButton(page, COMMENT_A.id, 'Reply'));
	const reply = panelItem(page, COMMENT_A.id).getByRole('textbox', { name: 'Reply' });
	await reply.fill('Kept');

	// A resolve or read failure: today's error snapshot (no frames, the banner), on the same page.
	await postToChrome(page, {
		...canvasUpdated([]),
		pageId: '',
		pages: [],
	});
	await postToChrome(page, { type: 'artboard:error', message: 'Could not read the canvas.' });
	await expect(page.getByText('No artboard yet', { exact: true })).toBeVisible();
	await expect(panel(page)).toBeVisible();
	await expect(reply).toHaveValue('Kept');

	// The next canvas for A merges as today: the frame and its pin come back, the composer stays.
	await stagePage(page, PAGE_A);
	await expect(pinOf(page, COMMENT_A.id)).toBeVisible();
	await expect(reply).toHaveValue('Kept');
});

const panStage = async (page: Page): Promise<string | null> => {
	const before = await layerTransform(page);
	await page.mouse.move(400, 400);
	await page.mouse.wheel(0, 120);
	await expect.poll(() => layerTransform(page)).not.toBe(before);
	return layerTransform(page);
};

test('the stage fits all after a switch, and a reload on the same page restores its view', async ({
	page,
}) => {
	// No saved view: A fits on its first layout, which is what B must get too.
	await openHarness(page);
	await stagePage(page, PAGE_A);
	await expect.poll(() => layerTransform(page)).not.toBeNull();
	const fitted = await layerTransform(page);
	await panStage(page);

	await stagePage(page, PAGE_B);
	await expect.poll(() => layerTransform(page)).toBe(fitted);

	// B's own view comes back after a reload that stages B.
	const panned = await panStage(page);
	await reload(page);
	await stagePage(page, PAGE_B);
	await expect.poll(() => layerTransform(page)).toBe(panned);
});

test('a reload that stages B restores B’s thread even with a draft saved for A', async ({
	page,
}) => {
	await openPageA(page);
	await clickChrome(commentButton(page));
	await openDraft(page, 'On A');
	await postToChrome(page, commentsOf(PAGE_B, [COMMENT_B]));
	await stagePage(page, PAGE_B);
	await clickChrome(commentButton(page));
	await openThread(page, COMMENT_B.id);

	await reload(page);
	await stagePage(page, PAGE_B);
	await postToChrome(page, commentsOf(PAGE_B, [COMMENT_B]));
	await expect(thread(page)).toBeVisible();
	await expect(thread(page)).toContainText(COMMENT_B.body);
	await expect(popover(page)).toBeHidden();
});

test('the mode and the comments panel’s open state carry across a switch', async ({ page }) => {
	await openPageA(page);
	await enterEditMode(page);
	await clickChrome(panelToggle(page));
	await expect(panel(page)).toBeVisible();

	await stagePage(page, PAGE_B);
	await expect(editButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(panel(page)).toBeVisible();
});

test('only the first page after a reload gets the saved thread back', async ({ page }) => {
	await openPageA(page, [COMMENT_A]);
	await openThread(page, COMMENT_A.id);

	await reload(page);
	await stagePage(page, PAGE_A);
	await postToChrome(page, commentsOf(PAGE_A, [COMMENT_A]));
	await expect(thread(page)).toBeVisible();

	// The saved thread was for that first stage; a later trip to A must not reopen it.
	await clickChrome(threadButton(page, 'Close'));
	await expect(thread(page)).toBeHidden();
	await postToChrome(page, commentsOf(PAGE_B, [COMMENT_B]));
	await stagePage(page, PAGE_B);
	await stagePage(page, PAGE_A);
	await postToChrome(page, commentsOf(PAGE_A, [COMMENT_A]));
	await expect(pinOf(page, COMMENT_A.id)).toBeVisible();
	await nextAnimationFrame(page);
	await expect(thread(page)).toHaveCount(0);
});
