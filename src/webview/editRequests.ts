import type { EDIT_FIELDS } from '../disk/layout';
import type { FrameRecord } from './canvasFrames';
import type { ArtboardEditedMessage, ArtboardEditMessage, UiErrorMessage } from './hostMessages';

// Edit-mode saves (9e): one artboard:edit in flight per panel, the rest wait in order and go out
// with the hash the previous answer brought (9c: two commits on one base would conflict with the
// user's own save). Pure; EditState (editState.svelte.ts) holds the state and does the I/O.
// ponytail: one in flight per panel, not per frame (the simplest form of the 9c rule), and no
// timeout: an answer that never arrives (a dropped post) blocks later saves until the webview
// reloads.

export type EditField = (typeof EDIT_FIELDS)[number];

// Which element a draft and its save belong to, fixed when the draft starts (never at commit:
// the pick can move first). documentVersion: the frame's document then; a reload drops its preview.
export type EditKey = { frameId: string; sourceNumber: number; documentVersion: number };

export type EditCommit = {
	key: EditKey;
	field: EditField;
	// The field's raw draft: the host normalizes.
	value: string;
	// Text only: the draft's baseline raw text node.
	liveText?: string;
};

type InFlight = { requestId: string; key: EditKey; baseHash: string };

// `key`: the edit the copy is about, so a pick of another element clears it.
type EditError = { message: string; key: EditKey | undefined };

export type EditRequestsState = {
	waiting: readonly EditCommit[];
	inFlight: InFlight | undefined;
	error: EditError | undefined;
};

export const NOT_SAVED_COPY = 'Not saved: the frame changed. Try again.';

export const INITIAL_EDIT_REQUESTS: EditRequestsState = {
	waiting: [],
	inFlight: undefined,
	error: undefined,
};

type SendFrame = Pick<FrameRecord, 'id' | 'kind' | 'hash' | 'documentVersion'>;

// A commit clears the error: the user moved on.
export const enqueueEdit = (state: EditRequestsState, commit: EditCommit): EditRequestsState => ({
	...state,
	waiting: [...state.waiting, commit],
	error: undefined,
});

// An edit that ended unsent. A copy already showing (a refusal from the same event) wins.
export const notSaved = (state: EditRequestsState, key: EditKey | undefined): EditRequestsState =>
	state.error === undefined ? { ...state, error: { message: NOT_SAVED_COPY, key } } : state;

const isSendable = (commit: EditCommit, frame: SendFrame | undefined): frame is SendFrame =>
	frame !== undefined &&
	frame.kind === 'iframe' &&
	frame.documentVersion === commit.key.documentVersion;

// The next artboard:edit, when nothing is in flight. Heads whose frame left, became a tile or
// reloaded since the draft started are dropped (their preview is gone), and the loop goes on.
export const nextSend = ({
	state,
	frames,
	newRequestId,
}: {
	state: EditRequestsState;
	frames: readonly SendFrame[];
	newRequestId: () => string;
}): { state: EditRequestsState; send: ArtboardEditMessage | undefined } => {
	if (state.inFlight !== undefined) {
		return { state, send: undefined };
	}
	let next = state;
	for (const [index, commit] of state.waiting.entries()) {
		const frame = frames.find((candidate) => candidate.id === commit.key.frameId);
		if (!isSendable(commit, frame)) {
			next = notSaved(next, commit.key);
			continue;
		}
		const requestId = newRequestId();
		const send: ArtboardEditMessage = {
			type: 'artboard:edit',
			requestId,
			frameId: commit.key.frameId,
			sourceNumber: commit.key.sourceNumber,
			hash: frame.hash,
			field: commit.field,
			value: commit.value,
			...(commit.liveText === undefined ? {} : { liveText: commit.liveText }),
		};
		return {
			state: {
				...next,
				waiting: state.waiting.slice(index + 1),
				inFlight: { requestId, key: commit.key, baseHash: frame.hash },
			},
			send,
		};
	}
	return { state: { ...next, waiting: [] }, send: undefined };
};

export type EditAnswerStep = {
	state: EditRequestsState;
	// Success: what CanvasState.adoptEditAnswer takes.
	adopt: { answer: ArtboardEditedMessage; baseHash: string } | undefined;
	// Refusal: frames whose previews must go (the in-flight one and every dropped waiting one).
	reloadFrameIds: string[];
};

// Only the in-flight request's answer counts (comment answers share ui:error; ids never match).
export const answerEdit = (
	state: EditRequestsState,
	message: ArtboardEditedMessage | UiErrorMessage,
): EditAnswerStep => {
	const unchanged = { state, adopt: undefined, reloadFrameIds: [] };
	const inFlight = state.inFlight;
	if (inFlight === undefined || message.requestId !== inFlight.requestId) {
		return unchanged;
	}
	if (message.type === 'artboard:edited') {
		if (message.frameId !== inFlight.key.frameId) {
			return unchanged;
		}
		return {
			state: { ...state, inFlight: undefined },
			adopt: { answer: message, baseHash: inFlight.baseHash },
			reloadFrameIds: [],
		};
	}
	const frameIds = new Set([
		inFlight.key.frameId,
		...state.waiting.map((commit) => commit.key.frameId),
	]);
	return {
		state: {
			waiting: [],
			inFlight: undefined,
			error: { message: message.message, key: inFlight.key },
		},
		adopt: undefined,
		reloadFrameIds: [...frameIds],
	};
};

// A new pick (not a re-post) of another element clears the copy; an empty pick never does.
export const clearErrorOnPick = (
	state: EditRequestsState,
	pick: { frameId: string; sourceNumber: number | null; repost: boolean },
): EditRequestsState => {
	const key = state.error?.key;
	if (state.error === undefined || pick.repost) {
		return state;
	}
	return key === undefined || key.frameId !== pick.frameId || key.sourceNumber !== pick.sourceNumber
		? { ...state, error: undefined }
		: state;
};
