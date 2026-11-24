import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { chromeLoadErrorMessage, missingChromeAssets } from './hostFs';

const vscodeMock = vi.hoisted(() => ({
	stat: vi.fn<(uri: { path: string }) => Promise<void>>(),
	FileSystemError: class extends Error {
		constructor(readonly code: string) {
			super(code);
		}
	},
}));

vi.mock('vscode', () => ({
	Uri: {
		joinPath: (base: { path: string }, ...segments: string[]) => ({
			path: [base.path, ...segments].join('/'),
		}),
	},
	FileSystemError: vscodeMock.FileSystemError,
	workspace: { fs: { stat: vscodeMock.stat } },
}));

const extensionUri = { path: '/extension' } as vscode.Uri;
const JS = 'dist/webview/chrome.js';
const CSS = 'dist/webview/chrome.css';
const notFound = (): Error => new vscodeMock.FileSystemError('FileNotFound');

const statFailing = (failures: Record<string, Error>): void => {
	vscodeMock.stat.mockImplementation((uri) => {
		const failure = failures[uri.path.replace('/extension/', '')];
		return failure === undefined ? Promise.resolve() : Promise.reject(failure);
	});
};

test('missingChromeAssets: both present → none missing', async () => {
	statFailing({});
	assert.deepEqual(await missingChromeAssets(extensionUri), []);
});

test('missingChromeAssets: chrome.js not found → only the js', async () => {
	statFailing({ [JS]: notFound() });
	assert.deepEqual(await missingChromeAssets(extensionUri), [JS]);
});

test('missingChromeAssets: both not found → js first, then css', async () => {
	statFailing({ [CSS]: notFound(), [JS]: notFound() });
	assert.deepEqual(await missingChromeAssets(extensionUri), [JS, CSS]);
});

test('missingChromeAssets: a non-not-found stat error counts as missing and still resolves', async () => {
	statFailing({ [CSS]: new Error('EACCES') });
	assert.deepEqual(await missingChromeAssets(extensionUri), [CSS]);
});

test('chromeLoadErrorMessage: exact text for js only, css only, and both', () => {
	assert.equal(
		chromeLoadErrorMessage([JS]),
		'Vibeboard could not load its panel: dist/webview/chrome.js is missing. Reinstall the extension, or run pnpm compile in a development checkout.',
	);
	assert.equal(
		chromeLoadErrorMessage([CSS]),
		'Vibeboard could not load its panel: dist/webview/chrome.css is missing. Reinstall the extension, or run pnpm compile in a development checkout.',
	);
	assert.equal(
		chromeLoadErrorMessage([JS, CSS]),
		'Vibeboard could not load its panel: dist/webview/chrome.js and dist/webview/chrome.css are missing. Reinstall the extension, or run pnpm compile in a development checkout.',
	);
});
