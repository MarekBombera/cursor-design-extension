import { asciiTrim, splitStyleDeclarations } from '../disk/inlineStyle';
import { EDIT_STYLE_FIELDS, RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from '../disk/layout';
import type { ChromePick } from './commentPick';
import type { EditStyleField, FrameMode, PickEditFields } from './frame/frameMessages';

type Editability = 'editable' | 'no-number' | 'shared-number';

// Colour has its own swatch.
export type InputField = Exclude<EditStyleField, 'color'>;

const INPUT_FIELDS = EDIT_STYLE_FIELDS.filter((field): field is InputField => field !== 'color');

type EditableView = {
	kind: 'editable';
	target: string;
	text:
		// value: what the field shows (trimmed); liveText: the raw text node a save sends.
		| { state: 'plain'; value: string; liveText: string }
		| { state: 'children' | 'too-long' }
		// The element can never hold text (void or raw-text): no field, no hint.
		| { state: 'none' };
	// 'too-long': edit.style is null (over MAX_PICK_STYLE_CHARS): a hint, no style fields.
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

// The last declaration's value, as typed (trimmed): the same tokenizer and "last one" the edit
// core replaces. A longhand never fills its shorthand.
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
