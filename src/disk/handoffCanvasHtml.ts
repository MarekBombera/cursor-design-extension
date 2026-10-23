import canvasRuntimeSource from '../webview/frame/runtime.ts?iife';
import stageGeometrySource from '../webview/stageGeometry.ts?iife';
import {
	CANVAS_RUNTIME_ATTRIBUTE,
	FRAME_HEIGHT_MESSAGE,
	FRAME_WHEEL_MESSAGE,
} from '../webview/frame/frameMessages';
import { FIT_PADDING, layoutCanvasChrome } from '../webview/stageGeometry';

// View-only canvas.html for a handoff: every frame at its layout position, at scale 1, growing
// to its measured height. Frame index.html files stay pristine; only the srcdoc copies here carry
// the measuring runtime.
// ponytail: canvas.html carries every frame's HTML a second time, with no size cap.
// ponytail: if scripts are off or a frame never reports, it stays PROVISIONAL_FRAME_HEIGHT tall.
// ponytail: assets/ is not copied into the handoff, so relative images may be missing.
// ponytail: an empty artboard file previews as an empty frame (no error tile).

const PROVISIONAL_FRAME_HEIGHT = 800;

export type CanvasPreviewFrame = {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	group?: string;
	folder: string;
	html: string;
};

const escapeHtml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const HEAD_START_TAG = /<head(?=[\s/>])[^>]*>/i;
const HTML_START_TAG = /<html(?=[\s/>])[^>]*>/i;

const injectionIndex = (html: string): number => {
	for (const pattern of [HEAD_START_TAG, HTML_START_TAG]) {
		const match = pattern.exec(html);
		if (match !== null) {
			return match.index + match[0].length;
		}
	}
	return 0;
};

// The frame's exact HTML plus one inserted block (base + runtime). String insertion only.
export const buildPreviewFrameHtml = ({
	html,
	folder,
	id,
}: {
	html: string;
	folder: string;
	id: string;
}): string => {
	const baseHref = `${encodeURIComponent(folder)}/${encodeURIComponent(id)}/`;
	const block = `<base href="${baseHref}"><script ${CANVAS_RUNTIME_ATTRIBUTE}>${canvasRuntimeSource}</script>`;
	const index = injectionIndex(html);
	return `${html.slice(0, index)}${block}${html.slice(index)}`;
};

const boxStyle = ({
	x,
	y,
	width,
	height,
}: {
	x: number;
	y: number;
	width: number;
	height: number;
}): string => `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;

// Plain JS, free of the less-than-slash sequence (the ?iife strings are escaped). Accepts only
// allowlisted messages from its own frames' windows and never posts to frames.
const previewControllerSource = (
	entries: readonly { id: string; top: number; right: number }[],
): string => `(() => {
${stageGeometrySource}
const PAGE_PADDING = ${FIT_PADDING};
const heightType = ${JSON.stringify(FRAME_HEIGHT_MESSAGE)};
const wheelType = ${JSON.stringify(FRAME_WHEEL_MESSAGE)};
const entries = ${JSON.stringify(entries).replaceAll('<', '\\u003c')};
const records = [];
for (const iframe of document.querySelectorAll('iframe[data-cd-frame]')) {
	const id = iframe.getAttribute('data-cd-frame');
	for (const entry of entries) {
		if (entry.id === id) {
			records.push({
				iframe: iframe,
				top: entry.top,
				right: entry.right,
				height: ${PROVISIONAL_FRAME_HEIGHT},
				guard: { lastGrowth: 0, frozen: false },
			});
		}
	}
}
const resizePage = () => {
	let bottom = 0;
	let right = 0;
	for (const record of records) {
		bottom = Math.max(bottom, record.top + record.height);
		right = Math.max(right, record.right);
	}
	document.body.style.height = bottom + PAGE_PADDING + 'px';
	document.body.style.width = right + PAGE_PADDING + 'px';
};
window.addEventListener('message', (event) => {
	let record;
	for (const candidate of records) {
		if (candidate.iframe.contentWindow === event.source) {
			record = candidate;
		}
	}
	const data = event.data;
	if (record === undefined || data === null || typeof data !== 'object' || Array.isArray(data)) {
		return;
	}
	if (data.type === heightType) {
		if (!Number.isFinite(data.height)) {
			return;
		}
		const next = stageGeometry.nextFrameHeight({ current: record.height, reported: data.height, state: record.guard });
		record.height = next.height;
		record.guard = next.state;
		record.iframe.style.height = next.height + 'px';
		resizePage();
		return;
	}
	if (data.type === wheelType) {
		if (!Number.isFinite(data.deltaX) || !Number.isFinite(data.deltaY) || data.ctrlKey !== false) {
			return;
		}
		window.scrollBy(data.deltaX, data.deltaY);
	}
});
resizePage();
})();`;

const PREVIEW_STYLE = `html { background: #f2f2f2; }
body { margin: 0; position: relative; font-family: system-ui, -apple-system, sans-serif; }
.cd-label, .cd-heading { position: absolute; box-sizing: border-box; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cd-label { font-size: 12px; line-height: 24px; color: #555; }
.cd-heading { font-size: 14px; font-weight: 600; line-height: 32px; color: #222; }
iframe { position: absolute; display: block; border: 0; background: #fff; box-shadow: 0 0 0 1px #d0d0d0; }`;

export const buildCanvasPreviewHtml = ({
	exportId,
	frames,
}: {
	exportId: string;
	frames: readonly CanvasPreviewFrame[];
}): string => {
	// Same label and heading boxes as the live stage. Offsets depend only on x/y/width, so they are
	// fixed at build time; heights change at runtime.
	const { labels, headings, bounds } = layoutCanvasChrome({
		frames: frames.map(({ id, x, y, width, group }) => ({
			id,
			x,
			y,
			width,
			height: PROVISIONAL_FRAME_HEIGHT,
			group,
		})),
	});
	const dx = bounds === null ? 0 : FIT_PADDING - bounds.x;
	const dy = bounds === null ? 0 : FIT_PADDING - bounds.y;

	const headingMarkup = headings.map(
		({ group, ...box }) =>
			`<div class="cd-heading" style="${boxStyle({ ...box, x: box.x + dx, y: box.y + dy })}">${escapeHtml(group)}</div>`,
	);
	const frameMarkup = frames.map((frame, index) => {
		const x = frame.x + dx;
		const y = frame.y + dy;
		const label = escapeHtml(frame.label);
		const srcdoc = escapeHtml(buildPreviewFrameHtml(frame));
		const labelBox = labels[index];
		return `<div class="cd-label" style="${boxStyle({ ...labelBox, x: labelBox.x + dx, y: labelBox.y + dy })}">${label}</div>
<iframe data-cd-frame="${escapeHtml(frame.id)}" sandbox="allow-scripts" scrolling="no" title="${label}" style="${boxStyle({ x, y, width: frame.width, height: PROVISIONAL_FRAME_HEIGHT })}" srcdoc="${srcdoc}"></iframe>`;
	});
	const entries = frames.map((frame) => ({
		id: frame.id,
		top: frame.y + dy,
		right: frame.x + dx + frame.width,
	}));
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Canvas preview ${escapeHtml(exportId)}</title>
<style>
${PREVIEW_STYLE}
</style>
</head>
<body>
${[...headingMarkup, ...frameMarkup].join('\n')}
<script>
${previewControllerSource(entries)}
</script>
</body>
</html>
`;
};
