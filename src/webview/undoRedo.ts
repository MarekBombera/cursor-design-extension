import type { FrameRecord } from './canvasFrames';
import { frameLabel } from './commentsPanel';
import type { FrameMode } from './frame/frameMessages';
import type { HistoryStep } from './hostMessages';

// Undo / Redo rules (9f): the frame the inspector's buttons act on, whether a step is available,
// and which keys ask for one. Pure; EditState (editState.svelte.ts) holds the history frame and
// sends the steps; the host holds the history itself (src/host/editHistory.ts).

// The frame the Undo / Redo buttons act on (the latest Edit-mode pick's, kept after the pick
// drops), with its display name and the host's flags. Undefined disables both buttons.
export type HistoryTarget = { frameId: string; label: string; canUndo: boolean; canRedo: boolean };

export const historyTarget = ({
	frames,
	frameId,
}: {
	frames: readonly FrameRecord[];
	frameId: string | undefined;
}): HistoryTarget | undefined => {
	const frame = frames.find((candidate) => candidate.id === frameId);
	return frame === undefined
		? undefined
		: {
				frameId: frame.id,
				label: frameLabel(frames, frame.id),
				canUndo: frame.canUndo,
				canRedo: frame.canRedo,
			};
};

// Chrome focus: Cmd/Ctrl+Z undoes and with Shift redoes, in Edit mode only, never from a text
// field (its own native undo wins). It ignores defaultPrevented: VS Code's webview host may prevent
// undo / redo keydowns itself, to route them through the workbench. Ctrl+Y is not a shortcut.
// ponytail: `key` is layout-dependent, like the C key; a layout without `z` has the buttons.
export const historyKeyStep = ({
	key,
	ctrlKey,
	metaKey,
	altKey,
	shiftKey,
	repeat,
	isComposing,
	inTextEntry,
	mode,
}: {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	repeat: boolean;
	isComposing: boolean;
	inTextEntry: boolean;
	mode: FrameMode;
}): HistoryStep | undefined => {
	if (
		mode !== 'edit' ||
		!(ctrlKey || metaKey) ||
		altKey ||
		repeat ||
		isComposing ||
		inTextEntry ||
		(key !== 'z' && key !== 'Z')
	) {
		return undefined;
	}
	return shiftKey ? 'redo' : 'undo';
};

// Frame focus: a forwarded cd:key undo / redo. A design's own script can post the same
// message, so it counts only in Edit mode, from the history frame, while that frame holds focus.
export const forwardedHistoryStep = ({
	key,
	mode,
	senderFrameId,
	historyFrameId,
	senderHasFocus,
}: {
	key: HistoryStep;
	mode: FrameMode;
	senderFrameId: string;
	historyFrameId: string | undefined;
	senderHasFocus: boolean;
}): HistoryStep | undefined =>
	mode === 'edit' && senderFrameId === historyFrameId && senderHasFocus ? key : undefined;

// Whether the host holds a step of that kind, from the flags it last posted or answered.
export const canStep = (
	flags: Pick<HistoryTarget, 'canUndo' | 'canRedo'>,
	step: HistoryStep,
): boolean => (step === 'undo' ? flags.canUndo : flags.canRedo);
