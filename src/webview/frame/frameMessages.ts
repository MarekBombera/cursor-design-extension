// Frame ↔ chrome message contract. Pure constants and guards, no DOM types: the export
// (src/disk/handoffCanvasHtml.ts) imports this under the root tsconfig, which has no DOM lib.

export const CANVAS_RUNTIME_ATTRIBUTE = 'data-cd-canvas-runtime';

export const FRAME_WHEEL_MESSAGE = 'cd:frame-wheel';

export const FRAME_HEIGHT_MESSAGE = 'cd:frame-height';

export type FrameHeightMessage = { type: typeof FRAME_HEIGHT_MESSAGE; height: number };

export type FrameWheelMessage = {
	type: typeof FRAME_WHEEL_MESSAGE;
	deltaX: number;
	deltaY: number;
	ctrlKey: boolean;
	x: number;
	y: number;
};

export type FrameMessage = FrameHeightMessage | FrameWheelMessage;

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

// Frame → chrome posts are untrusted (rule 02). The bridge has already matched event.source
// to a live frame; this only checks the payload. Anything else returns undefined.
export const parseFrameMessage = (data: unknown): FrameMessage | undefined => {
	if (data === null || typeof data !== 'object') {
		return undefined;
	}
	const record = data as Record<string, unknown>;
	if (record.type === FRAME_HEIGHT_MESSAGE) {
		return isFiniteNumber(record.height)
			? { type: FRAME_HEIGHT_MESSAGE, height: record.height }
			: undefined;
	}
	if (record.type !== FRAME_WHEEL_MESSAGE) {
		return undefined;
	}
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
