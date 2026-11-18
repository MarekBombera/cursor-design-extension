<script lang="ts">
	import { type Snippet, tick } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	import Composer from './Composer.svelte';
	import PinChip from './PinChip.svelte';
	import TargetRef from './TargetRef.svelte';
	import { popoverKeyAction, targetChipText } from './commentPopover';
	import { type CommentAction, canSubmitReply } from './commentActions';
	import { relativeTime } from './commentsPanel';
	import type { PostedComment } from './hostMessages';
	import { flagBadge, type PinBadge, statusBadge } from './pins';
	import Avatar from './ui/Avatar.svelte';
	import Badge from './ui/Badge.svelte';
	import Button from './ui/Button.svelte';
	import Message from './ui/Message.svelte';

	// One comment as a view, shared by the Comments panel and the pin thread. Every field is
	// comments.json data, rendered as text only. The composer state lives in App's `actions` (keyed
	// by comment id), so a composer open in the panel is open in the thread too. Without `shell` it
	// is the panel's framed article; with it, the caller places the parts (head, thread, footer):
	// the thread puts them in its Widget.
	type Props = {
		shell?: Snippet<[{ head: Snippet; thread: Snippet; footer: Snippet }]>;
		comment: PostedComment;
		// The comment's number (commentNumber), shared with its pin.
		number: number;
		badge: PinBadge | undefined;
		// Epoch ms, for the relative times.
		now: number;
		action: CommentAction | undefined;
		// The frame's display name (frameLabel).
		frameLabel: string;
		// The frame is drawn (a live iframe); false says "Frame not shown" in the status badge's place.
		frameShown: boolean;
		// Show the target on the canvas: the panel's card for a shown frame only; never the thread.
		onJump?: () => void;
		onReplyOpen: () => void;
		onReplyInput: (text: string) => void;
		onReplyCancel: () => void;
		onReplySubmit: () => void;
		onToggleStatus: () => void;
		// Another copy is in flight somewhere in the chrome (copyPending); one copy at a time.
		copyBlocked: boolean;
		// This card's own copy just succeeded (copyFeedback is live).
		copied: boolean;
		onCopy: () => void;
	};

	let {
		shell,
		comment,
		number,
		badge,
		now,
		action,
		frameLabel,
		frameShown,
		onJump,
		onReplyOpen,
		onReplyInput,
		onReplyCancel,
		onReplySubmit,
		onToggleStatus,
		copyBlocked,
		copied,
		onCopy,
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
	const composerOpen = $derived(action?.reply !== undefined);
	const replyPending = $derived(action?.pending?.kind === 'reply');
	const anythingPending = $derived(action?.pending !== undefined);
	const canSend = $derived(canSubmitReply(action));
	const copyDisabled = $derived(copyBlocked || anythingPending);
	const resolved = $derived(comment.status === 'resolved');
	const describedBy = $derived(action?.error === undefined ? undefined : errorId);

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

	const handleCopy = (): void => {
		if (!copyDisabled) {
			onCopy();
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

	const timeTitle = (iso: string): string => new Date(iso).toLocaleString();
</script>

{#snippet head()}
	<div class="head">
		<PinChip {number} status={comment.status} />
		<!-- No element icon: the pin number already identifies the target, so the text keeps room. -->
		<TargetRef
			frame={frameLabel}
			element={chipText}
			title={comment.selector}
			jumpLabel="Show on canvas: {frameLabel} · {chipText}"
			data-cd-focus={onJump === undefined ? undefined : 'jump'}
			onjump={onJump}
		/>
		{#if frameShown}
			<Badge {...statusBadge(comment.status)} />
		{:else}
			<!-- In the status badge's place: the absent frame is what this card needs to say. -->
			<span class="note">Frame not shown.</span>
		{/if}
	</div>
{/snippet}

{#snippet entryMeta(author: 'you' | 'agent', iso: string)}
	{@const time = relativeTime({ iso, now })}
	<span class="meta">
		<span class="author">{author === 'agent' ? 'Agent' : 'You'}</span>
		{#if time !== undefined}
			<time datetime={iso} title={timeTitle(iso)}>{time}</time>
		{/if}
	</span>
{/snippet}

<!-- The last failed request's host copy: under the reply box while the composer is open, else
     after the thread. -->
{#snippet error()}
	{#if action?.error !== undefined}
		<Message tone="error" id={errorId}>{action.error}</Message>
	{/if}
{/snippet}

<!-- The comment, then its replies: each entry but the last draws the line to the next avatar. -->
{#snippet thread()}
	<div class="thread">
		<div class={['entry', { joined: comment.replies.length > 0 }]}>
			<Avatar author="you" /><div class="content">
				{@render entryMeta('you', comment.createdAt)}
				<p class={['body', { resolved }]}>{comment.body}</p>
				{#if badge !== undefined}
					<div class="flags"><Badge {...flagBadge(badge)} /></div>
				{/if}
			</div>
		</div>
		{#if comment.replies.length > 0}
			<ol class="replies">
				{#each comment.replies as reply, index (reply.id)}
					{@const author = reply.author === 'agent' ? 'agent' : 'you'}
					<li
						class={[
							'entry',
							{ agent: author === 'agent', joined: index < comment.replies.length - 1 },
						]}
					>
						<!-- Touching, so the entry's text starts with its author. -->
						<Avatar {author} /><div class="content">
							{@render entryMeta(author, reply.createdAt)}
							<p class={['body', { resolved }]}>{reply.body}</p>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
	{#if !composerOpen}
		{@render error()}
	{/if}
{/snippet}

<!-- aria-disabled, not disabled: a disabled focused button would drop focus to the body. -->
{#snippet footer()}
	{#if composerOpen}
		<!-- Its root catches the keys bubbling from the textarea and both buttons. -->
		<Composer
			value={action?.reply ?? ''}
			label="Reply"
			placeholder="Reply to the Agent…"
			rows={4}
			primaryLabel="Add reply"
			pending={replyPending}
			canSubmit={canSend}
			focusKey="reply"
			{describedBy}
			textareaAttachment={attachTextarea}
			message={error}
			oninput={onReplyInput}
			onsubmit={onReplySubmit}
			oncancel={closeComposer}
			onkeydown={handleComposerKeydown}
		/>
	{/if}
	<div class="actions">
		{#if !composerOpen}
			<Button
				variant="ghost"
				size="sm"
				icon="reply"
				{@attach attachReplyButton}
				data-cd-focus="reply"
				onclick={openComposer}>Reply</Button
			>
		{/if}
		<Button
			variant="ghost"
			size="sm"
			icon={resolved ? 'reopen' : 'check'}
			aria-disabled={anythingPending}
			aria-describedby={describedBy}
			data-cd-focus="status"
			onclick={handleStatus}>{resolved ? 'Reopen' : 'Resolve'}</Button
		>
		<!-- One element in both states, so focus stays on it when it reads "Copied". -->
		<span class="end">
			<Button
				variant="ghost"
				tone={copied ? undefined : 'agent'}
				size="sm"
				icon={copied ? 'check' : 'sparkle'}
				aria-disabled={copyDisabled}
				aria-describedby={describedBy}
				data-cd-focus="copy"
				onclick={handleCopy}>{copied ? 'Copied' : 'Copy for Agent'}</Button
			>
		</span>
	</div>
{/snippet}

{#if shell === undefined}
	<article class={['card', { resolved }]} data-cd-comment-card>
		{@render head()}
		{@render thread()}
		{@render footer()}
	</article>
{:else}
	{@render shell({ head, thread, footer })}
{/if}

<style>
	/* In the panel the card draws its own edge; in the thread the Widget does. */
	.card {
		display: grid;
		gap: var(--cd-space-10);
		min-width: 0;
		padding: var(--cd-space-10) var(--cd-space-12) var(--cd-space-8);
		border: 1px solid var(--cd-edge);
		border-radius: var(--cd-radius-md);
		background: var(--cd-bg-card);
	}
	.card.resolved {
		background: transparent;
	}
	/* Fills the Widget's header row in the thread. */
	.head {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--cd-space-8);
		min-width: 0;
	}
	.note {
		flex: none;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-xs);
		white-space: nowrap;
	}
	.thread,
	.replies {
		display: grid;
		gap: var(--cd-space-12);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/* The avatar, then author and time with the body (and any flags) under them. */
	.entry {
		position: relative;
		display: grid;
		grid-template-columns: var(--cd-avatar) minmax(0, 1fr);
		column-gap: var(--cd-space-8);
	}
	.content {
		display: grid;
		row-gap: var(--cd-space-2);
		min-width: 0;
	}
	/* The line from below this entry's avatar to the next one. */
	.joined::before {
		content: '';
		position: absolute;
		top: calc(var(--cd-avatar) + var(--cd-space-2));
		bottom: calc(-1 * var(--cd-space-10));
		left: calc(var(--cd-avatar) / 2 - 0.5px);
		width: 1px;
		background: var(--cd-edge);
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: var(--cd-space-6);
		min-width: 0;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		line-height: var(--cd-lh-sm);
	}
	.author {
		color: var(--cd-fg);
		font-weight: var(--cd-weight-strong);
	}
	.body {
		margin: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.agent .body {
		margin-top: var(--cd-space-2);
		padding: var(--cd-space-6) var(--cd-space-8);
		border-radius: var(--cd-radius-sm);
		background: var(--cd-agent-bg);
	}
	.body.resolved {
		color: var(--cd-fg-2);
	}
	.flags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--cd-space-6);
		margin-top: var(--cd-space-4);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--cd-space-2);
		margin: 0 calc(-1 * var(--cd-space-6)) calc(-1 * var(--cd-space-4));
	}
	.end {
		margin-left: auto;
	}
</style>
