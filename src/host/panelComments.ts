import * as vscode from 'vscode';

import { toSafeArtboardErrorMessage } from './artboardDisk';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import {
	commentCreateRequestId,
	parseChromeMessage,
	toNewComment,
	toPostedComment,
} from './chromeMessages';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import { addComment, readComments } from '../disk/comments';
import { InvalidArgsError, NoWorkspaceError } from '../disk/errors';
import { postAnswerToPanel, postCommentsToPanel } from '../panel/openArtboardPanel';

// vscode glue only: chromeMessages.ts maps, the disk lib decides, the outbox times the posts.
// Neither export ever rejects.

const READ_FALLBACK_MESSAGE = 'Could not read comments. Check the Output panel: Cursor Design.';

const CREATE_FALLBACK_MESSAGE = 'Could not add the comment. Check the Output panel: Cursor Design.';

const MALFORMED_CREATE_MESSAGE = 'Could not add the comment. Pick the element again.';

// The last read started wins, so a slow read never overwrites a newer list.
let readGeneration = 0;

export const postPanelComments = async ({
	outputChannel,
}: {
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const token = ++readGeneration;
	// ponytail: no total payload cap; 500 comments × 100 replies × 2000 chars is the ceiling, the
	// same as for canvas:updated. Upgrade path: page the list if a real workspace gets close.
	try {
		const workspaceFolder = firstWorkspaceFolder();
		if (!vscode.workspace.isTrusted || !workspaceFolder) {
			postCommentsToPanel({ comments: [] });
			return;
		}
		const comments = await readComments({ workspaceRoot: workspaceFolder.uri.fsPath });
		if (token === readGeneration) {
			postCommentsToPanel({ comments: comments.map(toPostedComment) });
		}
	} catch (error: unknown) {
		logDiskError({ scope: 'panelComments.read', error, outputChannel });
		if (token === readGeneration) {
			postCommentsToPanel({
				comments: [],
				error: toSafeArtboardErrorMessage(error, READ_FALLBACK_MESSAGE),
			});
		}
	}
};

// One comment:create attempt, answered exactly once (comment:added or ui:error) unless it has no
// usable requestId to answer to.
export const createCommentFromChrome = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const requestId = commentCreateRequestId(value);
	const refuse = (message: string, error: unknown): void => {
		logDiskError({ scope: 'panelComments.create', error, outputChannel });
		if (requestId !== undefined) {
			postAnswerToPanel({ type: 'ui:error', requestId, message });
		}
	};
	try {
		if (requestId === undefined) {
			logDiskError({
				scope: 'panelComments.create',
				error: new InvalidArgsError('comment:create from the panel has no valid requestId.'),
				outputChannel,
			});
			return;
		}
		if (!vscode.workspace.isTrusted) {
			refuse(UNTRUSTED_WORKSPACE_MESSAGE, 'comment:create refused in an untrusted workspace.');
			return;
		}
		const workspaceFolder = firstWorkspaceFolder();
		if (!workspaceFolder) {
			const error = new NoWorkspaceError();
			refuse(error.message, error);
			return;
		}
		const message = parseChromeMessage(value);
		if (message?.type !== 'comment:create') {
			refuse(
				MALFORMED_CREATE_MESSAGE,
				new InvalidArgsError('Malformed comment:create message from the panel.'),
			);
			return;
		}
		await addComment({
			workspaceRoot: workspaceFolder.uri.fsPath,
			comment: toNewComment(message),
		});
		postAnswerToPanel({ type: 'comment:added', requestId });
		void postPanelComments({ outputChannel });
	} catch (error: unknown) {
		refuse(toSafeArtboardErrorMessage(error, CREATE_FALLBACK_MESSAGE), error);
	}
};
