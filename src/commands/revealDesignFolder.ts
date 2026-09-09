import * as vscode from 'vscode';

import { CURSOR_DESIGN_DIR } from '../disk/layout';

const isFileNotFound = (error: unknown): boolean => {
	if (!(error instanceof vscode.FileSystemError)) {
		return false;
	}
	return error.code === 'FileNotFound' || error.code === 'EntryNotFound';
};

export const revealDesignFolder = async (outputChannel: vscode.OutputChannel): Promise<void> => {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	// ponytail: first folder only; ambiguous_workspace is Phase 2
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(
			'Open a workspace folder first. Cursor Design does not store artboards without a folder.',
		);
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
		outputChannel.appendLine(
			`revealDesignFolder: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
		);
		await vscode.window.showErrorMessage(
			'Could not reveal the design folder. Check the Output panel: Cursor Design.',
		);
	}
};
