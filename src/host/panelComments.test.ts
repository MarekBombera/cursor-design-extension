import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	readlink,
	rm,
	unlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import {
	COPIED_NOT_MARKED_MESSAGE,
	NOTHING_OPEN_MESSAGE,
	PAGE_GONE_MESSAGE,
} from './panelRequestCopy';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { createArtboard, readArtboard } from '../disk/artboardFs';
import { addComment, resolveComment } from '../disk/comments';
import type { CommentsFile } from '../disk/commentsFile';
import { MigrationConflictError } from '../disk/errors';
import {
	FIRST_PAGE_ID,
	artboardsTombstoneSegments,
	commentsPathSegments,
	projectPathSegments,
} from '../disk/layout';
import type { PageLocation } from '../disk/layoutFs';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, openPage } from '../disk/pageOps';
import { withWorkspaceLock } from '../disk/workspaceLock';
import { answerCommentRequest, postPanelComments } from './panelComments';
import type { PanelPorts } from '../panel/openArtboardPanel';
import type { CommentsUpdatedMessage } from '../webview/hostMessages';

// Pinned values: the module keeps these private.
const MALFORMED_CHANGE_MESSAGE = 'Could not save the change. Try again.';
const COMMENT_GONE_MESSAGE = 'This comment no longer exists.';
const COPY_FAILED_MESSAGE = 'Could not copy the prompt. Check the Output panel: Vibeboard.';

// End to end over a real temp workspace: only the ports are faked. page-1 is open; the requests
// name page-2.

const HTML = '<h1>Hi</h1>';
const SECOND_PAGE_ID = 'page-2';

type PostedList = Omit<CommentsUpdatedMessage, 'type'>;

let root = '';
let trusted = true;
// One ordered log of what the host does, so order is assertable.
let calls: string[] = [];
let clipboard = '';

const makePorts = () =>
	({
		isTrusted: () => trusted,
		workspaceRoot: vi.fn((): string | undefined => root),
		log: vi.fn((_scope: string, _error: unknown) => {}),
		postAnswer: vi.fn((answer: { type: string }) => {
			calls.push(`answer:${answer.type}`);
		}),
		postSnapshot: vi.fn(),
		postComments: vi.fn((_list: PostedList) => {
			calls.push('comments');
		}),
		writeClipboard: vi.fn((text: string) => {
			calls.push('clipboard');
			clipboard = text;
			return Promise.resolve();
		}),
		confirmModal: vi.fn(() => Promise.resolve(true)),
	}) satisfies PanelPorts;

let ports = makePorts();

const answers = (): unknown[] => ports.postAnswer.mock.calls.map(([answer]) => answer);
const postedLists = (): PostedList[] => ports.postComments.mock.calls.map(([list]) => list);

const waitForComments = (count: number): Promise<void> =>
	vi.waitFor(
		() => {
			assert.equal(ports.postComments.mock.calls.length, count);
		},
		{ timeout: 5000 },
	);

const pageAt = (workspaceRoot: string, pageId: string): PageLocation => ({
	workspaceRoot,
	pageId,
});

// The two-page fixture, steps 1-4 of the spec (page-2 is open after them).
const buildPages = async (workspaceRoot: string): Promise<void> => {
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	await createArtboard({
		page: pageAt(workspaceRoot, FIRST_PAGE_ID),
		artboardId: 'hero',
		html: HTML,
		writeEnsurePanelMarker: false,
	});
	await createPage({ workspaceRoot, writeEnsurePanelMarker: false });
	await createArtboard({
		page: pageAt(workspaceRoot, SECOND_PAGE_ID),
		artboardId: 'hero',
		html: HTML,
		writeEnsurePanelMarker: false,
	});
};

const buildWorkspace = async (): Promise<void> => {
	await buildPages(root);
	await openPage({ workspaceRoot: root, pageId: FIRST_PAGE_ID });
};

// Index lost: any resolve rebuilds project.json, so a byte-identical tree proves none ran.
const buildTripwire = async (workspaceRoot: string): Promise<void> => {
	await buildPages(workspaceRoot);
	await unlink(join(workspaceRoot, ...projectPathSegments));
};

// Every entry under the root: relative path to file bytes, directories and symlinks listed too.
const readTree = async (workspaceRoot: string): Promise<Record<string, string>> => {
	const tree: Record<string, string> = {};
	const walk = async (relative: string): Promise<void> => {
		for (const name of (await readdir(join(workspaceRoot, relative))).sort()) {
			const entry = join(relative, name);
			const absolute = join(workspaceRoot, entry);
			const stats = await lstat(absolute);
			if (stats.isSymbolicLink()) {
				tree[entry] = `symlink:${await readlink(absolute)}`;
			} else if (stats.isDirectory()) {
				tree[entry] = 'dir';
				await walk(entry);
			} else {
				tree[entry] = (await readFile(absolute)).toString('base64');
			}
		}
	};
	await walk('');
	return tree;
};

const commentsPath = (pageId: string): string => join(root, ...commentsPathSegments(pageId));

const readStoredComments = (pageId: string): CommentsFile['comments'] =>
	(JSON.parse(readFileSync(commentsPath(pageId), 'utf8')) as CommentsFile).comments;

const storedStatuses = (pageId: string): string[] =>
	readStoredComments(pageId).map((comment) => comment.status);

const heroGeneration = async (pageId: string): Promise<number> =>
	(await readArtboard({ page: pageAt(root, pageId), artboardId: 'hero' })).generation;

const seedComment = async (pageId: string, body = 'Fix this'): Promise<string> => {
	const comment = await addComment({
		page: pageAt(root, pageId),
		comment: {
			frameId: 'hero',
			generation: await heroGeneration(pageId),
			selector: 'h1',
			tagName: 'h1',
			text: 'Hi',
			rect: { x: 0, y: 0, width: 10, height: 10 },
			pin: { x: 0.5, y: 0.5 },
			styles: {},
			body,
			isPage: false,
		},
	});
	return comment.id;
};

// The generation always comes from page-2's hero: a request naming a gone page (page-9) has none.
const createMessage = async (requestedPageId: string) => ({
	type: 'comment:create',
	requestId: 'req-1',
	pageId: requestedPageId,
	frameId: 'hero',
	generation: await heroGeneration(SECOND_PAGE_ID),
	selector: 'h1',
	tagName: 'h1',
	text: 'Hi',
	rect: { x: 0, y: 0, width: 10, height: 10 },
	point: { x: 5, y: 5 },
	box: { width: 10, height: 10 },
	styles: {},
	isPage: false,
	body: 'Fix this',
});
const replyMessage = (id: string) => ({
	type: 'comment:reply',
	requestId: 'req-2',
	pageId: SECOND_PAGE_ID,
	id,
	body: 'Done',
});
const setStatusMessage = (id: string) => ({
	type: 'comment:set-status',
	requestId: 'req-3',
	pageId: SECOND_PAGE_ID,
	id,
	status: 'resolved',
});
const copyMessage = (id: string) => ({
	type: 'comment:copy',
	requestId: 'req-4',
	pageId: SECOND_PAGE_ID,
	id,
});
const copyOpenMessage = { type: 'comment:copy-open', requestId: 'req-5', pageId: SECOND_PAGE_ID };

beforeEach(async () => {
	trusted = true;
	calls = [];
	clipboard = '';
	ports = makePorts();
	root = await mkdtemp(join(tmpdir(), 'vibeboard-panelComments-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test('the tripwire control: a trusted resolve rebuilds the lost index', async () => {
	const tripwireRoot = await mkdtemp(join(tmpdir(), 'vibeboard-panelComments-tripwire-'));
	try {
		await buildTripwire(tripwireRoot);
		const before = await readTree(tripwireRoot);
		await resolveOpenPage({ workspaceRoot: tripwireRoot, createIfFresh: false });
		const after = await readTree(tripwireRoot);
		assert.equal(before[join(...projectPathSegments)], undefined);
		assert.notEqual(after[join(...projectPathSegments)], undefined);
	} finally {
		await rm(tripwireRoot, { recursive: true, force: true });
	}
});

test('a bad requestId posts nothing and writes nothing', async () => {
	await buildTripwire(root);
	const before = await readTree(root);
	await answerCommentRequest({
		value: { ...replyMessage('c-1'), requestId: 'a b' },
		ports,
	});
	assert.deepEqual(calls, []);
	assert.equal(ports.workspaceRoot.mock.calls.length, 0);
	assert.deepEqual(await readTree(root), before);
});

test('an untrusted workspace posts one ui:error and writes nothing', async () => {
	await buildTripwire(root);
	const value = await createMessage(SECOND_PAGE_ID);
	const before = await readTree(root);
	trusted = false;
	await answerCommentRequest({ value, ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-1', message: UNTRUSTED_WORKSPACE_MESSAGE },
	]);
	assert.deepEqual(calls, ['answer:ui:error']);
	assert.equal(ports.workspaceRoot.mock.calls.length, 0);
	assert.deepEqual(await readTree(root), before);
});

test('a resolver error posts one ui:error with its message and writes nothing', async () => {
	await buildWorkspace();
	const id = await seedComment(SECOND_PAGE_ID);
	const commentsBefore = await readFile(commentsPath(SECOND_PAGE_ID));
	// A root artboards folder next to the index: resolveOpenPage throws MigrationConflictError.
	const tombstone = join(root, ...artboardsTombstoneSegments);
	await unlink(tombstone);
	await mkdir(tombstone);
	await answerCommentRequest({ value: replyMessage(id), ports });
	const conflict = new MigrationConflictError({ pageId: FIRST_PAGE_ID, names: ['artboards'] });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-2', message: conflict.message },
	]);
	assert.equal(ports.log.mock.calls.length, 1);
	assert.equal(ports.log.mock.calls[0]?.[1] instanceof MigrationConflictError, true);
	assert.deepEqual(await readFile(commentsPath(SECOND_PAGE_ID)), commentsBefore);
});

test('a malformed comment:reply posts one ui:error with the change copy', async () => {
	await answerCommentRequest({ value: { ...replyMessage('c-1'), body: 7 }, ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-2', message: MALFORMED_CHANGE_MESSAGE },
	]);
	assert.deepEqual(calls, ['answer:ui:error']);
});

test("each request type answers once, then refreshes, and acts on the requested page's file", async () => {
	await buildWorkspace();

	await answerCommentRequest({ value: await createMessage(SECOND_PAGE_ID), ports });
	await waitForComments(1);
	assert.deepEqual(calls, ['answer:comment:added', 'comments']);
	const [created] = readStoredComments(SECOND_PAGE_ID);
	assert.notEqual(created, undefined);
	const id = created?.id ?? '';

	calls = [];
	await answerCommentRequest({ value: replyMessage(id), ports });
	await waitForComments(2);
	assert.deepEqual(calls, ['answer:comment:saved', 'comments']);

	calls = [];
	await answerCommentRequest({ value: setStatusMessage(id), ports });
	await waitForComments(3);
	assert.deepEqual(calls, ['answer:comment:saved', 'comments']);

	const stored = readStoredComments(SECOND_PAGE_ID);
	assert.deepEqual(
		stored.map((comment) => [comment.id, comment.status, comment.body]),
		[[id, 'resolved', 'Fix this']],
	);
	assert.deepEqual(
		stored[0]?.replies.map((reply) => [reply.author, reply.body]),
		[['user', 'Done']],
	);
	await assert.rejects(lstat(commentsPath(FIRST_PAGE_ID)), { code: 'ENOENT' });
});

test('a comment that no longer exists posts one ui:error', async () => {
	await buildWorkspace();
	await answerCommentRequest({ value: replyMessage('missing-comment'), ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-2', message: COMMENT_GONE_MESSAGE },
	]);
});

test('copy writes the clipboard, then marks sent, then answers, then refreshes', async () => {
	await buildWorkspace();
	const id = await seedComment(SECOND_PAGE_ID);
	const statusAtClipboard: string[] = [];
	ports.writeClipboard.mockImplementationOnce((text: string) => {
		calls.push('clipboard');
		clipboard = text;
		statusAtClipboard.push(...storedStatuses(SECOND_PAGE_ID));
		return Promise.resolve();
	});
	await answerCommentRequest({ value: copyMessage(id), ports });
	assert.deepEqual(statusAtClipboard, ['open']);
	assert.deepEqual(storedStatuses(SECOND_PAGE_ID), ['sent']);
	assert.deepEqual(answers(), [{ type: 'ui:copied', requestId: 'req-4', count: 1 }]);
	assert.equal(clipboard.startsWith(`Handle vibeboard comment ${id} only.`), true);
	await waitForComments(1);
	assert.deepEqual(calls, ['clipboard', 'answer:ui:copied', 'comments']);
});

test('copy-open sends the open ids in listComments order and answers the marked count', async () => {
	await buildWorkspace();
	const ids = [
		await seedComment(SECOND_PAGE_ID, 'First'),
		await seedComment(SECOND_PAGE_ID, 'Second'),
		await seedComment(SECOND_PAGE_ID, 'Third'),
	];
	ports.writeClipboard.mockImplementationOnce(async (text: string) => {
		calls.push('clipboard');
		clipboard = text;
		// The Agent resolves the second one between the read and the lock: 2 of 3 still open.
		await resolveComment({ page: pageAt(root, SECOND_PAGE_ID), id: ids[1] ?? '', note: 'Done' });
	});
	await answerCommentRequest({ value: copyOpenMessage, ports });
	assert.equal(clipboard.includes(`- ${ids.join('\n- ')}\n`), true);
	assert.deepEqual(answers(), [{ type: 'ui:copied', requestId: 'req-5', count: 2 }]);
	assert.deepEqual(
		readStoredComments(SECOND_PAGE_ID).map((comment) => [comment.id, comment.status]),
		[
			[ids[0], 'sent'],
			[ids[1], 'resolved'],
			[ids[2], 'sent'],
		],
	);
	await waitForComments(1);
	assert.deepEqual(calls, ['clipboard', 'answer:ui:copied', 'comments']);
});

test('a rejected clipboard write marks nothing sent and answers the copy fallback', async () => {
	await buildWorkspace();
	const id = await seedComment(SECOND_PAGE_ID);
	ports.writeClipboard.mockImplementationOnce(() => {
		calls.push('clipboard');
		return Promise.reject(new Error('denied'));
	});
	await answerCommentRequest({ value: copyMessage(id), ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: COPY_FAILED_MESSAGE },
	]);
	assert.deepEqual(storedStatuses(SECOND_PAGE_ID), ['open']);
	await waitForComments(1);
	assert.deepEqual(calls, ['clipboard', 'answer:ui:error', 'comments']);
});

test('a markCommentsSent failure says the prompt was copied but not marked', async () => {
	await buildWorkspace();
	const id = await seedComment(SECOND_PAGE_ID);
	// The handler's resolve and read are lock-free on an indexed workspace; markCommentsSent waits.
	await withWorkspaceLock({
		workspaceRoot: root,
		operation: () => answerCommentRequest({ value: copyMessage(id), ports }),
	});
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: COPIED_NOT_MARKED_MESSAGE },
	]);
	assert.deepEqual(storedStatuses(SECOND_PAGE_ID), ['open']);
	await waitForComments(1);
	assert.deepEqual(calls, ['clipboard', 'answer:ui:error', 'comments']);
}, 10_000);

test('copy-open with nothing open copies nothing and refreshes the stale count', async () => {
	await buildWorkspace();
	const id = await seedComment(SECOND_PAGE_ID);
	await resolveComment({ page: pageAt(root, SECOND_PAGE_ID), id, note: 'Done' });
	await answerCommentRequest({ value: copyOpenMessage, ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-5', message: NOTHING_OPEN_MESSAGE },
	]);
	assert.equal(ports.writeClipboard.mock.calls.length, 0);
	await waitForComments(1);
});

test('copying a comment that no longer exists answers the gone copy without a clipboard write', async () => {
	await buildWorkspace();
	await answerCommentRequest({ value: copyMessage('missing-comment'), ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: COMMENT_GONE_MESSAGE },
	]);
	assert.equal(ports.writeClipboard.mock.calls.length, 0);
	await waitForComments(1);
});

test('an untrusted workspace refuses a copy before the clipboard', async () => {
	await buildTripwire(root);
	const before = await readTree(root);
	trusted = false;
	await answerCommentRequest({ value: copyMessage('c-1'), ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: UNTRUSTED_WORKSPACE_MESSAGE },
	]);
	assert.equal(ports.writeClipboard.mock.calls.length, 0);
	await waitForComments(1);
	assert.deepEqual(postedLists(), [{ pageId: '', comments: [] }]);
	assert.deepEqual(await readTree(root), before);
});

test('a gone page answers one ui:error with the page copy and writes nothing', async () => {
	await buildWorkspace();
	const value = await createMessage('page-9');
	const before = await readTree(root);
	await answerCommentRequest({ value, ports });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-1', message: PAGE_GONE_MESSAGE },
	]);
	assert.deepEqual(await readTree(root), before);
});

test('the posted list names the open page, kept on a read failure, empty when nothing resolved', async () => {
	await buildWorkspace();
	const id = await seedComment(FIRST_PAGE_ID);
	await postPanelComments({ ports });
	assert.deepEqual(
		postedLists().map((list) => [list.pageId, list.comments.map((comment) => comment.id)]),
		[[FIRST_PAGE_ID, [id]]],
	);
	assert.equal(postedLists()[0]?.error, undefined);

	ports.postComments.mockClear();
	await writeFile(commentsPath(FIRST_PAGE_ID), '{');
	await postPanelComments({ ports });
	assert.deepEqual(
		postedLists().map((list) => [list.pageId, list.comments]),
		[[FIRST_PAGE_ID, []]],
	);
	assert.equal(typeof postedLists()[0]?.error, 'string');

	ports.postComments.mockClear();
	await writeFile(join(root, ...projectPathSegments), '{');
	await postPanelComments({ ports });
	assert.deepEqual(
		postedLists().map((list) => [list.pageId, list.comments]),
		[['', []]],
	);
	assert.equal(typeof postedLists()[0]?.error, 'string');

	ports.postComments.mockClear();
	trusted = false;
	await postPanelComments({ ports });
	assert.deepEqual(postedLists(), [{ pageId: '', comments: [] }]);
});

test('a slow comment read never posts over a newer one', async () => {
	await buildWorkspace();
	const older = postPanelComments({ ports });
	await postPanelComments({ ports });
	await older;
	assert.equal(ports.postComments.mock.calls.length, 1);
});
