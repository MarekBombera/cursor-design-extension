<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import Icon from './ui/Icon.svelte';
	import type { IconName } from './ui/icons';

	// Where a comment points: [icon] frame › element, in the UI font. With `onjump` it is a button
	// that shows the target on the canvas (named by `jumpLabel`); without it, plain text. Rest
	// carries title, data-cd-focus and attachments onto the root.
	type Props = Omit<HTMLAttributes<HTMLElement>, 'class' | 'children'> & {
		frame: string;
		element: string;
		icon?: IconName;
		jumpLabel?: string;
		onjump?: () => void;
	};

	let { frame, element, icon, jumpLabel, onjump, ...rest }: Props = $props();
</script>

<!-- Spaces between the parts, so the text reads "Frame element"; the flex gap draws the spacing. -->
{#snippet parts()}
	{#if icon !== undefined}
		<Icon name={icon} size={14} />
	{/if}
	<span class="frame">{frame}</span>
	<Icon name="chevron-right" size={12} />
	<span class="element">{element}</span>
{/snippet}

{#if onjump === undefined}
	<span class="target" {...rest}>{@render parts()}</span>
{:else}
	<button class="target jump" type="button" aria-label={jumpLabel} {...rest} onclick={onjump}>
		{@render parts()}
		<span class="go"><Icon name="target" size={14} /></span>
	</button>
{/if}

<style>
	/* Fills the row it sits in (card head, widget header); the element text ellipsizes. */
	.target {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: var(--cd-space-4);
		min-width: 0;
		border-radius: var(--cd-radius-sm);
		color: var(--cd-fg-3);
		font-size: var(--cd-fs-sm);
		line-height: var(--cd-lh-sm);
		text-align: start;
	}
	/* The frame name keeps its width up to half the row; the element text takes the rest. */
	.frame {
		flex: none;
		max-width: 50%;
		overflow: hidden;
		color: var(--cd-fg-2);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* A long element text ellipsizes; the selector is the title. */
	.element {
		min-width: 4em;
		overflow: hidden;
		color: var(--cd-fg);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.jump {
		cursor: pointer;
	}
	.jump:hover .element {
		color: var(--cd-link);
		text-decoration: underline;
	}
	/* The jump hint shows on hover; keyboard focus has the ring and the button's name. */
	.go {
		display: inline-flex;
		color: var(--cd-link);
		opacity: 0;
		transition: opacity var(--cd-dur) var(--cd-ease);
	}
	.jump:hover .go {
		opacity: 1;
	}
</style>
