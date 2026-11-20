import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { mergeCanvasFrames } from './canvasFrames';
import { forwardedHistoryStep, historyKeyStep, historyTarget } from './undoRedo';

test('historyTarget names the frame and its flags, or nothing without one', () => {
	const frames = mergeCanvasFrames({
		records: [],
		frames: ['a', 'b'].map((id) => ({
			id,
			label: id === 'a' ? 'Desktop' : '',
			x: 0,
			y: 0,
			width: 400,
			generation: 1,
			hash: `sha256:${id}`,
			html: '<p>x</p>',
			canUndo: id === 'a',
			canRedo: false,
		})),
	});
	assert.deepEqual(historyTarget({ frames, frameId: 'a' }), {
		frameId: 'a',
		label: 'Desktop',
		canUndo: true,
		canRedo: false,
	});
	// An empty label falls back to the id, like every frame name.
	assert.equal(historyTarget({ frames, frameId: 'b' })?.label, 'b');
	assert.equal(historyTarget({ frames, frameId: undefined }), undefined);
	assert.equal(historyTarget({ frames, frameId: 'left' }), undefined);
});

test('Cmd/Ctrl+Z is undo and with Shift redo, in Edit mode only, never from a text field', () => {
	const press = (overrides: Partial<Parameters<typeof historyKeyStep>[0]> = {}) =>
		historyKeyStep({
			key: 'z',
			ctrlKey: false,
			metaKey: true,
			altKey: false,
			shiftKey: false,
			repeat: false,
			isComposing: false,
			inTextEntry: false,
			mode: 'edit',
			...overrides,
		});
	assert.equal(press(), 'undo');
	assert.equal(press({ metaKey: false, ctrlKey: true }), 'undo');
	assert.equal(press({ key: 'Z', shiftKey: true }), 'redo');
	assert.equal(press({ shiftKey: true }), 'redo');
	for (const blocked of [
		{ metaKey: false },
		{ altKey: true },
		{ repeat: true },
		{ isComposing: true },
		{ inTextEntry: true },
		{ key: 'y', ctrlKey: true },
		{ mode: 'interact' },
		{ mode: 'comment' },
	] as const) {
		assert.equal(press(blocked), undefined, JSON.stringify(blocked));
	}
});

test('a forwarded undo counts only from the focused history frame in Edit mode', () => {
	const forwarded = (overrides: Partial<Parameters<typeof forwardedHistoryStep>[0]> = {}) =>
		forwardedHistoryStep({
			key: 'undo',
			mode: 'edit',
			senderFrameId: 'a',
			historyFrameId: 'a',
			senderHasFocus: true,
			...overrides,
		});
	assert.equal(forwarded(), 'undo');
	assert.equal(forwarded({ key: 'redo' }), 'redo');
	for (const blocked of [
		{ mode: 'comment' },
		{ senderFrameId: 'b' },
		{ historyFrameId: undefined },
		{ senderHasFocus: false },
	] as const) {
		assert.equal(forwarded(blocked), undefined, JSON.stringify(blocked));
	}
});
