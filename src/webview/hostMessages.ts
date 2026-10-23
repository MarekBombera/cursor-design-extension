import type { StageView } from './stageGeometry';

// Host ↔ chrome message contract, defined once. The host `import type`s these; the chrome
// parses every posted value through `parseHostMessage` first, and the host parses chrome
// messages with `parseChromeMessage` (src/host/chromeMessages.ts). DOM-free on purpose: the root
// tsconfig (no DOM lib) type-checks this file through the host imports.

export type PostedCanvasFrame = {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	group?: string;
	// This frame's artboard meta generation (0 when meta is absent).
	generation: number;
	html: string;
	errorMessage?: string;
};

export type CanvasUpdatedMessage = {
	type: 'canvas:updated';
	activeArtboardId: string;
	generation: number;
	cspNonce: string;
	frames: PostedCanvasFrame[];
};

type ArtboardErrorMessage = {
	type: 'artboard:error';
	message: string;
};

type UiStatusMessage = {
	type: 'ui:status';
	mcpAvailable: boolean;
	handoffStale: boolean;
};

export type HostMessage = CanvasUpdatedMessage | ArtboardErrorMessage | UiStatusMessage;

export type FramePlacement = { x: number; y: number; width: number };

// Sent once per drag/resize/nudge on release. `base` is the frame's placement at gesture start.
export type FramePlaceMessage = {
	type: 'frame:place';
	id: string;
	x: number;
	y: number;
	width: number;
	base: FramePlacement;
};

export type ChromeMessage = { type: 'artboard:ready' } | FramePlaceMessage;

const ARTBOARD_ERROR_FALLBACK = 'Could not load artboard.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object';

const isOptionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number => Number.isFinite(value);

const parsePostedFrame = (entry: unknown): PostedCanvasFrame | undefined => {
	if (
		!isRecord(entry) ||
		typeof entry.id !== 'string' ||
		typeof entry.label !== 'string' ||
		typeof entry.html !== 'string' ||
		!isFiniteNumber(entry.x) ||
		!isFiniteNumber(entry.y) ||
		!isFiniteNumber(entry.width) ||
		!isFiniteNumber(entry.generation) ||
		!isOptionalString(entry.group) ||
		!isOptionalString(entry.errorMessage)
	) {
		return undefined;
	}
	const frame: PostedCanvasFrame = {
		id: entry.id,
		label: entry.label,
		x: entry.x,
		y: entry.y,
		width: entry.width,
		generation: entry.generation,
		html: entry.html,
	};
	if (entry.group !== undefined) {
		frame.group = entry.group;
	}
	if (entry.errorMessage !== undefined) {
		frame.errorMessage = entry.errorMessage;
	}
	return frame;
};

// A frame entry failing validation is dropped; the chrome then removes that id like any id
// missing from a valid canvas:updated.
const parseCanvasUpdated = (data: Record<string, unknown>): CanvasUpdatedMessage | undefined => {
	if (
		typeof data.activeArtboardId !== 'string' ||
		typeof data.cspNonce !== 'string' ||
		!isFiniteNumber(data.generation) ||
		!Array.isArray(data.frames)
	) {
		return undefined;
	}
	const frames: PostedCanvasFrame[] = [];
	for (const entry of data.frames as unknown[]) {
		const frame = parsePostedFrame(entry);
		if (frame !== undefined) {
			frames.push(frame);
		}
	}
	return {
		type: 'canvas:updated',
		activeArtboardId: data.activeArtboardId,
		generation: data.generation,
		cspNonce: data.cspNonce,
		frames,
	};
};

// Unknown `type` or a malformed payload returns undefined; never throws.
export const parseHostMessage = (data: unknown): HostMessage | undefined => {
	if (!isRecord(data)) {
		return undefined;
	}
	if (data.type === 'canvas:updated') {
		return parseCanvasUpdated(data);
	}
	if (data.type === 'artboard:error') {
		return {
			type: 'artboard:error',
			message: typeof data.message === 'string' ? data.message : ARTBOARD_ERROR_FALLBACK,
		};
	}
	if (data.type === 'ui:status') {
		if (typeof data.mcpAvailable !== 'boolean') {
			return undefined;
		}
		return {
			type: 'ui:status',
			mcpAvailable: data.mcpAvailable,
			handoffStale: data.handoffStale === true,
		};
	}
	return undefined;
};

// Webview state survives hide/show (the webview reloads), so the view is restored from it.
// Anything malformed is rejected and the first layout fits instead.
export const parseSavedStageView = (value: unknown): StageView | undefined => {
	if (
		!isRecord(value) ||
		!isFiniteNumber(value.x) ||
		!isFiniteNumber(value.y) ||
		!isFiniteNumber(value.zoom) ||
		value.zoom <= 0
	) {
		return undefined;
	}
	return { x: value.x, y: value.y, zoom: value.zoom };
};

export type MessageRoute = { kind: 'frame'; frameId: string } | { kind: 'host' } | { kind: 'drop' };

// Who sent a window message. A registered frame's window wins, whatever the payload claims. An
// opaque-origin sender that is not (or no longer) registered never reaches the host parser.
// `source` null never matches: a detached iframe's contentWindow is null too.
export const routeMessage = ({
	source,
	origin,
	iframes,
}: {
	source: unknown;
	origin: string;
	iframes: ReadonlyMap<string, { contentWindow: unknown }>;
}): MessageRoute => {
	if (source !== null) {
		for (const [frameId, iframe] of iframes) {
			if (iframe.contentWindow === source) {
				return { kind: 'frame', frameId };
			}
		}
	}
	return origin === 'null' ? { kind: 'drop' } : { kind: 'host' };
};
