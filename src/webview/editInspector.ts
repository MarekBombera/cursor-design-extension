import {
	isRefusedEditText,
	normalizeEditText,
	normalizeStyleValue,
	previewText,
} from '../disk/editValues';
import {
	asciiTrim,
	leadingWhitespaceLength,
	removeStyleProperty,
	setStyleProperty,
	splitStyleDeclarations,
	trailingWhitespaceLength,
} from '../disk/inlineStyle';
import {
	EDIT_STYLE_FIELDS,
	MAX_EDIT_TEXT_CHARS,
	MAX_PICK_STYLE_CHARS,
	RAW_TEXT_ELEMENTS,
	VOID_ELEMENTS,
} from '../disk/layout';
import type { ChromePick } from './commentPick';
import type { EditCommit, EditField, EditKey } from './editRequests';
import type {
	EditApplyMessage,
	EditStyleField,
	FrameMode,
	PickEditFields,
} from './frame/frameMessages';

// Inspector rules (9d, 9e): what the Edit-mode inspector shows for the chrome's pick, the toolbar's
// pick announcement, and the field drafts (preview and commit). Pure; the view is Inspector.svelte,
// the drafts live in EditState. The host stays the authority on every save (9c), so these rules
// only decide what to show and whether to send.

type Editability = 'editable' | 'no-number' | 'shared-number';

// The style fields shown as text inputs; colour has its own swatch.
export type InputField = Exclude<EditStyleField, 'color'>;

const INPUT_FIELDS = EDIT_STYLE_FIELDS.filter((field): field is InputField => field !== 'color');

type EditableView = {
	kind: 'editable';
	target: string;
	text:
		// value: what the field shows; liveText: the frame's raw text, which 9e sends.
		| { state: 'plain'; value: string; liveText: string }
		| { state: 'children' | 'too-long' }
		// The element can never hold text (void or raw-text): no field, no hint.
		| { state: 'none' };
	// 'too-long': the style attribute is over MAX_PICK_STYLE_CHARS (edit.style null): a hint, no
	// style fields.
	style: 'editable' | 'too-long';
	fields: Array<{ field: InputField; value: string; placeholder: string }>;
	color: { hex: string; value: string; computed: boolean };
};

type InspectorView =
	| { kind: 'empty' }
	| { kind: 'not-editable'; reason: Exclude<Editability, 'editable'>; target: string }
	| EditableView;

// Shown when the computed colour gives no hex (the native colour input needs one).
const FALLBACK_HEX = '#000000';

export const editability = (edit: PickEditFields): Editability => {
	if (edit.sourceNumber === null) {
		return 'no-number';
	}
	return edit.sharedNumber ? 'shared-number' : 'editable';
};

// The value of the last declaration of `property` in a style attribute, as typed (trimmed): the
// same tokenizer and the same "last one" the edit core replaces, read after the tokenizer's own
// colon. A longhand never fills its shorthand.
export const inlineValue = (style: string | null, property: string): string => {
	if (style === null) {
		return '';
	}
	const segment = splitStyleDeclarations(style)
		.segments.filter((candidate) => candidate.property === property)
		.at(-1);
	return asciiTrim(segment?.value ?? '');
};

// Chromium's computed colour serialization only: `rgb(r, g, b)` or `rgba(r, g, b, a)`.
const COMPUTED_RGB = /^rgba?\((\d{1,3}), (\d{1,3}), (\d{1,3})(?:, [0-9.]+)?\)$/;

// ponytail: a computed colour in a modern colour space (oklch(), color()) has no hex here and the
// swatch falls back to black; upgrade: a canvas-based normalizer in the chrome.
export const toHexColor = (value: string): string | undefined => {
	const match = COMPUTED_RGB.exec(value);
	if (match === null) {
		return undefined;
	}
	const channels = match.slice(1, 4).map(Number);
	if (channels.some((channel) => channel > 255)) {
		return undefined;
	}
	return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

const editableView = ({
	pick,
	edit,
	target,
}: {
	pick: ChromePick;
	edit: PickEditFields;
	target: string;
}): EditableView => {
	const noText = VOID_ELEMENTS.has(pick.tagName) || RAW_TEXT_ELEMENTS.has(pick.tagName);
	const inlineColor = inlineValue(edit.style, 'color');
	const computedColor = pick.styles.color ?? '';
	return {
		kind: 'editable',
		target,
		text: noText
			? { state: 'none' }
			: edit.textState === 'plain'
				? { state: 'plain', value: asciiTrim(edit.text), liveText: edit.text }
				: { state: edit.textState },
		style: edit.style === null ? 'too-long' : 'editable',
		fields: INPUT_FIELDS.map((field) => ({
			field,
			value: inlineValue(edit.style, field),
			placeholder: pick.styles[field] ?? '',
		})),
		color: {
			hex: toHexColor(computedColor) ?? FALLBACK_HEX,
			value: inlineColor === '' ? computedColor : inlineColor,
			computed: inlineColor === '',
		},
	};
};

export const inspectorView = (pick: ChromePick | undefined): InspectorView => {
	if (pick?.edit === undefined) {
		return { kind: 'empty' };
	}
	const target = pick.isPage ? 'page' : pick.tagName;
	const reason = editability(pick.edit);
	return reason === 'editable'
		? editableView({ pick, edit: pick.edit, target })
		: { kind: 'not-editable', reason, target };
};

// The toolbar's announcement for a pick: what was selected, plus whether the inspector can edit
// it in Edit mode. '' in Interact mode or without a pick.
export const pickAnnouncementText = ({
	mode,
	pick,
}: {
	mode: FrameMode;
	pick: Pick<ChromePick, 'tagName' | 'isPage' | 'edit'> | undefined;
}): string => {
	if (mode === 'interact' || pick === undefined) {
		return '';
	}
	const selected = pick.isPage ? 'Whole frame selected' : `${pick.tagName} element selected`;
	const blocked =
		mode === 'edit' && pick.edit !== undefined && editability(pick.edit) !== 'editable';
	return blocked ? `${selected}, not editable` : selected;
};

// ---- 9e: field drafts --------------------------------------------------------------------------

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
