<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	// `disabled` and `aria-disabled` pass through untouched, so callers keep their own click guards.
	// Prefer aria-disabled: a disabled focused button drops focus to body.
	type CommonProps = Omit<HTMLButtonAttributes, 'class' | 'children'> & {
		icon?: IconName;
		pending?: boolean;
		block?: boolean;
		children: Snippet;
	};

	// The agent tone tints only a ghost's icon; on a filled button it would fight the fill.
	type Size = 'md' | 'sm';
	type Props = CommonProps &
		(
			| { variant?: 'primary' | 'secondary'; size?: Size; tone?: never }
			| { variant: 'segment'; size?: never; tone?: never }
			| { variant: 'ghost'; size?: Size; tone?: 'agent' }
		);

	let {
		variant = 'secondary',
		size = 'md',
		tone,
		icon,
		pending = false,
		block = false,
		children,
		...rest
	}: Props = $props();
</script>

<!-- No whitespace before the label, so the button's text is exactly its label. -->
<button
	class={[
		'button',
		`variant-${variant}`,
		`size-${size}`,
		{ agent: tone === 'agent', block, 'has-icon': pending || icon !== undefined },
	]}
	type="button"
	aria-busy={pending ? 'true' : undefined}
	{...rest}
>
	{#if pending}
		<Icon name="spinner" />
	{:else if icon !== undefined}
		<Icon name={icon} />
	{/if}{@render children()}
</button>

<style>
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--cd-space-6);
		box-sizing: border-box;
		height: var(--cd-control-h);
		padding: 0 var(--cd-space-10);
		border: 1px solid var(--cd-button-edge);
		border-radius: var(--cd-radius-sm);
		font-size: var(--cd-fs-md);
		line-height: var(--cd-lh-md);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--cd-dur) var(--cd-ease),
			color var(--cd-dur) var(--cd-ease);
	}
	.size-sm {
		height: var(--cd-control-h-sm);
		padding: 0 var(--cd-button-pad-sm);
		gap: var(--cd-space-4);
		font-size: var(--cd-fs-sm);
	}
	/* An icon's glyph sits inside its box with room to spare, so the leading pad is smaller and the
	   label looks evenly padded once a fill shows (hover, Copied). */
	.has-icon {
		padding-left: var(--cd-space-8);
	}
	.size-sm.has-icon {
		padding-left: var(--cd-space-4);
	}
	.block {
		width: 100%;
	}
	.variant-primary {
		background: var(--cd-primary-bg);
		color: var(--cd-primary-fg);
	}
	.variant-primary:hover {
		background: var(--cd-primary-hover);
	}
	.variant-secondary {
		background: var(--cd-secondary-bg);
		color: var(--cd-secondary-fg);
	}
	.variant-secondary:hover {
		background: var(--cd-secondary-hover);
	}
	.variant-ghost {
		background: transparent;
		border-color: transparent;
		color: var(--cd-fg-2);
	}
	.variant-ghost:hover {
		background: var(--cd-bg-hover);
		color: var(--cd-fg);
	}
	.variant-ghost.agent {
		color: var(--cd-fg);
	}
	.variant-ghost.agent > :global(svg) {
		color: var(--cd-agent);
	}
	/* A toggle (aria-pressed) uses VS Code's option style, as IconButton does. */
	.button[aria-pressed='true'] {
		background: var(--cd-toggle-on-bg);
		border-color: var(--cd-toggle-on-edge);
		color: var(--cd-toggle-on-fg);
	}
	.variant-segment {
		height: var(--cd-control-h-sm);
		padding: 0 var(--cd-space-8);
		border: 0;
		background: transparent;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
	}
	.variant-segment:hover {
		color: var(--cd-fg);
	}
	.variant-segment[aria-pressed='true'] {
		background: var(--cd-bg-card);
		color: var(--cd-fg);
		box-shadow:
			0 0 0 1px var(--cd-edge),
			0 1px 2px var(--cd-shadow);
	}
	/* Disabled: VS Code's disabled colour, never opacity, no hover; primary drops to the secondary
	   fill. Pending wins: a pending button keeps its own fill and says it is working. A pressed
	   toggle keeps its pressed fill, so it never looks half-pressed. */
	.button:is(:disabled, [aria-disabled='true']):not([aria-busy='true']) {
		color: var(--cd-fg-disabled);
		cursor: default;
	}
	.variant-primary:is(:disabled, [aria-disabled='true']):not([aria-busy='true'], [aria-pressed='true']),
	.variant-secondary:is(:disabled, [aria-disabled='true']):not([aria-busy='true'], [aria-pressed='true']) {
		background: var(--cd-secondary-bg);
	}
	.variant-ghost:is(:disabled, [aria-disabled='true']):not([aria-busy='true'], [aria-pressed='true']),
	.variant-segment:is(:disabled, [aria-disabled='true']):not([aria-busy='true'], [aria-pressed='true']) {
		background: transparent;
	}
	.variant-ghost.agent:is(:disabled, [aria-disabled='true']):not([aria-busy='true']) > :global(svg) {
		color: var(--cd-fg-disabled);
	}
	.button[aria-busy='true'] {
		cursor: progress;
	}
</style>
