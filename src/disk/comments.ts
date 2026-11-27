import { readArtboard } from './artboardFs';
import { type CommentView, withCommentViews } from './commentViews';
import { matchCommentTarget, parseArtboardDocument, targetAgrees } from './commentTarget';
import {
	COMMENT_BODY_MESSAGE,
	type NewComment,
	commentsTextIfExists,
	orderedComment,
	readCommentsFile,
	validateNewComment,
	writeCommentsFile,
	type Comment,
} from './commentsFile';
import {
	CommentNotFoundError,
	CommentResolvedError,
	InvalidArgsError,
	PickOutdatedError,
	logStderr,
} from './errors';
import {
	COMMENTS_SCHEMA_VERSION,
	MAX_COMMENT_BODY_CHARS,
	MAX_COMMENT_REPLIES,
	MAX_COMMENTS,
	MAX_PICK_TEXT_CHARS,
	type CommentStatus,
	commentsPathSegments,
} from './layout';
import {
	type PageLocation,
	assertLayoutDirsOwned,
	readProjectFile,
	readStoredMeta,
} from './layoutFs';
import { withWorkspaceLock } from './workspaceLock';

// Every write is a read-modify-write of comments.json under the workspace lock; reads take none.

const commentCountMessage = (pageId: string): string =>
	`comments.json already holds ${MAX_COMMENTS} comments. Remove resolved comments from ${commentsPathSegments(pageId).join('/')}, then retry.`;

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

const findComment = (comments: readonly Comment[], id: string): Comment => {
	const comment = comments.find((entry) => entry.id === id);
	if (comment === undefined) {
		throw new CommentNotFoundError();
	}
	return comment;
};

const replaceComment = (comments: readonly Comment[], next: Comment): Comment[] =>
	comments.map((entry) => (entry.id === next.id ? next : entry));

// The one write shell: ownership check, optional lock-free missing-file exit, then read, change and
// write under the workspace lock. `change` returns `comments` to write; omitting them writes nothing.
const changeCommentsFile = async <T>({
	page,
	ifMissing,
	change,
}: {
	page: PageLocation;
	ifMissing?: () => T;
	change: (comments: readonly Comment[]) => { comments?: Comment[]; result: T };
}): Promise<T> => {
	await assertLayoutDirsOwned(page);
	if (ifMissing !== undefined && (await commentsTextIfExists(page)) === undefined) {
		return ifMissing();
	}
	return withWorkspaceLock({
		workspaceRoot: page.workspaceRoot,
		operation: async () => {
			const file = await readCommentsFile(page);
			const { comments, result } = change(file.comments);
			if (comments !== undefined) {
				await writeCommentsFile(page, { version: COMMENTS_SCHEMA_VERSION, comments });
			}
			return result;
		},
	});
};

const throwNotFound = (): never => {
	throw new CommentNotFoundError();
};

const artboardLabel = (title: string, frameId: string): string => {
	const source = title === '' ? frameId : title;
	return source.replace(/[\p{Cc}\u2028\u2029]/gu, ' ').slice(0, MAX_PICK_TEXT_CHARS);
};

export const addComment = async ({
	page,
	comment,
}: {
	page: PageLocation;
	comment: NewComment;
}): Promise<Comment> => {
	await assertLayoutDirsOwned(page);
	const fields = validateNewComment(comment);
	const read = await readArtboard({ page, artboardId: fields.frameId });
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
	const storedMeta = await readStoredMeta(page, fields.frameId);
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
	return changeCommentsFile({
		page,
		change: (comments) => {
			if (comments.length >= MAX_COMMENTS) {
				throw new InvalidArgsError(commentCountMessage(page.pageId));
			}
			return { comments: [...comments, next], result: next };
		},
	});
};

export const replyToComment = async ({
	page,
	id,
	body,
}: {
	page: PageLocation;
	id: unknown;
	body: unknown;
}): Promise<Comment> => {
	const commentId = requireCommentId(id);
	const trimmed = requireCommentBody(body);
	return changeCommentsFile({
		page,
		ifMissing: throwNotFound,
		change: (comments) => {
			const current = findComment(comments, commentId);
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
			return { comments: replaceComment(comments, next), result: next };
		},
	});
};

export const setCommentStatus = async ({
	page,
	id,
	status,
}: {
	page: PageLocation;
	id: unknown;
	status: unknown;
}): Promise<Comment> => {
	if (status !== 'open' && status !== 'resolved') {
		throw new InvalidArgsError(SET_STATUS_MESSAGE);
	}
	const commentId = requireCommentId(id);
	return changeCommentsFile({
		page,
		ifMissing: throwNotFound,
		change: (comments) => {
			const current = findComment(comments, commentId);
			const nextStatus: CommentStatus | undefined =
				status === 'resolved' && (current.status === 'open' || current.status === 'sent')
					? 'resolved'
					: status === 'open' && current.status === 'resolved'
						? 'open'
						: undefined;
			if (nextStatus === undefined) {
				return { result: current };
			}
			const next: Comment = { ...current, status: nextStatus };
			return { comments: replaceComment(comments, next), result: next };
		},
	});
};

export const markCommentsSent = async ({
	page,
	ids,
}: {
	page: PageLocation;
	ids: readonly string[];
}): Promise<Comment[]> => {
	return changeCommentsFile({
		page,
		ifMissing: () => [],
		change: (existing) => {
			const marked: Comment[] = [];
			const comments = existing.map((comment) => {
				if (comment.status === 'open' && ids.includes(comment.id)) {
					const next: Comment = { ...comment, status: 'sent' };
					marked.push(next);
					return next;
				}
				return comment;
			});
			return marked.length === 0 ? { result: [] } : { comments, result: marked };
		},
	});
};

export const resolveComment = async ({
	page,
	id,
	note,
}: {
	page: PageLocation;
	id: unknown;
	note: unknown;
}): Promise<Comment> => {
	const commentId = requireCommentId(id);
	const trimmed = requireNote(note);
	return changeCommentsFile({
		page,
		ifMissing: throwNotFound,
		change: (comments) => {
			const current = findComment(comments, commentId);
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
			return { comments: replaceComment(comments, next), result: next };
		},
	});
};

export const listComments = async ({
	page,
	status,
}: {
	page: PageLocation;
	status?: unknown;
}): Promise<{ comments: CommentView[] }> => {
	if (status !== undefined && status !== 'open' && status !== 'sent' && status !== 'resolved') {
		throw new InvalidArgsError(LIST_STATUS_MESSAGE);
	}
	await assertLayoutDirsOwned(page);
	const file = await readCommentsFile(page);
	const comments =
		status === undefined
			? file.comments.filter((comment) => comment.status !== 'resolved')
			: file.comments.filter((comment) => comment.status === status);
	return { comments: await withCommentViews(page, comments) };
};

// The panel's read: every stored comment, resolved included, with the same flags as get_comment.
export const readComments = async ({ page }: { page: PageLocation }): Promise<CommentView[]> => {
	await assertLayoutDirsOwned(page);
	return withCommentViews(page, (await readCommentsFile(page)).comments);
};

export const getComment = async ({
	page,
	id,
}: {
	page: PageLocation;
	id: unknown;
}): Promise<CommentView> => {
	const commentId = requireCommentId(id);
	await assertLayoutDirsOwned(page);
	const file = await readCommentsFile(page);
	const comment = findComment(file.comments, commentId);
	const [view] = await withCommentViews(page, [comment]);
	if (view === undefined) {
		throw new CommentNotFoundError();
	}
	return view;
};

// Lock-free: the first indexed page other than exceptPageId whose comments.json holds the id. An
// unreadable index or comments file, or a symlinked page folder, is logged and skipped: a hint never replaces the caller's error.
// ponytail: O(pages) comments.json reads on a miss; fine at MAX_PAGES. Upgrade path: a comment id
// to page index.
export const findCommentPage = async ({
	workspaceRoot,
	id,
	exceptPageId,
}: {
	workspaceRoot: string;
	id: string;
	exceptPageId: string;
}): Promise<string | undefined> => {
	let pageIds: string[];
	try {
		pageIds = ((await readProjectFile(workspaceRoot))?.pages ?? []).map((entry) => entry.id);
	} catch (error: unknown) {
		logStderr('comment page lookup', error);
		return undefined;
	}
	for (const pageId of pageIds) {
		if (pageId === exceptPageId) {
			continue;
		}
		try {
			await assertLayoutDirsOwned({ workspaceRoot, pageId });
			const file = await readCommentsFile({ workspaceRoot, pageId });
			if (file.comments.some((comment) => comment.id === id)) {
				return pageId;
			}
		} catch (error: unknown) {
			logStderr(`page ${pageId} comments lookup`, error);
		}
	}
	return undefined;
};
