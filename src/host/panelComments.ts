import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import {
	commentRequestErrorMessage,
	commentRequestId,
	commentRequestType,
	malformedRequestMessage,
	parseChromeMessage,
	toNewComment,
	toPostedComment,
} from './chromeMessages';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import { addComment, readComments, replyToComment, setCommentStatus } from '../disk/comments';
import { InvalidArgsError, NoWorkspaceError, toSafeArtboardErrorMessage } from '../disk/errors';
import { postAnswerToPanel, postCommentsToPanel } from '../panel/openArtboardPanel';

// vscode glue only: chromeMessages.ts maps, the disk lib decides, the outbox times the posts.
// Neither export ever rejects.

const READ_FALLBACK_MESSAGE = 'Could not read comments. Check the Output panel: Cursor Design.';

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

const LOG_SCOPES = {
	'comment:create': 'panelComments.create',
	'comment:reply': 'panelComments.reply',
	'comment:set-status': 'panelComments.setStatus',
} as const;

// One comment:create / comment:reply / comment:set-status attempt, answered exactly once
// (comment:added or comment:saved, else ui:error) unless it has no usable requestId to answer to.
// replyToComment and setCommentStatus take withWorkspaceLock themselves: never wrap them.
export const answerCommentRequest = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const requestId = commentRequestId(value);
	const type = commentRequestType(value);
	if (type === undefined) {
		// Routing only calls this for a claimed type, so there is nothing to answer to.
		logDiskError({
			scope: 'panelComments.answer',
			error: new InvalidArgsError('Comment request from the panel claims no known type.'),
			outputChannel,
		});
		return;
	}
	const scope = LOG_SCOPES[type];
	const refuse = (message: string, error: unknown): void => {
		logDiskError({ scope, error, outputChannel });
		if (requestId !== undefined) {
			postAnswerToPanel({ type: 'ui:error', requestId, message });
		}
	};
	try {
		if (requestId === undefined) {
			logDiskError({
				scope,
				error: new InvalidArgsError(`${type} from the panel has no valid requestId.`),
				outputChannel,
			});
			return;
		}
		if (!vscode.workspace.isTrusted) {
			refuse(UNTRUSTED_WORKSPACE_MESSAGE, `${type} refused in an untrusted workspace.`);
			return;
		}
		const workspaceFolder = firstWorkspaceFolder();
		if (!workspaceFolder) {
			const error = new NoWorkspaceError();
			refuse(error.message, error);
			return;
		}
		const message = parseChromeMessage(value);
		if (message?.type !== type) {
			refuse(
				malformedRequestMessage(type),
				new InvalidArgsError(`Malformed ${type} message from the panel.`),
			);
			return;
		}
		const workspaceRoot = workspaceFolder.uri.fsPath;
		// Exhaustive on purpose: a fourth comment request type fails to compile here until it is
		// handled and answered.
		switch (message.type) {
			case 'comment:create':
				await addComment({ workspaceRoot, comment: toNewComment(message) });
				postAnswerToPanel({ type: 'comment:added', requestId });
				break;
			case 'comment:reply':
				await replyToComment({ workspaceRoot, id: message.id, body: message.body });
				postAnswerToPanel({ type: 'comment:saved', requestId });
				break;
			case 'comment:set-status':
				await setCommentStatus({ workspaceRoot, id: message.id, status: message.status });
				postAnswerToPanel({ type: 'comment:saved', requestId });
				break;
			default:
				return message satisfies never;
		}
		void postPanelComments({ outputChannel });
	} catch (error: unknown) {
		refuse(commentRequestErrorMessage({ type, error }), error);
	}
};
