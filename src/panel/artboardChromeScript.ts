// Plain JS inlined into the chrome <script> (no bundler in the webview). Same rules as
// stageGeometry for the *output*: no backtick, no dollar-brace, no less-than-slash.
// Host values are interpolated here, then pasted into artboardChromeHtml.ts.

type ArtboardChromeScriptArgs = {
	embeddedCanvasRuntimeSource: string;
	canvasRuntimeAttribute: string;
	canvasWheelMessage: string;
	mcpUnavailableCopy: string;
};

export const buildArtboardChromeScript = ({
	embeddedCanvasRuntimeSource,
	canvasRuntimeAttribute,
	canvasWheelMessage,
	mcpUnavailableCopy,
}: ArtboardChromeScriptArgs): string => `const vscodeApi = acquireVsCodeApi();
const iframe = document.getElementById('artboard-frame');
const stageViewport = document.getElementById('stage-viewport');
const stageLayer = document.getElementById('stage-layer');
const zoomReadout = document.getElementById('zoom-readout');
const zoomPreset = document.getElementById('zoom-preset');
const zoomFit = document.getElementById('zoom-fit');
const canvasRuntimeSource = ${embeddedCanvasRuntimeSource};
const canvasRuntimeAttribute = ${JSON.stringify(canvasRuntimeAttribute)};
const canvasWheelMessage = ${JSON.stringify(canvasWheelMessage)};
const emptyCopy = document.getElementById('empty-copy');
const idBadge = document.getElementById('artboard-id-badge');
const generationBadge = document.getElementById('artboard-generation-badge');
const handoffBadge = document.getElementById('handoff-stale-badge');
const errorBanner = document.getElementById('artboard-error');
const mcpBanner = document.getElementById('mcp-banner');
const mcpUnavailableCopy = ${JSON.stringify(mcpUnavailableCopy)};
const handoffStaleCopy = 'Handoff out of date. Re-export.';
let currentBlobUrl;
let lastHtml;

const revokeCurrentBlob = () => {
	if (currentBlobUrl !== undefined) {
		URL.revokeObjectURL(currentBlobUrl);
		currentBlobUrl = undefined;
	}
};

// ponytail: one provisional frame at stage (0, 0). 6d replaces these with the
// canvas.json width and the reported frame height.
const PROVISIONAL_FRAME_WIDTH = 1280;
const PROVISIONAL_FRAME_HEIGHT = 800;

const isUsableStageView = (view) =>
	view !== null &&
	typeof view === 'object' &&
	Number.isFinite(view.x) &&
	Number.isFinite(view.y) &&
	Number.isFinite(view.zoom) &&
	view.zoom > 0;

// Webview state survives hide/show (the webview reloads), so the view is restored
// from it. Anything malformed is ignored and the first layout fits instead.
const savedState = vscodeApi.getState();
const hasSavedView =
	savedState !== null && typeof savedState === 'object' && isUsableStageView(savedState.stageView);
let stageView = hasSavedView
	? { x: savedState.stageView.x, y: savedState.stageView.y, zoom: savedState.stageView.zoom }
	: { x: 0, y: 0, zoom: 1 };
let initialViewApplied = false;
let isDraggingStage = false;
let lastPointerX = 0;
let lastPointerY = 0;

const stageBounds = () => {
	if (stageViewport.hidden) {
		return null;
	}
	return frameBounds({
		frames: [{ x: 0, y: 0, width: PROVISIONAL_FRAME_WIDTH, height: PROVISIONAL_FRAME_HEIGHT }],
	});
};

// The single write path for the view: clamp, transform the layer, readout, save.
const commitStageView = (nextView) => {
	const bounds = stageBounds();
	const viewportWidth = stageViewport.clientWidth;
	const viewportHeight = stageViewport.clientHeight;
	if (bounds === null || viewportWidth === 0 || viewportHeight === 0) {
		return;
	}
	stageView = clampStageView({ view: nextView, bounds, viewportWidth, viewportHeight });
	stageLayer.style.transform =
		'translate(' + stageView.x + 'px, ' + stageView.y + 'px) scale(' + stageView.zoom + ')';
	zoomReadout.textContent = Math.round(stageView.zoom * 100) + '%';
	vscodeApi.setState({ stageView });
};

// Runs once per webview load: the saved view, or a fit on first open. Later edits
// and artboard switches keep whatever view the user has.
const applyInitialView = () => {
	if (initialViewApplied) {
		return;
	}
	if (stageBounds() === null || stageViewport.clientWidth === 0 || stageViewport.clientHeight === 0) {
		return;
	}
	commitStageView(
		hasSavedView
			? stageView
			: fitStageView({
					bounds: stageBounds(),
					viewportWidth: stageViewport.clientWidth,
					viewportHeight: stageViewport.clientHeight,
				}),
	);
	initialViewApplied = true;
};

const viewportPoint = (event) => {
	const viewportRect = stageViewport.getBoundingClientRect();
	return {
		screenX: event.clientX - viewportRect.left,
		screenY: event.clientY - viewportRect.top,
	};
};

const handleCanvasMessage = (data) => {
	// ponytail: rejects are not logged; wheel fires at 60+ Hz, so logging would spam.
	// Upgrade path: a debug-only reject counter.
	if (data === null || typeof data !== 'object' || data.type !== canvasWheelMessage) {
		return;
	}
	if (
		!Number.isFinite(data.deltaY) ||
		!Number.isFinite(data.clientX) ||
		!Number.isFinite(data.clientY)
	) {
		return;
	}
	// The frame sits at stage (0, 0), so its screen origin is the view offset.
	commitStageView(
		zoomStageAt({
			view: stageView,
			deltaY: data.deltaY,
			screenX: stageView.x + data.clientX * stageView.zoom,
			screenY: stageView.y + data.clientY * stageView.zoom,
		}),
	);
};

// Stage gestures land on the chrome document, not the runtime. Wheel events
// inside the iframe never bubble here, so the two paths cannot double-zoom.
stageViewport.addEventListener(
	'wheel',
	(event) => {
		event.preventDefault();
		if (event.ctrlKey || event.metaKey) {
			const point = viewportPoint(event);
			commitStageView(
				zoomStageAt({
					view: stageView,
					deltaY: event.deltaY,
					screenX: point.screenX,
					screenY: point.screenY,
				}),
			);
			return;
		}
		commitStageView(panStage({ view: stageView, deltaX: event.deltaX, deltaY: event.deltaY }));
	},
	{ passive: false },
);

stageViewport.addEventListener('pointerdown', (event) => {
	if (event.button !== 0) {
		return;
	}
	if (event.target !== stageViewport && event.target !== stageLayer) {
		return;
	}
	isDraggingStage = true;
	stageViewport.setPointerCapture(event.pointerId);
	lastPointerX = event.clientX;
	lastPointerY = event.clientY;
	stageViewport.style.cursor = 'grabbing';
});

stageViewport.addEventListener('pointermove', (event) => {
	if (!isDraggingStage) {
		return;
	}
	commitStageView(
		panStage({
			view: stageView,
			deltaX: lastPointerX - event.clientX,
			deltaY: lastPointerY - event.clientY,
		}),
	);
	lastPointerX = event.clientX;
	lastPointerY = event.clientY;
});

const endStageDrag = () => {
	isDraggingStage = false;
	stageViewport.style.cursor = '';
};
for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
	stageViewport.addEventListener(eventName, endStageDrag);
}

zoomPreset.addEventListener('change', () => {
	if (zoomPreset.value === '') {
		return;
	}
	commitStageView(
		zoomStageTo({
			view: stageView,
			zoom: Number(zoomPreset.value),
			screenX: stageViewport.clientWidth / 2,
			screenY: stageViewport.clientHeight / 2,
		}),
	);
	zoomPreset.selectedIndex = 0;
});

zoomFit.addEventListener('click', () => {
	commitStageView(
		fitStageView({
			bounds: stageBounds(),
			viewportWidth: stageViewport.clientWidth,
			viewportHeight: stageViewport.clientHeight,
		}),
	);
});

// Covers a panel that was not laid out yet, and re-clamps after every resize.
new ResizeObserver(() => {
	if (stageViewport.clientWidth === 0 || stageViewport.clientHeight === 0) {
		return;
	}
	applyInitialView();
	commitStageView(stageView);
}).observe(stageViewport);

// Runs first in head (after meta charset) so the runtime captures window.parent
// and registers its wheel listener before any artboard script.
const injectCanvasRuntime = (parsed, nonceValue) => {
	for (const element of parsed.querySelectorAll('script[' + canvasRuntimeAttribute + ']')) {
		element.remove();
	}
	const runtimeScript = parsed.createElement('script');
	runtimeScript.setAttribute('nonce', nonceValue);
	runtimeScript.setAttribute(canvasRuntimeAttribute, '');
	runtimeScript.textContent = canvasRuntimeSource;
	const charsetMeta = parsed.head.querySelector('meta[charset]');
	if (charsetMeta !== null) {
		charsetMeta.after(runtimeScript);
		return;
	}
	parsed.head.prepend(runtimeScript);
};

// The blob frame inherits this document's nonce CSP, so bare script/style tags
// would be blocked. Stamping the chrome nonce re-allows exactly those tags;
// inline handlers, style attributes, and subresources stay blocked (v1 limit).
// DOMParser never executes scripts, and meta http-equiv is stripped so the
// artboard cannot stack its own policy on top. The canvas runtime is then
// injected into the blob copy only; disk and export HTML never see it.
const stampArtboardHtml = (rawHtml, nonceValue) => {
	const parsed = new DOMParser().parseFromString(rawHtml, 'text/html');
	for (const element of parsed.querySelectorAll('meta[http-equiv]')) {
		element.remove();
	}
	for (const element of parsed.querySelectorAll('script, style')) {
		element.setAttribute('nonce', nonceValue);
	}
	injectCanvasRuntime(parsed, nonceValue);
	return '<!DOCTYPE html>' + parsed.documentElement.outerHTML;
};

const applyArtboardHtml = (html, nonceValue) => {
	if (html === lastHtml) {
		return;
	}
	lastHtml = html;
	revokeCurrentBlob();
	if (html.length === 0) {
		stageViewport.hidden = true;
		zoomPreset.disabled = true;
		zoomFit.disabled = true;
		iframe.removeAttribute('src');
		emptyCopy.hidden = false;
		return;
	}
	emptyCopy.hidden = true;
	stageViewport.hidden = false;
	zoomPreset.disabled = false;
	zoomFit.disabled = false;
	applyInitialView();
	const blob = new Blob([stampArtboardHtml(html, nonceValue)], { type: 'text/html' });
	currentBlobUrl = URL.createObjectURL(blob);
	iframe.src = currentBlobUrl;
};

window.addEventListener('message', (event) => {
	if (iframe.contentWindow !== null && event.source === iframe.contentWindow) {
		handleCanvasMessage(event.data);
		return;
	}
	if (event.origin === 'null') {
		return;
	}
	const data = event.data;
	if (data === null || typeof data !== 'object') {
		return;
	}
	if (data.type === 'artboard:updated') {
		idBadge.textContent = typeof data.artboardId === 'string' ? data.artboardId : '';
		generationBadge.textContent = typeof data.generation === 'number' ? String(data.generation) : '';
		applyArtboardHtml(
			typeof data.html === 'string' ? data.html : '',
			typeof data.cspNonce === 'string' ? data.cspNonce : '',
		);
		errorBanner.hidden = true;
		errorBanner.textContent = '';
		return;
	}
	if (data.type === 'artboard:error') {
		errorBanner.hidden = false;
		errorBanner.textContent = typeof data.message === 'string' ? data.message : 'Could not load artboard.';
		return;
	}
	if (data.type === 'ui:status') {
		if (typeof data.mcpAvailable !== 'boolean') {
			return;
		}
		if (data.mcpAvailable) {
			mcpBanner.hidden = true;
			mcpBanner.textContent = '';
		} else {
			mcpBanner.hidden = false;
			mcpBanner.textContent = mcpUnavailableCopy;
		}
		if (data.handoffStale === true) {
			handoffBadge.hidden = false;
			handoffBadge.textContent = handoffStaleCopy;
			return;
		}
		handoffBadge.hidden = true;
		handoffBadge.textContent = '';
	}
});

window.addEventListener('pagehide', revokeCurrentBlob);
vscodeApi.postMessage({ type: 'artboard:ready' });
`;
