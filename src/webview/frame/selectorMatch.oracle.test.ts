// @vitest-environment happy-dom
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { type DefaultTreeAdapterMap, defaultTreeAdapter, parse } from 'parse5';
import { test } from 'vite-plus/test';

import { selectMatches } from '../../disk/selectorMatch';

// Random cross-check of selectMatches against happy-dom's querySelectorAll, limited to the subset
// happy-dom gets right: plain HTML tags with no implied end tags, word idents, case-sensitive
// attributes. Escapes, foreign elements and case-insensitive values are covered against real
// Chromium by selectorMatch.cases.ts; digit-start idents are accepted on purpose (Chromium throws
// on them). A failing seed becomes a literal case there.

type TreeNode = {
	tag: string;
	id?: string;
	classes: string[];
	data?: string;
	children: TreeNode[];
};

const TAGS = ['div', 'span', 'section', 'article'];

// Explicit depth: up to 4 levels of up to 3 children each.
const nodeAt = (depth: number): fc.Arbitrary<TreeNode> =>
	fc.record(
		{
			tag: fc.constantFrom(...TAGS),
			id: fc.constantFrom('x', 'y'),
			classes: fc.subarray(['a', 'b', 'c']),
			data: fc.constantFrom('1', '2'),
			children: depth === 0 ? fc.constant([]) : fc.array(nodeAt(depth - 1), { maxLength: 3 }),
		},
		{ requiredKeys: ['tag', 'classes', 'children'] },
	);

const nodeArbitrary = nodeAt(3);

const toHtml = ({ tag, id, classes, data, children }: TreeNode): string => {
	const idAttribute = id === undefined ? '' : ` id="${id}"`;
	const classAttribute = classes.length === 0 ? '' : ` class="${classes.join(' ')}"`;
	const dataAttribute = data === undefined ? '' : ` data-k="${data}"`;
	return `<${tag}${idAttribute}${classAttribute}${dataAttribute}>${children.map(toHtml).join('')}</${tag}>`;
};

// Each selector is built from true facts about a random element and some of its ancestors, so
// most selectors match and both combinators run; now and then one fact is swapped for a random one
// for the negatives. Independent random constraints almost never matched (0.3% with a combinator).
// At most one fact of each kind, in tag-id-class-attribute-nth order: happy-dom miscounts two ids
// or an id after a pseudo-class (Chromium does not; those shapes are literal cases instead).
const KINDS = ['tag', 'id', 'class', 'data', 'nth'] as const;

type Kind = (typeof KINDS)[number];

const RANDOM_FACTS: Record<Kind, string[]> = {
	tag: ['span', 'section'],
	id: ['#x', '#y'],
	class: ['.a', '.c'],
	data: ['[data-k="1"]', '[data-k="2"]'],
	nth: [':nth-child(3)', ':nth-of-type(2)'],
};

const factsOf = (element: Element): Record<Kind, string[]> => {
	const siblings = Array.from(element.parentElement?.children ?? []);
	const sameType = siblings.filter((sibling) => sibling.localName === element.localName);
	const data = element.getAttribute('data-k');
	return {
		tag: [element.localName],
		id: element.id === '' ? [] : [`#${element.id}`],
		class: Array.from(element.classList, (name) => `.${name}`),
		data: data === null ? [] : [`[data-k="${data}"]`],
		nth: [
			`:nth-child(${siblings.indexOf(element) + 1})`,
			`:nth-of-type(${sameType.indexOf(element) + 1})`,
		],
	};
};

const selectorFrom = (body: Element, choices: readonly number[]): string => {
	let next = 0;
	const pick = (count: number): number => (choices[next++ % choices.length] ?? 0) % count;
	const elements = Array.from(body.querySelectorAll('*'));
	const chain: Element[] = [];
	for (
		let element: Element | null = elements[pick(elements.length)] ?? null;
		element !== null && element !== body;
		element = element.parentElement
	) {
		if (chain.length === 0 || pick(2) === 0) {
			chain.unshift(element);
		}
	}
	return chain
		.map((element, index) => {
			const facts = factsOf(element);
			const kinds = KINDS.filter((kind) => facts[kind].length > 0 && pick(3) === 0);
			const used = kinds.length === 0 ? ['tag' as const] : kinds;
			const swapped = pick(6) === 0 ? used[pick(used.length)] : undefined;
			const text = used
				.map((kind) => {
					const options = kind === swapped ? RANDOM_FACTS[kind] : facts[kind];
					return options[pick(options.length)] ?? '';
				})
				.join('');
			const previous = chain[index - 1];
			const child = previous !== undefined && element.parentElement === previous && pick(2) === 0;
			return index === 0 ? text : `${child ? ' > ' : ' '}${text}`;
		})
		.join('');
};

// Element-index path from the root element, the same shape for both trees.
const domPath = (element: Element): string => {
	const steps: number[] = [];
	for (
		let current: Element | null = element;
		current?.parentElement;
		current = current.parentElement
	) {
		steps.unshift(Array.prototype.indexOf.call(current.parentElement.children, current));
	}
	return steps.join('/');
};

const treePath = (element: DefaultTreeAdapterMap['element']): string => {
	const steps: number[] = [];
	let current = element;
	for (
		let parent = current.parentNode;
		parent !== null && defaultTreeAdapter.isElementNode(parent);
		parent = current.parentNode
	) {
		steps.unshift(
			parent.childNodes.filter((child) => defaultTreeAdapter.isElementNode(child)).indexOf(current),
		);
		current = parent;
	}
	return steps.join('/');
};

test('selectMatches agrees with happy-dom on random simple trees', () => {
	fc.assert(
		fc.property(
			fc.array(nodeArbitrary, { minLength: 1, maxLength: 3 }),
			fc.array(fc.nat(), { minLength: 16, maxLength: 16 }),
			(nodes, choices) => {
				const html = `<!doctype html><html><head></head><body>${nodes.map(toHtml).join('')}</body></html>`;
				const dom = new DOMParser().parseFromString(html, 'text/html');
				const selector = selectorFrom(dom.body, choices);
				const expected = Array.from(dom.querySelectorAll(selector), domPath);
				const actual = selectMatches(parse(html), selector)?.map(treePath);
				assert.deepEqual(actual, expected, `${selector} on ${html}`);
			},
		),
		{ numRuns: 500 },
	);
});
