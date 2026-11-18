import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import {
	HINT_CONTAINER,
	HINT_FRAME_MISSING,
	HINT_FRAME_UNREADABLE,
	HINT_NO_SINGLE_MATCH,
	HINT_UNCHECKED,
	commentFlags,
	matchCommentTarget,
	parseArtboardDocument,
	targetAgrees,
} from './commentTarget';

const fingerprintOf = (html: string, selector: string): string => {
	const match = matchCommentTarget({ document: parseArtboardDocument(html), selector });
	assert.equal(match.checkable, true);
	assert.equal(match.matches, 1);
	assert.ok(match.fingerprint);
	return match.fingerprint;
};

test('re-indenting between tags keeps the fingerprint', () => {
	const compact = '<main><p>Hi</p></main>';
	const indented = '<main>\n  <p>Hi</p>\n</main>';
	assert.equal(fingerprintOf(compact, 'p'), fingerprintOf(indented, 'p'));
});

test('re-indenting a text leaf keeps the fingerprint', () => {
	assert.equal(fingerprintOf('<p>Hi</p>', 'p'), fingerprintOf('<p>\n  Hi\n</p>', 'p'));
});

test('rewriting single-quoted attributes as double-quoted keeps the fingerprint', () => {
	assert.equal(
		fingerprintOf("<p class='hero'>Hi</p>", 'p'),
		fingerprintOf('<p class="hero">Hi</p>', 'p'),
	);
});

test('editing text inside the target changes the fingerprint', () => {
	assert.notEqual(fingerprintOf('<p>Hi</p>', 'p'), fingerprintOf('<p>Hey</p>', 'p'));
});

test('editing an attribute inside the target changes the fingerprint', () => {
	assert.notEqual(
		fingerprintOf('<p class="a">Hi</p>', 'p'),
		fingerprintOf('<p class="b">Hi</p>', 'p'),
	);
});

test('reordering attributes changes the fingerprint', () => {
	assert.notEqual(
		fingerprintOf('<p class="a" id="x">Hi</p>', 'p'),
		fingerprintOf('<p id="x" class="a">Hi</p>', 'p'),
	);
});

test('editing a sibling leaves the target fresh', () => {
	const before = '<section><p>Keep</p><p>Other</p></section>';
	const after = '<section><p>Keep</p><p>Changed</p></section>';
	const selector = 'p:nth-of-type(1)';
	const target = {
		isPage: false,
		selector,
		targetFingerprint: fingerprintOf(before, selector),
	};
	assert.deepEqual(commentFlags({ target, document: parseArtboardDocument(after) }), {
		stale: false,
		targetMissing: false,
	});
});

test('editing inside a container target is stale and carries HINT_CONTAINER', () => {
	const before = '<section><p>Keep</p></section>';
	const after = '<section><p>Changed</p></section>';
	const target = {
		isPage: false,
		selector: 'section',
		targetFingerprint: fingerprintOf(before, 'section'),
	};
	assert.deepEqual(commentFlags({ target, document: parseArtboardDocument(after) }), {
		stale: true,
		targetMissing: false,
		hint: HINT_CONTAINER,
	});
});

test('a card inserted before the target makes the :nth-child hit stale', () => {
	const before = '<div><article>One</article><article>Two</article></div>';
	const after = '<div><article>New</article><article>One</article><article>Two</article></div>';
	const selector = 'article:nth-child(2)';
	const target = {
		isPage: false,
		selector,
		targetFingerprint: fingerprintOf(before, selector),
	};
	const flags = commentFlags({ target, document: parseArtboardDocument(after) });
	assert.equal(flags.stale, true);
	assert.equal(flags.targetMissing, false);
});

test('0 matches is targetMissing', () => {
	const html = '<p>Hi</p>';
	const target = { isPage: false, selector: 'h1', targetFingerprint: fingerprintOf(html, 'p') };
	assert.deepEqual(commentFlags({ target, document: parseArtboardDocument(html) }), {
		stale: null,
		targetMissing: true,
		hint: HINT_NO_SINGLE_MATCH,
	});
});

test('2+ matches is targetMissing', () => {
	const html = '<div><p>A</p><p>B</p></div>';
	const target = {
		isPage: false,
		selector: 'p',
		targetFingerprint: fingerprintOf('<p>A</p>', 'p'),
	};
	assert.deepEqual(commentFlags({ target, document: parseArtboardDocument(html) }), {
		stale: null,
		targetMissing: true,
		hint: HINT_NO_SINGLE_MATCH,
	});
});

// The old matcher's caps refused these pages (64 deep, 20,000 elements, 5,000 siblings) and any
// selector with more than 2 descendant steps; the linear matcher answers them.
test('deep, wide and large pages and longer descendant chains are checkable', () => {
	const deep = parseArtboardDocument(`${'<div>'.repeat(100)}leaf${'</div>'.repeat(100)}`);
	assert.deepEqual(matchCommentTarget({ document: deep, selector: 'p div div div' }), {
		checkable: true,
		matches: 0,
	});
	assert.deepEqual(matchCommentTarget({ document: deep, selector: 'div div div div div' }), {
		checkable: true,
		matches: 96,
	});
	const list = (count: number): string => `<ul>${'<li>x</li>'.repeat(count)}</ul>`;
	const wide = matchCommentTarget({
		document: parseArtboardDocument(list(6000)),
		selector: 'li:nth-child(3)',
	});
	assert.equal(wide.checkable && wide.matches, 1);
	const large = matchCommentTarget({
		document: parseArtboardDocument(list(4000).repeat(6)),
		selector: 'ul:nth-child(1) > li:nth-child(2)',
	});
	assert.equal(large.checkable && large.matches, 1);
	const chained = matchCommentTarget({
		document: parseArtboardDocument(`${'<div>'.repeat(60)}leaf${'</div>'.repeat(60)}`),
		selector: Array.from({ length: 60 }, () => 'div').join(' > '),
	});
	assert.equal(chained.checkable && chained.matches, 1);
});

test('a selector outside the grammar or past MAX_MATCH_WORK reads unchecked', () => {
	const html = `${'<div>'.repeat(50_000)}leaf${'</div>'.repeat(50_000)}`;
	const selector = `${'div '.repeat(249)}div`;
	const target = { isPage: false, selector, targetFingerprint: 'sha256:x' };
	assert.deepEqual(commentFlags({ target, document: parseArtboardDocument(html) }), {
		stale: null,
		targetMissing: null,
		hint: HINT_UNCHECKED,
	});
	assert.deepEqual(
		matchCommentTarget({ document: parseArtboardDocument('<p>x</p>'), selector: '[' }),
		{ checkable: false },
	);
});

// The old tree format keyed attributes by local name, so an element with both xlink:href and
// href serialized only one of them and an edit to the other never changed the fingerprint.
// Spreading 130,000 children into one push() overflowed the call stack (RangeError).
test('a target with a very wide subtree is read without throwing', () => {
	const html = `<div id="w"><ul>${'<li>x</li>'.repeat(200_000)}</ul></div>`;
	const match = matchCommentTarget({ document: parseArtboardDocument(html), selector: '#w' });
	assert.equal(match.checkable && match.matches, 1);
	assert.equal(match.checkable && match.text?.length, 200_000);
});

test('editing a namespaced SVG attribute inside the target changes the fingerprint', () => {
	assert.notEqual(
		fingerprintOf('<svg><a xlink:href="#x" href="#y">l</a></svg>', 'svg'),
		fingerprintOf('<svg><a xlink:href="#z" href="#y">l</a></svg>', 'svg'),
	);
});

test('match results are cached per document and selector, never shared across documents', () => {
	const first = parseArtboardDocument('<p>one</p>');
	const second = parseArtboardDocument('<p>two</p>');
	const firstMatch = matchCommentTarget({ document: first, selector: 'p' });
	const secondMatch = matchCommentTarget({ document: second, selector: 'p' });
	assert.equal(firstMatch.checkable && firstMatch.text, 'one');
	assert.equal(secondMatch.checkable && secondMatch.text, 'two');
	assert.equal(matchCommentTarget({ document: first, selector: 'p' }), firstMatch);
	assert.notEqual(matchCommentTarget({ document: first, selector: 'body > p' }), firstMatch);
});

test('page comment with a missing frame is targetMissing and not stale', () => {
	assert.deepEqual(
		commentFlags({ target: { isPage: true, selector: 'body' }, document: 'missing' }),
		{ stale: false, targetMissing: true, hint: HINT_FRAME_MISSING },
	);
});

test('page comment with a present frame is never stale', () => {
	assert.deepEqual(
		commentFlags({
			target: { isPage: true, selector: 'body' },
			document: parseArtboardDocument('<p>changed</p>'),
		}),
		{ stale: false, targetMissing: false },
	);
});

test('element comment with a missing frame is targetMissing', () => {
	assert.deepEqual(
		commentFlags({
			target: { isPage: false, selector: 'p', targetFingerprint: 'sha256:'.padEnd(71, '0') },
			document: 'missing',
		}),
		{ stale: null, targetMissing: true, hint: HINT_FRAME_MISSING },
	);
});

test('unreadable frame is unchecked', () => {
	assert.deepEqual(
		commentFlags({
			target: { isPage: false, selector: 'p', targetFingerprint: 'sha256:'.padEnd(71, '0') },
			document: 'unreadable',
		}),
		{ stale: null, targetMissing: null, hint: HINT_FRAME_UNREADABLE },
	);
});

test('page comment on an unreadable frame is unchecked, not fresh', () => {
	assert.deepEqual(
		commentFlags({ target: { isPage: true, selector: 'body' }, document: 'unreadable' }),
		{ stale: null, targetMissing: null, hint: HINT_FRAME_UNREADABLE },
	);
});

test('no fingerprint is unchecked', () => {
	assert.deepEqual(
		commentFlags({
			target: { isPage: false, selector: 'p' },
			document: parseArtboardDocument('<p>Hi</p>'),
		}),
		{ stale: null, targetMissing: null, hint: HINT_UNCHECKED },
	);
});

test('an uncheckable selector is unchecked', () => {
	assert.deepEqual(
		commentFlags({
			target: {
				isPage: false,
				selector: 'div:has(p)',
				targetFingerprint: fingerprintOf('<div><p>x</p></div>', 'p'),
			},
			document: parseArtboardDocument('<div><p>x</p></div>'),
		}),
		{ stale: null, targetMissing: null, hint: HINT_UNCHECKED },
	);
});

test('targetAgrees is false on a tag mismatch', () => {
	const match = matchCommentTarget({
		document: parseArtboardDocument('<h1>Hi</h1>'),
		selector: 'h1',
	});
	assert.equal(targetAgrees({ match, tagName: 'p', text: 'Hi' }), false);
});

test('targetAgrees is false on a text mismatch', () => {
	const match = matchCommentTarget({
		document: parseArtboardDocument('<h1>Hi</h1>'),
		selector: 'h1',
	});
	assert.equal(targetAgrees({ match, tagName: 'h1', text: 'Bye' }), false);
});

test('targetAgrees is true for empty pick text with a matching tag', () => {
	const match = matchCommentTarget({
		document: parseArtboardDocument('<h1>Hi</h1>'),
		selector: 'h1',
	});
	assert.equal(targetAgrees({ match, tagName: 'h1', text: '' }), true);
});

test('targetAgrees ignores case and whitespace in text', () => {
	const match = matchCommentTarget({
		document: parseArtboardDocument('<h1>hello world</h1>'),
		selector: 'h1',
	});
	assert.equal(targetAgrees({ match, tagName: 'h1', text: 'HELLO  WORLD' }), true);
});

test('targetAgrees is false when the match is not checkable', () => {
	assert.equal(targetAgrees({ match: { checkable: false }, tagName: 'div', text: '' }), false);
});

test('a tbody selector matches source written without tbody', () => {
	const match = matchCommentTarget({
		document: parseArtboardDocument('<table><tr><td>x</td></tr></table>'),
		selector: 'table > tbody > tr',
	});
	assert.equal(match.checkable, true);
	assert.equal(match.matches, 1);
	assert.equal(match.tagName, 'tr');
});
