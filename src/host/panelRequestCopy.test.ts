import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	ArtboardNotFoundError,
	CommentNotFoundError,
	ConflictError,
	CorruptMetaError,
	DiskError,
	EditRefusedError,
	InvalidArgsError,
	InvalidArtboardIdError,
	LockTimeoutError,
} from '../disk/errors';
import {
	CHANGE_FALLBACK_MESSAGE,
	COMMENT_GONE_MESSAGE,
	COPY_FAILED_MESSAGE,
	CREATE_FALLBACK_MESSAGE,
	MALFORMED_CHANGE_MESSAGE,
	MALFORMED_CREATE_MESSAGE,
	EDIT_CONFLICT_MESSAGE,
	EDIT_FALLBACK_MESSAGE,
	EDIT_FRAME_GONE_MESSAGE,
	MALFORMED_EDIT_MESSAGE,
	commentRequestErrorMessage,
	editRequestErrorMessage,
	malformedRequestMessage,
	HISTORY_CLEARED_MESSAGE,
	HISTORY_FALLBACK_MESSAGE,
	MALFORMED_HISTORY_MESSAGE,
} from './panelRequestCopy';

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

test('malformedRequestMessage gives create its own copy and replies and status changes the change copy', () => {
	assert.equal(malformedRequestMessage('comment:create'), MALFORMED_CREATE_MESSAGE);
	assert.equal(malformedRequestMessage('comment:reply'), MALFORMED_CHANGE_MESSAGE);
	assert.equal(malformedRequestMessage('comment:set-status'), MALFORMED_CHANGE_MESSAGE);
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
		[new CorruptMetaError('hero'), EDIT_FALLBACK_MESSAGE],
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
		[new CorruptMetaError('hero'), HISTORY_FALLBACK_MESSAGE],
		[new Error('/Users/someone/secret'), HISTORY_FALLBACK_MESSAGE],
	];
	for (const [error, expected] of rows) {
		assert.equal(editRequestErrorMessage(error, 'history'), expected);
	}
});
