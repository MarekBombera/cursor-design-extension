import {
	type ArtboardDocument,
	type CommentDocument,
	type CommentFlags,
	HINT_CHECK_BUDGET,
	commentFlags,
	parseArtboardDocument,
} from './commentTarget';
import type { Comment } from './commentsFile';
import { DiskError, logStderr } from './errors';
import { artboardHtmlPathSegments } from './layout';
import { layoutEntryKind, readUtf8IfExists, workspaceJoin, workspaceLayoutFile } from './layoutFs';

// Each comment's stale / targetMissing flags, checked against its frame's HTML on disk.

export type CommentView = Comment & CommentFlags;

// Per read: past it, a comment that needs a target match reports unchecked.
const CHECK_BUDGET_MS = 200;

// One parse per workspace and frame, reused while the HTML text is identical (which also keeps
// matchCommentTarget's per-document match cache, so an unchanged frame runs no match).
// ponytail: FIFO at MAX_PARSED_DOCUMENTS; source tags and edits insert here too, so more than 32
// changed frames evict comment trees and re-parse. A tree with locations is about 34 MB per
// realistic 1.5M-char frame, 134 MB for bare tiny tags: 1.1 to 4.3 GB at the cap. Upgrade path:
// LRU, plus a cap on total HTML chars.
export const MAX_PARSED_DOCUMENTS = 32;
const parsedDocuments = new Map<string, { html: string; document: ArtboardDocument }>();

export const frameCacheKey = (workspaceRoot: string, frameId: string): string =>
	`${workspaceRoot}\0${frameId}`;

export const cachedArtboardDocument = ({
	workspaceRoot,
	frameId,
	html,
}: {
	workspaceRoot: string;
	frameId: string;
	html: string;
}): ArtboardDocument => {
	const key = frameCacheKey(workspaceRoot, frameId);
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
};

const loadArtboardDocument = async (
	workspaceRoot: string,
	frameId: string,
): Promise<CommentDocument> => {
	const key = frameCacheKey(workspaceRoot, frameId);
	try {
		const html = await readUtf8IfExists(
			workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(frameId)),
		);
		if (html === undefined) {
			parsedDocuments.delete(key);
			return 'missing';
		}
		return cachedArtboardDocument({ workspaceRoot, frameId, html });
	} catch (error: unknown) {
		if (error instanceof DiskError) {
			logStderr('comment target read', error);
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
			logStderr('comment target read', error);
			return 'unreadable';
		}
		throw error;
	}
};

// Parse only frames a fingerprinted element comment needs; the rest need only existence.
// ponytail: a whole-file parse on the extension host thread, once per HTML change per frame; no
// byte cap. Upgrade path: a worker thread for the host read.
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
