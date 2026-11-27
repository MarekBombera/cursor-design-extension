import { defaultTreeAdapter, html as parse5Html } from 'parse5';

import {
	type ArtboardDocument,
	type ArtboardElement,
	parseArtboardDocument,
} from './commentTarget';
import { leadingWhitespaceLength, trailingWhitespaceLength } from './inlineStyle';
import {
	applyStyleChanges,
	type EditChange,
	type EditRefusal,
	hasLoneSurrogate,
	isRefusedEditText,
	normalizeEditText,
	type StyleChange,
} from './editValues';
import { EDIT_STYLE_FIELDS, MAX_EDIT_TEXT_CHARS, RAW_TEXT_ELEMENTS } from './layout';
import { isJsonRecord } from './parse';
import { entryOffset, numberedElements, tagNameEnd } from './sourceTags';

// One Edit-mode change to disk HTML, by source number: string splices at parse5 offsets change
// only the element's text or its inline style properties; every other byte stays. Pure.

export type ArtboardEdit = { sourceNumber: number } & EditChange;

export type EditResult = { ok: true; html: string } | { ok: false; refusal: EditRefusal };

type TargetArgs = { html: string; element: ArtboardElement };

const LEADING_NEWLINE_DROPPED = new Set(['pre', 'listing']);

const EMPTY_VALUE = /[\t\n\f\r ]*=/y;

// Spelled as a code point: the formatter would turn a \u00a0 escape into an invisible character.
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

const refuse = (refusal: EditRefusal): EditResult => ({ ok: false, refusal });

const isStyleChange = (entry: unknown): entry is StyleChange => {
	if (!isJsonRecord(entry)) {
		return false;
	}
	const { field, value } = entry;
	return EDIT_STYLE_FIELDS.some((styleField) => styleField === field) && typeof value === 'string';
};

// The untrusted edit's checked shape: `field: 'text'` selects the text variant, anything else must
// be the styles shape. undefined: neither.
const checkedEdit = (
	edit: Record<string, unknown>,
): { value: string; liveText: string } | { styles: readonly StyleChange[] } | undefined => {
	const { field, value, liveText, styles } = edit;
	if (field === 'text') {
		return typeof value === 'string' && typeof liveText === 'string'
			? { value, liveText }
			: undefined;
	}
	if (!Array.isArray(styles)) {
		return undefined;
	}
	// Array.from fills holes with undefined: `every` skips holes, so a sparse list would pass.
	const changes: unknown[] = Array.from(styles);
	return changes.every(isStyleChange) ? { styles: changes } : undefined;
};

// A programming error, not a refusal: the caller passed a document parsed from other HTML. The
// start tag's own bounds anchor it, not its name: parse5 renames some tags (`<image>` is `img`).
const assertParsedFrom = (html: string, element: ArtboardElement): void => {
	const location = element.sourceCodeLocation;
	const startTag = location?.startTag;
	if (
		location === undefined ||
		location === null ||
		startTag === undefined ||
		location.endOffset > html.length ||
		html.charAt(startTag.startOffset) !== '<' ||
		html.charAt(startTag.endOffset - 1) !== '>'
	) {
		throw new Error('Edit core: the document was not parsed from this HTML.');
	}
};

const encodeText = (text: string): string =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll(NO_BREAK_SPACE, '&nbsp;');

const normalizeNewlines = (text: string): string => text.replaceAll(/\r\n?/g, '\n');

type TextSplice = { html: string; spliceStart: number; expectedText: string };

// Where the encoded text goes: the trimmed middle of the element's one text node (its edge
// whitespace kept), or, with no text node, before the end tag (after the start tag if none).
const spliceText = ({
	html,
	element,
	value,
}: {
	html: string;
	element: ArtboardElement;
	value: string;
}): TextSplice | undefined => {
	const location = element.sourceCodeLocation;
	const startTagEnd = location?.startTag?.endOffset ?? 0;
	const contentEnd = location?.endTag?.startOffset ?? location?.endOffset ?? 0;
	const [textNode] = element.childNodes;
	if (textNode === undefined) {
		const insertAt = location?.endTag?.startOffset ?? startTagEnd;
		return {
			html: `${html.slice(0, insertAt)}${encodeText(value)}${html.slice(insertAt)}`,
			spliceStart: insertAt,
			expectedText: value,
		};
	}
	const textLocation = textNode.sourceCodeLocation;
	if (
		textLocation === undefined ||
		textLocation === null ||
		textLocation.startOffset < startTagEnd ||
		textLocation.endOffset > contentEnd
	) {
		return undefined;
	}
	const span = html.slice(textLocation.startOffset, textLocation.endOffset);
	const leading = span.slice(0, leadingWhitespaceLength(span));
	const trailing = span.slice(span.length - trailingWhitespaceLength(span.slice(leading.length)));
	// HTML drops one newline right after <pre> / <listing>; when parse5 tokenizes it with the
	// whitespace after it, the text location includes it but the node's value does not.
	const droppedNewline =
		element.namespaceURI === parse5Html.NS.HTML &&
		LEADING_NEWLINE_DROPPED.has(element.tagName) &&
		textLocation.startOffset === startTagEnd &&
		normalizeNewlines(leading).startsWith('\n');
	const middleStart = textLocation.startOffset + leading.length;
	const middleEnd = textLocation.endOffset - trailing.length;
	return {
		html: `${html.slice(0, middleStart)}${encodeText(value)}${html.slice(middleEnd)}`,
		spliceStart: middleStart,
		expectedText: `${normalizeNewlines(leading).slice(droppedNewline ? 1 : 0)}${value}${normalizeNewlines(trailing)}`,
	};
};

// Re-parse: every source number must stay on its element (offsets after the splice shift by the
// length change) and the text inside it. Catches text that restructures the page: <head> (the
// implied <body> takes over), empty table parts (foster-parenting), void elements, template,
// self-closing foreign elements.
// ponytail: one full re-parse per text edit (up to MAX_POSTED_ARTBOARD_HTML_CHARS). Upgrade path:
// seed cachedArtboardDocument's cache with the new document instead of discarding it.
const keepsStructure = ({
	html,
	entries,
	sourceNumber,
	splice,
}: {
	html: string;
	entries: ArtboardElement[][];
	sourceNumber: number;
	splice: TextSplice;
}): boolean => {
	const lengthChange = splice.html.length - html.length;
	const nextEntries = numberedElements(parseArtboardDocument(splice.html));
	const numbersKept =
		nextEntries.length === entries.length &&
		entries.every((entry, index) => {
			const offset = entryOffset(entry);
			const expected = offset < splice.spliceStart ? offset : offset + lengthChange;
			return entryOffset(nextEntries[index]) === expected;
		});
	const target = nextEntries[sourceNumber];
	const [edited] = target ?? [];
	if (!numbersKept || target?.length !== 1 || edited === undefined) {
		return false;
	}
	const [child, ...others] = edited.childNodes;
	if (splice.expectedText === '') {
		return child === undefined;
	}
	return (
		child !== undefined &&
		others.length === 0 &&
		defaultTreeAdapter.isTextNode(child) &&
		child.value === splice.expectedText
	);
};

const editText = ({
	html,
	element,
	sourceNumber,
	entries,
	value,
	liveText,
}: TargetArgs & {
	sourceNumber: number;
	entries: ArtboardElement[][];
	value: string;
	liveText: string;
}): EditResult => {
	const children = element.childNodes;
	if (
		(element.namespaceURI === parse5Html.NS.HTML && RAW_TEXT_ELEMENTS.has(element.tagName)) ||
		children.length > 1 ||
		(children[0] !== undefined && !defaultTreeAdapter.isTextNode(children[0]))
	) {
		return refuse('not-plain-text');
	}
	if (liveText.length > MAX_EDIT_TEXT_CHARS || hasLoneSurrogate(liveText)) {
		return refuse('invalid-value');
	}
	const text = normalizeEditText(value);
	if (isRefusedEditText(text)) {
		return refuse('invalid-value');
	}
	const [textNode] = children;
	const sourceText =
		textNode !== undefined && defaultTreeAdapter.isTextNode(textNode) ? textNode.value : '';
	if (liveText !== sourceText) {
		return refuse('text-changed');
	}
	const splice = spliceText({ html, element, value: text });
	if (splice === undefined) {
		return refuse('not-plain-text');
	}
	if (splice.html === html) {
		return { ok: true, html };
	}
	return keepsStructure({ html, entries, sourceNumber, splice })
		? { ok: true, html: splice.html }
		: refuse('not-plain-text');
};

type StyleAttribute = {
	start: number;
	end: number;
	name: string;
	styleText: string;
	// Where the style text sits in `html` when it is quoted; unquoted and valueless attributes
	// are rewritten whole, double-quoted.
	quoted?: { start: number; end: number };
};

const readStyleAttribute = (
	html: string,
	location: { startOffset: number; endOffset: number },
): StyleAttribute => {
	const { startOffset: start, endOffset: end } = location;
	const name = html.slice(start, start + 'style'.length);
	let index = start + name.length;
	// parse5 ends an empty unquoted value's location at the name (`style=>`); take the `=` too.
	if (end === index) {
		EMPTY_VALUE.lastIndex = index;
		return {
			start,
			end: EMPTY_VALUE.test(html) ? EMPTY_VALUE.lastIndex : end,
			name,
			styleText: '',
		};
	}
	index += leadingWhitespaceLength(html.slice(index, end));
	if (html.charAt(index) !== '=') {
		return { start, end, name, styleText: '' };
	}
	index += 1;
	index += leadingWhitespaceLength(html.slice(index, end));
	const quote = html.charAt(index);
	if ((quote === '"' || quote === "'") && end - index >= 2 && html.charAt(end - 1) === quote) {
		return {
			start,
			end,
			name,
			styleText: html.slice(index + 1, end - 1),
			quoted: { start: index + 1, end: end - 1 },
		};
	}
	return { start, end, name, styleText: html.slice(index, end) };
};

const editStyle = ({
	html,
	element,
	changes,
}: TargetArgs & { changes: readonly StyleChange[] }): EditResult => {
	const startTag = element.sourceCodeLocation?.startTag;
	const styleLocation = element.sourceCodeLocation?.attrs?.style;
	if (styleLocation === undefined) {
		// A <body> or <html> style merged in from a later duplicate start tag.
		if (element.attrs.some((attribute) => attribute.name === 'style')) {
			return refuse('unsupported-style');
		}
		const applied = applyStyleChanges({ styleText: '', changes });
		if (!applied.ok) {
			return refuse(applied.refusal);
		}
		if (applied.styleText === '') {
			return { ok: true, html };
		}
		const insertAt = tagNameEnd(html, startTag?.startOffset ?? 0);
		return {
			ok: true,
			html: `${html.slice(0, insertAt)} style="${applied.styleText}"${html.slice(insertAt)}`,
		};
	}
	const attribute = readStyleAttribute(html, styleLocation);
	if (attribute.quoted === undefined && attribute.styleText.includes('"')) {
		return refuse('unsupported-style');
	}
	const applied = applyStyleChanges({ styleText: attribute.styleText, changes });
	if (!applied.ok) {
		return refuse(applied.refusal);
	}
	const { styleText } = applied;
	if (styleText === attribute.styleText) {
		return { ok: true, html };
	}
	const { quoted } = attribute;
	return quoted === undefined
		? {
				ok: true,
				html: `${html.slice(0, attribute.start)}${attribute.name}="${styleText}"${html.slice(attribute.end)}`,
			}
		: { ok: true, html: `${html.slice(0, quoted.start)}${styleText}${html.slice(quoted.end)}` };
};

// `document` must be parseArtboardDocument(html); another document throws. The first failing
// check wins: input shape, number lookup, then the field's rules. `ok: true` with the input HTML
// unchanged is a no-op; the caller decides whether to write.
export const editArtboardHtml = ({
	html,
	document,
	edit,
}: {
	html: string;
	document: ArtboardDocument;
	edit: ArtboardEdit;
}): EditResult => {
	// Untrusted panel input: re-checked here although parseChromeMessage checks its shape too.
	const untrusted: Record<string, unknown> = edit;
	const checked = checkedEdit(untrusted);
	if (checked === undefined) {
		return refuse('invalid-value');
	}
	const { sourceNumber } = untrusted;
	if (typeof sourceNumber !== 'number' || !Number.isSafeInteger(sourceNumber) || sourceNumber < 0) {
		return refuse('unknown-number');
	}
	const entries = numberedElements(document);
	const entry = entries[sourceNumber];
	const [element] = entry ?? [];
	if (entry === undefined || element === undefined) {
		return refuse('unknown-number');
	}
	if (entry.length > 1) {
		return refuse('shared-number');
	}
	assertParsedFrom(html, element);
	return 'styles' in checked
		? editStyle({ html, element, changes: checked.styles })
		: editText({
				html,
				element,
				sourceNumber,
				entries,
				value: checked.value,
				liveText: checked.liveText,
			});
};
