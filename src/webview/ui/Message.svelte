<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	type Tone = 'info' | 'warning' | 'error';

	// The meaning is in the icon and VS Code's validation tint, never the text colour. `banner` is a
	// full-width row under the toolbar; `inline` sits in a card or widget.
	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		tone: Tone;
		variant?: 'inline' | 'banner';
		icon?: IconName;
		children: Snippet;
	};

	let { tone, variant = 'inline', icon, children, ...rest }: Props = $props();

	const DEFAULT_ICONS = {
		info: 'info',
		warning: 'warning',
		error: 'error',
	} as const satisfies Record<Tone, IconName>;
</script>

<!-- No whitespace around the text, so the message's text is exactly its content. -->
<div class={['message', `tone-${tone}`, `variant-${variant}`]} {...rest}>
	<Icon name={icon ?? DEFAULT_ICONS[tone]} /><span class="text">{@render children()}</span>
</div>

<style>
	.message {
		--cd-message-tone: var(--cd-info);
		--cd-message-bg: var(--cd-info-bg);
		display: flex;
		align-items: flex-start;
		gap: var(--cd-space-6);
		box-sizing: border-box;
		margin: 0;
		padding: var(--cd-space-6) var(--cd-space-8);
		border-radius: var(--cd-radius-sm);
		background: var(--cd-message-bg);
		color: var(--cd-fg);
		font-size: var(--cd-fs-sm);
		line-height: var(--cd-lh-sm);
		overflow-wrap: break-word;
	}
	.message > :global(svg) {
		color: var(--cd-message-tone);
	}
	.text {
		min-width: 0;
	}
	.text :global(b) {
		font-weight: var(--cd-weight-strong);
	}
	.tone-warning {
		--cd-message-tone: var(--cd-warning);
		--cd-message-bg: var(--cd-warning-bg);
	}
	.tone-error {
		--cd-message-tone: var(--cd-error);
		--cd-message-bg: var(--cd-error-bg);
	}
	/* A row in the chrome's column: full width, never squeezed by the stage. */
	.variant-banner {
		flex: none;
		align-items: center;
		gap: var(--cd-space-8);
		min-height: 28px;
		padding: var(--cd-space-4) var(--cd-space-12);
		border-bottom: 1px solid var(--cd-divider);
		border-radius: 0;
	}
</style>
