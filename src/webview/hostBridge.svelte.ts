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
	type PageFree,
	parseHostMessage,
	routeMessage,
} from './hostMessages';
import {
	parseSavedCommentUi,
	parseSavedStageView,
	type SavedCommentUi,
	type SavedStageView,
} from './savedState';

type VsCodeApi = {
	postMessage: (message: unknown) => void;
	getState: () => unknown;
	setState: (state: unknown) => void;
};

declare const acquireVsCodeApi: () => VsCodeApi;

const vscodeApi = acquireVsCodeApi();

// Webview state is one record; each save keeps the other keys, so no save erases another's.
const savedRecord = (): Record<string, unknown> => {
	const state = vscodeApi.getState();
	return state !== null && typeof state === 'object' ? { ...state } : {};
};

export const readSavedStageView = (): SavedStageView | undefined =>
	parseSavedStageView(savedRecord().stageView);

export const saveStageView = (stageView: SavedStageView): void => {
	vscodeApi.setState({ ...savedRecord(), stageView });
};

export const readSavedCommentsPanelOpen = (): boolean => savedRecord().commentsPanelOpen === true;

export const saveCommentsPanelOpen = (open: boolean): void => {
	vscodeApi.setState({ ...savedRecord(), commentsPanelOpen: open });
};

export const readSavedCommentUi = (): SavedCommentUi => parseSavedCommentUi(vscodeApi.getState());

// Snapshot: a deep $state proxy cannot be cloned. A key at its default is left out; the previous
// record's `mode` (and the pre-9d `commentMode` key) is dropped first, so leaving a mode is saved
// too.
export const saveCommentUi = (ui: SavedCommentUi): void => {
	const {
		mode: _mode,
		commentMode: _commentMode,
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

// The only place a page-bound request gets its page: the pure rules build it page-free.
// Snapshot: callers pass gesture fields that are $state proxies, and postMessage's structured
// clone throws DataCloneError on a Proxy.
export const postFramePlace = (pageId: string, message: PageFree<FramePlaceMessage>): void => {
	vscodeApi.postMessage({ ...$state.snapshot(message), pageId });
};

// Snapshot for the same reason: the draft target is $state.
export const postCommentRequest = (
	pageId: string,
	message: PageFree<CommentRequestMessage>,
): void => {
	vscodeApi.postMessage({ ...$state.snapshot(message), pageId });
};

export const postEditRequest = (
	pageId: string,
	message: PageFree<ArtboardEditMessage | ArtboardHistoryMessage>,
): void => {
	vscodeApi.postMessage({ ...$state.snapshot(message), pageId });
};

// The only chrome → frame send. '*' because a sandboxed frame has an opaque origin; the frame can
// only navigate to blob: (chrome CSP frame-src), a document its own script made. The payload is a
// command or this frame's own data (its comment ids and selectors, its element's edit preview),
// never comment bodies or another frame's data.
export const postToFrame = (iframe: HTMLIFrameElement, message: ChromeFrameMessage): void => {
	iframe.contentWindow?.postMessage(message, '*');
};

type HostBridgeArgs = {
	// Read at message time (the mounted page's iframes), so a page change needs no new subscription.
	iframes: () => ReadonlyMap<string, HTMLIFrameElement>;
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
			const route = routeMessage({
				source: event.source,
				origin: event.origin,
				iframes: iframes(),
			});
			if (route.kind === 'frame') {
				// ponytail: rejects are not logged (wheel fires at 60+ Hz), and a late cd:frame-height or
				// cd:frame-wheel from a previous document is accepted. Upgrade: a sampled reject count
				// posted to the host log; a document id on frame messages.
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
