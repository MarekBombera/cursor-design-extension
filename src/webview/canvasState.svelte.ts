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
import type { ChromeFrameMessage, FrameWheelMessage } from './frame/frameMessages';
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
import { postToFrame, readSavedStageView, saveStageView } from './hostBridge.svelte';
import type {
	ArtboardEditedMessage,
	CanvasUpdatedMessage,
	FramePlacement,
	FramePlaceMessage,
	PagePost,
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

export class CanvasState {
	frames: FrameRecord[] = $state.raw([]);
	artboardId = $state('');
	generation = $state('');
	nonce = $state('');
	errorMessage: string | undefined = $state();
	committedView: StageView | undefined = $state.raw();
	gesture: FrameGesture | undefined = $state.raw();
	// Set by the first canvas:updated, even one with no frames.
	framesKnown = $state(false);
	// $state: the popover and the thread place themselves inside the viewport.
	viewportWidth = $state(0);
	viewportHeight = $state(0);

	// Not $state: read at message or handler time only.
	readonly iframes = new Map<string, HTMLIFrameElement>();
	// The page this state belongs to ('' is "no page"); only the saved stage view is matched to it.
	readonly #pageId: string;
	readonly #post: PagePost<FramePlaceMessage>;
	// The saved view, only when it is this page's: another page's fits all instead.
	readonly #savedView: StageView | undefined;
	#stageView: StageView;
	#initialViewApplied = false;
	// Scroll sink: where the last recentre landed, and the last frame wheel or sink pan.
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

	constructor({ pageId, post }: { pageId: string; post: PagePost<FramePlaceMessage> }) {
		this.#pageId = pageId;
		this.#post = post;
		const saved = readSavedStageView();
		this.#savedView =
			saved?.pageId === pageId ? { x: saved.x, y: saved.y, zoom: saved.zoom } : undefined;
		this.#stageView = this.#savedView ?? { x: 0, y: 0, zoom: 1 };
	}

	jumpFrame = (comment: PostedComment): FrameRecord | undefined =>
		liveIframeIds(this.frames).has(comment.frameId)
			? this.displayFrames.find((frame) => frame.id === comment.frameId)
			: undefined;

	// The view's one write path.
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
		saveStageView({ ...this.#stageView, pageId: this.#pageId });
	};

	// Once per page mount: later edits and artboard switches keep the user's view.
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

	handleFrameWheel = (frame: FrameRecord, message: FrameWheelMessage): void => {
		// The gesture may leave this frame and continue as root scroll (handleSinkScroll).
		this.#lastSinkGestureAt = performance.now();
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

	// A key with chrome focus ends the sink gesture, so the root scroll it causes (PageDown, Space,
	// arrows) never pans the stage.
	endSinkGesture = (): void => {
		this.#lastSinkGestureAt = Number.NEGATIVE_INFINITY;
	};

	// Here, not in theme.css, so SCROLL_SINK_ROOM stays the one constant (CSSOM passes the CSP).
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
			this.#post(step.commit);
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

	// The host's answer to an edit or undo / redo based on `baseHash`; no reload. False when a newer
	// post already won and the record is unchanged.
	adoptEditAnswer = (answer: ArtboardEditedMessage, baseHash: string): boolean => {
		const record = this.frames.find((frame) => frame.id === answer.frameId);
		if (record === undefined) {
			return false;
		}
		const adopted = adoptEditAnswer({ record, answer, baseHash });
		if (adopted === record) {
			return false;
		}
		this.#updateFrame(answer.frameId, () => adopted);
		if (answer.frameId === this.artboardId) {
			this.generation = String(adopted.generation);
		}
		return true;
	};

	// Rebuilds the iframe from the latest adopted copy: drops a refused edit's preview, and shows the
	// file a written undo / redo restored.
	reloadFrame = (id: string): void => {
		this.#updateFrame(id, reloadFrame);
	};
}
