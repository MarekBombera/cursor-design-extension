<script lang="ts">
	import { MAX_EDIT_TEXT_CHARS } from '../disk/layout';
	import type { ChromePick } from './commentPick';
	import type { EditField } from './editRequests';
	import { type EditDraft, fieldValue, textMaxLength } from './editDrafts';
	import { type InputField, inspectorView } from './editInspector';
	import EmptyState from './ui/EmptyState.svelte';
	import IconButton from './ui/IconButton.svelte';
	import Message from './ui/Message.svelte';
	import type { HistoryTarget } from './undoRedo';

	// Frame data reaches the DOM only as field values and text, never {@html}.
	type Props = {
		pick: ChromePick | undefined;
		frameLabel: string;
		drafts: Partial<Record<EditField, EditDraft>>;
		// The last save's refusal or "Not saved" copy; shown in every view.
		requestError: string | undefined;
		fieldError: (field: EditField) => string | undefined;
		onParent: () => void;
		onChild: () => void;
		onFieldFocus: () => void;
		onFieldInput: (field: EditField, value: string) => void;
		onFieldCommit: (field: EditField) => void;
		// The frame Undo / Redo act on; undefined disables both.
		history: HistoryTarget | undefined;
		historyAnnouncement: string;
		onUndo: () => void;
		onRedo: () => void;
	};

	let {
		pick,
		frameLabel,
		drafts,
		requestError,
		fieldError,
		onParent,
		onChild,
		onFieldFocus,
		onFieldInput,
		onFieldCommit,
		history,
		historyAnnouncement,
		onUndo,
		onRedo,
	}: Props = $props();

	const fieldId = $props.id();

	const view = $derived(inspectorView(pick));

	const FIELD_LABELS = {
		'font-size': 'Font size',
		padding: 'Padding',
		margin: 'Margin',
	} as const satisfies Record<InputField, string>;

	const NOT_EDITABLE_COPY = {
		'no-number':
			"Not editable here: this element can't be matched to the artboard file. Ask the Agent to change it.",
		'shared-number':
			"Not editable: a script copied this element, so the file can't tell the copies apart. Ask the Agent to change it.",
	} as const;

	const TEXT_HINTS = {
		children: 'Contains other elements: ask the Agent to change this text.',
		'too-long': `This text is over ${MAX_EDIT_TEXT_CHARS.toLocaleString('en-US')} characters: ask the Agent to change it.`,
	} as const;

	const STYLE_TOO_LONG_COPY =
		"This element's style attribute is too long to edit here: ask the Agent.";

	// The head buttons are aria-disabled because a reload can disable the one under focus, so a
	// click checks the same flag itself.
	const runIf = (enabled: boolean, send: () => void): void => {
		if (enabled) {
			send();
		}
	};

	const canUndo = $derived(history?.canUndo === true);
	const canRedo = $derived(history?.canRedo === true);
	const historyLabel = (verb: string): string =>
		history === undefined ? verb : `${verb} in ${history.label}`;

	const shown = (field: EditField, pickValue: string): string =>
		fieldValue({ draft: drafts[field], pick, pickValue });

	// Enter (Shift+Enter too) commits; no newline is typed. Never while an IME composes.
	const commitOnEnter = (field: EditField) => (event: KeyboardEvent) => {
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			onFieldCommit(field);
		}
	};

	const errorId = (field: EditField): string => `${fieldId}-${field}-error`;
</script>

<aside aria-label="Inspector" data-cd-inspector>
	<div class="head">
		<p class="title">Inspector</p>
		<span class="steps">
			<span class="history">
				<IconButton
					icon="undo"
					label={historyLabel('Undo')}
					aria-disabled={!canUndo}
					onclick={() => runIf(canUndo, onUndo)}
				/>
				<IconButton
					icon="redo"
					label={historyLabel('Redo')}
					aria-disabled={!canRedo}
					onclick={() => runIf(canRedo, onRedo)}
				/>
			</span>
			<IconButton
				icon="arrow-up"
				label="Select parent element"
				aria-disabled={pick === undefined}
				onclick={() => runIf(pick !== undefined, onParent)}
			/>
			<IconButton
				icon="arrow-down"
				label="Select child element"
				aria-disabled={pick === undefined}
				onclick={() => runIf(pick !== undefined, onChild)}
			/>
		</span>
		{#if view.kind !== 'empty'}
			<p class="target">{frameLabel} › {view.target}</p>
		{/if}
		<p class="visually-hidden" aria-live="polite">{historyAnnouncement}</p>
	</div>
	<div class="body">
		<div class={{ 'request-error': requestError !== undefined }} aria-live="polite">
			{#if requestError !== undefined}
				<Message tone="error">{requestError}</Message>
			{/if}
		</div>
		{#if view.kind === 'empty'}
			<EmptyState icon="edit" title="No element selected">
				Click an element to edit its text and style.
			</EmptyState>
		{:else if view.kind === 'not-editable'}
			<Message tone="info">{NOT_EDITABLE_COPY[view.reason]}</Message>
		{:else}
			{@const textError = fieldError('text')}
			<div class="fields">
				{#if view.text.state === 'plain'}
					<label for="{fieldId}-text">Text</label>
					<textarea
						id="{fieldId}-text"
						rows="3"
						maxlength={textMaxLength(drafts.text?.liveText ?? view.text.liveText)}
						value={shown('text', view.text.value)}
						aria-invalid={textError !== undefined}
						aria-describedby={textError === undefined ? undefined : errorId('text')}
						onfocus={onFieldFocus}
						oninput={(event) => onFieldInput('text', event.currentTarget.value)}
						onkeydown={commitOnEnter('text')}
						onblur={() => onFieldCommit('text')}
					></textarea>
					{#if textError !== undefined}
						<Message tone="error" id={errorId('text')}>{textError}</Message>
					{/if}
				{:else if view.text.state !== 'none'}
					<Message tone="info">{TEXT_HINTS[view.text.state]}</Message>
				{/if}
				{#if view.style === 'too-long'}
					<Message tone="info">{STYLE_TOO_LONG_COPY}</Message>
				{:else}
					{#each view.fields as field (field.field)}
						{@const error = fieldError(field.field)}
						<label for="{fieldId}-{field.field}">{FIELD_LABELS[field.field]}</label>
						<input
							id="{fieldId}-{field.field}"
							type="text"
							value={shown(field.field, field.value)}
							placeholder={field.placeholder}
							aria-invalid={error !== undefined}
							aria-describedby={error === undefined ? undefined : errorId(field.field)}
							onfocus={onFieldFocus}
							oninput={(event) => onFieldInput(field.field, event.currentTarget.value)}
							onkeydown={commitOnEnter(field.field)}
							onblur={() => onFieldCommit(field.field)}
						/>
						{#if error !== undefined}
							<Message tone="error" id={errorId(field.field)}>{error}</Message>
						{/if}
						{#if field.field === 'font-size'}
							{@const colorDraft = drafts.color}
							<label for="{fieldId}-color">Color</label>
							<span class="color">
								<!-- The native picker: input previews, change (release) commits; no blur commit,
								     opening the picker may blur it. -->
								<input
									id="{fieldId}-color"
									type="color"
									value={shown('color', view.color.hex)}
									onfocus={onFieldFocus}
									oninput={(event) => onFieldInput('color', event.currentTarget.value)}
									onchange={() => onFieldCommit('color')}
								/>
								<span class={{ computed: view.color.computed && colorDraft === undefined }}
									>{shown('color', view.color.value)}</span
								>
							</span>
						{/if}
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</aside>

<style>
	/* After the comments panel (order 1), so it is the right edge. */
	aside {
		order: 2;
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--cd-inspector-w);
		max-width: 30%;
		box-sizing: border-box;
		overflow: hidden;
		border-left: 1px solid var(--cd-divider);
		background: var(--cd-bg-chrome);
	}
	p {
		margin: 0;
	}
	.head {
		display: grid;
		flex: none;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--cd-space-4) var(--cd-space-8);
		padding: var(--cd-space-8) var(--cd-space-12) var(--cd-space-10);
		border-bottom: 1px solid var(--cd-divider);
	}
	.title {
		font: var(--cd-weight-strong) var(--cd-fs-xs) / var(--cd-lh-sm) var(--cd-font);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.steps,
	.history {
		display: inline-flex;
		gap: var(--cd-space-2);
	}
	.history {
		margin-inline-end: var(--cd-space-6);
	}
	.target {
		grid-column: 1 / -1;
		overflow: hidden;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.request-error {
		margin-bottom: var(--cd-space-12);
	}
	.body {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		padding: var(--cd-space-12);
	}
	.fields {
		display: grid;
		gap: var(--cd-space-4);
	}
	label {
		margin-top: var(--cd-space-6);
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
	}
	label:first-child {
		margin-top: 0;
	}
	.color {
		display: flex;
		align-items: center;
		gap: var(--cd-space-8);
		min-width: 0;
	}
	/* Real text, so the secondary text colour: the placeholder colour misses 4.5:1 on light themes. */
	.computed {
		color: var(--cd-fg-2);
	}
</style>
