import type { FramePlaceMessage, FramePlacement } from './hostMessages';
import {
	dragFrame,
	passedGestureThreshold,
	placementChanged,
	resizeFrameWidth,
	screenToStage,
	type StagePoint,
	type StageView,
} from './stageGeometry';

// Frame move/resize gesture rules for the chrome. Pure: App owns the state and posts the commit.

export type FrameGestureKind = 'move' | 'resize';

// What Stage reports. Pointer coordinates are viewport-relative screen px, like the wheel path.
// Keyboard steps are stage px.
export type StageFrameGesture = { id: string; kind: FrameGestureKind } & (
	| {
			source: 'pointer';
			phase: 'start' | 'move' | 'end' | 'cancel';
			screenX: number;
			screenY: number;
	  }
	| { source: 'keyboard'; phase: 'nudge'; stepX: number; stepY: number; repeat: boolean }
	| { source: 'keyboard'; phase: 'end' | 'cancel' }
);

// One gesture at a time, from either source. `base` is the disk placement at start; `override`
// is the local preview. `committing` keeps the preview until the host's answer shows disk moved
// off `base` (success) or an artboard:error clears it (failure).
export type FrameGesture = {
	id: string;
	kind: FrameGestureKind;
	source: 'pointer' | 'keyboard';
	base: FramePlacement;
	// Pointer only: where the gesture started, in stage and viewport screen px.
	startStage?: StagePoint;
	startScreen?: StagePoint;
	override?: FramePlacement;
	phase: 'active' | 'committing';
};

export type FrameGestureStep = { gesture: FrameGesture | undefined; commit?: FramePlaceMessage };

type DiskPlacementOf = (id: string) => FramePlacement | undefined;

const previewPlacement = ({
	kind,
	from,
	delta,
}: {
	kind: FrameGestureKind;
	from: FramePlacement;
	delta: StagePoint;
}): FramePlacement =>
	kind === 'move'
		? { ...dragFrame({ start: from, stageDelta: delta }), width: from.width }
		: {
				x: from.x,
				y: from.y,
				width: resizeFrameWidth({ startWidth: from.width, stageDeltaX: delta.x }),
			};

const newGesture = ({
	event,
	diskPlacement,
	view,
}: {
	event: StageFrameGesture;
	diskPlacement: DiskPlacementOf;
	view: StageView;
}): FrameGesture | undefined => {
	const base = diskPlacement(event.id);
	if (base === undefined) {
		return undefined;
	}
	const gesture: FrameGesture = {
		id: event.id,
		kind: event.kind,
		source: event.source,
		base,
		phase: 'active',
	};
	if (event.source === 'pointer') {
		const startScreen = { x: event.screenX, y: event.screenY };
		gesture.startScreen = startScreen;
		gesture.startStage = screenToStage({ view, screenX: startScreen.x, screenY: startScreen.y });
	}
	return gesture;
};

const ownsEvent = (gesture: FrameGesture, event: StageFrameGesture): boolean =>
	gesture.phase === 'active' &&
	gesture.source === event.source &&
	gesture.id === event.id &&
	gesture.kind === event.kind;

// Every event outside its phase is a no-op: that is what stops lostpointercapture, keyup then
// blur, and late moves from fighting the commit. `view` is the current stage view, so a wheel
// pan or zoom mid-drag stays correct on the next move.
export const stepFrameGesture = ({
	gesture,
	event,
	diskPlacement,
	view,
}: {
	gesture: FrameGesture | undefined;
	event: StageFrameGesture;
	diskPlacement: DiskPlacementOf;
	view: StageView;
}): FrameGestureStep => {
	if (event.phase === 'start') {
		return { gesture: gesture ?? newGesture({ event, diskPlacement, view }) };
	}
	if (event.phase === 'nudge') {
		// Only a fresh keydown starts a gesture. Auto-repeat from a key still held after
		// Agent-wins or a failed write must not restart one and overwrite the disk position.
		const current =
			gesture ?? (event.repeat ? undefined : newGesture({ event, diskPlacement, view }));
		if (current === undefined || !ownsEvent(current, event)) {
			return { gesture };
		}
		return {
			gesture: {
				...current,
				override: previewPlacement({
					kind: current.kind,
					from: current.override ?? current.base,
					delta: { x: event.stepX, y: event.stepY },
				}),
			},
		};
	}
	if (gesture === undefined || !ownsEvent(gesture, event)) {
		return { gesture };
	}
	if (event.phase === 'cancel') {
		return { gesture: undefined };
	}
	if (event.phase === 'end') {
		const { override, base, id } = gesture;
		if (override === undefined || !placementChanged({ base, next: override })) {
			return { gesture: undefined };
		}
		return {
			gesture: { ...gesture, phase: 'committing' },
			commit: { type: 'frame:place', id, ...override, base },
		};
	}
	const { startScreen, startStage } = gesture;
	if (event.source !== 'pointer' || startScreen === undefined || startStage === undefined) {
		return { gesture };
	}
	const screen = { x: event.screenX, y: event.screenY };
	if (gesture.override === undefined && !passedGestureThreshold({ startScreen, screen })) {
		return { gesture };
	}
	const now = screenToStage({ view, screenX: screen.x, screenY: screen.y });
	return {
		gesture: {
			...gesture,
			override: previewPlacement({
				kind: gesture.kind,
				from: gesture.base,
				delta: { x: now.x - startStage.x, y: now.y - startStage.y },
			}),
		},
	};
};

// On canvas:updated. Agent wins: an active gesture whose frame moved on disk is dropped. A
// committing one ends once disk differs from base (the host answered); until then it stays.
export const settleFrameGesture = ({
	gesture,
	diskPlacement,
}: {
	gesture: FrameGesture | undefined;
	diskPlacement: DiskPlacementOf;
}): FrameGesture | undefined => {
	if (gesture === undefined) {
		return undefined;
	}
	const disk = diskPlacement(gesture.id);
	return disk === undefined || placementChanged({ base: gesture.base, next: disk })
		? undefined
		: gesture;
};
