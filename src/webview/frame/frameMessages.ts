// Frame ↔ chrome message contract. Pure constants and guards, no DOM types: the export
// (src/disk/handoffCanvasHtml.ts) imports this under the root tsconfig, which has no DOM lib.

import {
	COMMENT_STYLE_KEYS,
	MAX_FRAME_COORDINATE,
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

// Frame-local CSS px (the frame's client coordinates).
export type FrameRect = { x: number; y: number; width: number; height: number };

export type FrameMode = 'interact' | 'comment';

export type CommentStyles = Partial<Record<(typeof COMMENT_STYLE_KEYS)[number], string>>;

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
};

// The mode keys, forwarded so they work with focus inside a frame.
type FrameKeyMessage = { type: typeof FRAME_KEY_MESSAGE; key: 'c' | 'Escape' };

export type FrameMessage =
	| FrameHeightMessage
	| FrameWheelMessage
	| FrameReadyMessage
	| FrameHoverMessage
	| FramePickMessage
	| FrameKeyMessage;

export type ChromeFrameMessage =
	| { type: typeof FRAME_MODE_MESSAGE; mode: FrameMode }
	| { type: typeof PICK_PARENT_MESSAGE }
	| { type: typeof PICK_CHILD_MESSAGE };

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const isCoordinate = (value: unknown): value is number =>
	isFiniteNumber(value) && Math.abs(value) <= MAX_FRAME_COORDINATE;

// Longest element tag name a frame may report in cd:pick.
const MAX_TAG_NAME_CHARS = 64;

const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export const isTagName = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_TAG_NAME_CHARS && TAG_NAME_PATTERN.test(value);

// Control characters (C0, DEL, C1, so newline, carriage return and tab) and the Unicode line and
// paragraph separators: anything that could break a line in an Agent prompt.
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;

export const hasControlChars = (value: string): boolean => CONTROL_CHARS.test(value);

// Letters and digits in any script (CJK font names), plus a short punctuation list. A plain
// space, not \s, so no newline or tab passes; at least one non-space character.
const STYLE_VALUE_PATTERN = /^(?=.*[^ ])[\p{L}\p{N}_ #%.,()'"/+-]+$/u;

export const isSafeStyleValue = (value: string): boolean =>
	value.length <= MAX_STYLE_VALUE_CHARS && STYLE_VALUE_PATTERN.test(value);

const asRecord = (data: unknown): Record<string, unknown> | undefined =>
	data === null || typeof data !== 'object' ? undefined : (data as Record<string, unknown>);

// Also guards the rects in comments:updated (hostMessages.ts).
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

// `null` is a valid "no selector"; undefined means the guard failed.
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

const parseFramePick = (record: Record<string, unknown>): FramePickMessage | undefined => {
	const { tagName, text, isPage, repost } = record;
	const rect = parseNullableRect(record.rect);
	const selector = parseSelector(record.selector);
	const point = parsePoint(record.point);
	const box = parseBox(record.box);
	const styles = parseStyles(record.styles);
	if (!isTagName(tagName) || rect === undefined || typeof isPage !== 'boolean') {
		return undefined;
	}
	if (box === undefined || typeof repost !== 'boolean') {
		return undefined;
	}
	if (selector === undefined || !isPickText(text) || point === undefined || styles === undefined) {
		return undefined;
	}
	// A page pick is labelled body (8e locates it by point inside the documentElement box).
	if (isPage && (selector !== 'body' || tagName !== 'body')) {
		return undefined;
	}
	return {
		type: FRAME_PICK_MESSAGE,
		selector,
		tagName,
		text,
		rect,
		point,
		box,
		styles,
		isPage,
		repost,
	};
};

// Frame → chrome posts are untrusted (rule 02). The bridge has already matched event.source
// to a live frame; this only checks the payload and rebuilds it, dropping extra fields.
// Anything else returns undefined.
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
			return record.key === 'c' || record.key === 'Escape'
				? { type: FRAME_KEY_MESSAGE, key: record.key }
				: undefined;
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
			return record.mode === 'interact' || record.mode === 'comment'
				? { type: FRAME_MODE_MESSAGE, mode: record.mode }
				: undefined;
		case PICK_PARENT_MESSAGE:
			return { type: PICK_PARENT_MESSAGE };
		case PICK_CHILD_MESSAGE:
			return { type: PICK_CHILD_MESSAGE };
		default:
			return undefined;
	}
};
