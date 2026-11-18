import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type {
	CommentCopyMessage,
	CommentCopyOpenMessage,
	CommentReplyMessage,
	CommentSavedMessage,
	CommentSetStatusMessage,
	CopiedMessage,
	PostedComment,
	UiErrorMessage,
} from './hostMessages';
import {
	type AnchorState,
	commentNumber,
	liveAnchor,
	type PinBadge,
	pinBadge,
	statusBadge,
} from './pins';
import type { BadgeTone } from './ui/badge';
import type { IconName } from './ui/icons';

// Comments panel and comment-action rules (8g). Pure: App holds `actions` and posts the returned
// messages; CommentCard and CommentsPanel render what these return.

export type CommentAction = {
	// Composer text; undefined = composer closed.
	reply?: string;
	// The one request in flight for this comment.
	// ponytail: a lost answer (the host dies between the request and its answer) keeps `pending`
	// set until the webview reloads, which resets `actions`. The host always answers while the
	// chrome is ready, so there is no timeout. Upgrade path: a host-level answer timeout. A lost copy
	// answer also blocks every Copy button (one copy at a time) until that reload.
	pending?:
		| { requestId: string; kind: 'reply' }
		| { requestId: string; kind: 'status'; status: 'open' | 'resolved' }
		| { requestId: string; kind: 'copy' };
	// The last failed request's host copy.
	error?: string;
};

// Keyed by comment id. An entry with no reply, pending or error is deleted.
export type CommentActions = ReadonlyMap<string, CommentAction>;

export type PanelItem = {
	comment: PostedComment;
	// The comment's number (commentNumber), shared with its pin.
	number: number;
	badge: PinBadge | undefined;
	// frameLabel: the drawn frame's label, or the frame id.
	frameLabel: string;
	// The frame is a live iframe, so the stage can jump to it.
	canJump: boolean;
};

// The one rule for a frame's display name: its label, or its id when the frame is absent or its
// label is empty.
export const frameLabel = (frames: readonly FrameRecord[], frameId: string): string =>
	frames.find((frame) => frame.id === frameId)?.label || frameId;

// `comments` is the full comments.json list: it numbers the items.
export const panelItems = ({
	comments,
	anchors,
	frames,
}: {
	comments: readonly PostedComment[];
	anchors: AnchorState;
	frames: readonly FrameRecord[];
}): { unresolved: PanelItem[]; resolved: PanelItem[] } => {
	const liveIds = liveIframeIds(frames);
	const items = comments.map((comment, index): PanelItem => ({
		comment,
		number: commentNumber(index),
		badge: pinBadge({ comment, live: liveAnchor({ anchors, comment }) }),
		frameLabel: frameLabel(frames, comment.frameId),
		canJump: liveIds.has(comment.frameId),
	}));
	return {
		unresolved: items.filter((item) => item.comment.status !== 'resolved'),
		resolved: items.filter((item) => item.comment.status === 'resolved'),
	};
};

export type PanelSummary = Record<PostedComment['status'], number>;

// The comments per status: the panel header's summary and the handoff button. The toolbar's
// unresolved count is open + sent, added up in App.
export const panelSummary = (comments: readonly PostedComment[]): PanelSummary => ({
	open: comments.filter((comment) => comment.status === 'open').length,
	sent: comments.filter((comment) => comment.status === 'sent').length,
	resolved: comments.filter((comment) => comment.status === 'resolved').length,
});

const SUMMARY_WORDS: Record<PostedComment['status'], string> = {
	open: 'to send',
	sent: 'with Agent',
	resolved: 'resolved',
};

// The panel header's summary line, open, sent, resolved: each count with its status icon and tone
// (statusBadge). A zero count is left out, so all zero is an empty list and no line.
export const summaryParts = (
	summary: PanelSummary,
): { text: string; icon: IconName; tone: BadgeTone }[] =>
	(['open', 'sent', 'resolved'] as const)
		.filter((status) => summary[status] > 0)
		.map((status) => ({
			text: `${String(summary[status])} ${SUMMARY_WORDS[status]}`,
			icon: statusBadge(status).icon,
			tone: statusBadge(status).tone,
		}));

const commentsText = (count: number): string =>
	count === 1 ? '1 comment' : `${String(count)} comments`;

// The panel's handoff block. `copied` is the count of the copy-open answer still showing
// (undefined = no feedback). Feedback wins over everything, but "Copied 0 comments" never shows:
// it reads as nothing to send. `disabled` only at zero open with no feedback showing: the feedback
// is never drawn disabled, and submitCopyOpen ignores a click while it shows. A pending copy blocks
// on top of it.
export const handoffCopy = ({
	open,
	sent,
	copied,
}: {
	open: number;
	sent: number;
	copied?: number;
}): { label: string; hint: string | undefined; disabled: boolean; copied: boolean } => {
	const disabled = copied === undefined && open === 0;
	if (copied !== undefined && copied > 0) {
		return {
			label: `Copied ${commentsText(copied)}`,
			hint: 'Now paste into Cursor Agent chat.',
			disabled,
			copied: true,
		};
	}
	if (copied === undefined && open > 0) {
		return {
			label: `Copy ${open === 1 ? '1 open comment' : `${String(open)} open comments`} for Agent`,
			hint: 'Then paste into Cursor Agent chat.',
			disabled,
			copied: false,
		};
	}
	const hint =
		sent === 0 ? undefined : `${commentsText(sent)} ${sent === 1 ? 'is' : 'are'} with the Agent.`;
	return { label: 'Nothing new to send', hint, disabled, copied: false };
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// `now` in epoch ms. A future time (clock skew) reads as just now.
export const relativeTime = ({ iso, now }: { iso: string; now: number }): string | undefined => {
	const time = Date.parse(iso);
	if (Number.isNaN(time)) {
		return undefined;
	}
	const elapsed = now - time;
	if (elapsed < MINUTE_MS) {
		return 'just now';
	}
	if (elapsed < HOUR_MS) {
		return relativeFormat.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
	}
	if (elapsed < DAY_MS) {
		return relativeFormat.format(-Math.floor(elapsed / HOUR_MS), 'hour');
	}
	const days = Math.floor(elapsed / DAY_MS);
	if (days < 30) {
		return relativeFormat.format(-days, 'day');
	}
	if (days < 365) {
		return relativeFormat.format(-Math.floor(days / 30), 'month');
	}
	return relativeFormat.format(-Math.floor(days / 365), 'year');
};

const replyPending = (action: CommentAction | undefined): boolean =>
	action?.pending?.kind === 'reply';

const anythingPending = (action: CommentAction | undefined): boolean =>
	action?.pending !== undefined;

// The one write path: drops undefined keys, and the whole entry when nothing is left.
const withAction = ({
	actions,
	id,
	action,
}: {
	actions: CommentActions;
	id: string;
	action: CommentAction;
}): CommentActions => {
	const { reply, pending, error } = action;
	const next = new Map(actions);
	if (reply === undefined && pending === undefined && error === undefined) {
		next.delete(id);
		return next;
	}
	next.set(id, {
		...(reply === undefined ? {} : { reply }),
		...(pending === undefined ? {} : { pending }),
		...(error === undefined ? {} : { error }),
	});
	return next;
};

export const openReply = ({
	actions,
	id,
}: {
	actions: CommentActions;
	id: string;
}): CommentActions => {
	const action = actions.get(id);
	if (action?.reply !== undefined) {
		return actions;
	}
	return withAction({ actions, id, action: { ...action, reply: '' } });
};

export const editReply = ({
	actions,
	id,
	text,
}: {
	actions: CommentActions;
	id: string;
	text: string;
}): CommentActions => {
	const action = actions.get(id);
	if (replyPending(action)) {
		return actions;
	}
	return withAction({ actions, id, action: { ...action, reply: text } });
};

export const closeReply = ({
	actions,
	id,
}: {
	actions: CommentActions;
	id: string;
}): CommentActions => {
	const action = actions.get(id);
	if (action === undefined || replyPending(action)) {
		return actions;
	}
	return withAction({ actions, id, action: { ...action, reply: undefined, error: undefined } });
};

export const canSubmitReply = (action: CommentAction | undefined): boolean => {
	if (action?.reply === undefined || anythingPending(action)) {
		return false;
	}
	const length = action.reply.trim().length;
	return length >= 1 && length <= MAX_COMMENT_BODY_CHARS;
};

export const submitReply = ({
	actions,
	id,
	requestId,
}: {
	actions: CommentActions;
	id: string;
	requestId: string;
}): { actions: CommentActions; message?: CommentReplyMessage } => {
	const action = actions.get(id);
	if (action?.reply === undefined || !canSubmitReply(action)) {
		return { actions };
	}
	return {
		actions: withAction({
			actions,
			id,
			action: { ...action, pending: { requestId, kind: 'reply' }, error: undefined },
		}),
		message: { type: 'comment:reply', requestId, id, body: action.reply.trim() },
	};
};

// Resolve for open and sent, Reopen for resolved.
export const submitStatus = ({
	actions,
	comment,
	requestId,
}: {
	actions: CommentActions;
	comment: PostedComment;
	requestId: string;
}): { actions: CommentActions; message?: CommentSetStatusMessage } => {
	const action = actions.get(comment.id);
	if (anythingPending(action)) {
		return { actions };
	}
	const status = comment.status === 'resolved' ? 'open' : 'resolved';
	return {
		actions: withAction({
			actions,
			id: comment.id,
			action: { ...action, pending: { requestId, kind: 'status', status }, error: undefined },
		}),
		message: { type: 'comment:set-status', requestId, id: comment.id, status },
	};
};

// The panel's batch Copy for Agent: its one request in flight and its last failure (8h).
export type CopyOpenState = { pending?: string; error?: string };

// The Copy button that reads "Copied": one comment's card, or the copy-open button with the
// count its answer marked sent.
export type CopiedButton = { kind: 'comment'; id: string } | { kind: 'open'; count: number };

// How long a Copy button reads "Copied" after its own success.
export const COPY_FEEDBACK_MS = 1500;

// One copy at a time across the chrome, so the clipboard always holds the last answered copy.
export const copyPending = ({
	actions,
	copyOpen,
}: {
	actions: CommentActions;
	copyOpen: CopyOpenState;
}): boolean =>
	copyOpen.pending !== undefined ||
	[...actions.values()].some((action) => action.pending?.kind === 'copy');

export const copyAnnouncement = ({
	kind,
	count,
}: {
	kind: 'single' | 'batch';
	count: number;
}): string => {
	if (count === 0) {
		return 'Prompt copied.';
	}
	if (kind === 'single') {
		return 'Prompt copied. Comment marked sent.';
	}
	return `Prompt copied. ${commentsText(count)} marked sent.`;
};

export const submitCopy = ({
	actions,
	copyOpen,
	id,
	requestId,
}: {
	actions: CommentActions;
	copyOpen: CopyOpenState;
	id: string;
	requestId: string;
}): { actions: CommentActions; message?: CommentCopyMessage } => {
	const action = actions.get(id);
	if (copyPending({ actions, copyOpen }) || anythingPending(action)) {
		return { actions };
	}
	return {
		actions: withAction({
			actions,
			id,
			action: { ...action, pending: { requestId, kind: 'copy' }, error: undefined },
		}),
		message: { type: 'comment:copy', requestId, id },
	};
};

// `copiedShowing`: the button's "Copied" feedback is still up; a click on it copies nothing.
export const submitCopyOpen = ({
	actions,
	copyOpen,
	openCount,
	copiedShowing,
	requestId,
}: {
	actions: CommentActions;
	copyOpen: CopyOpenState;
	openCount: number;
	copiedShowing: boolean;
	requestId: string;
}): { copyOpen: CopyOpenState; message?: CommentCopyOpenMessage } => {
	if (openCount === 0 || copiedShowing || copyPending({ actions, copyOpen })) {
		return { copyOpen };
	}
	return {
		copyOpen: { pending: requestId },
		message: { type: 'comment:copy-open', requestId },
	};
};

// The host's answer to the batch Copy for Agent. A non-matching answer returns the same state. A success
// names how many comments the host marked sent, for the button's "Copied N comments".
export const answerCopyOpen = ({
	state,
	answer,
}: {
	state: CopyOpenState;
	answer: CopiedMessage | UiErrorMessage;
}): { state: CopyOpenState; announcement?: string; copiedCount?: number } => {
	if (state.pending === undefined || answer.requestId !== state.pending) {
		return { state };
	}
	if (answer.type === 'ui:error') {
		return { state: { error: answer.message }, announcement: answer.message };
	}
	return {
		state: {},
		announcement: copyAnnouncement({ kind: 'batch', count: answer.count }),
		copiedCount: answer.count,
	};
};

// The host's answer to one request. An answer to no pending request, or of the wrong kind
// (ui:copied only answers a copy, comment:saved only a reply or status), returns the same object.
export const answerAction = ({
	actions,
	answer,
}: {
	actions: CommentActions;
	answer: CommentSavedMessage | CopiedMessage | UiErrorMessage;
}): { actions: CommentActions; announcement?: string; copiedId?: string } => {
	if (answer.requestId === undefined) {
		return { actions };
	}
	const match = [...actions].find(([, action]) => action.pending?.requestId === answer.requestId);
	if (match === undefined) {
		return { actions };
	}
	const [id, action] = match;
	const { pending } = action;
	if ((answer.type === 'ui:copied') !== (pending?.kind === 'copy') && answer.type !== 'ui:error') {
		return { actions };
	}
	if (answer.type === 'ui:copied') {
		// Before the reply fallthrough: a copy never touches the composer.
		return {
			actions: withAction({ actions, id, action: { ...action, pending: undefined } }),
			announcement: copyAnnouncement({ kind: 'single', count: answer.count }),
			copiedId: id,
		};
	}
	if (answer.type === 'ui:error') {
		return {
			actions: withAction({
				actions,
				id,
				action: { ...action, pending: undefined, error: answer.message },
			}),
			announcement: answer.message,
		};
	}
	if (pending?.kind === 'status') {
		return {
			actions: withAction({ actions, id, action: { ...action, pending: undefined } }),
			announcement: pending.status === 'resolved' ? 'Comment resolved.' : 'Comment reopened.',
		};
	}
	return {
		actions: withAction({ actions, id, action: { ...action, reply: '', pending: undefined } }),
		announcement: 'Reply added.',
	};
};

// On comments:updated. An update with `error` lists nothing usable, so every action (and its typed
// text) survives a transient read failure. Otherwise ids no longer listed are dropped, so a late
// answer finds nothing.
export const keepLiveActions = ({
	actions,
	comments,
	error,
}: {
	actions: CommentActions;
	comments: readonly PostedComment[];
	error: string | undefined;
}): CommentActions => {
	if (error !== undefined) {
		return actions;
	}
	const listed = new Set(comments.map((comment) => comment.id));
	if ([...actions.keys()].every((id) => listed.has(id))) {
		return actions;
	}
	return new Map([...actions].filter(([id]) => listed.has(id)));
};

// The one alternating live-region rule: equal text is not re-announced, so every even sequence
// ends in a no-break space and a repeat still speaks.
export const liveRegionText = ({ text, sequence }: { text: string; sequence: number }): string =>
	sequence % 2 === 0 ? `${text} ` : text;
