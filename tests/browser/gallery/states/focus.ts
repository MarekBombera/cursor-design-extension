import { type Locator, type Page } from '@playwright/test';
import {
	boxOf,
	commentButton,
	copyOpenButton,
	panelButton,
	panelToggle,
	pinOf,
	popover,
	zoomSelect,
} from '../../harness';
import { handleOf, jumpChip, labelOf, pickElement } from '../interact';
import { settle, type StateDefinition, withComments } from '../scene';
import { shootPopover } from './popover';

export const focusStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	focusStates.push(definition);
};

const focusState = ({
	state,
	setup,
	target,
	panelOpen = false,
	closeup = false,
}: {
	state: string;
	setup: string;
	target: (page: Page) => Locator;
	panelOpen?: boolean;
	closeup?: boolean;
}): void => {
	add({
		surface: 'focus',
		state,
		setup,
		run: async ({ open, shoot, page }) => {
			await open(withComments({ panel: panelOpen }));
			// A key press first, so :focus-visible applies to the scripted focus.
			await page.keyboard.press('Tab');
			await target(page).focus();
			await settle(page);
			await shoot(closeup ? { closeup: await boxOf(target(page)) } : {});
		},
	});
};
focusState({
	state: 'toolbar-comment-button',
	setup: 'Tab then focus() on the Comment segment.',
	target: commentButton,
	closeup: true,
});
focusState({
	state: 'toolbar-comments-button',
	setup: 'Focus on the Comments button.',
	target: panelToggle,
	closeup: true,
});
focusState({
	state: 'toolbar-zoom-select',
	setup: 'Focus on the Zoom select.',
	target: zoomSelect,
	closeup: true,
});
focusState({
	state: 'toolbar-fit-all',
	setup: 'Focus on Fit all.',
	target: (page) => page.getByRole('button', { name: 'Fit all' }),
	closeup: true,
});
focusState({
	state: 'frame-label',
	setup: 'Focus on the Pricing frame label.',
	target: (page) => labelOf(page, 'pricing'),
});
focusState({
	state: 'frame-resize-handle',
	setup: 'Focus on the Home resize handle.',
	target: (page) => handleOf(page, 'home'),
});
focusState({
	state: 'pin',
	setup: 'Focus on the #hero-title pin.',
	target: (page) => pinOf(page, 'h-title'),
});
focusState({
	state: 'panel-card-button',
	setup: 'Panel open, focus on the Resolve button of the #hero-title card.',
	target: (page) => panelButton(page, 'h-title', 'Resolve'),
	panelOpen: true,
});
focusState({
	state: 'panel-card-chip',
	setup: 'Panel open, focus on the target chip (jump) of the #cta-primary card.',
	target: (page) => jumpChip(page, 'h-cta'),
	panelOpen: true,
});
focusState({
	state: 'panel-copy-open',
	setup: 'Panel open, focus on the copy-open button.',
	target: copyOpenButton,
	panelOpen: true,
});
add({
	surface: 'focus',
	state: 'popover-textarea',
	setup: 'Popover open, textarea focused by default.',
	run: async (session) => {
		await session.open({});
		await pickElement(session.page, 'home', '#hero-title');
		await shootPopover(session);
	},
});
add({
	surface: 'focus',
	state: 'popover-button',
	setup: 'Popover open, Tab moved to the Add comment button after typing.',
	run: async (session) => {
		const { page } = session;
		await session.open({});
		await pickElement(page, 'home', '#hero-title');
		await page.keyboard.type('Looks good');
		await popover(page).getByRole('button', { name: 'Add comment' }).focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await shootPopover(session);
	},
});
