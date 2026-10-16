import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import { STAGE_GEOMETRY_SOURCE } from './stageGeometry';

type View = { x: number; y: number; zoom: number };
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type StageGeometry = {
	MIN_STAGE_ZOOM: number;
	MAX_STAGE_ZOOM: number;
	stageToScreen: (args: { view: View; stageX: number; stageY: number }) => Point;
	screenToStage: (args: { view: View; screenX: number; screenY: number }) => Point;
	zoomStageAt: (args: { view: View; deltaY: number; screenX: number; screenY: number }) => View;
	zoomStageTo: (args: { view: View; zoom: number; screenX: number; screenY: number }) => View;
	panStage: (args: { view: View; deltaX: number; deltaY: number }) => View;
	frameBounds: (args: { frames: Rect[] }) => Rect | null;
	clampStageView: (args: {
		view: View;
		bounds: Rect | null;
		viewportWidth: number;
		viewportHeight: number;
	}) => View;
	fitStageView: (args: {
		bounds: Rect | null;
		viewportWidth: number;
		viewportHeight: number;
	}) => View;
};

// Evaluates the exact shipped string; a fresh context has its own Math and nothing else.
const geometry = runInNewContext(
	`${STAGE_GEOMETRY_SOURCE}\n;({ MIN_STAGE_ZOOM, MAX_STAGE_ZOOM, stageToScreen, screenToStage, zoomStageAt, zoomStageTo, panStage, frameBounds, clampStageView, fitStageView })`,
) as StageGeometry;

const TOLERANCE = 1e-9;

// vm results come from another realm, so compare field by field instead of deepStrictEqual.
const assertClose = (
	actual: Record<string, number> | null,
	expected: Record<string, number>,
): void => {
	assert.ok(actual !== null);
	for (const [key, value] of Object.entries(expected)) {
		assert.ok(
			Math.abs(actual[key] - value) <= TOLERANCE,
			`${key}: expected ${value}, got ${actual[key]}`,
		);
	}
};

test('screen and stage coordinates round-trip at several zoom levels', () => {
	for (const zoom of [0.25, 1, 3]) {
		const view = { x: 37, y: -12, zoom };
		const screen = geometry.stageToScreen({ view, stageX: 100, stageY: 250 });
		assertClose(screen, { x: 100 * zoom + 37, y: 250 * zoom - 12 });
		assertClose(geometry.screenToStage({ view, screenX: screen.x, screenY: screen.y }), {
			x: 100,
			y: 250,
		});
	}
});

test('wheel up zooms in and wheel down zooms out', () => {
	const view = { x: 0, y: 0, zoom: 1 };
	assert.ok(geometry.zoomStageAt({ view, deltaY: -10, screenX: 0, screenY: 0 }).zoom > 1);
	assert.ok(geometry.zoomStageAt({ view, deltaY: 10, screenX: 0, screenY: 0 }).zoom < 1);
});

test('one zoom step is capped', () => {
	const view = { x: 0, y: 0, zoom: 1 };
	const medium = geometry.zoomStageAt({ view, deltaY: 100, screenX: 0, screenY: 0 });
	const large = geometry.zoomStageAt({ view, deltaY: 1000, screenX: 0, screenY: 0 });
	assertClose(medium, { x: 0, y: 0, zoom: Math.exp(-0.2) });
	assertClose(large, { x: 0, y: 0, zoom: medium.zoom });
});

test('zoom clamps exactly at the minimum and maximum', () => {
	assert.equal(geometry.MIN_STAGE_ZOOM, 0.05);
	assert.equal(geometry.MAX_STAGE_ZOOM, 10);
	const atMin = geometry.zoomStageAt({
		view: { x: 0, y: 0, zoom: 0.05 },
		deltaY: 100,
		screenX: 0,
		screenY: 0,
	});
	const atMax = geometry.zoomStageAt({
		view: { x: 0, y: 0, zoom: 10 },
		deltaY: -100,
		screenX: 0,
		screenY: 0,
	});
	assert.equal(atMin.zoom, 0.05);
	assert.equal(atMax.zoom, 10);
});

test('zoomStageTo keeps the screen anchor fixed at the target zoom', () => {
	const zoomed = geometry.zoomStageTo({
		view: { x: 100, y: 50, zoom: 1 },
		zoom: 2,
		screenX: 300,
		screenY: 200,
	});
	assert.equal(zoomed.x, -100);
	assert.equal(zoomed.y, -100);
	assert.equal(zoomed.zoom, 2);
});

test('zoomStageTo clamps the target zoom at both ends', () => {
	const view = { x: 0, y: 0, zoom: 1 };
	assertClose(geometry.zoomStageTo({ view, zoom: 0.01, screenX: 0, screenY: 0 }), {
		x: 0,
		y: 0,
		zoom: 0.05,
	});
	assertClose(geometry.zoomStageTo({ view, zoom: 50, screenX: 0, screenY: 0 }), {
		x: 0,
		y: 0,
		zoom: 10,
	});
	assertClose(geometry.zoomStageTo({ view, zoom: 50, screenX: 100, screenY: 40 }), {
		x: 100 - 100 * 10,
		y: 40 - 40 * 10,
		zoom: 10,
	});
});

test('zoomStageTo from a zero zoom yields a finite view', () => {
	const zoomed = geometry.zoomStageTo({
		view: { x: 10, y: 20, zoom: 0 },
		zoom: 2,
		screenX: 100,
		screenY: 100,
	});
	assertClose(zoomed, { x: 100 - 90 * 40, y: 100 - 80 * 40, zoom: 2 });
});

test('the stage point under the cursor stays under it while zooming', () => {
	const view = { x: 30, y: 40, zoom: 1.5 };
	const anchor = geometry.screenToStage({ view, screenX: 200, screenY: 300 });
	const zoomed = geometry.zoomStageAt({ view, deltaY: -50, screenX: 200, screenY: 300 });
	assert.notEqual(zoomed.zoom, view.zoom);
	assertClose(geometry.stageToScreen({ view: zoomed, stageX: anchor.x, stageY: anchor.y }), {
		x: 200,
		y: 300,
	});
});

test('a zero input zoom still yields a finite view', () => {
	const zoomed = geometry.zoomStageAt({
		view: { x: 10, y: 20, zoom: 0 },
		deltaY: -50,
		screenX: 100,
		screenY: 100,
	});
	assert.ok(Number.isFinite(zoomed.x) && Number.isFinite(zoomed.y));
	assert.ok(zoomed.zoom >= 0.05);
});

test('pan moves the view against the wheel delta and keeps zoom', () => {
	assertClose(geometry.panStage({ view: { x: 10, y: 20, zoom: 2 }, deltaX: 5, deltaY: -7 }), {
		x: 5,
		y: 27,
		zoom: 2,
	});
});

test('frame bounds are the union rect, or null for no frames', () => {
	assertClose(
		geometry.frameBounds({
			frames: [
				{ x: 0, y: 0, width: 100, height: 50 },
				{ x: 200, y: -20, width: 50, height: 30 },
			],
		}),
		{ x: 0, y: -20, width: 250, height: 70 },
	);
	assert.equal(geometry.frameBounds({ frames: [] }), null);
});

test('clamp keeps exactly 48px of large bounds visible at each edge', () => {
	const bounds = { x: 0, y: 0, width: 2000, height: 1500 };
	const viewport = { viewportWidth: 800, viewportHeight: 600 };
	assertClose(
		geometry.clampStageView({ view: { x: 5000, y: 5000, zoom: 1 }, bounds, ...viewport }),
		{
			x: 752,
			y: 552,
			zoom: 1,
		},
	);
	assertClose(
		geometry.clampStageView({ view: { x: -5000, y: -5000, zoom: 1 }, bounds, ...viewport }),
		{ x: -1952, y: -1452, zoom: 1 },
	);

	const offsetBounds = { x: 100, y: 50, width: 1000, height: 1000 };
	const clamped = geometry.clampStageView({
		view: { x: 5000, y: 5000, zoom: 2 },
		bounds: offsetBounds,
		...viewport,
	});
	assertClose(clamped, { x: 552, y: 452, zoom: 2 });
	assertClose(geometry.stageToScreen({ view: clamped, stageX: 100, stageY: 50 }), {
		x: 800 - 48,
		y: 600 - 48,
	});
});

test('clamp keeps small bounds fully visible', () => {
	const bounds = { x: 0, y: 0, width: 20, height: 10 };
	const viewport = { viewportWidth: 800, viewportHeight: 600 };
	assertClose(
		geometry.clampStageView({ view: { x: -500, y: -500, zoom: 1 }, bounds, ...viewport }),
		{ x: 0, y: 0, zoom: 1 },
	);
	assertClose(
		geometry.clampStageView({ view: { x: 5000, y: 5000, zoom: 1 }, bounds, ...viewport }),
		{
			x: 780,
			y: 590,
			zoom: 1,
		},
	);
});

test('clamp in a 30x30 viewport keeps 30px visible', () => {
	const bounds = { x: 0, y: 0, width: 2000, height: 1500 };
	const viewport = { viewportWidth: 30, viewportHeight: 30 };
	assertClose(geometry.clampStageView({ view: { x: 100, y: 100, zoom: 1 }, bounds, ...viewport }), {
		x: 0,
		y: 0,
		zoom: 1,
	});
	assertClose(
		geometry.clampStageView({ view: { x: -5000, y: -5000, zoom: 1 }, bounds, ...viewport }),
		{ x: -1970, y: -1470, zoom: 1 },
	);
});

test('clamp with null bounds only clamps zoom', () => {
	assertClose(
		geometry.clampStageView({
			view: { x: 999, y: -999, zoom: 50 },
			bounds: null,
			viewportWidth: 800,
			viewportHeight: 600,
		}),
		{ x: 999, y: -999, zoom: 10 },
	);
});

test('fit centers the bounds inside the padded viewport', () => {
	assertClose(
		geometry.fitStageView({
			bounds: { x: 100, y: 50, width: 2000, height: 1000 },
			viewportWidth: 1096,
			viewportHeight: 600,
		}),
		{ x: -2, y: 25, zoom: 0.5 },
	);
});

test('fit never zooms past 100%', () => {
	assertClose(
		geometry.fitStageView({
			bounds: { x: 10, y: 20, width: 100, height: 100 },
			viewportWidth: 800,
			viewportHeight: 600,
		}),
		{ x: 340, y: 230, zoom: 1 },
	);
});

test('fit returns the default view for empty, zero-size, or tiny inputs', () => {
	const defaultView = { x: 0, y: 0, zoom: 1 };
	assertClose(
		geometry.fitStageView({ bounds: null, viewportWidth: 800, viewportHeight: 600 }),
		defaultView,
	);
	assertClose(
		geometry.fitStageView({
			bounds: { x: 5, y: 5, width: 0, height: 100 },
			viewportWidth: 800,
			viewportHeight: 600,
		}),
		defaultView,
	);
	assertClose(
		geometry.fitStageView({
			bounds: { x: 5, y: 5, width: 100, height: 100 },
			viewportWidth: 50,
			viewportHeight: 50,
		}),
		defaultView,
	);
});

test('source has no backtick, dollar-brace, or closing tag sequence', () => {
	assert.ok(!STAGE_GEOMETRY_SOURCE.includes('`'));
	assert.ok(!STAGE_GEOMETRY_SOURCE.includes('${'));
	assert.ok(!STAGE_GEOMETRY_SOURCE.includes('</'));
});
