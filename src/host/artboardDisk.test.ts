import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import { createArtboard, placeFrame } from '../disk/artboardFs';
import {
	CorruptManifestError,
	CorruptProjectError,
	FrameMovedError,
	PageNotFoundError,
	toSafeArtboardErrorMessage,
} from '../disk/errors';
import {
	ARTBOARDS_TOMBSTONE_TEXT,
	DEFAULT_ARTBOARD_ID,
	FIRST_PAGE_ID,
	PROJECT_SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardsDirSegments,
	artboardsTombstoneSegments,
	canvasPathSegments,
	manifestPathSegments,
	pageDirSegments,
	projectPathSegments,
} from '../disk/layout';
import { readCanvasLayoutFile } from '../disk/layoutFs';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, listPages, renamePage } from '../disk/pageOps';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { PAGE_GONE_MESSAGE } from './panelRequestCopy';
import type { PanelPorts } from '../panel/openArtboardPanel';
import {
	initAndLoadArtboard,
	placeFrameFromChrome,
	readActiveArtboardFromDisk,
} from './artboardDisk';

const HERO_HTML = '<h1>Hi</h1>';
// Pinned: the module keeps it private.
const MALFORMED_FRAME_PLACE_MESSAGE = 'Could not move the frame. Try again.';

let root = '';
let trusted = true;

const createPorts = () =>
	({
		isTrusted: () => trusted,
		workspaceRoot: vi.fn((): string | undefined => root),
		log: vi.fn((_scope: string, _error: unknown) => {}),
		postAnswer: vi.fn(),
		postSnapshot: vi.fn(),
		postComments: vi.fn(),
		writeClipboard: vi.fn((_text: string) => Promise.resolve()),
		confirmModal: vi.fn((_prompt: { message: string; detail: string; action: string }) =>
			Promise.resolve(true),
		),
	}) satisfies PanelPorts;

let ports = createPorts();
let args = { workspaceRoot: root, ports };

beforeEach(async () => {
	trusted = true;
	root = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	ports = createPorts();
	args = { workspaceRoot: root, ports };
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const pageAt = (pageId: string, workspaceRoot: string = root) => ({ workspaceRoot, pageId });
const projectPath = (workspaceRoot: string = root): string =>
	join(workspaceRoot, ...projectPathSegments);
const manifestPath = (pageId: string): string => join(root, ...manifestPathSegments(pageId));
const canvasBytes = async (pageId: string): Promise<string | undefined> =>
	readFile(join(root, ...canvasPathSegments(pageId)), 'utf8').catch(() => undefined);

// page-1 holds hero; page-2 holds its default artboard plus its own hero and is the open page.
const buildTwoPages = async (workspaceRoot: string = root): Promise<void> => {
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	await createArtboard({
		page: pageAt(FIRST_PAGE_ID, workspaceRoot),
		artboardId: 'hero',
		html: HERO_HTML,
		writeEnsurePanelMarker: false,
	});
	await createPage({ workspaceRoot, writeEnsurePanelMarker: false });
	await createArtboard({
		page: pageAt('page-2', workspaceRoot),
		artboardId: 'hero',
		html: HERO_HTML,
		writeEnsurePanelMarker: false,
	});
};

// Index lost: any resolve rebuilds project.json, so an unchanged tree proves none ran.
const buildTripwire = async (workspaceRoot: string = root): Promise<void> => {
	await buildTwoPages(workspaceRoot);
	await rm(projectPath(workspaceRoot));
};

// Every entry under the root, symlinks never followed; directories listed so a new empty one counts.
const readTree = async (workspaceRoot: string = root): Promise<Record<string, string>> => {
	const tree: Record<string, string> = {};
	const walk = async (relative: string): Promise<void> => {
		for (const name of await readdir(join(workspaceRoot, relative))) {
			const entry = join(relative, name);
			const fullPath = join(workspaceRoot, entry);
			const stats = await lstat(fullPath);
			if (stats.isSymbolicLink()) {
				tree[entry] = `symlink:${await readlink(fullPath)}`;
			} else if (stats.isDirectory()) {
				tree[entry] = 'dir';
				await walk(entry);
			} else {
				tree[entry] = `file:${(await readFile(fullPath)).toString('base64')}`;
			}
		}
	};
	await walk('');
	return tree;
};

const framePlace = (overrides: Record<string, unknown> = {}) => ({
	type: 'frame:place',
	pageId: FIRST_PAGE_ID,
	id: 'hero',
	x: 10,
	y: 20,
	width: 400,
	base: { x: 50, y: 60, width: 300 },
	...overrides,
});

const placeHeroOnPageOne = async (): Promise<void> => {
	await placeFrame({ page: pageAt(FIRST_PAGE_ID), id: 'hero', x: 50, y: 60, width: 300 });
};

const loaders = [
	['artboardDisk.initAndLoad', initAndLoadArtboard],
	['artboardDisk.readActive', readActiveArtboardFromDisk],
] as const;

const logScopes = (): unknown[] => ports.log.mock.calls.map(([scope]) => scope);

// project.json indexing page-1 and page-2 (open), plus the tombstone, as the disk lib writes them
// (a resolve restores a missing tombstone, which a tree compare would count).
const writeProject = async (workspaceRoot: string): Promise<void> => {
	await mkdir(join(workspaceRoot, '.vibeboard'), { recursive: true });
	await writeFile(join(workspaceRoot, ...artboardsTombstoneSegments), ARTBOARDS_TOMBSTONE_TEXT);
	await writeFile(
		projectPath(workspaceRoot),
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

// AP3: only Open creates project.json.
test('Open creates the project and default artboard; the refresh creates nothing', async () => {
	const empty = await readActiveArtboardFromDisk(args);
	assert.equal(empty.pageId, FIRST_PAGE_ID);
	assert.equal(empty.errorMessage, undefined);
	assert.deepEqual(empty.frames, []);
	assert.deepEqual(await readdir(root), []);

	const opened = await initAndLoadArtboard(args);
	assert.ok(await lstat(projectPath()));
	assert.equal(opened.errorMessage, undefined);
	assert.deepEqual(
		opened.frames.map(({ id }) => id),
		[DEFAULT_ARTBOARD_ID],
	);
});

test("a frame:place for page-1 while page-2 is open places on page-1's canvas", async () => {
	await buildTwoPages();
	await placeHeroOnPageOne();
	// The fixture writes no canvas.json for page-2, so a misplaced write would create one.
	const pageTwoCanvas = await canvasBytes('page-2');
	const result = await placeFrameFromChrome({ value: framePlace(), ports });
	assert.equal(result, undefined);
	const stored = await readCanvasLayoutFile(pageAt(FIRST_PAGE_ID));
	const hero = stored.frames.find(({ id }) => id === 'hero');
	assert.deepEqual([hero?.x, hero?.y, hero?.width], [10, 20, 400]);
	assert.equal(await canvasBytes('page-2'), pageTwoCanvas);
});

test('a frame:place with a stale base returns the moved copy and writes nothing', async () => {
	await buildTwoPages();
	await placeHeroOnPageOne();
	const before = await canvasBytes(FIRST_PAGE_ID);
	const result = await placeFrameFromChrome({
		value: framePlace({ base: { x: 0, y: 0, width: 300 } }),
		ports,
	});
	assert.equal(result, toSafeArtboardErrorMessage(new FrameMovedError('hero')));
	assert.equal(await canvasBytes(FIRST_PAGE_ID), before);
});

test('a frame:place for a gone page returns the page copy', async () => {
	await buildTwoPages();
	const before = await readTree();
	const result = await placeFrameFromChrome({ value: framePlace({ pageId: 'page-9' }), ports });
	assert.equal(result, PAGE_GONE_MESSAGE);
	assert.deepEqual(await readTree(), before);
});

test('a corrupt project.json logs once under the loader and yields the safe message with no page', async () => {
	await buildTwoPages();
	await writeFile(projectPath(), '{');
	for (const [scope, load] of loaders) {
		ports.log.mockClear();
		const snapshot = await load(args);
		// Its own scope, never artboardDisk.listPages: an unresolved page reads no list.
		assert.deepEqual(logScopes(), [scope]);
		assert.equal(snapshot.errorMessage, new CorruptProjectError().message);
		assert.equal(snapshot.pageId, '');
		assert.deepEqual(snapshot.frames, []);
		assert.deepEqual(snapshot.pages, []);
	}
});

test('the manifest gate checks the resolved page, not a fixed one', async () => {
	await buildTwoPages();
	await rm(manifestPath('page-2'));
	const empty = await readActiveArtboardFromDisk(args);
	assert.equal(empty.pageId, 'page-2');
	assert.equal(empty.errorMessage, undefined);
	assert.deepEqual(empty.frames, []);

	await createArtboard({
		page: pageAt('page-2'),
		artboardId: 'two',
		html: HERO_HTML,
		writeEnsurePanelMarker: false,
	});
	const read = await readActiveArtboardFromDisk(args);
	assert.equal(read.pageId, 'page-2');
	assert.deepEqual(read.frames.map(({ id }) => id).sort(), [DEFAULT_ARTBOARD_ID, 'hero', 'two']);
});

test('a missing manifest makes the default artboard active on Open and creates nothing on the refresh', async () => {
	await buildTwoPages();
	await rm(manifestPath('page-2'));
	const before = await readTree();
	await readActiveArtboardFromDisk(args);
	assert.deepEqual(await readTree(), before);

	const snapshot = await initAndLoadArtboard(args);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(snapshot.errorMessage, undefined);
	assert.equal(snapshot.activeArtboardId, DEFAULT_ARTBOARD_ID);
});

test('a read failure after the resolve keeps the resolved page id', async () => {
	await buildTwoPages();
	await writeFile(manifestPath('page-2'), '{');
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(
		snapshot.errorMessage,
		toSafeArtboardErrorMessage(new CorruptManifestError({ pageId: 'page-2' })),
	);
	assert.equal(ports.log.mock.calls.length, 1);
});

// The resolver can migrate or create files, so an untrusted folder never reaches it.
test('an untrusted Open, refresh or frame:place touches no page', async () => {
	const controlRoot = await mkdtemp(join(tmpdir(), 'vibeboard-artboard-disk-'));
	try {
		await buildTripwire(controlRoot);
		await resolveOpenPage({ workspaceRoot: controlRoot, createIfFresh: false });
		assert.ok(await lstat(projectPath(controlRoot)), 'a trusted resolve trips the wire');
	} finally {
		await rm(controlRoot, { recursive: true, force: true });
	}

	await buildTripwire();
	const before = await readTree();
	trusted = false;
	for (const snapshot of [
		await initAndLoadArtboard(args),
		await readActiveArtboardFromDisk(args),
	]) {
		assert.equal(snapshot.errorMessage, UNTRUSTED_WORKSPACE_MESSAGE);
		assert.deepEqual(snapshot.pages, []);
	}
	assert.equal(
		await placeFrameFromChrome({ value: framePlace(), ports }),
		UNTRUSTED_WORKSPACE_MESSAGE,
	);
	assert.deepEqual(await readTree(), before);
});

test('a malformed frame:place places nothing and answers the move copy', async () => {
	await buildTripwire();
	const before = await readTree();
	const result = await placeFrameFromChrome({ value: framePlace({ x: 'far' }), ports });
	assert.equal(result, MALFORMED_FRAME_PLACE_MESSAGE);
	assert.deepEqual(await readTree(), before);
});

test('Open on a page with artboard.html but no manifest keeps its bytes and makes it active', async () => {
	await writeProject(root);
	await mkdir(join(root, ...artboardsDirSegments('page-2')), { recursive: true });
	const htmlPath = join(root, ...artboardHtmlPathSegments('page-2', DEFAULT_ARTBOARD_ID));
	await writeFile(htmlPath, '<p>mine</p>');
	const snapshot = await initAndLoadArtboard(args);
	assert.equal(snapshot.errorMessage, undefined);
	assert.equal(await readFile(htmlPath, 'utf8'), '<p>mine</p>');
	const manifest = await readFile(manifestPath('page-2'), 'utf8');
	assert.equal(JSON.parse(manifest).activeArtboardId, DEFAULT_ARTBOARD_ID);
});

// project.json indexes page-2 (open) but pages/page-2/ is gone.
test('an indexed open page with no folder shows the noFolder error on Open and refresh, creating nothing', async () => {
	await mkdir(join(root, '.vibeboard', 'pages'), { recursive: true });
	await writeProject(root);
	const before = await readTree();
	for (const [, load] of loaders) {
		ports.log.mockClear();
		const snapshot = await load(args);
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
	assert.deepEqual(await readTree(), before);
});

test.each([
	['frames', readActiveArtboardFromDisk],
	['frames on Open', initAndLoadArtboard],
	['empty', readActiveArtboardFromDisk],
	['failed', readActiveArtboardFromDisk],
] as const)('the page list rides on the %s snapshot of the resolved page', async (name, load) => {
	await buildTwoPages();
	await renamePage({ workspaceRoot: root, pageId: 'page-2', title: 'Checkout' });
	if (name === 'empty') {
		await rm(manifestPath('page-2'));
	}
	if (name === 'failed') {
		await writeFile(manifestPath('page-2'), '{');
	}
	const snapshot = await load(args);
	assert.equal(snapshot.pageId, 'page-2');
	assert.deepEqual(snapshot.pages, (await listPages({ workspaceRoot: root })).pages);
});

test('a list failure is logged and lists nothing; the snapshot keeps its own error', async () => {
	await buildTwoPages();
	await writeFile(manifestPath('page-2'), '{');
	// The read's log is the one write before the list: corrupt the index right then.
	ports.log.mockImplementation((scope: string) => {
		if (scope === 'artboardDisk.readActive') {
			writeFileSync(projectPath(), '{');
		}
	});
	const snapshot = await readActiveArtboardFromDisk(args);
	assert.deepEqual(snapshot.pages, []);
	assert.equal(snapshot.pageId, 'page-2');
	assert.equal(
		snapshot.errorMessage,
		toSafeArtboardErrorMessage(new CorruptManifestError({ pageId: 'page-2' })),
	);
	assert.deepEqual(logScopes(), ['artboardDisk.readActive', 'artboardDisk.listPages']);
});

// Listed after the initialize: a list read before it would carry the folder's old mtime.
test('a page Open just initialized is listed with its new files time', async () => {
	await writeProject(root);
	const folder = join(root, ...pageDirSegments('page-2'));
	await mkdir(folder, { recursive: true });
	const past = new Date('2001-01-01T00:00:00.000Z');
	await utimes(folder, past, past);
	const snapshot = await initAndLoadArtboard(args);
	assert.equal(snapshot.errorMessage, undefined);
	const [pageOne, pageTwo] = snapshot.pages;
	assert.deepEqual(pageOne, { id: 'page-1', title: 'Page 1', updatedAt: null });
	assert.equal(pageTwo?.id, 'page-2');
	assert.ok(
		pageTwo.updatedAt !== null && Date.parse(pageTwo.updatedAt) > past.getTime(),
		String(pageTwo.updatedAt),
	);
});
