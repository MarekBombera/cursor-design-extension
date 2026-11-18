<script lang="ts">
	import Banners from './Banners.svelte';
	import CommentPopover from './CommentPopover.svelte';
	import CommentsPanel from './CommentsPanel.svelte';
	import CommentThread from './CommentThread.svelte';
	import Pins from './Pins.svelte';
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
	import {
		answerAction,
		answerCopyOpen,
		closeReply,
		type CommentActions,
		COPY_FEEDBACK_MS,
		type CopiedButton,
		copyPending,
		type CopyOpenState,
		editReply,
		frameLabel,
		keepLiveActions,
		liveRegionText,
		openReply,
		panelItems,
		panelSummary,
		submitCopy,
		submitCopyOpen,
		submitReply,
		submitStatus,
	} from './commentsPanel';
	import type { ChromeFrameMessage, FrameMessage, FramePickMessage } from './frame/frameMessages';
	import runtimeSource from './frame/runtime.ts?iife';
	import {
		connectHostBridge,
		postCommentRequest,
		postFramePlace,
		postToFrame,
		readSavedCommentsPanelOpen,
		readSavedStageView,
		saveCommentsPanelOpen,
		saveStageView,
	} from './hostBridge.svelte';
	import type {
		CanvasUpdatedMessage,
		FramePlacement,
		CommentSavedMessage,
		CopiedMessage,
		HostMessage,
		PostedComment,
		UiErrorMessage,
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
		frameSizeText,
		liveIframeIds,
		mergeCanvasFrames,
		toChromeFrames,
		withGestureOverride,
	} from './canvasFrames';
	import {
		type AnchorState,
		anchorSends,
		applyAnchorRects,
		dropFrameAnchors,
		JUMP_FLASH_MS,
		jumpTarget,
		keepOpenThread,
		layoutPins,
		liveAnchor,
	} from './pins';
	import Stage from './Stage.svelte';
	import {
		clampStageView,
		fitStageView,
		fitZoom,
		jumpStageView,
		layoutCanvasChrome,
		panStage,
		stageToScreen,
		type StageView,
		zoomStageTo,
	} from './stageGeometry';
	import Toolbar from './Toolbar.svelte';
	import EmptyState from './ui/EmptyState.svelte';

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
	// comments.json as the host last read it, pins drawn from it; its own banner on failure.
	let comments: PostedComment[] = $state([]);
	// Where each live frame last said its comments' targets are (cd:anchor-rects); rules in pins.ts.
	let anchors: AnchorState = $state.raw(new Map());
	// The comment whose read-only thread is open; it closes when its pin is no longer placed.
	let openThreadId: string | undefined = $state();
	let pinsView: ReturnType<typeof Pins> | undefined = $state();
	let stage: ReturnType<typeof Stage> | undefined = $state();
	let commentsError: string | undefined = $state();
	// Reply composers and status requests by comment id; the rules live in commentsPanel.ts.
	let actions: CommentActions = $state.raw(new Map());
	// The copy-open button's request state; the rules live in commentsPanel.ts.
	let copyOpen: CopyOpenState = $state({});
	// The Copy button that reads "Copied". The sequence restarts the timer on a repeat; cleared after
	// COPY_FEEDBACK_MS.
	let copyFeedback: (CopiedButton & { sequence: number }) | undefined = $state.raw();
	// The comments live region's text; the sequence makes a repeat speak again (liveRegionText).
	let announcement = $state({ text: '', sequence: 0 });
	// The Comments panel; closed by default, restored from webview state.
	let commentsPanelOpen = $state(readSavedCommentsPanelOpen());
	// Epoch ms for relative times, refreshed every minute.
	let now = $state(Date.now());
	// The open comment popover's target and request state; the rules live in commentPopover.ts.
	let draft: CommentDraft | undefined = $state();
	let popover: ReturnType<typeof CommentPopover> | undefined = $state();
	// The comment whose target flashes after a jump; cleared after JUMP_FLASH_MS.
	let flash: { commentId: string; sequence: number } | undefined = $state.raw();
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
		layout.labels.map((box) => {
			const frame = displayFrames.find((candidate) => candidate.id === box.id);
			return {
				...box,
				text: frame?.label ?? '',
				size: frame === undefined ? '' : frameSizeText(frame),
			};
		}),
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
	// Pins follow the same drawn frames and committed view as the outlines. Both number the comments
	// from the full list, so a pin, its card and its thread share one number.
	const pins = $derived(
		layoutPins({ comments, anchors, frames: displayFrames, view: committedView }),
	);
	// Read only while the panel is open (its content renders only then). The committed frames, not
	// the drawn ones: a drag changes only x / y / width, so the list does not rebuild on each move.
	const commentItems = $derived(panelItems({ comments, anchors, frames }));
	// The drawn frame a comment can jump to: only a live iframe, never a tile or an absent frame.
	const jumpFrame = (comment: PostedComment): FrameRecord | undefined =>
		liveIframeIds(frames).has(comment.frameId)
			? displayFrames.find((frame) => frame.id === comment.frameId)
			: undefined;

	// The flash follows pan, zoom, a drag preview and the frame's latest cd:anchor-rects.
	const flashOutline = $derived.by(() => {
		const comment = comments.find((entry) => entry.id === flash?.commentId);
		const frame = comment === undefined ? undefined : jumpFrame(comment);
		if (comment === undefined || frame === undefined) {
			return undefined;
		}
		const { outline } = jumpTarget({ comment, live: liveAnchor({ anchors, comment }), frame });
		return frameOutline({
			view: committedView,
			frames: displayFrames,
			target: { frameId: frame.id, rect: outline ?? null },
		});
	});
	// One copy at a time across the chrome.
	const copyBlocked = $derived(copyPending({ actions, copyOpen }));
	const summary = $derived(panelSummary(comments));
	const openPin = $derived(pins.find((pin) => pin.id === openThreadId));
	const openComment = $derived(comments.find((entry) => entry.id === openThreadId));
	const canStep = $derived(draft !== undefined && picking.pick?.frameId === draft.frameId);

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
			actions = keepLiveActions({ actions, comments: message.comments, error: message.error });
			sendAnchors(liveIframeIds(frames));
			return;
		}
		if (message.type === 'comment:added') {
			handleCommentAnswer(message);
			return;
		}
		// A ui:error answers a draft, an action or the copy-open request; UUIDs never cross-match.
		if (message.type === 'ui:error') {
			handleCommentAnswer(message);
			handleActionAnswer(message);
			handleCopyOpenAnswer(message);
			return;
		}
		if (message.type === 'comment:saved') {
			handleActionAnswer(message);
			return;
		}
		if (message.type === 'ui:copied') {
			handleActionAnswer(message);
			handleCopyOpenAnswer(message);
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

	// Each frame measures only its own element comments; [] stops its observers.
	const sendAnchors = (frameIds: Iterable<string>): void => {
		for (const send of anchorSends({ comments, frameIds })) {
			sendToFrame(send.frameId, { type: 'cd:anchors', anchors: send.anchors });
		}
	};

	const threadHasFocus = (): boolean =>
		document.activeElement?.closest('[data-cd-comment-thread]') != null;

	// Closes the thread without a user asking (its pin is gone, or a draft opened). Focus that was
	// inside it lands on the stage viewport, never on body.
	const closeThreadImplicitly = (): void => {
		if (openThreadId === undefined) {
			return;
		}
		const hadFocus = threadHasFocus();
		openThreadId = undefined;
		if (hadFocus) {
			stage?.focusViewport();
		}
	};

	// Closes the open thread whenever its pin is no longer placed, whatever moved it (comments,
	// a frame's answer, its height, a reload, a drag preview or its settle). Pre: it runs before the
	// thread leaves the DOM, so focus inside it still moves to the stage viewport, never body.
	$effect.pre(() => {
		if (keepOpenThread({ openThreadId, pins }) === undefined) {
			closeThreadImplicitly();
		}
	});

	// A pin opens its thread, swaps to it from another, or closes it when it is the open one.
	const handlePinOpen = (id: string): void => {
		openThreadId = openThreadId === id ? undefined : id;
	};

	// Escape or Close: focus goes back to the pin that opened it.
	const handleThreadClose = (): void => {
		const id = openThreadId;
		openThreadId = undefined;
		if (id !== undefined) {
			pinsView?.focusPin(id);
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
		for (const frameId of anchors.keys()) {
			if (!liveFrameIds.has(frameId)) {
				anchors = dropFrameAnchors({ state: anchors, frameId });
			}
		}
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
			postCommentRequest(submitted.message);
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

	const announce = (text: string | undefined): void => {
		if (text !== undefined) {
			announcement = { text, sequence: announcement.sequence + 1 };
		}
	};

	const handleReplyOpen = (id: string): void => {
		actions = openReply({ actions, id });
	};

	const handleReplyInput = (id: string, text: string): void => {
		actions = editReply({ actions, id, text });
	};

	const handleReplyCancel = (id: string): void => {
		actions = closeReply({ actions, id });
	};

	const handleReplySubmit = (id: string): void => {
		const submitted = submitReply({ actions, id, requestId: crypto.randomUUID() });
		actions = submitted.actions;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	const handleToggleStatus = (id: string): void => {
		const comment = comments.find((entry) => entry.id === id);
		if (comment === undefined) {
			return;
		}
		const submitted = submitStatus({ actions, comment, requestId: crypto.randomUUID() });
		actions = submitted.actions;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	const handleCopy = (id: string): void => {
		const submitted = submitCopy({ actions, copyOpen, id, requestId: crypto.randomUUID() });
		actions = submitted.actions;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	const handleCopyOpen = (): void => {
		const submitted = submitCopyOpen({
			actions,
			copyOpen,
			openCount: summary.open,
			copiedShowing: copyFeedback?.kind === 'open',
			requestId: crypto.randomUUID(),
		});
		copyOpen = submitted.copyOpen;
		if (submitted.message !== undefined) {
			postCommentRequest(submitted.message);
		}
	};

	// A new success replaces any other button's "Copied" and restarts the timer.
	const showCopied = (button: CopiedButton): void => {
		copyFeedback = { ...button, sequence: (copyFeedback?.sequence ?? 0) + 1 };
	};

	const handleToggleCommentsPanel = (): void => {
		commentsPanelOpen = !commentsPanelOpen;
		saveCommentsPanelOpen(commentsPanelOpen);
	};

	// The target chip: center the target (zooming out only when it would not fit), then flash it.
	const handleJump = (id: string): void => {
		const comment = comments.find((entry) => entry.id === id);
		const frame = comment === undefined ? undefined : jumpFrame(comment);
		if (
			comment === undefined ||
			frame === undefined ||
			committedView === undefined ||
			viewportWidth === 0 ||
			viewportHeight === 0
		) {
			return;
		}
		const target = jumpTarget({ comment, live: liveAnchor({ anchors, comment }), frame });
		commitStageView(
			jumpStageView({
				view: committedView,
				center: { x: frame.x + target.center.x, y: frame.y + target.center.y },
				fitZoom:
					target.fit === undefined
						? undefined
						: fitZoom({ ...target.fit, viewportWidth, viewportHeight }),
				viewportWidth,
				viewportHeight,
			}),
		);
		flash = { commentId: id, sequence: (flash?.sequence ?? 0) + 1 };
	};

	// Each jump restarts the flash timer; the cleanup cancels the previous one.
	$effect(() => {
		if (flash === undefined) {
			return;
		}
		const timer = setTimeout(() => {
			flash = undefined;
		}, JUMP_FLASH_MS);
		return () => {
			clearTimeout(timer);
		};
	});

	// Each copy success restarts the "Copied" timer; the cleanup cancels the previous one.
	$effect(() => {
		if (copyFeedback === undefined) {
			return;
		}
		const timer = setTimeout(() => {
			copyFeedback = undefined;
		}, COPY_FEEDBACK_MS);
		return () => {
			clearTimeout(timer);
		};
	});

	const handleActionAnswer = (
		answer: CommentSavedMessage | CopiedMessage | UiErrorMessage,
	): void => {
		const answered = answerAction({ actions, answer });
		actions = answered.actions;
		if (answered.copiedId !== undefined) {
			showCopied({ kind: 'comment', id: answered.copiedId });
		}
		announce(answered.announcement);
	};

	const handleCopyOpenAnswer = (answer: CopiedMessage | UiErrorMessage): void => {
		const answered = answerCopyOpen({ state: copyOpen, answer });
		copyOpen = answered.state;
		if (answered.copiedCount !== undefined) {
			showCopied({ kind: 'open', count: answered.copiedCount });
		}
		announce(answered.announcement);
	};

	$effect(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, 60_000);
		return () => {
			clearInterval(timer);
		};
	});

	// A cd:pick in Comment mode opens or retargets the draft (re-posts only move it). Focus goes to
	// the textarea on open, or on a retarget whose click moved focus into the frame, after the
	// frame's own window.focus() settled. A re-post never moves focus.
	const applyPickToDraft = (frame: FrameRecord, pick: FramePickMessage): void => {
		const opened = draft === undefined;
		draft = draftFromPick({ draft, frameId: frame.id, pick, generation: frame.generation });
		if (draft !== undefined) {
			closeThreadImplicitly();
		}
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
			// A new document: its old answers are gone, and it measures after the cd:mode above.
			if (message.type === 'cd:ready') {
				anchors = dropFrameAnchors({ state: anchors, frameId });
				sendAnchors([frameId]);
			}
			return;
		}
		if (message.type === 'cd:anchor-rects') {
			// Keyed by the sending frame, in any mode: a forged answer only moves its own pins.
			anchors = applyAnchorRects({ state: anchors, frameId, anchors: message.anchors });
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
	zoom={committedView?.zoom ?? 1}
	disabled={frames.length === 0}
	commentMode={picking.commentMode}
	pick={picking.pick}
	{commentsPanelOpen}
	unresolvedCount={summary.open + summary.sent}
	onPreset={handlePreset}
	onFit={handleFit}
	onToggleComment={handleToggleComment}
	onToggleCommentsPanel={handleToggleCommentsPanel}
/>
<Banners {errorMessage} {commentsError} {mcpUnavailable} />
<!-- The panel comes first (Tab order panel → stage); CSS order draws it on the right. -->
<div class="workspace">
	<CommentsPanel
		open={commentsPanelOpen}
		items={commentItems}
		error={commentsError}
		{now}
		{actions}
		onJump={handleJump}
		onReplyOpen={handleReplyOpen}
		onReplyInput={handleReplyInput}
		onReplyCancel={handleReplyCancel}
		onReplySubmit={handleReplySubmit}
		onToggleStatus={handleToggleStatus}
		{copyBlocked}
		copied={copyFeedback}
		{copyOpen}
		{summary}
		onCopy={handleCopy}
		onCopyOpen={handleCopyOpen}
	/>
	<Stage
		bind:this={stage}
		frames={displayFrames}
		{labels}
		headings={layout.headings}
		activeId={artboardId}
		{nonce}
		{runtimeSource}
		{transform}
		zoom={committedView?.zoom ?? 1}
		hidden={frames.length === 0}
		commentMode={picking.commentMode}
		{hoverOutline}
		{pickOutline}
		{flashOutline}
		onWheel={handleStageWheel}
		onDragPan={handleDragPan}
		onViewportSize={handleViewportSize}
		onIframe={handleIframe}
		onRenderError={handleRenderError}
		onFrameGesture={handleFrameGesture}
	>
		<Pins
			bind:this={pinsView}
			{pins}
			inert={draft !== undefined}
			openId={openThreadId}
			onOpen={handlePinOpen}
		/>
		{#if openPin !== undefined && openComment !== undefined}
			{#key openThreadId}
				<CommentThread
					comment={openComment}
					number={openPin.number}
					frameLabel={frameLabel(frames, openComment.frameId)}
					badge={openPin.badge}
					anchor={openPin}
					{viewportWidth}
					{viewportHeight}
					{now}
					action={actions.get(openComment.id)}
					onClose={handleThreadClose}
					onReplyOpen={() => handleReplyOpen(openComment.id)}
					onReplyInput={(text) => handleReplyInput(openComment.id, text)}
					onReplyCancel={() => handleReplyCancel(openComment.id)}
					onReplySubmit={() => handleReplySubmit(openComment.id)}
					onToggleStatus={() => handleToggleStatus(openComment.id)}
					{copyBlocked}
					copied={copyFeedback?.kind === 'comment' && copyFeedback.id === openComment.id}
					onCopy={() => handleCopy(openComment.id)}
				/>
			{/key}
		{/if}
		{#if draft !== undefined && draftAnchor !== undefined}
			<CommentPopover
				bind:this={popover}
				{draft}
				frameLabel={frameLabel(frames, draft.frameId)}
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
	<!-- In the stage's place, centred in the space the panel leaves. -->
	<EmptyState
		icon="artboard"
		title="No artboard yet"
		example="“Design a pricing page with three plans”"
		hidden={frames.length > 0}
	>
		Ask Cursor Agent to design something. It shows up here as you work.
	</EmptyState>
</div>
<span class="visually-hidden" aria-live="polite">{liveRegionText(announcement)}</span>

<style>
	/* A row in the #svelte-root column: the panel and the stage share its width. */
	/* The stage tint also sits behind the empty state while the stage is hidden. */
	.workspace {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		background: var(--cd-bg-stage);
	}
</style>
