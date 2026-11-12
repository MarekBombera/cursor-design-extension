import { MAX_FRAME_COORDINATE } from '../../disk/layout';
import { clampNumber } from '../stageGeometry';
import type { AnchorRect, FrameRect } from './frameMessages';

// Sub-pixel jitter (layout rounding, a 0.5px border) is not a move.
const MOVE_THRESHOLD_PX = 0.5;

const rectMoved = (last: FrameRect | null, next: FrameRect | null): boolean => {
	if (last === null || next === null) {
		return last !== next;
	}
	return (
		Math.abs(last.x - next.x) > MOVE_THRESHOLD_PX ||
		Math.abs(last.y - next.y) > MOVE_THRESHOLD_PX ||
		Math.abs(last.width - next.width) > MOVE_THRESHOLD_PX ||
		Math.abs(last.height - next.height) > MOVE_THRESHOLD_PX
	);
};

// True when the chrome's pins would move: a different ordered id list, a rect appearing or
// disappearing, or any edge moving more than 0.5px. Nothing posted yet always counts.
export const anchorsMoved = ({
	last,
	next,
}: {
	last: readonly AnchorRect[] | undefined;
	next: readonly AnchorRect[];
}): boolean => {
	if (last === undefined || last.length !== next.length) {
		return true;
	}
	return next.some((anchor, index) => {
		const previous = last[index];
		return (
			previous === undefined ||
			previous.id !== anchor.id ||
			rectMoved(previous.box, anchor.box) ||
			rectMoved(previous.visible, anchor.visible)
		);
	});
};

// Into parseFrameRect's bounds, so a measured rect never fails the chrome's own guard.
export const capAnchorRect = (rect: FrameRect): FrameRect => ({
	x: clampNumber({ value: rect.x, min: -MAX_FRAME_COORDINATE, max: MAX_FRAME_COORDINATE }),
	y: clampNumber({ value: rect.y, min: -MAX_FRAME_COORDINATE, max: MAX_FRAME_COORDINATE }),
	width: clampNumber({ value: rect.width, min: 0, max: MAX_FRAME_COORDINATE }),
	height: clampNumber({ value: rect.height, min: 0, max: MAX_FRAME_COORDINATE }),
});
