import type { EDIT_FIELDS, HISTORY_STEPS } from '../disk/layout';
import {
	type CommentStyles,
	type FrameRect,
	hasControlChars,
	isTagName,
	parseFrameRect,
} from './frame/frameMessages';

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

export type CanvasUpdatedMessage = {
	type: 'canvas:updated';
	activeArtboardId: string;
	generation: number;
	cspNonce: string;
	frames: PostedCanvasFrame[];
};

type ArtboardErrorMessage = {
	type: 'artboard:error';
	message: string;
};

type UiStatusMessage = {
	type: 'ui:status';
	mcpAvailable: boolean;
	handoffStale: boolean;
};

type PostedReply = {
	id: string;
	author: 'user' | 'agent';
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
	pin: { x: number; y: number };
	body: string;
	isPage: boolean;
	status: 'open' | 'sent' | 'resolved';
	createdAt: string;
	replies: PostedReply[];
	stale: boolean | null;
	targetMissing: boolean | null;
};

// `error` is safe copy for the comments banner; the list is then empty and the canvas unaffected.
export type CommentsUpdatedMessage = {
	type: 'comments:updated';
	comments: PostedComment[];
	error?: string;
};

// Success answer to comment:create.
export type CommentAddedMessage = { type: 'comment:added'; requestId: string };

// Success answer to comment:reply and comment:set-status.
export type CommentSavedMessage = { type: 'comment:saved'; requestId: string };

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
	| UiErrorMessage;

export type FramePlacement = { x: number; y: number; width: number };

// Sent once per drag/resize/nudge on release. `base` is the frame's placement at gesture start.
export type FramePlaceMessage = {
	type: 'frame:place';
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
	frameId: string;
	generation: number;
	selector: string;
	tagName: string;
	text: string;
	rect: FrameRect | null;
	point: { x: number; y: number };
	box: { width: number; height: number };
	styles: CommentStyles;
	isPage: boolean;
	body: string;
};

export type CommentReplyMessage = {
	type: 'comment:reply';
	requestId: string;
	id: string;
	body: string;
};

export type CommentSetStatusMessage = {
	type: 'comment:set-status';
	requestId: string;
	id: string;
	status: 'open' | 'resolved';
};

export type CommentCopyMessage = { type: 'comment:copy'; requestId: string; id: string };

// One prompt for every open comment, in comments.json order.
export type CommentCopyOpenMessage = { type: 'comment:copy-open'; requestId: string };

// Every chrome → host comment write; each attempt with a valid requestId is answered once.
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
	frameId: string;
	sourceNumber: number;
	hash: string;
	field: (typeof EDIT_FIELDS)[number];
	value: string;
	// Present iff field is 'text': the element's full live text (never the pick excerpt).
	liveText?: string;
};

export type HistoryStep = (typeof HISTORY_STEPS)[number];

// Undo or redo the panel's own last write to the frame. The host writes only bytes it holds.
// Answered once: artboard:edited or ui:error { requestId }.
export type ArtboardHistoryMessage = {
	type: 'artboard:history';
	requestId: string;
	frameId: string;
	step: HistoryStep;
};

export type ChromeMessage =
	| { type: 'artboard:ready' }
	| FramePlaceMessage
	| CommentRequestMessage
	| ArtboardEditMessage
	| ArtboardHistoryMessage;

const ARTBOARD_ERROR_FALLBACK = 'Could not load artboard.';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

export const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const parsePostedFrame = (entry: unknown): PostedCanvasFrame | undefined => {
	if (
		!isRecord(entry) ||
		typeof entry.id !== 'string' ||
		typeof entry.label !== 'string' ||
		typeof entry.html !== 'string' ||
		!isFiniteNumber(entry.x) ||
		!isFiniteNumber(entry.y) ||
		!isFiniteNumber(entry.width) ||
		!isFiniteNumber(entry.generation) ||
		typeof entry.hash !== 'string' ||
		typeof entry.canUndo !== 'boolean' ||
		typeof entry.canRedo !== 'boolean' ||
		!isOptionalString(entry.group) ||
		!isOptionalString(entry.errorMessage)
	) {
		return undefined;
	}
	const frame: PostedCanvasFrame = {
		id: entry.id,
		label: entry.label,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		generation: entry.generation,
		hash: entry.hash,
		html: entry.html,
		canUndo: entry.canUndo,
		canRedo: entry.canRedo,
	};
	if (entry.group !== undefined) {
		frame.group = entry.group;
	}
	if (entry.errorMessage !== undefined) {
		frame.errorMessage = entry.errorMessage;
	}
	return frame;
};

// A frame entry failing validation is dropped; the chrome then removes that id like any id
// missing from a valid canvas:updated.
const parseCanvasUpdated = (data: Record<string, unknown>): CanvasUpdatedMessage | undefined => {
	if (
		typeof data.activeArtboardId !== 'string' ||
		typeof data.cspNonce !== 'string' ||
		!isFiniteNumber(data.generation) ||
		!Array.isArray(data.frames)
	) {
		return undefined;
	}
	const frames: PostedCanvasFrame[] = [];
	for (const entry of data.frames as unknown[]) {
		const frame = parsePostedFrame(entry);
		if (frame !== undefined) {
			frames.push(frame);
		}
	}
	return {
		type: 'canvas:updated',
		activeArtboardId: data.activeArtboardId,
		generation: data.generation,
		cspNonce: data.cspNonce,
		frames,
	};
};

const parseReply = (entry: unknown): PostedReply | undefined => {
	if (
		!isRecord(entry) ||
		typeof entry.id !== 'string' ||
		(entry.author !== 'user' && entry.author !== 'agent') ||
		typeof entry.body !== 'string' ||
		typeof entry.createdAt !== 'string'
	) {
		return undefined;
	}
	return { id: entry.id, author: entry.author, body: entry.body, createdAt: entry.createdAt };
};

const isCommentStatus = (value: unknown): value is PostedComment['status'] =>
	value === 'open' || value === 'sent' || value === 'resolved';

const isFlag = (value: unknown): value is boolean | null =>
	value === true || value === false || value === null;

// Field by field, with the cd:pick guards: comments.json is workspace data, and a design script
// can write it through the Agent.
const parsePostedComment = (entry: unknown): PostedComment | undefined => {
	if (
		!isRecord(entry) ||
		typeof entry.id !== 'string' ||
		typeof entry.frameId !== 'string' ||
		typeof entry.selector !== 'string' ||
		hasControlChars(entry.selector) ||
		!isTagName(entry.tagName) ||
		typeof entry.text !== 'string' ||
		hasControlChars(entry.text) ||
		!isRecord(entry.pin) ||
		!isFiniteNumber(entry.pin.x) ||
		!isFiniteNumber(entry.pin.y) ||
		typeof entry.body !== 'string' ||
		typeof entry.isPage !== 'boolean' ||
		!isCommentStatus(entry.status) ||
		typeof entry.createdAt !== 'string' ||
		!Array.isArray(entry.replies) ||
		!isFlag(entry.stale) ||
		!isFlag(entry.targetMissing)
	) {
		return undefined;
	}
	const rect = entry.rect === null ? null : parseFrameRect(entry.rect);
	const replies = (entry.replies as unknown[]).map(parseReply);
	if (rect === undefined || replies.includes(undefined)) {
		return undefined;
	}
	return {
		id: entry.id,
		frameId: entry.frameId,
		selector: entry.selector,
		tagName: entry.tagName,
		text: entry.text,
		rect,
		pin: { x: entry.pin.x, y: entry.pin.y },
		body: entry.body,
		isPage: entry.isPage,
		status: entry.status,
		createdAt: entry.createdAt,
		replies: replies.filter((reply) => reply !== undefined),
		stale: entry.stale,
		targetMissing: entry.targetMissing,
	};
};

// A malformed comment is dropped, like a malformed frame; a malformed list or error drops all.
const parseCommentsUpdated = (
	data: Record<string, unknown>,
): CommentsUpdatedMessage | undefined => {
	if (!Array.isArray(data.comments) || !isOptionalString(data.error)) {
		return undefined;
	}
	const comments: PostedComment[] = [];
	for (const entry of data.comments as unknown[]) {
		const comment = parsePostedComment(entry);
		if (comment !== undefined) {
			comments.push(comment);
		}
	}
	return data.error === undefined
		? { type: 'comments:updated', comments }
		: { type: 'comments:updated', comments, error: data.error };
};

const parseUiError = (data: Record<string, unknown>): UiErrorMessage | undefined => {
	if (typeof data.message !== 'string' || !isOptionalString(data.requestId)) {
		return undefined;
	}
	return data.requestId === undefined
		? { type: 'ui:error', message: data.message }
		: { type: 'ui:error', message: data.message, requestId: data.requestId };
};

// Unknown `type` or a malformed payload returns undefined; never throws.
export const parseHostMessage = (data: unknown): HostMessage | undefined => {
	if (!isRecord(data)) {
		return undefined;
	}
	if (data.type === 'canvas:updated') {
		return parseCanvasUpdated(data);
	}
	if (data.type === 'artboard:error') {
		return {
			type: 'artboard:error',
			message: typeof data.message === 'string' ? data.message : ARTBOARD_ERROR_FALLBACK,
		};
	}
	if (data.type === 'ui:status') {
		if (typeof data.mcpAvailable !== 'boolean') {
			return undefined;
		}
		return {
			type: 'ui:status',
			mcpAvailable: data.mcpAvailable,
			handoffStale: data.handoffStale === true,
		};
	}
	if (data.type === 'comments:updated') {
		return parseCommentsUpdated(data);
	}
	if (data.type === 'comment:added' || data.type === 'comment:saved') {
		return typeof data.requestId === 'string'
			? { type: data.type, requestId: data.requestId }
			: undefined;
	}
	if (data.type === 'ui:error') {
		return parseUiError(data);
	}
	if (data.type === 'artboard:edited') {
		// The same guards as a canvas:updated frame's html, hash, generation and flags.
		return typeof data.requestId === 'string' &&
			typeof data.frameId === 'string' &&
			typeof data.hash === 'string' &&
			isFiniteNumber(data.generation) &&
			typeof data.html === 'string' &&
			typeof data.canUndo === 'boolean' &&
			typeof data.canRedo === 'boolean'
			? {
					type: 'artboard:edited',
					requestId: data.requestId,
					frameId: data.frameId,
					hash: data.hash,
					generation: data.generation,
					html: data.html,
					canUndo: data.canUndo,
					canRedo: data.canRedo,
				}
			: undefined;
	}
	if (data.type === 'ui:copied') {
		return typeof data.requestId === 'string' &&
			typeof data.count === 'number' &&
			Number.isInteger(data.count) &&
			data.count >= 0
			? { type: 'ui:copied', requestId: data.requestId, count: data.count }
			: undefined;
	}
	return undefined;
};

export type MessageRoute = { kind: 'frame'; frameId: string } | { kind: 'host' } | { kind: 'drop' };

// Who sent a window message. A registered frame's window wins, whatever the payload claims. An
// opaque-origin sender that is not (or no longer) registered never reaches the host parser.
// `source` null never matches: a detached iframe's contentWindow is null too.
export const routeMessage = ({
	source,
	origin,
	iframes,
}: {
	source: unknown;
	origin: string;
	iframes: ReadonlyMap<string, { contentWindow: unknown }>;
}): MessageRoute => {
	if (source !== null) {
		for (const [frameId, iframe] of iframes) {
			if (iframe.contentWindow === source) {
				return { kind: 'frame', frameId };
			}
		}
	}
	return origin === 'null' ? { kind: 'drop' } : { kind: 'host' };
};
