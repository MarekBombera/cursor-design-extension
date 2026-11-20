import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import {
	MAX_COMMENTS,
	MAX_EDIT_TEXT_CHARS,
	MAX_PICK_STYLE_CHARS,
	MAX_SELECTOR_CHARS,
} from '../../disk/layout';
import type { ChromeMessage, HostMessage } from '../hostMessages';
import {
	FRAME_ANCHORS_MESSAGE,
	FRAME_ANCHOR_RECTS_MESSAGE,
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
	EDIT_APPLY_MESSAGE,
	parseChromeFrameMessage,
	PICK_REFRESH_MESSAGE,
	parseFrameMessage,
	parsePickFields,
	toOneLine,
} from './frameMessages';
import * as frameMessages from './frameMessages';

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

test('toOneLine collapses breakers and bidi controls, trims, and never cuts a surrogate pair', () => {
	assert.equal(toOneLine(' a\n\tb\u2028c\u202Ed  ', 100), 'a b c d');
	// The cap lands inside the emoji (high surrogate kept at index 2): drop it and the space before.
	assert.equal(toOneLine('ab \u{1F600}cd', 4), 'ab');
	assert.equal(toOneLine('ab\u{1F600}', 4), 'ab\u{1F600}');
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
	// An old pick shape, without selector, text, point, box or styles.
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

test('parsePickFields keeps the pick fields without type and repost, with the same guards', () => {
	const { type: _type, repost: _repost, ...fields } = pick;
	assert.deepEqual(parsePickFields({ ...fields, extra: 1 }), fields);
	assert.equal(parsePickFields({ ...fields, selector: '.a\n' }), undefined);
	assert.equal(parsePickFields({ ...fields, isPage: true }), undefined);
});

const edit = {
	sourceNumber: 7,
	sharedNumber: false,
	textState: 'plain',
	text: '\n    Title\n',
	style: 'font-size: 32px;\n color: #ff0000',
} as const;

test('cd:pick rebuilds its edit fields and drops extra keys inside them', () => {
	assert.deepEqual(parseFrameMessage({ ...pick, edit: { ...edit, extra: 1 } }), { ...pick, edit });
	for (const fields of [
		{ ...edit, sourceNumber: null, style: null },
		{ ...edit, sourceNumber: 0, sharedNumber: true },
		{ ...edit, sourceNumber: Number.MAX_SAFE_INTEGER },
		{ ...edit, textState: 'children', text: '' },
		{ ...edit, textState: 'too-long', text: '' },
		{ ...edit, text: 'a'.repeat(MAX_EDIT_TEXT_CHARS) },
		{ ...edit, style: 'a'.repeat(MAX_PICK_STYLE_CHARS) },
		{ ...edit, style: '' },
	]) {
		assert.deepEqual(parseFrameMessage({ ...pick, edit: fields }), { ...pick, edit: fields });
	}
	// A Comment-mode pick (no edit) parses without an edit key.
	assert.equal('edit' in (parseFrameMessage(pick) ?? {}), false);
});

test('cd:pick with a bad edit field is rejected whole', () => {
	for (const fields of [
		null,
		[],
		'edit',
		{ ...edit, sourceNumber: -1 },
		{ ...edit, sourceNumber: 1.5 },
		{ ...edit, sourceNumber: '3' },
		{ ...edit, sourceNumber: Number.MAX_SAFE_INTEGER + 1 },
		{ ...edit, sourceNumber: undefined },
		{ ...edit, sourceNumber: null, sharedNumber: true },
		{ ...edit, sharedNumber: 'no' },
		{ ...edit, textState: 'mixed' },
		{ ...edit, textState: 'children', text: 'x' },
		{ ...edit, textState: 'too-long', text: 'x' },
		{ ...edit, text: 'a'.repeat(MAX_EDIT_TEXT_CHARS + 1) },
		{ ...edit, text: 3 },
		{ ...edit, style: 3 },
		{ ...edit, style: undefined },
		{ ...edit, style: 'a'.repeat(MAX_PICK_STYLE_CHARS + 1) },
	]) {
		assert.equal(parseFrameMessage({ ...pick, edit: fields }), undefined, JSON.stringify(fields));
	}
});

test('cd:key accepts exactly c, Escape, undo and redo', () => {
	for (const key of ['c', 'Escape', 'undo', 'redo'] as const) {
		assert.deepEqual(parseFrameMessage({ type: FRAME_KEY_MESSAGE, key, extra: 1 }), {
			type: FRAME_KEY_MESSAGE,
			key,
		});
	}
	for (const key of ['C', 'Enter', 'z', 'Undo', 7, undefined]) {
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
	for (const mode of ['interact', 'comment', 'edit'] as const) {
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
		{ type: FRAME_MODE_MESSAGE, mode: 'Edit' },
		{ type: FRAME_MODE_MESSAGE },
		{ type: FRAME_PICK_MESSAGE },
		{ type: 'cd:anchors' },
	]) {
		assert.equal(parseChromeFrameMessage(value), undefined, JSON.stringify(value));
	}
});

test('cd:pick-refresh and cd:edit-apply: one of text or style, a real source number', () => {
	assert.deepEqual(parseChromeFrameMessage({ type: PICK_REFRESH_MESSAGE, extra: 1 }), {
		type: PICK_REFRESH_MESSAGE,
	});
	assert.deepEqual(
		parseChromeFrameMessage({ type: EDIT_APPLY_MESSAGE, sourceNumber: 0, text: '', extra: 1 }),
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 0, text: '' },
	);
	assert.deepEqual(
		parseChromeFrameMessage({ type: EDIT_APPLY_MESSAGE, sourceNumber: 7, style: 'color: red' }),
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 7, style: 'color: red' },
	);
	for (const value of [
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 1 },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 1, text: 'a', style: 'b' },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: null, text: 'a' },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: -1, text: 'a' },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 1.5, text: 'a' },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: '1', text: 'a' },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 1, text: 3 },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 1, text: 'a'.repeat(MAX_EDIT_TEXT_CHARS + 1) },
		{ type: EDIT_APPLY_MESSAGE, sourceNumber: 1, style: 'a'.repeat(MAX_PICK_STYLE_CHARS + 1) },
	]) {
		assert.equal(parseChromeFrameMessage(value), undefined, JSON.stringify(value).slice(0, 80));
	}
});

test('cd:anchors rebuilds its entries and rejects the whole list on one bad entry', () => {
	const request = { id: 'c1', selector: 'main > h1' };
	assert.deepEqual(
		parseChromeFrameMessage({
			type: FRAME_ANCHORS_MESSAGE,
			anchors: [{ ...request, extra: 1 }],
			extra: 1,
		}),
		{ type: FRAME_ANCHORS_MESSAGE, anchors: [request] },
	);
	// `__proto__` is a valid id: it stays a plain string on a rebuilt entry, never a prototype.
	const proto = parseChromeFrameMessage({
		type: FRAME_ANCHORS_MESSAGE,
		anchors: [JSON.parse('{"id":"__proto__","selector":"p"}') as unknown],
	});
	assert.deepEqual(proto, {
		type: FRAME_ANCHORS_MESSAGE,
		anchors: [{ id: '__proto__', selector: 'p' }],
	});
	assert.equal(
		Object.getPrototypeOf(proto?.type === FRAME_ANCHORS_MESSAGE ? proto.anchors[0] : {}),
		Object.prototype,
	);
	const tooMany = Array.from({ length: MAX_COMMENTS + 1 }, () => request);
	for (const anchors of [
		[{ ...request, id: 'c 1' }],
		[{ ...request, id: 'x'.repeat(65) }],
		[{ ...request, selector: 'x'.repeat(MAX_SELECTOR_CHARS + 1) }],
		[{ ...request, selector: 'h1\nh2' }],
		[{ ...request, selector: null }],
		[{ ...request, selector: '' }],
		[request, 'c2'],
		tooMany,
		{ 0: request },
		undefined,
	]) {
		assert.equal(
			parseChromeFrameMessage({ type: FRAME_ANCHORS_MESSAGE, anchors }),
			undefined,
			JSON.stringify(anchors)?.slice(0, 80),
		);
	}
	assert.equal(
		parseChromeFrameMessage({ type: FRAME_ANCHORS_MESSAGE, anchors: tooMany.slice(1) })?.type,
		FRAME_ANCHORS_MESSAGE,
	);
});

test('cd:anchor-rects needs valid rects, and box null with visible null', () => {
	const rect = { x: 1, y: 2, width: 3, height: 4 };
	assert.deepEqual(
		parseFrameMessage({
			type: FRAME_ANCHOR_RECTS_MESSAGE,
			anchors: [
				{ id: 'c1', box: rect, visible: null, extra: 1 },
				{ id: 'c2', box: null, visible: null },
			],
		}),
		{
			type: FRAME_ANCHOR_RECTS_MESSAGE,
			anchors: [
				{ id: 'c1', box: rect, visible: null },
				{ id: 'c2', box: null, visible: null },
			],
		},
	);
	const tooMany = Array.from({ length: MAX_COMMENTS + 1 }, () => ({
		id: 'c1',
		box: null,
		visible: null,
	}));
	for (const anchors of [
		[{ id: 'c1', box: null, visible: rect }],
		[{ id: 'c1', box: { ...rect, width: -1 }, visible: null }],
		[{ id: 'c1', box: rect }],
		[{ id: 'bad id', box: null, visible: null }],
		tooMany,
		'c1',
	]) {
		assert.equal(
			parseFrameMessage({ type: FRAME_ANCHOR_RECTS_MESSAGE, anchors }),
			undefined,
			JSON.stringify(anchors).slice(0, 80),
		);
	}
});

const contractSection = (): string => {
	const map = readFileSync(join(process.cwd(), 'blueprint/context/system-map.md'), 'utf8');
	const start = map.indexOf('## Message contract (shipped)');
	assert.ok(start >= 0);
	const next = map.indexOf('\n## ', start + 1);
	return map.slice(start, next < 0 ? undefined : next);
};

test('system map message contract names exactly the frame messages', () => {
	const section = contractSection();
	const constants = Object.entries(frameMessages)
		.filter(
			([name, value]) =>
				name.endsWith('_MESSAGE') && typeof value === 'string' && value.startsWith('cd:'),
		)
		.map(([, value]) => value);
	assert.ok(constants.length > 0);
	assert.deepEqual(new Set(section.match(/cd:[a-z-]+/g)), new Set(constants));
});

// A new message type fails type-checking here as a missing property, a removed one as an excess
// property, so these lists stay exactly the unions.
const HOST_TO_CHROME: Record<HostMessage['type'], true> = {
	'canvas:updated': true,
	'artboard:error': true,
	'ui:status': true,
	'comments:updated': true,
	'comment:added': true,
	'comment:saved': true,
	'ui:copied': true,
	'artboard:edited': true,
	'ui:error': true,
};
const CHROME_TO_HOST: Record<ChromeMessage['type'], true> = {
	'artboard:ready': true,
	'frame:place': true,
	'comment:create': true,
	'comment:reply': true,
	'comment:set-status': true,
	'comment:copy': true,
	'comment:copy-open': true,
	'artboard:edit': true,
	'artboard:history': true,
};

test('system map message contract names exactly the host and chrome messages', () => {
	const named = new Map<string, Set<string>>([
		['host → chrome', new Set()],
		['chrome → host', new Set()],
	]);
	for (const [, direction, cell] of contractSection().matchAll(
		/^\| (host → chrome|chrome → host) \| ([^|]+) \|/gm,
	)) {
		for (const [, name] of cell.matchAll(/`([^`]+)`/g)) {
			named.get(direction)?.add(name);
		}
	}
	assert.deepEqual(named.get('host → chrome'), new Set(Object.keys(HOST_TO_CHROME)));
	assert.deepEqual(named.get('chrome → host'), new Set(Object.keys(CHROME_TO_HOST)));
});
