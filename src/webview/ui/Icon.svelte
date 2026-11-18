<script lang="ts">
	import { ICONS, type IconName, type IconShape } from './icons';

	type Props = {
		name: IconName;
		// The only sizing: no component sizes an icon in CSS.
		size?: 12 | 14 | 16 | 24 | 32;
	};

	let { name, size = 16 }: Props = $props();

	const shapes: readonly IconShape[] = $derived(ICONS[name]);
</script>

<svg
	class={['icon', { spin: name === 'spinner' }]}
	viewBox="0 0 16 16"
	width={size}
	height={size}
	aria-hidden="true"
	focusable="false"
	fill="none"
	stroke="currentColor"
	stroke-width="1.3"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#each shapes as shape, index (index)}
		{#if shape.kind === 'path'}
			<path
				d={shape.path}
				fill={shape.fill ? 'currentColor' : undefined}
				stroke={shape.fill ? 'none' : undefined}
			/>
		{:else if shape.kind === 'circle'}
			<circle
				cx={shape.cx}
				cy={shape.cy}
				r={shape.radius}
				fill={shape.fill ? 'currentColor' : undefined}
				stroke={shape.fill ? 'none' : undefined}
			/>
		{:else}
			<rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
		{/if}
	{/each}
</svg>

<style>
	.icon {
		display: block;
		flex: none;
	}
	/* --cd-spin is none under reduced motion (theme.css). */
	.spin {
		animation: var(--cd-spin);
	}
</style>
