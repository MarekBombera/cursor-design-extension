import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE, panelFrameHtml } from './canvasSnapshot';
import { claimedRequestId, parseChromeMessage } from './chromeMessages';
import {
	forgetHistory,
	historyEpoch,
	historyFlags,
	historyStepTarget,
	recordEdit,
	recordStep,
} from './editHistory';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
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
import {
	ArtboardNotFoundError,
	ConflictError,
	InvalidArgsError,
	NoWorkspaceError,
} from '../disk/errors';
import { parseArtboardId } from '../disk/parse';
import { postAnswerToPanel } from '../panel/openArtboardPanel';
import type { ArtboardEditMessage } from '../webview/hostMessages';

// vscode glue only (9c): chromeMessages.ts parses, panelRequestCopy.ts words the copy, the disk lib decides and
// writes, the outbox times the post, editHistory.ts (9f) holds the undo steps. Never rejects.
// ponytail: no host guard of its own against two requests in flight: the chrome sends one at a
// time. A webview reload while a step awaits the lock lets the new chrome send a second step on
// the same target; it conflicts with the first's write and forgets a valid history, with the
// "changed on disk" copy. No data loss.

const EDIT_SCOPE = 'panelEdit.answer';
const HISTORY_SCOPE = 'panelEdit.history';

type Refuse = (message: string, error: unknown) => void;

// Logs the failure; answers it with the copy when the attempt has a requestId to answer to.
const refuser =
	({
		requestId,
		scope,
		outputChannel,
	}: {
		requestId: string | undefined;
		scope: string;
		outputChannel: vscode.OutputChannel;
	}): Refuse =>
	(message, error) => {
		logDiskError({ scope, error, outputChannel });
		if (requestId !== undefined) {
			postAnswerToPanel({ type: 'ui:error', requestId, message });
		}
	};

// The checks both panel writes run first: a usable requestId (else logged, never answered), a
// trusted workspace and a folder (else refused). Undefined: already logged or refused.
const checkedWorkspaceRoot = ({
	type,
	requestId,
	refuse,
}: {
	type: string;
	requestId: string | undefined;
	refuse: Refuse;
}): string | undefined => {
	if (requestId === undefined) {
		refuse('', new InvalidArgsError(`${type} from the panel has no valid requestId.`));
		return undefined;
	}
	if (!vscode.workspace.isTrusted) {
		refuse(UNTRUSTED_WORKSPACE_MESSAGE, `${type} refused in an untrusted workspace.`);
		return undefined;
	}
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		const error = new NoWorkspaceError();
		refuse(error.message, error);
		return undefined;
	}
	return workspaceFolder.uri.fsPath;
};

// The answer to a written (or same-bytes) change: the tagged copy the echo will post, and the
// history flags after it. editArtboard refuses a result over the preview cap and an undo or redo
// writes a file that was under it, so panelFrameHtml returns no too-large errorMessage here.
const postEdited = ({
	requestId,
	workspaceRoot,
	written,
	outputChannel,
}: {
	requestId: string;
	workspaceRoot: string;
	written: { artboardId: string; hash: string; generation: number; html: string };
	outputChannel: vscode.OutputChannel;
}): void => {
	const posted = panelFrameHtml({
		workspaceRoot,
		frameId: written.artboardId,
		html: written.html,
		onTagError: (frameId, error) => {
			logDiskError({ scope: `panelEdit.sourceTags:${frameId}`, error, outputChannel });
		},
	});
	postAnswerToPanel({
		type: 'artboard:edited',
		requestId,
		frameId: written.artboardId,
		hash: written.hash,
		generation: written.generation,
		html: posted.html,
		...historyFlags(written.artboardId),
	});
};

// The edit core's union, built field by field: a style edit never carries liveText. The guard
// already requires liveText for text; a missing one is refused as malformed, never defaulted.
const toArtboardEdit = (message: ArtboardEditMessage): ArtboardEdit => {
	if (message.field !== 'text') {
		return { sourceNumber: message.sourceNumber, field: message.field, value: message.value };
	}
	if (message.liveText === undefined) {
		throw new InvalidArgsError('artboard:edit text without liveText.');
	}
	return {
		sourceNumber: message.sourceNumber,
		field: 'text',
		value: message.value,
		liveText: message.liveText,
	};
};

// One artboard:edit attempt, answered exactly once (artboard:edited, else ui:error) unless it has
// no usable requestId to answer to. editArtboard's updateArtboard takes withWorkspaceLock itself:
// never wrap it.
export const answerEditRequest = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const requestId = claimedRequestId(value);
	const refuse = refuser({ requestId, scope: EDIT_SCOPE, outputChannel });
	try {
		const workspaceRoot = checkedWorkspaceRoot({ type: 'artboard:edit', requestId, refuse });
		if (workspaceRoot === undefined || requestId === undefined) {
			return;
		}
		const message = parseChromeMessage(value);
		if (message?.type !== 'artboard:edit') {
			refuse(
				MALFORMED_EDIT_MESSAGE,
				new InvalidArgsError('Malformed artboard:edit message from the panel.'),
			);
			return;
		}
		const epoch = historyEpoch();
		const edited = await editArtboard({
			workspaceRoot,
			artboardId: message.frameId,
			baseHash: message.hash,
			edit: toArtboardEdit(message),
		});
		// ponytail: no await from here to the post, so the answer beats the watcher echo's 200 ms
		// debounce. Two ceilings: the HTML write, meta write and lock release (read + unlink) taking
		// over 200 ms lets the echo arrive first, and a refresh (watcher or frame:place) that read disk
		// before this write can post the old hash and generation after this answer. Neither loses
		// data. The chrome (9e, canvasFrames.ts): an echo first reloads the frame and the answer is
		// a no-op (a waiting save says "Not saved"); a stale pre-write post is skipped
		// (replacedHashes). Third ceiling (9f): the echo's snapshot arriving before recordEdit
		// forgets this frame's older undo steps (its new hash is not held yet), this edit then
		// starts a fresh history, and the chrome may show Undo disabled until the next post. No
		// data loss.
		if (edited.html !== edited.baseHtml) {
			recordEdit({
				frameId: edited.artboardId,
				base: { html: edited.baseHtml, hash: edited.baseHash },
				next: { html: edited.html, hash: edited.hash },
				epoch,
			});
		}
		postEdited({ requestId, workspaceRoot, written: edited, outputChannel });
	} catch (error: unknown) {
		refuse(editRequestErrorMessage(error, 'edit'), error);
	}
};

// One artboard:history attempt (9f), answered exactly once like an edit. It writes only bytes the
// history holds (disk reads and edit-core outputs), never HTML from the chrome, through the same
// checked write: updateArtboard compares the history's current hash under the lock (never wrap
// it). A conflict or a missing file forgets the frame's history; busy or a disk error keeps it.
// ponytail: after a conflict whose disk hash the last snapshot already carried, no new post
// arrives, so Undo stays enabled in the chrome and answers "Nothing to undo" until the next post.
export const answerHistoryRequest = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const requestId = claimedRequestId(value);
	const refuse = refuser({ requestId, scope: HISTORY_SCOPE, outputChannel });
	let frameId: string | undefined;
	try {
		const workspaceRoot = checkedWorkspaceRoot({ type: 'artboard:history', requestId, refuse });
		if (workspaceRoot === undefined || requestId === undefined) {
			return;
		}
		const message = parseChromeMessage(value);
		if (message?.type !== 'artboard:history') {
			refuse(
				MALFORMED_HISTORY_MESSAGE,
				new InvalidArgsError('Malformed artboard:history message from the panel.'),
			);
			return;
		}
		// Its InvalidArtboardIdError maps to the same malformed copy, by design.
		frameId = parseArtboardId(message.frameId);
		const restore = historyStepTarget({ frameId, step: message.step });
		if (restore === undefined) {
			refuse(
				message.step === 'undo' ? NOTHING_TO_UNDO_MESSAGE : NOTHING_TO_REDO_MESSAGE,
				new InvalidArgsError(`artboard:history ${message.step} with no step held.`),
			);
			return;
		}
		const epoch = historyEpoch();
		const written = await updateArtboard({
			workspaceRoot,
			artboardId: frameId,
			html: restore.target.html,
			baseHash: restore.base.hash,
		});
		// No await from here to the post (the 9c ceiling in answerEditRequest applies).
		recordStep({ frameId, step: message.step, baseHash: restore.base.hash, epoch });
		postEdited({
			requestId,
			workspaceRoot,
			written: { ...written, html: restore.target.html },
			outputChannel,
		});
	} catch (error: unknown) {
		if (
			frameId !== undefined &&
			(error instanceof ConflictError || error instanceof ArtboardNotFoundError)
		) {
			forgetHistory(frameId);
		}
		refuse(editRequestErrorMessage(error, 'history'), error);
	}
};
