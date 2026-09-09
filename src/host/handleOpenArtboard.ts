import * as vscode from 'vscode';

import { initAndLoadArtboard, readActiveArtboardFromDisk, snapshotForChrome } from './artboardDisk';
import { ensureArtboardWatcher } from './watchArtboardDisk';
import { openArtboardPanel, postArtboardSnapshotToPanel } from '../panel/openArtboardPanel';

const NO_FOLDER_TOAST =
	'Open a workspace folder first. Cursor Design does not store artboards without a folder.';

type HandleOpenArtboardArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

export const reloadVisibleArtboardFromDisk = async (
	outputChannel: vscode.OutputChannel,
): Promise<void> => {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}
	const snapshot = await readActiveArtboardFromDisk({ workspaceFolder, outputChannel });
	postArtboardSnapshotToPanel(snapshotForChrome(snapshot));
};

export const handleOpenArtboard = async ({
	context,
	outputChannel,
}: HandleOpenArtboardArgs): Promise<void> => {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	// ponytail: first folder only; ambiguous_workspace is Phase 2
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(NO_FOLDER_TOAST);
		openArtboardPanel(context);
		return;
	}

	const snapshot = await initAndLoadArtboard({ workspaceFolder, outputChannel });
	postArtboardSnapshotToPanel(snapshotForChrome(snapshot));
	openArtboardPanel(context);
	ensureArtboardWatcher({ context, outputChannel });
};
