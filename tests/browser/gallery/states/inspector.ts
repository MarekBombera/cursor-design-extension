import { expect, type Page } from '@playwright/test';

import { MAX_PICK_STYLE_CHARS } from '../../../../src/disk/layout';
import {
	boxOf,
	clickAt,
	editFrame,
	enterEditMode,
	frameElementBox,
	frameOf,
	inspector,
	isMessageOfType,
	posted,
	postToChrome,
} from '../../harness';
import { type Session, settle, type StateDefinition } from '../scene';

export const inspectorStates: StateDefinition[] = [];

const EDIT_FRAME = editFrame({ id: 'edit', label: 'Edit fixture' });

const openEditMode = async ({ open, page }: Session): Promise<void> => {
	await open({ frames: [EDIT_FRAME] });
	await enterEditMode(page);
};

// Picks one fixture element; `x` is a fraction of its width (the button's right end is its text).
const pick = async (page: Page, selector: string, x = 0.5): Promise<void> => {
	const box = await frameElementBox({ page, frameId: 'edit', selector });
	await clickAt(page, { x: box.x + box.width * x, y: box.y + box.height / 2 });
	await expect(inspector(page).getByText(/^Edit fixture › /)).toBeVisible();
};

const inspectorState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
): void => {
	inspectorStates.push({ surface: 'inspector', state, setup, run });
};
inspectorState('empty', 'Clicked the Edit segment; nothing picked.', async (session) => {
	await openEditMode(session);
	await settle(session.page);
	await session.shoot({ closeup: await boxOf(inspector(session.page)) });
});
inspectorState(
	'editable',
	'Edit mode, picked the h1 (inline font size and colour, computed padding and margin).',
	async (session) => {
		await openEditMode(session);
		await pick(session.page, '#title');
		await settle(session.page);
		await session.shoot({ closeup: await boxOf(inspector(session.page)) });
	},
);
inspectorState(
	'mixed-content-hint',
	'Edit mode, picked a button holding a span: the text hint instead of a Text field.',
	async (session) => {
		await openEditMode(session);
		await pick(session.page, '#mixed', 0.9);
		await settle(session.page);
		await session.shoot({ closeup: await boxOf(inspector(session.page)) });
	},
);
inspectorState(
	'not-editable',
	'Edit mode, picked the div a script made: no source number.',
	async (session) => {
		await openEditMode(session);
		await pick(session.page, '#made');
		await settle(session.page);
		await session.shoot({ closeup: await boxOf(inspector(session.page)) });
	},
);
inspectorState(
	'field-error',
	'Edit mode, picked the padded div, typed an invalid padding and left the field (9e).',
	async (session) => {
		await openEditMode(session);
		await pick(session.page, '#padded');
		const padding = inspector(session.page).getByLabel('Padding', { exact: true });
		await padding.fill('4 apples;');
		await padding.blur();
		await expect(inspector(session.page).getByText(/^Not saved: use a number/)).toBeVisible();
		await settle(session.page);
		await session.shoot({ closeup: await boxOf(inspector(session.page)) });
	},
);
inspectorState(
	'request-error',
	'Edit mode, saved a margin on the h1 and the host refused it (conflict copy, 9e).',
	async (session) => {
		const { page } = session;
		await openEditMode(session);
		await pick(page, '#title');
		const margin = inspector(page).getByLabel('Margin', { exact: true });
		await margin.fill('4');
		await margin.blur();
		await expect
			.poll(
				async () =>
					(await posted(page)).filter((data) => isMessageOfType(data, 'artboard:edit')).length,
			)
			.toBe(1);
		const request = (await posted(page)).find((data) => isMessageOfType(data, 'artboard:edit'));
		await postToChrome(page, {
			type: 'ui:error',
			requestId: isMessageOfType(request, 'artboard:edit') ? String(request.requestId) : '',
			message: 'This artboard changed on disk. Make the edit again.',
		});
		await expect(inspector(page).getByText('This artboard changed on disk.')).toBeVisible();
		await settle(page);
		await session.shoot({ closeup: await boxOf(inspector(page)) });
	},
);
inspectorState(
	'style-too-long',
	'Edit mode, picked a div whose style attribute is over the cap: the hint, no style fields (9e).',
	async (session) => {
		const { page } = session;
		await openEditMode(session);
		await (await frameOf(page, 'edit')).locator('#padded').evaluate((element, length) => {
			element.setAttribute('style', `--x: ${'a'.repeat(length)}`);
		}, MAX_PICK_STYLE_CHARS);
		await pick(page, '#padded');
		await expect(inspector(page).getByText(/style attribute is too long/)).toBeVisible();
		await settle(page);
		await session.shoot({ closeup: await boxOf(inspector(page)) });
	},
);
