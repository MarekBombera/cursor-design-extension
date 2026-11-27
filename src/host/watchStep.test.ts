import { describe, expect, it } from 'vite-plus/test';

import { type WatchEvent, IDLE_WATCH_STATE, stepWatch } from './watchStep';

const markerPath = '/ws/.vibeboard/.ensure-panel';
const artboardPath = '/ws/.vibeboard/pages/page-1/artboards/hero.html';
const nestedMarkerPath = '/ws/.vibeboard/pages/page-1/.ensure-panel';

// Frozen, so a step that mutates its input throws instead of passing.
const step = (markerPending: boolean, event: WatchEvent) =>
	stepWatch(Object.freeze({ markerPending }), event);

const disk = (change: 'write' | 'delete', path: string): WatchEvent => ({
	type: 'disk',
	change,
	path,
	markerPath,
});

describe('stepWatch', () => {
	it('starts idle', () => {
		expect(IDLE_WATCH_STATE).toEqual({ markerPending: false });
	});

	// Row 1: lock and temp files never schedule a run, whatever is pending.
	it.each(
		[
			'/ws/.vibeboard/.lock',
			'/ws/.vibeboard/.lock.123',
			'/ws/.vibeboard/pages/page-1/canvas.json.tmp',
		]
			.flatMap((path) => (['write', 'delete'] as const).map((change) => ({ path, change })))
			.flatMap((row) => [false, true].map((markerPending) => ({ ...row, markerPending }))),
	)('ignores $change of $path from pending $markerPending', ({ path, change, markerPending }) => {
		expect(step(markerPending, disk(change, path))).toEqual({
			state: { markerPending },
			effect: 'ignore',
		});
	});

	// Rows 2-5, plus a nested `.ensure-panel` that is not the marker (rows 3 and 5).
	it.each([
		{ row: 2, change: 'delete', path: markerPath, from: true, next: false, effect: 'ignore' },
		{ row: 3, change: 'delete', path: artboardPath, from: false, next: false, effect: 'debounce' },
		{ row: 3, change: 'delete', path: artboardPath, from: true, next: true, effect: 'debounce' },
		{
			row: 3,
			change: 'delete',
			path: nestedMarkerPath,
			from: true,
			next: true,
			effect: 'debounce',
		},
		{ row: 4, change: 'write', path: markerPath, from: false, next: true, effect: 'debounce' },
		{ row: 5, change: 'write', path: artboardPath, from: false, next: false, effect: 'debounce' },
		{ row: 5, change: 'write', path: artboardPath, from: true, next: true, effect: 'debounce' },
		{
			row: 5,
			change: 'write',
			path: nestedMarkerPath,
			from: false,
			next: false,
			effect: 'debounce',
		},
	] as const)(
		'row $row: $change of $path from pending $from',
		({ change, path, from, next, effect }) => {
			expect(step(from, disk(change, path))).toEqual({ state: { markerPending: next }, effect });
		},
	);

	// Rows 6-12.
	it.each([
		{
			row: 6,
			from: false,
			event: { type: 'settled', sameFolder: false, trusted: true },
			next: false,
			effect: 'ignore',
		},
		{
			row: 6,
			from: true,
			event: { type: 'settled', sameFolder: false, trusted: true },
			next: false,
			effect: 'ignore',
		},
		{
			row: 6,
			from: false,
			event: { type: 'settled', sameFolder: false, trusted: false },
			next: false,
			effect: 'ignore',
		},
		{
			row: 6,
			from: true,
			event: { type: 'settled', sameFolder: false, trusted: false },
			next: false,
			effect: 'ignore',
		},
		{
			row: 7,
			from: true,
			event: { type: 'settled', sameFolder: true, trusted: false },
			next: false,
			effect: 'ignore',
		},
		{
			row: 8,
			from: true,
			event: { type: 'settled', sameFolder: true, trusted: true },
			next: true,
			effect: 'checkMarker',
		},
		{
			row: 9,
			from: false,
			event: { type: 'settled', sameFolder: true, trusted: true },
			next: false,
			effect: 'refresh',
		},
		{
			row: 9,
			from: false,
			event: { type: 'settled', sameFolder: true, trusted: false },
			next: false,
			effect: 'refresh',
		},
		{
			row: 10,
			from: false,
			event: { type: 'markerChecked', exists: false },
			next: false,
			effect: 'ignore',
		},
		{
			row: 10,
			from: true,
			event: { type: 'markerChecked', exists: false },
			next: false,
			effect: 'ignore',
		},
		{
			row: 11,
			from: false,
			event: { type: 'markerChecked', exists: true },
			next: false,
			effect: 'openPanel',
		},
		{
			row: 11,
			from: true,
			event: { type: 'markerChecked', exists: true },
			next: true,
			effect: 'openPanel',
		},
		{ row: 12, from: false, event: { type: 'opened' }, next: false, effect: 'ignore' },
		{ row: 12, from: true, event: { type: 'opened' }, next: false, effect: 'ignore' },
	] as const)('row $row: $event.type from pending $from', ({ from, event, next, effect }) => {
		expect(step(from, event)).toEqual({ state: { markerPending: next }, effect });
	});
});
