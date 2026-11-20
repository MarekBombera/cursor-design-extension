import {
	asciiLowerCase,
	asciiTrim,
	BORDER_PARENTS,
	leadingWhitespaceLength,
	removeStyleProperties,
	removeStyleProperty,
	setStyleProperty,
	trailingWhitespaceLength,
} from './inlineStyle';
import { EDIT_STYLE_FIELDS, MAX_EDIT_TEXT_CHARS, MAX_STYLE_VALUE_CHARS } from './layout';

// Shared by the edit core (the authority on every save) and the chrome's inspector. No parse5, no
// DOM: the webview bundle imports this file.

export type StyleField = (typeof EDIT_STYLE_FIELDS)[number];

const ASCII_WHITESPACE_RUNS = /[\t\n\f\r ]+/g;

const NEWLINES = /\r\n|\r|\n/g;

const LONE_SURROGATE = /\p{Cs}/u;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Unsigned, with a digit after any dot: `1`, `1.6`, `.5`; never `1.` or `-1`.
const UNSIGNED_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

const LENGTH_VALUE = /^[A-Za-z0-9.%+\-*/(), ]+$/;

const BARE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export const hasLoneSurrogate = (text: string): boolean => LONE_SURROGATE.test(text);

const hasRefusedControl = (text: string): boolean => {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
			return true;
		}
	}
	return false;
};

export const normalizeEditText = (value: string): string =>
	asciiTrim(value.replaceAll(NEWLINES, ' '));

// Takes the normalized text.
export const isRefusedEditText = (text: string): boolean =>
	text.length > MAX_EDIT_TEXT_CHARS || hasRefusedControl(text) || hasLoneSurrogate(text);

// The element's whole text node after a text edit, as the frame shows it: only the trimmed middle
// changes (all-whitespace text is all leading).
// ponytail: edge whitespace written as a reference (`&#32;Hi`) is whitespace in the DOM but not in
// the source span, so the next text save after such a preview reads text-changed. Upgrade path:
// the host answers with the new text node.
export const previewText = ({ liveText, value }: { liveText: string; value: string }): string => {
	const leading = liveText.slice(0, leadingWhitespaceLength(liveText));
	const rest = liveText.slice(leading.length);
	const trailing = rest.slice(rest.length - trailingWhitespaceLength(rest));
	return `${leading}${normalizeEditText(value)}${trailing}`;
};

const COLOR_FIELDS: ReadonlySet<StyleField> = new Set([
	'color',
	'background-color',
	'border-color',
]);

// Exactly what the inspector's controls offer; matched after ASCII lowercasing.
const KEYWORDS: Partial<Record<StyleField, ReadonlySet<string>>> = {
	'font-weight': new Set(['100', '200', '300', '400', '500', '600', '700', '800', '900']),
	'font-style': new Set(['normal', 'italic']),
	'text-decoration-line': new Set(['none', 'underline', 'line-through', 'underline line-through']),
	'text-align': new Set(['left', 'center', 'right', 'justify']),
	'text-transform': new Set(['none', 'uppercase', 'lowercase', 'capitalize']),
	overflow: new Set(['visible', 'hidden', 'clip', 'scroll', 'auto']),
	'border-style': new Set(['none', 'solid', 'dashed', 'dotted', 'double']),
};

// Bare numbers outside parentheses get px. Never for a field that can take an image or url():
// `url(//host/x)` passes these characters.
const lengthValue = (collapsed: string): string | undefined => {
	if (!LENGTH_VALUE.test(collapsed) || collapsed.includes('/*') || collapsed.includes('*/')) {
		return undefined;
	}
	let depth = 0;
	const parts: string[] = [];
	for (const part of collapsed.split(' ')) {
		parts.push(depth === 0 && BARE_NUMBER.test(part) ? `${part}px` : part);
		for (const character of part) {
			depth += character === '(' ? 1 : character === ')' ? -1 : 0;
			if (depth < 0) {
				return undefined;
			}
		}
	}
	return depth === 0 ? parts.join(' ') : undefined;
};

const writtenValue = (field: StyleField, collapsed: string): string | undefined => {
	if (COLOR_FIELDS.has(field)) {
		if (HEX_COLOR.test(collapsed)) {
			return collapsed;
		}
		return asciiLowerCase(collapsed) === 'transparent' ? 'transparent' : undefined;
	}
	const keywords = KEYWORDS[field];
	if (keywords !== undefined) {
		const keyword = asciiLowerCase(collapsed);
		return keywords.has(keyword) ? keyword : undefined;
	}
	if (field === 'opacity') {
		return UNSIGNED_NUMBER.test(collapsed) && Number(collapsed) <= 1 ? collapsed : undefined;
	}
	if (field === 'line-height' && UNSIGNED_NUMBER.test(collapsed)) {
		return collapsed;
	}
	// A line-height number never gets px: `1.` or `-1.5` is refused, not turned into a length.
	if (field === 'line-height' && BARE_NUMBER.test(collapsed)) {
		return undefined;
	}
	return lengthValue(collapsed);
};

// Trims and collapses ASCII whitespace, then checks the field's rule. '' = clear; undefined =
// refused. The written value can never hold a quote, &, <, >, ;, :, \, !, braces or a comment,
// so it is safe in any attribute quoting and cannot end or swallow another declaration. A length
// the browser ignores (abc) is kept as typed.
export const normalizeStyleValue = (field: StyleField, value: string): string | undefined => {
	const collapsed = asciiTrim(value.replaceAll(ASCII_WHITESPACE_RUNS, ' '));
	if (collapsed === '') {
		return '';
	}
	const written = writtenValue(field, collapsed);
	return written !== undefined && written.length <= MAX_STYLE_VALUE_CHARS ? written : undefined;
};

export type StyleChange = { field: StyleField; value: string };

export type StyleChangesResult =
	| { ok: true; styleText: string }
	| { ok: false; refusal: 'invalid-value' | 'unsupported-style' };

const BORDER_FIELDS: readonly StyleField[] = ['border-width', 'border-style', 'border-color'];

// The one apply rule for the edit core and the chrome's preview: every value is normalized before
// anything changes, then each is set or removed in list order. `styleText` is '' when the element
// has no style attribute. Clearing all three border fields also removes every border shorthand
// (Reset on Border).
export const applyStyleChanges = ({
	styleText,
	changes,
}: {
	styleText: string;
	changes: readonly StyleChange[];
}): StyleChangesResult => {
	const fields = new Set(changes.map((change) => change.field));
	if (
		changes.length === 0 ||
		changes.length > EDIT_STYLE_FIELDS.length ||
		fields.size !== changes.length
	) {
		return { ok: false, refusal: 'invalid-value' };
	}
	const written: StyleChange[] = [];
	for (const { field, value } of changes) {
		const normalized = normalizeStyleValue(field, value);
		if (normalized === undefined) {
			return { ok: false, refusal: 'invalid-value' };
		}
		written.push({ field, value: normalized });
	}
	let next = styleText;
	for (const { field, value } of written) {
		const updated =
			value === ''
				? removeStyleProperty(next, field)
				: setStyleProperty({ styleText: next, property: field, value });
		if (updated === undefined) {
			return { ok: false, refusal: 'unsupported-style' };
		}
		next = updated;
	}
	const resetsBorder = BORDER_FIELDS.every((field) =>
		written.some((change) => change.field === field && change.value === ''),
	);
	return {
		ok: true,
		styleText: resetsBorder ? removeStyleProperties(next, new Set(BORDER_PARENTS)) : next,
	};
};
