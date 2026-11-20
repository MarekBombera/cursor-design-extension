import {
	type ChromeFrameMessage,
	type FrameMessage,
	parseFrameMessage,
} from './frame/frameMessages';
import {
	type ArtboardEditMessage,
	type ArtboardHistoryMessage,
	type CommentRequestMessage,
	type FramePlaceMessage,
	type HostMessage,
	parseHostMessage,
	routeMessage,
} from './hostMessages';
import { parseSavedCommentUi, parseSavedStageView, type SavedCommentUi } from './savedState';
import type { StageView } from './stageGeometry';

// The one place that talks to the host: acquireVsCodeApi once, one message listener, webview
// state. Components never call postMessage or add message listeners (rule 08).

type VsCodeApi = {
	postMessage: (message: unknown) => void;
	getState: () => unknown;
	setState: (state: unknown) => void;
};

declare const acquireVsCodeApi: () => VsCodeApi;

const vscodeApi = acquireVsCodeApi();

// Webview state is one record, {stageView, commentsPanelOpen, mode, commentDraft, openThreadId,
// replyDrafts}; each save keeps the other keys, so no save erases another's.
const savedRecord = (): Record<string, unknown> => {
	const state = vscodeApi.getState();
	return state !== null && typeof state === 'object' ? { ...state } : {};
};

export const readSavedStageView = (): StageView | undefined =>
	parseSavedStageView(savedRecord().stageView);

export const saveStageView = (stageView: StageView): void => {
	vscodeApi.setState({ ...savedRecord(), stageView });
};

// A missing or non-boolean value reads as closed.
export const readSavedCommentsPanelOpen = (): boolean => savedRecord().commentsPanelOpen === true;

export const saveCommentsPanelOpen = (open: boolean): void => {
	vscodeApi.setState({ ...savedRecord(), commentsPanelOpen: open });
};

export const readSavedCommentUi = (): SavedCommentUi => parseSavedCommentUi(vscodeApi.getState());

// Snapshot: a deep $state proxy cannot be cloned. A key at its default (Interact mode, no draft,
// no thread, no reply text) is left out, so a closed comment UI leaves only the other keys; the
// previous record's `mode` is dropped first, so leaving a mode is saved too.
export const saveCommentUi = (ui: SavedCommentUi): void => {
	const {
		mode: _mode,
		commentDraft: _commentDraft,
		openThreadId: _openThreadId,
		replyDrafts: _replyDrafts,
		...others
	} = savedRecord();
	const { mode, commentDraft, openThreadId, replyDrafts } = $state.snapshot(ui);
	vscodeApi.setState({
		...others,
		...(mode === 'interact' ? {} : { mode }),
		...(commentDraft === undefined ? {} : { commentDraft }),
		...(openThreadId === undefined ? {} : { openThreadId }),
		...(Object.keys(replyDrafts).length === 0 ? {} : { replyDrafts }),
	});
};

// Snapshot: callers pass gesture fields that are $state proxies, and postMessage's structured
// clone throws DataCloneError on a Proxy.
export const postFramePlace = (message: FramePlaceMessage): void => {
	vscodeApi.postMessage($state.snapshot(message));
};

// Snapshot for the same reason: the draft target is $state.
export const postCommentRequest = (message: CommentRequestMessage): void => {
	vscodeApi.postMessage($state.snapshot(message));
};

// 9e: one Edit-mode save, or (9f) one undo / redo step; the host answers artboard:edited or
// ui:error with its requestId.
export const postEditRequest = (message: ArtboardEditMessage | ArtboardHistoryMessage): void => {
	vscodeApi.postMessage($state.snapshot(message));
};

// The only chrome → frame send. '*' because a sandboxed frame has an opaque origin, so there is
// nothing to target; the frame can only navigate to blob: (chrome CSP frame-src), a document its
// own script made. The payload is a mode, a step or refresh command, this frame's own comment ids
// and selectors (cd:anchors), or an Edit-mode preview of this frame's own element (cd:edit-apply),
// never comment bodies or another frame's data.
export const postToFrame = (iframe: HTMLIFrameElement, message: ChromeFrameMessage): void => {
	iframe.contentWindow?.postMessage(message, '*');
};

type HostBridgeArgs = {
	// Live frame iframes by frame id, matched against event.source at message time.
	iframes: ReadonlyMap<string, HTMLIFrameElement>;
	onHostMessage: (message: HostMessage) => void;
	onFrameMessage: (frameId: string, message: FrameMessage) => void;
};

// Call during component init: subscribes once, posts artboard:ready after the listener exists.
export const connectHostBridge = ({
	iframes,
	onHostMessage,
	onFrameMessage,
}: HostBridgeArgs): void => {
	$effect(() => {
		const handleMessage = (event: MessageEvent): void => {
			const route = routeMessage({ source: event.source, origin: event.origin, iframes });
			if (route.kind === 'frame') {
				// ponytail: rejects are not logged; wheel fires at 60+ Hz, so logging would spam.
				// Late cd:frame-height / cd:frame-wheel from a previous document is accepted.
				const message = parseFrameMessage(event.data);
				if (message !== undefined) {
					onFrameMessage(route.frameId, message);
				}
				return;
			}
			if (route.kind === 'drop') {
				return;
			}
			const message = parseHostMessage(event.data);
			if (message !== undefined) {
				onHostMessage(message);
			}
		};
		window.addEventListener('message', handleMessage);
		vscodeApi.postMessage({ type: 'artboard:ready' });
		return () => {
			window.removeEventListener('message', handleMessage);
		};
	});
};
