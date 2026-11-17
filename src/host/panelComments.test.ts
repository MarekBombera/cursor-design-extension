import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import {
	COMMENT_GONE_MESSAGE,
	COPIED_NOT_MARKED_MESSAGE,
	COPY_FAILED_MESSAGE,
	MALFORMED_CHANGE_MESSAGE,
	NOTHING_OPEN_MESSAGE,
} from './chromeMessages';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import type { CommentView } from '../disk/comments';
import { CommentNotFoundError, LockTimeoutError } from '../disk/errors';
import { answerCommentRequest } from './panelComments';

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

const { postAnswerToPanel } = await import('../panel/openArtboardPanel');
const { replyToComment, getComment, listComments, markCommentsSent } =
	await import('../disk/comments');

const outputChannel = {} as vscode.OutputChannel;
const answers = (): unknown[] => vi.mocked(postAnswerToPanel).mock.calls.map(([answer]) => answer);
const flushRefresh = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const create = {
	type: 'comment:create',
	requestId: 'req-1',
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
const reply = { type: 'comment:reply', requestId: 'req-2', id: 'c-1', body: 'Done' };
const setStatus = { type: 'comment:set-status', requestId: 'req-3', id: 'c-1', status: 'resolved' };

const copy = { type: 'comment:copy', requestId: 'req-4', id: 'c-1' };
const copyOpen = { type: 'comment:copy-open', requestId: 'req-5' };

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
});
