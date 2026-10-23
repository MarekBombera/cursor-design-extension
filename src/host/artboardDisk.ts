import * as vscode from 'vscode';

import { parseChromeMessage } from './chromeMessages';
import { fileExists, firstWorkspaceFolder, logDiskError } from './hostFs';
import {
	canvasSnapshotErrorMessage,
	canvasViewReadLogs,
	emptyArtboardSnapshot,
	UNTRUSTED_WORKSPACE_MESSAGE,
	type CanvasSnapshot,
} from './canvasSnapshot';
import {
	type CanvasView,
	createArtboard,
	placeFrame,
	readCanvasView,
	setActiveArtboard,
} from '../disk/artboardFs';
import {
	ArtboardExistsError,
	CursorDesignError,
	InvalidArgsError,
	NoWorkspaceError,
} from '../disk/errors';
import { DEFAULT_ARTBOARD_HTML, DEFAULT_ARTBOARD_ID, manifestPathSegments } from '../disk/layout';

export { emptyArtboardSnapshot, UNTRUSTED_WORKSPACE_MESSAGE, type CanvasSnapshot };

type WorkspaceDiskArgs = {
	workspaceFolder: vscode.WorkspaceFolder;
	outputChannel: vscode.OutputChannel;
};

const toSafeArtboardErrorMessage = (error: unknown): string => {
	if (error instanceof CursorDesignError) {
		return error.message;
	}
	return 'Could not load artboard. Check the Output panel: Cursor Design.';
};

const joinWorkspace = (
	workspaceFolder: vscode.WorkspaceFolder,
	segments: readonly string[],
): vscode.Uri => vscode.Uri.joinPath(workspaceFolder.uri, ...segments);

// No manifest yet: create the default artboard, or make an existing artboard.html active.
// Goes through the disk lib so the host gets the same symlink and ownership checks as MCP.
const initializeDefaultArtboard = async (workspaceRoot: string): Promise<void> => {
	try {
		await createArtboard({
			workspaceRoot,
			artboardId: DEFAULT_ARTBOARD_ID,
			html: DEFAULT_ARTBOARD_HTML,
			writeEnsurePanelMarker: false,
		});
	} catch (error: unknown) {
		if (!(error instanceof ArtboardExistsError)) {
			throw error;
		}
		await setActiveArtboard({ workspaceRoot, artboardId: DEFAULT_ARTBOARD_ID });
	}
};

const logCanvasViewReadErrors = ({
	view,
	outputChannel,
}: {
	view: CanvasView;
	outputChannel: vscode.OutputChannel;
}): void => {
	for (const readLog of canvasViewReadLogs(view)) {
		outputChannel.appendLine(`${readLog.scope}: ${readLog.tileMessage}`);
		if (readLog.error !== undefined) {
			logDiskError({ scope: readLog.scope, error: readLog.error, outputChannel });
		}
	}
};

const snapshotFromCanvasView = async ({
	workspaceFolder,
	outputChannel,
}: WorkspaceDiskArgs): Promise<CanvasSnapshot> => {
	const view = await readCanvasView({ workspaceRoot: workspaceFolder.uri.fsPath });
	logCanvasViewReadErrors({ view, outputChannel });
	const activeFrame = view.frames.find((frame) => frame.id === view.activeArtboardId);
	const errorMessage = canvasSnapshotErrorMessage({
		activeArtboardId: view.activeArtboardId,
		frames: view.frames,
		layoutErrorMessage: view.layoutErrorMessage,
	});

	return {
		activeArtboardId: view.activeArtboardId,
		generation: activeFrame?.generation ?? 0,
		frames: view.frames,
		handoffStale: view.handoffStale,
		errorMessage,
	};
};

type LoadActiveSnapshotArgs = WorkspaceDiskArgs & {
	scope: string;
	initializeWhenMissing: boolean;
};

const loadActiveSnapshot = async ({
	workspaceFolder,
	outputChannel,
	scope,
	initializeWhenMissing,
}: LoadActiveSnapshotArgs): Promise<CanvasSnapshot> => {
	if (!vscode.workspace.isTrusted) {
		return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
	}

	const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);
	try {
		if (!(await fileExists(manifestUri))) {
			if (!initializeWhenMissing) {
				return emptyArtboardSnapshot();
			}
			await initializeDefaultArtboard(workspaceFolder.uri.fsPath);
		}
		return await snapshotFromCanvasView({ workspaceFolder, outputChannel });
	} catch (error: unknown) {
		logDiskError({ scope, error, outputChannel });
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	}
};

export const initAndLoadArtboard = async (args: WorkspaceDiskArgs): Promise<CanvasSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.initAndLoad', initializeWhenMissing: true });

export const readActiveArtboardFromDisk = async (
	args: WorkspaceDiskArgs,
): Promise<CanvasSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.readActive', initializeWhenMissing: false });

const MALFORMED_FRAME_PLACE_MESSAGE = 'Could not move the frame. Try again.';

// Panel drag/resize commit. Never rejects: every attempt is answered with one fresh snapshot,
// carrying errorMessage when the write failed (posted as artboard:error after canvas:updated).
export const placeFrameFromChrome = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<CanvasSnapshot> => {
	try {
		if (!vscode.workspace.isTrusted) {
			return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
		}
		const workspaceFolder = firstWorkspaceFolder();
		if (!workspaceFolder) {
			return emptyArtboardSnapshot(new NoWorkspaceError().message);
		}
		let placeErrorMessage: string | undefined;
		const message = parseChromeMessage(value);
		if (message?.type !== 'frame:place') {
			logDiskError({
				scope: 'artboardDisk.placeFrame',
				error: new InvalidArgsError('Malformed frame:place message from the panel.'),
				outputChannel,
			});
			placeErrorMessage = MALFORMED_FRAME_PLACE_MESSAGE;
		} else {
			try {
				await placeFrame({
					workspaceRoot: workspaceFolder.uri.fsPath,
					id: message.id,
					x: message.x,
					y: message.y,
					width: message.width,
					base: message.base,
				});
			} catch (error: unknown) {
				logDiskError({ scope: 'artboardDisk.placeFrame', error, outputChannel });
				placeErrorMessage = toSafeArtboardErrorMessage(error);
			}
		}
		const snapshot = await readActiveArtboardFromDisk({ workspaceFolder, outputChannel });
		if (placeErrorMessage === undefined) {
			return snapshot;
		}
		// A layout error already on the snapshot is the more severe one.
		return { ...snapshot, errorMessage: snapshot.errorMessage ?? placeErrorMessage };
	} catch (error: unknown) {
		logDiskError({ scope: 'artboardDisk.placeFrameFromChrome', error, outputChannel });
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	}
};
