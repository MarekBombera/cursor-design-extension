import { MAX_HISTORY_STEPS } from '../disk/layout';
import type { HistoryStep } from '../webview/hostMessages';

// Undo / redo for the panel's own Edit-mode writes: whole-file snapshots per frame, in extension
// memory for the panel session, never on disk.
// ponytail: up to 21 whole files per frame (20 steps plus current), each at most
// MAX_POSTED_ARTBOARD_HTML_CHARS, and no cap on frames. Upgrade path: per-element inverses, or a
// global byte budget that evicts the oldest steps.

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

// One frame's history on one page: the same frame id on two pages is two histories.
export type HistoryKey = { pageId: string; frameId: string };

// A page id has no '/' (PAGE_ID_PATTERN), so the first one splits the key unambiguously.
const keyText = ({ pageId, frameId }: HistoryKey): string => `${pageId}/${frameId}`;

const histories = new Map<string, FrameHistory>();

// Bumped by every clear: a request that read the epoch before its awaited write records nothing
// once the panel closed or the folders changed meanwhile.
let epoch = 0;

export const historyEpoch = (): number => epoch;

const stepEntry = (history: FrameHistory, step: HistoryStep): HistoryEntry | undefined =>
	(step === 'undo' ? history.undo : history.redo).at(-1);

// One written edit: base = the disk file it replaced, next = the file written.
export const recordEdit = ({
	pageId,
	frameId,
	base,
	next,
	epoch: requestEpoch,
}: HistoryKey & {
	base: HistoryEntry;
	next: HistoryEntry;
	epoch: number;
}): void => {
	if (requestEpoch !== epoch) {
		return;
	}
	const history = histories.get(keyText({ pageId, frameId }));
	histories.set(
		keyText({ pageId, frameId }),
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
	pageId,
	frameId,
	step,
}: HistoryKey & {
	step: HistoryStep;
}): { base: HistoryEntry; target: HistoryEntry } | undefined => {
	const history = histories.get(keyText({ pageId, frameId }));
	const target = history === undefined ? undefined : stepEntry(history, step);
	return history === undefined || target === undefined
		? undefined
		: { base: history.current, target };
};

// After a step's write succeeded over baseHash. A history that moved meanwhile is forgotten: it
// no longer describes the file. A frame without history never gains one here.
export const recordStep = ({
	pageId,
	frameId,
	step,
	baseHash,
	epoch: requestEpoch,
}: HistoryKey & {
	step: HistoryStep;
	baseHash: string;
	epoch: number;
}): void => {
	const history = histories.get(keyText({ pageId, frameId }));
	if (requestEpoch !== epoch || history === undefined) {
		return;
	}
	const target = stepEntry(history, step);
	if (history.current.hash !== baseHash || target === undefined) {
		histories.delete(keyText({ pageId, frameId }));
		return;
	}
	histories.set(
		keyText({ pageId, frameId }),
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

export const forgetHistory = (key: HistoryKey): void => {
	histories.delete(keyText(key));
};

// The outside-change rule, per posted frame: a hash the history holds (current, undo or redo) is
// its own write or a refresh that read disk before it; any other hash, '' (unreadable) included,
// is a change from elsewhere and forgets that frame's history. Frames not listed, and every other
// page's histories, are left alone.
// ponytail: an outside write that recreates exactly a held state (an editor undo in the .html, a
// git checkout) is caught only by the next step's checked write, which then forgets the history.
// Upgrade path: store each entry's generation; a held hash at a newer generation is outside.
export const keepUnchangedHistories = ({
	pageId,
	frames,
}: {
	pageId: string;
	frames: ReadonlyArray<{ id: string; hash: string }>;
}): void => {
	for (const frame of frames) {
		const key = keyText({ pageId, frameId: frame.id });
		const history = histories.get(key);
		if (history === undefined) {
			continue;
		}
		const held = [history.current, ...history.undo, ...history.redo];
		if (!held.some((entry) => entry.hash === frame.hash)) {
			histories.delete(key);
		}
	}
};

// Panel closed or workspace folders changed.
export const clearEditHistories = (): void => {
	histories.clear();
	epoch += 1;
};

export const historyFlags = (key: HistoryKey): HistoryFlags => {
	const history = histories.get(keyText(key));
	return {
		canUndo: history !== undefined && history.undo.length > 0,
		canRedo: history !== undefined && history.redo.length > 0,
	};
};
