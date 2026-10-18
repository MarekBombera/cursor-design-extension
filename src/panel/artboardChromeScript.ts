// Plain JS inlined into the chrome <script> (no bundler in the webview). Same rules as
// stageGeometry for the *output*: no backtick, no dollar-brace, no less-than-slash.
// Host values are interpolated here, then pasted into artboardChromeHtml.ts.

type ArtboardChromeScriptArgs = {
	embeddedCanvasRuntimeSource: string;
	canvasRuntimeAttribute: string;
	frameHeightMessage: string;
	frameWheelMessage: string;
	mcpUnavailableCopy: string;
};

export const buildArtboardChromeScript = ({
	embeddedCanvasRuntimeSource,
	canvasRuntimeAttribute,
	frameHeightMessage,
	frameWheelMessage,
	mcpUnavailableCopy,
}: ArtboardChromeScriptArgs): string => `const vscodeApi = acquireVsCodeApi();
const stageViewport = document.getElementById('stage-viewport');
const stageLayer = document.getElementById('stage-layer');
const zoomReadout = document.getElementById('zoom-readout');
const zoomPreset = document.getElementById('zoom-preset');
const zoomFit = document.getElementById('zoom-fit');
const canvasRuntimeSource = ${embeddedCanvasRuntimeSource};
const canvasRuntimeAttribute = ${JSON.stringify(canvasRuntimeAttribute)};
const frameHeightMessage = ${JSON.stringify(frameHeightMessage)};
const frameWheelMessage = ${JSON.stringify(frameWheelMessage)};
const emptyCopy = document.getElementById('empty-copy');
const idBadge = document.getElementById('artboard-id-badge');
const generationBadge = document.getElementById('artboard-generation-badge');
const handoffBadge = document.getElementById('handoff-stale-badge');
const errorBanner = document.getElementById('artboard-error');
const mcpBanner = document.getElementById('mcp-banner');
const mcpUnavailableCopy = ${JSON.stringify(mcpUnavailableCopy)};
const handoffStaleCopy = 'Handoff out of date. Re-export.';
const frameRecords = new Map();
const labelNodes = new Map();
const headingNodes = new Map();

const PROVISIONAL_FRAME_HEIGHT = 800;
const ERROR_TILE_HEIGHT = 160;

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

const wrapperHeight = (record) => (record.kind === 'tile' ? ERROR_TILE_HEIGHT : record.height);

const chromeLayoutFrames = () => {
	const frames = [];
	for (const record of frameRecords.values()) {
		const frame = {
			id: record.id,
			x: record.x,
			y: record.y,
			width: record.width,
			height: wrapperHeight(record),
		};
		if (typeof record.group === 'string' && record.group.length > 0) {
			frame.group = record.group;
		}
		frames.push(frame);
	}
	return frames;
};

const stageBounds = () => {
	if (stageViewport.hidden) {
		return null;
	}
	return layoutCanvasChrome({ frames: chromeLayoutFrames() }).bounds;
};

const placeChromeBox = (node, box) => {
	node.style.left = box.x + 'px';
	node.style.top = box.y + 'px';
	node.style.width = box.width + 'px';
	node.style.height = box.height + 'px';
};

const reconcileChromeDecorations = () => {
	const layout = layoutCanvasChrome({ frames: chromeLayoutFrames() });
	const seenLabelIds = new Set();
	for (const box of layout.labels) {
		seenLabelIds.add(box.id);
		let labelNode = labelNodes.get(box.id);
		if (labelNode === undefined) {
			labelNode = document.createElement('div');
			labelNode.className = 'cd-frame-label';
			labelNode.setAttribute('data-cd-frame-label', box.id);
			labelNodes.set(box.id, labelNode);
		}
		const record = frameRecords.get(box.id);
		labelNode.textContent = record === undefined ? '' : record.label;
		placeChromeBox(labelNode, box);
		stageLayer.appendChild(labelNode);
	}
	for (const id of Array.from(labelNodes.keys())) {
		if (!seenLabelIds.has(id)) {
			labelNodes.get(id).remove();
			labelNodes.delete(id);
		}
	}
	const seenGroups = new Set();
	for (const box of layout.headings) {
		seenGroups.add(box.group);
		let headingNode = headingNodes.get(box.group);
		if (headingNode === undefined) {
			headingNode = document.createElement('div');
			headingNode.className = 'cd-group-heading';
			headingNode.setAttribute('data-cd-group-heading', box.group);
			headingNodes.set(box.group, headingNode);
		}
		headingNode.textContent = box.group;
		placeChromeBox(headingNode, box);
		stageLayer.appendChild(headingNode);
	}
	for (const group of Array.from(headingNodes.keys())) {
		if (!seenGroups.has(group)) {
			headingNodes.get(group).remove();
			headingNodes.delete(group);
		}
	}
};

const layoutFrameWrapper = (record) => {
	record.wrapper.style.left = record.x + 'px';
	record.wrapper.style.top = record.y + 'px';
	record.wrapper.style.width = record.width + 'px';
	record.wrapper.style.height = wrapperHeight(record) + 'px';
};

const setFrameActive = (record, activeArtboardId) => {
	if (record.id === activeArtboardId) {
		record.wrapper.classList.add('cd-frame-active');
		return;
	}
	record.wrapper.classList.remove('cd-frame-active');
};

const revokeRecordBlob = (record) => {
	if (record.blobUrl !== undefined) {
		URL.revokeObjectURL(record.blobUrl);
		record.blobUrl = undefined;
	}
};

const removeFrameRecord = (id) => {
	const record = frameRecords.get(id);
	if (record === undefined) {
		return;
	}
	revokeRecordBlob(record);
	record.wrapper.remove();
	frameRecords.delete(id);
};

const revokeAllFrameBlobs = () => {
	for (const record of frameRecords.values()) {
		revokeRecordBlob(record);
	}
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

const handleFrameMessage = (data, frame) => {
	// ponytail: rejects are not logged; wheel fires at 60+ Hz, so logging would spam.
	// Late cd:frame-height / cd:frame-wheel from a previous document is accepted.
	if (data === null || typeof data !== 'object') {
		return;
	}
	if (data.type === frameHeightMessage) {
		if (!Number.isFinite(data.height)) {
			return;
		}
		const next = nextFrameHeight({
			current: frame.height,
			reported: data.height,
			state: frame.heightGuard,
		});
		frame.height = next.height;
		frame.heightGuard = next.state;
		layoutFrameWrapper(frame);
		reconcileChromeDecorations();
		commitStageView(stageView);
		return;
	}
	if (data.type !== frameWheelMessage) {
		return;
	}
	if (
		!Number.isFinite(data.deltaX) ||
		!Number.isFinite(data.deltaY) ||
		!Number.isFinite(data.x) ||
		!Number.isFinite(data.y) ||
		typeof data.ctrlKey !== 'boolean'
	) {
		return;
	}
	if (data.ctrlKey === true) {
		commitStageView(
			zoomStageAt({
				view: stageView,
				deltaY: data.deltaY,
				screenX: stageView.x + (frame.x + data.x) * stageView.zoom,
				screenY: stageView.y + (frame.y + data.y) * stageView.zoom,
			}),
		);
		return;
	}
	commitStageView(
		panStage({
			view: stageView,
			deltaX: data.deltaX,
			deltaY: data.deltaY,
		}),
	);
};

const frameRecordForSource = (source) => {
	for (const record of frameRecords.values()) {
		if (record.iframe !== undefined && record.iframe.contentWindow === source) {
			return record;
		}
	}
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

const tileCopy = (frame, renderFailed) => {
	if (typeof frame.errorMessage === 'string') {
		return frame.errorMessage;
	}
	if (frame.html.trim() === '') {
		return 'Empty artboard file.';
	}
	if (renderFailed) {
		return 'Could not render this frame.';
	}
	return 'Empty artboard file.';
};

const showFrameTile = (record, text) => {
	revokeRecordBlob(record);
	if (record.iframe !== undefined) {
		record.iframe.remove();
		record.iframe = undefined;
	}
	if (record.tile === undefined) {
		const tile = document.createElement('div');
		tile.className = 'cd-frame-tile';
		record.wrapper.appendChild(tile);
		record.tile = tile;
	}
	record.tile.textContent = text;
	record.kind = 'tile';
};

const showFrameIframe = (record, html, nonceValue) => {
	if (record.tile !== undefined) {
		record.tile.remove();
		record.tile = undefined;
	}
	if (record.iframe === undefined) {
		const iframe = document.createElement('iframe');
		iframe.setAttribute('sandbox', 'allow-scripts');
		iframe.setAttribute('scrolling', 'no');
		record.wrapper.appendChild(iframe);
		record.iframe = iframe;
	}
	record.iframe.setAttribute('title', 'Frame: ' + record.label);
	const shouldReload = record.kind !== 'iframe' || html !== record.lastHtml;
	if (!shouldReload) {
		record.kind = 'iframe';
		return;
	}
	revokeRecordBlob(record);
	record.heightGuard = { lastGrowth: 0, frozen: false };
	try {
		const blob = new Blob([stampArtboardHtml(html, nonceValue)], { type: 'text/html' });
		record.blobUrl = URL.createObjectURL(blob);
		record.iframe.src = record.blobUrl;
		record.kind = 'iframe';
	} catch {
		// ponytail: stamp/blob throw is per-frame tile copy only; no chrome log
		showFrameTile(record, 'Could not render this frame.');
	}
};

const ensureFrameRecord = (frame) => {
	const existing = frameRecords.get(frame.id);
	if (existing !== undefined) {
		existing.label = frame.label;
		existing.x = frame.x;
		existing.y = frame.y;
		existing.width = frame.width;
		existing.group = frame.group;
		return existing;
	}
	const wrapper = document.createElement('div');
	wrapper.className = 'cd-frame';
	wrapper.setAttribute('data-cd-frame-id', frame.id);
	const record = {
		id: frame.id,
		label: frame.label,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		group: frame.group,
		height: PROVISIONAL_FRAME_HEIGHT,
		kind: 'tile',
		lastHtml: undefined,
		heightGuard: { lastGrowth: 0, frozen: false },
		wrapper: wrapper,
		iframe: undefined,
		tile: undefined,
		blobUrl: undefined,
	};
	frameRecords.set(frame.id, record);
	return record;
};

const isOptionalString = (value) => value === undefined || typeof value === 'string';

const isValidPostedFrame = (entry) =>
	entry !== null &&
	typeof entry === 'object' &&
	typeof entry.id === 'string' &&
	typeof entry.label === 'string' &&
	typeof entry.html === 'string' &&
	Number.isFinite(entry.x) &&
	Number.isFinite(entry.y) &&
	Number.isFinite(entry.width) &&
	isOptionalString(entry.group) &&
	isOptionalString(entry.errorMessage);

const isValidCanvasUpdated = (data) =>
	typeof data.activeArtboardId === 'string' &&
	typeof data.cspNonce === 'string' &&
	Number.isFinite(data.generation) &&
	Array.isArray(data.frames);

const applyEmptyStage = () => {
	stageViewport.hidden = true;
	zoomPreset.disabled = true;
	zoomFit.disabled = true;
	emptyCopy.hidden = false;
};

const reconcileCanvasFrames = (data) => {
	const seenIds = new Set();
	for (const entry of data.frames) {
		if (!isValidPostedFrame(entry)) {
			if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string') {
				removeFrameRecord(entry.id);
			}
			continue;
		}
		seenIds.add(entry.id);
		const record = ensureFrameRecord(entry);
		stageLayer.appendChild(record.wrapper);
		const showTile = typeof entry.errorMessage === 'string' || entry.html.trim() === '';
		if (showTile) {
			showFrameTile(record, tileCopy(entry, false));
		} else {
			showFrameIframe(record, entry.html, data.cspNonce);
		}
		record.lastHtml = entry.html;
		layoutFrameWrapper(record);
		setFrameActive(record, data.activeArtboardId);
	}
	for (const id of Array.from(frameRecords.keys())) {
		if (!seenIds.has(id)) {
			removeFrameRecord(id);
		}
	}
	reconcileChromeDecorations();
	if (frameRecords.size === 0) {
		applyEmptyStage();
		return;
	}
	emptyCopy.hidden = true;
	stageViewport.hidden = false;
	zoomPreset.disabled = false;
	zoomFit.disabled = false;
	applyInitialView();
	commitStageView(stageView);
};

window.addEventListener('message', (event) => {
	const sourceRecord = frameRecordForSource(event.source);
	if (sourceRecord !== undefined) {
		handleFrameMessage(event.data, sourceRecord);
		return;
	}
	if (event.origin === 'null') {
		return;
	}
	const data = event.data;
	if (data === null || typeof data !== 'object') {
		return;
	}
	if (data.type === 'canvas:updated') {
		if (!isValidCanvasUpdated(data)) {
			return;
		}
		idBadge.textContent = data.activeArtboardId;
		generationBadge.textContent = data.activeArtboardId === '' ? '' : String(data.generation);
		reconcileCanvasFrames(data);
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

window.addEventListener('pagehide', revokeAllFrameBlobs);
vscodeApi.postMessage({ type: 'artboard:ready' });
`;
