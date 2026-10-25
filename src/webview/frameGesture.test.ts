import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	arrowNudge,
	failFrameGesture,
	type FrameGesture,
	REVEAL_MARGIN,
	revealOffset,
	type StageFrameGesture,
	settleFrameGesture,
	stepFrameGesture,
	scrollSinkStep,
	wheelToView,
} from './frameGesture';
import type { FramePlacement } from './hostMessages';

const VIEW = { x: 0, y: 0, zoom: 1 };
const disk: Record<string, FramePlacement> = {
	a: { x: 10, y: 20, width: 400 },
	b: { x: 600, y: 20, width: 300 },
};
const diskPlacement = (id: string): FramePlacement | undefined => disk[id];

const step = (gesture: FrameGesture | undefined, event: StageFrameGesture, view = VIEW) =>
	stepFrameGesture({ gesture, event, diskPlacement, view });

const pointer = (
	phase: 'start' | 'move' | 'end' | 'cancel',
	screenX: number,
	screenY = 0,
	id = 'a',
	kind: 'move' | 'resize' = 'move',
): StageFrameGesture => ({ id, kind, source: 'pointer', phase, screenX, screenY });

const nudge = (stepX: number, repeat = false, id = 'a'): StageFrameGesture => ({
	id,
	kind: 'move',
	source: 'keyboard',
	phase: 'nudge',
	stepX,
	stepY: 0,
	repeat,
});

const dragTo = (screenX: number, screenY = 0): FrameGesture | undefined => {
	const started = step(undefined, pointer('start', 0)).gesture;
	return step(started, pointer('move', screenX, screenY)).gesture;
};

test('a pointer drag previews whole px and commits once with the base', () => {
	const moved = dragTo(25.4, 7.6);
	assert.deepEqual(moved?.override, { x: 35, y: 28, width: 400 });
	const ended = step(moved, pointer('end', 25.4, 7.6));
	assert.equal(ended.gesture?.phase, 'committing');
	assert.deepEqual(ended.commit, {
		type: 'frame:place',
		id: 'a',
		x: 35,
		y: 28,
		width: 400,
		base: { x: 10, y: 20, width: 400 },
	});
	// A late lostpointercapture end or move does nothing while committing.
	assert.deepEqual(step(ended.gesture, pointer('end', 0)), { gesture: ended.gesture });
	assert.deepEqual(step(ended.gesture, pointer('move', 90)), { gesture: ended.gesture });
});

test('a plain click (under the 3px threshold) writes nothing', () => {
	const clicked = dragTo(2, 2);
	assert.equal(clicked?.override, undefined);
	assert.deepEqual(step(clicked, pointer('end', 2, 2)), { gesture: undefined });
});

test('a resize changes width only and clamps to the minimum', () => {
	const started = step(undefined, pointer('start', 0, 0, 'a', 'resize')).gesture;
	const resized = step(started, pointer('move', -1000, 0, 'a', 'resize')).gesture;
	assert.deepEqual(resized?.override, { x: 10, y: 20, width: 120 });
});

test('a zoom change mid-drag keeps the frame under the cursor in stage space', () => {
	const started = step(undefined, pointer('start', 100)).gesture;
	const zoomed = step(started, pointer('move', 104), { x: 0, y: 0, zoom: 2 }).gesture;
	// Start: screen 100 = stage 100 at zoom 1. Now: screen 104 = stage 52 at zoom 2. Delta -48.
	assert.deepEqual(zoomed?.override, { x: -38, y: 20, width: 400 });
});

test('Escape cancels an active gesture; one gesture at a time; source and id must match', () => {
	const moved = dragTo(50);
	assert.deepEqual(step(moved, pointer('cancel', 50)), { gesture: undefined });
	assert.equal(step(moved, pointer('start', 0, 0, 'b')).gesture, moved);
	assert.equal(step(moved, nudge(8, false, 'b')).gesture, moved);
	assert.equal(
		step(moved, { id: 'a', kind: 'move', source: 'keyboard', phase: 'end' }).gesture,
		moved,
	);
	assert.equal(step(moved, pointer('end', 50, 0, 'b')).gesture, moved);
});

test('keyboard nudges step from the last preview; end commits', () => {
	const first = step(undefined, nudge(8)).gesture;
	const second = step(first, nudge(64, true)).gesture;
	assert.deepEqual(second?.override, { x: 82, y: 20, width: 400 });
	const ended = step(second, { id: 'a', kind: 'move', source: 'keyboard', phase: 'end' });
	assert.equal(ended.commit?.x, 82);
});

test('F-17: auto-repeat never starts a gesture after Agent-wins cleared one', () => {
	const held = step(undefined, nudge(8)).gesture;
	const afterAgent = settleFrameGesture({
		gesture: held,
		diskPlacement: () => ({ x: 500, y: 20, width: 400 }),
	});
	assert.equal(afterAgent, undefined);
	assert.deepEqual(step(afterAgent, nudge(8, true)), { gesture: undefined });
	assert.deepEqual(step(afterAgent, { id: 'a', kind: 'move', source: 'keyboard', phase: 'end' }), {
		gesture: undefined,
	});
	assert.notEqual(step(afterAgent, nudge(8, false)).gesture, undefined);
});

test('settle: active drops on a disk move, committing waits for the host answer', () => {
	const moved = dragTo(50);
	assert.equal(settleFrameGesture({ gesture: moved, diskPlacement }), moved);
	assert.equal(settleFrameGesture({ gesture: moved, diskPlacement: () => undefined }), undefined);
	const committing = step(moved, pointer('end', 50)).gesture;
	assert.equal(settleFrameGesture({ gesture: committing, diskPlacement }), committing);
	assert.equal(
		settleFrameGesture({
			gesture: committing,
			diskPlacement: () => ({ x: 60, y: 20, width: 400 }),
		}),
		undefined,
	);
});

test('arrowNudge: resize ignores up/down, chords and other keys pass through', () => {
	const key = (value: string, extra: Partial<Parameters<typeof arrowNudge>[0]> = {}) =>
		arrowNudge({ key: value, shiftKey: false, hasModifier: false, kind: 'move', ...extra });
	assert.deepEqual(key('ArrowUp', { shiftKey: true }), { stepX: 0, stepY: -64 });
	assert.deepEqual(key('ArrowLeft', { kind: 'resize' }), { stepX: -8, stepY: 0 });
	// Each of these would otherwise preventDefault and trap the key.
	assert.equal(key('ArrowUp', { kind: 'resize' }), undefined);
	assert.equal(key('ArrowDown', { kind: 'resize' }), undefined);
	assert.equal(key('ArrowLeft', { hasModifier: true }), undefined);
	assert.equal(key('Tab'), undefined);
});

test('revealOffset: pans only as far as needed; too-large targets align their start', () => {
	const view = { viewStart: 0, viewEnd: 1000 };
	assert.equal(revealOffset({ ...view, start: 100, end: 200 }), 0);
	// Inside the margin but visible: still pans by the shortfall.
	assert.equal(revealOffset({ ...view, start: 10, end: 60 }), 10 - REVEAL_MARGIN);
	assert.equal(revealOffset({ ...view, start: -300, end: -200 }), -300 - REVEAL_MARGIN);
	assert.equal(revealOffset({ ...view, start: 950, end: 1100 }), 1100 - (1000 - REVEAL_MARGIN));
	assert.equal(revealOffset({ ...view, start: 400, end: 1400 }), 400 - REVEAL_MARGIN);
});

test('failFrameGesture drops only a committing gesture, never a drag in progress', () => {
	const active = step(undefined, pointer('start', 0)).gesture;
	assert.ok(active !== undefined);
	assert.equal(failFrameGesture(active), active);
	assert.equal(failFrameGesture({ ...active, phase: 'committing' }), undefined);
	assert.equal(failFrameGesture(undefined), undefined);
});

test('a zoom wheel keeps the point under the pointer fixed; a plain wheel pans and ignores the anchor', () => {
	const view = { x: 40, y: 30, zoom: 1 };
	const zoomed = wheelToView({
		view,
		wheel: { deltaX: 99, deltaY: -100, zoom: true, screenX: 200, screenY: 150 },
	});
	assert.ok(zoomed.zoom > 1);
	assert.ok(Math.abs((200 - zoomed.x) / zoomed.zoom - (200 - view.x) / view.zoom) < 1e-9);
	assert.ok(Math.abs((150 - zoomed.y) / zoomed.zoom - (150 - view.y) / view.zoom) < 1e-9);
	assert.deepEqual(
		wheelToView({ view, wheel: { deltaX: 5, deltaY: 7, zoom: false, screenX: 200, screenY: 150 } }),
		{ x: 35, y: 23, zoom: 1 },
	);
});

test('the scroll sink pans by the offset from where it was re-centred, only during a frame gesture', () => {
	const rest = { restX: 5000, restY: 4999.5, lastGestureAt: 1000 };
	// The rest of a gesture that left its frame: pan by exactly what Chromium scrolled.
	assert.deepEqual(scrollSinkStep({ ...rest, scrollX: 5040, scrollY: 4989.5, now: 1016 }), {
		recentre: true,
		pan: { deltaX: 40, deltaY: -10 },
	});
	// The scroll back lands on the rest position (sub-pixel included): no pan, no feedback loop.
	assert.deepEqual(scrollSinkStep({ ...rest, scrollX: 5000, scrollY: 4999.5, now: 1032 }), {
		recentre: false,
		pan: undefined,
	});
	// End/Home or a reset scroll position inside the gesture window: re-centre, no 5000px pan.
	for (const scrollY of [9999.5, 0]) {
		assert.deepEqual(scrollSinkStep({ ...rest, scrollX: 5000, scrollY, now: 1016 }), {
			recentre: true,
			pan: undefined,
		});
	}
	// A root scroll long after any frame wheel (keys bubbling out of a frame): re-centre, no pan.
	assert.deepEqual(scrollSinkStep({ ...rest, scrollX: 5000, scrollY: 5040, now: 9000 }), {
		recentre: true,
		pan: undefined,
	});
});
