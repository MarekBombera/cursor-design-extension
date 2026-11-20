<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	// `label` is the accessible name and, unless rest sets a title, the tooltip. The count badge is
	// visual only (aria-label replaces the content), so `label` must say any count it shows:
	// "Comments, 3 unresolved".
	type Props = Omit<HTMLButtonAttributes, 'class' | 'children' | 'aria-label'> & {
		icon: IconName;
		label: string;
		count?: number;
	};

	let { icon, label, count = 0, ...rest }: Props = $props();
</script>

<button
	class="icon-button"
	type="button"
	aria-label={label}
	title={label}
	{...rest}
>
	<Icon name={icon} />
	{#if count > 0}
		<span class="count">{count}</span>
	{/if}
</button>

<style>
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--cd-space-4);
		box-sizing: border-box;
		min-width: var(--cd-icon-btn);
		height: var(--cd-icon-btn);
		padding: 0 var(--cd-space-4);
		border: 1px solid transparent;
		border-radius: var(--cd-radius-sm);
		background: transparent;
		color: var(--cd-fg);
		font-size: var(--cd-fs-sm);
		cursor: pointer;
		transition: background-color var(--cd-dur) var(--cd-ease);
	}
	.icon-button:hover {
		background: var(--cd-bg-hover);
	}
	.icon-button:active {
		background: var(--cd-bg-active);
	}
	.icon-button:is([aria-pressed='true'], [aria-expanded='true']) {
		background: var(--cd-toggle-on-bg);
		border-color: var(--cd-toggle-on-edge);
		color: var(--cd-toggle-on-fg);
	}
	/* Disabled: VS Code's disabled colour, never opacity, no hover. */
	.icon-button:is(:disabled, [aria-disabled='true']) {
		background: transparent;
		color: var(--cd-fg-disabled);
		cursor: default;
	}
	.count {
		box-sizing: border-box;
		min-width: 16px;
		height: 16px;
		padding: 0 var(--cd-space-4);
		border-radius: var(--cd-radius-pill);
		background: var(--cd-count-bg);
		color: var(--cd-count-fg);
		font: var(--cd-weight-strong) var(--cd-fs-xs) / 16px var(--cd-font);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
</style>
