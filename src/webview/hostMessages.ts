import type { EditChange } from '../disk/editValues';
import type { CommentStatus, HISTORY_STEPS, ReplyAuthor } from '../disk/layout';
import type { CommentStyles, FramePoint, FrameRect, FrameSize } from './frame/frameMessages';

// DOM-free: the root tsconfig (no DOM lib) type-checks this file through the host's imports.

export type PostedCanvasFrame = {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	group?: string;
	// This frame's artboard meta generation (0 when meta is absent).
	generation: number;
	// hashHtml of the disk HTML (never the tagged copy); '' when the file was not readable. The
	// base an Edit-mode change is checked against.
	hash: string;
	html: string;
	errorMessage?: string;
	// The host's undo history for the panel's own writes, read at every send (replays too).
	canUndo: boolean;
	canRedo: boolean;
};

// One project.json page. updatedAt: the newest mtime of the page's files (ISO 8601), null when
// unreadable.
export type PostedPage = { id: string; title: string; updatedAt: string | null };

// pageId: the page the snapshot was read from; '' when no page was resolved (no frames then).
// pages: every page in project.json order; [] when no page resolved or the list read failed.
export type CanvasUpdatedMessage = {
	type: 'canvas:updated';
	pageId: string;
	activeArtboardId: string;
	generation: number;
	cspNonce: string;
	frames: PostedCanvasFrame[];
	pages: PostedPage[];
};

type ArtboardErrorMessage = {
	type: 'artboard:error';
	message: string;
};

export type UiStatusMessage = {
	type: 'ui:status';
	mcpAvailable: boolean;
	handoffStale: boolean;
};

type PostedReply = {
	id: string;
	author: ReplyAuthor;
	body: string;
	createdAt: string;
};

// What the chrome gets of a stored comment (toPostedComment): never the artboard label, version,
// styles or fingerprint. The flags are get_comment's: `null` means unchecked.
export type PostedComment = {
	id: string;
	frameId: string;
	selector: string;
	tagName: string;
	text: string;
	rect: FrameRect | null;
	pin: FramePoint;
	body: string;
	isPage: boolean;
	status: CommentStatus;
	createdAt: string;
	replies: PostedReply[];
	stale: boolean | null;
	targetMissing: boolean | null;
};

// `error` is safe copy for the comments banner; the list is then empty and the canvas unaffected.
// pageId as on canvas:updated.
export type CommentsUpdatedMessage = {
	type: 'comments:updated';
	pageId: string;
	comments: PostedComment[];
	error?: string;
};

// Success answer to comment:create.
export type CommentAddedMessage = { type: 'comment:added'; requestId: string };

// Success answer to comment:reply and comment:set-status.
export type CommentSavedMessage = { type: 'comment:saved'; requestId: string };

// Success answer to any page:* request, a cancelled delete included.
export type PageSavedMessage = { type: 'page:saved'; requestId: string };

export type UiErrorMessage = { type: 'ui:error'; message: string; requestId?: string };

// Success answer to comment:copy and comment:copy-open. `count` = comments this copy moved from
// open to sent (0 for a re-copy, or when the Agent resolved them first).
export type CopiedMessage = { type: 'ui:copied'; requestId: string; count: number };

// Success answer to artboard:edit and artboard:history. `html` is the new tagged frame copy, the
// exact string the watcher echo's canvas:updated will carry. The chrome adopts it; after a step it
// also reloads the frame. The flags are the frame's history after this write.
export type ArtboardEditedMessage = {
	type: 'artboard:edited';
	requestId: string;
	frameId: string;
	hash: string;
	generation: number;
	html: string;
	canUndo: boolean;
	canRedo: boolean;
};

export type HostMessage =
	| CanvasUpdatedMessage
	| ArtboardErrorMessage
	| UiStatusMessage
	| CommentsUpdatedMessage
	| CommentAddedMessage
	| CommentSavedMessage
	| CopiedMessage
	| ArtboardEditedMessage
	| PageSavedMessage
	| UiErrorMessage;

export type FramePlacement = FramePoint & Pick<FrameSize, 'width'>;

// Sent once per drag/resize/nudge on release. `base` is the frame's placement at gesture start.
export type FramePlaceMessage = {
	type: 'frame:place';
	pageId: string;
	id: string;
	x: number;
	y: number;
	width: number;
	base: FramePlacement;
};

// A user pick plus the typed body. `box` is the target's unclipped border-box size, so the host
// can turn `point` into the stored pin fraction even when `rect` is clipped.
export type CommentCreateMessage = {
	type: 'comment:create';
	requestId: string;
	pageId: string;
	frameId: string;
	generation: number;
	selector: string;
	tagName: string;
	text: string;
	rect: FrameRect | null;
	point: FramePoint;
	box: FrameSize;
	styles: CommentStyles;
	isPage: boolean;
	body: string;
};

export type CommentReplyMessage = {
	type: 'comment:reply';
	requestId: string;
	pageId: string;
	id: string;
	body: string;
};

export type CommentSetStatusMessage = {
	type: 'comment:set-status';
	requestId: string;
	pageId: string;
	id: string;
	// `sent` is the host's to set.
	status: Exclude<CommentStatus, 'sent'>;
};

export type CommentCopyMessage = {
	type: 'comment:copy';
	requestId: string;
	pageId: string;
	id: string;
};

// One prompt for every open comment, in comments.json order.
export type CommentCopyOpenMessage = {
	type: 'comment:copy-open';
	requestId: string;
	pageId: string;
};

// Every chrome → host comment write; each attempt with a valid requestId is answered once. Every
// page-bound request names its page (`pageId`); the host acts on that page, never the open one.
export type CommentRequestMessage =
	| CommentCreateMessage
	| CommentReplyMessage
	| CommentSetStatusMessage
	| CommentCopyMessage
	| CommentCopyOpenMessage;

// One Edit-mode change to the element numbered `sourceNumber` (data-cd-src) in the frame whose disk
// HTML had `hash`. Answered once: artboard:edited or ui:error { requestId }.
export type ArtboardEditMessage = {
	type: 'artboard:edit';
	requestId: string;
	pageId: string;
	frameId: string;
	sourceNumber: number;
	hash: string;
	// A styles change is one write, one undo step.
} & EditChange;

export type HistoryStep = (typeof HISTORY_STEPS)[number];

// Undo or redo the panel's own last write to the frame. The host writes only bytes it holds.
// Answered once: artboard:edited or ui:error { requestId }.
export type ArtboardHistoryMessage = {
	type: 'artboard:history';
	requestId: string;
	pageId: string;
	frameId: string;
	step: HistoryStep;
};

// A page-bound request as the pure rules build it; only hostBridge's pageBoundPost adds `pageId`.
// Distributive, so a union (the edit variants, the comment requests) keeps its members.
export type PageFree<Message> = Message extends unknown ? Omit<Message, 'pageId'> : never;

// One page's post port: takes a page-free request, posts it with the page's `pageId`. DesignPage
// builds one per page with hostBridge's `pageBoundPost`; each state class narrows it to the
// requests it sends.
export type PagePost<Message> = (message: PageFree<Message>) => void;

type PageOpenMessage = { type: 'page:open'; requestId: string; pageId: string };

// No title: the disk lib names the new page "Page <n>".
type PageCreateMessage = { type: 'page:create'; requestId: string };

// `title` is the raw draft; the host's parsePageTitle trims and checks it.
type PageRenameMessage = {
	type: 'page:rename';
	requestId: string;
	pageId: string;
	title: string;
};

type PageDeleteMessage = { type: 'page:delete'; requestId: string; pageId: string };

// Not page-bound: `pageId` is the target page, not the staged one, so PageFree does not apply and
// hostBridge adds none. Each attempt with a valid requestId is answered once: page:saved or
// ui:error { requestId }.
export type PageRequestMessage =
	| PageOpenMessage
	| PageCreateMessage
	| PageRenameMessage
	| PageDeleteMessage;

export type ChromeMessage =
	| { type: 'artboard:ready' }
	| FramePlaceMessage
	| CommentRequestMessage
	| ArtboardEditMessage
	| ArtboardHistoryMessage
	| PageRequestMessage;
