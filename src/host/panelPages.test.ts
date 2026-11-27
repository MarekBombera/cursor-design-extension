import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import { type CanvasSnapshot, UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { clearEditHistories, historyEpoch, historyFlags, recordEdit } from './editHistory';
import { MALFORMED_PAGE_REQUEST_MESSAGE, PAGE_GONE_MESSAGE } from './panelRequestCopy';
import { answerPageRequest } from './panelPages';
import { createArtboard } from '../disk/artboardFs';
import { InvalidArgsError, LockTimeoutError, NoWorkspaceError } from '../disk/errors';
import { hashHtml } from '../disk/hash';
import {
	FIRST_PAGE_ID,
	deletedDirSegments,
	ensurePanelPathSegments,
	pageDirSegments,
	projectPathSegments,
} from '../disk/layout';
import { readProjectFile } from '../disk/layoutFs';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, listPages, openPage } from '../disk/pageOps';
import { withWorkspaceLock } from '../disk/workspaceLock';
import type { PanelPorts } from '../panel/openArtboardPanel';

// Pinned values: the copy module keeps these private.
const RENAME_REFUSED_MESSAGE = 'A page title needs 1 to 80 characters and no control characters.';
const LAST_PAGE_MESSAGE = 'The last page cannot be deleted.';

// End to end over a real temp workspace: only the ports are faked. Every answer starts the real
// refreshPanel, so each request waits for its snapshot and comments posts before the next one.

const PAGE_2 = 'page-2';
const HERO_HTML = '<main><h1>Hi</h1></main>\n';

const open = { type: 'page:open', requestId: 'req-1', pageId: PAGE_2 };
const create = { type: 'page:create', requestId: 'req-2' };
const rename = { type: 'page:rename', requestId: 'req-3', pageId: PAGE_2, title: 'Pricing' };
const remove = { type: 'page:delete', requestId: 'req-4', pageId: PAGE_2 };

const makeHost = (root: string) => ({
	root: root as string | undefined,
	isTrusted: true,
	confirmed: false,
	// One shared, ordered log of what the panel sees, so order is assertable.
	calls: [] as string[],
});

const makePorts = (host: ReturnType<typeof makeHost>) =>
	({
		isTrusted: () => host.isTrusted,
		workspaceRoot: vi.fn(() => host.root),
		log: vi.fn((_scope: string, _error: unknown) => {}),
		postAnswer: vi.fn((answer: { type: string }) => {
			host.calls.push(`answer:${answer.type}`);
		}),
		postSnapshot: vi.fn((snapshot: CanvasSnapshot) => {
			host.calls.push(`snapshot:${snapshot.pageId}`);
		}),
		postComments: vi.fn((_comments: { pageId: string }) => {
			host.calls.push('comments');
		}),
		writeClipboard: vi.fn(() => Promise.resolve()),
		confirmModal: vi.fn((_prompt: { message: string; detail: string; action: string }) => {
			host.calls.push('modal');
			return Promise.resolve(host.confirmed);
		}),
	}) satisfies PanelPorts;

let root = '';
let host = makeHost(root);
let ports = makePorts(host);

const answers = (): unknown[] => ports.postAnswer.mock.calls.map(([answer]) => answer);

const waitForCalls = (fake: { mock: { calls: unknown[] } }, count: number): Promise<void> =>
	vi.waitFor(
		() => {
			assert.equal(fake.mock.calls.length, count);
		},
		{ timeout: 5000 },
	);

// The refresh every answer starts posts a snapshot, then the comments.
const waitForRefreshes = async (count: number): Promise<void> => {
	await waitForCalls(ports.postSnapshot, count);
	await waitForCalls(ports.postComments, count);
};

const send = async (value: unknown): Promise<void> => {
	const before = ports.postComments.mock.calls.length;
	await answerPageRequest({ value, ports });
	await waitForRefreshes(before + 1);
};

// Every entry under the root: relative path to bytes; directories listed so a new empty one counts.
// lstat only: a symlink is recorded as its target text, never followed.
const readTree = async (dir: string, prefix = ''): Promise<Record<string, string>> => {
	const tree: Record<string, string> = {};
	for (const name of (await readdir(dir)).sort()) {
		const path = join(dir, name);
		const relative = `${prefix}${name}`;
		const stats = await lstat(path);
		if (stats.isSymbolicLink()) {
			tree[relative] = `symlink:${await readlink(path)}`;
		} else if (stats.isDirectory()) {
			tree[`${relative}/`] = 'dir';
			Object.assign(tree, await readTree(path, `${relative}/`));
		} else {
			tree[relative] = (await readFile(path)).toString('base64');
		}
	}
	return tree;
};

const exists = (workspaceRoot: string, segments: readonly string[]): Promise<boolean> =>
	lstat(join(workspaceRoot, ...segments)).then(
		() => true,
		() => false,
	);

// page-1 and page-2, each with a hero artboard; page-2 is open unless reopenFirst.
const buildTwoPages = async (workspaceRoot: string, reopenFirst = true): Promise<void> => {
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: HERO_HTML,
		writeEnsurePanelMarker: false,
	});
	const created = await createPage({ workspaceRoot, writeEnsurePanelMarker: false });
	assert.equal(created.page.id, PAGE_2);
	await createArtboard({
		page: { workspaceRoot, pageId: created.page.id },
		artboardId: 'hero',
		html: HERO_HTML,
		writeEnsurePanelMarker: false,
	});
	if (reopenFirst) {
		await openPage({ workspaceRoot, pageId: FIRST_PAGE_ID });
	}
};

// Index lost: any resolve rebuilds project.json, so a byte-identical tree proves none ran.
const buildTripwire = async (workspaceRoot: string): Promise<void> => {
	await buildTwoPages(workspaceRoot, false);
	await rm(join(workspaceRoot, ...projectPathSegments));
};

const withSecondRoot = async (run: (workspaceRoot: string) => Promise<void>): Promise<void> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-panelPages-'));
	try {
		await run(workspaceRoot);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
};

const editFrame = (pageId: string): void => {
	const entry = (html: string): { html: string; hash: string } => ({ html, hash: hashHtml(html) });
	recordEdit({
		pageId,
		frameId: 'hero',
		base: entry('a'),
		next: entry('b'),
		epoch: historyEpoch(),
	});
};

beforeEach(async () => {
	clearEditHistories();
	root = await mkdtemp(join(tmpdir(), 'vibeboard-panelPages-'));
	host = makeHost(root);
	ports = makePorts(host);
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test('the tripwire holds: a trusted resolve on an index-lost workspace writes project.json', async () => {
	await withSecondRoot(async (workspaceRoot) => {
		await buildTripwire(workspaceRoot);
		assert.equal(await exists(workspaceRoot, projectPathSegments), false);
		await resolveOpenPage({ workspaceRoot, createIfFresh: false });
		assert.equal(await exists(workspaceRoot, projectPathSegments), true);
	});
});

test.each([
	{
		value: open,
		check: async () => {
			assert.equal((await readProjectFile(root))?.openPageId, PAGE_2);
			return PAGE_2;
		},
	},
	{
		value: create,
		check: async () => {
			const project = await readProjectFile(root);
			assert.equal(await exists(root, pageDirSegments('page-3')), true);
			assert.deepEqual(
				project?.pages.map(({ id }) => id),
				[FIRST_PAGE_ID, PAGE_2, 'page-3'],
			);
			assert.equal(project?.openPageId, 'page-3');
			assert.equal(await exists(root, ensurePanelPathSegments), false);
			return 'page-3';
		},
	},
	{
		value: rename,
		check: async () => {
			const project = await readProjectFile(root);
			assert.equal(project?.pages.find(({ id }) => id === PAGE_2)?.title, 'Pricing');
			return FIRST_PAGE_ID;
		},
	},
	{
		value: remove,
		check: async () => {
			assert.equal(await exists(root, pageDirSegments(PAGE_2)), false);
			const deleted = await readdir(join(root, ...deletedDirSegments));
			assert.equal(deleted.filter((name) => name.startsWith(`${PAGE_2}-`)).length, 1);
			const project = await readProjectFile(root);
			assert.deepEqual(
				project?.pages.map(({ id }) => id),
				[FIRST_PAGE_ID],
			);
			return FIRST_PAGE_ID;
		},
	},
])('$value.type answers page:saved after its write, then refreshes', async ({ value, check }) => {
	await buildTwoPages(root);
	host.confirmed = true;
	await send(value);
	const snapshotPageId = await check();
	assert.deepEqual(answers(), [{ type: 'page:saved', requestId: value.requestId }]);
	assert.deepEqual(host.calls.slice(-3), [
		'answer:page:saved',
		`snapshot:${snapshotPageId}`,
		'comments',
	]);
});

test('the handler resolves before a page op: an index-lost rename rebuilds the index, then retitles', async () => {
	await buildTripwire(root);
	await send({ ...rename, pageId: FIRST_PAGE_ID });
	assert.deepEqual(answers(), [{ type: 'page:saved', requestId: 'req-3' }]);
	const project = await readProjectFile(root);
	assert.equal(project?.pages.find(({ id }) => id === FIRST_PAGE_ID)?.title, 'Pricing');
});

test('never a resolve that creates a project: a rename in a fresh root refuses and creates no index', async () => {
	await send({ ...rename, pageId: FIRST_PAGE_ID });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-3', message: PAGE_GONE_MESSAGE },
	]);
	assert.deepEqual(host.calls, ['answer:ui:error', `snapshot:${FIRST_PAGE_ID}`, 'comments']);
	// The lock may leave an empty .vibeboard/, so only the index is checked.
	assert.equal(await exists(root, projectPathSegments), false);
});

test('no usable requestId: nothing answered, the root never read, nothing written', async () => {
	await buildTripwire(root);
	const before = await readTree(root);
	for (const value of [
		{ ...rename, requestId: 'a b' },
		{ type: 'page:delete', pageId: PAGE_2 },
	]) {
		await answerPageRequest({ value, ports });
	}
	assert.deepEqual(host.calls, []);
	assert.equal(ports.workspaceRoot.mock.calls.length, 0);
	assert.deepEqual(await readTree(root), before);
});

test('untrusted and folderless requests answer ui:error, then refresh, writing nothing', async () => {
	await buildTripwire(root);
	const before = await readTree(root);
	host.isTrusted = false;
	await send(open);
	assert.deepEqual(await readTree(root), before);
	host.isTrusted = true;
	host.root = undefined;
	await send(create);
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-1', message: UNTRUSTED_WORKSPACE_MESSAGE },
		{ type: 'ui:error', requestId: 'req-2', message: new NoWorkspaceError().message },
	]);
	assert.deepEqual(host.calls, [
		'answer:ui:error',
		'snapshot:',
		'comments',
		'answer:ui:error',
		'snapshot:',
		'comments',
	]);
	assert.deepEqual(await readTree(root), before);
});

test('a malformed title or page id answers ui:error, then refreshes, writing nothing', async () => {
	await buildTwoPages(root);
	const before = await readTree(root);
	await send({ ...rename, title: 7 });
	await send({ ...remove, pageId: '../x' });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-3', message: MALFORMED_PAGE_REQUEST_MESSAGE },
		{ type: 'ui:error', requestId: 'req-4', message: MALFORMED_PAGE_REQUEST_MESSAGE },
	]);
	assert.deepEqual(
		ports.log.mock.calls.map(([scope, error]) => [scope, error instanceof InvalidArgsError]),
		[
			['panelPages.rename', true],
			['panelPages.delete', true],
		],
	);
	assert.deepEqual(await readTree(root), before);
});

test('delete of an unlisted id, with no project.json, or of the last page refuses before the modal', async () => {
	await buildTwoPages(root);
	const twoPages = await readTree(root);
	await send({ ...remove, pageId: 'page-3' });
	assert.deepEqual(await readTree(root), twoPages);

	await withSecondRoot(async (freshRoot) => {
		host.root = freshRoot;
		await send(remove);
		assert.equal(await exists(freshRoot, projectPathSegments), false);
	});

	await withSecondRoot(async (onePageRoot) => {
		await resolveOpenPage({ workspaceRoot: onePageRoot, createIfFresh: true });
		await createArtboard({
			page: { workspaceRoot: onePageRoot, pageId: FIRST_PAGE_ID },
			artboardId: 'hero',
			html: HERO_HTML,
			writeEnsurePanelMarker: false,
		});
		const onePage = await readTree(onePageRoot);
		host.root = onePageRoot;
		await send({ ...remove, pageId: FIRST_PAGE_ID });
		assert.deepEqual(await readTree(onePageRoot), onePage);
	});

	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: PAGE_GONE_MESSAGE },
		{ type: 'ui:error', requestId: 'req-4', message: PAGE_GONE_MESSAGE },
		{ type: 'ui:error', requestId: 'req-4', message: LAST_PAGE_MESSAGE },
	]);
	assert.equal(ports.confirmModal.mock.calls.length, 0);
	assert.equal(ports.postComments.mock.calls.length, 3);
});

test('a cancelled modal answers page:saved, deletes nothing and refreshes', async () => {
	await buildTwoPages(root);
	const title = (await listPages({ workspaceRoot: root })).pages.find(
		({ id }) => id === PAGE_2,
	)?.title;
	assert.equal(title, 'Page 2');
	const before = await readTree(root);
	editFrame(PAGE_2);
	await send(remove);
	assert.deepEqual(host.calls, [
		'modal',
		'answer:page:saved',
		`snapshot:${FIRST_PAGE_ID}`,
		'comments',
	]);
	assert.deepEqual(answers(), [{ type: 'page:saved', requestId: 'req-4' }]);
	assert.deepEqual(await readTree(root), before);
	assert.equal(historyFlags({ pageId: PAGE_2, frameId: 'hero' }).canUndo, true);
	assert.deepEqual(ports.confirmModal.mock.calls[0], [
		{
			message: `Delete "${title}"?`,
			detail: 'Its files move to .vibeboard/deleted/.',
			action: 'Delete',
		},
	]);
});

test("a confirmed delete deletes, forgets only that page's histories, answers page:saved", async () => {
	await buildTwoPages(root);
	host.confirmed = true;
	for (const pageId of [PAGE_2, FIRST_PAGE_ID, 'page-20']) {
		editFrame(pageId);
	}
	await send(remove);
	assert.deepEqual(answers(), [{ type: 'page:saved', requestId: 'req-4' }]);
	assert.equal(await exists(root, pageDirSegments(PAGE_2)), false);
	assert.equal(historyFlags({ pageId: PAGE_2, frameId: 'hero' }).canUndo, false);
	assert.equal(historyFlags({ pageId: FIRST_PAGE_ID, frameId: 'hero' }).canUndo, true);
	assert.equal(historyFlags({ pageId: 'page-20', frameId: 'hero' }).canUndo, true);
});

test('a busy lock answers its own copy; Agent copy never reaches the panel', async () => {
	await buildTwoPages(root);
	await withWorkspaceLock({
		workspaceRoot: root,
		operation: async () => {
			await answerPageRequest({ value: rename, ports });
		},
	});
	await waitForRefreshes(1);
	await send({ ...rename, title: '   ' });
	await send({ ...open, pageId: 'page-9' });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-3', message: new LockTimeoutError().message },
		{ type: 'ui:error', requestId: 'req-3', message: RENAME_REFUSED_MESSAGE },
		{ type: 'ui:error', requestId: 'req-1', message: PAGE_GONE_MESSAGE },
	]);
	assert.deepEqual(host.calls, [
		'answer:ui:error',
		`snapshot:${FIRST_PAGE_ID}`,
		'comments',
		'answer:ui:error',
		`snapshot:${FIRST_PAGE_ID}`,
		'comments',
		'answer:ui:error',
		`snapshot:${FIRST_PAGE_ID}`,
		'comments',
	]);
}, 10_000);
