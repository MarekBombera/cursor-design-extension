import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { fake } from '../testing/fake';

const panelMock = vi.hoisted(() => ({
	receive: undefined as ((message: unknown) => void) | undefined,
	isTrusted: true,
	root: '/a' as string | undefined,
	warnings: [] as unknown[][],
	choice: undefined as string | undefined,
	clipboardError: undefined as Error | undefined,
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
		showWarningMessage: (...args: unknown[]) => {
			panelMock.warnings.push(args);
			return Promise.resolve(panelMock.choice);
		},
	},
	workspace: {
		get isTrusted() {
			return panelMock.isTrusted;
		},
	},
	env: {
		clipboard: {
			writeText: () =>
				panelMock.clipboardError ? Promise.reject(panelMock.clipboardError) : Promise.resolve(),
		},
	},
}));
vi.mock('./artboardChromeHtml', () => ({
	buildArtboardChromeHtml: () => ({ html: '', cspNonce: 'nonce' }),
}));
vi.mock('../host/hostFs', () => ({
	missingChromeAssets: () => Promise.resolve([]),
	chromeLoadErrorMessage: () => '',
	firstWorkspaceFolder: () =>
		panelMock.root === undefined ? undefined : { uri: { fsPath: panelMock.root } },
}));

const { createPanelPorts, openArtboardPanel, setArtboardPanelHandlers } =
	await import('./openArtboardPanel');

beforeEach(() => {
	panelMock.isTrusted = true;
	panelMock.root = '/a';
	panelMock.warnings = [];
	panelMock.choice = undefined;
	panelMock.clipboardError = undefined;
});

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

test('createPanelPorts: the delete confirm is the native modal; trust and root are read per call', async () => {
	const ports = createPanelPorts(fake<vscode.OutputChannel>({}));
	const prompt = { message: 'Delete "Home"?', detail: 'Gone.', action: 'Delete' };
	panelMock.choice = 'Delete';
	assert.equal(await ports.confirmModal(prompt), true);
	panelMock.choice = undefined;
	assert.equal(await ports.confirmModal(prompt), false);
	assert.deepEqual(panelMock.warnings, [
		['Delete "Home"?', { modal: true, detail: 'Gone.' }, 'Delete'],
		['Delete "Home"?', { modal: true, detail: 'Gone.' }, 'Delete'],
	]);

	assert.equal(ports.isTrusted(), true);
	assert.equal(ports.workspaceRoot(), '/a');
	panelMock.isTrusted = false;
	panelMock.root = undefined;
	assert.equal(ports.isTrusted(), false);
	assert.equal(ports.workspaceRoot(), undefined);
});

// Rule 02: a failed clipboard write must reject, so panelComments never marks the comment sent.
test('createPanelPorts: a rejected clipboard write rejects writeClipboard', async () => {
	const ports = createPanelPorts(fake<vscode.OutputChannel>({}));
	await ports.writeClipboard('prompt');
	panelMock.clipboardError = new Error('denied');
	await assert.rejects(ports.writeClipboard('prompt'), /denied/);
});
