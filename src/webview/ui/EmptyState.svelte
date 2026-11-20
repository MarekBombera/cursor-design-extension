<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	// VS Code's welcome-view look, centred by auto margins in whatever space its parent gives it.
	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children' | 'title'> & {
		icon: IconName;
		title: string;
		children?: Snippet;
		example?: string;
	};

	let { icon, title, children, example, ...rest }: Props = $props();
</script>

<div class="empty-state" {...rest}>
	<Icon name={icon} size={32} />
	<p class="title">{title}</p>
	{#if children !== undefined}
		<p>{@render children()}</p>
	{/if}
	{#if example !== undefined}
		<p class="example">{example}</p>
	{/if}
</div>

<style>
	.empty-state {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: var(--cd-space-8);
		box-sizing: border-box;
		max-width: 300px;
		margin: auto;
		padding: var(--cd-space-24);
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		line-height: var(--cd-lh-sm);
		text-align: center;
	}
	p {
		margin: 0;
	}
	.title {
		color: var(--cd-fg);
		font-size: var(--cd-fs-md);
		font-weight: var(--cd-weight-strong);
	}
	.example {
		padding: var(--cd-space-6) var(--cd-space-10);
		border: 1px dashed var(--cd-frame-edge);
		border-radius: var(--cd-radius-md);
		color: var(--cd-fg);
		font-style: italic;
	}
</style>
