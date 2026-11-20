import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { type DefaultTreeAdapterMap, parse } from 'parse5';
import { test } from 'vite-plus/test';

import { SELECTOR_CASES } from './selectorMatch.cases';
import { MAX_MATCH_WORK, selectMatches } from './selectorMatch';

type TreeDocument = DefaultTreeAdapterMap['document'];

const markers = (document: TreeDocument, selector: string): string[] | null =>
	selectMatches(document, selector)?.map(
		(element) => element.attrs.find((attribute) => attribute.name === 'data-t')?.value ?? '?',
	) ?? null;

test('every case in the shared table (Chromium proves the same table)', () => {
	for (const { name, html, selector, expected } of SELECTOR_CASES) {
		assert.deepEqual(markers(parse(html), selector), expected, `${name}: ${selector}`);
	}
});

// Alone the scale cases take about 0.3 s at most; the parallel suite makes them up to 4x slower. A return
// to backtracking takes seconds to minutes, so this bound still catches it without flaking.
const LINEAR_BOUND_MS = 5000;

const timed = <T>(run: () => T): { result: T; ms: number } => {
	const started = performance.now();
	const result = run();
	return { result, ms: performance.now() - started };
};

const SMALL = parse('<div id="a" class="b"><p>x</p></div>');

test('selectors outside the finder grammar are null', () => {
	for (const selector of [
		'',
		' p',
		'p ',
		'div:has(p)',
		'div:not(p)',
		':is(div) p',
		':where(div) p',
		':matches(div) p',
		'p:nth-child(1 of .b)',
		'p:nth-child()',
		'p:nth-child(-1)',
		'div + p',
		'div ~ p',
		'div>p',
		'div  p',
		'div >p',
		'div > > p',
		'*',
		'[id]',
		"[id='a']",
		'[id=a]',
		'[id="a"',
		'[id="a]',
		'p::before',
		'#',
		'.',
		'#a\\',
		'#a\\\n',
		'#a\\\r',
		'#a\\\f',
		'[id="a\nb"]',
		'#\\31\t23',
		':nth-child(1)p',
		'[id="a"]p',
		'.b'.repeat(501),
		'[id="\\31\tx"]',
		'#a\0',
		'#a\uD800',
		'.\\\uDC00',
	]) {
		assert.equal(selectMatches(SMALL, selector), null, JSON.stringify(selector));
	}
});

test('every finder form parses', () => {
	const document = parse('<my-card class="a:b café"><p data-x=\'a"b\'>x</p></my-card>');
	for (const selector of [
		'p',
		'#a > p',
		'.b p',
		'div#a.b > p:nth-child(1)',
		'div:nth-of-type(1) > p:nth-of-type(1)',
		'[id="a"] > p',
		'#\\31 23 p',
		'my-card > p',
		'.a\\:b > p',
		'.café p',
		'[data-x="a\\"b"]',
		'html > body:nth-of-type(1) > my-card:nth-of-type(1) > p:nth-of-type(1)',
		'#\\#x',
		'.\\31 23',
		'.b'.repeat(500),
	]) {
		assert.notEqual(selectMatches(document, selector), null, selector);
		assert.notEqual(selectMatches(SMALL, selector), null, selector);
	}
});

// Every escape must have one reading. The first regex split `\aaaaaa` 6 ways (67 s for 12); the
// next read `\31 ` inside a value as escape + space or escape, then space (2^n). Each run here is
// unterminated, so the token fails and any second reading would be retried.
test('hostile runs of escapes are rejected in linear time', () => {
	// Short runs first: if a second reading returns, these fail in seconds instead of hanging.
	for (const count of [10, 28, 120]) {
		const runs = ['\\aaaaaa', '\\31 ', '\\1 ', '\\000031 '].map((unit) => unit.repeat(count));
		for (const run of runs) {
			for (const selector of [
				`${run}!`,
				`.${run}!`,
				`[${run}!`,
				`[${run}="x"!`,
				`[a="${run}`,
				`[a="${run}!`,
				`p ${run} >`,
			]) {
				const { result, ms } = timed(() => selectMatches(SMALL, selector));
				assert.equal(result, null, selector.slice(0, 12));
				assert.ok(ms < 1000, `${count}× ${selector.slice(0, 12)}… took ${ms} ms`);
			}
		}
	}
});

test('past MAX_SELECTOR_CHARS a selector is null before any work', () => {
	const { result, ms } = timed(() => selectMatches(SMALL, `.${'a'.repeat(8_400_000)}`));
	assert.equal(result, null);
	assert.ok(ms < 1000, `took ${ms} ms`);
});

test('escapes decode as CSS does', () => {
	const document = parse(
		'<p id="A1">1</p><p id="A">2</p><p id="a b">3</p><p id="�">4</p><p id="&#x1F600;">5</p><p id="1 2">6</p>',
	);
	const ids = (selector: string): string[] | null =>
		selectMatches(document, selector)?.map(
			(element) => element.attrs.find((attribute) => attribute.name === 'id')?.value ?? '?',
		) ?? null;
	assert.deepEqual(ids('#\\0000411'), ['A1'], 'the 7th hex digit is a literal');
	assert.deepEqual(ids('#\\41 1'), ['A1'], 'one space ends the escape');
	assert.deepEqual(
		ids('[id="\\31  2"]'),
		['1 2'],
		'the escape takes one space, the next is literal',
	);
	assert.deepEqual(ids('#\\41'), ['A']);
	assert.deepEqual(ids('#\\000041'), ['A']);
	assert.deepEqual(ids('#a\\ b'), ['a b'], 'escaped space');
	assert.deepEqual(ids('#\\0'), ['�']);
	assert.deepEqual(ids('#\\d800'), ['�']);
	assert.deepEqual(ids('#\\dfff'), ['�']);
	assert.deepEqual(ids('#\\110000'), ['�']);
	assert.deepEqual(ids('#\\1F600'), ['\u{1F600}'], 'astral code point');
	assert.deepEqual(ids('#\\\u{1F600}'), ['\u{1F600}'], 'escaped astral character');
	assert.deepEqual(ids('#\u{1F600}'), ['\u{1F600}'], 'raw astral character');
});

test('a document with a doctype, comments and text around the elements', () => {
	const document = parse(
		'<!doctype html><!--a--><html><!--b--><head></head>\ntext<body><!--c-->x<p>y</p>z</body></html><!--d-->',
	);
	assert.equal(selectMatches(document, 'html > body > p')?.length, 1);
	assert.equal(selectMatches(document, 'p:nth-child(1)')?.length, 1);
	assert.equal(selectMatches(document, 'html:nth-child(1)')?.length, 1);
	assert.equal(selectMatches(document, 'body:nth-child(2)')?.length, 1);
});

const deepDivs = (depth: number): TreeDocument =>
	parse(`${'<div>'.repeat(depth)}leaf${'</div>'.repeat(depth)}`);

const LONG_SELECTOR = `${'div '.repeat(249)}div`;

test('scale: deep, wide and long inputs stay linear', () => {
	assert.equal(LONG_SELECTOR.length, 999);
	const deep = deepDivs(10_000);
	const wide = parse(`<ul>${'<li>x</li>'.repeat(50_000)}</ul>`);
	const fiveThousand = deepDivs(5000);
	const nearCeiling = deepDivs(39_000);
	for (const [document, selector, count] of [
		[deep, 'p div div div', 0],
		[deep, 'div div div', 9998],
		[wide, 'li:nth-child(3)', 1],
		[wide, 'li:nth-of-type(49999)', 1],
		[fiveThousand, LONG_SELECTOR, 4751],
		[nearCeiling, LONG_SELECTOR, 38_751],
	] as const) {
		const { result, ms } = timed(() => selectMatches(document, selector));
		assert.equal(result?.length, count, `${selector.slice(0, 20)}…`);
		assert.ok(ms < LINEAR_BOUND_MS, `${selector.slice(0, 20)}… took ${ms} ms`);
	}
});

test('scale: past MAX_MATCH_WORK the match gives up as null', () => {
	const document = deepDivs(100_000);
	assert.ok(100_000 * 250 > MAX_MATCH_WORK);
	const { result, ms } = timed(() => selectMatches(document, LONG_SELECTOR));
	assert.equal(result, null);
	assert.ok(ms < LINEAR_BOUND_MS, `took ${ms} ms`);
	assert.equal(selectMatches(document, 'div div div')?.length, 99_998);
});

// A case-insensitive value is folded only at equal length; folding 200 KB values per check took
// 7 s here (35 s at 1 MB).
test('a long attribute value never costs a fold per check', () => {
	const values = `<i type="${'B'.repeat(200_000)}"></i>`.repeat(10);
	const document = parse(`${'<b type="a">'.repeat(90)}${values}`);
	const selector = Array.from({ length: 90 }, () => '[type="a"]').join(' ');
	const { result, ms } = timed(() => selectMatches(document, selector));
	assert.equal(result?.length, 1);
	assert.ok(ms < 1000, `took ${ms} ms`);
});

// The attribute-count part of the charge (element.attrs.length) needs more than 10M attributes
// (50 MB+) to change a result, so no test pins it; the cost tests above pin the check count.
test('MAX_MATCH_WORK counts every check: long selectors and attribute-heavy pages stay bounded', () => {
	const attributes = Array.from({ length: 200 }, (_, index) => `b${index}=1`).join(' ');
	const heavy = parse(`<p ${attributes} id="a">x</p>`.repeat(4000));
	for (const [document, selector, count] of [
		[heavy, '#a'.repeat(499), 4000],
		[heavy, '[b199="1"]'.repeat(99), 4000],
		[parse('<i class="a">x</i>'.repeat(30_000)), '.a'.repeat(499), null],
		// Each check folds a 10-char value that matches only case-insensitively, so a fold is charged
		// by the value's length (7.6 s when it counted 1 unit).
		[parse('<i type=AAAAAAAAAa>x</i>'.repeat(181_808)), '[type="AAAAAAAAAA"]'.repeat(52), null],
	] as const) {
		const { result, ms } = timed(() => selectMatches(document, selector));
		assert.equal(result === null ? null : result.length, count, selector.slice(0, 12));
		assert.ok(ms < LINEAR_BOUND_MS, `${selector.slice(0, 12)}… took ${ms} ms`);
	}
});

const SELECTOR_PIECES = [
	'div',
	'p',
	'#a',
	'.b',
	'[data-x="',
	'"]',
	'\\31 ',
	'\\1 ',
	'\\000031 ',
	'\\',
	' ',
	' > ',
	':nth-child(1)',
	':nth-of-type(',
	')',
	'\t',
	'"',
	'x',
	'-',
	'\uD800',
];

test('never throws on selector-shaped input', () => {
	const document = parse('<div id="a" class="b c"><p data-x="1">x</p><svg><circle/></svg></div>');
	fc.assert(
		fc.property(fc.array(fc.constantFrom(...SELECTOR_PIECES), { maxLength: 120 }), (pieces) => {
			const result = selectMatches(document, pieces.join(''));
			return result === null || Array.isArray(result);
		}),
		{ numRuns: 3000 },
	);
});

test('never throws, for any string', () => {
	const document = parse('<div id="a" class="b c"><p data-x="1">x</p><svg><circle/></svg></div>');
	fc.assert(
		fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (selector) => {
			const result = selectMatches(document, selector);
			return result === null || Array.isArray(result);
		}),
		{ numRuns: 2000 },
	);
});
