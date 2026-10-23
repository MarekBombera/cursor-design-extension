// Pure stage math for the chrome and, through `?iife`, the exported canvas.html. Every function
// takes one object and returns new values, with no DOM and nothing global except Math.
// View { x, y, zoom } maps stage px to screen px: screen = stage * zoom + (x, y), which is
// CSS translate(x, y) scale(zoom) with transform-origin 0 0.

import { MAX_FRAME_COORDINATE, MAX_FRAME_WIDTH, MIN_FRAME_WIDTH } from '../disk/layout';
import type { FramePlacement } from './hostMessages';

export type StageView = { x: number; y: number; zoom: number };

export type StagePoint = { x: number; y: number };

export type StageRect = { x: number; y: number; width: number; height: number };

export type ChromeFrame = StageRect & { id: string; group?: string };

export type FrameLabelBox = StageRect & { id: string };

export type GroupHeadingBox = StageRect & { group: string };

export type CanvasChromeLayout = {
	labels: FrameLabelBox[];
	headings: GroupHeadingBox[];
	bounds: StageRect | null;
};

export type FrameHeightGuard = { lastGrowth: number; frozen: boolean };

export const MIN_STAGE_ZOOM = 0.05;
export const MAX_STAGE_ZOOM = 10;
const ZOOM_STEP_CAP = 0.2;
const ZOOM_SENSITIVITY = 0.01;
const FIT_PADDING = 48;
const KEEP_VISIBLE = 48;

const clampNumber = ({ value, min, max }: { value: number; min: number; max: number }): number =>
	Math.min(max, Math.max(min, value));

const clampStageZoom = ({ zoom }: { zoom: number }): number =>
	clampNumber({ value: zoom, min: MIN_STAGE_ZOOM, max: MAX_STAGE_ZOOM });

export const stageToScreen = ({
	view,
	stageX,
	stageY,
}: {
	view: StageView;
	stageX: number;
	stageY: number;
}): StagePoint => ({
	x: stageX * view.zoom + view.x,
	y: stageY * view.zoom + view.y,
});

// A frame-local rect (CSS px inside the frame at stage `frame`) to viewport-local screen px.
export const frameRectToScreen = ({
	view,
	frame,
	rect,
}: {
	view: StageView;
	frame: StagePoint;
	rect: StageRect;
}): StageRect => {
	const origin = stageToScreen({ view, stageX: frame.x + rect.x, stageY: frame.y + rect.y });
	return {
		x: origin.x,
		y: origin.y,
		width: rect.width * view.zoom,
		height: rect.height * view.zoom,
	};
};

export const screenToStage = ({
	view,
	screenX,
	screenY,
}: {
	view: StageView;
	screenX: number;
	screenY: number;
}): StagePoint => ({
	x: (screenX - view.x) / view.zoom,
	y: (screenY - view.y) / view.zoom,
});

export const zoomStageTo = ({
	view,
	zoom: targetZoom,
	screenX,
	screenY,
}: {
	view: StageView;
	zoom: number;
	screenX: number;
	screenY: number;
}): StageView => {
	const fromZoom = clampStageZoom({ zoom: view.zoom });
	const zoom = clampStageZoom({ zoom: targetZoom });
	return {
		x: screenX - ((screenX - view.x) * zoom) / fromZoom,
		y: screenY - ((screenY - view.y) * zoom) / fromZoom,
		zoom,
	};
};

export const zoomStageAt = ({
	view,
	deltaY,
	screenX,
	screenY,
}: {
	view: StageView;
	deltaY: number;
	screenX: number;
	screenY: number;
}): StageView => {
	const step = clampNumber({
		value: -deltaY * ZOOM_SENSITIVITY,
		min: -ZOOM_STEP_CAP,
		max: ZOOM_STEP_CAP,
	});
	return zoomStageTo({
		view,
		zoom: clampStageZoom({ zoom: view.zoom }) * Math.exp(step),
		screenX,
		screenY,
	});
};

export const panStage = ({
	view,
	deltaX,
	deltaY,
}: {
	view: StageView;
	deltaX: number;
	deltaY: number;
}): StageView => ({
	x: view.x - deltaX,
	y: view.y - deltaY,
	zoom: view.zoom,
});

export const frameBounds = ({ frames }: { frames: readonly StageRect[] }): StageRect | null => {
	const [first] = frames;
	if (first === undefined) {
		return null;
	}
	let left = first.x;
	let top = first.y;
	let right = first.x + first.width;
	let bottom = first.y + first.height;
	for (const frame of frames) {
		left = Math.min(left, frame.x);
		top = Math.min(top, frame.y);
		right = Math.max(right, frame.x + frame.width);
		bottom = Math.max(bottom, frame.y + frame.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
};

const FRAME_LABEL_BAND = 24;
const GROUP_HEADING_BAND = 32;

type HeadingAccumulator = { group: string; minX: number; minY: number; maxRight: number };

export const layoutCanvasChrome = ({
	frames,
}: {
	frames: readonly ChromeFrame[];
}): CanvasChromeLayout => {
	const labels: FrameLabelBox[] = [];
	const headingAcc: HeadingAccumulator[] = [];
	for (const frame of frames) {
		labels.push({
			id: frame.id,
			x: frame.x,
			y: frame.y - FRAME_LABEL_BAND,
			width: frame.width,
			height: FRAME_LABEL_BAND,
		});
		if (typeof frame.group !== 'string' || frame.group.length === 0) {
			continue;
		}
		const found = headingAcc.find((entry) => entry.group === frame.group);
		if (found === undefined) {
			headingAcc.push({
				group: frame.group,
				minX: frame.x,
				minY: frame.y,
				maxRight: frame.x + frame.width,
			});
			continue;
		}
		if (found.minX > frame.x) {
			found.minX = frame.x;
		}
		if (found.minY > frame.y) {
			found.minY = frame.y;
		}
		if (frame.x + frame.width > found.maxRight) {
			found.maxRight = frame.x + frame.width;
		}
	}
	const headings: GroupHeadingBox[] = headingAcc.map((entry) => ({
		group: entry.group,
		x: entry.minX,
		y: entry.minY - FRAME_LABEL_BAND - GROUP_HEADING_BAND,
		width: entry.maxRight - entry.minX,
		height: GROUP_HEADING_BAND,
	}));
	const boxes: StageRect[] = [...frames, ...labels, ...headings].map(({ x, y, width, height }) => ({
		x,
		y,
		width,
		height,
	}));
	return { labels, headings, bounds: frameBounds({ frames: boxes }) };
};

const MIN_FRAME_HEIGHT = 1;
const MAX_FRAME_HEIGHT = 20000;

export const nextFrameHeight = ({
	current,
	reported,
	state,
}: {
	current: number;
	reported: number;
	state: FrameHeightGuard;
}): { height: number; state: FrameHeightGuard } => {
	if (!Number.isFinite(reported)) {
		return { height: current, state };
	}
	const clamped = clampNumber({ value: reported, min: MIN_FRAME_HEIGHT, max: MAX_FRAME_HEIGHT });
	const growth = clamped - current;
	if (0 >= growth) {
		return { height: clamped, state: { lastGrowth: 0, frozen: state.frozen } };
	}
	if (state.frozen) {
		return { height: current, state };
	}
	if (state.lastGrowth > 0 && 1 >= Math.abs(growth - state.lastGrowth)) {
		return { height: current, state: { lastGrowth: state.lastGrowth, frozen: true } };
	}
	return { height: clamped, state: { lastGrowth: growth, frozen: state.frozen } };
};

const clampStageAxis = ({
	offset,
	start,
	size,
	zoom,
	viewportSize,
}: {
	offset: number;
	start: number;
	size: number;
	zoom: number;
	viewportSize: number;
}): number => {
	const scaledSize = size * zoom;
	const keep = Math.min(KEEP_VISIBLE, scaledSize, viewportSize);
	return clampNumber({
		value: offset,
		min: keep - scaledSize - start * zoom,
		max: viewportSize - keep - start * zoom,
	});
};

export const clampStageView = ({
	view,
	bounds,
	viewportWidth,
	viewportHeight,
}: {
	view: StageView;
	bounds: StageRect | null;
	viewportWidth: number;
	viewportHeight: number;
}): StageView => {
	const zoom = clampStageZoom({ zoom: view.zoom });
	if (bounds === null || viewportWidth <= 0 || viewportHeight <= 0) {
		return { x: view.x, y: view.y, zoom };
	}
	return {
		x: clampStageAxis({
			offset: view.x,
			start: bounds.x,
			size: bounds.width,
			zoom,
			viewportSize: viewportWidth,
		}),
		y: clampStageAxis({
			offset: view.y,
			start: bounds.y,
			size: bounds.height,
			zoom,
			viewportSize: viewportHeight,
		}),
		zoom,
	};
};

export const fitStageView = ({
	bounds,
	viewportWidth,
	viewportHeight,
}: {
	bounds: StageRect | null;
	viewportWidth: number;
	viewportHeight: number;
}): StageView => {
	if (
		bounds === null ||
		bounds.width <= 0 ||
		bounds.height <= 0 ||
		viewportWidth <= 2 * FIT_PADDING ||
		viewportHeight <= 2 * FIT_PADDING
	) {
		return { x: 0, y: 0, zoom: 1 };
	}
	const zoom = clampStageZoom({
		zoom: Math.min(
			(viewportWidth - 2 * FIT_PADDING) / bounds.width,
			(viewportHeight - 2 * FIT_PADDING) / bounds.height,
			1,
		),
	});
	return {
		x: (viewportWidth - bounds.width * zoom) / 2 - bounds.x * zoom,
		y: (viewportHeight - bounds.height * zoom) / 2 - bounds.y * zoom,
		zoom,
	};
};

// Frame drag/resize gestures land on whole stage px (no grid, like Figma's pixel snap).
export const GESTURE_THRESHOLD_PX = 3;
export const NUDGE_STEP = 8;
export const NUDGE_STEP_LARGE = 64;

// `+ 0` turns -0 into 0 so a rounded value never serializes as -0.
export const roundToPixel = (value: number): number => Math.round(value) + 0;

const clampCoordinate = (value: number): number =>
	clampNumber({ value, min: -MAX_FRAME_COORDINATE, max: MAX_FRAME_COORDINATE });

// Rounds the absolute target, so a fractional position from the Agent lands on a whole px.
export const dragFrame = ({
	start,
	stageDelta,
}: {
	start: StagePoint;
	stageDelta: StagePoint;
}): StagePoint => ({
	x: clampCoordinate(roundToPixel(start.x + stageDelta.x)),
	y: clampCoordinate(roundToPixel(start.y + stageDelta.y)),
});

export const resizeFrameWidth = ({
	startWidth,
	stageDeltaX,
}: {
	startWidth: number;
	stageDeltaX: number;
}): number =>
	clampNumber({
		value: roundToPixel(startWidth + stageDeltaX),
		min: MIN_FRAME_WIDTH,
		max: MAX_FRAME_WIDTH,
	});

// Per axis, not diagonal distance, so a plain click never moves a frame.
export const passedGestureThreshold = ({
	startScreen,
	screen,
}: {
	startScreen: StagePoint;
	screen: StagePoint;
}): boolean =>
	Math.abs(screen.x - startScreen.x) >= GESTURE_THRESHOLD_PX ||
	Math.abs(screen.y - startScreen.y) >= GESTURE_THRESHOLD_PX;

export const placementChanged = ({
	base,
	next,
}: {
	base: FramePlacement;
	next: FramePlacement;
}): boolean => base.x !== next.x || base.y !== next.y || base.width !== next.width;
