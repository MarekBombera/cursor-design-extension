import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	applyPickMessage,
	arrowPickStep,
	type CommentPickState,
	INITIAL_COMMENT_PICK,
	keepLiveFrames,
	toggleCommentMode,
} from './commentPick';

const rect = { x: 1, y: 2, width: 3, height: 4 };
const pickFields = {
	selector: '.card:nth-of-type(3)',
	tagName: 'div',
	text: 'Card',
	rect,
	point: { x: 5, y: 6 },
	styles: { color: 'rgb(0, 0, 0)' },
	isPage: false,
};
const pickIn = (frameId: string): CommentPickState['pick'] => ({
	frameId,
	sequence: 1,
	...pickFields,
});
const commenting = (overrides: Partial<CommentPickState> = {}): CommentPickState => ({
	commentMode: true,
	hover: undefined,
	pick: undefined,
	...overrides,
});

test('a reload clears only that frame and re-sends the current mode', () => {
	const state = commenting({ hover: { frameId: 'b', rect }, pick: pickIn('a') });
	const step = applyPickMessage({ state, frameId: 'a', message: { type: 'cd:ready' } });
	assert.equal(step.state.pick, undefined);
	assert.deepEqual(step.state.hover, { frameId: 'b', rect });
	assert.deepEqual(step.sends, [{ frameId: 'a', message: { type: 'cd:mode', mode: 'comment' } }]);
	// Interact mode still answers cd:ready, with interact.
	const interact = applyPickMessage({
		state: INITIAL_COMMENT_PICK,
		frameId: 'a',
		message: { type: 'cd:ready' },
	});
	assert.deepEqual(interact.sends, [
		{ frameId: 'a', message: { type: 'cd:mode', mode: 'interact' } },
	]);
});

test('hover and pick posted outside Comment mode are ignored (a design script can post them)', () => {
	for (const message of [
		{ type: 'cd:hover', rect },
		{ type: 'cd:pick', ...pickFields },
	] as const) {
		const step = applyPickMessage({ state: INITIAL_COMMENT_PICK, frameId: 'a', message });
		assert.equal(step.state, INITIAL_COMMENT_PICK);
		assert.deepEqual(step.sends, []);
	}
});

test('a null hover from another frame does not clear the current hover', () => {
	const state = commenting({ hover: { frameId: 'b', rect } });
	const fromA = applyPickMessage({
		state,
		frameId: 'a',
		message: { type: 'cd:hover', rect: null },
	});
	assert.deepEqual(fromA.state.hover, { frameId: 'b', rect });
	const fromB = applyPickMessage({
		state,
		frameId: 'b',
		message: { type: 'cd:hover', rect: null },
	});
	assert.equal(fromB.state.hover, undefined);
});

test('picking in another frame resets the old frame; re-picking the same frame sends nothing', () => {
	const state = commenting({ pick: pickIn('a') });
	const fields = { ...pickFields, selector: null, tagName: 'p', rect: null };
	const message = { type: 'cd:pick', ...fields } as const;
	const other = applyPickMessage({ state, frameId: 'b', message });
	assert.deepEqual(other.sends, [{ frameId: 'a', message: { type: 'cd:mode', mode: 'comment' } }]);
	// A null rect keeps the chip: the pick is stored, only the outline is gone. A null selector
	// is stored as is.
	assert.deepEqual(other.state.pick, { frameId: 'b', sequence: 2, ...fields });
	// The sequence counts picks, so the chrome can re-announce two equal picks in a row.
	assert.equal(
		applyPickMessage({ state: other.state, frameId: 'b', message }).state.pick?.sequence,
		3,
	);
	assert.deepEqual(applyPickMessage({ state, frameId: 'a', message }).sends, []);
});

test('toggling forgets hover and pick and tells every frame the new mode', () => {
	const step = toggleCommentMode({
		state: commenting({ hover: { frameId: 'a', rect }, pick: pickIn('a') }),
		frameIds: ['a', 'b'],
	});
	assert.deepEqual(step.state, INITIAL_COMMENT_PICK);
	assert.deepEqual(
		step.sends.map((send) => send.frameId),
		['a', 'b'],
	);
	assert.ok(
		step.sends.every((send) => send.message.type === 'cd:mode' && send.message.mode === 'interact'),
	);
});

test('frames leaving the stage take their hover and pick; an empty stage leaves Comment mode', () => {
	const state = commenting({ hover: { frameId: 'gone', rect }, pick: pickIn('kept') });
	const kept = keepLiveFrames({ state, liveFrameIds: new Set(['kept']) });
	assert.deepEqual(kept, { commentMode: true, hover: undefined, pick: pickIn('kept') });
	assert.deepEqual(keepLiveFrames({ state, liveFrameIds: new Set() }), INITIAL_COMMENT_PICK);
});

test('arrows step only when nothing else owns the key', () => {
	const ready = commenting({ pick: pickIn('a') });
	const base = { state: ready, hasModifier: false, defaultPrevented: false, inTextEntry: false };
	assert.equal(arrowPickStep({ ...base, key: 'ArrowUp' }), 'cd:pick-parent');
	assert.equal(arrowPickStep({ ...base, key: 'ArrowDown' }), 'cd:pick-child');
	for (const blocked of [
		{ key: 'ArrowUp', defaultPrevented: true }, // a focused frame label nudged instead
		{ key: 'ArrowUp', hasModifier: true },
		{ key: 'ArrowUp', inTextEntry: true }, // the zoom select
		{ key: 'ArrowUp', state: commenting() }, // no pick yet
		{ key: 'ArrowUp', state: { ...ready, commentMode: false } },
		{ key: 'ArrowLeft' },
	]) {
		assert.equal(arrowPickStep({ ...base, ...blocked }), undefined, JSON.stringify(blocked));
	}
});
