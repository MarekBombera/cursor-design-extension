import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	answerEdit,
	clearErrorOnPick,
	type EditCommit,
	type EditRequestsState,
	enqueueEdit,
	INITIAL_EDIT_REQUESTS,
	nextSend,
	NOT_SAVED_COPY,
	notSaved,
} from './editRequests';

const frame = (
	id: string,
	overrides: { hash?: string; documentVersion?: number; kind?: 'tile' | 'iframe' } = {},
) => ({
	id,
	kind: 'iframe' as const,
	hash: `sha256:${id}0`,
	documentVersion: 1,
	...overrides,
});

const commit = (overrides: Partial<EditCommit> = {}): EditCommit => ({
	key: { frameId: 'a', sourceNumber: 3, documentVersion: 1 },
	field: 'padding',
	value: '8',
	...overrides,
});

let counter = 0;
const newRequestId = (): string => {
	counter += 1;
	return `r${counter}`;
};

const queued = (...commits: EditCommit[]): EditRequestsState =>
	commits.reduce(enqueueEdit, INITIAL_EDIT_REQUESTS);

test('two commits: one in flight, the second goes out after the answer with its hash', () => {
	const first = nextSend({
		state: queued(commit(), commit({ field: 'margin', value: '4' })),
		frames: [frame('a')],
		newRequestId,
	});
	assert.equal(first.send?.field, 'padding');
	assert.equal(first.send?.hash, 'sha256:a0');
	assert.equal(first.send?.sourceNumber, 3);
	assert.equal('liveText' in (first.send ?? {}), false);
	// Nothing else leaves while one is in flight.
	assert.equal(
		nextSend({ state: first.state, frames: [frame('a')], newRequestId }).send,
		undefined,
	);
	const answered = answerEdit(first.state, {
		type: 'artboard:edited',
		requestId: first.send?.requestId ?? '',
		frameId: 'a',
		hash: 'sha256:a1',
		generation: 2,
		html: '<p>1</p>',
	});
	assert.equal(answered.adopt?.baseHash, 'sha256:a0');
	// CanvasState adopts the answer before the next send reads the hash.
	const second = nextSend({
		state: answered.state,
		frames: [frame('a', { hash: 'sha256:a1' })],
		newRequestId,
	});
	assert.equal(second.send?.field, 'margin');
	assert.equal(second.send?.hash, 'sha256:a1');
});

test('a text commit carries its baseline liveText', () => {
	const { send } = nextSend({
		state: queued(commit({ field: 'text', value: 'New', liveText: ' Old ' })),
		frames: [frame('a')],
		newRequestId,
	});
	assert.equal(send?.liveText, ' Old ');
});

test('a refusal keeps its copy, drops the queue and names every frame to reload', () => {
	const first = nextSend({
		state: queued(commit(), commit({ key: { frameId: 'b', sourceNumber: 1, documentVersion: 1 } })),
		frames: [frame('a'), frame('b')],
		newRequestId,
	});
	const refused = answerEdit(first.state, {
		type: 'ui:error',
		requestId: first.send?.requestId ?? '',
		message: 'This artboard changed on disk. Make the edit again.',
	});
	assert.deepEqual(refused.state.waiting, []);
	assert.equal(refused.state.inFlight, undefined);
	assert.equal(refused.state.error?.message, 'This artboard changed on disk. Make the edit again.');
	assert.deepEqual([...refused.reloadFrameIds].sort(), ['a', 'b']);
	// The reload ends drafts in the same event: the refusal copy wins.
	assert.equal(notSaved(refused.state, undefined).error?.message, refused.state.error?.message);
});

test('answers for another request or frame are ignored', () => {
	const first = nextSend({ state: queued(commit()), frames: [frame('a')], newRequestId });
	for (const message of [
		{ type: 'ui:error', requestId: 'other', message: 'x' },
		{
			type: 'artboard:edited',
			requestId: first.send?.requestId ?? '',
			frameId: 'b',
			hash: 'sha256:b1',
			generation: 2,
			html: '',
		},
	] as const) {
		const step = answerEdit(first.state, message);
		assert.equal(step.state, first.state);
		assert.equal(step.adopt, undefined);
	}
	assert.equal(
		answerEdit(INITIAL_EDIT_REQUESTS, { type: 'ui:error', message: 'x' }).adopt,
		undefined,
	);
});

test('a commit whose frame reloaded, left or became a tile is dropped and the next still goes', () => {
	const state = queued(
		commit({ value: 'reloaded' }),
		commit({ key: { frameId: 'gone', sourceNumber: 1, documentVersion: 1 }, value: 'gone' }),
		commit({ key: { frameId: 't', sourceNumber: 1, documentVersion: 1 }, value: 'tile' }),
		commit({ key: { frameId: 'b', sourceNumber: 1, documentVersion: 1 }, value: 'sent' }),
	);
	const step = nextSend({
		state,
		frames: [frame('a', { documentVersion: 2 }), frame('t', { kind: 'tile' }), frame('b')],
		newRequestId,
	});
	assert.equal(step.send?.value, 'sent');
	assert.equal(step.state.error?.message, NOT_SAVED_COPY);
	assert.deepEqual(step.state.waiting, []);
	// All dropped: nothing sent, the queue is empty, the copy shows.
	const none = nextSend({ state: queued(commit()), frames: [], newRequestId });
	assert.equal(none.send, undefined);
	assert.deepEqual(none.state.waiting, []);
	assert.equal(none.state.error?.message, NOT_SAVED_COPY);
});

test('the copy clears on a new pick of another element only; a commit clears it too', () => {
	const failed = notSaved(INITIAL_EDIT_REQUESTS, {
		frameId: 'a',
		sourceNumber: 3,
		documentVersion: 1,
	});
	assert.equal(clearErrorOnPick(failed, { frameId: 'a', sourceNumber: 3, repost: false }), failed);
	assert.equal(clearErrorOnPick(failed, { frameId: 'a', sourceNumber: 4, repost: true }), failed);
	assert.equal(
		clearErrorOnPick(failed, { frameId: 'a', sourceNumber: 4, repost: false }).error,
		undefined,
	);
	assert.equal(
		clearErrorOnPick(failed, { frameId: 'b', sourceNumber: 3, repost: false }).error,
		undefined,
	);
	assert.equal(enqueueEdit(failed, commit()).error, undefined);
});
