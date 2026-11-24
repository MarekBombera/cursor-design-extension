import * as vscode from 'vscode';

import { parseChromeMessage } from './chromeMessages';
import { fileExists, firstWorkspaceFolder, logDiskError } from './hostFs';
import {
	canvasSnapshotErrorMessage,
	canvasViewReadLogs,
	emptyArtboardSnapshot,
	panelFrames,
	UNTRUSTED_WORKSPACE_MESSAGE,
	type CanvasSnapshot,
} from './canvasSnapshot';
import { createArtboard, placeFrame, setActiveArtboard } from '../disk/artboardFs';
import { type CanvasView, readCanvasView } from '../disk/canvasView';
import {
	ArtboardExistsError,
	InvalidArgsError,
	NoWorkspaceError,
	PageNotFoundError,
	toSafeArtboardErrorMessage,
} from '../disk/errors';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	manifestPathSegments,
	projectPathSegments,
} from '../disk/layout';
import {
	type PageLocation,
	lstatOrUndefined,
	pageFolderExists,
	workspaceJoin,
} from '../disk/layoutFs';
import { resolveOpenPage, resolveRequestedPage } from '../disk/openPage';
import { listPages } from '../disk/pageOps';
import type { PostedPage } from '../webview/hostMessages';
import { PAGE_GONE_MESSAGE } from './panelRequestCopy';

type WorkspaceDiskArgs = {
	workspaceFolder: vscode.WorkspaceFolder;
	outputChannel: vscode.OutputChannel;
};

const joinWorkspace = (
	workspaceFolder: vscode.WorkspaceFolder,
	segments: readonly string[],
): vscode.Uri => vscode.Uri.joinPath(workspaceFolder.uri, ...segments);

// No manifest yet: create the default artboard, or make an existing artboard.html active.
// Goes through the disk lib so the host gets the same symlink and ownership checks as MCP.
const initializeDefaultArtboard = async (page: PageLocation): Promise<void> => {
	try {
		await createArtboard({
			page,
			artboardId: DEFAULT_ARTBOARD_ID,
			html: DEFAULT_ARTBOARD_HTML,
			writeEnsurePanelMarker: false,
		});
	} catch (error: unknown) {
		if (!(error instanceof ArtboardExistsError)) {
			throw error;
		}
		await setActiveArtboard({ page, artboardId: DEFAULT_ARTBOARD_ID });
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
	page,
	outputChannel,
}: {
	page: PageLocation;
	outputChannel: vscode.OutputChannel;
}): Promise<Omit<CanvasSnapshot, 'pages'>> => {
	const view = await readCanvasView({ page });
	logCanvasViewReadErrors({ view, outputChannel });
	const activeFrame = view.frames.find((frame) => frame.id === view.activeArtboardId);
	const errorMessage = canvasSnapshotErrorMessage({
		activeArtboardId: view.activeArtboardId,
		frames: view.frames,
		layoutErrorMessage: view.layoutErrorMessage,
	});

	return {
		pageId: page.pageId,
		activeArtboardId: view.activeArtboardId,
		generation: activeFrame?.generation ?? 0,
		// Same root and page as panelComments' readComments, so the shared parse cache keys match.
		frames: panelFrames({
			workspaceRoot: page.workspaceRoot,
			pageId: page.pageId,
			frames: view.frames,
			onTagError: (frameId, error) => {
				logDiskError({ scope: `artboardDisk.sourceTags:${frameId}`, error, outputChannel });
			},
		}),
		handoffStale: view.handoffStale,
		errorMessage,
	};
};

const readOpenPageSnapshot = async ({
	workspaceFolder,
	outputChannel,
	page,
	initializeWhenMissing,
}: WorkspaceDiskArgs & {
	page: PageLocation;
	initializeWhenMissing: boolean;
}): Promise<Omit<CanvasSnapshot, 'pages'>> => {
	if (!(await fileExists(joinWorkspace(workspaceFolder, manifestPathSegments(page.pageId))))) {
		if (!initializeWhenMissing) {
			// An indexed page whose folder is gone is an error. Only a fresh folder resolves with
			// no project.json, and it stays an empty stage.
			if (
				!(await pageFolderExists(page.workspaceRoot, page.pageId)) &&
				(await lstatOrUndefined(workspaceJoin(page.workspaceRoot, projectPathSegments))) !==
					undefined
			) {
				throw new PageNotFoundError(page.pageId);
			}
			return { ...emptyArtboardSnapshot(), pageId: page.pageId };
		}
		await initializeDefaultArtboard(page);
	}
	return await snapshotFromCanvasView({ page, outputChannel });
};

// A list failure never fails the snapshot: it is logged and lists nothing.
const readPostedPages = async ({
	page,
	outputChannel,
}: {
	page: PageLocation;
	outputChannel: vscode.OutputChannel;
}): Promise<PostedPage[]> => {
	try {
		return (await listPages({ workspaceRoot: page.workspaceRoot })).pages;
	} catch (error: unknown) {
		logDiskError({ scope: 'artboardDisk.listPages', error, outputChannel });
		return [];
	}
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
		// No frames are posted, so drop every tagged copy the memo still holds.
		panelFrames({
			workspaceRoot: workspaceFolder.uri.fsPath,
			pageId: '',
			frames: [],
			onTagError: () => {},
		});
		return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
	}

	const failed = (error: unknown): CanvasSnapshot => {
		logDiskError({ scope, error, outputChannel });
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	};
	// Resolved outside the read's try, so a read failure still names the page it came from.
	let page: PageLocation;
	try {
		page = await resolveOpenPage({
			workspaceRoot: workspaceFolder.uri.fsPath,
			createIfFresh: initializeWhenMissing,
		});
	} catch (error: unknown) {
		return failed(error);
	}
	let snapshot: Omit<CanvasSnapshot, 'pages'>;
	try {
		snapshot = await readOpenPageSnapshot({
			workspaceFolder,
			outputChannel,
			page,
			initializeWhenMissing,
		});
	} catch (error: unknown) {
		snapshot = { ...failed(error), pageId: page.pageId };
	}
	// Listed after the read (and any initialize), so a just-created page has its time; a failed
	// read still lists, so the Pages menu offers a way off a broken page.
	return { ...snapshot, pages: await readPostedPages({ page, outputChannel }) };
};

export const initAndLoadArtboard = async (args: WorkspaceDiskArgs): Promise<CanvasSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.initAndLoad', initializeWhenMissing: true });

export const readActiveArtboardFromDisk = async (
	args: WorkspaceDiskArgs,
): Promise<CanvasSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.readActive', initializeWhenMissing: false });

const MALFORMED_FRAME_PLACE_MESSAGE = 'Could not move the frame. Try again.';

// Panel drag/resize commit. Never rejects: returns the error copy for the banner, or undefined;
// the caller refreshes the panel after it.
export const placeFrameFromChrome = async ({
	value,
	outputChannel,
}: {
	value: unknown;
	outputChannel: vscode.OutputChannel;
}): Promise<string | undefined> => {
	try {
		if (!vscode.workspace.isTrusted) {
			return UNTRUSTED_WORKSPACE_MESSAGE;
		}
		const workspaceFolder = firstWorkspaceFolder();
		if (!workspaceFolder) {
			return new NoWorkspaceError().message;
		}
		const message = parseChromeMessage(value);
		if (message?.type !== 'frame:place') {
			logDiskError({
				scope: 'artboardDisk.placeFrame',
				error: new InvalidArgsError('Malformed frame:place message from the panel.'),
				outputChannel,
			});
			return MALFORMED_FRAME_PLACE_MESSAGE;
		}
		try {
			await placeFrame({
				page: await resolveRequestedPage({
					workspaceRoot: workspaceFolder.uri.fsPath,
					pageId: message.pageId,
				}),
				id: message.id,
				x: message.x,
				y: message.y,
				width: message.width,
				base: message.base,
			});
			return undefined;
		} catch (error: unknown) {
			logDiskError({ scope: 'artboardDisk.placeFrame', error, outputChannel });
			// ponytail: a gone requested page is never the open page, so this banner shows over the
			// open page's snapshot and names no page. Upgrade path: 10d's page menu names it.
			return error instanceof PageNotFoundError
				? PAGE_GONE_MESSAGE
				: toSafeArtboardErrorMessage(error);
		}
	} catch (error: unknown) {
		logDiskError({ scope: 'artboardDisk.placeFrameFromChrome', error, outputChannel });
		return toSafeArtboardErrorMessage(error);
	}
};
