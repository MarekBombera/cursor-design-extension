import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	isRefusedEditText,
	normalizeEditText,
	normalizeStyleValue,
	previewText,
} from './editValues';
import { MAX_EDIT_TEXT_CHARS, MAX_STYLE_VALUE_CHARS } from './layout';

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

test('normalizeStyleValue keeps a #rrggbb colour as typed and refuses any other colour', () => {
	assert.equal(normalizeStyleValue('color', '#AbCdEf'), '#AbCdEf');
	assert.equal(normalizeStyleValue('color', 'rgb(1, 2, 3)'), undefined);
	assert.equal(normalizeStyleValue('color', '#fff'), undefined);
	assert.equal(normalizeStyleValue('color', ''), '');
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
