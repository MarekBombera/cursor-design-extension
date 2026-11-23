import type { CommentDraft, CommentDraftSlot } from './commentPopover';
import type { FrameMode } from './frame/frameMessages';
import type { CanvasUpdatedMessage, CommentsUpdatedMessage } from './hostMessages';
import type { SavedCommentUi } from './savedState';

// What App hands a page when it mounts. Only the first page with a real id gets the saved
// thread and reply drafts; a held draft only on its own page.
export type PageStart = {
	pageId: string;
	// The canvas:updated that staged this page, and App's latest comment list.
	canvas?: CanvasUpdatedMessage;
	comments?: CommentsUpdatedMessage;
	mode: FrameMode;
	heldDraft?: CommentDraft;
	heldThreadId?: string;
	replyDrafts: Readonly<Record<string, string>>;
};

// A canvas:updated remounts the page only for a real page other than the staged one. '' is "no
// page" and never remounts: it applies to the staged page as an error snapshot.
export const isPageChange = ({
	messagePageId,
	stagedPageId,
}: {
	messagePageId: string;
	stagedPageId: string;
}): boolean => messagePageId !== '' && messagePageId !== stagedPageId;

// The start of the page a canvas:updated stages. The mode carries over from the leaving page (the
// staged start's when none is mounted); `first` is true only for the first page with a real id.
export const nextPageStart = ({
	canvas,
	comments,
	staged,
	mountedMode,
	draftSlot,
	saved,
	first,
}: {
	canvas: CanvasUpdatedMessage;
	comments: CommentsUpdatedMessage | undefined;
	staged: PageStart;
	mountedMode: FrameMode | undefined;
	draftSlot: CommentDraftSlot | undefined;
	saved: Pick<SavedCommentUi, 'openThreadId' | 'replyDrafts'>;
	first: boolean;
}): PageStart => {
	const heldDraft = draftSlot?.pageId === canvas.pageId ? draftSlot.draft : undefined;
	return {
		pageId: canvas.pageId,
		canvas,
		...(comments === undefined ? {} : { comments }),
		mode: mountedMode ?? staged.mode,
		...(heldDraft === undefined ? {} : { heldDraft }),
		// The draft wins over the thread, but only on its own page.
		...(first && heldDraft === undefined && saved.openThreadId !== undefined
			? { heldThreadId: saved.openThreadId }
			: {}),
		replyDrafts: first ? saved.replyDrafts : {},
	};
};

// A comment list applies to its own page, or as a '' one (no page: no comments, maybe the error
// banner). Another page's list is never drawn nor sent to a frame.
export const isPageComments = ({
	listPageId,
	pageId,
}: {
	listPageId: string;
	pageId: string;
}): boolean => listPageId === pageId || listPageId === '';
