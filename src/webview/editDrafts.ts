import {
	applyStyleChanges,
	COLOR_FIELDS,
	isRefusedEditText,
	normalizeEditText,
	normalizeStyleValue,
	previewText,
	type StyleChange,
	type StyleField,
} from '../disk/editValues';
import { leadingWhitespaceLength, trailingWhitespaceLength } from '../disk/inlineStyle';
import { MAX_EDIT_TEXT_CHARS, MAX_PICK_STYLE_CHARS } from '../disk/layout';
import type { ChromePick } from './commentPick';
import { editability, inlineValue } from './editInspector';
import { type EditCommit, type EditField, type EditKey, NOT_SAVED_COPY } from './editRequests';
import type { EditApplyMessage } from './frame/frameMessages';

// The host stays the authority on every save; these rules only decide what to preview and send.

export type FieldErrorKind =
	| 'invalid-length'
	| 'invalid-color'
	| 'invalid-opacity'
	| 'invalid-leading'
	| 'invalid-choice'
	| 'complex-style'
	| 'control-text';

export const FIELD_ERROR_COPY = {
	'invalid-length': 'Not saved: use a number, a CSS length such as 1.5rem, or leave it empty.',
	'invalid-color': 'Not saved: use a hex color such as #1a2b3c, transparent, or leave it empty.',
	'invalid-opacity': 'Not saved: use a number from 0 to 1, or leave it empty.',
	'invalid-leading':
		'Not saved: use a number such as 1.5, a CSS length such as 24px, or leave it empty.',
	// Selects, segments, Reset and Add border offer only valid values: defensive.
	'invalid-choice': 'Not saved: choose a value from the list.',
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

// Only on an editable pick (a number, not shared), and for a style field only when the style
// attribute is within the cap.
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

export const sameElement = (key: EditKey, pick: ChromePick | undefined): boolean =>
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

// A refused text-box value, named by its field's own rule.
const invalidValueError = (field: StyleField): FieldErrorKind => {
	if (COLOR_FIELDS.has(field)) {
		return 'invalid-color';
	}
	if (field === 'opacity') {
		return 'invalid-opacity';
	}
	return field === 'line-height' ? 'invalid-leading' : 'invalid-length';
};

// The edit core's apply rule, so the preview is what a save writes.
const stylePreview = (draft: EditDraft, field: StyleField): StylePreview => {
	const applied = applyStyleChanges({
		styleText: draft.style,
		changes: [{ field, value: draft.value }],
	});
	if (!applied.ok) {
		return {
			error: applied.refusal === 'invalid-value' ? invalidValueError(field) : 'complex-style',
		};
	}
	return applied.styleText.length > MAX_PICK_STYLE_CHARS
		? { error: 'complex-style' }
		: { style: applied.styleText };
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
		: {
				kind: 'save',
				commit: { key: draft.key, styles: [{ field: draft.field, value: draft.value }] },
			};
};

// A choice, Reset or Add border: one save of every change, so one undo step. Raw values go out;
// the host normalizes.
export const stylesCommit = ({
	pick,
	documentVersion,
	changes,
}: {
	pick: ChromePick | undefined;
	documentVersion: number;
	changes: readonly StyleChange[];
}):
	| { kind: 'none' }
	| { kind: 'unchanged' }
	| { kind: 'invalid'; error: FieldErrorKind; key: EditKey }
	| { kind: 'save'; preview: EditApplyMessage; commit: EditCommit } => {
	const edit = pick?.edit;
	if (
		pick === undefined ||
		edit === undefined ||
		edit.sourceNumber === null ||
		edit.sharedNumber ||
		edit.style === null
	) {
		return { kind: 'none' };
	}
	const key = { frameId: pick.frameId, sourceNumber: edit.sourceNumber, documentVersion };
	const applied = applyStyleChanges({ styleText: edit.style, changes });
	if (!applied.ok) {
		return {
			kind: 'invalid',
			error: applied.refusal === 'invalid-value' ? 'invalid-choice' : 'complex-style',
			key,
		};
	}
	if (applied.styleText.length > MAX_PICK_STYLE_CHARS) {
		return { kind: 'invalid', error: 'complex-style', key };
	}
	if (applied.styleText === edit.style) {
		return { kind: 'unchanged' };
	}
	return {
		kind: 'save',
		preview: applyMessage(edit.sourceNumber, { style: applied.styleText }),
		commit: { key, styles: [...changes] },
	};
};

const SWATCH_HEX = /^#[0-9a-f]{6}$/i;

// The native swatch needs #rrggbb: a draft of the picked element shows while it is one.
export const swatchValue = ({
	draft,
	pick,
	swatch,
}: {
	draft: EditDraft | undefined;
	pick: ChromePick | undefined;
	swatch: string;
}): string =>
	draft !== undefined && sameElement(draft.key, pick) && SWATCH_HEX.test(draft.value)
		? draft.value.toLowerCase()
		: swatch;

export type DraftFate = 'keep' | 'commit' | 'drop';

// Drop when the frame left, became a tile or reloaded (the preview went with the document), or the
// draft's element is no longer editable; commit when the user picked another element.
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

// A pick of another element ends the draft, so name the value's own cause, not a frame change.
export const invalidDraftCopy = (error: FieldErrorKind, ending: 'pick' | 'step'): string => {
	if (ending === 'pick') {
		// ponytail: a user who already saw the field error sees the same copy once more here. Upgrade:
		// track whether the field's blur went to an artboard iframe (FocusEvent.relatedTarget) and
		// drop silently only when it did not.
		return FIELD_ERROR_COPY[error];
	}
	// ponytail: the step that ends the draft clears this copy at once (enqueueStep), so an invalid
	// draft ended by Undo / Redo ends silently; the copy shows only when the step queue is full.
	// Upgrade: set the field copy after the step is enqueued.
	return NOT_SAVED_COPY;
};
