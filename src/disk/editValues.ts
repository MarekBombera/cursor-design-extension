import { asciiTrim, leadingWhitespaceLength, trailingWhitespaceLength } from './inlineStyle';
import { type EDIT_STYLE_FIELDS, MAX_EDIT_TEXT_CHARS, MAX_STYLE_VALUE_CHARS } from './layout';

// Edit-mode value rules (0.4), shared by the edit core (artboardEdit.ts, the authority on every
// save) and the chrome's inspector (preview and pre-checks). No parse5, no DOM: the webview bundle
// imports this file.

export type StyleField = (typeof EDIT_STYLE_FIELDS)[number];

const ASCII_WHITESPACE_RUNS = /[\t\n\f\r ]+/g;

const NEWLINES = /\r\n|\r|\n/g;

const LONE_SURROGATE = /\p{Cs}/u;

const COLOR_VALUE = /^#[0-9a-fA-F]{6}$/;

const LENGTH_VALUE = /^[A-Za-z0-9.%+\-*/(), ]+$/;

const BARE_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export const hasLoneSurrogate = (text: string): boolean => LONE_SURROGATE.test(text);

// C0 controls other than tab, and DEL, are refused in edited text.
const hasRefusedControl = (text: string): boolean => {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
			return true;
		}
	}
	return false;
};

// The text an edit writes: a newline becomes a space, ASCII edges trimmed.
export const normalizeEditText = (value: string): string =>
	asciiTrim(value.replaceAll(NEWLINES, ' '));

// Checked on the normalized text: over the cap, a refused control character or a lone surrogate.
export const isRefusedEditText = (text: string): boolean =>
	text.length > MAX_EDIT_TEXT_CHARS || hasRefusedControl(text) || hasLoneSurrogate(text);

// The element's whole text node after a text edit, as the frame should show it: the source keeps
// its leading and trailing whitespace and only the trimmed middle changes (all-whitespace text is
// all leading).
// ponytail: edge whitespace written as a reference (`&#32;Hi`) is whitespace in the DOM but not in
// the source span, so the next text save after such a preview reads text-changed. Upgrade: the
// host answers with the new text node.
export const previewText = ({ liveText, value }: { liveText: string; value: string }): string => {
	const leading = liveText.slice(0, leadingWhitespaceLength(liveText));
	const rest = liveText.slice(leading.length);
	const trailing = rest.slice(rest.length - trailingWhitespaceLength(rest));
	return `${leading}${normalizeEditText(value)}${trailing}`;
};

// Trims and collapses ASCII whitespace, then checks the field's rule. '' = clear; undefined =
// refused. Bare numbers outside parentheses get px. The written value can never hold a quote,
// &, <, >, ;, :, \, !, braces or a comment, so it is safe in any attribute quoting and cannot
// end or swallow another declaration. A value the browser ignores (abc) is kept as typed.
export const normalizeStyleValue = (field: StyleField, value: string): string | undefined => {
	const collapsed = asciiTrim(value.replaceAll(ASCII_WHITESPACE_RUNS, ' '));
	if (collapsed === '') {
		return '';
	}
	if (field === 'color') {
		return COLOR_VALUE.test(collapsed) ? collapsed : undefined;
	}
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
	const written = parts.join(' ');
	return depth === 0 && written.length <= MAX_STYLE_VALUE_CHARS ? written : undefined;
};
