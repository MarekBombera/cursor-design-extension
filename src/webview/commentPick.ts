import type {
	ChromeFrameMessage,
	FrameHoverMessage,
	FramePickMessage,
	FrameReadyMessage,
	FrameRect,
} from './frame/frameMessages';

// Comment-mode picking rules for the chrome. Pure: App owns the state, posts the sends, and
// draws the outlines.

export type CommentPickState = {
	commentMode: boolean;
	// Frame-local rects as the frame reported them.
	hover: { frameId: string; rect: FrameRect } | undefined;
	pick: { frameId: string; tagName: string; rect: FrameRect | null; isPage: boolean } | undefined;
};

type FrameSend = { frameId: string; message: ChromeFrameMessage };

export type CommentPickStep = { state: CommentPickState; sends: FrameSend[] };

export type PickStepType = 'cd:pick-parent' | 'cd:pick-child';

export const INITIAL_COMMENT_PICK: CommentPickState = {
	commentMode: false,
	hover: undefined,
	pick: undefined,
};

const frameModeMessage = (commentMode: boolean): ChromeFrameMessage => ({
	type: 'cd:mode',
	mode: commentMode ? 'comment' : 'interact',
});

// Flips the mode, forgets hover and pick, and tells every live frame.
export const toggleCommentMode = ({
	state,
	frameIds,
}: {
	state: CommentPickState;
	frameIds: Iterable<string>;
}): CommentPickStep => {
	const commentMode = !state.commentMode;
	const message = frameModeMessage(commentMode);
	return {
		state: { commentMode, hover: undefined, pick: undefined },
		sends: Array.from(frameIds, (frameId) => ({ frameId, message })),
	};
};

// After canvas:updated: frames that left the stage take their hover and pick with them, and an
// empty stage leaves Comment mode.
export const keepLiveFrames = ({
	state,
	liveFrameIds,
}: {
	state: CommentPickState;
	liveFrameIds: ReadonlySet<string>;
}): CommentPickState => ({
	commentMode: state.commentMode && liveFrameIds.size > 0,
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
				commentMode: state.commentMode,
				hover: state.hover?.frameId === frameId ? undefined : state.hover,
				pick: state.pick?.frameId === frameId ? undefined : state.pick,
			},
			sends: [{ frameId, message: frameModeMessage(state.commentMode) }],
		};
	}
	// A design script can post these any time; they only count in Comment mode.
	if (!state.commentMode) {
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
	// the reset it posts nothing, so the window is one message.
	const previous = state.pick;
	const sends: FrameSend[] =
		previous !== undefined && previous.frameId !== frameId
			? [{ frameId: previous.frameId, message: frameModeMessage(true) }]
			: [];
	const pick = {
		frameId,
		tagName: message.tagName,
		rect: message.rect,
		isPage: message.isPage,
	};
	return { state: { ...state, pick }, sends };
};

// ↑/↓ while focus is in chrome. Label nudges call preventDefault first, and modified arrows or
// arrows in a text field belong to someone else. With focus in a frame the runtime steps itself.
export const arrowPickStep = ({
	state,
	key,
	hasModifier,
	defaultPrevented,
	inTextEntry,
}: {
	state: CommentPickState;
	key: string;
	hasModifier: boolean;
	defaultPrevented: boolean;
	inTextEntry: boolean;
}): PickStepType | undefined => {
	if (!state.commentMode || state.pick === undefined || defaultPrevented || hasModifier) {
		return undefined;
	}
	if (inTextEntry) {
		return undefined;
	}
	if (key === 'ArrowUp') {
		return 'cd:pick-parent';
	}
	return key === 'ArrowDown' ? 'cd:pick-child' : undefined;
};
