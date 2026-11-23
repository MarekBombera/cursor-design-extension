import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE, panelFrameHtml } from './canvasSnapshot';
import { claimedRequestId, parseChromeMessage } from './chromeMessages';
import {
	type HistoryKey,
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
import type { PageLocation } from '../disk/layoutFs';
import { resolveRequestedPage } from '../disk/openPage';
import { parseArtboardId } from '../disk/parse';
import { postAnswerToPanel } from '../panel/openArtboardPanel';
import type { ArtboardEditMessage } from '../webview/hostMessages';

// vscode glue only. Neither export ever rejects.
// ponytail: no host guard against two requests in flight (the chrome sends one at a time). A
// webview reload while a step awaits the lock lets the new chrome send a second step on the same
// target; it conflicts and forgets a valid history ("changed on disk" copy), no data loss. Upgrade
// path: a per-frame in-flight latch here.

const EDIT_SCOPE = 'panelEdit.answer';
const HISTORY_SCOPE = 'panelEdit.history';

type Refuse = (message: string, error: unknown) => void;

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

// Undefined: already logged or refused.
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
	page,
	written,
	outputChannel,
}: {
	requestId: string;
	page: PageLocation;
	written: { artboardId: string; hash: string; generation: number; html: string };
	outputChannel: vscode.OutputChannel;
}): void => {
	const posted = panelFrameHtml({
		workspaceRoot: page.workspaceRoot,
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
		postEdited({ requestId, page, written: edited, outputChannel });
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
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const requestId = claimedRequestId(value);
	const refuse = refuser({ requestId, scope: HISTORY_SCOPE, outputChannel });
	let key: HistoryKey | undefined;
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
			outputChannel,
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
