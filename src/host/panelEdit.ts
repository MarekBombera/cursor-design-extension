import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE, panelFrameHtml } from './canvasSnapshot';
import {
	MALFORMED_EDIT_MESSAGE,
	claimedRequestId,
	editRequestErrorMessage,
	parseChromeMessage,
} from './chromeMessages';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import type { ArtboardEdit } from '../disk/artboardEdit';
import { editArtboard } from '../disk/artboardEditFs';
import { InvalidArgsError, NoWorkspaceError } from '../disk/errors';
import { postAnswerToPanel } from '../panel/openArtboardPanel';
import type { ArtboardEditMessage } from '../webview/hostMessages';

// vscode glue only (9c): chromeMessages.ts parses and words the copy, the disk lib decides and
// writes, the outbox times the post. Never rejects.

const SCOPE = 'panelEdit.answer';

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
	const refuse = (message: string, error: unknown): void => {
		logDiskError({ scope: SCOPE, error, outputChannel });
		if (requestId !== undefined) {
			postAnswerToPanel({ type: 'ui:error', requestId, message });
		}
	};
	try {
		if (requestId === undefined) {
			logDiskError({
				scope: SCOPE,
				error: new InvalidArgsError('artboard:edit from the panel has no valid requestId.'),
				outputChannel,
			});
			return;
		}
		if (!vscode.workspace.isTrusted) {
			refuse(UNTRUSTED_WORKSPACE_MESSAGE, 'artboard:edit refused in an untrusted workspace.');
			return;
		}
		const workspaceFolder = firstWorkspaceFolder();
		if (!workspaceFolder) {
			const error = new NoWorkspaceError();
			refuse(error.message, error);
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
		const workspaceRoot = workspaceFolder.uri.fsPath;
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
		// (replacedHashes). editArtboard refuses a result over the preview cap,
		// so panelFrameHtml returns no too-large errorMessage here.
		const posted = panelFrameHtml({
			workspaceRoot,
			frameId: edited.artboardId,
			html: edited.html,
			onTagError: (frameId, error) => {
				logDiskError({ scope: `panelEdit.sourceTags:${frameId}`, error, outputChannel });
			},
		});
		postAnswerToPanel({
			type: 'artboard:edited',
			requestId,
			frameId: edited.artboardId,
			hash: edited.hash,
			generation: edited.generation,
			html: posted.html,
		});
	} catch (error: unknown) {
		refuse(editRequestErrorMessage(error), error);
	}
};
