import * as vscode from 'vscode';

import type { CanvasSnapshot } from '../host/canvasSnapshot';
import {
	commentRequestType,
	isArtboardEditAttempt,
	isArtboardHistoryAttempt,
	isFramePlaceAttempt,
	pageRequestType,
	parseChromeMessage,
} from '../host/chromeMessages';
import { clearEditHistories, historyFlags, keepUnchangedHistories } from '../host/editHistory';
import { chromeLoadErrorMessage, missingChromeAssets } from '../host/hostFs';
import { type PanelAnswer, createPanelOutbox } from '../host/panelOutbox';
import type { CommentsUpdatedMessage } from '../webview/hostMessages';
import { buildArtboardChromeHtml } from './artboardChromeHtml';

const ARTBOARD_VIEW_TYPE = 'vibeboard.artboard' as const;

let currentPanel: vscode.WebviewPanel | undefined;
// Each request handler gets every attempt raw, valid or not, and owns its one answer.
type ArtboardPanelHandlers = {
	onVisible: () => void;
	onFramePlace: (value: unknown) => void;
	onEditRequest: (value: unknown) => void;
	onHistoryRequest: (value: unknown) => void;
	onCommentRequest: (value: unknown) => void;
	onPageRequest: (value: unknown) => void;
};

let handlers: ArtboardPanelHandlers | undefined;
let chromeCspNonce = '';

const outbox = createPanelOutbox({
	post: (message) => {
		void currentPanel?.webview.postMessage(message);
	},
	readCspNonce: () => chromeCspNonce,
	readHistoryFlags: historyFlags,
	keepUnchangedHistories,
});

export const hasCurrentArtboardPanel = (): boolean => currentPanel !== undefined;

export const setArtboardPanelHandlers = (next: ArtboardPanelHandlers): void => {
	handlers = next;
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
	panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.svg');
	const chrome = buildArtboardChromeHtml({
		webview: panel.webview,
		extensionUri: context.extensionUri,
	});
	chromeCspNonce = chrome.cspNonce;
	panel.webview.html = chrome.html;
	void missingChromeAssets(context.extensionUri).then((missing) => {
		if (missing.length > 0) {
			void vscode.window.showErrorMessage(chromeLoadErrorMessage(missing));
		}
	});
	panel.webview.onDidReceiveMessage((message: unknown) => {
		if (isFramePlaceAttempt(message)) {
			handlers?.onFramePlace(message);
			return;
		}
		if (isArtboardHistoryAttempt(message)) {
			handlers?.onHistoryRequest(message);
			return;
		}
		if (isArtboardEditAttempt(message)) {
			handlers?.onEditRequest(message);
			return;
		}
		if (commentRequestType(message) !== undefined) {
			handlers?.onCommentRequest(message);
			return;
		}
		if (pageRequestType(message) !== undefined) {
			handlers?.onPageRequest(message);
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
		handlers?.onVisible();
	});
	panel.onDidDispose(() => {
		currentPanel = undefined;
		outbox.reset();
		// Undo history lives for the panel session only.
		clearEditHistories();
	});
	currentPanel = panel;
	return panel;
};
