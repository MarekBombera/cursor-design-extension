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

const SMALL_DOCUMENT = parseArtboardDocument('<div id="a" class="b"><p>x</p></div>');

test('selectors outside the finder grammar are never run', () => {
	for (const selector of [
		'div:has(p)',
		'div:not(p)',
		':is(div) p',
		':where(div) p',
		':matches(div) p',
		'p:nth-child(1 of .b)',
		'div + p',
		'div ~ p',
		'div>p',
		'div  p',
		'*',
		'[id]',
		'p::before',
	]) {
		assert.deepEqual(
			matchCommentTarget({ document: SMALL_DOCUMENT, selector }),
			{
				checkable: false,
			},
			selector,
		);
	}
});

test('every finder form is checkable', () => {
	for (const selector of [
		'p',
		'#a > p',
		'.b p',
		'div#a.b > p:nth-child(1)',
		'div:nth-of-type(1) > p:nth-of-type(1)',
		'[id="a"] > p',
		'#\\31 23 p',
	]) {
		assert.equal(
			matchCommentTarget({ document: SMALL_DOCUMENT, selector }).checkable,
			true,
			selector,
		);
	}
});

// Without the guard this selector backtracks for seconds on this page, then matches nothing
// (checkable: true, matches: 0); the guard must refuse it before css-select runs.
test('more than 2 descendant combinators are not checkable on a deep page', () => {
	const depth = 40;
	const html = `${'<div>'.repeat(depth)}leaf${'</div>'.repeat(depth)}`;
	const document = parseArtboardDocument(html);
	assert.equal(matchCommentTarget({ document, selector: 'p div div' }).checkable, true);
	assert.deepEqual(matchCommentTarget({ document, selector: 'p div div div' }), {
		checkable: false,
	});
	assert.deepEqual(matchCommentTarget({ document, selector: 'p div div div div div div div' }), {
		checkable: false,
	});
});

// The old IDENT split each hex escape 6 ways: 12 of these took 67 s, and 140 never finished.
test('a hostile run of escapes fails the grammar without backtracking', () => {
	const selector = `${'\\aaaaaa'.repeat(140)}!`;
	assert.deepEqual(matchCommentTarget({ document: SMALL_DOCUMENT, selector }), {
		checkable: false,
	});
});

// Allowed selectors still cost about depth^3 in css-select, times the number of deep stacks.
test('a page deeper than 64 elements is not checkable, even for an allowed selector', () => {
	const deep = parseArtboardDocument(`${'<div>'.repeat(100)}leaf${'</div>'.repeat(100)}`);
	assert.deepEqual(matchCommentTarget({ document: deep, selector: 'p div div' }), {
		checkable: false,
	});
	const shallow = parseArtboardDocument(`${'<div>'.repeat(60)}leaf${'</div>'.repeat(60)}`);
	assert.equal(matchCommentTarget({ document: shallow, selector: 'p div div' }).checkable, true);
});

// Forms buildSelector can emit that a tightened grammar must keep accepting.
test('escaped, non-ASCII, custom-element and fallback-path selectors stay checkable', () => {
	const document = parseArtboardDocument(
		'<my-card class="a:b café"><p data-x=\'a"b\'>x</p></my-card>',
	);
	for (const selector of [
		'my-card > p',
		'.a\\:b > p',
		'.café p',
		'[data-x="a\\"b"]',
		'html > body:nth-of-type(1) > my-card:nth-of-type(1) > p:nth-of-type(1)',
		'#\\#x',
		'.\\31 23',
	]) {
		assert.equal(matchCommentTarget({ document, selector }).checkable, true, selector);
	}
});

// :nth-child is quadratic in sibling count (li:nth-child(3): 2.2 s at 20k siblings).
test('a page wider than 5,000 siblings or larger than 20,000 elements is not checkable', () => {
	const list = (count: number): string => `<ul>${'<li>x</li>'.repeat(count)}</ul>`;
	assert.equal(
		matchCommentTarget({ document: parseArtboardDocument(list(4000)), selector: 'li:nth-child(3)' })
			.checkable,
		true,
	);
	assert.deepEqual(
		matchCommentTarget({
			document: parseArtboardDocument(list(6000)),
			selector: 'li:nth-child(3)',
		}),
		{ checkable: false },
	);
	const large = parseArtboardDocument(list(4000).repeat(6));
	assert.deepEqual(matchCommentTarget({ document: large, selector: 'ul:nth-child(1) > li' }), {
		checkable: false,
	});
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

test('a 60-step child chain stays checkable (linear in css-select)', () => {
	const depth = 60;
	const html = `${'<div>'.repeat(depth)}leaf${'</div>'.repeat(depth)}`;
	const selector = Array.from({ length: depth }, () => 'div').join(' > ');
	assert.equal(
		matchCommentTarget({ document: parseArtboardDocument(html), selector }).checkable,
		true,
	);
});

test('a selector css-select throws on is not checkable', () => {
	assert.deepEqual(
		matchCommentTarget({ document: parseArtboardDocument('<p>x</p>'), selector: '[' }),
		{ checkable: false },
	);
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
