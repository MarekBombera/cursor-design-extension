import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type {
	CommentReplyMessage,
	CommentSavedMessage,
	CommentSetStatusMessage,
	PostedComment,
	UiErrorMessage,
} from './hostMessages';
import { type AnchorState, liveAnchor, type PinBadge, pinBadge } from './pins';

// Comments panel and comment-action rules (8g). Pure: App holds `actions` and posts the returned
// messages; CommentCard and CommentsPanel render what these return.

export type CommentAction = {
	// Composer text; undefined = composer closed.
	reply?: string;
	// The one request in flight for this comment.
	// ponytail: a lost answer (the host dies between the request and its answer) keeps `pending`
	// set until the webview reloads, which resets `actions`. The host always answers while the
	// chrome is ready, so there is no timeout. Upgrade path: a host-level answer timeout.
	pending?:
		| { requestId: string; kind: 'reply' }
		| { requestId: string; kind: 'status'; status: 'open' | 'resolved' };
	// The last failed request's host copy.
	error?: string;
};

// Keyed by comment id. An entry with no reply, pending or error is deleted.
export type CommentActions = ReadonlyMap<string, CommentAction>;

export type PanelItem = {
	comment: PostedComment;
	badge: PinBadge | undefined;
	// The drawn frame's label; the frame id when the frame is absent or its label is empty.
	frameLabel: string;
	// The frame is a live iframe, so the stage can jump to it.
	canJump: boolean;
};

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
	const labels = new Map(frames.map((frame) => [frame.id, frame.label]));
	const items = comments.map((comment): PanelItem => ({
		comment,
		badge: pinBadge({ comment, live: liveAnchor({ anchors, comment }) }),
		frameLabel: labels.get(comment.frameId) || comment.frameId,
		canJump: liveIds.has(comment.frameId),
	}));
	return {
		unresolved: items.filter((item) => item.comment.status !== 'resolved'),
		resolved: items.filter((item) => item.comment.status === 'resolved'),
	};
};

export const unresolvedCount = (comments: readonly PostedComment[]): number =>
	comments.filter((comment) => comment.status !== 'resolved').length;

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

// The host's answer to one request. An answer to no pending request returns the same object.
export const answerAction = ({
	actions,
	answer,
}: {
	actions: CommentActions;
	answer: CommentSavedMessage | UiErrorMessage;
}): { actions: CommentActions; announcement?: string } => {
	if (answer.requestId === undefined) {
		return { actions };
	}
	const match = [...actions].find(([, action]) => action.pending?.requestId === answer.requestId);
	if (match === undefined) {
		return { actions };
	}
	const [id, action] = match;
	const { pending } = action;
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
