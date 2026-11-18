import { expect } from '@playwright/test';
import { boxOf, clickChrome, commentButton, postToChrome, zoomSelect } from '../../harness';
import { openPanelUi, toolbar } from '../interact';
import { HANDOFF_STALE, type Session, settle, type StateDefinition, withComments } from '../scene';

export const toolbarStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	toolbarStates.push(definition);
};

// 1. Toolbar
const toolbarState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
	notes?: string[],
): void => {
	add({ surface: 'toolbar', state, setup, notes, run });
};
toolbarState(
	'default',
	'Three frames at 100%, 11 comments (10 unresolved: 9 open + 1 sent), panel closed, Interact mode.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
toolbarState('comment-mode', 'Clicked the Comment segment.', async ({ open, shoot, page }) => {
	await open(withComments());
	await clickChrome(commentButton(page));
	await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true');
	await page.mouse.move(640, 20);
	await settle(page);
	await shoot({ closeup: await boxOf(toolbar(page)) });
});
toolbarState(
	'zoom-select-focused',
	'Tabbed, then focused the Zoom select (the native popup is not captured by headless screenshots).',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await page.keyboard.press('Tab');
		await zoomSelect(page).focus();
		await settle(page);
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
	['The native <select> popup list is drawn by the OS and is absent from the screenshot.'],
);
toolbarState('zoom-75-readout', 'Chose 75% in the Zoom select.', async ({ open, shoot, page }) => {
	await open(withComments());
	await zoomSelect(page).selectOption('0.75');
	await settle(page);
	await shoot({ closeup: await boxOf(toolbar(page)) });
});
toolbarState(
	'panel-open-count',
	'Clicked Comments to open the panel; the button shows its pressed style and the count.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await openPanelUi(page);
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
toolbarState(
	'handoff-stale',
	'Host message ui:status { mcpAvailable: true, handoffStale: true }.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, HANDOFF_STALE);
		await settle(page);
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
toolbarState(
	'no-artboard-disabled',
	'No canvas:updated: the mode segments, zoom select and Fit all are disabled; Comments stays enabled.',
	async ({ open, shoot, page }) => {
		await open({ noCanvas: true });
		await shoot({ closeup: await boxOf(toolbar(page)) });
	},
);
