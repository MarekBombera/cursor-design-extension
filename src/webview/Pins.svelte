<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { flagBadge, type PlacedPin, statusBadge } from './pins';
	import Icon from './ui/Icon.svelte';

	// Viewport-local screen px, so a pin keeps its size at any zoom. A teardrop whose tip
	// (bottom-right) sits on the point, so the body never covers the spot being discussed.
	type Props = {
		pins: PlacedPin[];
		// A comment draft is open: a click at a pin goes through to the frame and retargets it.
		inert: boolean;
		// The comment whose thread is open, for the pin's expanded state.
		openId: string | undefined;
		onOpen: (id: string) => void;
	};

	let { pins, inert, openId, onOpen }: Props = $props();

	let wrapper: HTMLDivElement | undefined;

	const attachWrapper: Attachment<HTMLDivElement> = (element) => {
		wrapper = element;
		return () => {
			wrapper = undefined;
		};
	};

	// PinThread calls this when the thread closes by Escape or Close.
	export const focusPin = (id: string): void => {
		wrapper
			?.querySelector<HTMLButtonElement>(`[data-cd-pin="${CSS.escape(id)}"]`)
			?.focus({ preventScroll: true });
	};
</script>

<!-- The wrapper is required: Stage's startDrag treats a direct child of the viewport as empty stage,
     so a bare pin button would start a pan. -->
<div class="pins" data-cd-pins {inert} {@attach attachWrapper}>
	{#each pins as pin (pin.id)}
		<!-- A missing target draws a ghost pin; stale and unchecked add a flag. The label says it. -->
		<button
			type="button"
			class={['pin', pin.status, { missing: pin.badge === 'missing' }]}
			data-cd-pin={pin.id}
			aria-label={pin.label}
			aria-haspopup="dialog"
			aria-expanded={pin.id === openId}
			style:left="{pin.x}px"
			style:top="{pin.y}px"
			onclick={() => onOpen(pin.id)}
		>
			{#if pin.status === 'resolved'}
				<Icon name={statusBadge('resolved').icon} size={12} />
			{:else}
				{pin.number}
			{/if}
			{#if pin.badge === 'stale' || pin.badge === 'unchecked'}
				<span class={['badge', pin.badge]}>
					<Icon name={flagBadge(pin.badge).icon} size={12} />
				</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	/* clip, not hidden: a hidden wrapper is a scroll container, so focusing an off-screen pin would
	   scroll it under the stage math. isolation keeps the pins' z-index below the popovers. */
	.pins {
		position: absolute;
		inset: 0;
		overflow: clip;
		pointer-events: none;
		isolation: isolate;
	}
	/* The body grows up and to the left of the tip; scaling from the tip keeps it on the point. */
	.pin {
		--cd-pin-fill: var(--cd-open);
		--cd-pin-ink: var(--cd-on-open);
		position: absolute;
		z-index: 1;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		width: var(--cd-pin);
		height: var(--cd-pin);
		border-radius: 50% 50% 3px 50%;
		background: var(--cd-pin-fill);
		color: var(--cd-pin-ink);
		font: var(--cd-weight-strong) var(--cd-fs-xs) / 1 var(--cd-font);
		font-variant-numeric: tabular-nums;
		box-shadow:
			0 0 0 2px var(--cd-pin-ring),
			0 2px 6px var(--cd-shadow);
		transform: translate(-100%, -100%);
		transform-origin: bottom right;
		transition: transform var(--cd-dur) var(--cd-ease);
		pointer-events: auto;
		cursor: pointer;
	}
	.pin:hover {
		transform: translate(-100%, -100%) scale(1.08);
	}
	.sent {
		--cd-pin-fill: var(--cd-agent);
		--cd-pin-ink: var(--cd-on-agent);
	}
	.resolved {
		--cd-pin-fill: var(--cd-pin-resolved-bg);
		--cd-pin-ink: var(--cd-pin-resolved-fg);
		z-index: 0;
		width: var(--cd-pin-sm);
		height: var(--cd-pin-sm);
	}
	/* Target gone: a ghost at the stored spot. The number stays readable text; the pin colour is
	   the inner edge and a dashed ring (a pseudo-element, so the focus outline stays free). */
	.missing {
		background: var(--cd-pin-ring);
		color: var(--cd-fg);
		box-shadow:
			inset 0 0 0 1.5px var(--cd-pin-fill),
			0 0 0 2px var(--cd-pin-ring),
			0 2px 6px var(--cd-shadow);
	}
	.missing::after {
		content: '';
		position: absolute;
		inset: -3.5px;
		border: 1.5px dashed var(--cd-pin-fill);
		border-radius: inherit;
		pointer-events: none;
	}
	/* The pin whose thread is open: a foreground ring around the halo, so it never reads as the
	   keyboard focus ring (the global one, whose 2px offset touches the halo). */
	.pin[aria-expanded='true'] {
		z-index: 2;
		box-shadow:
			0 0 0 2px var(--cd-pin-ring),
			0 0 0 4px var(--cd-fg),
			0 2px 8px var(--cd-shadow);
	}
	.missing[aria-expanded='true'] {
		box-shadow:
			inset 0 0 0 1.5px var(--cd-pin-fill),
			0 0 0 2px var(--cd-pin-ring),
			0 0 0 4px var(--cd-fg),
			0 2px 8px var(--cd-shadow);
	}
	/* On the body's far corner, away from the tip. */
	.badge {
		position: absolute;
		top: calc(-1 * var(--cd-space-6));
		left: calc(-1 * var(--cd-space-6));
		display: grid;
		place-items: center;
		width: 14px;
		height: 14px;
		border-radius: var(--cd-radius-pill);
		background: var(--cd-pin-ring);
		box-shadow: 0 1px 2px var(--cd-shadow);
		color: var(--cd-fg-2);
	}
	.badge.stale {
		color: var(--cd-warning);
	}
</style>
