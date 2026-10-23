import type { HostMessage, PostedCanvasFrame } from '../webview/hostMessages';
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
	markReady: () => void;
	reset: () => void;
};

// What the chrome sees, and when: nothing before artboard:ready, then the latest view and status.
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
		// A second artboard:ready (webview reload) re-sends the cached view and status.
		markReady: () => {
			chromeReady = true;
			flushView();
			flushUiStatus();
		},
		// Panel disposed: drop the view and stale flag; mcpAvailable is process state and survives.
		reset: () => {
			chromeReady = false;
			pendingView = undefined;
			pendingUiStatus = { mcpAvailable: pendingUiStatus.mcpAvailable, handoffStale: false };
		},
	};
};
