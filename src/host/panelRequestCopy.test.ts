import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { FIRST_PAGE_ID } from '../disk/layout';

import {
	ArtboardNotFoundError,
	CommentNotFoundError,
	ConflictError,
	CorruptMetaError,
	CorruptProjectError,
	DiskError,
	EditRefusedError,
	InvalidArgsError,
	InvalidArtboardIdError,
	LockTimeoutError,
	PageNotFoundError,
} from '../disk/errors';
import {
	MALFORMED_EDIT_MESSAGE,
	MALFORMED_PAGE_REQUEST_MESSAGE,
	commentRequestErrorMessage,
	editRequestErrorMessage,
	malformedRequestMessage,
	MALFORMED_HISTORY_MESSAGE,
	PAGE_GONE_MESSAGE,
	pageRequestErrorMessage,
} from './panelRequestCopy';

// Pinned values: the module keeps these private.
const CREATE_FALLBACK_MESSAGE = 'Could not add the comment. Check the Output panel: Vibeboard.';
const MALFORMED_CREATE_MESSAGE = 'Could not add the comment. Pick the element again.';
const CHANGE_FALLBACK_MESSAGE = 'Could not save the change. Check the Output panel: Vibeboard.';
const MALFORMED_CHANGE_MESSAGE = 'Could not save the change. Try again.';
const COMMENT_GONE_MESSAGE = 'This comment no longer exists.';
const COPY_FAILED_MESSAGE = 'Could not copy the prompt. Check the Output panel: Vibeboard.';
const EDIT_FALLBACK_MESSAGE = 'Could not save the edit. Check the Output panel: Vibeboard.';
const EDIT_CONFLICT_MESSAGE = 'This artboard changed on disk. Make the edit again.';
const EDIT_FRAME_GONE_MESSAGE = 'This frame no longer exists.';
const HISTORY_CLEARED_MESSAGE = 'This artboard changed on disk, so its undo history was cleared.';
const HISTORY_FALLBACK_MESSAGE = 'Could not undo or redo. Check the Output panel: Vibeboard.';

test('a copy error: gone comment remapped, domain copy kept, anything else the copy fallback', () => {
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:copy', error: new CommentNotFoundError() }),
		COMMENT_GONE_MESSAGE,
	);
	const busy = new LockTimeoutError();
	assert.equal(commentRequestErrorMessage({ type: 'comment:copy', error: busy }), busy.message);
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:copy-open', error: new Error('clipboard') }),
		COPY_FAILED_MESSAGE,
	);
});

test('commentRequestErrorMessage remaps a missing comment and keeps domain copy', () => {
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:reply', error: new CommentNotFoundError() }),
		COMMENT_GONE_MESSAGE,
	);
	const capped = new InvalidArgsError('This comment has the maximum number of replies.');
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:reply', error: capped }),
		capped.message,
	);
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:reply', error: new Error('/secret/path') }),
		CHANGE_FALLBACK_MESSAGE,
	);
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:set-status', error: new Error('x') }),
		CHANGE_FALLBACK_MESSAGE,
	);
	assert.equal(
		commentRequestErrorMessage({ type: 'comment:create', error: new Error('x') }),
		CREATE_FALLBACK_MESSAGE,
	);
});

test('malformedRequestMessage: create its own copy, reply and status the change copy, copies the copy fallback', () => {
	assert.equal(malformedRequestMessage('comment:create'), MALFORMED_CREATE_MESSAGE);
	assert.equal(malformedRequestMessage('comment:reply'), MALFORMED_CHANGE_MESSAGE);
	assert.equal(malformedRequestMessage('comment:set-status'), MALFORMED_CHANGE_MESSAGE);
	assert.equal(malformedRequestMessage('comment:copy'), COPY_FAILED_MESSAGE);
	assert.equal(malformedRequestMessage('comment:copy-open'), COPY_FAILED_MESSAGE);
});

test('editRequestErrorMessage is an allowlist: Agent copy never reaches the panel', () => {
	const refused = new EditRefusedError('not-plain-text');
	const busy = new LockTimeoutError();
	const disk = new DiskError();
	const rows: [unknown, string][] = [
		[new ConflictError('hero', {}), EDIT_CONFLICT_MESSAGE],
		[new ArtboardNotFoundError('hero'), EDIT_FRAME_GONE_MESSAGE],
		[new InvalidArgsError('x'), MALFORMED_EDIT_MESSAGE],
		[new InvalidArtboardIdError('Bad id'), MALFORMED_EDIT_MESSAGE],
		[refused, refused.message],
		[busy, busy.message],
		[disk, disk.message],
		[new CorruptMetaError({ pageId: FIRST_PAGE_ID, artboardId: 'hero' }), EDIT_FALLBACK_MESSAGE],
		[new Error('/Users/someone/secret'), EDIT_FALLBACK_MESSAGE],
	];
	for (const [error, expected] of rows) {
		assert.equal(editRequestErrorMessage(error, 'edit'), expected);
	}
	assert.match(refused.message, /Ask the Agent/);
});

test('history copy differs from edit copy for conflict, malformed and fallback only', () => {
	const busy = new LockTimeoutError();
	const disk = new DiskError();
	const rows: [unknown, string][] = [
		[new ConflictError('hero', {}), HISTORY_CLEARED_MESSAGE],
		[new ArtboardNotFoundError('hero'), EDIT_FRAME_GONE_MESSAGE],
		[new InvalidArgsError('x'), MALFORMED_HISTORY_MESSAGE],
		[new InvalidArtboardIdError('Bad id'), MALFORMED_HISTORY_MESSAGE],
		[busy, busy.message],
		[disk, disk.message],
		[new CorruptMetaError({ pageId: FIRST_PAGE_ID, artboardId: 'hero' }), HISTORY_FALLBACK_MESSAGE],
		[new Error('/Users/someone/secret'), HISTORY_FALLBACK_MESSAGE],
	];
	for (const [error, expected] of rows) {
		assert.equal(editRequestErrorMessage(error, 'history'), expected);
	}
});

test('a gone page maps to the panel copy on every page-bound request kind', () => {
	const error = new PageNotFoundError('page-2');
	assert.equal(PAGE_GONE_MESSAGE, 'That page no longer exists.');
	assert.equal(commentRequestErrorMessage({ type: 'comment:create', error }), PAGE_GONE_MESSAGE);
	assert.equal(commentRequestErrorMessage({ type: 'comment:copy', error }), PAGE_GONE_MESSAGE);
	assert.equal(editRequestErrorMessage(error, 'edit'), PAGE_GONE_MESSAGE);
	assert.equal(editRequestErrorMessage(error, 'history'), PAGE_GONE_MESSAGE);
});

test('pageRequestErrorMessage: panel copy by reason and type, domain copy for busy and disk', () => {
	const unlisted = new PageNotFoundError('page-2', { reason: 'unlisted' });
	const noFolder = new PageNotFoundError('page-2');
	const refused = new InvalidArgsError('Agent copy: call list_pages.');
	const busy = new LockTimeoutError();
	const disk = new DiskError();
	const fallback = 'Could not change the pages. Check the Output panel: Vibeboard.';
	const rows: [Parameters<typeof pageRequestErrorMessage>[0]['type'], unknown, string][] = [
		['page:open', unlisted, PAGE_GONE_MESSAGE],
		[
			'page:delete',
			noFolder,
			"This page's folder is missing. Delete the page to remove it from the list.",
		],
		['page:create', unlisted, fallback],
		['page:create', noFolder, fallback],
		['page:rename', refused, 'A page title needs 1 to 80 characters and no control characters.'],
		['page:create', refused, 'This project already has 100 pages. Delete one first.'],
		['page:delete', refused, 'The last page cannot be deleted.'],
		['page:open', refused, MALFORMED_PAGE_REQUEST_MESSAGE],
		['page:rename', busy, busy.message],
		['page:create', disk, disk.message],
		['page:open', new CorruptProjectError(), fallback],
		['page:delete', new Error('/Users/someone/secret'), fallback],
	];
	for (const [type, error, expected] of rows) {
		assert.equal(pageRequestErrorMessage({ type, error }), expected);
	}
	assert.equal(MALFORMED_PAGE_REQUEST_MESSAGE, 'Could not change the pages. Try again.');
});
