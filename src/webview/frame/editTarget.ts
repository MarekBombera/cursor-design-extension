import {
	EDIT_STYLE_FIELDS,
	MAX_EDIT_TEXT_CHARS,
	MAX_PICK_STYLE_CHARS,
	SOURCE_TAG_ATTRIBUTE,
} from '../../disk/layout';
import type { PickEditFields } from './frameMessages';
import { readStyles } from './selector';

// Part of the frame runtime, embedded in the exported canvas.html, so it stays small and only reads
// the design DOM: attributes through getAttribute, children through childNodes. Never a setter,
// `.style` or `.dataset`.

const CANONICAL_NUMBER = /^(?:0|[1-9]\d*)$/;

const NOT_ASCII_WHITESPACE = /[^\t\n\f\r ]/;

const sourceNumberOf = (element: Element): number | null => {
	const value = element.getAttribute(SOURCE_TAG_ATTRIBUTE);
	if (value === null || !CANONICAL_NUMBER.test(value)) {
		return null;
	}
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : null;
};

// A comment counts as other content: it is a node, not text (the edit core agrees).
export const hasOtherContent = (element: Element): boolean => {
	const children = element.childNodes;
	const [only] = children;
	return children.length > 1 || (only !== undefined && !(only instanceof Text));
};

const textOf = (element: Element): Pick<PickEditFields, 'textState' | 'text'> => {
	if (hasOtherContent(element)) {
		const mixed = [...element.childNodes].some(
			(node) => node instanceof Text && NOT_ASCII_WHITESPACE.test(node.data),
		);
		return { textState: mixed ? 'mixed' : 'elements', text: '' };
	}
	const [only] = element.childNodes;
	const text = only instanceof Text ? only.data : '';
	return text.length > MAX_EDIT_TEXT_CHARS
		? { textState: 'too-long', text: '' }
		: { textState: 'plain', text };
};

// Every edit field's current value, as Chromium serializes it.
const computedOf = (element: Element): PickEditFields['computed'] => {
	if (!element.isConnected) {
		return {};
	}
	const computed = window.getComputedStyle(element);
	return readStyles((property) => computed.getPropertyValue(property), EDIT_STYLE_FIELDS);
};

export const describeEditTarget = (element: Element): PickEditFields => {
	const style = element.getAttribute('style');
	const sourceNumber = element.isConnected ? sourceNumberOf(element) : null;
	return {
		sourceNumber,
		// The number is a validated integer, so the selector cannot be injected.
		sharedNumber:
			sourceNumber !== null &&
			element.ownerDocument.querySelectorAll(`[${SOURCE_TAG_ATTRIBUTE}="${sourceNumber}"]`).length >
				1,
		...textOf(element),
		style: style === null ? '' : style.length > MAX_PICK_STYLE_CHARS ? null : style,
		computed: computedOf(element),
	};
};
