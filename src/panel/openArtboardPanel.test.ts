import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

const panelMock = vi.hoisted(() => ({
	receive: undefined as ((message: unknown) => void) | undefined,
}));

vi.mock('vscode', () => ({
	ViewColumn: { One: 1, Beside: -2 },
	Uri: { joinPath: (base: unknown) => base },
	window: {
		createWebviewPanel: () => ({
			visible: true,
			webview: {
				html: '',
				postMessage: () => Promise.resolve(true),
				onDidReceiveMessage: (listener: (message: unknown) => void) => {
					panelMock.receive = listener;
				},
			},
			onDidChangeViewState: () => {},
			onDidDispose: () => {},
		}),
		showErrorMessage: () => Promise.resolve(undefined),
	},
}));
vi.mock('./artboardChromeHtml', () => ({
	buildArtboardChromeHtml: () => ({ html: '', cspNonce: 'nonce' }),
}));
vi.mock('../host/hostFs', () => ({
	missingChromeAssets: () => Promise.resolve([]),
	chromeLoadErrorMessage: () => '',
}));

const { openArtboardPanel, setArtboardPanelHandlers } = await import('./openArtboardPanel');

test('each claimed chrome request type reaches exactly its own handler', () => {
	const calls: [string, unknown][] = [];
	const handler =
		(name: string) =>
		(value: unknown): void => {
			calls.push([name, value]);
		};
	setArtboardPanelHandlers({
		onVisible: () => {
			calls.push(['onVisible', undefined]);
		},
		onFramePlace: handler('onFramePlace'),
		onEditRequest: handler('onEditRequest'),
		onHistoryRequest: handler('onHistoryRequest'),
		onCommentRequest: handler('onCommentRequest'),
		onPageRequest: handler('onPageRequest'),
	});
	openArtboardPanel({ context: { extensionUri: {} } as unknown as vscode.ExtensionContext });
	const cases: [string, unknown][] = [
		['onFramePlace', { type: 'frame:place' }],
		['onEditRequest', { type: 'artboard:edit' }],
		['onHistoryRequest', { type: 'artboard:history' }],
		['onCommentRequest', { type: 'comment:reply' }],
		['onPageRequest', { type: 'page:open' }],
	];
	for (const [, message] of cases) {
		panelMock.receive?.(message);
	}
	// Unclaimed and ready messages reach no handler.
	panelMock.receive?.({ type: 'artboard:ready' });
	panelMock.receive?.({ type: 'unknown' });
	assert.deepEqual(calls, cases);
});
