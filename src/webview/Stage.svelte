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

	import Frame from './Frame.svelte';
	import type { FrameLabelBox, GroupHeadingBox } from './stageGeometry';

	type Props = {
		frames: StageFrame[];
		labels: Array<FrameLabelBox & { text: string }>;
		headings: GroupHeadingBox[];
		activeId: string;
		nonce: string;
		runtimeSource: string;
		transform: string | undefined;
		hidden: boolean;
		onWheel: (wheel: StageWheel) => void;
		onDragPan: (deltaX: number, deltaY: number) => void;
		onViewportSize: (width: number, height: number) => void;
		onIframe: (id: string, iframe: HTMLIFrameElement | undefined) => void;
		onRenderError: (id: string) => void;
	};

	let {
		frames,
		labels,
		headings,
		activeId,
		nonce,
		runtimeSource,
		transform,
		hidden,
		onWheel,
		onDragPan,
		onViewportSize,
		onIframe,
		onRenderError,
	}: Props = $props();

	let dragging = $state(false);
	let lastPointerX = 0;
	let lastPointerY = 0;

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
	class={['viewport', { dragging }]}
	role="presentation"
	{hidden}
	{@attach attachWheel}
	{@attach attachResize}
	onpointerdown={startDrag}
	onpointermove={moveDrag}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onlostpointercapture={endDrag}
>
	<div class="layer" style:transform>
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
		{#each labels as label (label.id)}
			<div
				class="label"
				data-cd-frame-label={label.id}
				style:left="{label.x}px"
				style:top="{label.y}px"
				style:width="{label.width}px"
				style:height="{label.height}px"
			>
				{label.text}
			</div>
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
	.viewport {
		flex: 1 1 auto;
		position: relative;
		overflow: hidden;
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
</style>
