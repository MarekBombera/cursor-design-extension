import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import {
	COPIED_NOT_MARKED_MESSAGE,
	NOTHING_OPEN_MESSAGE,
	PAGE_GONE_MESSAGE,
} from './panelRequestCopy';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import type { CommentView } from '../disk/commentViews';
import {
	CommentNotFoundError,
	LockTimeoutError,
	MigrationConflictError,
	PageNotFoundError,
} from '../disk/errors';
import { answerCommentRequest, postPanelComments } from './panelComments';

// Pinned values: the module keeps these private.
const MALFORMED_CHANGE_MESSAGE = 'Could not save the change. Try again.';
const COMMENT_GONE_MESSAGE = 'This comment no longer exists.';
const COPY_FAILED_MESSAGE = 'Could not copy the prompt. Check the Output panel: Cursor Design.';

// One shared, ordered log of everything the host does, so order is assertable.
const host = vi.hoisted(() => ({ isTrusted: true, calls: [] as string[], clipboard: '' }));
const writeText = vi.hoisted(() =>
	vi.fn((text: string) => {
		host.calls.push('clipboard');
		host.clipboard = text;
		return Promise.resolve();
	}),
);

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
	env: { clipboard: { writeText } },
}));
vi.mock('./hostFs', () => ({
	firstWorkspaceFolder: () => ({ uri: { fsPath: '/ws' } }),
	logDiskError: vi.fn(),
}));
vi.mock('../panel/openArtboardPanel', () => ({
	postAnswerToPanel: vi.fn((answer: { type: string }) => host.calls.push(`answer:${answer.type}`)),
	postCommentsToPanel: vi.fn(() => host.calls.push('comments:updated')),
}));
// page-1 is open; the requests below name page-2.
vi.mock('../disk/openPage', () => ({
	resolveOpenPage: vi.fn(({ workspaceRoot }: { workspaceRoot: string }) =>
		Promise.resolve({ workspaceRoot, pageId: 'page-1' }),
	),
	resolveRequestedPage: vi.fn(
		({ workspaceRoot, pageId }: { workspaceRoot: string; pageId: string }) =>
			Promise.resolve({ workspaceRoot, pageId }),
	),
}));
vi.mock('../disk/comments', () => ({
	addComment: vi.fn(() => host.calls.push('write:create')),
	replyToComment: vi.fn(() => host.calls.push('write:reply')),
	setCommentStatus: vi.fn(() => host.calls.push('write:set-status')),
	readComments: vi.fn(() => Promise.resolve([])),
	getComment: vi.fn(),
	listComments: vi.fn(),
	markCommentsSent: vi.fn(({ ids }: { ids: readonly string[] }) => {
		host.calls.push('write:sent');
		return Promise.resolve(ids.map((id) => ({ id })));
	}),
}));

const { postAnswerToPanel, postCommentsToPanel } = await import('../panel/openArtboardPanel');
const {
	addComment,
	replyToComment,
	setCommentStatus,
	getComment,
	listComments,
	markCommentsSent,
	readComments,
} = await import('../disk/comments');
const { resolveOpenPage, resolveRequestedPage } = await import('../disk/openPage');
const { logDiskError } = await import('./hostFs');

const outputChannel = {} as vscode.OutputChannel;
const answers = (): unknown[] => vi.mocked(postAnswerToPanel).mock.calls.map(([answer]) => answer);
const flushRefresh = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const create = {
	type: 'comment:create',
	requestId: 'req-1',
	pageId: 'page-2',
	frameId: 'hero',
	generation: 1,
	selector: 'h1',
	tagName: 'h1',
	text: 'Hi',
	rect: { x: 0, y: 0, width: 10, height: 10 },
	point: { x: 5, y: 5 },
	box: { width: 10, height: 10 },
	styles: {},
	isPage: false,
	body: 'Fix this',
};
const reply = {
	type: 'comment:reply',
	requestId: 'req-2',
	pageId: 'page-2',
	id: 'c-1',
	body: 'Done',
};
const setStatus = {
	type: 'comment:set-status',
	requestId: 'req-3',
	pageId: 'page-2',
	id: 'c-1',
	status: 'resolved',
};

const copy = { type: 'comment:copy', requestId: 'req-4', pageId: 'page-2', id: 'c-1' };
const copyOpen = { type: 'comment:copy-open', requestId: 'req-5', pageId: 'page-2' };

// Only the fields the prompt reads matter here; commentPrompt.test.ts pins the text.
const stored = (id: string): CommentView =>
	({
		id,
		frameId: 'hero',
		artboard: 'Hero',
		version: 1,
		selector: 'h1',
		tagName: 'h1',
		text: 'Hi',
		styles: {},
		body: 'Fix this',
		status: 'open',
	}) as CommentView;

beforeEach(() => {
	host.isTrusted = true;
	host.calls.length = 0;
	host.clipboard = '';
	vi.clearAllMocks();
	vi.mocked(getComment).mockResolvedValue(stored('c-1'));
	vi.mocked(listComments).mockResolvedValue({
		comments: [stored('c-2'), stored('c-1'), stored('c-3')],
	});
});

test('a bad requestId posts nothing and writes nothing', async () => {
	await answerCommentRequest({ value: { ...reply, requestId: 'a b' }, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, []);
});

test('an untrusted workspace posts one ui:error and writes nothing', async () => {
	host.isTrusted = false;
	await answerCommentRequest({ value: create, outputChannel });
	await flushRefresh();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-1', message: UNTRUSTED_WORKSPACE_MESSAGE },
	]);
	assert.deepEqual(host.calls, ['answer:ui:error']);
	assert.equal(vi.mocked(resolveRequestedPage).mock.calls.length, 0);
});

test('a resolver error posts one ui:error with its message and writes nothing', async () => {
	const conflict = new MigrationConflictError({ pageId: 'page-1', names: ['manifest.json'] });
	vi.mocked(resolveRequestedPage).mockRejectedValueOnce(conflict);
	await answerCommentRequest({ value: reply, outputChannel });
	await flushRefresh();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-2', message: conflict.message },
	]);
	assert.deepEqual(host.calls, ['answer:ui:error']);
	assert.deepEqual(
		vi.mocked(logDiskError).mock.calls.map(([args]) => args.error),
		[conflict],
	);
	assert.equal(vi.mocked(addComment).mock.calls.length, 0);
	assert.equal(vi.mocked(replyToComment).mock.calls.length, 0);
	assert.equal(vi.mocked(setCommentStatus).mock.calls.length, 0);
});

test('a malformed comment:reply posts one ui:error with the change copy', async () => {
	await answerCommentRequest({ value: { ...reply, body: 7 }, outputChannel });
	await flushRefresh();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-2', message: MALFORMED_CHANGE_MESSAGE },
	]);
	assert.deepEqual(host.calls, ['answer:ui:error']);
});

test('each request type answers once, before the comments:updated refresh', async () => {
	const cases = [
		[create, 'create', 'comment:added'],
		[reply, 'reply', 'comment:saved'],
		[setStatus, 'set-status', 'comment:saved'],
	] as const;
	for (const [value, write, answer] of cases) {
		host.calls.length = 0;
		await answerCommentRequest({ value, outputChannel });
		await flushRefresh();
		assert.deepEqual(host.calls, [`write:${write}`, `answer:${answer}`, 'comments:updated']);
	}
});

test('a comment that no longer exists posts one ui:error and no refresh', async () => {
	vi.mocked(replyToComment).mockRejectedValueOnce(new CommentNotFoundError());
	await answerCommentRequest({ value: reply, outputChannel });
	await flushRefresh();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-2', message: 'This comment no longer exists.' },
	]);
	assert.deepEqual(host.calls, ['answer:ui:error']);
});

test('copy writes the clipboard, then marks sent, then answers, then refreshes', async () => {
	await answerCommentRequest({ value: copy, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['clipboard', 'write:sent', 'answer:ui:copied', 'comments:updated']);
	assert.deepEqual(answers(), [{ type: 'ui:copied', requestId: 'req-4', count: 1 }]);
	assert.equal(host.clipboard.startsWith('Handle cursor-design comment c-1 only.'), true);
});

test('copy-open sends the open ids in listComments order and answers the marked count', async () => {
	vi.mocked(markCommentsSent).mockImplementationOnce(() => {
		host.calls.push('write:sent');
		// The Agent resolved c-1 between the read and the lock: 2 of 3 still open.
		return Promise.resolve([stored('c-2'), stored('c-3')]);
	});
	await answerCommentRequest({ value: copyOpen, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['clipboard', 'write:sent', 'answer:ui:copied', 'comments:updated']);
	assert.deepEqual(vi.mocked(markCommentsSent).mock.calls[0]?.[0].ids, ['c-2', 'c-1', 'c-3']);
	assert.equal(host.clipboard.includes('- c-2\n- c-1\n- c-3\n'), true);
	assert.deepEqual(answers(), [{ type: 'ui:copied', requestId: 'req-5', count: 2 }]);
});

test('a rejected clipboard write marks nothing sent and answers the copy fallback', async () => {
	writeText.mockRejectedValueOnce(new Error('denied'));
	await answerCommentRequest({ value: copy, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['answer:ui:error', 'comments:updated']);
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: COPY_FAILED_MESSAGE },
	]);
});

test('a markCommentsSent failure says the prompt was copied but not marked', async () => {
	vi.mocked(markCommentsSent).mockRejectedValueOnce(new LockTimeoutError());
	await answerCommentRequest({ value: copyOpen, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['clipboard', 'answer:ui:error', 'comments:updated']);
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-5', message: COPIED_NOT_MARKED_MESSAGE },
	]);
});

test('copy-open with nothing open copies nothing and refreshes the stale count', async () => {
	vi.mocked(listComments).mockResolvedValueOnce({ comments: [] });
	await answerCommentRequest({ value: copyOpen, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['answer:ui:error', 'comments:updated']);
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-5', message: NOTHING_OPEN_MESSAGE },
	]);
});

test('copying a comment that no longer exists answers the gone copy without a clipboard write', async () => {
	vi.mocked(getComment).mockRejectedValueOnce(new CommentNotFoundError());
	await answerCommentRequest({ value: copy, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['answer:ui:error', 'comments:updated']);
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: COMMENT_GONE_MESSAGE },
	]);
});

test('an untrusted workspace refuses a copy before the clipboard', async () => {
	host.isTrusted = false;
	await answerCommentRequest({ value: copy, outputChannel });
	await flushRefresh();
	assert.deepEqual(host.calls, ['answer:ui:error', 'comments:updated']);
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: UNTRUSTED_WORKSPACE_MESSAGE },
	]);
	assert.equal(vi.mocked(resolveRequestedPage).mock.calls.length, 0);
});

test("a request for page-2 while page-1 is open acts on page-2's location", async () => {
	const page2 = { workspaceRoot: '/ws', pageId: 'page-2' };
	for (const value of [create, reply, setStatus, copy, copyOpen]) {
		vi.mocked(resolveRequestedPage).mockResolvedValueOnce(page2);
		await answerCommentRequest({ value, outputChannel });
	}
	await flushRefresh();
	assert.deepEqual(
		vi.mocked(resolveRequestedPage).mock.calls.map(([args]) => args.pageId),
		['page-2', 'page-2', 'page-2', 'page-2', 'page-2'],
	);
	// The exact returned location, never one the handler rebuilt or re-resolved.
	for (const page of [
		vi.mocked(addComment).mock.calls[0]?.[0].page,
		vi.mocked(replyToComment).mock.calls[0]?.[0].page,
		vi.mocked(setCommentStatus).mock.calls[0]?.[0].page,
		vi.mocked(getComment).mock.calls[0]?.[0].page,
		vi.mocked(listComments).mock.calls[0]?.[0].page,
		...vi.mocked(markCommentsSent).mock.calls.map(([args]) => args.page),
	]) {
		assert.equal(page, page2);
	}
});

test('a gone page answers one ui:error with the page copy and writes nothing', async () => {
	vi.mocked(resolveRequestedPage).mockRejectedValueOnce(new PageNotFoundError('page-2'));
	await answerCommentRequest({ value: create, outputChannel });
	await flushRefresh();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-1', message: PAGE_GONE_MESSAGE },
	]);
	assert.equal(vi.mocked(addComment).mock.calls.length, 0);
});

const postedLists = (): unknown[] =>
	vi.mocked(postCommentsToPanel).mock.calls.map(([list]) => list);

test('the posted list names the resolved page, kept on a read failure, empty when nothing resolved', async () => {
	await postPanelComments({ outputChannel });
	assert.deepEqual(postedLists(), [{ pageId: 'page-1', comments: [] }]);

	vi.mocked(postCommentsToPanel).mockClear();
	vi.mocked(readComments).mockRejectedValueOnce(new LockTimeoutError());
	await postPanelComments({ outputChannel });
	assert.deepEqual(
		postedLists().map((list) => (list as { pageId: string }).pageId),
		['page-1'],
	);
	assert.equal((postedLists()[0] as { error?: string }).error !== undefined, true);

	vi.mocked(postCommentsToPanel).mockClear();
	vi.mocked(resolveOpenPage).mockRejectedValueOnce(new LockTimeoutError());
	await postPanelComments({ outputChannel });
	assert.equal((postedLists()[0] as { pageId: string }).pageId, '');

	vi.mocked(postCommentsToPanel).mockClear();
	host.isTrusted = false;
	await postPanelComments({ outputChannel });
	assert.deepEqual(postedLists(), [{ pageId: '', comments: [] }]);
});

test('a slow comment read never posts over a newer one', async () => {
	let finishOlder: (comments: []) => void = () => {};
	vi.mocked(resolveOpenPage)
		.mockResolvedValueOnce({ workspaceRoot: '/ws', pageId: 'page-old' })
		.mockResolvedValueOnce({ workspaceRoot: '/ws', pageId: 'page-new' });
	vi.mocked(readComments).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishOlder = resolve;
			}),
	);
	const older = postPanelComments({ outputChannel });
	await postPanelComments({ outputChannel });
	finishOlder([]);
	await older;
	assert.deepEqual(postedLists(), [{ pageId: 'page-new', comments: [] }]);
});
