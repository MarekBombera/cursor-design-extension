<script module lang="ts">
	import type { CommentDraft } from './commentPopover';
	import type { FrameMode } from './frame/frameMessages';

	// The page's comment UI to save, stamped with its own pageId (never App's stage id), so a read
	// taken mid-swap names the right page. `draft` and `threadId` are the live or the held one.
	export type PageSavable = {
		pageId: string;
		mode: FrameMode;
		draft: CommentDraft | undefined;
		threadId: string | undefined;
		replyDrafts: Record<string, string>;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';

	import Banners from './Banners.svelte';
	import { liveIframeIds } from './canvasFrames';
	import { CanvasState } from './canvasState.svelte';
	import { CommentPicker } from './commentPicker.svelte';
	import CommentPopover from './CommentPopover.svelte';
	import CommentsPanel from './CommentsPanel.svelte';
	import { frameLabel, liveRegionText } from './commentsPanel';
	import { CommentsState } from './commentsState.svelte';
	import { EditState } from './editState.svelte';
	import CommentThread from './CommentThread.svelte';
	import type { FrameMessage } from './frame/frameMessages';
	import runtimeSource from './frame/runtime.ts?iife';
	import type { CanvasUpdatedMessage, CommentsUpdatedMessage, HostMessage } from './hostMessages';
	import { isPageComments, type PageStart } from './pageStart';
	import Pins from './Pins.svelte';
	import { PinThread } from './pinThread.svelte';
	import Stage from './Stage.svelte';
	import Toolbar from './Toolbar.svelte';
	import Inspector from './Inspector.svelte';
	import EmptyState from './ui/EmptyState.svelte';

	// One page's chrome. App remounts it ({#key}) for another page, so nothing here outlives its
	// page: frames, iframes, picks, pins, threads, composers, drafts and requests all start again.
	let {
		start,
		mcpUnavailable,
		handoffStale,
	}: { start: PageStart; mcpUnavailable: boolean; handoffStale: boolean } = $props();

	// Read once, untracked: App never changes a mounted page's start (another page remounts).
	const initial = untrack(() => start);
	const { pageId } = initial;
	// One module per domain, in dependency order: PinThread's $effect.pre runs on creation and reads
	// the canvas and the comments.
	const canvas = new CanvasState(pageId);
	const comments = new CommentsState({ pageId, replyDrafts: initial.replyDrafts });
	const pinThread = new PinThread({ canvas, comments, heldThreadId: initial.heldThreadId });
	const picker = new CommentPicker({
		canvas,
		pinThread,
		pageId,
		mode: initial.mode,
		heldDraft: initial.heldDraft,
	});
	const edit = new EditState({ canvas, picker, pageId });

	const keepLiveCommentState = (): void => {
		const liveFrameIds = liveIframeIds(canvas.frames);
		picker.keepLiveState(liveFrameIds);
		pinThread.keepLiveAnchors(liveFrameIds);
	};

	const applyCanvas = (message: CanvasUpdatedMessage): void => {
		canvas.applyCanvasUpdated(message);
		keepLiveCommentState();
		picker.restoreHeldDraft();
		edit.handleFramesChanged();
	};

	const applyComments = (message: CommentsUpdatedMessage): void => {
		if (!isPageComments({ listPageId: message.pageId, pageId })) {
			return;
		}
		comments.applyCommentsUpdated(message);
		pinThread.sendAnchors(liveIframeIds(canvas.frames));
	};

	// Every host message but ui:status (App holds it). Answers to another page's requests match no
	// requestId here and are dropped.
	export const handleHostMessage = (
		message: Exclude<HostMessage, { type: 'ui:status' }>,
	): void => {
		if (message.type === 'canvas:updated') {
			applyCanvas(message);
			return;
		}
		if (message.type === 'artboard:error') {
			canvas.applyArtboardError(message.message);
			return;
		}
		if (message.type === 'comments:updated') {
			applyComments(message);
			return;
		}
		if (message.type === 'comment:added') {
			picker.handleCommentAnswer(message);
			return;
		}
		// A ui:error answers a draft, an action, the copy-open request or an edit; UUIDs never
		// cross-match.
		if (message.type === 'ui:error') {
			picker.handleCommentAnswer(message);
			comments.handleActionAnswer(message);
			comments.handleCopyOpenAnswer(message);
			edit.handleEditAnswer(message);
			return;
		}
		if (message.type === 'comment:saved') {
			comments.handleActionAnswer(message);
			return;
		}
		if (message.type === 'ui:copied') {
			comments.handleActionAnswer(message);
			comments.handleCopyOpenAnswer(message);
			return;
		}
		edit.handleEditAnswer(message);
	};

	export const handleFrameMessage = (frameId: string, message: FrameMessage): void => {
		const frame = canvas.frames.find((candidate) => candidate.id === frameId);
		if (frame === undefined) {
			return;
		}
		if (message.type === 'cd:ready' || message.type === 'cd:hover' || message.type === 'cd:pick') {
			picker.handlePickMessage(frame, message);
			// A new document: its old answers are gone, and it measures after the cd:mode above.
			if (message.type === 'cd:ready') {
				pinThread.resetFrameAnchors(frameId);
				edit.handleFrameReady(frameId);
			} else if (message.type === 'cd:pick') {
				edit.handlePick(message, frameId, document.activeElement === canvas.iframes.get(frameId));
			}
			return;
		}
		if (message.type === 'cd:anchor-rects') {
			// Keyed by the sending frame, in any mode: a forged answer only moves its own pins.
			pinThread.handleAnchorRects(frameId, message.anchors);
			return;
		}
		if (message.type === 'cd:frame-height') {
			canvas.handleFrameHeight(frameId, message.height);
			return;
		}
		if (message.type === 'cd:key') {
			if (message.key === 'undo' || message.key === 'redo') {
				edit.handleFrameHistoryKey(
					frameId,
					message.key,
					document.activeElement === canvas.iframes.get(frameId),
				);
			} else {
				picker.handleFrameKey(message.key);
			}
			return;
		}
		canvas.handleFrameWheel(frame, message);
	};

	// The host bridge matches frame messages against these at message time.
	export const iframes: ReadonlyMap<string, HTMLIFrameElement> = canvas.iframes;

	// Called by App right before this page unmounts for another page.
	export const leave = (): void => {
		edit.discardDrafts();
	};

	// Reactive: App's save $effect re-runs on every change it reads. App also reads the mode here
	// right before a switch, to hand it to the next page.
	export const savable = (): PageSavable => ({
		pageId,
		mode: picker.picking.mode,
		draft: picker.heldDraft ?? picker.savedDraft,
		threadId: pinThread.openThreadId ?? pinThread.heldThreadId,
		replyDrafts: comments.savedReplyDrafts,
	});

	const handleWindowKeydown = (event: KeyboardEvent): void => {
		canvas.endSinkGesture();
		picker.handleKeydown(event);
	};

	// A user open ends any restore still held: the draft here, the thread in handlePinOpen.
	const handlePinOpen = (id: string): void => {
		picker.heldDraft = undefined;
		pinThread.handlePinOpen(id);
	};

	const handleRenderError = (id: string): void => {
		canvas.handleRenderError(id);
		keepLiveCommentState();
		edit.handleFramesChanged();
	};

	// The page starts from what staged it: the canvas first, so the list finds its frames.
	if (initial.canvas !== undefined) {
		applyCanvas(initial.canvas);
	}
	if (initial.comments !== undefined) {
		applyComments(initial.comments);
	}

	// Idempotent body styles: safe on every mount.
	canvas.installScrollSink();
</script>

<svelte:window
	onkeydowncapture={edit.handleHistoryKeydown}
	onkeydown={handleWindowKeydown}
	onscroll={canvas.handleSinkScroll}
	onresize={canvas.recentreScrollSink}
/>

<Toolbar
	artboardId={canvas.artboardId}
	generation={canvas.generation}
	{handoffStale}
	zoom={canvas.committedView?.zoom ?? 1}
	disabled={canvas.frames.length === 0}
	mode={picker.picking.mode}
	pick={picker.picking.pick}
	commentsPanelOpen={comments.commentsPanelOpen}
	unresolvedCount={comments.summary.open + comments.summary.sent}
	onPreset={canvas.handlePreset}
	onFit={canvas.handleFit}
	onChooseMode={picker.handleChooseMode}
	onToggleCommentsPanel={comments.handleToggleCommentsPanel}
/>
<Banners
	errorMessage={canvas.errorMessage}
	commentsError={comments.commentsError}
	{mcpUnavailable}
/>
<!-- The inspector (Edit mode only) and the panel come first (Tab order inspector → panel → stage);
     CSS order draws them on the right, the inspector at the edge. -->
<div class="workspace">
	{#if picker.picking.mode === 'edit'}
		{@const pick = picker.picking.pick}
		<Inspector
			{pick}
			frameLabel={pick === undefined ? '' : frameLabel(canvas.frames, pick.frameId)}
			drafts={edit.drafts}
			drafted={edit.drafted}
			requestError={edit.requestError}
			fieldError={edit.fieldError}
			onParent={() => picker.stepPick('cd:pick-parent')}
			onChild={() => picker.stepPick('cd:pick-child')}
			onFieldFocus={edit.handleFieldFocus}
			onFieldInput={edit.handleFieldInput}
			onFieldCommit={edit.handleFieldCommit}
			onStyleChanges={edit.handleStyleChanges}
			history={edit.history}
			announcement={edit.announcement}
			onUndo={() => edit.handleHistoryStep('undo')}
			onRedo={() => edit.handleHistoryStep('redo')}
		/>
	{/if}
	<CommentsPanel
		open={comments.commentsPanelOpen}
		items={pinThread.commentItems}
		error={comments.commentsError}
		now={comments.now}
		actions={comments.actions}
		onJump={pinThread.handleJump}
		onReplyOpen={comments.handleReplyOpen}
		onReplyInput={comments.handleReplyInput}
		onReplyCancel={comments.handleReplyCancel}
		onReplySubmit={comments.handleReplySubmit}
		onToggleStatus={comments.handleToggleStatus}
		copyBlocked={comments.copyBlocked}
		copied={comments.copyFeedback}
		copyOpen={comments.copyOpen}
		summary={comments.summary}
		onCopy={comments.handleCopy}
		onCopyOpen={comments.handleCopyOpen}
	/>
	<Stage
		bind:this={pinThread.stage}
		frames={canvas.displayFrames}
		labels={canvas.labels}
		headings={canvas.layout.headings}
		activeId={canvas.artboardId}
		nonce={canvas.nonce}
		{runtimeSource}
		transform={canvas.transform}
		zoom={canvas.committedView?.zoom ?? 1}
		hidden={canvas.frames.length === 0}
		mode={picker.picking.mode}
		hoverOutline={picker.hoverOutline}
		pickOutline={picker.pickOutline}
		flashOutline={pinThread.flashOutline}
		onWheel={canvas.handleStageWheel}
		onDragPan={canvas.handleDragPan}
		onViewportSize={canvas.handleViewportSize}
		onIframe={canvas.handleIframe}
		onRenderError={handleRenderError}
		onFrameGesture={canvas.handleFrameGesture}
	>
		<Pins
			bind:this={pinThread.pinsView}
			pins={pinThread.pins}
			inert={picker.draft !== undefined}
			openId={pinThread.openThreadId}
			onOpen={handlePinOpen}
		/>
		{#if pinThread.openPin !== undefined && pinThread.openComment !== undefined}
			{@const openPin = pinThread.openPin}
			{@const openComment = pinThread.openComment}
			{#key pinThread.openThreadId}
				<CommentThread
					comment={openComment}
					number={openPin.number}
					frameLabel={frameLabel(canvas.frames, openComment.frameId)}
					badge={openPin.badge}
					anchor={openPin}
					viewportWidth={canvas.viewportWidth}
					viewportHeight={canvas.viewportHeight}
					now={comments.now}
					action={comments.actions.get(openComment.id)}
					onClose={pinThread.handleThreadClose}
					focusOnOpen={pinThread.threadFocusOnOpen}
					onReplyOpen={() => comments.handleReplyOpen(openComment.id)}
					onReplyInput={(text) => comments.handleReplyInput(openComment.id, text)}
					onReplyCancel={() => comments.handleReplyCancel(openComment.id)}
					onReplySubmit={() => comments.handleReplySubmit(openComment.id)}
					onToggleStatus={() => comments.handleToggleStatus(openComment.id)}
					copyBlocked={comments.copyBlocked}
					copied={comments.copyFeedback?.kind === 'comment' &&
						comments.copyFeedback.id === openComment.id}
					onCopy={() => comments.handleCopy(openComment.id)}
				/>
			{/key}
		{/if}
		{#if picker.draft !== undefined && picker.draftAnchor !== undefined}
			<CommentPopover
				bind:this={picker.popover}
				draft={picker.draft}
				body={picker.draft.body}
				oninput={picker.handleDraftInput}
				frameLabel={frameLabel(canvas.frames, picker.draft.frameId)}
				anchor={picker.draftAnchor}
				viewportWidth={canvas.viewportWidth}
				viewportHeight={canvas.viewportHeight}
				canStep={picker.canStep}
				onAdd={picker.handleAdd}
				onCancel={picker.handleCancel}
				onParent={() => picker.stepPick('cd:pick-parent')}
				onChild={() => picker.stepPick('cd:pick-child')}
			/>
		{/if}
	</Stage>
	<!-- In the stage's place, centred in the space the panel leaves. -->
	<EmptyState
		icon="artboard"
		title="No artboard yet"
		example="“Design a pricing page with three plans”"
		hidden={canvas.frames.length > 0}
	>
		Ask Cursor Agent to design something. It shows up here as you work.
	</EmptyState>
</div>
<span class="visually-hidden" aria-live="polite">{liveRegionText(comments.announcement)}</span>

<style>
	/* The stage tint also sits behind the empty state while the stage is hidden. */
	.workspace {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		background: var(--cd-bg-stage);
	}
</style>
