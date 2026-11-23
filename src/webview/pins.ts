import { type FrameRecord, liveIframeIds } from './canvasFrames';
import type { AnchorRect, AnchorRequest, FrameRect } from './frame/frameMessages';
import { clipRect } from './frame/pickTarget';
import type { PostedComment } from './hostMessages';
import { clampNumber, type StagePoint, type StageView, stageToScreen } from './stageGeometry';
import type { BadgeProps } from './ui/badge';

type LiveAnchor = { box: FrameRect | null; visible: FrameRect | null };

// Frame id, then comment id. Maps, never plain objects: the ids come from an untrusted frame.
export type AnchorState = ReadonlyMap<string, ReadonlyMap<string, LiveAnchor>>;

export type PinBadge = 'missing' | 'stale' | 'unchecked';

// x, y: viewport-local screen px of the pin's tip (the teardrop's bottom-right corner).
export type PlacedPin = {
	id: string;
	x: number;
	y: number;
	number: number;
	status: PostedComment['status'];
	badge: PinBadge | undefined;
	label: string;
};

// A genuine answer never puts a pin outside `visible` or the frame; this is rounding room.
const PIN_TOLERANCE_PX = 0.5;

const EXCERPT_CHARS = 60;

export const JUMP_FLASH_MS = 1500;

// Chrome-only copy: no host or MCP text quotes it. Status words stay short for the card head and
// start the pin label.
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

// Literal return types, so callers see every badge has an icon.
export const statusBadge = (
	status: PostedComment['status'],
): (typeof STATUS_BADGES)[PostedComment['status']] => STATUS_BADGES[status];

export const flagBadge = (badge: PinBadge): (typeof FLAG_BADGES)[PinBadge] => FLAG_BADGES[badge];

// 1-based index in the full comments.json list (every status), so a status change keeps it.
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

// A frame with no element comments still gets [], so its runtime stops observing.
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

export const liveAnchor = ({
	anchors,
	comment,
}: {
	anchors: AnchorState;
	comment: PostedComment;
}): LiveAnchor | undefined =>
	comment.isPage ? undefined : anchors.get(comment.frameId)?.get(comment.id);

// Frame-local CSS px of the pin's tip: an element pin at its target's top-left, so its body never
// covers the words; a page pin at its stored fraction.
// ponytail: the whole box's corner, so a target clipped at its top-left hides its pin. Upgrade
// path: the corner of `visible`.
// ponytail: the page fraction is of the documentElement box but applied to the frame record's
// size, so it drifts when they differ (body taller than html, MAX_FRAME_HEIGHT, the growth guard).
// Upgrade path: anchor page comments to documentElement through the channel.
// Exported for tests: they pin the stage point before layoutPins offsets, hides or stacks it.
/** @internal */
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

// Exported for tests: they pin the label per badge and number; layoutPins derives both.
/** @internal */
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

// Screen px between pins whose tips coincide: the 24px pin (--cd-pin), its 2px ring on both sides
// and a 2px gap. Pins keep their size at any zoom, so this is screen space, not stage space.
const PIN_STACK_STEP_PX = 30;

// `frames` and `view` must be the inputs that place the frame wrappers (drag preview included). A
// pin outside its frame is hidden, so a forged rect cannot draw over a neighbor. `comments` is the
// full list: it numbers the pins.
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
	// Pins already placed per rounded tip, so comments on one element (or nested elements that
	// share a corner) line up to the left instead of covering each other. ponytail: exact-pixel
	// match only; tips a few px apart (a border, padding) still overlap. Upgrade: step any pin whose
	// tip is within one pin width of an earlier one.
	const pinsAtTip = new Map<string, number>();
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
		const tip = `${String(Math.round(screen.x))},${String(Math.round(screen.y))}`;
		const before = pinsAtTip.get(tip) ?? 0;
		pinsAtTip.set(tip, before + 1);
		const badge = pinBadge({ comment, live });
		const number = commentNumber(index);
		return [
			{
				id: comment.id,
				x: screen.x - before * PIN_STACK_STEP_PX,
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

// Frame-local CSS px; `fit` undefined keeps the zoom. Centering the target box keeps its pin on
// screen too. A missing target flashes its stored rect; one scrolled out of its box flashes none.
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
	const box = live?.box ?? comment.rect;
	const fitBox = box === null ? null : clipRect(box, [frameRect]);
	const outline =
		live !== undefined && live.box !== null
			? (live.visible ?? undefined)
			: (comment.rect ?? undefined);
	if (fitBox === null) {
		return { center: pinCenter, fit: undefined, outline };
	}
	return {
		center: { x: fitBox.x + fitBox.width / 2, y: fitBox.y + fitBox.height / 2 },
		fit: { width: fitBox.width, height: fitBox.height },
		outline,
	};
};

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

// A thread restored from webview state: open once its pin is placed; drop once it cannot be
// (comment gone, frame not a live iframe, or the frame answered and placed no pin); else hold.
// `comments` and `liveFrameIds` are undefined until known.
export const resolveHeldThread = ({
	held,
	pins,
	comments,
	liveFrameIds,
	anchorAnswered,
}: {
	held: string;
	pins: readonly PlacedPin[];
	comments: readonly PostedComment[] | undefined;
	liveFrameIds: ReadonlySet<string> | undefined;
	anchorAnswered: boolean;
}): 'open' | 'hold' | 'drop' => {
	if (pins.some((pin) => pin.id === held)) {
		return 'open';
	}
	const comment = comments?.find((entry) => entry.id === held);
	if (comments !== undefined && comment === undefined) {
		return 'drop';
	}
	if (comment !== undefined && liveFrameIds !== undefined && !liveFrameIds.has(comment.frameId)) {
		return 'drop';
	}
	return anchorAnswered ? 'drop' : 'hold';
};
