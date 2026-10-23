<script lang="ts">
	import Banners from './Banners.svelte';
	import {
		applyPickMessage,
		arrowPickStep,
		type CommentPickState,
		type CommentPickStep,
		INITIAL_COMMENT_PICK,
		keepLiveFrames,
		type PickStepType,
		toggleCommentMode,
	} from './commentPick';
	import type { ChromeFrameMessage, FrameMessage, FrameRect } from './frame/frameMessages';
	import runtimeSource from './frame/runtime.ts?iife';
	import {
		connectHostBridge,
		postFramePlace,
		postToFrame,
		readSavedStageView,
		saveStageView,
	} from './hostBridge.svelte';
	import type { CanvasUpdatedMessage, FramePlacement, HostMessage } from './hostMessages';
	import {
		type FrameGesture,
		type StageFrameGesture,
		failFrameGesture,
		settleFrameGesture,
		stepFrameGesture,
		type StageWheel,
		wheelToView,
	} from './frameGesture';
	import {
		applyFrameHeight,
		demoteToTile,
		type FrameRecord,
		frameOutline,
		liveIframeIds,
		mergeCanvasFrames,
		toChromeFrames,
		withGestureOverride,
	} from './canvasFrames';
	import Stage from './Stage.svelte';
	import {
		clampStageView,
		fitStageView,
		layoutCanvasChrome,
		panStage,
		stageToScreen,
		type StageView,
		zoomStageTo,
	} from './stageGeometry';
	import Toolbar from './Toolbar.svelte';

	// First-seen order; never reordered (moving an iframe in the DOM reloads it).
	let frames: FrameRecord[] = $state([]);
	let artboardId = $state('');
	let generation = $state('');
	let nonce = $state('');
	let errorMessage: string | undefined = $state();
	let mcpUnavailable = $state(false);
	let handoffStale = $state(false);
	let committedView: StageView | undefined = $state();
	let gesture: FrameGesture | undefined = $state();
	// Comment mode, hover and pick; the rules live in commentPick.ts.
	let picking: CommentPickState = $state(INITIAL_COMMENT_PICK);

	// Not reactive: the iframe registry is matched against event.source at message time, and
	// the view / viewport size are read by handlers when they run.
	const iframes = new Map<string, HTMLIFrameElement>();
	const savedView = readSavedStageView();
	let stageView: StageView = savedView ?? { x: 0, y: 0, zoom: 1 };
	let initialViewApplied = false;
	let viewportWidth = 0;
	let viewportHeight = 0;

	const displayFrames = $derived(withGestureOverride({ frames, gesture }));
	const layout = $derived(layoutCanvasChrome({ frames: toChromeFrames(displayFrames) }));
	const labels = $derived(
		layout.labels.map((box) => ({
			...box,
			text: displayFrames.find((frame) => frame.id === box.id)?.label ?? '',
		})),
	);
	const transform = $derived(
		committedView === undefined
			? undefined
			: `translate(${committedView.x}px, ${committedView.y}px) scale(${committedView.zoom})`,
	);
	// Outlines use the drawn frame position (including a drag preview) and the committed view,
	// the same inputs that place the frame wrapper, so an outline stays glued to its element.
	const hoverOutline = $derived(
		frameOutline({ view: committedView, frames: displayFrames, target: picking.hover }),
	);
	const pickOutline = $derived(
		frameOutline({ view: committedView, frames: displayFrames, target: picking.pick }),
	);
	const zoomText = $derived(
		`${Math.round((committedView === undefined ? 1 : committedView.zoom) * 100)}%`,
	);

	// The single write path for the view: clamp, transform the layer, readout, save.
	const commitStageView = (nextView: StageView): void => {
		const bounds = layout.bounds;
		if (bounds === null || viewportWidth === 0 || viewportHeight === 0) {
			return;
		}
		stageView = clampStageView({ view: nextView, bounds, viewportWidth, viewportHeight });
		committedView = stageView;
		saveStageView(stageView);
	};

	// Runs once per webview load: the saved view, or a fit on first open. Later edits and
	// artboard switches keep whatever view the user has.
	const applyInitialView = (): void => {
		if (initialViewApplied) {
			return;
		}
		if (layout.bounds === null || viewportWidth === 0 || viewportHeight === 0) {
			return;
		}
		commitStageView(
			savedView === undefined
				? fitStageView({ bounds: layout.bounds, viewportWidth, viewportHeight })
				: stageView,
		);
		initialViewApplied = true;
	};

	const applyCanvasUpdated = (message: CanvasUpdatedMessage): void => {
		artboardId = message.activeArtboardId;
		generation = message.activeArtboardId === '' ? '' : String(message.generation);
		nonce = message.cspNonce;
		// A deleted artboard file (or an entry that failed validation) leaves the stage; its
		// Frame unmounts and revokes its blob URL.
		frames = mergeCanvasFrames({ records: frames, frames: message.frames });
		picking = keepLiveFrames({ state: picking, liveFrameIds: liveIframeIds(frames) });
		gesture = settleFrameGesture({ gesture, diskPlacement });
		errorMessage = undefined;
		if (frames.length === 0) {
			return;
		}
		applyInitialView();
		commitStageView(stageView);
	};

	const handleHostMessage = (message: HostMessage): void => {
		if (message.type === 'canvas:updated') {
			applyCanvasUpdated(message);
			return;
		}
		if (message.type === 'artboard:error') {
			errorMessage = message.message;
			// The host posts this after the answering canvas:updated of a failed frame:place,
			// which is how a failure that leaves disk equal to base drops the preview.
			gesture = failFrameGesture(gesture);
			return;
		}
		mcpUnavailable = !message.mcpAvailable;
		handoffStale = message.handoffStale;
	};

	// Every chrome → frame send goes to a registered iframe (the `iframes` map).
	const sendToFrame = (frameId: string, message: ChromeFrameMessage): void => {
		const iframe = iframes.get(frameId);
		if (iframe !== undefined) {
			postToFrame(iframe, message);
		}
	};

	const applyPickStep = (step: CommentPickStep): void => {
		picking = step.state;
		for (const send of step.sends) {
			sendToFrame(send.frameId, send.message);
		}
	};

	const handleToggleComment = (): void => {
		applyPickStep(toggleCommentMode({ state: picking, frameIds: iframes.keys() }));
	};

	const stepPick = (type: PickStepType): void => {
		if (picking.pick !== undefined) {
			sendToFrame(picking.pick.frameId, { type });
		}
	};

	const isTextEntry = (target: EventTarget | null): boolean =>
		target instanceof HTMLElement &&
		(target.isContentEditable || target.matches('input, textarea, select'));

	const handleWindowKeydown = (event: KeyboardEvent): void => {
		const step = arrowPickStep({
			state: picking,
			key: event.key,
			hasModifier: event.ctrlKey || event.metaKey || event.altKey || event.shiftKey,
			defaultPrevented: event.defaultPrevented,
			inTextEntry: isTextEntry(event.target),
		});
		if (step !== undefined) {
			event.preventDefault();
			stepPick(step);
		}
	};

	const handleStageWheel = (wheel: StageWheel): void => {
		commitStageView(wheelToView({ view: stageView, wheel }));
	};

	// Frame records are replaced, never mutated: the pure rules return new objects.
	const updateFrame = (id: string, update: (record: FrameRecord) => FrameRecord): void => {
		frames = frames.map((record) => (record.id === id ? update(record) : record));
	};

	const handleFrameMessage = (frameId: string, message: FrameMessage): void => {
		const frame = frames.find((candidate) => candidate.id === frameId);
		if (frame === undefined) {
			return;
		}
		if (message.type === 'cd:ready' || message.type === 'cd:hover' || message.type === 'cd:pick') {
			applyPickStep(applyPickMessage({ state: picking, frameId, message }));
			return;
		}
		if (message.type === 'cd:frame-height') {
			updateFrame(frameId, (record) => applyFrameHeight({ record, reported: message.height }));
			commitStageView(stageView);
			return;
		}
		// The frame reports frame-local coordinates; the wheel anchor is the viewport point under it.
		const anchor = stageToScreen({
			view: stageView,
			stageX: frame.x + message.x,
			stageY: frame.y + message.y,
		});
		handleStageWheel({
			deltaX: message.deltaX,
			deltaY: message.deltaY,
			zoom: message.ctrlKey,
			screenX: anchor.x,
			screenY: anchor.y,
		});
	};

	const handleDragPan = (deltaX: number, deltaY: number): void => {
		commitStageView(panStage({ view: stageView, deltaX, deltaY }));
	};

	const diskPlacement = (id: string): FramePlacement | undefined => {
		const frame = frames.find((candidate) => candidate.id === id);
		return frame === undefined ? undefined : { x: frame.x, y: frame.y, width: frame.width };
	};

	const handleFrameGesture = (event: StageFrameGesture): void => {
		const step = stepFrameGesture({ gesture, event, diskPlacement, view: stageView });
		gesture = step.gesture;
		if (step.commit !== undefined) {
			postFramePlace(step.commit);
		}
	};

	const handleViewportSize = (width: number, height: number): void => {
		viewportWidth = width;
		viewportHeight = height;
		if (width === 0 || height === 0) {
			return;
		}
		applyInitialView();
		commitStageView(stageView);
	};

	const handlePreset = (zoom: number): void => {
		commitStageView(
			zoomStageTo({
				view: stageView,
				zoom,
				screenX: viewportWidth / 2,
				screenY: viewportHeight / 2,
			}),
		);
	};

	const handleFit = (): void => {
		commitStageView(fitStageView({ bounds: layout.bounds, viewportWidth, viewportHeight }));
	};

	const handleIframe = (id: string, iframe: HTMLIFrameElement | undefined): void => {
		if (iframe === undefined) {
			iframes.delete(id);
			return;
		}
		iframes.set(id, iframe);
	};

	const handleRenderError = (id: string): void => {
		updateFrame(id, demoteToTile);
		picking = keepLiveFrames({ state: picking, liveFrameIds: liveIframeIds(frames) });
	};

	connectHostBridge({
		iframes,
		onHostMessage: handleHostMessage,
		onFrameMessage: handleFrameMessage,
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<Toolbar
	{artboardId}
	{generation}
	{handoffStale}
	{zoomText}
	disabled={frames.length === 0}
	commentMode={picking.commentMode}
	pick={picking.pick}
	onPreset={handlePreset}
	onFit={handleFit}
	onToggleComment={handleToggleComment}
	onPickParent={() => stepPick('cd:pick-parent')}
	onPickChild={() => stepPick('cd:pick-child')}
/>
<Banners {errorMessage} {mcpUnavailable} />
<p class="empty" hidden={frames.length > 0}>No artboard yet.</p>
<Stage
	frames={displayFrames}
	{labels}
	headings={layout.headings}
	activeId={artboardId}
	{nonce}
	{runtimeSource}
	{transform}
	zoom={committedView?.zoom ?? 1}
	hidden={frames.length === 0}
	{hoverOutline}
	{pickOutline}
	onWheel={handleStageWheel}
	onDragPan={handleDragPan}
	onViewportSize={handleViewportSize}
	onIframe={handleIframe}
	onRenderError={handleRenderError}
	onFrameGesture={handleFrameGesture}
/>

<style>
	:global(html),
	:global(body) {
		height: 100%;
		margin: 0;
		background: var(--vscode-editor-background);
		color: var(--vscode-foreground);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}
	:global(#svelte-root) {
		height: 100%;
		display: flex;
		flex-direction: column;
	}
	.empty {
		margin: 0;
		padding: 0.75rem;
	}
	.empty[hidden] {
		display: none;
	}
</style>
