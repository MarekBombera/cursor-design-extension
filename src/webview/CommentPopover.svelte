<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import {
		blockedTargetCopy,
		canSubmit,
		type CommentDraft,
		placePopover,
		popoverKeyAction,
		targetChipText,
	} from './commentPopover';
	import Composer from './Composer.svelte';
	import type { StagePoint } from './stageGeometry';
	import TargetRef from './TargetRef.svelte';
	import IconButton from './ui/IconButton.svelte';
	import Message from './ui/Message.svelte';
	import Widget from './ui/Widget.svelte';

	type Props = {
		draft: CommentDraft;
		// The draft's typed text; App owns it, so it lives and dies with the draft.
		body: string;
		// The draft frame's display name (frameLabel).
		frameLabel: string;
		// Viewport-local screen px of the pick point.
		anchor: StagePoint;
		viewportWidth: number;
		viewportHeight: number;
		// A live pick exists for the draft's frame; false after that frame reloaded.
		canStep: boolean;
		oninput: (body: string) => void;
		onAdd: (body: string) => void;
		onCancel: () => void;
		onParent: () => void;
		onChild: () => void;
	};

	let {
		draft,
		body,
		frameLabel,
		anchor,
		viewportWidth,
		viewportHeight,
		canStep,
		oninput,
		onAdd,
		onCancel,
		onParent,
		onChild,
	}: Props = $props();

	let width = $state(0);
	let height = $state(0);
	// Read by handlers only, so not reactive.
	let textarea: HTMLTextAreaElement | undefined;

	const position = $derived(
		placePopover({ anchor, width, height, viewportWidth, viewportHeight }),
	);
	const pending = $derived(draft.pendingRequestId !== undefined);
	// Frame data and host copy, rendered as text only.
	const chipText = $derived(targetChipText(draft.target));
	const chipTitle = $derived(draft.target.selector ?? draft.target.tagName);
	const blocked = $derived(blockedTargetCopy(draft));
	const parentDisabled = $derived(!canStep || draft.target.isPage);

	const attachTextarea: Attachment<HTMLTextAreaElement> = (element) => {
		textarea = element;
		return () => {
			textarea = undefined;
		};
	};

	// App calls this after the pick that opened or retargeted the draft, and after a restore (the
	// caret then goes to the end of the restored text).
	export const focusBody = (caretAtEnd = false): void => {
		textarea?.focus();
		if (caretAtEnd) {
			textarea?.setSelectionRange(body.length, body.length);
		}
	};

	const handleKeydown = (event: KeyboardEvent): void => {
		const action = popoverKeyAction({
			key: event.key,
			shiftKey: event.shiftKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			isComposing: event.isComposing,
			bodyEmpty: body === '',
			inTextarea: event.target === textarea,
		});
		if (action === undefined) {
			return;
		}
		// Prevented keys are ignored by App's window keydown, so this Escape never also leaves
		// Comment mode.
		event.preventDefault();
		if (action === 'add') {
			onAdd(body);
		} else if (action === 'cancel') {
			onCancel();
		} else if (action === 'parent') {
			onParent();
		} else {
			onChild();
		}
	};
</script>

<Widget
	bind:width
	bind:height
	left={position.x}
	top={position.y}
	role="dialog"
	aria-label="Add comment"
	tabindex={-1}
	data-cd-comment-popover
	onkeydown={handleKeydown}
>
	{#snippet header()}
		<TargetRef
			frame={frameLabel}
			element={chipText}
			icon={draft.target.isPage ? 'page' : 'element'}
			title={chipTitle}
			data-cd-comment-target
		/>
		<IconButton
			icon="arrow-up"
			label="Select parent element"
			title="Parent (↑)"
			aria-disabled={parentDisabled}
			onclick={parentDisabled ? undefined : onParent}
		/>
		<IconButton
			icon="arrow-down"
			label="Select child element"
			title="Child (↓)"
			aria-disabled={!canStep}
			onclick={canStep ? onChild : undefined}
		/>
	{/snippet}
	<!-- Cancel, then Add: Tab from the box reaches Cancel first. -->
	<Composer
		value={body}
		label="Comment"
		placeholder="Comment for the Agent…"
		rows={4}
		primaryLabel="Add comment"
		{pending}
		canSubmit={canSubmit(draft, body)}
		stepHint
		textareaAttachment={attachTextarea}
		{oninput}
		onsubmit={() => onAdd(body)}
		oncancel={onCancel}
	>
		{#snippet message()}
			<!-- Always rendered, so the status region stays in the accessibility tree and announces a
			     message that appears later. Empty, it has no height. -->
			<div class="status" role="status">
				{#if draft.error !== undefined}
					<Message tone="error">{draft.error}</Message>
				{:else if blocked !== undefined}
					<Message tone="info">{blocked}</Message>
				{/if}
			</div>
		{/snippet}
	</Composer>
</Widget>

<style>
	.status {
		display: grid;
	}
	/* Empty, it would still take a grid gap in the composer. */
	.status:empty {
		margin-top: calc(-1 * var(--cd-space-6));
	}
</style>
