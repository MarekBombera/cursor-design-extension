import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	applyPickMessage,
	type ChromePick,
	chooseMode,
	clearPick,
	type CommentPickState,
	INITIAL_COMMENT_PICK,
	keepLiveFrames,
	modeKeyAction,
	type ModeKeyInput,
	pickCounts,
	pressedMode,
} from './commentPick';
import { FRAME_MODES, type FrameMode, type PickEditFields } from './frame/frameMessages';

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
const pickIn = (frameId: string): ChromePick => ({
	frameId,
	sequence: 1,
	...pickFields,
});
const edit: PickEditFields = {
	sourceNumber: 3,
	sharedNumber: false,
	textState: 'plain',
	text: 'Card',
	style: null,
};
const commenting = (overrides: Partial<CommentPickState> = {}): CommentPickState => ({
	mode: 'comment',
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

test('hover and pick posted in Interact mode are ignored (a design script can post them)', () => {
	for (const message of [
		{ type: 'cd:hover', rect },
		{ type: 'cd:pick', ...pickFields },
		{ type: 'cd:pick', ...pickFields, edit },
	] as const) {
		const step = applyPickMessage({ state: INITIAL_COMMENT_PICK, frameId: 'a', message });
		assert.equal(step.state, INITIAL_COMMENT_PICK);
		assert.deepEqual(step.sends, []);
	}
});

test('pickCounts: a pick counts only when its edit fields match the mode', () => {
	const hover = { type: 'cd:hover', rect } as const;
	const commentPick = { type: 'cd:pick', ...pickFields } as const;
	const editPick = { type: 'cd:pick', ...pickFields, edit } as const;
	const table: Array<[FrameMode, boolean, boolean, boolean]> = [
		// mode, hover, pick without edit, pick with edit
		['interact', false, false, false],
		['comment', true, true, false],
		['edit', true, false, true],
	];
	for (const [mode, hoverCounts, commentCounts, editCounts] of table) {
		assert.equal(pickCounts({ mode, message: hover }), hoverCounts, `${mode} hover`);
		assert.equal(pickCounts({ mode, message: commentPick }), commentCounts, `${mode} pick`);
		assert.equal(pickCounts({ mode, message: editPick }), editCounts, `${mode} edit pick`);
	}
});

test('Edit mode keeps hover and an edit pick, drops a pick without edit; Comment drops one with', () => {
	const editing = commenting({ mode: 'edit' });
	const hovered = applyPickMessage({
		state: editing,
		frameId: 'a',
		message: { type: 'cd:hover', rect },
	});
	assert.deepEqual(hovered.state.hover, { frameId: 'a', rect });
	const picked = applyPickMessage({
		state: editing,
		frameId: 'a',
		message: { type: 'cd:pick', ...pickFields, edit },
	});
	assert.deepEqual(picked.state.pick, { frameId: 'a', sequence: 1, ...pickFields, edit });
	// A Comment-mode pick still in flight after the switch to Edit mode, and the reverse.
	const stale = applyPickMessage({
		state: editing,
		frameId: 'a',
		message: { type: 'cd:pick', ...pickFields },
	});
	assert.equal(stale.state, editing);
	assert.deepEqual(stale.sends, []);
	const forged = applyPickMessage({
		state: commenting(),
		frameId: 'a',
		message: { type: 'cd:pick', ...pickFields, edit },
	});
	assert.equal(forged.state.pick, undefined);
	assert.deepEqual(forged.sends, []);
	// The previous frame forgets its path with the current mode.
	const other = applyPickMessage({
		state: picked.state,
		frameId: 'b',
		message: { type: 'cd:pick', ...pickFields, edit },
	});
	assert.deepEqual(other.sends, [{ frameId: 'a', message: { type: 'cd:mode', mode: 'edit' } }]);
	// A reload in Edit mode re-sends edit.
	assert.deepEqual(
		applyPickMessage({ state: picked.state, frameId: 'a', message: { type: 'cd:ready' } }).sends,
		[{ frameId: 'a', message: { type: 'cd:mode', mode: 'edit' } }],
	);
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

test('choosing a mode forgets hover and pick and tells every frame', () => {
	const step = chooseMode({ mode: 'edit', frameIds: ['a', 'b'] });
	assert.deepEqual(step.state, { mode: 'edit', hover: undefined, pick: undefined });
	assert.deepEqual(step.sends, [
		{ frameId: 'a', message: { type: 'cd:mode', mode: 'edit' } },
		{ frameId: 'b', message: { type: 'cd:mode', mode: 'edit' } },
	]);
});

test('pressing the active mode returns to Interact; any other press chooses that mode', () => {
	for (const current of FRAME_MODES) {
		for (const pressed of FRAME_MODES) {
			assert.equal(
				pressedMode(current, pressed),
				pressed === current ? 'interact' : pressed,
				`${current} + ${pressed}`,
			);
		}
	}
});

test('frames leaving the stage take their hover and pick; an empty stage leaves Comment or Edit mode', () => {
	const state = commenting({ hover: { frameId: 'gone', rect }, pick: pickIn('kept') });
	const kept = keepLiveFrames({ state, liveFrameIds: new Set(['kept']) });
	assert.deepEqual(kept, { mode: 'comment', hover: undefined, pick: pickIn('kept') });
	assert.deepEqual(keepLiveFrames({ state, liveFrameIds: new Set() }), INITIAL_COMMENT_PICK);
	assert.deepEqual(
		keepLiveFrames({ state: commenting({ mode: 'edit' }), liveFrameIds: new Set() }),
		INITIAL_COMMENT_PICK,
	);
});

const keyInput = (overrides: Partial<ModeKeyInput> = {}): ModeKeyInput => ({
	key: 'c',
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	repeat: false,
	defaultPrevented: false,
	inTextEntry: false,
	mode: 'interact',
	hasFrames: true,
	popoverOpen: false,
	forwarded: false,
	...overrides,
});

test('c toggles only when nothing else owns the key and a frame is live', () => {
	assert.equal(modeKeyAction(keyInput()), 'toggle');
	// In Edit mode C presses Comment too.
	assert.equal(modeKeyAction(keyInput({ mode: 'edit' })), 'toggle');
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

test('Escape leaves Comment and Edit mode, and does nothing in Interact mode', () => {
	assert.equal(modeKeyAction(keyInput({ key: 'Escape', mode: 'comment' })), 'exit');
	assert.equal(modeKeyAction(keyInput({ key: 'Escape', mode: 'edit' })), 'exit');
	assert.equal(modeKeyAction(keyInput({ key: 'Escape', mode: 'interact' })), undefined);
	assert.equal(modeKeyAction(keyInput({ key: 'Enter', mode: 'comment' })), undefined);
});

test('with the popover open only a chrome Escape cancels; c and a forwarded Escape do nothing', () => {
	const open = { mode: 'comment', popoverOpen: true } as const;
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
