import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { test } from 'vite-plus/test';

import * as geometry from './stageGeometry';
import type { StagePoint as Point, StageRect as Rect, StageView as View } from './stageGeometry';
import stageGeometrySource from './stageGeometry.ts?iife';

const TOLERANCE = 1e-9;

const boxRect = (
	box: { x: number; y: number; width: number; height: number } | undefined,
): Rect | null =>
	box === undefined ? null : { x: box.x, y: box.y, width: box.width, height: box.height };

// Float results (zoom, exp) compare within a tolerance; exact cases use deepEqual.
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
	assert.deepEqual(geometry.panStage({ view: { x: 10, y: 20, zoom: 2 }, deltaX: 5, deltaY: -7 }), {
		x: 5,
		y: 27,
		zoom: 2,
	});
});

test('layoutCanvasChrome places labels, one heading per group, and includes them in bounds', () => {
	const layout = geometry.layoutCanvasChrome({
		frames: [
			{ id: 'a', x: 0, y: 100, width: 1280, height: 800, group: 'Desktop' },
			{ id: 'b', x: 1304, y: 100, width: 390, height: 800, group: 'Desktop' },
			{ id: 'c', x: 0, y: 1000, width: 600, height: 400 },
		],
	});
	assert.equal(layout.labels.length, 3);
	assert.equal(layout.labels[0]?.id, 'a');
	assert.deepEqual(boxRect(layout.labels[0]), { x: 0, y: 76, width: 1280, height: 24 });
	assert.equal(layout.labels[1]?.id, 'b');
	assert.deepEqual(boxRect(layout.labels[1]), { x: 1304, y: 76, width: 390, height: 24 });
	assert.equal(layout.labels[2]?.id, 'c');
	assert.deepEqual(boxRect(layout.labels[2]), { x: 0, y: 976, width: 600, height: 24 });
	assert.equal(layout.headings.length, 1);
	assert.equal(layout.headings[0]?.group, 'Desktop');
	assert.deepEqual(boxRect(layout.headings[0]), { x: 0, y: 44, width: 1694, height: 32 });
	assert.deepEqual(layout.bounds, { x: 0, y: 44, width: 1694, height: 1356 });
});

test('layoutCanvasChrome has no heading for ungrouped frames and null bounds for none', () => {
	const ungrouped = geometry.layoutCanvasChrome({
		frames: [{ id: 'solo', x: 10, y: 50, width: 100, height: 80 }],
	});
	assert.equal(ungrouped.headings.length, 0);
	assert.equal(ungrouped.labels.length, 1);
	assert.deepEqual(ungrouped.bounds, { x: 10, y: 26, width: 100, height: 104 });
	const empty = geometry.layoutCanvasChrome({ frames: [] });
	assert.equal(empty.bounds, null);
	assert.equal(empty.labels.length, 0);
	assert.equal(empty.headings.length, 0);
});

test('layoutCanvasChrome headings follow first-seen group order', () => {
	const layout = geometry.layoutCanvasChrome({
		frames: [
			{ id: 'm', x: 0, y: 40, width: 100, height: 80, group: 'Mobile' },
			{ id: 'd', x: 200, y: 10, width: 120, height: 80, group: 'Desktop' },
		],
	});
	assert.equal(layout.headings.length, 2);
	assert.equal(layout.headings[0]?.group, 'Mobile');
	assert.equal(layout.headings[1]?.group, 'Desktop');
	assert.deepEqual(boxRect(layout.headings[0]), { x: 0, y: -16, width: 100, height: 32 });
	assert.deepEqual(boxRect(layout.headings[1]), { x: 200, y: -46, width: 120, height: 32 });
});

test('frame bounds are the union rect, or null for no frames', () => {
	assert.deepEqual(
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
	assert.deepEqual(
		geometry.clampStageView({ view: { x: 5000, y: 5000, zoom: 1 }, bounds, ...viewport }),
		{
			x: 752,
			y: 552,
			zoom: 1,
		},
	);
	assert.deepEqual(
		geometry.clampStageView({ view: { x: -5000, y: -5000, zoom: 1 }, bounds, ...viewport }),
		{ x: -1952, y: -1452, zoom: 1 },
	);

	const offsetBounds = { x: 100, y: 50, width: 1000, height: 1000 };
	const clamped = geometry.clampStageView({
		view: { x: 5000, y: 5000, zoom: 2 },
		bounds: offsetBounds,
		...viewport,
	});
	assert.deepEqual(clamped, { x: 552, y: 452, zoom: 2 });
	assert.deepEqual(geometry.stageToScreen({ view: clamped, stageX: 100, stageY: 50 }), {
		x: 800 - 48,
		y: 600 - 48,
	});
});

test('clamp keeps small bounds fully visible', () => {
	const bounds = { x: 0, y: 0, width: 20, height: 10 };
	const viewport = { viewportWidth: 800, viewportHeight: 600 };
	assert.deepEqual(
		geometry.clampStageView({ view: { x: -500, y: -500, zoom: 1 }, bounds, ...viewport }),
		{ x: 0, y: 0, zoom: 1 },
	);
	assert.deepEqual(
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
	assert.deepEqual(
		geometry.clampStageView({ view: { x: 100, y: 100, zoom: 1 }, bounds, ...viewport }),
		{
			x: 0,
			y: 0,
			zoom: 1,
		},
	);
	assert.deepEqual(
		geometry.clampStageView({ view: { x: -5000, y: -5000, zoom: 1 }, bounds, ...viewport }),
		{ x: -1970, y: -1470, zoom: 1 },
	);
});

test('clamp with null bounds only clamps zoom', () => {
	assert.deepEqual(
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
	assert.deepEqual(
		geometry.fitStageView({
			bounds: { x: 100, y: 50, width: 2000, height: 1000 },
			viewportWidth: 1096,
			viewportHeight: 600,
		}),
		{ x: -2, y: 25, zoom: 0.5 },
	);
});

test('fit never zooms past 100%', () => {
	assert.deepEqual(
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
	assert.deepEqual(
		geometry.fitStageView({ bounds: null, viewportWidth: 800, viewportHeight: 600 }),
		defaultView,
	);
	assert.deepEqual(
		geometry.fitStageView({
			bounds: { x: 5, y: 5, width: 0, height: 100 },
			viewportWidth: 800,
			viewportHeight: 600,
		}),
		defaultView,
	);
	assert.deepEqual(
		geometry.fitStageView({
			bounds: { x: 5, y: 5, width: 100, height: 100 },
			viewportWidth: 50,
			viewportHeight: 50,
		}),
		defaultView,
	);
});

test('nextFrameHeight applies first report, shrink, growth, clamps, and freeze', () => {
	const reset = { lastGrowth: 0, frozen: false };
	const first = geometry.nextFrameHeight({ current: 800, reported: 1200, state: reset });
	assert.equal(first.height, 1200);
	assert.equal(first.state.lastGrowth, 400);
	assert.equal(first.state.frozen, false);

	const grown = geometry.nextFrameHeight({
		current: 1200,
		reported: 1500,
		state: first.state,
	});
	assert.equal(grown.height, 1500);
	assert.equal(grown.state.lastGrowth, 300);

	const shrunk = geometry.nextFrameHeight({
		current: 1500,
		reported: 400,
		state: grown.state,
	});
	assert.equal(shrunk.height, 400);
	assert.equal(shrunk.state.lastGrowth, 0);
	assert.equal(shrunk.state.frozen, false);

	const ignored = geometry.nextFrameHeight({
		current: 800,
		reported: Number.POSITIVE_INFINITY,
		state: reset,
	});
	assert.equal(ignored.height, 800);
	assert.equal(ignored.state.lastGrowth, 0);
	assert.equal(ignored.state.frozen, false);
	assert.equal(
		geometry.nextFrameHeight({ current: 800, reported: Number.NaN, state: reset }).height,
		800,
	);

	assert.equal(geometry.nextFrameHeight({ current: 800, reported: 0, state: reset }).height, 1);
	assert.equal(
		geometry.nextFrameHeight({ current: 800, reported: 50000, state: reset }).height,
		20000,
	);

	const bounce = geometry.nextFrameHeight({ current: 800, reported: 1800, state: reset });
	const frozen = geometry.nextFrameHeight({
		current: bounce.height,
		reported: 2800,
		state: bounce.state,
	});
	assert.equal(frozen.height, 1800);
	assert.equal(frozen.state.frozen, true);
	assert.equal(frozen.state.lastGrowth, 1000);

	const shrinkFrozen = geometry.nextFrameHeight({
		current: 1800,
		reported: 500,
		state: frozen.state,
	});
	assert.equal(shrinkFrozen.height, 500);
	assert.equal(shrinkFrozen.state.frozen, true);
	assert.equal(shrinkFrozen.state.lastGrowth, 0);

	const blocked = geometry.nextFrameHeight({
		current: 500,
		reported: 900,
		state: shrinkFrozen.state,
	});
	assert.equal(blocked.height, 500);
	assert.equal(blocked.state.frozen, true);

	const afterReset = geometry.nextFrameHeight({
		current: 500,
		reported: 900,
		state: reset,
	});
	assert.equal(afterReset.height, 900);
	assert.equal(afterReset.state.frozen, false);
	assert.equal(afterReset.state.lastGrowth, 400);
});

test('the ?iife string has no closing tag sequence', () => {
	assert.ok(!stageGeometrySource.includes('</'));
});

const finiteCoord = fc.integer({ min: -4000, max: 4000 });
const inRangeZoom = fc.double({
	min: geometry.MIN_STAGE_ZOOM,
	max: geometry.MAX_STAGE_ZOOM,
	noNaN: true,
});
const finiteZoom = fc.double({ min: -50, max: 50, noNaN: true });
const positiveSize = fc.integer({ min: 1, max: 2000 });
const positiveViewport = fc.integer({ min: 1, max: 4000 });

const viewInRangeArb = fc.record({
	x: finiteCoord,
	y: finiteCoord,
	zoom: inRangeZoom,
});

const assertZoomClamped = (zoom: number): void => {
	assert.ok(zoom >= geometry.MIN_STAGE_ZOOM - TOLERANCE);
	assert.ok(zoom <= geometry.MAX_STAGE_ZOOM + TOLERANCE);
};

const assertKeepVisible = ({
	view,
	bounds,
	viewportWidth,
	viewportHeight,
}: {
	view: View;
	bounds: Rect;
	viewportWidth: number;
	viewportHeight: number;
}): void => {
	const keepX = Math.min(48, bounds.width * view.zoom, viewportWidth);
	const keepY = Math.min(48, bounds.height * view.zoom, viewportHeight);
	const left = bounds.x * view.zoom + view.x;
	const right = (bounds.x + bounds.width) * view.zoom + view.x;
	const top = bounds.y * view.zoom + view.y;
	const bottom = (bounds.y + bounds.height) * view.zoom + view.y;
	const visibleWidth = Math.min(viewportWidth, right) - Math.max(0, left);
	const visibleHeight = Math.min(viewportHeight, bottom) - Math.max(0, top);
	assert.ok(visibleWidth + TOLERANCE >= keepX, `visible width ${visibleWidth} < keep ${keepX}`);
	assert.ok(visibleHeight + TOLERANCE >= keepY, `visible height ${visibleHeight} < keep ${keepY}`);
};

const assertBoxInsideViewport = ({
	view,
	box,
	viewportWidth,
	viewportHeight,
}: {
	view: View;
	box: Rect;
	viewportWidth: number;
	viewportHeight: number;
}): void => {
	const corners: Point[] = [
		{ x: box.x, y: box.y },
		{ x: box.x + box.width, y: box.y },
		{ x: box.x, y: box.y + box.height },
		{ x: box.x + box.width, y: box.y + box.height },
	];
	for (const corner of corners) {
		const screen = geometry.stageToScreen({
			view,
			stageX: corner.x,
			stageY: corner.y,
		});
		assert.ok(screen.x >= -TOLERANCE, `x ${screen.x} < 0`);
		assert.ok(screen.y >= -TOLERANCE, `y ${screen.y} < 0`);
		assert.ok(screen.x <= viewportWidth + TOLERANCE, `x ${screen.x} > ${viewportWidth}`);
		assert.ok(screen.y <= viewportHeight + TOLERANCE, `y ${screen.y} > ${viewportHeight}`);
	}
};

const chromeFrameArb = fc
	.record({
		id: fc.string({ minLength: 1, maxLength: 12, unit: 'grapheme-ascii' }),
		x: finiteCoord,
		y: finiteCoord,
		width: positiveSize,
		height: positiveSize,
		group: fc.option(fc.string({ minLength: 1, maxLength: 16, unit: 'grapheme-ascii' }), {
			nil: undefined,
		}),
	})
	.map(({ group, ...frame }) => (group === undefined ? frame : { ...frame, group }));

test('property: zoom-at-cursor keeps the screen pixel', () => {
	fc.assert(
		fc.property(
			viewInRangeArb,
			finiteCoord,
			finiteCoord,
			finiteZoom,
			fc.double({ min: -2000, max: 2000, noNaN: true }),
			(view, screenX, screenY, targetZoom, deltaY) => {
				const anchor = geometry.screenToStage({ view, screenX, screenY });
				const zoomedTo = geometry.zoomStageTo({ view, zoom: targetZoom, screenX, screenY });
				const zoomedAt = geometry.zoomStageAt({ view, deltaY, screenX, screenY });
				assertClose(
					geometry.stageToScreen({ view: zoomedTo, stageX: anchor.x, stageY: anchor.y }),
					{
						x: screenX,
						y: screenY,
					},
				);
				assertClose(
					geometry.stageToScreen({ view: zoomedAt, stageX: anchor.x, stageY: anchor.y }),
					{
						x: screenX,
						y: screenY,
					},
				);
			},
		),
	);
});

test('property: result zoom clamps and clampStageView keeps bounds visible', () => {
	fc.assert(
		fc.property(
			fc.record({
				x: finiteCoord,
				y: finiteCoord,
				zoom: finiteZoom,
			}),
			finiteZoom,
			fc.double({ min: -2000, max: 2000, noNaN: true }),
			fc.record({
				x: finiteCoord,
				y: finiteCoord,
				width: positiveSize,
				height: positiveSize,
			}),
			positiveViewport,
			positiveViewport,
			(view, targetZoom, deltaY, bounds, viewportWidth, viewportHeight) => {
				const zoomedTo = geometry.zoomStageTo({
					view,
					zoom: targetZoom,
					screenX: 0,
					screenY: 0,
				});
				const zoomedAt = geometry.zoomStageAt({
					view,
					deltaY,
					screenX: 0,
					screenY: 0,
				});
				const clamped = geometry.clampStageView({
					view,
					bounds,
					viewportWidth,
					viewportHeight,
				});
				assertZoomClamped(zoomedTo.zoom);
				assertZoomClamped(zoomedAt.zoom);
				assertZoomClamped(clamped.zoom);
				assertKeepVisible({
					view: clamped,
					bounds,
					viewportWidth,
					viewportHeight,
				});
			},
		),
	);
});

test('property: fit-all contains every chrome box', () => {
	fc.assert(
		fc.property(
			fc.uniqueArray(chromeFrameArb, {
				minLength: 0,
				maxLength: 5,
				selector: (frame) => frame.id,
			}),
			fc.integer({ min: 97, max: 4000 }),
			fc.integer({ min: 97, max: 4000 }),
			(frames, viewportWidth, viewportHeight) => {
				const union = geometry.frameBounds({ frames });
				const layout = geometry.layoutCanvasChrome({ frames });
				if (frames.length === 0) {
					assert.equal(union, null);
					assert.equal(layout.bounds, null);
					return;
				}
				if (layout.bounds === null) {
					return;
				}
				const neededZoom = Math.min(
					(viewportWidth - 2 * 48) / layout.bounds.width,
					(viewportHeight - 2 * 48) / layout.bounds.height,
				);
				// Current fit clamps zoom up to MIN_STAGE_ZOOM, so oversized bounds overflow.
				if (neededZoom < geometry.MIN_STAGE_ZOOM) {
					return;
				}
				const view = geometry.fitStageView({
					bounds: layout.bounds,
					viewportWidth,
					viewportHeight,
				});
				for (const box of [...frames, ...layout.labels, ...layout.headings]) {
					assertBoxInsideViewport({
						view,
						box,
						viewportWidth,
						viewportHeight,
					});
				}
			},
		),
	);
});

test('resizeFrameWidth rounds the width to whole px and clamps to 120..3840', () => {
	for (const [target, expected] of [
		[119, 120],
		[120, 120],
		[3840, 3840],
		[3841, 3840],
	]) {
		assert.equal(geometry.resizeFrameWidth({ startWidth: target, stageDeltaX: 0 }), expected);
	}
	assert.equal(geometry.resizeFrameWidth({ startWidth: 400, stageDeltaX: 5.4 }), 405);
	assert.equal(geometry.resizeFrameWidth({ startWidth: 400, stageDeltaX: 3.6 }), 404);
});

test('dragFrame follows the delta exactly and rounds the absolute position to whole px', () => {
	const at = (startX: number, deltaX: number): number =>
		geometry.dragFrame({ start: { x: startX, y: 0 }, stageDelta: { x: deltaX, y: 0 } }).x;
	assert.equal(at(13, 0), 13);
	assert.equal(at(13, 5), 18);
	assert.equal(at(17366, 8), 17374);
	assert.equal(at(13.4, 0), 13);
	assert.equal(at(13, 0.6), 14);
});

test('dragFrame normalizes -0 and clamps to ±MAX_FRAME_COORDINATE', () => {
	const near = geometry.dragFrame({ start: { x: -0.3, y: -0.1 }, stageDelta: { x: 0, y: 0 } });
	assert.ok(Object.is(near.x, 0) && Object.is(near.y, 0));
	assert.ok(Object.is(geometry.roundToPixel(-0), 0));
	assert.deepEqual(
		geometry.dragFrame({ start: { x: 99_999, y: -99_999 }, stageDelta: { x: 500, y: -500 } }),
		{ x: 100_000, y: -100_000 },
	);
});

test('passedGestureThreshold checks each axis on its own', () => {
	const passed = (x: number, y: number): boolean =>
		geometry.passedGestureThreshold({
			startScreen: { x: 10, y: 10 },
			screen: { x: 10 + x, y: 10 + y },
		});
	assert.equal(passed(2, 0), false);
	assert.equal(passed(3, 0), true);
	assert.equal(passed(0, 3), true);
	assert.equal(passed(0, -3), true);
	assert.equal(passed(2, 2), false);
});

test('placementChanged is true when any of x, y, width differs', () => {
	const base = { x: 0, y: 8, width: 400 };
	assert.equal(geometry.placementChanged({ base, next: { ...base } }), false);
	assert.equal(geometry.placementChanged({ base, next: { ...base, x: 8 } }), true);
	assert.equal(geometry.placementChanged({ base, next: { ...base, y: 0 } }), true);
	assert.equal(geometry.placementChanged({ base, next: { ...base, width: 408 } }), true);
});

const MAX_COORDINATE = 100_000;
const gestureCoordinate = fc.oneof(
	fc.integer({ min: -MAX_COORDINATE, max: MAX_COORDINATE }),
	fc.double({ min: -MAX_COORDINATE, max: MAX_COORDINATE, noNaN: true }),
);
const gestureView = fc.record({
	x: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
	y: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
	zoom: fc.double({ min: 0.05, max: 10, noNaN: true }),
});

// Stage delta comes from two screen points through screenToStage, as the chrome computes it.
const stageDeltaOf = (view: View, startScreen: Point, screen: Point): Point => {
	const from = geometry.screenToStage({ view, screenX: startScreen.x, screenY: startScreen.y });
	const to = geometry.screenToStage({ view, screenX: screen.x, screenY: screen.y });
	return { x: to.x - from.x, y: to.y - from.y };
};

const screenPoint = fc.record({
	x: fc.double({ min: -5_000, max: 5_000, noNaN: true }),
	y: fc.double({ min: -5_000, max: 5_000, noNaN: true }),
});

test('property: dragFrame lands on a whole px within ±MAX_FRAME_COORDINATE', () => {
	fc.assert(
		fc.property(
			gestureCoordinate,
			gestureCoordinate,
			gestureView,
			screenPoint,
			screenPoint,
			(startX, startY, view, startScreen, screen) => {
				const placed = geometry.dragFrame({
					start: { x: startX, y: startY },
					stageDelta: stageDeltaOf(view, startScreen, screen),
				});
				for (const value of [placed.x, placed.y]) {
					assert.ok(Math.abs(value) <= MAX_COORDINATE);
					assert.ok(Number.isInteger(value));
				}
			},
		),
	);
});

test('property: resizeFrameWidth lands on a whole px within 120..3840', () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 120, max: 3840 }),
			gestureView,
			screenPoint,
			screenPoint,
			(startWidth, view, startScreen, screen) => {
				const width = geometry.resizeFrameWidth({
					startWidth,
					stageDeltaX: stageDeltaOf(view, startScreen, screen).x,
				});
				assert.ok(width >= 120 && width <= 3840);
				assert.ok(Number.isInteger(width));
			},
		),
	);
});

test('frameRectToScreen maps a frame-local rect through a panned view at any zoom', () => {
	const frame = { x: 100, y: 50 };
	const rect = { x: 10, y: 20, width: 30, height: 40 };
	for (const zoom of [0.1, 1, 4]) {
		const view = { x: -15, y: 25, zoom };
		assertClose(geometry.frameRectToScreen({ view, frame, rect }), {
			x: (100 + 10) * zoom - 15,
			y: (50 + 20) * zoom + 25,
			width: 30 * zoom,
			height: 40 * zoom,
		});
	}
});
