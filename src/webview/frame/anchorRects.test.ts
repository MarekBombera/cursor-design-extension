import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { MAX_FRAME_COORDINATE } from '../../disk/layout';
import { anchorsMoved, capAnchorRect } from './anchorRects';
import { type AnchorRect, parseFrameMessage } from './frameMessages';

const rect = { x: 10, y: 20, width: 100, height: 40 };

const anchor = (overrides: Partial<AnchorRect> = {}): AnchorRect => ({
	id: 'c1',
	box: rect,
	visible: rect,
	...overrides,
});

test('anchorsMoved: exactly 0.5px is not a move, 0.51px is', () => {
	const last = [anchor()];
	assert.equal(anchorsMoved({ last, next: [anchor({ box: { ...rect, x: 10.5 } })] }), false);
	assert.equal(anchorsMoved({ last, next: [anchor({ box: { ...rect, height: 39.49 } })] }), true);
	assert.equal(anchorsMoved({ last, next: [anchor({ box: { ...rect, y: 20.51 } })] }), true);
});

test('anchorsMoved: a null flip, a visible-only change and a changed id list are moves', () => {
	const last = [anchor()];
	assert.equal(anchorsMoved({ last, next: [anchor({ box: null, visible: null })] }), true);
	assert.equal(anchorsMoved({ last: [anchor({ visible: null })], next: last }), true);
	assert.equal(anchorsMoved({ last, next: [anchor({ visible: { ...rect, width: 50 } })] }), true);
	assert.equal(anchorsMoved({ last, next: [anchor({ id: 'c2' })] }), true);
	assert.equal(anchorsMoved({ last, next: [anchor(), anchor({ id: 'c2' })] }), true);
	assert.equal(anchorsMoved({ last, next: [anchor()] }), false);
});

test('anchorsMoved: empty to empty is quiet; nothing posted yet always moves', () => {
	assert.equal(anchorsMoved({ last: [], next: [] }), false);
	assert.equal(anchorsMoved({ last: undefined, next: [] }), true);
});

test('capAnchorRect keeps a 150000px box inside the chrome guard', () => {
	const capped = capAnchorRect({ x: -150_000, y: 0, width: 150_000, height: 150_000 });
	assert.deepEqual(capped, {
		x: -MAX_FRAME_COORDINATE,
		y: 0,
		width: MAX_FRAME_COORDINATE,
		height: MAX_FRAME_COORDINATE,
	});
	const posted = { type: 'cd:anchor-rects', anchors: [anchor({ box: capped, visible: null })] };
	assert.notEqual(parseFrameMessage(posted), undefined);
});
