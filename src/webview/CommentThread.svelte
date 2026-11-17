<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import CommentCard from './CommentCard.svelte';
	import { placePopover } from './commentPopover';
	import type { CommentAction } from './commentsPanel';
	import type { PostedComment } from './hostMessages';
	import type { PinBadge } from './pins';
	import type { StagePoint } from './stageGeometry';

	// The thread of one comment, opened from its pin: the comment card (Reply, Resolve / Reopen,
	// Copy prompt), then Close.
	type Props = {
		comment: PostedComment;
		badge: PinBadge | undefined;
		// Viewport-local screen px of the pin.
		anchor: StagePoint;
		viewportWidth: number;
		viewportHeight: number;
		now: number;
		action: CommentAction | undefined;
		onClose: () => void;
		onReplyOpen: () => void;
		onReplyInput: (text: string) => void;
		onReplyCancel: () => void;
		onReplySubmit: () => void;
		onToggleStatus: () => void;
		copyBlocked: boolean;
		copied: boolean;
		onCopy: () => void;
	};

	let {
		comment,
		badge,
		anchor,
		viewportWidth,
		viewportHeight,
		now,
		action,
		onClose,
		onReplyOpen,
		onReplyInput,
		onReplyCancel,
		onReplySubmit,
		onToggleStatus,
		copyBlocked,
		copied,
		onCopy,
	}: Props = $props();

	let width = $state(0);
	let height = $state(0);

	const position = $derived(
		placePopover({ anchor, width, height, viewportWidth, viewportHeight }),
	);

	// App keys this component by the open thread, so each open lands focus on Close.
	const focusOnOpen: Attachment<HTMLButtonElement> = (element) => {
		element.focus({ preventScroll: true });
	};

	// Prevented, so App's window keydown (the mode-key rule) ignores this Escape. An Escape the
	// card's composer already handled (prevented) closes only the composer.
	const handleKeydown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) {
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
	<CommentCard
		{comment}
		{badge}
		{now}
		{action}
		surface="thread"
		target={undefined}
		{onReplyOpen}
		{onReplyInput}
		{onReplyCancel}
		{onReplySubmit}
		{onToggleStatus}
		{copyBlocked}
		{copied}
		{onCopy}
	/>
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
