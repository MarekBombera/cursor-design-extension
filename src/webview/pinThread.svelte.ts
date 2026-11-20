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

// A restore takes focus only when nothing has it, so it never steals focus from typing.
export const canTakeFocus = (): boolean =>
	document.hasFocus() &&
	(document.activeElement === null || document.activeElement === document.body);

const threadHasFocus = (): boolean =>
	document.activeElement?.closest('[data-cd-comment-thread]') != null;

// Pins, the open thread, and what shares their anchor answers: panel items and the jump + flash.
export class PinThread {
	readonly #canvas: CanvasState;
	readonly #comments: CommentsState;
	// Each live frame's last cd:anchor-rects.
	anchors: AnchorState = $state.raw(new Map());
	openThreadId: string | undefined = $state();
	// False only for a restored thread that found focus elsewhere (canTakeFocus).
	threadFocusOnOpen = $state(true);
	// A thread restored after a reload, kept apart so the live rules never see it. It waits for its
	// pin.
	heldThreadId: string | undefined;
	pinsView: { focusPin: (id: string) => void } | undefined = $state();
	stage: { focusViewport: () => void } | undefined = $state();
	flash: { commentId: string; sequence: number } | undefined = $state.raw();

	// The drawn frames, like the outlines. Pins and panel items number from the full list, so a pin,
	// its card and its thread share one number.
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

		// Closes the open thread whenever its pin is no longer placed, whatever moved it. Pre: it runs
		// before the thread leaves the DOM, so focus inside it moves to the stage viewport, not body.
		$effect.pre(() => {
			if (keepOpenThread({ openThreadId: this.openThreadId, pins: this.pins }) === undefined) {
				this.closeThreadImplicitly();
			}
		});

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

		// Each jump restarts the flash timer.
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
