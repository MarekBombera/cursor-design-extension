import {
	CorruptCanvasError,
	InvalidArtboardIdError,
	UnsupportedCanvasVersionError,
} from './errors';
import {
	CANVAS_SCHEMA_VERSION,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	MAX_FRAME_WIDTH,
	MIN_FRAME_WIDTH,
} from './layout';
import { parseArtboardId } from './parse';

// One artboard's slot on the shared stage, in stage px. Height is never stored; the panel measures it.
export type CanvasFrame = {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	group?: string;
};

// Shape of .cursor-design/canvas.json. This is the STORED layout, not the resolved list list_artboards returns.
export type CanvasLayout = {
	version: typeof CANVAS_SCHEMA_VERSION;
	frames: CanvasFrame[];
};

export type CanvasPlacement = {
	x?: number;
	y?: number;
	width?: number;
	label?: string;
	group?: string;
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const clampFrameWidth = (width: number): number =>
	Math.min(MAX_FRAME_WIDTH, Math.max(MIN_FRAME_WIDTH, width));

// Key order is fixed so serialized frames always read id, label, x, y, width, group.
const buildFrame = ({ id, label, x, y, width, group }: CanvasFrame): CanvasFrame => {
	const frame: CanvasFrame = { id, label, x, y, width };
	if (group !== undefined && group.length > 0) {
		frame.group = group;
	}
	return frame;
};

const parseFrameId = (value: unknown): string => {
	try {
		return parseArtboardId(value);
	} catch (error: unknown) {
		if (error instanceof InvalidArtboardIdError) {
			throw new CorruptCanvasError({ cause: error });
		}
		throw error;
	}
};

const parseFrameGroup = (value: unknown): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new CorruptCanvasError();
	}
	return value.length > 0 ? value : undefined;
};

const parseCanvasFrame = (value: unknown): CanvasFrame => {
	if (!isJsonRecord(value)) {
		throw new CorruptCanvasError();
	}
	const id = parseFrameId(value.id);
	if (
		typeof value.label !== 'string' ||
		!isFiniteNumber(value.x) ||
		!isFiniteNumber(value.y) ||
		!isFiniteNumber(value.width)
	) {
		throw new CorruptCanvasError();
	}
	return buildFrame({
		id,
		label: value.label,
		x: value.x,
		y: value.y,
		width: clampFrameWidth(value.width),
		group: parseFrameGroup(value.group),
	});
};

// Strict reader for canvas.json. Throws CORRUPT_CANVAS or UNSUPPORTED_CANVAS_VERSION so a broken file is never rewritten.
export const parseCanvasLayout = (value: unknown): CanvasLayout => {
	if (!isJsonRecord(value)) {
		throw new CorruptCanvasError();
	}
	if (!Number.isInteger(value.version)) {
		throw new CorruptCanvasError();
	}
	if (value.version !== CANVAS_SCHEMA_VERSION) {
		throw new UnsupportedCanvasVersionError(value.version as number);
	}
	if (!Array.isArray(value.frames)) {
		throw new CorruptCanvasError();
	}
	const seenIds = new Set<string>();
	const frames = value.frames.map((rawFrame: unknown) => {
		const frame = parseCanvasFrame(rawFrame);
		if (seenIds.has(frame.id)) {
			throw new CorruptCanvasError();
		}
		seenIds.add(frame.id);
		return frame;
	});
	return { version: CANVAS_SCHEMA_VERSION, frames };
};

export const serializeCanvasLayout = (layout: CanvasLayout): string =>
	`${JSON.stringify({ version: layout.version, frames: layout.frames.map(buildFrame) }, null, 2)}\n`;

// Turns stored frames into what the panel and Agent see: stored frames for artboards that still exist, then auto-placed ones. Pure; never writes.
export const resolveCanvasFrames = ({
	stored,
	artboards,
}: {
	stored: readonly CanvasFrame[];
	artboards: readonly { artboardId: string; title: string }[];
}): CanvasFrame[] => {
	const listedIds = new Set(artboards.map(({ artboardId }) => artboardId));
	const resolved = stored.filter((frame) => listedIds.has(frame.id)).map(buildFrame);
	const storedIds = new Set(stored.map(({ id }) => id));
	for (const { artboardId, title } of artboards) {
		if (storedIds.has(artboardId)) {
			continue;
		}
		let x = 0;
		let y = 0;
		let rightEdge: number | undefined;
		for (const frame of resolved) {
			const frameRight = frame.x + frame.width;
			// Strict greater-than: the earlier frame keeps a tied right edge.
			if (rightEdge === undefined || frameRight > rightEdge) {
				rightEdge = frameRight;
				x = frameRight + FRAME_GAP;
				y = frame.y;
			}
		}
		resolved.push({
			id: artboardId,
			label: title === '' ? artboardId : title,
			x,
			y,
			width: DEFAULT_FRAME_WIDTH,
		});
	}
	return resolved;
};

// Applies a partial update to ONE frame and returns the next stored layout, leaving every other stored entry (orphans too) untouched.
export const placeCanvasFrame = ({
	layout,
	current,
	placement,
}: {
	layout: CanvasLayout;
	current: CanvasFrame;
	placement: CanvasPlacement;
}): CanvasLayout => {
	const nextFrame = buildFrame({
		id: current.id,
		label: placement.label ?? current.label,
		x: placement.x ?? current.x,
		y: placement.y ?? current.y,
		width: placement.width === undefined ? current.width : clampFrameWidth(placement.width),
		group: placement.group ?? current.group,
	});
	const storedIndex = layout.frames.findIndex(({ id }) => id === current.id);
	const frames =
		storedIndex === -1
			? [...layout.frames, nextFrame]
			: layout.frames.map((frame, index) => (index === storedIndex ? nextFrame : frame));
	return { version: CANVAS_SCHEMA_VERSION, frames };
};
