import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type { CommentStyles, FramePickMessage, FrameRect } from './frame/frameMessages';
import type { CommentAddedMessage, CommentCreateMessage, UiErrorMessage } from './hostMessages';
import { clampNumber, stageToScreen, type StagePoint, type StageView } from './stageGeometry';

export type DraftTarget = {
	selector: string | null;
	tagName: string;
	text: string;
	rect: FrameRect | null;
	point: { x: number; y: number };
	box: { width: number; height: number };
	styles: CommentStyles;
	isPage: boolean;
};

export type CommentDraft = {
	frameId: string;
	// The frame record's generation when the pick arrived.
	generation: number;
	target: DraftTarget;
	// Survives a retarget, dies with the draft.
	body: string;
	pendingRequestId?: string;
	// The host's ui:error answer, shown until the next user pick.
	error?: string;
};

export type PopoverKeyAction = 'add' | 'cancel' | 'parent' | 'child';

// The caller prevents the default of every non-undefined result, so the window keydown
// (modeKeyAction) then ignores the key. First match wins.
export const popoverKeyAction = ({
	key,
	shiftKey,
	ctrlKey,
	metaKey,
	altKey,
	isComposing,
	bodyEmpty,
	inTextarea,
}: {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	isComposing: boolean;
	bodyEmpty: boolean;
	inTextarea: boolean;
}): PopoverKeyAction | undefined => {
	if (isComposing) {
		return undefined;
	}
	if (key === 'Escape') {
		return 'cancel';
	}
	const modified = shiftKey || ctrlKey || metaKey || altKey;
	// Enter never inserts a newline; Shift+Enter does (native). Add is a no-op unless canSubmit.
	if (key === 'Enter' && inTextarea && !modified) {
		return 'add';
	}
	// Once the box has text, arrows move the caret (and are inert on buttons).
	if (bodyEmpty && !modified) {
		if (key === 'ArrowUp') {
			return 'parent';
		}
		if (key === 'ArrowDown') {
			return 'child';
		}
	}
	return undefined;
};

const toTarget = (pick: FramePickMessage): DraftTarget => ({
	selector: pick.selector,
	tagName: pick.tagName,
	text: pick.text,
	rect: pick.rect,
	point: pick.point,
	box: pick.box,
	styles: pick.styles,
	isPage: pick.isPage,
});

// A user pick opens or retargets the draft (keeps a pending request, drops a stale error). A
// re-post only moves the open draft's geometry: it never opens, moves frames or clears an error.
// ponytail: a pick from the old document between canvas:updated and the frame's reload gets the
// new generation. The window is milliseconds, and addComment's tag + text cross-check stores no
// fingerprint if the element differs. Upgrade path: track the generation the iframe shows.
// ponytail: a design script can post a forged user cd:pick and retarget the open draft; the text
// is kept and the chip shows the new target. Upgrade path: retarget only on a pick from the frame
// holding focus, as EditState does for the history frame.
export const draftFromPick = ({
	draft,
	frameId,
	pick,
	generation,
}: {
	draft: CommentDraft | undefined;
	frameId: string;
	pick: FramePickMessage;
	generation: number;
}): CommentDraft | undefined => {
	if (!pick.repost) {
		const opened: CommentDraft = {
			frameId,
			generation,
			target: toTarget(pick),
			body: draft?.body ?? '',
		};
		return draft?.pendingRequestId === undefined
			? opened
			: { ...opened, pendingRequestId: draft.pendingRequestId };
	}
	if (draft === undefined || draft.frameId !== frameId) {
		return draft;
	}
	return {
		...draft,
		target: { ...draft.target, rect: pick.rect, point: pick.point, box: pick.box },
	};
};

export const editDraftBody = (draft: CommentDraft, body: string): CommentDraft =>
	draft.pendingRequestId === undefined ? { ...draft, body } : draft;

export const blockedTargetCopy = (draft: CommentDraft): string | undefined => {
	if (draft.generation < 1) {
		return 'This artboard has no version yet. Ask the Agent to update it, then pick again.';
	}
	if (draft.target.selector === null) {
		return 'This element has no unique selector. Press ↑ to pick its parent.';
	}
	if (!draft.target.isPage && draft.target.rect === null) {
		return 'The element is out of view. Scroll it back or pick it again.';
	}
	return undefined;
};

export const canSubmit = (draft: CommentDraft, body: string): boolean => {
	const length = body.trim().length;
	return (
		draft.pendingRequestId === undefined &&
		length >= 1 &&
		length <= MAX_COMMENT_BODY_CHARS &&
		blockedTargetCopy(draft) === undefined
	);
};

export const submitDraft = ({
	draft,
	body,
	requestId,
}: {
	draft: CommentDraft;
	body: string;
	requestId: string;
}): { draft: CommentDraft; message: CommentCreateMessage } | undefined => {
	const { selector } = draft.target;
	if (!canSubmit(draft, body) || selector === null) {
		return undefined;
	}
	return {
		draft: { ...draft, pendingRequestId: requestId },
		message: {
			type: 'comment:create',
			requestId,
			frameId: draft.frameId,
			generation: draft.generation,
			selector,
			tagName: draft.target.tagName,
			text: draft.target.text,
			rect: draft.target.rect,
			point: draft.target.point,
			box: draft.target.box,
			styles: draft.target.styles,
			isPage: draft.target.isPage,
			body,
		},
	};
};

// Undefined closes the draft (the caller runs clearPick); an answer to another request returns
// the same draft object.
export const answerDraft = (
	draft: CommentDraft,
	answer: CommentAddedMessage | UiErrorMessage,
): CommentDraft | undefined => {
	if (answer.requestId === undefined || answer.requestId !== draft.pendingRequestId) {
		return draft;
	}
	if (answer.type === 'comment:added') {
		return undefined;
	}
	const { pendingRequestId: _pending, ...rest } = draft;
	return { ...rest, error: answer.message };
};

export const keepLiveDraft = ({
	draft,
	commentMode,
	liveFrameIds,
}: {
	draft: CommentDraft | undefined;
	commentMode: boolean;
	liveFrameIds: ReadonlySet<string>;
}): CommentDraft | undefined =>
	draft !== undefined && commentMode && liveFrameIds.has(draft.frameId) ? draft : undefined;

// A restored draft comes back on the first canvas:updated under keepLiveDraft's rule; either way
// the caller ends the hold.
export const resolveHeldDraft = ({
	held,
	commentMode,
	frames,
}: {
	held: CommentDraft | undefined;
	commentMode: boolean;
	frames: readonly FrameRecord[];
}): { draft?: CommentDraft } => {
	const draft = keepLiveDraft({ draft: held, commentMode, liveFrameIds: liveIframeIds(frames) });
	return draft === undefined ? {} : { draft };
};

// Frame data, rendered as text only.
export const targetChipText = (
	target: Pick<DraftTarget, 'isPage' | 'text' | 'tagName'>,
): string => {
	if (target.isPage) {
		return 'Whole frame';
	}
	return target.text === '' ? `<${target.tagName}>` : target.text;
};

// Viewport px on the drawn frame (drag preview included). The point is clamped into the visible
// rect, so a clipped target anchors at its nearest visible spot; nothing persists from this (the
// stored pin uses `box`).
export const popoverAnchor = ({
	view,
	frame,
	target,
}: {
	view: StageView;
	frame: StagePoint;
	target: Pick<DraftTarget, 'rect' | 'point'>;
}): StagePoint => {
	const { rect, point } = target;
	if (rect === null) {
		return stageToScreen({ view, stageX: frame.x, stageY: frame.y });
	}
	return stageToScreen({
		view,
		stageX: frame.x + rect.x + clampNumber({ value: point.x, min: 0, max: rect.width }),
		stageY: frame.y + rect.y + clampNumber({ value: point.y, min: 0, max: rect.height }),
	});
};

const POPOVER_GAP = 8;
const POPOVER_MARGIN = 8;

// Viewport-local px. Flips at a viewport edge, then clamps; the top-left wins when the popover is
// larger than the viewport.
export const placePopover = ({
	anchor,
	width,
	height,
	viewportWidth,
	viewportHeight,
}: {
	anchor: StagePoint;
	width: number;
	height: number;
	viewportWidth: number;
	viewportHeight: number;
}): StagePoint => {
	let x = anchor.x + POPOVER_GAP;
	let y = anchor.y + POPOVER_GAP;
	if (x + width > viewportWidth - POPOVER_MARGIN) {
		x = anchor.x - POPOVER_GAP - width;
	}
	if (y + height > viewportHeight - POPOVER_MARGIN) {
		y = anchor.y - POPOVER_GAP - height;
	}
	return {
		x: Math.max(POPOVER_MARGIN, Math.min(x, viewportWidth - width - POPOVER_MARGIN)),
		y: Math.max(POPOVER_MARGIN, Math.min(y, viewportHeight - height - POPOVER_MARGIN)),
	};
};
