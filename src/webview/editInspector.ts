import type { StyleChange, StyleField } from '../disk/editValues';
import {
	asciiTrim,
	BORDER_PARENTS,
	clearedProperties,
	splitStyleDeclarations,
} from '../disk/inlineStyle';
import { RAW_TEXT_ELEMENTS, VOID_ELEMENTS } from '../disk/layout';
import type { ChromePick } from './commentPick';
import type { FrameMode, PickEditFields } from './frame/frameMessages';
import type { IconName } from './ui/icons';

type Editability = 'editable' | 'no-number' | 'shared-number';

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
const COMPUTED_RGB = /^rgba?\((\d{1,3}), (\d{1,3}), (\d{1,3})(?:, ([0-9.]+))?\)$/;

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

// What a colour field shows for a computed colour: the text (placeholder), the native swatch's
// #rrggbb, and whether it is no colour at all.
export const colorDisplay = (
	computed: string | undefined,
): { text: string; swatch: string; none: boolean } => {
	if (computed === undefined) {
		return { text: '', swatch: FALLBACK_HEX, none: false };
	}
	const hex = toHexColor(computed);
	if (hex === undefined) {
		return { text: computed, swatch: FALLBACK_HEX, none: false };
	}
	const alpha = Number(COMPUTED_RGB.exec(computed)?.[4] ?? '1');
	if (alpha === 0) {
		return { text: 'None', swatch: FALLBACK_HEX, none: true };
	}
	return { text: alpha >= 1 ? hex : computed, swatch: hex, none: false };
};

type Selection = 'text' | 'mixed' | 'container' | 'no-text';

export type SectionId = 'text' | 'appearance' | 'spacing' | 'border';

type FieldBase = {
	field: StyleField;
	// Visible, inside the field.
	label: string;
	// The accessible name before the set suffix.
	name: string;
	set: boolean;
	// Spans both grid columns.
	wide: boolean;
};

// change undefined: a display-only option (the current value is outside the list).
export type SelectOption = { value: string; label: string; change: StyleChange | undefined };

type SegmentButton = {
	name: string;
	icon?: IconName;
	glyph?: 'I' | 'U' | 'S';
	pressed: boolean;
	// The pressed look only; the group's set names it.
	set: boolean;
	change: StyleChange;
};

export type FieldView =
	| (FieldBase & { control: 'text'; value: string; placeholder: string })
	| (FieldBase & {
			control: 'color';
			value: string;
			placeholder: string;
			swatch: string;
			none: boolean;
			pickerName: string;
	  })
	| (FieldBase & { control: 'select'; options: SelectOption[]; selected: string })
	| {
			control: 'segments';
			id: 'text-style' | 'align';
			name: string;
			set: boolean;
			wide: false;
			buttons: SegmentButton[];
	  };

export type ContentView =
	| { state: 'plain'; value: string; liveText: string }
	| { state: 'too-long' };

type SectionAction = {
	kind: 'reset' | 'add-border';
	label: 'Reset' | 'Add border';
	name: string;
	enabled: boolean;
	changes: StyleChange[];
	announcement: string;
};

type SectionTitle = 'Text' | 'Typography' | 'Appearance' | 'Spacing' | 'Border';

export type SectionView = {
	id: SectionId;
	title: SectionTitle;
	// Mixed only.
	hint: string | undefined;
	fields: FieldView[];
	action: SectionAction;
};

type EditableSections = {
	selection: Selection;
	// The 'text' selection only; the first row of Text.
	content: ContentView | undefined;
	// edit.style is null (over MAX_PICK_STYLE_CHARS): sections is [].
	styleTooLong: boolean;
	sections: SectionView[];
};

type EditableView = { kind: 'editable'; target: string } & EditableSections;

const MIXED_HINT = 'To change these words, ask the Agent or select a part that holds only text.';

// Each section's style fields in render order; Reset clears them all (Gap even while hidden).
const SECTION_FIELDS = {
	text: [
		'font-size',
		'color',
		'font-weight',
		'font-style',
		'text-decoration-line',
		'text-align',
		'line-height',
		'letter-spacing',
		'text-transform',
	],
	appearance: ['background-color', 'border-radius', 'overflow', 'opacity'],
	spacing: ['padding', 'margin', 'gap'],
	border: ['border-width', 'border-style', 'border-color'],
} as const satisfies Record<SectionId, readonly StyleField[]>;

const BORDER_FIELDS: ReadonlySet<StyleField> = new Set(SECTION_FIELDS.border);

const WIDE_FIELDS: ReadonlySet<StyleField> = new Set([
	'background-color',
	'opacity',
	'padding',
	'margin',
	'gap',
	'border-color',
]);

// Visible label, then the accessible name when it differs.
const FIELD_NAMES: Partial<Record<StyleField, { label: string; name?: string }>> = {
	'font-size': { label: 'Size' },
	color: { label: 'Color' },
	'font-weight': { label: 'Weight' },
	'line-height': { label: 'Leading' },
	'letter-spacing': { label: 'Tracking' },
	'text-transform': { label: 'Case' },
	'background-color': { label: 'Background' },
	'border-radius': { label: 'Radius' },
	overflow: { label: 'Overflow' },
	opacity: { label: 'Opacity' },
	padding: { label: 'Padding' },
	margin: { label: 'Margin' },
	gap: { label: 'Gap' },
	'border-width': { label: 'Width', name: 'Border width' },
	'border-style': { label: 'Style', name: 'Border style' },
	'border-color': { label: 'Color', name: 'Border color' },
};

const PICKER_NAMES: Partial<Record<StyleField, string>> = {
	color: 'Color picker',
	'background-color': 'Background picker',
	'border-color': 'Border color picker',
};

// For Case, Overflow and Border Style the label is the value.
const keywordOptions = (values: readonly string[]): { value: string; label: string }[] =>
	values.map((value) => ({ value, label: value }));

// value: what is saved; label: what shows.
const SELECT_OPTIONS: Partial<Record<StyleField, readonly { value: string; label: string }[]>> = {
	'font-weight': [
		{ value: '100', label: 'Thin' },
		{ value: '200', label: 'Extra Light' },
		{ value: '300', label: 'Light' },
		{ value: '400', label: 'Regular' },
		{ value: '500', label: 'Medium' },
		{ value: '600', label: 'Semibold' },
		{ value: '700', label: 'Bold' },
		{ value: '800', label: 'Extra Bold' },
		{ value: '900', label: 'Black' },
	],
	'text-transform': keywordOptions(['none', 'uppercase', 'lowercase', 'capitalize']),
	overflow: keywordOptions(['visible', 'hidden', 'clip', 'scroll', 'auto']),
	'border-style': keywordOptions(['none', 'solid', 'dashed', 'dotted', 'double']),
};

const GAP_DISPLAYS: ReadonlySet<string> = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);

// ponytail: Align assumes left-to-right (`start` is left); `direction` is not in computed.
// Upgrade: add `direction` to EDIT_STYLE_FIELDS and map start / end by it.
const ALIGN_PRESSED: Readonly<Record<string, string>> = {
	left: 'left',
	start: 'left',
	'-webkit-left': 'left',
	right: 'right',
	end: 'right',
	'-webkit-right': 'right',
	center: 'center',
	'-webkit-center': 'center',
	justify: 'justify',
};

const ALIGN_BUTTONS = [
	{ value: 'left', name: 'Align left', icon: 'align-left' },
	{ value: 'center', name: 'Align center', icon: 'align-center' },
	{ value: 'right', name: 'Align right', icon: 'align-right' },
	{ value: 'justify', name: 'Justify', icon: 'align-justify' },
] as const satisfies readonly { value: string; name: string; icon: IconName }[];

// Set: the style attribute holds a declaration Reset on the field's section removes because of
// it. Never a font, text-decoration or background parent: Reset keeps those (D2).
// ponytail: a parent Reset keeps (`background: #ccc` on #picture) shows no dot and cannot be
// cleared from the inspector; the Agent removes it. Upgrade: a 9h edit-core rule for parents.
const declaredProperties = (style: string): ReadonlySet<string> =>
	new Set(
		splitStyleDeclarations(style).segments.flatMap((segment) =>
			segment.property === undefined ? [] : [segment.property],
		),
	);

const isSet = (declared: ReadonlySet<string>, field: StyleField): boolean =>
	clearedProperties(field).some((property) => declared.has(property)) ||
	(BORDER_FIELDS.has(field) && BORDER_PARENTS.some((property) => declared.has(property)));

const selectionOf = (pick: ChromePick, edit: PickEditFields): Selection => {
	if (VOID_ELEMENTS.has(pick.tagName) || RAW_TEXT_ELEMENTS.has(pick.tagName)) {
		return 'no-text';
	}
	if (edit.textState === 'mixed') {
		return 'mixed';
	}
	return edit.textState === 'elements' ? 'container' : 'text';
};

const selectOptions = ({
	field,
	computed,
}: {
	field: StyleField;
	computed: string | undefined;
}): { options: SelectOption[]; selected: string } => {
	const options: SelectOption[] = (SELECT_OPTIONS[field] ?? []).map((option) => ({
		...option,
		change: { field, value: option.value },
	}));
	if (computed !== undefined && options.some((option) => option.value === computed)) {
		return { options, selected: computed };
	}
	// The current value outside the list shows, and saves nothing.
	const extra = computed ?? '';
	return {
		options: [...options, { value: extra, label: computed ?? '–', change: undefined }],
		selected: extra,
	};
};

// I flips italic; U and S flip one token of the rest and keep the other (other tokens drop).
// ponytail: `overline` and other decoration tokens drop on a U or S click. Upgrade: keep them.
const textStyleButtons = ({
	computed,
	declared,
}: {
	computed: PickEditFields['computed'];
	declared: ReadonlySet<string>;
}): SegmentButton[] => {
	const fontStyle = computed['font-style'] ?? '';
	const italic = fontStyle === 'italic' || fontStyle.startsWith('oblique');
	const tokens = new Set((computed['text-decoration-line'] ?? '').split(' '));
	const underline = tokens.has('underline');
	const strike = tokens.has('line-through');
	const decoration = (next: { underline: boolean; strike: boolean }): StyleChange => ({
		field: 'text-decoration-line',
		value:
			[next.underline ? 'underline' : '', next.strike ? 'line-through' : '']
				.filter((token) => token !== '')
				.join(' ') || 'none',
	});
	const decorationSet = isSet(declared, 'text-decoration-line');
	return [
		{
			name: 'Italic',
			glyph: 'I',
			pressed: italic,
			set: isSet(declared, 'font-style'),
			change: { field: 'font-style', value: italic ? 'normal' : 'italic' },
		},
		{
			name: 'Underline',
			glyph: 'U',
			pressed: underline,
			set: decorationSet,
			change: decoration({ underline: !underline, strike }),
		},
		{
			name: 'Strikethrough',
			glyph: 'S',
			pressed: strike,
			set: decorationSet,
			change: decoration({ underline, strike: !strike }),
		},
	];
};

const alignButtons = ({
	computed,
	set,
}: {
	computed: string | undefined;
	set: boolean;
}): SegmentButton[] => {
	const pressed = ALIGN_PRESSED[computed ?? ''];
	return ALIGN_BUTTONS.map(({ value, name, icon }) => ({
		name,
		icon,
		pressed: pressed === value,
		set,
		change: { field: 'text-align', value },
	}));
};

const fieldView = ({
	field,
	edit,
	declared,
}: {
	field: StyleField;
	edit: PickEditFields;
	declared: ReadonlySet<string>;
}): FieldView => {
	const names = FIELD_NAMES[field];
	const base: FieldBase = {
		field,
		label: names?.label ?? field,
		name: names?.name ?? names?.label ?? field,
		set: isSet(declared, field),
		wide: WIDE_FIELDS.has(field),
	};
	const computed = edit.computed[field];
	const pickerName = PICKER_NAMES[field];
	if (pickerName !== undefined) {
		const display = colorDisplay(computed);
		return {
			...base,
			control: 'color',
			value: inlineValue(edit.style, field),
			placeholder: display.text,
			swatch: display.swatch,
			none: display.none,
			pickerName,
		};
	}
	if (SELECT_OPTIONS[field] !== undefined) {
		return { ...base, control: 'select', ...selectOptions({ field, computed }) };
	}
	return {
		...base,
		control: 'text',
		value: inlineValue(edit.style, field),
		placeholder: computed ?? '',
	};
};

const textFields = ({
	edit,
	declared,
}: {
	edit: PickEditFields;
	declared: ReadonlySet<string>;
}): FieldView[] => {
	const view = (field: StyleField): FieldView => fieldView({ field, edit, declared });
	const textStyle = textStyleButtons({ computed: edit.computed, declared });
	const alignSet = isSet(declared, 'text-align');
	return [
		view('font-size'),
		view('color'),
		view('font-weight'),
		{
			control: 'segments',
			id: 'text-style',
			name: 'Text style',
			set: isSet(declared, 'font-style') || isSet(declared, 'text-decoration-line'),
			wide: false,
			buttons: textStyle,
		},
		{
			control: 'segments',
			id: 'align',
			name: 'Align',
			set: alignSet,
			wide: false,
			buttons: alignButtons({ computed: edit.computed['text-align'], set: alignSet }),
		},
		view('line-height'),
		view('letter-spacing'),
		view('text-transform'),
	];
};

const ADD_BORDER: SectionAction = {
	kind: 'add-border',
	label: 'Add border',
	name: 'Add border',
	enabled: true,
	// The colour stays currentColor and is not written.
	changes: [
		{ field: 'border-width', value: '1px' },
		{ field: 'border-style', value: 'solid' },
	],
	announcement: 'Border added.',
};

const resetAction = ({
	id,
	title,
	declared,
}: {
	id: SectionId;
	title: SectionTitle;
	declared: ReadonlySet<string>;
}): SectionAction => ({
	kind: 'reset',
	label: 'Reset',
	name: `Reset ${title}`,
	enabled: SECTION_FIELDS[id].some((field) => isSet(declared, field)),
	changes: SECTION_FIELDS[id].map((field) => ({ field, value: '' })),
	announcement: `${title} reset.`,
});

const contentOf = (edit: PickEditFields): ContentView =>
	edit.textState === 'too-long'
		? { state: 'too-long' }
		: { state: 'plain', value: asciiTrim(edit.text), liveText: edit.text };

// drafted: the fields with an open draft for this element. Previewing an emptied box drops its
// declaration from the frame, so the re-posted pick alone would unmount the field mid-typing.
export const editableSections = ({
	pick,
	edit,
	drafted,
}: {
	pick: ChromePick;
	edit: PickEditFields;
	drafted: ReadonlySet<StyleField>;
}): EditableSections => {
	const selection = selectionOf(pick, edit);
	const content = selection === 'text' ? contentOf(edit) : undefined;
	if (edit.style === null) {
		return { selection, content, styleTooLong: true, sections: [] };
	}
	const declared = declaredProperties(edit.style);
	const view = (field: StyleField): FieldView => fieldView({ field, edit, declared });
	const section = ({
		id,
		title,
		fields,
		hint,
	}: {
		id: SectionId;
		title: SectionTitle;
		fields: FieldView[];
		hint?: string;
	}): SectionView => ({
		id,
		title,
		hint,
		fields,
		action: resetAction({ id, title, declared }),
	});
	const showsGap =
		GAP_DISPLAYS.has(pick.styles.display ?? '') || isSet(declared, 'gap') || drafted.has('gap');
	const bordered =
		SECTION_FIELDS.border.some((field) => isSet(declared, field) || drafted.has(field)) ||
		(edit.computed['border-style'] ?? 'none') !== 'none';
	const sections: SectionView[] = [
		section({
			id: 'appearance',
			title: 'Appearance',
			fields: SECTION_FIELDS.appearance.map(view),
		}),
		section({
			id: 'spacing',
			title: 'Spacing',
			fields: [view('padding'), view('margin'), ...(showsGap ? [view('gap')] : [])],
		}),
		bordered
			? section({ id: 'border', title: 'Border', fields: SECTION_FIELDS.border.map(view) })
			: { id: 'border', title: 'Border', hint: undefined, fields: [], action: ADD_BORDER },
	];
	if (selection === 'text' || selection === 'mixed') {
		sections.unshift(
			section({
				id: 'text',
				title: selection === 'text' ? 'Text' : 'Typography',
				fields: textFields({ edit, declared }),
				hint: selection === 'mixed' ? MIXED_HINT : undefined,
			}),
		);
	}
	return { selection, content, styleTooLong: false, sections };
};

export const inspectorView = (
	pick: ChromePick | undefined,
	drafted: ReadonlySet<StyleField>,
): InspectorView => {
	if (pick?.edit === undefined) {
		return { kind: 'empty' };
	}
	const target = pick.isPage ? 'page' : pick.tagName;
	const reason = editability(pick.edit);
	return reason === 'editable'
		? { kind: 'editable', target, ...editableSections({ pick, edit: pick.edit, drafted }) }
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
