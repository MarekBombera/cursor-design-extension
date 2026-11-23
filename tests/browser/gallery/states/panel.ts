import { type Page } from '@playwright/test';
import {
	boxOf,
	clickChrome,
	copyOpenButton,
	panel,
	panelButton,
	panelItem,
	postToChrome,
} from '../../harness';
import { jumpChip, lastRequest } from '../interact';
import {
	ago,
	COMMENTS_JSON_ERROR,
	type Definition,
	longList,
	type Session,
	settle,
	SHORT,
	type StateDefinition,
	withComments,
} from '../scene';

export const panelStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	panelStates.push(definition);
};

const panelState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
): void => {
	add({ surface: 'panel', state, setup, run });
};
export const answerError = async (page: Page, type: string, message: string): Promise<void> => {
	const request = await lastRequest(page, type);
	await postToChrome(page, { type: 'ui:error', message, requestId: String(request.requestId) });
	await settle(page);
};
const REPLY_LIMIT = 'This comment has the maximum number of replies.';

panelState('empty', 'Panel open, no comments.', async ({ open, shoot }) => {
	await open({ definitions: [], panel: true });
	await shoot();
});
panelState('error', 'Panel open, comments:updated with error.', async ({ open, shoot, page }) => {
	await open({ definitions: [], panel: true });
	await postToChrome(page, {
		type: 'comments:updated',
		pageId: 'page-1',
		comments: [],
		error: COMMENTS_JSON_ERROR,
	});
	await settle(page);
	await shoot();
});
panelState(
	'typical',
	'Panel open with the 11 default comments (9 open, 1 sent, 1 resolved; Agent replies).',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await shoot({ closeup: await boxOf(panelItem(page, 'h-sub')) });
	},
);
panelState(
	'card-close-ups',
	'Close-up of a plain open card (h-title) in the full panel.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'long-list-top',
	'26 comments with long bodies, long targets and 8 Agent replies; panel scrolled to top.',
	async ({ open, shoot }) => {
		await open({ definitions: longList(), panel: true });
		await shoot();
	},
);
panelState(
	'long-list-scrolled',
	'Same list scrolled ~60% down (the Resolved group heading comes into view).',
	async ({ open, shoot, page }) => {
		await open({ definitions: longList(), panel: true });
		// The list, not the aside, is the scroller.
		await panel(page)
			.locator('.list')
			.evaluate((element) => {
				element.scrollTop = element.scrollHeight * 0.6;
			});
		await settle(page);
		await shoot();
	},
);
panelState('long-list-bottom', 'Same list scrolled to the end.', async ({ open, shoot, page }) => {
	await open({ definitions: longList(), panel: true });
	await panel(page)
		.locator('.list')
		.evaluate((element) => {
			element.scrollTop = element.scrollHeight;
		});
	await settle(page);
	await shoot();
});
panelState(
	'reply-composer-open',
	'Clicked Reply on the #hero-title card in the panel and typed a draft.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Reply'));
		await page.keyboard.type('Agreed, and the subhead too.');
		await settle(page);
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'reply-error',
	'Reply submitted from the panel, host answered ui:error.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Reply'));
		await page.keyboard.type('One more thought');
		await page.keyboard.press('Enter');
		await answerError(page, 'comment:reply', REPLY_LIMIT);
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'resolve-error',
	'Clicked Resolve on the #hero-title card in the panel, host answered ui:error.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Resolve'));
		await answerError(page, 'comment:set-status', 'Could not resolve the comment.');
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'copy-for-agent-copied',
	'Clicked Copy for Agent on the #hero-title card, host answered ui:copied (count 1): the button says Copied for 1.5 s.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(panelButton(page, 'h-title', 'Copy for Agent'));
		const request = await lastRequest(page, 'comment:copy');
		await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 1 });
		await page.waitForTimeout(100);
		await shoot({ closeup: await boxOf(panelItem(page, 'h-title')) });
	},
);
panelState(
	'copy-open-copied',
	'Clicked Copy 9 open comments for Agent, host answered ui:copied (count 9).',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(copyOpenButton(page));
		const request = await lastRequest(page, 'comment:copy-open');
		await postToChrome(page, { type: 'ui:copied', requestId: String(request.requestId), count: 9 });
		await page.waitForTimeout(100);
		await shoot();
	},
);
panelState(
	'copy-open-error',
	'Clicked Copy 9 open comments for Agent, host answered ui:error.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(copyOpenButton(page));
		await answerError(page, 'comment:copy-open', 'Could not copy to the clipboard.');
		await shoot();
	},
);
panelState(
	'copy-open-disabled',
	'Only sent and resolved comments: the copy-open button is aria-disabled.',
	async ({ open, shoot }) => {
		await open({
			definitions: SHORT.filter(
				(definition) => definition.status === 'sent' || definition.status === 'resolved',
			),
			panel: true,
		});
		await shoot();
	},
);
panelState(
	'frame-absent',
	'Added a comment whose frame (archive-2) is not on the stage, plus normal ones.',
	async ({ open, shoot, page }) => {
		const orphan: Definition = {
			id: 'o-1',
			frameId: 'archive-2',
			selector: '#hero-title',
			tagName: 'h1',
			text: 'Old landing headline',
			body: 'This frame was removed from the canvas but the comment stayed.',
			rect: { x: 20, y: 40, width: 300, height: 40 },
			createdAt: ago(60 * 30),
		};
		await open({ definitions: [...SHORT, orphan], panel: true });
		await panelItem(page, 'o-1').evaluate((element) => {
			element.scrollIntoView({ block: 'center' });
		});
		await settle(page);
		await shoot({ closeup: await boxOf(panelItem(page, 'o-1')) });
	},
);
panelState(
	'jump-flash',
	'Clicked the target chip of the #cta-primary card (click to jump): flash outline on the stage.',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await clickChrome(jumpChip(page, 'h-cta'));
		await page.waitForTimeout(200);
		await shoot();
	},
);
panelState('only-resolved', 'Only resolved comments in the list.', async ({ open, shoot }) => {
	await open({
		definitions: SHORT.filter((definition) => definition.status === 'resolved'),
		panel: true,
	});
	await shoot();
});
