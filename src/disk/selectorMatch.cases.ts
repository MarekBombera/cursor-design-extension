// One table, two engines: selectorMatch.test.ts runs every case through selectMatches (Verify), and
// tests/browser/selectorMatch.spec.ts runs every non-null case through Chromium's querySelectorAll
// (the authority for the matching rules). `data-t` marks elements; `expected` lists the matched
// markers in document order ('?' for an unmarked element). null = outside the finder grammar.

export type SelectorCase = {
	name: string;
	html: string;
	selector: string;
	expected: string[] | null;
};

const BASIC = `<!doctype html><html data-t="html"><head data-t="head"><title>t</title></head><body data-t="body">
<div data-t="d1" id="main" class="card hero"><span data-t="s1">a</span><p data-t="p1">b</p><span data-t="s2" class="x">c</span><p data-t="p2">d</p></div>
<section data-t="sec"><div data-t="d2"><div data-t="d3"><em data-t="em">e</em></div></div></section>
</body></html>`;

const ESCAPES = `<p data-t="digits" id="123" class="a:b café">x</p><p data-t="quote" data-x='a"b' data-y="back\\slash">y</p><p data-t="pair" class="a b">z</p><p data-t="fffd" id="�">w</p>`;

const FOREIGN = `<svg data-t="svg" viewBox="0 0 1 1"><circle data-t="circle" r="1"></circle><foreignObject data-t="fo"><div data-t="fodiv" rel="NoOpener">f</div></foreignObject><a data-t="svga" xlink:href="#x" href="#y" rel="NoOpener" class="Q">l</a></svg><math data-t="math"><mi data-t="mi">x</mi></math><p data-t="hp" rel="NoOpener">h</p><svg><a data-t="onlyx" xlink:href="#z">z</a></svg>`;

const TEMPLATE = `<template data-t="tpl"><p data-t="in" class="t">t</p></template><p data-t="live" class="t">l</p>`;

const CLASS_SPACES = `<p data-t="nbsp" class="a\u00A0b">1</p><p data-t="vt" class="c\u000Bd">2</p><p data-t="tab" class="e\tf">3</p>`;

// Foster parenting puts the table's <mglyph> beside the MathML one, as an HTML element: one parent,
// two same-tag children from two namespaces (parse5 and Chromium agree).
const MGLYPH = `<math><mi><mglyph data-t="m1"></mglyph><table><mglyph data-t="h1"></mglyph></table></mi></math>`;

const ODD_TAGS = `<constructor data-t="ctor" __proto__="x">c</constructor><k data-t="k">k</k>`;

const TABLE = `<table data-t="table"><tr data-t="tr"><td data-t="td">c</td></tr></table>`;

const DUPLICATE_IDS = `<p data-t="first" id="dup">1</p><p data-t="second" id="dup">2</p>`;

// The nearest section above the target sits under div.b, the outer one under div.a: a greedy
// nearest-ancestor matcher answers 'div.a > section p' wrongly.
const NESTED = `<div data-t="outer" class="a"><section data-t="s1"><div data-t="mid" class="b"><section data-t="s2"><p data-t="target">x</p></section></div></section></div>`;

const ONE_DIV = `<div data-t="only">x</div>`;

const at = (html: string) => (name: string, selector: string, expected: string[] | null) => ({
	name,
	html,
	selector,
	expected,
});

const basic = at(BASIC);
const escapes = at(ESCAPES);
const foreign = at(FOREIGN);
const template = at(TEMPLATE);
const oddTags = at(ODD_TAGS);

export const SELECTOR_CASES: readonly SelectorCase[] = [
	basic('tag', 'p', ['p1', 'p2']),
	basic('child', 'div > p', ['p1', 'p2']),
	basic('descendant', 'div p', ['p1', 'p2']),
	basic('descendant without a match', 'section p', []),
	basic('descendant through levels', 'section em', ['em']),
	basic('child is not descendant', 'section > em', []),
	basic('child chain', 'section > div > div > em', ['em']),
	basic('descendant needs a strict ancestor', 'div div', ['d3']),
	basic('id and class', '#main > span.x', ['s2']),
	basic('two classes', '.card.hero', ['d1']),
	basic('missing class', '.card.nope', []),
	basic('class is case-sensitive', '.Card', []),
	basic('tag is case-insensitive', 'DIV > P', ['p1', 'p2']),
	basic('nth-child first', 'span:nth-child(1)', ['s1']),
	basic('nth-child counts mixed siblings', 'span:nth-child(3)', ['s2']),
	basic('nth-of-type', 'span:nth-of-type(2)', ['s2']),
	basic('nth-of-type first', 'p:nth-of-type(1)', ['p1']),
	basic('nth-child of a later type', 'p:nth-child(2)', ['p1']),
	basic('nth-child zero', 'p:nth-child(0)', []),
	basic('nth-child leading zero', 'p:nth-child(02)', ['p1']),
	basic('nth-child past the end', 'p:nth-child(99)', []),
	basic('two ids never match one element', '#main#other', []),
	basic('the same id twice', '#main#main', ['d1']),
	basic('an id after a pseudo-class', ':nth-child(1)#main', ['d1']),
	basic('a pseudo-class twice around an id', ':nth-of-type(1)#main:nth-of-type(1)', ['d1']),
	basic('html', 'html', ['html']),
	basic('html is the first child of the document', 'html:nth-child(1)', ['html']),
	basic('body after head', 'body:nth-child(2)', ['body']),
	basic('html > body', 'html > body', ['body']),
	basic(
		'nth-of-type fallback path',
		'html > body:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2)',
		['p2'],
	),
	escapes('hex escape with its space', '#\\31 23', ['digits']),
	escapes('escaped colon', '.a\\:b', ['digits']),
	escapes('non-ASCII class', '.café', ['digits']),
	escapes('hex escape space at the end', '.caf\\e9 ', ['digits']),
	escapes('six hex digits need no space', '.\\000061\\3A b', ['digits']),
	escapes('hex escape as a tag', '\\70 ', ['digits', 'quote', 'pair', 'fffd']),
	escapes('escaped quote in a value', '[data-x="a\\"b"]', ['quote']),
	escapes('escaped backslash in a value', '[data-y="back\\\\slash"]', ['quote']),
	escapes('class pair', '.a.b', ['pair']),
	escapes('zero escape is U+FFFD', '#\\0', ['fffd']),
	escapes('surrogate escape is U+FFFD', '#\\d800', ['fffd']),
	escapes('out-of-range escape is U+FFFD', '#\\110000', ['fffd']),
	escapes('trailing space after an escape run is not a combinator', '#\\31 23 ', null),
	foreign('svg child', 'svg > circle', ['circle']),
	foreign('camelCase SVG tag', 'foreignObject', ['fo']),
	foreign('camelCase SVG tag, lowercase', 'foreignobject', ['fo']),
	foreign('camelCase SVG tag, uppercase', 'FOREIGNOBJECT', ['fo']),
	foreign('through foreignObject', 'svg > foreignobject > div', ['fodiv']),
	foreign('SVG attribute name, lowercase', '[viewbox="0 0 1 1"]', ['svg']),
	foreign('SVG attribute name, uppercase', '[VIEWBOX="0 0 1 1"]', ['svg']),
	foreign('attribute with no namespace', '[href="#y"]', ['svga']),
	foreign('namespaced attribute never matches', '[href="#x"]', []),
	foreign('rel value folds on HTML elements only', '[rel="noopener"]', ['fodiv', 'hp']),
	foreign('rel value exact', '[rel="NoOpener"]', ['fodiv', 'svga', 'hp']),
	foreign('a namespaced attribute alone never matches', '[href="#z"]', []),
	foreign('class on SVG is case-sensitive', 'a.Q', ['svga']),
	foreign('class on SVG, wrong case', 'a.q', []),
	foreign('MathML tag, uppercase', 'MI', ['mi']),
	foreign('MathML child', 'math > mi', ['mi']),
	template('template content is never searched', 'p.t', ['live']),
	template('template descendants', 'template p', []),
	template('template itself', 'template', ['tpl']),
	at(CLASS_SPACES)('NBSP does not split classes', '.a', []),
	at(CLASS_SPACES)('VT does not split classes', '.c', []),
	at(CLASS_SPACES)('tab splits classes', '.f', ['tab']),
	at(MGLYPH)('nth-of-type counts per namespace', 'mi > mglyph:nth-of-type(1)', ['m1', 'h1']),
	at(MGLYPH)('no second mglyph of one type', 'mi > mglyph:nth-of-type(2)', []),
	oddTags('constructor tag', 'constructor', ['ctor']),
	oddTags('__proto__ attribute', '[__proto__="x"]', ['ctor']),
	oddTags('Kelvin sign is not k', 'K', []),
	oddTags('uppercase K is k', 'K', ['k']),
	at(TABLE)('implied tbody', 'table > tbody > tr > td', ['td']),
	at(TABLE)('tr is not a child of table', 'table > tr', []),
	at(DUPLICATE_IDS)('duplicate ids', '#dup', ['first', 'second']),
	at(NESTED)('descendant after child needs the right section', 'div.a > section p', ['target']),
	at(NESTED)('child chain fails', 'div.a > section > p', []),
	at(ONE_DIV)('lone div is not div div', 'div div', []),
	at(ONE_DIV)('empty selector', '', null),
	at(ONE_DIV)('universal', '*', null),
	at(ONE_DIV)('child without spaces', 'div>div', null),
	at(ONE_DIV)('sibling combinator', 'div + div', null),
	at(ONE_DIV)('bare attribute', '[data-t]', null),
	at(ONE_DIV)('single-quoted value', "[data-t='only']", null),
	at(ONE_DIV)('other pseudo-class', 'div:first-child', null),
];
