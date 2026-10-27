import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	applyFrameHeight,
	demoteToTile,
	EMPTY_ARTBOARD_COPY,
	type FrameRecord,
	frameOutline,
	liveIframeIds,
	mergeCanvasFrames,
	PROVISIONAL_FRAME_HEIGHT,
	RENDER_ERROR_COPY,
	TILE_HEIGHT,
	toChromeFrames,
	withGestureOverride,
} from './canvasFrames';
import type { FrameGesture } from './frameGesture';
import type { PostedCanvasFrame } from './hostMessages';

const posted = (id: string, overrides: Partial<PostedCanvasFrame> = {}): PostedCanvasFrame => ({
	id,
	label: id,
	x: 0,
	y: 0,
	width: 400,
	generation: 1,
	html: `<p>${id}</p>`,
	...overrides,
});

const only = (records: FrameRecord[]): FrameRecord => {
	const [record] = records;
	assert.ok(record !== undefined);
	return record;
};

// A record as it looks after its iframe measured 1200px and the growth guard froze.
const measured = (id: string): FrameRecord => ({
	...only(mergeCanvasFrames({ records: [], frames: [posted(id)] })),
	height: 1200,
	measuredHeight: 1200,
	guard: { lastGrowth: 5, frozen: true },
});

test('an identical re-post (tab switch) changes nothing, frozen guard included', () => {
	const records = Object.freeze([measured('a'), measured('b')]);
	const frames = Object.freeze([posted('a'), posted('b')]);
	assert.deepEqual(mergeCanvasFrames({ records, frames }), records);
});

test('new html restarts the guard but keeps the measured height', () => {
	const next = only(
		mergeCanvasFrames({
			records: [measured('a')],
			frames: [posted('a', { html: '<p>edited</p>' })],
		}),
	);
	assert.deepEqual(next.guard, { lastGrowth: 0, frozen: false });
	assert.equal(next.height, 1200);
});

test('a tile that recovers with the same html reloads: guard reset, height restored', () => {
	const tile = only(
		mergeCanvasFrames({
			records: [measured('a')],
			frames: [posted('a', { errorMessage: 'Could not read' })],
		}),
	);
	assert.deepEqual([tile.kind, tile.height, tile.measuredHeight], ['tile', TILE_HEIGHT, 1200]);
	const back = only(mergeCanvasFrames({ records: [tile], frames: [posted('a')] }));
	assert.deepEqual([back.kind, back.height], ['iframe', 1200]);
	assert.deepEqual(back.guard, { lastGrowth: 0, frozen: false });
});

test('whitespace html is the empty tile; an error message wins over real html', () => {
	const [empty, broken] = mergeCanvasFrames({
		records: [],
		frames: [posted('a', { html: ' \n\t' }), posted('b', { errorMessage: 'Bad meta' })],
	});
	assert.deepEqual([empty?.kind, empty?.tileText], ['tile', EMPTY_ARTBOARD_COPY]);
	assert.deepEqual([broken?.kind, broken?.tileText], ['tile', 'Bad meta']);
});

test('a host reorder never moves existing records; new frames append; gone frames drop', () => {
	const next = mergeCanvasFrames({
		records: [measured('a'), measured('b'), measured('c')],
		frames: [posted('new'), posted('c'), posted('a')],
	});
	assert.deepEqual(
		next.map((record) => record.id),
		['a', 'c', 'new'],
	);
	assert.deepEqual([next[2]?.kind, next[2]?.height], ['iframe', PROVISIONAL_FRAME_HEIGHT]);
});

test('placement and group follow every post; a missing group clears it', () => {
	const next = only(
		mergeCanvasFrames({
			records: [{ ...measured('a'), group: 'Desktop' }],
			frames: [posted('a', { x: 40, y: -8, width: 390, label: 'Mobile' })],
		}),
	);
	assert.deepEqual(
		[next.x, next.y, next.width, next.label, next.group],
		[40, -8, 390, 'Mobile', undefined],
	);
});

test('only iframe frames can hold a pick', () => {
	const tile = only(mergeCanvasFrames({ records: [], frames: [posted('t', { html: '' })] }));
	assert.deepEqual(liveIframeIds([measured('a'), tile]), new Set(['a']));
});

test('a height report on a tile is measured but never drawn; on an iframe it is drawn', () => {
	const tile = { ...measured('a'), kind: 'tile' as const, height: TILE_HEIGHT };
	const reported = applyFrameHeight({ record: tile, reported: 1100 });
	assert.deepEqual([reported.measuredHeight, reported.height], [1100, TILE_HEIGHT]);
	const iframe = applyFrameHeight({ record: { ...measured('a'), kind: 'iframe' }, reported: 900 });
	assert.deepEqual([iframe.measuredHeight, iframe.height], [900, 900]);
});

test('a frozen guard ignores growth; the input record is never mutated', () => {
	const record = Object.freeze({ ...measured('a'), kind: 'iframe' as const });
	const next = applyFrameHeight({ record, reported: 5000 });
	assert.equal(next.height, 1200);
	assert.deepEqual(next.guard, record.guard);
	assert.notEqual(next, record);
});

test('a render error demotes to a tile but keeps the measured height for recovery', () => {
	const frame = Object.freeze({ ...measured('a'), kind: 'iframe' as const });
	const tile = demoteToTile(frame);
	assert.deepEqual(
		[tile.kind, tile.tileText, tile.height, tile.measuredHeight],
		['tile', RENDER_ERROR_COPY, TILE_HEIGHT, 1200],
	);
	assert.equal(frame.kind, 'iframe');
});

test('the gesture preview applies to its own frame only, and never mutates the record', () => {
	const frames = Object.freeze([measured('a'), measured('b')]);
	const gesture: FrameGesture = {
		id: 'b',
		kind: 'move',
		source: 'pointer',
		base: { x: 0, y: 0, width: 400 },
		override: { x: 50, y: 60, width: 300 },
		phase: 'active',
	};
	const [a, b] = withGestureOverride({ frames, gesture });
	assert.deepEqual([a?.x, b?.x, b?.y, b?.width], [0, 50, 60, 300]);
	assert.equal(a, frames[0]);
	assert.equal(frames[1]?.x, 0);
	assert.deepEqual(
		withGestureOverride({ frames, gesture: { ...gesture, override: undefined } }),
		frames,
	);
});

test('chrome frames drop an empty group key instead of passing group: undefined', () => {
	const [none, empty, grouped] = toChromeFrames([
		{ ...measured('a'), group: undefined },
		{ ...measured('b'), group: '' },
		{ ...measured('c'), group: 'g' },
	]);
	assert.ok(none !== undefined && empty !== undefined && grouped !== undefined);
	assert.ok(!('group' in none) && !('group' in empty));
	assert.equal(grouped.group, 'g');
});

test('an outline needs a target with a rect, a committed view and a frame still on stage', () => {
	const frames = [{ ...measured('a'), x: 100, y: 200 }];
	const view = { x: 10, y: 20, zoom: 2 };
	const rect = { x: 5, y: 6, width: 30, height: 40 };
	assert.deepEqual(frameOutline({ view, frames, target: { frameId: 'a', rect } }), {
		x: 220,
		y: 432,
		width: 60,
		height: 80,
	});
	assert.equal(frameOutline({ view, frames, target: undefined }), undefined);
	assert.equal(frameOutline({ view, frames, target: { frameId: 'a', rect: null } }), undefined);
	assert.equal(frameOutline({ view, frames, target: { frameId: 'gone', rect } }), undefined);
	assert.equal(
		frameOutline({ view: undefined, frames, target: { frameId: 'a', rect } }),
		undefined,
	);
});

test('each post carries the frame generation onto its record', () => {
	const [first] = mergeCanvasFrames({ records: [], frames: [posted('a', { generation: 1 })] });
	assert.equal(first?.generation, 1);
	const next = only(
		mergeCanvasFrames({ records: [measured('a')], frames: [posted('a', { generation: 4 })] }),
	);
	assert.equal(next.generation, 4);
});
