import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { enqueueDiskOp } from './mcpQueue';

test('a rejected op does not block the next one', async () => {
	await assert.rejects(
		enqueueDiskOp(async () => {
			throw new Error('boom');
		}),
		/boom/,
	);
	assert.equal(await enqueueDiskOp(async () => 'after'), 'after');
});

test('ops never overlap, even when the earlier one is slower', async () => {
	const events: string[] = [];
	await Promise.all([
		enqueueDiskOp(async () => {
			events.push('slow:start');
			await delay(20);
			events.push('slow:end');
		}),
		enqueueDiskOp(async () => {
			events.push('fast:start');
			events.push('fast:end');
		}),
	]);
	assert.deepEqual(events, ['slow:start', 'slow:end', 'fast:start', 'fast:end']);
});
