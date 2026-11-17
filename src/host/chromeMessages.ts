import * as z from 'zod/mini';

import type { CommentView, NewComment } from '../disk/comments';
import { CommentNotFoundError, toSafeArtboardErrorMessage } from '../disk/errors';
import {
	COMMENT_ID_PATTERN,
	MAX_FRAME_COORDINATE,
	MAX_PICK_TEXT_CHARS,
	MAX_SELECTOR_CHARS,
} from '../disk/layout';
import { hasControlChars, isTagName } from '../webview/frame/frameMessages';
import type {
	ChromeMessage,
	CommentCreateMessage,
	CommentRequestMessage,
	PostedComment,
} from '../webview/hostMessages';

// No `vscode` import: the panel's untrusted chrome → host input is parsed here, and the chrome ↔
// host mapping lives here, so both stay unit-testable.

// z.number() already rejects NaN and ±Infinity.
const coordinate = z.number().check(z.gte(-MAX_FRAME_COORDINATE), z.lte(MAX_FRAME_COORDINATE));

const width = z.number().check(z.gt(0), z.lte(MAX_FRAME_COORDINATE));

const size = z.number().check(z.gte(0), z.lte(MAX_FRAME_COORDINATE));

const placementShape = { x: coordinate, y: coordinate, width };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const noControlChars = z.refine<string>((value) => !hasControlChars(value));

// The pick fields get the cd:pick guards; addComment owns the frame id charset, generation ≥ 1,
// the style allowlist and the body rule (trim, 1..MAX_COMMENT_BODY_CHARS) and their copy.
const commentCreateSchema = z.object({
	type: z.literal('comment:create'),
	requestId: z.string().check(z.regex(REQUEST_ID_PATTERN)),
	frameId: z.string(),
	generation: z.int().check(z.gte(0)),
	selector: z.string().check(z.minLength(1), z.maxLength(MAX_SELECTOR_CHARS), noControlChars),
	tagName: z.string().check(z.refine(isTagName)),
	text: z.string().check(z.maxLength(MAX_PICK_TEXT_CHARS), noControlChars),
	rect: z.nullable(z.object({ x: coordinate, y: coordinate, width: size, height: size })),
	point: z.object({ x: size, y: size }),
	box: z.object({ width: size, height: size }),
	styles: z.record(z.string(), z.string()),
	isPage: z.boolean(),
	body: z.string(),
});

// The body rule (trim, 1..MAX_COMMENT_BODY_CHARS) is the disk lib's, before it takes the lock.
const commentReplySchema = z.object({
	type: z.literal('comment:reply'),
	requestId: z.string().check(z.regex(REQUEST_ID_PATTERN)),
	id: z.string().check(z.regex(COMMENT_ID_PATTERN)),
	body: z.string(),
});

// `sent` is the host's to set (8h), so it fails the parse here.
const commentSetStatusSchema = z.object({
	type: z.literal('comment:set-status'),
	requestId: z.string().check(z.regex(REQUEST_ID_PATTERN)),
	id: z.string().check(z.regex(COMMENT_ID_PATTERN)),
	status: z.enum(['open', 'resolved']),
});

// The artboard id charset is enforced by placeFrame's parseArtboardId.
const chromeMessageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('artboard:ready') }),
	z.object({
		type: z.literal('frame:place'),
		id: z.string(),
		...placementShape,
		base: z.object(placementShape),
	}),
	commentCreateSchema,
	commentReplySchema,
	commentSetStatusSchema,
]);

// Unknown `type`, a non-object, or any failing field returns undefined; never throws.
export const parseChromeMessage = (value: unknown): ChromeMessage | undefined => {
	const parsed = chromeMessageSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

const claimsType = (value: unknown, type: string): value is Record<string, unknown> =>
	value !== null &&
	typeof value === 'object' &&
	'type' in value &&
	(value as { type: unknown }).type === type;

// True for anything that claims to be frame:place, valid or not, so every attempt gets an answer.
export const isFramePlaceAttempt = (value: unknown): boolean => claimsType(value, 'frame:place');

const COMMENT_REQUEST_TYPES: readonly CommentRequestMessage['type'][] = [
	'comment:create',
	'comment:reply',
	'comment:set-status',
];

// The claimed raw type of a comment request, valid or not (read before any parse), so every attempt
// gets an answer. Undefined: not a comment request.
export const commentRequestType = (value: unknown): CommentRequestMessage['type'] | undefined =>
	COMMENT_REQUEST_TYPES.find((type) => claimsType(value, type));

// The id to answer, even when another field fails the full parse. Undefined: nothing to answer to.
export const commentRequestId = (value: unknown): string | undefined => {
	const requestId =
		commentRequestType(value) === undefined
			? undefined
			: (value as { requestId?: unknown }).requestId;
	return typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId)
		? requestId
		: undefined;
};

export const CREATE_FALLBACK_MESSAGE =
	'Could not add the comment. Check the Output panel: Cursor Design.';

export const MALFORMED_CREATE_MESSAGE = 'Could not add the comment. Pick the element again.';

export const CHANGE_FALLBACK_MESSAGE =
	'Could not save the change. Check the Output panel: Cursor Design.';

export const MALFORMED_CHANGE_MESSAGE = 'Could not save the change. Try again.';

export const COMMENT_GONE_MESSAGE = 'This comment no longer exists.';

export const malformedRequestMessage = (type: CommentRequestMessage['type']): string =>
	type === 'comment:create' ? MALFORMED_CREATE_MESSAGE : MALFORMED_CHANGE_MESSAGE;

// The panel's own copy: the Agent copy of CommentNotFoundError says to call list_comments.
export const commentRequestErrorMessage = ({
	type,
	error,
}: {
	type: CommentRequestMessage['type'];
	error: unknown;
}): string =>
	error instanceof CommentNotFoundError
		? COMMENT_GONE_MESSAGE
		: toSafeArtboardErrorMessage(
				error,
				type === 'comment:create' ? CREATE_FALLBACK_MESSAGE : CHANGE_FALLBACK_MESSAGE,
			);

// The pin is the point as a fraction of the unclipped box, never of the (maybe clipped or null)
// rect. A zero-size box pins at 0 instead of NaN (addComment clamps the pin to 0..1 but leaves
// NaN alone). A non-page null rect passes through for
// addComment to reject; the chrome never sends one.
export const toNewComment = (message: CommentCreateMessage): NewComment => ({
	frameId: message.frameId,
	generation: message.generation,
	selector: message.selector,
	tagName: message.tagName,
	text: message.text,
	rect: message.isPage ? null : message.rect,
	pin: {
		x: message.box.width > 0 ? message.point.x / message.box.width : 0,
		y: message.box.height > 0 ? message.point.y / message.box.height : 0,
	},
	styles: message.styles,
	body: message.body,
	isPage: message.isPage,
});

// An explicit pick, never a spread: artboard, version, styles and targetFingerprint stay on disk,
// and the flag hint is Agent copy, not panel copy.
export const toPostedComment = (comment: CommentView): PostedComment => ({
	id: comment.id,
	frameId: comment.frameId,
	selector: comment.selector,
	tagName: comment.tagName,
	text: comment.text,
	rect:
		comment.rect === null
			? null
			: {
					x: comment.rect.x,
					y: comment.rect.y,
					width: comment.rect.width,
					height: comment.rect.height,
				},
	pin: { x: comment.pin.x, y: comment.pin.y },
	body: comment.body,
	isPage: comment.isPage,
	status: comment.status,
	createdAt: comment.createdAt,
	replies: comment.replies.map((reply) => ({
		id: reply.id,
		author: reply.author,
		body: reply.body,
		createdAt: reply.createdAt,
	})),
	stale: comment.stale,
	targetMissing: comment.targetMissing,
});
