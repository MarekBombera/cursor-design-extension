import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
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
import { commentsText } from './commentsPanel';

// Comment-action rules (8g, 8h): reply, status and copy requests, one in flight per comment and one
// copy at a time, and the host's answers to them. Pure: App holds `actions` and posts the returned
// messages.

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

// Also App's reply-text save: a reply in flight is not saved.
export const replyPending = (action: CommentAction | undefined): boolean =>
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
	const announcement = copyAnnouncement({ kind: 'batch', count: answer.count });
	// Nothing marked sent shows no Copied feedback: the button keeps its "Nothing new to send" look.
	return answer.count > 0
		? { state: {}, announcement, copiedCount: answer.count }
		: { state: {}, announcement };
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
