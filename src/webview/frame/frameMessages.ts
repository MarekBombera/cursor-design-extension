// No DOM types: the disk and host code import this under the root tsconfig, which has no DOM lib.

import {
	COMMENT_ID_PATTERN,
	COMMENT_STYLE_KEYS,
	type EDIT_STYLE_FIELDS,
	MAX_COMMENTS,
	MAX_EDIT_TEXT_CHARS,
	MAX_FRAME_COORDINATE,
	MAX_PICK_STYLE_CHARS,
	MAX_PICK_TEXT_CHARS,
	MAX_SELECTOR_CHARS,
	MAX_STYLE_VALUE_CHARS,
} from '../../disk/layout';

export const CANVAS_RUNTIME_ATTRIBUTE = 'data-cd-canvas-runtime';

export const FRAME_WHEEL_MESSAGE = 'cd:frame-wheel';

export const FRAME_HEIGHT_MESSAGE = 'cd:frame-height';

export const FRAME_READY_MESSAGE = 'cd:ready';

export const FRAME_HOVER_MESSAGE = 'cd:hover';

export const FRAME_PICK_MESSAGE = 'cd:pick';

export const FRAME_KEY_MESSAGE = 'cd:key';

export const FRAME_MODE_MESSAGE = 'cd:mode';

export const PICK_PARENT_MESSAGE = 'cd:pick-parent';

export const PICK_CHILD_MESSAGE = 'cd:pick-child';

// Chrome → frame, Edit mode only: preview one element's whole text node or style attribute.
export const EDIT_APPLY_MESSAGE = 'cd:edit-apply';

// Chrome → frame, Edit mode only: re-describe the current pick and re-post it.
export const PICK_REFRESH_MESSAGE = 'cd:pick-refresh';

// Chrome → frame: the element comments of this frame to measure for pins.
export const FRAME_ANCHORS_MESSAGE = 'cd:anchors';

// Frame → chrome: where those comments' targets are now.
export const FRAME_ANCHOR_RECTS_MESSAGE = 'cd:anchor-rects';

// Frame-local CSS px (the frame's client coordinates).
export type FrameRect = { x: number; y: number; width: number; height: number };

export const FRAME_MODES = ['interact', 'comment', 'edit'] as const;

export type FrameMode = (typeof FRAME_MODES)[number];

export const isFrameMode = (value: unknown): value is FrameMode =>
	(FRAME_MODES as readonly unknown[]).includes(value);

export type CommentStyles = Partial<Record<(typeof COMMENT_STYLE_KEYS)[number], string>>;

export type EditStyleField = (typeof EDIT_STYLE_FIELDS)[number];

const PICK_TEXT_STATES = ['plain', 'children', 'too-long'] as const;

// The computed values are the pick's own `styles`.
export type PickEditFields = {
	// The target's data-cd-src as a canonical non-negative integer; null when absent, malformed or
	// the target is disconnected.
	sourceNumber: number | null;
	// Another element in the target's document carries the same number (a script cloned it).
	sharedNumber: boolean;
	// 'plain': no child nodes or exactly one text node; 'children': anything else; 'too-long':
	// plain, but over MAX_EDIT_TEXT_CHARS.
	textState: (typeof PICK_TEXT_STATES)[number];
	// The text node's full, unmodified data iff 'plain'; '' otherwise.
	text: string;
	// The style attribute as the live page holds it: '' when absent, null only over
	// MAX_PICK_STYLE_CHARS.
	style: string | null;
};

type FrameHeightMessage = { type: typeof FRAME_HEIGHT_MESSAGE; height: number };

type FrameWheelMessage = {
	type: typeof FRAME_WHEEL_MESSAGE;
	deltaX: number;
	deltaY: number;
	ctrlKey: boolean;
	x: number;
	y: number;
};

export type FrameReadyMessage = { type: typeof FRAME_READY_MESSAGE };

export type FrameHoverMessage = { type: typeof FRAME_HOVER_MESSAGE; rect: FrameRect | null };

export type FramePickMessage = {
	type: typeof FRAME_PICK_MESSAGE;
	// null: no unique selector within the cap, or a disconnected target.
	selector: string | null;
	tagName: string;
	text: string;
	rect: FrameRect | null;
	// CSS px relative to the current target's unclipped border box.
	point: { x: number; y: number };
	// That unclipped border box's size, so the pin fraction is right for a clipped target.
	box: { width: number; height: number };
	styles: CommentStyles;
	isPage: boolean;
	// True for a scroll or resize re-post of the same pick; false for a click or ↑/↓ step.
	repost: boolean;
	// Present iff the frame is in Edit mode.
	edit?: PickEditFields;
};

// The keys a frame forwards so they work with focus inside it: the mode keys C and Escape, and
// undo / redo for Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
const FRAME_KEYS = ['c', 'Escape', 'undo', 'redo'] as const;

export type FrameKey = (typeof FRAME_KEYS)[number];

const isFrameKey = (value: unknown): value is FrameKey =>
	(FRAME_KEYS as readonly unknown[]).includes(value);

type FrameKeyMessage = { type: typeof FRAME_KEY_MESSAGE; key: FrameKey };

export type AnchorRequest = { id: string; selector: string };

// `box`: the target's unclipped border box; null when the selector matched 0 or 2+ elements or
// threw. `visible`: that box after visibleRect's clipping; null when fully clipped, zero-area, or
// `box` is null.
export type AnchorRect = { id: string; box: FrameRect | null; visible: FrameRect | null };

type FrameAnchorsMessage = { type: typeof FRAME_ANCHORS_MESSAGE; anchors: AnchorRequest[] };

// Live preview: exactly one of `text` (the element's whole new text node) or `style` (its whole
// new style attribute). Display only: nothing reaches disk from it.
export type EditApplyMessage =
	| { type: typeof EDIT_APPLY_MESSAGE; sourceNumber: number; text: string }
	| { type: typeof EDIT_APPLY_MESSAGE; sourceNumber: number; style: string };

type FrameAnchorRectsMessage = {
	type: typeof FRAME_ANCHOR_RECTS_MESSAGE;
	anchors: AnchorRect[];
};

export type FrameMessage =
	| FrameHeightMessage
	| FrameWheelMessage
	| FrameReadyMessage
	| FrameHoverMessage
	| FramePickMessage
	| FrameKeyMessage
	| FrameAnchorRectsMessage;

export type ChromeFrameMessage =
	| { type: typeof FRAME_MODE_MESSAGE; mode: FrameMode }
	| { type: typeof PICK_PARENT_MESSAGE }
	| { type: typeof PICK_CHILD_MESSAGE }
	| { type: typeof PICK_REFRESH_MESSAGE }
	| EditApplyMessage
	| FrameAnchorsMessage;

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const isCoordinate = (value: unknown): value is number =>
	isFiniteNumber(value) && Math.abs(value) <= MAX_FRAME_COORDINATE;

const MAX_TAG_NAME_CHARS = 64;

const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export const isTagName = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_TAG_NAME_CHARS && TAG_NAME_PATTERN.test(value);

// Control characters (C0, DEL, C1, so newline, carriage return and tab) and the Unicode line and
// paragraph separators: anything that could break a line in an Agent prompt.
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;

export const hasControlChars = (value: string): boolean => CONTROL_CHARS.test(value);

// Must cover every line breaker CONTROL_CHARS does (\s covers U+2028 / U+2029), plus format
// characters (bidi overrides such as U+202E) that would visually reorder a pasted prompt.
const ONE_LINE_BREAKERS = /[\p{Cc}\p{Cf}\s]+/gu;

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

// One Agent-prompt line of at most `cap` UTF-16 units; a cut never leaves a lone high surrogate.
export const toOneLine = (value: string, cap: number): string => {
	const collapsed = value.replace(ONE_LINE_BREAKERS, ' ').trim();
	const cut = collapsed.slice(0, cap);
	const whole = isHighSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
	return whole.trimEnd();
};

// Letters and digits in any script (CJK font names), plus a short punctuation list. A plain
// space, not \s, so no newline or tab passes; at least one non-space character.
const STYLE_VALUE_PATTERN = /^(?=.*[^ ])[\p{L}\p{N}_ #%.,()'"/+-]+$/u;

export const isSafeStyleValue = (value: string): boolean =>
	value.length <= MAX_STYLE_VALUE_CHARS && STYLE_VALUE_PATTERN.test(value);

const asRecord = (data: unknown): Record<string, unknown> | undefined =>
	data === null || typeof data !== 'object' ? undefined : (data as Record<string, unknown>);

export const parseFrameRect = (value: unknown): FrameRect | undefined => {
	const record = asRecord(value);
	if (record === undefined) {
		return undefined;
	}
	const { x, y, width, height } = record;
	if (
		!isCoordinate(x) ||
		!isCoordinate(y) ||
		!isCoordinate(width) ||
		!isCoordinate(height) ||
		0 > width ||
		0 > height
	) {
		return undefined;
	}
	return { x, y, width, height };
};

// `null` is a valid "no rect"; undefined means the guard failed.
const parseNullableRect = (value: unknown): FrameRect | null | undefined =>
	value === null ? null : parseFrameRect(value);

const parseFrameWheel = (record: Record<string, unknown>): FrameWheelMessage | undefined => {
	const { deltaX, deltaY, ctrlKey, x, y } = record;
	if (
		!isFiniteNumber(deltaX) ||
		!isFiniteNumber(deltaY) ||
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		typeof ctrlKey !== 'boolean'
	) {
		return undefined;
	}
	return { type: FRAME_WHEEL_MESSAGE, deltaX, deltaY, ctrlKey, x, y };
};

const parseSelector = (value: unknown): string | null | undefined => {
	if (value === null) {
		return null;
	}
	return typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_SELECTOR_CHARS &&
		!hasControlChars(value)
		? value
		: undefined;
};

const isPickText = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_PICK_TEXT_CHARS && !hasControlChars(value);

const isPointCoordinate = (value: unknown): value is number =>
	isFiniteNumber(value) && value >= 0 && value <= MAX_FRAME_COORDINATE;

const parsePoint = (value: unknown): { x: number; y: number } | undefined => {
	const record = asRecord(value);
	if (record === undefined || !isPointCoordinate(record.x) || !isPointCoordinate(record.y)) {
		return undefined;
	}
	return { x: record.x, y: record.y };
};

const parseBox = (value: unknown): { width: number; height: number } | undefined => {
	const record = asRecord(value);
	if (
		record === undefined ||
		!isPointCoordinate(record.width) ||
		!isPointCoordinate(record.height)
	) {
		return undefined;
	}
	return { width: record.width, height: record.height };
};

const isStyleKey = (key: string): key is (typeof COMMENT_STYLE_KEYS)[number] =>
	(COMMENT_STYLE_KEYS as readonly string[]).includes(key);

// One bad key or value rejects the whole map; the runtime never produces one.
const parseStyles = (value: unknown): CommentStyles | undefined => {
	const record = asRecord(value);
	if (record === undefined || Array.isArray(value)) {
		return undefined;
	}
	const styles: CommentStyles = {};
	for (const [key, style] of Object.entries(record)) {
		if (!isStyleKey(key) || typeof style !== 'string' || !isSafeStyleValue(style)) {
			return undefined;
		}
		styles[key] = style;
	}
	return styles;
};

// cd:pick and a saved comment draft share these guards.
export const parsePickFields = (
	record: Record<string, unknown>,
): Omit<FramePickMessage, 'type' | 'repost' | 'edit'> | undefined => {
	const { tagName, text, isPage } = record;
	const rect = parseNullableRect(record.rect);
	const selector = parseSelector(record.selector);
	const point = parsePoint(record.point);
	const box = parseBox(record.box);
	const styles = parseStyles(record.styles);
	if (!isTagName(tagName) || rect === undefined || typeof isPage !== 'boolean') {
		return undefined;
	}
	if (box === undefined) {
		return undefined;
	}
	if (selector === undefined || !isPickText(text) || point === undefined || styles === undefined) {
		return undefined;
	}
	// A page pick is labelled body; its pin comes from `point`, never the selector.
	if (isPage && (selector !== 'body' || tagName !== 'body')) {
		return undefined;
	}
	return { selector, tagName, text, rect, point, box, styles, isPage };
};

// The host's artboard:edit takes the same range (chromeMessages.ts).
const isSourceNumber = (value: unknown): value is number | null =>
	value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);

const parseEditApply = (record: Record<string, unknown>): EditApplyMessage | undefined => {
	const { sourceNumber, text, style } = record;
	if (!isSourceNumber(sourceNumber) || sourceNumber === null) {
		return undefined;
	}
	if (typeof text === 'string' && style === undefined && text.length <= MAX_EDIT_TEXT_CHARS) {
		return { type: EDIT_APPLY_MESSAGE, sourceNumber, text };
	}
	if (typeof style === 'string' && text === undefined && style.length <= MAX_PICK_STYLE_CHARS) {
		return { type: EDIT_APPLY_MESSAGE, sourceNumber, style };
	}
	return undefined;
};

const isPickTextState = (value: unknown): value is PickEditFields['textState'] =>
	(PICK_TEXT_STATES as readonly unknown[]).includes(value);

// Rebuilt, so extra keys are dropped. `text` and `style` may hold control characters: both are
// the page's own text, shown only as field values and never put in an Agent prompt.
const parsePickEdit = (value: unknown): PickEditFields | undefined => {
	const record = asRecord(value);
	if (record === undefined || Array.isArray(value)) {
		return undefined;
	}
	const { sourceNumber, sharedNumber, textState, text, style } = record;
	if (
		!isSourceNumber(sourceNumber) ||
		typeof sharedNumber !== 'boolean' ||
		(sharedNumber && sourceNumber === null) ||
		!isPickTextState(textState) ||
		typeof text !== 'string' ||
		text.length > MAX_EDIT_TEXT_CHARS ||
		(textState !== 'plain' && text !== '') ||
		(style !== null && (typeof style !== 'string' || style.length > MAX_PICK_STYLE_CHARS))
	) {
		return undefined;
	}
	return { sourceNumber, sharedNumber, textState, text, style };
};

const parseFramePick = (record: Record<string, unknown>): FramePickMessage | undefined => {
	const fields = parsePickFields(record);
	if (fields === undefined || typeof record.repost !== 'boolean') {
		return undefined;
	}
	if (record.edit === undefined) {
		return { type: FRAME_PICK_MESSAGE, ...fields, repost: record.repost };
	}
	const edit = parsePickEdit(record.edit);
	return edit === undefined
		? undefined
		: { type: FRAME_PICK_MESSAGE, ...fields, repost: record.repost, edit };
};

// At most MAX_COMMENTS entries; one bad entry rejects the whole list. Entries are rebuilt, so
// extra fields are dropped and an id like `__proto__` stays a plain string value.
const parseAnchorList = <Entry>(
	value: unknown,
	parseEntry: (record: Record<string, unknown>) => Entry | undefined,
): Entry[] | undefined => {
	if (!Array.isArray(value) || value.length > MAX_COMMENTS) {
		return undefined;
	}
	const entries: Entry[] = [];
	for (const entry of value as unknown[]) {
		const record = asRecord(entry);
		const parsed = record === undefined ? undefined : parseEntry(record);
		if (parsed === undefined) {
			return undefined;
		}
		entries.push(parsed);
	}
	return entries;
};

const isCommentId = (value: unknown): value is string =>
	typeof value === 'string' && COMMENT_ID_PATTERN.test(value);

const parseAnchorRequest = (record: Record<string, unknown>): AnchorRequest | undefined => {
	const selector = parseSelector(record.selector);
	return isCommentId(record.id) && typeof selector === 'string'
		? { id: record.id, selector }
		: undefined;
};

const parseAnchorRect = (record: Record<string, unknown>): AnchorRect | undefined => {
	const box = parseNullableRect(record.box);
	const visible = parseNullableRect(record.visible);
	if (!isCommentId(record.id) || box === undefined || visible === undefined) {
		return undefined;
	}
	// A target that does not resolve cannot be visible.
	return box === null && visible !== null ? undefined : { id: record.id, box, visible };
};

// Untrusted. The bridge already matched event.source to a live frame; this checks and rebuilds the
// payload, dropping extra fields.
export const parseFrameMessage = (data: unknown): FrameMessage | undefined => {
	const record = asRecord(data);
	if (record === undefined) {
		return undefined;
	}
	switch (record.type) {
		case FRAME_HEIGHT_MESSAGE:
			return isFiniteNumber(record.height)
				? { type: FRAME_HEIGHT_MESSAGE, height: record.height }
				: undefined;
		case FRAME_WHEEL_MESSAGE:
			return parseFrameWheel(record);
		case FRAME_READY_MESSAGE:
			return { type: FRAME_READY_MESSAGE };
		case FRAME_HOVER_MESSAGE: {
			const rect = parseNullableRect(record.rect);
			return rect === undefined ? undefined : { type: FRAME_HOVER_MESSAGE, rect };
		}
		case FRAME_PICK_MESSAGE:
			return parseFramePick(record);
		case FRAME_KEY_MESSAGE:
			return isFrameKey(record.key) ? { type: FRAME_KEY_MESSAGE, key: record.key } : undefined;
		case FRAME_ANCHOR_RECTS_MESSAGE: {
			const anchors = parseAnchorList(record.anchors, parseAnchorRect);
			return anchors === undefined ? undefined : { type: FRAME_ANCHOR_RECTS_MESSAGE, anchors };
		}
		default:
			return undefined;
	}
};

// Chrome → frame, checked by the runtime after it matched event.source to its captured parent.
export const parseChromeFrameMessage = (data: unknown): ChromeFrameMessage | undefined => {
	const record = asRecord(data);
	if (record === undefined) {
		return undefined;
	}
	switch (record.type) {
		case FRAME_MODE_MESSAGE:
			return isFrameMode(record.mode) ? { type: FRAME_MODE_MESSAGE, mode: record.mode } : undefined;
		case PICK_PARENT_MESSAGE:
			return { type: PICK_PARENT_MESSAGE };
		case PICK_CHILD_MESSAGE:
			return { type: PICK_CHILD_MESSAGE };
		case PICK_REFRESH_MESSAGE:
			return { type: PICK_REFRESH_MESSAGE };
		case EDIT_APPLY_MESSAGE:
			return parseEditApply(record);
		case FRAME_ANCHORS_MESSAGE: {
			const anchors = parseAnchorList(record.anchors, parseAnchorRequest);
			return anchors === undefined ? undefined : { type: FRAME_ANCHORS_MESSAGE, anchors };
		}
		default:
			return undefined;
	}
};
