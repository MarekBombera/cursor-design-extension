import * as vscode from 'vscode';

import type { CanvasSnapshot } from '../host/canvasSnapshot';
import {
	commentRequestType,
	isArtboardEditAttempt,
	isFramePlaceAttempt,
	parseChromeMessage,
} from '../host/chromeMessages';
import { type PanelAnswer, createPanelOutbox } from '../host/panelOutbox';
import type { CommentsUpdatedMessage } from '../webview/hostMessages';
import { buildArtboardChromeHtml } from './artboardChromeHtml';

const ARTBOARD_VIEW_TYPE = 'cursorDesign.artboard' as const;

let currentPanel: vscode.WebviewPanel | undefined;
let onPanelBecameVisible: (() => void) | undefined;
let onFramePlace: ((value: unknown) => void) | undefined;
let onCommentRequest: ((value: unknown) => void) | undefined;
let onEditRequest: ((value: unknown) => void) | undefined;
let chromeCspNonce = '';

const outbox = createPanelOutbox({
	post: (message) => {
		void currentPanel?.webview.postMessage(message);
	},
	readCspNonce: () => chromeCspNonce,
});

export const hasCurrentArtboardPanel = (): boolean => currentPanel !== undefined;

export const setArtboardPanelOnVisible = (handler: () => void): void => {
	onPanelBecameVisible = handler;
};

// Gets every frame:place attempt raw, valid or not; the handler owns the one answer.
export const setArtboardPanelOnFramePlace = (handler: (value: unknown) => void): void => {
	onFramePlace = handler;
};

// Gets every comment request attempt (create, reply, set-status, copy, copy-open) raw, valid or not; the handler owns the one answer.
export const setArtboardPanelOnCommentRequest = (handler: (value: unknown) => void): void => {
	onCommentRequest = handler;
};

// Gets every artboard:edit attempt raw, valid or not; the handler owns the one answer (9c).
export const setArtboardPanelOnEditRequest = (handler: (value: unknown) => void): void => {
	onEditRequest = handler;
};

export const postArtboardSnapshotToPanel = (snapshot: CanvasSnapshot): void => {
	outbox.postSnapshot(snapshot);
};

export const postUiStatusToPanel = (partial: {
	mcpAvailable?: boolean;
	handoffStale?: boolean;
}): void => {
	outbox.postUiStatus(partial);
};

export const postCommentsToPanel = (comments: Omit<CommentsUpdatedMessage, 'type'>): void => {
	outbox.postComments(comments);
};

export const postAnswerToPanel = (answer: PanelAnswer): void => {
	outbox.postAnswer(answer);
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
		if (isFramePlaceAttempt(message)) {
			onFramePlace?.(message);
			return;
		}
		if (isArtboardEditAttempt(message)) {
			onEditRequest?.(message);
			return;
		}
		if (commentRequestType(message) !== undefined) {
			onCommentRequest?.(message);
			return;
		}
		if (parseChromeMessage(message)?.type !== 'artboard:ready') {
			return;
		}
		outbox.markReady();
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
		currentPanel = undefined;
		outbox.reset();
	});
	currentPanel = panel;
	return panel;
};
