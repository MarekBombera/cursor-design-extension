import { MAX_HISTORY_STEPS } from '../disk/layout';
import type { HistoryStep } from '../webview/hostMessages';

// Undo / redo for the panel's own Edit-mode writes (9f): whole-file snapshots per frame, in
// extension memory for the panel session, never on disk. No `vscode` import: the store and its
// rules stay unit-testable; panelEdit.ts writes, the outbox reads the flags and checks snapshots.
// ponytail: up to 21 whole files per frame (20 steps plus the current copy), each at most
// MAX_POSTED_ARTBOARD_HTML_CHARS, and no cap on the number of frames, so the total is unbounded
// across frames. Upgrade path: per-element inverses instead of whole files, or a global byte
// budget that evicts the oldest steps.

// hash = hashHtml(html): sha256: plus lowercase hex.
export type HistoryEntry = { html: string; hash: string };

// undo.length + redo.length ≤ MAX_HISTORY_STEPS: an edit grows undo by one (capped) and empties
// redo; a step moves one entry between them. `current` is what the extension last wrote.
type FrameHistory = {
	undo: readonly HistoryEntry[];
	redo: readonly HistoryEntry[];
	current: HistoryEntry;
};

export type HistoryFlags = { canUndo: boolean; canRedo: boolean };

const histories = new Map<string, FrameHistory>();

// Bumped by every clear: a request that read the epoch before its awaited write records nothing
// once the panel closed or the folders changed meanwhile.
let epoch = 0;

export const historyEpoch = (): number => epoch;

// The entry a step restores: the top of its stack.
const stepEntry = (history: FrameHistory, step: HistoryStep): HistoryEntry | undefined =>
	(step === 'undo' ? history.undo : history.redo).at(-1);

// One written edit: base = the disk file it replaced, next = the file written.
export const recordEdit = ({
	frameId,
	base,
	next,
	epoch: requestEpoch,
}: {
	frameId: string;
	base: HistoryEntry;
	next: HistoryEntry;
	epoch: number;
}): void => {
	if (requestEpoch !== epoch) {
		return;
	}
	const history = histories.get(frameId);
	histories.set(
		frameId,
		history?.current.hash === base.hash
			? {
					undo: [...history.undo, history.current].slice(-MAX_HISTORY_STEPS),
					redo: [],
					current: next,
				}
			: { undo: [base], redo: [], current: next },
	);
};

// What a step would write (target) over what the extension last wrote (base).
export const historyStepTarget = ({
	frameId,
	step,
}: {
	frameId: string;
	step: HistoryStep;
}): { base: HistoryEntry; target: HistoryEntry } | undefined => {
	const history = histories.get(frameId);
	const target = history === undefined ? undefined : stepEntry(history, step);
	return history === undefined || target === undefined
		? undefined
		: { base: history.current, target };
};

// After a step's write succeeded over baseHash. A history that moved meanwhile is forgotten: it
// no longer describes the file. A frame without history never gains one here.
export const recordStep = ({
	frameId,
	step,
	baseHash,
	epoch: requestEpoch,
}: {
	frameId: string;
	step: HistoryStep;
	baseHash: string;
	epoch: number;
}): void => {
	const history = histories.get(frameId);
	if (requestEpoch !== epoch || history === undefined) {
		return;
	}
	const target = stepEntry(history, step);
	if (history.current.hash !== baseHash || target === undefined) {
		histories.delete(frameId);
		return;
	}
	histories.set(
		frameId,
		step === 'undo'
			? {
					undo: history.undo.slice(0, -1),
					redo: [...history.redo, history.current],
					current: target,
				}
			: {
					undo: [...history.undo, history.current],
					redo: history.redo.slice(0, -1),
					current: target,
				},
	);
};

export const forgetHistory = (frameId: string): void => {
	histories.delete(frameId);
};

// The outside-change rule, per posted frame: a hash the history holds (current, undo or redo) is
// its own write or a refresh that read disk before it; any other hash, '' (unreadable) included,
// is a change from elsewhere and forgets that frame's history. Frames not listed are left alone.
// ponytail: an outside write that recreates exactly a held state (an editor undo in the .html, a
// git checkout) is caught only by the next step's checked write, which then forgets the history.
export const keepUnchangedHistories = (
	frames: ReadonlyArray<{ id: string; hash: string }>,
): void => {
	for (const frame of frames) {
		const history = histories.get(frame.id);
		if (history === undefined) {
			continue;
		}
		const held = [history.current, ...history.undo, ...history.redo];
		if (!held.some((entry) => entry.hash === frame.hash)) {
			histories.delete(frame.id);
		}
	}
};

// Panel closed or workspace folders changed.
export const clearEditHistories = (): void => {
	histories.clear();
	epoch += 1;
};

export const historyFlags = (frameId: string): HistoryFlags => {
	const history = histories.get(frameId);
	return {
		canUndo: history !== undefined && history.undo.length > 0,
		canRedo: history !== undefined && history.redo.length > 0,
	};
};
