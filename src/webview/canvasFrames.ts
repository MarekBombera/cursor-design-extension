import type { FrameRect } from './frame/frameMessages';
import type { FrameGesture } from './frameGesture';
import type { ArtboardEditedMessage, PostedCanvasFrame } from './hostMessages';
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
	// The artboard generation the host last posted for this frame (comment:create's pick check).
	generation: number;
	// The disk HTML's hash the host last posted (the base of an Edit-mode change, 9c).
	hash: string;
	// 9f: the host's undo / redo availability for this frame, from the last post or answer taken.
	canUndo: boolean;
	canRedo: boolean;
	kind: 'tile' | 'iframe';
	// Why a tile shows: an empty file or a failure. Read only while kind is 'tile'.
	tileKind: 'empty' | 'error';
	tileText: string;
	// The latest known tagged copy: posted, or adopted from an edit answer (9e).
	html: string;
	// What the iframe was built from; Frame's blob effect reads only these two, so adopting an
	// edit answer never reloads. The version bumps on every reload.
	documentHtml: string;
	documentVersion: number;
};

export type FrameRecord = StageFrame & {
	// Hashes the user's own adopted saves replaced since the last outside change (9e): a post
	// carrying one with an older generation read disk before the save.
	replacedHashes: readonly string[];
	group: string | undefined;
	// Measured iframe height; the wrapper uses TILE_HEIGHT while kind is 'tile'.
	measuredHeight: number;
	// False until the first cd:frame-height: measuredHeight is still PROVISIONAL_FRAME_HEIGHT.
	heightReported: boolean;
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
	generation: entry.generation,
	hash: '',
	canUndo: false,
	canRedo: false,
	height: TILE_HEIGHT,
	measuredHeight: PROVISIONAL_FRAME_HEIGHT,
	heightReported: false,
	guard: resetGuard(),
	kind: 'tile',
	tileKind: 'empty',
	tileText: '',
	html: '',
	documentHtml: '',
	documentVersion: 0,
	replacedHashes: [],
});

// A refresh that read disk before the user's own save: it carries a hash that save replaced and
// an older generation. Keep the adopted copy (9c handed this ceiling to 9e).
const isStalePreWrite = (record: FrameRecord, entry: PostedCanvasFrame): boolean =>
	entry.errorMessage === undefined &&
	record.kind === 'iframe' &&
	record.replacedHashes.includes(entry.hash) &&
	entry.generation < record.generation;

const mergeRecord = (record: FrameRecord, entry: PostedCanvasFrame): FrameRecord => {
	const placement = {
		label: entry.label,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		group: entry.group,
	};
	if (isStalePreWrite(record, entry)) {
		return { ...record, ...placement };
	}
	const placed: FrameRecord = {
		...record,
		...placement,
		generation: entry.generation,
		hash: entry.hash,
		html: entry.html,
		canUndo: entry.canUndo,
		canRedo: entry.canRedo,
		// The echo of the user's own save keeps the list; any other change ends it.
		replacedHashes: entry.hash === record.hash ? record.replacedHashes : [],
	};
	if (entry.errorMessage !== undefined || entry.html.trim() === '') {
		return {
			...placed,
			kind: 'tile',
			tileKind: entry.errorMessage === undefined ? 'empty' : 'error',
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
		documentHtml: reloads ? entry.html : record.documentHtml,
		documentVersion: reloads ? record.documentVersion + 1 : record.documentVersion,
	};
};

// 9e: the host's answer to the user's own edit. Taken only while the record still holds the
// HTML the edit was based on: otherwise a newer post (the echo, or an outside change) already
// won. The iframe already shows the edit (its preview), so nothing reloads.
export const adoptEditAnswer = ({
	record,
	answer,
	baseHash,
}: {
	record: FrameRecord;
	answer: Pick<ArtboardEditedMessage, 'html' | 'hash' | 'generation' | 'canUndo' | 'canRedo'>;
	baseHash: string;
}): FrameRecord =>
	record.kind === 'iframe' && record.hash === baseHash
		? {
				...record,
				html: answer.html,
				hash: answer.hash,
				generation: answer.generation,
				canUndo: answer.canUndo,
				canRedo: answer.canRedo,
				replacedHashes: [...record.replacedHashes, baseHash],
			}
		: record;

// 9e: rebuild the iframe from the latest known copy (a refused edit drops its preview), keeping
// every edit already adopted.
export const reloadFrame = (record: FrameRecord): FrameRecord =>
	record.kind === 'iframe'
		? {
				...record,
				documentHtml: record.html,
				documentVersion: record.documentVersion + 1,
				guard: resetGuard(),
			}
		: record;

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
		heightReported: true,
		guard: next.state,
		height: record.kind === 'iframe' ? next.height : record.height,
	};
};

// The size in a frame's label: the drawn width (a resize preview included) by the last reported
// height, or the width alone before the first report. A tile shows none: it is not the artboard's
// size, and its last measured height would be stale.
export const frameSizeText = (frame: FrameRecord): string => {
	if (frame.kind !== 'iframe') {
		return '';
	}
	return frame.heightReported ? `${frame.width} × ${frame.measuredHeight}` : String(frame.width);
};

// The iframe failed to render (Frame's onRenderError): show a tile with the error copy instead.
export const demoteToTile = (record: FrameRecord): FrameRecord => ({
	...record,
	kind: 'tile',
	tileKind: 'error',
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
