import {
	ArtboardNotFoundError,
	CommentNotFoundError,
	ConflictError,
	DiskError,
	EditRefusedError,
	InvalidArgsError,
	InvalidArtboardIdError,
	LockTimeoutError,
	PageNotFoundError,
	toSafeArtboardErrorMessage,
} from '../disk/errors';
import type { CommentRequestMessage } from '../webview/hostMessages';

// Allowlists that keep the disk lib's Agent copy out of the panel.

const CREATE_FALLBACK_MESSAGE = 'Could not add the comment. Check the Output panel: Cursor Design.';

const MALFORMED_CREATE_MESSAGE = 'Could not add the comment. Pick the element again.';

const CHANGE_FALLBACK_MESSAGE = 'Could not save the change. Check the Output panel: Cursor Design.';

const MALFORMED_CHANGE_MESSAGE = 'Could not save the change. Try again.';

const COMMENT_GONE_MESSAGE = 'This comment no longer exists.';

// Every page-bound request for a page that is gone; PageNotFoundError's own text is Agent copy.
export const PAGE_GONE_MESSAGE = 'That page no longer exists.';

// The copy types' fallback (a clipboard rejection lands here) and their malformed copy.
const COPY_FAILED_MESSAGE = 'Could not copy the prompt. Check the Output panel: Cursor Design.';

// The clipboard holds the prompt, but markCommentsSent threw (busy, corrupt, anything).
export const COPIED_NOT_MARKED_MESSAGE =
	'The prompt was copied, but the comment status was not updated. Try again.';

export const NOTHING_OPEN_MESSAGE = 'There are no open comments to copy.';

export const isCopyType = (type: CommentRequestMessage['type']): boolean =>
	type === 'comment:copy' || type === 'comment:copy-open';

const fallbackMessage = (type: CommentRequestMessage['type']): string =>
	type === 'comment:create'
		? CREATE_FALLBACK_MESSAGE
		: isCopyType(type)
			? COPY_FAILED_MESSAGE
			: CHANGE_FALLBACK_MESSAGE;

export const malformedRequestMessage = (type: CommentRequestMessage['type']): string =>
	type === 'comment:create'
		? MALFORMED_CREATE_MESSAGE
		: isCopyType(type)
			? COPY_FAILED_MESSAGE
			: MALFORMED_CHANGE_MESSAGE;

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
		: error instanceof PageNotFoundError
			? PAGE_GONE_MESSAGE
			: toSafeArtboardErrorMessage(error, fallbackMessage(type));

export const MALFORMED_EDIT_MESSAGE = 'Could not save the edit. Try again.';

const EDIT_FALLBACK_MESSAGE = 'Could not save the edit. Check the Output panel: Cursor Design.';

const EDIT_CONFLICT_MESSAGE = 'This artboard changed on disk. Make the edit again.';

const EDIT_FRAME_GONE_MESSAGE = 'This frame no longer exists.';

export const NOTHING_TO_UNDO_MESSAGE = 'Nothing to undo in this frame.';

export const NOTHING_TO_REDO_MESSAGE = 'Nothing to redo in this frame.';

const HISTORY_CLEARED_MESSAGE = 'This artboard changed on disk, so its undo history was cleared.';

export const MALFORMED_HISTORY_MESSAGE = 'Could not undo or redo. Try again.';

const HISTORY_FALLBACK_MESSAGE = 'Could not undo or redo. Check the Output panel: Cursor Design.';

// Panel copy for a failed artboard:edit or artboard:history, an allowlist in this order: every
// other domain error's own message is Agent copy (ConflictError says to call read_artboard,
// CorruptMetaError to set_artboard), so it gets the fallback. Conflict, malformed and fallback
// copy differ by kind; not found, busy and disk copy are shared.
export const editRequestErrorMessage = (error: unknown, kind: 'edit' | 'history'): string => {
	if (error instanceof ConflictError) {
		return kind === 'edit' ? EDIT_CONFLICT_MESSAGE : HISTORY_CLEARED_MESSAGE;
	}
	if (error instanceof ArtboardNotFoundError) {
		return EDIT_FRAME_GONE_MESSAGE;
	}
	if (error instanceof PageNotFoundError) {
		return PAGE_GONE_MESSAGE;
	}
	if (error instanceof InvalidArgsError || error instanceof InvalidArtboardIdError) {
		return kind === 'edit' ? MALFORMED_EDIT_MESSAGE : MALFORMED_HISTORY_MESSAGE;
	}
	if (
		error instanceof EditRefusedError ||
		error instanceof LockTimeoutError ||
		error instanceof DiskError
	) {
		return error.message;
	}
	return kind === 'edit' ? EDIT_FALLBACK_MESSAGE : HISTORY_FALLBACK_MESSAGE;
};
