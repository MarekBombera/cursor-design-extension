import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { HostMessage } from '../webview/hostMessages';
import type { CanvasSnapshot } from './canvasSnapshot';
import { createPanelOutbox } from './panelOutbox';

const setup = () => {
	const posted: HostMessage[] = [];
	const nonce = { value: 'nonce-1' };
	const outbox = createPanelOutbox({
		post: (message) => posted.push(message),
		readCspNonce: () => nonce.value,
	});
	const types = (): string[] => posted.map(({ type }) => type);
	return { outbox, posted, nonce, types };
};

const snapshot = (overrides: Partial<CanvasSnapshot> = {}): CanvasSnapshot => ({
	activeArtboardId: 'hero',
	generation: 3,
	frames: [],
	handoffStale: false,
	...overrides,
});

test('posts nothing before artboard:ready, then flushes view and status', () => {
	const { outbox, types } = setup();
	outbox.postUiStatus({ mcpAvailable: true });
	outbox.postSnapshot(snapshot({ errorMessage: 'broken' }));
	assert.deepEqual(types(), []);
	outbox.markReady();
	assert.deepEqual(types(), ['canvas:updated', 'artboard:error', 'ui:status']);
});

test('a second artboard:ready (webview reload) re-sends the last view, error and status', () => {
	const { outbox, posted } = setup();
	outbox.postUiStatus({ mcpAvailable: true });
	outbox.postSnapshot(snapshot({ generation: 1 }));
	outbox.postSnapshot(snapshot({ generation: 2, errorMessage: 'broken', handoffStale: true }));
	outbox.markReady();
	const first = posted.splice(0);
	outbox.markReady();
	assert.deepEqual(posted, first);
	assert.deepEqual(posted, [
		{
			type: 'canvas:updated',
			activeArtboardId: 'hero',
			generation: 2,
			frames: [],
			cspNonce: 'nonce-1',
		},
		{ type: 'artboard:error', message: 'broken' },
		{ type: 'ui:status', mcpAvailable: true, handoffStale: true },
	]);
});

test('canvas:updated without an error is not followed by artboard:error', () => {
	const { outbox, types } = setup();
	outbox.markReady();
	outbox.postSnapshot(snapshot());
	assert.deepEqual(types(), ['canvas:updated']);
});

test('reads the CSP nonce at flush time, not when the view was queued', () => {
	const { outbox, posted, nonce } = setup();
	outbox.postSnapshot(snapshot());
	nonce.value = 'nonce-2';
	outbox.markReady();
	assert.equal(posted[0]?.type === 'canvas:updated' && posted[0].cspNonce, 'nonce-2');
});

test('withholds ui:status until mcpAvailable is known, then sends the latest stale flag', () => {
	const { outbox, posted, types } = setup();
	outbox.markReady();
	outbox.postSnapshot(snapshot({ handoffStale: true }));
	outbox.postUiStatus({ handoffStale: true });
	assert.deepEqual(types(), ['canvas:updated']);
	outbox.postUiStatus({ mcpAvailable: false });
	assert.deepEqual(posted.at(-1), { type: 'ui:status', mcpAvailable: false, handoffStale: true });
	posted.length = 0;
	outbox.postSnapshot(snapshot());
	assert.deepEqual(types(), ['ui:status', 'canvas:updated']);
});

test('reset (dispose) drops the view and stale flag and waits for ready, keeping mcpAvailable', () => {
	const { outbox, posted } = setup();
	outbox.postUiStatus({ mcpAvailable: true });
	outbox.postSnapshot(snapshot({ handoffStale: true }));
	outbox.markReady();
	outbox.reset();
	posted.length = 0;
	outbox.postUiStatus({});
	assert.deepEqual(posted, []);
	outbox.markReady();
	assert.deepEqual(posted, [{ type: 'ui:status', mcpAvailable: true, handoffStale: false }]);
});

test('comments queued before ready flush after the view and status, and every ready re-sends them', () => {
	const { outbox, posted, types } = setup();
	outbox.postComments({ comments: [], error: 'broken' });
	outbox.postSnapshot(snapshot());
	outbox.postUiStatus({ mcpAvailable: true });
	outbox.markReady();
	assert.deepEqual(types(), ['canvas:updated', 'ui:status', 'comments:updated']);
	assert.deepEqual(posted.at(-1), { type: 'comments:updated', comments: [], error: 'broken' });
	posted.length = 0;
	outbox.markReady();
	assert.deepEqual(types(), ['canvas:updated', 'ui:status', 'comments:updated']);
});

test('an answer before ready is dropped and never replayed; after ready it posts once', () => {
	const { outbox, posted, types } = setup();
	outbox.postAnswer({ type: 'comment:added', requestId: 'r1' });
	outbox.markReady();
	assert.deepEqual(types(), []);
	outbox.postAnswer({ type: 'ui:error', requestId: 'r2', message: 'Pick it again.' });
	outbox.markReady();
	assert.deepEqual(posted, [{ type: 'ui:error', requestId: 'r2', message: 'Pick it again.' }]);
});

test('reset drops the cached comments', () => {
	const { outbox, types } = setup();
	outbox.postComments({ comments: [] });
	outbox.reset();
	outbox.markReady();
	assert.deepEqual(types(), []);
});
