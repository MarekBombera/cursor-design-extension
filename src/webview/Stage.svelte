<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	import { MAX_FRAME_WIDTH, MIN_FRAME_WIDTH } from '../disk/layout';
	import Frame from './Frame.svelte';
	import Overlay from './Overlay.svelte';
	import Icon from './ui/Icon.svelte';
	import type { StageFrame } from './canvasFrames';
	import {
		arrowNudge,
		type FrameGestureKind,
		revealOffset,
		type StageFrameGesture,
		type StageWheel,
	} from './frameGesture';
	import {
		type FrameLabelBox,
		type GroupHeadingBox,
		type StageRect,
	} from './stageGeometry';

	type Props = {
		frames: StageFrame[];
		// `size` is the label's width × height text (frameSizeText; empty on a tile).
		labels: Array<FrameLabelBox & { text: string; size: string }>;
		headings: GroupHeadingBox[];
		activeId: string;
		nonce: string;
		runtimeSource: string;
		transform: string | undefined;
		zoom: number;
		hidden: boolean;
		commentMode: boolean;
		hoverOutline: StageRect | undefined;
		pickOutline: StageRect | undefined;
		flashOutline: StageRect | undefined;
		onWheel: (wheel: StageWheel) => void;
		onDragPan: (deltaX: number, deltaY: number) => void;
		onViewportSize: (width: number, height: number) => void;
		onIframe: (id: string, iframe: HTMLIFrameElement | undefined) => void;
		onRenderError: (id: string) => void;
		onFrameGesture: (gesture: StageFrameGesture) => void;
		// Viewport-local chrome above the frames and outlines (the comment popover).
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
		commentMode,
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

	// The resize handle is a fixed 8 screen px wide, centered on the frame's right edge.
	const HANDLE_SCREEN_WIDTH = 8;

	type GestureTarget = { id: string; kind: FrameGestureKind };

	let dragging = $state(false);
	let lastPointerX = 0;
	let lastPointerY = 0;
	// Read by pointer handlers only, so not reactive.
	let viewportElement: HTMLDivElement | undefined;
	// The label or handle holding pointer capture. Cleared before any 'end' or 'cancel' is
	// reported, so a lostpointercapture that follows pointerup reports nothing. Like Figma, only
	// Escape reverts: a release outside the panel (no pointerup, capture lost) or a browser
	// pointercancel commits the last preview.
	let captured: (GestureTarget & { pointerId: number; element: Element }) | undefined =
		$state();
	// The artboard iframe holding focus. An out-of-process frame's iframe element (Cursor's blob
	// frames are) never matches :focus or :focus-visible and gets no focus events; the chrome window
	// blurs with that iframe as its activeElement, and refocuses when focus comes back.
	// ponytail: focus leaving the webview from inside a frame reaches no chrome event, so the ring
	// stays until the chrome is focused again.
	let focusedFrameId: string | undefined = $state();
	// Frame to frame (a click or Tab from one iframe into another) fires no chrome event at all.
	const FRAME_FOCUS_POLL_MS = 200;

	const trackFrameFocus = (): void => {
		const active = document.activeElement;
		focusedFrameId =
			active instanceof HTMLIFrameElement
				? (active.closest('[data-cd-frame-id]')?.getAttribute('data-cd-frame-id') ?? undefined)
				: undefined;
	};

	// While a frame holds focus the chrome window stays blurred, so re-read activeElement until focus
	// comes back to the chrome (trackFrameFocus clears the id) or the stage unmounts.
	// ponytail: a 200ms poll, so the ring can trail a frame-to-frame move by one tick, and it keeps
	// polling while focus sits in a frame and the user is in another app. Upgrade path: a cd:focus
	// message from the frame runtime.
	$effect(() => {
		if (focusedFrameId === undefined) {
			return;
		}
		const timer = setInterval(trackFrameFocus, FRAME_FOCUS_POLL_MS);
		return () => {
			clearInterval(timer);
		};
	});

	// Arrow keys held on the focused label or handle; blur clears them.
	const heldArrows = new Set<string>();

	const viewportPoint = (event: PointerEvent): { screenX: number; screenY: number } => {
		const rect = viewportElement?.getBoundingClientRect();
		return {
			screenX: event.clientX - (rect?.left ?? 0),
			screenY: event.clientY - (rect?.top ?? 0),
		};
	};

	const isCaptured = (event: PointerEvent, target: GestureTarget): boolean =>
		captured !== undefined &&
		captured.id === target.id &&
		captured.kind === target.kind &&
		captured.pointerId === event.pointerId;

	const startFrameGesture = (
		event: PointerEvent & { currentTarget: Element },
		target: GestureTarget,
	): void => {
		if (event.button !== 0 || captured !== undefined) {
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		captured = { ...target, pointerId: event.pointerId, element: event.currentTarget };
		onFrameGesture({ ...target, source: 'pointer', phase: 'start', ...viewportPoint(event) });
	};

	const moveFrameGesture = (event: PointerEvent, target: GestureTarget): void => {
		if (!isCaptured(event, target)) {
			return;
		}
		onFrameGesture({ ...target, source: 'pointer', phase: 'move', ...viewportPoint(event) });
	};

	const endFrameGesture = (event: PointerEvent, target: GestureTarget): void => {
		if (!isCaptured(event, target)) {
			return;
		}
		captured = undefined;
		onFrameGesture({ ...target, source: 'pointer', phase: 'end', ...viewportPoint(event) });
	};

	// Escape cancels a pointer gesture; the listener exists only while capture is held.
	$effect(() => {
		const current = captured;
		if (current === undefined) {
			return;
		}
		const handleKeydown = (event: KeyboardEvent): void => {
			if (event.key !== 'Escape') {
				return;
			}
			captured = undefined;
			if (current.element.hasPointerCapture(current.pointerId)) {
				current.element.releasePointerCapture(current.pointerId);
			}
			onFrameGesture({
				id: current.id,
				kind: current.kind,
				source: 'pointer',
				phase: 'cancel',
				screenX: 0,
				screenY: 0,
			});
		};
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
		};
	});

	// A label or handle removed mid-gesture (the Agent deleted its frame) never runs its own
	// lostpointercapture handler, so its teardown drops the capture: otherwise every later drag
	// returns early until Escape. App already dropped its gesture (settleFrameGesture).
	const releaseOnRemove: Attachment<Element> = (element) => () => {
		if (captured?.element === element) {
			captured = undefined;
		}
	};

	// Focus may land on a label or handle that is off screen (Tab, or a nudge). Pan the stage,
	// not the viewport, until it is visible; a label wider than the viewport aligns its start.
	const revealFocused = (event: FocusEvent & { currentTarget: Element }): void => {
		// Keyboard focus only: a pointerdown also focuses the label or handle, and panning then
		// would jump the camera under a starting drag.
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

	const handleFrameKeydown = (event: KeyboardEvent, target: GestureTarget): void => {
		if (event.key === 'Escape') {
			heldArrows.clear();
			onFrameGesture({ ...target, source: 'keyboard', phase: 'cancel' });
			return;
		}
		const step = arrowNudge({
			key: event.key,
			shiftKey: event.shiftKey,
			hasModifier: event.ctrlKey || event.metaKey || event.altKey,
			kind: target.kind,
		});
		if (step === undefined) {
			return;
		}
		event.preventDefault();
		heldArrows.add(event.key);
		onFrameGesture({
			...target,
			source: 'keyboard',
			phase: 'nudge',
			...step,
			repeat: event.repeat,
		});
	};

	// Commits once no arrow is held, so holding two arrows and releasing one keeps nudging.
	const handleFrameKeyup = (event: KeyboardEvent, target: GestureTarget): void => {
		if (heldArrows.delete(event.key) && heldArrows.size === 0) {
			onFrameGesture({ ...target, source: 'keyboard', phase: 'end' });
		}
	};

	const handleFrameBlur = (target: GestureTarget): void => {
		heldArrows.clear();
		onFrameGesture({ ...target, source: 'keyboard', phase: 'end' });
	};

	// Stage gestures land on the chrome document, not the runtime. Wheel events inside the
	// iframe never bubble here, so the two paths cannot double-zoom. Non-passive, so this is a
	// listener and not an onwheel attribute (Svelte makes those passive). Props are read at
	// event time only, so neither attachment re-subscribes.
	const attachWheel: Attachment<HTMLDivElement> = (element) => {
		const handleWheel = (event: WheelEvent): void => {
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			onWheel({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				zoom: event.ctrlKey || event.metaKey,
				screenX: event.clientX - rect.left,
				screenY: event.clientY - rect.top,
			});
		};
		element.addEventListener('wheel', handleWheel, { passive: false });
		return () => {
			element.removeEventListener('wheel', handleWheel);
		};
	};

	// Where focus goes when the chrome closes something focus was in (the comment thread), so it
	// never falls to body. tabindex -1: focusable by script only, never a Tab stop.
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

	const startDrag = (event: PointerEvent & { currentTarget: HTMLDivElement }): void => {
		if (event.button !== 0) {
			return;
		}
		// Empty stage only: the viewport itself or its one child, the layer.
		const onEmptyStage =
			event.target === event.currentTarget ||
			(event.target instanceof Element && event.target.parentElement === event.currentTarget);
		if (!onEmptyStage) {
			return;
		}
		// Labels and handles move or resize their frame; they never pan.
		if (
			event.target instanceof Element &&
			event.target.closest('[data-cd-frame-label], [data-cd-frame-resize]') !== null
		) {
			return;
		}
		dragging = true;
		event.currentTarget.setPointerCapture(event.pointerId);
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
	};

	const moveDrag = (event: PointerEvent): void => {
		if (!dragging) {
			return;
		}
		onDragPan(lastPointerX - event.clientX, lastPointerY - event.clientY);
		lastPointerX = event.clientX;
		lastPointerY = event.clientY;
	};

	const endDrag = (): void => {
		dragging = false;
	};
</script>

<svelte:window onblur={trackFrameFocus} onfocus={trackFrameFocus} />

<div
	class={[
		'viewport',
		{
			dragging,
			'frame-gesture-move': captured?.kind === 'move',
			'frame-gesture-resize': captured?.kind === 'resize',
		},
	]}
	role="presentation"
	tabindex="-1"
	{hidden}
	{@attach attachViewport}
	{@attach attachWheel}
	{@attach attachResize}
	onpointerdown={startDrag}
	onpointermove={moveDrag}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onlostpointercapture={endDrag}
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
				html={frame.html}
				{nonce}
				{runtimeSource}
				lifted={captured?.id === frame.id}
				focused={focusedFrameId === frame.id}
				{onIframe}
				{onRenderError}
			/>
		{/each}
		<!-- After the frames so handles paint above the iframes (no frame sets a z-index). -->
		{#each frames as frame (frame.id)}
			{@const target = { id: frame.id, kind: 'resize' as const }}
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
				{@attach releaseOnRemove}
				style:left="{frame.x + frame.width - HANDLE_SCREEN_WIDTH / zoom / 2}px"
				style:top="{frame.y}px"
				style:width="{HANDLE_SCREEN_WIDTH / zoom}px"
				style:height="{frame.height}px"
				onpointerdown={(event) => startFrameGesture(event, target)}
				onpointermove={(event) => moveFrameGesture(event, target)}
				onpointerup={(event) => endFrameGesture(event, target)}
				onpointercancel={(event) => endFrameGesture(event, target)}
				onlostpointercapture={(event) => endFrameGesture(event, target)}
				onkeydown={(event) => handleFrameKeydown(event, target)}
				onkeyup={(event) => handleFrameKeyup(event, target)}
				onfocus={revealFocused}
				onblur={() => handleFrameBlur(target)}
			></div>
		{/each}
		{#each labels as label (label.id)}
			{@const target = { id: label.id, kind: 'move' as const }}
			<button
				type="button"
				class={['label', { active: label.id === activeId }]}
				data-cd-frame-label={label.id}
				{@attach releaseOnRemove}
				aria-label="Move frame {label.text}"
				style:left="{label.x}px"
				style:top="{label.y}px"
				style:width="{label.width}px"
				style:height="{label.height}px"
				onpointerdown={(event) => startFrameGesture(event, target)}
				onpointermove={(event) => moveFrameGesture(event, target)}
				onpointerup={(event) => endFrameGesture(event, target)}
				onpointercancel={(event) => endFrameGesture(event, target)}
				onlostpointercapture={(event) => endFrameGesture(event, target)}
				onkeydown={(event) => handleFrameKeydown(event, target)}
				onkeyup={(event) => handleFrameKeyup(event, target)}
				onfocus={revealFocused}
				onblur={() => handleFrameBlur(target)}
			>
				<span class="label-chip">
					<!-- The frame icon turns into a gripper on hover: the label is a drag handle. -->
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
	<!-- The toolbar's live region already announces the mode; this is the visible reminder. -->
	{#if commentMode}
		<div class="mode-hint" aria-hidden="true">
			<span class="hint-icon"><Icon name="comment" size={14} /></span>
			Click an element to comment <span class="separator">·</span> <kbd>Esc</kbd> to leave
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
	/* Focused by script only (focusViewport), as a fallback; it is not a control. */
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
	/* The button keeps the whole band above its frame as the drag target; the chip inside hugs the
	   text, so the hover fill matches what the label shows. */
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
	/* The bar shows on hover and focus; the handle stays a fixed 4 × 36 screen px at any zoom. */
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
	/* The layer is scaled, so divide by zoom to keep the ring 2 screen px at any zoom. */
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
	/* Only the icon takes the mode colour. */
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
