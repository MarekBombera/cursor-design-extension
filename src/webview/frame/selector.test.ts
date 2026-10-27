// @vitest-environment happy-dom
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, vi } from 'vite-plus/test';

import { FRAME_PICK_MESSAGE, parseFrameMessage } from './frameMessages';
import {
	buildSelector,
	describeElement,
	isGeneratedName,
	readStyles,
	textExcerpt,
} from './selector';

// While set, every finder call throws it (a real overflow, or any other finder failure).
let finderThrows: Error | undefined;

vi.mock('@medv/finder', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@medv/finder')>();
	return {
		...actual,
		finder: (...args: Parameters<typeof actual.finder>): string => {
			if (finderThrows !== undefined) {
				throw finderThrows;
			}
			return actual.finder(...args);
		},
	};
});

const fixtureHtml = readFileSync(join(process.cwd(), 'fixtures/picking.html'), 'utf8');

// DOMParser does not run the fixture's scripts.
const parseFixture = (): Document => new DOMParser().parseFromString(fixtureHtml, 'text/html');

const at = (doc: Document, query: string, index = 0): Element => {
	const element = doc.querySelectorAll(query)[index];
	assert.ok(element, query);
	return element;
};

// The selector matches exactly this element in its document.
const roundTrip = (element: Element, timeoutMs?: number): string => {
	const selector = buildSelector(element, timeoutMs);
	assert.ok(selector !== null);
	assert.deepEqual([...element.ownerDocument.querySelectorAll(selector)], [element], selector);
	return selector;
};

test('nested sections, a scroll-box item and an svg round-trip', () => {
	const doc = parseFixture();
	roundTrip(at(doc, 'section.inner'));
	roundTrip(at(doc, 'section.inner p'));
	roundTrip(at(doc, '.scroll-box li', 6));
	roundTrip(at(doc, 'svg.icon-paths'));
});

test('card #3 of five identical cards matches only itself, template content included', () => {
	const doc = parseFixture();
	const template = at(doc, 'template');
	assert.ok(template instanceof HTMLTemplateElement);
	assert.ok(template.content.querySelector('.card'));
	const cards = [...doc.querySelectorAll('.card')];
	assert.equal(cards.length, 5);
	const selector = roundTrip(at(doc, '.card', 2));
	for (const [index, card] of cards.entries()) {
		assert.equal(card.matches(selector), index === 2, `card ${index + 1}`);
	}
});

test('duplicate and escaped ids round-trip', () => {
	const doc = parseFixture();
	for (const duplicate of doc.querySelectorAll('[id="dup"]')) {
		assert.notEqual(roundTrip(duplicate), '#dup');
	}
	for (const id of ['1st', 'a:b', 'price.total']) {
		const element = doc.getElementById(id);
		assert.ok(element, id);
		roundTrip(element);
	}
});

test('generated class and id names stay out of the selector; word-like ones are used', () => {
	const doc = parseFixture();
	for (const element of [
		at(doc, '[class="css-1x2y3z svelte-abcdef"]'),
		at(doc, '[id="row-123456"]'),
	]) {
		const selector = roundTrip(element);
		for (const name of ['css-1x2y3z', 'svelte-abcdef', 'row-123456']) {
			assert.ok(!selector.includes(name), selector);
		}
	}
	assert.ok(roundTrip(at(doc, '.card-title')).includes('card-title'));
});

test('a shadow host round-trips', () => {
	const doc = parseFixture();
	const host = at(doc, 'cd-shadow-host');
	const inside = doc.createElement('p');
	inside.textContent = 'shadow';
	host.attachShadow({ mode: 'open' }).append(inside);
	roundTrip(host);
});

test('a removed element has no selector', () => {
	const doc = parseFixture();
	const card = at(doc, '.card', 2);
	card.remove();
	assert.equal(buildSelector(card), null);
});

test('the timeout fallback still round-trips; a fallback over the cap is null', () => {
	roundTrip(at(parseFixture(), '.card', 2), -1);
	const doc = new DOMParser().parseFromString('<!doctype html><body></body>', 'text/html');
	let deepest: Element = doc.body;
	for (let depth = 0; depth < 70; depth += 1) {
		deepest = deepest.appendChild(doc.createElement('div'));
	}
	assert.equal(buildSelector(deepest, -1), null);
});

test('a finder stack overflow falls back to an nth-of-type path; other finder throws give null', () => {
	// In a real browser, class-heavy markup makes finder expand more candidate paths than the
	// stack holds (RangeError, F-40 / F-55), even with a negative timeout. happy-dom is too slow
	// to get there, so finder is made to throw here.
	const doc = parseFixture();
	const card = at(doc, '.card', 2);
	try {
		finderThrows = new RangeError('Maximum call stack size exceeded');
		const selector = roundTrip(card);
		assert.ok(selector.startsWith('html > body:nth-of-type(1) > '), selector);
		assert.ok(selector.endsWith('article:nth-of-type(3)'), selector);
		roundTrip(at(doc, 'svg.icon-paths'));
		finderThrows = new Error('Selector was not found.');
		assert.equal(buildSelector(card), null);
	} finally {
		finderThrows = undefined;
	}
});

test('a selector from the script-mutated live DOM can miss in the static HTML', () => {
	const live = parseFixture();
	const list = at(live, '#mutated-list');
	const inserted = live.createElement('li');
	inserted.textContent = 'Inserted by script';
	list.insertBefore(inserted, list.children[1] ?? null);
	const itemB = at(live, '#mutated-list li', 2);
	assert.equal(itemB.textContent, 'Item B');
	const selector = roundTrip(itemB);
	const matches = parseFixture().querySelectorAll(selector);
	assert.ok(matches.length !== 1 || matches[0]?.textContent !== 'Item B', selector);
});

test('isGeneratedName matches framework scoping prefixes only', () => {
	for (const name of [
		'css-1x2y3z',
		'SVELTE-abc123',
		'sc-bdVaJa',
		'jsx-123',
		'emotion-x',
		'astro-ABCDEF',
	]) {
		assert.equal(isGeneratedName(name), true, name);
	}
	for (const name of ['card-title', 'cssx', 'hero']) {
		assert.equal(isGeneratedName(name), false, name);
	}
});

test('textExcerpt collapses, trims, drops control characters and cuts at 200', () => {
	assert.equal(textExcerpt('  a\n\tb    c\u0001d\u0085e\u2028f  '), 'a b c d e f');
	assert.equal(textExcerpt('x'.repeat(250)), 'x'.repeat(200));
	// U+1F600 is a surrogate pair at indexes 199 and 200; the cut keeps no half of it.
	assert.equal(textExcerpt(`${'x'.repeat(199)}\u{1F600}`), 'x'.repeat(199));
});

test('readStyles keeps safe allowlisted values in allowlist order', () => {
	const values: Record<string, string> = {
		gap: '4px',
		color: 'rgb(0, 0, 0)',
		'font-family': '"Inter",   sans-serif',
		'z-index': '3',
	};
	assert.deepEqual(Object.entries(readStyles((property) => values[property] ?? '')), [
		['font-family', '"Inter", sans-serif'],
		['color', 'rgb(0, 0, 0)'],
		['gap', '4px'],
	]);
	for (const unsafe of [
		'',
		'a'.repeat(201),
		'red; background: url(x)',
		'a{b}',
		'<x>',
		'red\nblue',
		'red\n',
	]) {
		assert.deepEqual(
			readStyles(() => unsafe),
			{},
			JSON.stringify(unsafe),
		);
	}
});

test('describeElement: page pick, text sources, styles and a disconnected element', () => {
	const doc = parseFixture();
	const page = describeElement(doc.documentElement, true);
	assert.equal(page.selector, 'body');
	assert.equal(page.tagName, 'body');
	assert.equal(page.text, '');
	assert.equal(page.styles['font-family'], 'system-ui, sans-serif');

	const inner = at(doc, 'section.inner p');
	Object.defineProperty(inner, 'innerText', { value: 'from\ninnerText' });
	assert.equal(describeElement(inner, false).text, 'from innerText');
	// SVG has no innerText; its text comes from textContent.
	const svgElement = at(doc, 'svg.icon-tiny');
	svgElement.append(doc.createElementNS('http://www.w3.org/2000/svg', 'title'));
	svgElement.lastElementChild?.append('  tiny\n icon ');
	const svg = describeElement(svgElement, false);
	assert.equal(svg.tagName, 'svg');
	assert.equal(svg.text, 'tiny icon');

	const card = describeElement(at(doc, '.card', 2), false);
	assert.equal(card.tagName, 'article');
	assert.equal(card.text, 'Card Same content.');
	assert.equal(card.styles['border-radius'], '6px');
	assert.equal(card.styles.padding, '12px');

	const detached = doc.createElement('div');
	detached.textContent = 'gone';
	assert.deepEqual(describeElement(detached, false), {
		selector: null,
		tagName: 'div',
		text: '',
		styles: {},
	});
});

test('a described pick passes the cd:pick guard (the runtime never fails its own guard)', () => {
	const doc = parseFixture();
	for (const [element, isPage] of [
		[at(doc, '.card', 2), false],
		[doc.documentElement, true],
	] as const) {
		const message = {
			type: FRAME_PICK_MESSAGE,
			...describeElement(element, isPage),
			rect: null,
			point: { x: 0, y: 0 },
			box: { width: 0, height: 0 },
			isPage,
			repost: false,
		};
		assert.deepEqual(parseFrameMessage(message), message);
	}
});
