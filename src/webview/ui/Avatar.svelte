<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import Icon from './Icon.svelte';

	// Who wrote a thread entry. Decorative: the author's name always sits beside it, so it is hidden
	// from assistive tech, and the "Y" is CSS content so it never joins the entry's text.
	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children'> & {
		author: 'you' | 'agent';
	};

	let { author, ...rest }: Props = $props();
</script>

<!-- No whitespace inside, so the avatar adds no text to its entry. -->
<span class={['avatar', author]} aria-hidden="true" {...rest}
	>{#if author === 'agent'}<Icon name="sparkle" size={12} />{/if}</span
>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--cd-avatar);
		height: var(--cd-avatar);
		border-radius: var(--cd-radius-pill);
		background: var(--cd-avatar-bg);
		color: var(--cd-fg);
		font: var(--cd-weight-strong) 10px / 1 var(--cd-font);
	}
	.you::before {
		content: 'Y';
	}
	.agent {
		background: var(--cd-agent);
		color: var(--cd-on-agent);
	}
</style>
