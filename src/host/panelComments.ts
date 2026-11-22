import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import {
	commentRequestId,
	commentRequestType,
	parseChromeMessage,
	toNewComment,
	toPostedComment,
} from './chromeMessages';
import {
	COPIED_NOT_MARKED_MESSAGE,
	NOTHING_OPEN_MESSAGE,
	commentRequestErrorMessage,
	isCopyType,
	malformedRequestMessage,
} from './panelRequestCopy';
import { openCommentsPrompt, singleCommentPrompt } from './commentPrompt';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import {
	addComment,
	getComment,
	listComments,
	markCommentsSent,
	readComments,
	replyToComment,
	setCommentStatus,
} from '../disk/comments';
import { InvalidArgsError, NoWorkspaceError, toSafeArtboardErrorMessage } from '../disk/errors';
import { resolveOpenPage } from '../disk/openPage';
import { postAnswerToPanel, postCommentsToPanel } from '../panel/openArtboardPanel';

// vscode glue only. Neither export ever rejects.

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
		const comments = await readComments({
			page: await resolveOpenPage({
				workspaceRoot: workspaceFolder.uri.fsPath,
				createIfFresh: false,
			}),
		});
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
	'comment:copy': 'panelComments.copy',
	'comment:copy-open': 'panelComments.copyOpen',
} as const;

// Answered exactly once unless it has no usable requestId. The disk writes take
// withWorkspaceLock themselves: never wrap them.
// Copy: clipboard first, then markCommentsSent, so a failed write marks nothing sent; every copy
// answer, success or error, is followed by a refresh (a stale Copy all open count corrects itself).
// ponytail: getComment / listComments compute flags the prompt never uses, bounded by the 200 ms
// check budget and the parse cache. Upgrade path: a flag-free disk read.
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
			if (isCopyType(type)) {
				void postPanelComments({ outputChannel });
			}
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
		const page = await resolveOpenPage({
			workspaceRoot: workspaceFolder.uri.fsPath,
			createIfFresh: false,
		});
		// The clipboard already holds the prompt here, so any throw gets its own copy; the typed
		// message is only logged. Undefined: refused, stop.
		const markSent = async (ids: readonly string[]): Promise<number | undefined> => {
			try {
				return (await markCommentsSent({ page, ids })).length;
			} catch (error: unknown) {
				refuse(COPIED_NOT_MARKED_MESSAGE, error);
				return undefined;
			}
		};
		// Exhaustive on purpose: a new comment request type fails to compile here until it is
		// handled and answered.
		switch (message.type) {
			case 'comment:create':
				await addComment({ page, comment: toNewComment(message) });
				postAnswerToPanel({ type: 'comment:added', requestId });
				break;
			case 'comment:reply':
				await replyToComment({ page, id: message.id, body: message.body });
				postAnswerToPanel({ type: 'comment:saved', requestId });
				break;
			case 'comment:set-status':
				await setCommentStatus({ page, id: message.id, status: message.status });
				postAnswerToPanel({ type: 'comment:saved', requestId });
				break;
			case 'comment:copy': {
				const comment = await getComment({ page, id: message.id });
				await vscode.env.clipboard.writeText(singleCommentPrompt(comment));
				const count = await markSent([comment.id]);
				if (count === undefined) {
					return;
				}
				postAnswerToPanel({ type: 'ui:copied', requestId, count });
				break;
			}
			case 'comment:copy-open': {
				const { comments } = await listComments({ page, status: 'open' });
				if (comments.length === 0) {
					refuse(
						NOTHING_OPEN_MESSAGE,
						new InvalidArgsError('Copy all open with no open comments on disk.'),
					);
					return;
				}
				const ids = comments.map((comment) => comment.id);
				await vscode.env.clipboard.writeText(openCommentsPrompt(ids));
				const count = await markSent(ids);
				if (count === undefined) {
					return;
				}
				postAnswerToPanel({ type: 'ui:copied', requestId, count });
				break;
			}
			default:
				return message satisfies never;
		}
		void postPanelComments({ outputChannel });
	} catch (error: unknown) {
		refuse(commentRequestErrorMessage({ type, error }), error);
	}
};
