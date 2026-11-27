import * as z from 'zod/mini';

import type { ArtboardEdit } from '../disk/artboardEdit';
import type { CommentView } from '../disk/commentViews';
import type { NewComment } from '../disk/commentsFile';
import { isArtboardHash } from '../disk/hash';
import {
	COMMENT_ID_PATTERN,
	EDIT_STYLE_FIELDS,
	HISTORY_STEPS,
	MAX_EDIT_TEXT_CHARS,
	MAX_FRAME_COORDINATE,
	MAX_PAGE_TITLE_CHARS,
	MAX_PICK_TEXT_CHARS,
	MAX_SELECTOR_CHARS,
	isPageId,
} from '../disk/layout';
import { hasControlChars, isRecord, isTagName } from '../webview/frame/frameMessages';
import type {
	ArtboardEditMessage,
	ChromeMessage,
	CommentCreateMessage,
	CommentRequestMessage,
	PageRequestMessage,
	PostedComment,
} from '../webview/hostMessages';

// No `vscode` import, so parsing the panel's untrusted input stays unit-testable.

// z.number() already rejects NaN and ±Infinity.
const coordinate = z.number().check(z.gte(-MAX_FRAME_COORDINATE), z.lte(MAX_FRAME_COORDINATE));

const width = z.number().check(z.gt(0), z.lte(MAX_FRAME_COORDINATE));

const size = z.number().check(z.gte(0), z.lte(MAX_FRAME_COORDINATE));

const placementShape = { x: coordinate, y: coordinate, width };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const noControlChars = z.refine<string>((value) => !hasControlChars(value));

const requestIdField = z.string().check(z.regex(REQUEST_ID_PATTERN));

// Untrusted: the page-id pattern is what keeps `../x` out of a path.
const pageIdField = z.string().check(z.refine(isPageId));

// The pick fields get the cd:pick guards; addComment owns the frame id charset, generation ≥ 1,
// the style allowlist and the body rule (trim, 1..MAX_COMMENT_BODY_CHARS) and their copy.
const commentCreateSchema = z.object({
	type: z.literal('comment:create'),
	requestId: requestIdField,
	pageId: pageIdField,
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
	requestId: requestIdField,
	pageId: pageIdField,
	id: z.string().check(z.regex(COMMENT_ID_PATTERN)),
	body: z.string(),
});

// `sent` is the host's to set, so it fails the parse here.
const commentSetStatusSchema = z.object({
	type: z.literal('comment:set-status'),
	requestId: requestIdField,
	pageId: pageIdField,
	id: z.string().check(z.regex(COMMENT_ID_PATTERN)),
	status: z.enum(['open', 'resolved']),
});

const commentCopySchema = z.object({
	type: z.literal('comment:copy'),
	requestId: requestIdField,
	pageId: pageIdField,
	id: z.string().check(z.regex(COMMENT_ID_PATTERN)),
});

const commentCopyOpenSchema = z.object({
	type: z.literal('comment:copy-open'),
	requestId: requestIdField,
	pageId: pageIdField,
});

// Shape and size only: text encoding, control characters, style value safety and the live text
// compare are the edit core's; the frame id charset and exact file name the disk lib's.
const artboardEditShape = {
	type: z.literal('artboard:edit'),
	requestId: requestIdField,
	pageId: pageIdField,
	frameId: z.string(),
	sourceNumber: z.int().check(z.gte(0), z.lte(Number.MAX_SAFE_INTEGER)),
	hash: z.string().check(z.refine(isArtboardHash)),
};

const editValue = z.string().check(z.maxLength(MAX_EDIT_TEXT_CHARS));

const artboardEditTextSchema = z.object({
	...artboardEditShape,
	field: z.literal('text'),
	value: editValue,
	liveText: editValue,
});

const artboardEditStylesSchema = z.object({
	...artboardEditShape,
	styles: z.array(z.object({ field: z.enum(EDIT_STYLE_FIELDS), value: editValue })).check(
		z.minLength(1),
		z.maxLength(EDIT_STYLE_FIELDS.length),
		z.refine((styles) => new Set(styles.map((change) => change.field)).size === styles.length),
	),
});

// Shape only: the frame id charset is the disk lib's; the host owns the bytes an undo or redo
// writes, so nothing else crosses this boundary.
const artboardHistorySchema = z.object({
	type: z.literal('artboard:history'),
	requestId: requestIdField,
	pageId: pageIdField,
	frameId: z.string(),
	step: z.enum(HISTORY_STEPS),
});

// page:* pageId is the target page, not a page-bound staged page.
const pageOpenSchema = z.object({
	type: z.literal('page:open'),
	requestId: requestIdField,
	pageId: pageIdField,
});

const pageCreateSchema = z.object({
	type: z.literal('page:create'),
	requestId: requestIdField,
});

// A size cap only: the trim and title rule are parsePageTitle's at the disk boundary.
const pageRenameSchema = z.object({
	type: z.literal('page:rename'),
	requestId: requestIdField,
	pageId: pageIdField,
	title: z.string().check(z.maxLength(MAX_PAGE_TITLE_CHARS * 4)),
});

const pageDeleteSchema = z.object({
	type: z.literal('page:delete'),
	requestId: requestIdField,
	pageId: pageIdField,
});

// The artboard id charset is enforced by placeFrame's parseArtboardId. Both edit variants share
// `type`, so they sit beside the discriminated union; text is tried first and unknown keys are
// stripped, so a message with the text fields and `styles` parses as text.
// Exported for tests: chromeMessages.test.ts checks its output type both ways against ChromeMessage.
/** @internal */
export const chromeMessageSchema = z.union([
	z.discriminatedUnion('type', [
		z.object({ type: z.literal('artboard:ready') }),
		z.object({
			type: z.literal('frame:place'),
			pageId: pageIdField,
			id: z.string(),
			...placementShape,
			base: z.object(placementShape),
		}),
		commentCreateSchema,
		commentReplySchema,
		commentSetStatusSchema,
		commentCopySchema,
		commentCopyOpenSchema,
		artboardHistorySchema,
		pageOpenSchema,
		pageCreateSchema,
		pageRenameSchema,
		pageDeleteSchema,
	]),
	artboardEditTextSchema,
	artboardEditStylesSchema,
]);

// Unknown `type`, a non-object, or any failing field returns undefined; never throws.
export const parseChromeMessage = (value: unknown): ChromeMessage | undefined => {
	const parsed = chromeMessageSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

const claimsType = (
	value: unknown,
	type: ChromeMessage['type'],
): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && 'type' in value && value.type === type;

// Valid or not: every claimed attempt gets an answer.
export const isFramePlaceAttempt = (value: unknown): boolean => claimsType(value, 'frame:place');

export const isArtboardEditAttempt = (value: unknown): boolean =>
	claimsType(value, 'artboard:edit');

export const isArtboardHistoryAttempt = (value: unknown): boolean =>
	claimsType(value, 'artboard:history');

// Read before any parse, so a request that fails it can still be answered. Undefined: nothing to
// answer to.
export const claimedRequestId = (value: unknown): string | undefined => {
	const requestId =
		value !== null && typeof value === 'object' && 'requestId' in value
			? value.requestId
			: undefined;
	return typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId)
		? requestId
		: undefined;
};

// Records, not lists: `satisfies` fails the build when a request type is added to or removed from
// the message union without this table.
const COMMENT_REQUEST_TYPES = {
	'comment:create': true,
	'comment:reply': true,
	'comment:set-status': true,
	'comment:copy': true,
	'comment:copy-open': true,
} satisfies Record<CommentRequestMessage['type'], true>;

const PAGE_REQUEST_TYPES = {
	'page:open': true,
	'page:create': true,
	'page:rename': true,
	'page:delete': true,
} satisfies Record<PageRequestMessage['type'], true>;

const claimedTypeIn = <Type extends string>(
	types: Record<Type, true>,
	type: unknown,
): type is Type => typeof type === 'string' && Object.hasOwn(types, type);

// Valid or not, read before any parse, so every attempt gets an answer. Undefined: not a comment
// request.
export const commentRequestType = (value: unknown): CommentRequestMessage['type'] | undefined => {
	const type = isRecord(value) ? value.type : undefined;
	return claimedTypeIn(COMMENT_REQUEST_TYPES, type) ? type : undefined;
};

// Valid or not, read before any parse, so every attempt gets an answer. Undefined: not a page
// request.
export const pageRequestType = (value: unknown): PageRequestMessage['type'] | undefined => {
	const type = isRecord(value) ? value.type : undefined;
	return claimedTypeIn(PAGE_REQUEST_TYPES, type) ? type : undefined;
};

// The edit core's union, built key by key: nothing else of the message reaches it.
export const toArtboardEdit = (message: ArtboardEditMessage): ArtboardEdit =>
	'styles' in message
		? { sourceNumber: message.sourceNumber, styles: message.styles }
		: {
				sourceNumber: message.sourceNumber,
				field: 'text',
				value: message.value,
				liveText: message.liveText,
			};

// Pin = point / unclipped box, never the (maybe clipped or null) rect. A zero-size box pins at 0,
// not NaN (addComment clamps 0..1 but leaves NaN). A non-page null rect is left for addComment to
// reject; the chrome never sends one.
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
