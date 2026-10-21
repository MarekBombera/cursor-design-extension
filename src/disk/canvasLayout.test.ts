import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	type CanvasFrame,
	type CanvasLayout,
	parseCanvasLayout,
	placeCanvasFrame,
	resolveCanvasFrames,
	serializeCanvasLayout,
} from './canvasLayout';
import {
	CANVAS_SCHEMA_VERSION,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	MAX_FRAME_WIDTH,
	MIN_FRAME_WIDTH,
} from './layout';

const frame = ({ id, ...overrides }: Partial<CanvasFrame> & { id: string }): CanvasFrame => ({
	id,
	label: id,
	x: 0,
	y: 0,
	width: DEFAULT_FRAME_WIDTH,
	...overrides,
});

const layoutOf = (frames: CanvasFrame[]): CanvasLayout => ({
	version: CANVAS_SCHEMA_VERSION,
	frames,
});

const codeOf = (run: () => unknown): unknown => {
	try {
		run();
	} catch (error: unknown) {
		return (error as { code?: unknown }).code;
	}
	return undefined;
};

test('parse keeps a valid layout, including an empty label', () => {
	const raw = {
		version: CANVAS_SCHEMA_VERSION,
		frames: [
			{ id: 'hero', label: '', x: 10, y: -20, width: 400, group: 'Desktop', extra: true },
			{ id: 'hero-alt', label: 'Alt', x: 0.5, y: 0, width: 390 },
		],
		unknownRoot: 1,
	};
	assert.deepEqual(
		parseCanvasLayout(raw),
		layoutOf([
			{ id: 'hero', label: '', x: 10, y: -20, width: 400, group: 'Desktop' },
			{ id: 'hero-alt', label: 'Alt', x: 0.5, y: 0, width: 390 },
		]),
	);
});

test('parse rejects corrupt layouts with CORRUPT_CANVAS', () => {
	const valid = { id: 'hero', label: 'Hero', x: 0, y: 0, width: 400 };
	const corruptCases: unknown[] = [
		null,
		[],
		'canvas',
		{ version: '1', frames: [] },
		{ version: 1.5, frames: [] },
		{ version: CANVAS_SCHEMA_VERSION },
		{ version: CANVAS_SCHEMA_VERSION, frames: [null] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [[]] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [{ ...valid, id: '../hero' }] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [{ ...valid, label: 3 }] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [{ ...valid, x: Number.POSITIVE_INFINITY }] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [{ ...valid, x: '0' }] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [{ ...valid, group: 3 }] },
		{ version: CANVAS_SCHEMA_VERSION, frames: [valid, { ...valid, x: 500 }] },
	];
	for (const corrupt of corruptCases) {
		assert.equal(
			codeOf(() => parseCanvasLayout(corrupt)),
			'CORRUPT_CANVAS',
			JSON.stringify(corrupt),
		);
	}
});

test('parse rejects another integer version with UNSUPPORTED_CANVAS_VERSION', () => {
	assert.equal(
		codeOf(() => parseCanvasLayout({ version: CANVAS_SCHEMA_VERSION + 1, frames: [] })),
		'UNSUPPORTED_CANVAS_VERSION',
	);
});

test('parse clamps width and drops an empty group', () => {
	const parsed = parseCanvasLayout({
		version: CANVAS_SCHEMA_VERSION,
		frames: [
			{ id: 'narrow', label: '', x: 0, y: 0, width: 50, group: '' },
			{ id: 'wide', label: '', x: 0, y: 0, width: 9999 },
		],
	});
	assert.equal(parsed.frames[0].width, MIN_FRAME_WIDTH);
	assert.equal(parsed.frames[1].width, MAX_FRAME_WIDTH);
	assert.ok(!('group' in parsed.frames[0]));
});

test('serialize matches pretty JSON, round-trips, and never writes an empty group', () => {
	const layout = layoutOf([
		frame({ id: 'hero', group: 'Desktop' }),
		frame({ id: 'hero-alt', x: 1304 }),
	]);
	const text = serializeCanvasLayout(layout);
	assert.equal(text, `${JSON.stringify(layout, null, 2)}\n`);
	assert.deepEqual(parseCanvasLayout(JSON.parse(text)), layout);

	const withEmptyGroup = serializeCanvasLayout(layoutOf([frame({ id: 'hero', group: '' })]));
	assert.ok(!withEmptyGroup.includes('group'));
	assert.ok(!serializeCanvasLayout(layoutOf([frame({ id: 'hero' })])).includes('group'));
});

test('resolve keeps stored order, copies stored frames, and drops orphans', () => {
	const stored = [
		frame({ id: 'zeta', label: 'Old label', x: 5, y: 6, width: 300, group: 'G' }),
		frame({ id: 'orphan', x: 9999 }),
		frame({ id: 'alpha', x: -100, y: 40 }),
	];
	const resolved = resolveCanvasFrames({
		stored,
		artboards: [
			{ artboardId: 'alpha', title: 'Alpha' },
			{ artboardId: 'zeta', title: 'New title' },
		],
	});
	assert.deepEqual(resolved, [stored[0], stored[2]]);
});

test('resolve auto-places at the origin when nothing is stored', () => {
	assert.deepEqual(
		resolveCanvasFrames({ stored: [], artboards: [{ artboardId: 'hero', title: 'Hero' }] }),
		[{ id: 'hero', label: 'Hero', x: 0, y: 0, width: DEFAULT_FRAME_WIDTH }],
	);
});

test('resolve auto-places right of the greatest right edge at that frame y', () => {
	const resolved = resolveCanvasFrames({
		stored: [
			frame({ id: 'a', x: 0, y: 10, width: 500 }),
			frame({ id: 'b', x: 100, y: 70, width: 600 }),
			frame({ id: 'c', x: 200, y: 90, width: 500 }),
		],
		artboards: [
			{ artboardId: 'a', title: '' },
			{ artboardId: 'b', title: '' },
			{ artboardId: 'c', title: '' },
			{ artboardId: 'd', title: 'D' },
		],
	});
	// b and c tie at a right edge of 700; the earlier frame (b) wins.
	assert.deepEqual(resolved[3], {
		id: 'd',
		label: 'D',
		x: 700 + FRAME_GAP,
		y: 70,
		width: DEFAULT_FRAME_WIDTH,
	});
});

test('resolve places several missing frames in the given order with a title-to-id label fallback', () => {
	const resolved = resolveCanvasFrames({
		stored: [],
		artboards: [
			{ artboardId: 'artboard', title: 'Artboard' },
			{ artboardId: 'hero', title: '' },
			{ artboardId: 'hero-alt', title: ' ' },
		],
	});
	assert.deepEqual(
		resolved.map(({ id, label, x, y }) => ({ id, label, x, y })),
		[
			{ id: 'artboard', label: 'Artboard', x: 0, y: 0 },
			{ id: 'hero', label: 'hero', x: DEFAULT_FRAME_WIDTH + FRAME_GAP, y: 0 },
			{ id: 'hero-alt', label: ' ', x: 2 * (DEFAULT_FRAME_WIDTH + FRAME_GAP), y: 0 },
		],
	);
});

test('place applies a partial update and keeps the other fields', () => {
	const stored = frame({ id: 'hero', label: 'Hero', x: 10, y: 20, width: 400, group: 'Desktop' });
	const next = placeCanvasFrame({
		layout: layoutOf([stored]),
		current: stored,
		placement: { x: 50, label: undefined },
	});
	assert.deepEqual(next.frames, [{ ...stored, x: 50 }]);
});

test('place clamps width and deletes the group for an empty string', () => {
	const stored = frame({ id: 'hero', group: 'Desktop' });
	const narrow = placeCanvasFrame({
		layout: layoutOf([stored]),
		current: stored,
		placement: { width: 50, group: '' },
	});
	assert.equal(narrow.frames[0].width, MIN_FRAME_WIDTH);
	assert.ok(!('group' in narrow.frames[0]));
	const wide = placeCanvasFrame({
		layout: layoutOf([stored]),
		current: stored,
		placement: { width: 9999 },
	});
	assert.equal(wide.frames[0].width, MAX_FRAME_WIDTH);
	assert.equal(wide.frames[0].group, 'Desktop');
});

test('place appends an unstored frame, keeps orphans, and adds no siblings', () => {
	const orphan = frame({ id: 'orphan', x: 9999 });
	const current = frame({ id: 'hero', x: DEFAULT_FRAME_WIDTH + FRAME_GAP });
	const next = placeCanvasFrame({
		layout: layoutOf([orphan]),
		current,
		placement: { group: 'Mobile' },
	});
	assert.deepEqual(next.frames, [orphan, { ...current, group: 'Mobile' }]);
});

test('an empty placement upserts the auto-placed current frame', () => {
	const [current] = resolveCanvasFrames({
		stored: [],
		artboards: [{ artboardId: 'hero', title: 'Hero' }],
	});
	const next = placeCanvasFrame({ layout: layoutOf([]), current, placement: {} });
	assert.deepEqual(next, layoutOf([current]));
});
