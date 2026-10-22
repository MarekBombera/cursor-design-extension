import { type FrameMessage, parseFrameMessage } from './frame/frameMessages';
import { type HostMessage, parseHostMessage, parseSavedStageView } from './hostMessages';
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

type HostBridgeArgs = {
	// Live frame iframes by frame id, matched against event.source at message time.
	iframes: ReadonlyMap<string, HTMLIFrameElement>;
	onHostMessage: (message: HostMessage) => void;
	onFrameMessage: (frameId: string, message: FrameMessage) => void;
};

const frameIdForSource = (
	iframes: ReadonlyMap<string, HTMLIFrameElement>,
	source: MessageEventSource | null,
): string | undefined => {
	for (const [frameId, iframe] of iframes) {
		if (iframe.contentWindow === source) {
			return frameId;
		}
	}
	return undefined;
};

// Call during component init: subscribes once, posts artboard:ready after the listener exists.
export const connectHostBridge = ({
	iframes,
	onHostMessage,
	onFrameMessage,
}: HostBridgeArgs): void => {
	$effect(() => {
		const handleMessage = (event: MessageEvent): void => {
			const frameId = frameIdForSource(iframes, event.source);
			if (frameId !== undefined) {
				// ponytail: rejects are not logged; wheel fires at 60+ Hz, so logging would spam.
				// Late cd:frame-height / cd:frame-wheel from a previous document is accepted.
				const message = parseFrameMessage(event.data);
				if (message !== undefined) {
					onFrameMessage(frameId, message);
				}
				return;
			}
			// Sandboxed frames post with origin "null"; one that is not (or no longer) registered
			// must never reach the host-message path.
			if (event.origin === 'null') {
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
