import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { CorruptProjectError, DiskError, PageNotFoundError } from '../disk/errors';
import {
	DEFAULT_ARTBOARD_ID,
	artboardHtmlPathSegments,
	artboardsDirSegments,
	manifestPathSegments,
} from '../disk/layout';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { PAGE_GONE_MESSAGE } from './panelRequestCopy';
import {
	initAndLoadArtboard,
	placeFrameFromChrome,
	readActiveArtboardFromDisk,
} from './artboardDisk';

const host = vi.hoisted(() => ({ manifestExists: true, isTrusted: true }));

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
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
}));
vi.mock('../disk/canvasView', () => ({
	readCanvasView: vi.fn(() =>
		Promise.resolve({ activeArtboardId: '', frames: [], handoffStale: false }),
	),
}));

const { resolveOpenPage, resolveRequestedPage } = await import('../disk/openPage');
const { createArtboard, placeFrame, setActiveArtboard } = await import('../disk/artboardFs');
const { readCanvasView } = await import('../disk/canvasView');
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
	host.isTrusted = true;
	vi.clearAllMocks();
});

const createIfFreshFlags = (): unknown[] =>
	vi.mocked(resolveOpenPage).mock.calls.map(([call]) => call.createIfFresh);

test('Open resolves with createIfFresh; the refresh does not', async () => {
	await initAndLoadArtboard(args);
	assert.deepEqual(createIfFreshFlags(), [true]);
	vi.mocked(resolveOpenPage).mockClear();
	await readActiveArtboardFromDisk(args);
	assert.deepEqual(createIfFreshFlags(), [false]);
});

test("a frame:place for page-1 while page-2 is open places on page-1's location", async () => {
	const pageOne = { workspaceRoot: '/ws', pageId: 'page-1' };
	vi.mocked(resolveRequestedPage).mockResolvedValueOnce(pageOne);
	const result = await placeFrameFromChrome({ value: framePlace, outputChannel });
	assert.deepEqual(vi.mocked(resolveRequestedPage).mock.calls, [
		[{ workspaceRoot: '/ws', pageId: 'page-1' }],
	]);
	assert.deepEqual(vi.mocked(placeFrame).mock.calls[0]?.[0], {
		page: pageOne,
		id: 'hero',
		x: 10,
		y: 20,
		width: 400,
		base: { x: 0, y: 0, width: 400 },
	});
	assert.equal(result, undefined);
});

test('a frame:place for a gone page returns the page copy', async () => {
	vi.mocked(resolveRequestedPage).mockRejectedValueOnce(new PageNotFoundError('page-1'));
	const result = await placeFrameFromChrome({ value: framePlace, outputChannel });
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
	assert.equal(result, PAGE_GONE_MESSAGE);
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

// The resolver can migrate or create files, so an untrusted folder never reaches it.
test('an untrusted Open, refresh or frame:place touches no page', async () => {
	host.isTrusted = false;
	for (const snapshot of [
		await initAndLoadArtboard(args),
		await readActiveArtboardFromDisk(args),
	]) {
		assert.equal(snapshot.errorMessage, UNTRUSTED_WORKSPACE_MESSAGE);
	}
	assert.equal(
		await placeFrameFromChrome({ value: framePlace, outputChannel }),
		UNTRUSTED_WORKSPACE_MESSAGE,
	);
	assert.equal(vi.mocked(resolveOpenPage).mock.calls.length, 0);
	assert.equal(vi.mocked(resolveRequestedPage).mock.calls.length, 0);
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
});

test('a malformed frame:place places nothing and answers the move copy', async () => {
	const result = await placeFrameFromChrome({
		value: { ...framePlace, x: 'far' },
		outputChannel,
	});
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
	assert.equal(result, 'Could not move the frame. Try again.');
});

test('Open on a page with artboard.html but no manifest keeps its bytes and makes it active', async () => {
	const actual = await vi.importActual<typeof import('../disk/artboardFs')>('../disk/artboardFs');
	vi.mocked(createArtboard).mockImplementationOnce(actual.createArtboard);
	vi.mocked(setActiveArtboard).mockImplementationOnce(actual.setActiveArtboard);
	host.manifestExists = false;
	const root = await mkdtemp(join(tmpdir(), 'cursor-design-artboard-disk-'));
	try {
		await mkdir(join(root, ...artboardsDirSegments('page-2')), { recursive: true });
		const htmlPath = join(root, ...artboardHtmlPathSegments('page-2', DEFAULT_ARTBOARD_ID));
		await writeFile(htmlPath, '<p>mine</p>');
		const snapshot = await initAndLoadArtboard({
			workspaceFolder: { uri: { fsPath: root } } as vscode.WorkspaceFolder,
			outputChannel,
		});
		assert.equal(snapshot.errorMessage, undefined);
		assert.equal(await readFile(htmlPath, 'utf8'), '<p>mine</p>');
		const manifest = await readFile(join(root, ...manifestPathSegments('page-2')), 'utf8');
		assert.equal(JSON.parse(manifest).activeArtboardId, DEFAULT_ARTBOARD_ID);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
