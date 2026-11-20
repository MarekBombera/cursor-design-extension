import type { CanvasState } from './canvasState.svelte';
import { type CommentPicker, isTextEntry } from './commentPicker.svelte';
import { frameLabel, liveRegionText } from './commentsPanel';
import {
	answerEdit,
	clearErrorOnPick,
	type EditField,
	type EditRequestsState,
	enqueueEdit,
	enqueueStep,
	INITIAL_EDIT_REQUESTS,
	nextSend,
	notSaved,
} from './editRequests';
import {
	baselinePreview,
	commitDraft,
	draftFate,
	draftPreview,
	type EditDraft,
	FIELD_ERROR_COPY,
	startDraft,
} from './editDrafts';
import type { FramePickMessage } from './frame/frameMessages';
import { postEditRequest } from './hostBridge.svelte';
import type { ArtboardEditedMessage, HistoryStep, UiErrorMessage } from './hostMessages';
import {
	canStep,
	forwardedHistoryStep,
	historyKeyStep,
	type HistoryTarget,
	historyTarget,
} from './undoRedo';

// Edit-mode saves (9e) and undo / redo (9f): the inspector's field drafts, their live previews in
// the frame, the artboard:edit and artboard:history requests with their answers, and the frame
// Undo / Redo act on. Rules: editDrafts.ts (drafts), undoRedo.ts (history target and keys) and
// editRequests.ts (one in flight). Created after CanvasState and CommentPicker.
export class EditState {
	// One draft per field; only the focused field gets input, but an invalid commit keeps its draft.
	drafts: Partial<Record<EditField, EditDraft>> = $state({});
	requests: EditRequestsState = $state(INITIAL_EDIT_REQUESTS);
	// 9f: the frame of the latest accepted Edit-mode pick from a frame that held focus (F-146). It
	// outlives the pick (a step's reload drops it) and mode switches, and clears when the frame
	// leaves; a webview reload loses it.
	historyFrameId: string | undefined = $state(undefined);
	#announcement = $state({ text: '', sequence: 0 });

	readonly #canvas: CanvasState;
	readonly #picker: CommentPicker;

	readonly requestError = $derived(this.requests.error?.message);
	// The polite announcement after a written step; a repeat still speaks (liveRegionText).
	readonly historyAnnouncement = $derived(liveRegionText(this.#announcement));

	constructor({ canvas, picker }: { canvas: CanvasState; picker: CommentPicker }) {
		this.#canvas = canvas;
		this.#picker = picker;
	}

	// A getter, not a field $derived: #canvas is set in the constructor, after field initializers.
	get history(): HistoryTarget | undefined {
		return historyTarget({ frames: this.#canvas.frames, frameId: this.historyFrameId });
	}

	fieldError = (field: EditField): string | undefined => {
		const error = this.drafts[field]?.error;
		return error === undefined ? undefined : FIELD_ERROR_COPY[error];
	};

	#pump = (): void => {
		const step = nextSend({
			state: this.requests,
			frames: this.#canvas.frames,
			newRequestId: () => crypto.randomUUID(),
		});
		this.requests = step.state;
		if (step.send !== undefined) {
			postEditRequest(step.send);
		}
	};

	#setDraft = (field: EditField, draft: EditDraft | undefined): void => {
		const { [field]: _dropped, ...rest } = this.drafts;
		this.drafts = draft === undefined ? rest : { ...rest, [field]: draft };
	};

	// The draft ends unsent and its preview goes; `revert` false when the document is gone anyway.
	#dropDraft = (draft: EditDraft, revert: boolean): void => {
		if (revert && draft.previewed) {
			this.#canvas.sendToFrame(draft.key.frameId, baselinePreview(draft));
		}
		this.#setDraft(draft.field, undefined);
		this.requests = notSaved(this.requests, draft.key);
	};

	// Focus: the frame re-describes the pick first, so the baseline a draft takes is fresh.
	handleFieldFocus = (): void => {
		const pick = this.#picker.picking.pick;
		if (pick !== undefined) {
			this.#canvas.sendToFrame(pick.frameId, { type: 'cd:pick-refresh' });
		}
	};

	handleFieldInput = (field: EditField, value: string): void => {
		const pick = this.#picker.picking.pick;
		const existing = this.drafts[field];
		const frame = this.#canvas.frames.find((candidate) => candidate.id === pick?.frameId);
		const draft =
			existing === undefined
				? startDraft({ pick, documentVersion: frame?.documentVersion ?? -1, field, value })
				: { ...existing, value, error: undefined };
		if (draft === undefined) {
			return;
		}
		const preview = draftPreview(draft);
		if (preview !== undefined) {
			this.#canvas.sendToFrame(draft.key.frameId, preview);
		}
		this.#setDraft(field, { ...draft, previewed: draft.previewed || preview !== undefined });
	};

	handleFieldCommit = (field: EditField): void => {
		const draft = this.drafts[field];
		if (draft !== undefined) {
			this.#commit(draft, { keepInvalid: true });
		}
	};

	#commit = (draft: EditDraft, { keepInvalid }: { keepInvalid: boolean }): void => {
		const verdict = commitDraft(draft);
		if (verdict.kind !== 'save' && verdict.revert !== undefined) {
			this.#canvas.sendToFrame(draft.key.frameId, verdict.revert);
		}
		if (verdict.kind === 'invalid') {
			if (keepInvalid) {
				this.#setDraft(draft.field, { ...draft, previewed: false, error: verdict.error });
			} else {
				this.#setDraft(draft.field, undefined);
				this.requests = notSaved(this.requests, draft.key);
			}
			return;
		}
		this.#setDraft(draft.field, undefined);
		if (verdict.kind === 'save') {
			this.requests = enqueueEdit(this.requests, verdict.commit);
			this.#pump();
		}
	};

	// After every pick message the picker accepted: drafts of another element commit, drafts of an
	// element that is no longer editable end, and a new pick of another element clears the copy.
	// `senderHasFocus`: the sending frame holds focus. Only such a pick moves the history frame
	// (F-146): a design's script can post a pick without focus, but not retarget Undo / Redo with it.
	handlePick = (message: FramePickMessage, frameId: string, senderHasFocus: boolean): void => {
		const pick = this.#picker.picking.pick;
		if (pick === undefined || pick.frameId !== frameId) {
			return;
		}
		if (message.edit !== undefined) {
			if (senderHasFocus) {
				this.historyFrameId = frameId;
			}
			this.requests = clearErrorOnPick(this.requests, {
				frameId,
				sourceNumber: message.edit.sourceNumber,
				repost: message.repost,
			});
		}
		this.#settleDrafts();
	};

	// A frame document loaded (cd:ready): its drafts' previews are gone.
	handleFrameReady = (frameId: string): void => {
		for (const draft of Object.values(this.drafts)) {
			if (draft.key.frameId === frameId) {
				this.#dropDraft(draft, false);
			}
		}
	};

	// After the frame list changed (canvas:updated, a render error, a forced reload).
	handleFramesChanged = (): void => {
		if (
			this.historyFrameId !== undefined &&
			this.#canvas.frames.every((frame) => frame.id !== this.historyFrameId)
		) {
			this.historyFrameId = undefined;
		}
		this.#settleDrafts();
	};

	// 9f: Undo or Redo on the history frame. Open drafts commit first (valid ones are saved, the
	// rest end), so a step always follows the saves the user made.
	handleHistoryStep = (step: HistoryStep): void => {
		const target = this.history;
		if (target === undefined || !canStep(target, step)) {
			return;
		}
		for (const draft of Object.values(this.drafts)) {
			this.#commit(draft, { keepInvalid: false });
		}
		this.requests = enqueueStep(this.requests, { frameId: target.frameId, step });
		this.#pump();
	};

	// 9f: the capture-phase window keydown. A Cmd/Ctrl+Z it takes stops here, before VS Code's own
	// webview keydown routing on the window, even when nothing can be undone.
	handleHistoryKeydown = (event: KeyboardEvent): void => {
		const step = historyKeyStep({
			key: event.key,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			repeat: event.repeat,
			isComposing: event.isComposing,
			inTextEntry: isTextEntry(event.target),
			mode: this.#picker.picking.mode,
		});
		if (step === undefined) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		// stopPropagation skips App's bubble keydown, which ends the scroll-sink gesture: do it here.
		this.#canvas.endSinkGesture();
		this.handleHistoryStep(step);
	};

	// 9f: a cd:key undo / redo from a frame; a request to check, not a keypress.
	handleFrameHistoryKey = (frameId: string, key: HistoryStep, senderHasFocus: boolean): void => {
		const step = forwardedHistoryStep({
			key,
			mode: this.#picker.picking.mode,
			senderFrameId: frameId,
			historyFrameId: this.historyFrameId,
			senderHasFocus,
		});
		if (step !== undefined) {
			this.handleHistoryStep(step);
		}
	};

	#settleDrafts = (): void => {
		const pick = this.#picker.picking.pick;
		for (const draft of Object.values(this.drafts)) {
			const frame = this.#canvas.frames.find((candidate) => candidate.id === draft.key.frameId);
			const fate = draftFate({ draft, frame, pick });
			if (fate === 'commit') {
				this.#commit(draft, { keepInvalid: false });
			} else if (fate === 'drop') {
				this.#dropDraft(draft, frame?.documentVersion === draft.key.documentVersion);
			}
		}
	};

	handleEditAnswer = (message: ArtboardEditedMessage | UiErrorMessage): void => {
		const step = answerEdit(this.requests, message);
		if (step.state === this.requests) {
			return;
		}
		this.requests = step.state;
		if (step.adopt !== undefined) {
			const adopted = this.#canvas.adoptEditAnswer(step.adopt.answer, step.adopt.baseHash);
			if (step.stepDone !== undefined) {
				// Written either way; when a newer post won, it already reloaded the frame.
				if (adopted) {
					this.#canvas.reloadFrame(step.stepDone.frameId);
				}
				const verb = step.stepDone.step === 'undo' ? 'Undone' : 'Redone';
				this.#announcement = {
					text: `${verb} in ${frameLabel(this.#canvas.frames, step.stepDone.frameId)}.`,
					sequence: this.#announcement.sequence + 1,
				};
			}
		}
		for (const frameId of step.reloadFrameIds) {
			this.#canvas.reloadFrame(frameId);
		}
		this.handleFramesChanged();
		this.#pump();
	};
}
