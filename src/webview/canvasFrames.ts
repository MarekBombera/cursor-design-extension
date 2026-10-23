import type { FrameRect } from './frame/frameMessages';
import type { FrameGesture } from './frameGesture';
import type { PostedCanvasFrame } from './hostMessages';
import {
	type ChromeFrame,
	type FrameHeightGuard,
	frameRectToScreen,
	nextFrameHeight,
	type StageRect,
	type StageView,
} from './stageGeometry';

// How each canvas:updated changes the stage's frame list. Pure: App owns the $state array and
// assigns the result. The host re-posts the whole canvas on every tab switch, so an identical
// post must change nothing.

export type StageFrame = {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	kind: 'tile' | 'iframe';
	tileText: string;
	html: string;
};

export type FrameRecord = StageFrame & {
	group: string | undefined;
	// Measured iframe height; the wrapper uses TILE_HEIGHT while kind is 'tile'.
	measuredHeight: number;
	guard: FrameHeightGuard;
};

export const PROVISIONAL_FRAME_HEIGHT = 800;
export const TILE_HEIGHT = 160;
export const EMPTY_ARTBOARD_COPY = 'Empty artboard file.';
export const RENDER_ERROR_COPY = 'Could not render this frame.';

const resetGuard = (): FrameHeightGuard => ({ lastGrowth: 0, frozen: false });

const newRecord = (entry: PostedCanvasFrame): FrameRecord => ({
	id: entry.id,
	label: entry.label,
	x: entry.x,
	y: entry.y,
	width: entry.width,
	group: entry.group,
	height: TILE_HEIGHT,
	measuredHeight: PROVISIONAL_FRAME_HEIGHT,
	guard: resetGuard(),
	kind: 'tile',
	tileText: '',
	html: '',
});

const mergeRecord = (record: FrameRecord, entry: PostedCanvasFrame): FrameRecord => {
	const placed: FrameRecord = {
		...record,
		label: entry.label,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		group: entry.group,
		html: entry.html,
	};
	if (entry.errorMessage !== undefined || entry.html.trim() === '') {
		return {
			...placed,
			kind: 'tile',
			tileText: entry.errorMessage ?? EMPTY_ARTBOARD_COPY,
			height: TILE_HEIGHT,
		};
	}
	// A new document (Frame's blob effect reloads on kind and html) restarts height tracking but
	// keeps the measured height. The nonce also reloads it, but it is fixed per webview.
	const reloads = record.kind !== 'iframe' || entry.html !== record.html;
	return {
		...placed,
		kind: 'iframe',
		guard: reloads ? resetGuard() : record.guard,
		height: record.measuredHeight,
	};
};

// Existing records keep their order (moving an iframe in the DOM reloads it); new frames are
// appended in the host's order; frames the host no longer sends are dropped.
export const mergeCanvasFrames = ({
	records,
	frames,
}: {
	records: readonly FrameRecord[];
	frames: readonly PostedCanvasFrame[];
}): FrameRecord[] => {
	const entries = new Map(frames.map((entry) => [entry.id, entry]));
	const kept = records.flatMap((record) => {
		const entry = entries.get(record.id);
		return entry === undefined ? [] : [mergeRecord(record, entry)];
	});
	const known = new Set(records.map((record) => record.id));
	const added = frames
		.filter((entry) => !known.has(entry.id))
		.map((entry) => mergeRecord(newRecord(entry), entry));
	return [...kept, ...added];
};

// Frames that can hold a hover or pick: a tile has no document, so no runtime to clear them.
export const liveIframeIds = (records: readonly FrameRecord[]): Set<string> =>
	new Set(records.filter((record) => record.kind === 'iframe').map((record) => record.id));

// An iframe reported its content height. Always tracked in `measuredHeight` (a tile restores it
// when the frame recovers); only an iframe draws it. The growth guard lives in nextFrameHeight.
export const applyFrameHeight = ({
	record,
	reported,
}: {
	record: FrameRecord;
	reported: number;
}): FrameRecord => {
	const next = nextFrameHeight({
		current: record.measuredHeight,
		reported,
		state: record.guard,
	});
	return {
		...record,
		measuredHeight: next.height,
		guard: next.state,
		height: record.kind === 'iframe' ? next.height : record.height,
	};
};

// The iframe failed to render (Frame's onRenderError): show a tile with the error copy instead.
export const demoteToTile = (record: FrameRecord): FrameRecord => ({
	...record,
	kind: 'tile',
	tileText: RENDER_ERROR_COPY,
	height: TILE_HEIGHT,
});

// What the stage draws: disk frames, with the gesture preview on the one it belongs to. Order is
// unchanged, and left/top/width never reload an iframe.
export const withGestureOverride = ({
	frames,
	gesture,
}: {
	frames: readonly FrameRecord[];
	gesture: FrameGesture | undefined;
}): FrameRecord[] =>
	frames.map((frame) =>
		gesture?.override !== undefined && frame.id === gesture.id
			? { ...frame, ...gesture.override }
			: frame,
	);

// layoutCanvasChrome input; an absent or empty group stays a key-less ungrouped frame.
export const toChromeFrames = (frames: readonly FrameRecord[]): ChromeFrame[] =>
	frames.map(({ id, x, y, width, height, group }) => {
		const box = { id, x, y, width, height };
		return group !== undefined && group.length > 0 ? { ...box, group } : box;
	});

// A frame-local hover or pick rect in viewport px. Undefined without a target or rect, before
// the first committed view, or for a frame that left the stage.
export const frameOutline = ({
	view,
	frames,
	target,
}: {
	view: StageView | undefined;
	frames: readonly FrameRecord[];
	target: { frameId: string; rect: FrameRect | null } | undefined;
}): StageRect | undefined => {
	if (target === undefined || target.rect === null || view === undefined) {
		return undefined;
	}
	const frame = frames.find((candidate) => candidate.id === target.frameId);
	return frame === undefined ? undefined : frameRectToScreen({ view, frame, rect: target.rect });
};
