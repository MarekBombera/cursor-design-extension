import { type DefaultTreeAdapterMap, defaultTreeAdapter, html } from 'parse5';

import { MAX_SELECTOR_CHARS } from './layout';

// The grammar @medv/finder and the frame's nth-of-type fallback emit, with Chromium's no-quirks
// rules (the frame copy always is). selectorMatch.cases.ts holds the rules, proven in Chromium.

type TreeDocument = DefaultTreeAdapterMap['document'];
type TreeElement = DefaultTreeAdapterMap['element'];
type TreeParent = DefaultTreeAdapterMap['parentNode'];

type Compound = {
	tag?: string;
	ids: string[];
	classes: string[];
	// `folded`: the value ASCII-folded, set only for a name in CASE_INSENSITIVE_ATTRIBUTES.
	attributes: { name: string; value: string; folded?: string }[];
	nthChild: number[];
	nthOfType: number[];
};

// `child`: the combinator before this step is " > " (else " "; unused on the first step).
type Step = { compound: Compound; child: boolean };

// `checks`: what one element can cost: one per compound and per simple selector, plus each
// case-insensitive value's length (a fold reads the whole attribute value).
type Selector = { steps: Step[]; checks: number };

// ponytail: a match runs uninterrupted up to MAX_MATCH_WORK checks (about 0.3-0.7 s measured), then
// reads unchecked; N distinct selectors walk the document N times. Upgrade path: one walk for all
// of a document's selectors, or a worker thread.
export const MAX_MATCH_WORK = 10_000_000;

// HTML spec "case-sensitivity of selectors": values compared ASCII case-insensitively on HTML
// elements. https://html.spec.whatwg.org/multipage/semantics-other.html#case-sensitivity-of-selectors
const CASE_INSENSITIVE_ATTRIBUTES = new Set(
	`accept accept-charset align alink axis bgcolor charset checked clear codetype color compact
	declare defer dir direction disabled enctype face frame hreflang http-equiv lang language link
	media method multiple nohref noresize noshade nowrap readonly rel rev rules scope scrolling
	selected shape target text type valign valuetype vlink`.split(/\s+/),
);

// A-Z only: toLowerCase() on the whole string would fold U+212A KELVIN SIGN to "k"; on a run of
// A-Z it is ASCII-only, and one call per run beats one per letter.
const asciiFold = (value: string): string =>
	value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

// Each escape has exactly one reading (a hex escape takes every hex digit and always the one space
// after; a tab there fails, as the spec asks), so a failing token gives up in linear time. Two
// readings per escape (`\31 ` as escape + space, or escape then a literal space) backtracked 2^n.
const ESCAPE = String.raw`\\(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{1,5}(?![0-9A-Fa-f]))(?: |(?![ \t]))|\\[^\n\r\f0-9A-Fa-f]`;
const IDENT = String.raw`(?:[\w-]|${ESCAPE}|[^\x00-\x7F])+`;
const TOKEN_SOURCE = String.raw`( > | )|([#.]?)(${IDENT})|\[(${IDENT})="((?:[^"\\\n\r\f]|${ESCAPE})*)"\]|:nth-(child|of-type)\((\d+)\)`;

const decodeEscapes = (text: string): string =>
	text.replace(/\\(?:([0-9A-Fa-f]{1,6}) ?|(.))/gsu, (_, hex: string | undefined, char: string) => {
		if (hex === undefined) {
			return char;
		}
		const codePoint = Number.parseInt(hex, 16);
		const invalid =
			codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff;
		return invalid ? '�' : String.fromCodePoint(codePoint);
	});

const emptyCompound = (): Compound => ({
	ids: [],
	classes: [],
	attributes: [],
	nthChild: [],
	nthOfType: [],
});

const simpleCount = (compound: Compound): number =>
	compound.ids.length +
	compound.classes.length +
	compound.attributes.length +
	compound.nthChild.length +
	compound.nthOfType.length;

const isEmpty = (compound: Compound): boolean =>
	compound.tag === undefined && simpleCount(compound) === 0;

// A raw NUL or lone surrogate is null: Chromium reads it as U+FFFD, so answering here would claim a
// missing target. The length cap runs first: V8's regexp stack throws on a token near 8M chars.
const parseSelector = (selector: string): Selector | null => {
	if (selector.length > MAX_SELECTOR_CHARS || /\0|[\uD800-\uDFFF]/u.test(selector)) {
		return null;
	}
	const token = new RegExp(TOKEN_SOURCE, 'uy');
	const steps: Step[] = [];
	let step: Step = { compound: emptyCompound(), child: false };
	while (token.lastIndex < selector.length) {
		const match = token.exec(selector);
		if (match === null) {
			return null;
		}
		const [, combinator, marker, ident, name, value, nthKind, nthIndex] = match;
		const { compound } = step;
		if (combinator !== undefined) {
			steps.push(step); // an empty compound is refused once, after the loop
			step = { compound: emptyCompound(), child: combinator === ' > ' };
		} else if (ident !== undefined && marker === '') {
			if (!isEmpty(compound)) {
				return null; // a tag only starts a compound
			}
			compound.tag = asciiFold(decodeEscapes(ident));
		} else if (ident !== undefined) {
			(marker === '#' ? compound.ids : compound.classes).push(decodeEscapes(ident));
		} else if (name !== undefined && value !== undefined) {
			const attribute = { name: asciiFold(decodeEscapes(name)), value: decodeEscapes(value) };
			compound.attributes.push(
				CASE_INSENSITIVE_ATTRIBUTES.has(attribute.name)
					? { ...attribute, folded: asciiFold(attribute.value) }
					: attribute,
			);
		} else {
			(nthKind === 'child' ? compound.nthChild : compound.nthOfType).push(Number(nthIndex));
		}
	}
	steps.push(step);
	if (steps.some(({ compound }) => isEmpty(compound))) {
		return null;
	}
	const checks = steps.reduce(
		(sum, { compound }) =>
			sum +
			1 +
			simpleCount(compound) +
			compound.attributes.reduce((length, { folded }) => length + (folded?.length ?? 0), 0),
		0,
	);
	return { steps, checks };
};

// Attributes and classes are read once on first use, so each later check is one Map or Set lookup.
type Target = {
	element: TreeElement;
	tag: string;
	childIndex: number;
	typeIndex: number;
	attributes?: Map<string, string>;
	classes?: Set<string>;
};

// Attributes with no namespace (xlink:href never matches [href]), by ASCII-folded name: names
// fold on every element, SVG included ([viewbox] matches viewBox).
const attributesOf = (target: Target): Map<string, string> => {
	target.attributes ??= new Map(
		target.element.attrs
			.filter((attribute) => attribute.namespace === undefined)
			.map((attribute) => [asciiFold(attribute.name), attribute.value]),
	);
	return target.attributes;
};

const classesOf = (target: Target): Set<string> => {
	target.classes ??= new Set((attributesOf(target).get('class') ?? '').split(/[\t\n\f\r ]+/));
	return target.classes;
};

const attributeMatches = (
	target: Target,
	{ name, value, folded }: Compound['attributes'][number],
): boolean => {
	const actual = attributesOf(target).get(name);
	return (
		actual === value ||
		(folded !== undefined &&
			actual !== undefined &&
			target.element.namespaceURI === html.NS.HTML &&
			// ASCII folding keeps length, so only a same-length value is folded; parseSelector
			// charges that length in `checks`.
			actual.length === folded.length &&
			asciiFold(actual) === folded)
	);
};

// Loops, not every(): this runs once per element and step, and a closure per call costs 3x here.
const matchesCompound = (target: Target, compound: Compound): boolean => {
	if (compound.tag !== undefined && compound.tag !== target.tag) {
		return false;
	}
	for (const id of compound.ids) {
		if (attributesOf(target).get('id') !== id) {
			return false;
		}
	}
	for (const name of compound.classes) {
		if (!classesOf(target).has(name)) {
			return false;
		}
	}
	for (const attribute of compound.attributes) {
		if (!attributeMatches(target, attribute)) {
			return false;
		}
	}
	for (const index of compound.nthChild) {
		if (index !== target.childIndex) {
			return false;
		}
	}
	for (const index of compound.nthOfType) {
		if (index !== target.typeIndex) {
			return false;
		}
	}
	return true;
};

// 1-based index among siblings of the same tag and namespace: foster parenting can put an HTML
// <mglyph> beside a MathML one under one <mi>. A Map, never object keys: <constructor> and
// <__proto__> are legal tags.
const typeIndexes = (children: readonly TreeElement[]): number[] => {
	const counts = new Map<string, number>();
	return children.map((element) => {
		const key = `${element.namespaceURI} ${element.tagName}`;
		const count = (counts.get(key) ?? 0) + 1;
		counts.set(key, count);
		return count;
	});
};

type Frame = { completed: Uint8Array; children: TreeElement[]; types: number[]; next: number };

// One top-down walk. An element completes step i when it matches compound i and its prefix holds:
// for " > " its parent completed step i-1, for " " some strict ancestor did. Memory is depth ×
// steps bytes, bounded by MAX_MATCH_WORK.
const walk = (document: TreeDocument, { steps, checks }: Selector): TreeElement[] | null => {
	const usesTypes = steps.some(({ compound }) => compound.nthOfType.length > 0);
	const frameOf = (completed: Uint8Array, parent: TreeParent): Frame => {
		const children = parent.childNodes.filter((child): child is TreeElement =>
			defaultTreeAdapter.isElementNode(child),
		);
		return { completed, children, types: usesTypes ? typeIndexes(children) : [], next: 0 };
	};
	const ancestorCount = new Int32Array(steps.length);
	// The document's frame: no element completed anything, so popping it changes no count.
	const stack = [frameOf(new Uint8Array(steps.length), document)];
	const matches: TreeElement[] = [];
	let work = 0;
	for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
		const element = frame.children[frame.next];
		if (element === undefined) {
			stack.pop();
			for (let index = 0; index < steps.length; index += 1) {
				ancestorCount[index] -= frame.completed[index] ?? 0;
			}
			continue;
		}
		// The first attribute check reads them all, so they count even when unused.
		work += checks + element.attrs.length;
		if (work > MAX_MATCH_WORK) {
			return null;
		}
		const target: Target = {
			element,
			tag: asciiFold(element.tagName),
			childIndex: frame.next + 1,
			typeIndex: frame.types[frame.next] ?? 0,
		};
		frame.next += 1;
		const completed = new Uint8Array(steps.length);
		// Index loops in this walk: entries() or forEach cost a pair or a call per element and step.
		for (let index = 0; index < steps.length; index += 1) {
			const { compound, child } = steps[index];
			const prefix =
				index === 0 ||
				(child ? frame.completed[index - 1] === 1 : (ancestorCount[index - 1] ?? 0) > 0);
			if (prefix && matchesCompound(target, compound)) {
				completed[index] = 1;
			}
		}
		// Only now: this element must not count as its own ancestor for its later steps (a lone div
		// never matches "div div").
		for (let index = 0; index < steps.length; index += 1) {
			ancestorCount[index] += completed[index] ?? 0;
		}
		if (completed[steps.length - 1] === 1) {
			matches.push(element);
		}
		stack.push(frameOf(completed, element));
	}
	return matches;
};

// Document order. null outside the finder grammar, past MAX_SELECTOR_CHARS or past MAX_MATCH_WORK
// (which counts every check, so it bounds a match on any page size). Never throws.
export const selectMatches = (document: TreeDocument, selector: string): TreeElement[] | null => {
	const parsed = parseSelector(selector);
	return parsed === null ? null : walk(document, parsed);
};
