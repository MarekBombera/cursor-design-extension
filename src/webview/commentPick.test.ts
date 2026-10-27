import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	applyPickMessage,
	clearPick,
	type CommentPickState,
	INITIAL_COMMENT_PICK,
	keepLiveFrames,
	modeKeyAction,
	type ModeKeyInput,
	toggleCommentMode,
} from './commentPick';

const rect = { x: 1, y: 2, width: 3, height: 4 };
const pickFields = {
	selector: '.card:nth-of-type(3)',
	tagName: 'div',
	text: 'Card',
	rect,
	point: { x: 5, y: 6 },
	box: { width: 3, height: 4 },
	styles: { color: 'rgb(0, 0, 0)' },
	isPage: false,
	repost: false,
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

test('a re-post moves only a pick chrome still holds for that frame (F-80)', () => {
	const message = {
		type: 'cd:pick',
		...pickFields,
		repost: true,
		rect: { ...rect, y: 9 },
	} as const;
	// No pick (the draft closed and clearPick dropped it): the in-flight re-post changes nothing.
	const cleared = commenting();
	const afterClose = applyPickMessage({ state: cleared, frameId: 'a', message });
	assert.equal(afterClose.state, cleared);
	assert.deepEqual(afterClose.sends, []);
	// Another frame holds the pick: a re-post never moves it.
	const elsewhere = commenting({ pick: pickIn('b') });
	assert.equal(applyPickMessage({ state: elsewhere, frameId: 'a', message }).state, elsewhere);
	// The same frame: the rect follows.
	const same = applyPickMessage({
		state: commenting({ pick: pickIn('a') }),
		frameId: 'a',
		message,
	});
	assert.deepEqual(same.state.pick?.rect, { ...rect, y: 9 });
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

const keyInput = (overrides: Partial<ModeKeyInput> = {}): ModeKeyInput => ({
	key: 'c',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	repeat: false,
	defaultPrevented: false,
	inTextEntry: false,
	commentMode: false,
	hasFrames: true,
	popoverOpen: false,
	forwarded: false,
	...overrides,
});

test('c toggles only when nothing else owns the key and a frame is live', () => {
	assert.equal(modeKeyAction(keyInput()), 'toggle');
	assert.equal(modeKeyAction(keyInput({ key: 'C', forwarded: true })), 'toggle');
	for (const blocked of [
		{ ctrlKey: true }, // Ctrl+C copies
		{ metaKey: true }, // Cmd+C copies
		{ altKey: true },
		{ inTextEntry: true }, // the zoom select, the popover textarea
		{ repeat: true },
		{ defaultPrevented: true },
		{ hasFrames: false },
	]) {
		assert.equal(modeKeyAction(keyInput(blocked)), undefined, JSON.stringify(blocked));
	}
});

test('Escape leaves Comment mode, and only in Comment mode', () => {
	assert.equal(modeKeyAction(keyInput({ key: 'Escape', commentMode: true })), 'exit');
	assert.equal(modeKeyAction(keyInput({ key: 'Escape', commentMode: false })), undefined);
	assert.equal(modeKeyAction(keyInput({ key: 'Enter', commentMode: true })), undefined);
});

test('with the popover open only a chrome Escape cancels; c and a forwarded Escape do nothing', () => {
	const open = { commentMode: true, popoverOpen: true };
	assert.equal(modeKeyAction(keyInput({ ...open, key: 'Escape' })), 'cancel');
	assert.equal(modeKeyAction(keyInput({ ...open, key: 'Escape', forwarded: true })), undefined);
	assert.equal(modeKeyAction(keyInput({ ...open, key: 'c' })), undefined);
	assert.equal(modeKeyAction(keyInput({ ...open, key: 'c', forwarded: true })), undefined);
	// The popover already handled (and prevented) its own Escape.
	assert.equal(
		modeKeyAction(keyInput({ ...open, key: 'Escape', defaultPrevented: true })),
		undefined,
	);
});

test('clearPick drops the pick and resets only the picked frame', () => {
	const step = clearPick(commenting({ hover: { frameId: 'b', rect }, pick: pickIn('a') }));
	assert.equal(step.state.pick, undefined);
	assert.deepEqual(step.state.hover, { frameId: 'b', rect });
	assert.deepEqual(step.sends, [{ frameId: 'a', message: { type: 'cd:mode', mode: 'comment' } }]);
	assert.deepEqual(clearPick(commenting()).sends, []);
});
