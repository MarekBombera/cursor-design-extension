import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type { AnchorRect, AnchorRequest, FrameRect } from './frame/frameMessages';
import type { PostedComment } from './hostMessages';
import { clampNumber, type StagePoint, type StageView, stageToScreen } from './stageGeometry';
import type { BadgeProps } from './ui/badge';

// Pin rules (8f2). Pure: App holds the comments, the live anchors and the open thread, and draws
// what layoutPins returns with Pins.svelte.

type LiveAnchor = { box: FrameRect | null; visible: FrameRect | null };

// Frame id, then comment id. Maps, never plain objects: the ids come from an untrusted frame.
export type AnchorState = ReadonlyMap<string, ReadonlyMap<string, LiveAnchor>>;

export type PinBadge = 'missing' | 'stale' | 'unchecked';

// x, y: viewport-local screen px of the pin's tip (the teardrop's bottom-right corner).
export type PlacedPin = {
	id: string;
	x: number;
	y: number;
	// The comment's number (commentNumber), drawn on the pin and in its aria-label.
	number: number;
	status: PostedComment['status'];
	badge: PinBadge | undefined;
	label: string;
};

// A genuine answer never puts a pin outside `visible` or the frame; this is rounding room.
const PIN_TOLERANCE_PX = 0.5;

const EXCERPT_CHARS = 60;

// How long the jump outline stays on the target.
export const JUMP_FLASH_MS = 1500;

// The card's status and target-flag badges. Chrome-only copy: no host or MCP text quotes it. A
// flag's description is the sentence assistive tech reads after its label. The status words are
// short so the card head keeps room for the target; they are also the pin label's first word.
const STATUS_BADGES = {
	open: { tone: 'accent', icon: 'dot', label: 'Open' },
	sent: { tone: 'agent', icon: 'send', label: 'Sent', description: 'Sent to Agent' },
	resolved: { tone: 'success', icon: 'check', label: 'Resolved' },
} as const satisfies Record<PostedComment['status'], BadgeProps>;

const FLAG_BADGES = {
	stale: {
		tone: 'warning',
		icon: 'warning',
		label: 'Target changed',
		description: 'The element changed since this comment.',
	},
	missing: {
		tone: 'warning',
		icon: 'error',
		label: 'Target missing',
		description: 'The element is gone or no longer unique.',
	},
	unchecked: {
		tone: 'neutral',
		icon: 'question',
		label: 'Not checked',
		description:
			"This target can't be checked from disk (made by script, too complex, or the file can't be read).",
	},
} as const satisfies Record<PinBadge, BadgeProps>;

// Every status and flag badge has an icon (the panel summary and the pins draw them).
export const statusBadge = (
	status: PostedComment['status'],
): (typeof STATUS_BADGES)[PostedComment['status']] => STATUS_BADGES[status];

export const flagBadge = (badge: PinBadge): (typeof FLAG_BADGES)[PinBadge] => FLAG_BADGES[badge];

// A comment's number from its index in the full comments.json list: 1-based over every status, so
// a number survives a status change. The pin, its panel card and its thread show the same number;
// layoutPins and panelItems number from the full list they are given.
// ponytail: numbers are array positions, so a hand-reordered comments.json renumbers. Upgrade
// path: a stored number field on disk.
export const commentNumber = (index: number): number => index + 1;

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

// The one live-anchor lookup: the frame's last answer for an element comment. Page comments have
// no anchor.
export const liveAnchor = ({
	anchors,
	comment,
}: {
	anchors: AnchorState;
	comment: PostedComment;
}): LiveAnchor | undefined =>
	comment.isPage ? undefined : anchors.get(comment.frameId)?.get(comment.id);

// Frame-local CSS px: where the pin's tip sits. An element comment anchors at its target box's
// top-left corner, so the pin's body grows into the margin above and left of the element and never
// covers its words. A page comment keeps its stored fraction of the frame.
// ponytail: the corner of the whole box, so a target whose top-left is clipped (scrolled up inside
// a box) hides its pin while the rest still shows. Upgrade path: the corner of `visible`.
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
	return base === null ? { x: 0, y: 0 } : { x: base.x, y: base.y };
};

const isOutside = (point: StagePoint, rect: FrameRect): boolean =>
	point.x < rect.x - PIN_TOLERANCE_PX ||
	point.y < rect.y - PIN_TOLERANCE_PX ||
	point.x > rect.x + rect.width + PIN_TOLERANCE_PX ||
	point.y > rect.y + rect.height + PIN_TOLERANCE_PX;

// `<Open | Sent | Resolved> comment <number>[, target changed | , target missing | , not checked]:
// <excerpt>`; the flag words are the card badge's label, lowercased.
export const pinLabel = ({
	comment,
	badge,
	number,
}: {
	comment: PostedComment;
	badge: PinBadge | undefined;
	number: number;
}): string => {
	const body = comment.body.replace(/\s+/g, ' ').trim();
	const chars = Array.from(body);
	const excerpt =
		chars.length > EXCERPT_CHARS ? `${chars.slice(0, EXCERPT_CHARS).join('')}…` : body;
	const state = badge === undefined ? '' : `, ${flagBadge(badge).label.toLowerCase()}`;
	return `${statusBadge(comment.status).label} comment ${number}${state}: ${excerpt}`;
};

// The pins to draw, in comments.json order. `frames` are the drawn frames (drag preview included)
// and `view` the committed view, the same inputs that place the frame wrappers. A comment is
// placed only on a live iframe frame, and hidden when its target is clipped out or its point
// falls outside the frame (a forged rect must not draw over a neighbor). `comments` is the full
// comments.json list: it numbers the pins.
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
	return comments.flatMap((comment, index) => {
		const frame = liveFrames.get(comment.frameId);
		if (frame === undefined) {
			return [];
		}
		const live = liveAnchor({ anchors, comment });
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
		const number = commentNumber(index);
		return [
			{
				id: comment.id,
				x: screen.x,
				y: screen.y,
				number,
				status: comment.status,
				badge,
				label: pinLabel({ comment, badge, number }),
			},
		];
	});
};

const clampIntoRect = (point: StagePoint, rect: FrameRect): StagePoint => ({
	x: clampNumber({ value: point.x, min: rect.x, max: rect.x + rect.width }),
	y: clampNumber({ value: point.y, min: rect.y, max: rect.y + rect.height }),
});

// `box` clipped to `bounds`, or undefined when nothing with area is left.
const intersectRect = (box: FrameRect | null, bounds: FrameRect): FrameRect | undefined => {
	if (box === null) {
		return undefined;
	}
	const left = Math.max(box.x, bounds.x);
	const top = Math.max(box.y, bounds.y);
	const width = Math.min(box.x + box.width, bounds.x + bounds.width) - left;
	const height = Math.min(box.y + box.height, bounds.y + bounds.height) - top;
	return width > 0 && height > 0 ? { x: left, y: top, width, height } : undefined;
};

// Click to jump, all frame-local CSS px: the point to center, the size to fit (undefined keeps the
// zoom) and the rect to flash. The center is the target box (the pin is inside it), so both stay
// on screen. A missing target flashes its stored rect; a target scrolled out of its box gets none.
export const jumpTarget = ({
	comment,
	live,
	frame,
}: {
	comment: PostedComment;
	live: LiveAnchor | undefined;
	frame: { width: number; height: number };
}): {
	center: StagePoint;
	fit: { width: number; height: number } | undefined;
	outline: FrameRect | undefined;
} => {
	const frameRect = { x: 0, y: 0, width: frame.width, height: frame.height };
	const pinCenter = clampIntoRect(pinPoint({ comment, live, frame }), frameRect);
	if (comment.isPage) {
		return { center: pinCenter, fit: undefined, outline: frameRect };
	}
	const fitBox = intersectRect(live?.box ?? comment.rect, frameRect);
	const outline =
		live !== undefined && live.box !== null
			? (live.visible ?? undefined)
			: (comment.rect ?? undefined);
	if (fitBox === undefined) {
		return { center: pinCenter, fit: undefined, outline };
	}
	return {
		center: { x: fitBox.x + fitBox.width / 2, y: fitBox.y + fitBox.height / 2 },
		fit: { width: fitBox.width, height: fitBox.height },
		outline,
	};
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
