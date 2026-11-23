import { className, finder, idName } from '@medv/finder';

import { COMMENT_STYLE_KEYS, MAX_PICK_TEXT_CHARS, MAX_SELECTOR_CHARS } from '../../disk/layout';
import { type FramePickMessage, hasControlChars, isSafeStyleValue } from './frameMessages';

// Part of the frame runtime; it only reads the design DOM.

// Finder runs synchronously in the click handler; its 1000 ms default would freeze the frame.
// Past the timeout it returns its :nth-of-type fallback path.
const FINDER_TIMEOUT_MS = 200;

const GENERATED_PREFIXES = ['css-', 'svelte-', 'sc-', 'jsx-', 'emotion-', 'astro-'];

// ponytail: framework prefix list plus finder's own word check (idName / className); a
// letters-only hash without a known prefix can still pass. Upgrade: entropy scoring.
const isGeneratedName = (name: string): boolean => {
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
// Exported for tests: they pass a finder timeout, which describeElement cannot.
/** @internal */
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
		// Finder expands every candidate path up front, so class-heavy markup (about 50 classes per
		// element) overflows the stack (RangeError) before any timeout is checked. Build its
		// :nth-of-type fallback directly.
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

// Keeps format chars (\p{Cf}) that toOneLine strips: targetAgrees compares it with raw disk text.
// Exported for tests: they pin the collapse and cut on raw strings, without DOM innerText.
/** @internal */
export const textExcerpt = (raw: string): string => {
	const text = raw
		.replaceAll(/[\p{Cc}\s]+/gu, ' ')
		.trim()
		.slice(0, MAX_PICK_TEXT_CHARS);
	const last = text.charCodeAt(text.length - 1);
	// A cut through a surrogate pair leaves a lone high surrogate.
	return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
};

// Unsafe values are omitted, never stripped: stripping changes their meaning.
export const readStyles = <Key extends string>(
	read: (property: string) => string,
	keys: readonly Key[],
): Partial<Record<Key, string>> => {
	const styles: Partial<Record<Key, string>> = {};
	for (const key of keys) {
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

// Everything but the selector: cheap enough to recompute after an Edit-mode preview.
export const describeContent = (
	element: Element,
	isPage: boolean,
): Omit<PickDescription, 'selector'> => {
	if (isPage) {
		// The whole page's text is noise; a page comment has no target to check.
		const body = element.ownerDocument.body ?? element;
		return {
			tagName: 'body',
			text: '',
			styles: readStyles(
				(property) => window.getComputedStyle(body).getPropertyValue(property),
				COMMENT_STYLE_KEYS,
			),
		};
	}
	if (!element.isConnected) {
		return { tagName: element.localName, text: '', styles: {} };
	}
	const style = window.getComputedStyle(element);
	return {
		tagName: element.localName,
		text: textExcerpt(
			element instanceof HTMLElement ? element.innerText : (element.textContent ?? ''),
		),
		styles: readStyles((property) => style.getPropertyValue(property), COMMENT_STYLE_KEYS),
	};
};

export const describeElement = (element: Element, isPage: boolean): PickDescription => ({
	selector: isPage ? 'body' : element.isConnected ? buildSelector(element) : null,
	...describeContent(element, isPage),
});
