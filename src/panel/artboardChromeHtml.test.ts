import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as vscode from 'vscode';

import { buildArtboardChromeHtml } from './artboardChromeHtml';

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

test('each chrome document gets a fresh nonce', () => {
	const first = buildArtboardChromeHtml(fakeWebview);
	const second = buildArtboardChromeHtml(fakeWebview);

	assert.notEqual(first.cspNonce, second.cspNonce);
});
