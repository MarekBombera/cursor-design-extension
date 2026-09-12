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

let artboardWatcher: vscode.FileSystemWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingMarkerEnsure = false;
let watcherDisposeHooked = false;

const clearDebounceTimer = (): void => {
	if (debounceTimer !== undefined) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
};

const disposeArtboardWatcher = (): void => {
	clearDebounceTimer();
	pendingMarkerEnsure = false;
	artboardWatcher?.dispose();
	artboardWatcher = undefined;
};

const refreshWatchedArtboard = async (
	workspaceFolder: vscode.WorkspaceFolder,
	outputChannel: vscode.OutputChannel,
): Promise<void> => {
	if (!hasCurrentArtboardPanel()) {
		return;
	}
	// ponytail: last clean writer wins; no cross-window lock
	const snapshot = await readActiveArtboardFromDisk({ workspaceFolder, outputChannel });
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

export const replaceArtboardWatcher = ({ context, outputChannel }: WatchArtboardDiskArgs): void => {
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
			openArtboardPanel(context);
			await refreshWatchedArtboard(workspaceFolder, outputChannel);
			await deleteEnsurePanelMarker(markerUri, outputChannel);
			pendingMarkerEnsure = false;
			return;
		}
		await refreshWatchedArtboard(workspaceFolder, outputChannel);
	};

	const scheduleDebounce = (): void => {
		clearDebounceTimer();
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			void runDebouncedWatch();
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

	// Re-arm from disk: a marker written before this replace lost its flag with the old watcher.
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
	replaceArtboardWatcher({ context, outputChannel });
};
