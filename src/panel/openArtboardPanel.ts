import * as vscode from 'vscode';

import { buildArtboardChromeHtml } from './artboardChromeHtml';

const ARTBOARD_VIEW_TYPE = 'cursorDesign.artboard' as const;
// ponytail: 1.5M char ceiling; upgrade if a real artboard needs more
const MAX_POSTED_ARTBOARD_HTML_CHARS = 1_500_000;
const ARTBOARD_HTML_TOO_LARGE_MESSAGE = 'Artboard HTML is too large to preview in the panel.';

export type ArtboardUpdatedMessage = {
	type: 'artboard:updated';
	artboardId: string;
	generation: number;
	html: string;
	cspNonce: string;
	title: string;
	viewport: string;
};

export type ArtboardErrorMessage = {
	type: 'artboard:error';
	message: string;
};

export type UiStatusMessage = {
	type: 'ui:status';
	mcpAvailable: boolean;
	handoffStale: boolean;
};

type ArtboardViewFields = {
	artboardId: string;
	title: string;
	generation: number;
	html: string;
	viewport: string;
};

type ArtboardHostView = {
	updated: ArtboardViewFields;
	errorMessage?: string;
};

let currentPanel: vscode.WebviewPanel | undefined;
let chromeReady = false;
let pendingView: ArtboardHostView | undefined;
let pendingUiStatus: { mcpAvailable?: boolean; handoffStale: boolean } = { handoffStale: false };
let onPanelBecameVisible: (() => void) | undefined;
let chromeCspNonce = '';

const isArtboardReadyMessage = (value: unknown): boolean => {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	return 'type' in value && value.type === 'artboard:ready';
};

const flushPendingArtboardView = (): void => {
	if (!currentPanel || !chromeReady || pendingView === undefined) {
		return;
	}
	void currentPanel.webview.postMessage({
		type: 'artboard:updated',
		...pendingView.updated,
		cspNonce: chromeCspNonce,
	} satisfies ArtboardUpdatedMessage);
	if (pendingView.errorMessage !== undefined) {
		const errorMessage: ArtboardErrorMessage = {
			type: 'artboard:error',
			message: pendingView.errorMessage,
		};
		void currentPanel.webview.postMessage(errorMessage);
	}
};

const flushPendingUiStatus = (): void => {
	if (!currentPanel || !chromeReady || pendingUiStatus.mcpAvailable === undefined) {
		return;
	}
	const statusMessage: UiStatusMessage = {
		type: 'ui:status',
		mcpAvailable: pendingUiStatus.mcpAvailable,
		handoffStale: pendingUiStatus.handoffStale,
	};
	void currentPanel.webview.postMessage(statusMessage);
};

export const hasCurrentArtboardPanel = (): boolean => currentPanel !== undefined;

export const setArtboardPanelOnVisible = (handler: () => void): void => {
	onPanelBecameVisible = handler;
};

export type PostArtboardSnapshotArgs = ArtboardViewFields & {
	errorMessage?: string;
	handoffStale: boolean;
};

export const postArtboardSnapshotToPanel = ({
	errorMessage,
	handoffStale,
	...updatedFields
}: PostArtboardSnapshotArgs): void => {
	const htmlTooLarge = updatedFields.html.length > MAX_POSTED_ARTBOARD_HTML_CHARS;
	pendingView = {
		updated: htmlTooLarge ? { ...updatedFields, html: '' } : updatedFields,
		errorMessage: errorMessage ?? (htmlTooLarge ? ARTBOARD_HTML_TOO_LARGE_MESSAGE : undefined),
	};
	postUiStatusToPanel({ handoffStale });
	flushPendingArtboardView();
};

export const postUiStatusToPanel = (partial: {
	mcpAvailable?: boolean;
	handoffStale?: boolean;
}): void => {
	if (partial.mcpAvailable !== undefined) {
		pendingUiStatus.mcpAvailable = partial.mcpAvailable;
	}
	if (partial.handoffStale !== undefined) {
		pendingUiStatus.handoffStale = partial.handoffStale;
	}
	flushPendingUiStatus();
};

export type OpenArtboardPanelArgs = {
	context: vscode.ExtensionContext;
	preserveFocus?: boolean;
};

export const openArtboardPanel = ({
	preserveFocus: preserveFocusFlag,
}: OpenArtboardPanelArgs): vscode.WebviewPanel => {
	const preserveFocus = preserveFocusFlag === true;
	if (currentPanel) {
		currentPanel.reveal(undefined, preserveFocus);
		return currentPanel;
	}

	const showOptions = preserveFocus
		? { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }
		: vscode.ViewColumn.One;
	const panel = vscode.window.createWebviewPanel(ARTBOARD_VIEW_TYPE, 'Artboard', showOptions, {
		enableScripts: true,
		localResourceRoots: [],
	});
	const chrome = buildArtboardChromeHtml(panel.webview);
	chromeCspNonce = chrome.cspNonce;
	panel.webview.html = chrome.html;
	panel.webview.onDidReceiveMessage((message: unknown) => {
		if (!isArtboardReadyMessage(message)) {
			return;
		}
		chromeReady = true;
		flushPendingArtboardView();
		flushPendingUiStatus();
	});
	let wasVisible = panel.visible;
	panel.onDidChangeViewState(() => {
		const becameVisible = panel.visible && !wasVisible;
		wasVisible = panel.visible;
		if (!becameVisible) {
			return;
		}
		onPanelBecameVisible?.();
	});
	panel.onDidDispose(() => {
		chromeReady = false;
		currentPanel = undefined;
		pendingView = undefined;
		pendingUiStatus = {
			mcpAvailable: pendingUiStatus.mcpAvailable,
			handoffStale: false,
		};
	});
	currentPanel = panel;
	return panel;
};
