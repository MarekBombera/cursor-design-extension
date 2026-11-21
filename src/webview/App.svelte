<script lang="ts">
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
	import { connectHostBridge, readSavedCommentUi, saveCommentUi } from './hostBridge.svelte';
	import type { HostMessage } from './hostMessages';
	import Pins from './Pins.svelte';
	import { PinThread } from './pinThread.svelte';
	import Stage from './Stage.svelte';
	import Toolbar from './Toolbar.svelte';
	import Inspector from './Inspector.svelte';
	import EmptyState from './ui/EmptyState.svelte';

	// Saved before this webview reloaded (a tab switch). Mode and reply text come back at once; the
	// draft and the open thread are held until what they point at exists.
	const savedCommentUi = readSavedCommentUi();
	// One module per domain, in dependency order: PinThread's $effect.pre runs on creation and reads
	// the canvas and the comments.
	const canvas = new CanvasState();
	const comments = new CommentsState(savedCommentUi.replyDrafts);
	const pinThread = new PinThread({
		canvas,
		comments,
		heldThreadId: savedCommentUi.openThreadId,
	});
	const picker = new CommentPicker({
		canvas,
		pinThread,
		mode: savedCommentUi.mode,
		heldDraft: savedCommentUi.commentDraft,
	});
	const edit = new EditState({ canvas, picker });

	const keepLiveCommentState = (): void => {
		const liveFrameIds = liveIframeIds(canvas.frames);
		picker.keepLiveState(liveFrameIds);
		pinThread.keepLiveAnchors(liveFrameIds);
	};

	const handleHostMessage = (message: HostMessage): void => {
		if (message.type === 'canvas:updated') {
			canvas.applyCanvasUpdated(message);
			keepLiveCommentState();
			picker.restoreHeldDraft();
			edit.handleFramesChanged();
			return;
		}
		if (message.type === 'artboard:error') {
			canvas.applyArtboardError(message.message);
			return;
		}
		if (message.type === 'comments:updated') {
			comments.applyCommentsUpdated(message);
			pinThread.sendAnchors(liveIframeIds(canvas.frames));
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
		if (message.type === 'artboard:edited') {
			edit.handleEditAnswer(message);
			return;
		}
		canvas.mcpUnavailable = !message.mcpAvailable;
		canvas.handoffStale = message.handoffStale;
	};

	const handleFrameMessage = (frameId: string, message: FrameMessage): void => {
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

	// No debounce: setState is cheap, and a debounce would race the tab hide. Each key is the live
	// value, or the held one while it waits.
	// ponytail: add or reply text in flight when the tab hid is not restored (the host never replays
	// an answer), so a failed request loses it. Upgrade: save pending text until its answer or the
	// next comments:updated.
	$effect(() => {
		saveCommentUi({
			mode: picker.picking.mode,
			commentDraft: picker.heldDraft ?? picker.savedDraft,
			openThreadId: pinThread.openThreadId ?? pinThread.heldThreadId,
			replyDrafts: comments.savedReplyDrafts,
		});
	});

	canvas.installScrollSink();

	connectHostBridge({
		iframes: canvas.iframes,
		onHostMessage: handleHostMessage,
		onFrameMessage: handleFrameMessage,
	});
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
	handoffStale={canvas.handoffStale}
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
	mcpUnavailable={canvas.mcpUnavailable}
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
