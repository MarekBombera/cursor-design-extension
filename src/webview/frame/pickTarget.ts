// Pure hit-test rules for Comment-mode picking. Generic over the element type, so the runtime
// passes DOM predicates and tests pass plain objects. No DOM types: the runtime bundles this.

import { MAX_FRAME_COORDINATE } from '../../disk/layout';
import { clampNumber } from '../stageGeometry';
import type { FrameRect } from './frameMessages';

type PickTargetArgs<T> = {
	// Topmost first, the `elementsFromPoint` order.
	stack: readonly T[];
	// SVG internals become the outermost <svg>.
	resolve: (element: T) => T;
	// html or body.
	isRoot: (element: T) => boolean;
	paints: (element: T) => boolean;
	contains: (ancestor: T, element: T) => boolean;
};

// Returns the element a click picks, or undefined for a page pick. An element that paints
// nothing is skipped when a non-ancestor lies under it (a transparent overlay over a sibling).
export const pickTarget = <T>({
	stack,
	resolve,
	isRoot,
	paints,
	contains,
}: PickTargetArgs<T>): T | undefined => {
	const resolved = stack.map(resolve);
	for (const [index, candidate] of resolved.entries()) {
		if (isRoot(candidate)) {
			continue;
		}
		const coversNonAncestor =
			!paints(candidate) && resolved.slice(index + 1).some((below) => !contains(below, candidate));
		if (!coversNonAncestor) {
			return candidate;
		}
	}
	return undefined;
};

export const sameRect = (left: FrameRect | null, right: FrameRect | null): boolean =>
	left === null || right === null
		? left === right
		: left.x === right.x &&
			left.y === right.y &&
			left.width === right.width &&
			left.height === right.height;

type PostedPick<T> = {
	element: T;
	// Compared by identity: a new description object means the pick was described again.
	described: object;
	rect: FrameRect | null;
	point: { x: number; y: number };
};

// True when a re-post would send chrome the same pick it already has.
export const isUnchangedPick = <T>({
	last,
	next,
}: {
	last: PostedPick<T>;
	next: PostedPick<T>;
}): boolean =>
	last.element === next.element &&
	last.described === next.described &&
	sameRect(last.rect, next.rect) &&
	last.point.x === next.point.x &&
	last.point.y === next.point.y;

// Intersects rect with each clip in turn; zero area is null.
export const clipRect = (rect: FrameRect, clips: readonly FrameRect[]): FrameRect | null => {
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.width;
	let bottom = rect.y + rect.height;
	for (const clip of clips) {
		left = Math.max(left, clip.x);
		top = Math.max(top, clip.y);
		right = Math.min(right, clip.x + clip.width);
		bottom = Math.min(bottom, clip.y + clip.height);
	}
	if (left >= right || top >= bottom) {
		return null;
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
};

// The click point relative to the current target's unclipped border box, clamped into it (and
// into the coordinate cap, so a pick never fails its own guard). The anchor is the clicked
// element; the offset is the click inside its box at click time.
export const pointInTarget = ({
	anchorBox,
	offset,
	targetBox,
}: {
	anchorBox: FrameRect;
	offset: { x: number; y: number };
	targetBox: FrameRect;
}): { x: number; y: number } => ({
	x: clampNumber({
		value: anchorBox.x + offset.x - targetBox.x,
		min: 0,
		max: Math.min(targetBox.width, MAX_FRAME_COORDINATE),
	}),
	y: clampNumber({
		value: anchorBox.y + offset.y - targetBox.y,
		min: 0,
		max: Math.min(targetBox.height, MAX_FRAME_COORDINATE),
	}),
});

const ZERO_ALPHA = String.raw`(?:0+(?:\.0*)?|\.0+)%?\s*\)$`;
const LEGACY_ZERO_ALPHA = new RegExp(String.raw`^(?:rgba|hsla)\(.*,\s*${ZERO_ALPHA}`, 'i');
const SLASH_ZERO_ALPHA = new RegExp(String.raw`\/\s*${ZERO_ALPHA}`);

// Unknown formats count as painted, which keeps the element (the safe side).
export const isTransparentColor = (value: string): boolean => {
	const color = value.trim();
	return color === 'transparent' || LEGACY_ZERO_ALPHA.test(color) || SLASH_ZERO_ALPHA.test(color);
};

const REPLACED_OR_CONTROL = new Set([
	'img',
	'svg',
	'video',
	'audio',
	'canvas',
	'iframe',
	'embed',
	'object',
	'picture',
	'input',
	'textarea',
	'select',
	'button',
	'progress',
	'meter',
	'hr',
]);

// Computed-style strings, as `getComputedStyle` returns them.
type PaintStyle = {
	backgroundColor: string;
	backgroundImage: string;
	boxShadow: string;
	borderTopWidth: string;
	borderRightWidth: string;
	borderBottomWidth: string;
	borderLeftWidth: string;
	borderTopColor: string;
	borderRightColor: string;
	borderBottomColor: string;
	borderLeftColor: string;
};

type PaintInput = {
	localName: string;
	width: number;
	height: number;
	hasOwnText: boolean;
	style: PaintStyle;
};

// ponytail: heuristic; ignores ::before / ::after, outline and filters. Upgrade: add
// pseudo-element checks (getComputedStyle(element, '::before')).
export const paintsFromStyle = ({
	localName,
	width,
	height,
	hasOwnText,
	style,
}: PaintInput): boolean => {
	if (width === 0 || height === 0) {
		return false;
	}
	if (REPLACED_OR_CONTROL.has(localName) || hasOwnText) {
		return true;
	}
	if (
		!isTransparentColor(style.backgroundColor) ||
		style.backgroundImage !== 'none' ||
		style.boxShadow !== 'none'
	) {
		return true;
	}
	const borders: Array<[width: string, color: string]> = [
		[style.borderTopWidth, style.borderTopColor],
		[style.borderRightWidth, style.borderRightColor],
		[style.borderBottomWidth, style.borderBottomColor],
		[style.borderLeftWidth, style.borderLeftColor],
	];
	return borders.some(
		([borderWidth, borderColor]) =>
			Number.parseFloat(borderWidth) > 0 && !isTransparentColor(borderColor),
	);
};
