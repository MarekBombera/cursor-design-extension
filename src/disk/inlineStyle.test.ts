import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { test } from 'vite-plus/test';

import {
	BORDER_PARENTS,
	clearedProperties,
	removeStyleProperty,
	setStyleProperty,
	splitStyleDeclarations,
} from './inlineStyle';

// Pinned values: the module keeps these private.
const PADDING_LONGHANDS = [
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'padding-block',
	'padding-block-start',
	'padding-block-end',
	'padding-inline',
	'padding-inline-start',
	'padding-inline-end',
];
const MARGIN_LONGHANDS = [
	'margin-top',
	'margin-right',
	'margin-bottom',
	'margin-left',
	'margin-block',
	'margin-block-start',
	'margin-block-end',
	'margin-inline',
	'margin-inline-start',
	'margin-inline-end',
];

const set = (styleText: string, property: string, value: string): string | undefined =>
	setStyleProperty({ styleText, property, value });

const properties = (styleText: string): (string | undefined)[] =>
	splitStyleDeclarations(styleText).segments.map((segment) => segment.property);

test('a set changes the last occurrence in place, keeping spacing and !important', () => {
	assert.equal(
		set('color : red  !IMPORTANT ;x:y', 'color', '#00ff00'),
		'color : #00ff00  !IMPORTANT ;x:y',
	);
	assert.equal(set('color: red; color: blue', 'color', '#000000'), 'color: red; color: #000000');
	assert.equal(set('COLOR: red', 'color', '#000000'), 'COLOR: #000000');
	assert.equal(set('color: ;', 'color', '#000000'), 'color: #000000;');
});

test('a set appends after the last declaration, keeping trailing whitespace at the end', () => {
	assert.equal(set('', 'font-size', '12px'), 'font-size: 12px');
	assert.equal(set('   ', 'font-size', '12px'), 'font-size: 12px   ');
	assert.equal(set('color: red', 'font-size', '12px'), 'color: red; font-size: 12px');
	assert.equal(set('color: red;', 'font-size', '12px'), 'color: red; font-size: 12px;');
	assert.equal(set('color: red; ', 'font-size', '12px'), 'color: red; font-size: 12px; ');
	assert.equal(set('color: red&semi;', 'font-size', '12px'), 'color: red&semi; font-size: 12px;');
});

test('an append never completes a reference left without its semicolon', () => {
	assert.equal(
		set('font-family: A&copy', 'font-size', '12px'),
		'font-family: A&copy ; font-size: 12px',
	);
	assert.equal(set('content: x&#38', 'font-size', '12px'), 'content: x&#38 ; font-size: 12px');
	// A complete reference is just text: it still needs our separator.
	assert.equal(set('content: x&#38;', 'font-size', '12px'), 'content: x&#38;; font-size: 12px');
});

test('a later font shorthand moves the new font-size to the end', () => {
	assert.equal(
		set('font-size: 10px; font: 16px serif; color: red', 'font-size', '12px'),
		'font: 16px serif; color: red; font-size: 12px',
	);
	assert.equal(
		set('font: 16px serif; font-size: 10px', 'font-size', '12px'),
		'font: 16px serif; font-size: 12px',
	);
});

test('a later parent shorthand moves an in-place set to the end', () => {
	assert.equal(
		set('text-decoration-line: none; text-decoration: underline', 'text-decoration-line', 'none'),
		'text-decoration: underline; text-decoration-line: none',
	);
	assert.equal(
		set('border-color: #000; border: 1px solid #ddd', 'border-color', '#fff'),
		'border: 1px solid #ddd; border-color: #fff',
	);
	assert.equal(
		set('border-color: #000; border-inline-end: 1px solid', 'border-color', '#fff'),
		'border-inline-end: 1px solid; border-color: #fff',
	);
	assert.equal(
		set('background-color: #000; background: url(a.png)', 'background-color', '#fff'),
		'background: url(a.png); background-color: #fff',
	);
	// A parent before the field, or another field's parent, changes nothing.
	assert.equal(
		set('background: none; background-color: #000; font: 12px serif', 'background-color', '#fff'),
		'background: none; background-color: #fff; font: 12px serif',
	);
});

test('a shorthand field drops only its own longhands', () => {
	assert.equal(set('row-gap: 1px; display: grid', 'gap', '8px'), 'display: grid; gap: 8px');
	assert.equal(
		set('border-top-width: 1px; border-top-style: solid', 'border-width', '2px'),
		'border-top-style: solid; border-width: 2px',
	);
	assert.equal(
		set('border-top-left-radius: 1px; border-radius: 2px', 'border-radius', '4px'),
		'border-radius: 4px',
	);
	assert.equal(set('overflow-x: auto', 'overflow', 'hidden'), 'overflow: hidden');
	assert.equal(BORDER_PARENTS.length, 11);
});

test('clearedProperties is the field plus only its own longhands', () => {
	assert.deepEqual(clearedProperties('font-size'), ['font-size']);
	assert.deepEqual(clearedProperties('padding'), ['padding', ...PADDING_LONGHANDS]);
	assert.deepEqual(clearedProperties('margin'), ['margin', ...MARGIN_LONGHANDS]);
	const width = clearedProperties('border-width');
	assert.ok(width.includes('border-top-width'));
	// A border field never clears a parent or another aspect: Reset on Border does that (9h).
	assert.ok(!width.includes('border') && !width.includes('border-top-style'));
});

test('padding drops its ten longhands and nothing else', () => {
	const styleText = [...PADDING_LONGHANDS, 'margin-left', 'padding-x', 'padding']
		.map((property) => `${property}: 1px`)
		.join('; ');
	assert.equal(set(styleText, 'padding', '8px'), 'margin-left: 1px; padding-x: 1px; padding: 8px');
	assert.equal(
		set('margin-top: 1px; padding-top: 2px', 'margin', '0px'),
		'padding-top: 2px; margin: 0px',
	);
});

test('a remove takes each matching segment with its own separator', () => {
	const styleText = 'color: red; font-size: 12px; margin: 0';
	assert.equal(removeStyleProperty(styleText, 'font-size'), 'color: red; margin: 0');
	assert.equal(removeStyleProperty(styleText, 'color'), 'font-size: 12px; margin: 0');
	assert.equal(removeStyleProperty('color: red; margin: 0', 'margin'), 'color: red;');
	assert.equal(removeStyleProperty('color: red; margin: 0;', 'margin'), 'color: red;');
	assert.equal(removeStyleProperty('margin: 0', 'margin'), '');
	assert.equal(removeStyleProperty('color: red; color: blue', 'color'), '');
	assert.equal(removeStyleProperty('color: red', 'margin'), 'color: red');
	assert.equal(
		removeStyleProperty('padding: 1px; padding-left: 2px; color: red', 'padding'),
		'color: red',
	);
});

test('a ; inside strings, brackets, comments or after an escape does not split', () => {
	for (const value of [
		'"a;b"',
		"'a;b'",
		'url(a;b)',
		'var(--x, a;b)',
		'[a;b]',
		'a /* ; */ b',
		'a\\;b',
	]) {
		assert.deepEqual(properties(`content: ${value}; color: red`), ['content', 'color'], value);
	}
	assert.equal(
		set('content: "a;b"; color: red', 'color', '#000000'),
		'content: "a;b"; color: #000000',
	);
});

test('character references are read as the characters CSS sees', () => {
	// &quot; quotes the ;, &semi; and &#59; separate, &colon; names the property.
	assert.deepEqual(properties('content: &quot;a;b&quot;; color: red'), ['content', 'color']);
	assert.deepEqual(properties('color: red&semi; margin&colon; 0&#59;'), [
		'color',
		'margin',
		undefined,
	]);
	assert.deepEqual(splitStyleDeclarations('a: 1&semi;b: 2').segments, [
		{ text: 'a: 1', separator: '&semi;', property: 'a', value: '1' },
		{ text: 'b: 2', separator: '', property: 'b', value: '2' },
	]);
	// An unknown named reference is ordinary text: its own ; never separates.
	assert.deepEqual(properties('content: a&copy;b; color: red'), ['content', 'color']);
});

test('a comment before the name is not part of it', () => {
	assert.equal(set('/* c */ color: red', 'color', '#000000'), '/* c */ color: #000000');
});

test('a segment value starts after the real colon, never one inside a comment', () => {
	const values = (styleText: string): Array<string | undefined> =>
		splitStyleDeclarations(styleText).segments.map((segment) => segment.value);
	assert.deepEqual(values('/* note: brand */ color: #ff0000'), ['#ff0000']);
	assert.deepEqual(values('color/*a:b*/: red'), ['red']);
	// Kept as typed after the colon's whitespace; a segment with no colon has no value.
	assert.deepEqual(values('margin:  0 auto !important ; junk'), ['0 auto !important ', undefined]);
});

test('endsOpen reports text ending inside a string, comment, escape or bracket', () => {
	for (const styleText of [
		'content: "abc',
		'color: red /* x',
		'background: url(a',
		'content: a\\',
	]) {
		assert.equal(splitStyleDeclarations(styleText).endsOpen, true, styleText);
		assert.equal(set(styleText, 'font-size', '12px'), undefined, styleText);
	}
	assert.equal(splitStyleDeclarations('content: "a"; b: (c)').endsOpen, false);
	// In-place replacement is still fine on open text.
	assert.equal(
		set('color: red; content: "abc', 'color', '#000000'),
		'color: #000000; content: "abc',
	);
});

test('segments and separators rebuild any style text exactly', () => {
	const piece = fc.constantFrom(
		'color',
		': ',
		';',
		' ',
		'"',
		"'",
		'(',
		')',
		'[',
		'}',
		'/*',
		'*/',
		'\\',
		'&semi;',
		'&quot;',
		'&#59;',
		'&amp',
		'red',
		'!important',
	);
	fc.assert(
		fc.property(fc.array(fc.oneof(piece, fc.string()), { maxLength: 30 }), (pieces) => {
			const styleText = pieces.join('');
			const { segments } = splitStyleDeclarations(styleText);
			assert.equal(
				segments.map(({ text, separator }) => `${text}${separator}`).join(''),
				styleText,
			);
		}),
	);
});
