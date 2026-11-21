<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';
	import { ignoreKeyRepeat } from './keyRepeat';

	// One inspector field: the label inside on the left, the value on the right, and a set dot in
	// the left pad. Values reach the DOM only as field values, placeholders and option labels.
	type TextEntry = {
		value: string;
		invalid: boolean;
		describedBy: string | undefined;
		oninput: (value: string) => void;
		// Enter (Shift+Enter too, never while an IME composes) or blur; the swatch commits on change.
		oncommit: () => void;
	};

	type Labelled = {
		label: string;
	};

	type Segment = {
		name: string;
		icon?: IconName;
		glyph?: 'I' | 'U' | 'S';
		pressed: boolean;
		// The pressed look only: set on this element, not inherited.
		set: boolean;
		onpress: () => void;
	};

	type Props = {
		id: string;
		// The property (or segment group) it edits, also the test hook (data-cd-field): the name
		// changes when set.
		field: string;
		// The accessible name before the " (set on this element)" suffix.
		name: string;
		set: boolean;
		// Spans both grid columns.
		wide: boolean;
	} & (
		| (Labelled & TextEntry & { control: 'text'; placeholder: string })
		| (Labelled & TextEntry & { control: 'textarea'; maxlength: number })
		| (Labelled &
				TextEntry & {
					control: 'color';
					placeholder: string;
					// Always #rrggbb: the native colour input has no other value.
					swatch: string;
					none: boolean;
					pickerName: string;
				})
		| (Labelled & {
				control: 'select';
				options: readonly { value: string; label: string }[];
				// The option the select always shows; a choice never moves it, the next pick does.
				selected: string;
				onchoose: (value: string) => void;
		  })
		// No visible label: the buttons are the value.
		| { control: 'segments'; segments: readonly Segment[] }
	);

	let props: Props = $props();

	const accessibleName = $derived(props.set ? `${props.name} (set on this element)` : props.name);

	const commitOnEnter =
		(oncommit: () => void) =>
		(event: KeyboardEvent): void => {
			if (event.key === 'Enter' && !event.isComposing) {
				event.preventDefault();
				oncommit();
			}
		};
</script>

<div
	class={[
		'field',
		`control-${props.control}`,
		{
			'is-set': props.set,
			invalid: props.control !== 'segments' && props.control !== 'select' && props.invalid,
			wide: props.wide,
		},
	]}
>
	{#if props.control === 'segments'}
		<div class="seg" role="group" aria-label={accessibleName} data-cd-field={props.field}>
			{#each props.segments as segment (segment.name)}
				<button
					type="button"
					class={{ set: segment.set }}
					aria-pressed={segment.pressed}
					aria-label={segment.name}
					onkeydown={ignoreKeyRepeat}
					onclick={segment.onpress}
				>
					{#if segment.icon !== undefined}
						<Icon name={segment.icon} size={14} />
					{:else}
						<span class={['glyph', `glyph-${segment.glyph}`]}>{segment.glyph}</span>
					{/if}
				</button>
			{/each}
		</div>
	{:else}
		<label class="label" for={props.id}>{props.label}</label>
		{#if props.control === 'select'}
			{@const { selected, onchoose } = props}
			<!-- The DOM value goes back to `selected` after every choice, so the select shows the
			     computed value until the pick re-posts it.
			     ponytail: a native select fires no change for its current option, so an inherited value
			     can't be pinned by re-choosing it (choose another, then back). Upgrade: a custom listbox.
			     ponytail: arrow keys on a closed select change it on some platforms, saving every step.
			     Upgrade: a custom listbox, or saving on blur there. -->
			<select
				id={props.id}
				value={selected}
				aria-label={accessibleName}
				data-cd-field={props.field}
				onchange={(event) => {
					onchoose(event.currentTarget.value);
					event.currentTarget.value = selected;
				}}
			>
				{#each props.options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
			<span class="chevron"><Icon name="chevron-down" size={12} /></span>
		{:else if props.control === 'textarea'}
			<textarea
				id={props.id}
				rows="1"
				maxlength={props.maxlength}
				value={props.value}
				aria-label={accessibleName}
				aria-invalid={props.invalid}
				aria-describedby={props.describedBy}
				data-cd-field={props.field}
				oninput={(event) => props.oninput(event.currentTarget.value)}
				onkeydown={commitOnEnter(props.oncommit)}
				onblur={props.oncommit}
			></textarea>
		{:else}
			<input
				id={props.id}
				type="text"
				value={props.value}
				placeholder={props.placeholder}
				aria-label={accessibleName}
				aria-invalid={props.invalid}
				aria-describedby={props.describedBy}
				data-cd-field={props.field}
				oninput={(event) => props.oninput(event.currentTarget.value)}
				onkeydown={commitOnEnter(props.oncommit)}
				onblur={props.oncommit}
			/>
			{#if props.control === 'color'}
				<!-- The native picker: input previews into the same draft, change (release) commits; no
				     blur commit, opening the picker may blur it.
				     ponytail: the picker has no alpha, so a #rrggbbaa draft drops it. Upgrade: an alpha
				     control. -->
				<input
					class={['swatch', { none: props.none }]}
					type="color"
					value={props.swatch}
					aria-label={props.pickerName}
					oninput={(event) => props.oninput(event.currentTarget.value)}
					onchange={props.oncommit}
				/>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.field {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--cd-space-4);
		box-sizing: border-box;
		min-width: 0;
		height: var(--cd-control-h);
		/* The left pad is the dot's slot, so labels line up whether or not a value is set. */
		padding: 0 var(--cd-space-6) 0 var(--cd-space-12);
		border: 1px solid var(--cd-input-edge);
		border-radius: var(--cd-radius-sm);
		background: var(--cd-input-bg);
		color: var(--cd-input-fg);
		font-size: var(--cd-fs-sm);
	}
	.wide {
		grid-column: 1 / -1;
	}
	.is-set::before {
		content: '';
		position: absolute;
		top: 50%;
		left: var(--cd-space-4);
		width: var(--cd-set-dot);
		height: var(--cd-set-dot);
		margin-top: calc(var(--cd-set-dot) / -2);
		border-radius: 50%;
		background: var(--cd-accent);
	}
	/* The whole field is the hit target, and it says so before the click. */
	.field:hover {
		border-color: var(--cd-field-edge-hover);
	}
	.invalid,
	.invalid:hover {
		border-color: var(--cd-error);
	}
	/* One ring at a time: a focused swatch or segment button draws its own. */
	.field:not(.control-segments):focus-within:not(:has(.swatch:focus-visible)) {
		outline: 1px solid var(--cd-focus);
		outline-offset: -1px;
	}
	.label {
		flex: none;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-xs);
		line-height: var(--cd-lh-sm);
	}
	.field input,
	.field textarea,
	.field select {
		flex: 1 1 auto;
		box-sizing: border-box;
		width: auto;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 0;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	/* Computed values read as real text: the global placeholder colour misses 4.5:1 on light
	   themes. */
	.field input::placeholder,
	.field textarea::placeholder {
		color: var(--cd-fg-2);
		opacity: 1;
	}
	.control-textarea {
		align-items: flex-start;
		height: auto;
		padding-top: var(--cd-space-4);
		padding-bottom: var(--cd-space-4);
	}
	.control-textarea .label {
		padding-top: 1px;
	}
	.field textarea {
		display: block;
		height: auto;
		min-height: var(--cd-lh-sm);
		max-height: calc(var(--cd-lh-sm) * 6);
		line-height: var(--cd-lh-sm);
		text-align: left;
		resize: none;
		field-sizing: content;
	}
	/* The native select: the chevron is drawn over its right edge, so a click on it opens the list. */
	.field select {
		appearance: none;
		/* The 12px chevron and a 4px gap. */
		padding-inline-end: var(--cd-space-16);
		text-align-last: right;
		cursor: pointer;
	}
	/* Inherited reads secondary, set reads full, as a text box's placeholder vs value. */
	.field:not(.is-set) select {
		color: var(--cd-fg-2);
	}
	.chevron {
		position: absolute;
		right: var(--cd-space-6);
		color: var(--cd-fg-2);
		pointer-events: none;
	}
	.field select option {
		background: var(--cd-dropdown-bg);
		color: var(--cd-dropdown-fg);
	}
	/* Segments: Align and I / U / S, raw buttons inside the field. */
	.control-segments {
		padding: 0 var(--cd-space-2) 0 var(--cd-space-12);
	}
	.seg {
		display: flex;
		flex: 1 1 auto;
		gap: var(--cd-space-2);
	}
	.seg button {
		display: inline-flex;
		flex: 1 1 0;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		height: var(--cd-seg-h);
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--cd-kbd-radius);
		background: transparent;
		color: var(--cd-fg-2);
		font: inherit;
		cursor: pointer;
	}
	.seg button:hover {
		background: var(--cd-bg-hover);
		color: var(--cd-fg);
	}
	.seg button:focus-visible {
		outline-offset: -1px;
	}
	/* Pressed but inherited: a quiet fill, the same "secondary = from the design's CSS" as a value. */
	.seg button[aria-pressed='true'] {
		background: var(--cd-bg-active);
		color: var(--cd-fg);
	}
	/* Pressed and set on this element: VS Code's option style, as IconButton. */
	.seg button.set[aria-pressed='true'] {
		background: var(--cd-toggle-on-bg);
		border-color: var(--cd-toggle-on-edge);
		color: var(--cd-toggle-on-fg);
	}
	.glyph {
		font-size: var(--cd-fs-md);
		line-height: 1;
	}
	.glyph-I {
		font-style: italic;
	}
	.glyph-U {
		text-decoration: underline;
	}
	.glyph-S {
		text-decoration: line-through;
	}
	/* The swatch is the native colour input: keyboard, picker and eyedropper for free. */
	.field input.swatch {
		flex: none;
		width: var(--cd-swatch);
		height: var(--cd-swatch);
		margin-inline-start: var(--cd-space-2);
		border-radius: var(--cd-kbd-radius);
		overflow: hidden;
		appearance: none;
		cursor: pointer;
	}
	.swatch::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	.swatch::-webkit-color-swatch {
		border: 0;
		border-radius: var(--cd-kbd-radius);
		/* Drawn over the colour, so a swatch the colour of the field still has a shape. */
		box-shadow: inset 0 0 0 1px var(--cd-frame-edge);
	}
	.field input.swatch:focus-visible {
		outline: var(--cd-focus-ring);
		outline-offset: 1px;
	}
	/* No colour: an empty well with a slash in the secondary text colour, not the error red. The
	   browser paints the swatch colour inline, so only !important covers it. */
	.swatch.none::-webkit-color-swatch {
		background: linear-gradient(
			to top right,
			transparent calc(50% - 0.5px),
			var(--cd-fg-2) calc(50% - 0.5px),
			var(--cd-fg-2) calc(50% + 0.5px),
			transparent calc(50% + 0.5px)
		) !important;
	}
</style>
