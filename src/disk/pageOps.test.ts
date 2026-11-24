import assert from 'node:assert/strict';
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	unlink,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';

import { DiskError, InvalidArgsError, PageNotFoundError } from './errors';
import { hashHtml } from './hash';
import { DEFAULT_ARTBOARD_HTML } from './layout';
import { resolveOpenPage } from './openPage';
import { createPage, deletePage, listPages, openPage, renamePage } from './pageOps';
import type { WithWorkspaceLockArgs } from './workspaceLock';

// onLocked runs once an op holds the lock, before its locked work.
const lockHook = vi.hoisted(() => ({
	onLocked: undefined as ((workspaceRoot: string) => Promise<void>) | undefined,
}));

vi.mock('./workspaceLock', async (importOriginal) => {
	const original = await importOriginal<typeof import('./workspaceLock')>();
	return {
		...original,
		withWorkspaceLock: <T>(args: WithWorkspaceLockArgs<T>): Promise<T> =>
			original.withWorkspaceLock({
				...args,
				operation: async () => {
					await lockHook.onLocked?.(args.workspaceRoot);
					return args.operation();
				},
			}),
	};
});

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-page-ops-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	lockHook.onLocked = undefined;
	vi.restoreAllMocks();
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const designDir = (root: string, ...names: string[]): string =>
	join(root, '.cursor-design', ...names);

const pageDir = (root: string, pageId: string, ...names: string[]): string =>
	designDir(root, 'pages', pageId, ...names);

const readProject = async (root: string): Promise<unknown> =>
	JSON.parse(await readFile(designDir(root, 'project.json'), 'utf8')) as unknown;

const exists = async (path: string): Promise<boolean> =>
	lstat(path).then(
		() => true,
		() => false,
	);

// project.json listing `pageIds` titled "Page <n>", each with a folder holding one marker file.
const seedPages = async (root: string, pageIds: string[], openPageId: string): Promise<void> => {
	for (const pageId of pageIds) {
		await mkdir(pageDir(root, pageId), { recursive: true });
		await writeFile(pageDir(root, pageId, 'canvas.json'), `{"page":"${pageId}"}\n`);
	}
	await writeFile(
		designDir(root, 'project.json'),
		JSON.stringify({
			version: 1,
			openPageId,
			pages: pageIds.map((id) => ({ id, title: `Page ${id.slice(5)}` })),
		}),
	);
};

const unlistedMessage = (pageId: string): string =>
	`Page "${pageId}" does not exist. Call list_pages for the page ids.`;

const isUnlisted =
	(pageId: string) =>
	(error: unknown): boolean =>
		error instanceof PageNotFoundError && error.message === unlistedMessage(pageId);

const DEFAULT_HASH = hashHtml(DEFAULT_ARTBOARD_HTML);

const NOW = new Date('2026-11-24T10:00:00.000Z');

const STAMP = '20261124T100000000Z';

test('listPages on a folder with no index lists nothing and writes nothing', async () => {
	const root = await makeTempRoot();
	assert.deepEqual(await listPages({ workspaceRoot: root }), { openPageId: null, pages: [] });
	assert.deepEqual(await readdir(root), []);
});

test('listPages keeps index order; updatedAt is the newest design file, else the folder', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-3', 'page-1'], 'page-1');
	await mkdir(pageDir(root, 'page-4'));
	await writeFile(
		designDir(root, 'project.json'),
		JSON.stringify({
			version: 1,
			openPageId: 'page-1',
			pages: [
				{ id: 'page-3', title: 'Pricing' },
				{ id: 'page-1', title: 'Home' },
				{ id: 'page-4', title: 'Empty' },
			],
		}),
	);
	await mkdir(pageDir(root, 'page-1', 'artboards'));
	await writeFile(pageDir(root, 'page-1', 'artboards', 'hero.html'), '<p>hero</p>');
	const saved = new Date('2030-01-02T03:04:05.000Z');
	await utimes(pageDir(root, 'page-1', 'artboards', 'hero.html'), saved, saved);
	const folderTime = new Date('2029-05-06T07:08:09.000Z');
	await utimes(pageDir(root, 'page-4'), folderTime, folderTime);
	const listed = await listPages({ workspaceRoot: root });
	assert.equal(listed.openPageId, 'page-1');
	assert.deepEqual(
		listed.pages.map(({ id, title }) => [id, title]),
		[
			['page-3', 'Pricing'],
			['page-1', 'Home'],
			['page-4', 'Empty'],
		],
	);
	assert.equal(listed.pages[1]?.updatedAt, saved.toISOString());
	assert.equal(listed.pages[2]?.updatedAt, folderTime.toISOString());
	assert.equal(typeof listed.pages[0]?.updatedAt, 'string');

	// A stray file in artboards/ is not a design file, however new.
	await writeFile(pageDir(root, 'page-1', 'artboards', 'notes.tmp'), 'scratch');
	const stray = new Date('2031-01-01T00:00:00.000Z');
	await utimes(pageDir(root, 'page-1', 'artboards', 'notes.tmp'), stray, stray);
	const relisted = await listPages({ workspaceRoot: root });
	assert.equal(relisted.pages[1]?.updatedAt, saved.toISOString());
});

test('listPages gives updatedAt null for a missing folder and for an unreadable or symlinked page; the rest list', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2', 'page-3', 'page-4'], 'page-1');
	await rm(pageDir(root, 'page-2'), { recursive: true });
	await writeFile(pageDir(root, 'page-3', 'artboards'), 'not a folder');
	const elsewhere = await makeTempRoot();
	await writeFile(join(elsewhere, 'outside.html'), '<p>outside</p>');
	await rm(pageDir(root, 'page-4', 'artboards'), { recursive: true, force: true });
	await symlink(elsewhere, pageDir(root, 'page-4', 'artboards'));
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const { pages } = await listPages({ workspaceRoot: root });
	assert.deepEqual(
		pages.map(({ id, updatedAt }) => [id, updatedAt === null]),
		[
			['page-1', false],
			['page-2', true],
			['page-3', true],
			['page-4', true],
		],
	);
	assert.equal(stderr.mock.calls.length, 2);
});

test('createPage on a folder never opened fills page-1 with the title and the default artboard', async () => {
	const root = await makeTempRoot();
	const created = await createPage({
		workspaceRoot: root,
		title: 'Pricing',
		writeEnsurePanelMarker: false,
	});
	assert.deepEqual(created, {
		page: { id: 'page-1', title: 'Pricing' },
		artboardId: 'artboard',
		generation: 1,
		hash: DEFAULT_HASH,
	});
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-1',
		pages: [{ id: 'page-1', title: 'Pricing' }],
	});
	assert.equal(
		await readFile(pageDir(root, 'page-1', 'artboards', 'artboard.html'), 'utf8'),
		DEFAULT_ARTBOARD_HTML,
	);
	assert.deepEqual(await readdir(designDir(root, 'pages')), ['page-1']);
	assert.equal(await exists(designDir(root, '.ensure-panel')), false);
});

test('createPage next to a page-1 with a manifest appends a page, opens it, and omits to "Page <n>"', async () => {
	const root = await makeTempRoot();
	await createPage({ workspaceRoot: root, title: 'Home', writeEnsurePanelMarker: false });
	const created = await createPage({
		workspaceRoot: root,
		title: 'Checkout',
		writeEnsurePanelMarker: false,
	});
	assert.deepEqual(created, {
		page: { id: 'page-2', title: 'Checkout' },
		artboardId: 'artboard',
		generation: 1,
		hash: DEFAULT_HASH,
	});
	assert.equal(
		await readFile(pageDir(root, 'page-2', 'artboards', 'artboard.html'), 'utf8'),
		DEFAULT_ARTBOARD_HTML,
	);
	const untitled = await createPage({ workspaceRoot: root, writeEnsurePanelMarker: false });
	assert.deepEqual(untitled.page, { id: 'page-3', title: 'Page 3' });
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-3',
		pages: [
			{ id: 'page-1', title: 'Home' },
			{ id: 'page-2', title: 'Checkout' },
			{ id: 'page-3', title: 'Page 3' },
		],
	});
});

test('createPage does not adopt a page-1 the user renamed or one holding an artboard file but no manifest', async () => {
	const renamedRoot = await makeTempRoot();
	await resolveOpenPage({ workspaceRoot: renamedRoot, createIfFresh: true });
	await renamePage({ workspaceRoot: renamedRoot, pageId: 'page-1', title: 'Home' });
	const afterRename = await createPage({
		workspaceRoot: renamedRoot,
		title: 'Next',
		writeEnsurePanelMarker: false,
	});
	assert.equal(afterRename.page.id, 'page-2');
	assert.equal(await exists(pageDir(renamedRoot, 'page-1', 'manifest.json')), false);

	// An artboard file but no manifest: a set_artboard that failed after its HTML write, or the
	// host's init mid-write. It is the user's page, not a blank one.
	const filledRoot = await makeTempRoot();
	await resolveOpenPage({ workspaceRoot: filledRoot, createIfFresh: true });
	await mkdir(pageDir(filledRoot, 'page-1', 'artboards'));
	await writeFile(pageDir(filledRoot, 'page-1', 'artboards', 'hero.html'), '<p>hero</p>');
	const afterFill = await createPage({
		workspaceRoot: filledRoot,
		title: 'Next',
		writeEnsurePanelMarker: false,
	});
	assert.equal(afterFill.page.id, 'page-2');
	assert.deepEqual(await readdir(pageDir(filledRoot, 'page-1', 'artboards')), ['hero.html']);
	assert.equal(await exists(pageDir(filledRoot, 'page-1', 'manifest.json')), false);
	assert.deepEqual(await readProject(filledRoot), {
		version: 1,
		openPageId: 'page-2',
		pages: [
			{ id: 'page-1', title: 'Page 1' },
			{ id: 'page-2', title: 'Next' },
		],
	});
});

test('createPage appends page-2 when the sole "Page 1" folder was deleted by hand', async () => {
	const root = await makeTempRoot();
	await resolveOpenPage({ workspaceRoot: root, createIfFresh: true });
	await rm(pageDir(root, 'page-1'), { recursive: true });
	const created = await createPage({
		workspaceRoot: root,
		title: 'Next',
		writeEnsurePanelMarker: false,
	});
	assert.deepEqual(created.page, { id: 'page-2', title: 'Next' });
	assert.equal(await exists(pageDir(root, 'page-2', 'artboards', 'artboard.html')), true);
	assert.equal(((await readProject(root)) as { openPageId: string }).openPageId, 'page-2');
});

test('createPage makes a new page when page-1 was renamed while the adoption waited for the lock', async () => {
	const root = await makeTempRoot();
	await resolveOpenPage({ workspaceRoot: root, createIfFresh: true });
	lockHook.onLocked = async (workspaceRoot) => {
		lockHook.onLocked = undefined;
		await writeFile(
			designDir(workspaceRoot, 'project.json'),
			JSON.stringify({
				version: 1,
				openPageId: 'page-1',
				pages: [{ id: 'page-1', title: 'Home' }],
			}),
		);
	};
	const created = await createPage({
		workspaceRoot: root,
		title: 'Next',
		writeEnsurePanelMarker: false,
	});
	assert.deepEqual(created.page, { id: 'page-2', title: 'Next' });
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-2',
		pages: [
			{ id: 'page-1', title: 'Home' },
			{ id: 'page-2', title: 'Next' },
		],
	});
	// The default artboard written before the lock stays in page-1 (ponytail in pageOps).
	assert.equal(await exists(pageDir(root, 'page-1', 'artboards', 'artboard.html')), true);
});

test('createPage refuses a full project with nothing written', async () => {
	const root = await makeTempRoot();
	const pageIds = Array.from({ length: 100 }, (_, index) => `page-${index + 1}`);
	await seedPages(root, pageIds, 'page-1');
	await resolveOpenPage({ workspaceRoot: root, createIfFresh: false });
	const before = await readdir(designDir(root, 'pages'));
	const projectBefore = await readFile(designDir(root, 'project.json'), 'utf8');
	await assert.rejects(
		createPage({ workspaceRoot: root, title: 'One more', writeEnsurePanelMarker: true }),
		(error: unknown) =>
			error instanceof InvalidArgsError &&
			error.message === 'A project holds at most 100 pages. Delete a page first.',
	);
	assert.deepEqual(await readdir(designDir(root, 'pages')), before);
	assert.equal(await readFile(designDir(root, 'project.json'), 'utf8'), projectBefore);
	assert.equal(await exists(designDir(root, '.ensure-panel')), false);
});

test('createPage never reuses an id: unindexed pages/ names of any kind, past 100, and deleted pages', async () => {
	const root = await makeTempRoot();
	await createPage({ workspaceRoot: root, title: 'Home', writeEnsurePanelMarker: false });
	// A file is counted too: no directory filter. It is the highest name, so a filtered scan would
	// claim page-2 instead.
	await writeFile(pageDir(root, 'page-5'), 'orphan file');
	assert.equal(
		(await createPage({ workspaceRoot: root, title: 'B', writeEnsurePanelMarker: false })).page.id,
		'page-6',
	);
	for (let pageNumber = 7; pageNumber <= 120; pageNumber += 1) {
		await mkdir(pageDir(root, `page-${pageNumber}`));
	}
	const highest = await createPage({
		workspaceRoot: root,
		title: 'C',
		writeEnsurePanelMarker: false,
	});
	assert.equal(highest.page.id, 'page-121');
	await deletePage({ workspaceRoot: root, pageId: 'page-121', now: NOW });
	for (let pageNumber = 7; pageNumber <= 120; pageNumber += 1) {
		await rm(pageDir(root, `page-${pageNumber}`), { recursive: true });
	}
	assert.deepEqual(await readdir(designDir(root, 'deleted')), [`page-121-${STAMP}`]);
	assert.equal(
		(await createPage({ workspaceRoot: root, title: 'D', writeEnsurePanelMarker: false })).page.id,
		'page-122',
	);
});

test('createPage fails with DISK_ERROR and writes no index when project.json goes missing before the lock', async () => {
	const root = await makeTempRoot();
	await createPage({ workspaceRoot: root, title: 'Home', writeEnsurePanelMarker: false });
	lockHook.onLocked = async (workspaceRoot) => {
		await unlink(designDir(workspaceRoot, 'project.json'));
	};
	await assert.rejects(
		createPage({ workspaceRoot: root, title: 'Next', writeEnsurePanelMarker: true }),
		(error: unknown) =>
			error instanceof DiskError &&
			error.message ===
				'The page list .cursor-design/project.json disappeared. Retry; cursor-design rebuilds it from the page folders.',
	);
	assert.equal(await exists(designDir(root, 'project.json')), false);
	assert.equal(await exists(designDir(root, '.ensure-panel')), false);
	// The claimed folder stays as an orphan with its default artboard.
	assert.equal(await exists(pageDir(root, 'page-2', 'artboards', 'artboard.html')), true);
});

test('createPage refuses a symlinked deleted/ before claiming a page folder', async () => {
	const root = await makeTempRoot();
	await createPage({ workspaceRoot: root, title: 'Home', writeEnsurePanelMarker: false });
	await symlink(await makeTempRoot(), designDir(root, 'deleted'));
	await assert.rejects(
		createPage({ workspaceRoot: root, title: 'Next', writeEnsurePanelMarker: false }),
		(error: unknown) =>
			error instanceof DiskError &&
			error.message === '.cursor-design/deleted must be a directory (symlinks rejected).',
	);
	assert.deepEqual(await readdir(designDir(root, 'pages')), ['page-1']);
});

test('createPage retitles and opens a claimed id an index rebuilt meanwhile already lists, even at 100 pages', async () => {
	const root = await makeTempRoot();
	const pageIds = Array.from({ length: 99 }, (_, index) => `page-${index + 1}`);
	await seedPages(root, pageIds, 'page-1');
	const rebuiltPages = [...pageIds, 'page-100'].map((id) => ({ id, title: `Page ${id.slice(5)}` }));
	// project.json was deleted after the claim; a resolve rebuilt it from the folders, page-100 included.
	lockHook.onLocked = async (workspaceRoot) => {
		await writeFile(
			designDir(workspaceRoot, 'project.json'),
			JSON.stringify({ version: 1, openPageId: 'page-1', pages: rebuiltPages }),
		);
	};
	const created = await createPage({
		workspaceRoot: root,
		title: 'Pricing',
		writeEnsurePanelMarker: false,
	});
	assert.deepEqual(created.page, { id: 'page-100', title: 'Pricing' });
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-100',
		pages: [...rebuiltPages.slice(0, 99), { id: 'page-100', title: 'Pricing' }],
	});
});

test('createPage refuses with INVALID_ARGS when another creator fills the project to 100 pages after the lock is taken', async () => {
	const root = await makeTempRoot();
	const pageIds = Array.from({ length: 99 }, (_, index) => `page-${index + 1}`);
	await seedPages(root, pageIds, 'page-1');
	lockHook.onLocked = async (workspaceRoot) => {
		lockHook.onLocked = undefined;
		await mkdir(pageDir(workspaceRoot, 'page-101'));
		await writeFile(
			designDir(workspaceRoot, 'project.json'),
			JSON.stringify({
				version: 1,
				openPageId: 'page-1',
				pages: [...pageIds, 'page-101'].map((id) => ({ id, title: `Page ${id.slice(5)}` })),
			}),
		);
	};
	await assert.rejects(
		createPage({ workspaceRoot: root, title: 'One more', writeEnsurePanelMarker: false }),
		(error: unknown) => error instanceof InvalidArgsError && error.code === 'INVALID_ARGS',
	);
	const { pages } = (await readProject(root)) as { pages: { id: string }[] };
	assert.equal(pages.length, 100);
	assert.equal(
		pages.some(({ id }) => id === 'page-100'),
		false,
	);
});

test('createPage succeeds and logs when the .ensure-panel write fails after the index write', async () => {
	const root = await makeTempRoot();
	await createPage({ workspaceRoot: root, title: 'Home', writeEnsurePanelMarker: false });
	await mkdir(designDir(root, '.ensure-panel'));
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const created = await createPage({
		workspaceRoot: root,
		title: 'Next',
		writeEnsurePanelMarker: true,
	});
	assert.deepEqual(created.page, { id: 'page-2', title: 'Next' });
	assert.equal(stderr.mock.calls.length, 1);
	assert.equal(((await readProject(root)) as { openPageId: string }).openPageId, 'page-2');
});

test('createPage writes .ensure-panel only after the index lists the page', async () => {
	const root = await makeTempRoot();
	await createPage({ workspaceRoot: root, title: 'Home', writeEnsurePanelMarker: false });
	const markerAtLock: boolean[] = [];
	lockHook.onLocked = async (workspaceRoot) => {
		markerAtLock.push(await exists(designDir(workspaceRoot, '.ensure-panel')));
	};
	await createPage({ workspaceRoot: root, title: 'Next', writeEnsurePanelMarker: true });
	assert.deepEqual(markerAtLock, [false]);
	assert.equal(await exists(designDir(root, '.ensure-panel')), true);
});

test('openPage refuses an unlisted id and a listed page with no folder', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2'], 'page-1');
	await rm(pageDir(root, 'page-2'), { recursive: true });
	await assert.rejects(openPage({ workspaceRoot: root, pageId: 'page-9' }), isUnlisted('page-9'));
	await assert.rejects(
		openPage({ workspaceRoot: root, pageId: 'page-2' }),
		(error: unknown) =>
			error instanceof PageNotFoundError &&
			error.message ===
				'Page "page-2" has no folder. Restore .cursor-design/pages/page-2/, or delete .cursor-design/project.json to rebuild the page list from the page folders.',
	);
	assert.equal(((await readProject(root)) as { openPageId: string }).openPageId, 'page-1');
});

test('openPage on a fresh folder is the unlisted PAGE_NOT_FOUND and writes nothing', async () => {
	const root = await makeTempRoot();
	await assert.rejects(openPage({ workspaceRoot: root, pageId: 'page-1' }), isUnlisted('page-1'));
	assert.deepEqual(await readdir(root), []);
});

test('openPage writes openPageId, and leaves project.json alone when the page is already open', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2'], 'page-1');
	assert.deepEqual(await openPage({ workspaceRoot: root, pageId: 'page-2' }), {
		page: { id: 'page-2', title: 'Page 2' },
	});
	assert.equal(((await readProject(root)) as { openPageId: string }).openPageId, 'page-2');
	const inode = (await lstat(designDir(root, 'project.json'))).ino;
	await openPage({ workspaceRoot: root, pageId: 'page-2' });
	assert.equal((await lstat(designDir(root, 'project.json'))).ino, inode);
});

test('renamePage retitles in place and refuses a bad id, a bad title and an unlisted id', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2'], 'page-1');
	assert.deepEqual(
		await renamePage({ workspaceRoot: root, pageId: 'page-2', title: ' Pricing ' }),
		{
			page: { id: 'page-2', title: 'Pricing' },
		},
	);
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-1',
		pages: [
			{ id: 'page-1', title: 'Page 1' },
			{ id: 'page-2', title: 'Pricing' },
		],
	});
	assert.equal(
		await readFile(pageDir(root, 'page-2', 'canvas.json'), 'utf8'),
		'{"page":"page-2"}\n',
	);
	const inode = (await lstat(designDir(root, 'project.json'))).ino;
	await renamePage({ workspaceRoot: root, pageId: 'page-2', title: 'Pricing' });
	assert.equal((await lstat(designDir(root, 'project.json'))).ino, inode);
	await assert.rejects(
		renamePage({ workspaceRoot: root, pageId: '../x', title: 'A' }),
		(error: unknown) => error instanceof InvalidArgsError && !error.message.includes('../x'),
	);
	await assert.rejects(
		renamePage({ workspaceRoot: root, pageId: 'page-2', title: 'a\nb' }),
		InvalidArgsError,
	);
	await assert.rejects(
		renamePage({ workspaceRoot: root, pageId: 'page-9', title: 'A' }),
		isUnlisted('page-9'),
	);
});

test('deletePage moves the folder to deleted/ and opens the previous neighbour, else the next', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2', 'page-3'], 'page-2');
	assert.deepEqual(await deletePage({ workspaceRoot: root, pageId: 'page-2', now: NOW }), {
		deletedPageId: 'page-2',
		openPageId: 'page-1',
	});
	assert.equal(await exists(pageDir(root, 'page-2')), false);
	assert.equal(
		await readFile(designDir(root, 'deleted', `page-2-${STAMP}`, 'canvas.json'), 'utf8'),
		'{"page":"page-2"}\n',
	);
	assert.deepEqual(await deletePage({ workspaceRoot: root, pageId: 'page-1', now: NOW }), {
		deletedPageId: 'page-1',
		openPageId: 'page-3',
	});
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-3',
		pages: [{ id: 'page-3', title: 'Page 3' }],
	});
	await assert.rejects(
		deletePage({ workspaceRoot: root, pageId: 'page-3', now: NOW }),
		(error: unknown) =>
			error instanceof InvalidArgsError && error.message === 'The last page cannot be deleted.',
	);
	await assert.rejects(
		deletePage({ workspaceRoot: root, pageId: 'page-1', now: NOW }),
		isUnlisted('page-1'),
	);
});

test('deletePage of a page that is not open keeps openPageId', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2'], 'page-1');
	assert.deepEqual(await deletePage({ workspaceRoot: root, pageId: 'page-2', now: NOW }), {
		deletedPageId: 'page-2',
		openPageId: 'page-1',
	});
});

test('deletePage refuses a file at deleted/ before changing anything', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2'], 'page-1');
	await writeFile(designDir(root, 'deleted'), 'not a folder');
	const projectBefore = await readFile(designDir(root, 'project.json'), 'utf8');
	await assert.rejects(
		deletePage({ workspaceRoot: root, pageId: 'page-2', now: NOW }),
		(error: unknown) =>
			error instanceof DiskError &&
			error.message === '.cursor-design/deleted must be a directory (symlinks rejected).',
	);
	assert.equal(await readFile(designDir(root, 'project.json'), 'utf8'), projectBefore);
	assert.equal(await exists(pageDir(root, 'page-2')), true);
});

test('deletePage succeeds when the folder move fails: the folder stays in pages/, unlisted', async () => {
	const root = await makeTempRoot();
	await seedPages(root, ['page-1', 'page-2'], 'page-1');
	await mkdir(designDir(root, 'deleted', `page-2-${STAMP}`), { recursive: true });
	await writeFile(designDir(root, 'deleted', `page-2-${STAMP}`, 'taken'), '');
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	assert.deepEqual(await deletePage({ workspaceRoot: root, pageId: 'page-2', now: NOW }), {
		deletedPageId: 'page-2',
		openPageId: 'page-1',
	});
	assert.equal(stderr.mock.calls.length, 1);
	assert.equal(await exists(pageDir(root, 'page-2', 'canvas.json')), true);
	assert.deepEqual(await readProject(root), {
		version: 1,
		openPageId: 'page-1',
		pages: [{ id: 'page-1', title: 'Page 1' }],
	});
});
