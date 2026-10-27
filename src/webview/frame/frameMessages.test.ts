import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import {
	FRAME_HEIGHT_MESSAGE,
	FRAME_HOVER_MESSAGE,
	FRAME_KEY_MESSAGE,
	FRAME_MODE_MESSAGE,
	FRAME_PICK_MESSAGE,
	FRAME_READY_MESSAGE,
	FRAME_WHEEL_MESSAGE,
	PICK_CHILD_MESSAGE,
	PICK_PARENT_MESSAGE,
	hasControlChars,
	isSafeStyleValue,
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

test('hasControlChars covers C0, DEL, C1 and the Unicode line separators', () => {
	for (const value of ['\u0000', 'a\nb', '\u007f', '\u0085', '\u009f', '\u2028', '\u2029']) {
		assert.equal(hasControlChars(value), true, JSON.stringify(value));
	}
	for (const value of [' ', 'é']) {
		assert.equal(hasControlChars(value), false, value);
	}
});

test('isSafeStyleValue allows computed-style text, not markup, breaks or oversize', () => {
	for (const value of [
		'rgb(0, 0, 0)',
		'"Inter", system-ui, -apple-system, sans-serif',
		'color(srgb 1 0 0 / 0.5)',
		'"ヒラギノ角ゴ ProN W3", "Noto Sans CJK JP", sans-serif',
		'calc(100% + 10px)',
	]) {
		assert.equal(isSafeStyleValue(value), true, value);
	}
	for (const value of [';', '{', '<', ':', '\t', '\n', '\u2028', '', ' ', '   ', 'a'.repeat(201)]) {
		assert.equal(isSafeStyleValue(value), false, JSON.stringify(value));
	}
});

const rect = { x: 1, y: -2, width: 30, height: 40 };
const pick = {
	type: FRAME_PICK_MESSAGE,
	selector: '.card:nth-of-type(3)',
	tagName: 'my-card2',
	text: 'Card',
	rect,
	point: { x: 5, y: 6 },
	box: { width: 30, height: 80 },
	styles: { color: 'rgb(0, 0, 0)', 'font-family': '"Inter", sans-serif' },
	isPage: false,
	repost: false,
};
const pagePick = { ...pick, selector: 'body', tagName: 'body', text: '', rect: null, isPage: true };

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
	assert.deepEqual(
		parseFrameMessage({ ...pick, point: { ...pick.point, extra: 1 }, extra: 1 }),
		pick,
	);
	assert.deepEqual(parseFrameMessage(pagePick), pagePick);
});

test('cd:pick accepts a null selector, empty text and styles, and fields at their caps', () => {
	for (const valid of [
		{ selector: null },
		{ text: '' },
		{ styles: {} },
		{ selector: 'a'.repeat(1000) },
		{ text: 'a'.repeat(200) },
	]) {
		assert.deepEqual(
			parseFrameMessage({ ...pick, ...valid }),
			{ ...pick, ...valid },
			JSON.stringify(valid),
		);
	}
});

test('cd:pick rejects bad selectors, text, styles, points and page labels', () => {
	for (const broken of [
		{ selector: 'a'.repeat(1001) },
		{ selector: '' },
		{ selector: '.a\n.b' },
		{ selector: '.a\r' },
		{ selector: '.a\u0000' },
		{ selector: '.a\u007f' },
		{ selector: '.a\u2028' },
		{ selector: undefined },
		{ selector: 42 },
		{ text: 7 },
		{ text: 'a\u0085b' },
		{ text: 'a'.repeat(201) },
		{ text: 'a\nb' },
		{ styles: { 'z-index': '1' } },
		{ styles: { color: 'red; background: url(x)' } },
		{ styles: { color: 0 } },
		{ styles: { color: ' ' } },
		{ styles: JSON.parse('{"__proto__": "red"}') as unknown },
		{ styles: { constructor: 'red' } },
		{ styles: ['red'] },
		{ styles: null },
		{ point: { x: Number.NaN, y: 0 } },
		{ point: { x: 0, y: Number.POSITIVE_INFINITY } },
		{ point: { x: -1, y: 0 } },
		{ point: { x: 0, y: 100_001 } },
		{ point: undefined },
	]) {
		assert.equal(parseFrameMessage({ ...pick, ...broken }), undefined, JSON.stringify(broken));
	}
	for (const broken of [{ selector: '.card' }, { selector: null }, { tagName: 'div' }]) {
		assert.equal(parseFrameMessage({ ...pagePick, ...broken }), undefined, JSON.stringify(broken));
	}
	// The 8d1 shape.
	assert.equal(
		parseFrameMessage({ type: FRAME_PICK_MESSAGE, tagName: 'div', rect, isPage: false }),
		undefined,
	);
});

test('cd:pick needs repost and a finite, non-negative box', () => {
	assert.deepEqual(parseFrameMessage({ ...pick, repost: true }), { ...pick, repost: true });
	const { repost: _repost, ...withoutRepost } = pick;
	const { box: _box, ...withoutBox } = pick;
	for (const broken of [
		withoutRepost,
		withoutBox,
		{ ...pick, repost: 'false' },
		{ ...pick, box: { width: -1, height: 10 } },
		{ ...pick, box: { width: 10, height: Number.NaN } },
		{ ...pick, box: { width: 10 } },
	]) {
		assert.equal(parseFrameMessage(broken), undefined, JSON.stringify(broken));
	}
});

test('cd:key accepts exactly c and Escape', () => {
	for (const key of ['c', 'Escape'] as const) {
		assert.deepEqual(parseFrameMessage({ type: FRAME_KEY_MESSAGE, key, extra: 1 }), {
			type: FRAME_KEY_MESSAGE,
			key,
		});
	}
	for (const key of ['C', 'Enter', 7, undefined]) {
		assert.equal(parseFrameMessage({ type: FRAME_KEY_MESSAGE, key }), undefined, String(key));
	}
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
	const ruleLine = `5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: \`parseChromeMessage\`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure), comment:create { requestId, frameId, generation, selector, tagName, text, rect|null, point, box, styles, isPage, body } (chrome → host, untrusted: \`parseChromeMessage\`, then \`addComment\`; refused in untrusted workspaces; every attempt with a valid requestId answered once, never replayed: comment:added { requestId } or ui:error { message, requestId? }); canvas:updated (frames carry \`generation\`)|artboard:error, ui:status, comments:updated { comments, error? } (host → chrome; comments:updated is held until artboard:ready and re-sent on reload like canvas:updated, and its \`error\` is the comments banner, never a blank stage). iframe → chrome, allowlisted by source and typed (\`parseFrameMessage\`): ${FRAME_HEIGHT_MESSAGE} { height }, ${FRAME_WHEEL_MESSAGE} { deltaX, deltaY, ctrlKey, x, y }, ${FRAME_READY_MESSAGE}, ${FRAME_HOVER_MESSAGE} { rect|null }, ${FRAME_PICK_MESSAGE} { selector|null, tagName, text, rect|null, point, box, styles, isPage, repost } (\`rect\` is frame-local CSS px; \`point\` is CSS px relative to the current target's border box and \`box\` is that box's unclipped size; \`repost\` is true for a scroll or resize re-post, false for a click or step; chrome drops ${FRAME_HOVER_MESSAGE} and ${FRAME_PICK_MESSAGE} outside Comment mode), ${FRAME_KEY_MESSAGE} { key: c|Escape } (C or Escape with frame focus, not from editable targets or with Ctrl/Meta/Alt; the chrome's mode-key rule decides). Chrome → iframe (runtime accepts only from the parent it captured at load, \`parseChromeFrameMessage\`): ${FRAME_MODE_MESSAGE} { mode: interact|comment }, ${PICK_PARENT_MESSAGE}, ${PICK_CHILD_MESSAGE}.\n`;
	assert.ok(ruleSource.includes(ruleLine));
});
