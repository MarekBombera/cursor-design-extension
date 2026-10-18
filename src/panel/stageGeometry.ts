// Plain JS for 6c to inline raw into the chrome script (no bundler there). Every function
// takes one object and returns new values, with no DOM and nothing global except Math.
// Must stay free of backticks, dollar-brace, and less-than-slash so it can never break out
// of the template literal that inlines it or close the chrome script element.
// View { x, y, zoom } maps stage px to screen px: screen = stage * zoom + (x, y), which is
// CSS translate(x, y) scale(zoom) with transform-origin 0 0.
export const STAGE_GEOMETRY_SOURCE = `const MIN_STAGE_ZOOM = 0.05;
const MAX_STAGE_ZOOM = 10;
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

const zoomStageTo = ({ view, zoom: targetZoom, screenX, screenY }) => {
	const fromZoom = clampStageZoom({ zoom: view.zoom });
	const zoom = clampStageZoom({ zoom: targetZoom });
	return {
		x: screenX - ((screenX - view.x) * zoom) / fromZoom,
		y: screenY - ((screenY - view.y) * zoom) / fromZoom,
		zoom,
	};
};

const zoomStageAt = ({ view, deltaY, screenX, screenY }) => {
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

const FRAME_LABEL_BAND = 24;
const GROUP_HEADING_BAND = 32;

const layoutCanvasChrome = ({ frames }) => {
	const labels = [];
	const headingAcc = [];
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
		let found;
		for (const entry of headingAcc) {
			if (entry.group === frame.group) {
				found = entry;
				break;
			}
		}
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
	const headings = [];
	for (const entry of headingAcc) {
		headings.push({
			group: entry.group,
			x: entry.minX,
			y: entry.minY - FRAME_LABEL_BAND - GROUP_HEADING_BAND,
			width: entry.maxRight - entry.minX,
			height: GROUP_HEADING_BAND,
		});
	}
	const boxes = [];
	for (const frame of frames) {
		boxes.push({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
	}
	for (const label of labels) {
		boxes.push({ x: label.x, y: label.y, width: label.width, height: label.height });
	}
	for (const heading of headings) {
		boxes.push({ x: heading.x, y: heading.y, width: heading.width, height: heading.height });
	}
	return { labels: labels, headings: headings, bounds: frameBounds({ frames: boxes }) };
};

const MIN_FRAME_HEIGHT = 1;
const MAX_FRAME_HEIGHT = 20000;

const nextFrameHeight = ({ current, reported, state }) => {
	if (!Number.isFinite(reported)) {
		return { height: current, state: state };
	}
	const clamped = clampNumber({ value: reported, min: MIN_FRAME_HEIGHT, max: MAX_FRAME_HEIGHT });
	const growth = clamped - current;
	if (0 >= growth) {
		return { height: clamped, state: { lastGrowth: 0, frozen: state.frozen } };
	}
	if (state.frozen) {
		return { height: current, state: state };
	}
	if (state.lastGrowth > 0 && 1 >= Math.abs(growth - state.lastGrowth)) {
		return { height: current, state: { lastGrowth: state.lastGrowth, frozen: true } };
	}
	return { height: clamped, state: { lastGrowth: growth, frozen: state.frozen } };
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
