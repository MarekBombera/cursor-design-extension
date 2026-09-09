import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

const ARTBOARD_VIEW_TYPE = 'cursorDesign.artboard' as const;

let currentPanel: vscode.WebviewPanel | undefined;

const createCspNonce = (): string => randomBytes(16).toString('hex');

const buildEmptyArtboardHtml = (webview: vscode.Webview): string => {
	const nonce = createCspNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${webview.cspSource};" />
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
		}
		main {
			box-sizing: border-box;
			padding: 1.5rem;
		}
	</style>
</head>
<body>
	<main>
		<p>No artboard yet.</p>
	</main>
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
		enableScripts: false,
		localResourceRoots: [context.extensionUri],
	});
	panel.webview.html = buildEmptyArtboardHtml(panel.webview);
	panel.onDidDispose(() => {
		currentPanel = undefined;
	});
	context.subscriptions.push(panel);
	currentPanel = panel;
	return panel;
};
