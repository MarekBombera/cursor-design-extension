import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { CorruptProjectError, DiskError, PageNotFoundError } from '../disk/errors';
import {
	DEFAULT_ARTBOARD_ID,
	PROJECT_SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardsDirSegments,
	manifestPathSegments,
	pageDirSegments,
	projectPathSegments,
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
// The real reader by default; a test stubs one call.
vi.mock('../disk/pageOps', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../disk/pageOps')>();
	return { listPages: vi.fn(actual.listPages) };
});

const { resolveOpenPage, resolveRequestedPage } = await import('../disk/openPage');
const { listPages } = await import('../disk/pageOps');
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

// project.json indexing page-1 and page-2 (open), as the disk lib writes it.
const writeProject = async (root: string): Promise<void> => {
	await mkdir(join(root, '.vibeboard'), { recursive: true });
	await writeFile(
		join(root, ...projectPathSegments),
		JSON.stringify({
			version: PROJECT_SCHEMA_VERSION,
			openPageId: 'page-2',
			pages: [
				{ id: 'page-1', title: 'Page 1' },
				{ id: 'page-2', title: 'Page 2' },
			],
		}),
	);
};

const listed = [
	{ id: 'page-1', title: 'Page 1', updatedAt: '2026-11-21T10:00:00.000Z' },
	{ id: 'page-2', title: 'Checkout', updatedAt: null },
];

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
	const root = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
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

// project.json indexes page-2 (the mocked open page) but pages/page-2/ is gone.
test('an indexed open page with no folder shows the noFolder error on Open and refresh, creating nothing', async () => {
	const actual = await vi.importActual<typeof import('../disk/artboardFs')>('../disk/artboardFs');
	vi.mocked(createArtboard).mockImplementationOnce(actual.createArtboard);
	host.manifestExists = false;
	const root = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	try {
		await mkdir(join(root, '.vibeboard', 'pages'), { recursive: true });
		await writeProject(root);
		const before = await readdir(root, { recursive: true });
		const rootArgs = {
			workspaceFolder: { uri: { fsPath: root } } as vscode.WorkspaceFolder,
			outputChannel,
		};
		for (const load of [initAndLoadArtboard, readActiveArtboardFromDisk]) {
			vi.mocked(logDiskError).mockClear();
			const snapshot = await load(rootArgs);
			assert.equal(snapshot.errorMessage, new PageNotFoundError('page-2').message);
			assert.ok(snapshot.errorMessage?.includes('has no folder'));
			assert.equal(snapshot.pageId, 'page-2');
			assert.deepEqual(snapshot.frames, []);
			// The Pages menu still lists every page, so the user can leave or delete this one.
			assert.deepEqual(
				snapshot.pages.map(({ id, updatedAt }) => [id, updatedAt]),
				[
					['page-1', null],
					['page-2', null],
				],
			);
			assert.equal(vi.mocked(logDiskError).mock.calls.length, 1);
		}
		assert.deepEqual((await readdir(root, { recursive: true })).sort(), before.sort());
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('the page list rides on the frames, empty and failed snapshots of the resolved page', async () => {
	const loads: [string, () => void, typeof readActiveArtboardFromDisk][] = [
		['frames', () => {}, readActiveArtboardFromDisk],
		['frames on Open', () => {}, initAndLoadArtboard],
		['empty', () => (host.manifestExists = false), readActiveArtboardFromDisk],
		[
			'failed',
			() => vi.mocked(readCanvasView).mockRejectedValueOnce(new DiskError('Bad canvas.json.')),
			readActiveArtboardFromDisk,
		],
	];
	for (const [name, arrange, load] of loads) {
		host.manifestExists = true;
		vi.mocked(listPages).mockClear();
		vi.mocked(listPages).mockResolvedValueOnce({ openPageId: 'page-2', pages: listed });
		arrange();
		const snapshot = await load(args);
		assert.equal(snapshot.pageId, 'page-2', name);
		assert.deepEqual(snapshot.pages, listed, name);
		assert.deepEqual(vi.mocked(listPages).mock.calls, [[{ workspaceRoot: '/ws' }]], name);
	}
});

test('no resolved page lists nothing and never reads the list', async () => {
	vi.mocked(resolveOpenPage).mockRejectedValueOnce(new CorruptProjectError());
	assert.deepEqual((await readActiveArtboardFromDisk(args)).pages, []);
	host.isTrusted = false;
	assert.deepEqual((await initAndLoadArtboard(args)).pages, []);
	assert.equal(vi.mocked(listPages).mock.calls.length, 0);
});

test('a list failure is logged and lists nothing; the snapshot is unaffected', async () => {
	const error = new CorruptProjectError();
	vi.mocked(listPages).mockRejectedValueOnce(error);
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.deepEqual(snapshot.pages, []);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, undefined);
	assert.deepEqual(vi.mocked(logDiskError).mock.calls, [
		[{ scope: 'artboardDisk.listPages', error, outputChannel }],
	]);
});

// Listed after the initialize: a list read before it would carry the folder's old mtime.
test('a page Open just initialized is listed with its new files time', async () => {
	const actual = await vi.importActual<typeof import('../disk/artboardFs')>('../disk/artboardFs');
	vi.mocked(createArtboard).mockImplementationOnce(actual.createArtboard);
	host.manifestExists = false;
	const root = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	try {
		await writeProject(root);
		const folder = join(root, ...pageDirSegments('page-2'));
		await mkdir(folder, { recursive: true });
		const past = new Date('2001-01-01T00:00:00.000Z');
		await utimes(folder, past, past);
		const snapshot = await initAndLoadArtboard({
			workspaceFolder: { uri: { fsPath: root } } as vscode.WorkspaceFolder,
			outputChannel,
		});
		assert.equal(snapshot.errorMessage, undefined);
		const [pageOne, pageTwo] = snapshot.pages;
		assert.deepEqual(pageOne, { id: 'page-1', title: 'Page 1', updatedAt: null });
		assert.equal(pageTwo?.id, 'page-2');
		assert.ok(
			pageTwo.updatedAt !== null && Date.parse(pageTwo.updatedAt) > past.getTime(),
			String(pageTwo.updatedAt),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
