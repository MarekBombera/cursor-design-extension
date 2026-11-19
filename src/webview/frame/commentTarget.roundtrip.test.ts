// @vitest-environment happy-dom
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { matchCommentTarget, parseArtboardDocument, targetAgrees } from '../../disk/commentTarget';
import { SOURCE_TAG_ATTRIBUTE } from '../../disk/layout';
import { sourceTaggedHtml } from '../../disk/sourceTags';
import { stampArtboardHtml } from '../stampArtboardHtml';
import { buildSelector, describeElement } from './selector';

const fixtureHtml = readFileSync(join(process.cwd(), 'fixtures/picking.html'), 'utf8');

// The frame gets the host's tagged copy; disk-side matching parses the untagged fixture.
const taggedHtml = sourceTaggedHtml({
	html: fixtureHtml,
	document: parseArtboardDocument(fixtureHtml),
});

const stampedDocument = (): Document =>
	new DOMParser().parseFromString(
		stampArtboardHtml({ html: taggedHtml, nonce: 'test-nonce', runtimeSource: 'void 0;' }),
		'text/html',
	);

const at = (doc: Document, query: string, index = 0): Element => {
	const element = doc.querySelectorAll(query)[index];
	assert.ok(element, query);
	return element;
};

const assertDiskAgrees = (element: Element): void => {
	const description = describeElement(element, false);
	assert.ok(description.selector !== null, 'selector');
	const match = matchCommentTarget({
		document: parseArtboardDocument(fixtureHtml),
		selector: description.selector,
	});
	assert.equal(match.checkable, true, description.selector);
	assert.equal(match.matches, 1, description.selector);
	assert.equal(targetAgrees({ match, tagName: description.tagName, text: description.text }), true);
	assert.equal(buildSelector(element), description.selector);
};

test('nested section, third card, scroll item and a selector trap agree on disk', () => {
	const doc = stampedDocument();
	assertDiskAgrees(at(doc, 'section.inner p'));
	assertDiskAgrees(at(doc, '.card', 2));
	assertDiskAgrees(at(doc, '.scroll-box li', 6));
	assertDiskAgrees(at(doc, '.card-title'));
});

test('picks in a tagged frame never put the source number in a selector', () => {
	const doc = stampedDocument();
	const picked = [
		at(doc, 'section.inner p'),
		at(doc, '.card', 2),
		at(doc, '.scroll-box li', 6),
		at(doc, '.card-title'),
		at(doc, 'html'),
		at(doc, 'head'),
		at(doc, 'body'),
	];
	for (const element of picked) {
		assert.ok(element.hasAttribute(SOURCE_TAG_ATTRIBUTE), element.localName);
		const selector = buildSelector(element);
		assert.ok(selector !== null, element.localName);
		assert.equal(selector.includes('data-cd'), false, selector);
	}
});
