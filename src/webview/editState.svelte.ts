import type { CanvasState } from './canvasState.svelte';
import type { CommentPicker } from './commentPicker.svelte';
import {
	answerEdit,
	clearErrorOnPick,
	type EditField,
	type EditRequestsState,
	enqueueEdit,
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
} from './editInspector';
import type { FramePickMessage } from './frame/frameMessages';
import { postEditRequest } from './hostBridge.svelte';
import type { ArtboardEditedMessage, UiErrorMessage } from './hostMessages';

// Edit-mode saves (9e): the inspector's field drafts, their live previews in the frame, and the
// artboard:edit requests with their answers. Rules: editInspector.ts (drafts) and
// editRequests.ts (one in flight). Created after CanvasState and CommentPicker.
export class EditState {
	// One draft per field; only the focused field gets input, but an invalid commit keeps its draft.
	drafts: Partial<Record<EditField, EditDraft>> = $state({});
	requests: EditRequestsState = $state(INITIAL_EDIT_REQUESTS);

	readonly #canvas: CanvasState;
	readonly #picker: CommentPicker;

	readonly requestError = $derived(this.requests.error?.message);

	constructor({ canvas, picker }: { canvas: CanvasState; picker: CommentPicker }) {
		this.#canvas = canvas;
		this.#picker = picker;
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
	handlePick = (message: FramePickMessage, frameId: string): void => {
		const pick = this.#picker.picking.pick;
		if (pick === undefined || pick.frameId !== frameId) {
			return;
		}
		if (message.edit !== undefined) {
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
		this.#settleDrafts();
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
			this.#canvas.adoptEditAnswer(step.adopt.answer, step.adopt.baseHash);
		}
		for (const frameId of step.reloadFrameIds) {
			this.#canvas.reloadFrame(frameId);
		}
		this.handleFramesChanged();
		this.#pump();
	};
}
