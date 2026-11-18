import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
import {
	type CommentAction,
	type CommentActions,
	answerAction,
	answerCopyOpen,
	canSubmitReply,
	closeReply,
	copyAnnouncement,
	editReply,
	keepLiveActions,
	openReply,
	submitCopy,
	submitCopyOpen,
	submitReply,
	submitStatus,
} from './commentActions';
import type { PostedComment } from './hostMessages';

const comment = (overrides: Partial<PostedComment> = {}): PostedComment => ({
	id: 'c1',
	frameId: 'a',
	selector: 'h1',
	tagName: 'h1',
	text: 'Hello',
	rect: { x: 10, y: 20, width: 100, height: 40 },
	pin: { x: 0.5, y: 0.25 },
	body: 'Make this bolder',
	isPage: false,
	status: 'open',
	createdAt: '2026-10-26T10:00:00.000Z',
	replies: [],
	stale: false,
	targetMissing: false,
	...overrides,
});

const actionsOf = (entries: Record<string, CommentAction>): CommentActions =>
	new Map(Object.entries(entries));

test('a blank, whitespace-only or over-cap reply sends nothing; exactly the cap sends', () => {
	for (const reply of ['', ' \n\t ']) {
		const actions = actionsOf({ c1: { reply } });
		const result = submitReply({ actions, id: 'c1', requestId: 'r1' });
		assert.equal(result.message, undefined);
		assert.equal(result.actions, actions);
	}
	assert.equal(canSubmitReply({ reply: 'x'.repeat(MAX_COMMENT_BODY_CHARS) }), true);
	assert.equal(canSubmitReply({ reply: 'x'.repeat(MAX_COMMENT_BODY_CHARS + 1) }), false);
	assert.equal(canSubmitReply(undefined), false);
});

test('submitReply trims the body, sets pending and clears the error', () => {
	const result = submitReply({
		actions: actionsOf({ c1: { reply: '  Bigger  ', error: 'old' } }),
		id: 'c1',
		requestId: 'r1',
	});
	assert.deepEqual(result.message, {
		type: 'comment:reply',
		requestId: 'r1',
		id: 'c1',
		body: 'Bigger',
	});
	assert.deepEqual(result.actions.get('c1'), {
		reply: '  Bigger  ',
		pending: { requestId: 'r1', kind: 'reply' },
	});
});

test('a second request while one is pending sends nothing', () => {
	const statusPending = actionsOf({
		c1: { reply: 'More', pending: { requestId: 'r1', kind: 'status', status: 'resolved' } },
	});
	assert.equal(
		submitReply({ actions: statusPending, id: 'c1', requestId: 'r2' }).message,
		undefined,
	);
	const replyPending = actionsOf({
		c1: { reply: 'More', pending: { requestId: 'r1', kind: 'reply' } },
	});
	const second = submitStatus({ actions: replyPending, comment: comment(), requestId: 'r2' });
	assert.equal(second.message, undefined);
	assert.equal(second.actions, replyPending);
});

test('submitStatus resolves open and sent, and reopens resolved', () => {
	const target = (status: PostedComment['status']): string | undefined =>
		submitStatus({ actions: new Map(), comment: comment({ status }), requestId: 'r1' }).message
			?.status;
	assert.equal(target('open'), 'resolved');
	assert.equal(target('sent'), 'resolved');
	assert.equal(target('resolved'), 'open');
});

test('a matching comment:saved empties the composer and keeps it open', () => {
	const result = answerAction({
		actions: actionsOf({ c1: { reply: 'Bigger', pending: { requestId: 'r1', kind: 'reply' } } }),
		answer: { type: 'comment:saved', requestId: 'r1' },
	});
	assert.deepEqual(result.actions.get('c1'), { reply: '' });
	assert.equal(result.announcement, 'Reply added.');
});

test('a matching comment:saved for status announces resolved or reopened and drops the entry', () => {
	const answer = (status: 'open' | 'resolved'): ReturnType<typeof answerAction> =>
		answerAction({
			actions: actionsOf({ c1: { pending: { requestId: 'r1', kind: 'status', status } } }),
			answer: { type: 'comment:saved', requestId: 'r1' },
		});
	assert.equal(answer('resolved').announcement, 'Comment resolved.');
	assert.equal(answer('open').announcement, 'Comment reopened.');
	assert.equal(answer('open').actions.has('c1'), false);
});

test('a matching ui:error keeps the reply text, sets the error and announces it', () => {
	const result = answerAction({
		actions: actionsOf({ c1: { reply: 'Bigger', pending: { requestId: 'r1', kind: 'reply' } } }),
		answer: { type: 'ui:error', requestId: 'r1', message: 'This comment no longer exists.' },
	});
	assert.deepEqual(result.actions.get('c1'), {
		reply: 'Bigger',
		error: 'This comment no longer exists.',
	});
	assert.equal(result.announcement, 'This comment no longer exists.');
});

test('a non-matching answer, or a ui:error without requestId, returns the same object', () => {
	const actions = actionsOf({
		c1: { reply: 'Bigger', pending: { requestId: 'r1', kind: 'reply' } },
	});
	for (const answer of [
		{ type: 'comment:saved', requestId: 'other' } as const,
		{ type: 'ui:error', message: 'Nope' } as const,
	]) {
		const result = answerAction({ actions, answer });
		assert.equal(result.actions, actions);
		assert.equal(result.announcement, undefined);
	}
});

test('closeReply: no change while a reply is pending; closes while only a status is pending', () => {
	const replyPending = actionsOf({
		c1: { reply: 'x', pending: { requestId: 'r1', kind: 'reply' } },
	});
	assert.equal(closeReply({ actions: replyPending, id: 'c1' }), replyPending);
	const pending = { requestId: 'r1', kind: 'status', status: 'resolved' } as const;
	const closed = closeReply({
		actions: actionsOf({ c1: { reply: 'x', error: 'old', pending } }),
		id: 'c1',
	});
	assert.deepEqual(closed.get('c1'), { pending });
	assert.equal(
		closeReply({ actions: actionsOf({ c1: { reply: 'x' } }), id: 'c1' }).has('c1'),
		false,
	);
});

test('openReply keeps open text, and editReply is ignored while a reply is pending', () => {
	const open = actionsOf({ c1: { reply: 'typed' } });
	assert.equal(openReply({ actions: open, id: 'c1' }), open);
	assert.deepEqual(openReply({ actions: new Map(), id: 'c1' }).get('c1'), { reply: '' });
	const pending = actionsOf({ c1: { reply: 'x', pending: { requestId: 'r1', kind: 'reply' } } });
	assert.equal(editReply({ actions: pending, id: 'c1', text: 'y' }), pending);
	assert.deepEqual(editReply({ actions: open, id: 'c1', text: 'y' }).get('c1'), { reply: 'y' });
});

test('keepLiveActions drops unlisted ids and keeps everything on an update with error', () => {
	const actions = actionsOf({ c1: { reply: 'keep' }, gone: { reply: 'drop' } });
	const kept = keepLiveActions({ actions, comments: [comment()], error: undefined });
	assert.deepEqual([...kept.keys()], ['c1']);
	assert.equal(keepLiveActions({ actions, comments: [], error: 'Could not read' }), actions);
	const listed = actionsOf({ c1: { reply: 'keep' } });
	assert.equal(
		keepLiveActions({ actions: listed, comments: [comment()], error: undefined }),
		listed,
	);
});

test('one copy at a time: a pending card copy or batch blocks every other copy', () => {
	const cardPending = actionsOf({ a: { pending: { requestId: 'r1', kind: 'copy' } } });
	const onB = submitCopy({ actions: cardPending, copyOpen: {}, id: 'b', requestId: 'r2' });
	assert.equal(onB.message, undefined);
	assert.equal(onB.actions, cardPending);
	const batch = submitCopyOpen({
		actions: cardPending,
		copyOpen: {},
		openCount: 2,
		copiedShowing: false,
		requestId: 'r2',
	});
	assert.equal(batch.message, undefined);
	assert.equal(
		submitCopy({ actions: new Map(), copyOpen: { pending: 'r0' }, id: 'b', requestId: 'r2' })
			.message,
		undefined,
	);
	assert.equal(
		submitCopyOpen({
			actions: new Map(),
			copyOpen: { pending: 'r0' },
			openCount: 2,
			copiedShowing: false,
			requestId: 'r2',
		}).message,
		undefined,
	);
});

test('a click on the Copied feedback copies nothing; the same click after it sends', () => {
	const click = (copiedShowing: boolean) =>
		submitCopyOpen({
			actions: new Map(),
			copyOpen: {},
			openCount: 2,
			copiedShowing,
			requestId: 'r1',
		});
	assert.equal(click(true).message, undefined);
	assert.deepEqual(click(true).copyOpen, {});
	assert.deepEqual(click(false).message, { type: 'comment:copy-open', requestId: 'r1' });
});

test('copy waits for a status request on the same comment; batch sends nothing with zero open', () => {
	const statusPending = actionsOf({
		c1: { pending: { requestId: 'r1', kind: 'status', status: 'resolved' } },
	});
	assert.equal(
		submitCopy({ actions: statusPending, copyOpen: {}, id: 'c1', requestId: 'r2' }).message,
		undefined,
	);
	assert.equal(
		submitCopyOpen({
			actions: new Map(),
			copyOpen: {},
			openCount: 0,
			copiedShowing: false,
			requestId: 'r2',
		}).message,
		undefined,
	);
});

test('a new copy clears the previous error and keeps the composer text', () => {
	const result = submitCopy({
		actions: actionsOf({ c1: { reply: 'Draft', error: 'Old failure' } }),
		copyOpen: {},
		id: 'c1',
		requestId: 'r1',
	});
	assert.deepEqual(result.message, { type: 'comment:copy', requestId: 'r1', id: 'c1' });
	assert.deepEqual(result.actions.get('c1'), {
		reply: 'Draft',
		pending: { requestId: 'r1', kind: 'copy' },
	});
	const batch = submitCopyOpen({
		actions: new Map(),
		copyOpen: { error: 'Old failure' },
		openCount: 1,
		copiedShowing: false,
		requestId: 'r2',
	});
	assert.deepEqual(batch.copyOpen, { pending: 'r2' });
});

test('a copy answer leaves the reply draft alone and names the copied comment', () => {
	const result = answerAction({
		actions: actionsOf({ c1: { reply: 'Draft', pending: { requestId: 'r1', kind: 'copy' } } }),
		answer: { type: 'ui:copied', requestId: 'r1', count: 1 },
	});
	assert.deepEqual(result.actions.get('c1'), { reply: 'Draft' });
	assert.equal(result.copiedId, 'c1');
	assert.equal(result.announcement, 'Prompt copied. Comment marked sent.');
});

test('an answer of the wrong kind returns the same object', () => {
	const copying = actionsOf({ c1: { pending: { requestId: 'r1', kind: 'copy' } } });
	assert.equal(
		answerAction({ actions: copying, answer: { type: 'comment:saved', requestId: 'r1' } }).actions,
		copying,
	);
	const replying = actionsOf({ c1: { reply: 'x', pending: { requestId: 'r1', kind: 'reply' } } });
	const misfit = answerAction({
		actions: replying,
		answer: { type: 'ui:copied', requestId: 'r1', count: 1 },
	});
	assert.equal(misfit.actions, replying);
	assert.equal(misfit.copiedId, undefined);
});

test('answerCopyOpen: success copies with its count, an error is kept and announced, a stranger changes nothing', () => {
	const state = { pending: 'r1' };
	const copied = answerCopyOpen({
		state,
		answer: { type: 'ui:copied', requestId: 'r1', count: 3 },
	});
	assert.deepEqual(copied, {
		state: {},
		announcement: 'Prompt copied. 3 comments marked sent.',
		copiedCount: 3,
	});
	const failed = answerCopyOpen({
		state,
		answer: { type: 'ui:error', requestId: 'r1', message: 'Busy' },
	});
	assert.deepEqual(failed, { state: { error: 'Busy' }, announcement: 'Busy' });
	const stranger = answerCopyOpen({
		state,
		answer: { type: 'ui:copied', requestId: 'r9', count: 1 },
	});
	assert.equal(stranger.state, state);
	assert.equal(stranger.copiedCount, undefined);
	// Nothing marked sent: announced, but no Copied feedback.
	assert.deepEqual(
		answerCopyOpen({ state, answer: { type: 'ui:copied', requestId: 'r1', count: 0 } }),
		{ state: {}, announcement: 'Prompt copied.' },
	);
});

test('copyAnnouncement for single 0 and 1, batch 0, 1 and 3', () => {
	assert.equal(copyAnnouncement({ kind: 'single', count: 0 }), 'Prompt copied.');
	assert.equal(
		copyAnnouncement({ kind: 'single', count: 1 }),
		'Prompt copied. Comment marked sent.',
	);
	assert.equal(copyAnnouncement({ kind: 'batch', count: 0 }), 'Prompt copied.');
	assert.equal(
		copyAnnouncement({ kind: 'batch', count: 1 }),
		'Prompt copied. 1 comment marked sent.',
	);
	assert.equal(
		copyAnnouncement({ kind: 'batch', count: 3 }),
		'Prompt copied. 3 comments marked sent.',
	);
});
