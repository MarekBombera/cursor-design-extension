import {
	type ArtboardDocument,
	type CommentDocument,
	type CommentFlags,
	HINT_CHECK_BUDGET,
	commentFlags,
	parseArtboardDocument,
} from './commentTarget';
import type { Comment } from './commentsFile';
import { DiskError } from './errors';
import { artboardHtmlPathSegments } from './layout';
import { layoutEntryKind, readUtf8IfExists, workspaceJoin, workspaceLayoutFile } from './layoutFs';

// The flag read shared by list_comments, get_comment and the panel: each comment gets stale and
// targetMissing from its frame's HTML on disk, with a parse cache and a time budget per read.

export type CommentView = Comment & CommentFlags;

const logTargetReadError = (error: unknown): void => {
	process.stderr.write(
		`cursor-design: comment target read failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
};

// The flag read's time budget: past it, a comment that needs a target match reports unchecked.
const CHECK_BUDGET_MS = 200;

// One parse per workspace and frame, reused only while the HTML text is identical. An unchanged
// document also keeps matchCommentTarget's per-document match cache, so a re-read of an unchanged
// frame runs no match at all.
// ponytail: capped at MAX_PARSED_DOCUMENTS, oldest insert evicted first (FIFO, not LRU), so a
// deleted frame or a previous workspace stops holding its tree once newer frames arrive; past the
// cap a read that needs every frame reparses them all. Upgrade path: LRU (re-insert on hit).
export const MAX_PARSED_DOCUMENTS = 32;
const parsedDocuments = new Map<string, { html: string; document: ArtboardDocument }>();

const loadArtboardDocument = async (
	workspaceRoot: string,
	frameId: string,
): Promise<CommentDocument> => {
	const key = `${workspaceRoot}\0${frameId}`;
	try {
		const html = await readUtf8IfExists(
			workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(frameId)),
		);
		if (html === undefined) {
			parsedDocuments.delete(key);
			return 'missing';
		}
		const cached = parsedDocuments.get(key);
		if (cached?.html === html) {
			return cached.document;
		}
		const document = parseArtboardDocument(html);
		parsedDocuments.set(key, { html, document });
		for (const oldest of parsedDocuments.keys()) {
			if (parsedDocuments.size <= MAX_PARSED_DOCUMENTS) {
				break;
			}
			parsedDocuments.delete(oldest);
		}
		return document;
	} catch (error: unknown) {
		if (error instanceof DiskError) {
			logTargetReadError(error);
			parsedDocuments.delete(key);
			return 'unreadable';
		}
		throw error;
	}
};

const loadFramePresence = async (
	workspaceRoot: string,
	frameId: string,
): Promise<CommentDocument> => {
	try {
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
	} catch (error: unknown) {
		if (error instanceof DiskError) {
			logTargetReadError(error);
			return 'unreadable';
		}
		throw error;
	}
};

// Parse only frames a fingerprinted element comment needs; every other comment needs only to know
// whether its frame file still exists.
// ponytail: parse5 parses the whole file, so parse time grows with HTML size (no byte cap exists).
// It runs on the extension host thread once per HTML change per frame; each match is bounded by
// MAX_MATCH_WORK (selectorMatch.ts) and the read by its budget. Upgrade path: a worker thread for
// the host read.
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

export const withCommentViews = async (
	workspaceRoot: string,
	comments: Comment[],
): Promise<CommentView[]> => {
	const documents = await documentsFor(workspaceRoot, comments);
	// After the parse: the budget bounds matching only, so a slow parse never skips a match.
	const started = performance.now();
	return comments.map((comment) => {
		const document = documents.get(comment.frameId) ?? 'missing';
		// Page and presence-only comments cost no match, so the budget never skips them.
		const needsMatch =
			typeof document === 'object' && !comment.isPage && comment.targetFingerprint !== undefined;
		if (needsMatch && performance.now() - started > CHECK_BUDGET_MS) {
			return { ...comment, stale: null, targetMissing: null, hint: HINT_CHECK_BUDGET };
		}
		return { ...comment, ...commentFlags({ target: comment, document }) };
	});
};
