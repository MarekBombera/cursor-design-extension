import * as vscode from 'vscode';

import {
	emptyArtboardSnapshot,
	initAndLoadArtboard,
	readActiveArtboardFromDisk,
	UNTRUSTED_WORKSPACE_MESSAGE,
} from './artboardDisk';
import { firstWorkspaceFolder, NO_FOLDER_MESSAGE } from './hostFs';
import { ensureArtboardWatcher } from './watchArtboardDisk';
import { openArtboardPanel, postArtboardSnapshotToPanel } from '../panel/openArtboardPanel';

type HandleOpenArtboardArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

export const reloadVisibleArtboardFromDisk = async (
	outputChannel: vscode.OutputChannel,
): Promise<void> => {
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		postArtboardSnapshotToPanel(
			emptyArtboardSnapshot(vscode.workspace.isTrusted ? undefined : UNTRUSTED_WORKSPACE_MESSAGE),
		);
		return;
	}
	postArtboardSnapshotToPanel(await readActiveArtboardFromDisk({ workspaceFolder, outputChannel }));
};

export const handleOpenArtboard = async ({
	context,
	outputChannel,
}: HandleOpenArtboardArgs): Promise<void> => {
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		await vscode.window.showErrorMessage(NO_FOLDER_MESSAGE);
		openArtboardPanel({ context });
		return;
	}

	postArtboardSnapshotToPanel(await initAndLoadArtboard({ workspaceFolder, outputChannel }));
	openArtboardPanel({ context });
	ensureArtboardWatcher({ context, outputChannel });
};
