import * as vscode from 'vscode';

import { firstWorkspaceFolder, NO_FOLDER_MESSAGE } from './hostFs';
import { refreshPanel } from './refreshPanel';
import { ensureArtboardWatcher } from './watchArtboardDisk';
import { openArtboardPanel } from '../panel/openArtboardPanel';

type HandleOpenArtboardArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

export const handleOpenArtboard = async ({
	context,
	outputChannel,
}: HandleOpenArtboardArgs): Promise<void> => {
	if (!firstWorkspaceFolder()) {
		await vscode.window.showErrorMessage(NO_FOLDER_MESSAGE);
		openArtboardPanel({ context });
		return;
	}

	await refreshPanel({ outputChannel, initialize: true });
	openArtboardPanel({ context });
	ensureArtboardWatcher({ context, outputChannel });
};
