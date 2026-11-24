import * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { pageRequestId, pageRequestType, parseChromeMessage } from './chromeMessages';
import { forgetPageHistories } from './editHistory';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import { MALFORMED_PAGE_REQUEST_MESSAGE, pageRequestErrorMessage } from './panelRequestCopy';
import { refreshPanel } from './refreshPanel';
import { InvalidArgsError, NoWorkspaceError } from '../disk/errors';
import { readProjectFile } from '../disk/layoutFs';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, deletePage, listedPage, openPage, renamePage } from '../disk/pageOps';
import { postAnswerToPanel } from '../panel/openArtboardPanel';

// vscode glue only. Never rejects.

const LOG_SCOPES = {
	'page:open': 'panelPages.open',
	'page:create': 'panelPages.create',
	'page:rename': 'panelPages.rename',
	'page:delete': 'panelPages.delete',
} as const;

const DELETE_ACTION = 'Delete';

// A cancelled modal returns with nothing written (the caller answers page:saved). The last-page
// check runs before the modal so it never asks for a delete that must fail; deletePage re-checks it under the lock.
const confirmAndDeletePage = async ({
	workspaceRoot,
	pageId,
}: {
	workspaceRoot: string;
	pageId: string;
}): Promise<void> => {
	const { project, entry } = listedPage(await readProjectFile(workspaceRoot), pageId);
	if (project.pages.length === 1) {
		throw new InvalidArgsError('The last page cannot be deleted.');
	}
	const choice = await vscode.window.showWarningMessage(
		`Delete "${entry.title}"?`,
		{ modal: true, detail: 'Its files move to .vibeboard/deleted/.' },
		DELETE_ACTION,
	);
	if (choice !== DELETE_ACTION) {
		return;
	}
	await deletePage({ workspaceRoot, pageId, now: new Date() });
	forgetPageHistories(pageId);
};

// Answered exactly once (page:saved, a cancelled delete included, or ui:error) unless it has no
// usable requestId; every answer is followed by a refresh, so the list and stage catch up without
// waiting on the watcher. One resolve here covers renamePage and deletePage (they never resolve);
// createPage and openPage resolve again inside by contract, lock-free after this one.
export const answerPageRequest = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<void> => {
	const requestId = pageRequestId(value);
	const type = pageRequestType(value);
	// Routing only calls this for a claimed type; a request without a usable requestId has nothing to answer to.
	if (type === undefined || requestId === undefined) {
		logDiskError({
			scope: 'panelPages.answer',
			error: new InvalidArgsError(
				`${type ?? 'Page request'} from the panel has no valid requestId.`,
			),
			outputChannel,
		});
		return;
	}
	const scope = LOG_SCOPES[type];
	const refuse = (message: string, error: unknown): void => {
		logDiskError({ scope, error, outputChannel });
		postAnswerToPanel({ type: 'ui:error', requestId, message });
		void refreshPanel({ outputChannel });
	};
	try {
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
				MALFORMED_PAGE_REQUEST_MESSAGE,
				new InvalidArgsError(`Malformed ${type} message from the panel.`),
			);
			return;
		}
		const workspaceRoot = workspaceFolder.uri.fsPath;
		await resolveOpenPage({ workspaceRoot, createIfFresh: false });
		// Exhaustive on purpose: a new page request type fails to compile here until it is handled.
		switch (message.type) {
			case 'page:open':
				await openPage({ workspaceRoot, pageId: message.pageId });
				break;
			case 'page:create':
				await createPage({ workspaceRoot, writeEnsurePanelMarker: false });
				break;
			case 'page:rename':
				await renamePage({ workspaceRoot, pageId: message.pageId, title: message.title });
				break;
			case 'page:delete':
				await confirmAndDeletePage({ workspaceRoot, pageId: message.pageId });
				break;
			default:
				return message satisfies never;
		}
		postAnswerToPanel({ type: 'page:saved', requestId });
		void refreshPanel({ outputChannel });
	} catch (error: unknown) {
		refuse(pageRequestErrorMessage({ type, error }), error);
	}
};
