import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import {
	FRAME_HEIGHT_MESSAGE,
	FRAME_HOVER_MESSAGE,
	FRAME_MODE_MESSAGE,
	FRAME_PICK_MESSAGE,
	FRAME_READY_MESSAGE,
	FRAME_WHEEL_MESSAGE,
	PICK_CHILD_MESSAGE,
	PICK_PARENT_MESSAGE,
	parseChromeFrameMessage,
	parseFrameMessage,
} from './frameMessages';

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

const rect = { x: 1, y: -2, width: 30, height: 40 };
const pick = { type: FRAME_PICK_MESSAGE, tagName: 'my-card2', rect, isPage: false };

test('cd:ready, cd:hover and cd:pick rebuild without extra fields', () => {
	assert.deepEqual(parseFrameMessage({ type: FRAME_READY_MESSAGE, extra: 1 }), {
		type: FRAME_READY_MESSAGE,
	});
	assert.deepEqual(
		parseFrameMessage({ type: FRAME_HOVER_MESSAGE, rect: { ...rect, extra: 1 }, extra: 1 }),
		{ type: FRAME_HOVER_MESSAGE, rect },
	);
	assert.deepEqual(parseFrameMessage({ type: FRAME_HOVER_MESSAGE, rect: null }), {
		type: FRAME_HOVER_MESSAGE,
		rect: null,
	});
	assert.deepEqual(parseFrameMessage({ ...pick, extra: 1 }), pick);
	assert.deepEqual(parseFrameMessage({ ...pick, rect: null, isPage: true }), {
		...pick,
		rect: null,
		isPage: true,
	});
});

test('cd:pick rejects bad tags, rects and isPage', () => {
	for (const broken of [
		{ tagName: 'a'.repeat(65) },
		{ tagName: 'DIV' },
		{ tagName: 'div\n' },
		{ tagName: 'di\u0007v' },
		{ tagName: '' },
		{ tagName: 1 },
		{ isPage: 'false' },
		{ isPage: undefined },
		{ rect: undefined },
	]) {
		assert.equal(parseFrameMessage({ ...pick, ...broken }), undefined, JSON.stringify(broken));
	}
	assert.deepEqual(parseFrameMessage({ ...pick, tagName: 'a'.repeat(64) }), {
		...pick,
		tagName: 'a'.repeat(64),
	});
});

test('rects must be finite, non-negative in size and within the coordinate cap', () => {
	for (const broken of [
		{ x: Number.NaN },
		{ y: Number.POSITIVE_INFINITY },
		{ width: -1 },
		{ height: 100_001 },
		{ x: -100_001 },
		{ width: '1' },
	]) {
		const message = { type: FRAME_HOVER_MESSAGE, rect: { ...rect, ...broken } };
		assert.equal(parseFrameMessage(message), undefined, JSON.stringify(broken));
		assert.equal(parseFrameMessage({ ...pick, rect: { ...rect, ...broken } }), undefined);
	}
	assert.equal(parseFrameMessage({ type: FRAME_HOVER_MESSAGE }), undefined);
	assert.equal(parseFrameMessage({ type: FRAME_HOVER_MESSAGE, rect: 'none' }), undefined);
});

test('parseChromeFrameMessage accepts only the mode and step commands', () => {
	for (const mode of ['interact', 'comment'] as const) {
		assert.deepEqual(parseChromeFrameMessage({ type: FRAME_MODE_MESSAGE, mode, extra: 1 }), {
			type: FRAME_MODE_MESSAGE,
			mode,
		});
	}
	assert.deepEqual(parseChromeFrameMessage({ type: PICK_PARENT_MESSAGE, extra: 1 }), {
		type: PICK_PARENT_MESSAGE,
	});
	assert.deepEqual(parseChromeFrameMessage({ type: PICK_CHILD_MESSAGE }), {
		type: PICK_CHILD_MESSAGE,
	});
	for (const value of [
		null,
		'cd:mode',
		{ type: FRAME_MODE_MESSAGE, mode: 'edit' },
		{ type: FRAME_MODE_MESSAGE },
		{ type: FRAME_PICK_MESSAGE },
		{ type: 'cd:anchors' },
	]) {
		assert.equal(parseChromeFrameMessage(value), undefined, JSON.stringify(value));
	}
});

test('rule 02 message line names exactly these frame messages', () => {
	const ruleSource = readFileSync(join(process.cwd(), '.claude/rules/02-mcp-webview.md'), 'utf8');
	const ruleLine = `5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: \`parseChromeMessage\`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure); canvas:updated (frames carry \`generation\`)|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed (\`parseFrameMessage\`): ${FRAME_HEIGHT_MESSAGE} { height }, ${FRAME_WHEEL_MESSAGE} { deltaX, deltaY, ctrlKey, x, y }, ${FRAME_READY_MESSAGE}, ${FRAME_HOVER_MESSAGE} { rect|null }, ${FRAME_PICK_MESSAGE} { tagName, rect|null, isPage } (frame-local CSS px; chrome drops ${FRAME_HOVER_MESSAGE} and ${FRAME_PICK_MESSAGE} outside Comment mode). Chrome → iframe (runtime accepts only from the parent it captured at load, \`parseChromeFrameMessage\`): ${FRAME_MODE_MESSAGE} { mode: interact|comment }, ${PICK_PARENT_MESSAGE}, ${PICK_CHILD_MESSAGE}.\n`;
	assert.ok(ruleSource.includes(ruleLine));
});
