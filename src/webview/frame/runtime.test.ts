import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import runtimeSource from './runtime.ts?iife';
import { FRAME_HEIGHT_MESSAGE, FRAME_WHEEL_MESSAGE } from './frameMessages';

test('canvas runtime posts only frame height and wheel and never touches the artboard', () => {
	const parentIndex = runtimeSource.indexOf('window.parent');
	assert.ok(parentIndex >= 0);
	assert.ok(parentIndex < runtimeSource.indexOf('addEventListener'));
	assert.ok(!runtimeSource.includes('</'));
	assert.ok(runtimeSource.includes(JSON.stringify(FRAME_HEIGHT_MESSAGE)));
	assert.ok(runtimeSource.includes(JSON.stringify(FRAME_WHEEL_MESSAGE)));
	assert.equal(runtimeSource.split('host.postMessage').length - 1, 2);
	assert.ok(runtimeSource.includes('parentElement'));
	assert.ok(runtimeSource.includes('overflowY'));
	assert.ok(runtimeSource.includes('overflowX'));
	assert.ok(runtimeSource.includes('"overlay"'));
	assert.ok(runtimeSource.includes('scrollHeight - 1 >'));
	assert.ok(runtimeSource.includes('2e4') || runtimeSource.includes('20000'));
	assert.ok(runtimeSource.includes('x: event.clientX'));
	assert.ok(runtimeSource.includes('y: event.clientY'));
	assert.ok(runtimeSource.includes('passive: false'));
	assert.ok(runtimeSource.includes('capture: true'));
	for (const forbidden of [
		'.style',
		'classList',
		'setAttribute',
		'data-dc-',
		'sc-host',
		'design_doc_mode',
	]) {
		assert.ok(!runtimeSource.includes(forbidden), forbidden);
	}
});
