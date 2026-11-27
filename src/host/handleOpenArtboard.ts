import * as vscode from 'vscode';

import { firstWorkspaceFolder, NO_FOLDER_MESSAGE } from './hostFs';
import { refreshPanel } from './refreshPanel';
import { ensureArtboardWatcher } from './watchArtboardDisk';
import { type PanelPorts, openArtboardPanel } from '../panel/openArtboardPanel';

type HandleOpenArtboardArgs = {
	context: vscode.ExtensionContext;
	ports: PanelPorts;
};

export const handleOpenArtboard = async ({
	context,
	ports,
}: HandleOpenArtboardArgs): Promise<void> => {
	if (!firstWorkspaceFolder()) {
		await vscode.window.showErrorMessage(NO_FOLDER_MESSAGE);
		openArtboardPanel({ context });
		return;
	}

	await refreshPanel({ ports, initialize: true });
	openArtboardPanel({ context });
	ensureArtboardWatcher({ context, ports });
};
