import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { FrameRecord } from './canvasFrames';
import type { PostedComment } from './hostMessages';
import {
	type AnchorState,
	anchorSends,
	applyAnchorRects,
	dropFrameAnchors,
	jumpTarget,
	keepOpenThread,
	layoutPins,
	liveAnchor,
	pinBadge,
	pinLabel,
	pinPoint,
	resolveHeldThread,
} from './pins';

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
	label: 'A',
	x: 1000,
	y: 500,
	width: 400,
	height: 300,
	generation: 1,
	hash: '',
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

const view = { x: 0, y: 0, zoom: 1 };
const box = { x: 50, y: 60, width: 200, height: 80 };

const answered = (
	frameId: string,
	id: string,
	anchor: { box: typeof box | null; visible: typeof box | null },
): AnchorState => applyAnchorRects({ state: new Map(), frameId, anchors: [{ id, ...anchor }] });

test('applyAnchorRects keeps the last duplicate and never touches another frame', () => {
	const state = applyAnchorRects({
		state: answered('b', 'c2', { box, visible: box }),
		frameId: 'a',
		anchors: [
			{ id: 'c1', box: null, visible: null },
			{ id: 'c1', box, visible: box },
			// Forged: frame A answering for frame B's comment.
			{ id: 'c2', box: { ...box, x: 0 }, visible: null },
		],
	});
	assert.deepEqual(state.get('a')?.get('c1'), { box, visible: box });
	assert.deepEqual(state.get('b')?.get('c2'), { box, visible: box });
});

test('a forged cd:anchor-rects from frame A with a frame B id moves nothing in B', () => {
	const comments = [comment({ id: 'b1', frameId: 'b' })];
	const frames = [frame({ id: 'b' })];
	const before = layoutPins({ comments, anchors: new Map(), frames, view });
	const forged = answered('a', 'b1', { box: { x: 0, y: 0, width: 1, height: 1 }, visible: null });
	assert.deepEqual(layoutPins({ comments, anchors: forged, frames, view }), before);
	assert.equal(before.length, 1);
});

test('dropFrameAnchors removes one frame and returns the same state when absent', () => {
	const state = answered('a', 'c1', { box, visible: box });
	assert.equal(dropFrameAnchors({ state, frameId: 'b' }), state);
	assert.equal(dropFrameAnchors({ state, frameId: 'a' }).has('a'), false);
});

test('anchorSends sends element comments of each frame, and [] to a frame without any', () => {
	const comments = [
		comment({ id: 'c1' }),
		comment({ id: 'p1', isPage: true, selector: 'body', tagName: 'body', rect: null }),
		comment({ id: 'r1', status: 'resolved', selector: 'p' }),
		comment({ id: 'b1', frameId: 'b' }),
	];
	assert.deepEqual(anchorSends({ comments, frameIds: ['a', 'c'] }), [
		{
			frameId: 'a',
			anchors: [
				{ id: 'c1', selector: 'h1' },
				{ id: 'r1', selector: 'p' },
			],
		},
		{ frameId: 'c', anchors: [] },
	]);
});

test('pinBadge: resolved shows none; a live box: null beats disk stale', () => {
	const gone = { box: null, visible: null };
	assert.equal(
		pinBadge({ comment: comment({ status: 'resolved', stale: true }), live: gone }),
		undefined,
	);
	assert.equal(pinBadge({ comment: comment({ stale: true }), live: gone }), 'missing');
	assert.equal(pinBadge({ comment: comment({ targetMissing: true }), live: undefined }), 'missing');
	assert.equal(pinBadge({ comment: comment({ stale: true }), live: undefined }), 'stale');
	assert.equal(
		pinBadge({
			comment: comment({ status: 'sent', stale: null, targetMissing: null }),
			live: undefined,
		}),
		'unchecked',
	);
	// Unchecked needs both flags null; a page comment on a present frame is never stale.
	assert.equal(pinBadge({ comment: comment({ stale: null }), live: undefined }), undefined);
	assert.equal(pinBadge({ comment: comment(), live: { box, visible: box } }), undefined);
});

test('pinPoint: an element pin at its box corner (live, then stored rect), a page pin at its fraction', () => {
	const element = comment();
	assert.deepEqual(pinPoint({ comment: element, live: { box, visible: box }, frame: frame() }), {
		x: box.x,
		y: box.y,
	});
	// The stored fraction no longer moves an element pin.
	assert.deepEqual(
		pinPoint({
			comment: comment({ pin: { x: 0.9, y: 0.9 } }),
			live: { box, visible: box },
			frame: frame(),
		}),
		{ x: box.x, y: box.y },
	);
	assert.deepEqual(
		pinPoint({ comment: element, live: { box: null, visible: null }, frame: frame() }),
		{
			x: 10,
			y: 20,
		},
	);
	assert.deepEqual(
		pinPoint({ comment: comment({ rect: null }), live: undefined, frame: frame() }),
		{ x: 0, y: 0 },
	);
	const page = comment({ isPage: true, rect: null, pin: { x: 0.25, y: 0.5 } });
	assert.deepEqual(pinPoint({ comment: page, live: undefined, frame: frame() }), {
		x: 100,
		y: 150,
	});
});

test('layoutPins: screen point on the drawn frame at the committed view, numbered in file order', () => {
	const pins = layoutPins({
		comments: [comment({ id: 'r0', frameId: 'gone', status: 'resolved' }), comment()],
		anchors: answered('a', 'c1', { box, visible: box }),
		frames: [frame()],
		view: { x: 10, y: 20, zoom: 2 },
	});
	assert.deepEqual(pins, [
		{
			id: 'c1',
			x: 10 + (1000 + 50) * 2,
			y: 20 + (500 + 60) * 2,
			// The unplaced resolved comment before it keeps number 1.
			number: 2,
			status: 'open',
			badge: undefined,
			label: 'Open comment 2: Make this bolder',
		},
	]);
	assert.deepEqual(
		layoutPins({
			comments: [comment()],
			anchors: new Map(),
			frames: [frame()],
			view: undefined,
		}),
		[],
	);
});

test('layoutPins lines up pins whose tips coincide to the left, in file order', () => {
	const sameTarget = (id: string): PostedComment => comment({ id, selector: 'h1' });
	const pins = layoutPins({
		comments: [
			sameTarget('c1'),
			sameTarget('c2'),
			comment({ id: 'other', rect: box }),
			sameTarget('c3'),
		],
		anchors: new Map(),
		frames: [frame()],
		view,
	});
	const at = (id: string): { x: number; y: number } => {
		const pin = pins.find((placed) => placed.id === id);
		assert.ok(pin);
		return { x: pin.x, y: pin.y };
	};
	// The first keeps the corner; each later one at the same tip steps 30 screen px left.
	assert.deepEqual(at('c2'), { x: at('c1').x - 30, y: at('c1').y });
	assert.deepEqual(at('c3'), { x: at('c1').x - 60, y: at('c1').y });
	// A pin at another tip is not shifted.
	assert.deepEqual(at('other'), { x: 1000 + box.x, y: 500 + box.y });
});

test('layoutPins hides a pin outside visible, fully clipped, or outside the frame', () => {
	const place = (anchors: AnchorState, comments = [comment()]): number =>
		layoutPins({ comments, anchors, frames: [frame()], view }).length;
	assert.equal(place(answered('a', 'c1', { box, visible: box })), 1);
	assert.equal(place(answered('a', 'c1', { box, visible: null })), 0);
	// The point, the box corner (50, 60), is 0.5px inside the tolerance, then just past it.
	assert.equal(place(answered('a', 'c1', { box, visible: { ...box, x: 50.5, width: 10 } })), 1);
	assert.equal(place(answered('a', 'c1', { box, visible: { ...box, x: 50.6, width: 10 } })), 0);
	// A zero-area target is hidden by design.
	const zero = { x: 5, y: 7, width: 0, height: 0 };
	assert.equal(place(answered('a', 'c1', { box: zero, visible: null })), 0);
	// A forged rect outside the frame never draws over a neighbor, even with visible set.
	const far = { x: 5000, y: 0, width: 10, height: 10 };
	assert.equal(place(answered('a', 'c1', { box: far, visible: far })), 0);
	// box: null draws the missing pin at the stored rect.
	const missing = layoutPins({
		comments: [comment()],
		anchors: answered('a', 'c1', { box: null, visible: null }),
		frames: [frame()],
		view,
	});
	assert.equal(missing[0]?.badge, 'missing');
});

test('layoutPins places nothing on a tile or a frame that is not drawn', () => {
	const comments = [comment(), comment({ id: 'b1', frameId: 'b' })];
	assert.deepEqual(
		layoutPins({ comments, anchors: new Map(), frames: [frame({ kind: 'tile' })], view }),
		[],
	);
});

test('pinLabel collapses whitespace and cuts at 60 characters with an ellipsis', () => {
	assert.equal(
		pinLabel({ comment: comment({ body: '  Make\n this\tbolder ' }), badge: 'stale', number: 3 }),
		'Open comment 3, target changed: Make this bolder',
	);
	assert.equal(
		pinLabel({ comment: comment({ body: 'Hi' }), badge: 'unchecked', number: 2 }),
		'Open comment 2, not checked: Hi',
	);
	assert.equal(
		pinLabel({
			comment: comment({ body: 'x'.repeat(60), status: 'sent' }),
			badge: undefined,
			number: 1,
		}),
		`Sent comment 1: ${'x'.repeat(60)}`,
	);
	assert.equal(
		pinLabel({
			comment: comment({ body: 'x'.repeat(61), status: 'resolved' }),
			badge: 'missing',
			number: 12,
		}),
		`Resolved comment 12, target missing: ${'x'.repeat(60)}…`,
	);
});

test('keepOpenThread keeps the id only while its pin is placed', () => {
	const pins = layoutPins({
		comments: [comment()],
		anchors: new Map(),
		frames: [frame()],
		view,
	});
	assert.equal(keepOpenThread({ openThreadId: 'c1', pins }), 'c1');
	assert.equal(keepOpenThread({ openThreadId: 'c2', pins }), undefined);
	assert.equal(keepOpenThread({ openThreadId: undefined, pins }), undefined);
});

test('liveAnchor: undefined for a page comment, an unknown frame and an unknown id', () => {
	const anchors = answered('a', 'c1', { box, visible: box });
	assert.deepEqual(liveAnchor({ anchors, comment: comment() }), { box, visible: box });
	assert.equal(liveAnchor({ anchors, comment: comment({ isPage: true }) }), undefined);
	assert.equal(liveAnchor({ anchors, comment: comment({ frameId: 'b' }) }), undefined);
	assert.equal(liveAnchor({ anchors, comment: comment({ id: 'c2' }) }), undefined);
});

const jumpFrame = { width: 400, height: 300 };

test('jumpTarget: a page comment centers its pin, keeps the zoom and outlines the frame', () => {
	assert.deepEqual(
		jumpTarget({
			comment: comment({ isPage: true, rect: null, pin: { x: 0.5, y: 0.5 } }),
			live: undefined,
			frame: jumpFrame,
		}),
		{
			center: { x: 200, y: 150 },
			fit: undefined,
			outline: { x: 0, y: 0, width: 400, height: 300 },
		},
	);
});

test('jumpTarget: a live box is centered and fitted, and the outline is its visible part', () => {
	const visible = { ...box, height: 40 };
	assert.deepEqual(jumpTarget({ comment: comment(), live: { box, visible }, frame: jumpFrame }), {
		center: { x: 150, y: 100 },
		fit: { width: 200, height: 80 },
		outline: visible,
	});
});

test('jumpTarget: a live target scrolled out of view (visible: null) gets no outline', () => {
	const target = jumpTarget({ comment: comment(), live: { box, visible: null }, frame: jumpFrame });
	assert.equal(target.outline, undefined);
	assert.deepEqual(target.fit, { width: 200, height: 80 });
});

test('jumpTarget: a missing target (box: null) or no live answer uses the stored rect', () => {
	const stored = comment().rect;
	for (const live of [{ box: null, visible: null }, undefined]) {
		assert.deepEqual(jumpTarget({ comment: comment(), live, frame: jumpFrame }), {
			center: { x: 60, y: 40 },
			fit: { width: 100, height: 40 },
			outline: stored,
		});
	}
});

test('jumpTarget: a box outside the frame or with no area has no fit and centers the clamped pin', () => {
	const outside = { x: 900, y: -500, width: 100, height: 100 };
	const far = jumpTarget({
		comment: comment(),
		live: { box: outside, visible: null },
		frame: jumpFrame,
	});
	assert.equal(far.fit, undefined);
	assert.deepEqual(far.center, { x: 400, y: 0 });
	const flat = jumpTarget({
		comment: comment({ rect: { x: 10, y: 20, width: 0, height: 40 } }),
		live: undefined,
		frame: jumpFrame,
	});
	assert.equal(flat.fit, undefined);
	assert.deepEqual(flat.center, { x: 10, y: 20 });
});

test('jumpTarget: a box partly outside the frame fits only its inside part', () => {
	const partial = { x: 300, y: 250, width: 200, height: 100 };
	assert.deepEqual(
		jumpTarget({ comment: comment(), live: { box: partial, visible: null }, frame: jumpFrame }).fit,
		{ width: 100, height: 50 },
	);
});

test('resolveHeldThread: open on its pin, drop once it cannot come back, hold otherwise', () => {
	const pins = layoutPins({ comments: [comment()], anchors: new Map(), frames: [frame()], view });
	const known = { comments: [comment()], liveFrameIds: new Set(['a']), anchorAnswered: false };
	assert.equal(resolveHeldThread({ held: 'c1', pins, ...known }), 'open');
	// Nothing known yet.
	assert.equal(
		resolveHeldThread({
			held: 'c1',
			pins: [],
			comments: undefined,
			liveFrameIds: undefined,
			anchorAnswered: false,
		}),
		'hold',
	);
	// Known, placed later (the frame has not answered yet).
	assert.equal(resolveHeldThread({ held: 'c1', pins: [], ...known }), 'hold');
	// Comments known without it.
	assert.equal(resolveHeldThread({ held: 'c2', pins, ...known }), 'drop');
	// Its frame is gone or a tile.
	assert.equal(
		resolveHeldThread({ held: 'c1', pins: [], ...known, liveFrameIds: new Set(['b']) }),
		'drop',
	);
	// The frame answered and no pin was placed.
	assert.equal(resolveHeldThread({ held: 'c1', pins: [], ...known, anchorAnswered: true }), 'drop');
});
