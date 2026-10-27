import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	answerDraft,
	blockedTargetCopy,
	canSubmit,
	type CommentDraft,
	draftFromPick,
	keepLiveDraft,
	placePopover,
	popoverAnchor,
	popoverKeyAction,
	submitDraft,
	targetChipText,
} from './commentPopover';
import type { FramePickMessage } from './frame/frameMessages';

const userPick = (overrides: Partial<FramePickMessage> = {}): FramePickMessage => ({
	type: 'cd:pick',
	selector: 'h1',
	tagName: 'h1',
	text: 'Hello',
	rect: { x: 10, y: 20, width: 100, height: 40 },
	point: { x: 5, y: 6 },
	box: { width: 100, height: 40 },
	styles: {},
	isPage: false,
	repost: false,
	...overrides,
});

const draftOf = (overrides: Partial<CommentDraft> = {}): CommentDraft => ({
	...(draftFromPick({
		draft: undefined,
		frameId: 'a',
		pick: userPick(),
		generation: 2,
	}) as CommentDraft),
	...overrides,
});

const keys = {
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	isComposing: false,
	bodyEmpty: true,
	inTextarea: true,
};

test('Enter adds from the textarea only, never during IME, and Shift+Enter is a newline', () => {
	assert.equal(popoverKeyAction({ ...keys, key: 'Enter' }), 'add');
	assert.equal(popoverKeyAction({ ...keys, key: 'Enter', bodyEmpty: false }), 'add');
	assert.equal(popoverKeyAction({ ...keys, key: 'Enter', isComposing: true }), undefined);
	// On a button Enter activates the button natively.
	assert.equal(popoverKeyAction({ ...keys, key: 'Enter', inTextarea: false }), undefined);
	assert.equal(popoverKeyAction({ ...keys, key: 'Enter', shiftKey: true }), undefined);
	assert.equal(popoverKeyAction({ ...keys, key: 'Escape' }), 'cancel');
	assert.equal(popoverKeyAction({ ...keys, key: 'Escape', isComposing: true }), undefined);
});

test('↑/↓ step only while the box is empty, from the textarea or a button', () => {
	assert.equal(popoverKeyAction({ ...keys, key: 'ArrowUp' }), 'parent');
	assert.equal(popoverKeyAction({ ...keys, key: 'ArrowDown' }), 'child');
	assert.equal(popoverKeyAction({ ...keys, key: 'ArrowUp', inTextarea: false }), 'parent');
	assert.equal(popoverKeyAction({ ...keys, key: 'ArrowUp', bodyEmpty: false }), undefined);
	assert.equal(popoverKeyAction({ ...keys, key: 'ArrowUp', shiftKey: true }), undefined);
});

test('canSubmit needs a trimmed body in range, a usable target and no pending request', () => {
	assert.equal(canSubmit(draftOf(), ' Bolder '), true);
	assert.equal(canSubmit(draftOf(), '  \n '), false);
	assert.equal(canSubmit(draftOf(), ` ${'a'.repeat(2000)} `), true);
	assert.equal(canSubmit(draftOf(), 'a'.repeat(2001)), false);
	assert.equal(canSubmit(draftOf({ pendingRequestId: 'r1' }), 'Bolder'), false);
	for (const blocked of [
		draftOf({ generation: 0 }),
		draftOf({ target: { ...draftOf().target, selector: null } }),
		draftOf({ target: { ...draftOf().target, rect: null } }),
	]) {
		assert.notEqual(blockedTargetCopy(blocked), undefined);
		assert.equal(canSubmit(blocked, 'Bolder'), false);
	}
	// A page pick has no rect and is fine.
	const page = draftOf({ target: { ...draftOf().target, rect: null, isPage: true } });
	assert.equal(blockedTargetCopy(page), undefined);
});

test('a re-post never opens, never moves frames, and keeps the error; a user pick retargets', () => {
	const repost = userPick({ repost: true, point: { x: 50, y: 7 } });
	assert.equal(
		draftFromPick({ draft: undefined, frameId: 'a', pick: repost, generation: 2 }),
		undefined,
	);
	const failed = draftOf({ error: 'Pick it again.' });
	assert.equal(draftFromPick({ draft: failed, frameId: 'b', pick: repost, generation: 2 }), failed);
	const moved = draftFromPick({ draft: failed, frameId: 'a', pick: repost, generation: 9 });
	assert.equal(moved?.error, 'Pick it again.');
	assert.equal(moved?.generation, 2);
	assert.deepEqual(moved?.target.point, { x: 50, y: 7 });

	const pending = draftOf({ pendingRequestId: 'r1', error: 'old' });
	const retargeted = draftFromPick({
		draft: pending,
		frameId: 'b',
		pick: userPick({ selector: 'p', tagName: 'p', text: 'Other' }),
		generation: 5,
	});
	assert.equal(retargeted?.frameId, 'b');
	assert.equal(retargeted?.generation, 5);
	assert.equal(retargeted?.target.selector, 'p');
	assert.equal(retargeted?.pendingRequestId, 'r1');
	assert.equal(retargeted?.error, undefined);
});

test('submit carries the pick fields; answers match only the pending request', () => {
	const submitted = submitDraft({ draft: draftOf(), body: 'Bolder', requestId: 'r1' });
	assert.ok(submitted !== undefined);
	assert.equal(submitted.draft.pendingRequestId, 'r1');
	assert.deepEqual(submitted.message, {
		type: 'comment:create',
		requestId: 'r1',
		frameId: 'a',
		generation: 2,
		selector: 'h1',
		tagName: 'h1',
		text: 'Hello',
		rect: { x: 10, y: 20, width: 100, height: 40 },
		point: { x: 5, y: 6 },
		box: { width: 100, height: 40 },
		styles: {},
		isPage: false,
		body: 'Bolder',
	});
	assert.equal(submitDraft({ draft: submitted.draft, body: 'Again', requestId: 'r2' }), undefined);

	const pending = submitted.draft;
	assert.equal(answerDraft(pending, { type: 'comment:added', requestId: 'r0' }), pending);
	assert.equal(answerDraft(pending, { type: 'ui:error', message: 'x' }), pending);
	assert.equal(answerDraft(pending, { type: 'comment:added', requestId: 'r1' }), undefined);
	const failed = answerDraft(pending, {
		type: 'ui:error',
		requestId: 'r1',
		message: 'Pick it again.',
	});
	assert.equal(failed?.error, 'Pick it again.');
	assert.equal(failed?.pendingRequestId, undefined);
	assert.deepEqual(failed?.target, pending.target);
});

test('the draft closes when the mode ends or its frame is no longer a live iframe', () => {
	const draft = draftOf();
	assert.equal(keepLiveDraft({ draft, commentMode: true, liveFrameIds: new Set(['a']) }), draft);
	assert.equal(
		keepLiveDraft({ draft, commentMode: true, liveFrameIds: new Set(['b']) }),
		undefined,
	);
	assert.equal(
		keepLiveDraft({ draft, commentMode: false, liveFrameIds: new Set(['a']) }),
		undefined,
	);
});

test('the chip reads Whole frame, the element text, or its tag', () => {
	const { target } = draftOf();
	assert.equal(targetChipText(target), 'Hello');
	assert.equal(targetChipText({ ...target, text: '' }), '<h1>');
	assert.equal(targetChipText({ ...target, isPage: true }), 'Whole frame');
});

test('the anchor is the pick point on the drawn frame, clamped into the visible rect', () => {
	const view = { x: 100, y: 50, zoom: 2 };
	const frame = { x: 10, y: 0 };
	const rect = { x: 10, y: 20, width: 100, height: 40 };
	assert.deepEqual(popoverAnchor({ view, frame, target: { rect, point: { x: 5, y: 6 } } }), {
		x: (10 + 10 + 5) * 2 + 100,
		y: (0 + 20 + 6) * 2 + 50,
	});
	// A point past the visible rect (a clipped target) lands on its nearest visible spot.
	assert.deepEqual(popoverAnchor({ view, frame, target: { rect, point: { x: 500, y: 90 } } }), {
		x: (10 + 10 + 100) * 2 + 100,
		y: (0 + 20 + 40) * 2 + 50,
	});
	assert.deepEqual(popoverAnchor({ view, frame, target: { rect: null, point: { x: 5, y: 6 } } }), {
		x: 10 * 2 + 100,
		y: 50,
	});
});

test('the popover flips at the right and bottom edges and stays inside a small viewport', () => {
	const size = { width: 200, height: 100, viewportWidth: 800, viewportHeight: 600 };
	assert.deepEqual(placePopover({ ...size, anchor: { x: 100, y: 100 } }), { x: 108, y: 108 });
	assert.deepEqual(placePopover({ ...size, anchor: { x: 700, y: 100 } }), { x: 492, y: 108 });
	assert.deepEqual(placePopover({ ...size, anchor: { x: 100, y: 560 } }), { x: 108, y: 452 });
	assert.deepEqual(
		placePopover({ ...size, viewportWidth: 150, viewportHeight: 80, anchor: { x: 100, y: 60 } }),
		{ x: 8, y: 8 },
	);
});
