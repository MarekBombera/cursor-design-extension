import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { MAX_COMMENTS } from '../disk/layout';
import { parseSavedCommentUi, parseSavedStageView } from './savedState';

test('saved stage view needs finite x, y, a positive finite zoom and a page id', () => {
	assert.deepEqual(parseSavedStageView({ x: -5, y: 2, zoom: 0.5, pageId: 'page-2', extra: 1 }), {
		x: -5,
		y: 2,
		zoom: 0.5,
		pageId: 'page-2',
	});
	// A valid page id, so only the number is wrong.
	const pageId = 'page-1';
	for (const value of [
		{ x: 0, y: 0, zoom: 1 },
		{ x: 0, y: 0, zoom: 1, pageId: '' },
		{ x: 0, y: 0, zoom: 1, pageId: '../x' },
		null,
		undefined,
		'view',
		{ x: 0, y: 0, zoom: 0, pageId },
		{ x: 0, y: 0, zoom: -1, pageId },
		{ x: Number.NaN, y: 0, zoom: 1, pageId },
		{ x: 0, y: 0, zoom: Number.POSITIVE_INFINITY, pageId },
		{ x: 0, zoom: 1, pageId },
	]) {
		assert.equal(parseSavedStageView(value), undefined, JSON.stringify(value));
	}
});

const savedTarget = {
	selector: 'h1',
	tagName: 'h1',
	text: 'Hello',
	rect: { x: 10, y: 20, width: 100, height: 40 },
	point: { x: 5, y: 6 },
	box: { width: 100, height: 40 },
	styles: {},
	isPage: false,
};
const savedDraft = { frameId: 'a', generation: 2, target: savedTarget, body: 'Bolder' };
const savedSlot = { pageId: 'page-1', draft: savedDraft };
const savedUi = {
	mode: 'comment',
	commentDraft: savedSlot,
	replyDrafts: { c1: 'Thanks', c2: '' },
};

test('saved comment UI round-trips through JSON', () => {
	assert.deepEqual(parseSavedCommentUi(JSON.parse(JSON.stringify(savedUi))), savedUi);
	assert.deepEqual(parseSavedCommentUi({ openThreadId: 'c1', stageView: {} }), {
		mode: 'interact',
		openThreadId: 'c1',
		replyDrafts: {},
	});
});

test('saved mode: comment and edit come back; missing, bogus and the old commentMode key read as interact', () => {
	assert.equal(parseSavedCommentUi({ mode: 'edit' }).mode, 'edit');
	assert.equal(parseSavedCommentUi({ mode: 'comment' }).mode, 'comment');
	for (const state of [
		{},
		{ mode: 'Edit' },
		{ mode: 'interact' },
		{ mode: true },
		{ commentMode: true },
	]) {
		assert.equal(parseSavedCommentUi(state).mode, 'interact', JSON.stringify(state));
	}
});

test('saved comment UI: a non-object state or wrong types read as the defaults', () => {
	const empty = { mode: 'interact', replyDrafts: {} };
	for (const state of [undefined, null, 'x', 7, []]) {
		assert.deepEqual(parseSavedCommentUi(state), empty, JSON.stringify(state));
	}
	assert.deepEqual(
		parseSavedCommentUi({
			mode: 7,
			commentDraft: 'x',
			openThreadId: 7,
			replyDrafts: 'x',
		}),
		empty,
	);
});

test('saved comment UI: a malformed draft is dropped alone', () => {
	for (const broken of [
		{ frameId: '' },
		{ frameId: 7 },
		{ generation: -1 },
		{ generation: 1.5 },
		{ generation: '2' },
		{ generation: Number.MAX_SAFE_INTEGER + 1 },
		{ body: 7 },
		{ body: 'a'.repeat(2001) },
		{ target: { ...savedTarget, selector: 'h1\nh2' } },
		{ target: { ...savedTarget, isPage: true } },
		{ target: { ...savedTarget, point: undefined } },
		{ target: null },
	]) {
		assert.deepEqual(
			parseSavedCommentUi({
				...savedUi,
				commentDraft: { ...savedSlot, draft: { ...savedDraft, ...broken } },
			}),
			{ mode: 'comment', replyDrafts: savedUi.replyDrafts },
			JSON.stringify(broken),
		);
	}
	// At the body cap it is kept; pendingRequestId and error are never restored.
	const atCap = { ...savedDraft, body: 'a'.repeat(2000) };
	assert.deepEqual(
		parseSavedCommentUi({
			commentDraft: {
				pageId: 'page-1',
				draft: { ...atCap, pendingRequestId: 'r1', error: 'Pick it again.' },
			},
		}).commentDraft,
		{ pageId: 'page-1', draft: atCap },
	);
});

test('saved comment UI: a draft without a good page id is dropped alone', () => {
	for (const commentDraft of [
		savedDraft,
		{ draft: savedDraft },
		{ pageId: '', draft: savedDraft },
		{ pageId: '../x', draft: savedDraft },
	]) {
		assert.deepEqual(
			parseSavedCommentUi({ ...savedUi, commentDraft, openThreadId: 'c1' }),
			{ mode: 'comment', openThreadId: 'c1', replyDrafts: savedUi.replyDrafts },
			JSON.stringify(commentDraft),
		);
	}
});

test('saved comment UI: a bad thread id is dropped, and a draft and a thread are both kept', () => {
	for (const openThreadId of ['', 'c 1', 'a'.repeat(65), 7]) {
		assert.equal(parseSavedCommentUi({ openThreadId }).openThreadId, undefined);
	}
	const both = parseSavedCommentUi({ commentDraft: savedSlot, openThreadId: 'c1' });
	assert.deepEqual(both.commentDraft, savedSlot);
	assert.equal(both.openThreadId, 'c1');
});

test('saved reply drafts drop bad entries one by one and keep at most MAX_COMMENTS', () => {
	assert.deepEqual(
		parseSavedCommentUi({
			replyDrafts: { c1: 'ok', 'bad id': 'x', c2: 7, c3: 'a'.repeat(2001), c4: '' },
		}).replyDrafts,
		{ c1: 'ok', c4: '' },
	);
	const many = Object.fromEntries(
		Array.from({ length: MAX_COMMENTS + 1 }, (_, index) => [`c${String(index)}`, 'x']),
	);
	const kept = parseSavedCommentUi({ replyDrafts: many }).replyDrafts;
	assert.equal(Object.keys(kept).length, MAX_COMMENTS);
	assert.equal(kept[`c${String(MAX_COMMENTS)}`], undefined);
	for (const replyDrafts of [
		new Map([['c1', 'x']]),
		['x'],
		Object.create({ c1: 'x' }) as unknown,
	]) {
		assert.deepEqual(parseSavedCommentUi({ replyDrafts }).replyDrafts, {});
	}
});
