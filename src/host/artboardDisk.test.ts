import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

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
import type { PanelPorts } from '../panel/openArtboardPanel';
import {
	initAndLoadArtboard,
	placeFrameFromChrome,
	readActiveArtboardFromDisk,
} from './artboardDisk';

const host = vi.hoisted(() => ({ isTrusted: true }));

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

const ports = {
	isTrusted: () => host.isTrusted,
	workspaceRoot: () => '/ws',
	log: vi.fn((_scope: string, _error: unknown) => {}),
	postAnswer: vi.fn(),
	postSnapshot: vi.fn(),
	postComments: vi.fn(),
	writeClipboard: vi.fn(() => Promise.resolve()),
	confirmModal: vi.fn(() => Promise.resolve(true)),
} satisfies PanelPorts;
// A fresh temp root per test holding pages/page-2/manifest.json; a test removes it for "no manifest".
let root = '';
let args = { workspaceRoot: root, ports };
const manifestPath = (): string => join(root, ...manifestPathSegments('page-2'));
const writeManifest = async (): Promise<void> => {
	await mkdir(join(root, ...pageDirSegments('page-2')), { recursive: true });
	await writeFile(manifestPath(), '{}');
};

const framePlace = {
	type: 'frame:place',
	pageId: 'page-1',
	id: 'hero',
	x: 10,
	y: 20,
	width: 400,
	base: { x: 0, y: 0, width: 400 },
};

beforeEach(async () => {
	host.isTrusted = true;
	vi.clearAllMocks();
	root = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	args = { workspaceRoot: root, ports };
	await writeManifest();
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
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
	const result = await placeFrameFromChrome({ value: framePlace, ports });
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
	const result = await placeFrameFromChrome({ value: framePlace, ports });
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
	assert.equal(result, PAGE_GONE_MESSAGE);
});

test('a rejected resolve logs once and yields the safe message with no page', async () => {
	for (const load of [initAndLoadArtboard, readActiveArtboardFromDisk]) {
		ports.log.mockClear();
		vi.mocked(resolveOpenPage).mockRejectedValueOnce(new CorruptProjectError());
		const snapshot = await load(args);
		assert.equal(ports.log.mock.calls.length, 1);
		assert.equal(snapshot.errorMessage, new CorruptProjectError().message);
		assert.equal(snapshot.pageId, '');
		assert.deepEqual(snapshot.frames, []);
	}
});

test('a resolved fresh page with no manifest is an empty snapshot of that page', async () => {
	await rm(manifestPath());
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, undefined);
	assert.deepEqual(snapshot.frames, []);
});

test('the manifest gate checks the resolved page, not a fixed one', async () => {
	await rm(manifestPath());
	await mkdir(join(root, ...pageDirSegments('page-1')), { recursive: true });
	await writeFile(join(root, ...manifestPathSegments('page-1')), '{}');
	const empty = await readActiveArtboardFromDisk(args);
	assert.equal(empty.pageId, 'page-2');
	assert.deepEqual(empty.frames, []);
	assert.equal(vi.mocked(readCanvasView).mock.calls.length, 0);
	await writeManifest();
	await readActiveArtboardFromDisk(args);
	assert.deepEqual(
		vi.mocked(readCanvasView).mock.calls.map(([call]) => call.page.pageId),
		['page-2'],
	);
});

test('a missing manifest creates the default artboard on Open and never on the refresh', async () => {
	await rm(manifestPath());
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
	assert.equal(ports.log.mock.calls.length, 1);
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
		await placeFrameFromChrome({ value: framePlace, ports }),
		UNTRUSTED_WORKSPACE_MESSAGE,
	);
	assert.equal(vi.mocked(resolveOpenPage).mock.calls.length, 0);
	assert.equal(vi.mocked(resolveRequestedPage).mock.calls.length, 0);
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
});

test('a malformed frame:place places nothing and answers the move copy', async () => {
	const result = await placeFrameFromChrome({
		value: { ...framePlace, x: 'far' },
		ports,
	});
	assert.equal(vi.mocked(placeFrame).mock.calls.length, 0);
	assert.equal(result, 'Could not move the frame. Try again.');
});

test('Open on a page with artboard.html but no manifest keeps its bytes and makes it active', async () => {
	const actual = await vi.importActual<typeof import('../disk/artboardFs')>('../disk/artboardFs');
	vi.mocked(createArtboard).mockImplementationOnce(actual.createArtboard);
	vi.mocked(setActiveArtboard).mockImplementationOnce(actual.setActiveArtboard);
	const ownRoot = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	try {
		await mkdir(join(ownRoot, ...artboardsDirSegments('page-2')), { recursive: true });
		const htmlPath = join(ownRoot, ...artboardHtmlPathSegments('page-2', DEFAULT_ARTBOARD_ID));
		await writeFile(htmlPath, '<p>mine</p>');
		const snapshot = await initAndLoadArtboard({ workspaceRoot: ownRoot, ports });
		assert.equal(snapshot.errorMessage, undefined);
		assert.equal(await readFile(htmlPath, 'utf8'), '<p>mine</p>');
		const manifest = await readFile(join(ownRoot, ...manifestPathSegments('page-2')), 'utf8');
		assert.equal(JSON.parse(manifest).activeArtboardId, DEFAULT_ARTBOARD_ID);
	} finally {
		await rm(ownRoot, { recursive: true, force: true });
	}
});

// project.json indexes page-2 (the mocked open page) but pages/page-2/ is gone.
test('an indexed open page with no folder shows the noFolder error on Open and refresh, creating nothing', async () => {
	const actual = await vi.importActual<typeof import('../disk/artboardFs')>('../disk/artboardFs');
	vi.mocked(createArtboard).mockImplementationOnce(actual.createArtboard);
	const ownRoot = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	try {
		await mkdir(join(ownRoot, '.vibeboard', 'pages'), { recursive: true });
		await writeProject(ownRoot);
		const before = await readdir(ownRoot, { recursive: true });
		const rootArgs = { workspaceRoot: ownRoot, ports };
		for (const load of [initAndLoadArtboard, readActiveArtboardFromDisk]) {
			ports.log.mockClear();
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
			assert.equal(ports.log.mock.calls.length, 1);
		}
		assert.deepEqual((await readdir(ownRoot, { recursive: true })).sort(), before.sort());
	} finally {
		await rm(ownRoot, { recursive: true, force: true });
	}
});

test('the page list rides on the frames, empty and failed snapshots of the resolved page', async () => {
	const loads: [string, () => unknown, typeof readActiveArtboardFromDisk][] = [
		['frames', () => {}, readActiveArtboardFromDisk],
		['frames on Open', () => {}, initAndLoadArtboard],
		['empty', () => rm(manifestPath()), readActiveArtboardFromDisk],
		[
			'failed',
			() => vi.mocked(readCanvasView).mockRejectedValueOnce(new DiskError('Bad canvas.json.')),
			readActiveArtboardFromDisk,
		],
	];
	for (const [name, arrange, load] of loads) {
		await writeManifest();
		vi.mocked(listPages).mockClear();
		vi.mocked(readCanvasView).mockClear();
		vi.mocked(listPages).mockResolvedValueOnce({ openPageId: 'page-2', pages: listed });
		await arrange();
		const snapshot = await load(args);
		assert.equal(snapshot.pageId, 'page-2', name);
		assert.deepEqual(snapshot.pages, listed, name);
		assert.deepEqual(vi.mocked(listPages).mock.calls, [[{ workspaceRoot: root }]], name);
		assert.equal(vi.mocked(readCanvasView).mock.calls.length, name === 'empty' ? 0 : 1, name);
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
	assert.deepEqual(ports.log.mock.calls, [['artboardDisk.listPages', error]]);
});

// Listed after the initialize: a list read before it would carry the folder's old mtime.
test('a page Open just initialized is listed with its new files time', async () => {
	const actual = await vi.importActual<typeof import('../disk/artboardFs')>('../disk/artboardFs');
	vi.mocked(createArtboard).mockImplementationOnce(actual.createArtboard);
	const ownRoot = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	try {
		await writeProject(ownRoot);
		const folder = join(ownRoot, ...pageDirSegments('page-2'));
		await mkdir(folder, { recursive: true });
		const past = new Date('2001-01-01T00:00:00.000Z');
		await utimes(folder, past, past);
		const snapshot = await initAndLoadArtboard({ workspaceRoot: ownRoot, ports });
		assert.equal(snapshot.errorMessage, undefined);
		const [pageOne, pageTwo] = snapshot.pages;
		assert.deepEqual(pageOne, { id: 'page-1', title: 'Page 1', updatedAt: null });
		assert.equal(pageTwo?.id, 'page-2');
		assert.ok(
			pageTwo.updatedAt !== null && Date.parse(pageTwo.updatedAt) > past.getTime(),
			String(pageTwo.updatedAt),
		);
	} finally {
		await rm(ownRoot, { recursive: true, force: true });
	}
});
