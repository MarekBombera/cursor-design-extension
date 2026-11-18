import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
import type { FrameRecord } from './canvasFrames';
import {
	answerAction,
	answerCopyOpen,
	canSubmitReply,
	type CommentAction,
	type CommentActions,
	closeReply,
	copyAnnouncement,
	editReply,
	keepLiveActions,
	liveRegionText,
	openReply,
	frameLabel,
	handoffCopy,
	panelItems,
	panelSummary,
	relativeTime,
	submitCopy,
	submitCopyOpen,
	submitReply,
	submitStatus,
	summaryParts,
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
	tileKind: 'empty',
	tileText: '',
	html: '<p>a</p>',
	group: undefined,
	measuredHeight: 300,
	heightReported: true,
	guard: { lastGrowth: 0, frozen: false },
	...overrides,
});

const actionsOf = (entries: Record<string, CommentAction>): CommentActions =>
	new Map(Object.entries(entries));

test('panelItems groups open and sent before resolved, each in file order, numbered over every status', () => {
	const comments = [
		comment({ id: 'r1', status: 'resolved' }),
		comment({ id: 's1', status: 'sent' }),
		comment({ id: 'o1', status: 'open' }),
		comment({ id: 'r2', status: 'resolved' }),
	];
	const items = panelItems({ comments, anchors: new Map(), frames: [frame()] });
	assert.deepEqual(
		items.unresolved.map((item) => [item.comment.id, item.number]),
		[
			['s1', 2],
			['o1', 3],
		],
	);
	assert.deepEqual(
		items.resolved.map((item) => [item.comment.id, item.number]),
		[
			['r1', 1],
			['r2', 4],
		],
	);
});

test('panelItems: a live box: null beats clean disk flags', () => {
	const anchors = applyAnchorRects({
		state: new Map(),
		frameId: 'a',
		anchors: [{ id: 'c1', box: null, visible: null }],
	});
	const [item] = panelItems({
		comments: [comment()],
		anchors,
		frames: [frame()],
	}).unresolved;
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

test('frameLabel: the label, or the id for an unknown frame or an empty label', () => {
	const frames = [frame(), frame({ id: 'blank', label: '' })];
	assert.equal(frameLabel(frames, 'a'), 'Home');
	assert.equal(frameLabel(frames, 'gone'), 'gone');
	assert.equal(frameLabel(frames, 'blank'), 'blank');
});

test('panelSummary counts open, sent and resolved', () => {
	assert.deepEqual(panelSummary([]), { open: 0, sent: 0, resolved: 0 });
	assert.deepEqual(
		panelSummary([
			comment({ id: 'o', status: 'open' }),
			comment({ id: 's', status: 'sent' }),
			comment({ id: 'r', status: 'resolved' }),
		]),
		{ open: 1, sent: 1, resolved: 1 },
	);
});

test('summaryParts: open, sent, resolved with their status icons, zero counts left out', () => {
	assert.deepEqual(summaryParts({ open: 0, sent: 0, resolved: 0 }), []);
	assert.deepEqual(summaryParts({ open: 3, sent: 0, resolved: 2 }), [
		{ text: '3 to send', icon: 'dot', tone: 'accent' },
		{ text: '2 resolved', icon: 'check', tone: 'success' },
	]);
	assert.deepEqual(summaryParts({ open: 0, sent: 1, resolved: 0 }), [
		{ text: '1 with Agent', icon: 'send', tone: 'agent' },
	]);
});

test('handoffCopy: plural and singular, nothing to send with and without a hint, and copy feedback', () => {
	assert.deepEqual(handoffCopy({ open: 3, sent: 0 }), {
		label: 'Copy 3 open comments for Agent',
		hint: 'Then paste into Cursor Agent chat.',
		disabled: false,
		copied: false,
	});
	assert.equal(handoffCopy({ open: 1, sent: 5 }).label, 'Copy 1 open comment for Agent');
	assert.deepEqual(handoffCopy({ open: 0, sent: 2 }), {
		label: 'Nothing new to send',
		hint: '2 comments are with the Agent.',
		disabled: true,
		copied: false,
	});
	assert.equal(handoffCopy({ open: 0, sent: 1 }).hint, '1 comment is with the Agent.');
	assert.deepEqual(handoffCopy({ open: 0, sent: 0 }), {
		label: 'Nothing new to send',
		hint: undefined,
		disabled: true,
		copied: false,
	});
	// Feedback wins over the open count and is never drawn disabled (submitCopyOpen ignores it).
	assert.deepEqual(handoffCopy({ open: 2, sent: 3, copied: 3 }), {
		label: 'Copied 3 comments',
		hint: 'Now paste into Cursor Agent chat.',
		disabled: false,
		copied: true,
	});
	assert.equal(handoffCopy({ open: 0, sent: 1, copied: 1 }).label, 'Copied 1 comment');
	assert.equal(handoffCopy({ open: 0, sent: 1, copied: 1 }).disabled, false);
	// "Copied 0 comments" never shows, even with comments still open.
	assert.deepEqual(handoffCopy({ open: 2, sent: 2, copied: 0 }), {
		label: 'Nothing new to send',
		hint: '2 comments are with the Agent.',
		disabled: false,
		copied: false,
	});
});
