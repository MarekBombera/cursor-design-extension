import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { Comment } from '../disk/comments';
import {
	commentCreateRequestId,
	isCommentCreateAttempt,
	isFramePlaceAttempt,
	parseChromeMessage,
	toNewComment,
	toPostedComment,
} from './chromeMessages';
import type { CommentCreateMessage } from '../webview/hostMessages';

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

const validCreate: CommentCreateMessage = {
	type: 'comment:create',
	requestId: 'a1b2-C3_d4',
	frameId: 'hero',
	generation: 2,
	selector: '.card:nth-of-type(3)',
	tagName: 'div',
	text: 'Card',
	rect: { x: -4, y: 8, width: 100, height: 40 },
	point: { x: 50, y: 20 },
	box: { width: 100, height: 40 },
	styles: { color: 'rgb(0, 0, 0)' },
	isPage: false,
	body: 'Make it bolder',
};

test('accepts a valid comment:create; a 2001-character body is addComment’s to refuse', () => {
	assert.deepEqual(parseChromeMessage(validCreate), validCreate);
	const long = { ...validCreate, body: 'a'.repeat(2001) };
	assert.deepEqual(parseChromeMessage(long), long);
});

test('comment:create rejects bad ids, selectors, numbers and shapes', () => {
	const { box: _box, ...withoutBox } = validCreate;
	for (const broken of [
		{ ...validCreate, requestId: 'a b' },
		{ ...validCreate, requestId: 'a'.repeat(65) },
		{ ...validCreate, selector: 'a'.repeat(1001) },
		{ ...validCreate, selector: '.a\n.b' },
		{ ...validCreate, rect: { ...validCreate.rect, x: Number.NaN } },
		{ ...validCreate, point: { x: -1, y: 0 } },
		withoutBox,
		{ ...validCreate, isPage: 'false' },
	]) {
		assert.equal(parseChromeMessage(broken), undefined, JSON.stringify(broken));
	}
});

test('a malformed comment:create is still an attempt with an answerable requestId', () => {
	const malformed = { type: 'comment:create', requestId: 'req-1', selector: 7 };
	assert.equal(parseChromeMessage(malformed), undefined);
	assert.equal(isCommentCreateAttempt(malformed), true);
	assert.equal(commentCreateRequestId(malformed), 'req-1');
	assert.equal(commentCreateRequestId({ ...malformed, requestId: 'a b' }), undefined);
	assert.equal(isCommentCreateAttempt(validPlace), false);
	assert.equal(commentCreateRequestId(validPlace), undefined);
});

test('toNewComment pins by the unclipped box, never by the rect', () => {
	assert.deepEqual(toNewComment(validCreate).pin, { x: 0.5, y: 0.5 });
	// Zero-width box: no NaN.
	assert.deepEqual(toNewComment({ ...validCreate, box: { width: 0, height: 40 } }).pin, {
		x: 0,
		y: 0.5,
	});
	// A point past the box passes through; addComment clamps the stored pin (comments.test.ts).
	assert.equal(toNewComment({ ...validCreate, point: { x: 500, y: 20 } }).pin.x, 5);
	// A clipped target: the visible rect is 40 high, the box 200; the point is below the rect.
	const clipped = toNewComment({
		...validCreate,
		point: { x: 50, y: 120 },
		box: { width: 100, height: 200 },
	});
	assert.equal(clipped.pin.y, 0.6);
	// A page pick never stores a rect; a null rect maps without throwing.
	assert.equal(toNewComment({ ...validCreate, isPage: true }).rect, null);
	const nullRect = toNewComment({ ...validCreate, rect: null });
	assert.equal(nullRect.rect, null);
	assert.deepEqual(nullRect.pin, { x: 0.5, y: 0.5 });
});

test('toPostedComment never carries artboard, version, styles or the fingerprint', () => {
	const comment: Comment = {
		id: 'c1',
		frameId: 'hero',
		artboard: 'Landing',
		version: 3,
		selector: 'h1',
		tagName: 'h1',
		text: 'Hello',
		rect: { x: 0, y: 0, width: 10, height: 10 },
		pin: { x: 0.5, y: 0.25 },
		styles: { color: 'rgb(0, 0, 0)' },
		body: 'Bolder',
		isPage: false,
		targetFingerprint: `sha256:${'a'.repeat(64)}`,
		status: 'resolved',
		createdAt: '2026-10-26T10:00:00.000Z',
		replies: [{ id: 'r1', author: 'agent', body: 'Done', createdAt: '2026-10-26T11:00:00.000Z' }],
	};
	const posted = toPostedComment(comment);
	for (const key of ['artboard', 'version', 'styles', 'targetFingerprint']) {
		assert.equal(key in posted, false, key);
	}
	assert.equal(posted.status, 'resolved');
	assert.deepEqual(posted.replies, comment.replies);
});
