<script lang="ts">
	type Props = {
		artboardId: string;
		generation: string;
		handoffStale: boolean;
		zoomText: string;
		disabled: boolean;
		commentMode: boolean;
		pick: { selector: string | null; tagName: string; isPage: boolean; sequence: number } | undefined;
		onPreset: (zoom: number) => void;
		onFit: () => void;
		onToggleComment: () => void;
		onPickParent: () => void;
		onPickChild: () => void;
	};

	let {
		artboardId,
		generation,
		handoffStale,
		zoomText,
		disabled,
		commentMode,
		pick,
		onPreset,
		onFit,
		onToggleComment,
		onPickParent,
		onPickChild,
	}: Props = $props();

	// Frame data, rendered as text only.
	const pickText = $derived(
		!commentMode || pick === undefined
			? ''
			: pick.isPage
				? 'Whole frame'
				: (pick.selector ?? `${pick.tagName} (no unique selector)`),
	);

	// The live region stays mounted, so a new pick is announced, not just inserted. It reads the
	// tag, not a selector of up to 1000 characters. Equal text is not re-announced, so every other
	// pick ends in a no-break space: two div picks in a row still both speak.
	const pickAnnouncement = $derived.by(() => {
		if (pickText === '' || pick === undefined) {
			return '';
		}
		const text = pick.isPage ? 'Whole frame selected' : `${pick.tagName} element selected`;
		return pick.sequence % 2 === 0 ? `${text}\u00a0` : text;
	});

	const presets = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

	const choosePreset = (event: Event & { currentTarget: HTMLSelectElement }): void => {
		const select = event.currentTarget;
		if (select.value === '') {
			return;
		}
		onPreset(Number(select.value));
		select.selectedIndex = 0;
	};
</script>

<header class="bar">
	<span class="badge">{artboardId}</span>
	<span class="badge">{generation}</span>
	<span class="badge" aria-live="polite" hidden={!handoffStale}>
		{handoffStale ? 'Handoff out of date. Re-export.' : ''}
	</span>
	<button
		class="action"
		type="button"
		aria-pressed={commentMode}
		{disabled}
		onclick={onToggleComment}>Comment</button
	>
	<span class="chip" title={pickText} hidden={pickText === ''}>{pickText}</span>
	<span class="visually-hidden" aria-live="polite">{pickAnnouncement}</span>
	{#if pickText !== ''}
		<button
			class="action"
			type="button"
			aria-label="Select parent element"
			title="Parent (↑)"
			aria-disabled={pick?.isPage}
			onclick={pick?.isPage === true ? undefined : onPickParent}>Parent</button
		>
		<button
			class="action"
			type="button"
			aria-label="Select child element"
			title="Child (↓)"
			onclick={onPickChild}>Child</button
		>
	{/if}
	<span class="badge readout">{zoomText}</span>
	<select class="preset" aria-label="Zoom preset" {disabled} onchange={choosePreset}>
		<option value="" selected disabled>Zoom</option>
		{#each presets as preset (preset)}
			<option value={String(preset)}>{Math.round(preset * 100)}%</option>
		{/each}
	</select>
	<button class="action" type="button" {disabled} onclick={onFit}>Fit all</button>
</header>

<style>
	.bar {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--vscode-panel-border);
		flex: 0 0 auto;
	}
	.badge {
		color: var(--vscode-descriptionForeground);
	}
	.badge[hidden] {
		display: none;
	}
	.readout {
		margin-left: auto;
	}
	.preset {
		font: inherit;
		color: var(--vscode-dropdown-foreground);
		background: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border);
	}
	.action {
		font: inherit;
		padding: 0.125rem 0.5rem;
		color: var(--vscode-button-secondaryForeground);
		background: var(--vscode-button-secondaryBackground);
		border: 0;
	}
	.action[aria-pressed='true'] {
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-background);
	}
	/* aria-disabled keeps a focused Parent button focusable when it reaches Whole frame. */
	.action:disabled,
	.action[aria-disabled='true'] {
		opacity: 0.5;
	}
	/* A long selector ellipsizes; the full text is the title. */
	.chip {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 0 0.375rem;
		font-family: var(--vscode-editor-font-family);
		color: var(--vscode-badge-foreground);
		background: var(--vscode-badge-background);
	}
	.chip[hidden] {
		display: none;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.preset:focus-visible,
	.action:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
	}
</style>
