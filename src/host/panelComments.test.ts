import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { MALFORMED_CHANGE_MESSAGE } from './chromeMessages';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { CommentNotFoundError } from '../disk/errors';
import { answerCommentRequest } from './panelComments';

// One shared, ordered log of everything the host does, so order is assertable.
const host = vi.hoisted(() => ({ isTrusted: true, calls: [] as string[] }));

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
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
}));

const { postAnswerToPanel } = await import('../panel/openArtboardPanel');
const { replyToComment } = await import('../disk/comments');

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

beforeEach(() => {
	host.isTrusted = true;
	host.calls.length = 0;
	vi.clearAllMocks();
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
