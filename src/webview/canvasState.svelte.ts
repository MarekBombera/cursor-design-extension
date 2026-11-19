import {
	adoptEditAnswer,
	applyFrameHeight,
	demoteToTile,
	type FrameRecord,
	frameSizeText,
	liveIframeIds,
	mergeCanvasFrames,
	reloadFrame,
	toChromeFrames,
	withGestureOverride,
} from './canvasFrames';
import type { ChromeFrameMessage, FrameMessage } from './frame/frameMessages';
import {
	failFrameGesture,
	type FrameGesture,
	SCROLL_SINK_CENTER,
	SCROLL_SINK_ROOM,
	scrollSinkStep,
	settleFrameGesture,
	type StageFrameGesture,
	stepFrameGesture,
	type StageWheel,
	wheelToView,
} from './frameGesture';
import {
	postFramePlace,
	postToFrame,
	readSavedStageView,
	saveStageView,
} from './hostBridge.svelte';
import type {
	ArtboardEditedMessage,
	CanvasUpdatedMessage,
	FramePlacement,
	PostedComment,
} from './hostMessages';
import {
	clampStageView,
	fitStageView,
	layoutCanvasChrome,
	panStage,
	stageToScreen,
	type StageView,
	zoomStageTo,
} from './stageGeometry';

// The artboard on the stage: the frames as the host last posted them, the pan / zoom view, a frame
// move or resize in progress, the iframe registry and the root scroll sink. The rules live in
// canvasFrames.ts, frameGesture.ts and stageGeometry.ts.
export class CanvasState {
	// First-seen order; never reordered (moving an iframe in the DOM reloads it).
	frames: FrameRecord[] = $state([]);
	artboardId = $state('');
	generation = $state('');
	nonce = $state('');
	errorMessage: string | undefined = $state();
	mcpUnavailable = $state(false);
	handoffStale = $state(false);
	committedView: StageView | undefined = $state();
	gesture: FrameGesture | undefined = $state();
	// A canvas:updated arrived (resolveHeldThread).
	framesKnown = $state(false);
	// The popover places itself inside the viewport.
	viewportWidth = $state(0);
	viewportHeight = $state(0);

	// Not reactive: the iframe registry is matched against event.source at message time, and
	// the view is read by handlers when they run.
	readonly iframes = new Map<string, HTMLIFrameElement>();
	readonly #savedView = readSavedStageView();
	#stageView: StageView = this.#savedView ?? { x: 0, y: 0, zoom: 1 };
	#initialViewApplied = false;
	// Scroll sink (frameGesture.ts): where the last scroll back landed, and when the last frame
	// wheel or sink pan happened.
	#sinkRestX = 0;
	#sinkRestY = 0;
	#lastSinkGestureAt = Number.NEGATIVE_INFINITY;

	readonly displayFrames = $derived(
		withGestureOverride({ frames: this.frames, gesture: this.gesture }),
	);
	readonly layout = $derived(layoutCanvasChrome({ frames: toChromeFrames(this.displayFrames) }));
	readonly labels = $derived(
		this.layout.labels.map((box) => {
			const frame = this.displayFrames.find((candidate) => candidate.id === box.id);
			return {
				...box,
				text: frame?.label ?? '',
				size: frame === undefined ? '' : frameSizeText(frame),
			};
		}),
	);
	readonly transform = $derived(
		this.committedView === undefined
			? undefined
			: `translate(${this.committedView.x}px, ${this.committedView.y}px) scale(${this.committedView.zoom})`,
	);

	// The drawn frame a comment can jump to: only a live iframe, never a tile or an absent frame.
	jumpFrame = (comment: PostedComment): FrameRecord | undefined =>
		liveIframeIds(this.frames).has(comment.frameId)
			? this.displayFrames.find((frame) => frame.id === comment.frameId)
			: undefined;

	// The single write path for the view: clamp, transform the layer, readout, save.
	commitStageView = (nextView: StageView): void => {
		const bounds = this.layout.bounds;
		if (bounds === null || this.viewportWidth === 0 || this.viewportHeight === 0) {
			return;
		}
		this.#stageView = clampStageView({
			view: nextView,
			bounds,
			viewportWidth: this.viewportWidth,
			viewportHeight: this.viewportHeight,
		});
		this.committedView = this.#stageView;
		saveStageView(this.#stageView);
	};

	// Runs once per webview load: the saved view, or a fit on first open. Later edits and
	// artboard switches keep whatever view the user has.
	#applyInitialView = (): void => {
		if (this.#initialViewApplied) {
			return;
		}
		if (this.layout.bounds === null || this.viewportWidth === 0 || this.viewportHeight === 0) {
			return;
		}
		this.commitStageView(
			this.#savedView === undefined
				? fitStageView({
						bounds: this.layout.bounds,
						viewportWidth: this.viewportWidth,
						viewportHeight: this.viewportHeight,
					})
				: this.#stageView,
		);
		this.#initialViewApplied = true;
	};

	applyCanvasUpdated = (message: CanvasUpdatedMessage): void => {
		this.artboardId = message.activeArtboardId;
		this.nonce = message.cspNonce;
		// A deleted artboard file (or an entry that failed validation) leaves the stage; its
		// Frame unmounts and revokes its blob URL.
		this.frames = mergeCanvasFrames({ records: this.frames, frames: message.frames });
		// From the merged record, so a skipped stale pre-write post cannot move the label back.
		const active = this.frames.find((frame) => frame.id === message.activeArtboardId);
		this.generation =
			message.activeArtboardId === '' ? '' : String(active?.generation ?? message.generation);
		this.framesKnown = true;
		this.gesture = settleFrameGesture({
			gesture: this.gesture,
			diskPlacement: this.#diskPlacement,
		});
		this.errorMessage = undefined;
		if (this.frames.length === 0) {
			return;
		}
		this.#applyInitialView();
		this.commitStageView(this.#stageView);
	};

	applyArtboardError = (message: string): void => {
		this.errorMessage = message;
		// The host posts this after the answering canvas:updated of a failed frame:place,
		// which is how a failure that leaves disk equal to base drops the preview.
		this.gesture = failFrameGesture(this.gesture);
	};

	// Every chrome → frame send goes to a registered iframe (the `iframes` map).
	sendToFrame = (frameId: string, message: ChromeFrameMessage): void => {
		const iframe = this.iframes.get(frameId);
		if (iframe !== undefined) {
			postToFrame(iframe, message);
		}
	};

	handleStageWheel = (wheel: StageWheel): void => {
		this.commitStageView(wheelToView({ view: this.#stageView, wheel }));
	};

	// Frame records are replaced, never mutated: the pure rules return new objects.
	#updateFrame = (id: string, update: (record: FrameRecord) => FrameRecord): void => {
		this.frames = this.frames.map((record) => (record.id === id ? update(record) : record));
	};

	handleFrameHeight = (frameId: string, height: number): void => {
		this.#updateFrame(frameId, (record) => applyFrameHeight({ record, reported: height }));
		this.commitStageView(this.#stageView);
	};

	handleFrameWheel = (
		frame: FrameRecord,
		message: Extract<FrameMessage, { type: 'cd:frame-wheel' }>,
	): void => {
		// The gesture may leave this frame and continue as root scroll (handleSinkScroll).
		this.#lastSinkGestureAt = performance.now();
		// The frame reports frame-local coordinates; the wheel anchor is the viewport point under it.
		const anchor = stageToScreen({
			view: this.#stageView,
			stageX: frame.x + message.x,
			stageY: frame.y + message.y,
		});
		this.handleStageWheel({
			deltaX: message.deltaX,
			deltaY: message.deltaY,
			zoom: message.ctrlKey,
			screenX: anchor.x,
			screenY: anchor.y,
		});
	};

	handleDragPan = (deltaX: number, deltaY: number): void => {
		this.commitStageView(panStage({ view: this.#stageView, deltaX, deltaY }));
	};

	recentreScrollSink = (): void => {
		window.scrollTo(SCROLL_SINK_CENTER, SCROLL_SINK_CENTER);
		this.#sinkRestX = window.scrollX;
		this.#sinkRestY = window.scrollY;
	};

	handleSinkScroll = (): void => {
		const now = performance.now();
		const step = scrollSinkStep({
			scrollX: window.scrollX,
			scrollY: window.scrollY,
			restX: this.#sinkRestX,
			restY: this.#sinkRestY,
			now,
			lastGestureAt: this.#lastSinkGestureAt,
		});
		if (step.recentre) {
			this.recentreScrollSink();
		}
		if (step.pan !== undefined) {
			this.#lastSinkGestureAt = now;
			this.handleDragPan(step.pan.deltaX, step.pan.deltaY);
		}
	};

	// A key with chrome focus ends any frame gesture, so the root scroll it causes (PageDown,
	// Space, arrows) never pans through the scroll sink.
	endSinkGesture = (): void => {
		this.#lastSinkGestureAt = Number.NEGATIVE_INFINITY;
	};

	// The body's hidden scroll room comes from the one constant (CSSOM, allowed by the nonce CSP).
	installScrollSink = (): void => {
		document.body.style.width = `calc(100% + ${SCROLL_SINK_ROOM}px)`;
		document.body.style.height = `calc(100% + ${SCROLL_SINK_ROOM}px)`;
		this.recentreScrollSink();
	};

	#diskPlacement = (id: string): FramePlacement | undefined => {
		const frame = this.frames.find((candidate) => candidate.id === id);
		return frame === undefined ? undefined : { x: frame.x, y: frame.y, width: frame.width };
	};

	handleFrameGesture = (event: StageFrameGesture): void => {
		const step = stepFrameGesture({
			gesture: this.gesture,
			event,
			diskPlacement: this.#diskPlacement,
			view: this.#stageView,
		});
		this.gesture = step.gesture;
		if (step.commit !== undefined) {
			postFramePlace(step.commit);
		}
	};

	handleViewportSize = (width: number, height: number): void => {
		this.viewportWidth = width;
		this.viewportHeight = height;
		if (width === 0 || height === 0) {
			return;
		}
		this.#applyInitialView();
		this.commitStageView(this.#stageView);
	};

	handlePreset = (zoom: number): void => {
		this.commitStageView(
			zoomStageTo({
				view: this.#stageView,
				zoom,
				screenX: this.viewportWidth / 2,
				screenY: this.viewportHeight / 2,
			}),
		);
	};

	handleFit = (): void => {
		this.commitStageView(
			fitStageView({
				bounds: this.layout.bounds,
				viewportWidth: this.viewportWidth,
				viewportHeight: this.viewportHeight,
			}),
		);
	};

	handleIframe = (id: string, iframe: HTMLIFrameElement | undefined): void => {
		if (iframe === undefined) {
			this.iframes.delete(id);
			return;
		}
		this.iframes.set(id, iframe);
	};

	handleRenderError = (id: string): void => {
		this.#updateFrame(id, demoteToTile);
	};

	// 9e: the host's answer to the user's own edit, based on `baseHash`; no reload.
	adoptEditAnswer = (answer: ArtboardEditedMessage, baseHash: string): void => {
		this.#updateFrame(answer.frameId, (record) => adoptEditAnswer({ record, answer, baseHash }));
		const active = this.frames.find((frame) => frame.id === this.artboardId);
		if (answer.frameId === this.artboardId && active !== undefined) {
			this.generation = String(active.generation);
		}
	};

	// 9e: a refused edit drops its preview by rebuilding the iframe from the latest adopted copy.
	reloadFrame = (id: string): void => {
		this.#updateFrame(id, reloadFrame);
	};
}
