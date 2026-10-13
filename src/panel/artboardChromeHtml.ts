import { randomBytes } from 'node:crypto';

import type * as vscode from 'vscode';

import {
	ARTBOARD_CANVAS_RUNTIME_SOURCE,
	CANVAS_RUNTIME_ATTRIBUTE,
	CANVAS_WHEEL_MESSAGE,
} from './artboardCanvasRuntime';

const MCP_UNAVAILABLE_COPY = 'MCP unavailable. Artboard still loads from disk.';

const createCspNonce = (): string => randomBytes(16).toString('hex');

export const embedScriptSource = (source: string): string =>
	JSON.stringify(source).replaceAll('<', '\\u003c');

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
		#artboard-well {
			flex: 1 1 auto;
			position: relative;
			overflow: hidden;
			background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
		}
		#artboard-frame {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
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
	<p id="artboard-error" class="error" role="alert" hidden></p>
	<p id="mcp-banner" class="mcp-banner" role="status" hidden></p>
	<p id="empty-copy">No artboard yet.</p>
	<div id="artboard-well" hidden>
		<iframe id="artboard-frame" sandbox="allow-scripts" title="Artboard preview"></iframe>
	</div>
	<script nonce="${nonce}">
		const vscodeApi = acquireVsCodeApi();
		const iframe = document.getElementById('artboard-frame');
		const artboardWell = document.getElementById('artboard-well');
		const canvasRuntimeSource = ${embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE)};
		const canvasRuntimeAttribute = ${JSON.stringify(CANVAS_RUNTIME_ATTRIBUTE)};
		const canvasWheelMessage = ${JSON.stringify(CANVAS_WHEEL_MESSAGE)};
		const canvasView = { x: 0, y: 0, zoom: 1 };
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

		const applyCanvasView = () => {
			iframe.style.transformOrigin = '0 0';
			iframe.style.transform =
				'translate(' + canvasView.x + 'px, ' + canvasView.y + 'px) scale(' + canvasView.zoom + ')';
		};

		const applyZoomDelta = (deltaY) => {
			const zoomStep = Math.min(0.2, Math.max(-0.2, -deltaY * 0.01));
			canvasView.zoom = Math.min(2, Math.max(0.5, canvasView.zoom * Math.exp(zoomStep)));
			applyCanvasView();
		};

		const handleCanvasMessage = (data) => {
			// ponytail: rejects are not logged; wheel fires at 60+ Hz, so logging would spam.
			// Upgrade path: a debug-only reject counter.
			if (data === null || typeof data !== 'object' || data.type !== canvasWheelMessage) {
				return;
			}
			if (!Number.isFinite(data.deltaY)) {
				return;
			}
			applyZoomDelta(data.deltaY);
		};

		// Letterbox gestures land on the chrome document, not the runtime. Wheel events
		// inside the iframe never bubble here, so the two paths cannot double-zoom.
		artboardWell.addEventListener(
			'wheel',
			(event) => {
				if (!event.ctrlKey && !event.metaKey) {
					return;
				}
				event.preventDefault();
				applyZoomDelta(event.deltaY);
			},
			{ passive: false },
		);

		// Runs first in head (after meta charset) so the runtime captures window.parent
		// and registers its wheel listener before any artboard script.
		const injectCanvasRuntime = (parsed, nonceValue) => {
			for (const element of parsed.querySelectorAll('script[' + canvasRuntimeAttribute + ']')) {
				element.remove();
			}
			const runtimeScript = parsed.createElement('script');
			runtimeScript.setAttribute('nonce', nonceValue);
			runtimeScript.setAttribute(canvasRuntimeAttribute, '');
			runtimeScript.textContent = canvasRuntimeSource;
			const charsetMeta = parsed.head.querySelector('meta[charset]');
			if (charsetMeta !== null) {
				charsetMeta.after(runtimeScript);
				return;
			}
			parsed.head.prepend(runtimeScript);
		};

		// The blob frame inherits this document's nonce CSP, so bare <script>/<style>
		// would be blocked. Stamping the chrome nonce re-allows exactly those tags;
		// inline handlers, style="" attributes, and subresources stay blocked (v1 limit).
		// DOMParser never executes scripts, and meta http-equiv is stripped so the
		// artboard cannot stack its own policy on top. The canvas runtime is then
		// injected into the blob copy only; disk and export HTML never see it.
		const stampArtboardHtml = (rawHtml, nonceValue) => {
			const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
			for (const element of parsed.querySelectorAll('meta[http-equiv]')) {
				element.remove();
			}
			for (const element of parsed.querySelectorAll('script, style')) {
				element.setAttribute('nonce', nonceValue);
			}
			injectCanvasRuntime(parsed, nonceValue);
			return '<!DOCTYPE html>' + parsed.documentElement.outerHTML;
		};

		const applyArtboardHtml = (html, nonceValue) => {
			if (html === lastHtml) {
				return;
			}
			lastHtml = html;
			revokeCurrentBlob();
			if (html.length === 0) {
				artboardWell.hidden = true;
				iframe.removeAttribute('src');
				emptyCopy.hidden = false;
				return;
			}
			emptyCopy.hidden = true;
			artboardWell.hidden = false;
			const blob = new Blob([stampArtboardHtml(html, nonceValue)], { type: 'text/html' });
			currentBlobUrl = URL.createObjectURL(blob);
			iframe.src = currentBlobUrl;
		};

		window.addEventListener('message', (event) => {
			if (iframe.contentWindow !== null && event.source === iframe.contentWindow) {
				handleCanvasMessage(event.data);
				return;
			}
			if (event.origin === 'null') {
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
		applyCanvasView();
		vscodeApi.postMessage({ type: 'artboard:ready' });
	</script>
</body>
</html>`,
		cspNonce: nonce,
	};
};
