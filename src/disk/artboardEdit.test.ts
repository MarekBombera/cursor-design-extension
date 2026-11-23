import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { type ArtboardEdit, type EditResult, editArtboardHtml } from './artboardEdit';
import { parseArtboardDocument } from './commentTarget';
import type { StyleChange, StyleField } from './editValues';
import { MAX_EDIT_TEXT_CHARS } from './layout';

const edited = (html: string, edit: ArtboardEdit): EditResult =>
	editArtboardHtml({ html, document: parseArtboardDocument(html), edit });

const text = (html: string, sourceNumber: number, value: string, liveText: string): EditResult =>
	edited(html, { sourceNumber, field: 'text', value, liveText });

const style = (html: string, sourceNumber: number, field: StyleField, value: string): EditResult =>
	edited(html, { sourceNumber, styles: [{ field, value }] });

const styles = (html: string, changes: StyleChange[]): EditResult =>
	edited(html, { sourceNumber: 0, styles: changes });

const ok = (html: string): EditResult => ({ ok: true, html });

const refused = (refusal: string): EditResult => ({ ok: false, refusal }) as EditResult;

test('a text edit replaces only the trimmed middle of the one text node', () => {
	assert.deepEqual(text('<div><p>Old</p></div>', 1, 'New', 'Old'), ok('<div><p>New</p></div>'));
	assert.deepEqual(text('<p>\n  Old\n</p>', 0, 'New', '\n  Old\n'), ok('<p>\n  New\n</p>'));
	// Other references in the node come back as characters.
	assert.deepEqual(text('<p>&copy; Old</p>', 0, '© New', '© Old'), ok('<p>© New</p>'));
});

test('a text edit encodes & < > and no-break space, and turns newlines into spaces', () => {
	assert.deepEqual(
		text('<p>a</p>', 0, ` a & <b> c${String.fromCodePoint(0xa0)}d\r\ne\nf `, 'a'),
		ok('<p>a &amp; &lt;b&gt; c&nbsp;d e f</p>'),
	);
});

test('an empty element gets its text before the end tag, or after a start tag with none', () => {
	assert.deepEqual(text('<p></p>', 0, 'Hi', ''), ok('<p>Hi</p>'));
	assert.deepEqual(text('<pre>\n</pre>', 0, 'Hi', ''), ok('<pre>\nHi</pre>'));
	assert.deepEqual(text('<ul><li><li>b</ul>', 1, 'Hi', ''), ok('<ul><li>Hi<li>b</ul>'));
	assert.deepEqual(text('<p></p>', 0, '  ', ''), ok('<p></p>'));
	// Clearing an element's text is a plain edit, not a refusal.
	assert.deepEqual(text('<p>Hi</p>', 0, '', 'Hi'), ok('<p></p>'));
});

test('CRLF files and a pre leading newline are edited byte-exactly', () => {
	assert.deepEqual(
		text('<div>\r\n<p>\r\n Old\r\n</p>\r\n</div>', 1, 'New', '\n Old\n'),
		ok('<div>\r\n<p>\r\n New\r\n</p>\r\n</div>'),
	);
	assert.deepEqual(text('<pre>\nx</pre>', 0, 'y', 'x'), ok('<pre>\ny</pre>'));
	// The newline HTML drops after <pre> sits inside the text location when whitespace follows.
	assert.deepEqual(text('<pre>\n  Old\n</pre>', 0, 'New', '  Old\n'), ok('<pre>\n  New\n</pre>'));
	assert.deepEqual(text('<pre>\r\n  Old</pre>', 0, 'New', '  Old'), ok('<pre>\r\n  New</pre>'));
	assert.deepEqual(
		text('<listing>\n\nOld</listing>', 0, 'New', '\nOld'),
		ok('<listing>\n\nNew</listing>'),
	);
});

test('an unknown or shared number is refused before any field rule', () => {
	for (const sourceNumber of [-1, 1.5, 1, Number.NaN]) {
		assert.deepEqual(text('<p>a</p>', sourceNumber, 'b', 'a'), refused('unknown-number'));
	}
	assert.deepEqual(text('<p><b>x</p><p>y</p>', 1, 'z', 'x'), refused('shared-number'));
	assert.deepEqual(style('<p><b>x</p><p>y</p>', 1, 'color', '#000000'), refused('shared-number'));
});

test('a malformed edit shape is refused without throwing', () => {
	const html = '<p>a</p>';
	const document = parseArtboardDocument(html);
	for (const edit of [
		{ sourceNumber: 0, field: 'text', value: 'b' },
		{ sourceNumber: 0, field: 'color', value: '#000000' },
		{ sourceNumber: 0, styles: [{ field: 'border', value: '1px' }] },
		{ sourceNumber: 0, styles: [{ field: 'color', value: 1 }] },
		{ sourceNumber: 0, styles: [null] },
		// A hole at 0: `every` skips holes.
		{ sourceNumber: 0, styles: Object.assign([], { 1: { field: 'color', value: '#000000' } }) },
		{ sourceNumber: 0, styles: [['color', '#000000']] },
		{ sourceNumber: 0, styles: { field: 'color', value: '#000000' } },
	]) {
		assert.deepEqual(
			editArtboardHtml({ html, document, edit: edit as unknown as ArtboardEdit }),
			refused('invalid-value'),
		);
	}
});

test('text is refused on an element that holds more than one text node', () => {
	assert.deepEqual(text('<p>a<b>b</b></p>', 0, 'c', 'ab'), refused('not-plain-text'));
	assert.deepEqual(text('<p>a<!-- c --></p>', 0, 'c', 'a'), refused('not-plain-text'));
	assert.deepEqual(text('<noscript>a</noscript>', 0, 'c', 'a'), refused('not-plain-text'));
});

test('text is refused when the live text, the value or their size is not safe', () => {
	assert.deepEqual(text('<p>Old</p>', 0, 'New', 'Other'), refused('text-changed'));
	assert.deepEqual(
		text('<p>Old</p>', 0, 'New', 'x'.repeat(MAX_EDIT_TEXT_CHARS + 1)),
		refused('invalid-value'),
	);
	assert.deepEqual(text('<p>Old</p>', 0, 'a\u0000b', 'Old'), refused('invalid-value'));
	assert.deepEqual(text('<p>Old</p>', 0, 'a\u007fb', 'Old'), refused('invalid-value'));
	assert.deepEqual(text('<p>Old</p>', 0, 'New', 'a\ud800'), refused('invalid-value'));
	assert.deepEqual(text('<p>Old</p>', 0, 'a\ud800b', 'Old'), refused('invalid-value'));
	assert.deepEqual(
		text('<p>Old</p>', 0, 'x'.repeat(MAX_EDIT_TEXT_CHARS + 1), 'Old'),
		refused('invalid-value'),
	);
	assert.deepEqual(text('<p>Old</p>', 0, 'a\tb', 'Old'), ok('<p>a\tb</p>'));
});

test('the re-parse check refuses text that would change the structure or land outside', () => {
	// head: the implied body takes over and the explicit <body> loses its number.
	assert.deepEqual(
		text('<html><head></head><body class=a><p>x</p>', 1, 'Hi', ''),
		refused('not-plain-text'),
	);
	assert.deepEqual(text('<table></table>', 0, 'Hi', ''), refused('not-plain-text'));
	assert.deepEqual(text('<p>a<br>b</p>', 1, 'Hi', ''), refused('not-plain-text'));
	assert.deepEqual(text('<param>', 0, 'Hi', ''), refused('not-plain-text'));
	assert.deepEqual(text('<svg><circle/></svg>', 1, 'Hi', ''), refused('not-plain-text'));
	// Text after </body> belongs to body but sits outside its tags: refused, never spliced there.
	assert.deepEqual(text('<body></body>Old', 0, 'New', 'Old'), refused('not-plain-text'));
});

test('a tag parse5 renames is edited, not mistaken for another document', () => {
	assert.deepEqual(
		style('<p>a</p><image>', 1, 'color', '#000000'),
		ok('<p>a</p><image style="color: #000000">'),
	);
	assert.deepEqual(
		style('<IMAGE src=x>', 0, 'margin', '1'),
		ok('<IMAGE style="margin: 1px" src=x>'),
	);
});

test('a document parsed from other HTML throws', () => {
	assert.throws(() =>
		editArtboardHtml({
			html: '<div>x</div>',
			document: parseArtboardDocument('<p>x</p>'),
			edit: { sourceNumber: 0, field: 'text', value: 'y', liveText: 'x' },
		}),
	);
});

test('a style edit adds, sets or removes one declaration in any attribute form', () => {
	assert.deepEqual(style('<p>a</p>', 0, 'font-size', '12'), ok('<p style="font-size: 12px">a</p>'));
	assert.deepEqual(
		style('<p style="">a</p>', 0, 'color', '#ff0000'),
		ok('<p style="color: #ff0000">a</p>'),
	);
	assert.deepEqual(
		style('<p style="color: red">a</p>', 0, 'padding', '8 16'),
		ok('<p style="color: red; padding: 8px 16px">a</p>'),
	);
	assert.deepEqual(
		style('<p style = "color: red">a</p>', 0, 'margin', '0'),
		ok('<p style = "color: red; margin: 0px">a</p>'),
	);
	assert.deepEqual(
		style("<p style='color: red'>a</p>", 0, 'color', '#ABCDEF'),
		ok("<p style='color: #ABCDEF'>a</p>"),
	);
	assert.deepEqual(
		style('<p STYLE="color: red">a</p>', 0, 'color', '#00ff00'),
		ok('<p STYLE="color: #00ff00">a</p>'),
	);
	assert.deepEqual(
		style('<p style=color:red>a</p>', 0, 'margin', '0'),
		ok('<p style="color:red; margin: 0px">a</p>'),
	);
	assert.deepEqual(style('<p style=>a</p>', 0, 'margin', '4'), ok('<p style="margin: 4px">a</p>'));
	assert.deepEqual(style('<p style>a</p>', 0, 'margin', '4'), ok('<p style="margin: 4px">a</p>'));
});

test('a multi-field edit applies every change in one splice', () => {
	const changes: StyleChange[] = [
		{ field: 'font-weight', value: '700' },
		{ field: 'gap', value: '8' },
	];
	assert.deepEqual(
		styles('<p class="x" style="color: #000000">a</p>', changes),
		ok('<p class="x" style="color: #000000; font-weight: 700; gap: 8px">a</p>'),
	);
	assert.deepEqual(
		styles('<p class="x">a</p>', changes),
		ok('<p style="font-weight: 700; gap: 8px" class="x">a</p>'),
	);
	assert.deepEqual(
		styles('<p>a</p>', [
			{ field: 'gap', value: '' },
			{ field: 'opacity', value: ' ' },
		]),
		ok('<p>a</p>'),
	);
	assert.deepEqual(
		styles('<p style="color: #000000">a</p>', [
			{ field: 'gap', value: '8' },
			{ field: 'opacity', value: '2' },
		]),
		refused('invalid-value'),
	);
});

test('a clear removes the declaration, with its longhands for padding and margin', () => {
	assert.deepEqual(
		style('<p style="color: red; margin: 0">a</p>', 0, 'color', ''),
		ok('<p style="margin: 0">a</p>'),
	);
	assert.deepEqual(
		style('<p style="padding: 1px; padding-left: 2px; color: red">a</p>', 0, 'padding', '  '),
		ok('<p style="color: red">a</p>'),
	);
	assert.deepEqual(style('<p>a</p>', 0, 'color', ''), ok('<p>a</p>'));
	assert.deepEqual(
		style('<p style=color:red>a</p>', 0, 'margin', ''),
		ok('<p style=color:red>a</p>'),
	);
});

test('bare numbers outside parentheses get px; anything else is kept as typed', () => {
	assert.deepEqual(
		style('<p>a</p>', 0, 'margin', 'calc(8px + 2px)'),
		ok('<p style="margin: calc(8px + 2px)">a</p>'),
	);
	assert.deepEqual(
		style('<p>a</p>', 0, 'margin', 'calc(8 + 2px)  1.5rem'),
		ok('<p style="margin: calc(8 + 2px) 1.5rem">a</p>'),
	);
	assert.deepEqual(style('<p>a</p>', 0, 'font-size', 'abc'), ok('<p style="font-size: abc">a</p>'));
});

test('unsafe style values are refused', () => {
	for (const value of ['red', '#12345', '#ff00001', 'rgb(0,0,0)']) {
		assert.deepEqual(style('<p>a</p>', 0, 'color', value), refused('invalid-value'), value);
	}
	const overCapAfterPx = '1 '.repeat(60).trim();
	for (const value of [
		'1px;x',
		'1px"',
		"1px'",
		'(1px',
		'1px)',
		')1px(',
		'1px/*x*/',
		'1px*/',
		'1px:2',
		overCapAfterPx,
	]) {
		assert.deepEqual(style('<p>a</p>', 0, 'font-size', value), refused('invalid-value'), value);
	}
});

test('a style attribute the core cannot edit safely is refused', () => {
	assert.deepEqual(
		style('<p style=a"b>x</p>', 0, 'color', '#000000'),
		refused('unsupported-style'),
	);
	// Valid declarations, but rewriting them inside new double quotes would break the markup.
	assert.deepEqual(
		style('<p style=font-family:"x">a</p>', 0, 'color', '#000000'),
		refused('unsupported-style'),
	);
	assert.deepEqual(
		style('<p style="content: \'abc">x</p>', 0, 'font-size', '12'),
		refused('unsupported-style'),
	);
	// The second <body>'s style merges into the first, which has no style location.
	assert.deepEqual(
		style('<body><p>x</p><body style="color:red">', 0, 'color', '#000000'),
		refused('unsupported-style'),
	);
});
