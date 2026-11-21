import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { StyleField } from '../disk/editValues';
import type { ChromePick } from './commentPick';
import {
	colorDisplay,
	editability,
	editableSections,
	type FieldView,
	inlineValue,
	inspectorView,
	pickAnnouncementText,
	toHexColor,
} from './editInspector';
import type { PickEditFields } from './frame/frameMessages';

const NO_DRAFTS: ReadonlySet<StyleField> = new Set();

const edit: PickEditFields = {
	sourceNumber: 4,
	sharedNumber: false,
	textState: 'plain',
	text: '\n    Title\n  ',
	style: 'font-size: 32px; color: #ff0000',
	computed: {
		'font-size': '32px',
		color: 'rgb(255, 0, 0)',
		padding: '0px',
		margin: '21px 0px',
		'font-weight': '700',
	},
};

const pickWith = (
	fields: Partial<PickEditFields> | undefined,
	overrides: Partial<ChromePick> = {},
): ChromePick => ({
	frameId: 'a',
	sequence: 1,
	selector: 'h1',
	tagName: 'h1',
	text: 'Title',
	rect: { x: 0, y: 0, width: 10, height: 10 },
	point: { x: 1, y: 1 },
	box: { width: 10, height: 10 },
	styles: {
		'font-size': '32px',
		color: 'rgb(255, 0, 0)',
		padding: '0px',
		margin: '21px 0px',
	},
	isPage: false,
	repost: false,
	...(fields === undefined ? {} : { edit: { ...edit, ...fields } }),
	...overrides,
});

test('no pick, or a pick without edit fields, shows the empty inspector', () => {
	assert.deepEqual(inspectorView(undefined, NO_DRAFTS), { kind: 'empty' });
	assert.deepEqual(inspectorView(pickWith(undefined), NO_DRAFTS), { kind: 'empty' });
});

test('no number and a shared number are not editable, page picks name the page', () => {
	assert.deepEqual(inspectorView(pickWith({ sourceNumber: null }), NO_DRAFTS), {
		kind: 'not-editable',
		reason: 'no-number',
		target: 'h1',
	});
	assert.deepEqual(inspectorView(pickWith({ sharedNumber: true }), NO_DRAFTS), {
		kind: 'not-editable',
		reason: 'shared-number',
		target: 'h1',
	});
	assert.deepEqual(
		inspectorView(pickWith({ sourceNumber: null }, { isPage: true, tagName: 'body' }), NO_DRAFTS),
		{
			kind: 'not-editable',
			reason: 'no-number',
			target: 'page',
		},
	);
	assert.equal(editability({ ...edit, sourceNumber: null, sharedNumber: false }), 'no-number');
	assert.equal(editability(edit), 'editable');
});

test('an editable pick is the section model, targeting the tag or the page', () => {
	const pick = pickWith({});
	assert.ok(pick.edit !== undefined);
	assert.deepEqual(inspectorView(pick, NO_DRAFTS), {
		kind: 'editable',
		target: 'h1',
		...editableSections({ pick, edit: pick.edit, drafted: NO_DRAFTS }),
	});
	const page = inspectorView(
		pickWith({ textState: 'elements', text: '' }, { isPage: true }),
		NO_DRAFTS,
	);
	assert.ok(page.kind === 'editable');
	assert.equal(page.target, 'page');
	assert.equal(page.selection, 'container');
});

test('inlineValue reads the last declaration of that exact property, as typed', () => {
	const style = 'font-size: 32px; color: #ff0000';
	assert.equal(inlineValue(style, 'font-size'), '32px');
	assert.equal(inlineValue(style, 'color'), '#ff0000');
	assert.equal(inlineValue('padding: 4px; padding: 8px 16px', 'padding'), '8px 16px');
	assert.equal(inlineValue('PADDING: 4px', 'padding'), '4px');
	assert.equal(inlineValue('padding-left: 4px', 'padding'), '');
	assert.equal(inlineValue(null, 'padding'), '');
	assert.equal(inlineValue('margin: 0 auto !important', 'margin'), '0 auto !important');
	assert.equal(inlineValue('margin: /* gap */ 1.5rem ', 'margin'), '/* gap */ 1.5rem');
	assert.equal(inlineValue('font-size:\n  var(--title)', 'font-size'), 'var(--title)');
	// A colon inside a comment never starts the value.
	assert.equal(inlineValue('/* note: brand */ color: #ff0000', 'color'), '#ff0000');
	assert.equal(inlineValue('color/*a:b*/: red', 'color'), 'red');
});

test('the toolbar announcement says not editable only in Edit mode', () => {
	const blocked = pickWith({ sourceNumber: null });
	assert.equal(
		pickAnnouncementText({ mode: 'edit', pick: blocked }),
		'h1 element selected, not editable',
	);
	assert.equal(
		pickAnnouncementText({
			mode: 'edit',
			pick: pickWith({ sharedNumber: true }, { isPage: true }),
		}),
		'Whole frame selected, not editable',
	);
	assert.equal(pickAnnouncementText({ mode: 'edit', pick: pickWith({}) }), 'h1 element selected');
	// Comment-mode picks carry no edit fields; a stray one never adds the suffix there.
	assert.equal(pickAnnouncementText({ mode: 'comment', pick: blocked }), 'h1 element selected');
	assert.equal(pickAnnouncementText({ mode: 'interact', pick: blocked }), '');
	assert.equal(pickAnnouncementText({ mode: 'edit', pick: undefined }), '');
});

test('toHexColor reads only Chromium computed rgb() and rgba()', () => {
	assert.equal(toHexColor('rgb(255, 0, 0)'), '#ff0000');
	assert.equal(toHexColor('rgba(0, 0, 255, 0.5)'), '#0000ff');
	assert.equal(toHexColor('rgb(10, 20, 30)'), '#0a141e');
	for (const value of [
		'rgb(256, 0, 0)',
		'rgb(255 0 0)',
		'#ff0000',
		'red',
		'oklch(0.7 0.1 200)',
		'',
	]) {
		assert.equal(toHexColor(value), undefined, value);
	}
});

const sectionsOf = (
	fields: Partial<PickEditFields>,
	overrides: Partial<ChromePick> = {},
	drafted: ReadonlySet<StyleField> = NO_DRAFTS,
): ReturnType<typeof editableSections> => {
	const pick = pickWith(fields, overrides);
	assert.ok(pick.edit !== undefined);
	return editableSections({ pick, edit: pick.edit, drafted });
};

const fieldOf = (view: ReturnType<typeof editableSections>, key: string): FieldView | undefined =>
	view.sections
		.flatMap((section) => section.fields)
		.find((candidate) =>
			candidate.control === 'segments' ? candidate.id === key : candidate.field === key,
		);

const sectionOf = (view: ReturnType<typeof editableSections>, id: string) =>
	view.sections.find((section) => section.id === id);

test('the selection kind picks the sections; the tag rule wins over every text state', () => {
	const titles = (view: ReturnType<typeof editableSections>) =>
		view.sections.map((section) => section.title);
	const text = sectionsOf({});
	assert.equal(text.selection, 'text');
	assert.deepEqual(titles(text), ['Text', 'Appearance', 'Spacing', 'Border']);
	assert.deepEqual(text.content, { state: 'plain', value: 'Title', liveText: '\n    Title\n  ' });
	assert.equal(sectionOf(text, 'text')?.hint, undefined);
	// An empty element is text with empty Content; too-long text keeps Text without a Content box.
	assert.deepEqual(sectionsOf({ text: '' }).content, { state: 'plain', value: '', liveText: '' });
	const long = sectionsOf({ textState: 'too-long', text: '' });
	assert.equal(long.selection, 'text');
	assert.deepEqual(long.content, { state: 'too-long' });
	const mixed = sectionsOf({ textState: 'mixed', text: '' });
	assert.equal(mixed.selection, 'mixed');
	assert.equal(mixed.content, undefined);
	assert.deepEqual(titles(mixed), ['Typography', 'Appearance', 'Spacing', 'Border']);
	assert.equal(
		sectionOf(mixed, 'text')?.hint,
		'To change these words, ask the Agent or select a part that holds only text.',
	);
	const container = sectionsOf({ textState: 'elements', text: '' });
	assert.equal(container.selection, 'container');
	assert.deepEqual(titles(container), ['Appearance', 'Spacing', 'Border']);
	for (const tagName of ['img', 'iframe']) {
		const view = sectionsOf({}, { tagName });
		assert.equal(view.selection, 'no-text', tagName);
		assert.equal(view.content, undefined);
		assert.deepEqual(titles(view), ['Appearance', 'Spacing', 'Border']);
	}
});

test('an over-cap style renders no section, only Content', () => {
	assert.deepEqual(sectionsOf({ style: null }), {
		selection: 'text',
		content: { state: 'plain', value: 'Title', liveText: '\n    Title\n  ' },
		styleTooLong: true,
		sections: [],
	});
});

test('set: through a longhand or a border parent; never through font or background', () => {
	const view = sectionsOf({
		style: 'padding-left: 2px; border-top: 1px solid; font: 12px serif; background: #ccc',
	});
	assert.equal(fieldOf(view, 'padding')?.set, true);
	// A field set only through a longhand or parent shows the dot and an empty box.
	assert.deepEqual(fieldOf(view, 'padding'), {
		field: 'padding',
		label: 'Padding',
		name: 'Padding',
		set: true,
		wide: true,
		control: 'text',
		value: '',
		placeholder: '0px',
	});
	for (const field of ['border-width', 'border-style', 'border-color']) {
		assert.equal(fieldOf(view, field)?.set, true, field);
	}
	for (const field of ['font-size', 'font-weight', 'line-height', 'background-color', 'margin']) {
		assert.equal(fieldOf(view, field)?.set, false, field);
	}
	assert.equal(fieldOf(view, 'text-style')?.set, false);
	assert.equal(sectionOf(view, 'appearance')?.action.enabled, false);
	assert.equal(sectionOf(view, 'spacing')?.action.enabled, true);
});

test('colorDisplay: lowercase hex, None for no colour, translucent and other spaces as given', () => {
	assert.deepEqual(colorDisplay('rgb(255, 0, 170)'), {
		text: '#ff00aa',
		swatch: '#ff00aa',
		none: false,
	});
	assert.deepEqual(colorDisplay('rgba(0, 0, 0, 0)'), {
		text: 'None',
		swatch: '#000000',
		none: true,
	});
	assert.deepEqual(colorDisplay('rgba(16, 32, 48, 0.5)'), {
		text: 'rgba(16, 32, 48, 0.5)',
		swatch: '#102030',
		none: false,
	});
	assert.deepEqual(colorDisplay('oklch(0.7 0.1 200)'), {
		text: 'oklch(0.7 0.1 200)',
		swatch: '#000000',
		none: false,
	});
	assert.deepEqual(colorDisplay(undefined), { text: '', swatch: '#000000', none: false });
	// The colour field: the inline value as typed, the computed display as placeholder.
	const view = sectionsOf({ style: 'color: red', computed: { color: 'rgb(255, 0, 0)' } });
	assert.deepEqual(fieldOf(view, 'color'), {
		field: 'color',
		label: 'Color',
		name: 'Color',
		set: true,
		wide: false,
		control: 'color',
		value: 'red',
		placeholder: '#ff0000',
		swatch: '#ff0000',
		none: false,
		pickerName: 'Color picker',
	});
});

test('align: start, end and -webkit-center map; match-parent presses none; each button saves', () => {
	const pressed = (textAlign: string): string[] => {
		const align = fieldOf(sectionsOf({ computed: { 'text-align': textAlign } }), 'align');
		return align?.control === 'segments'
			? align.buttons.filter((button) => button.pressed).map((button) => button.name)
			: [];
	};
	assert.deepEqual(pressed('start'), ['Align left']);
	assert.deepEqual(pressed('end'), ['Align right']);
	assert.deepEqual(pressed('-webkit-center'), ['Align center']);
	assert.deepEqual(pressed('match-parent'), []);
	const align = fieldOf(sectionsOf({ computed: { 'text-align': 'left' } }), 'align');
	// The pressed, inherited button still saves its value explicitly.
	assert.deepEqual(align?.control === 'segments' ? align.buttons[0] : undefined, {
		name: 'Align left',
		icon: 'align-left',
		pressed: true,
		set: false,
		change: { field: 'text-align', value: 'left' },
	});
});

test('selects: the computed value is selected; an out-of-list or missing value is display-only', () => {
	const weight = fieldOf(sectionsOf({ computed: { 'font-weight': '700' } }), 'font-weight');
	assert.ok(weight?.control === 'select');
	assert.equal(weight.selected, '700');
	assert.equal(weight.options.length, 9);
	assert.deepEqual(weight.options[6], {
		value: '700',
		label: 'Bold',
		change: { field: 'font-weight', value: '700' },
	});
	const variable = fieldOf(sectionsOf({ computed: { 'font-weight': '450' } }), 'font-weight');
	assert.ok(variable?.control === 'select');
	assert.equal(variable.selected, '450');
	assert.deepEqual(variable.options.at(-1), { value: '450', label: '450', change: undefined });
	const missing = fieldOf(sectionsOf({ computed: {} }), 'overflow');
	assert.ok(missing?.control === 'select');
	assert.equal(missing.selected, '');
	assert.deepEqual(missing.options.at(-1), { value: '', label: '–', change: undefined });
	assert.equal(missing.options.length, 6);
});

test('text style: I flips italic; U and S combine and drop other tokens', () => {
	const buttons = (computed: PickEditFields['computed'], style = '') => {
		const group = fieldOf(sectionsOf({ computed, style }), 'text-style');
		return group?.control === 'segments' ? group.buttons : [];
	};
	const [italic, underline, strike] = buttons({ 'font-style': 'oblique 10deg' });
	assert.equal(italic?.pressed, true);
	assert.deepEqual(italic?.change, { field: 'font-style', value: 'normal' });
	assert.deepEqual(buttons({ 'font-style': 'normal' })[0]?.change, {
		field: 'font-style',
		value: 'italic',
	});
	assert.equal(underline?.pressed, false);
	assert.deepEqual(underline?.change, { field: 'text-decoration-line', value: 'underline' });
	assert.deepEqual(strike?.change, { field: 'text-decoration-line', value: 'line-through' });
	const both = buttons({ 'text-decoration-line': 'underline line-through' });
	assert.deepEqual(both[1]?.change.value, 'line-through');
	assert.deepEqual(both[2]?.change.value, 'underline');
	const overline = buttons({ 'text-decoration-line': 'underline overline' });
	assert.deepEqual(overline[2]?.change.value, 'underline line-through');
	assert.deepEqual(overline[1]?.change.value, 'none');
	// Each button's set is its own property's; the group is set when either is.
	const set = buttons({}, 'text-decoration-line: underline');
	assert.deepEqual(
		set.map((button) => button.set),
		[false, true, true],
	);
	assert.equal(fieldOf(sectionsOf({ style: 'font-style: italic' }), 'text-style')?.set, true);
});

test('gap shows for flex and grid displays or when set; hidden for block or no display', () => {
	const hasGap = (display: string | undefined, style = '', drafted = NO_DRAFTS): boolean =>
		fieldOf(
			sectionsOf({ style }, { styles: display === undefined ? {} : { display } }, drafted),
			'gap',
		) !== undefined;
	for (const display of ['flex', 'inline-flex', 'grid', 'inline-grid']) {
		assert.equal(hasGap(display), true, display);
	}
	assert.equal(hasGap('block'), false);
	assert.equal(hasGap(undefined), false);
	assert.equal(hasGap('block', 'row-gap: 4px'), true);
	// An emptied Gap box previews '' (no longer set): its draft keeps it until the draft ends.
	assert.equal(hasGap('block', '', new Set(['gap'])), true);
	assert.equal(hasGap('block', '', new Set(['padding'])), false);
});

test('border presence: computed style or any set field; otherwise Add border', () => {
	const border = (fields: Partial<PickEditFields>) => sectionOf(sectionsOf(fields), 'border');
	const none = border({ computed: { 'border-style': 'none', 'border-width': '0px' } });
	assert.deepEqual(none?.fields, []);
	assert.deepEqual(none?.action, {
		kind: 'add-border',
		label: 'Add border',
		name: 'Add border',
		enabled: true,
		changes: [
			{ field: 'border-width', value: '1px' },
			{ field: 'border-style', value: 'solid' },
		],
		announcement: 'Border added.',
	});
	assert.equal(border({ computed: {} })?.action.kind, 'add-border');
	const ruled = border({ computed: { 'border-style': 'none none solid' } });
	assert.equal(ruled?.fields.length, 3);
	assert.equal(ruled?.action.kind, 'reset');
	assert.equal(ruled?.action.enabled, false);
	// The multi-value style shows as given: an extra, display-only option.
	const style = ruled?.fields[1];
	assert.ok(style?.control === 'select');
	assert.equal(style.selected, 'none none solid');
	assert.equal(style.name, 'Border style');
	assert.equal(style.label, 'Style');
	assert.equal(border({ style: 'border: 1px solid #ddd', computed: {} })?.action.enabled, true);
	const widthOnly = border({ style: 'border-width: 3px', computed: { 'border-style': 'none' } });
	assert.equal(widthOnly?.fields.length, 3);
	assert.equal(widthOnly?.action.enabled, true);
	// An emptied Width box previews '' (no border left): its draft keeps all three fields.
	const emptied = (drafted: ReadonlySet<StyleField>) =>
		sectionOf(
			sectionsOf({ style: '', computed: { 'border-style': 'none' } }, {}, drafted),
			'border',
		);
	const drafted = emptied(new Set(['border-width']));
	assert.equal(drafted?.fields.length, 3);
	assert.equal(drafted?.action.kind, 'reset');
	assert.equal(emptied(new Set(['padding']))?.action.kind, 'add-border');
});

test('every Reset clears its section in render order and names its section', () => {
	const view = sectionsOf({ style: 'font-size: 2px', computed: { 'border-style': 'solid' } });
	assert.deepEqual(
		view.sections.map(({ action }) => [action.name, action.announcement, action.enabled]),
		[
			['Reset Text', 'Text reset.', true],
			['Reset Appearance', 'Appearance reset.', false],
			['Reset Spacing', 'Spacing reset.', false],
			['Reset Border', 'Border reset.', false],
		],
	);
	const cleared = (id: string) =>
		sectionOf(view, id)?.action.changes.map((change) => {
			assert.equal(change.value, '');
			return change.field;
		});
	assert.deepEqual(cleared('text'), [
		'font-size',
		'color',
		'font-weight',
		'font-style',
		'text-decoration-line',
		'text-align',
		'line-height',
		'letter-spacing',
		'text-transform',
	]);
	assert.deepEqual(cleared('appearance'), [
		'background-color',
		'border-radius',
		'overflow',
		'opacity',
	]);
	// Gap is cleared even while hidden.
	assert.equal(fieldOf(view, 'gap'), undefined);
	assert.deepEqual(cleared('spacing'), ['padding', 'margin', 'gap']);
	assert.deepEqual(cleared('border'), ['border-width', 'border-style', 'border-color']);
	assert.equal(
		sectionOf(sectionsOf({ textState: 'mixed', text: '' }), 'text')?.action.name,
		'Reset Typography',
	);
});
