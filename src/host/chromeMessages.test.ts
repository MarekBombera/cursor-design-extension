import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { isFramePlaceAttempt, parseChromeMessage } from './chromeMessages';

const validPlace = {
	type: 'frame:place',
	id: 'hero',
	x: -16,
	y: 64,
	width: 480,
	base: { x: 0, y: 64, width: 400 },
};

test('accepts artboard:ready and a valid frame:place', () => {
	assert.deepEqual(parseChromeMessage({ type: 'artboard:ready' }), { type: 'artboard:ready' });
	assert.deepEqual(parseChromeMessage(validPlace), validPlace);
});

test('rejects non-finite and out-of-range numbers', () => {
	for (const broken of [
		{ x: Number.NaN },
		{ y: Number.POSITIVE_INFINITY },
		{ width: Number.NEGATIVE_INFINITY },
		{ x: 1e308 },
		{ x: 100_001 },
		{ y: -100_001 },
		{ width: 0 },
		{ width: 100_001 },
		{ base: { ...validPlace.base, x: Number.NaN } },
		{ base: { ...validPlace.base, width: 0 } },
	]) {
		assert.equal(
			parseChromeMessage({ ...validPlace, ...broken }),
			undefined,
			JSON.stringify(broken),
		);
	}
});

test('rejects malformed shapes', () => {
	const { base: _base, ...withoutBase } = validPlace;
	for (const value of [
		withoutBase,
		{ ...validPlace, base: { ...validPlace.base, y: '64' } },
		{ ...validPlace, id: 7 },
		{ ...validPlace, type: 'frame:nope' },
		[validPlace],
		null,
		'frame:place',
		3,
	]) {
		assert.equal(parseChromeMessage(value), undefined, JSON.stringify(value));
	}
});

test('isFramePlaceAttempt flags any frame:place, valid or not, and nothing else', () => {
	assert.equal(isFramePlaceAttempt(validPlace), true);
	assert.equal(isFramePlaceAttempt({ type: 'frame:place', x: 'left' }), true);
	assert.equal(isFramePlaceAttempt({ type: 'artboard:ready' }), false);
	assert.equal(isFramePlaceAttempt(null), false);
	assert.equal(isFramePlaceAttempt('frame:place'), false);
});
