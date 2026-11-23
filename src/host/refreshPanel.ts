import * as vscode from 'vscode';

import { initAndLoadArtboard, readActiveArtboardFromDisk } from './artboardDisk';
import { emptyArtboardSnapshot, UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { firstWorkspaceFolder, logDiskError } from './hostFs';
import { postPanelComments } from './panelComments';
import { postArtboardSnapshotToPanel } from '../panel/openArtboardPanel';

// Last started wins: a refresh posts only when no newer one started during its read. A frame-place
// error is held from the refresh's start until the next post, whichever refresh makes it: a failed
// place writes nothing, so only artboard:error ends the chrome's committing drag (failFrameGesture).
// ponytail: two ceilings, each corrected by the next refresh (the watcher echo):
// 1. the latest refresh can still straddle a write that starts no refresh of its own (an
//    artboard:edited answer, an MCP write inside the 200 ms debounce) and post the pre-write
//    frames; history survives (the pre-edit hash is held in undo);
// 2. a non-initializing refresh that starts during Open's initialize read can read disk before
//    the default artboard and project.json are written, and win.
// Upgrade path: a disk-side generation the read can compare.
let refreshGeneration = 0;
let pendingErrorMessage: string | undefined;

// Never rejects: reads a fresh snapshot, then posts it and the comment list unless superseded.
export const refreshPanel = async ({
	outputChannel,
	initialize = false,
	errorMessage,
}: {
	outputChannel: vscode.OutputChannel;
	initialize?: boolean; // Open Artboard only: initAndLoadArtboard (createIfFresh)
	errorMessage?: string; // shown when the snapshot carries none (frame place copy)
}): Promise<void> => {
	const token = ++refreshGeneration;
	pendingErrorMessage = errorMessage ?? pendingErrorMessage;
	try {
		const workspaceFolder = firstWorkspaceFolder();
		const snapshot = !workspaceFolder
			? emptyArtboardSnapshot(vscode.workspace.isTrusted ? undefined : UNTRUSTED_WORKSPACE_MESSAGE)
			: await (initialize ? initAndLoadArtboard : readActiveArtboardFromDisk)({
					workspaceFolder,
					outputChannel,
				});
		if (token !== refreshGeneration) {
			return;
		}
		const shownError = snapshot.errorMessage ?? pendingErrorMessage;
		pendingErrorMessage = undefined;
		postArtboardSnapshotToPanel({ ...snapshot, errorMessage: shownError });
		void postPanelComments({ outputChannel });
	} catch (error) {
		logDiskError({ scope: 'refreshPanel', error, outputChannel });
	}
};
