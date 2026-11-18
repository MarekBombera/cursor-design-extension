import { postToChrome } from '../../harness';
import {
	COMMENTS_JSON_ERROR,
	HANDOFF_STALE,
	MCP_DOWN,
	type Session,
	settle,
	type StateDefinition,
	withComments,
} from '../scene';

export const bannersStates: StateDefinition[] = [];

const add = (definition: StateDefinition): void => {
	bannersStates.push(definition);
};

// 2. Banners
const bannerState = (
	state: string,
	setup: string,
	run: (session: Session) => Promise<void>,
	notes?: string[],
): void => {
	add({ surface: 'banner', state, setup, notes, run });
};
bannerState(
	'mcp-unavailable',
	'ui:status { mcpAvailable: false }.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, MCP_DOWN);
		await settle(page);
		await shoot();
	},
);
bannerState(
	'handoff-stale',
	'ui:status { handoffStale: true }: the marker is a toolbar badge, not a banner.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, HANDOFF_STALE);
		await settle(page);
		await shoot();
	},
);
bannerState(
	'artboard-error',
	'artboard:error with a file-read message.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, {
			type: 'artboard:error',
			message: 'Could not read .cursor-design/artboards/home.html: file is not valid UTF-8.',
		});
		await settle(page);
		await shoot();
	},
);
bannerState(
	'comments-error',
	`comments:updated with error "${COMMENTS_JSON_ERROR}" and an empty list.`,
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, {
			type: 'comments:updated',
			comments: [],
			error: COMMENTS_JSON_ERROR,
		});
		await settle(page);
		await shoot();
	},
);
bannerState(
	'all-stacked',
	'MCP unavailable + handoff stale + artboard:error + comments error at once (panel open).',
	async ({ open, shoot, page }) => {
		await open(withComments({ panel: true }));
		await postToChrome(page, { type: 'ui:status', mcpAvailable: false, handoffStale: true });
		await postToChrome(page, { type: 'artboard:error', message: 'Could not move frame "home".' });
		await postToChrome(page, {
			type: 'comments:updated',
			comments: [],
			error: COMMENTS_JSON_ERROR,
		});
		await settle(page);
		await shoot();
	},
);
bannerState(
	'ui-error-unmatched',
	'ui:error with no requestId, and one with an unknown requestId.',
	async ({ open, shoot, page }) => {
		await open(withComments());
		await postToChrome(page, { type: 'ui:error', message: 'Could not write comments.json.' });
		await postToChrome(page, {
			type: 'ui:error',
			message: 'Unrelated failure.',
			requestId: 'nobody',
		});
		await settle(page);
		await shoot();
	},
	['A ui:error that matches no request renders nothing, so the shot shows the unchanged chrome.'],
);
