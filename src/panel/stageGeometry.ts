// Plain JS for 6c to inline raw into the chrome script (no bundler there). Every function
// takes one object and returns new values, with no DOM and nothing global except Math.
// Must stay free of backticks, dollar-brace, and less-than-slash so it can never break out
// of the template literal that inlines it or close the chrome script element.
// View { x, y, zoom } maps stage px to screen px: screen = stage * zoom + (x, y), which is
// CSS translate(x, y) scale(zoom) with transform-origin 0 0.
export const STAGE_GEOMETRY_SOURCE = `const MIN_STAGE_ZOOM = 0.1;
const MAX_STAGE_ZOOM = 4;
const ZOOM_STEP_CAP = 0.2;
const ZOOM_SENSITIVITY = 0.01;
const FIT_PADDING = 48;
const KEEP_VISIBLE = 48;

const clampNumber = ({ value, min, max }) => Math.min(max, Math.max(min, value));

const clampStageZoom = ({ zoom }) =>
	clampNumber({ value: zoom, min: MIN_STAGE_ZOOM, max: MAX_STAGE_ZOOM });

const stageToScreen = ({ view, stageX, stageY }) => ({
	x: stageX * view.zoom + view.x,
	y: stageY * view.zoom + view.y,
});

const screenToStage = ({ view, screenX, screenY }) => ({
	x: (screenX - view.x) / view.zoom,
	y: (screenY - view.y) / view.zoom,
});

const zoomStageAt = ({ view, deltaY, screenX, screenY }) => {
	const fromZoom = clampStageZoom({ zoom: view.zoom });
	const step = clampNumber({
		value: -deltaY * ZOOM_SENSITIVITY,
		min: -ZOOM_STEP_CAP,
		max: ZOOM_STEP_CAP,
	});
	const zoom = clampStageZoom({ zoom: fromZoom * Math.exp(step) });
	return {
		x: screenX - ((screenX - view.x) * zoom) / fromZoom,
		y: screenY - ((screenY - view.y) * zoom) / fromZoom,
		zoom,
	};
};

const panStage = ({ view, deltaX, deltaY }) => ({
	x: view.x - deltaX,
	y: view.y - deltaY,
	zoom: view.zoom,
});

const frameBounds = ({ frames }) => {
	if (frames.length === 0) {
		return null;
	}
	let left = frames[0].x;
	let top = frames[0].y;
	let right = frames[0].x + frames[0].width;
	let bottom = frames[0].y + frames[0].height;
	for (const frame of frames) {
		left = Math.min(left, frame.x);
		top = Math.min(top, frame.y);
		right = Math.max(right, frame.x + frame.width);
		bottom = Math.max(bottom, frame.y + frame.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
};

const clampStageAxis = ({ offset, start, size, zoom, viewportSize }) => {
	const scaledSize = size * zoom;
	const keep = Math.min(KEEP_VISIBLE, scaledSize, viewportSize);
	return clampNumber({
		value: offset,
		min: keep - scaledSize - start * zoom,
		max: viewportSize - keep - start * zoom,
	});
};

const clampStageView = ({ view, bounds, viewportWidth, viewportHeight }) => {
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

const fitStageView = ({ bounds, viewportWidth, viewportHeight }) => {
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
`;
