import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { ChromePick } from './commentPick';
import {
	editability,
	inlineValue,
	inspectorView,
	pickAnnouncementText,
	toHexColor,
} from './editInspector';
import type { PickEditFields } from './frame/frameMessages';

const edit: PickEditFields = {
	sourceNumber: 4,
	sharedNumber: false,
	textState: 'plain',
	text: '\n    Title\n  ',
	style: 'font-size: 32px; color: #ff0000',
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
	assert.deepEqual(inspectorView(undefined), { kind: 'empty' });
	assert.deepEqual(inspectorView(pickWith(undefined)), { kind: 'empty' });
});

test('no number and a shared number are not editable, page picks name the page', () => {
	assert.deepEqual(inspectorView(pickWith({ sourceNumber: null })), {
		kind: 'not-editable',
		reason: 'no-number',
		target: 'h1',
	});
	assert.deepEqual(inspectorView(pickWith({ sharedNumber: true })), {
		kind: 'not-editable',
		reason: 'shared-number',
		target: 'h1',
	});
	assert.deepEqual(
		inspectorView(pickWith({ sourceNumber: null }, { isPage: true, tagName: 'body' })),
		{
			kind: 'not-editable',
			reason: 'no-number',
			target: 'page',
		},
	);
	assert.equal(editability({ ...edit, sourceNumber: null, sharedNumber: false }), 'no-number');
	assert.equal(editability(edit), 'editable');
});

test('an editable pick fills the fields from the style attribute with computed placeholders', () => {
	const view = inspectorView(pickWith({}));
	assert.equal(view.kind, 'editable');
	if (view.kind !== 'editable') {
		return;
	}
	assert.equal(view.target, 'h1');
	// The field shows the trimmed text; liveText keeps the frame's raw text for 9e.
	assert.deepEqual(view.text, { state: 'plain', value: 'Title', liveText: '\n    Title\n  ' });
	assert.deepEqual(view.fields, [
		{ field: 'font-size', value: '32px', placeholder: '32px' },
		{ field: 'padding', value: '', placeholder: '0px' },
		{ field: 'margin', value: '', placeholder: '21px 0px' },
	]);
	assert.deepEqual(view.color, { hex: '#ff0000', value: '#ff0000', computed: false });
	// No inline colour: the computed one, marked computed; a missing computed value is ''.
	const plain = inspectorView(pickWith({ style: null }, { styles: {} }));
	assert.ok(plain.kind === 'editable');
	assert.deepEqual(plain.color, { hex: '#000000', value: '', computed: true });
	assert.deepEqual(
		plain.fields.map((field) => field.placeholder),
		['', '', ''],
	);
	const page = inspectorView(pickWith({ textState: 'children', text: '' }, { isPage: true }));
	assert.ok(page.kind === 'editable');
	assert.equal(page.target, 'page');
});

test('the text field: empty plain keeps a field, mixed and long show a hint, void and raw text none', () => {
	const textOf = (pick: ChromePick): unknown => {
		const view = inspectorView(pick);
		return view.kind === 'editable' ? view.text : view.kind;
	};
	assert.deepEqual(textOf(pickWith({ text: '' })), { state: 'plain', value: '', liveText: '' });
	assert.deepEqual(textOf(pickWith({ textState: 'children', text: '' })), { state: 'children' });
	assert.deepEqual(textOf(pickWith({ textState: 'too-long', text: '' })), { state: 'too-long' });
	// The tag rule wins over every text state.
	for (const tagName of ['img', 'input', 'iframe']) {
		for (const textState of ['plain', 'children', 'too-long'] as const) {
			assert.deepEqual(
				textOf(pickWith({ textState, text: '' }, { tagName })),
				{ state: 'none' },
				`${tagName} ${textState}`,
			);
		}
	}
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
	// F-138: a colon inside a comment never starts the value.
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

test('an over-cap style attribute shows the hint instead of the style fields', () => {
	const view = inspectorView(pickWith({ style: null }));
	assert.equal(view.kind === 'editable' ? view.style : '', 'too-long');
	const normal = inspectorView(pickWith({ style: '' }));
	assert.equal(normal.kind === 'editable' ? normal.style : '', 'editable');
});
