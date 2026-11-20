<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import type { StageFrame } from './canvasFrames';
	import { stampArtboardHtml } from './stampArtboardHtml';
	import Icon from './ui/Icon.svelte';

	type Props = {
		id: string;
		label: string;
		x: number;
		y: number;
		width: number;
		height: number;
		kind: StageFrame['kind'];
		tileKind: StageFrame['tileKind'];
		tileText: string;
		// What the iframe is built from; a new version (a forced reload) rebuilds it even when the
		// HTML is the same. The latest adopted copy is not a prop: adopting never reloads.
		documentHtml: string;
		documentVersion: number;
		nonce: string;
		runtimeSource: string;
		lifted: boolean;
		// From Stage: CSS cannot see an out-of-process iframe's focus.
		focused: boolean;
		onIframe: (id: string, iframe: HTMLIFrameElement | undefined) => void;
		onRenderError: (id: string) => void;
	};

	let {
		id,
		label,
		x,
		y,
		width,
		height,
		kind,
		tileKind,
		tileText,
		documentHtml,
		documentVersion,
		nonce,
		runtimeSource,
		lifted,
		focused,
		onIframe,
		onRenderError,
	}: Props = $props();

	// Stage passes props from its {#each} item, a new record object on every height report, drag
	// preview and canvas:updated. A direct prop read below would subscribe to that whole record, and
	// every re-run sets a new blob URL: the document reloads, reports its height again, and the frame
	// reload-loops. These deriveds only notify when the value changes.
	const frameId = $derived(id);
	const frameHtml = $derived(documentHtml);
	const frameVersion = $derived(documentVersion);
	const emptyTile = $derived(tileKind === 'empty');

	// Registers before src is set, so the first cd:frame-height is never dropped. The nested effect
	// reads only the document html, its version and nonce, so nothing else reloads the document.
	const attachIframe: Attachment<HTMLIFrameElement> = (iframe) => {
		onIframe(frameId, iframe);
		$effect(() => {
			let blobUrl: string;
			// Read so a forced reload (same html, new version) re-runs this effect.
			void frameVersion;
			try {
				const document = stampArtboardHtml({ html: frameHtml, nonce, runtimeSource });
				blobUrl = URL.createObjectURL(new Blob([document], { type: 'text/html' }));
			} catch {
				// ponytail: a stamp or blob failure shows only the tile and is never logged. Upgrade:
				// post it to the host's Output channel.
				onRenderError(frameId);
				return;
			}
			iframe.src = blobUrl;
			return () => {
				URL.revokeObjectURL(blobUrl);
			};
		});
		return () => {
			onIframe(frameId, undefined);
		};
	};
</script>

<div
	class={['frame', { lifted, 'has-tile': kind === 'tile' }]}
	data-cd-frame-id={id}
	style:left="{x}px"
	style:top="{y}px"
	style:width="{width}px"
	style:height="{height}px"
>
	{#if kind === 'tile'}
		<div class={['tile', { error: !emptyTile }]}>
			<span class="tile-icon"><Icon name={emptyTile ? 'page' : 'error'} size={24} /></span>
			<b class="tile-title">{emptyTile ? 'Empty artboard' : "Couldn't render this frame"}</b>
			<span>{tileText}</span>
		</div>
	{:else}
		<iframe
			class={{ focused }}
			sandbox="allow-scripts"
			scrolling="no"
			title="Frame: {label}"
			{@attach attachIframe}
		></iframe>
	{/if}
</div>

<style>
	.frame {
		position: absolute;
		overflow: hidden;
		box-shadow: var(--cd-shadow-frame);
		pointer-events: none;
	}
	.lifted {
		z-index: 1;
		box-shadow: var(--cd-shadow-lifted);
	}
	/* The tile draws its own edge. */
	.has-tile {
		box-shadow: none;
	}
	.frame > iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		/* An artboard that sets no background renders like a browser page (light Canvas, dark
		   text), not on the editor colour; the artboard's own styles still win. */
		color-scheme: light;
		background: Canvas;
		pointer-events: auto;
	}
	/* Drawn inside: the frame clips anything outside its box. The ring follows
	   document.activeElement (Stage's focusedFrameId), so it also shows after a mouse click into
	   the frame; accepted. */
	.frame > iframe.focused {
		outline: calc(2px / var(--cd-stage-zoom)) solid var(--cd-focus);
		outline-offset: calc(-2px / var(--cd-stage-zoom));
	}
	.tile {
		display: grid;
		place-content: center;
		justify-items: center;
		gap: var(--cd-space-8);
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		padding: var(--cd-space-12);
		border: 1px dashed var(--cd-frame-edge);
		border-radius: var(--cd-radius-md);
		background: var(--cd-bg-card);
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		text-align: center;
		overflow-wrap: break-word;
	}
	.tile.error {
		border-style: solid;
		border-color: var(--cd-tile-error-edge);
		color: var(--cd-fg);
	}
	.tile-title {
		color: var(--cd-fg);
		font-size: var(--cd-fs-md);
		font-weight: var(--cd-weight-strong);
	}
	.tile-icon {
		display: flex;
		color: var(--cd-fg-3);
	}
	.error .tile-icon {
		color: var(--cd-error);
	}
</style>
