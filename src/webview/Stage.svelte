<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	import { MAX_FRAME_WIDTH, MIN_FRAME_WIDTH } from '../disk/layout';
	import Frame from './Frame.svelte';
	import Overlay from './Overlay.svelte';
	import { StageGestures } from './stageGestures.svelte';
	import Icon from './ui/Icon.svelte';
	import type { IconName } from './ui/icons';
	import type { StageFrame } from './canvasFrames';
	import type { CanvasState } from './canvasState.svelte';
	import type { FrameMode, FrameRect } from './frame/frameMessages';
	import { revealOffset, type StageFrameGesture, type StageWheel } from './frameGesture';
	import type { GroupHeadingBox } from './stageGeometry';

	type Props = {
		frames: StageFrame[];
		labels: CanvasState['labels'];
		headings: GroupHeadingBox[];
		activeId: string;
		nonce: string;
		runtimeSource: string;
		transform: string | undefined;
		zoom: number;
		hidden: boolean;
		mode: FrameMode;
		hoverOutline: FrameRect | undefined;
		pickOutline: FrameRect | undefined;
		flashOutline: FrameRect | undefined;
		onWheel: (wheel: StageWheel) => void;
		onDragPan: (deltaX: number, deltaY: number) => void;
		onViewportSize: (width: number, height: number) => void;
		onIframe: ComponentProps<typeof Frame>['onIframe'];
		onRenderError: ComponentProps<typeof Frame>['onRenderError'];
		onFrameGesture: (gesture: StageFrameGesture) => void;
		// Viewport-local chrome above the frames and outlines: pins, the thread, the add popover.
		children?: Snippet;
	};

	let {
		frames,
		labels,
		headings,
		activeId,
		nonce,
		runtimeSource,
		transform,
		zoom,
		hidden,
		mode,
		hoverOutline,
		pickOutline,
		flashOutline,
		onWheel,
		onDragPan,
		onViewportSize,
		onIframe,
		onRenderError,
		onFrameGesture,
		children,
	}: Props = $props();

	const MODE_HINTS = {
		comment: { icon: 'comment', verb: 'comment' },
		edit: { icon: 'edit', verb: 'edit' },
	} as const satisfies Record<Exclude<FrameMode, 'interact'>, { icon: IconName; verb: string }>;

	const HANDLE_SCREEN_WIDTH = 8;

	let viewportElement: HTMLDivElement | undefined;
	// An out-of-process iframe (Cursor's blob frames) never matches :focus and gets no focus events;
	// the chrome window blurs with it as activeElement and refocuses when focus returns. Frame to
	// frame fires no chrome event at all, so the effect below polls while a frame holds focus.
	let focusedFrameId: string | undefined = $state();
	const FRAME_FOCUS_POLL_MS = 200;

	const trackFrameFocus = (): void => {
		const active = document.activeElement;
		focusedFrameId =
			active instanceof HTMLIFrameElement
				? (active.closest('[data-cd-frame-id]')?.getAttribute('data-cd-frame-id') ?? undefined)
				: undefined;
	};

	// ponytail: the ring trails a frame-to-frame move by up to one poll, polls while the user is in
	// another app, and stays after focus leaves the webview from a frame. Upgrade: a cd:focus message
	// from the frame runtime.
	$effect(() => {
		if (focusedFrameId === undefined) {
			return;
		}
		const timer = setInterval(trackFrameFocus, FRAME_FOCUS_POLL_MS);
		return () => {
			clearInterval(timer);
		};
	});

	const gestures = new StageGestures({
		viewport: () => viewportElement,
		onFrameGesture: (gesture) => onFrameGesture(gesture),
		onDragPan: (deltaX, deltaY) => onDragPan(deltaX, deltaY),
		onWheel: (wheel) => onWheel(wheel),
	});

	// Keyboard focus on an off-screen label or handle pans the stage, never scrolls the viewport.
	const revealFocused = (event: FocusEvent & { currentTarget: Element }): void => {
		// A pointerdown also focuses it; panning then would jump the camera under a starting drag.
		if (!event.currentTarget.matches(':focus-visible')) {
			return;
		}
		const viewport = viewportElement?.getBoundingClientRect();
		if (viewport === undefined) {
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		const deltaX = revealOffset({
			start: rect.left,
			end: rect.right,
			viewStart: viewport.left,
			viewEnd: viewport.right,
		});
		const deltaY = revealOffset({
			start: rect.top,
			end: rect.bottom,
			viewStart: viewport.top,
			viewEnd: viewport.bottom,
		});
		if (deltaX !== 0 || deltaY !== 0) {
			onDragPan(deltaX, deltaY);
		}
	};

	// Focus fallback when the chrome closes or unmounts what held focus, so it never falls to body.
	export const focusViewport = (): void => {
		viewportElement?.focus({ preventScroll: true });
	};

	const attachViewport: Attachment<HTMLDivElement> = (element) => {
		viewportElement = element;
		return () => {
			viewportElement = undefined;
		};
	};

	// Covers a panel that was not laid out yet, and re-clamps after every resize.
	const attachResize: Attachment<HTMLDivElement> = (element) => {
		const observer = new ResizeObserver(() => {
			onViewportSize(element.clientWidth, element.clientHeight);
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	};
</script>

<svelte:window
	onblur={trackFrameFocus}
	onfocus={trackFrameFocus}
	onkeydown={gestures.handleWindowKeydown}
/>

<div
	class={[
		'viewport',
		{
			dragging: gestures.dragging,
			'frame-gesture-move': gestures.captured?.kind === 'move',
			'frame-gesture-resize': gestures.captured?.kind === 'resize',
		},
	]}
	role="presentation"
	tabindex="-1"
	{hidden}
	{@attach attachViewport}
	{@attach gestures.attachWheel}
	{@attach attachResize}
	onpointerdown={gestures.startDrag}
	onpointermove={gestures.moveDrag}
	onpointerup={gestures.endDrag}
	onpointercancel={gestures.endDrag}
	onlostpointercapture={gestures.endDrag}
>
	<div class="layer" style:transform style:--cd-stage-zoom={zoom}>
		<!-- Frames keep first-seen order and are never moved: moving an iframe reloads it. -->
		{#each frames as frame (frame.id)}
			<Frame
				id={frame.id}
				label={frame.label}
				x={frame.x}
				y={frame.y}
				width={frame.width}
				height={frame.height}
				kind={frame.kind}
				tileKind={frame.tileKind}
				tileText={frame.tileText}
				documentHtml={frame.documentHtml}
				documentVersion={frame.documentVersion}
				{nonce}
				{runtimeSource}
				lifted={gestures.captured?.id === frame.id}
				focused={focusedFrameId === frame.id}
				{onIframe}
				{onRenderError}
			/>
		{/each}
		<!-- After the frames so handles paint above the iframes (no frame sets a z-index). -->
		{#each frames as frame (frame.id)}
			{const target = $derived({ id: frame.id, kind: 'resize' as const })}
			<!-- A focusable separator is the WAI-ARIA window-splitter widget; Svelte classes the role as static. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<div
				class="resize-handle"
				role="separator"
				aria-orientation="vertical"
				tabindex="0"
				aria-label="Resize width of {frame.label}"
				aria-valuenow={frame.width}
				aria-valuemin={MIN_FRAME_WIDTH}
				aria-valuemax={MAX_FRAME_WIDTH}
				data-cd-frame-resize={frame.id}
				{@attach gestures.releaseOnRemove}
				style:left="{frame.x + frame.width - HANDLE_SCREEN_WIDTH / zoom / 2}px"
				style:top="{frame.y}px"
				style:width="{HANDLE_SCREEN_WIDTH / zoom}px"
				style:height="{frame.height}px"
				onpointerdown={(event) => gestures.startFrameGesture(event, target)}
				onpointermove={(event) => gestures.moveFrameGesture(event, target)}
				onpointerup={(event) => gestures.endFrameGesture(event, target)}
				onpointercancel={(event) => gestures.endFrameGesture(event, target)}
				onlostpointercapture={(event) => gestures.endFrameGesture(event, target)}
				onkeydown={(event) => gestures.handleFrameKeydown(event, target)}
				onkeyup={(event) => gestures.handleFrameKeyup(event, target)}
				onfocus={revealFocused}
				onblur={() => gestures.handleFrameBlur(target)}
			></div>
		{/each}
		{#each labels as label (label.id)}
			{const target = $derived({ id: label.id, kind: 'move' as const })}
			<button
				type="button"
				class={['label', { active: label.id === activeId }]}
				data-cd-frame-label={label.id}
				{@attach gestures.releaseOnRemove}
				aria-label="Move frame {label.text}"
				style:left="{label.x}px"
				style:top="{label.y}px"
				style:width="{label.width}px"
				style:height="{label.height}px"
				onpointerdown={(event) => gestures.startFrameGesture(event, target)}
				onpointermove={(event) => gestures.moveFrameGesture(event, target)}
				onpointerup={(event) => gestures.endFrameGesture(event, target)}
				onpointercancel={(event) => gestures.endFrameGesture(event, target)}
				onlostpointercapture={(event) => gestures.endFrameGesture(event, target)}
				onkeydown={(event) => gestures.handleFrameKeydown(event, target)}
				onkeyup={(event) => gestures.handleFrameKeyup(event, target)}
				onfocus={revealFocused}
				onblur={() => gestures.handleFrameBlur(target)}
			>
				<span class="label-chip">
					<span class="label-icon"><Icon name="frame" size={12} /></span>
					<span class="label-grip"><Icon name="gripper" size={12} /></span>
					<span class="label-name">{label.text}</span>
					{#if label.size !== ''}
						<span class="label-size">{label.size}</span>
					{/if}
				</span>
			</button>
		{/each}
		{#each headings as heading (heading.group)}
			<div
				class="heading"
				data-cd-group-heading={heading.group}
				style:left="{heading.x}px"
				style:top="{heading.y}px"
				style:width="{heading.width}px"
				style:height="{heading.height}px"
			>
				<span class="heading-text">{heading.group}</span>
			</div>
		{/each}
	</div>
	<Overlay hover={hoverOutline} pick={pickOutline} flash={flashOutline} />
	<!-- aria-hidden: the toolbar's live region already announces the mode. -->
	{#if mode !== 'interact'}
		{const hint = $derived(MODE_HINTS[mode])}
		<div class="mode-hint" aria-hidden="true">
			<span class="hint-icon"><Icon name={hint.icon} size={14} /></span>
			Click an element to {hint.verb} <span class="separator">·</span> <kbd>Esc</kbd> to leave
		</div>
	{/if}
	{@render children?.()}
</div>

<style>
	/* clip, not hidden: focusing a label must never scroll the viewport under the stage math. */
	.viewport {
		flex: 1 1 auto;
		position: relative;
		overflow: clip;
		background: var(--cd-bg-stage);
		min-height: 0;
		min-width: 0;
		touch-action: none;
		cursor: grab;
	}
	/* Script-only focus target (focusViewport), not a control. */
	.viewport:focus {
		outline: none;
	}
	.dragging {
		cursor: grabbing;
	}
	.layer {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	.label,
	.heading {
		position: absolute;
		pointer-events: none;
		white-space: nowrap;
		overflow: hidden;
		box-sizing: border-box;
	}
	/* The button is the whole band (the drag target); the chip hugs the text for the hover fill. */
	.label {
		display: flex;
		align-items: center;
		color: var(--cd-fg-2);
		font-size: var(--cd-fs-sm);
		text-align: left;
		pointer-events: auto;
		cursor: grab;
	}
	.label-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--cd-space-6);
		box-sizing: border-box;
		max-width: 100%;
		height: var(--cd-control-h-sm);
		padding: 0 var(--cd-space-6);
		border-radius: var(--cd-radius-sm);
		transition: background-color var(--cd-dur) var(--cd-ease);
	}
	.label:hover .label-chip {
		background: var(--cd-bg-hover);
		color: var(--cd-fg);
	}
	.label-icon,
	.label-grip {
		display: flex;
		flex: none;
		color: var(--cd-fg-3);
	}
	.label-grip,
	.label:hover .label-icon {
		display: none;
	}
	.label:hover .label-grip {
		display: flex;
	}
	.label-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.label-size {
		flex: none;
		color: var(--cd-fg-2);
		font-variant-numeric: tabular-nums;
	}
	/* The active artboard reads through its label, not an outline on the frame. */
	.active {
		color: var(--cd-fg);
		font-weight: var(--cd-weight-strong);
	}
	.active .label-icon {
		color: var(--cd-accent);
	}
	.heading {
		display: flex;
		align-items: center;
		color: var(--cd-fg-2);
		font: var(--cd-weight-strong) var(--cd-fs-xs) / var(--cd-lh-sm) var(--cd-font);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.heading-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.resize-handle {
		position: absolute;
		box-sizing: border-box;
		pointer-events: auto;
		cursor: ew-resize;
	}
	/* The bar: 4 × 36 screen px at any zoom, shown on hover and focus. */
	.resize-handle::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: calc(4px / var(--cd-stage-zoom));
		height: calc(36px / var(--cd-stage-zoom));
		border-radius: var(--cd-radius-pill);
		background: var(--cd-fg-3);
		transform: translate(-50%, -50%);
		opacity: 0;
		transition: opacity var(--cd-dur) var(--cd-ease);
	}
	.resize-handle:hover::after,
	.resize-handle:focus-visible::after {
		opacity: 1;
	}
	.label:focus-visible,
	.resize-handle:focus-visible {
		outline: calc(2px / var(--cd-stage-zoom)) solid var(--cd-focus);
		outline-offset: 0;
	}
	.mode-hint {
		position: absolute;
		top: var(--cd-space-12);
		left: 50%;
		display: inline-flex;
		align-items: center;
		gap: var(--cd-space-8);
		padding: var(--cd-space-4) var(--cd-space-8) var(--cd-space-4) var(--cd-space-10);
		border-radius: var(--cd-radius-pill);
		background: var(--cd-bg-widget);
		box-shadow: var(--cd-shadow-widget);
		color: var(--cd-fg);
		font-size: var(--cd-fs-sm);
		white-space: nowrap;
		transform: translateX(-50%);
		pointer-events: none;
	}
	.hint-icon {
		display: flex;
		color: var(--cd-accent);
	}
	.separator {
		color: var(--cd-fg-2);
	}
	/* Backs up pointer capture: sandboxed iframes must not swallow a drag that crosses them. */
	.frame-gesture-move :global(iframe),
	.frame-gesture-resize :global(iframe) {
		pointer-events: none;
	}
	.frame-gesture-move {
		cursor: grabbing;
	}
	.frame-gesture-resize {
		cursor: ew-resize;
	}
</style>
