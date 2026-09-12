import { randomBytes } from 'node:crypto';

import type * as vscode from 'vscode';

const MCP_UNAVAILABLE_COPY = 'MCP unavailable. Artboard still loads from disk.';

const createCspNonce = (): string => randomBytes(16).toString('hex');

export type ArtboardChromeDocument = {
	html: string;
	cspNonce: string;
};

export const buildArtboardChromeHtml = (webview: vscode.Webview): ArtboardChromeDocument => {
	const nonce = createCspNonce();
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
		<span id="handoff-stale-badge" class="badge" aria-live="polite" hidden></span>
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
		const handoffBadge = document.getElementById('handoff-stale-badge');
		const errorBanner = document.getElementById('artboard-error');
		const mcpBanner = document.getElementById('mcp-banner');
		const mcpUnavailableCopy = '${MCP_UNAVAILABLE_COPY}';
		const handoffStaleCopy = 'Handoff out of date. Re-export.';
		let currentBlobUrl;
		let lastHtml;

		const revokeCurrentBlob = () => {
			if (currentBlobUrl !== undefined) {
				URL.revokeObjectURL(currentBlobUrl);
				currentBlobUrl = undefined;
			}
		};

		// The blob frame inherits this document's nonce CSP, so bare <script>/<style>
		// would be blocked. Stamping the chrome nonce re-allows exactly those tags;
		// inline handlers, style="" attributes, and subresources stay blocked (v1 limit).
		// DOMParser never executes scripts, and meta http-equiv is stripped so the
		// artboard cannot stack its own policy on top.
		const stampArtboardHtml = (rawHtml, nonceValue) => {
			const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
			for (const element of parsed.querySelectorAll('meta[http-equiv]')) {
				element.remove();
			}
			for (const element of parsed.querySelectorAll('script, style')) {
				element.setAttribute('nonce', nonceValue);
			}
			return '<!DOCTYPE html>' + parsed.documentElement.outerHTML;
		};

		const applyArtboardHtml = (html, nonceValue) => {
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
			const blob = new Blob([stampArtboardHtml(html, nonceValue)], { type: 'text/html' });
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
				applyArtboardHtml(
					typeof data.html === 'string' ? data.html : '',
					typeof data.cspNonce === 'string' ? data.cspNonce : '',
				);
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
				} else {
					mcpBanner.hidden = false;
					mcpBanner.textContent = mcpUnavailableCopy;
				}
				if (data.handoffStale === true) {
					handoffBadge.hidden = false;
					handoffBadge.textContent = handoffStaleCopy;
					return;
				}
				handoffBadge.hidden = true;
				handoffBadge.textContent = '';
			}
		});

		window.addEventListener('pagehide', revokeCurrentBlob);
		vscodeApi.postMessage({ type: 'artboard:ready' });
	</script>
</body>
</html>`,
		cspNonce: nonce,
	};
};
