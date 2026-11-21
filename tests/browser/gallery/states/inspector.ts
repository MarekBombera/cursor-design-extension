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

export const openEditMode = async ({
	open,
	page,
}: Pick<Session, 'open' | 'page'>): Promise<void> => {
	await open({ frames: [EDIT_FRAME] });
	await enterEditMode(page);
};

// Picks one fixture element; `x` is a fraction of its width (the button's right end is its text).
export const pickToEdit = async (page: Page, selector: string, x = 0.5): Promise<void> => {
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
// Picks one element and shoots the inspector; `section` scrolls that section into view first.
const pickedState = ({
	state,
	setup,
	selector,
	x,
	section,
}: {
	state: string;
	setup: string;
	selector: string;
	x?: number;
	section?: string;
}): void => {
	inspectorState(state, setup, async (session) => {
		const { page } = session;
		await openEditMode(session);
		await pickToEdit(page, selector, x);
		if (section !== undefined) {
			await inspector(page).locator(`[data-cd-section="${section}"]`).scrollIntoViewIfNeeded();
		}
		await settle(page);
		await session.shoot({ closeup: await boxOf(inspector(page)) });
	});
};
pickedState({
	state: 'text',
	setup:
		'Edit mode, picked the h1: Text with Content, Size and Color set (the dot), the rest computed.',
	selector: '#title',
});
pickedState({
	state: 'mixed',
	setup: 'Edit mode, picked a button holding a span: Typography with the hint, no Content.',
	selector: '#mixed',
	x: 0.9,
});
pickedState({
	state: 'container-gap',
	setup: 'Edit mode, picked the flex row: no text section; Spacing shows Gap (12px computed).',
	selector: '#row',
});
pickedState({
	state: 'img',
	setup:
		'Edit mode, picked the img: Appearance, Spacing and Border only; a background parent stays unset.',
	selector: '#picture',
});
pickedState({
	state: 'border-present',
	setup: 'Edit mode, picked the p with an inline border shorthand: three set border fields, Reset.',
	selector: '#boxed',
	section: 'border',
});
pickedState({
	state: 'add-border',
	setup: 'Edit mode, picked a p with no border: the Border section offers Add border.',
	selector: '#spaced',
	section: 'border',
});
inspectorState(
	'narrow-one-column',
	'Edit mode at an 820px-wide viewport (inspector about 246px): the fields stack in one column.',
	async (session) => {
		const { page } = session;
		await page.setViewportSize({ width: 820, height: 800 });
		await openEditMode(session);
		await pickToEdit(page, '#title');
		await settle(page);
		await session.shoot({ closeup: await boxOf(inspector(page)) });
	},
);
inspectorState(
	'not-editable',
	'Edit mode, picked the div a script made: no source number.',
	async (session) => {
		await openEditMode(session);
		await pickToEdit(session.page, '#made');
		await settle(session.page);
		await session.shoot({ closeup: await boxOf(inspector(session.page)) });
	},
);
inspectorState(
	'field-error',
	'Edit mode, picked the padded div, typed an invalid padding and left the field (9e).',
	async (session) => {
		await openEditMode(session);
		await pickToEdit(session.page, '#padded');
		const padding = inspector(session.page).locator('[data-cd-field="padding"]');
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
		await pickToEdit(page, '#title');
		const margin = inspector(page).locator('[data-cd-field="margin"]');
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
		await pickToEdit(page, '#padded');
		await expect(inspector(page).getByText(/style attribute is too long/)).toBeVisible();
		await settle(page);
		await session.shoot({ closeup: await boxOf(inspector(page)) });
	},
);
