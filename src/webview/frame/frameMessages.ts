// Frame ↔ chrome message contract. Pure constants and guards, no DOM types: the export
// (src/disk/handoffCanvasHtml.ts) imports this under the root tsconfig, which has no DOM lib.

import { MAX_FRAME_COORDINATE, MAX_TAG_NAME_CHARS } from '../../disk/layout';

export const CANVAS_RUNTIME_ATTRIBUTE = 'data-cd-canvas-runtime';

export const FRAME_WHEEL_MESSAGE = 'cd:frame-wheel';

export const FRAME_HEIGHT_MESSAGE = 'cd:frame-height';

export const FRAME_READY_MESSAGE = 'cd:ready';

export const FRAME_HOVER_MESSAGE = 'cd:hover';

export const FRAME_PICK_MESSAGE = 'cd:pick';

export const FRAME_MODE_MESSAGE = 'cd:mode';

export const PICK_PARENT_MESSAGE = 'cd:pick-parent';

export const PICK_CHILD_MESSAGE = 'cd:pick-child';

// Frame-local CSS px (the frame's client coordinates).
export type FrameRect = { x: number; y: number; width: number; height: number };

export type FrameMode = 'interact' | 'comment';

export type FrameHeightMessage = { type: typeof FRAME_HEIGHT_MESSAGE; height: number };

export type FrameWheelMessage = {
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
	tagName: string;
	rect: FrameRect | null;
	isPage: boolean;
};

export type FrameMessage =
	| FrameHeightMessage
	| FrameWheelMessage
	| FrameReadyMessage
	| FrameHoverMessage
	| FramePickMessage;

export type ChromeFrameMessage =
	| { type: typeof FRAME_MODE_MESSAGE; mode: FrameMode }
	| { type: typeof PICK_PARENT_MESSAGE }
	| { type: typeof PICK_CHILD_MESSAGE };

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const isCoordinate = (value: unknown): value is number =>
	isFiniteNumber(value) && Math.abs(value) <= MAX_FRAME_COORDINATE;

const TAG_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

const isTagName = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= MAX_TAG_NAME_CHARS && TAG_NAME_PATTERN.test(value);

const asRecord = (data: unknown): Record<string, unknown> | undefined =>
	data === null || typeof data !== 'object' ? undefined : (data as Record<string, unknown>);

const parseFrameRect = (value: unknown): FrameRect | undefined => {
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

const parseFramePick = (record: Record<string, unknown>): FramePickMessage | undefined => {
	const { tagName, isPage } = record;
	const rect = parseNullableRect(record.rect);
	if (!isTagName(tagName) || rect === undefined || typeof isPage !== 'boolean') {
		return undefined;
	}
	return { type: FRAME_PICK_MESSAGE, tagName, rect, isPage };
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
