import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { CorruptProjectError, DiskError, PageNotFoundError } from '../disk/errors';
import { PAGE_GONE_MESSAGE } from './panelRequestCopy';
import {
	initAndLoadArtboard,
	placeFrameFromChrome,
	readActiveArtboardFromDisk,
} from './artboardDisk';

const host = vi.hoisted(() => ({ manifestExists: true }));

vi.mock('vscode', () => ({
	workspace: { isTrusted: true },
	Uri: { joinPath: (_base: unknown, ...segments: string[]) => segments.join('/') },
}));
vi.mock('./hostFs', () => ({
	firstWorkspaceFolder: () => ({ uri: { fsPath: '/ws' } }),
	fileExists: vi.fn(() => Promise.resolve(host.manifestExists)),
	logDiskError: vi.fn(),
}));
// page-2 is open; the frame:place below names page-1.
vi.mock('../disk/openPage', () => ({
	resolveOpenPage: vi.fn(({ workspaceRoot }: { workspaceRoot: string }) =>
		Promise.resolve({ workspaceRoot, pageId: 'page-2' }),
	),
	resolveRequestedPage: vi.fn(
		({ workspaceRoot, pageId }: { workspaceRoot: string; pageId: string }) =>
			Promise.resolve({ workspaceRoot, pageId }),
	),
}));
vi.mock('../disk/artboardFs', () => ({
	createArtboard: vi.fn(() => Promise.resolve()),
	setActiveArtboard: vi.fn(() => Promise.resolve()),
	placeFrame: vi.fn(() => Promise.resolve()),
	readCanvasView: vi.fn(() =>
		Promise.resolve({ activeArtboardId: '', frames: [], handoffStale: false }),
	),
}));

const { resolveOpenPage, resolveRequestedPage } = await import('../disk/openPage');
const { createArtboard, placeFrame, readCanvasView } = await import('../disk/artboardFs');
const { fileExists, logDiskError } = await import('./hostFs');

const workspaceFolder = { uri: { fsPath: '/ws' } } as vscode.WorkspaceFolder;
const outputChannel = {} as vscode.OutputChannel;
const args = { workspaceFolder, outputChannel };

const framePlace = {
	type: 'frame:place',
	pageId: 'page-1',
	id: 'hero',
	x: 10,
	y: 20,
	width: 400,
	base: { x: 0, y: 0, width: 400 },
};

beforeEach(() => {
	host.manifestExists = true;
	vi.clearAllMocks();
});

const createIfFreshFlags = (): unknown[] =>
	vi.mocked(resolveOpenPage).mock.calls.map(([call]) => call.createIfFresh);

test("Open resolves with createIfFresh; the refresh and frame:place's refresh do not", async () => {
	await initAndLoadArtboard(args);
	assert.deepEqual(createIfFreshFlags(), [true]);
	vi.mocked(resolveOpenPage).mockClear();
	await readActiveArtboardFromDisk(args);
	await placeFrameFromChrome({ value: framePlace, outputChannel });
	assert.deepEqual(createIfFreshFlags(), [false, false]);
});

test("a frame:place for page-1 while page-2 is open places on page-1's location", async () => {
	const pageOne = { workspaceRoot: '/ws', pageId: 'page-1' };
	vi.mocked(resolveRequestedPage).mockResolvedValueOnce(pageOne);
	const snapshot = await placeFrameFromChrome({ value: framePlace, outputChannel });
	assert.deepEqual(vi.mocked(resolveRequestedPage).mock.calls, [
		[{ workspaceRoot: '/ws', pageId: 'page-1' }],
	]);
	assert.equal(vi.mocked(placeFrame).mock.calls[0]?.[0].page, pageOne);
	// The answer is the open page's snapshot.
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, undefined);
});

test('a frame:place for a gone page answers the open page with the page copy', async () => {
	vi.mocked(resolveRequestedPage).mockRejectedValueOnce(new PageNotFoundError('page-1'));
	const snapshot = await placeFrameFromChrome({ value: framePlace, outputChannel });
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, PAGE_GONE_MESSAGE);
});

test('a rejected resolve logs once and yields the safe message with no page', async () => {
	for (const load of [initAndLoadArtboard, readActiveArtboardFromDisk]) {
		vi.mocked(logDiskError).mockClear();
		vi.mocked(resolveOpenPage).mockRejectedValueOnce(new CorruptProjectError());
		const snapshot = await load(args);
		assert.equal(vi.mocked(logDiskError).mock.calls.length, 1);
		assert.equal(snapshot.errorMessage, new CorruptProjectError().message);
		assert.equal(snapshot.pageId, '');
		assert.deepEqual(snapshot.frames, []);
	}
});

test('a resolved fresh page with no manifest is an empty snapshot of that page', async () => {
	host.manifestExists = false;
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, undefined);
	assert.deepEqual(snapshot.frames, []);
});

test('the manifest gate checks the resolved page, not a fixed one', async () => {
	await readActiveArtboardFromDisk(args);
	const [gated] = vi.mocked(fileExists).mock.calls[0] ?? [];
	assert.equal(typeof gated, 'string');
	assert.ok(String(gated).includes('page-2'));
});

test('a missing manifest creates the default artboard on Open and never on the refresh', async () => {
	host.manifestExists = false;
	await readActiveArtboardFromDisk(args);
	assert.equal(vi.mocked(createArtboard).mock.calls.length, 0);
	const snapshot = await initAndLoadArtboard(args);
	assert.equal(vi.mocked(createArtboard).mock.calls.length, 1);
	assert.equal(vi.mocked(createArtboard).mock.calls[0]?.[0].page.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, undefined);
});

test('a read failure after the resolve keeps the resolved page id', async () => {
	vi.mocked(readCanvasView).mockRejectedValueOnce(new DiskError('Could not read canvas.json.'));
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, 'Could not read canvas.json.');
	assert.equal(vi.mocked(logDiskError).mock.calls.length, 1);
});

test('a good read carries the resolved page id', async () => {
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.equal(snapshot.pageId, 'page-2');
});
