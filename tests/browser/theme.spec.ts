import { expect, type Locator, test } from '@playwright/test';

import type { PostedComment } from '../../src/webview/hostMessages';
import { clickChrome, openHarness, panelItem, postToChrome } from './harness';
import { VSCODE_THEME_VARIABLES } from './vscodeHost';

// theme.css against Cursor's real _defaultStyles (vscodeHost.ts), mostly in Light Modern: the global layer
// must win by source order, with no cascade layers.

const COMMENT: PostedComment = {
	id: 'c-title',
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
};

// Light Modern's focusBorder (#005fb8) and keybindingLabel.background (#dddddd66).
const FOCUS_COLOUR = 'rgb(0, 95, 184)';
const KBD_BACKGROUND = 'rgba(221, 221, 221, 0.4)';

const style = (locator: Locator, property: string): Promise<string> =>
	locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

// The built chrome.css is minified, so 120ms may read back as .12s.
const durationMs = (value: string): number =>
	value.trim().endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;

test('the body drops the host padding and paints the editor background', async ({ page }) => {
	await openHarness(page, { vscodeHost: 'light' });
	const body = page.locator('body');
	await expect(body).toHaveClass('vscode-light');
	expect(await style(body, 'padding-left')).toBe('0px');
	expect(await style(body, 'padding-right')).toBe('0px');
	expect(await style(body, 'background-color')).toBe('rgb(255, 255, 255)');
});

test('a primary button gets the offset 2px ring and the textarea the inset 1px ring', async ({
	page,
}) => {
	await openHarness(page, { vscodeHost: 'light' });
	await postToChrome(page, { type: 'comments:updated', comments: [COMMENT] });
	await clickChrome(page.getByRole('button', { name: /^Comments/ }));
	await clickChrome(
		panelItem(page, COMMENT.id).getByRole('button', { name: 'Reply', exact: true }),
	);

	const textarea = panelItem(page, COMMENT.id).getByRole('textbox', { name: 'Reply' });
	await expect(textarea).toBeFocused();
	expect(await style(textarea, 'outline-style')).toBe('solid');
	expect(await style(textarea, 'outline-width')).toBe('1px');
	expect(await style(textarea, 'outline-offset')).toBe('-1px');
	expect(await style(textarea, 'outline-color')).toBe(FOCUS_COLOUR);

	// Cancel sits between the textarea and Add reply.
	await page.keyboard.press('Tab');
	await page.keyboard.press('Tab');
	const addReply = panelItem(page, COMMENT.id).getByRole('button', {
		name: 'Add reply',
		exact: true,
	});
	await expect(addReply).toBeFocused();
	expect(await style(addReply, 'outline-style')).toBe('solid');
	expect(await style(addReply, 'outline-width')).toBe('2px');
	expect(await style(addReply, 'outline-offset')).toBe('2px');
	expect(await style(addReply, 'outline-color')).toBe(FOCUS_COLOUR);
});

test('a kbd takes the token look over the host rule', async ({ page }) => {
	await openHarness(page, { vscodeHost: 'light' });
	// The toolbar's C hint next to the mode group.
	const kbd = page.getByRole('banner').locator('kbd');
	expect(await style(kbd, 'background-color')).toBe(KBD_BACKGROUND);
	// The host's kbd is 1px all round with an inset shadow; the token look has a 2px bottom edge.
	expect(await style(kbd, 'border-bottom-width')).toBe('2px');
	expect(await style(kbd, 'box-shadow')).toBe('none');
});

test('dark themes put dark ink on the Agent purple', async ({ page }) => {
	await openHarness(page, { vscodeHost: 'dark' });
	const body = page.locator('body');
	await expect(body).toHaveClass('vscode-dark');
	expect((await style(body, '--cd-on-agent')).trim()).toBe(
		VSCODE_THEME_VARIABLES.dark['--vscode-editor-background'],
	);
});

test("Cursor's reduce-motion class stops motion like the OS setting", async ({ page }) => {
	await openHarness(page, { vscodeHost: 'light' });
	const body = page.locator('body');
	expect(durationMs(await style(body, '--cd-dur'))).toBe(120);
	await body.evaluate((element) => element.classList.add('vscode-reduce-motion'));
	expect(durationMs(await style(body, '--cd-dur'))).toBe(0);
	expect((await style(body, '--cd-spin')).trim()).toBe('none');
});
