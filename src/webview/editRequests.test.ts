import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { MAX_HISTORY_STEPS } from '../disk/layout';
import {
	answerEdit,
	clearErrorOnPick,
	type EditCommit,
	type EditRequestsState,
	enqueueEdit,
	enqueueStep,
	INITIAL_EDIT_REQUESTS,
	nextSend,
	NOT_SAVED_COPY,
	notSaved,
} from './editRequests';

const frame = (
	id: string,
	overrides: {
		hash?: string;
		documentVersion?: number;
		kind?: 'tile' | 'iframe';
		canUndo?: boolean;
		canRedo?: boolean;
	} = {},
) => ({
	id,
	kind: 'iframe' as const,
	hash: `sha256:${id}0`,
	documentVersion: 1,
	canUndo: false,
	canRedo: false,
	...overrides,
});

const editSent = (send: ReturnType<typeof nextSend>['send']) =>
	send?.type === 'artboard:edit' ? send : undefined;

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
	assert.equal(editSent(first.send)?.field, 'padding');
	assert.equal(editSent(first.send)?.hash, 'sha256:a0');
	assert.equal(editSent(first.send)?.sourceNumber, 3);
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
		canUndo: true,
		canRedo: false,
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
	assert.equal(editSent(second.send)?.field, 'margin');
	assert.equal(editSent(second.send)?.hash, 'sha256:a1');
});

test('a text commit carries its baseline liveText', () => {
	const { send } = nextSend({
		state: queued(commit({ field: 'text', value: 'New', liveText: ' Old ' })),
		frames: [frame('a')],
		newRequestId,
	});
	assert.equal(editSent(send)?.liveText, ' Old ');
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
	assert.equal(
		notSaved(refused.state, { key: undefined }).error?.message,
		refused.state.error?.message,
	);
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
			canUndo: true,
			canRedo: false,
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
	assert.equal(editSent(step.send)?.value, 'sent');
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
		key: { frameId: 'a', sourceNumber: 3, documentVersion: 1 },
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

// Undo / redo steps share the queue.
const edited = (requestId: string, frameId = 'a') =>
	({
		type: 'artboard:edited',
		requestId,
		frameId,
		hash: `sha256:${frameId}1`,
		generation: 2,
		html: '<p>1</p>',
		canUndo: true,
		canRedo: false,
	}) as const;

test('a step waits behind an in-flight edit and goes out after its answer, with no hash', () => {
	const first = nextSend({
		state: enqueueStep(queued(commit()), { frameId: 'a', step: 'undo' }),
		frames: [frame('a')],
		newRequestId,
	});
	assert.equal(first.send?.type, 'artboard:edit');
	assert.equal(
		nextSend({ state: first.state, frames: [frame('a')], newRequestId }).send,
		undefined,
	);
	const answered = answerEdit(first.state, edited(first.send?.requestId ?? ''));
	assert.equal(answered.stepDone, undefined);
	// The edit's answer set canUndo: the step is sent with that flag, after the adopt.
	const second = nextSend({
		state: answered.state,
		frames: [frame('a', { hash: 'sha256:a1', canUndo: true })],
		newRequestId,
	});
	assert.deepEqual(second.send, {
		type: 'artboard:history',
		requestId: second.send?.requestId,
		frameId: 'a',
		step: 'undo',
	});
	assert.equal(second.state.inFlight?.baseHash, 'sha256:a1');
});

test('a step whose flag is false, or whose frame is a tile or gone, is dropped with no copy', () => {
	const state = [
		{ frameId: 'a', step: 'redo' },
		{ frameId: 't', step: 'undo' },
		{ frameId: 'gone', step: 'undo' },
	].reduce(
		(queue, request) => enqueueStep(queue, request as { frameId: string; step: 'undo' | 'redo' }),
		INITIAL_EDIT_REQUESTS,
	);
	const step = nextSend({
		state,
		frames: [frame('a', { canUndo: true }), frame('t', { kind: 'tile', canUndo: true })],
		newRequestId,
	});
	assert.equal(step.send, undefined);
	assert.deepEqual(step.state, INITIAL_EDIT_REQUESTS);
});

test('a written step adopts, names the step and asks for no reload by itself', () => {
	const sent = nextSend({
		state: enqueueStep(INITIAL_EDIT_REQUESTS, { frameId: 'a', step: 'redo' }),
		frames: [frame('a', { canRedo: true })],
		newRequestId,
	});
	const answered = answerEdit(sent.state, edited(sent.send?.requestId ?? ''));
	assert.equal(answered.adopt?.baseHash, 'sha256:a0');
	assert.deepEqual(answered.stepDone, { frameId: 'a', step: 'redo' });
	assert.deepEqual(answered.reloadFrameIds, []);
	assert.equal(answered.state.inFlight, undefined);
	// Another frame's answer to the same id is ignored.
	assert.equal(answerEdit(sent.state, edited(sent.send?.requestId ?? '', 'b')).state, sent.state);
});

test('a refused step keeps its copy, drops steps silently and reloads only dropped edits', () => {
	let state = enqueueStep(INITIAL_EDIT_REQUESTS, { frameId: 'a', step: 'undo' });
	state = enqueueEdit(
		state,
		commit({ key: { frameId: 'b', sourceNumber: 1, documentVersion: 1 } }),
	);
	state = enqueueStep(state, { frameId: 'c', step: 'undo' });
	const sent = nextSend({ state, frames: [frame('a', { canUndo: true })], newRequestId });
	const refused = answerEdit(sent.state, {
		type: 'ui:error',
		requestId: sent.send?.requestId ?? '',
		message: 'This artboard changed on disk, so its undo history was cleared.',
	});
	assert.deepEqual(refused.reloadFrameIds, ['b']);
	assert.deepEqual(refused.state.waiting, []);
	assert.deepEqual(refused.state.error, {
		message: 'This artboard changed on disk, so its undo history was cleared.',
		key: undefined,
	});
	assert.equal(refused.stepDone, undefined);
	// Any new pick clears a step's copy.
	assert.equal(
		clearErrorOnPick(refused.state, { frameId: 'a', sourceNumber: 1, repost: false }).error,
		undefined,
	);
});

test('an edit committed while a step is in flight is not saved once the step reloads its frame', () => {
	const sent = nextSend({
		state: enqueueStep(INITIAL_EDIT_REQUESTS, { frameId: 'a', step: 'undo' }),
		frames: [frame('a', { canUndo: true })],
		newRequestId,
	});
	const withEdit = enqueueEdit(sent.state, commit());
	const answered = answerEdit(withEdit, edited(sent.send?.requestId ?? ''));
	// EditState reloaded the frame: its documentVersion moved past the draft's.
	const next = nextSend({
		state: answered.state,
		frames: [frame('a', { documentVersion: 2, hash: 'sha256:a1' })],
		newRequestId,
	});
	assert.equal(next.send, undefined);
	assert.equal(next.state.error?.message, NOT_SAVED_COPY);
});

test('enqueueStep clears the copy', () => {
	const failed = notSaved(INITIAL_EDIT_REQUESTS, { key: undefined });
	assert.equal(enqueueStep(failed, { frameId: 'a', step: 'undo' }).error, undefined);
});

test('at most MAX_HISTORY_STEPS steps wait; a further one is ignored', () => {
	let state = INITIAL_EDIT_REQUESTS;
	for (let index = 0; index < MAX_HISTORY_STEPS + 5; index += 1) {
		state = enqueueStep(state, { frameId: 'a', step: index % 2 === 0 ? 'undo' : 'redo' });
	}
	assert.equal(state.waiting.length, MAX_HISTORY_STEPS);
	// Edits still queue behind a full step queue.
	assert.equal(enqueueEdit(state, commit()).waiting.length, MAX_HISTORY_STEPS + 1);
});
