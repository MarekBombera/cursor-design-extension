<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
	import {
		blockedTargetCopy,
		canSubmit,
		type CommentDraft,
		placePopover,
		popoverKeyAction,
		targetChipText,
	} from './commentPopover';
	import type { StagePoint } from './stageGeometry';

	type Props = {
		draft: CommentDraft;
		// Viewport-local screen px of the pick point.
		anchor: StagePoint;
		viewportWidth: number;
		viewportHeight: number;
		// A live pick exists for the draft's frame; false after that frame reloaded.
		canStep: boolean;
		onAdd: (body: string) => void;
		onCancel: () => void;
		onParent: () => void;
		onChild: () => void;
	};

	let {
		draft,
		anchor,
		viewportWidth,
		viewportHeight,
		canStep,
		onAdd,
		onCancel,
		onParent,
		onChild,
	}: Props = $props();

	// The typed text lives here and survives a retarget, a host error and a frame reload: the
	// popover stays mounted while the draft exists.
	let body = $state('');
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
	const message = $derived(draft.error ?? blockedTargetCopy(draft) ?? '');
	const parentDisabled = $derived(!canStep || draft.target.isPage);

	const attachTextarea: Attachment<HTMLTextAreaElement> = (element) => {
		textarea = element;
		return () => {
			textarea = undefined;
		};
	};

	// App calls this after the pick that opened or retargeted the draft.
	export const focusBody = (): void => {
		textarea?.focus();
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

	// Neither a pointerdown nor a wheel on the popover reaches the stage's pan and zoom.
	const stopAtPopover = (event: Event): void => {
		event.stopPropagation();
	};
</script>

<div
	class="popover"
	role="dialog"
	aria-label="Add comment"
	tabindex="-1"
	data-cd-comment-popover
	bind:offsetWidth={width}
	bind:offsetHeight={height}
	style:left="{position.x}px"
	style:top="{position.y}px"
	onkeydown={handleKeydown}
	onpointerdown={stopAtPopover}
	onwheel={stopAtPopover}
>
	<div class="row">
		<span class="chip" title={chipTitle}>{chipText}</span>
		<button
			class="action"
			type="button"
			aria-label="Select parent element"
			title="Parent (↑)"
			aria-disabled={parentDisabled}
			onclick={parentDisabled ? undefined : onParent}>Parent</button
		>
		<button
			class="action"
			type="button"
			aria-label="Select child element"
			title="Child (↓)"
			aria-disabled={!canStep}
			onclick={canStep ? onChild : undefined}>Child</button
		>
	</div>
	<p class="hint">↑ parent · ↓ child</p>
	<textarea
		{@attach attachTextarea}
		bind:value={body}
		aria-label="Comment"
		rows="3"
		maxlength={MAX_COMMENT_BODY_CHARS}
	></textarea>
	<p class="message" role="status">{message}</p>
	<div class="row">
		<!-- aria-disabled, not disabled: pressing Add makes it pending, and a disabled focused
		     button would drop focus to the page body. -->
		<button
			class="primary"
			type="button"
			aria-disabled={!canSubmit(draft, body)}
			onclick={() => onAdd(body)}>Add comment</button
		>
		<button class="action" type="button" disabled={pending} onclick={onCancel}>Cancel</button>
	</div>
</div>

<style>
	.popover {
		position: absolute;
		box-sizing: border-box;
		width: 18rem;
		max-width: calc(100% - 1rem);
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
	.hint,
	.message {
		margin: 0;
		color: var(--vscode-descriptionForeground);
	}
	/* Never display: none, so the status region stays in the accessibility tree and announces an
	   error that appears later. Empty, it has no height. */
	.message {
		color: var(--vscode-errorForeground);
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
	/* aria-disabled keeps a focused Parent / Child button focusable. */
	button:disabled,
	button[aria-disabled='true'] {
		opacity: 0.5;
	}
	textarea:focus-visible,
	button:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
	}
</style>
