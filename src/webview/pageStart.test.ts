import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { CommentDraft } from './commentPopover';
import type { CanvasUpdatedMessage, CommentsUpdatedMessage } from './hostMessages';
import { isPageChange, isPageComments, nextPageStart, type PageStart } from './pageStart';

const canvasOf = (pageId: string): CanvasUpdatedMessage => ({
	type: 'canvas:updated',
	pageId,
	activeArtboardId: 'hero',
	generation: 1,
	cspNonce: 'nonce',
	frames: [],
	pages: [],
});

const draft: CommentDraft = {
	frameId: 'hero',
	generation: 1,
	target: {
		selector: 'h1',
		tagName: 'h1',
		text: 'Hello',
		rect: null,
		point: { x: 0, y: 0 },
		box: { width: 10, height: 10 },
		styles: {},
		isPage: false,
	},
	body: 'Held',
};

const staged: PageStart = { pageId: 'page-1', mode: 'comment', replyDrafts: {} };
const saved = { openThreadId: 'c-1', replyDrafts: { 'c-1': 'Reply' } };

const startOf = (
	overrides: Partial<Parameters<typeof nextPageStart>[0]> = {},
): ReturnType<typeof nextPageStart> =>
	nextPageStart({
		canvas: canvasOf('page-2'),
		comments: undefined,
		staged,
		mountedMode: undefined,
		draftSlot: undefined,
		saved,
		first: true,
		...overrides,
	});

test('only a real page other than the staged one is a page change', () => {
	assert.equal(isPageChange({ messagePageId: 'page-2', stagedPageId: 'page-1' }), true);
	assert.equal(isPageChange({ messagePageId: 'page-1', stagedPageId: 'page-1' }), false);
	// '' never remounts, even over a real staged page.
	assert.equal(isPageChange({ messagePageId: '', stagedPageId: 'page-1' }), false);
});

test('a held draft starts only on its own page, and then wins over the saved thread', () => {
	const own = startOf({ draftSlot: { pageId: 'page-2', draft } });
	assert.equal(own.heldDraft, draft);
	assert.equal(own.heldThreadId, undefined);
	const other = startOf({ draftSlot: { pageId: 'page-3', draft } });
	assert.equal(other.heldDraft, undefined);
	assert.equal(other.heldThreadId, 'c-1');
});

test('the saved thread and reply drafts go only to the first real page', () => {
	const first = startOf();
	assert.equal(first.heldThreadId, 'c-1');
	assert.deepEqual(first.replyDrafts, { 'c-1': 'Reply' });
	const later = startOf({ first: false });
	assert.equal(later.heldThreadId, undefined);
	assert.deepEqual(later.replyDrafts, {});
});

test('the mode carries over from the leaving page, else from the staged start', () => {
	assert.equal(startOf({ mountedMode: 'edit' }).mode, 'edit');
	assert.equal(startOf().mode, 'comment');
});

test('a comment list already received goes with the page start; none leaves no key', () => {
	const comments: CommentsUpdatedMessage = {
		type: 'comments:updated',
		pageId: 'page-2',
		comments: [],
	};
	assert.equal(startOf({ comments }).comments, comments);
	assert.ok(!('comments' in startOf()));
});

test('a comment list applies to its own page or as a no-page list, never to another page', () => {
	assert.equal(isPageComments({ listPageId: 'page-1', pageId: 'page-1' }), true);
	assert.equal(isPageComments({ listPageId: '', pageId: 'page-1' }), true);
	assert.equal(isPageComments({ listPageId: 'page-2', pageId: 'page-1' }), false);
});
