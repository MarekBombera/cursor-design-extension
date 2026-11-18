<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { HTMLAttributes } from 'svelte/elements';

	import { MAX_COMMENT_BODY_CHARS } from '../disk/layout';
	import Button from './ui/Button.svelte';

	// The comment composer, shared by the add popover and the reply in a card or thread: the text
	// box, any message (error or notice) between it and the actions, then a key hint, Cancel and the
	// primary action last. Keys stay with the caller (rest carries onkeydown onto the root), and so
	// does the text: `value` in, `oninput` out. Cancel and the primary are aria-disabled, never
	// disabled: a disabled focused button would drop focus to the body.
	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children' | 'oninput'> & {
		value: string;
		// The text box's accessible name.
		label: string;
		placeholder: string;
		rows: number;
		// The primary action's words; pending reads "Adding…".
		primaryLabel: string;
		pending: boolean;
		canSubmit: boolean;
		// The popover's hint: ↑ ↓ step the target while the box is empty.
		stepHint?: boolean;
		// Prefix of the data-cd-focus keys (`<key>-text`, `-cancel`, `-send`) the panel restores.
		focusKey?: string;
		describedBy?: string;
		textareaAttachment?: Attachment<HTMLTextAreaElement>;
		message?: Snippet;
		oninput: (text: string) => void;
		onsubmit: () => void;
		oncancel: () => void;
	};

	let {
		value,
		label,
		placeholder,
		rows,
		primaryLabel,
		pending,
		canSubmit,
		stepHint = false,
		focusKey,
		describedBy,
		textareaAttachment,
		message,
		oninput,
		onsubmit,
		oncancel,
		...rest
	}: Props = $props();

	const focus = (part: string): string | undefined =>
		focusKey === undefined ? undefined : `${focusKey}-${part}`;

	const handleInput = (event: Event & { currentTarget: HTMLTextAreaElement }): void => {
		oninput(event.currentTarget.value);
	};

	const handleCancel = (): void => {
		if (!pending) {
			oncancel();
		}
	};

	const handleSubmit = (): void => {
		if (canSubmit) {
			onsubmit();
		}
	};
</script>

<div class="composer" {...rest}>
	<textarea
		{@attach textareaAttachment}
		aria-label={label}
		aria-describedby={describedBy}
		data-cd-focus={focus('text')}
		{rows}
		{placeholder}
		maxlength={MAX_COMMENT_BODY_CHARS}
		readonly={pending}
		{value}
		oninput={handleInput}
	></textarea>
	{@render message?.()}
	<div class="row">
		<!-- The keys are spoken by their buttons' names; the hint is for sighted users only. -->
		<span class="hint" aria-hidden="true">
			{#if stepHint && value === ''}
				<kbd>↑</kbd> <kbd>↓</kbd> parent / child
			{:else}
				<kbd>⏎</kbd> add · <kbd>⇧⏎</kbd> new line
			{/if}
		</span>
		<Button size="sm" aria-disabled={pending} data-cd-focus={focus('cancel')} onclick={handleCancel}
			>Cancel</Button
		>
		<Button
			variant="primary"
			size="sm"
			{pending}
			aria-disabled={!canSubmit}
			data-cd-focus={focus('send')}
			onclick={handleSubmit}>{pending ? 'Adding…' : primaryLabel}</Button
		>
	</div>
</div>

<style>
	.composer {
		display: grid;
		gap: var(--cd-space-6);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--cd-space-6);
	}
	.hint {
		margin-right: auto;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-xs);
		white-space: nowrap;
	}
</style>
