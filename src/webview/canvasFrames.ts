import type { PostedCanvasFrame } from './hostMessages';
import type { FrameHeightGuard } from './stageGeometry';

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
