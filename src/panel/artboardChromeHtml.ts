import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

export const CHROME_JS_SEGMENTS = ['dist', 'webview', 'chrome.js'] as const;
export const CHROME_CSS_SEGMENTS = ['dist', 'webview', 'chrome.css'] as const;

const createCspNonce = (): string => randomBytes(16).toString('hex');

export type ArtboardChromeDocument = {
	html: string;
	cspNonce: string;
};

export type BuildArtboardChromeHtmlArgs = {
	webview: vscode.Webview;
	extensionUri: vscode.Uri;
};

// The nonce also stamps artboard script and style tags in the blob frames, which inherit this CSP.
export const buildArtboardChromeHtml = ({
	webview,
	extensionUri,
}: BuildArtboardChromeHtmlArgs): ArtboardChromeDocument => {
	const nonce = createCspNonce();
	const chromeCssUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, ...CHROME_CSS_SEGMENTS),
	);
	const chromeJsUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, ...CHROME_JS_SEGMENTS),
	);
	const csp = [
		"default-src 'none'",
		`style-src 'nonce-${nonce}' ${webview.cspSource}`,
		"style-src-attr 'unsafe-inline'",
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
	<title>Vibeboard</title>
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
