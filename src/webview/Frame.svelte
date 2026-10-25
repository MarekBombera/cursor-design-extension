<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { stampArtboardHtml } from './stampArtboardHtml';

	type Props = {
		id: string;
		label: string;
		x: number;
		y: number;
		width: number;
		height: number;
		kind: 'tile' | 'iframe';
		tileText: string;
		html: string;
		nonce: string;
		runtimeSource: string;
		active: boolean;
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
		tileText,
		html,
		nonce,
		runtimeSource,
		active,
		onIframe,
		onRenderError,
	}: Props = $props();

	// Stage passes props from its {#each} item, a new record object on every height report, drag
	// preview and canvas:updated. A direct prop read below would subscribe to that whole record,
	// and every re-run sets a new blob URL: the document reloads, its runtime reports its height
	// again, and the frame reload-loops. These deriveds only notify when the value changes.
	const frameId = $derived(id);
	const frameHtml = $derived(html);

	// Registers before src is set, so the first cd:frame-height is never dropped. The nested
	// effect reads only html and nonce (kind is the {#if} around it): label, position, width
	// or active changes never reload the document.
	const attachIframe: Attachment<HTMLIFrameElement> = (iframe) => {
		onIframe(frameId, iframe);
		$effect(() => {
			let blobUrl: string;
			try {
				const document = stampArtboardHtml({ html: frameHtml, nonce, runtimeSource });
				blobUrl = URL.createObjectURL(new Blob([document], { type: 'text/html' }));
			} catch {
				// ponytail: stamp/blob throw is per-frame tile copy only; no chrome log
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
	class={['frame', active && 'active']}
	data-cd-frame-id={id}
	style:left="{x}px"
	style:top="{y}px"
	style:width="{width}px"
	style:height="{height}px"
>
	{#if kind === 'tile'}
		<div class="tile">{tileText}</div>
	{:else}
		<iframe
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
		pointer-events: none;
	}
	.frame > iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		background: var(--vscode-editor-background);
		pointer-events: auto;
	}
	.active {
		outline: 2px solid var(--vscode-focusBorder);
	}
	.tile {
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		color: var(--vscode-errorForeground);
		border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
		overflow-wrap: anywhere;
	}
</style>
