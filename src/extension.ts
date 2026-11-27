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
import { logDiskError, migrateLegacyDesignFolders } from './host/hostFs';
import { clearEditHistories } from './host/editHistory';
import { answerCommentRequest } from './host/panelComments';
import { answerEditRequest, answerHistoryRequest } from './host/panelEdit';
import { answerPageRequest } from './host/panelPages';
import { refreshPanel } from './host/refreshPanel';
import { disposeArtboardWatcher, replaceArtboardWatcher } from './host/watchArtboardDisk';
import { registerVibeboardMcp } from './mcp/registerVibeboardMcp';
import { postUiStatusToPanel, setArtboardPanelHandlers } from './panel/openArtboardPanel';

export const activate = async (context: vscode.ExtensionContext): Promise<void> => {
	const outputChannel = vscode.window.createOutputChannel('Vibeboard');
	context.subscriptions.push(outputChannel, { dispose: disposeArtboardWatcher });

	const syncHostRuntime = async (rearmMarker: boolean): Promise<void> => {
		// TODO(1.0): remove .cursor-design migration
		await migrateLegacyDesignFolders(outputChannel);
		const mcpAvailable = registerVibeboardMcp({ context, outputChannel });
		postUiStatusToPanel({ mcpAvailable });
		if (mcpAvailable && vscode.cursor?.mcp) {
			// Cursor reads ~/.cursor/skills/; every agent also gets the skill as MCP instructions.
			void syncAgentSkill({ extensionUri: context.extensionUri, outputChannel });
		}
		replaceArtboardWatcher({ context, outputChannel, rearmMarker });
	};

	setArtboardPanelHandlers({
		onVisible: () => {
			void refreshPanel({ outputChannel });
		},
		onFramePlace: (value) => {
			void placeFrameFromChrome({ value, outputChannel })
				.then((errorMessage) => refreshPanel({ outputChannel, errorMessage }))
				.catch((error: unknown) => {
					logDiskError({ scope: 'extension.framePlace', error, outputChannel });
				});
		},
		onEditRequest: (value) => {
			void answerEditRequest({ value, outputChannel });
		},
		onHistoryRequest: (value) => {
			void answerHistoryRequest({ value, outputChannel });
		},
		onCommentRequest: (value) => {
			void answerCommentRequest({ value, outputChannel });
		},
		onPageRequest: (value) => {
			void answerPageRequest({ value, outputChannel });
		},
	});

	if (vscode.workspace.isTrusted) {
		await syncHostRuntime(false);
	} else {
		postUiStatusToPanel({ mcpAvailable: false });
	}

	context.subscriptions.push(
		vscode.workspace.onDidGrantWorkspaceTrust(() => {
			void syncHostRuntime(false);
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			// ponytail: any folder change clears all undo history, not only a new first folder.
			// Upgrade path: clear only when firstWorkspaceFolder changes.
			clearEditHistories();
			if (!vscode.workspace.isTrusted) {
				postUiStatusToPanel({ mcpAvailable: false });
				replaceArtboardWatcher({ context, outputChannel, rearmMarker: true });
				void refreshPanel({ outputChannel });
			} else {
				void syncHostRuntime(true).then(() => refreshPanel({ outputChannel }));
			}
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
