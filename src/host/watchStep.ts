import { isLockOrTempPath } from '../disk/workspaceLock';

type WatchState = { readonly markerPending: boolean };

export type WatchEvent =
	// A watcher create or change event is `write`; a delete event is `delete`.
	| { type: 'disk'; change: 'write' | 'delete'; path: string; markerPath: string }
	// The 200 ms debounce fired and the serial run chain reached this run.
	| { type: 'settled'; sameFolder: boolean; trusted: boolean }
	// The shell's marker stat finished; a stat error counts as `exists: false` (the shell logs it first).
	| { type: 'markerChecked'; exists: boolean }
	// The shell opened the panel, refreshed and deleted the marker.
	| { type: 'opened' };

type WatchEffect = 'ignore' | 'debounce' | 'refresh' | 'checkMarker' | 'openPanel';

export const IDLE_WATCH_STATE: WatchState = { markerPending: false };

// The disk watcher's one decision: the next state and the effect the vscode shell runs.
export const stepWatch = (
	state: WatchState,
	event: WatchEvent,
): { state: WatchState; effect: WatchEffect } => {
	if (event.type === 'disk') {
		if (isLockOrTempPath(event.path)) {
			return { state, effect: 'ignore' };
		}
		const isMarker = event.path === event.markerPath;
		if (event.change === 'delete') {
			return isMarker
				? { state: { markerPending: false }, effect: 'ignore' }
				: { state, effect: 'debounce' };
		}
		return { state: isMarker ? { markerPending: true } : state, effect: 'debounce' };
	}
	if (event.type === 'settled') {
		if (!event.sameFolder) {
			return { state: { markerPending: false }, effect: 'ignore' };
		}
		if (state.markerPending && !event.trusted) {
			return { state: { markerPending: false }, effect: 'ignore' };
		}
		return state.markerPending
			? { state: { markerPending: true }, effect: 'checkMarker' }
			: { state: { markerPending: false }, effect: 'refresh' };
	}
	if (event.type === 'markerChecked') {
		return event.exists
			? { state, effect: 'openPanel' }
			: { state: { markerPending: false }, effect: 'ignore' };
	}
	return { state: { markerPending: false }, effect: 'ignore' };
};
