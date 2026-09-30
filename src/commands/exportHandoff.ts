import * as vscode from 'vscode';

import { exportArtboard } from '../disk/artboardFs';
import { ArtboardNotFoundError, CursorDesignError } from '../disk/errors';
import { UNTRUSTED_WORKSPACE_MESSAGE } from '../host/artboardDisk';
import { logDiskError } from '../host/hostFs';

const NO_FOLDER_MESSAGE = 'Open a workspace folder to export a handoff.';
const NO_ACTIVE_MESSAGE =
	'No active artboard to export. Ask the agent to `set_artboard`, or pick an existing id.';
const GENERIC_FAILURE_MESSAGE = 'Could not export handoff. Check the Output panel: Cursor Design.';

export const exportHandoff = async (outputChannel: vscode.OutputChannel): Promise<void> => {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(NO_FOLDER_MESSAGE);
		return;
	}
	if (!vscode.workspace.isTrusted) {
		await vscode.window.showErrorMessage(UNTRUSTED_WORKSPACE_MESSAGE);
		return;
	}

	try {
		const { handoffPath } = await exportArtboard({ workspaceRoot: workspaceFolder.uri.fsPath });
		await vscode.window.showInformationMessage(`Handoff exported to ${handoffPath}/.`);
	} catch (error: unknown) {
		if (error instanceof ArtboardNotFoundError) {
			await vscode.window.showErrorMessage(NO_ACTIVE_MESSAGE);
			return;
		}
		if (error instanceof CursorDesignError) {
			await vscode.window.showErrorMessage(error.message);
			return;
		}
		logDiskError({ scope: 'exportHandoff', error, outputChannel });
		await vscode.window.showErrorMessage(GENERIC_FAILURE_MESSAGE);
	}
};
