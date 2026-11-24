import * as vscode from 'vscode';

import {
	EXPORT_HANDOFF_COMMAND,
	OPEN_ARTBOARD_COMMAND,
	REVEAL_DESIGN_FOLDER_COMMAND,
} from './commands/commandIds';
import { exportHandoff } from './commands/exportHandoff';
import { revealDesignFolder } from './commands/revealDesignFolder';
import { syncAgentSkill } from './host/agentSkill';
import { placeFrameFromChrome } from './host/artboardDisk';
import { handleOpenArtboard } from './host/handleOpenArtboard';
import { logDiskError } from './host/hostFs';
import { clearEditHistories } from './host/editHistory';
import { answerCommentRequest } from './host/panelComments';
import { isArtboardHistoryAttempt } from './host/chromeMessages';
import { answerEditRequest, answerHistoryRequest } from './host/panelEdit';
import { answerPageRequest } from './host/panelPages';
import { refreshPanel } from './host/refreshPanel';
import { replaceArtboardWatcher } from './host/watchArtboardDisk';
import { registerCursorDesignMcp } from './mcp/registerCursorDesignMcp';
import {
	postUiStatusToPanel,
	setArtboardPanelOnCommentRequest,
	setArtboardPanelOnEditRequest,
	setArtboardPanelOnFramePlace,
	setArtboardPanelOnPageRequest,
	setArtboardPanelOnVisible,
} from './panel/openArtboardPanel';

export const activate = (context: vscode.ExtensionContext): void => {
	const outputChannel = vscode.window.createOutputChannel('Cursor Design');
	context.subscriptions.push(outputChannel);

	const syncHostRuntime = (rearmMarker: boolean): void => {
		const mcpAvailable = registerCursorDesignMcp({ context, outputChannel });
		postUiStatusToPanel({ mcpAvailable });
		if (mcpAvailable) {
			// Cursor only: the skill documents the MCP tools.
			void syncAgentSkill({ extensionUri: context.extensionUri, outputChannel });
		}
		replaceArtboardWatcher({ context, outputChannel, rearmMarker });
	};

	setArtboardPanelOnVisible(() => {
		void refreshPanel({ outputChannel });
	});

	setArtboardPanelOnFramePlace((value) => {
		void placeFrameFromChrome({ value, outputChannel })
			.then((errorMessage) => refreshPanel({ outputChannel, errorMessage }))
			.catch((error: unknown) => {
				logDiskError({ scope: 'extension.framePlace', error, outputChannel });
			});
	});

	setArtboardPanelOnCommentRequest((value) => {
		void answerCommentRequest({ value, outputChannel });
	});

	setArtboardPanelOnPageRequest((value) => {
		void answerPageRequest({ value, outputChannel });
	});

	setArtboardPanelOnEditRequest((value) => {
		void (isArtboardHistoryAttempt(value) ? answerHistoryRequest : answerEditRequest)({
			value,
			outputChannel,
		});
	});

	if (vscode.workspace.isTrusted) {
		syncHostRuntime(false);
	} else {
		postUiStatusToPanel({ mcpAvailable: false });
	}

	context.subscriptions.push(
		vscode.workspace.onDidGrantWorkspaceTrust(() => {
			syncHostRuntime(false);
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			// ponytail: any folder change clears all undo history, not only a new first folder.
			// Upgrade path: clear only when firstWorkspaceFolder changes.
			clearEditHistories();
			if (!vscode.workspace.isTrusted) {
				postUiStatusToPanel({ mcpAvailable: false });
				replaceArtboardWatcher({ context, outputChannel, rearmMarker: true });
			} else {
				syncHostRuntime(true);
			}
			void refreshPanel({ outputChannel });
		}),
		vscode.commands.registerCommand(OPEN_ARTBOARD_COMMAND, () => {
			void handleOpenArtboard({ context, outputChannel });
		}),
		vscode.commands.registerCommand(REVEAL_DESIGN_FOLDER_COMMAND, () => {
			void revealDesignFolder(outputChannel);
		}),
		vscode.commands.registerCommand(EXPORT_HANDOFF_COMMAND, () => {
			void exportHandoff(outputChannel);
		}),
	);
};

export const deactivate = (): void => {};
