<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	import type { PostedComment } from './hostMessages';

	// A comment's pin number in its pin's colour, so a card or thread pairs up with its pin.
	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children'> & {
		number: number;
		status: PostedComment['status'];
	};

	let { number, status, ...rest }: Props = $props();
</script>

<!-- The hidden word gives the number its meaning for assistive tech: "Comment 3". -->
<span class={['pin-chip', status]} {...rest}><span class="visually-hidden">Comment&nbsp;</span>{number}</span
>

<style>
	.pin-chip {
		display: inline-grid;
		place-items: center;
		flex: none;
		box-sizing: border-box;
		min-width: var(--cd-chip-h);
		height: var(--cd-chip-h);
		padding: 0 var(--cd-space-4);
		border-radius: 9px 9px 2px 9px;
		background: var(--cd-open);
		color: var(--cd-on-open);
		font: var(--cd-weight-strong) var(--cd-fs-xs) / 1 var(--cd-font);
		font-variant-numeric: tabular-nums;
	}
	.sent {
		background: var(--cd-agent);
		color: var(--cd-on-agent);
	}
	.resolved {
		background: var(--cd-pin-resolved-bg);
		color: var(--cd-pin-resolved-fg);
	}
</style>
