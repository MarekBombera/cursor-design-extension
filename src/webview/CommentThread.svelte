<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	import CommentCard from './CommentCard.svelte';
	import { placePopover } from './commentPopover';
	import type { StagePoint } from './stageGeometry';
	import IconButton from './ui/IconButton.svelte';
	import Widget from './ui/Widget.svelte';

	// The thread of one comment, opened from its pin: a Widget holding the comment card's parts (its
	// head, then Close; the thread in the body; Reply, Resolve / Reopen, Copy for Agent in the
	// footer). This owns placement, Escape and the focus on open; the card's props pass through.
	type Props = Omit<ComponentProps<typeof CommentCard>, 'shell' | 'frameShown' | 'onJump'> & {
		// Viewport-local screen px of the pin.
		anchor: StagePoint;
		viewportWidth: number;
		viewportHeight: number;
		onClose: () => void;
	};

	let { anchor, viewportWidth, viewportHeight, onClose, ...cardProps }: Props = $props();

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
</script>

<!-- A pin is placed only on a drawn frame, so the thread's frame is always shown. -->
<CommentCard {...cardProps} frameShown>
	{#snippet shell({ head, thread, footer })}
		<Widget
			bind:width
			bind:height
			left={position.x}
			top={position.y}
			role="dialog"
			aria-label="Comment"
			tabindex={-1}
			data-cd-comment-thread
			onkeydown={handleKeydown}
			{footer}
		>
			{#snippet header()}
				{@render head()}
				<IconButton icon="close" label="Close" {@attach focusOnOpen} onclick={onClose} />
			{/snippet}
			{@render thread()}
		</Widget>
	{/snippet}
</CommentCard>
