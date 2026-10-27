import {
	type CommentStyles,
	type FrameRect,
	hasControlChars,
	isTagName,
	parseFrameRect,
} from './frame/frameMessages';
import type { StageView } from './stageGeometry';

// Host ↔ chrome message contract, defined once. The host `import type`s these; the chrome
// parses every posted value through `parseHostMessage` first, and the host parses chrome
// messages with `parseChromeMessage` (src/host/chromeMessages.ts). DOM-free on purpose: the root
// tsconfig (no DOM lib) type-checks this file through the host imports.

export type PostedCanvasFrame = {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	group?: string;
	// This frame's artboard meta generation (0 when meta is absent).
	generation: number;
	html: string;
	errorMessage?: string;
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
// styles or fingerprint. 8f2 adds the stale / targetMissing flags.
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
};

// `error` is safe copy for the comments banner; the list is then empty and the canvas unaffected.
export type CommentsUpdatedMessage = {
	type: 'comments:updated';
	comments: PostedComment[];
	error?: string;
};

// The answers to one comment:create, matched by its requestId.
export type CommentAddedMessage = { type: 'comment:added'; requestId: string };

export type UiErrorMessage = { type: 'ui:error'; message: string; requestId?: string };

export type HostMessage =
	| CanvasUpdatedMessage
	| ArtboardErrorMessage
	| UiStatusMessage
	| CommentsUpdatedMessage
	| CommentAddedMessage
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

export type ChromeMessage = { type: 'artboard:ready' } | FramePlaceMessage | CommentCreateMessage;

const ARTBOARD_ERROR_FALLBACK = 'Could not load artboard.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

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
		html: entry.html,
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
		!Array.isArray(entry.replies)
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
	if (data.type === 'comment:added') {
		return typeof data.requestId === 'string'
			? { type: 'comment:added', requestId: data.requestId }
			: undefined;
	}
	if (data.type === 'ui:error') {
		return parseUiError(data);
	}
	return undefined;
};

// Webview state survives hide/show (the webview reloads), so the view is restored from it.
// Anything malformed is rejected and the first layout fits instead.
export const parseSavedStageView = (value: unknown): StageView | undefined => {
	if (
		!isRecord(value) ||
		!isFiniteNumber(value.x) ||
		!isFiniteNumber(value.y) ||
		!isFiniteNumber(value.zoom) ||
		value.zoom <= 0
	) {
		return undefined;
	}
	return { x: value.x, y: value.y, zoom: value.zoom };
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
