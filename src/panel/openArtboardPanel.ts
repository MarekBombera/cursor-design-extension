import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

const ARTBOARD_VIEW_TYPE = 'cursorDesign.artboard' as const;

export type ArtboardUpdatedMessage = {
	type: 'artboard:updated';
	artboardId: string;
	generation: number;
	html: string;
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
};

const MCP_UNAVAILABLE_COPY = 'MCP unavailable. Artboard still loads from disk.';

type ArtboardHostView = {
	updated: ArtboardUpdatedMessage;
	errorMessage?: string;
};

let currentPanel: vscode.WebviewPanel | undefined;
let chromeReady = false;
let pendingView: ArtboardHostView | undefined;
let pendingMcpAvailable: boolean | undefined;
let onPanelBecameVisible: (() => void) | undefined;

const createCspNonce = (): string => randomBytes(16).toString('hex');

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
	void currentPanel.webview.postMessage(pendingView.updated);
	if (pendingView.errorMessage !== undefined) {
		const errorMessage: ArtboardErrorMessage = {
			type: 'artboard:error',
			message: pendingView.errorMessage,
		};
		void currentPanel.webview.postMessage(errorMessage);
	}
};

const flushPendingUiStatus = (): void => {
	if (!currentPanel || !chromeReady || pendingMcpAvailable === undefined) {
		return;
	}
	const statusMessage: UiStatusMessage = {
		type: 'ui:status',
		mcpAvailable: pendingMcpAvailable,
	};
	void currentPanel.webview.postMessage(statusMessage);
};

export const hasCurrentArtboardPanel = (): boolean => currentPanel !== undefined;

export const setArtboardPanelOnVisible = (handler: () => void): void => {
	onPanelBecameVisible = handler;
};

export const postArtboardSnapshotToPanel = ({
	errorMessage,
	...updatedFields
}: Omit<ArtboardUpdatedMessage, 'type'> & { errorMessage?: string }): void => {
	pendingView = {
		updated: { type: 'artboard:updated', ...updatedFields },
		errorMessage,
	};
	flushPendingArtboardView();
};

export const postUiStatusToPanel = (mcpAvailable: boolean): void => {
	pendingMcpAvailable = mcpAvailable;
	flushPendingUiStatus();
};

const buildArtboardChromeHtml = (webview: vscode.Webview): string => {
	const nonce = createCspNonce();
	const csp = [
		"default-src 'none'",
		`style-src 'nonce-${nonce}' ${webview.cspSource}`,
		`script-src 'nonce-${nonce}' ${webview.cspSource}`,
		'frame-src blob:',
	].join('; ');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Cursor Design</title>
	<style nonce="${nonce}">
		html,
		body {
			height: 100%;
			margin: 0;
			background: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			display: flex;
			flex-direction: column;
		}
		.chrome-bar {
			display: flex;
			gap: 0.75rem;
			align-items: center;
			box-sizing: border-box;
			padding: 0.5rem 0.75rem;
			border-bottom: 1px solid var(--vscode-panel-border);
			flex: 0 0 auto;
		}
		.badge {
			color: var(--vscode-descriptionForeground);
		}
		.error {
			margin: 0;
			padding: 0.5rem 0.75rem;
			color: var(--vscode-errorForeground);
			flex: 0 0 auto;
		}
		.mcp-banner {
			margin: 0;
			padding: 0.5rem 0.75rem;
			color: var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningForeground));
			flex: 0 0 auto;
		}
		#empty-copy {
			margin: 0;
			padding: 0.75rem;
		}
		#artboard-frame {
			flex: 1 1 auto;
			width: 100%;
			border: 0;
			background: var(--vscode-editor-background);
		}
	</style>
</head>
<body>
	<header class="chrome-bar">
		<span id="artboard-id-badge" class="badge"></span>
		<span id="artboard-generation-badge" class="badge"></span>
	</header>
	<p id="artboard-error" class="error" hidden></p>
	<p id="mcp-banner" class="mcp-banner" hidden></p>
	<p id="empty-copy">No artboard yet.</p>
	<iframe id="artboard-frame" sandbox="allow-scripts" title="Artboard preview"></iframe>
	<script nonce="${nonce}">
		const vscodeApi = acquireVsCodeApi();
		const iframe = document.getElementById('artboard-frame');
		const emptyCopy = document.getElementById('empty-copy');
		const idBadge = document.getElementById('artboard-id-badge');
		const generationBadge = document.getElementById('artboard-generation-badge');
		const errorBanner = document.getElementById('artboard-error');
		const mcpBanner = document.getElementById('mcp-banner');
		const mcpUnavailableCopy = '${MCP_UNAVAILABLE_COPY}';
		let currentBlobUrl;
		let lastHtml;

		const revokeCurrentBlob = () => {
			if (currentBlobUrl !== undefined) {
				URL.revokeObjectURL(currentBlobUrl);
				currentBlobUrl = undefined;
			}
		};

		const applyArtboardHtml = (html) => {
			if (html === lastHtml) {
				return;
			}
			lastHtml = html;
			revokeCurrentBlob();
			if (html.length === 0) {
				iframe.removeAttribute('src');
				emptyCopy.hidden = false;
				return;
			}
			emptyCopy.hidden = true;
			const blob = new Blob([html], { type: 'text/html' });
			currentBlobUrl = URL.createObjectURL(blob);
			iframe.src = currentBlobUrl;
		};

		window.addEventListener('message', (event) => {
			if (event.source === iframe.contentWindow) {
				return;
			}
			const data = event.data;
			if (data === null || typeof data !== 'object') {
				return;
			}
			if (data.type === 'artboard:updated') {
				idBadge.textContent = typeof data.artboardId === 'string' ? data.artboardId : '';
				generationBadge.textContent = typeof data.generation === 'number' ? String(data.generation) : '';
				applyArtboardHtml(typeof data.html === 'string' ? data.html : '');
				errorBanner.hidden = true;
				errorBanner.textContent = '';
				return;
			}
			if (data.type === 'artboard:error') {
				errorBanner.hidden = false;
				errorBanner.textContent = typeof data.message === 'string' ? data.message : 'Could not load artboard.';
				return;
			}
			if (data.type === 'ui:status') {
				if (typeof data.mcpAvailable !== 'boolean') {
					return;
				}
				if (data.mcpAvailable) {
					mcpBanner.hidden = true;
					mcpBanner.textContent = '';
					return;
				}
				mcpBanner.hidden = false;
				mcpBanner.textContent = mcpUnavailableCopy;
			}
		});

		window.addEventListener('pagehide', revokeCurrentBlob);
		vscodeApi.postMessage({ type: 'artboard:ready' });
	</script>
</body>
</html>`;
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
	panel.webview.html = buildArtboardChromeHtml(panel.webview);
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
	});
	currentPanel = panel;
	return panel;
};
