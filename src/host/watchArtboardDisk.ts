import * as vscode from 'vscode';

import { CURSOR_DESIGN_DIR } from '../disk/layout';
import { readActiveArtboardFromDisk, snapshotForChrome } from './artboardDisk';
import { hasCurrentArtboardPanel, postArtboardSnapshotToPanel } from '../panel/openArtboardPanel';

const WATCH_DEBOUNCE_MS = 200;

type WatchArtboardDiskArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

let artboardWatcher: vscode.FileSystemWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const clearDebounceTimer = (): void => {
	if (debounceTimer !== undefined) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
};

const refreshWatchedArtboard = async (
	workspaceFolder: vscode.WorkspaceFolder,
	outputChannel: vscode.OutputChannel,
): Promise<void> => {
	// ponytail: last clean writer wins; no cross-window lock
	const snapshot = await readActiveArtboardFromDisk({ workspaceFolder, outputChannel });
	if (!hasCurrentArtboardPanel()) {
		return;
	}
	postArtboardSnapshotToPanel(snapshotForChrome(snapshot));
};

export const ensureArtboardWatcher = ({ context, outputChannel }: WatchArtboardDiskArgs): void => {
	if (artboardWatcher !== undefined) {
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}

	artboardWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(workspaceFolder, `${CURSOR_DESIGN_DIR}/**`),
	);
	const scheduleRefresh = (): void => {
		clearDebounceTimer();
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			void refreshWatchedArtboard(workspaceFolder, outputChannel);
		}, WATCH_DEBOUNCE_MS);
	};
	artboardWatcher.onDidChange(scheduleRefresh);
	artboardWatcher.onDidCreate(scheduleRefresh);
	artboardWatcher.onDidDelete(scheduleRefresh);
	context.subscriptions.push(artboardWatcher, {
		dispose: (): void => {
			clearDebounceTimer();
			artboardWatcher = undefined;
		},
	});
};
