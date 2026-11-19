import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { parseHostMessage, routeMessage } from './hostMessages';

const validFrame = {
	id: 'a',
	label: 'A',
	x: 0,
	y: 10,
	width: 400,
	generation: 2,
	hash: 'sha256:aa',
	html: '<p>a</p>',
};
const validUpdate = {
	type: 'canvas:updated',
	activeArtboardId: 'a',
	generation: 3,
	cspNonce: 'n',
	frames: [validFrame],
};

test('a valid canvas:updated parses with its frames', () => {
	assert.deepEqual(parseHostMessage(validUpdate), validUpdate);
	const withOptional = { ...validFrame, group: 'Desktop', errorMessage: 'broken' };
	assert.deepEqual(parseHostMessage({ ...validUpdate, frames: [withOptional] }), {
		...validUpdate,
		frames: [withOptional],
	});
});

test('canvas:updated with any top-level field wrong is rejected', () => {
	for (const broken of [
		{ activeArtboardId: 1 },
		{ cspNonce: undefined },
		{ generation: Number.NaN },
		{ generation: '3' },
		{ frames: 'a' },
		{ frames: { 0: validFrame } },
	]) {
		assert.equal(
			parseHostMessage({ ...validUpdate, ...broken }),
			undefined,
			JSON.stringify(broken),
		);
	}
});

test('invalid frame entries are dropped and the valid ones kept in order', () => {
	const second = { ...validFrame, id: 'b' };
	const parsed = parseHostMessage({
		...validUpdate,
		frames: [
			null,
			'a',
			{ ...validFrame, id: 7 },
			{ ...validFrame, label: undefined },
			{ ...validFrame, html: 1 },
			{ ...validFrame, x: Number.POSITIVE_INFINITY },
			{ ...validFrame, y: '0' },
			{ ...validFrame, width: Number.NaN },
			{ ...validFrame, generation: undefined },
			{ ...validFrame, generation: Number.NaN },
			{ ...validFrame, generation: '2' },
			{ ...validFrame, group: 1 },
			{ ...validFrame, errorMessage: false },
			{ ...validFrame, hash: undefined },
			{ ...validFrame, hash: 5 },
			second,
			validFrame,
		],
	});
	assert.ok(parsed?.type === 'canvas:updated');
	assert.deepEqual(
		parsed.frames.map(({ id }) => id),
		['b', 'a'],
	);
});

test('non-objects and unknown types are ignored', () => {
	for (const value of [null, undefined, 'canvas:updated', 3, { type: 'nope' }, {}]) {
		assert.equal(parseHostMessage(value), undefined);
	}
});

test('artboard:error falls back to the default copy for a non-string message', () => {
	assert.deepEqual(parseHostMessage({ type: 'artboard:error', message: 'Bad canvas.json' }), {
		type: 'artboard:error',
		message: 'Bad canvas.json',
	});
	assert.deepEqual(parseHostMessage({ type: 'artboard:error', message: 4 }), {
		type: 'artboard:error',
		message: 'Could not load artboard.',
	});
});

test('ui:status needs a boolean mcpAvailable; handoffStale is true only when true', () => {
	assert.equal(parseHostMessage({ type: 'ui:status', mcpAvailable: 'no' }), undefined);
	assert.deepEqual(parseHostMessage({ type: 'ui:status', mcpAvailable: false }), {
		type: 'ui:status',
		mcpAvailable: false,
		handoffStale: false,
	});
	assert.deepEqual(
		parseHostMessage({ type: 'ui:status', mcpAvailable: true, handoffStale: 'yes' }),
		{ type: 'ui:status', mcpAvailable: true, handoffStale: false },
	);
	assert.deepEqual(
		parseHostMessage({ type: 'ui:status', mcpAvailable: true, handoffStale: true }),
		{ type: 'ui:status', mcpAvailable: true, handoffStale: true },
	);
});

test('routeMessage: the registered window decides, never the payload or a null source', () => {
	const frameWindow = {};
	const iframes = new Map([
		['a', { contentWindow: frameWindow }],
		['detached', { contentWindow: null }],
	]);
	assert.deepEqual(routeMessage({ source: frameWindow, origin: 'null', iframes }), {
		kind: 'frame',
		frameId: 'a',
	});
	// An unregistered (or removed) sandboxed frame never reaches the host parser.
	assert.deepEqual(routeMessage({ source: {}, origin: 'null', iframes }), { kind: 'drop' });
	// A null source must not match the detached iframe's null contentWindow.
	assert.deepEqual(routeMessage({ source: null, origin: 'null', iframes }), { kind: 'drop' });
	assert.deepEqual(routeMessage({ source: null, origin: 'vscode-webview://x', iframes }), {
		kind: 'host',
	});
});

const validComment = {
	id: 'c1',
	frameId: 'a',
	selector: 'h1',
	tagName: 'h1',
	text: 'Hello',
	rect: { x: 0, y: 0, width: 10, height: 10 },
	pin: { x: 0.5, y: 0.25 },
	body: 'Bolder',
	isPage: false,
	status: 'open',
	createdAt: '2026-10-26T10:00:00.000Z',
	replies: [{ id: 'r1', author: 'agent', body: 'Done', createdAt: '2026-10-26T11:00:00.000Z' }],
	stale: true,
	targetMissing: false,
};

test('comments:updated drops a malformed comment and keeps the valid one', () => {
	assert.deepEqual(
		parseHostMessage({
			type: 'comments:updated',
			comments: [{ ...validComment, selector: 'h1\nh2' }, validComment],
		}),
		{ type: 'comments:updated', comments: [validComment] },
	);
});

test('comments:updated keeps true, false and null flags and drops anything else', () => {
	const unchecked = { ...validComment, id: 'c2', stale: null, targetMissing: null };
	const noTargetMissing: Record<string, unknown> = { ...validComment, id: 'c3' };
	delete noTargetMissing.targetMissing;
	assert.deepEqual(
		parseHostMessage({
			type: 'comments:updated',
			comments: [
				validComment,
				{ ...validComment, id: 'c4', stale: 'yes' },
				noTargetMissing,
				unchecked,
			],
		}),
		{ type: 'comments:updated', comments: [validComment, unchecked] },
	);
});

test('comments:updated with a non-array list or a non-string error is rejected', () => {
	assert.equal(parseHostMessage({ type: 'comments:updated', comments: {} }), undefined);
	assert.equal(parseHostMessage({ type: 'comments:updated', comments: [], error: 7 }), undefined);
	// An empty error is kept; Banners hides it.
	assert.deepEqual(parseHostMessage({ type: 'comments:updated', comments: [], error: '' }), {
		type: 'comments:updated',
		comments: [],
		error: '',
	});
});

test('ui:copied needs a string requestId and a non-negative integer count', () => {
	assert.deepEqual(parseHostMessage({ type: 'ui:copied', requestId: 'r1', count: 0, extra: 1 }), {
		type: 'ui:copied',
		requestId: 'r1',
		count: 0,
	});
	for (const broken of [
		{ count: 1 },
		{ requestId: 7, count: 1 },
		{ requestId: 'r1', count: -1 },
		{ requestId: 'r1', count: 1.5 },
		{ requestId: 'r1', count: '2' },
	]) {
		assert.equal(parseHostMessage({ type: 'ui:copied', ...broken }), undefined);
	}
});

test('comment:saved needs a string requestId', () => {
	assert.deepEqual(parseHostMessage({ type: 'comment:saved', requestId: 'r1' }), {
		type: 'comment:saved',
		requestId: 'r1',
	});
	assert.equal(parseHostMessage({ type: 'comment:saved' }), undefined);
	assert.equal(parseHostMessage({ type: 'comment:saved', requestId: 7 }), undefined);
});

test('comment:added needs a string requestId; ui:error a string message and optional requestId', () => {
	assert.equal(parseHostMessage({ type: 'comment:added' }), undefined);
	assert.equal(parseHostMessage({ type: 'comment:added', requestId: 7 }), undefined);
	assert.equal(parseHostMessage({ type: 'ui:error', message: 'x', requestId: 7 }), undefined);
	assert.deepEqual(parseHostMessage({ type: 'ui:error', message: 'Copy failed.' }), {
		type: 'ui:error',
		message: 'Copy failed.',
	});
});
