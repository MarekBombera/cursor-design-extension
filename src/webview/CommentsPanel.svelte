<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import CommentCard from './CommentCard.svelte';
	import { type CommentActions, type CopiedButton, type CopyOpenState } from './commentActions';
	import { handoffCopy, type PanelItem, type PanelSummary, summaryParts } from './commentsPanel';
	import Button from './ui/Button.svelte';
	import EmptyState from './ui/EmptyState.svelte';
	import Icon from './ui/Icon.svelte';
	import Message from './ui/Message.svelte';

	// Every comment in comments.json, unresolved first. Always mounted (the toolbar toggle's
	// aria-controls must resolve); its content renders only while open, so a closed panel costs
	// nothing on each cd:anchor-rects. First in the DOM so Tab reaches it before the stage; CSS
	// `order` draws it on the right.
	type Props = {
		open: boolean;
		items: { unresolved: PanelItem[]; resolved: PanelItem[] };
		// comments:updated's error; the banner carries the detail.
		error: string | undefined;
		now: number;
		actions: CommentActions;
		onJump: (id: string) => void;
		onReplyOpen: (id: string) => void;
		onReplyInput: (id: string, text: string) => void;
		onReplyCancel: (id: string) => void;
		onReplySubmit: (id: string) => void;
		onToggleStatus: (id: string) => void;
		// copyPending: a copy is in flight, so every Copy button waits (one copy at a time).
		copyBlocked: boolean;
		// The button whose copy just succeeded, while its "Copied" shows.
		copied: CopiedButton | undefined;
		copyOpen: CopyOpenState;
		// Open / sent / resolved counts: the summary line and the handoff button.
		summary: PanelSummary;
		onCopy: (id: string) => void;
		onCopyOpen: () => void;
	};

	let {
		open,
		items,
		error,
		now,
		actions,
		onJump,
		onReplyOpen,
		onReplyInput,
		onReplyCancel,
		onReplySubmit,
		onToggleStatus,
		copyBlocked,
		copied,
		copyOpen,
		summary,
		onCopy,
		onCopyOpen,
	}: Props = $props();

	const copyOpenErrorId = $props.id();
	const handoff = $derived(
		handoffCopy({
			open: summary.open,
			sent: summary.sent,
			copied: copied?.kind === 'open' ? copied.count : undefined,
		}),
	);
	const copyOpenDisabled = $derived(handoff.disabled || copyBlocked);
	const parts = $derived(summaryParts(summary));
	const empty = $derived(items.unresolved.length === 0 && items.resolved.length === 0);

	const handleCopyOpen = (): void => {
		if (!copyOpenDisabled) {
			onCopyOpen();
		}
	};

	// Read by the focus effects only, so not reactive.
	let aside: HTMLElement | undefined;
	type KeptFocus = { id: string; key: string | undefined };
	// The focused item and control before a list update; set by the pre-pass, cleared after.
	let kept: KeptFocus | undefined;

	const attachAside: Attachment<HTMLElement> = (element) => {
		aside = element;
		return () => {
			aside = undefined;
		};
	};

	// An unfocused webview keeps a stale activeElement (the user is typing in Agent chat), so it
	// records nothing: restoring that would pull focus out of the chat.
	const focusedItem = (): KeptFocus | undefined => {
		if (!document.hasFocus()) {
			return undefined;
		}
		const active = document.activeElement;
		const id = active?.closest('[data-cd-comment-item]')?.getAttribute('data-cd-comment-item');
		if (active === null || id === null || id === undefined) {
			return undefined;
		}
		return { id, key: active.getAttribute('data-cd-focus') ?? undefined };
	};

	const restoreFocus = ({ id, key }: KeptFocus): void => {
		const item = aside?.querySelector(`[data-cd-comment-item="${CSS.escape(id)}"]`);
		if (item === null || item === undefined) {
			aside?.focus({ preventScroll: true });
			return;
		}
		const target =
			(key === undefined
				? null
				: item.querySelector<HTMLElement>(`[data-cd-focus="${CSS.escape(key)}"]`)) ??
			item.querySelector<HTMLElement>('[data-cd-focus="status"]');
		target?.focus({ preventScroll: true });
		if (target instanceof HTMLTextAreaElement) {
			target.setSelectionRange(target.value.length, target.value.length);
		}
	};

	// Focus kept across list updates (Resolve moves an item between the groups; the Agent resolves
	// a comment you are replying to): the pre-pass records where focus is before the DOM changes,
	// overwriting any earlier record.
	$effect.pre(() => {
		if (!open) {
			kept = undefined;
			return;
		}
		// Tracked only while open: every list update re-runs this pass.
		void items;
		kept = focusedItem();
	});

	// After the DOM changed: only a focus the update dropped to body moves, never one elsewhere.
	$effect(() => {
		if (open) {
			void items;
		}
		const record = kept;
		kept = undefined;
		const active = document.activeElement;
		if (record === undefined || (active !== null && active !== document.body)) {
			return;
		}
		restoreFocus(record);
	});
</script>

{#snippet group(title: string, list: PanelItem[])}
	{#if list.length > 0}
		<!-- The dot is decoration, so the heading's name reads "Unresolved 3". -->
		<h2 class="section-title">{title} <span aria-hidden="true">·</span> {list.length}</h2>
		<ol>
			{#each list as item (item.comment.id)}
				{@const id = item.comment.id}
				<li data-cd-comment-item={id} data-cd-status={item.comment.status}>
					<CommentCard
						comment={item.comment}
						number={item.number}
						badge={item.badge}
						{now}
						action={actions.get(id)}
						frameLabel={item.frameLabel}
						frameShown={item.canJump}
						onJump={item.canJump ? () => onJump(id) : undefined}
						onReplyOpen={() => onReplyOpen(id)}
						onReplyInput={(text) => onReplyInput(id, text)}
						onReplyCancel={() => onReplyCancel(id)}
						onReplySubmit={() => onReplySubmit(id)}
						onToggleStatus={() => onToggleStatus(id)}
						{copyBlocked}
						copied={copied?.kind === 'comment' && copied.id === id}
						onCopy={() => onCopy(id)}
					/>
				</li>
			{/each}
		</ol>
	{/if}
{/snippet}

<aside
	id="cd-comments-panel"
	aria-label="Comments"
	tabindex="-1"
	data-cd-comments-panel
	hidden={!open}
	{@attach attachAside}
>
	{#if open}
		<!-- Outside the scrolling list, so a focused card control is never under it. -->
		<div class="head">
			<p class="title">Comments</p>
			{#if error === undefined && !empty}
				{#if parts.length > 0}
					<p class="summary">
						{#each parts as part, index (part.text)}
							<!-- Hidden commas, so the line reads as a list, not one run of words. -->
							{#if index > 0}<span class="visually-hidden">,&nbsp;</span>{/if}<span class="part"
								><span class={['summary-icon', `tone-${part.tone}`]}
									><Icon name={part.icon} size={12} /></span
								>{part.text}</span
							>
						{/each}
					</p>
				{/if}
				<!-- aria-disabled, not disabled: a disabled focused button would drop focus to the body. -->
				<div class="handoff">
					<Button
						variant={handoff.copied ? 'secondary' : 'primary'}
						icon={handoff.copied ? 'check' : 'sparkle'}
						block
						aria-disabled={copyOpenDisabled}
						aria-describedby={copyOpen.error === undefined ? undefined : copyOpenErrorId}
						data-cd-copy-open
						onclick={handleCopyOpen}>{handoff.label}</Button
					>
					{#if copyOpen.error !== undefined}
						<Message tone="error" id={copyOpenErrorId}>{copyOpen.error}</Message>
					{:else if handoff.hint !== undefined}
						<p class="hint">{handoff.hint}</p>
					{/if}
				</div>
			{/if}
		</div>
		{#if error !== undefined}
			<EmptyState icon="warning" title="Comments are unavailable"
				>The notice above the canvas says why.</EmptyState
			>
		{:else if empty}
			<EmptyState icon="comment" title="No comments yet"
				>Press <kbd>C</kbd>, then click an element to add one.</EmptyState
			>
		{:else}
			<div class="list">
				{@render group('Unresolved', items.unresolved)}
				{@render group('Resolved', items.resolved)}
			</div>
		{/if}
	{/if}
</aside>

<style>
	/* A column: the header, then the list, which is the scroller. No display rule fights [hidden]:
	   the global rule wins. */
	aside {
		order: 1;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--cd-panel-w);
		max-width: 50%;
		margin-left: auto;
		box-sizing: border-box;
		overflow: hidden;
		overscroll-behavior: contain;
		border-left: 1px solid var(--cd-divider);
		background: var(--cd-bg-chrome);
	}
	/* Focused by script only, as a fallback when focus would drop to body; it is not a control. */
	aside:focus {
		outline: none;
	}
	p {
		margin: 0;
	}
	.head {
		display: grid;
		flex: none;
		gap: var(--cd-space-8);
		padding: var(--cd-space-8) var(--cd-space-12) var(--cd-space-10);
		border-bottom: 1px solid var(--cd-divider);
	}
	.title,
	.section-title {
		margin: 0;
		font: var(--cd-weight-strong) var(--cd-fs-xs) / var(--cd-lh-sm) var(--cd-font);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.title {
		display: flex;
		align-items: center;
		height: 24px;
	}
	.section-title {
		margin-top: var(--cd-space-6);
		color: var(--cd-fg-2);
	}
	.section-title:first-child {
		margin-top: 0;
	}
	.summary {
		display: flex;
		flex-wrap: wrap;
		gap: var(--cd-space-4) var(--cd-space-10);
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
	}
	.part {
		display: inline-flex;
		align-items: center;
		gap: var(--cd-space-4);
	}
	/* Each count's status icon in its meaning colour; the text stays --cd-fg-2. */
	.summary-icon {
		display: inline-flex;
	}
	.summary-icon.tone-accent {
		color: var(--cd-open);
	}
	.summary-icon.tone-agent {
		color: var(--cd-agent);
	}
	.summary-icon.tone-success {
		color: var(--cd-resolved);
	}
	.handoff {
		display: grid;
		gap: var(--cd-space-4);
	}
	.hint {
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-xs);
		line-height: var(--cd-lh-sm);
		text-align: center;
	}
	.list {
		display: grid;
		flex: 1 1 auto;
		align-content: start;
		gap: var(--cd-space-8);
		min-height: 0;
		padding: var(--cd-space-10) var(--cd-space-12) var(--cd-space-16);
		overflow: auto;
		overscroll-behavior: contain;
	}
	ol {
		display: grid;
		gap: var(--cd-space-8);
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
