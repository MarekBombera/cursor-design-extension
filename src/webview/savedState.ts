import { COMMENT_ID_PATTERN, isPageId, MAX_COMMENT_BODY_CHARS, MAX_COMMENTS } from '../disk/layout';
import type { CommentDraft, CommentDraftSlot } from './commentPopover';
import {
	type FrameMode,
	isFiniteNumber,
	isFrameMode,
	isRecord,
	parsePickFields,
} from './frame/frameMessages';
import type { StageView } from './stageGeometry';

// Webview state (getState / setState) survives a tab switch, which reloads the webview. Read it
// through these parsers only; the host never sees it.

// The view of one page: only that page restores it.
export type SavedStageView = StageView & { pageId: string };

// Malformed or without a page: rejected, so the first layout fits instead.
export const parseSavedStageView = (value: unknown): SavedStageView | undefined => {
	if (
		!isRecord(value) ||
		!isFiniteNumber(value.x) ||
		!isFiniteNumber(value.y) ||
		!isFiniteNumber(value.zoom) ||
		value.zoom <= 0 ||
		!isPageId(value.pageId)
	) {
		return undefined;
	}
	return { x: value.x, y: value.y, zoom: value.zoom, pageId: value.pageId };
};

export type SavedCommentUi = {
	mode: FrameMode;
	// The one draft slot, with its page. Never pending and never with an error.
	commentDraft?: CommentDraftSlot;
	openThreadId?: string;
	// Comment id → reply text; '' is an open, empty composer.
	replyDrafts: Readonly<Record<string, string>>;
};

const isCommentId = (value: unknown): value is string =>
	typeof value === 'string' && COMMENT_ID_PATTERN.test(value);

const isSavedBody = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_COMMENT_BODY_CHARS;

// The frame id is only compared against live frame ids, so any non-empty string will do.
const parseSavedDraft = (value: unknown): CommentDraft | undefined => {
	if (!isRecord(value) || !isRecord(value.target)) {
		return undefined;
	}
	const { frameId, generation, body } = value;
	if (
		typeof frameId !== 'string' ||
		frameId === '' ||
		typeof generation !== 'number' ||
		!Number.isSafeInteger(generation) ||
		generation < 0 ||
		!isSavedBody(body)
	) {
		return undefined;
	}
	const target = parsePickFields(value.target);
	return target === undefined ? undefined : { frameId, generation, target, body };
};

// Rebuilt entry by entry, so a bad entry drops alone. Object.fromEntries defines own keys, so an
// id like `__proto__` stays a plain key.
const parseReplyDrafts = (value: unknown): Record<string, string> => {
	if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		return {};
	}
	const entries = Object.entries(value)
		.filter((entry): entry is [string, string] => isCommentId(entry[0]) && isSavedBody(entry[1]))
		.slice(0, MAX_COMMENTS);
	return Object.fromEntries(entries);
};

const parseSavedSlot = (value: unknown): CommentDraftSlot | undefined => {
	if (!isRecord(value) || !isPageId(value.pageId)) {
		return undefined;
	}
	const draft = parseSavedDraft(value.draft);
	return draft === undefined ? undefined : { pageId: value.pageId, draft };
};

// Each key is checked on its own: a bad key is dropped and the rest still restore. A draft and a
// thread are both kept: they may belong to different pages, so the draft wins only when its page
// mounts (App.svelte).
export const parseSavedCommentUi = (state: unknown): SavedCommentUi => {
	const record = isRecord(state) ? state : {};
	const commentDraft = parseSavedSlot(record.commentDraft);
	const openThreadId = isCommentId(record.openThreadId) ? record.openThreadId : undefined;
	return {
		mode: isFrameMode(record.mode) ? record.mode : 'interact',
		...(commentDraft === undefined ? {} : { commentDraft }),
		...(openThreadId === undefined ? {} : { openThreadId }),
		replyDrafts: parseReplyDrafts(record.replyDrafts),
	};
};
