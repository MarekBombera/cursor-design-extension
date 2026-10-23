import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	EMPTY_ARTBOARD_COPY,
	type FrameRecord,
	liveIframeIds,
	mergeCanvasFrames,
	PROVISIONAL_FRAME_HEIGHT,
	TILE_HEIGHT,
} from './canvasFrames';
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
