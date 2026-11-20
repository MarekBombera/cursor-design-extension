import {
	answerAction,
	answerCopyOpen,
	closeReply,
	type CommentAction,
	type CommentActions,
	COPY_FEEDBACK_MS,
	type CopiedButton,
	copyPending,
	type CopyOpenState,
	editReply,
	keepLiveActions,
	openReply,
	replyPending,
	submitCopy,
	submitCopyOpen,
	submitReply,
	submitStatus,
} from './commentActions';
import { panelSummary } from './commentsPanel';
import {
	postCommentRequest,
	readSavedCommentsPanelOpen,
	saveCommentsPanelOpen,
} from './hostBridge.svelte';
import type {
	CommentSavedMessage,
	CommentsUpdatedMessage,
	CopiedMessage,
	PostedComment,
	UiErrorMessage,
} from './hostMessages';

export class CommentsState {
	comments: PostedComment[] = $state([]);
	commentsError: string | undefined = $state();
	// The last comments:updated carried no error.
	commentsKnown = $state(false);
	// By comment id. Restored reply text opens its composer.
	actions: CommentActions;
	copyOpen: CopyOpenState = $state({});
	copyFeedback: (CopiedButton & { sequence: number }) | undefined = $state.raw();
	// The comments live region's text; the sequence makes a repeat speak again (liveRegionText).
	announcement = $state({ text: '', sequence: 0 });
	commentsPanelOpen = $state(readSavedCommentsPanelOpen());
	now = $state(Date.now());

	// One copy at a time across the chrome.
	readonly copyBlocked = $derived.by(() =>
		copyPending({ actions: this.actions, copyOpen: this.copyOpen }),
	);
	readonly summary = $derived(panelSummary(this.comments));

	constructor(replyDrafts: Readonly<Record<string, string>>) {
		this.actions = $state.raw(
			new Map<string, CommentAction>(
				Object.entries(replyDrafts).map(([id, reply]) => [id, { reply }]),
			),
		);

		$effect(() => {
			if (this.copyFeedback === undefined) {
				return;
			}
			const timer = setTimeout(() => {
				this.copyFeedback = undefined;
			}, COPY_FEEDBACK_MS);
			return () => {
				clearTimeout(timer);
			};
		});

		$effect(() => {
			const timer = setInterval(() => {
				this.now = Date.now();
			}, 60_000);
			return () => {
				clearInterval(timer);
			};
		});
	}

	// Reply text kept across a reload: never a pending reply's (the host never replays its answer).
	get savedReplyDrafts(): Record<string, string> {
		return Object.fromEntries(
			[...this.actions].flatMap(([id, action]): [string, string][] =>
				action.reply === undefined || replyPending(action) ? [] : [[id, action.reply]],
			),
		);
	}

	applyCommentsUpdated = (message: CommentsUpdatedMessage): void => {
		this.comments = message.comments;
		this.commentsError = message.error;
		this.commentsKnown = message.error === undefined;
		this.actions = keepLiveActions({
			actions: this.actions,
			comments: message.comments,
			error: message.error,
		});
	};

	#announce = (text: string | undefined): void => {
		if (text !== undefined) {
			this.announcement = { text, sequence: this.announcement.sequence + 1 };
		}
	};

	handleReplyOpen = (id: string): void => {
		this.actions = openReply({ actions: this.actions, id });
	};

	handleReplyInput = (id: string, text: string): void => {
		this.actions = editReply({ actions: this.actions, id, text });
	};

	handleReplyCancel = (id: string): void => {
		this.actions = closeReply({ actions: this.actions, id });
	};

	handleReplySubmit = (id: string): void => {
		const submitted = submitReply({ actions: this.actions, id, requestId: crypto.randomUUID() });
		this.actions = submitted.actions;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	handleToggleStatus = (id: string): void => {
		const comment = this.comments.find((entry) => entry.id === id);
		if (comment === undefined) {
			return;
		}
		const submitted = submitStatus({
			actions: this.actions,
			comment,
			requestId: crypto.randomUUID(),
		});
		this.actions = submitted.actions;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	handleCopy = (id: string): void => {
		const submitted = submitCopy({
			actions: this.actions,
			copyOpen: this.copyOpen,
			id,
			requestId: crypto.randomUUID(),
		});
		this.actions = submitted.actions;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	handleCopyOpen = (): void => {
		const submitted = submitCopyOpen({
			actions: this.actions,
			copyOpen: this.copyOpen,
			openCount: this.summary.open,
			copiedShowing: this.copyFeedback?.kind === 'open',
			requestId: crypto.randomUUID(),
		});
		this.copyOpen = submitted.copyOpen;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	// A new success replaces any other button's "Copied" and restarts its timer (sequence).
	#showCopied = (button: CopiedButton): void => {
		this.copyFeedback = { ...button, sequence: (this.copyFeedback?.sequence ?? 0) + 1 };
	};

	handleToggleCommentsPanel = (): void => {
		this.commentsPanelOpen = !this.commentsPanelOpen;
		saveCommentsPanelOpen(this.commentsPanelOpen);
	};

	handleActionAnswer = (answer: CommentSavedMessage | CopiedMessage | UiErrorMessage): void => {
		const answered = answerAction({ actions: this.actions, answer });
		this.actions = answered.actions;
		if (answered.copiedId !== undefined) {
			this.#showCopied({ kind: 'comment', id: answered.copiedId });
		}
		this.#announce(answered.announcement);
	};

	handleCopyOpenAnswer = (answer: CopiedMessage | UiErrorMessage): void => {
		const answered = answerCopyOpen({ state: this.copyOpen, answer });
		this.copyOpen = answered.state;
		if (answered.copiedCount !== undefined) {
			this.#showCopied({ kind: 'open', count: answered.copiedCount });
		}
		this.#announce(answered.announcement);
	};
}
