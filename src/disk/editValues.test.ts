import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	applyStyleChanges,
	isRefusedEditText,
	normalizeEditText,
	normalizeStyleValue,
	previewText,
	type StyleChange,
} from './editValues';
import { EDIT_STYLE_FIELDS, MAX_EDIT_TEXT_CHARS, MAX_STYLE_VALUE_CHARS } from './layout';

test('normalizeStyleValue adds px to bare numbers outside parentheses only', () => {
	assert.equal(normalizeStyleValue('padding', '8 16'), '8px 16px');
	assert.equal(normalizeStyleValue('padding', '  8\n\t1.5rem '), '8px 1.5rem');
	assert.equal(normalizeStyleValue('font-size', 'calc(1 + 2)'), 'calc(1 + 2)');
	assert.equal(normalizeStyleValue('font-size', '-.5'), '-.5px');
	assert.equal(normalizeStyleValue('margin', 'var(--gap)'), 'var(--gap)');
});

test('normalizeStyleValue refuses unsafe or unbalanced values and clears on empty', () => {
	assert.equal(normalizeStyleValue('padding', ''), '');
	assert.equal(normalizeStyleValue('padding', ' \n '), '');
	assert.equal(normalizeStyleValue('padding', 'calc(1 + 2'), undefined);
	assert.equal(normalizeStyleValue('padding', '1)('), undefined);
	assert.equal(normalizeStyleValue('padding', '1px /* x */'), undefined);
	assert.equal(normalizeStyleValue('padding', '1px; color: red'), undefined);
	assert.equal(normalizeStyleValue('padding', '1px !important'), undefined);
	assert.equal(normalizeStyleValue('padding', 'a'.repeat(MAX_STYLE_VALUE_CHARS + 1)), undefined);
});

test('a colour field takes a 3, 4, 6 or 8 digit hex as typed or transparent, nothing else', () => {
	for (const field of ['color', 'background-color', 'border-color'] as const) {
		assert.equal(normalizeStyleValue(field, '#AbCdEf'), '#AbCdEf');
		assert.equal(normalizeStyleValue(field, '#fff'), '#fff');
		assert.equal(normalizeStyleValue(field, '#ffff'), '#ffff');
		assert.equal(normalizeStyleValue(field, '#11223344'), '#11223344');
		assert.equal(normalizeStyleValue(field, ' TRANSPARENT '), 'transparent');
		assert.equal(normalizeStyleValue(field, '#12345'), undefined);
		assert.equal(normalizeStyleValue(field, 'red'), undefined);
		assert.equal(normalizeStyleValue(field, 'rgb(1, 2, 3)'), undefined);
	}
});

test('line-height keeps an unsigned number unitless and never gives a bare number px', () => {
	assert.equal(normalizeStyleValue('line-height', '1.6'), '1.6');
	assert.equal(normalizeStyleValue('line-height', '.5'), '.5');
	assert.equal(normalizeStyleValue('line-height', '1.'), undefined);
	assert.equal(normalizeStyleValue('line-height', '-1.5'), undefined);
	assert.equal(normalizeStyleValue('line-height', '+2'), undefined);
	assert.equal(normalizeStyleValue('line-height', '24px'), '24px');
	assert.equal(normalizeStyleValue('line-height', '1.5em'), '1.5em');
	assert.equal(normalizeStyleValue('line-height', 'normal'), 'normal');
});

test('the length fields share the length rule', () => {
	for (const field of ['letter-spacing', 'gap', 'border-radius', 'border-width'] as const) {
		assert.equal(normalizeStyleValue(field, '24'), '24px');
		assert.equal(normalizeStyleValue(field, 'url(//host/x'), undefined);
	}
	// Fits collapsed, passes the cap once px is added.
	const nearCap = `${'1 '.repeat(MAX_STYLE_VALUE_CHARS / 2 - 1)}1`;
	assert.equal(nearCap.length, MAX_STYLE_VALUE_CHARS - 1);
	assert.equal(normalizeStyleValue('gap', nearCap), undefined);
});

test('opacity takes an unsigned number from 0 to 1 as typed', () => {
	assert.equal(normalizeStyleValue('opacity', '0'), '0');
	assert.equal(normalizeStyleValue('opacity', '.5'), '.5');
	assert.equal(normalizeStyleValue('opacity', '1'), '1');
	assert.equal(normalizeStyleValue('opacity', '1.5'), undefined);
	assert.equal(normalizeStyleValue('opacity', '-0.1'), undefined);
	assert.equal(normalizeStyleValue('opacity', '1.'), undefined);
	assert.equal(normalizeStyleValue('opacity', '50%'), undefined);
});

test('a keyword field takes only its list, lowercased', () => {
	assert.equal(normalizeStyleValue('font-style', 'ITALIC'), 'italic');
	assert.equal(normalizeStyleValue('font-weight', '700'), '700');
	assert.equal(normalizeStyleValue('font-weight', '450'), undefined);
	assert.equal(normalizeStyleValue('font-weight', 'bold'), undefined);
	assert.equal(
		normalizeStyleValue('text-decoration-line', ' underline \n line-through'),
		'underline line-through',
	);
	assert.equal(normalizeStyleValue('text-decoration-line', 'line-through underline'), undefined);
	assert.equal(normalizeStyleValue('text-align', 'Center'), 'center');
	assert.equal(normalizeStyleValue('text-align', 'start'), undefined);
	assert.equal(normalizeStyleValue('text-transform', 'UPPERCASE'), 'uppercase');
	assert.equal(normalizeStyleValue('overflow', 'Hidden'), 'hidden');
	assert.equal(normalizeStyleValue('border-style', 'dashed'), 'dashed');
	assert.equal(normalizeStyleValue('border-style', 'groove'), undefined);
});

test('an empty value clears every field', () => {
	for (const field of EDIT_STYLE_FIELDS) {
		assert.equal(normalizeStyleValue(field, ' \t '), '', field);
	}
});

test('applyStyleChanges sets and clears in list order', () => {
	assert.deepEqual(
		applyStyleChanges({
			styleText: 'color: #000000; margin: 0',
			changes: [
				{ field: 'font-weight', value: '700' },
				{ field: 'margin', value: '' },
				{ field: 'opacity', value: '.5' },
			],
		}),
		{ ok: true, styleText: 'color: #000000; font-weight: 700; opacity: .5' },
	);
	assert.deepEqual(applyStyleChanges({ styleText: '', changes: [{ field: 'gap', value: '8' }] }), {
		ok: true,
		styleText: 'gap: 8px',
	});
});

test('applyStyleChanges refuses the whole list before changing anything', () => {
	const refused = (changes: readonly StyleChange[], styleText = 'color: #000000') =>
		applyStyleChanges({ styleText, changes });
	const invalid = { ok: false, refusal: 'invalid-value' };
	assert.deepEqual(
		refused([
			{ field: 'margin', value: '0' },
			{ field: 'opacity', value: '2' },
		]),
		invalid,
	);
	assert.deepEqual(
		refused([
			{ field: 'margin', value: '0' },
			{ field: 'margin', value: '1' },
		]),
		invalid,
	);
	assert.deepEqual(refused([]), invalid);
	assert.deepEqual(
		refused(Array.from({ length: 20 }, () => ({ field: 'gap', value: '1' }) as const)),
		invalid,
	);
	assert.deepEqual(refused([{ field: 'gap', value: '1' }], 'content: "open'), {
		ok: false,
		refusal: 'unsupported-style',
	});
});

test('clearing all three border fields also removes the border shorthands', () => {
	const styleText = 'border: 1px solid #ddd; color: #000000; border-bottom: 2px dashed #000';
	const clear = (fields: readonly StyleChange['field'][]) =>
		applyStyleChanges({ styleText, changes: fields.map((field) => ({ field, value: '' })) });
	assert.deepEqual(clear(['border-width', 'border-style', 'border-color']), {
		ok: true,
		styleText: 'color: #000000;',
	});
	assert.deepEqual(clear(['border-width', 'border-style']), { ok: true, styleText });
});

test('isRefusedEditText allows tab and refuses other controls, lone surrogates and the cap', () => {
	assert.equal(isRefusedEditText('a\tb'), false);
	assert.equal(isRefusedEditText('a\u0001b'), true);
	assert.equal(isRefusedEditText('a\u007fb'), true);
	assert.equal(isRefusedEditText('\ud800'), true);
	assert.equal(isRefusedEditText('😀'), false);
	assert.equal(isRefusedEditText('a'.repeat(MAX_EDIT_TEXT_CHARS)), false);
	assert.equal(isRefusedEditText('a'.repeat(MAX_EDIT_TEXT_CHARS + 1)), true);
});

test('normalizeEditText turns newlines into spaces and trims ASCII edges', () => {
	assert.equal(normalizeEditText('  a\r\nb\rc\n '), 'a b c');
	assert.equal(normalizeEditText(' a '), ' a ');
});

test('previewText keeps the live edges and replaces the trimmed middle', () => {
	assert.equal(previewText({ liveText: '  Hi\n', value: 'a\nb' }), '  a b\n');
	assert.equal(previewText({ liveText: '', value: ' New ' }), 'New');
	assert.equal(previewText({ liveText: '   ', value: 'x' }), '   x');
	assert.equal(previewText({ liveText: 'Old', value: '' }), '');
});
