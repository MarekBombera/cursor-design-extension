<script lang="ts" module>
	export type StageFrame = {
		id: string;
		label: string;
		x: number;
		y: number;
		width: number;
		height: number;
		kind: 'tile' | 'iframe';
		tileText: string;
		html: string;
	};

	export type StageWheel = {
		deltaX: number;
		deltaY: number;
		zoom: boolean;
		screenX: number;
		screenY: number;
	};
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	import { MAX_FRAME_WIDTH, MIN_FRAME_WIDTH } from '../disk/layout';
	import Frame from './Frame.svelte';
	import type { FrameGestureKind, StageFrameGesture } from './frameGesture';
	import {
		type FrameLabelBox,
		type GroupHeadingBox,
		NUDGE_STEP,
		NUDGE_STEP_LARGE,
	} from './stageGeometry';

	type Props = {
		frames: StageFrame[];
		labels: Array<FrameLabelBox & { text: string }>;
		headings: GroupHeadingBox[];
		activeId: string;
		nonce: string;
		runtimeSource: string;
		transform: string | undefined;
		zoom: number;
		hidden: boolean;
		onWheel: (wheel: StageWheel) => void;
		onDragPan: (deltaX: number, deltaY: number) => void;
		onViewportSize: (width: number, height: number) => void;
		onIframe: (id: string, iframe: HTMLIFrameElement | undefined) => void;
		onRenderError: (id: string) => void;
		onFrameGesture: (gesture: StageFrameGesture) => void;
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
		onWheel,
		onDragPan,
		onViewportSize,
		onIframe,
		onRenderError,
		onFrameGesture,
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

	// Focus may land on a label or handle that is off screen (Tab, or a nudge). Pan the stage,
	// not the viewport, until it is visible; a label wider than the viewport aligns its start.
	const REVEAL_MARGIN = 24;
	const revealOffset = ({
		start,
		end,
		viewStart,
		viewEnd,
	}: {
		start: number;
		end: number;
		viewStart: number;
		viewEnd: number;
	}): number => {
		if (start < viewStart + REVEAL_MARGIN || end - start > viewEnd - viewStart - 2 * REVEAL_MARGIN) {
			return start - (viewStart + REVEAL_MARGIN);
		}
		return Math.max(0, end - (viewEnd - REVEAL_MARGIN));
	};

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

	const arrowStep = (
		event: KeyboardEvent,
		kind: FrameGestureKind,
	): { stepX: number; stepY: number } | undefined => {
		const size = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
		if (event.key === 'ArrowLeft') {
			return { stepX: -size, stepY: 0 };
		}
		if (event.key === 'ArrowRight') {
			return { stepX: size, stepY: 0 };
		}
		if (kind === 'resize') {
			return undefined;
		}
		if (event.key === 'ArrowUp') {
			return { stepX: 0, stepY: -size };
		}
		if (event.key === 'ArrowDown') {
			return { stepX: 0, stepY: size };
		}
		return undefined;
	};

	const handleFrameKeydown = (event: KeyboardEvent, target: GestureTarget): void => {
		if (event.key === 'Escape') {
			heldArrows.clear();
			onFrameGesture({ ...target, source: 'keyboard', phase: 'cancel' });
			return;
		}
		const step = arrowStep(event, target.kind);
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
	<div class="layer" style:transform style:--stage-zoom={zoom}>
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
				tileText={frame.tileText}
				html={frame.html}
				{nonce}
				{runtimeSource}
				active={frame.id === activeId}
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
				class="label"
				data-cd-frame-label={label.id}
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
				{label.text}
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
				{heading.group}
			</div>
		{/each}
	</div>
</div>

<style>
	/* clip, not hidden: focusing a label must never scroll the viewport under the stage math. */
	.viewport {
		flex: 1 1 auto;
		position: relative;
		overflow: clip;
		background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
		min-height: 0;
		touch-action: none;
		cursor: grab;
	}
	.viewport[hidden] {
		display: none;
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
		text-overflow: ellipsis;
		box-sizing: border-box;
	}
	.label {
		display: block;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		pointer-events: auto;
		cursor: move;
	}
	.resize-handle {
		position: absolute;
		box-sizing: border-box;
		pointer-events: auto;
		cursor: ew-resize;
	}
	/* The layer is scaled, so divide by zoom to keep the ring 2 screen px at any zoom. */
	.label:focus-visible,
	.resize-handle:focus-visible {
		outline: calc(2px / var(--stage-zoom, 1)) solid var(--vscode-focusBorder);
		outline-offset: 0;
	}
	/* Backs up pointer capture: sandboxed iframes must not swallow a drag that crosses them. */
	.frame-gesture-move :global(iframe),
	.frame-gesture-resize :global(iframe) {
		pointer-events: none;
	}
	.frame-gesture-move {
		cursor: move;
	}
	.frame-gesture-resize {
		cursor: ew-resize;
	}
</style>
