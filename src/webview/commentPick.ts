import type {
	ChromeFrameMessage,
	FrameHoverMessage,
	FrameMode,
	FramePickMessage,
	FrameReadyMessage,
	FrameRect,
} from './frame/frameMessages';

// Picking rules for both Comment and Edit mode.

// Frame data, untrusted: shown only as text.
export type ChromePick = { frameId: string; sequence: number } & Omit<FramePickMessage, 'type'>;

export type CommentPickState = {
	mode: FrameMode;
	// Frame-local rects as the frame reported them.
	hover: { frameId: string; rect: FrameRect } | undefined;
	pick: ChromePick | undefined;
};

type FrameSend = { frameId: string; message: ChromeFrameMessage };

export type CommentPickStep = { state: CommentPickState; sends: FrameSend[] };

export type PickStepType = 'cd:pick-parent' | 'cd:pick-child';

export const INITIAL_COMMENT_PICK: CommentPickState = {
	mode: 'interact',
	hover: undefined,
	pick: undefined,
};

const frameModeMessage = (mode: FrameMode): ChromeFrameMessage => ({ type: 'cd:mode', mode });

export const pressedMode = (current: FrameMode, pressed: FrameMode): FrameMode =>
	pressed === current ? 'interact' : pressed;

// Callers skip a repeat of the current mode, so a repeat never drops a pick or draft.
export const chooseMode = ({
	mode,
	frameIds,
}: {
	mode: FrameMode;
	frameIds: Iterable<string>;
}): CommentPickStep => {
	const message = frameModeMessage(mode);
	return {
		state: { mode, hover: undefined, pick: undefined },
		sends: Array.from(frameIds, (frameId) => ({ frameId, message })),
	};
};

// A design script can post cd:hover / cd:pick any time, and a pick can be in flight across a mode
// change: an Edit-mode pick carries `edit`, a Comment-mode pick never does.
export const pickCounts = ({
	mode,
	message,
}: {
	mode: FrameMode;
	message: FrameHoverMessage | FramePickMessage;
}): boolean => {
	if (mode === 'interact') {
		return false;
	}
	if (message.type === 'cd:hover') {
		return true;
	}
	return (message.edit !== undefined) === (mode === 'edit');
};

export const keepLiveFrames = ({
	state,
	liveFrameIds,
}: {
	state: CommentPickState;
	liveFrameIds: ReadonlySet<string>;
}): CommentPickState => ({
	mode: liveFrameIds.size > 0 ? state.mode : 'interact',
	hover:
		state.hover !== undefined && liveFrameIds.has(state.hover.frameId) ? state.hover : undefined,
	pick: state.pick !== undefined && liveFrameIds.has(state.pick.frameId) ? state.pick : undefined,
});

export const applyPickMessage = ({
	state,
	frameId,
	message,
}: {
	state: CommentPickState;
	frameId: string;
	message: FrameReadyMessage | FrameHoverMessage | FramePickMessage;
}): CommentPickStep => {
	if (message.type === 'cd:ready') {
		// A first load or a reload: the frame has no pick, so chrome drops its stale ones.
		return {
			state: {
				mode: state.mode,
				hover: state.hover?.frameId === frameId ? undefined : state.hover,
				pick: state.pick?.frameId === frameId ? undefined : state.pick,
			},
			sends: [{ frameId, message: frameModeMessage(state.mode) }],
		};
	}
	if (!pickCounts({ mode: state.mode, message })) {
		return { state, sends: [] };
	}
	if (message.type === 'cd:hover') {
		if (message.rect !== null) {
			return { state: { ...state, hover: { frameId, rect: message.rect } }, sends: [] };
		}
		const hover = state.hover?.frameId === frameId ? undefined : state.hover;
		return { state: { ...state, hover }, sends: [] };
	}
	// One pick across frames: the previous frame forgets its path (cd:mode resets it).
	// ponytail: a cd:pick already in flight from that frame can still flip the pick back; after
	// the reset it posts nothing, so the window is one message. Upgrade path: a pick epoch sent in
	// cd:mode and echoed in cd:pick.
	const previous = state.pick;
	// A re-post only moves a pick chrome still holds. One already in flight when the draft closed
	// (clearPick) would otherwise put the outline back on a frame that forgot its path.
	if (message.repost && previous?.frameId !== frameId) {
		return { state, sends: [] };
	}
	const sends: FrameSend[] =
		previous !== undefined && previous.frameId !== frameId
			? [{ frameId: previous.frameId, message: frameModeMessage(state.mode) }]
			: [];
	const { type: _type, ...fields } = message;
	// Counts picks so the Toolbar's live region text changes even when two picks read the same. A
	// re-post (scroll, edit preview) is the same pick: it keeps the count, so nothing re-announces.
	const sequence =
		message.repost && previous !== undefined ? previous.sequence : (previous?.sequence ?? 0) + 1;
	return { state: { ...state, pick: { frameId, sequence, ...fields } }, sends };
};

// The frame forgets its path too (cd:mode resets it).
export const clearPick = (state: CommentPickState): CommentPickStep => ({
	state: { ...state, pick: undefined },
	sends:
		state.pick === undefined
			? []
			: [{ frameId: state.pick.frameId, message: frameModeMessage(state.mode) }],
});

export type ModeKeyAction = 'toggle' | 'exit' | 'cancel';

// C and Escape, from the chrome's own keydown or a frame's cd:key (`forwarded`, already filtered
// by the runtime). First match wins. While the popover is open it owns keys: only a chrome Escape
// that reaches here (focus had left the popover) cancels it, so neither C nor a forged cd:key
// discards a draft. 'toggle' presses Comment.
export type ModeKeyInput = {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	repeat: boolean;
	defaultPrevented: boolean;
	inTextEntry: boolean;
	mode: FrameMode;
	hasFrames: boolean;
	popoverOpen: boolean;
	forwarded: boolean;
};

export const modeKeyAction = ({
	key,
	ctrlKey,
	metaKey,
	altKey,
	repeat,
	defaultPrevented,
	inTextEntry,
	mode,
	hasFrames,
	popoverOpen,
	forwarded,
}: ModeKeyInput): ModeKeyAction | undefined => {
	if (defaultPrevented || inTextEntry || ctrlKey || metaKey || altKey || repeat) {
		return undefined;
	}
	if (popoverOpen) {
		return key === 'Escape' && !forwarded ? 'cancel' : undefined;
	}
	if (key === 'c' || key === 'C') {
		return hasFrames ? 'toggle' : undefined;
	}
	return key === 'Escape' && mode !== 'interact' ? 'exit' : undefined;
};
