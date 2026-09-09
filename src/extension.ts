import * as vscode from 'vscode';

import {
	EXPORT_HANDOFF_COMMAND,
	OPEN_ARTBOARD_COMMAND,
	REVEAL_DESIGN_FOLDER_COMMAND,
} from './commands/commandIds';
import { exportHandoff } from './commands/exportHandoff';
import { revealDesignFolder } from './commands/revealDesignFolder';
import { registerCursorDesignMcp } from './mcp/registerCursorDesignMcp';
import { openArtboardPanel } from './panel/openArtboardPanel';

export const activate = (context: vscode.ExtensionContext): void => {
	const outputChannel = vscode.window.createOutputChannel('Cursor Design');
	context.subscriptions.push(outputChannel);

	registerCursorDesignMcp({ context, outputChannel });

	context.subscriptions.push(
		vscode.commands.registerCommand(OPEN_ARTBOARD_COMMAND, () => {
			openArtboardPanel(context);
		}),
		vscode.commands.registerCommand(REVEAL_DESIGN_FOLDER_COMMAND, () => {
			void revealDesignFolder(outputChannel);
		}),
		vscode.commands.registerCommand(EXPORT_HANDOFF_COMMAND, () => {
			exportHandoff();
		}),
	);
};

export const deactivate = (): void => {};
