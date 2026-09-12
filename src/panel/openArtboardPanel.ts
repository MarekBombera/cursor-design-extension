import * as vscode from 'vscode';

import { buildArtboardChromeHtml } from './artboardChromeHtml';

const ARTBOARD_VIEW_TYPE = 'cursorDesign.artboard' as const;

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
	pendingView = {
		updated: updatedFields,
		errorMessage,
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

export const openArtboardPanel = (context: vscode.ExtensionContext): vscode.WebviewPanel => {
	const column = vscode.ViewColumn.One;
	if (currentPanel) {
		currentPanel.reveal(column);
		return currentPanel;
	}

	const panel = vscode.window.createWebviewPanel(ARTBOARD_VIEW_TYPE, 'Artboard', column, {
		enableScripts: true,
		localResourceRoots: [context.extensionUri],
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
	panel.onDidChangeViewState(() => {
		if (!panel.visible) {
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
