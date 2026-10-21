import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type * as vscode from 'vscode';

import {
	ARTBOARD_CANVAS_RUNTIME_SOURCE,
	CANVAS_RUNTIME_ATTRIBUTE,
	FRAME_HEIGHT_MESSAGE,
	FRAME_WHEEL_MESSAGE,
} from './artboardCanvasRuntime';
import { buildArtboardChromeHtml, embedScriptSource } from './artboardChromeHtml';
import { buildArtboardChromeScript } from './artboardChromeScript';
import { STAGE_GEOMETRY_SOURCE } from './stageGeometry';

const fakeWebview = { cspSource: 'vscode-webview://test' } as vscode.Webview;

test('chrome document is complete and carries one CSP nonce everywhere', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.equal(chrome.cspNonce.length, 32);
	assert.ok(chrome.html.startsWith('<!DOCTYPE html>'));
	assert.ok(chrome.html.endsWith('</html>'));
	assert.ok(chrome.html.includes("default-src 'none'"));
	assert.ok(chrome.html.includes('frame-src blob:'));
	assert.ok(chrome.html.includes(`style-src 'nonce-${chrome.cspNonce}' vscode-webview://test`));
	assert.ok(chrome.html.includes(`script-src 'nonce-${chrome.cspNonce}' vscode-webview://test`));
	assert.ok(chrome.html.includes(`<style nonce="${chrome.cspNonce}">`));
	assert.ok(chrome.html.includes(`<script nonce="${chrome.cspNonce}">`));
});

test('chrome document has no static iframe, one vscode api, and no remote resources', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(!chrome.html.includes('id="artboard-frame"'));
	assert.ok(chrome.html.includes('<div id="stage-layer"></div>'));
	assert.equal(chrome.html.split('acquireVsCodeApi').length - 1, 1);
	assert.ok(!chrome.html.includes('http:'));
	assert.ok(chrome.html.includes('MCP unavailable. Artboard still loads from disk.'));
});

test('chrome script ignores nested-frame null origin', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes("event.origin === 'null'"));
});

test('chrome script hides the stage and disables the toolbar when there are no frames', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const reconcileIndex = chrome.html.indexOf('const reconcileCanvasFrames');
	const emptyIndex = chrome.html.indexOf('if (frameRecords.size === 0)', reconcileIndex);

	assert.ok(reconcileIndex >= 0);
	assert.ok(emptyIndex > reconcileIndex);
	assert.ok(emptyIndex < chrome.html.indexOf('applyEmptyStage();', emptyIndex) + 1);
	assert.ok(chrome.html.includes('stageViewport.hidden = true'));
	assert.ok(chrome.html.includes('zoomPreset.disabled = true'));
	assert.ok(chrome.html.includes('zoomFit.disabled = true'));
	assert.ok(!chrome.html.includes('artboardWell'));
});

test('a non-empty artboard shows the stage, enables the toolbar, then applies the initial view', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const showIndex = chrome.html.indexOf('stageViewport.hidden = false');

	assert.ok(showIndex >= 0);
	assert.ok(showIndex < chrome.html.indexOf('zoomPreset.disabled = false', showIndex));
	assert.ok(showIndex < chrome.html.indexOf('zoomFit.disabled = false', showIndex));
	assert.ok(showIndex < chrome.html.indexOf('applyInitialView();', showIndex));
});

test('chrome script source cannot break out of the inline script element', () => {
	const script = buildArtboardChromeScript({
		embeddedCanvasRuntimeSource: embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE),
		canvasRuntimeAttribute: CANVAS_RUNTIME_ATTRIBUTE,
		frameHeightMessage: FRAME_HEIGHT_MESSAGE,
		frameWheelMessage: FRAME_WHEEL_MESSAGE,
		mcpUnavailableCopy: 'MCP unavailable. Artboard still loads from disk.',
	});

	assert.ok(!script.includes('`'));
	assert.ok(!script.includes('${'));
	assert.ok(!script.includes('</'));
});

test('embedScriptSource escapes every less-than', () => {
	const embedded = embedScriptSource('a</script><b');

	assert.ok(embedded.includes('\\u003c'));
	assert.ok(!embedded.includes('<'));
});

test('chrome starts with an empty stage layer and injects the canvas runtime once', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const viewportIndex = chrome.html.indexOf('<div id="stage-viewport" hidden>');
	const layerIndex = chrome.html.indexOf('<div id="stage-layer"></div>');

	assert.ok(viewportIndex >= 0);
	assert.ok(layerIndex > viewportIndex);
	assert.ok(chrome.html.includes(CANVAS_RUNTIME_ATTRIBUTE));
	assert.ok(chrome.html.includes(embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE)));
	assert.equal(chrome.html.split('<script nonce="').length - 1, 1);
	assert.equal(chrome.html.split('</script>').length - 1, 1);
});

test('chrome inlines the stage geometry and transforms only the stage layer', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes(STAGE_GEOMETRY_SOURCE));
	assert.ok(chrome.html.includes('stageView = clampStageView('));
	assert.ok(chrome.html.includes('stageLayer.style.transform'));
	assert.ok(chrome.html.includes('vscodeApi.setState({ stageView })'));
	assert.ok(!chrome.html.includes('iframe.style.transform'));
	assert.ok(!chrome.html.includes('applyZoomDelta'));
	assert.equal(chrome.html.split('Math.exp(').length - 1, 1);
});

test('chrome restores a validated saved view and fits only once on first layout', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('vscodeApi.getState()'));
	assert.ok(chrome.html.includes('Number.isFinite(view.zoom)'));
	assert.ok(chrome.html.includes('view.zoom > 0'));
	assert.ok(chrome.html.includes('if (initialViewApplied)'));
	assert.ok(chrome.html.includes('initialViewApplied = true'));
	assert.ok(chrome.html.includes('hasSavedView'));
	assert.ok(chrome.html.includes('fitStageView'));
	assert.ok(chrome.html.includes('ResizeObserver'));
	assert.ok(chrome.html.includes('commitStageView(stageView)'));
});

test('chrome pans on plain wheel and zooms at the cursor on ctrl/meta wheel', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const listenerIndex = chrome.html.indexOf('stageViewport.addEventListener(');
	const wheelIndex = chrome.html.indexOf("'wheel'", listenerIndex);
	const passiveIndex = chrome.html.indexOf('{ passive: false }', wheelIndex);
	const listenerSource = chrome.html.slice(listenerIndex, passiveIndex);

	assert.ok(listenerIndex >= 0);
	assert.ok(wheelIndex > listenerIndex);
	assert.ok(passiveIndex > wheelIndex);
	assert.ok(
		listenerSource.indexOf('event.preventDefault()') < listenerSource.indexOf('event.ctrlKey'),
	);
	assert.ok(listenerSource.includes('event.metaKey'));
	assert.ok(listenerSource.includes('zoomStageAt('));
	assert.ok(listenerSource.includes('screenX: point.screenX'));
	assert.ok(
		listenerSource.includes(
			'panStage({ view: stageView, deltaX: event.deltaX, deltaY: event.deltaY })',
		),
	);
	assert.ok(chrome.html.includes('event.clientX - viewportRect.left'));
	assert.ok(chrome.html.includes('event.clientY - viewportRect.top'));
});

test('chrome frame-wheel validates every field and passes raw deltas', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('Number.isFinite(data.deltaX)'));
	assert.ok(chrome.html.includes('Number.isFinite(data.deltaY)'));
	assert.ok(chrome.html.includes('Number.isFinite(data.x)'));
	assert.ok(chrome.html.includes('Number.isFinite(data.y)'));
	assert.ok(chrome.html.includes("typeof data.ctrlKey !== 'boolean'"));
	assert.ok(chrome.html.includes('deltaY: data.deltaY'));
	assert.ok(chrome.html.includes('screenX: stageView.x + (frame.x + data.x) * stageView.zoom'));
	assert.ok(chrome.html.includes('screenY: stageView.y + (frame.y + data.y) * stageView.zoom'));
	assert.ok(chrome.html.includes('deltaX: data.deltaX'));
	assert.ok(chrome.html.includes('panStage({'));
});

test('chrome drags the empty stage with pointer capture in the pointer direction', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('event.button !== 0'));
	assert.ok(chrome.html.includes('event.target !== stageViewport && event.target !== stageLayer'));
	assert.ok(chrome.html.includes('stageViewport.setPointerCapture(event.pointerId)'));
	assert.ok(chrome.html.includes('deltaX: lastPointerX - event.clientX'));
	assert.ok(chrome.html.includes('deltaY: lastPointerY - event.clientY'));
	for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
		assert.ok(chrome.html.includes(`'${eventName}'`), eventName);
	}
});

test('chrome toolbar has the readout, nine presets in order, and a disabled Fit all', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const headerEnd = chrome.html.indexOf('</header>');
	const readoutIndex = chrome.html.indexOf('<span id="zoom-readout" class="badge">100%</span>');
	const selectIndex = chrome.html.indexOf(
		'<select id="zoom-preset" aria-label="Zoom preset" disabled>',
	);
	const fitIndex = chrome.html.indexOf(
		'<button id="zoom-fit" type="button" disabled>Fit all</button>',
	);

	assert.ok(readoutIndex >= 0);
	assert.ok(readoutIndex < selectIndex);
	assert.ok(selectIndex < fitIndex);
	assert.ok(fitIndex < headerEnd);
	assert.ok(chrome.html.includes('<option value="" selected disabled>Zoom</option>'));
	let previous = selectIndex;
	for (const value of ['0.5', '0.75', '0.9', '1', '1.1', '1.25', '1.5', '1.75', '2']) {
		const optionIndex = chrome.html.indexOf(`<option value="${value}">`, previous);
		assert.ok(optionIndex > previous, value);
		previous = optionIndex;
	}
	assert.ok(previous < fitIndex);
});

test('chrome presets zoom around the viewport center and Fit all refits', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('zoom: Number(zoomPreset.value)'));
	assert.ok(chrome.html.includes('screenX: stageViewport.clientWidth / 2'));
	assert.ok(chrome.html.includes('screenY: stageViewport.clientHeight / 2'));
	assert.ok(chrome.html.includes('zoomPreset.selectedIndex = 0'));
	assert.ok(chrome.html.includes("zoomFit.addEventListener('click'"));
	assert.ok(chrome.html.includes("Math.round(stageView.zoom * 100) + '%'"));
});

test('chrome routes iframe messages to canvas before the null-origin drop', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const sourceCheckIndex = chrome.html.indexOf('frameRecordForSource(event.source)');

	assert.ok(sourceCheckIndex >= 0);
	assert.ok(sourceCheckIndex < chrome.html.indexOf("event.origin === 'null'"));
	assert.ok(chrome.html.includes('record.iframe.contentWindow === source'));
});

test('canvas runtime posts only frame height and wheel and never touches the artboard', () => {
	const parentIndex = ARTBOARD_CANVAS_RUNTIME_SOURCE.indexOf('const host = window.parent');
	assert.ok(parentIndex >= 0);
	assert.ok(parentIndex < ARTBOARD_CANVAS_RUNTIME_SOURCE.indexOf('addEventListener'));
	assert.ok(!ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('<'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(JSON.stringify(FRAME_HEIGHT_MESSAGE)));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(JSON.stringify(FRAME_WHEEL_MESSAGE)));
	assert.equal(ARTBOARD_CANVAS_RUNTIME_SOURCE.split('host.postMessage').length - 1, 2);
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('parentElement'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('overflowY'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('overflowX'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes("'overlay'"));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('scrollHeight - 1 >'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('20000'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('x: event.clientX'));
	assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes('y: event.clientY'));
	for (const forbidden of [
		'.style',
		'classList',
		'setAttribute',
		'data-dc-',
		'sc-host',
		'design_doc_mode',
	]) {
		assert.ok(!ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(forbidden), forbidden);
	}
});

test('each chrome document gets a fresh nonce', () => {
	const first = buildArtboardChromeHtml(fakeWebview);
	const second = buildArtboardChromeHtml(fakeWebview);

	assert.notEqual(first.cspNonce, second.cspNonce);
});

test('canvas:updated replaces artboard:updated in host types and chrome', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const panelSource = readFileSync(join(process.cwd(), 'src/panel/openArtboardPanel.ts'), 'utf8');
	const diskSource = readFileSync(join(process.cwd(), 'src/host/artboardDisk.ts'), 'utf8');

	assert.ok(chrome.html.includes("data.type === 'canvas:updated'"));
	assert.ok(!chrome.html.includes('artboard:updated'));
	assert.ok(panelSource.includes('type CanvasUpdatedMessage'));
	assert.ok(panelSource.includes("type: 'canvas:updated'"));
	assert.ok(!panelSource.includes('artboard:updated'));
	assert.ok(diskSource.includes('type CanvasSnapshot'));
	assert.ok(!diskSource.includes('type ArtboardSnapshot'));
});

test('chrome validates canvas:updated and each frame before reconciling', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const validFrameIndex = chrome.html.indexOf('isValidPostedFrame(entry)');
	const removeInvalidIndex = chrome.html.indexOf('removeFrameRecord(entry.id)');

	assert.ok(chrome.html.includes('isValidCanvasUpdated(data)'));
	assert.ok(chrome.html.includes("typeof data.activeArtboardId === 'string'"));
	assert.ok(chrome.html.includes("typeof data.cspNonce === 'string'"));
	assert.ok(chrome.html.includes('Number.isFinite(data.generation)'));
	assert.ok(chrome.html.includes('Array.isArray(data.frames)'));
	assert.ok(validFrameIndex >= 0);
	assert.ok(removeInvalidIndex > validFrameIndex);
	assert.ok(chrome.html.includes("typeof entry.id === 'string'"));
	assert.ok(chrome.html.includes("typeof entry.label === 'string'"));
	assert.ok(chrome.html.includes("typeof entry.html === 'string'"));
	assert.ok(chrome.html.includes('Number.isFinite(entry.x)'));
	assert.ok(chrome.html.includes('Number.isFinite(entry.y)'));
	assert.ok(chrome.html.includes('Number.isFinite(entry.width)'));
	assert.ok(chrome.html.includes('isOptionalString(entry.group)'));
	assert.ok(chrome.html.includes('isOptionalString(entry.errorMessage)'));
});

test('chrome diffs frame html, revokes removed blobs, and toggles the active class', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const reloadIndex = chrome.html.indexOf(
		"const shouldReload = record.kind !== 'iframe' || html !== record.lastHtml",
	);
	const heightGuardIndex = chrome.html.indexOf(
		'record.heightGuard = { lastGrowth: 0, frozen: false }',
		reloadIndex,
	);
	const tileErrorIndex = chrome.html.indexOf("typeof frame.errorMessage === 'string'");
	const emptyTileIndex = chrome.html.indexOf("'Empty artboard file.'", tileErrorIndex);
	const renderTileIndex = chrome.html.indexOf("'Could not render this frame.'", tileErrorIndex);

	assert.ok(chrome.html.includes('html !== record.lastHtml'));
	assert.ok(chrome.html.includes("record.kind !== 'iframe'"));
	assert.ok(reloadIndex >= 0);
	assert.ok(heightGuardIndex > reloadIndex);
	assert.ok(tileErrorIndex >= 0);
	assert.ok(emptyTileIndex > tileErrorIndex);
	assert.ok(renderTileIndex > emptyTileIndex);
	assert.ok(chrome.html.includes('URL.revokeObjectURL(record.blobUrl)'));
	assert.ok(chrome.html.includes('removeFrameRecord(id)'));
	assert.ok(chrome.html.includes("record.wrapper.classList.add('cd-frame-active')"));
	assert.ok(chrome.html.includes("record.wrapper.classList.remove('cd-frame-active')"));
	assert.ok(chrome.html.includes('record.id === activeArtboardId'));
});

test('chrome labels and headings use textContent and never innerHTML', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(
		chrome.html.includes("labelNode.textContent = record === undefined ? '' : record.label"),
	);
	assert.ok(chrome.html.includes('headingNode.textContent = box.group'));
	assert.ok(!chrome.html.includes('innerHTML'));
});

test('every created iframe is sandboxed with scrolling disabled', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const createIndex = chrome.html.indexOf("document.createElement('iframe')");

	assert.ok(createIndex >= 0);
	const createBlock = chrome.html.slice(
		createIndex,
		chrome.html.indexOf('record.iframe = iframe', createIndex),
	);
	assert.ok(createBlock.includes("iframe.setAttribute('sandbox', 'allow-scripts')"));
	assert.ok(createBlock.includes("iframe.setAttribute('scrolling', 'no')"));
});

test('chrome frame-height validates height and applies nextFrameHeight', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('data.type === frameHeightMessage'));
	assert.ok(chrome.html.includes('Number.isFinite(data.height)'));
	assert.ok(chrome.html.includes('nextFrameHeight({'));
	assert.ok(chrome.html.includes('reported: data.height'));
	assert.ok(chrome.html.includes('reconcileChromeDecorations()'));
	assert.ok(chrome.html.includes('commitStageView(stageView)'));
});

test('canvas:wheel is gone from runtime, chrome script, and the CSP rule line', () => {
	const runtimeSource = readFileSync(
		join(process.cwd(), 'src/panel/artboardCanvasRuntime.ts'),
		'utf8',
	);
	const chromeScriptSource = readFileSync(
		join(process.cwd(), 'src/panel/artboardChromeScript.ts'),
		'utf8',
	);
	const ruleSource = readFileSync(join(process.cwd(), '.claude/rules/02-mcp-webview.md'), 'utf8');
	const ruleLine =
		'5. Messages: artboard:ready (chrome → host), canvas:updated|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed: cd:frame-height { height }, cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y } (frame-local CSS px). Chrome → iframe: none.';

	assert.ok(!runtimeSource.includes('canvas:wheel'));
	assert.ok(!chromeScriptSource.includes('canvas:wheel'));
	assert.ok(ruleSource.includes(ruleLine));
});
