<script lang="ts">
	import { tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
	import { popoverKeyAction, targetChipText } from './commentPopover';
	import { type CommentAction, canSubmitReply, relativeTime } from './commentsPanel';
	import type { PostedComment } from './hostMessages';
	import { type PinBadge, THREAD_BADGE_COPY, THREAD_STATUS_COPY } from './pins';

	// One comment as a view, shared by the pin thread and the Comments panel. Every field is
	// comments.json data, rendered as text only. The composer state lives in App's `actions`
	// (keyed by comment id), so a composer open in the panel is open in the thread too.
	type Props = {
		comment: PostedComment;
		badge: PinBadge | undefined;
		// Epoch ms, for the relative times.
		now: number;
		action: CommentAction | undefined;
		surface: 'panel' | 'thread';
		// Panel only: the drawn frame's label, and whether the stage can jump to it.
		target: { frameLabel: string; canJump: boolean } | undefined;
		onJump?: () => void;
		onReplyOpen: () => void;
		onReplyInput: (text: string) => void;
		onReplyCancel: () => void;
		onReplySubmit: () => void;
		onToggleStatus: () => void;
	};

	let {
		comment,
		badge,
		now,
		action,
		surface,
		target,
		onJump,
		onReplyOpen,
		onReplyInput,
		onReplyCancel,
		onReplySubmit,
		onToggleStatus,
	}: Props = $props();

	// The same comment can render in the panel and the thread at once, so ids are per instance.
	const uid = $props.id();
	const errorId = `${uid}-error`;

	// Read by handlers only, so not reactive.
	let textarea: HTMLTextAreaElement | undefined;
	let replyButton: HTMLButtonElement | undefined;

	const attachTextarea: Attachment<HTMLTextAreaElement> = (element) => {
		textarea = element;
		return () => {
			textarea = undefined;
		};
	};

	const attachReplyButton: Attachment<HTMLButtonElement> = (element) => {
		replyButton = element;
		return () => {
			replyButton = undefined;
		};
	};

	const chipText = $derived(targetChipText(comment));
	const createdTime = $derived(relativeTime({ iso: comment.createdAt, now }));
	const composerOpen = $derived(action?.reply !== undefined);
	const replyPending = $derived(action?.pending?.kind === 'reply');
	const anythingPending = $derived(action?.pending !== undefined);
	const canSend = $derived(canSubmitReply(action));
	const statusLabel = $derived(comment.status === 'resolved' ? 'Reopen' : 'Resolve');
	const dimmed = $derived(surface === 'panel' && comment.status === 'resolved');

	// Focus moves only on a user action, never on mount, so the panel and the thread never fight.
	const openComposer = async (): Promise<void> => {
		onReplyOpen();
		await tick();
		textarea?.focus();
	};

	// Escape and Cancel share this path; a pending reply keeps the composer.
	const closeComposer = async (): Promise<void> => {
		if (replyPending) {
			return;
		}
		onReplyCancel();
		await tick();
		replyButton?.focus();
	};

	const handleSend = (): void => {
		if (canSend) {
			onReplySubmit();
		}
	};

	const handleStatus = (): void => {
		if (!anythingPending) {
			onToggleStatus();
		}
	};

	// One handler for the textarea and both composer buttons. Prevented keys are ignored by App's
	// window keydown and the thread's Escape handler, so the first Escape closes only the composer.
	// Enter adds from the textarea only; on a button it activates that button natively.
	const handleComposerKeydown = (event: KeyboardEvent): void => {
		const key = popoverKeyAction({
			key: event.key,
			shiftKey: event.shiftKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			isComposing: event.isComposing,
			bodyEmpty: false,
			inTextarea: event.target instanceof HTMLTextAreaElement,
		});
		if (key === 'add') {
			event.preventDefault();
			onReplySubmit();
		} else if (key === 'cancel') {
			event.preventDefault();
			void closeComposer();
		}
	};

	const handleInput = (event: Event & { currentTarget: HTMLTextAreaElement }): void => {
		onReplyInput(event.currentTarget.value);
	};

	const timeTitle = (iso: string): string => new Date(iso).toLocaleString();
</script>

<div class={['card', { dimmed }]} data-cd-comment-card>
	<div class="row">
		{#if surface === 'panel' && target !== undefined}
			{#if target.canJump}
				<button
					class="chip"
					type="button"
					title={comment.selector}
					aria-label="Show on canvas: {target.frameLabel} · {chipText}"
					data-cd-focus="jump"
					onclick={onJump}>{target.frameLabel} · {chipText}</button
				>
			{:else}
				<span class="chip" title={comment.selector}>{target.frameLabel} · {chipText}</span>
				<span class="muted">Frame not shown.</span>
			{/if}
		{:else}
			<span class="chip" title={comment.selector}>{chipText}</span>
		{/if}
	</div>
	<p class="muted">
		<span>You</span>
		{#if createdTime !== undefined}
			<time datetime={comment.createdAt} title={timeTitle(comment.createdAt)}>{createdTime}</time>
		{/if}
		<span class="status">{THREAD_STATUS_COPY[comment.status]}</span>
	</p>
	{#if badge !== undefined}
		<p class={['badge', badge]}>{THREAD_BADGE_COPY[badge]}</p>
	{/if}
	<p class="body">{comment.body}</p>
	{#if comment.replies.length > 0}
		<ol class="replies">
			{#each comment.replies as reply (reply.id)}
				{@const replyTime = relativeTime({ iso: reply.createdAt, now })}
				<li>
					<span class="muted">
						<span>{reply.author === 'agent' ? 'Agent' : 'You'}</span>
						{#if replyTime !== undefined}
							<time datetime={reply.createdAt} title={timeTitle(reply.createdAt)}>{replyTime}</time>
						{/if}
					</span>
					<p class="body">{reply.body}</p>
				</li>
			{/each}
		</ol>
	{/if}
	<!-- aria-disabled, not disabled: a disabled focused button would drop focus to the body. -->
	<div class="row">
		{#if !composerOpen}
			<button
				{@attach attachReplyButton}
				class="action"
				type="button"
				data-cd-focus="reply"
				onclick={openComposer}>Reply</button
			>
		{/if}
		<button
			class="action"
			type="button"
			aria-disabled={anythingPending}
			aria-describedby={action?.error === undefined ? undefined : errorId}
			data-cd-focus="status"
			onclick={handleStatus}>{statusLabel}</button
		>
	</div>
	{#if composerOpen}
		<!-- Not interactive itself: it only catches keys bubbling from the textarea and buttons. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="composer" onkeydown={handleComposerKeydown}>
			<textarea
				{@attach attachTextarea}
				aria-label="Reply"
				aria-describedby={action?.error === undefined ? undefined : errorId}
				data-cd-focus="reply-text"
				rows="2"
				maxlength={MAX_COMMENT_BODY_CHARS}
				readonly={replyPending}
				value={action?.reply ?? ''}
				oninput={handleInput}
			></textarea>
			<div class="row">
				<button
					class="primary"
					type="button"
					aria-disabled={!canSend}
					data-cd-focus="reply-send"
					onclick={handleSend}>Add reply</button
				>
				<button
					class="action"
					type="button"
					aria-disabled={replyPending}
					data-cd-focus="reply-cancel"
					onclick={closeComposer}>Cancel</button
				>
			</div>
		</div>
	{/if}
	{#if action?.error !== undefined}
		<p class="error" id={errorId}>{action.error}</p>
	{/if}
</div>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}
	.dimmed {
		color: var(--vscode-descriptionForeground);
	}
	.composer {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
	}
	/* A long element text ellipsizes; the selector is the title. */
	.chip {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0 0.375rem;
		font: inherit;
		font-family: var(--vscode-editor-font-family);
		text-align: start;
		color: var(--vscode-badge-foreground);
		background: var(--vscode-badge-background);
		border: 0;
	}
	button.chip {
		cursor: pointer;
	}
	.muted {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		color: var(--vscode-descriptionForeground);
	}
	p {
		margin: 0;
	}
	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.stale {
		color: var(--vscode-editorWarning-foreground);
	}
	.missing {
		color: var(--vscode-editorError-foreground);
	}
	.unchecked {
		color: var(--vscode-descriptionForeground);
	}
	.error {
		color: var(--vscode-errorForeground);
	}
	.replies {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	textarea {
		box-sizing: border-box;
		width: 100%;
		resize: vertical;
		font: inherit;
		color: var(--vscode-input-foreground);
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
	}
	button {
		font: inherit;
		padding: 0.125rem 0.5rem;
		border: 0;
	}
	.action {
		color: var(--vscode-button-secondaryForeground);
		background: var(--vscode-button-secondaryBackground);
	}
	.primary {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
	}
	button[aria-disabled='true'] {
		opacity: 0.5;
	}
	textarea:focus-visible,
	button:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
	}
</style>
