import {
	type ChromeFrameMessage,
	type FrameMessage,
	parseFrameMessage,
} from './frame/frameMessages';
import {
	type FramePlaceMessage,
	type HostMessage,
	parseHostMessage,
	parseSavedStageView,
	routeMessage,
} from './hostMessages';
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

export const readSavedStageView = (): StageView | undefined => {
	const state = vscodeApi.getState();
	return parseSavedStageView(
		state !== null && typeof state === 'object' && 'stageView' in state
			? state.stageView
			: undefined,
	);
};

export const saveStageView = (stageView: StageView): void => {
	vscodeApi.setState({ stageView });
};

// Snapshot: callers pass gesture fields that are $state proxies, and postMessage's structured
// clone throws DataCloneError on a Proxy.
export const postFramePlace = (message: FramePlaceMessage): void => {
	vscodeApi.postMessage($state.snapshot(message));
};

// The only chrome → frame send. '*' because sandboxed frames have an opaque origin; the payload
// is only a mode or a step command, nothing private.
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
