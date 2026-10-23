import * as vscode from 'vscode';

// ponytail: first folder only; multi-root and ambiguous_workspace are Phase 2
export const firstWorkspaceFolder = (): vscode.WorkspaceFolder | undefined =>
	vscode.workspace.workspaceFolders?.[0];

export const NO_FOLDER_MESSAGE =
	'Open a workspace folder first. Cursor Design does not store artboards without a folder.';

export const isFileNotFound = (error: unknown): boolean =>
	error instanceof vscode.FileSystemError &&
	(error.code === 'FileNotFound' || error.code === 'EntryNotFound');

export const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return false;
		}
		throw error;
	}
};

type LogDiskErrorArgs = {
	scope: string;
	error: unknown;
	outputChannel: vscode.OutputChannel;
};

export const logDiskError = ({ scope, error, outputChannel }: LogDiskErrorArgs): void => {
	outputChannel.appendLine(
		`${scope}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
	);
};
