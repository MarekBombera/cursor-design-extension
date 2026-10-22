import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { parseHostMessage, parseSavedStageView } from './hostMessages';

const validFrame = {
	id: 'a',
	label: 'A',
	x: 0,
	y: 10,
	width: 400,
	generation: 2,
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

test('saved stage view needs finite x, y and a positive finite zoom', () => {
	assert.deepEqual(parseSavedStageView({ x: -5, y: 2, zoom: 0.5, extra: 1 }), {
		x: -5,
		y: 2,
		zoom: 0.5,
	});
	for (const value of [
		null,
		undefined,
		'view',
		{ x: 0, y: 0, zoom: 0 },
		{ x: 0, y: 0, zoom: -1 },
		{ x: Number.NaN, y: 0, zoom: 1 },
		{ x: 0, y: 0, zoom: Number.POSITIVE_INFINITY },
		{ x: 0, zoom: 1 },
	]) {
		assert.equal(parseSavedStageView(value), undefined, JSON.stringify(value));
	}
});
