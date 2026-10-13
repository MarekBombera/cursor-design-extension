import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as vscode from 'vscode';

import {
	ARTBOARD_CANVAS_RUNTIME_SOURCE,
	CANVAS_RUNTIME_ATTRIBUTE,
	CANVAS_WHEEL_MESSAGE,
} from './artboardCanvasRuntime';
import { buildArtboardChromeHtml, embedScriptSource } from './artboardChromeHtml';

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

test('chrome script hides the well and drops src on empty html', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);

	assert.ok(chrome.html.includes('if (html.length === 0)'));
	assert.ok(chrome.html.includes('artboardWell.hidden = true'));
	assert.ok(chrome.html.includes("iframe.removeAttribute('src')"));
});

test('embedScriptSource escapes every less-than', () => {
	const embedded = embedScriptSource('a</script><b');

	assert.ok(embedded.includes('\\u003c'));
	assert.ok(!embedded.includes('<'));
});

test('chrome wraps the iframe in the well and injects the canvas runtime once', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const wellIndex = chrome.html.indexOf('<div id="artboard-well" hidden>');

	assert.ok(wellIndex >= 0);
	assert.ok(wellIndex < chrome.html.indexOf('<iframe id="artboard-frame" sandbox="allow-scripts"'));
	assert.ok(chrome.html.includes(CANVAS_RUNTIME_ATTRIBUTE));
	assert.ok(chrome.html.includes(embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE)));
	assert.equal(chrome.html.split('<script nonce="').length - 1, 1);
	assert.equal(chrome.html.split('</script>').length - 1, 1);
	assert.ok(chrome.html.includes('transformOrigin'));
	assert.ok(chrome.html.includes('style.transform'));
});

test('chrome routes iframe messages to canvas before the null-origin drop', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const sourceCheckIndex = chrome.html.indexOf('event.source === iframe.contentWindow');

	assert.ok(sourceCheckIndex >= 0);
	assert.ok(sourceCheckIndex < chrome.html.indexOf("event.origin === 'null'"));
});

test('chrome zooms from ctrl/meta wheel over the letterbox well through the shared zoom path', () => {
	const chrome = buildArtboardChromeHtml(fakeWebview);
	const listenerIndex = chrome.html.indexOf("artboardWell.addEventListener(\n\t\t\t'wheel'");
	const passiveIndex = chrome.html.indexOf('{ passive: false }', listenerIndex);
	const listenerSource = chrome.html.slice(listenerIndex, passiveIndex);

	assert.ok(listenerIndex >= 0);
	assert.ok(passiveIndex > listenerIndex);
	assert.ok(listenerSource.includes('event.metaKey'));
	assert.ok(listenerSource.includes('event.ctrlKey'));
	assert.ok(listenerSource.includes('event.preventDefault()'));
	assert.ok(listenerSource.includes('applyZoomDelta(event.deltaY)'));
	assert.ok(chrome.html.includes('applyZoomDelta(data.deltaY)'));
	assert.equal(chrome.html.split('Math.exp(').length - 1, 1);
});

test('canvas runtime only forwards ctrl+wheel and never touches the artboard', () => {
	for (const required of [
		'passive: false',
		'ctrlKey',
		'metaKey',
		'preventDefault',
		'window.parent',
		JSON.stringify(CANVAS_WHEEL_MESSAGE),
	]) {
		assert.ok(ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(required), required);
	}
	for (const forbidden of ['<', '.style', 'classList', 'clientX', 'data-dc-', 'sc-host', 'design_doc_mode']) {
		assert.ok(!ARTBOARD_CANVAS_RUNTIME_SOURCE.includes(forbidden), forbidden);
	}
});

test('each chrome document gets a fresh nonce', () => {
	const first = buildArtboardChromeHtml(fakeWebview);
	const second = buildArtboardChromeHtml(fakeWebview);

	assert.notEqual(first.cspNonce, second.cspNonce);
});
