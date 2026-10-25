import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	clipRect,
	isTransparentColor,
	isUnchangedPick,
	paintsFromStyle,
	pickTarget,
	pointInTarget,
} from './pickTarget';

type Node = { name: string; parent?: Node; paints: boolean };

const node = (name: string, parent?: Node, paints = true): Node => ({ name, parent, paints });

const html = node('html');
const body = node('body', html);

const contains = (ancestor: Node, element: Node): boolean => {
	for (let current: Node | undefined = element; current; current = current.parent) {
		if (current === ancestor) {
			return true;
		}
	}
	return false;
};

const pick = (stack: Node[], resolve: (element: Node) => Node = (element) => element) =>
	pickTarget({
		stack,
		resolve,
		isRoot: (element) => element === html || element === body,
		paints: (element) => element.paints,
		contains,
	});

test('a transparent overlay above an unrelated sibling picks the sibling', () => {
	const overlay = node('overlay', body, false);
	const sibling = node('sibling', body);
	assert.equal(pick([overlay, sibling, body, html]), sibling);
});

test('a transparent section with only its ancestors below is kept', () => {
	const section = node('section', body, false);
	assert.equal(pick([section, body, html]), section);
});

test('a path inside an svg picks the svg', () => {
	const svg = node('svg', body);
	const path = node('path', svg);
	const resolve = (element: Node): Node => (element === path ? svg : element);
	assert.equal(pick([path, svg, body, html], resolve), svg);
});

test('an empty stack and an html/body-only stack are page picks', () => {
	assert.equal(pick([]), undefined);
	assert.equal(pick([body, html]), undefined);
});

test('a zero-size element over a sibling picks the sibling', () => {
	const empty = node('empty', body, false);
	const sibling = node('sibling', body);
	assert.equal(pick([empty, sibling, body, html]), sibling);
});

test('a painting element on top picks itself', () => {
	const card = node('card', body);
	const sibling = node('sibling', body);
	assert.equal(pick([card, sibling, body, html]), card);
});

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

test('clipRect intersects with every clip and nulls an empty result', () => {
	const viewport = rect(0, 0, 100, 100);
	assert.deepEqual(clipRect(rect(10, 10, 20, 20), [viewport]), rect(10, 10, 20, 20));
	assert.deepEqual(clipRect(rect(-10, 90, 30, 30), [viewport]), rect(0, 90, 20, 10));
	assert.equal(clipRect(rect(200, 200, 10, 10), [viewport]), null);
	assert.equal(clipRect(rect(10, 10, 0, 20), [viewport]), null);
	assert.deepEqual(
		clipRect(rect(0, 0, 100, 100), [rect(10, 0, 100, 100), rect(0, 20, 50, 100)]),
		rect(10, 20, 40, 80),
	);
});

const transparentStyle = {
	backgroundColor: 'rgba(0, 0, 0, 0)',
	backgroundImage: 'none',
	boxShadow: 'none',
	borderTopWidth: '0px',
	borderRightWidth: '0px',
	borderBottomWidth: '0px',
	borderLeftWidth: '0px',
	borderTopColor: 'rgb(0, 0, 0)',
	borderRightColor: 'rgb(0, 0, 0)',
	borderBottomColor: 'rgb(0, 0, 0)',
	borderLeftColor: 'rgb(0, 0, 0)',
};

const paints = (overrides: {
	localName?: string;
	width?: number;
	height?: number;
	hasOwnText?: boolean;
	style?: Partial<typeof transparentStyle>;
}): boolean =>
	paintsFromStyle({
		localName: overrides.localName ?? 'div',
		width: overrides.width ?? 10,
		height: overrides.height ?? 10,
		hasOwnText: overrides.hasOwnText ?? false,
		style: { ...transparentStyle, ...overrides.style },
	});

test('paintsFromStyle is false for zero size and for an all-transparent style', () => {
	assert.equal(paints({}), false);
	assert.equal(paints({ width: 0, hasOwnText: true }), false);
	assert.equal(paints({ height: 0, localName: 'img' }), false);
	assert.equal(
		paints({ style: { borderTopWidth: '2px', borderTopColor: 'rgba(0, 0, 0, 0)' } }),
		false,
	);
});

test('paintsFromStyle is true for any visible paint', () => {
	assert.equal(paints({ style: { backgroundColor: 'rgb(255, 0, 0)' } }), true);
	assert.equal(paints({ style: { backgroundColor: 'rgba(0, 0, 0, 0.5)' } }), true);
	assert.equal(paints({ style: { backgroundImage: 'url("a.png")' } }), true);
	assert.equal(
		paints({ style: { borderLeftWidth: '1px', borderLeftColor: 'rgb(0, 0, 0)' } }),
		true,
	);
	assert.equal(paints({ style: { boxShadow: 'rgb(0, 0, 0) 0px 1px 2px 0px' } }), true);
	assert.equal(paints({ hasOwnText: true }), true);
	assert.equal(paints({ localName: 'svg' }), true);
	assert.equal(paints({ localName: 'button' }), true);
});

test('isTransparentColor matches only zero alpha', () => {
	for (const color of [
		'transparent',
		'rgba(1, 2, 3, 0)',
		'rgba(0, 0, 0, 0.0)',
		'hsla(0, 0%, 0%, 0%)',
		'color(srgb 1 0 0 / 0)',
		'oklch(0.5 0.1 20 / 0%)',
	]) {
		assert.equal(isTransparentColor(color), true, color);
	}
	for (const color of [
		'rgb(1, 2, 3)',
		'rgb(255, 0, 0)',
		'rgba(0, 0, 0, 0.5)',
		'oklch(0.5 0.1 20)',
		'color(srgb 1 0 0 / 0.05)',
	]) {
		assert.equal(isTransparentColor(color), false, color);
	}
});

test('pointInTarget keeps the click inside the current target box', () => {
	const offset = { x: 5, y: 6 };
	const box = rect(100, 200, 50, 40);
	assert.deepEqual(pointInTarget({ anchorBox: box, offset, targetBox: box }), offset);
	// Parent box starts 10px left and 20px above the clicked child.
	assert.deepEqual(pointInTarget({ anchorBox: box, offset, targetBox: rect(90, 180, 200, 200) }), {
		x: 15,
		y: 26,
	});
	assert.deepEqual(pointInTarget({ anchorBox: box, offset: { x: -30, y: 500 }, targetBox: box }), {
		x: 0,
		y: 40,
	});
	assert.deepEqual(
		pointInTarget({
			anchorBox: rect(0, 0, 10, 10),
			offset: { x: 200_000, y: 300_000 },
			targetBox: rect(0, 0, 250_000, 400_000),
		}),
		{ x: 100_000, y: 100_000 },
	);
	assert.deepEqual(pointInTarget({ anchorBox: box, offset, targetBox: rect(120, 210, 0, 0) }), {
		x: 0,
		y: 0,
	});
});

test('isUnchangedPick is true only for the same element, description, rect and point', () => {
	const element = { name: 'card' };
	const described = { selector: '.card' };
	const last = { element, described, rect: rect(10, 20, 30, 40), point: { x: 5, y: 6 } };
	const unchanged = (next: Partial<typeof last>): boolean =>
		isUnchangedPick({ last, next: { ...last, ...next } });
	assert.equal(unchanged({}), true);
	assert.equal(unchanged({ rect: rect(10, 20, 30, 40), point: { x: 5, y: 6 } }), true);
	assert.equal(unchanged({ described: { selector: '.card' } }), false);
	assert.equal(unchanged({ rect: rect(11, 20, 30, 40) }), false);
	// sameRect is the only check that sees a scroll moving anchor and target together.
	assert.equal(unchanged({ rect: rect(10, 21, 30, 40) }), false);
	assert.equal(unchanged({ rect: rect(10, 20, 31, 40) }), false);
	assert.equal(unchanged({ rect: rect(10, 20, 30, 41) }), false);
	assert.equal(unchanged({ point: { x: 4, y: 6 } }), false);
	assert.equal(unchanged({ point: { x: 5, y: 7 } }), false);
	assert.equal(unchanged({ element: { name: 'card' } }), false);
	assert.equal(
		isUnchangedPick({ last: { ...last, rect: null }, next: { ...last, rect: null } }),
		true,
	);
	assert.equal(isUnchangedPick({ last: { ...last, rect: null }, next: last }), false);
});
