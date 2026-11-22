import * as vscode from 'vscode';

import { exportArtboard } from '../disk/artboardFs';
import { CursorDesignError } from '../disk/errors';
import { resolveOpenPage } from '../disk/openPage';
import { UNTRUSTED_WORKSPACE_MESSAGE } from '../host/artboardDisk';
import { firstWorkspaceFolder, logDiskError } from '../host/hostFs';

const NO_FOLDER_TO_EXPORT_MESSAGE = 'Open a workspace folder to export a handoff.';
const GENERIC_FAILURE_MESSAGE = 'Could not export handoff. Check the Output panel: Cursor Design.';

export const exportHandoff = async (outputChannel: vscode.OutputChannel): Promise<void> => {
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(NO_FOLDER_TO_EXPORT_MESSAGE);
		return;
	}
	if (!vscode.workspace.isTrusted) {
		await vscode.window.showErrorMessage(UNTRUSTED_WORKSPACE_MESSAGE);
		return;
	}

	try {
		const { handoffPath } = await exportArtboard({
			page: await resolveOpenPage({
				workspaceRoot: workspaceFolder.uri.fsPath,
				createIfFresh: false,
			}),
		});
		await vscode.window.showInformationMessage(`Handoff exported to ${handoffPath}/.`);
	} catch (error: unknown) {
		logDiskError({ scope: 'exportHandoff', error, outputChannel });
		await vscode.window.showErrorMessage(
			error instanceof CursorDesignError ? error.message : GENERIC_FAILURE_MESSAGE,
		);
	}
};
