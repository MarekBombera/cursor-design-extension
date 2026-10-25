import { className, finder, idName } from '@medv/finder';

import { COMMENT_STYLE_KEYS, MAX_PICK_TEXT_CHARS, MAX_SELECTOR_CHARS } from '../../disk/layout';
import {
	type CommentStyles,
	type FramePickMessage,
	hasControlChars,
	isSafeStyleValue,
} from './frameMessages';

// Pick data for one element (8d2). Part of the frame runtime; it only reads the design DOM.

// Finder runs synchronously in the click handler; its 1000 ms default would freeze the frame.
// Past the timeout it returns its :nth-of-type fallback path.
const FINDER_TIMEOUT_MS = 200;

const GENERATED_PREFIXES = ['css-', 'svelte-', 'sc-', 'jsx-', 'emotion-', 'astro-'];

// ponytail: framework prefix list plus finder's own word check (idName / className); a
// letters-only hash without a known prefix can still pass. Upgrade: entropy scoring.
export const isGeneratedName = (name: string): boolean => {
	const lower = name.toLowerCase();
	return GENERATED_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

const runFinder = (element: Element, timeoutMs: number): string =>
	finder(element, {
		// finder types root as Element, but accepts a Document at runtime (findRootDocument).
		// The document scopes uniqueness the same in the live frame and a parsed copy.
		root: element.ownerDocument as unknown as Element,
		idName: (name) => idName(name) && !isGeneratedName(name),
		className: (name) => className(name) && !isGeneratedName(name),
		timeoutMs,
	});

// The path finder falls back to, built without finder: one `tag:nth-of-type(n)` step per ancestor
// up to `html`. Unique by construction and linear in depth.
const nthOfTypePath = (element: Element): string => {
	const steps: string[] = [];
	for (let current: Element | null = element; current !== null; current = current.parentElement) {
		const tag = current.localName;
		if (tag === 'html') {
			steps.push('html');
			break;
		}
		let index = 1;
		for (let sibling = current.previousElementSibling; sibling !== null;) {
			if (sibling.localName === tag) {
				index += 1;
			}
			sibling = sibling.previousElementSibling;
		}
		steps.push(`${tag}:nth-of-type(${index})`);
	}
	return steps.reverse().join(' > ');
};

// A selector unique in the element's document, or null when none fits the cap.
export const buildSelector = (
	element: Element,
	timeoutMs: number = FINDER_TIMEOUT_MS,
): string | null => {
	if (!element.isConnected) {
		return null;
	}
	let selector: string;
	try {
		selector = runFinder(element, timeoutMs);
	} catch (error) {
		// Finder expands every candidate path up front, so class-heavy markup overflows the stack
		// (RangeError) before its timeout is checked, even with a negative timeout (about 50
		// classes per element). Build its :nth-of-type fallback path directly instead.
		// ponytail: any other finder throw (nothing unique, element left the document) means no
		// selector, silently: the frame has no log channel and the chip says so.
		if (!(error instanceof RangeError)) {
			return null;
		}
		selector = nthOfTypePath(element);
	}
	return selector === '' || selector.length > MAX_SELECTOR_CHARS || hasControlChars(selector)
		? null
		: selector;
};

export const textExcerpt = (raw: string): string => {
	// One pass: control characters and whitespace runs become one space.
	const text = raw
		.replaceAll(/[\p{Cc}\s]+/gu, ' ')
		.trim()
		.slice(0, MAX_PICK_TEXT_CHARS);
	const last = text.charCodeAt(text.length - 1);
	// A cut through a surrogate pair leaves a lone high surrogate.
	return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
};

// Unsafe values are omitted, never stripped: stripping changes their meaning.
export const readStyles = (read: (property: string) => string): CommentStyles => {
	const styles: CommentStyles = {};
	for (const key of COMMENT_STYLE_KEYS) {
		const raw = read(key);
		if (hasControlChars(raw)) {
			continue;
		}
		const value = raw.replaceAll(/ +/g, ' ').trim();
		if (isSafeStyleValue(value)) {
			styles[key] = value;
		}
	}
	return styles;
};

// The pick fields that depend only on the element, not on the click or scroll position.
export type PickDescription = Pick<FramePickMessage, 'selector' | 'tagName' | 'text' | 'styles'>;

export const describeElement = (element: Element, isPage: boolean): PickDescription => {
	if (isPage) {
		// The whole page's text is noise; 8e checks page comments by generation.
		const body = element.ownerDocument.body ?? element;
		return {
			selector: 'body',
			tagName: 'body',
			text: '',
			styles: readStyles((property) => window.getComputedStyle(body).getPropertyValue(property)),
		};
	}
	if (!element.isConnected) {
		return { selector: null, tagName: element.localName, text: '', styles: {} };
	}
	const style = window.getComputedStyle(element);
	return {
		selector: buildSelector(element),
		tagName: element.localName,
		text: textExcerpt(
			element instanceof HTMLElement ? element.innerText : (element.textContent ?? ''),
		),
		styles: readStyles((property) => style.getPropertyValue(property)),
	};
};
