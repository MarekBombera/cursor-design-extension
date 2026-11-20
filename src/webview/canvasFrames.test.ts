import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	adoptEditAnswer,
	applyFrameHeight,
	demoteToTile,
	EMPTY_ARTBOARD_COPY,
	type FrameRecord,
	frameOutline,
	frameSizeText,
	liveIframeIds,
	mergeCanvasFrames,
	PROVISIONAL_FRAME_HEIGHT,
	reloadFrame,
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
	hash: `sha256:${id}`,
	html: `<p>${id}</p>`,
	canUndo: false,
	canRedo: false,
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
	heightReported: true,
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
	assert.deepEqual(
		[empty?.kind, empty?.tileKind, empty?.tileText],
		['tile', 'empty', EMPTY_ARTBOARD_COPY],
	);
	assert.deepEqual(
		[broken?.kind, broken?.tileKind, broken?.tileText],
		['tile', 'error', 'Bad meta'],
	);
});

test('the tile kind follows the cause, never the copy: an error that reads like the empty copy', () => {
	const [lookalike] = mergeCanvasFrames({
		records: [],
		frames: [posted('a', { errorMessage: EMPTY_ARTBOARD_COPY })],
	});
	assert.equal(lookalike?.tileKind, 'error');
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

test('the disk hash follows every post, a tile that keeps the real hash included', () => {
	const first = only(mergeCanvasFrames({ records: [], frames: [posted('a')] }));
	assert.equal(first.hash, 'sha256:a');
	const next = only(
		mergeCanvasFrames({ records: [first], frames: [posted('a', { hash: 'sha256:edited' })] }),
	);
	assert.equal(next.hash, 'sha256:edited');
	const tile = only(
		mergeCanvasFrames({
			records: [],
			frames: [posted('t', { html: '', errorMessage: 'Too large', hash: 'sha256:real' })],
		}),
	);
	assert.deepEqual([tile.kind, tile.hash], ['tile', 'sha256:real']);
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
		[tile.kind, tile.tileKind, tile.tileText, tile.height, tile.measuredHeight],
		['tile', 'error', RENDER_ERROR_COPY, TILE_HEIGHT, 1200],
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

test('a frame label shows the width alone until the first height report, and a tile no size', () => {
	const fresh = only(mergeCanvasFrames({ records: [], frames: [posted('a')] }));
	assert.equal(frameSizeText(fresh), String(fresh.width));
	const reported = applyFrameHeight({ record: fresh, reported: 900 });
	assert.equal(frameSizeText(reported), `${fresh.width} × 900`);
	// A tile has no size, and its stale measured height never shows.
	assert.equal(frameSizeText(demoteToTile(reported)), '');
});

// The user's own edit. Base: hash h0, generation 1; the answer: h1, generation 2.
const base = (): FrameRecord => measured('a');
const answer = {
	html: '<p>edited</p>',
	hash: 'sha256:h1',
	generation: 2,
	canUndo: true,
	canRedo: false,
};
const adopted = (): FrameRecord =>
	adoptEditAnswer({ record: base(), answer, baseHash: 'sha256:a' });

test('an adopted edit answer replaces the copy, hash and generation without a reload', () => {
	const record = adopted();
	assert.equal(record.html, answer.html);
	assert.equal(record.hash, answer.hash);
	assert.equal(record.generation, 2);
	assert.equal(record.documentHtml, base().documentHtml);
	assert.equal(record.documentVersion, base().documentVersion);
	assert.deepEqual(record.replacedHashes, ['sha256:a']);
	// A newer post already won (another base), or the frame is a tile: unchanged.
	const other = base();
	assert.equal(adoptEditAnswer({ record: other, answer, baseHash: 'sha256:x' }), other);
	const tile = demoteToTile(base());
	assert.equal(adoptEditAnswer({ record: tile, answer, baseHash: 'sha256:a' }), tile);
});

test('after an adopt, the echo and any late pre-write read change nothing', () => {
	const echoed = only(
		mergeCanvasFrames({ records: [adopted()], frames: [posted('a', { ...answer })] }),
	);
	assert.equal(echoed.documentVersion, base().documentVersion);
	assert.deepEqual(echoed.replacedHashes, ['sha256:a']);
	// The pre-write read arrives after the echo, with a new placement: only the placement moves.
	const stale = posted('a', { x: 40 });
	const kept = only(mergeCanvasFrames({ records: [echoed], frames: [stale] }));
	assert.equal(kept.html, answer.html);
	assert.equal(kept.hash, answer.hash);
	assert.equal(kept.documentVersion, base().documentVersion);
	assert.equal(kept.x, 40);
	// Two adopts in a row: a late read of the first base is still skipped.
	const twice = adoptEditAnswer({
		record: echoed,
		answer: {
			html: '<p>again</p>',
			hash: 'sha256:h2',
			generation: 3,
			canUndo: true,
			canRedo: false,
		},
		baseHash: 'sha256:h1',
	});
	assert.equal(only(mergeCanvasFrames({ records: [twice], frames: [stale] })).hash, 'sha256:h2');
});

test('a stale tile post and an outside change merge as before; the change ends the list', () => {
	const tile = only(
		mergeCanvasFrames({ records: [adopted()], frames: [posted('a', { errorMessage: 'gone' })] }),
	);
	assert.equal(tile.kind, 'tile');
	const outside = only(
		mergeCanvasFrames({
			records: [adopted()],
			frames: [posted('a', { html: '<p>agent</p>', hash: 'sha256:agent', generation: 3 })],
		}),
	);
	assert.equal(outside.documentHtml, '<p>agent</p>');
	assert.equal(outside.documentVersion, base().documentVersion + 1);
	assert.deepEqual(outside.replacedHashes, []);
});

test('a forced reload rebuilds from the latest adopted copy, once', () => {
	const reloaded = reloadFrame(adopted());
	assert.equal(reloaded.documentHtml, answer.html);
	assert.equal(reloaded.documentVersion, base().documentVersion + 1);
	const tile = demoteToTile(base());
	assert.equal(reloadFrame(tile), tile);
});

test('undo / redo flags follow posts and answers; a stale pre-write post keeps them', () => {
	const fresh = only(mergeCanvasFrames({ records: [], frames: [posted('a')] }));
	assert.deepEqual([fresh.canUndo, fresh.canRedo], [false, false]);
	const record = adopted();
	assert.deepEqual([record.canUndo, record.canRedo], [true, false]);
	// A stale pre-write read carries old flags: only its placement is taken.
	const stale = only(
		mergeCanvasFrames({ records: [record], frames: [posted('a', { canUndo: false, x: 9 })] }),
	);
	assert.deepEqual([stale.canUndo, stale.canRedo, stale.x], [true, false, 9]);
	// Any other post, the echo included, brings the host's flags.
	const echoed = only(
		mergeCanvasFrames({
			records: [record],
			frames: [posted('a', { ...answer, canUndo: false, canRedo: true })],
		}),
	);
	assert.deepEqual([echoed.canUndo, echoed.canRedo], [false, true]);
});
