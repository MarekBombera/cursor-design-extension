import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { beforeEach, test } from 'vite-plus/test';

import { hashHtml } from '../disk/hash';
import { MAX_HISTORY_STEPS } from '../disk/layout';
import {
	type HistoryEntry,
	type HistoryKey,
	clearEditHistories,
	forgetHistory,
	historyEpoch,
	historyFlags,
	historyStepTarget,
	keepUnchangedHistories,
	recordEdit,
	recordStep,
} from './editHistory';

const FRAME = 'hero';

const PAGE_A = 'page-1';

const PAGE_B = 'page-2';

const key = (frameId = FRAME, pageId = PAGE_A): HistoryKey => ({ pageId, frameId });

const entry = (html: string): HistoryEntry => ({ html, hash: hashHtml(html) });

const page = (index: number): HistoryEntry => entry(`<p>${index}</p>`);

const edit = (base: HistoryEntry, next: HistoryEntry, at = key()): void => {
	recordEdit({ ...at, base, next, epoch: historyEpoch() });
};

// What a step writes, then the record after its write succeeded.
const step = (stepName: 'undo' | 'redo', at = key()): HistoryEntry | undefined => {
	const target = historyStepTarget({ ...at, step: stepName });
	if (target === undefined) {
		return undefined;
	}
	recordStep({ ...at, step: stepName, baseHash: target.base.hash, epoch: historyEpoch() });
	return target.target;
};

beforeEach(() => {
	clearEditHistories();
});

test('a first edit starts a history whose undo is the base', () => {
	edit(page(0), page(1));
	assert.deepEqual(historyFlags(key()), { canUndo: true, canRedo: false });
	assert.deepEqual(historyStepTarget({ ...key(), step: 'undo' }), {
		base: page(1),
		target: page(0),
	});
	assert.equal(historyStepTarget({ ...key(), step: 'redo' }), undefined);
});

test('a chained edit pushes the current copy; another base starts fresh', () => {
	edit(page(0), page(1));
	edit(page(1), page(2));
	assert.deepEqual(step('undo'), page(1));
	assert.deepEqual(step('undo'), page(0));
	assert.equal(step('undo'), undefined);

	clearEditHistories();
	edit(page(0), page(1));
	edit(page(7), page(8));
	assert.deepEqual(step('undo'), page(7));
	assert.equal(step('undo'), undefined);
});

test('21 chained edits keep 20 undo steps and drop the very first base', () => {
	for (let index = 0; index <= MAX_HISTORY_STEPS; index += 1) {
		edit(page(index), page(index + 1));
	}
	const undone: HistoryEntry[] = [];
	for (let target = step('undo'); target !== undefined; target = step('undo')) {
		undone.push(target);
	}
	assert.equal(undone.length, MAX_HISTORY_STEPS);
	assert.deepEqual(undone.at(-1), page(1));
});

test('undo then redo move one entry each way; a new edit empties redo', () => {
	edit(page(0), page(1));
	assert.deepEqual(step('undo'), page(0));
	assert.deepEqual(historyFlags(key()), { canUndo: false, canRedo: true });
	assert.deepEqual(step('redo'), page(1));
	assert.deepEqual(historyFlags(key()), { canUndo: true, canRedo: false });
	assert.deepEqual(step('undo'), page(0));
	edit(page(0), page(2));
	assert.deepEqual(historyFlags(key()), { canUndo: true, canRedo: false });
	assert.deepEqual(step('undo'), page(0));
});

test('recordStep forgets a history that moved, and never creates one', () => {
	edit(page(0), page(1));
	recordStep({ ...key(), step: 'undo', baseHash: page(9).hash, epoch: historyEpoch() });
	assert.deepEqual(historyFlags(key()), { canUndo: false, canRedo: false });
	assert.equal(historyStepTarget({ ...key(), step: 'undo' }), undefined);

	recordStep({ ...key('other'), step: 'redo', baseHash: page(0).hash, epoch: historyEpoch() });
	assert.equal(historyStepTarget({ ...key('other'), step: 'undo' }), undefined);
});

test('a clear between reading the epoch and recording leaves the store empty', () => {
	const staleEpoch = historyEpoch();
	clearEditHistories();
	recordEdit({ ...key(), base: page(0), next: page(1), epoch: staleEpoch });
	assert.deepEqual(historyFlags(key()), { canUndo: false, canRedo: false });

	edit(page(0), page(1));
	const target = historyStepTarget({ ...key(), step: 'undo' });
	assert.ok(target !== undefined);
	const stepEpoch = historyEpoch();
	clearEditHistories();
	recordStep({ ...key(), step: 'undo', baseHash: target.base.hash, epoch: stepEpoch });
	assert.deepEqual(historyFlags(key()), { canUndo: false, canRedo: false });
});

test('keepUnchangedHistories keeps held hashes and forgets any other', () => {
	edit(page(0), page(1));
	edit(page(1), page(2));
	step('undo');
	// current page(1), undo [page(0)], redo [page(2)]
	for (const held of [page(0), page(1), page(2)]) {
		keepUnchangedHistories({ pageId: PAGE_A, frames: [{ id: FRAME, hash: held.hash }] });
		assert.deepEqual(historyFlags(key()), { canUndo: true, canRedo: true });
	}
	edit(page(5), page(6), key('other'));
	keepUnchangedHistories({ pageId: PAGE_A, frames: [{ id: 'untracked', hash: '' }] });
	assert.equal(historyFlags(key('other')).canUndo, true);

	keepUnchangedHistories({ pageId: PAGE_A, frames: [{ id: FRAME, hash: page(9).hash }] });
	assert.deepEqual(historyFlags(key()), { canUndo: false, canRedo: false });
	keepUnchangedHistories({ pageId: PAGE_A, frames: [{ id: 'other', hash: '' }] });
	assert.deepEqual(historyFlags(key('other')), { canUndo: false, canRedo: false });
});

test('forgetHistory drops one frame; clearEditHistories drops all', () => {
	edit(page(0), page(1));
	edit(page(0), page(1), key('other'));
	forgetHistory(key());
	assert.equal(historyFlags(key()).canUndo, false);
	assert.equal(historyFlags(key('other')).canUndo, true);
	clearEditHistories();
	assert.deepEqual(historyFlags(key('other')), { canUndo: false, canRedo: false });
	assert.deepEqual(historyFlags(key('never-edited')), { canUndo: false, canRedo: false });
});

test('the same frame id on two pages keeps two independent histories', () => {
	edit(page(0), page(1));
	edit(page(5), page(6), key(FRAME, PAGE_B));
	assert.deepEqual(step('undo', key(FRAME, PAGE_B)), page(5));
	assert.deepEqual(historyFlags(key(FRAME, PAGE_B)), { canUndo: false, canRedo: true });
	assert.deepEqual(historyFlags(key()), { canUndo: true, canRedo: false });
	forgetHistory(key(FRAME, PAGE_B));
	assert.deepEqual(step('undo'), page(0));
});

test("a snapshot of page B neither forgets nor reads page A's history", () => {
	edit(page(0), page(1));
	// B posts the same frame id with a hash A's history does not hold.
	keepUnchangedHistories({ pageId: PAGE_B, frames: [{ id: FRAME, hash: page(9).hash }] });
	assert.deepEqual(historyFlags(key()), { canUndo: true, canRedo: false });
	assert.deepEqual(historyFlags(key(FRAME, PAGE_B)), { canUndo: false, canRedo: false });
});

test("A's history survives an A → B → A round trip when A's hashes are unchanged", () => {
	edit(page(0), page(1));
	keepUnchangedHistories({ pageId: PAGE_A, frames: [{ id: FRAME, hash: page(1).hash }] });
	keepUnchangedHistories({ pageId: PAGE_B, frames: [{ id: FRAME, hash: page(7).hash }] });
	keepUnchangedHistories({ pageId: PAGE_A, frames: [{ id: FRAME, hash: page(1).hash }] });
	assert.deepEqual(step('undo'), page(0));
});

test('random edit / undo / redo sequences keep the cap and round-trip', () => {
	fc.assert(
		fc.property(fc.array(fc.constantFrom('edit', 'undo', 'redo'), { maxLength: 80 }), (actions) => {
			clearEditHistories();
			let disk = page(0);
			let fresh = 1;
			let undoCount = 0;
			let redoCount = 0;
			for (const action of actions) {
				if (action === 'edit') {
					// Every edit writes fresh, unique bytes, so no step is vacuous.
					const next = page(fresh);
					fresh += 1;
					edit(disk, next);
					disk = next;
					undoCount = Math.min(undoCount + 1, MAX_HISTORY_STEPS);
					redoCount = 0;
				} else {
					const target = step(action);
					if (target !== undefined) {
						const before = disk;
						disk = target;
						if (action === 'undo') {
							undoCount -= 1;
							redoCount += 1;
							// An undo followed by a redo returns the same current hash.
							assert.deepEqual(step('redo'), before);
							assert.deepEqual(step('undo'), target);
						} else {
							undoCount += 1;
							redoCount -= 1;
						}
					}
				}
				const flags = historyFlags(key());
				assert.equal(flags.canUndo, undoCount > 0);
				assert.equal(flags.canRedo, redoCount > 0);
				assert.ok(undoCount + redoCount <= MAX_HISTORY_STEPS);
				assert.equal(
					historyStepTarget({ ...key(), step: 'undo' })?.base.hash ?? disk.hash,
					disk.hash,
				);
			}
		}),
	);
});
