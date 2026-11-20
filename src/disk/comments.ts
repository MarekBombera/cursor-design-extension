import { readArtboard } from './artboardFs';
import { type CommentView, withCommentViews } from './commentViews';
import { matchCommentTarget, parseArtboardDocument, targetAgrees } from './commentTarget';
import {
	COMMENT_BODY_MESSAGE,
	type CommentStatus,
	type NewComment,
	commentsTextIfExists,
	orderedComment,
	readCommentsFile,
	validateNewComment,
	writeCommentsFile,
	type Comment,
	type CommentsFile,
} from './commentsFile';
import {
	CommentNotFoundError,
	CommentResolvedError,
	InvalidArgsError,
	PickOutdatedError,
} from './errors';
import {
	COMMENTS_SCHEMA_VERSION,
	MAX_COMMENT_BODY_CHARS,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	MAX_PICK_TEXT_CHARS,
} from './layout';
import { assertLayoutDirsOwned, readStoredMeta } from './layoutFs';
import { withWorkspaceLock } from './workspaceLock';

// Every write is a read-modify-write of comments.json under the workspace lock; reads take none.

const COMMENT_COUNT_MESSAGE = `comments.json already holds ${MAX_COMMENTS} comments. Remove resolved comments from .cursor-design/comments.json, then retry.`;

const USER_REPLY_CAP_MESSAGE = 'This comment has the maximum number of replies.';

const THREAD_FULL_MESSAGE =
	"This comment's thread is full. Ask the user to resolve it in the panel.";

const NOTE_MESSAGE = `note must be a one-line description of what you changed, 1 to ${MAX_COMMENT_BODY_CHARS} characters.`;

const SET_STATUS_MESSAGE = 'status must be open or resolved.';

const LIST_STATUS_MESSAGE =
	'status must be open, sent, or resolved. Omit it for all unresolved comments.';

const COMMENT_ID_MESSAGE = 'id must be a comment id string from list_comments.';

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

// The panel's read: every stored comment, resolved included, with the same flags as get_comment.
export const readComments = async ({
	workspaceRoot,
}: {
	workspaceRoot: string;
}): Promise<CommentView[]> => {
	await assertLayoutDirsOwned(workspaceRoot);
	return withCommentViews(workspaceRoot, (await readCommentsFile(workspaceRoot)).comments);
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
