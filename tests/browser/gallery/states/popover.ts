import { expect } from '@playwright/test';
import {
	boxOf,
	clickAt,
	clickChrome,
	commentButton,
	frameBox,
	popover,
	postToChrome,
	stageBox,
} from '../../harness';
import { hoverOver, lastRequest, pickElement, pointIn } from '../interact';
import { FRAMES, type Session, settle, type StateDefinition, VIEW } from '../scene';

export const popoverStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	popoverStates.push(definition);
};

add({
	surface: 'comment',
	state: 'hover-outline',
	setup: 'Comment mode on, mouse over the #feature-2 card in Home (view scrolled down 280px).',
	run: async ({ open, shoot, page }) => {
		await open({ view: { x: 6, y: -280, zoom: 1 } });
		await clickChrome(commentButton(page));
		await hoverOver(page, await pointIn({ page, frameId: 'home', selector: '#feature-2' }));
		await shoot();
	},
});
add({
	surface: 'comment',
	state: 'hover-outline-small',
	setup: 'Comment mode, mouse over #nav-cta (a small button) with the default view.',
	run: async ({ open, shoot, page }) => {
		await open({});
		await clickChrome(commentButton(page));
		await hoverOver(page, await pointIn({ page, frameId: 'home', selector: '#nav-cta' }), 10);
		await shoot();
	},
});
const popoverState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
): void => {
	add({ surface: 'popover', state, setup, run });
};
export const shootPopover = async ({ shoot, page }: Session): Promise<void> => {
	await settle(page);
	await shoot({ closeup: await boxOf(popover(page)) });
};
popoverState(
	'empty',
	'Comment mode, clicked #hero-title; popover opened, textarea focused, Add disabled.',
	async (session) => {
		await session.open({});
		await pickElement(session.page, 'home', '#hero-title');
		await shootPopover(session);
	},
);
popoverState('with-text', 'Same pick, typed a two-line body.', async (session) => {
	await session.open({});
	await pickElement(session.page, 'home', '#hero-title');
	await session.page.keyboard.type(
		'Make the headline one line on tablet and drop the second clause.',
	);
	await session.page.keyboard.press('Shift+Enter');
	await session.page.keyboard.type('Keep the weight at 800.');
	await shootPopover(session);
});
popoverState(
	'long-chip-text',
	'Picked #deep-target (long element text, deep selector) after scrolling the view.',
	async (session) => {
		await session.open({ view: { x: 6, y: -520, zoom: 1 } });
		await pickElement(session.page, 'home', '#deep-target');
		await session.page.keyboard.type('Spec text reads awkwardly.');
		await shootPopover(session);
	},
);
popoverState(
	'page-pick',
	'Clicked the empty body area under the footer of Home (whole-frame pick).',
	async (session) => {
		const { page } = session;
		await session.open({});
		const home = await frameBox(page, 'home');
		const stage = await stageBox(page);
		// Re-open with the view scrolled so the bottom of Home is on screen.
		await session.reopen({ view: { x: 6, y: stage.height - 40 - home.height, zoom: 1 } });
		await clickChrome(commentButton(page));
		const frame = await frameBox(page, 'home');
		const point = { x: frame.x + 240, y: frame.y + frame.height - 20 };
		await page.mouse.move(point.x, point.y, { steps: 4 });
		await page.mouse.move(point.x + 1, point.y);
		await page.waitForTimeout(150);
		await clickAt(page, point);
		await expect(popover(page)).toBeVisible();
		await shootPopover(session);
	},
);
popoverState(
	'near-right-bottom-edge',
	'Re-opened with the view panned so #m-fab (bottom-right of Mobile) sits ~30px from the stage corner, then picked it.',
	async (session) => {
		const { page } = session;
		await session.open({});
		const stage = await stageBox(page);
		const point = await pointIn({ page, frameId: 'mobile', selector: '#m-fab' });
		await session.reopen({
			view: {
				x: VIEW.x + (stage.x + stage.width - 30 - point.x),
				y: VIEW.y + (stage.y + stage.height - 30 - point.y),
				zoom: 1,
			},
		});
		await pickElement(page, 'mobile', '#m-fab');
		await shootPopover(session);
	},
);
popoverState(
	'host-error',
	'Typed a body, pressed Add comment, host answered ui:error with the matching requestId.',
	async (session) => {
		const { page } = session;
		await session.open({});
		await pickElement(page, 'home', '#hero-sub');
		await page.keyboard.type('Tighten this copy.');
		await page.keyboard.press('Enter');
		const request = await lastRequest(page, 'comment:create');
		await postToChrome(page, {
			type: 'ui:error',
			message:
				'Could not save the comment. Fix .cursor-design/pages/page-1/comments.json and try again.',
			requestId: String(request.requestId),
		});
		await shootPopover(session);
	},
);
popoverState(
	'pending',
	'Typed a body, pressed Add comment, no host answer yet (pending).',
	async (session) => {
		const { page } = session;
		await session.open({});
		await pickElement(page, 'home', '#hero-sub');
		await page.keyboard.type('Tighten this copy.');
		await page.keyboard.press('Enter');
		await lastRequest(page, 'comment:create');
		await shootPopover(session);
	},
);
popoverState(
	'no-version-blocked',
	'Frame generation 0 (no artboard version): pick then type; the blocked-target copy shows.',
	async (session) => {
		await session.open({
			frames: FRAMES.map((frame) => (frame.id === 'home' ? { ...frame, generation: 0 } : frame)),
		});
		await pickElement(session.page, 'home', '#hero-title');
		await session.page.keyboard.type('Why is Add disabled?');
		await shootPopover(session);
	},
);
