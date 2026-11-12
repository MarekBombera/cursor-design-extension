import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type { AnchorRect, AnchorRequest, FrameRect } from './frame/frameMessages';
import type { PostedComment } from './hostMessages';
import { type StagePoint, type StageView, stageToScreen } from './stageGeometry';

// Pin rules (8f2). Pure: App holds the comments, the live anchors and the open thread, and draws
// what layoutPins returns with Pins.svelte.

type LiveAnchor = { box: FrameRect | null; visible: FrameRect | null };

// Frame id, then comment id. Maps, never plain objects: the ids come from an untrusted frame.
export type AnchorState = ReadonlyMap<string, ReadonlyMap<string, LiveAnchor>>;

export type PinBadge = 'missing' | 'stale' | 'unchecked';

// x, y: viewport-local screen px of the pin's center.
export type PlacedPin = {
	id: string;
	x: number;
	y: number;
	status: PostedComment['status'];
	badge: PinBadge | undefined;
	label: string;
};

// A genuine answer never puts a pin outside `visible` or the frame; this is rounding room.
const PIN_TOLERANCE_PX = 0.5;

const EXCERPT_CHARS = 60;

const STATUS_LABELS: Record<PostedComment['status'], string> = {
	open: 'Open',
	sent: 'Sent',
	resolved: 'Resolved',
};

// The read-only thread popover's copy (CommentThread.svelte).
export const THREAD_STATUS_COPY: Record<PostedComment['status'], string> = {
	open: 'Open',
	sent: 'Sent to Agent',
	resolved: 'Resolved',
};

export const THREAD_BADGE_COPY: Record<PinBadge, string> = {
	missing: 'Target missing: the element is gone or no longer unique.',
	stale: 'Stale: the element changed since this comment.',
	unchecked:
		"Unchecked: this target can't be checked from disk (made by script, too complex, or the file can't be read).",
};

const BADGE_LABELS: Record<PinBadge, string> = {
	missing: 'target missing',
	stale: 'stale',
	unchecked: 'unchecked',
};

// A cd:anchor-rects from frameId replaces only that frame's answers, so a forged message can move
// or hide its own frame's pins and nothing else. A duplicate id keeps the last entry.
export const applyAnchorRects = ({
	state,
	frameId,
	anchors,
}: {
	state: AnchorState;
	frameId: string;
	anchors: readonly AnchorRect[];
}): AnchorState => {
	const next = new Map(state);
	next.set(frameId, new Map(anchors.map(({ id, box, visible }) => [id, { box, visible }])));
	return next;
};

export const dropFrameAnchors = ({
	state,
	frameId,
}: {
	state: AnchorState;
	frameId: string;
}): AnchorState => {
	if (!state.has(frameId)) {
		return state;
	}
	const next = new Map(state);
	next.delete(frameId);
	return next;
};

// One cd:anchors per live frame: its element comments in comments.json order, every status. A
// frame with none gets [] so its runtime stops observing.
export const anchorSends = ({
	comments,
	frameIds,
}: {
	comments: readonly PostedComment[];
	frameIds: Iterable<string>;
}): { frameId: string; anchors: AnchorRequest[] }[] =>
	Array.from(frameIds, (frameId) => ({
		frameId,
		anchors: comments
			.filter((comment) => comment.frameId === frameId && !comment.isPage)
			.map((comment) => ({ id: comment.id, selector: comment.selector })),
	}));

// A resolved comment's target changed by definition, so it carries no badge. The live answer
// beats the disk flags: a target the frame cannot find is missing whatever disk said.
export const pinBadge = ({
	comment,
	live,
}: {
	comment: PostedComment;
	live: LiveAnchor | undefined;
}): PinBadge | undefined => {
	if (comment.status === 'resolved') {
		return undefined;
	}
	if (live?.box === null || comment.targetMissing === true) {
		return 'missing';
	}
	if (comment.stale === true) {
		return 'stale';
	}
	if (comment.stale === null && comment.targetMissing === null) {
		return 'unchecked';
	}
	return undefined;
};

// Frame-local CSS px. Pins are fractions multiplied by a size, so a zero-size box gives its origin
// and never NaN.
// ponytail: the stored-rect fallback applies a fraction of the unclipped pick-time box to the
// clipped rect, so a target partly clipped at pick time draws its fallback (and missing) pin
// slightly off. Upgrade path: store `box` on the comment.
// ponytail: a page pin uses the frame record's size, while 8f1 stored the fraction of the
// documentElement box; when the reported frame height differs (body taller than html,
// MAX_FRAME_HEIGHT, the growth guard) the page pin drifts. Upgrade path: anchor page comments to
// documentElement through the channel.
export const pinPoint = ({
	comment,
	live,
	frame,
}: {
	comment: PostedComment;
	live: LiveAnchor | undefined;
	frame: { width: number; height: number };
}): StagePoint => {
	if (comment.isPage) {
		return { x: comment.pin.x * frame.width, y: comment.pin.y * frame.height };
	}
	const base = live?.box ?? comment.rect;
	if (base === null) {
		return { x: 0, y: 0 };
	}
	return { x: base.x + comment.pin.x * base.width, y: base.y + comment.pin.y * base.height };
};

const isOutside = (point: StagePoint, rect: FrameRect): boolean =>
	point.x < rect.x - PIN_TOLERANCE_PX ||
	point.y < rect.y - PIN_TOLERANCE_PX ||
	point.x > rect.x + rect.width + PIN_TOLERANCE_PX ||
	point.y > rect.y + rect.height + PIN_TOLERANCE_PX;

// `<Open | Sent | Resolved> comment[, target missing | , stale | , unchecked]: <excerpt>`.
export const pinLabel = ({
	comment,
	badge,
}: {
	comment: PostedComment;
	badge: PinBadge | undefined;
}): string => {
	const body = comment.body.replace(/\s+/g, ' ').trim();
	const chars = Array.from(body);
	const excerpt =
		chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS).join('')}…` : body;
	const state = badge === undefined ? '' : `, ${BADGE_LABELS[badge]}`;
	return `${STATUS_LABELS[comment.status]} comment${state}: ${excerpt}`;
};

// The pins to draw, in comments.json order. `frames` are the drawn frames (drag preview included)
// and `view` the committed view, the same inputs that place the frame wrappers. A comment is
// placed only on a live iframe frame, and hidden when its target is clipped out or its point
// falls outside the frame (a forged rect must not draw over a neighbor).
export const layoutPins = ({
	comments,
	anchors,
	frames,
	view,
}: {
	comments: readonly PostedComment[];
	anchors: AnchorState;
	frames: readonly FrameRecord[];
	view: StageView | undefined;
}): PlacedPin[] => {
	if (view === undefined) {
		return [];
	}
	const liveIds = liveIframeIds(frames);
	const liveFrames = new Map(
		frames.filter((frame) => liveIds.has(frame.id)).map((frame) => [frame.id, frame]),
	);
	return comments.flatMap((comment) => {
		const frame = liveFrames.get(comment.frameId);
		if (frame === undefined) {
			return [];
		}
		const live = comment.isPage ? undefined : anchors.get(comment.frameId)?.get(comment.id);
		const point = pinPoint({ comment, live, frame });
		if (
			live !== undefined &&
			live.box !== null &&
			(live.visible === null || isOutside(point, live.visible))
		) {
			return [];
		}
		if (isOutside(point, { x: 0, y: 0, width: frame.width, height: frame.height })) {
			return [];
		}
		const screen = stageToScreen({ view, stageX: frame.x + point.x, stageY: frame.y + point.y });
		const badge = pinBadge({ comment, live });
		return [
			{
				id: comment.id,
				x: screen.x,
				y: screen.y,
				status: comment.status,
				badge,
				label: pinLabel({ comment, badge }),
			},
		];
	});
};

// The open thread stays open only while its pin is placed. It never reopens by itself.
export const keepOpenThread = ({
	openThreadId,
	pins,
}: {
	openThreadId: string | undefined;
	pins: readonly PlacedPin[];
}): string | undefined =>
	openThreadId !== undefined && pins.some((pin) => pin.id === openThreadId)
		? openThreadId
		: undefined;
