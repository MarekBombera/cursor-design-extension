import { type EDIT_FIELDS, MAX_HISTORY_STEPS } from '../disk/layout';
import type { FrameRecord } from './canvasFrames';
import type {
	ArtboardEditedMessage,
	ArtboardEditMessage,
	ArtboardHistoryMessage,
	HistoryStep,
	UiErrorMessage,
} from './hostMessages';
import { canStep } from './undoRedo';

// Saves and undo / redo steps: one request in flight, the rest wait in order; a save goes out with
// the hash the previous answer brought (two commits on one base would conflict with the user's own
// save).
// ponytail: one in flight per panel, not per frame, and no timeout: a lost answer blocks later
// requests until the webview reloads. Upgrade path: per-frame queues and an answer timeout.
// ponytail: a written step reloads its frame (scroll and page state reset): the restored file is
// not in the live page. Upgrade path: the answer carries the restored text or style for
// cd:edit-apply.

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

// A step has no element and no preview: it undoes or redoes the frame's last own write.
type QueuedRequest =
	| { kind: 'edit'; commit: EditCommit }
	| { kind: 'step'; frameId: string; step: HistoryStep };

type InFlight = QueuedRequest & { requestId: string; baseHash: string };

// `key`: the edit the copy is about, so a pick of another element clears it; undefined for a
// step's refusal (any new pick clears it).
type EditError = { message: string; key: EditKey | undefined };

export type EditRequestsState = {
	waiting: readonly QueuedRequest[];
	inFlight: InFlight | undefined;
	error: EditError | undefined;
};

export const NOT_SAVED_COPY = 'Not saved: the frame changed. Try again.';

export const INITIAL_EDIT_REQUESTS: EditRequestsState = {
	waiting: [],
	inFlight: undefined,
	error: undefined,
};

type SendFrame = Pick<
	FrameRecord,
	'id' | 'kind' | 'hash' | 'documentVersion' | 'canUndo' | 'canRedo'
>;

// A commit clears the error: the user moved on.
export const enqueueEdit = (state: EditRequestsState, commit: EditCommit): EditRequestsState => ({
	...state,
	waiting: [...state.waiting, { kind: 'edit', commit }],
	error: undefined,
});

// A step clears the error too. At most MAX_HISTORY_STEPS steps wait: a design script posting
// cd:key undo / redo in a loop cannot grow the queue or the writes it causes past what a history
// can hold; a further step is ignored.
export const enqueueStep = (
	state: EditRequestsState,
	{ frameId, step }: { frameId: string; step: HistoryStep },
): EditRequestsState =>
	state.waiting.filter((request) => request.kind === 'step').length >= MAX_HISTORY_STEPS
		? state
		: {
				...state,
				waiting: [...state.waiting, { kind: 'step', frameId, step }],
				error: undefined,
			};

// An edit that ended unsent. A copy already showing (a refusal from the same event) wins.
export const notSaved = (state: EditRequestsState, key: EditKey | undefined): EditRequestsState =>
	state.error === undefined ? { ...state, error: { message: NOT_SAVED_COPY, key } } : state;

const isSendableEdit = (commit: EditCommit, frame: SendFrame | undefined): frame is SendFrame =>
	frame !== undefined &&
	frame.kind === 'iframe' &&
	frame.documentVersion === commit.key.documentVersion;

// The flag is read at send time: the answer to the request before it may have changed it.
const isSendableStep = (step: HistoryStep, frame: SendFrame | undefined): frame is SendFrame =>
	frame !== undefined && frame.kind === 'iframe' && canStep(frame, step);

const requestFrameId = (request: QueuedRequest): string =>
	request.kind === 'step' ? request.frameId : request.commit.key.frameId;

// An edit whose frame left, became a tile or reloaded since its draft started is dropped with "Not
// saved" (its preview is gone); a step whose frame left, is a tile or has nothing to undo / redo
// any more is dropped silently. The loop goes on.
export const nextSend = ({
	state,
	frames,
	newRequestId,
}: {
	state: EditRequestsState;
	frames: readonly SendFrame[];
	newRequestId: () => string;
}): {
	state: EditRequestsState;
	send: ArtboardEditMessage | ArtboardHistoryMessage | undefined;
} => {
	if (state.inFlight !== undefined) {
		return { state, send: undefined };
	}
	let next = state;
	for (const [index, request] of state.waiting.entries()) {
		const frame = frames.find((candidate) => candidate.id === requestFrameId(request));
		if (request.kind === 'step') {
			if (!isSendableStep(request.step, frame)) {
				continue;
			}
			const requestId = newRequestId();
			return {
				state: {
					...next,
					waiting: state.waiting.slice(index + 1),
					inFlight: { ...request, requestId, baseHash: frame.hash },
				},
				send: { type: 'artboard:history', requestId, frameId: request.frameId, step: request.step },
			};
		}
		const { commit } = request;
		if (!isSendableEdit(commit, frame)) {
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
				inFlight: { ...request, requestId, baseHash: frame.hash },
			},
			send,
		};
	}
	return { state: { ...next, waiting: [] }, send: undefined };
};

export type EditAnswerStep = {
	state: EditRequestsState;
	// Success only.
	adopt: { answer: ArtboardEditedMessage; baseHash: string } | undefined;
	// Refusal: frames whose previews must go (an in-flight edit's and every dropped waiting edit's).
	reloadFrameIds: string[];
	// A written step: the caller reloads the frame if the adopt applied, and announces it.
	stepDone: { frameId: string; step: HistoryStep } | undefined;
};

// Only the in-flight request's answer counts (comment answers share ui:error; ids never match).
export const answerEdit = (
	state: EditRequestsState,
	message: ArtboardEditedMessage | UiErrorMessage,
): EditAnswerStep => {
	const unchanged = { state, adopt: undefined, reloadFrameIds: [], stepDone: undefined };
	const inFlight = state.inFlight;
	if (inFlight === undefined || message.requestId !== inFlight.requestId) {
		return unchanged;
	}
	const frameId = requestFrameId(inFlight);
	if (message.type === 'artboard:edited') {
		if (message.frameId !== frameId) {
			return unchanged;
		}
		return {
			state: { ...state, inFlight: undefined },
			adopt: { answer: message, baseHash: inFlight.baseHash },
			reloadFrameIds: [],
			stepDone: inFlight.kind === 'step' ? { frameId, step: inFlight.step } : undefined,
		};
	}
	// Every waiting request is dropped: steps silently (no preview), edits by reloading their frames.
	const frameIds = new Set([
		...(inFlight.kind === 'edit' ? [frameId] : []),
		...state.waiting.filter((request) => request.kind === 'edit').map(requestFrameId),
	]);
	return {
		state: {
			waiting: [],
			inFlight: undefined,
			error: {
				message: message.message,
				key: inFlight.kind === 'edit' ? inFlight.commit.key : undefined,
			},
		},
		adopt: undefined,
		reloadFrameIds: [...frameIds],
		stepDone: undefined,
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
