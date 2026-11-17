<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import CommentCard from './CommentCard.svelte';
	import type { CommentActions, CopyOpenState, PanelItem } from './commentsPanel';

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
		// The comment id whose copy just succeeded, or '*open' for Copy all open.
		copiedKey: string | undefined;
		copyOpen: CopyOpenState;
		// Comments with status `open`: the N in Copy all open (N).
		openCount: number;
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
		copiedKey,
		copyOpen,
		openCount,
		onCopy,
		onCopyOpen,
	}: Props = $props();

	const copyOpenErrorId = $props.id();
	const copyOpenDisabled = $derived(openCount === 0 || copyBlocked);

	const handleCopyOpen = (): void => {
		if (!copyOpenDisabled) {
			onCopyOpen();
		}
	};

	// Read by the focus effects only, so not reactive.
	let aside: HTMLElement | undefined;
	// The focused item and control before a list update; set by the pre-pass, cleared after.
	let kept: { id: string; key: string | undefined } | undefined;

	const attachAside: Attachment<HTMLElement> = (element) => {
		aside = element;
		return () => {
			aside = undefined;
		};
	};

	// An unfocused webview keeps a stale activeElement (the user is typing in Agent chat), so it
	// records nothing: restoring that would pull focus out of the chat.
	const focusedItem = (): { id: string; key: string | undefined } | undefined => {
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

	const restoreFocus = ({ id, key }: { id: string; key: string | undefined }): void => {
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
		<h2>{title} ({list.length})</h2>
		<ol>
			{#each list as item (item.comment.id)}
				{@const id = item.comment.id}
				<li data-cd-comment-item={id} data-cd-status={item.comment.status}>
					<CommentCard
						comment={item.comment}
						badge={item.badge}
						{now}
						action={actions.get(id)}
						surface="panel"
						target={{ frameLabel: item.frameLabel, canJump: item.canJump }}
						onJump={() => onJump(id)}
						onReplyOpen={() => onReplyOpen(id)}
						onReplyInput={(text) => onReplyInput(id, text)}
						onReplyCancel={() => onReplyCancel(id)}
						onReplySubmit={() => onReplySubmit(id)}
						onToggleStatus={() => onToggleStatus(id)}
						{copyBlocked}
						copied={copiedKey === id}
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
		{#if error !== undefined}
			<p class="state">Comments are unavailable.</p>
		{:else if items.unresolved.length === 0 && items.resolved.length === 0}
			<p class="state">No comments yet. Press C, then click an element to add one.</p>
		{:else}
			<!-- aria-disabled, not disabled: a disabled focused button would drop focus to the body. -->
			<div class="copy-open">
				<button
					class="action"
					type="button"
					aria-disabled={copyOpenDisabled}
					aria-describedby={copyOpen.error === undefined ? undefined : copyOpenErrorId}
					data-cd-copy-open
					onclick={handleCopyOpen}
					>{copiedKey === '*open' ? 'Copied' : `Copy all open (${String(openCount)})`}</button
				>
				{#if copyOpen.error !== undefined}
					<p class="error" id={copyOpenErrorId}>{copyOpen.error}</p>
				{/if}
			</div>
			{@render group('Unresolved', items.unresolved)}
			{@render group('Resolved', items.resolved)}
		{/if}
	{/if}
</aside>

<style>
	/* No display declaration, so [hidden] hides it. */
	aside {
		order: 1;
		flex: none;
		width: 20rem;
		max-width: 50%;
		margin-left: auto;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		overflow: auto;
		overscroll-behavior: contain;
		border-left: 1px solid var(--vscode-panel-border);
		background: var(--vscode-sideBar-background);
	}
	aside:focus {
		outline: none;
	}
	h2 {
		margin: 0.5rem 0;
		font-size: inherit;
		font-weight: 600;
	}
	ol {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0 0 0.75rem;
		padding: 0;
		list-style: none;
	}
	.copy-open {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
		margin: 0.5rem 0;
	}
	.copy-open p {
		margin: 0;
	}
	.error {
		color: var(--vscode-errorForeground);
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
	button[aria-disabled='true'] {
		opacity: 0.5;
	}
	button:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
	}
	.state {
		margin: 0.5rem 0;
		color: var(--vscode-descriptionForeground);
	}
</style>
