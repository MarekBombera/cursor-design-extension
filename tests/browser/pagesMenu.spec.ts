import { expect, type Page, test } from '@playwright/test';

import type { CanvasUpdatedMessage, PostedPage } from '../../src/webview/hostMessages';
import {
	canvasUpdated,
	clickChrome,
	commentButton,
	editFrame,
	isMessageOfType,
	lastRequest,
	loadsOf,
	nextAnimationFrame,
	openHarness,
	pageButton,
	pageRow,
	pagesMenu,
	panelToggle,
	posted,
	postToChrome,
} from './harness';

// The host stub is the harness: requests are the captured posts, answers are posted by the test.

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

// Built per call: a module-level `ago(5)` would read "6 minutes ago" after a minute of queueing.
const pagesNow = (): PostedPage[] => [
	{ id: 'page-1', title: 'Home', updatedAt: ago(5) },
	{ id: 'page-2', title: 'Pricing', updatedAt: null },
	{ id: 'page-3', title: 'Checkout', updatedAt: ago(60 * 26) },
];

const stageOf = (
	pageId: string,
	pages: PostedPage[] = pagesNow(),
	frames: CanvasUpdatedMessage['frames'] = [],
): CanvasUpdatedMessage => ({ ...canvasUpdated(frames), pageId, pages });

const openOn = async (page: Page, pages: PostedPage[] = pagesNow()): Promise<void> => {
	await openHarness(page);
	await postToChrome(page, stageOf('page-1', pages));
	await expect(pageButton(page)).toBeEnabled();
};

const openMenu = async (page: Page): Promise<void> => {
	await clickChrome(pageButton(page));
	await expect(pagesMenu(page)).toBeVisible();
};

const PAGE_REQUESTS = ['page:open', 'page:create', 'page:rename', 'page:delete'];

const pageRequests = async (page: Page): Promise<unknown[]> =>
	(await posted(page)).filter((message) =>
		PAGE_REQUESTS.some((type) => isMessageOfType(message, type)),
	);

const saved = (request: Record<string, unknown>) => ({
	type: 'page:saved' as const,
	requestId: String(request.requestId),
});

const renameButton = (page: Page, id: string) => page.locator(`[data-cd-page-rename="${id}"]`);
const deleteButton = (page: Page, id: string) => page.locator(`[data-cd-page-delete="${id}"]`);
const newPageButton = (page: Page) => page.locator('[data-cd-page-new]');
const titleField = (page: Page) => pagesMenu(page).getByRole('textbox', { name: 'Page title' });

test('the page button shows the open title and toggles aria-expanded', async ({ page }) => {
	await openOn(page);
	await expect(pageButton(page)).toHaveAccessibleName('Page: Home');
	await expect(pageButton(page)).toHaveAttribute('title', 'Home');
	await expect(pageButton(page)).toHaveAttribute('aria-expanded', 'false');
	await openMenu(page);
	await expect(pageButton(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(pageButton(page)).toHaveAttribute('aria-controls', 'cd-pages-menu');
	await expect(pagesMenu(page)).toHaveId('cd-pages-menu');
});

test('the menu lists pages in order with their times and marks the open page', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	const rows = pagesMenu(page).locator('[data-cd-page-row]');
	await expect(rows).toHaveCount(3);
	expect(await rows.evaluateAll((buttons) => buttons.map((b) => b.dataset.cdPageRow))).toEqual([
		'page-1',
		'page-2',
		'page-3',
	]);
	await expect(pageRow(page, 'page-1')).toHaveAccessibleName('Home edited 5 minutes ago');
	await expect(pageRow(page, 'page-2')).toHaveAccessibleName('Pricing');
	await expect(pageRow(page, 'page-3')).toHaveAccessibleName('Checkout edited yesterday');
	await expect(pageRow(page, 'page-1')).toHaveAttribute('aria-current', 'page');
	await expect(pageRow(page, 'page-2')).not.toHaveAttribute('aria-current');
	// Opening focuses the open page's row.
	await expect(pageRow(page, 'page-1')).toBeFocused();
});

test('opening another page posts page:open; the switch lands focus on the new button', async ({
	page,
}) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(pageRow(page, 'page-2'));
	const request = await lastRequest(page, 'page:open');
	expect(request.pageId).toBe('page-2');
	expect(Object.keys(request).sort()).toEqual(['pageId', 'requestId', 'type']);

	await postToChrome(page, saved(request));
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).toBeFocused();
	await postToChrome(page, stageOf('page-2'));
	await expect(pageButton(page)).toHaveAccessibleName('Page: Pricing');
	await expect(pageButton(page)).toBeFocused();
});

test('opening the open page closes the menu and posts nothing', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(pageRow(page, 'page-1'));
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).toBeFocused();
	expect(await pageRequests(page)).toEqual([]);
});

test('New blank page posts page:create', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(newPageButton(page));
	const request = await lastRequest(page, 'page:create');
	expect(Object.keys(request).sort()).toEqual(['requestId', 'type']);
});

test('rename posts the raw draft; an error shows under the editable field', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(renameButton(page, 'page-2'));
	await expect(titleField(page)).toBeFocused();
	await expect(titleField(page)).toHaveValue('Pricing');
	// Prefilled and selected: typing replaces it.
	await page.keyboard.type('  Plans  ');
	await page.keyboard.press('Enter');
	const request = await lastRequest(page, 'page:rename');
	expect(request).toMatchObject({ pageId: 'page-2', title: '  Plans  ' });

	await expect(titleField(page)).toBeFocused();
	await expect(titleField(page)).toHaveAttribute('readonly', '');
	await expect(pagesMenu(page).getByText('Renaming page…')).toBeAttached();

	await postToChrome(page, {
		type: 'ui:error',
		requestId: String(request.requestId),
		message: 'A page title needs 1 to 80 characters and no control characters.',
	});
	const alert = pagesMenu(page).getByRole('alert');
	await expect(alert).toHaveText(
		'A page title needs 1 to 80 characters and no control characters.',
	);
	await expect(titleField(page)).toHaveAttribute('aria-invalid', 'true');
	await expect(titleField(page)).toHaveAttribute('aria-describedby', 'cd-page-rename-error');
	await expect(titleField(page)).not.toHaveAttribute('readonly');
	await expect(titleField(page)).toBeFocused();

	// An edit clears the error; a success ends the field and focuses that row's Rename.
	await page.keyboard.type('x');
	await expect(alert).toHaveCount(0);
	await page.keyboard.press('Enter');
	const second = await lastRequest(page, 'page:rename');
	expect(second.requestId).not.toBe(request.requestId);
	await postToChrome(page, saved(second));
	await expect(titleField(page)).toHaveCount(0);
	await expect(renameButton(page, 'page-2')).toBeFocused();
	await expect(pagesMenu(page)).toBeVisible();
});

test('Escape in the rename field cancels, posts nothing and focuses Rename', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(renameButton(page, 'page-3'));
	await page.keyboard.type('Draft');
	await page.keyboard.press('Escape');
	await expect(titleField(page)).toHaveCount(0);
	await expect(renameButton(page, 'page-3')).toBeFocused();
	await expect(pagesMenu(page)).toBeVisible();
	expect(await pageRequests(page)).toEqual([]);
});

test('delete posts page:delete; a cancel closes, a confirm drops the row', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(deleteButton(page, 'page-3'));
	const cancelled = await lastRequest(page, 'page:delete');
	expect(cancelled.pageId).toBe('page-3');
	// The modal's Cancel: page:saved and the refresh with the same list.
	await postToChrome(page, saved(cancelled));
	await postToChrome(page, stageOf('page-1'));
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).toHaveAccessibleName('Page: Home');

	await openMenu(page);
	await clickChrome(deleteButton(page, 'page-3'));
	const confirmed = await lastRequest(page, 'page:delete');
	expect(confirmed.requestId).not.toBe(cancelled.requestId);
	await postToChrome(page, saved(confirmed));
	await postToChrome(page, stageOf('page-1', pagesNow().slice(0, 2)));
	await openMenu(page);
	await expect(pageRow(page, 'page-3')).toHaveCount(0);
	await expect(pagesMenu(page).locator('[data-cd-page-row]')).toHaveCount(2);
});

test('Delete is disabled on the last page', async ({ page }) => {
	await openOn(page, pagesNow().slice(0, 1));
	await openMenu(page);
	await expect(deleteButton(page, 'page-1')).toBeDisabled();
	await clickChrome(deleteButton(page, 'page-1'));
	await nextAnimationFrame(page);
	expect(await pageRequests(page)).toEqual([]);
});

test('while a request is in flight nothing else posts and Escape keeps the menu', async ({
	page,
}) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(newPageButton(page));
	await lastRequest(page, 'page:create');
	await expect(newPageButton(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(pageButton(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(pagesMenu(page).getByText('Creating page…')).toBeAttached();

	await clickChrome(pageRow(page, 'page-2'));
	await clickChrome(deleteButton(page, 'page-2'));
	await clickChrome(renameButton(page, 'page-2'));
	await clickChrome(pageButton(page));
	await page.keyboard.press('Escape');
	// An outside pointerdown is ignored too.
	await page.mouse.click(640, 600);
	await nextAnimationFrame(page);
	await expect(pagesMenu(page)).toBeVisible();
	await expect(titleField(page)).toHaveCount(0);
	expect(await pageRequests(page)).toHaveLength(1);
});

test('Escape closing the menu in Comment mode leaves the mode on Comment', async ({ page }) => {
	await openHarness(page);
	const frame = editFrame({ id: 'artboard', label: 'Artboard' });
	await postToChrome(page, stageOf('page-1', pagesNow(), [frame]));
	await expect.poll(() => loadsOf(page, frame.id)).toBeGreaterThan(0);
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await openMenu(page);
	await page.keyboard.press('Escape');
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).toBeFocused();
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('Escape on the page button closes the menu and leaves Comment mode on', async ({ page }) => {
	await openHarness(page);
	const frame = editFrame({ id: 'artboard', label: 'Artboard' });
	await postToChrome(page, stageOf('page-1', pagesNow(), [frame]));
	await expect.poll(() => loadsOf(page, frame.id)).toBeGreaterThan(0);
	await clickChrome(commentButton(page));
	await openMenu(page);
	await page.keyboard.press('Shift+Tab');
	await expect(pageButton(page)).toBeFocused();
	await expect(pagesMenu(page)).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(pagesMenu(page)).toBeHidden();
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('a rename error that lands after Tab leaves the field is still shown', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(renameButton(page, 'page-2'));
	await page.keyboard.type('Plans');
	await page.keyboard.press('Enter');
	const request = await lastRequest(page, 'page:rename');
	// Focus leaves the field while the request is in flight: the field stays.
	await page.keyboard.press('Tab');
	await expect(titleField(page)).toHaveCount(1);
	await postToChrome(page, {
		type: 'ui:error',
		requestId: String(request.requestId),
		message: 'That page no longer exists.',
	});
	await expect(pagesMenu(page).getByRole('alert')).toHaveText('That page no longer exists.');
	await expect(titleField(page)).toHaveAttribute('aria-invalid', 'true');
});

test('a rename error leaves focus where the user moved it during the request', async ({ page }) => {
	await openHarness(page);
	const frame = editFrame({ id: 'artboard', label: 'Artboard' });
	await postToChrome(page, stageOf('page-1', pagesNow(), [frame]));
	await expect.poll(() => loadsOf(page, frame.id)).toBeGreaterThan(0);
	await openMenu(page);
	await clickChrome(renameButton(page, 'page-2'));
	await page.keyboard.type('Plans');
	await page.keyboard.press('Enter');
	const request = await lastRequest(page, 'page:rename');
	// A click outside keeps the menu open while the request is in flight, but moves focus.
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toBeFocused();
	await postToChrome(page, {
		type: 'ui:error',
		requestId: String(request.requestId),
		message: 'That page no longer exists.',
	});
	await expect(pagesMenu(page).getByRole('alert')).toHaveText('That page no longer exists.');
	await expect(titleField(page)).toHaveAttribute('aria-invalid', 'true');
	await expect(commentButton(page)).toBeFocused();
});

test('leaving the rename field with Tab ends the rename', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(renameButton(page, 'page-2'));
	await expect(titleField(page)).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(titleField(page)).toHaveCount(0);
	expect(await pageRequests(page)).toEqual([]);
});

test('the whole flow works from the keyboard', async ({ page }) => {
	await openOn(page);
	await page.keyboard.press('Tab');
	await expect(pageButton(page)).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(pageRow(page, 'page-1')).toBeFocused();
	// Arrows wrap through the rows and New blank page; Home / End jump.
	await page.keyboard.press('ArrowUp');
	await expect(newPageButton(page)).toBeFocused();
	await page.keyboard.press('Home');
	await expect(pageRow(page, 'page-1')).toBeFocused();
	await page.keyboard.press('End');
	await expect(newPageButton(page)).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowDown');
	await expect(pageRow(page, 'page-2')).toBeFocused();
	// Tab walks the row's controls.
	await page.keyboard.press('Tab');
	await expect(renameButton(page, 'page-2')).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Enter');
	const request = await lastRequest(page, 'page:open');
	expect(request.pageId).toBe('page-2');
	await postToChrome(page, saved(request));
	await expect(pageButton(page)).toBeFocused();
	await postToChrome(page, stageOf('page-2'));
	await expect(pageButton(page)).toBeFocused();

	await page.keyboard.press('Space');
	await expect(pageRow(page, 'page-2')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).toBeFocused();
});

test('a switch with focus in the menu focuses the new button; elsewhere focus stays', async ({
	page,
}) => {
	await openOn(page);
	await openMenu(page);
	await expect(pageRow(page, 'page-1')).toBeFocused();
	// An Agent switch while the menu has focus.
	await postToChrome(page, stageOf('page-3'));
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).toBeFocused();
	await expect(pageButton(page)).toHaveAccessibleName('Page: Checkout');

	await panelToggle(page).focus();
	await postToChrome(page, stageOf('page-1'));
	await expect(pageButton(page)).toHaveAccessibleName('Page: Home');
	await expect(pageButton(page)).not.toBeFocused();
});

test('a switch during a request keeps the menu open for its answer', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(deleteButton(page, 'page-1'));
	const request = await lastRequest(page, 'page:delete');
	// A watcher refresh beats the answer.
	await postToChrome(page, stageOf('page-2'));
	await expect(pageButton(page)).toHaveAccessibleName('Page: Pricing');
	await expect(pagesMenu(page)).toBeVisible();
	await postToChrome(page, {
		type: 'ui:error',
		requestId: String(request.requestId),
		message: 'That page no longer exists.',
	});
	await expect(pagesMenu(page).getByRole('alert')).toHaveText('That page no longer exists.');
	await expect(newPageButton(page)).not.toHaveAttribute('aria-disabled');
});

test('a stray page:saved changes nothing', async ({ page }) => {
	await openOn(page);
	await openMenu(page);
	await clickChrome(newPageButton(page));
	await lastRequest(page, 'page:create');
	await postToChrome(page, { type: 'page:saved', requestId: 'not-a-request' });
	await nextAnimationFrame(page);
	await expect(pagesMenu(page)).toBeVisible();
	await expect(newPageButton(page)).toHaveAttribute('aria-disabled', 'true');
});

test('an empty page list disables the button', async ({ page }) => {
	await openOn(page);
	await postToChrome(page, { ...stageOf('page-1'), pageId: '', pages: [] });
	await expect(pageButton(page)).toBeDisabled();
});

test('an outside pointerdown or focus leaving closes the menu without moving focus', async ({
	page,
}) => {
	await openOn(page);
	await openMenu(page);
	await page.mouse.click(640, 600);
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).not.toBeFocused();

	await openMenu(page);
	await newPageButton(page).focus();
	await page.keyboard.press('Tab');
	await expect(pagesMenu(page)).toBeHidden();
	await expect(pageButton(page)).not.toBeFocused();
	expect(await pageRequests(page)).toEqual([]);
});
