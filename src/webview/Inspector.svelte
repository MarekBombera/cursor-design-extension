<script lang="ts">
	import type { StyleChange, StyleField } from '../disk/editValues';
	import { MAX_EDIT_TEXT_CHARS } from '../disk/layout';
	import type { ChromePick } from './commentPick';
	import type { EditField } from './editRequests';
	import { type EditDraft, fieldValue, swatchValue, textMaxLength } from './editDrafts';
	import {
		type ContentView,
		type FieldView,
		inspectorView,
		type SectionId,
		type SectionView,
		type SelectOption,
	} from './editInspector';
	import Button from './ui/Button.svelte';
	import EmptyState from './ui/EmptyState.svelte';
	import Field from './ui/Field.svelte';
	import IconButton from './ui/IconButton.svelte';
	import { ignoreKeyRepeat } from './ui/keyRepeat';
	import Message from './ui/Message.svelte';
	import type { HistoryTarget } from './undoRedo';

	// Frame data reaches the DOM only as field values, placeholders and text, never {@html}.
	type Props = {
		pick: ChromePick | undefined;
		frameLabel: string;
		drafts: Partial<Record<EditField, EditDraft>>;
		// The style fields with an open draft for this pick; they stay rendered (D8).
		drafted: ReadonlySet<StyleField>;
		// The last save's refusal or "Not saved" copy; shown in every view.
		requestError: string | undefined;
		fieldError: (field: EditField) => string | undefined;
		onParent: () => void;
		onChild: () => void;
		// Focus entered an inspector control.
		onFieldFocus: () => void;
		onFieldInput: (field: EditField, value: string) => void;
		onFieldCommit: (field: EditField) => void;
		// A choice, Reset or Add border: one save; true when it was enqueued.
		onStyleChanges: (changes: readonly StyleChange[], announcement?: string) => boolean;
		// The frame Undo / Redo act on; undefined disables both.
		history: HistoryTarget | undefined;
		// Undo / redo steps and saved section actions.
		announcement: string;
		onUndo: () => void;
		onRedo: () => void;
	};

	let {
		pick,
		frameLabel,
		drafts,
		drafted,
		requestError,
		fieldError,
		onParent,
		onChild,
		onFieldFocus,
		onFieldInput,
		onFieldCommit,
		onStyleChanges,
		history,
		announcement,
		onUndo,
		onRedo,
	}: Props = $props();

	const fieldId = $props.id();

	const view = $derived(inspectorView(pick, drafted));

	const NOT_EDITABLE_COPY = {
		'no-number':
			"Not editable here: this element can't be matched to the artboard file. Ask the Agent to change it.",
		'shared-number':
			"Not editable: a script copied this element, so the file can't tell the copies apart. Ask the Agent to change it.",
	} as const;

	const TEXT_TOO_LONG_COPY = `This text is over ${MAX_EDIT_TEXT_CHARS.toLocaleString('en-US')} characters: ask the Agent to change it.`;

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

	const errorId = (field: EditField): string => `${fieldId}-${field}-error`;

	const fieldKey = (field: FieldView): string =>
		field.control === 'segments' ? field.id : field.field;

	// ponytail: a choice or toggle reads the latest re-posted pick, so a second click within one
	// animation frame of a preview can read the state before it (a fast U-then-S can lose a token;
	// disk always gets exactly what was sent). Upgrade: chain choices on the pending preview.
	// A display-only option (the current value outside the list) saves nothing.
	const choose = (options: readonly SelectOption[], value: string): void => {
		const change = options.find((option) => option.value === value)?.change;
		if (change !== undefined) {
			onStyleChanges([change]);
		}
	};

	const actionId = (section: SectionId): string => `${fieldId}-${section}-action`;

	// Armed by a saved Add border: Width takes focus the first time it renders for that element.
	// Not state: the save's preview re-posts the pick, which re-runs the effect that reads it.
	let widthFocus: { frameId: string; sourceNumber: number } | undefined;

	// detail > 1: the second click of a double-click lands after the label flipped (Add border to
	// Reset), so it never sends a second save. aria-disabled: the click checks the flag itself.
	const runAction = (event: MouseEvent, { action }: SectionView): void => {
		if (event.detail > 1 || !action.enabled) {
			return;
		}
		const saved = onStyleChanges(action.changes, action.announcement);
		const sourceNumber = pick?.edit?.sourceNumber ?? undefined;
		if (saved && action.kind === 'add-border' && pick !== undefined && sourceNumber !== undefined) {
			widthFocus = { frameId: pick.frameId, sourceNumber };
		}
	};

	// Clears when the pick moves to another element or drops (a refusal reload), else on use.
	$effect(() => {
		void view;
		if (widthFocus === undefined) {
			return;
		}
		if (
			pick?.frameId !== widthFocus.frameId ||
			pick.edit?.sourceNumber !== widthFocus.sourceNumber
		) {
			widthFocus = undefined;
			return;
		}
		const width = document.getElementById(`${fieldId}-border-width`);
		if (width !== null) {
			widthFocus = undefined;
			width.focus();
		}
	});

	const sectionOf = (target: EventTarget | null): string | undefined =>
		target instanceof HTMLElement
			? target.closest<HTMLElement>('[data-cd-section]')?.dataset.cdSection
			: undefined;

	// A re-render that removes the focused field (Gap hidden, the border fields gone) hands focus
	// to its section's header button, which never unmounts. Read before the DOM update, used after.
	let focusedSection: string | undefined;
	$effect.pre(() => {
		void view;
		const active = document.activeElement;
		focusedSection =
			active instanceof HTMLElement && active.closest('[data-cd-inspector]') !== null
				? sectionOf(active)
				: undefined;
	});
	// Tab to another inspector control: the blur commit re-renders while focus is on body, before it
	// lands, and can remove Tab's destination. Capture phase: recorded before the commit. Only a
	// removed destination hands off: a click on a control that stays must keep its focus move.
	let tabbed: { section: string | undefined; to: Element } | undefined;
	const recordTab = (event: FocusEvent & { currentTarget: HTMLElement }): void => {
		const { relatedTarget } = event;
		tabbed =
			relatedTarget instanceof Element && event.currentTarget.contains(relatedTarget)
				? { section: sectionOf(event.target), to: relatedTarget }
				: undefined;
	};
	$effect(() => {
		void view;
		const removed =
			tabbed !== undefined && !tabbed.to.isConnected ? tabbed.section : undefined;
		tabbed = undefined;
		const section = focusedSection ?? removed;
		const active = document.activeElement;
		if (section !== undefined && (active === null || active === document.body)) {
			document.getElementById(`${fieldId}-${section}-action`)?.focus();
		}
	});

	// Props every text-box field shares; the draft wins over the pick value while it exists.
	const entryProps = (field: EditField, error: string | undefined) => ({
		id: `${fieldId}-${field}`,
		field,
		invalid: error !== undefined,
		describedBy: error === undefined ? undefined : errorId(field),
		oninput: (value: string) => onFieldInput(field, value),
		oncommit: () => onFieldCommit(field),
	});
</script>

{#snippet errorRow(field: EditField, error: string | undefined)}
	{#if error !== undefined}
		<div class="wide">
			<Message tone="error" id={errorId(field)}>{error}</Message>
		</div>
	{/if}
{/snippet}

{#snippet contentRow(content: ContentView)}
	{#if content.state === 'plain'}
		{@const error = fieldError('text')}
		<Field
			{...entryProps('text', error)}
			control="textarea"
			label="Content"
			name="Content"
			set={false}
			wide
			maxlength={textMaxLength(drafts.text?.liveText ?? content.liveText)}
			value={shown('text', content.value)}
		/>
		{@render errorRow('text', error)}
	{:else}
		<div class="wide">
			<Message tone="info">{TEXT_TOO_LONG_COPY}</Message>
		</div>
	{/if}
{/snippet}

<aside aria-label="Inspector" data-cd-inspector onblurcapture={recordTab}>
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
			<!-- The selected tag answers "what am I editing"; the frame is context. -->
			<p class="target">{frameLabel} › <b>{view.target}</b></p>
		{/if}
		<p class="visually-hidden" aria-live="polite">{announcement}</p>
	</div>
	<!-- Focus on any control re-describes the pick, so a draft or choice starts from fresh style. -->
	<div class="body" onfocusin={onFieldFocus}>
		<!-- ponytail: a reload that empties the pick unmounts a focused field and focus falls to body;
		     this region still announces the copy. Upgrade: move focus to the stage viewport first, as
		     leaving Edit mode does. -->
		<div class={{ 'request-error': requestError !== undefined }} aria-live="polite">
			{#if requestError !== undefined}
				<Message tone="error">{requestError}</Message>
			{/if}
		</div>
		{#if view.kind === 'empty'}
			<div class="pad">
				<EmptyState icon="edit" title="No element selected">
					Click an element to edit its text and style.
				</EmptyState>
			</div>
		{:else if view.kind === 'not-editable'}
			<div class="pad">
				<Message tone="info">{NOT_EDITABLE_COPY[view.reason]}</Message>
			</div>
		{:else if view.styleTooLong}
			<div class="grid pad">
				<!-- Too-long text here is the style message alone (D1). -->
				{#if view.content?.state === 'plain'}
					{@render contentRow(view.content)}
				{/if}
				<div class="wide">
					<Message tone="info">{STYLE_TOO_LONG_COPY}</Message>
				</div>
			</div>
		{:else}
			{#each view.sections as section (section.id)}
				<section
					class="section"
					aria-labelledby="{fieldId}-{section.id}-title"
					data-cd-section={section.id}
				>
					<div class="section-head">
						<h3 class="section-title" id="{fieldId}-{section.id}-title">{section.title}</h3>
						<!-- Always mounted: label, name and action switch in place, so focus survives. -->
						<span class="action">
							<Button
								id={actionId(section.id)}
								variant="ghost"
								size="sm"
								icon={section.action.kind === 'add-border' ? 'plus' : undefined}
								aria-label={section.action.name}
								aria-disabled={!section.action.enabled}
								onkeydown={ignoreKeyRepeat}
								onclick={(event) => runAction(event, section)}>{section.action.label}</Button
							>
						</span>
					</div>
					{#if section.fields.length > 0}
						<div class="grid">
							{#if section.hint !== undefined}
								<p class="hint wide">{section.hint}</p>
							{/if}
							{#if section.id === 'text' && view.content !== undefined}
								{@render contentRow(view.content)}
							{/if}
							<!-- Keyed by field, so a pick re-post after a preview keeps the DOM and focus. -->
							{#each section.fields as field (fieldKey(field))}
								{#if field.control === 'segments'}
									<Field
										id="{fieldId}-{field.id}"
										field={field.id}
										control="segments"
										name={field.name}
										set={field.set}
										wide={field.wide}
										segments={field.buttons.map((button) => ({
											...button,
											onpress: () => onStyleChanges([button.change]),
										}))}
									/>
								{:else if field.control === 'select'}
									<Field
										id="{fieldId}-{field.field}"
										field={field.field}
										control="select"
										label={field.label}
										name={field.name}
										set={field.set}
										wide={field.wide}
										options={field.options}
										selected={field.selected}
										onchoose={(value) => choose(field.options, value)}
									/>
								{:else}
									{@const error = fieldError(field.field)}
									{#if field.control === 'color'}
										<Field
											{...entryProps(field.field, error)}
											control="color"
											label={field.label}
											name={field.name}
											set={field.set}
											wide={field.wide}
											value={shown(field.field, field.value)}
											placeholder={field.placeholder}
											swatch={swatchValue({ draft: drafts[field.field], pick, swatch: field.swatch })}
											none={field.none}
											pickerName={field.pickerName}
										/>
									{:else}
										<Field
											{...entryProps(field.field, error)}
											control="text"
											label={field.label}
											name={field.name}
											set={field.set}
											wide={field.wide}
											value={shown(field.field, field.value)}
											placeholder={field.placeholder}
										/>
									{/if}
									{@render errorRow(field.field, error)}
								{/if}
							{/each}
						</div>
					{/if}
				</section>
			{/each}
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
		/* The field grid goes to one column when a narrow panel squeezes the inspector (R17). */
		container-type: inline-size;
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
	.title,
	.section-title {
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
		margin-inline-end: var(--cd-space-4);
		padding-inline-end: var(--cd-space-4);
		border-inline-end: 1px solid var(--cd-divider);
	}
	.target {
		grid-column: 1 / -1;
		overflow: hidden;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.target b {
		color: var(--cd-fg);
		font-weight: var(--cd-weight-strong);
	}
	.request-error {
		padding: var(--cd-space-10) var(--cd-space-12) 0;
	}
	.body {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
	}
	.pad {
		padding: var(--cd-space-12);
	}
	.section {
		padding: var(--cd-space-10) var(--cd-space-12) var(--cd-space-12);
		border-bottom: 1px solid var(--cd-divider);
	}
	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: var(--cd-control-h-sm);
	}
	/* The label, not the hover fill, lines up with the fields' right edge. */
	.action {
		margin-inline-end: calc(var(--cd-button-pad-sm) * -1);
	}
	.section-head + .grid {
		margin-top: var(--cd-space-6);
	}
	.section-title {
		margin: 0;
		color: var(--cd-fg-2);
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--cd-space-6);
	}
	@container (width < 260px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
	.wide {
		grid-column: 1 / -1;
	}
	.hint {
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-xs);
		line-height: var(--cd-lh-sm);
	}
</style>
