import * as vscode from 'vscode';

import { VIBEBOARD_DIR, ensurePanelPathSegments } from '../disk/layout';
import { isLockOrTempPath } from '../disk/workspaceLock';
import { fileExists, firstWorkspaceFolder, isFileNotFound } from './hostFs';
import { refreshPanel } from './refreshPanel';
import {
	type PanelPorts,
	hasCurrentArtboardPanel,
	openArtboardPanel,
} from '../panel/openArtboardPanel';

const WATCH_DEBOUNCE_MS = 200;

type WatchArtboardDiskArgs = {
	context: vscode.ExtensionContext;
	ports: PanelPorts;
};

type ReplaceArtboardWatcherArgs = WatchArtboardDiskArgs & {
	rearmMarker: boolean;
};

let artboardWatcher: vscode.FileSystemWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingMarkerEnsure = false;
let watchChain: Promise<void> = Promise.resolve();

const clearDebounceTimer = (): void => {
	if (debounceTimer !== undefined) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
};

// A no-op without a watcher; activate hooks it to deactivate.
export const disposeArtboardWatcher = (): void => {
	clearDebounceTimer();
	pendingMarkerEnsure = false;
	artboardWatcher?.dispose();
	artboardWatcher = undefined;
};

const refreshWatchedArtboard = async ({ ports }: { ports: PanelPorts }): Promise<void> =>
	hasCurrentArtboardPanel() ? refreshPanel({ ports }) : undefined;

const deleteEnsurePanelMarker = async (markerUri: vscode.Uri, ports: PanelPorts): Promise<void> => {
	try {
		await vscode.workspace.fs.delete(markerUri);
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return;
		}
		ports.log('watchArtboardDisk.deleteMarker', error);
	}
};

export const replaceArtboardWatcher = ({
	context,
	ports,
	rearmMarker,
}: ReplaceArtboardWatcherArgs): void => {
	disposeArtboardWatcher();
	if (!vscode.workspace.isTrusted) {
		return;
	}
	const workspaceFolder = firstWorkspaceFolder();
	if (!workspaceFolder) {
		return;
	}

	const markerUri = vscode.Uri.joinPath(workspaceFolder.uri, ...ensurePanelPathSegments);
	const isMarkerUri = (uri: vscode.Uri): boolean => uri.fsPath === markerUri.fsPath;

	const runDebouncedWatch = async (): Promise<void> => {
		const currentFirstFolder = firstWorkspaceFolder();
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
				ports.log('watchArtboardDisk.markerStat', error);
				return;
			}
			if (!markerStillThere) {
				pendingMarkerEnsure = false;
				return;
			}
			openArtboardPanel({ context, preserveFocus: true });
			await refreshWatchedArtboard({ ports });
			await deleteEnsurePanelMarker(markerUri, ports);
			pendingMarkerEnsure = false;
			return;
		}
		await refreshWatchedArtboard({ ports });
	};

	const scheduleDebounce = (): void => {
		clearDebounceTimer();
		debounceTimer = setTimeout(() => {
			debounceTimer = undefined;
			watchChain = watchChain.then(runDebouncedWatch, runDebouncedWatch);
		}, WATCH_DEBOUNCE_MS);
	};

	artboardWatcher = vscode.workspace.createFileSystemWatcher(
		new vscode.RelativePattern(workspaceFolder, `${VIBEBOARD_DIR}/**`),
	);
	const onArtboardDiskEvent = (uri: vscode.Uri): void => {
		if (isLockOrTempPath(uri.fsPath)) {
			return;
		}
		if (isMarkerUri(uri)) {
			pendingMarkerEnsure = true;
		}
		scheduleDebounce();
	};
	artboardWatcher.onDidCreate(onArtboardDiskEvent);
	artboardWatcher.onDidChange(onArtboardDiskEvent);
	artboardWatcher.onDidDelete((uri) => {
		if (isLockOrTempPath(uri.fsPath)) {
			return;
		}
		if (isMarkerUri(uri)) {
			pendingMarkerEnsure = false;
			return;
		}
		scheduleDebounce();
	});

	if (!rearmMarker) {
		return;
	}

	// Re-arm from disk: a marker written while the previous watcher was disposed must still open
	// the panel.
	void fileExists(markerUri)
		.then((markerStillThere) => {
			if (markerStillThere) {
				pendingMarkerEnsure = true;
				scheduleDebounce();
			}
		})
		.catch((error: unknown) => {
			ports.log('watchArtboardDisk.markerStat', error);
		});
};

export const ensureArtboardWatcher = ({ context, ports }: WatchArtboardDiskArgs): void => {
	if (artboardWatcher !== undefined) {
		return;
	}
	replaceArtboardWatcher({ context, ports, rearmMarker: false });
};
