import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { ChromePick } from './commentPick';
import { MAX_EDIT_TEXT_CHARS, MAX_PICK_STYLE_CHARS } from '../disk/layout';
import {
	commitDraft,
	draftFate,
	draftPreview,
	type EditDraft,
	editability,
	fieldValue,
	inlineValue,
	inspectorView,
	pickAnnouncementText,
	startDraft,
	textMaxLength,
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

// ---- 9e drafts ----------------------------------------------------------------------------------

const draftOf = (
	field: EditDraft['field'],
	value: string,
	fields: Partial<PickEditFields> = {},
) => {
	const draft = startDraft({ pick: pickWith(fields), documentVersion: 2, field, value });
	assert.ok(draft !== undefined);
	return draft;
};

test('a draft starts only on an editable pick, with its key and raw baselines', () => {
	const draft = draftOf('text', 'New');
	assert.deepEqual(draft.key, { frameId: 'a', sourceNumber: 4, documentVersion: 2 });
	assert.equal(draft.liveText, '\n    Title\n  ');
	assert.equal(draft.style, 'font-size: 32px; color: #ff0000');
	for (const fields of [{ sourceNumber: null }, { sharedNumber: true }]) {
		assert.equal(
			startDraft({ pick: pickWith(fields), documentVersion: 2, field: 'text', value: 'x' }),
			undefined,
		);
	}
	assert.equal(
		startDraft({ pick: undefined, documentVersion: 2, field: 'text', value: 'x' }),
		undefined,
	);
	// An over-cap style: no style draft; text still drafts.
	assert.equal(
		startDraft({
			pick: pickWith({ style: null }),
			documentVersion: 2,
			field: 'padding',
			value: '1',
		}),
		undefined,
	);
	assert.ok(
		startDraft({ pick: pickWith({ style: null }), documentVersion: 2, field: 'text', value: 'x' }),
	);
});

test('a field shows its draft only for the element it started on', () => {
	const draft = draftOf('padding', '8');
	assert.equal(fieldValue({ draft, pick: pickWith({}), pickValue: '' }), '8');
	assert.equal(fieldValue({ draft, pick: pickWith({ sourceNumber: 5 }), pickValue: '2px' }), '2px');
	assert.equal(fieldValue({ draft: undefined, pick: pickWith({}), pickValue: '2px' }), '2px');
});

const previewStyle = (draft: EditDraft): string | undefined => {
	const preview = draftPreview(draft);
	return preview !== undefined && 'style' in preview ? preview.style : undefined;
};

test('previews: text keeps the live edges; styles use the core string rules', () => {
	assert.deepEqual(draftPreview(draftOf('text', 'New\ntitle')), {
		type: 'cd:edit-apply',
		sourceNumber: 4,
		text: '\n    New title\n  ',
	});
	assert.deepEqual(draftPreview(draftOf('font-size', '16')), {
		type: 'cd:edit-apply',
		sourceNumber: 4,
		style: 'font-size: 16px; color: #ff0000',
	});
	// Clearing removes the declaration; a shorthand drops its longhands.
	assert.equal(previewStyle(draftOf('color', '')), 'font-size: 32px;');
	assert.equal(
		previewStyle(draftOf('padding', '4', { style: 'padding-left: 2px; color: red' })),
		'color: red; padding: 4px',
	);
	// Not previewable: a refused value, or a result over the cap.
	assert.equal(draftPreview(draftOf('padding', '1)(')), undefined);
	assert.equal(
		draftPreview(draftOf('margin', '1', { style: `--x: ${'a'.repeat(MAX_PICK_STYLE_CHARS - 6)}` })),
		undefined,
	);
});

test('unchanged commits send nothing and revert only a sent preview', () => {
	const sixteen = draftOf('font-size', '32', { style: 'font-size: 32px' });
	assert.deepEqual(commitDraft(sixteen), { kind: 'unchanged', revert: undefined });
	const previewed = commitDraft({ ...sixteen, previewed: true });
	assert.equal(previewed.kind, 'unchanged');
	assert.deepEqual(previewed.kind === 'unchanged' ? previewed.revert : undefined, {
		type: 'cd:edit-apply',
		sourceNumber: 4,
		style: 'font-size: 32px',
	});
	assert.equal(commitDraft(draftOf('color', '#FF0000')).kind, 'unchanged');
	// A newline-only change normalizes to the same text.
	assert.equal(commitDraft(draftOf('text', 'Title', { text: 'Ti\ntle' })).kind, 'save');
	assert.equal(commitDraft(draftOf('text', 'a b', { text: 'a\nb' })).kind, 'unchanged');
	// A baseline the rules refuse counts as changed.
	assert.equal(
		commitDraft(draftOf('padding', '4', { style: 'padding: 4px !important' })).kind,
		'save',
	);
});

test('invalid commits keep the draft with its error and restore the baseline', () => {
	const invalid = commitDraft(draftOf('padding', '16 apples;'));
	assert.equal(invalid.kind, 'invalid');
	assert.equal(invalid.kind === 'invalid' ? invalid.error : '', 'invalid-length');
	assert.deepEqual(invalid.kind === 'invalid' ? invalid.revert : undefined, {
		type: 'cd:edit-apply',
		sourceNumber: 4,
		style: 'font-size: 32px; color: #ff0000',
	});
	const open = commitDraft(draftOf('padding', '4', { style: 'background: url(a' }));
	assert.equal(open.kind === 'invalid' ? open.error : '', 'complex-style');
	const control = commitDraft(draftOf('text', 'a\u0001b'));
	assert.equal(control.kind === 'invalid' ? control.error : '', 'control-text');
});

test('a save carries the draft key, the raw value and, for text, the baseline', () => {
	assert.deepEqual(commitDraft(draftOf('text', ' New ')), {
		kind: 'save',
		commit: {
			key: { frameId: 'a', sourceNumber: 4, documentVersion: 2 },
			field: 'text',
			value: ' New ',
			liveText: '\n    Title\n  ',
		},
	});
	assert.deepEqual(commitDraft(draftOf('margin', ' 8 ')), {
		kind: 'save',
		commit: {
			key: { frameId: 'a', sourceNumber: 4, documentVersion: 2 },
			field: 'margin',
			value: ' 8 ',
		},
	});
});

test('the text maxlength leaves room for the baseline edge whitespace', () => {
	assert.equal(textMaxLength('\n  Title \n'), MAX_EDIT_TEXT_CHARS - 5);
	assert.equal(textMaxLength('   '), MAX_EDIT_TEXT_CHARS - 3);
	assert.equal(textMaxLength(''), MAX_EDIT_TEXT_CHARS);
});

test('draft lifecycle: reload drops, another element commits, a lost number drops', () => {
	const draft = draftOf('padding', '8');
	const live = { kind: 'iframe' as const, documentVersion: 2 };
	assert.equal(draftFate({ draft, frame: live, pick: pickWith({}) }), 'keep');
	assert.equal(draftFate({ draft, frame: undefined, pick: undefined }), 'drop');
	assert.equal(draftFate({ draft, frame: { ...live, kind: 'tile' }, pick: undefined }), 'drop');
	assert.equal(
		draftFate({ draft, frame: { ...live, documentVersion: 3 }, pick: pickWith({}) }),
		'drop',
	);
	assert.equal(draftFate({ draft, frame: live, pick: undefined }), 'keep');
	assert.equal(draftFate({ draft, frame: live, pick: pickWith({ sourceNumber: 9 }) }), 'commit');
	assert.equal(
		draftFate({ draft, frame: live, pick: pickWith({ sourceNumber: 9 }, { repost: true }) }),
		'keep',
	);
	assert.equal(draftFate({ draft, frame: live, pick: pickWith({}, { frameId: 'b' }) }), 'commit');
	assert.equal(draftFate({ draft, frame: live, pick: pickWith({ sharedNumber: true }) }), 'drop');
});

test('an over-cap style attribute shows the hint instead of the style fields', () => {
	const view = inspectorView(pickWith({ style: null }));
	assert.equal(view.kind === 'editable' ? view.style : '', 'too-long');
	const normal = inspectorView(pickWith({ style: '' }));
	assert.equal(normal.kind === 'editable' ? normal.style : '', 'editable');
});
