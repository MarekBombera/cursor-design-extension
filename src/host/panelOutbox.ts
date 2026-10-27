import type {
	CommentAddedMessage,
	CommentsUpdatedMessage,
	HostMessage,
	PostedCanvasFrame,
	UiErrorMessage,
} from '../webview/hostMessages';
import { type CanvasSnapshot, postedFrameFromSnapshot } from './canvasSnapshot';

type CanvasHostView = {
	updated: {
		activeArtboardId: string;
		generation: number;
		frames: PostedCanvasFrame[];
	};
	errorMessage?: string;
};

type UiStatusPartial = { mcpAvailable?: boolean; handoffStale?: boolean };

type PanelOutbox = {
	postSnapshot: (snapshot: CanvasSnapshot) => void;
	postUiStatus: (partial: UiStatusPartial) => void;
	postComments: (comments: Omit<CommentsUpdatedMessage, 'type'>) => void;
	postAnswer: (answer: CommentAddedMessage | UiErrorMessage) => void;
	markReady: () => void;
	reset: () => void;
};

// What the chrome sees, and when: nothing before artboard:ready, then the latest view, status and
// comments. Answers to a chrome request are never held: a chrome that reloaded has no request.
// The vscode glue (openArtboardPanel.ts) owns the panel; this owns only the pending state.
export const createPanelOutbox = ({
	post,
	readCspNonce,
}: {
	post: (message: HostMessage) => void;
	readCspNonce: () => string;
}): PanelOutbox => {
	let chromeReady = false;
	let pendingView: CanvasHostView | undefined;
	let pendingUiStatus: { mcpAvailable?: boolean; handoffStale: boolean } = { handoffStale: false };
	let pendingComments: CommentsUpdatedMessage | undefined;

	const flushView = (): void => {
		if (!chromeReady || pendingView === undefined) {
			return;
		}
		post({ type: 'canvas:updated', ...pendingView.updated, cspNonce: readCspNonce() });
		if (pendingView.errorMessage !== undefined) {
			post({ type: 'artboard:error', message: pendingView.errorMessage });
		}
	};

	const flushUiStatus = (): void => {
		if (!chromeReady || pendingUiStatus.mcpAvailable === undefined) {
			return;
		}
		post({
			type: 'ui:status',
			mcpAvailable: pendingUiStatus.mcpAvailable,
			handoffStale: pendingUiStatus.handoffStale,
		});
	};

	const flushComments = (): void => {
		if (chromeReady && pendingComments !== undefined) {
			post(pendingComments);
		}
	};

	const postUiStatus = (partial: UiStatusPartial): void => {
		if (partial.mcpAvailable !== undefined) {
			pendingUiStatus.mcpAvailable = partial.mcpAvailable;
		}
		if (partial.handoffStale !== undefined) {
			pendingUiStatus.handoffStale = partial.handoffStale;
		}
		flushUiStatus();
	};

	return {
		postSnapshot: (snapshot) => {
			pendingView = {
				updated: {
					activeArtboardId: snapshot.activeArtboardId,
					generation: snapshot.generation,
					frames: snapshot.frames.map(postedFrameFromSnapshot),
				},
				errorMessage: snapshot.errorMessage,
			};
			postUiStatus({ handoffStale: snapshot.handoffStale });
			flushView();
		},
		postUiStatus,
		postComments: (comments) => {
			pendingComments = { type: 'comments:updated', ...comments };
			flushComments();
		},
		postAnswer: (answer) => {
			if (chromeReady) {
				post(answer);
			}
		},
		// A second artboard:ready (webview reload) re-sends the cached view, status and comments.
		markReady: () => {
			chromeReady = true;
			flushView();
			flushUiStatus();
			flushComments();
		},
		// Panel disposed: drop the view, comments and stale flag; mcpAvailable is process state and
		// survives.
		reset: () => {
			chromeReady = false;
			pendingView = undefined;
			pendingComments = undefined;
			pendingUiStatus = { mcpAvailable: pendingUiStatus.mcpAvailable, handoffStale: false };
		},
	};
};
