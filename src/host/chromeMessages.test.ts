import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { CommentView } from '../disk/commentViews';
import { MAX_EDIT_TEXT_CHARS, MAX_FRAME_COORDINATE, MAX_PICK_TEXT_CHARS } from '../disk/layout';
import {
	claimedRequestId,
	commentRequestId,
	isArtboardEditAttempt,
	commentRequestType,
	isFramePlaceAttempt,
	parseChromeMessage,
	toNewComment,
	toPostedComment,
	isArtboardHistoryAttempt,
} from './chromeMessages';
import { COPY_FAILED_MESSAGE, malformedRequestMessage } from './panelRequestCopy';
import type { CommentCreateMessage } from '../webview/hostMessages';

const validPlace = {
	type: 'frame:place',
	pageId: 'page-1',
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
	pageId: 'page-1',
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

test('comment:create rejects bad ids, tags, text, numbers, styles and shapes', () => {
	const { box: _box, ...withoutBox } = validCreate;
	for (const broken of [
		{ ...validCreate, requestId: 'a b' },
		{ ...validCreate, requestId: 'a'.repeat(65) },
		{ ...validCreate, selector: 'a'.repeat(1001) },
		{ ...validCreate, selector: '.a\n.b' },
		{ ...validCreate, tagName: 'DIV' },
		{ ...validCreate, text: 'a'.repeat(MAX_PICK_TEXT_CHARS + 1) },
		{ ...validCreate, text: 'a\u2028b' },
		{ ...validCreate, generation: -1 },
		{ ...validCreate, generation: 1.5 },
		{ ...validCreate, rect: { ...validCreate.rect, x: Number.NaN } },
		{ ...validCreate, rect: { ...validCreate.rect, width: -1 } },
		{ ...validCreate, rect: { ...validCreate.rect, height: -1 } },
		{ ...validCreate, point: { x: -1, y: 0 } },
		{ ...validCreate, point: { x: MAX_FRAME_COORDINATE + 1, y: 0 } },
		{ ...validCreate, box: { width: MAX_FRAME_COORDINATE + 1, height: 40 } },
		{ ...validCreate, styles: { color: 1 } },
		{ ...validCreate, frameId: 7 },
		{ ...validCreate, body: 7 },
		withoutBox,
		{ ...validCreate, isPage: 'false' },
	]) {
		assert.equal(parseChromeMessage(broken), undefined, JSON.stringify(broken));
	}
});

const validReply = {
	type: 'comment:reply',
	requestId: 'r-2',
	pageId: 'page-1',
	id: 'c_1',
	body: 'More detail',
};
const validStatus = {
	type: 'comment:set-status',
	requestId: 'r-3',
	pageId: 'page-1',
	id: 'c_1',
	status: 'resolved',
};

test('comment:reply and comment:set-status parse', () => {
	assert.deepEqual(parseChromeMessage(validReply), validReply);
	assert.deepEqual(parseChromeMessage(validStatus), validStatus);
	assert.deepEqual(parseChromeMessage({ ...validStatus, status: 'open' }), {
		...validStatus,
		status: 'open',
	});
});

test('comment:reply and comment:set-status reject sent, bad ids, missing body and bad requestIds', () => {
	const { body: _body, ...withoutBody } = validReply;
	for (const broken of [
		{ ...validStatus, status: 'sent' },
		{ ...validStatus, status: undefined },
		{ ...validStatus, id: 'a b' },
		{ ...validReply, id: '' },
		{ ...validReply, id: 'a'.repeat(65) },
		withoutBody,
		{ ...validReply, body: 7 },
		{ ...validReply, requestId: 'a b' },
		{ ...validStatus, requestId: 'a'.repeat(65) },
	]) {
		assert.equal(parseChromeMessage(broken), undefined, JSON.stringify(broken));
	}
});

test('comment:copy and comment:copy-open parse; bad ids and requestIds are rejected but answerable', () => {
	const copy = { type: 'comment:copy', requestId: 'r-4', pageId: 'page-1', id: 'c-1' };
	const copyOpen = { type: 'comment:copy-open', requestId: 'r-5', pageId: 'page-1' };
	assert.deepEqual(parseChromeMessage({ ...copy, extra: 1 }), copy);
	assert.deepEqual(parseChromeMessage(copyOpen), copyOpen);
	for (const broken of [
		{ ...copy, id: 'a b' },
		{ ...copy, id: undefined },
		{ ...copyOpen, requestId: undefined },
		{ ...copyOpen, requestId: 'a b' },
	]) {
		assert.equal(parseChromeMessage(broken), undefined, JSON.stringify(broken));
	}
	assert.equal(commentRequestType({ ...copy, id: 'a b' }), 'comment:copy');
	assert.equal(commentRequestId({ ...copy, id: 'a b' }), 'r-4');
	assert.equal(commentRequestType(copyOpen), 'comment:copy-open');
	assert.equal(commentRequestId(copyOpen), 'r-5');
	assert.equal(malformedRequestMessage('comment:copy-open'), COPY_FAILED_MESSAGE);
});

test('a malformed comment request is still an attempt with an answerable requestId', () => {
	const malformed = { type: 'comment:create', requestId: 'req-1', selector: 7 };
	assert.equal(parseChromeMessage(malformed), undefined);
	assert.equal(commentRequestType(malformed), 'comment:create');
	assert.equal(commentRequestId(malformed), 'req-1');
	assert.equal(commentRequestId({ ...malformed, requestId: 'a b' }), undefined);
	assert.equal(commentRequestType({ ...validReply, body: 7 }), 'comment:reply');
	assert.equal(commentRequestId({ ...validReply, body: 7 }), 'r-2');
	assert.equal(commentRequestType({ ...validStatus, status: 'sent' }), 'comment:set-status');
	assert.equal(commentRequestId(validStatus), 'r-3');
	for (const other of [validPlace, null, 'comment:reply', 7, undefined]) {
		assert.equal(commentRequestType(other), undefined);
		assert.equal(commentRequestId(other), undefined);
	}
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

test('toPostedComment emits exactly the posted fields, flags included, never the hint', () => {
	const comment: CommentView = {
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
		stale: null,
		targetMissing: false,
		hint: 'Agent copy',
	};
	const posted = toPostedComment(comment);
	assert.deepEqual(Object.keys(posted), [
		'id',
		'frameId',
		'selector',
		'tagName',
		'text',
		'rect',
		'pin',
		'body',
		'isPage',
		'status',
		'createdAt',
		'replies',
		'stale',
		'targetMissing',
	]);
	assert.equal(posted.stale, null);
	assert.equal(posted.targetMissing, false);
	assert.deepEqual(posted.replies, comment.replies);
});

const HASH = `sha256:${'a'.repeat(64)}`;

const textEdit = {
	type: 'artboard:edit',
	requestId: 'edit-1',
	pageId: 'page-1',
	frameId: 'hero',
	sourceNumber: 3,
	hash: HASH,
	field: 'text',
	value: 'New',
	liveText: 'Old',
};

const styleEdit = {
	type: 'artboard:edit',
	requestId: 'edit-2',
	pageId: 'page-1',
	frameId: 'hero',
	sourceNumber: 0,
	hash: HASH,
	styles: [
		{ field: 'padding', value: '8' },
		{ field: 'border-color', value: '' },
	],
};

test('artboard:edit parses a text and a styles edit', () => {
	assert.deepEqual(parseChromeMessage(textEdit), textEdit);
	assert.deepEqual(parseChromeMessage(styleEdit), styleEdit);
	// The chrome never sends both: text wins and styles is stripped.
	assert.deepEqual(parseChromeMessage({ ...textEdit, styles: styleEdit.styles }), textEdit);
});

test('artboard:edit rejects bad fields, sizes, numbers, hashes and request ids', () => {
	const over = 'x'.repeat(MAX_EDIT_TEXT_CHARS + 1);
	const { styles: _styles, ...styleBase } = styleEdit;
	for (const broken of [
		{ ...styleBase, field: 'padding', value: '8' },
		{ ...styleBase, field: 'color', value: '#000000' },
		{ ...styleEdit, styles: [] },
		{ ...styleEdit, styles: Array.from({ length: 20 }, () => ({ field: 'gap', value: '1' })) },
		{
			...styleEdit,
			styles: [
				{ field: 'gap', value: '1' },
				{ field: 'gap', value: '2' },
			],
		},
		{ ...styleEdit, styles: [{ field: 'border', value: '1px' }] },
		{ ...styleEdit, styles: [{ field: 'gap', value: over }] },
		{ ...styleEdit, styles: [null] },
		{ ...styleEdit, styles: { field: 'gap', value: '1' } },
		{ ...textEdit, liveText: undefined },
		{ ...textEdit, value: over },
		{ ...textEdit, liveText: over },
		{ ...styleEdit, sourceNumber: -1 },
		{ ...styleEdit, sourceNumber: 1.5 },
		{ ...styleEdit, sourceNumber: Number.MAX_SAFE_INTEGER + 2 },
		{ ...styleEdit, hash: 'sha256:xyz' },
		{ ...styleEdit, hash: 'a'.repeat(64) },
		{ ...styleEdit, requestId: 'bad id' },
	]) {
		assert.equal(parseChromeMessage(broken), undefined, JSON.stringify(broken).slice(0, 120));
	}
});

test('a malformed artboard:edit is still an attempt with an answerable requestId', () => {
	const broken = { ...styleEdit, styles: [{ field: 'border', value: '1px' }] };
	assert.equal(isArtboardEditAttempt(broken), true);
	assert.equal(isArtboardEditAttempt({ type: 'comment:copy-open', requestId: 'x' }), false);
	assert.equal(claimedRequestId(broken), 'edit-2');
	assert.equal(claimedRequestId({ ...styleEdit, requestId: 'bad id' }), undefined);
	assert.equal(commentRequestId(styleEdit), undefined);
	assert.equal(commentRequestType(styleEdit), undefined);
});

test('artboard:history parses its shape only; every claim is an attempt', () => {
	const undo = {
		type: 'artboard:history',
		requestId: 'step-1',
		pageId: 'page-1',
		frameId: 'hero',
		step: 'undo',
	};
	assert.deepEqual(parseChromeMessage(undo), undo);
	assert.deepEqual(parseChromeMessage({ ...undo, step: 'redo', extra: 1 }), {
		...undo,
		step: 'redo',
	});
	for (const broken of [
		{ step: 'sideways' },
		{ step: undefined },
		{ requestId: 'bad id' },
		{ frameId: 7 },
	]) {
		assert.equal(parseChromeMessage({ ...undo, ...broken }), undefined, JSON.stringify(broken));
		assert.equal(isArtboardHistoryAttempt({ ...undo, ...broken }), true);
	}
	assert.equal(isArtboardHistoryAttempt({ type: 'artboard:edit' }), false);
	assert.equal(isArtboardEditAttempt(undo), false);
});

test('every page-bound request needs a valid pageId; a missing or bad one is malformed', () => {
	const requests: Record<string, unknown>[] = [
		validPlace,
		validCreate,
		validReply,
		validStatus,
		{ type: 'comment:copy', requestId: 'r-4', pageId: 'page-1', id: 'c-1' },
		{ type: 'comment:copy-open', requestId: 'r-5', pageId: 'page-1' },
		textEdit,
		{
			type: 'artboard:history',
			requestId: 'step-1',
			pageId: 'page-2',
			frameId: 'hero',
			step: 'undo',
		},
	];
	for (const request of requests) {
		assert.deepEqual(parseChromeMessage(request), request, String(request.type));
		const { pageId: _pageId, ...withoutPageId } = request;
		for (const broken of [
			withoutPageId,
			{ ...request, pageId: '../x' },
			{ ...request, pageId: '' },
		]) {
			assert.equal(parseChromeMessage(broken), undefined, JSON.stringify(broken).slice(0, 120));
		}
	}
});
