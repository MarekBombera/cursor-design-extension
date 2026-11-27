import * as vscode from 'vscode';

import { VIBEBOARD_DIR, ensurePanelPathSegments } from '../disk/layout';
import { fileExists, firstWorkspaceFolder, isFileNotFound } from './hostFs';
import { refreshPanel } from './refreshPanel';
import { type WatchEvent, IDLE_WATCH_STATE, stepWatch } from './watchStep';
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
let watchState = IDLE_WATCH_STATE;
let watchChain: Promise<void> = Promise.resolve();

const applyWatchEvent = (event: WatchEvent) => {
	const next = stepWatch(watchState, event);
	watchState = next.state;
	return next.effect;
};

const clearDebounceTimer = (): void => {
	if (debounceTimer !== undefined) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
};

// A no-op without a watcher; activate hooks it to deactivate.
export const disposeArtboardWatcher = (): void => {
	clearDebounceTimer();
	watchState = IDLE_WATCH_STATE;
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

	const runDebouncedWatch = async (): Promise<void> => {
		const effect = applyWatchEvent({
			type: 'settled',
			sameFolder: ports.workspaceRoot() === workspaceFolder.uri.fsPath,
			trusted: ports.isTrusted(),
		});
		if (effect === 'refresh') {
			await refreshWatchedArtboard({ ports });
			return;
		}
		if (effect !== 'checkMarker') {
			return;
		}
		let markerStillThere = false;
		try {
			markerStillThere = await fileExists(markerUri);
		} catch (error: unknown) {
			ports.log('watchArtboardDisk.markerStat', error);
		}
		if (applyWatchEvent({ type: 'markerChecked', exists: markerStillThere }) !== 'openPanel') {
			return;
		}
		openArtboardPanel({ context, preserveFocus: true });
		await refreshWatchedArtboard({ ports });
		await deleteEnsurePanelMarker(markerUri, ports);
		applyWatchEvent({ type: 'opened' });
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
	const onArtboardDiskEvent = (change: 'write' | 'delete', uri: vscode.Uri): void => {
		const event: WatchEvent = {
			type: 'disk',
			change,
			path: uri.fsPath,
			markerPath: markerUri.fsPath,
		};
		if (applyWatchEvent(event) === 'debounce') {
			scheduleDebounce();
		}
	};
	artboardWatcher.onDidCreate((uri) => onArtboardDiskEvent('write', uri));
	artboardWatcher.onDidChange((uri) => onArtboardDiskEvent('write', uri));
	artboardWatcher.onDidDelete((uri) => onArtboardDiskEvent('delete', uri));

	if (!rearmMarker) {
		return;
	}

	// Re-arm from disk: a marker written while the previous watcher was disposed must still open
	// the panel.
	void fileExists(markerUri)
		.then((markerStillThere) => {
			if (markerStillThere) {
				onArtboardDiskEvent('write', markerUri);
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
