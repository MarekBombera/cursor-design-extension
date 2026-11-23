<script lang="ts">
	import { flushSync } from 'svelte';

	import { keptCommentDraft } from './commentPopover';
	import DesignPage from './DesignPage.svelte';
	import { connectHostBridge, readSavedCommentUi, saveCommentUi } from './hostBridge.svelte';
	import type { CanvasUpdatedMessage, CommentsUpdatedMessage, HostMessage } from './hostMessages';
	import { isPageChange, nextPageStart, type PageStart } from './pageStart';

	// The state that spans pages. Everything bound to one page lives in DesignPage.

	// Saved before this webview reloaded (a tab switch), read once. The draft slot carries its page;
	// the thread and reply drafts go to the first page with a real id.
	const savedCommentUi = readSavedCommentUi();
	let draftSlot = savedCommentUi.commentDraft;
	let realPageMounted = false;
	let mcpUnavailable = $state(false);
	let handoffStale = $state(false);
	// ponytail: only the latest list is held, relying on the host's readGeneration (only the last
	// read started posts). Two refreshes whose canvas posts overtake each other can leave a page with
	// no comments until the next refresh. Upgrade: hold the latest list per page id.
	let latestComments: CommentsUpdatedMessage | undefined;
	// '' is "no page": the first paint's disabled toolbar and empty state, never a page to switch to.
	let stage: PageStart = $state.raw({
		pageId: '',
		mode: savedCommentUi.mode,
		replyDrafts: {},
	});
	let page: DesignPage | undefined = $state();

	const NO_IFRAMES: ReadonlyMap<string, HTMLIFrameElement> = new Map();

	// A canvas:updated for another page: the mounted page is thrown away and the new one starts with
	// the mode, the draft slot and this message. flushSync mounts it before the next message.
	// ponytail: focus is not moved; focus inside the old page falls to body. Only a hand edit or the
	// Agent switches pages until 10d's menu, which owns the focus target.
	// ponytail: a draft whose Add is in flight at the switch is not kept in the slot. Its comment
	// lands on its page if the write succeeds; a failed write loses the text (today's tab-hide
	// ceiling).
	const stagePage = (message: CanvasUpdatedMessage): void => {
		const mounted = page?.savable();
		draftSlot = keptCommentDraft({ slot: draftSlot, page: mounted });
		page?.leave();
		stage = nextPageStart({
			canvas: message,
			comments: latestComments,
			staged: stage,
			mountedMode: mounted?.mode,
			draftSlot,
			saved: savedCommentUi,
			first: !realPageMounted,
		});
		realPageMounted = true;
		flushSync();
		// The page has applied its start; holding it would keep every frame's first HTML alive.
		stage = { ...stage, canvas: undefined, comments: undefined };
	};

	const handleHostMessage = (message: HostMessage): void => {
		if (message.type === 'ui:status') {
			mcpUnavailable = !message.mcpAvailable;
			handoffStale = message.handoffStale;
			return;
		}
		if (
			message.type === 'canvas:updated' &&
			isPageChange({ messagePageId: message.pageId, stagedPageId: stage.pageId })
		) {
			stagePage(message);
			return;
		}
		if (message.type === 'comments:updated') {
			latestComments = message;
		}
		page?.handleHostMessage(message);
	};

	// No debounce: setState is cheap, and a debounce would race the tab hide. Nothing is written
	// with no page or the '' page, so the saved UI survives reloads with no canvas in between.
	// ponytail: add or reply text in flight when the tab hid is not restored (the host never replays
	// an answer), so a failed request loses it. Upgrade: save pending text until its answer or the
	// next comments:updated.
	$effect(() => {
		const mounted = page?.savable();
		if (mounted === undefined || mounted.pageId === '') {
			return;
		}
		draftSlot = keptCommentDraft({ slot: draftSlot, page: mounted });
		saveCommentUi({
			mode: mounted.mode,
			commentDraft: draftSlot,
			openThreadId: mounted.threadId,
			replyDrafts: mounted.replyDrafts,
		});
	});

	connectHostBridge({
		iframes: () => page?.iframes ?? NO_IFRAMES,
		onHostMessage: handleHostMessage,
		onFrameMessage: (frameId, message) => page?.handleFrameMessage(frameId, message),
	});
</script>

{#key stage.pageId}
	<DesignPage bind:this={page} start={stage} {mcpUnavailable} {handoffStale} />
{/key}
