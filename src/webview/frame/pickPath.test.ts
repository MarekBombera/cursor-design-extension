import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { stepToChild, stepToParent } from './pickPath';

const parents: Record<string, string | null> = {
	span: 'card',
	card: 'section',
	section: 'body',
	body: 'html',
	removed: null,
};

const up = (path: readonly string[]): readonly string[] =>
	stepToParent({
		path,
		parentOf: (element) => parents[element] ?? null,
		isRoot: (element) => element === 'body' || element === 'html',
	});

test('up, up, down returns the first parent', () => {
	assert.deepEqual(stepToChild(up(up(['span']))), ['span', 'card']);
});

test('down at the bottom stays', () => {
	assert.deepEqual(stepToChild(['span']), ['span']);
	assert.deepEqual(stepToChild([]), []);
});

test('up at body stays', () => {
	assert.deepEqual(up(up(up(up(['span'])))), ['span', 'card', 'section', 'body']);
	assert.deepEqual(up(['body']), ['body']);
});

test('a node whose parent is gone keeps the path', () => {
	assert.deepEqual(up(['removed']), ['removed']);
	assert.deepEqual(up([]), []);
});
