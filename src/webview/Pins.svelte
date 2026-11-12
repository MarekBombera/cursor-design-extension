<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import type { PinBadge, PlacedPin } from './pins';

	// Viewport-local screen px, so a pin is the same size at any zoom. Layout, badge and label come
	// from pins.ts; this only draws them.
	type Props = {
		pins: PlacedPin[];
		// A comment draft is open: a click at a pin goes through to the frame and retargets it.
		inert: boolean;
		// The comment whose thread is open, for the pin's expanded state.
		openId: string | undefined;
		onOpen: (id: string) => void;
	};

	let { pins, inert, openId, onOpen }: Props = $props();

	const BADGE_GLYPHS: Record<PinBadge, string> = { missing: '×', stale: '!', unchecked: '?' };

	// Read by focusPin only, so not reactive.
	let wrapper: HTMLDivElement | undefined;

	const attachWrapper: Attachment<HTMLDivElement> = (element) => {
		wrapper = element;
		return () => {
			wrapper = undefined;
		};
	};

	// App calls this when the thread closes by Escape or Close.
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
		<button
			type="button"
			class={['pin', pin.status]}
			data-cd-pin={pin.id}
			aria-label={pin.label}
			aria-haspopup="dialog"
			aria-expanded={pin.id === openId}
			style:left="{pin.x}px"
			style:top="{pin.y}px"
			onclick={() => onOpen(pin.id)}
		>
			{#if pin.status === 'resolved'}
				<span class="glyph" aria-hidden="true">✓</span>
			{/if}
			{#if pin.badge !== undefined}
				<span class={['badge', pin.badge]} aria-hidden="true">{BADGE_GLYPHS[pin.badge]}</span>
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
	.pin {
		position: absolute;
		box-sizing: border-box;
		width: 20px;
		height: 20px;
		margin: 0;
		padding: 0;
		transform: translate(-50%, -50%);
		border: 2px solid var(--vscode-button-background);
		border-radius: 50%;
		pointer-events: auto;
		cursor: pointer;
		font: inherit;
		z-index: 1;
	}
	.open {
		background: var(--vscode-button-background);
	}
	.sent {
		background: transparent;
	}
	.resolved {
		z-index: 0;
		opacity: 0.6;
		border-color: var(--vscode-disabledForeground);
		background: var(--vscode-disabledForeground);
	}
	.pin:focus-visible {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: 1px;
	}
	.glyph {
		display: block;
		font-size: 12px;
		line-height: 16px;
		text-align: center;
		color: var(--vscode-editor-background);
	}
	/* A filled disc with a ring: the badge sits on arbitrary artboard content, where a bare colored
	   glyph disappears. */
	.badge {
		position: absolute;
		top: -7px;
		right: -7px;
		box-sizing: border-box;
		width: 14px;
		height: 14px;
		border: 1px solid var(--vscode-editor-background);
		border-radius: 50%;
		color: var(--vscode-editor-background);
		font-size: 10px;
		font-weight: bold;
		line-height: 12px;
		text-align: center;
	}
	.stale {
		background: var(--vscode-editorWarning-foreground);
	}
	.missing {
		background: var(--vscode-editorError-foreground);
	}
	.unchecked {
		background: var(--vscode-descriptionForeground);
	}
</style>
