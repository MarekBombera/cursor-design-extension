<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import type { BadgeProps } from './badge';
	import Icon from './Icon.svelte';

	// A status pill. The text stays --cd-fg so it always reads; the tone colours only the icon and
	// a light tint. `description` explains the label: a tooltip for pointer users on the visible
	// face (hidden from assistive tech), and hidden text with the label, so it is exposed once.
	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children'> & BadgeProps;

	let { tone, icon, label, description, ...rest }: Props = $props();
</script>

{#snippet face()}
	{#if icon !== undefined}
		<Icon name={icon} size={12} />
	{/if}{label}
{/snippet}

<span class={['badge', `tone-${tone}`, { 'has-icon': icon !== undefined }]} {...rest}>
	{#if description === undefined}
		{@render face()}
	{:else}
		<span class="face" aria-hidden="true" title={description}>{@render face()}</span>
		<span class="visually-hidden">{label}. <span>{description}</span></span>
	{/if}
</span>

<style>
	.badge {
		--cd-badge-tone: var(--cd-fg-2);
		--cd-badge-bg: var(--cd-badge-bg-neutral);
		display: inline-flex;
		align-items: center;
		gap: var(--cd-space-4);
		box-sizing: border-box;
		height: var(--cd-chip-h);
		padding: 0 var(--cd-space-6);
		border-radius: var(--cd-radius-pill);
		background: var(--cd-badge-bg);
		color: var(--cd-fg);
		font-size: var(--cd-fs-xs);
		line-height: var(--cd-lh-sm);
		white-space: nowrap;
	}
	.has-icon {
		padding-left: var(--cd-space-4);
	}
	.face {
		display: inline-flex;
		align-items: center;
		gap: var(--cd-space-4);
	}
	.badge :global(svg) {
		color: var(--cd-badge-tone);
	}
	.tone-accent {
		--cd-badge-tone: var(--cd-accent);
		--cd-badge-bg: var(--cd-badge-bg-accent);
	}
	.tone-agent {
		--cd-badge-tone: var(--cd-agent);
		--cd-badge-bg: var(--cd-badge-bg-agent);
	}
	.tone-success {
		--cd-badge-tone: var(--cd-resolved);
		--cd-badge-bg: var(--cd-badge-bg-success);
	}
	.tone-warning {
		--cd-badge-tone: var(--cd-warning);
		--cd-badge-bg: var(--cd-badge-bg-warning);
	}
</style>
