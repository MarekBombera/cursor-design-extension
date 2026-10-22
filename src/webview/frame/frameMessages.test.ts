import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { FRAME_HEIGHT_MESSAGE, FRAME_WHEEL_MESSAGE, parseFrameMessage } from './frameMessages';

const wheel = { type: FRAME_WHEEL_MESSAGE, deltaX: 1, deltaY: -2, ctrlKey: false, x: 3, y: 4 };

test('frame height needs a finite height', () => {
	assert.deepEqual(parseFrameMessage({ type: FRAME_HEIGHT_MESSAGE, height: 900, extra: 1 }), {
		type: FRAME_HEIGHT_MESSAGE,
		height: 900,
	});
	for (const height of [undefined, '900', Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.equal(parseFrameMessage({ type: FRAME_HEIGHT_MESSAGE, height }), undefined);
	}
});

test('frame wheel needs finite deltas and position and a boolean ctrlKey', () => {
	assert.deepEqual(parseFrameMessage({ ...wheel, extra: 1 }), wheel);
	assert.deepEqual(parseFrameMessage({ ...wheel, ctrlKey: true }), { ...wheel, ctrlKey: true });
	for (const broken of [
		{ deltaX: Number.NaN },
		{ deltaY: '1' },
		{ x: undefined },
		{ y: Number.NEGATIVE_INFINITY },
		{ ctrlKey: 1 },
		{ ctrlKey: undefined },
	]) {
		assert.equal(parseFrameMessage({ ...wheel, ...broken }), undefined, JSON.stringify(broken));
	}
});

test('non-objects and other types are rejected', () => {
	for (const value of [null, undefined, 'cd:frame-height', 1, {}, { type: 'canvas:wheel' }]) {
		assert.equal(parseFrameMessage(value), undefined);
	}
});

test('rule 02 message line names exactly these frame messages', () => {
	const ruleSource = readFileSync(join(process.cwd(), '.claude/rules/02-mcp-webview.md'), 'utf8');
	const ruleLine = `5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: \`parseChromeMessage\`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure); canvas:updated (frames carry \`generation\`)|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed: ${FRAME_HEIGHT_MESSAGE} { height }, ${FRAME_WHEEL_MESSAGE} { deltaX, deltaY, ctrlKey, x, y } (frame-local CSS px). Chrome → iframe: none.`;
	assert.ok(ruleSource.includes(ruleLine));
});
