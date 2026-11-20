import { type Page } from '@playwright/test';
import {
	boxOf,
	clickChrome,
	pinOf,
	postToChrome,
	stageBox,
	thread,
	threadButton,
} from '../../harness';
import { lastRequest, openThread } from '../interact';
import {
	ago,
	type Definition,
	SENTENCES,
	type Session,
	settle,
	SHORT,
	type StateDefinition,
	VIEW,
	type View,
	withComments,
} from '../scene';

export const threadStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	threadStates.push(definition);
};

const threadState = ({
	state,
	setup,
	id,
	definitions = SHORT,
	extra,
	view,
}: {
	state: string;
	setup: string;
	id: string;
	definitions?: Definition[];
	extra?: (session: Session) => Promise<void>;
	view?: View;
}): void => {
	add({
		surface: 'thread',
		state,
		setup,
		run: async (session) => {
			await session.open({ definitions, view });
			await openThread(session.page, id);
			await extra?.(session);
			await session.shoot({ closeup: await boxOf(thread(session.page)) });
		},
	});
};
const withFirst = (change: Partial<Definition>): Definition[] => [
	{ ...(SHORT[0] as Definition), ...change },
	...SHORT.slice(1),
];
const typeReply = async (page: Page, text: string, submit = false): Promise<void> => {
	await clickChrome(threadButton(page, 'Reply'));
	await page.keyboard.type(text);
	if (submit) {
		await page.keyboard.press('Enter');
	}
};

threadState({ state: 'short', setup: 'Clicked the open pin on #hero-title.', id: 'h-title' });
threadState({
	state: 'with-agent-reply',
	setup: 'Clicked the sent pin on #hero-sub (a user reply and an Agent reply).',
	id: 'h-sub',
});
threadState({
	state: 'resolved-with-reply',
	setup:
		'View scrolled down 280px; clicked the resolved pin on #feature-2 (Reopen button, Agent reply).',
	id: 'h-f2',
	view: { x: 6, y: -280, zoom: 1 },
});
threadState({
	state: 'stale-badge',
	setup: 'Clicked the stale pin on #nav-cta (stale flag in the card).',
	id: 'h-nav',
});
threadState({
	state: 'missing-badge',
	setup: 'Clicked the missing-target pin (#promo-banner).',
	id: 'h-old',
});
threadState({
	state: 'unchecked-badge',
	setup: 'Clicked the unchecked pin on #hero-art.',
	id: 'h-art',
});
threadState({ state: 'page-comment', setup: 'Clicked the whole-frame (page) pin.', id: 'h-page' });
threadState({
	state: 'long-body',
	setup: 'Open comment with a ~900 character body including an unbroken 150-char token.',
	id: 'h-title',
	definitions: withFirst({
		body: `${SENTENCES.join(' ')} ${SENTENCES.join(' ')} ${SENTENCES.join(' ')} https://example.com/${'a-very-long-unbroken-path-segment-'.repeat(5)}`,
	}),
});
threadState({
	state: 'markup-body',
	setup: 'Body contains HTML, markdown and entities; it renders as literal text.',
	id: 'h-title',
	definitions: withFirst({
		body: '<img src=x onerror=alert(1)> <b>bold?</b> **markdown** `code` [link](https://x.test) &amp; &lt;script&gt;\n\n- list item one\n- list item two',
	}),
});
threadState({
	state: 'many-replies',
	setup: 'A comment with 7 replies alternating user and Agent.',
	id: 'h-title',
	definitions: withFirst({
		replies: Array.from({ length: 7 }, (_, index) => ({
			id: `mr${index}`,
			author: index % 2 === 0 ? ('user' as const) : ('agent' as const),
			body:
				index % 2 === 0
					? 'Looks better, but the left alignment is still off by a few pixels on mobile.'
					: 'Adjusted padding to 16px in version 6 and re-exported the handoff.',
			createdAt: ago(300 - index * 30),
		})),
	}),
});
threadState({
	state: 'reply-composer-open',
	setup: 'Clicked Reply in the thread; typed a draft.',
	id: 'h-title',
	extra: async ({ page }) => {
		await typeReply(page, 'Agreed. I will update the type scale too.');
		await settle(page);
	},
});
threadState({
	state: 'reply-pending',
	setup: 'Typed a reply and pressed Enter; no host answer yet.',
	id: 'h-title',
	extra: async ({ page }) => {
		await typeReply(page, 'Agreed. I will update the type scale too.', true);
		await lastRequest(page, 'comment:reply');
		await settle(page);
	},
});
threadState({
	state: 'reply-error',
	setup: 'Reply submitted, host answered ui:error (reply limit).',
	id: 'h-title',
	extra: async ({ page }) => {
		await typeReply(page, 'One more thought', true);
		const request = await lastRequest(page, 'comment:reply');
		await postToChrome(page, {
			type: 'ui:error',
			message: 'This comment has the maximum number of replies.',
			requestId: String(request.requestId),
		});
		await settle(page);
	},
});
threadState({
	state: 'resolve-error',
	setup: 'Clicked Resolve, host answered ui:error.',
	id: 'h-title',
	extra: async ({ page }) => {
		await clickChrome(threadButton(page, 'Resolve'));
		const request = await lastRequest(page, 'comment:set-status');
		await postToChrome(page, {
			type: 'ui:error',
			message: 'Could not resolve the comment.',
			requestId: String(request.requestId),
		});
		await settle(page);
	},
});
threadState({
	state: 'copied',
	setup: 'Clicked Copy for Agent, host answered ui:copied (the button reads Copied).',
	id: 'h-title',
	extra: async ({ page }) => {
		await clickChrome(threadButton(page, 'Copy for Agent'));
		const request = await lastRequest(page, 'comment:copy');
		await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 1 });
		await page.waitForTimeout(100);
	},
});
add({
	surface: 'thread',
	state: 'near-right-edge',
	setup: 'Panned so the Mobile #m-cta pin is ~40px from the stage right edge; opened its thread.',
	run: async (session) => {
		const { page } = session;
		await session.open(withComments());
		const stage = await stageBox(page);
		const pin = await boxOf(pinOf(page, 'm-cta'));
		await session.reopen({
			view: {
				x: VIEW.x + (stage.x + stage.width - 40 - (pin.x + pin.width / 2)),
				y: VIEW.y + 100,
				zoom: 1,
			},
		});
		await openThread(page, 'm-cta');
		await session.shoot({ closeup: await boxOf(thread(page)) });
	},
});
add({
	surface: 'thread',
	state: 'with-panel-open',
	setup: 'Panel open and the thread of #hero-sub open at the same time.',
	run: async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await openThread(page, 'h-sub');
		await shoot();
	},
});
