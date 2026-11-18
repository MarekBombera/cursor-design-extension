<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	// The floating editor-widget shell (add popover, comment thread): a header row, a body that
	// scrolls, an optional fixed footer. `left` / `top` place it in viewport px; `width` / `height`
	// report the measured size so the caller can place it (placePopover). Rest carries role, aria-*,
	// tabindex, data-cd-*, handlers and attachments onto the root. Neither a pointerdown nor a wheel
	// on a widget reaches the stage's pan and zoom, so callers cannot set those two handlers.
	type Props = Omit<
		HTMLAttributes<HTMLDivElement>,
		'class' | 'children' | 'onpointerdown' | 'onwheel'
	> & {
		header: Snippet;
		children: Snippet;
		footer?: Snippet;
		left?: number;
		top?: number;
		width?: number;
		height?: number;
	};

	let {
		header,
		children,
		footer,
		left,
		top,
		width = $bindable(0),
		height = $bindable(0),
		...rest
	}: Props = $props();

	const stopAtWidget = (event: Event): void => {
		event.stopPropagation();
	};
</script>

<div
	class="widget"
	bind:offsetWidth={width}
	bind:offsetHeight={height}
	style:left={left === undefined ? undefined : `${left}px`}
	style:top={top === undefined ? undefined : `${top}px`}
	{...rest}
	onpointerdown={stopAtWidget}
	onwheel={stopAtWidget}
>
	<div class="widget-head">{@render header()}</div>
	<div class="widget-body">{@render children()}</div>
	{#if footer !== undefined}
		<div class="widget-foot">{@render footer()}</div>
	{/if}
</div>

<style>
	.widget {
		position: absolute;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: var(--cd-widget-w);
		max-width: calc(100% - var(--cd-space-16));
		/* Capped, so a long thread scrolls its body instead of filling the stage. */
		max-height: min(var(--cd-widget-max-h), calc(100% - var(--cd-space-16)));
		border-radius: var(--cd-radius-md);
		background: var(--cd-bg-widget);
		box-shadow: var(--cd-shadow-widget);
		color: var(--cd-fg);
		cursor: auto;
	}
	.widget-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--cd-space-6);
		min-width: 0;
		min-height: 34px;
		padding: var(--cd-space-4) var(--cd-space-4) var(--cd-space-4) var(--cd-space-10);
		border-bottom: 1px solid var(--cd-edge);
	}
	.widget-body {
		display: grid;
		gap: var(--cd-space-10);
		min-height: 0;
		padding: var(--cd-space-10) var(--cd-space-12);
		overflow: auto;
		overscroll-behavior: contain;
	}
	.widget-foot {
		display: grid;
		flex: none;
		gap: var(--cd-space-8);
		padding: var(--cd-space-8) var(--cd-space-12);
		border-top: 1px solid var(--cd-edge);
	}
</style>
