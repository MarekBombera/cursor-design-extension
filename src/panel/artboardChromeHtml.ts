import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

const createCspNonce = (): string => randomBytes(16).toString('hex');

export type ArtboardChromeDocument = {
	html: string;
	cspNonce: string;
};

export type BuildArtboardChromeHtmlArgs = {
	webview: vscode.Webview;
	extensionUri: vscode.Uri;
};

// The webview shell: CSP, the Svelte chrome bundle, and its mount point. Everything else is
// rendered by src/webview/ (Svelte). The nonce also stamps artboard script/style tags in the
// blob frames, which inherit this CSP.
export const buildArtboardChromeHtml = ({
	webview,
	extensionUri,
}: BuildArtboardChromeHtmlArgs): ArtboardChromeDocument => {
	const nonce = createCspNonce();
	const chromeCssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'chrome.css'),
	);
	const chromeJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'chrome.js'),
	);
	const csp = [
		"default-src 'none'",
		`style-src 'nonce-${nonce}' ${webview.cspSource}`,
		`script-src 'nonce-${nonce}' ${webview.cspSource}`,
		'frame-src blob:',
	].join('; ');
	return {
		html: `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Cursor Design</title>
	<link rel="stylesheet" nonce="${nonce}" href="${chromeCssUri.toString()}">
</head>
<body>
	<div id="svelte-root"></div>
	<script type="module" nonce="${nonce}" src="${chromeJsUri.toString()}"></script>
</body>
</html>`,
		cspNonce: nonce,
	};
};
