import * as vscode from 'vscode';

import { CURSOR_DESIGN_DIR, ensurePanelPathSegments } from '../disk/layout';
import { readActiveArtboardFromDisk, snapshotForChrome } from './artboardDisk';
import { fileExists, isFileNotFound, logDiskError } from './hostFs';
import {
	hasCurrentArtboardPanel,
	openArtboardPanel,
	postArtboardSnapshotToPanel,
} from '../panel/openArtboardPanel';

const WATCH_DEBOUNCE_MS = 200;

type WatchArtboardDiskArgs = {
	context: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
};

type ReplaceArtboardWatcherArgs = WatchArtboardDiskArgs & {
	rearmMarker: boolean;
};

let artboardWatcher: vscode.FileSystemWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingMarkerEnsure = false;
let watcherDisposeHooked = false;
let watchGeneration = 0;
let watchChain: Promise<void> = Promise.resolve();

const clearDebounceTimer = (): void => {
	if (debounceTimer !== undefined) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
};

const disposeArtboardWatcher = (): void => {
	clearDebounceTimer();
	pendingMarkerEnsure = false;
	watchGeneration += 1;
	artboardWatcher?.dispose();
	artboardWatcher = undefined;
};

const refreshWatchedArtboard = async ({
	workspaceFolder,
	outputChannel,
	token,
}: {
	workspaceFolder: vscode.WorkspaceFolder;
	outputChannel: vscode.OutputChannel;
	token: number;
}): Promise<void> => {
	if (!hasCurrentArtboardPanel()) {
		return;
	}
	// ponytail: last clean writer wins; no cross-window lock
	const snapshot = await readActiveArtboardFromDisk({ workspaceFolder, outputChannel });
	if (token !== watchGeneration) {
		return;
	}
	postArtboardSnapshotToPanel(snapshotForChrome(snapshot));
};

const deleteEnsurePanelMarker = async (
	markerUri: vscode.Uri,
	outputChannel: vscode.OutputChannel,
): Promise<void> => {
	try {
		await vscode.workspace.fs.delete(markerUri);
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return;
		}
		logDiskError({ scope: 'watchArtboardDisk.deleteMarker', error, outputChannel });
	}
};

export const replaceArtboardWatcher = ({
	context,
	outputChannel,
	rearmMarker,
}: ReplaceArtboardWatcherArgs): void => {
	disposeArtboardWatcher();
	if (!vscode.workspace.isTrusted) {
		return;
	}
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return;
	}

	const markerUri = vscode.Uri.joinPath(workspaceFolder.uri, ...ensurePanelPathSegments);
	const isMarkerUri = (uri: vscode.Uri): boolean => uri.fsPath === markerUri.fsPath;

	const runDebouncedWatch = async (): Promise<void> => {
		const token = ++watchGeneration;
		const currentFirstFolder = vscode.workspace.workspaceFolders?.[0];
		if (!currentFirstFolder || currentFirstFolder.uri.fsPath !== workspaceFolder.uri.fsPath) {
			pendingMarkerEnsure = false;
			return;
		}
		if (pendingMarkerEnsure) {
			if (!vscode.workspace.isTrusted) {
				pendingMarkerEnsure = false;
				return;
			}
			let markerStillThere = false;
			try {
				markerStillThere = await fileExists(markerUri);
			} catch (error: unknown) {
				pendingMarkerEnsure = false;
				logDiskError({ scope: 'watchArtboardDisk.markerStat', error, outputChannel });
				return;
			}
			if (!markerStillThere) {
				pendingMarkerEnsure = false;
				return;
			}
			openArtboardPanel({ context, preserveFocus: true });
			await refreshWatchedArtboard({ workspaceFolder, outputChannel, token });
			await deleteEnsurePanelMarker(markerUri, outputChannel);
			pendingMarkerEnsure = false;
			return;
		}
		await refreshWatchedArtboard({ workspaceFolder, outputChannel, token });
	};

	const scheduleDebounce = (): void => {
		clearDebounceTimer();
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			watchChain = watchChain.then(runDebouncedWatch, runDebouncedWatch);
		}, WATCH_DEBOUNCE_MS);
	};

	artboardWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(workspaceFolder, `${CURSOR_DESIGN_DIR}/**`),
	);
	const onArtboardDiskEvent = (uri: vscode.Uri): void => {
		if (isMarkerUri(uri)) {
			pendingMarkerEnsure = true;
		}
		scheduleDebounce();
	};
	artboardWatcher.onDidCreate(onArtboardDiskEvent);
	artboardWatcher.onDidChange(onArtboardDiskEvent);
	artboardWatcher.onDidDelete((uri) => {
		if (isMarkerUri(uri)) {
			pendingMarkerEnsure = false;
			return;
		}
		scheduleDebounce();
	});

	if (!watcherDisposeHooked) {
		context.subscriptions.push({
			dispose: disposeArtboardWatcher,
		});
		watcherDisposeHooked = true;
	}

	if (!rearmMarker) {
		return;
	}

	// Re-arm from disk: a marker written while the previous watcher was disposed must still open the panel.
	void fileExists(markerUri)
		.then((markerStillThere) => {
			if (markerStillThere) {
				pendingMarkerEnsure = true;
				scheduleDebounce();
			}
		})
		.catch((error: unknown) => {
			logDiskError({ scope: 'watchArtboardDisk.markerStat', error, outputChannel });
		});
};

export const ensureArtboardWatcher = ({ context, outputChannel }: WatchArtboardDiskArgs): void => {
	if (artboardWatcher !== undefined) {
		return;
	}
	replaceArtboardWatcher({ context, outputChannel, rearmMarker: false });
};
