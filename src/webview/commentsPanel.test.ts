import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { FrameRecord } from './canvasFrames';
import {
	handoffCopy,
	liveRegionText,
	panelItems,
	panelSummary,
	relativeTime,
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
	hash: '',
	canUndo: false,
	canRedo: false,
	kind: 'iframe',
	tileKind: 'empty',
	tileText: '',
	html: '<p>a</p>',
	documentHtml: '<p>a</p>',
	documentVersion: 1,
	replacedHashes: [],
	group: undefined,
	measuredHeight: 300,
	heightReported: true,
	guard: { lastGrowth: 0, frozen: false },
	...overrides,
});

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

test('liveRegionText alternates a trailing no-break space so repeats speak', () => {
	assert.equal(liveRegionText({ text: 'Reply added.', sequence: 1 }), 'Reply added.');
	assert.equal(liveRegionText({ text: 'Reply added.', sequence: 2 }), 'Reply added. ');
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
	// A copied count of 0 is no feedback: never "Copied 0 comments", never an enabled empty button.
	assert.deepEqual(handoffCopy({ open: 2, sent: 2, copied: 0 }), {
		label: 'Copy 2 open comments for Agent',
		hint: 'Then paste into Cursor Agent chat.',
		disabled: false,
		copied: false,
	});
	assert.deepEqual(handoffCopy({ open: 0, sent: 2, copied: 0 }), {
		label: 'Nothing new to send',
		hint: '2 comments are with the Agent.',
		disabled: true,
		copied: false,
	});
});
