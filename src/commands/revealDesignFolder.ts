import * as vscode from 'vscode';

import { CURSOR_DESIGN_DIR } from '../disk/layout';
import {
	firstWorkspaceFolder,
	isFileNotFound,
	logDiskError,
	NO_FOLDER_MESSAGE,
} from '../host/hostFs';

export const revealDesignFolder = async (outputChannel: vscode.OutputChannel): Promise<void> => {
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(NO_FOLDER_MESSAGE);
		return;
	}

	const designFolderUri = vscode.Uri.joinPath(workspaceFolder.uri, CURSOR_DESIGN_DIR);
	try {
		await vscode.workspace.fs.stat(designFolderUri);
		await vscode.commands.executeCommand('revealInExplorer', designFolderUri);
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			await vscode.window.showInformationMessage(
				'The design folder is not created yet. It appears after the first artboard is saved.',
			);
			return;
		}
		logDiskError({ scope: 'revealDesignFolder', error, outputChannel });
		await vscode.window.showErrorMessage(
			'Could not reveal the design folder. Check the Output panel: Cursor Design.',
		);
	}
};
