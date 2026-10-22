import * as vscode from 'vscode';

import { parseChromeMessage } from './chromeMessages';
import { fileExists, logDiskError } from './hostFs';
import {
	canvasSnapshotErrorMessage,
	canvasViewReadLogs,
	emptyArtboardSnapshot,
	snapshotForChrome as applyCanvasSnapshotTrust,
	UNTRUSTED_WORKSPACE_MESSAGE,
	type CanvasSnapshot,
} from './canvasSnapshot';
import { type CanvasView, placeFrame, readCanvasView } from '../disk/artboardFs';
import { effectiveArtboardMeta } from '../disk/effectiveMeta';
import {
	CorruptManifestError,
	CorruptMetaError,
	CursorDesignError,
	InvalidArgsError,
	InvalidArtboardIdError,
	NoWorkspaceError,
} from '../disk/errors';
import { compareCanvasHandoff } from '../disk/handoff';
import { hashHtml } from '../disk/hash';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	manifestPathSegments,
} from '../disk/layout';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	parseManifest,
	parseMeta,
	serializeManifest,
	serializeMeta,
} from '../disk/parse';

export { emptyArtboardSnapshot, UNTRUSTED_WORKSPACE_MESSAGE, type CanvasSnapshot };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

type WorkspaceDiskArgs = {
	workspaceFolder: vscode.WorkspaceFolder;
	outputChannel: vscode.OutputChannel;
};

export const snapshotForChrome = (snapshot: CanvasSnapshot): CanvasSnapshot =>
	applyCanvasSnapshotTrust({ snapshot, isTrusted: vscode.workspace.isTrusted });

export const toSafeArtboardErrorMessage = (error: unknown): string => {
	if (error instanceof CursorDesignError) {
		return error.message;
	}
	return 'Could not load artboard. Check the Output panel: Cursor Design.';
};

const joinWorkspace = (
	workspaceFolder: vscode.WorkspaceFolder,
	segments: readonly string[],
): vscode.Uri => vscode.Uri.joinPath(workspaceFolder.uri, ...segments);

const readTextFile = async (uri: vscode.Uri): Promise<string> => {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return textDecoder.decode(bytes);
};

const writeTextFile = async (uri: vscode.Uri, contents: string): Promise<void> => {
	await vscode.workspace.fs.writeFile(uri, textEncoder.encode(contents));
};

const isExpectedMetaParseError = (error: unknown): boolean =>
	error instanceof SyntaxError ||
	error instanceof CorruptMetaError ||
	error instanceof InvalidArtboardIdError;

const readParsedMeta = async (
	metaUri: vscode.Uri,
	artboardId: string,
): Promise<ArtboardMeta | undefined> => {
	if (!(await fileExists(metaUri))) {
		return undefined;
	}
	try {
		const parsedMeta = parseMeta(JSON.parse(await readTextFile(metaUri)) as unknown);
		if (parsedMeta.id !== artboardId) {
			return undefined;
		}
		return parsedMeta;
	} catch (error: unknown) {
		if (isExpectedMetaParseError(error)) {
			return undefined;
		}
		throw error;
	}
};

const readManifest = async (manifestUri: vscode.Uri): Promise<ArtboardManifest> => {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(await readTextFile(manifestUri)) as unknown;
	} catch (error: unknown) {
		throw new CorruptManifestError({ cause: error });
	}
	return parseManifest(parsedJson);
};

const initializeDefaultArtboard = async (
	workspaceFolder: vscode.WorkspaceFolder,
): Promise<void> => {
	const artboardsUri = joinWorkspace(workspaceFolder, artboardsDirSegments);
	const htmlUri = joinWorkspace(workspaceFolder, artboardHtmlPathSegments(DEFAULT_ARTBOARD_ID));
	const metaUri = joinWorkspace(workspaceFolder, artboardMetaPathSegments(DEFAULT_ARTBOARD_ID));
	const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);

	await vscode.workspace.fs.createDirectory(artboardsUri);

	let html: string;
	if (await fileExists(htmlUri)) {
		html = await readTextFile(htmlUri);
	} else {
		html = DEFAULT_ARTBOARD_HTML;
		await writeTextFile(htmlUri, html);
	}

	let storedMeta = await readParsedMeta(metaUri, DEFAULT_ARTBOARD_ID);
	if (storedMeta === undefined) {
		storedMeta = {
			...effectiveArtboardMeta({
				html,
				meta: undefined,
				artboardId: DEFAULT_ARTBOARD_ID,
			}),
			updatedAt: new Date().toISOString(),
		};
		await writeTextFile(metaUri, serializeMeta(storedMeta));
	}

	const manifest: ArtboardManifest = {
		version: SCHEMA_VERSION,
		activeArtboardId: DEFAULT_ARTBOARD_ID,
		workspaceFolder: workspaceFolder.uri.fsPath,
		updatedAt: new Date().toISOString(),
	};
	await writeTextFile(manifestUri, serializeManifest(manifest));
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

	// Badge = exported && stale, so a never-exported canvas keeps it off.
	let handoffStale = false;
	if (view.frames.length > 0) {
		try {
			const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);
			const lastExport = (await fileExists(manifestUri))
				? (await readManifest(manifestUri)).lastExport
				: undefined;
			const compared = compareCanvasHandoff({
				lastExport,
				frames: view.frames.map((frame) => ({
					artboardId: frame.id,
					hash: frame.errorMessage === undefined ? hashHtml(frame.html) : undefined,
				})),
			});
			handoffStale = compared.exported && compared.stale;
		} catch (error: unknown) {
			logDiskError({ scope: 'artboardDisk.handoffStale', error, outputChannel });
			handoffStale = true;
		}
	}

	return {
		activeArtboardId: view.activeArtboardId,
		generation: activeFrame?.generation ?? 0,
		frames: view.frames,
		handoffStale,
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
			await initializeDefaultArtboard(workspaceFolder);
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
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
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
