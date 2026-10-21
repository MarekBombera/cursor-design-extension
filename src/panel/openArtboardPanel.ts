import * as vscode from 'vscode';

import {
	type CanvasSnapshot,
	postedFrameFromSnapshot,
	type PostedCanvasFrame,
} from '../host/canvasSnapshot';
import { buildArtboardChromeHtml } from './artboardChromeHtml';

const ARTBOARD_VIEW_TYPE = 'cursorDesign.artboard' as const;

export type CanvasUpdatedFrame = PostedCanvasFrame;

export type CanvasUpdatedMessage = {
	type: 'canvas:updated';
	activeArtboardId: string;
	generation: number;
	cspNonce: string;
	frames: CanvasUpdatedFrame[];
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

type CanvasHostView = {
	updated: {
		activeArtboardId: string;
		generation: number;
		frames: CanvasUpdatedFrame[];
	};
	errorMessage?: string;
};

let currentPanel: vscode.WebviewPanel | undefined;
let chromeReady = false;
let pendingView: CanvasHostView | undefined;
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
		type: 'canvas:updated',
		...pendingView.updated,
		cspNonce: chromeCspNonce,
	} satisfies CanvasUpdatedMessage);
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

export const postArtboardSnapshotToPanel = (snapshot: CanvasSnapshot): void => {
	pendingView = {
		updated: {
			activeArtboardId: snapshot.activeArtboardId,
			generation: snapshot.generation,
			frames: snapshot.frames.map(postedFrameFromSnapshot),
		},
		errorMessage: snapshot.errorMessage,
	};
	postUiStatusToPanel({ handoffStale: snapshot.handoffStale });
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
	context,
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
		localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
	});
	const chrome = buildArtboardChromeHtml({
		webview: panel.webview,
		extensionUri: context.extensionUri,
	});
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
