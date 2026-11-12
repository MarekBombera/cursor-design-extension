<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { placePopover, targetChipText } from './commentPopover';
	import type { PostedComment } from './hostMessages';
	import { type PinBadge, THREAD_BADGE_COPY, THREAD_STATUS_COPY } from './pins';
	import type { StagePoint } from './stageGeometry';

	// Read-only thread of one comment, opened from its pin. 8g adds Reply and Resolve / Reopen,
	// 8h adds Copy. Every field is comments.json data, rendered as text only.
	type Props = {
		comment: PostedComment;
		badge: PinBadge | undefined;
		// Viewport-local screen px of the pin.
		anchor: StagePoint;
		viewportWidth: number;
		viewportHeight: number;
		onClose: () => void;
	};

	let { comment, badge, anchor, viewportWidth, viewportHeight, onClose }: Props = $props();

	let width = $state(0);
	let height = $state(0);

	const position = $derived(
		placePopover({ anchor, width, height, viewportWidth, viewportHeight }),
	);
	const chipText = $derived(targetChipText(comment));

	// App keys this component by the open thread, so each open lands focus on Close.
	const focusOnOpen: Attachment<HTMLButtonElement> = (element) => {
		element.focus({ preventScroll: true });
	};

	// Prevented, so App's window keydown (the mode-key rule) ignores this Escape.
	const handleKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && !event.isComposing) {
			event.preventDefault();
			onClose();
		}
	};

	// Neither a pointerdown nor a wheel on the thread reaches the stage's pan and zoom.
	const stopAtThread = (event: Event): void => {
		event.stopPropagation();
	};
</script>

<div
	class="thread"
	role="dialog"
	aria-label="Comment"
	tabindex="-1"
	data-cd-comment-thread
	bind:offsetWidth={width}
	bind:offsetHeight={height}
	style:left="{position.x}px"
	style:top="{position.y}px"
	onkeydown={handleKeydown}
	onpointerdown={stopAtThread}
	onwheel={stopAtThread}
>
	<div class="row">
		<span class="chip" title={comment.selector}>{chipText}</span>
		<span class="status">{THREAD_STATUS_COPY[comment.status]}</span>
	</div>
	{#if badge !== undefined}
		<p class={['badge', badge]}>{THREAD_BADGE_COPY[badge]}</p>
	{/if}
	<p class="body">{comment.body}</p>
	{#if comment.replies.length > 0}
		<ol class="replies">
			{#each comment.replies as reply (reply.id)}
				<li>
					<span class="author">{reply.author === 'agent' ? 'Agent' : 'You'}</span>
					<p class="body">{reply.body}</p>
				</li>
			{/each}
		</ol>
	{/if}
	<div class="row end">
		<button class="action" type="button" {@attach focusOnOpen} onclick={onClose}>Close</button>
	</div>
</div>

<style>
	.thread {
		position: absolute;
		box-sizing: border-box;
		width: 18rem;
		max-width: calc(100% - 1rem);
		max-height: calc(100% - 1rem);
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.5rem;
		color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
		background: var(--vscode-editorWidget-background);
		border: 1px solid var(--vscode-editorWidget-border, var(--vscode-focusBorder));
		cursor: auto;
	}
	.row {
		display: flex;
		gap: 0.375rem;
		align-items: center;
	}
	.end {
		justify-content: flex-end;
	}
	/* A long element text ellipsizes; the selector is the title. */
	.chip {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0 0.375rem;
		font-family: var(--vscode-editor-font-family);
		color: var(--vscode-badge-foreground);
		background: var(--vscode-badge-background);
	}
	.status,
	.author {
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
	.replies {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
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
	button:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
	}
</style>
