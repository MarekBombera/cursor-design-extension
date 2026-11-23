// An edit changes or appends only the declarations it touches; every other character stays.

const SIDES = [
	'top',
	'right',
	'bottom',
	'left',
	'block',
	'block-start',
	'block-end',
	'inline',
	'inline-start',
	'inline-end',
] as const;

const longhandsOf = (shorthand: string): readonly string[] =>
	SIDES.map((side) => `${shorthand}-${side}`);

const borderSideLonghands = (suffix: string): readonly string[] =>
	SIDES.map((side) => `border-${side}-${suffix}`);

const PADDING_LONGHANDS: readonly string[] = longhandsOf('padding');

const MARGIN_LONGHANDS: readonly string[] = longhandsOf('margin');

// Every declaration that can set a side's width, style and colour at once.
export const BORDER_PARENTS: readonly string[] = ['border', ...longhandsOf('border')];

// Setting or clearing a shorthand drops its longhands, or the edit would look ignored. A border
// field drops only its own aspect: border-width never touches a -style or -color longhand.
const LONGHANDS = new Map<string, readonly string[]>([
	['padding', PADDING_LONGHANDS],
	['margin', MARGIN_LONGHANDS],
	['gap', ['row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap']],
	[
		'border-radius',
		[
			'top-left',
			'top-right',
			'bottom-right',
			'bottom-left',
			'start-start',
			'start-end',
			'end-start',
			'end-end',
		].map((corner) => `border-${corner}-radius`),
	],
	['overflow', ['overflow-x', 'overflow-y', 'overflow-block', 'overflow-inline']],
	['border-width', borderSideLonghands('width')],
	['border-style', borderSideLonghands('style')],
	['border-color', borderSideLonghands('color')],
]);

// A parent declared after the field's last declaration would override an in-place set.
const PARENTS = new Map<string, readonly string[]>([
	['font-size', ['font']],
	['font-weight', ['font']],
	['font-style', ['font']],
	['line-height', ['font']],
	['text-decoration-line', ['text-decoration']],
	['background-color', ['background']],
	['border-width', BORDER_PARENTS],
	['border-style', BORDER_PARENTS],
	['border-color', BORDER_PARENTS],
]);

// Named references that spell CSS syntax; numeric references are always decoded.
// ponytail: any other named reference, or one without its `;` (`&quot`, `&#59`), reads as text,
// so CSS syntax spelled that way may mis-split. Upgrade path: the full HTML entity table and its
// no-semicolon rules.
const NAMED_SYNTAX = new Map([
	['quot', '"'],
	['apos', "'"],
	['semi', ';'],
	['colon', ':'],
	['lpar', '('],
	['rpar', ')'],
	['lsqb', '['],
	['rsqb', ']'],
	['lcub', '{'],
	['rcub', '}'],
	['sol', '/'],
	['bsol', '\\'],
	['ast', '*'],
]);

const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/y;

const UNTERMINATED_REFERENCE = /&(?:#[xX]?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*)$/;

const ASCII_WHITESPACE = new Set(['\t', '\n', '\f', '\r', ' ']);

const IMPORTANT_SUFFIX = /![\t\n\f\r ]*important$/i;

const OPENERS = new Set(['(', '[', '{']);

const CLOSERS = new Set([')', ']', '}']);

// One unit of the style text as written: a character reference or one UTF-16 code unit. `char`
// is what CSS sees: the decoded character, or the raw text for a reference read as ordinary text.
type Unit = { start: number; end: number; char: string };

const referenceChar = (match: RegExpExecArray): string => {
	const [text, decimal, hex, name] = match;
	if (name !== undefined) {
		return NAMED_SYNTAX.get(name) ?? text;
	}
	const codePoint = decimal === undefined ? Number.parseInt(hex ?? '', 16) : Number(decimal);
	return codePoint >= 1 && codePoint <= 0x10_ff_ff ? String.fromCodePoint(codePoint) : text;
};

const readUnit = (styleText: string, index: number): Unit => {
	if (styleText.charAt(index) === '&') {
		CHARACTER_REFERENCE.lastIndex = index;
		const match = CHARACTER_REFERENCE.exec(styleText);
		if (match !== null) {
			return { start: index, end: index + match[0].length, char: referenceChar(match) };
		}
	}
	return { start: index, end: index + 1, char: styleText.charAt(index) };
};

export const leadingWhitespaceLength = (text: string): number => {
	let length = 0;
	while (length < text.length && ASCII_WHITESPACE.has(text.charAt(length))) {
		length += 1;
	}
	return length;
};

export const trailingWhitespaceLength = (text: string): number => {
	let length = 0;
	while (length < text.length && ASCII_WHITESPACE.has(text.charAt(text.length - 1 - length))) {
		length += 1;
	}
	return length;
};

export const asciiTrim = (text: string): string => {
	const start = leadingWhitespaceLength(text);
	return text.slice(start, text.length - trailingWhitespaceLength(text.slice(start)));
};

export const asciiLowerCase = (text: string): string =>
	text.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());

type ScannedSegment = {
	start: number;
	end: number;
	separatorEnd: number;
	property?: string;
	valueStart?: number;
	valueEnd?: number;
};

type ScannedStyle = { segments: ScannedSegment[]; endsOpen: boolean };

const valueSpan = ({
	styleText,
	start,
	end,
}: {
	styleText: string;
	start: number;
	end: number;
}): { valueStart: number; valueEnd: number } => {
	const valueStart = start + leadingWhitespaceLength(styleText.slice(start, end));
	let valueEnd = end - trailingWhitespaceLength(styleText.slice(valueStart, end));
	const important = IMPORTANT_SUFFIX.exec(styleText.slice(valueStart, valueEnd));
	if (important !== null) {
		valueEnd = valueStart + important.index;
		valueEnd -= trailingWhitespaceLength(styleText.slice(valueStart, valueEnd));
	}
	return { valueStart, valueEnd };
};

// A `;` at bracket depth 0, outside strings and comments and not escaped, ends a declaration.
// ponytail: a string runs to its closing quote or the end; CSS also ends a bad string at a
// newline. Upgrade path: stop strings at a newline as CSS does.
const scanStyle = (styleText: string): ScannedStyle => {
	const segments: ScannedSegment[] = [];
	let segmentStart = 0;
	let colonEnd: number | undefined;
	let name = '';
	let depth = 0;
	let quote: string | undefined;
	let inComment = false;
	let escaped = false;
	let previousInComment = '';
	const endSegment = (end: number, separatorEnd: number): void => {
		const segment: ScannedSegment = { start: segmentStart, end, separatorEnd };
		if (colonEnd !== undefined) {
			segment.property = asciiLowerCase(asciiTrim(name));
			Object.assign(segment, valueSpan({ styleText, start: colonEnd, end }));
		}
		segments.push(segment);
		segmentStart = separatorEnd;
		colonEnd = undefined;
		name = '';
	};
	let index = 0;
	while (index < styleText.length) {
		const unit = readUnit(styleText, index);
		index = unit.end;
		if (escaped) {
			escaped = false;
		} else if (inComment) {
			if (previousInComment === '*' && unit.char === '/') {
				inComment = false;
			}
			previousInComment = unit.char;
		} else if (quote !== undefined) {
			if (unit.char === '\\') {
				escaped = true;
			} else if (unit.char === quote) {
				quote = undefined;
			}
		} else if (unit.char === '/' && readUnit(styleText, index).char === '*') {
			inComment = true;
			previousInComment = '';
			index = readUnit(styleText, index).end;
		} else {
			if (colonEnd === undefined && unit.char !== ':') {
				name += unit.char;
			}
			if (unit.char === '\\') {
				escaped = true;
			} else if (unit.char === '"' || unit.char === "'") {
				quote = unit.char;
			} else if (OPENERS.has(unit.char)) {
				depth += 1;
			} else if (CLOSERS.has(unit.char)) {
				depth = Math.max(0, depth - 1);
			} else if (depth === 0 && unit.char === ';') {
				endSegment(unit.start, unit.end);
			} else if (depth === 0 && unit.char === ':' && colonEnd === undefined) {
				colonEnd = unit.end;
			}
		}
	}
	endSegment(styleText.length, styleText.length);
	return { segments, endsOpen: escaped || inComment || quote !== undefined || depth > 0 };
};

export type StyleSegment = {
	text: string;
	// The raw separator (`;`, `&semi;`, `&#59;`, ...), or '' for the last segment.
	separator: string;
	// Decoded name before the first top-level `:`, trimmed and ASCII-lowercased; absent when the
	// segment has no such colon (malformed, empty, comment-only), so it never matches.
	property?: string;
	// Raw text after that colon and its leading whitespace, as typed (`!important`, comments and
	// trailing whitespace kept); present exactly when `property` is.
	value?: string;
};

// Every segment's `text + separator`, joined, gives back `styleText` exactly. `endsOpen` is true
// when the text ends inside a string, a comment, after a lone `\`, or inside a bracket.
export const splitStyleDeclarations = (
	styleText: string,
): { segments: StyleSegment[]; endsOpen: boolean } => {
	const { segments, endsOpen } = scanStyle(styleText);
	return {
		segments: segments.map(({ start, end, separatorEnd, property, valueStart }) => ({
			text: styleText.slice(start, end),
			separator: styleText.slice(end, separatorEnd),
			...(property === undefined || valueStart === undefined
				? {}
				: { property, value: styleText.slice(valueStart, end) }),
		})),
		endsOpen,
	};
};

// Removes every segment naming one of `properties`, each with its own separator. When no kept
// segment precedes a removed one, the next kept segment's leading whitespace goes too.
export const removeStyleProperties = (
	styleText: string,
	properties: ReadonlySet<string>,
): string => {
	let output = '';
	let keptAny = false;
	let removedFirst = false;
	for (const segment of scanStyle(styleText).segments) {
		if (segment.property !== undefined && properties.has(segment.property)) {
			removedFirst ||= !keptAny;
			continue;
		}
		const text = styleText.slice(segment.start, segment.separatorEnd);
		output += !keptAny && removedFirst ? text.slice(leadingWhitespaceLength(text)) : text;
		keptAny = true;
	}
	return output;
};

// What clearing a field removes: the field and the longhands it drops.
export const clearedProperties = (field: string): readonly string[] => [
	field,
	...(LONGHANDS.get(field) ?? []),
];

// An absent property gives back the input unchanged; an emptied attribute stays `style=""`.
export const removeStyleProperty = (styleText: string, property: string): string =>
	removeStyleProperties(styleText, new Set(clearedProperties(property)));

// undefined: the text ends inside a string, comment, escape or bracket, so an appended
// declaration would land inside it.
const appendDeclaration = (styleText: string, declaration: string): string | undefined => {
	const { segments, endsOpen } = scanStyle(styleText);
	if (endsOpen) {
		return undefined;
	}
	const contentEnd = styleText.length - trailingWhitespaceLength(styleText);
	const before = styleText.slice(0, contentEnd);
	const after = styleText.slice(contentEnd);
	if (contentEnd === 0) {
		return `${declaration}${styleText}`;
	}
	const last = segments.at(-1);
	const endsWithSeparator =
		segments.length > 1 && last !== undefined && asciiTrim(styleText.slice(last.start)) === '';
	if (endsWithSeparator) {
		return `${before} ${declaration};${after}`;
	}
	// A reference left without its `;` (`A&copy`, `x&#38`) would take ours and swallow the
	// separator, so a space ends it first.
	const separator = UNTERMINATED_REFERENCE.test(before) ? ' ;' : ';';
	return `${before}${separator} ${declaration}${after}`;
};

const lastIndexOfProperty = (segments: ScannedSegment[], property: string): number => {
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		if (segments[index]?.property === property) {
			return index;
		}
	}
	return -1;
};

// `value` must already pass normalizeStyleValue. The last occurrence's value changes in place,
// keeping its spacing and `!important`; otherwise one declaration is appended. A shorthand then
// drops its longhands. undefined: the value would be appended onto text that ends open.
// ponytail: earlier duplicates stay, so an earlier `!important` duplicate still wins in the
// browser. Upgrade path: drop earlier duplicates on set.
// ponytail: a field moved to the end past a later parent (font-size before `font`, border-color
// before `border-top`, ...) loses its own `!important`, and a parent marked `!important` still
// wins after the move. Upgrade path: keep the flag on move and compare importance.
export const setStyleProperty = ({
	styleText,
	property,
	value,
}: {
	styleText: string;
	property: string;
	value: string;
}): string | undefined => {
	const { segments } = scanStyle(styleText);
	const lastIndex = lastIndexOfProperty(segments, property);
	const parents = PARENTS.get(property) ?? [];
	const overridden =
		lastIndex >= 0 &&
		segments
			.slice(lastIndex + 1)
			.some((segment) => segment.property !== undefined && parents.includes(segment.property));
	const target = overridden ? undefined : segments[lastIndex];
	const declaration = `${property}: ${value}`;
	let updated: string | undefined;
	if (target?.valueStart !== undefined && target.valueEnd !== undefined) {
		updated = `${styleText.slice(0, target.valueStart)}${value}${styleText.slice(target.valueEnd)}`;
	} else {
		const base = overridden ? removeStyleProperties(styleText, new Set([property])) : styleText;
		updated = appendDeclaration(base, declaration);
	}
	const longhands = LONGHANDS.get(property);
	return updated === undefined || longhands === undefined
		? updated
		: removeStyleProperties(updated, new Set(longhands));
};
