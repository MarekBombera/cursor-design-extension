import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as vscode from 'vscode';

import {
	ARTBOARD_CANVAS_RUNTIME_SOURCE,
	CANVAS_RUNTIME_ATTRIBUTE,
	CANVAS_WHEEL_MESSAGE,
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

test('chrome document keeps sandbox, single vscode api, and no remote resources', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('<iframe id="artboard-frame" sandbox="allow-scripts"'));
	assert.equal(chrome.html.split('acquireVsCodeApi').length - 1, 1);
	assert.ok(!chrome.html.includes('http:'));
	assert.ok(chrome.html.includes('MCP unavailable. Artboard still loads from disk.'));
});

test('chrome script ignores nested-frame null origin', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes("event.origin === 'null'"));
});

test('chrome script hides the stage, disables the toolbar, and drops src on empty html', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const emptyIndex = chrome.html.indexOf('if (html.length === 0)');
	const emptyBranch = chrome.html.slice(emptyIndex, chrome.html.indexOf('return;', emptyIndex));

	assert.ok(emptyIndex >= 0);
	assert.ok(emptyBranch.includes('stageViewport.hidden = true'));
	assert.ok(emptyBranch.includes('zoomPreset.disabled = true'));
	assert.ok(emptyBranch.includes('zoomFit.disabled = true'));
	assert.ok(emptyBranch.includes("iframe.removeAttribute('src')"));
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
		canvasWheelMessage: CANVAS_WHEEL_MESSAGE,
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

test('chrome nests the iframe in the stage layer and injects the canvas runtime once', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const viewportIndex = chrome.html.indexOf('<div id="stage-viewport" hidden>');
	const layerIndex = chrome.html.indexOf('<div id="stage-layer">');
	const iframeIndex = chrome.html.indexOf('<iframe id="artboard-frame" sandbox="allow-scripts"');

	assert.ok(viewportIndex >= 0);
	assert.ok(viewportIndex < layerIndex);
	assert.ok(layerIndex < iframeIndex);
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
	assert.ok(listenerSource.indexOf('event.preventDefault()') < listenerSource.indexOf('event.ctrlKey'));
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

test('chrome forwards frame zoom only with a finite cursor anchored at the frame origin', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('Number.isFinite(data.deltaY)'));
	assert.ok(chrome.html.includes('Number.isFinite(data.clientX)'));
	assert.ok(chrome.html.includes('Number.isFinite(data.clientY)'));
	assert.ok(chrome.html.includes('screenX: stageView.x + data.clientX * stageView.zoom'));
	assert.ok(chrome.html.includes('screenY: stageView.y + data.clientY * stageView.zoom'));
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
	const selectIndex = chrome.html.indexOf('<select id="zoom-preset" aria-label="Zoom preset" disabled>');
	const fitIndex = chrome.html.indexOf('<button id="zoom-fit" type="button" disabled>Fit all</button>');

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
	const sourceCheckIndex = chrome.html.indexOf('event.source === iframe.contentWindow');

	assert.ok(sourceCheckIndex >= 0);
	assert.ok(sourceCheckIndex < chrome.html.indexOf("event.origin === 'null'"));
});

test('canvas runtime only forwards ctrl+wheel and never touches the artboard', () => {
	for (const required of [
		'passive: false',
		'ctrlKey',
		'metaKey',
		'preventDefault',
		'window.parent',
		JSON.stringify(CANVAS_WHEEL_MESSAGE),
		'clientX: event.clientX',
		'clientY: event.clientY',
	]) {
		assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(required), required);
	}
	for (const forbidden of ['<', '.style', 'classList', 'data-dc-', 'sc-host', 'design_doc_mode']) {
		assert.ok(!ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(forbidden), forbidden);
	}
});

test('each chrome document gets a fresh nonce', () => {
	const first = buildArtboardChromeHtml(fakeWebview);
	const second = buildArtboardChromeHtml(fakeWebview);

	assert.notEqual(first.cspNonce, second.cspNonce);
});
