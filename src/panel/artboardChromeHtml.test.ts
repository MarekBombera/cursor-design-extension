import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { type ArtboardChromeDocument, buildArtboardChromeHtml } from './artboardChromeHtml';

vi.mock('vscode', () => ({
	Uri: {
		joinPath: (base: { path: string }, ...segments: string[]) => ({
			path: `/${[base.path.replace(/^\/+|\/+$/g, ''), ...segments].filter(Boolean).join('/')}`,
		}),
	},
}));

const fakeExtensionUri = { path: '/extension', scheme: 'file' } as vscode.Uri;
const fakeWebview = {
	cspSource: 'vscode-webview://test',
	asWebviewUri: (uri: vscode.Uri): vscode.Uri =>
		({
			toString: (): string => `vscode-webview://test${uri.path}`,
		}) as vscode.Uri,
} as vscode.Webview;

const buildChrome = (): ArtboardChromeDocument =>
	buildArtboardChromeHtml({ webview: fakeWebview, extensionUri: fakeExtensionUri });

test('shell is a complete document whose CSP is exactly the chrome policy', () => {
	const chrome = buildChrome();

	assert.equal(chrome.cspNonce.length, 32);
	assert.ok(chrome.html.startsWith('<!DOCTYPE html>'));
	assert.ok(chrome.html.endsWith('</html>'));
	// Artboard frames inherit this CSP. Changing it also updates what Agents are told works in a
	// frame: skills/cursor-design/SKILL.md § Writing artboard HTML and ARTBOARD_HTML_RULES in
	// src/mcp/artboardTools.ts.
	const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(chrome.html)?.[1];
	assert.equal(
		csp,
		`default-src 'none'; style-src 'nonce-${chrome.cspNonce}' vscode-webview://test; script-src 'nonce-${chrome.cspNonce}' vscode-webview://test; frame-src blob:`,
	);
});

test('the nonce sits on the stylesheet link and the module script and nowhere else', () => {
	const chrome = buildChrome();

	assert.ok(
		chrome.html.includes(
			`<link rel="stylesheet" nonce="${chrome.cspNonce}" href="vscode-webview://test/extension/dist/webview/chrome.css">`,
		),
	);
	const nonceAttributes = chrome.html.match(/nonce="[^"]*"/g) ?? [];
	assert.deepEqual(nonceAttributes, [`nonce="${chrome.cspNonce}"`, `nonce="${chrome.cspNonce}"`]);
	assert.equal(chrome.html.split(chrome.cspNonce).length - 1, 4);
});

test('one module script from asWebviewUri, after the mount element', () => {
	const chrome = buildChrome();

	const scripts = chrome.html.match(/<script\b[^>]*>/g) ?? [];
	assert.deepEqual(scripts, [
		`<script type="module" nonce="${chrome.cspNonce}" src="vscode-webview://test/extension/dist/webview/chrome.js">`,
	]);
	const rootIndex = chrome.html.indexOf('<div id="svelte-root"></div>');
	assert.ok(rootIndex >= 0);
	assert.ok(rootIndex < chrome.html.indexOf('<script'));
});

test('shell has no inline style, no vscode api, and no remote resources', () => {
	const chrome = buildChrome();

	assert.ok(!chrome.html.includes('<style'));
	assert.ok(!chrome.html.includes('acquireVsCodeApi'));
	assert.ok(!chrome.html.includes('http:'));
	assert.ok(!chrome.html.includes('https:'));
});

test('every document gets a fresh nonce', () => {
	assert.notEqual(buildChrome().cspNonce, buildChrome().cspNonce);
});
