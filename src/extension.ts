import * as vscode from 'vscode';

import {
	EXPORT_HANDOFF_COMMAND,
	OPEN_ARTBOARD_COMMAND,
	REVEAL_DESIGN_FOLDER_COMMAND,
} from './commands/commandIds';
import { exportHandoff } from './commands/exportHandoff';
import { revealDesignFolder } from './commands/revealDesignFolder';
import { handleOpenArtboard, reloadVisibleArtboardFromDisk } from './host/handleOpenArtboard';
import { replaceArtboardWatcher } from './host/watchArtboardDisk';
import { registerCursorDesignMcp } from './mcp/registerCursorDesignMcp';
import { postUiStatusToPanel, setArtboardPanelOnVisible } from './panel/openArtboardPanel';

export const activate = (context: vscode.ExtensionContext): void => {
	const outputChannel = vscode.window.createOutputChannel('Cursor Design');
	context.subscriptions.push(outputChannel);

	const syncHostRuntime = (): void => {
		const mcpAvailable = registerCursorDesignMcp({ context, outputChannel });
		postUiStatusToPanel({ mcpAvailable });
		replaceArtboardWatcher({ context, outputChannel });
	};

	setArtboardPanelOnVisible(() => {
		void reloadVisibleArtboardFromDisk(outputChannel);
	});

	if (vscode.workspace.isTrusted) {
		syncHostRuntime();
	} else {
		postUiStatusToPanel({ mcpAvailable: false });
	}

	context.subscriptions.push(
		vscode.workspace.onDidGrantWorkspaceTrust(() => {
			syncHostRuntime();
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			if (!vscode.workspace.isTrusted) {
				postUiStatusToPanel({ mcpAvailable: false });
				replaceArtboardWatcher({ context, outputChannel });
				return;
			}
			syncHostRuntime();
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
