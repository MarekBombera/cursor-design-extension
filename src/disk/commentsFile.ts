import * as z from 'zod/mini';

import {
	CorruptCommentsError,
	InvalidArgsError,
	InvalidArtboardIdError,
	UnsupportedCommentsVersionError,
} from './errors';
import { isArtboardHash, normalizeHash } from './hash';
import {
	COMMENTS_SCHEMA_VERSION,
	COMMENT_ID_PATTERN,
	COMMENT_STYLE_KEYS,
	MAX_COMMENT_BODY_CHARS,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	MAX_PICK_TEXT_CHARS,
	MAX_SELECTOR_CHARS,
	commentsPathSegments,
} from './layout';
import { readUtf8IfExists, workspaceLayoutFile, writeUtf8 } from './layoutFs';
import { isJsonRecord, parseArtboardId } from './parse';
import {
	type CommentStyles,
	hasControlChars,
	isSafeStyleValue,
	isTagName,
} from '../webview/frame/frameMessages';

export type CommentStatus = 'open' | 'sent' | 'resolved';

type CommentReply = {
	id: string;
	author: 'user' | 'agent';
	body: string;
	createdAt: string;
};

type CommentRect = { x: number; y: number; width: number; height: number };

type CommentPin = { x: number; y: number };

export type Comment = {
	id: string;
	frameId: string;
	artboard: string;
	version: number;
	selector: string;
	tagName: string;
	text: string;
	rect: CommentRect | null;
	pin: CommentPin;
	styles: CommentStyles;
	body: string;
	isPage: boolean;
	targetFingerprint?: string;
	status: CommentStatus;
	createdAt: string;
	replies: CommentReply[];
};

export type CommentsFile = {
	version: typeof COMMENTS_SCHEMA_VERSION;
	comments: Comment[];
};

export type NewComment = {
	frameId: string;
	generation: number;
	selector: string;
	tagName: string;
	text: string;
	rect: CommentRect | null;
	pin: CommentPin;
	styles: CommentStyles;
	body: string;
	isPage: boolean;
};

const COMMENT_FIELDS_INVALID_MESSAGE = 'Comment fields are invalid. Pick the element again.';

export const COMMENT_BODY_MESSAGE = `Comment text must be 1 to ${MAX_COMMENT_BODY_CHARS} characters.`;

const isStyleKey = (key: string): key is (typeof COMMENT_STYLE_KEYS)[number] =>
	(COMMENT_STYLE_KEYS as readonly string[]).includes(key);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const filterStyles = (value: Record<string, unknown>): CommentStyles => {
	const styles: CommentStyles = {};
	for (const [key, style] of Object.entries(value)) {
		if (isStyleKey(key) && typeof style === 'string' && isSafeStyleValue(style)) {
			styles[key] = style;
		}
	}
	return styles;
};

const commentIdString = z.string().check(z.regex(COMMENT_ID_PATTERN));

const finiteNumber = z.number().check(z.refine(Number.isFinite));

const pickTextString = z.string().check(
	z.maxLength(MAX_PICK_TEXT_CHARS),
	z.refine((value) => !hasControlChars(value)),
);

const artboardLabelString = z.string().check(
	z.minLength(1),
	z.maxLength(MAX_PICK_TEXT_CHARS),
	z.refine((value) => !hasControlChars(value)),
);

const selectorString = z.string().check(
	z.minLength(1),
	z.maxLength(MAX_SELECTOR_CHARS),
	z.refine((value) => !hasControlChars(value)),
);

const tagNameString = z.string().check(z.refine(isTagName));

const createdAtString = z.string().check(z.refine((value) => !Number.isNaN(Date.parse(value))));

const commentBodyString = z.string().check(z.minLength(1), z.maxLength(MAX_COMMENT_BODY_CHARS));

const rectSchema = z.object({
	x: finiteNumber,
	y: finiteNumber,
	width: finiteNumber.check(z.gte(0)),
	height: finiteNumber.check(z.gte(0)),
});

const pinSchema = z.object({
	x: finiteNumber,
	y: finiteNumber,
});

const replySchema = z.object({
	id: commentIdString,
	author: z.union([z.literal('user'), z.literal('agent')]),
	body: commentBodyString,
	createdAt: createdAtString,
});

// The fields a pick contributes: the same rules for a stored comment and for addComment's input.
const target = {
	frameId: z.string(),
	selector: selectorString,
	tagName: tagNameString,
	text: pickTextString,
	rect: z.nullable(rectSchema),
	pin: pinSchema,
	styles: z.record(z.string(), z.string()),
	body: commentBodyString,
	isPage: z.boolean(),
};

const targetSchema = z.object(target);

// Key order of this shape is the serialized key order; zod output follows it.
const commentSchema = z.object({
	id: commentIdString,
	frameId: target.frameId,
	artboard: artboardLabelString,
	version: z.int().check(z.gte(1)),
	selector: target.selector,
	tagName: target.tagName,
	text: target.text,
	rect: target.rect,
	pin: target.pin,
	styles: target.styles,
	body: target.body,
	isPage: target.isPage,
	targetFingerprint: z.optional(z.string().check(z.refine(isArtboardHash))),
	status: z.union([z.literal('open'), z.literal('sent'), z.literal('resolved')]),
	createdAt: createdAtString,
	replies: z.array(replySchema).check(z.maxLength(MAX_COMMENT_REPLIES)),
});

type TargetFields = z.infer<typeof targetSchema>;

const toPrettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const emptyCommentsFile = (): CommentsFile => ({
	version: COMMENTS_SCHEMA_VERSION,
	comments: [],
});

// Key order for a comment assembled in addComment; parsed comments already follow the schema.
export const orderedComment = (comment: Comment): Comment => ({
	id: comment.id,
	frameId: comment.frameId,
	artboard: comment.artboard,
	version: comment.version,
	selector: comment.selector,
	tagName: comment.tagName,
	text: comment.text,
	rect: comment.rect,
	pin: comment.pin,
	styles: comment.styles,
	body: comment.body,
	isPage: comment.isPage,
	...(comment.targetFingerprint === undefined
		? {}
		: { targetFingerprint: comment.targetFingerprint }),
	status: comment.status,
	createdAt: comment.createdAt,
	replies: comment.replies,
});

const clampedPin = (value: unknown): unknown =>
	isJsonRecord(value)
		? {
				x: typeof value.x === 'number' && Number.isFinite(value.x) ? clamp01(value.x) : value.x,
				y: typeof value.y === 'number' && Number.isFinite(value.y) ? clamp01(value.y) : value.y,
			}
		: value;

// The lenient part of the target rules, shared by parse and add: trim the body, drop unknown or
// unsafe style entries, clamp the pin. Undefined when frameId or styles cannot be used at all.
const preparedTarget = (value: Record<string, unknown>): Record<string, unknown> | undefined => {
	if (!isJsonRecord(value.styles)) {
		return undefined;
	}
	try {
		parseArtboardId(value.frameId);
	} catch (error: unknown) {
		if (error instanceof InvalidArtboardIdError) {
			return undefined;
		}
		throw error;
	}
	return {
		...value,
		body: typeof value.body === 'string' ? value.body.trim() : value.body,
		styles: filterStyles(value.styles),
		pin: clampedPin(value.pin),
	};
};

// Page comments target the whole frame: body selector, no rect; element comments need a rect.
const hasConsistentTarget = ({
	isPage,
	selector,
	tagName,
	rect,
}: Pick<TargetFields, 'isPage' | 'selector' | 'tagName' | 'rect'>): boolean =>
	isPage ? selector === 'body' && tagName === 'body' && rect === null : rect !== null;

const parseComment = (value: unknown): Comment => {
	const prepared = isJsonRecord(value) ? preparedTarget(value) : undefined;
	if (prepared === undefined) {
		throw new CorruptCommentsError();
	}
	const parsed = commentSchema.safeParse({
		...prepared,
		targetFingerprint:
			typeof prepared.targetFingerprint === 'string' && isArtboardHash(prepared.targetFingerprint)
				? normalizeHash(prepared.targetFingerprint)
				: prepared.targetFingerprint,
		replies: Array.isArray(prepared.replies)
			? prepared.replies.map((reply: unknown) =>
					isJsonRecord(reply) && typeof reply.body === 'string'
						? { ...reply, body: reply.body.trim() }
						: reply,
				)
			: prepared.replies,
	});
	if (!parsed.success) {
		throw new CorruptCommentsError({ cause: parsed.error });
	}
	const comment = parsed.data;
	const replyIds = new Set(comment.replies.map((reply) => reply.id));
	if (
		replyIds.size !== comment.replies.length ||
		!hasConsistentTarget(comment) ||
		(comment.isPage && comment.targetFingerprint !== undefined)
	) {
		throw new CorruptCommentsError();
	}
	return comment;
};

export const parseCommentsFile = (value: unknown): CommentsFile => {
	if (!isJsonRecord(value)) {
		throw new CorruptCommentsError();
	}
	if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
		throw new CorruptCommentsError();
	}
	if (value.version !== COMMENTS_SCHEMA_VERSION) {
		throw new UnsupportedCommentsVersionError(value.version);
	}
	if (!Array.isArray(value.comments) || value.comments.length > MAX_COMMENTS) {
		throw new CorruptCommentsError();
	}
	const seenIds = new Set<string>();
	const comments = value.comments.map((rawComment: unknown) => {
		const comment = parseComment(rawComment);
		if (seenIds.has(comment.id)) {
			throw new CorruptCommentsError();
		}
		seenIds.add(comment.id);
		return comment;
	});
	return { version: COMMENTS_SCHEMA_VERSION, comments };
};

export const serializeCommentsFile = (file: CommentsFile): string =>
	toPrettyJson({ version: COMMENTS_SCHEMA_VERSION, comments: file.comments });

export const readCommentsFile = async (workspaceRoot: string): Promise<CommentsFile> => {
	const text = await readUtf8IfExists(workspaceLayoutFile(workspaceRoot, commentsPathSegments));
	if (text === undefined) {
		return emptyCommentsFile();
	}
	if (text.length === 0) {
		throw new CorruptCommentsError();
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptCommentsError({ cause: error });
	}
	return parseCommentsFile(parsedJson);
};

export const commentsTextIfExists = async (workspaceRoot: string): Promise<string | undefined> =>
	readUtf8IfExists(workspaceLayoutFile(workspaceRoot, commentsPathSegments));

export const writeCommentsFile = async (
	workspaceRoot: string,
	file: CommentsFile,
): Promise<void> => {
	await writeUtf8({
		...workspaceLayoutFile(workspaceRoot, commentsPathSegments),
		contents: serializeCommentsFile(file),
	});
};

export const validateNewComment = (comment: NewComment): TargetFields => {
	const body = typeof comment.body === 'string' ? comment.body.trim() : '';
	if (body.length === 0 || body.length > MAX_COMMENT_BODY_CHARS) {
		throw new InvalidArgsError(COMMENT_BODY_MESSAGE);
	}
	const prepared = isJsonRecord(comment) ? preparedTarget({ ...comment, body }) : undefined;
	const parsed = prepared === undefined ? undefined : targetSchema.safeParse(prepared);
	if (
		parsed === undefined ||
		!parsed.success ||
		!hasConsistentTarget(parsed.data) ||
		!Number.isInteger(comment.generation) ||
		comment.generation < 1
	) {
		throw new InvalidArgsError(COMMENT_FIELDS_INVALID_MESSAGE, {
			cause: parsed === undefined || parsed.success ? undefined : parsed.error,
		});
	}
	return parsed.data;
};
