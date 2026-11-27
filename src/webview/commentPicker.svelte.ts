import { type FrameRecord, frameOutline, liveIframeIds } from './canvasFrames';
import type { CanvasState } from './canvasState.svelte';
import {
	applyPickMessage,
	chooseMode,
	clearPick,
	type CommentPickState,
	type CommentPickStep,
	INITIAL_COMMENT_PICK,
	keepLiveFrames,
	type ModeKeyAction,
	modeKeyAction,
	type ModeKeyInput,
	pickCounts,
	type PickStepType,
	pressedMode,
} from './commentPick';
import {
	answerDraft,
	type CommentDraft,
	draftFromPick,
	editDraftBody,
	keepLiveDraft,
	popoverAnchor,
	resolveHeldDraft,
	submitDraft,
} from './commentPopover';
import type {
	FrameHoverMessage,
	FrameMode,
	FramePickMessage,
	FrameReadyMessage,
} from './frame/frameMessages';
import type { CommentCreateMessage, PagePost } from './hostMessages';
import { canTakeFocus, type PinThread } from './pinThread.svelte';

const popoverHasFocus = (): boolean =>
	document.activeElement?.closest('[data-cd-comment-popover]') != null;

const inspectorHasFocus = (): boolean =>
	document.activeElement?.closest('[data-cd-inspector]') != null;

export const isTextEntry = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement &&
	(target.isContentEditable || target.matches('input, textarea, select'));

// Despite the name, also owns Edit mode: the mode, and the hover and pick both picking modes share.
export class CommentPicker {
	readonly #canvas: CanvasState;
	readonly #pinThread: PinThread;
	readonly #post: PagePost<CommentCreateMessage>;
	picking: CommentPickState;
	draft: CommentDraft | undefined = $state();
	popover: { focusBody: (caretAtEnd?: boolean) => void } | undefined = $state();
	// A draft restored after a reload, kept apart so the live rules never see it. It lives only until
	// the start canvas this page applies in its own script (restoreHeldDraft). That relies on App's
	// stagePage mounting a page together with its start canvas: a page mounted without one would keep
	// the hold, and savable would no longer save it.
	#heldDraft: CommentDraft | undefined;
	// A restored draft's popover takes focus once it mounts (the constructor's effect).
	#focusRestoredDraft = false;

	// $derived.by, not $derived: a derived that reads a constructor-set field must be a function
	// (TS2729). Both compile to the same lazy derived.

	// The same inputs that place the frame (drawn position with any drag preview, committed view),
	// so an outline stays glued to its element.
	readonly hoverOutline = $derived.by(() =>
		frameOutline({
			view: this.#canvas.committedView,
			frames: this.#canvas.displayFrames,
			target: this.picking.hover,
		}),
	);
	readonly pickOutline = $derived.by(() =>
		frameOutline({
			view: this.#canvas.committedView,
			frames: this.#canvas.displayFrames,
			target: this.picking.pick,
		}),
	);
	// The popover follows pan, zoom and a drag of its frame, like the outlines.
	readonly draftAnchor = $derived.by(() => {
		const draftFrame = this.#canvas.displayFrames.find((frame) => frame.id === this.draft?.frameId);
		return this.draft === undefined ||
			draftFrame === undefined ||
			this.#canvas.committedView === undefined
			? undefined
			: popoverAnchor({
					view: this.#canvas.committedView,
					frame: draftFrame,
					target: this.draft.target,
				});
	});
	readonly canStep = $derived.by(
		() => this.draft !== undefined && this.picking.pick?.frameId === this.draft.frameId,
	);

	constructor({
		canvas,
		pinThread,
		post,
		mode,
		heldDraft,
	}: {
		canvas: CanvasState;
		pinThread: PinThread;
		post: PagePost<CommentCreateMessage>;
		mode: FrameMode;
		heldDraft: CommentDraft | undefined;
	}) {
		this.#canvas = canvas;
		this.#pinThread = pinThread;
		this.#post = post;
		this.picking = $state({ ...INITIAL_COMMENT_PICK, mode });
		this.#heldDraft = heldDraft;

		// The restored popover mounts only once the stage has committed a view, so its focus waits for
		// the popover itself.
		$effect(() => {
			if (this.popover === undefined || !this.#focusRestoredDraft) {
				return;
			}
			this.#focusRestoredDraft = false;
			if (canTakeFocus()) {
				this.popover.focusBody(true);
			}
		});
	}

	// Saved draft: never a pending one (the host never replays its answer) and never its error.
	get savedDraft(): CommentDraft | undefined {
		const live = this.draft;
		if (live === undefined || live.pendingRequestId !== undefined) {
			return undefined;
		}
		const { error: _error, ...saved } = live;
		return saved;
	}

	#applyPickStep = (step: CommentPickStep): void => {
		this.picking = step.state;
		for (const send of step.sends) {
			this.#canvas.sendToFrame(send.frameId, send.message);
		}
	};

	// The inspector unmounts when Edit mode ends: focus in it moves to the stage viewport first.
	// On an empty stage the viewport is hidden, so focus falls to body (nothing to focus).
	#leaveInspectorFocus = (next: FrameMode): void => {
		if (this.picking.mode === 'edit' && next !== 'edit' && inspectorHasFocus()) {
			this.#pinThread.stage?.focusViewport();
		}
	};

	keepLiveState = (liveFrameIds: ReadonlySet<string>): void => {
		const picking = keepLiveFrames({ state: this.picking, liveFrameIds });
		this.#leaveInspectorFocus(picking.mode);
		this.picking = picking;
		this.draft = keepLiveDraft({
			draft: this.draft,
			commentMode: this.picking.mode === 'comment',
			liveFrameIds,
		});
	};

	// The one path that changes the mode. It discards any draft, pending or not; a late answer is
	// ignored.
	#setMode = (next: FrameMode): void => {
		if (next === this.picking.mode) {
			return;
		}
		this.#leaveInspectorFocus(next);
		this.draft = undefined;
		this.#applyPickStep(chooseMode({ mode: next, frameIds: this.#canvas.iframes.keys() }));
	};

	handleChooseMode = (pressed: FrameMode): void => {
		this.#setMode(pressedMode(this.picking.mode, pressed));
	};

	// Typed text goes with the draft. The frame gets focus back when asked, so ↑/↓ and a second
	// Escape reach its runtime.
	#closeDraft = (focusFrame: boolean): void => {
		const frameId = this.draft?.frameId;
		this.draft = undefined;
		this.#applyPickStep(clearPick(this.picking));
		if (focusFrame && frameId !== undefined) {
			this.#canvas.iframes.get(frameId)?.focus();
		}
	};

	// Cancel, popover Escape, or a chrome Escape after focus left the popover. Never while a
	// create is pending, so a Cancel never hides a comment that is being written.
	handleCancel = (): void => {
		if (this.draft !== undefined && this.draft.pendingRequestId === undefined) {
			this.#closeDraft(true);
		}
	};

	handleDraftInput = (body: string): void => {
		if (this.draft !== undefined) {
			this.draft = editDraftBody(this.draft, body);
		}
	};

	// The first canvas:updated after a reload ends the draft hold: the draft comes back on its live
	// frame or is dropped.
	restoreHeldDraft = (): void => {
		if (this.#heldDraft === undefined) {
			return;
		}
		this.draft = resolveHeldDraft({
			held: this.#heldDraft,
			commentMode: this.picking.mode === 'comment',
			frames: this.#canvas.frames,
		}).draft;
		this.#heldDraft = undefined;
		this.#focusRestoredDraft = this.draft !== undefined;
	};

	handleAdd = (body: string): void => {
		if (this.draft === undefined) {
			return;
		}
		// randomUUID: unique across webview reloads, so a previous webview's answer never matches.
		const submitted = submitDraft({ draft: this.draft, body, requestId: crypto.randomUUID() });
		if (submitted !== undefined) {
			this.draft = submitted.draft;
			this.#post(submitted.message);
		}
	};

	handleCommentAnswer = (answer: Parameters<typeof answerDraft>[1]): void => {
		if (this.draft === undefined) {
			return;
		}
		const next = answerDraft(this.draft, answer);
		if (next === undefined) {
			this.#closeDraft(popoverHasFocus());
		} else {
			this.draft = next;
		}
	};

	// A cd:pick in Comment mode opens or retargets the draft (re-posts only move it). Focus goes to
	// the textarea on open, or on a retarget whose click moved focus into the frame, after the
	// frame's own window.focus() settled. A re-post never moves focus.
	#applyPickToDraft = (frame: FrameRecord, pick: FramePickMessage): void => {
		const opened = this.draft === undefined;
		this.draft = draftFromPick({
			draft: this.draft,
			frameId: frame.id,
			pick,
			generation: frame.generation,
		});
		this.#pinThread.handleDraftPick({
			userPick: !pick.repost,
			draftOpen: this.draft !== undefined,
		});
		if (pick.repost || (!opened && document.activeElement?.tagName !== 'IFRAME')) {
			return;
		}
		requestAnimationFrame(() => {
			this.popover?.focusBody();
		});
	};

	// One verdict (pickCounts) for the pick and the draft: an Edit-mode pick in flight across a
	// switch to Comment mode, or a forged one, opens no draft.
	handlePickMessage = (
		frame: FrameRecord,
		message: FrameReadyMessage | FrameHoverMessage | FramePickMessage,
	): void => {
		if (
			message.type === 'cd:pick' &&
			this.picking.mode === 'comment' &&
			pickCounts({ mode: this.picking.mode, message })
		) {
			this.#applyPickToDraft(frame, message);
		}
		this.#applyPickStep(applyPickMessage({ state: this.picking, frameId: frame.id, message }));
	};

	stepPick = (type: PickStepType): void => {
		if (this.picking.pick !== undefined) {
			this.#canvas.sendToFrame(this.picking.pick.frameId, { type });
		}
	};

	#applyModeKey = (action: ModeKeyAction | undefined): void => {
		if (action === 'toggle') {
			this.handleChooseMode('comment');
		} else if (action === 'exit') {
			this.#setMode('interact');
		} else if (action === 'cancel') {
			this.handleCancel();
		}
	};

	#modeKey = (
		key: Omit<ModeKeyInput, 'mode' | 'hasFrames' | 'popoverOpen'>,
	): ModeKeyAction | undefined =>
		modeKeyAction({
			...key,
			mode: this.picking.mode,
			hasFrames: liveIframeIds(this.#canvas.frames).size > 0,
			popoverOpen: this.draft !== undefined,
		});

	handleKeydown = (event: KeyboardEvent): void => {
		this.#applyModeKey(
			this.#modeKey({
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

	handleFrameKey = (key: string): void => {
		// The runtime already dropped modified, repeated, composing and text-entry keys.
		this.#applyModeKey(
			this.#modeKey({
				key,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				repeat: false,
				defaultPrevented: false,
				inTextEntry: false,
				forwarded: true,
			}),
		);
	};
}
