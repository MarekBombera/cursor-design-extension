import type {
	ArtboardEditedMessage,
	CommentAddedMessage,
	CommentSavedMessage,
	CanvasUpdatedMessage,
	CommentsUpdatedMessage,
	CopiedMessage,
	HostMessage,
	PageSavedMessage,
	UiErrorMessage,
	UiStatusMessage,
} from '../webview/hostMessages';
import type { CanvasViewFrame } from '../disk/canvasView';
import { type CanvasSnapshot, postedFrameFromSnapshot } from './canvasSnapshot';
import type * as editHistory from './editHistory';

// The nonce and the history flags are added at send time.
type CanvasHostView = {
	updated: Omit<CanvasUpdatedMessage, 'type' | 'cspNonce' | 'frames'> & {
		frames: CanvasViewFrame[];
	};
	errorMessage?: string;
};

type UiStatusPartial = Partial<Omit<UiStatusMessage, 'type'>>;

// Every answer to one chrome request: posted only while ready, never held or replayed.
export type PanelAnswer =
	| CommentAddedMessage
	| CommentSavedMessage
	| CopiedMessage
	| ArtboardEditedMessage
	| PageSavedMessage
	| UiErrorMessage;

type PanelOutbox = {
	postSnapshot: (snapshot: CanvasSnapshot) => void;
	postUiStatus: (partial: UiStatusPartial) => void;
	postComments: (comments: Omit<CommentsUpdatedMessage, 'type'>) => void;
	postAnswer: (answer: PanelAnswer) => void;
	markReady: () => void;
	reset: () => void;
};

// Nothing before artboard:ready, then the latest view, status and comments. Answers are never
// held: a chrome that reloaded has no request. Every new snapshot goes through
// keepUnchangedHistories whatever its caller, and each canvas:updated reads the history flags when
// sent, so a replay after a webview reload is never stale.
export const createPanelOutbox = ({
	post,
	readCspNonce,
	readHistoryFlags,
	keepUnchangedHistories,
}: {
	post: (message: HostMessage) => void;
	readCspNonce: () => string;
	// Injected so the outbox stays testable without editHistory's module store.
	readHistoryFlags: typeof editHistory.historyFlags;
	keepUnchangedHistories: typeof editHistory.keepUnchangedHistories;
}): PanelOutbox => {
	let chromeReady = false;
	let pendingView: CanvasHostView | undefined;
	let pendingUiStatus: { mcpAvailable?: boolean; handoffStale: boolean } = { handoffStale: false };
	let pendingComments: CommentsUpdatedMessage | undefined;

	const flushView = (): void => {
		if (!chromeReady || pendingView === undefined) {
			return;
		}
		const { updated } = pendingView;
		post({
			type: 'canvas:updated',
			...updated,
			// The posted page's flags only: the same frame id on another page is another history.
			frames: updated.frames.map((frame) => ({
				...frame,
				...readHistoryFlags({ pageId: updated.pageId, frameId: frame.id }),
			})),
			cspNonce: readCspNonce(),
		});
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
			keepUnchangedHistories({ pageId: snapshot.pageId, frames: snapshot.frames });
			pendingView = {
				updated: {
					pageId: snapshot.pageId,
					activeArtboardId: snapshot.activeArtboardId,
					generation: snapshot.generation,
					frames: snapshot.frames.map(postedFrameFromSnapshot),
					pages: snapshot.pages,
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
