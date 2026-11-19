import { frameOutline, liveIframeIds } from './canvasFrames';
import type { CanvasState } from './canvasState.svelte';
import { panelItems } from './commentsPanel';
import type { CommentsState } from './commentsState.svelte';
import type { AnchorRect } from './frame/frameMessages';
import {
	anchorSends,
	applyAnchorRects,
	type AnchorState,
	dropFrameAnchors,
	JUMP_FLASH_MS,
	jumpTarget,
	keepOpenThread,
	layoutPins,
	liveAnchor,
	resolveHeldThread,
} from './pins';
import { fitZoom, jumpStageView } from './stageGeometry';

// A restored item takes focus only when nothing else has it, so it never steals focus from
// something the user is already typing in.
export const canTakeFocus = (): boolean =>
	document.hasFocus() &&
	(document.activeElement === null || document.activeElement === document.body);

const threadHasFocus = (): boolean =>
	document.activeElement?.closest('[data-cd-comment-thread]') != null;

// The comments on the stage: each live frame's anchor answers, the pins and panel items drawn
// from them, the read-only thread a pin opens (and the one held across a reload), and the jump to
// a comment's target with its flash. The rules live in pins.ts.
export class PinThread {
	readonly #canvas: CanvasState;
	readonly #comments: CommentsState;
	// Where each live frame last said its comments' targets are (cd:anchor-rects); rules in pins.ts.
	anchors: AnchorState = $state.raw(new Map());
	// The comment whose read-only thread is open; it closes when its pin is no longer placed.
	openThreadId: string | undefined = $state();
	// False only for a restored thread that found focus elsewhere (canTakeFocus).
	threadFocusOnOpen = $state(true);
	// The held restore (resolveHeldThread), apart from the live state so the live rules never see
	// it. It waits for its pin.
	heldThreadId: string | undefined;
	pinsView: { focusPin: (id: string) => void } | undefined = $state();
	stage: { focusViewport: () => void } | undefined = $state();
	// The comment whose target flashes after a jump; cleared after JUMP_FLASH_MS.
	flash: { commentId: string; sequence: number } | undefined = $state.raw();

	// $derived.by where a derived reads a field the constructor sets: TypeScript allows that read
	// only inside a function (TS2729). Both forms compile to the same lazy derived.

	// Pins follow the same drawn frames and committed view as the outlines. Both number the comments
	// from the full list, so a pin, its card and its thread share one number.
	readonly pins = $derived.by(() =>
		layoutPins({
			comments: this.#comments.comments,
			anchors: this.anchors,
			frames: this.#canvas.displayFrames,
			view: this.#canvas.committedView,
		}),
	);
	// Read only while the panel is open (its content renders only then). The committed frames, not
	// the drawn ones: a drag changes only x / y / width, so the list does not rebuild on each move.
	readonly commentItems = $derived.by(() =>
		panelItems({
			comments: this.#comments.comments,
			anchors: this.anchors,
			frames: this.#canvas.frames,
		}),
	);
	// The flash follows pan, zoom, a drag preview and the frame's latest cd:anchor-rects.
	readonly flashOutline = $derived.by(() => {
		const comment = this.#comments.comments.find((entry) => entry.id === this.flash?.commentId);
		const frame = comment === undefined ? undefined : this.#canvas.jumpFrame(comment);
		if (comment === undefined || frame === undefined) {
			return undefined;
		}
		const { outline } = jumpTarget({
			comment,
			live: liveAnchor({ anchors: this.anchors, comment }),
			frame,
		});
		return frameOutline({
			view: this.#canvas.committedView,
			frames: this.#canvas.displayFrames,
			target: { frameId: frame.id, rect: outline ?? null },
		});
	});
	readonly openPin = $derived(this.pins.find((pin) => pin.id === this.openThreadId));
	readonly openComment = $derived.by(() =>
		this.#comments.comments.find((entry) => entry.id === this.openThreadId),
	);

	constructor({
		canvas,
		comments,
		heldThreadId,
	}: {
		canvas: CanvasState;
		comments: CommentsState;
		heldThreadId: string | undefined;
	}) {
		this.#canvas = canvas;
		this.#comments = comments;
		this.heldThreadId = $state(heldThreadId);

		// Closes the open thread whenever its pin is no longer placed, whatever moved it (comments,
		// a frame's answer, its height, a reload, a drag preview or its settle). Pre: it runs before
		// the thread leaves the DOM, so focus inside it still moves to the stage viewport, never body.
		$effect.pre(() => {
			if (keepOpenThread({ openThreadId: this.openThreadId, pins: this.pins }) === undefined) {
				this.closeThreadImplicitly();
			}
		});

		// A held thread opens once its pin is placed, or is dropped once it cannot be.
		$effect.pre(() => {
			if (this.heldThreadId === undefined) {
				return;
			}
			const held = this.heldThreadId;
			const comment = this.#comments.comments.find((entry) => entry.id === held);
			const resolved = resolveHeldThread({
				held,
				pins: this.pins,
				comments: this.#comments.commentsKnown ? this.#comments.comments : undefined,
				liveFrameIds: this.#canvas.framesKnown ? liveIframeIds(this.#canvas.frames) : undefined,
				// Before the first committed view no pin is placed at all, so an answer says nothing yet.
				anchorAnswered:
					this.#canvas.committedView !== undefined &&
					comment !== undefined &&
					liveAnchor({ anchors: this.anchors, comment }) !== undefined,
			});
			if (resolved === 'hold') {
				return;
			}
			this.heldThreadId = undefined;
			if (resolved === 'open') {
				this.threadFocusOnOpen = canTakeFocus();
				this.openThreadId = held;
			}
		});

		// Each jump restarts the flash timer; the cleanup cancels the previous one.
		$effect(() => {
			if (this.flash === undefined) {
				return;
			}
			const timer = setTimeout(() => {
				this.flash = undefined;
			}, JUMP_FLASH_MS);
			return () => {
				clearTimeout(timer);
			};
		});
	}

	// Each frame measures only its own element comments; [] stops its observers.
	sendAnchors = (frameIds: Iterable<string>): void => {
		for (const send of anchorSends({ comments: this.#comments.comments, frameIds })) {
			this.#canvas.sendToFrame(send.frameId, { type: 'cd:anchors', anchors: send.anchors });
		}
	};

	resetFrameAnchors = (frameId: string): void => {
		this.anchors = dropFrameAnchors({ state: this.anchors, frameId });
		this.sendAnchors([frameId]);
	};

	handleAnchorRects = (frameId: string, anchors: readonly AnchorRect[]): void => {
		this.anchors = applyAnchorRects({ state: this.anchors, frameId, anchors });
	};

	keepLiveAnchors = (liveFrameIds: ReadonlySet<string>): void => {
		for (const frameId of this.anchors.keys()) {
			if (!liveFrameIds.has(frameId)) {
				this.anchors = dropFrameAnchors({ state: this.anchors, frameId });
			}
		}
	};

	// Closes the thread without a user asking (its pin is gone, or a draft opened). Focus that was
	// inside it lands on the stage viewport, never on body.
	closeThreadImplicitly = (): void => {
		if (this.openThreadId === undefined) {
			return;
		}
		const hadFocus = threadHasFocus();
		this.openThreadId = undefined;
		if (hadFocus) {
			this.stage?.focusViewport();
		}
	};

	// A pin opens its thread, swaps to it from another, or closes it when it is the open one. A
	// user open ends any restore still held (App drops the held draft too).
	handlePinOpen = (id: string): void => {
		this.heldThreadId = undefined;
		this.threadFocusOnOpen = true;
		this.openThreadId = this.openThreadId === id ? undefined : id;
	};

	// Escape or Close: focus goes back to the pin that opened it.
	handleThreadClose = (): void => {
		const id = this.openThreadId;
		this.openThreadId = undefined;
		if (id !== undefined) {
			this.pinsView?.focusPin(id);
		}
	};

	// The target chip: center the target (zooming out only when it would not fit), then flash it.
	handleJump = (id: string): void => {
		const comment = this.#comments.comments.find((entry) => entry.id === id);
		const frame = comment === undefined ? undefined : this.#canvas.jumpFrame(comment);
		const canvas = this.#canvas;
		if (
			comment === undefined ||
			frame === undefined ||
			canvas.committedView === undefined ||
			canvas.viewportWidth === 0 ||
			canvas.viewportHeight === 0
		) {
			return;
		}
		const target = jumpTarget({
			comment,
			live: liveAnchor({ anchors: this.anchors, comment }),
			frame,
		});
		canvas.commitStageView(
			jumpStageView({
				view: canvas.committedView,
				center: { x: frame.x + target.center.x, y: frame.y + target.center.y },
				fitZoom:
					target.fit === undefined
						? undefined
						: fitZoom({
								...target.fit,
								viewportWidth: canvas.viewportWidth,
								viewportHeight: canvas.viewportHeight,
							}),
				viewportWidth: canvas.viewportWidth,
				viewportHeight: canvas.viewportHeight,
			}),
		);
		this.flash = { commentId: id, sequence: (this.flash?.sequence ?? 0) + 1 };
	};
}
