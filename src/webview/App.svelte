<script lang="ts">
	import Banners from './Banners.svelte';
	import CommentPopover from './CommentPopover.svelte';
	import {
		applyPickMessage,
		clearPick,
		type CommentPickState,
		type CommentPickStep,
		INITIAL_COMMENT_PICK,
		keepLiveFrames,
		type ModeKeyAction,
		modeKeyAction,
		type ModeKeyInput,
		type PickStepType,
		toggleCommentMode,
	} from './commentPick';
	import {
		answerDraft,
		type CommentDraft,
		draftFromPick,
		keepLiveDraft,
		popoverAnchor,
		submitDraft,
	} from './commentPopover';
	import type { ChromeFrameMessage, FrameMessage, FramePickMessage } from './frame/frameMessages';
	import runtimeSource from './frame/runtime.ts?iife';
	import {
		connectHostBridge,
		postCommentCreate,
		postFramePlace,
		postToFrame,
		readSavedStageView,
		saveStageView,
	} from './hostBridge.svelte';
	import type {
		CanvasUpdatedMessage,
		FramePlacement,
		HostMessage,
		PostedComment,
	} from './hostMessages';
	import {
		type FrameGesture,
		type StageFrameGesture,
		failFrameGesture,
		SCROLL_SINK_CENTER,
		SCROLL_SINK_ROOM,
		scrollSinkStep,
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
	// comments.json as the host last read it (8f2 draws pins from it); its own banner on failure.
	let comments: PostedComment[] = $state([]);
	let commentsError: string | undefined = $state();
	// The open comment popover's target and request state; the rules live in commentPopover.ts.
	let draft: CommentDraft | undefined = $state();
	let popover: ReturnType<typeof CommentPopover> | undefined = $state();
	// The popover places itself inside the viewport.
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);

	// Not reactive: the iframe registry is matched against event.source at message time, and
	// the view is read by handlers when they run.
	const iframes = new Map<string, HTMLIFrameElement>();
	const savedView = readSavedStageView();
	let stageView: StageView = savedView ?? { x: 0, y: 0, zoom: 1 };
	let initialViewApplied = false;

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
	// The popover follows pan, zoom and a drag of its frame, like the outlines.
	const draftAnchor = $derived.by(() => {
		const draftFrame = displayFrames.find((frame) => frame.id === draft?.frameId);
		return draft === undefined || draftFrame === undefined || committedView === undefined
			? undefined
			: popoverAnchor({ view: committedView, frame: draftFrame, target: draft.target });
	});
	const canStep = $derived(draft !== undefined && picking.pick?.frameId === draft.frameId);
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
		keepLiveCommentState();
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
		if (message.type === 'comments:updated') {
			comments = message.comments;
			commentsError = message.error;
			return;
		}
		if (message.type === 'comment:added' || message.type === 'ui:error') {
			handleCommentAnswer(message);
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

	// Frames that left the stage or became tiles take their hover, pick and draft with them; an
	// empty stage leaves Comment mode.
	const keepLiveCommentState = (): void => {
		const liveFrameIds = liveIframeIds(frames);
		picking = keepLiveFrames({ state: picking, liveFrameIds });
		draft = keepLiveDraft({ draft, commentMode: picking.commentMode, liveFrameIds });
	};

	// Entering or leaving the mode discards any draft, pending or not; a late answer is ignored.
	const handleToggleComment = (): void => {
		draft = undefined;
		applyPickStep(toggleCommentMode({ state: picking, frameIds: iframes.keys() }));
	};

	const popoverHasFocus = (): boolean =>
		document.activeElement?.closest('[data-cd-comment-popover]') != null;

	// Typed text goes with the draft. The frame forgets its pick too, and gets focus back when
	// asked, so ↑/↓ and a second Escape reach its runtime.
	const closeDraft = (focusFrame: boolean): void => {
		const frameId = draft?.frameId;
		draft = undefined;
		applyPickStep(clearPick(picking));
		if (focusFrame && frameId !== undefined) {
			iframes.get(frameId)?.focus();
		}
	};

	// Cancel, popover Escape, or a chrome Escape after focus left the popover. Never while a
	// create is pending, so a Cancel never hides a comment that is being written.
	const handleCancel = (): void => {
		if (draft !== undefined && draft.pendingRequestId === undefined) {
			closeDraft(true);
		}
	};

	const handleAdd = (body: string): void => {
		if (draft === undefined) {
			return;
		}
		// randomUUID: unique across webview reloads, so a previous webview's answer never matches.
		const submitted = submitDraft({ draft, body, requestId: crypto.randomUUID() });
		if (submitted !== undefined) {
			draft = submitted.draft;
			postCommentCreate(submitted.message);
		}
	};

	const handleCommentAnswer = (answer: Parameters<typeof answerDraft>[1]): void => {
		if (draft === undefined) {
			return;
		}
		const next = answerDraft(draft, answer);
		if (next === undefined) {
			closeDraft(popoverHasFocus());
		} else {
			draft = next;
		}
	};

	// A cd:pick in Comment mode opens or retargets the draft (re-posts only move it). Focus goes to
	// the textarea on open, or on a retarget whose click moved focus into the frame, after the
	// frame's own window.focus() settled. A re-post never moves focus.
	const applyPickToDraft = (frame: FrameRecord, pick: FramePickMessage): void => {
		const opened = draft === undefined;
		draft = draftFromPick({ draft, frameId: frame.id, pick, generation: frame.generation });
		if (pick.repost || (!opened && document.activeElement?.tagName !== 'IFRAME')) {
			return;
		}
		requestAnimationFrame(() => {
			popover?.focusBody();
		});
	};

	const stepPick = (type: PickStepType): void => {
		if (picking.pick !== undefined) {
			sendToFrame(picking.pick.frameId, { type });
		}
	};

	const isTextEntry = (target: EventTarget | null): boolean =>
		target instanceof HTMLElement &&
		(target.isContentEditable || target.matches('input, textarea, select'));

	// C toggles Comment mode; Escape leaves it (toggling off is leaving it) or cancels the draft.
	const applyModeKey = (action: ModeKeyAction | undefined): void => {
		if (action === 'toggle' || action === 'exit') {
			handleToggleComment();
		} else if (action === 'cancel') {
			handleCancel();
		}
	};

	// The chrome's own keydown and a frame's cd:key share one rule, with the live state.
	const modeKey = (
		key: Omit<ModeKeyInput, 'commentMode' | 'hasFrames' | 'popoverOpen'>,
	): ModeKeyAction | undefined =>
		modeKeyAction({
			...key,
			commentMode: picking.commentMode,
			hasFrames: liveIframeIds(frames).size > 0,
			popoverOpen: draft !== undefined,
		});

	const handleWindowKeydown = (event: KeyboardEvent): void => {
		// A key with chrome focus ends any frame gesture, so the root scroll it causes (PageDown,
		// Space, arrows) never pans through the scroll sink.
		lastSinkGestureAt = Number.NEGATIVE_INFINITY;
		applyModeKey(
			modeKey({
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				repeat: event.repeat,
				defaultPrevented: event.defaultPrevented,
				inTextEntry: isTextEntry(event.target),
				forwarded: false,
			}),
		);
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
			if (message.type === 'cd:pick' && picking.commentMode) {
				applyPickToDraft(frame, message);
			}
			applyPickStep(applyPickMessage({ state: picking, frameId, message }));
			return;
		}
		if (message.type === 'cd:frame-height') {
			updateFrame(frameId, (record) => applyFrameHeight({ record, reported: message.height }));
			commitStageView(stageView);
			return;
		}
		if (message.type === 'cd:key') {
			// The runtime already dropped modified, repeated, composing and text-entry keys.
			applyModeKey(
				modeKey({
					key: message.key,
					ctrlKey: false,
					metaKey: false,
					altKey: false,
					repeat: false,
					defaultPrevented: false,
					inTextEntry: false,
					forwarded: true,
				}),
			);
			return;
		}
		// The gesture may leave this frame and continue as root scroll (handleSinkScroll).
		lastSinkGestureAt = performance.now();
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

	// Scroll sink (frameGesture.ts): where the last scroll back landed, and when the last frame
	// wheel or sink pan happened.
	let sinkRestX = 0;
	let sinkRestY = 0;
	let lastSinkGestureAt = Number.NEGATIVE_INFINITY;

	const recentreScrollSink = (): void => {
		window.scrollTo(SCROLL_SINK_CENTER, SCROLL_SINK_CENTER);
		sinkRestX = window.scrollX;
		sinkRestY = window.scrollY;
	};

	const handleSinkScroll = (): void => {
		const now = performance.now();
		const step = scrollSinkStep({
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			restX: sinkRestX,
			restY: sinkRestY,
			now,
			lastGestureAt: lastSinkGestureAt,
		});
		if (step.recentre) {
			recentreScrollSink();
		}
		if (step.pan !== undefined) {
			lastSinkGestureAt = now;
			handleDragPan(step.pan.deltaX, step.pan.deltaY);
		}
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
		keepLiveCommentState();
	};

	// The body's hidden scroll room comes from the one constant (CSSOM, allowed by the nonce CSP).
	document.body.style.width = `calc(100% + ${SCROLL_SINK_ROOM}px)`;
	document.body.style.height = `calc(100% + ${SCROLL_SINK_ROOM}px)`;
	recentreScrollSink();

	connectHostBridge({
		iframes,
		onHostMessage: handleHostMessage,
		onFrameMessage: handleFrameMessage,
	});
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onscroll={handleSinkScroll}
	onresize={recentreScrollSink}
/>

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
/>
<Banners {errorMessage} {commentsError} {mcpUnavailable} />
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
>
	{#if draft !== undefined && draftAnchor !== undefined}
		<CommentPopover
			bind:this={popover}
			{draft}
			anchor={draftAnchor}
			{viewportWidth}
			{viewportHeight}
			{canStep}
			onAdd={handleAdd}
			onCancel={handleCancel}
			onParent={() => stepPick('cd:pick-parent')}
			onChild={() => stepPick('cd:pick-child')}
		/>
	{/if}
</Stage>

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
	/* The root is the stage's scroll sink (frameGesture.ts): App sizes the body with
	   SCROLL_SINK_ROOM of hidden scroll room, while the fixed chrome never moves when it scrolls. */
	:global(html) {
		scrollbar-width: none;
		overscroll-behavior: none;
	}
	:global(#svelte-root) {
		position: fixed;
		inset: 0;
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
