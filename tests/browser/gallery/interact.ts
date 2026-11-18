import { type CDPSession, expect, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
	type Box,
	boxOf,
	clickAt,
	clickChrome,
	commentButton,
	frameBox,
	frameOf,
	isMessageOfType,
	panel,
	panelItem,
	panelToggle,
	pinOf,
	popover,
	posted,
	thread,
} from '../harness';
import { settle } from './scene';

// Gallery page helpers: the 2x close-up capture, locators and the clicks, hovers and gestures the
// states use.

const cdpSessions = new WeakMap<Page, CDPSession>();

// A 2x clip through CDP (clip.scale re-rasterises, so text is crisp). The clip is in document
// coordinates and the root is the stage's scroll sink, so its offset is added.
export const captureAt2x = async (page: Page, path: string, clip: Box): Promise<void> => {
	let session = cdpSessions.get(page);
	if (session === undefined) {
		session = await page.context().newCDPSession(page);
		cdpSessions.set(page, session);
	}
	const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
	await page.addStyleTag({ content: '* { caret-color: transparent !important; }' });
	const { data } = await session.send('Page.captureScreenshot', {
		format: 'png',
		clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y, scale: 2 },
		captureBeyondViewport: false,
	});
	writeFileSync(path, Buffer.from(data, 'base64'));
};

export const padded = (box: Box, margin = 24): Box => {
	const x = Math.max(0, Math.floor(box.x - margin));
	const y = Math.max(0, Math.floor(box.y - margin));
	const right = Math.min(1280, Math.ceil(box.x + box.width + margin));
	const bottom = Math.min(800, Math.ceil(box.y + box.height + margin));
	return { x, y, width: right - x, height: bottom - y };
};

export const unionOf = (boxes: Box[]): Box => {
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.width));
	const bottom = Math.max(...boxes.map((box) => box.y + box.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
};

export const toolbar = (page: Page): Locator => page.getByRole('banner');
export const jumpChip = (page: Page, id: string): Locator =>
	panelItem(page, id).locator('[data-cd-focus="jump"]');
export const labelOf = (page: Page, id: string): Locator =>
	page.locator(`[data-cd-frame-label="${id}"]`);
export const handleOf = (page: Page, id: string): Locator =>
	page.locator(`[data-cd-frame-resize="${id}"]`);

export const lastRequest = async (page: Page, type: string): Promise<Record<string, unknown>> => {
	const ofType = async (): Promise<Record<string, unknown>[]> =>
		(await posted(page)).filter((message): message is Record<string, unknown> =>
			isMessageOfType(message, type),
		);
	await expect.poll(async () => (await ofType()).length).toBeGreaterThan(0);
	return (await ofType()).at(-1) as Record<string, unknown>;
};

export const pointIn = async ({
	page,
	frameId,
	selector,
	zoom = 1,
	fx = 0.5,
	fy = 0.5,
}: {
	page: Page;
	frameId: string;
	selector: string;
	zoom?: number;
	fx?: number;
	fy?: number;
}): Promise<{ x: number; y: number }> => {
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
	return {
		x: frame.x + (rect.x + rect.width * fx) * zoom,
		y: frame.y + (rect.y + rect.height * fy) * zoom,
	};
};

export const hoverOver = async (
	page: Page,
	point: { x: number; y: number },
	from = 20,
): Promise<void> => {
	await page.mouse.move(point.x - from, point.y, { steps: 5 });
	await page.mouse.move(point.x, point.y, { steps: 5 });
	await page.waitForTimeout(250);
};

export const pickElement = async (page: Page, frameId: string, selector: string): Promise<void> => {
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	const point = await pointIn({ page, frameId, selector });
	await page.mouse.move(point.x, point.y, { steps: 4 });
	await page.mouse.move(point.x + 0.5, point.y + 0.5);
	await page.waitForTimeout(120);
	await clickAt(page, point);
	await expect(popover(page)).toBeVisible();
	// Typing before the box has focus goes nowhere.
	await expect(popover(page).getByRole('textbox', { name: 'Comment' })).toBeFocused();
};

export const openThread = async (page: Page, id: string): Promise<void> => {
	await expect(pinOf(page, id)).toBeVisible();
	// Near the tip, the part on its target's corner: a target at the frame's left edge puts the
	// pin's body off the stage edge at the gallery view (F-108).
	const pin = await boxOf(pinOf(page, id));
	await clickAt(page, { x: pin.x + pin.width - 4, y: pin.y + pin.height - 4 });
	await expect(thread(page)).toBeVisible();
	await settle(page);
};

export const openPanelUi = async (page: Page): Promise<void> => {
	await clickChrome(panelToggle(page));
	await expect(panel(page)).toBeVisible();
	await settle(page);
};

export const frameGesture = async ({
	page,
	label,
	dx,
	dy,
	release,
}: {
	page: Page;
	label: Locator;
	dx: number;
	dy: number;
	release: boolean;
}): Promise<void> => {
	const box = await boxOf(label);
	await page.mouse.move(box.x + 10, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 10 + dx, box.y + box.height / 2 + dy, { steps: 10 });
	if (release) {
		await page.mouse.up();
	}
};
