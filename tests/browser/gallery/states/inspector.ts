import { expect, type Page } from '@playwright/test';

import {
	boxOf,
	clickAt,
	editFrame,
	enterEditMode,
	frameElementBox,
	inspector,
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

// 9. Inspector (Edit mode)
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
