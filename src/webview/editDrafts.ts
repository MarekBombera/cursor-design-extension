import {
	isRefusedEditText,
	normalizeEditText,
	normalizeStyleValue,
	previewText,
} from '../disk/editValues';
import {
	leadingWhitespaceLength,
	removeStyleProperty,
	setStyleProperty,
	trailingWhitespaceLength,
} from '../disk/inlineStyle';
import { MAX_EDIT_TEXT_CHARS, MAX_PICK_STYLE_CHARS } from '../disk/layout';
import type { ChromePick } from './commentPick';
import { editability, inlineValue } from './editInspector';
import type { EditCommit, EditField, EditKey } from './editRequests';
import type { EditApplyMessage, EditStyleField } from './frame/frameMessages';

// Field drafts (9e): one field's uncommitted input in the Edit-mode inspector, its live preview in
// the frame and its commit verdict. Pure; the drafts live in EditState (editState.svelte.ts), the
// view is Inspector.svelte. The host stays the authority on every save (9c), so these rules only
// decide what to preview and whether to send.

export type FieldErrorKind = 'invalid-length' | 'complex-style' | 'control-text';

export const FIELD_ERROR_COPY = {
	'invalid-length': 'Not saved: use a number, a CSS length such as 1.5rem, or leave it empty.',
	'complex-style': "Not saved: this element's style is too complex to edit here. Ask the Agent.",
	'control-text': 'Not saved: the text has control characters. Remove them and try again.',
} as const satisfies Record<FieldErrorKind, string>;

// One field's uncommitted input, tied to the element it started on.
export type EditDraft = {
	key: EditKey;
	field: EditField;
	value: string;
	// Baselines from the pick when the draft started: the raw text node and the style attribute.
	liveText: string;
	style: string;
	// A preview reached the frame, so ending without a save must put the baseline back.
	previewed: boolean;
	error: FieldErrorKind | undefined;
};

// The draft for the first input in a field: only on an editable pick (a number, not shared), and
// for a style field only when the style attribute is within the cap.
export const startDraft = ({
	pick,
	documentVersion,
	field,
	value,
}: {
	pick: ChromePick | undefined;
	documentVersion: number;
	field: EditField;
	value: string;
}): EditDraft | undefined => {
	const edit = pick?.edit;
	if (pick === undefined || edit === undefined || edit.sourceNumber === null || edit.sharedNumber) {
		return undefined;
	}
	if (field !== 'text' && edit.style === null) {
		return undefined;
	}
	return {
		key: { frameId: pick.frameId, sourceNumber: edit.sourceNumber, documentVersion },
		field,
		value,
		liveText: edit.text,
		style: edit.style ?? '',
		previewed: false,
		error: undefined,
	};
};

const sameElement = (key: EditKey, pick: ChromePick | undefined): boolean =>
	pick !== undefined &&
	pick.frameId === key.frameId &&
	pick.edit?.sourceNumber === key.sourceNumber;

// A field shows its draft while it has one for the picked element, else the pick's value, so the
// re-posts a preview causes never overwrite typing.
export const fieldValue = ({
	draft,
	pick,
	pickValue,
}: {
	draft: EditDraft | undefined;
	pick: ChromePick | undefined;
	pickValue: string;
}): string => (draft !== undefined && sameElement(draft.key, pick) ? draft.value : pickValue);

// The textarea's maxlength: the saved text node keeps the baseline's edge whitespace, so the
// whole node stays within MAX_EDIT_TEXT_CHARS (and never turns 'too-long' mid-edit).
export const textMaxLength = (liveText: string): number => {
	const leading = leadingWhitespaceLength(liveText);
	return MAX_EDIT_TEXT_CHARS - leading - trailingWhitespaceLength(liveText.slice(leading));
};

type StylePreview = { style: string } | { error: FieldErrorKind };

const stylePreview = (draft: EditDraft, field: EditStyleField): StylePreview => {
	const value = normalizeStyleValue(field, draft.value);
	if (value === undefined) {
		return { error: 'invalid-length' };
	}
	const style =
		value === ''
			? removeStyleProperty(draft.style, field)
			: setStyleProperty({ styleText: draft.style, property: field, value });
	return style === undefined || style.length > MAX_PICK_STYLE_CHARS
		? { error: 'complex-style' }
		: { style };
};

const applyMessage = (
	sourceNumber: number,
	value: { text: string } | { style: string },
): EditApplyMessage =>
	'text' in value
		? { type: 'cd:edit-apply', sourceNumber, text: value.text }
		: { type: 'cd:edit-apply', sourceNumber, style: value.style };

// The preview for the draft's current value; undefined when the value cannot be previewed (the
// last preview stays until the commit decides).
export const draftPreview = (draft: EditDraft): EditApplyMessage | undefined => {
	if (draft.field === 'text') {
		const text = previewText({ liveText: draft.liveText, value: draft.value });
		return text.length > MAX_EDIT_TEXT_CHARS
			? undefined
			: applyMessage(draft.key.sourceNumber, { text });
	}
	const preview = stylePreview(draft, draft.field);
	return 'style' in preview ? applyMessage(draft.key.sourceNumber, preview) : undefined;
};

// Puts the frame back to the draft's baseline.
export const baselinePreview = (draft: EditDraft): EditApplyMessage =>
	applyMessage(
		draft.key.sourceNumber,
		draft.field === 'text' ? { text: draft.liveText } : { style: draft.style },
	);

const isUnchanged = (draft: EditDraft): boolean => {
	if (draft.field === 'text') {
		return normalizeEditText(draft.value) === normalizeEditText(draft.liveText);
	}
	const next = normalizeStyleValue(draft.field, draft.value);
	const previous = normalizeStyleValue(draft.field, inlineValue(draft.style, draft.field));
	if (next === undefined || previous === undefined) {
		return false;
	}
	return draft.field === 'color'
		? next.toLowerCase() === previous.toLowerCase()
		: next === previous;
};

export type CommitVerdict =
	// Nothing to send; `revert` puts the baseline back when a preview was sent.
	| { kind: 'unchanged'; revert: EditApplyMessage | undefined }
	// The draft stays with its error; the frame goes back to the baseline.
	| { kind: 'invalid'; error: FieldErrorKind; revert: EditApplyMessage }
	| { kind: 'save'; commit: EditCommit };

export const commitDraft = (draft: EditDraft): CommitVerdict => {
	if (isUnchanged(draft)) {
		return { kind: 'unchanged', revert: draft.previewed ? baselinePreview(draft) : undefined };
	}
	if (draft.field === 'text') {
		return isRefusedEditText(normalizeEditText(draft.value))
			? { kind: 'invalid', error: 'control-text', revert: baselinePreview(draft) }
			: {
					kind: 'save',
					commit: { key: draft.key, field: 'text', value: draft.value, liveText: draft.liveText },
				};
	}
	const preview = stylePreview(draft, draft.field);
	return 'error' in preview
		? { kind: 'invalid', error: preview.error, revert: baselinePreview(draft) }
		: { kind: 'save', commit: { key: draft.key, field: draft.field, value: draft.value } };
};

export type DraftFate = 'keep' | 'commit' | 'drop';

// What happens to an open draft when the stage changes (the lifecycle table in the 9e spec):
// - its frame left, became a tile or reloaded: drop (the preview is gone with the document);
// - a new pick of another element: commit against the draft's own key;
// - a refreshed pick of the draft's element that is no longer editable: drop.
export const draftFate = ({
	draft,
	frame,
	pick,
}: {
	draft: EditDraft;
	frame: { kind: 'tile' | 'iframe'; documentVersion: number } | undefined;
	pick: ChromePick | undefined;
}): DraftFate => {
	if (
		frame === undefined ||
		frame.kind !== 'iframe' ||
		frame.documentVersion !== draft.key.documentVersion
	) {
		return 'drop';
	}
	if (pick === undefined) {
		return 'keep';
	}
	if (!sameElement(draft.key, pick)) {
		return pick.repost ? 'keep' : 'commit';
	}
	return pick.edit !== undefined && editability(pick.edit) !== 'editable' ? 'drop' : 'keep';
};
