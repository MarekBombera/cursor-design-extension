<script lang="ts">
	import { MAX_EDIT_TEXT_CHARS } from '../disk/layout';
	import type { ChromePick } from './commentPick';
	import { type InputField, inspectorView } from './editInspector';
	import EmptyState from './ui/EmptyState.svelte';
	import IconButton from './ui/IconButton.svelte';
	import Message from './ui/Message.svelte';

	// The Edit-mode inspector (9d): the picked element's text and inline styles in disabled fields
	// (9e enables them). Rendered only in Edit mode, first in the workspace DOM (Tab order inspector
	// → comments panel → stage); CSS `order` draws it at the right edge. Frame data reaches the DOM
	// only as field values and text, never {@html}.
	type Props = {
		pick: ChromePick | undefined;
		// The picked frame's display name; '' without a pick.
		frameLabel: string;
		onParent: () => void;
		onChild: () => void;
	};

	let { pick, frameLabel, onParent, onChild }: Props = $props();

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

	// aria-disabled, not disabled: when a frame reload clears the pick under a focused step button,
	// focus stays on it instead of falling to body.
	const step = (send: () => void): void => {
		if (pick !== undefined) {
			send();
		}
	};
</script>

<aside aria-label="Inspector" data-cd-inspector>
	<div class="head">
		<p class="title">Inspector</p>
		<span class="steps">
			<IconButton
				icon="arrow-up"
				label="Select parent element"
				aria-disabled={pick === undefined}
				onclick={() => step(onParent)}
			/>
			<IconButton
				icon="arrow-down"
				label="Select child element"
				aria-disabled={pick === undefined}
				onclick={() => step(onChild)}
			/>
		</span>
		{#if view.kind !== 'empty'}
			<p class="target">{frameLabel} › {view.target}</p>
		{/if}
	</div>
	<div class="body">
		{#if view.kind === 'empty'}
			<EmptyState icon="edit" title="No element selected">
				Click an element to edit its text and style.
			</EmptyState>
		{:else if view.kind === 'not-editable'}
			<Message tone="info">{NOT_EDITABLE_COPY[view.reason]}</Message>
		{:else}
			<div class="fields">
				{#if view.text.state === 'plain'}
					<label for="{fieldId}-text">Text</label>
					<textarea id="{fieldId}-text" rows="3" disabled value={view.text.value}></textarea>
				{:else if view.text.state !== 'none'}
					<Message tone="info">{TEXT_HINTS[view.text.state]}</Message>
				{/if}
				{#each view.fields as field (field.field)}
					<label for="{fieldId}-{field.field}">{FIELD_LABELS[field.field]}</label>
					<input
						id="{fieldId}-{field.field}"
						type="text"
						disabled
						value={field.value}
						placeholder={field.placeholder}
					/>
					<!-- Color sits with the type fields, after Font size; a computed value reads secondary. -->
					{#if field.field === 'font-size'}
						<label for="{fieldId}-color">Color</label>
						<span class="color">
							<input id="{fieldId}-color" type="color" disabled value={view.color.hex} />
							<span class={{ computed: view.color.computed }}>{view.color.value}</span>
						</span>
					{/if}
				{/each}
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
	.steps {
		display: inline-flex;
		gap: var(--cd-space-2);
	}
	.target {
		grid-column: 1 / -1;
		overflow: hidden;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
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
