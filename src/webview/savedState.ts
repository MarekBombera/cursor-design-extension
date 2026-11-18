import { COMMENT_ID_PATTERN, MAX_COMMENT_BODY_CHARS, MAX_COMMENTS } from '../disk/layout';
import type { CommentDraft } from './commentPopover';
import { parsePickFields } from './frame/frameMessages';
import { isFiniteNumber, isRecord } from './hostMessages';
import type { StageView } from './stageGeometry';

// What the chrome keeps in VS Code webview state (getState / setState) across a tab switch, which
// reloads the webview: the stage view and the comment UI. Read through these parsers only; the
// host never sees this state.

// Webview state survives hide/show (the webview reloads), so the view is restored from it.
// Anything malformed is rejected and the first layout fits instead.
export const parseSavedStageView = (value: unknown): StageView | undefined => {
	if (
		!isRecord(value) ||
		!isFiniteNumber(value.x) ||
		!isFiniteNumber(value.y) ||
		!isFiniteNumber(value.zoom) ||
		value.zoom <= 0
	) {
		return undefined;
	}
	return { x: value.x, y: value.y, zoom: value.zoom };
};

// The comment UI kept in webview state across a tab switch (the webview reloads).
export type SavedCommentUi = {
	commentMode: boolean;
	// Never pending and never with an error.
	commentDraft?: CommentDraft;
	openThreadId?: string;
	// Comment id → reply text; '' is an open, empty composer.
	replyDrafts: Readonly<Record<string, string>>;
};

const isCommentId = (value: unknown): value is string =>
	typeof value === 'string' && COMMENT_ID_PATTERN.test(value);

const isSavedBody = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_COMMENT_BODY_CHARS;

// The frame id is only compared against live frame ids, so any non-empty string will do.
// `pendingRequestId` and `error` are never restored.
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

// Each key is checked on its own: a bad key is dropped and the rest still restore. A draft wins
// over a thread (pins are inert while a draft is open).
export const parseSavedCommentUi = (state: unknown): SavedCommentUi => {
	const record = isRecord(state) ? state : {};
	const commentDraft = parseSavedDraft(record.commentDraft);
	const openThreadId =
		commentDraft === undefined && isCommentId(record.openThreadId)
			? record.openThreadId
			: undefined;
	return {
		commentMode: record.commentMode === true,
		...(commentDraft === undefined ? {} : { commentDraft }),
		...(openThreadId === undefined ? {} : { openThreadId }),
		replyDrafts: parseReplyDrafts(record.replyDrafts),
	};
};
