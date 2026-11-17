<script lang="ts">
	import type { StageRect } from './stageGeometry';

	// Viewport-local screen px, so the outline thickness is constant at any zoom.
	type Props = {
		hover: StageRect | undefined;
		pick: StageRect | undefined;
		// Click to jump: the target's outline, shown for JUMP_FLASH_MS.
		flash: StageRect | undefined;
	};

	let { hover, pick, flash }: Props = $props();
</script>

{#snippet outline(rect: StageRect, kind: 'hover' | 'pick' | 'flash')}
	<div
		class={['outline', kind]}
		data-cd-flash={kind === 'flash' ? '' : undefined}
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
	{#if flash !== undefined}
		{@render outline(flash, 'flash')}
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
	.flash {
		border: 2px solid var(--vscode-editorInfo-foreground, var(--vscode-focusBorder));
	}
</style>
