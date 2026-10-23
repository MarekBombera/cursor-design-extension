<script lang="ts">
	import type { StageRect } from './stageGeometry';

	// Viewport-local screen px, so the outline thickness is constant at any zoom.
	type Props = {
		hover: StageRect | undefined;
		pick: StageRect | undefined;
	};

	let { hover, pick }: Props = $props();
</script>

{#snippet outline(rect: StageRect, kind: 'hover' | 'pick')}
	<div
		class={['outline', kind]}
		style:left="{rect.x}px"
		style:top="{rect.y}px"
		style:width="{rect.width}px"
		style:height="{rect.height}px"
	></div>
{/snippet}

<div class="overlay" aria-hidden="true">
	{#if hover !== undefined}
		{@render outline(hover, 'hover')}
	{/if}
	{#if pick !== undefined}
		{@render outline(pick, 'pick')}
	{/if}
</div>

<style>
	.overlay {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}
	.outline {
		position: absolute;
		box-sizing: border-box;
	}
	.hover {
		border: 1px dashed var(--vscode-focusBorder);
	}
	.pick {
		border: 2px solid var(--vscode-focusBorder);
	}
</style>
