import { panelFrameHtml } from './canvasSnapshot';
import {
	type HistoryKey,
	forgetHistory,
	historyEpoch,
	historyFlags,
	historyStepTarget,
	recordEdit,
	recordStep,
} from './editHistory';
import { checkedPanelMessage, panelRequest } from './panelRequest';
import {
	MALFORMED_EDIT_MESSAGE,
	MALFORMED_HISTORY_MESSAGE,
	NOTHING_TO_REDO_MESSAGE,
	NOTHING_TO_UNDO_MESSAGE,
	editRequestErrorMessage,
} from './panelRequestCopy';
import type { ArtboardEdit } from '../disk/artboardEdit';
import { editArtboard } from '../disk/artboardEditFs';
import { updateArtboard } from '../disk/artboardFs';
import { ArtboardNotFoundError, ConflictError, InvalidArgsError } from '../disk/errors';
import type { PageLocation } from '../disk/layoutFs';
import { resolveRequestedPage } from '../disk/openPage';
import { parseArtboardId } from '../disk/parse';
import type { PanelPorts } from '../panel/openArtboardPanel';
import type { ArtboardEditMessage } from '../webview/hostMessages';

// Panel edit and undo/redo handlers; all I/O through ports. Neither export ever rejects.
// ponytail: no host guard against two requests in flight (the chrome sends one at a time). A
// webview reload while a step awaits the lock lets the new chrome send a second step on the same
// target; it conflicts and forgets a valid history ("changed on disk" copy), no data loss. Upgrade
// path: a per-frame in-flight latch here.

const EDIT_SCOPE = 'panelEdit.answer';
const HISTORY_SCOPE = 'panelEdit.history';

// The answer to a written (or same-bytes) change: the tagged copy the echo will post, and the
// history flags after it. editArtboard refuses a result over the preview cap and an undo or redo
// writes a file that was under it, so panelFrameHtml returns no too-large errorMessage here.
const postEdited = ({
	requestId,
	page,
	written,
	ports,
}: {
	requestId: string;
	page: PageLocation;
	written: { artboardId: string; hash: string; generation: number; html: string };
	ports: PanelPorts;
}): void => {
	const posted = panelFrameHtml({
		workspaceRoot: page.workspaceRoot,
		pageId: page.pageId,
		frameId: written.artboardId,
		html: written.html,
		onTagError: (frameId, error) => {
			ports.log(`panelEdit.sourceTags:${frameId}`, error);
		},
	});
	ports.postAnswer({
		type: 'artboard:edited',
		requestId,
		frameId: written.artboardId,
		hash: written.hash,
		generation: written.generation,
		html: posted.html,
		...historyFlags({ pageId: page.pageId, frameId: written.artboardId }),
	});
};

// The edit core's union, built key by key: nothing else of the message reaches it.
const toArtboardEdit = (message: ArtboardEditMessage): ArtboardEdit =>
	'styles' in message
		? { sourceNumber: message.sourceNumber, styles: message.styles }
		: {
				sourceNumber: message.sourceNumber,
				field: 'text',
				value: message.value,
				liveText: message.liveText,
			};

// Answered exactly once unless it has no usable requestId.
export const answerEditRequest = async ({
	value,
	ports,
}: {
	value: unknown;
	ports: PanelPorts;
}): Promise<void> => {
	const request = panelRequest({ value, type: 'artboard:edit', scope: EDIT_SCOPE, ports });
	if (request === undefined) {
		return;
	}
	const { requestId, refuse } = request;
	try {
		const checked = checkedPanelMessage({
			value,
			type: 'artboard:edit',
			malformedMessage: MALFORMED_EDIT_MESSAGE,
			refuse,
			ports,
		});
		if (checked === undefined) {
			return;
		}
		const { workspaceRoot, message } = checked;
		const epoch = historyEpoch();
		const page = await resolveRequestedPage({ workspaceRoot, pageId: message.pageId });
		const edited = await editArtboard({
			page,
			artboardId: message.frameId,
			baseHash: message.hash,
			edit: toArtboardEdit(message),
		});
		// ponytail: no await from here to the post, so the answer beats the watcher echo's 200 ms
		// debounce. None of these ceilings loses data: a write plus lock release over 200 ms lets
		// the echo arrive first (the chrome reloads; the answer is a no-op); a refresh that read
		// disk before the write can post the old hash after it (the chrome skips it via
		// replacedHashes); an echo before recordEdit forgets older undo steps, so this edit starts
		// a fresh history. Upgrade path: keepUnchangedHistories skips a frame mid-edit.
		if (edited.html !== edited.baseHtml) {
			recordEdit({
				pageId: message.pageId,
				frameId: edited.artboardId,
				base: { html: edited.baseHtml, hash: edited.baseHash },
				next: { html: edited.html, hash: edited.hash },
				epoch,
			});
		}
		postEdited({ requestId, page, written: edited, ports });
	} catch (error: unknown) {
		refuse(editRequestErrorMessage(error, 'edit'), error);
	}
};

// Answered exactly once like an edit. Writes only bytes the history holds, never HTML from the
// chrome, through updateArtboard with the history's current hash (it takes the lock: never wrap
// it). A conflict or a missing file forgets the frame's history; busy or a disk error keeps it.
// ponytail: after a conflict whose disk hash the last snapshot already carried, no new post
// arrives, so Undo stays enabled and answers "Nothing to undo" until the next post. Upgrade path:
// post a refresh after forgetHistory.
export const answerHistoryRequest = async ({
	value,
	ports,
}: {
	value: unknown;
	ports: PanelPorts;
}): Promise<void> => {
	const request = panelRequest({ value, type: 'artboard:history', scope: HISTORY_SCOPE, ports });
	if (request === undefined) {
		return;
	}
	const { requestId, refuse } = request;
	let key: HistoryKey | undefined;
	try {
		const checked = checkedPanelMessage({
			value,
			type: 'artboard:history',
			malformedMessage: MALFORMED_HISTORY_MESSAGE,
			refuse,
			ports,
		});
		if (checked === undefined) {
			return;
		}
		const { workspaceRoot, message } = checked;
		// Its InvalidArtboardIdError maps to the same malformed copy, by design.
		const frameId = parseArtboardId(message.frameId);
		key = { pageId: message.pageId, frameId };
		// Before the resolve, so "Nothing to undo" does no I/O.
		const restore = historyStepTarget({ ...key, step: message.step });
		if (restore === undefined) {
			refuse(
				message.step === 'undo' ? NOTHING_TO_UNDO_MESSAGE : NOTHING_TO_REDO_MESSAGE,
				new InvalidArgsError(`artboard:history ${message.step} with no step held.`),
			);
			return;
		}
		const epoch = historyEpoch();
		const page = await resolveRequestedPage({ workspaceRoot, pageId: message.pageId });
		const written = await updateArtboard({
			page,
			artboardId: frameId,
			html: restore.target.html,
			baseHash: restore.base.hash,
		});
		// No await from here to the post (answerEditRequest's ceilings apply).
		recordStep({ ...key, step: message.step, baseHash: restore.base.hash, epoch });
		postEdited({
			requestId,
			page,
			written: { ...written, html: restore.target.html },
			ports,
		});
	} catch (error: unknown) {
		if (
			key !== undefined &&
			(error instanceof ConflictError || error instanceof ArtboardNotFoundError)
		) {
			forgetHistory(key);
		}
		refuse(editRequestErrorMessage(error, 'history'), error);
	}
};
