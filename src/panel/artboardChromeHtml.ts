import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import {
	ARTBOARD_CANVAS_RUNTIME_SOURCE,
	CANVAS_RUNTIME_ATTRIBUTE,
	FRAME_HEIGHT_MESSAGE,
	FRAME_WHEEL_MESSAGE,
} from './artboardCanvasRuntime';
import { buildArtboardChromeScript } from './artboardChromeScript';
import { STAGE_GEOMETRY_SOURCE } from './stageGeometry';

const MCP_UNAVAILABLE_COPY = 'MCP unavailable. Artboard still loads from disk.';

const createCspNonce = (): string => randomBytes(16).toString('hex');

export const embedScriptSource = (source: string): string =>
	JSON.stringify(source).replaceAll('<', '\\u003c');

export type ArtboardChromeDocument = {
	html: string;
	cspNonce: string;
};

export type BuildArtboardChromeHtmlArgs = {
	webview: vscode.Webview;
	extensionUri: vscode.Uri;
};

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
	const chromeScript = buildArtboardChromeScript({
		embeddedCanvasRuntimeSource: embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE),
		canvasRuntimeAttribute: CANVAS_RUNTIME_ATTRIBUTE,
		frameHeightMessage: FRAME_HEIGHT_MESSAGE,
		frameWheelMessage: FRAME_WHEEL_MESSAGE,
		mcpUnavailableCopy: MCP_UNAVAILABLE_COPY,
	});
	return {
		html: `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Cursor Design</title>
	<link rel="stylesheet" nonce="${nonce}" href="${chromeCssUri.toString()}">
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
		#zoom-readout {
			margin-left: auto;
		}
		#zoom-preset {
			font: inherit;
			color: var(--vscode-dropdown-foreground);
			background: var(--vscode-dropdown-background);
			border: 1px solid var(--vscode-dropdown-border);
		}
		#zoom-fit {
			font: inherit;
			padding: 0.125rem 0.5rem;
			color: var(--vscode-button-secondaryForeground);
			background: var(--vscode-button-secondaryBackground);
			border: 0;
		}
		#zoom-preset:focus-visible,
		#zoom-fit:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
		}
		#stage-viewport {
			flex: 1 1 auto;
			position: relative;
			overflow: hidden;
			background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
			min-height: 0;
			touch-action: none;
			cursor: grab;
		}
		#stage-layer {
			position: absolute;
			left: 0;
			top: 0;
			transform-origin: 0 0;
		}
		.cd-frame {
			position: absolute;
			overflow: hidden;
			pointer-events: none;
		}
		.cd-frame > iframe {
			display: block;
			width: 100%;
			height: 100%;
			border: 0;
			background: var(--vscode-editor-background);
			pointer-events: auto;
		}
		.cd-frame-active {
			outline: 2px solid var(--vscode-focusBorder);
		}
		.cd-frame-tile {
			width: 100%;
			height: 100%;
			box-sizing: border-box;
			padding: 0.5rem 0.75rem;
			color: var(--vscode-errorForeground);
			border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
			overflow-wrap: anywhere;
		}
		.cd-frame-label,
		.cd-group-heading {
			position: absolute;
			pointer-events: none;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			box-sizing: border-box;
		}
	</style>
</head>
<body>
	<header class="chrome-bar">
		<span id="artboard-id-badge" class="badge"></span>
		<span id="artboard-generation-badge" class="badge"></span>
		<span id="handoff-stale-badge" class="badge" aria-live="polite" hidden></span>
		<span id="zoom-readout" class="badge">100%</span>
		<select id="zoom-preset" aria-label="Zoom preset" disabled>
			<option value="" selected disabled>Zoom</option>
			<option value="0.5">50%</option>
			<option value="0.75">75%</option>
			<option value="0.9">90%</option>
			<option value="1">100%</option>
			<option value="1.1">110%</option>
			<option value="1.25">125%</option>
			<option value="1.5">150%</option>
			<option value="1.75">175%</option>
			<option value="2">200%</option>
		</select>
		<button id="zoom-fit" type="button" disabled>Fit all</button>
	</header>
	<p id="artboard-error" class="error" role="alert" hidden></p>
	<p id="mcp-banner" class="mcp-banner" role="status" hidden></p>
	<p id="empty-copy">No artboard yet.</p>
	<div id="stage-viewport" hidden>
		<div id="stage-layer"></div>
	</div>
	<script nonce="${nonce}">
		${STAGE_GEOMETRY_SOURCE}
		${chromeScript}
	</script>
	<div id="svelte-root" hidden></div>
	<script type="module" nonce="${nonce}" src="${chromeJsUri.toString()}"></script>
</body>
</html>`,
		cspNonce: nonce,
	};
};
