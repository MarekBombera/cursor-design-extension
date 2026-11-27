import { isPageId } from '../disk/layout';
import { isFiniteNumber, isRecord } from './frame/frameMessages';
import type {
	CanvasUpdatedMessage,
	CommentsUpdatedMessage,
	HostMessage,
	PostedCanvasFrame,
	PostedComment,
	PostedPage,
	UiErrorMessage,
} from './hostMessages';

const ARTBOARD_ERROR_FALLBACK = 'Could not load artboard.';

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

// '' is "no page" on host state messages.
const isPostedPageId = (value: unknown): value is string => value === '' || isPageId(value);

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

const parsePostedPage = (entry: unknown): PostedPage | undefined =>
	isRecord(entry) &&
	isPageId(entry.id) &&
	typeof entry.title === 'string' &&
	(entry.updatedAt === null || typeof entry.updatedAt === 'string')
		? { id: entry.id, title: entry.title, updatedAt: entry.updatedAt }
		: undefined;

// A frame entry failing validation is dropped; the chrome then removes that id like any id
// missing from a valid canvas:updated. A bad page entry is dropped the same way.
const parseCanvasUpdated = (data: Record<string, unknown>): CanvasUpdatedMessage | undefined => {
	if (
		!isPostedPageId(data.pageId) ||
		typeof data.activeArtboardId !== 'string' ||
		typeof data.cspNonce !== 'string' ||
		!isFiniteNumber(data.generation) ||
		!Array.isArray(data.frames) ||
		!Array.isArray(data.pages)
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
	const pages: PostedPage[] = [];
	for (const entry of data.pages as unknown[]) {
		const page = parsePostedPage(entry);
		if (page !== undefined) {
			pages.push(page);
		}
	}
	return {
		type: 'canvas:updated',
		pageId: data.pageId,
		activeArtboardId: data.activeArtboardId,
		generation: data.generation,
		cspNonce: data.cspNonce,
		frames,
		pages,
	};
};

// A malformed list or error drops all. Entries are not re-checked (rule 04's one cast): the host
// posts only comments that passed parseCommentsFile, where one bad entry fails the whole file
// (posted as `error`, no comments), and routeMessage keeps frames out. A comment's rect is finite
// but not capped at MAX_FRAME_COORDINATE; the panel renders comment text as Svelte text only.
const parseCommentsUpdated = (
	data: Record<string, unknown>,
): CommentsUpdatedMessage | undefined => {
	if (
		!isPostedPageId(data.pageId) ||
		!Array.isArray(data.comments) ||
		!isOptionalString(data.error)
	) {
		return undefined;
	}
	return data.error === undefined
		? {
				type: 'comments:updated',
				pageId: data.pageId,
				comments: data.comments as PostedComment[],
			}
		: {
				type: 'comments:updated',
				pageId: data.pageId,
				comments: data.comments as PostedComment[],
				error: data.error,
			};
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
		if (typeof data.mcpAvailable !== 'boolean' || typeof data.handoffStale !== 'boolean') {
			return undefined;
		}
		return {
			type: 'ui:status',
			mcpAvailable: data.mcpAvailable,
			handoffStale: data.handoffStale,
		};
	}
	if (data.type === 'comments:updated') {
		return parseCommentsUpdated(data);
	}
	if (
		data.type === 'comment:added' ||
		data.type === 'comment:saved' ||
		data.type === 'page:saved'
	) {
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
