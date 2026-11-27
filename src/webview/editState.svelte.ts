import type { CanvasState } from './canvasState.svelte';
import type { StyleChange, StyleField } from '../disk/editValues';
import type { ChromePick } from './commentPick';
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
	invalidDraftCopy,
	sameElement,
	startDraft,
	stylesCommit,
} from './editDrafts';
import type { FramePickMessage } from './frame/frameMessages';
import type {
	ArtboardEditedMessage,
	ArtboardEditMessage,
	ArtboardHistoryMessage,
	HistoryStep,
	PagePost,
	UiErrorMessage,
} from './hostMessages';
import {
	canStep,
	forwardedHistoryStep,
	historyKeyStep,
	type HistoryTarget,
	historyTarget,
} from './undoRedo';

export class EditState {
	// Only the focused field gets input, but an invalid commit keeps its draft, so several can exist.
	drafts: Partial<Record<EditField, EditDraft>> = $state.raw({});
	requests: EditRequestsState = $state.raw(INITIAL_EDIT_REQUESTS);
	// The frame of the latest accepted Edit-mode pick from a frame that held focus. It outlives the
	// pick (a step's reload drops it) and mode switches; it clears when the frame leaves, and a
	// webview reload loses it.
	historyFrameId: string | undefined = $state(undefined);
	#announcement = $state.raw({ text: '', sequence: 0 });

	readonly #canvas: CanvasState;
	readonly #picker: CommentPicker;
	readonly #post: PagePost<ArtboardEditMessage | ArtboardHistoryMessage>;

	readonly requestError = $derived(this.requests.error?.message);
	// After a written step or a saved Reset / Add border; a repeat still speaks (liveRegionText).
	readonly announcement = $derived(liveRegionText(this.#announcement));

	constructor({
		canvas,
		picker,
		post,
	}: {
		canvas: CanvasState;
		picker: CommentPicker;
		post: PagePost<ArtboardEditMessage | ArtboardHistoryMessage>;
	}) {
		this.#canvas = canvas;
		this.#picker = picker;
		this.#post = post;
	}

	// $derived.by, not $derived: #canvas and #picker are set in the constructor, and only the lazy
	// function form may read them (TS2729); nothing reads these during field initialization.
	readonly history: HistoryTarget | undefined = $derived.by(() =>
		historyTarget({ frames: this.#canvas.frames, frameId: this.historyFrameId }),
	);

	// The style fields with an open draft for the picked element: editableSections keeps them shown
	// while an emptied box's preview says they are unset.
	readonly drafted: ReadonlySet<StyleField> = $derived.by(() => {
		const pick = this.#picker.picking.pick;
		return new Set(
			Object.values(this.drafts).flatMap((draft) =>
				draft.field === 'text' || !sameElement(draft.key, pick) ? [] : [draft.field],
			),
		);
	});

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
			this.#post(step.send);
		}
	};

	#announce = (text: string): void => {
		this.#announcement = { text, sequence: this.#announcement.sequence + 1 };
	};

	#documentVersion = (pick: ChromePick | undefined): number =>
		this.#canvas.frames.find((candidate) => candidate.id === pick?.frameId)?.documentVersion ?? -1;

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
		this.requests = notSaved(this.requests, { key: draft.key });
	};

	// Focus on any inspector control: the frame re-describes the pick first, so the baseline a
	// draft or a choice takes is fresh (a design's script may have changed the style since).
	handleFieldFocus = (): void => {
		const pick = this.#picker.picking.pick;
		if (pick !== undefined) {
			this.#canvas.sendToFrame(pick.frameId, { type: 'cd:pick-refresh' });
		}
	};

	// Ends unsent and unannounced: the user moved to another control of the same element.
	#endDraftSilently = (draft: EditDraft): void => {
		if (draft.previewed) {
			this.#canvas.sendToFrame(draft.key.frameId, baselinePreview(draft));
		}
		this.#setDraft(draft.field, undefined);
	};

	// One open draft per element: a valid one is saved first, the rest end silently, so no save of
	// this element lands between another draft's start and its commit (a stale baseline).
	// `field` undefined ends them all (a choice, Reset or Add border).
	#endOtherDrafts = (field: EditField | undefined): void => {
		const pick = this.#picker.picking.pick;
		for (const draft of Object.values(this.drafts)) {
			if (draft.field === field || !sameElement(draft.key, pick)) {
				continue;
			}
			if (commitDraft(draft).kind === 'save') {
				this.#commit(draft, { ending: 'field' });
			} else {
				this.#endDraftSilently(draft);
			}
		}
	};

	handleFieldInput = (field: EditField, value: string): void => {
		const pick = this.#picker.picking.pick;
		const existing = this.drafts[field];
		// The others end before this draft reads its baseline, so their reverts land first (D5).
		if (existing === undefined) {
			this.#endOtherDrafts(field);
		}
		const draft =
			existing === undefined
				? startDraft({ pick, documentVersion: this.#documentVersion(pick), field, value })
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

	// A choice, Reset or Add border: one save of every change (one undo step). True when enqueued.
	handleStyleChanges = (changes: readonly StyleChange[], announcement?: string): boolean => {
		this.#endOtherDrafts(undefined);
		const pick = this.#picker.picking.pick;
		const verdict = stylesCommit({ pick, documentVersion: this.#documentVersion(pick), changes });
		if (verdict.kind === 'invalid') {
			this.requests = notSaved(this.requests, {
				key: verdict.key,
				message: FIELD_ERROR_COPY[verdict.error],
			});
			return false;
		}
		if (verdict.kind !== 'save') {
			return false;
		}
		this.#canvas.sendToFrame(verdict.commit.key.frameId, verdict.preview);
		this.requests = enqueueEdit(this.requests, verdict.commit);
		this.#pump();
		if (announcement !== undefined) {
			this.#announce(announcement);
		}
		return true;
	};

	// The page is going away: open drafts end unsaved, before the unmount blurs their field (a blur
	// commits). No revert: their document goes too.
	discardDrafts = (): void => {
		this.drafts = {};
	};

	handleFieldCommit = (field: EditField): void => {
		const draft = this.drafts[field];
		if (draft !== undefined) {
			this.#commit(draft, { ending: 'field' });
		}
	};

	#commit = (draft: EditDraft, { ending }: { ending: 'field' | 'pick' | 'step' }): void => {
		const verdict = commitDraft(draft);
		if (verdict.kind !== 'save' && verdict.revert !== undefined) {
			this.#canvas.sendToFrame(draft.key.frameId, verdict.revert);
		}
		if (verdict.kind === 'invalid') {
			if (ending === 'field') {
				this.#setDraft(draft.field, { ...draft, previewed: false, error: verdict.error });
			} else {
				this.#setDraft(draft.field, undefined);
				this.requests = notSaved(this.requests, {
					key: draft.key,
					message: invalidDraftCopy(verdict.error, ending),
				});
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
	// Only a pick from the frame holding focus moves the history frame: a design's script can post a
	// pick without focus, but must not retarget Undo / Redo with it.
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

	handleFramesChanged = (): void => {
		if (
			this.historyFrameId !== undefined &&
			this.#canvas.frames.every((frame) => frame.id !== this.historyFrameId)
		) {
			this.historyFrameId = undefined;
		}
		this.#settleDrafts();
	};

	// Open drafts commit first (valid ones are saved, the rest end), so a step always follows the
	// saves the user made.
	handleHistoryStep = (step: HistoryStep): void => {
		const target = this.history;
		if (target === undefined || !canStep(target, step)) {
			return;
		}
		for (const draft of Object.values(this.drafts)) {
			this.#commit(draft, { ending: 'step' });
		}
		this.requests = enqueueStep(this.requests, { frameId: target.frameId, step });
		this.#pump();
	};

	// Capture phase: a Cmd/Ctrl+Z it takes stops here, before VS Code's own webview keydown routing
	// on the window, even when nothing can be undone.
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

	// A frame's cd:key undo / redo is a request to check, not a keypress.
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
				this.#commit(draft, { ending: 'pick' });
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
				this.#announce(`${verb} in ${frameLabel(this.#canvas.frames, step.stepDone.frameId)}.`);
			}
		}
		for (const frameId of step.reloadFrameIds) {
			this.#canvas.reloadFrame(frameId);
		}
		this.handleFramesChanged();
		this.#pump();
	};
}
