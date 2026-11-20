<script lang="ts">
	import type { ChromePick } from './commentPick';
	import { liveRegionText } from './commentsPanel';
	import { pickAnnouncementText } from './editInspector';
	import type { FrameMode } from './frame/frameMessages';
	import { zoomChoices } from './zoomChoices';
	import Badge from './ui/Badge.svelte';
	import Button from './ui/Button.svelte';
	import Icon from './ui/Icon.svelte';
	import IconButton from './ui/IconButton.svelte';

	type Props = {
		artboardId: string;
		generation: string;
		handoffStale: boolean;
		zoom: number;
		disabled: boolean;
		mode: FrameMode;
		pick: Pick<ChromePick, 'tagName' | 'isPage' | 'sequence' | 'edit'> | undefined;
		commentsPanelOpen: boolean;
		unresolvedCount: number;
		onPreset: (zoom: number) => void;
		onFit: () => void;
		onChooseMode: (pressed: FrameMode) => void;
		onToggleCommentsPanel: () => void;
	};

	let {
		artboardId,
		generation,
		handoffStale,
		zoom,
		disabled,
		mode,
		pick,
		commentsPanelOpen,
		unresolvedCount,
		onPreset,
		onFit,
		onChooseMode,
		onToggleCommentsPanel,
	}: Props = $props();

	// liveRegionText, so two picks of the same tag in a row both speak.
	const pickAnnouncement = $derived.by(() => {
		const text = pickAnnouncementText({ mode, pick });
		return text === '' || pick === undefined ? '' : liveRegionText({ text, sequence: pick.sequence });
	});

	const zoomChoice = $derived(zoomChoices(zoom));

	const choosePreset = (event: Event & { currentTarget: HTMLSelectElement }): void => {
		onPreset(Number(event.currentTarget.value));
	};

</script>

<header class="bar">
	<span class="artboard">
		<Icon name="artboard" />
		{#if artboardId === ''}
			No artboard
		{:else}
			<span class="artboard-id">{artboardId}</span>
		{/if}
		{#if generation !== ''}
			<span class="generation">gen {generation}</span>
		{/if}
	</span>
	<!-- A live region must exist before its content, so it stays mounted and toggles hidden. -->
	<span aria-live="polite" hidden={!handoffStale}>
		{#if handoffStale}
			<Badge
				tone="warning"
				icon="warning"
				label="Handoff out of date"
				description="Re-export the handoff to update it."
			/>
		{/if}
	</span>
	<span class="divider"></span>
	<!-- Toggle buttons, not radios: Edit and Comment toggle back to Interact (pressedMode), and
	     Comment keeps its C shortcut. -->
	<div class="mode" role="group" aria-label="Mode">
		<Button
			variant="segment"
			icon="cursor"
			aria-pressed={mode === 'interact'}
			{disabled}
			onclick={() => onChooseMode('interact')}>Interact</Button
		>
		<Button
			variant="segment"
			icon="edit"
			aria-pressed={mode === 'edit'}
			{disabled}
			onclick={() => onChooseMode('edit')}>Edit</Button
		>
		<Button
			variant="segment"
			icon="comment"
			aria-pressed={mode === 'comment'}
			aria-keyshortcuts="c"
			title="Comment (C)"
			{disabled}
			onclick={() => onChooseMode('comment')}>Comment</Button
		>
	</div>
	<!-- Muted with the mode buttons it is the shortcut for. -->
	<kbd class={{ muted: disabled }} aria-hidden="true">C</kbd>
	<span class="visually-hidden" aria-live="polite">{pickAnnouncement}</span>
	<span class="zoom">
		<select aria-label="Zoom" {disabled} onchange={choosePreset}>
			{#each zoomChoice.options as option (option.value)}
				<option value={option.value} selected={option.value === zoomChoice.selected}
					>{option.label}</option
				>
			{/each}
		</select>
		<span class="chevron"><Icon name="chevron-down" size={14} /></span>
	</span>
	<IconButton icon="fit" label="Fit all" {disabled} onclick={onFit} />
	<span class="divider"></span>
	<!-- Never disabled: the panel lists comments whether or not a frame is drawn. -->
	<IconButton
		icon="comments"
		label={unresolvedCount > 0 ? `Comments, ${unresolvedCount} unresolved` : 'Comments'}
		count={unresolvedCount}
		aria-expanded={commentsPanelOpen}
		aria-controls="cd-comments-panel"
		onclick={onToggleCommentsPanel}
	/>
</header>

<style>
	.bar {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--cd-space-4) var(--cd-space-8);
		box-sizing: border-box;
		min-height: var(--cd-toolbar-h);
		padding: var(--cd-space-4) var(--cd-space-8) var(--cd-space-4) var(--cd-space-12);
		border-bottom: 1px solid var(--cd-divider);
		background: var(--cd-bg-chrome);
	}
	.artboard {
		display: inline-flex;
		align-items: center;
		gap: var(--cd-space-6);
		min-width: 0;
		color: var(--cd-fg-2);
	}
	.artboard-id {
		overflow: hidden;
		color: var(--cd-fg);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.generation {
		font-size: var(--cd-fs-sm);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.divider {
		flex: none;
		width: 1px;
		height: 16px;
		margin: 0 var(--cd-space-4);
		background: var(--cd-divider);
	}
	.muted {
		color: var(--cd-fg-disabled);
	}
	.mode {
		display: inline-flex;
		gap: var(--cd-space-2);
		padding: var(--cd-space-2);
		border-radius: var(--cd-radius-md);
		background: var(--cd-bg-hover);
	}
	.zoom {
		position: relative;
		display: inline-flex;
		align-items: center;
		margin-left: auto;
	}
	/* The global select look, with room for the chevron drawn over it. */
	.zoom select {
		appearance: none;
		height: var(--cd-icon-btn);
		padding: 0 var(--cd-space-24) 0 var(--cd-space-8);
		font-size: var(--cd-fs-sm);
		font-variant-numeric: tabular-nums;
	}
	.chevron {
		position: absolute;
		right: var(--cd-space-4);
		display: flex;
		color: var(--cd-fg-2);
		pointer-events: none;
	}
</style>
