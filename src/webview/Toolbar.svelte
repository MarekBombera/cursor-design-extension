<script lang="ts">
	type Props = {
		artboardId: string;
		generation: string;
		handoffStale: boolean;
		zoomText: string;
		disabled: boolean;
		onPreset: (zoom: number) => void;
		onFit: () => void;
	};

	let { artboardId, generation, handoffStale, zoomText, disabled, onPreset, onFit }: Props =
		$props();

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
	<span class="badge readout">{zoomText}</span>
	<select class="preset" aria-label="Zoom preset" {disabled} onchange={choosePreset}>
		<option value="" selected disabled>Zoom</option>
		{#each presets as preset (preset)}
			<option value={String(preset)}>{Math.round(preset * 100)}%</option>
		{/each}
	</select>
	<button class="fit" type="button" {disabled} onclick={onFit}>Fit all</button>
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
	.fit {
		font: inherit;
		padding: 0.125rem 0.5rem;
		color: var(--vscode-button-secondaryForeground);
		background: var(--vscode-button-secondaryBackground);
		border: 0;
	}
	.preset:focus-visible,
	.fit:focus-visible {
		outline: 1px solid var(--vscode-focusBorder);
	}
</style>
