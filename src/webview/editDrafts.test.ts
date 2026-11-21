import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { ChromePick } from './commentPick';
import { applyStyleChanges, type StyleChange } from '../disk/editValues';
import { MAX_EDIT_TEXT_CHARS, MAX_PICK_STYLE_CHARS } from '../disk/layout';
import {
	commitDraft,
	draftFate,
	draftPreview,
	type EditDraft,
	FIELD_ERROR_COPY,
	type FieldErrorKind,
	fieldValue,
	invalidDraftCopy,
	startDraft,
	stylesCommit,
	swatchValue,
	textMaxLength,
} from './editDrafts';
import { NOT_SAVED_COPY } from './editRequests';
import type { PickEditFields } from './frame/frameMessages';

const edit: PickEditFields = {
	sourceNumber: 4,
	sharedNumber: false,
	textState: 'plain',
	text: '\n    Title\n  ',
	style: 'font-size: 32px; color: #ff0000',
	computed: {},
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
			styles: [{ field: 'margin', value: ' 8 ' }],
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

test('an invalid draft ended by a pick names its own cause; a step returns the frame copy', () => {
	for (const kind of Object.keys(FIELD_ERROR_COPY) as FieldErrorKind[]) {
		assert.equal(invalidDraftCopy(kind, 'pick'), FIELD_ERROR_COPY[kind]);
	}
	assert.equal(invalidDraftCopy('invalid-length', 'step'), NOT_SAVED_COPY);
});

test('a refused value names its field: colour, opacity, leading, length', () => {
	const errorOf = (field: EditDraft['field'], value: string): unknown => {
		const verdict = commitDraft(draftOf(field, value));
		return verdict.kind === 'invalid' ? verdict.error : verdict.kind;
	};
	assert.equal(errorOf('color', 'red'), 'invalid-color');
	assert.equal(errorOf('background-color', 'url(x)'), 'invalid-color');
	assert.equal(errorOf('border-color', 'blue'), 'invalid-color');
	assert.equal(errorOf('opacity', '2'), 'invalid-opacity');
	assert.equal(errorOf('line-height', '-1'), 'invalid-leading');
	assert.equal(errorOf('gap', '1;'), 'invalid-length');
	assert.equal(errorOf('border-width', 'thick;'), 'invalid-length');
	assert.equal(
		FIELD_ERROR_COPY['invalid-color'],
		'Not saved: use a hex color such as #1a2b3c, transparent, or leave it empty.',
	);
	assert.equal(
		FIELD_ERROR_COPY['invalid-opacity'],
		'Not saved: use a number from 0 to 1, or leave it empty.',
	);
	assert.equal(
		FIELD_ERROR_COPY['invalid-leading'],
		'Not saved: use a number such as 1.5, a CSS length such as 24px, or leave it empty.',
	);
	assert.equal(FIELD_ERROR_COPY['invalid-choice'], 'Not saved: choose a value from the list.');
});

test('stylesCommit: none, unchanged, invalid, and one save whose preview is the core result', () => {
	const commit = (
		changes: StyleChange[],
		fields: Partial<PickEditFields> = {},
		pick?: ChromePick,
	) => stylesCommit({ pick: pick ?? pickWith(fields), documentVersion: 2, changes });
	const bold: StyleChange[] = [{ field: 'font-weight', value: '700' }];
	const key = { frameId: 'a', sourceNumber: 4, documentVersion: 2 };
	assert.deepEqual(stylesCommit({ pick: undefined, documentVersion: 2, changes: bold }), {
		kind: 'none',
	});
	assert.deepEqual(commit(bold, {}, pickWith(undefined)), { kind: 'none' });
	for (const fields of [{ sourceNumber: null }, { sharedNumber: true }, { style: null }]) {
		assert.deepEqual(commit(bold, fields), { kind: 'none' });
	}
	assert.deepEqual(commit(bold, { style: 'font-weight: 700' }), { kind: 'unchanged' });
	// Clearing what is not set changes nothing.
	assert.deepEqual(commit([{ field: 'opacity', value: '' }]), { kind: 'unchanged' });
	assert.deepEqual(commit([{ field: 'font-weight', value: 'heavy' }]), {
		kind: 'invalid',
		error: 'invalid-choice',
		key,
	});
	assert.deepEqual(commit(bold, { style: 'background: url(a' }), {
		kind: 'invalid',
		error: 'complex-style',
		key,
	});
	assert.deepEqual(commit(bold, { style: `--x: ${'a'.repeat(MAX_PICK_STYLE_CHARS - 6)}` }), {
		kind: 'invalid',
		error: 'complex-style',
		key,
	});
	const border: StyleChange[] = [
		{ field: 'border-width', value: '' },
		{ field: 'border-style', value: '' },
		{ field: 'border-color', value: '' },
	];
	const style = 'border: 1px solid #ddd; color: #ff0000';
	const applied = applyStyleChanges({ styleText: style, changes: border });
	assert.ok(applied.ok);
	assert.deepEqual(commit(border, { style }), {
		kind: 'save',
		preview: { type: 'cd:edit-apply', sourceNumber: 4, style: applied.styleText },
		commit: { key, styles: border },
	});
	assert.equal(applied.styleText, 'color: #ff0000');
});

test('swatchValue: a #rrggbb draft of the picked element, else the computed swatch', () => {
	const pick = pickWith({});
	assert.equal(
		swatchValue({ draft: draftOf('color', '#00FF00'), pick, swatch: '#ff0000' }),
		'#00ff00',
	);
	assert.equal(
		swatchValue({ draft: draftOf('color', '#abc'), pick, swatch: '#ff0000' }),
		'#ff0000',
	);
	assert.equal(
		swatchValue({
			draft: draftOf('color', '#00ff00'),
			pick: pickWith({ sourceNumber: 5 }),
			swatch: '#ff0000',
		}),
		'#ff0000',
	);
	assert.equal(swatchValue({ draft: undefined, pick, swatch: '#ff0000' }), '#ff0000');
});
