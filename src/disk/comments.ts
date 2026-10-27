import * as z from 'zod/mini';

import { readArtboard } from './artboardFs';
import {
	type CommentDocument,
	type CommentFlags,
	commentFlags,
	matchCommentTarget,
	parseArtboardDocument,
	targetAgrees,
} from './commentTarget';
import {
	CommentNotFoundError,
	CommentResolvedError,
	CorruptCommentsError,
	DiskError,
	InvalidArgsError,
	InvalidArtboardIdError,
	PickOutdatedError,
	UnsupportedCommentsVersionError,
} from './errors';
import { isArtboardHash, normalizeHash } from './hash';
import {
	COMMENTS_SCHEMA_VERSION,
	COMMENT_STYLE_KEYS,
	MAX_COMMENT_BODY_CHARS,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	MAX_PICK_TEXT_CHARS,
	MAX_SELECTOR_CHARS,
	artboardHtmlPathSegments,
	commentsPathSegments,
} from './layout';
import {
	assertLayoutDirsOwned,
	layoutEntryKind,
	readStoredMeta,
	readUtf8IfExists,
	workspaceJoin,
	workspaceLayoutFile,
	writeUtf8,
} from './layoutFs';
import { isJsonRecord, parseArtboardId } from './parse';
import { withWorkspaceLock } from './workspaceLock';
import {
	type CommentStyles,
	hasControlChars,
	isSafeStyleValue,
	isTagName,
} from '../webview/frame/frameMessages';

type CommentStatus = 'open' | 'sent' | 'resolved';

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

export type CommentView = Comment & CommentFlags;

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

const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const COMMENT_FIELDS_INVALID_MESSAGE = 'Comment fields are invalid. Pick the element again.';

const COMMENT_BODY_MESSAGE = `Comment text must be 1 to ${MAX_COMMENT_BODY_CHARS} characters.`;

const COMMENT_COUNT_MESSAGE = `comments.json already holds ${MAX_COMMENTS} comments. Remove resolved comments from .cursor-design/comments.json, then retry.`;

const USER_REPLY_CAP_MESSAGE = 'This comment has the maximum number of replies.';

const THREAD_FULL_MESSAGE =
	"This comment's thread is full. Ask the user to resolve it in the panel.";

const NOTE_MESSAGE = `note must be a one-line description of what you changed, 1 to ${MAX_COMMENT_BODY_CHARS} characters.`;

const SET_STATUS_MESSAGE = 'status must be open or resolved.';

const LIST_STATUS_MESSAGE =
	'status must be open, sent, or resolved. Omit it for all unresolved comments.';

const COMMENT_ID_MESSAGE = 'id must be a comment id string from list_comments.';

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
const orderedComment = (comment: Comment): Comment => ({
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

const commentsTextIfExists = async (workspaceRoot: string): Promise<string | undefined> =>
	readUtf8IfExists(workspaceLayoutFile(workspaceRoot, commentsPathSegments));

const writeCommentsFile = async (workspaceRoot: string, file: CommentsFile): Promise<void> => {
	await writeUtf8({
		...workspaceLayoutFile(workspaceRoot, commentsPathSegments),
		contents: serializeCommentsFile(file),
	});
};

const requireCommentId = (id: unknown): string => {
	if (typeof id !== 'string') {
		throw new InvalidArgsError(COMMENT_ID_MESSAGE);
	}
	return id;
};

const requireCommentBody = (body: unknown): string => {
	if (typeof body !== 'string') {
		throw new InvalidArgsError(COMMENT_BODY_MESSAGE);
	}
	const trimmed = body.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_COMMENT_BODY_CHARS) {
		throw new InvalidArgsError(COMMENT_BODY_MESSAGE);
	}
	return trimmed;
};

const requireNote = (note: unknown): string => {
	if (typeof note !== 'string') {
		throw new InvalidArgsError(NOTE_MESSAGE);
	}
	const trimmed = note.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_COMMENT_BODY_CHARS) {
		throw new InvalidArgsError(NOTE_MESSAGE);
	}
	return trimmed;
};

const findComment = (file: CommentsFile, id: string): Comment => {
	const comment = file.comments.find((entry) => entry.id === id);
	if (comment === undefined) {
		throw new CommentNotFoundError();
	}
	return comment;
};

const replaceComment = (file: CommentsFile, next: Comment): CommentsFile => ({
	version: COMMENTS_SCHEMA_VERSION,
	comments: file.comments.map((entry) => (entry.id === next.id ? next : entry)),
});

const artboardLabel = (title: string, frameId: string): string => {
	const source = title === '' ? frameId : title;
	return source.replace(/[\p{Cc}\u2028\u2029]/gu, ' ').slice(0, MAX_PICK_TEXT_CHARS);
};

const validateNewComment = (comment: NewComment): TargetFields => {
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

const logTargetReadError = (error: unknown): void => {
	process.stderr.write(
		`cursor-design: comment target read failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
};

const loadArtboardDocument = async (
	workspaceRoot: string,
	frameId: string,
): Promise<CommentDocument> => {
	try {
		const html = await readUtf8IfExists(
			workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(frameId)),
		);
		if (html === undefined) {
			return 'missing';
		}
		return parseArtboardDocument(html);
	} catch (error: unknown) {
		if (error instanceof DiskError) {
			logTargetReadError(error);
			return 'unreadable';
		}
		throw error;
	}
};

const loadFramePresence = async (
	workspaceRoot: string,
	frameId: string,
): Promise<CommentDocument> => {
	const kind = await layoutEntryKind(
		workspaceJoin(workspaceRoot, artboardHtmlPathSegments(frameId)),
	);
	if (kind === 'missing') {
		return 'missing';
	}
	if (kind === 'file') {
		return 'present';
	}
	return 'unreadable';
};

// Parse only frames a fingerprinted element comment needs; every other comment needs only to know
// whether its frame file still exists.
// ponytail: one css-select pass per distinct selector per call, each bounded by the commentTarget
// caps (~0.2 s worst case), so 500 distinct hostile selectors on one capped page could take ~100 s.
// Upgrade path: a per-call time budget that reports the rest unchecked.
const documentsFor = async (
	workspaceRoot: string,
	comments: readonly Comment[],
): Promise<Map<string, CommentDocument>> => {
	const parseIds = new Set<string>();
	const presenceIds = new Set<string>();
	for (const comment of comments) {
		if (!comment.isPage && comment.targetFingerprint !== undefined) {
			parseIds.add(comment.frameId);
		} else {
			presenceIds.add(comment.frameId);
		}
	}
	const documents = new Map<string, CommentDocument>();
	for (const frameId of parseIds) {
		documents.set(frameId, await loadArtboardDocument(workspaceRoot, frameId));
	}
	for (const frameId of presenceIds) {
		if (!documents.has(frameId)) {
			documents.set(frameId, await loadFramePresence(workspaceRoot, frameId));
		}
	}
	return documents;
};

const withCommentViews = async (
	workspaceRoot: string,
	comments: Comment[],
): Promise<CommentView[]> => {
	const documents = await documentsFor(workspaceRoot, comments);
	return comments.map((comment) => ({
		...comment,
		...commentFlags({ target: comment, document: documents.get(comment.frameId) ?? 'missing' }),
	}));
};

export const addComment = async ({
	workspaceRoot,
	comment,
}: {
	workspaceRoot: string;
	comment: NewComment;
}): Promise<Comment> => {
	await assertLayoutDirsOwned(workspaceRoot);
	const fields = validateNewComment(comment);
	const read = await readArtboard({ workspaceRoot, artboardId: fields.frameId });
	if (comment.generation !== read.generation) {
		throw new PickOutdatedError(fields.frameId);
	}
	let targetFingerprint: string | undefined;
	if (!fields.isPage) {
		const match = matchCommentTarget({
			document: parseArtboardDocument(read.html),
			selector: fields.selector,
		});
		if (
			targetAgrees({ match, tagName: fields.tagName, text: fields.text }) &&
			match.checkable &&
			match.fingerprint !== undefined
		) {
			targetFingerprint = match.fingerprint;
		}
	}
	const storedMeta = await readStoredMeta(workspaceRoot, fields.frameId);
	const next = orderedComment({
		...fields,
		id: crypto.randomUUID(),
		artboard: artboardLabel(storedMeta?.title ?? '', fields.frameId),
		version: comment.generation,
		targetFingerprint,
		status: 'open',
		createdAt: new Date().toISOString(),
		replies: [],
	});
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const file = await readCommentsFile(workspaceRoot);
			if (file.comments.length >= MAX_COMMENTS) {
				throw new InvalidArgsError(COMMENT_COUNT_MESSAGE);
			}
			const written = {
				version: COMMENTS_SCHEMA_VERSION,
				comments: [...file.comments, next],
			};
			await writeCommentsFile(workspaceRoot, written);
			return next;
		},
	});
};

export const replyToComment = async ({
	workspaceRoot,
	id,
	body,
}: {
	workspaceRoot: string;
	id: unknown;
	body: unknown;
}): Promise<Comment> => {
	const commentId = requireCommentId(id);
	const trimmed = requireCommentBody(body);
	await assertLayoutDirsOwned(workspaceRoot);
	if ((await commentsTextIfExists(workspaceRoot)) === undefined) {
		throw new CommentNotFoundError();
	}
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const file = await readCommentsFile(workspaceRoot);
			const current = findComment(file, commentId);
			if (current.replies.length >= MAX_COMMENT_REPLIES - 1) {
				throw new InvalidArgsError(USER_REPLY_CAP_MESSAGE);
			}
			const next: Comment = {
				...current,
				replies: [
					...current.replies,
					{
						id: crypto.randomUUID(),
						author: 'user',
						body: trimmed,
						createdAt: new Date().toISOString(),
					},
				],
			};
			await writeCommentsFile(workspaceRoot, replaceComment(file, next));
			return next;
		},
	});
};

export const setCommentStatus = async ({
	workspaceRoot,
	id,
	status,
}: {
	workspaceRoot: string;
	id: unknown;
	status: unknown;
}): Promise<Comment> => {
	if (status !== 'open' && status !== 'resolved') {
		throw new InvalidArgsError(SET_STATUS_MESSAGE);
	}
	const commentId = requireCommentId(id);
	await assertLayoutDirsOwned(workspaceRoot);
	if ((await commentsTextIfExists(workspaceRoot)) === undefined) {
		throw new CommentNotFoundError();
	}
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const file = await readCommentsFile(workspaceRoot);
			const current = findComment(file, commentId);
			const nextStatus: CommentStatus | undefined =
				status === 'resolved' && (current.status === 'open' || current.status === 'sent')
					? 'resolved'
					: status === 'open' && current.status === 'resolved'
						? 'open'
						: undefined;
			if (nextStatus === undefined) {
				return current;
			}
			const next: Comment = { ...current, status: nextStatus };
			await writeCommentsFile(workspaceRoot, replaceComment(file, next));
			return next;
		},
	});
};

export const markCommentsSent = async ({
	workspaceRoot,
	ids,
}: {
	workspaceRoot: string;
	ids: readonly string[];
}): Promise<Comment[]> => {
	await assertLayoutDirsOwned(workspaceRoot);
	if ((await commentsTextIfExists(workspaceRoot)) === undefined) {
		return [];
	}
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const file = await readCommentsFile(workspaceRoot);
			const marked: Comment[] = [];
			const comments = file.comments.map((comment) => {
				if (comment.status === 'open' && ids.includes(comment.id)) {
					const next: Comment = { ...comment, status: 'sent' };
					marked.push(next);
					return next;
				}
				return comment;
			});
			if (marked.length === 0) {
				return [];
			}
			await writeCommentsFile(workspaceRoot, { version: COMMENTS_SCHEMA_VERSION, comments });
			return marked;
		},
	});
};

export const resolveComment = async ({
	workspaceRoot,
	id,
	note,
}: {
	workspaceRoot: string;
	id: unknown;
	note: unknown;
}): Promise<Comment> => {
	const commentId = requireCommentId(id);
	const trimmed = requireNote(note);
	await assertLayoutDirsOwned(workspaceRoot);
	if ((await commentsTextIfExists(workspaceRoot)) === undefined) {
		throw new CommentNotFoundError();
	}
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const file = await readCommentsFile(workspaceRoot);
			const current = findComment(file, commentId);
			if (current.status === 'resolved') {
				throw new CommentResolvedError();
			}
			if (current.replies.length >= MAX_COMMENT_REPLIES) {
				throw new InvalidArgsError(THREAD_FULL_MESSAGE);
			}
			const next: Comment = {
				...current,
				status: 'resolved',
				replies: [
					...current.replies,
					{
						id: crypto.randomUUID(),
						author: 'agent',
						body: trimmed,
						createdAt: new Date().toISOString(),
					},
				],
			};
			await writeCommentsFile(workspaceRoot, replaceComment(file, next));
			return next;
		},
	});
};

export const listComments = async ({
	workspaceRoot,
	status,
}: {
	workspaceRoot: string;
	status?: unknown;
}): Promise<{ comments: CommentView[] }> => {
	if (status !== undefined && status !== 'open' && status !== 'sent' && status !== 'resolved') {
		throw new InvalidArgsError(LIST_STATUS_MESSAGE);
	}
	await assertLayoutDirsOwned(workspaceRoot);
	const file = await readCommentsFile(workspaceRoot);
	const comments =
		status === undefined
			? file.comments.filter((comment) => comment.status !== 'resolved')
			: file.comments.filter((comment) => comment.status === status);
	return { comments: await withCommentViews(workspaceRoot, comments) };
};

// The panel's read: every stored comment, resolved included, without flags (8f2 adds them).
export const readComments = async ({
	workspaceRoot,
}: {
	workspaceRoot: string;
}): Promise<Comment[]> => {
	await assertLayoutDirsOwned(workspaceRoot);
	return (await readCommentsFile(workspaceRoot)).comments;
};

export const getComment = async ({
	workspaceRoot,
	id,
}: {
	workspaceRoot: string;
	id: unknown;
}): Promise<CommentView> => {
	const commentId = requireCommentId(id);
	await assertLayoutDirsOwned(workspaceRoot);
	if ((await commentsTextIfExists(workspaceRoot)) === undefined) {
		throw new CommentNotFoundError();
	}
	const file = await readCommentsFile(workspaceRoot);
	const comment = findComment(file, commentId);
	const [view] = await withCommentViews(workspaceRoot, [comment]);
	if (view === undefined) {
		throw new CommentNotFoundError();
	}
	return view;
};
