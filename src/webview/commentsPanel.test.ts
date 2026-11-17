import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
import type { FrameRecord } from './canvasFrames';
import {
	answerAction,
	canSubmitReply,
	type CommentAction,
	type CommentActions,
	closeReply,
	editReply,
	keepLiveActions,
	liveRegionText,
	openReply,
	panelItems,
	relativeTime,
	submitReply,
	submitStatus,
	unresolvedCount,
} from './commentsPanel';
import type { PostedComment } from './hostMessages';
import { applyAnchorRects } from './pins';

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

const frame = (overrides: Partial<FrameRecord> = {}): FrameRecord => ({
	id: 'a',
	label: 'Home',
	x: 0,
	y: 0,
	width: 400,
	height: 300,
	generation: 1,
	kind: 'iframe',
	tileText: '',
	html: '<p>a</p>',
	group: undefined,
	measuredHeight: 300,
	guard: { lastGrowth: 0, frozen: false },
	...overrides,
});

const actionsOf = (entries: Record<string, CommentAction>): CommentActions =>
	new Map(Object.entries(entries));

test('panelItems groups open and sent before resolved, each in file order', () => {
	const comments = [
		comment({ id: 'r1', status: 'resolved' }),
		comment({ id: 's1', status: 'sent' }),
		comment({ id: 'o1', status: 'open' }),
		comment({ id: 'r2', status: 'resolved' }),
	];
	const items = panelItems({ comments, anchors: new Map(), frames: [frame()] });
	assert.deepEqual(
		items.unresolved.map((item) => item.comment.id),
		['s1', 'o1'],
	);
	assert.deepEqual(
		items.resolved.map((item) => item.comment.id),
		['r1', 'r2'],
	);
	assert.equal(unresolvedCount(comments), 2);
});

test('panelItems: a live box: null beats clean disk flags', () => {
	const anchors = applyAnchorRects({
		state: new Map(),
		frameId: 'a',
		anchors: [{ id: 'c1', box: null, visible: null }],
	});
	const [item] = panelItems({ comments: [comment()], anchors, frames: [frame()] }).unresolved;
	assert.equal(item?.badge, 'missing');
	assert.equal(item?.frameLabel, 'Home');
	assert.equal(item?.canJump, true);
});

test('panelItems: an absent frame, a tile or an empty label cannot jump or falls back to the id', () => {
	const comments = [
		comment({ id: 'gone', frameId: 'gone' }),
		comment({ id: 'tile', frameId: 'tile' }),
		comment({ id: 'blank', frameId: 'blank' }),
	];
	const frames = [frame({ id: 'tile', kind: 'tile' }), frame({ id: 'blank', label: '' })];
	const items = panelItems({ comments, anchors: new Map(), frames }).unresolved;
	assert.deepEqual(
		items.map(({ frameLabel, canJump }) => ({ frameLabel, canJump })),
		[
			{ frameLabel: 'gone', canJump: false },
			{ frameLabel: 'Home', canJump: false },
			{ frameLabel: 'blank', canJump: true },
		],
	);
});

test('relativeTime boundaries, a future time and an unparsable string', () => {
	const now = Date.parse('2026-11-16T12:00:00.000Z');
	const ago = (ms: number): string | undefined =>
		relativeTime({ iso: new Date(now - ms).toISOString(), now });
	assert.equal(ago(59_000), 'just now');
	assert.equal(ago(60_000), '1 minute ago');
	assert.equal(ago(24 * 3_600_000), 'yesterday');
	assert.equal(ago(-3_600_000), 'just now');
	assert.equal(relativeTime({ iso: 'not a date', now }), undefined);
});

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

test('liveRegionText alternates a trailing no-break space so repeats speak', () => {
	assert.equal(liveRegionText({ text: 'Reply added.', sequence: 1 }), 'Reply added.');
	assert.equal(liveRegionText({ text: 'Reply added.', sequence: 2 }), 'Reply added. ');
});
