import * as vscode from 'vscode';

import { fileExists, logDiskError } from './hostFs';
import { effectiveArtboardMeta } from '../disk/effectiveMeta';
import {
	ArtboardNotFoundError,
	CorruptManifestError,
	CorruptMetaError,
	CursorDesignError,
	InvalidArtboardIdError,
} from '../disk/errors';
import { compareHandoff } from '../disk/handoff';
import { hashHtml } from '../disk/hash';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	DEFAULT_VIEWPORT,
	SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	manifestPathSegments,
} from '../disk/layout';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	type LastExport,
	parseManifest,
	parseMeta,
	serializeManifest,
	serializeMeta,
} from '../disk/parse';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

export const UNTRUSTED_WORKSPACE_MESSAGE =
	'This workspace is not trusted. Cursor Design will not write files or preview artboard HTML.';

export type ArtboardSnapshot = {
	artboardId: string;
	title: string;
	generation: number;
	html: string;
	viewport: string;
	handoffStale: boolean;
	errorMessage?: string;
};

type WorkspaceDiskArgs = {
	workspaceFolder: vscode.WorkspaceFolder;
	outputChannel: vscode.OutputChannel;
};

export const emptyArtboardSnapshot = (errorMessage?: string): ArtboardSnapshot => ({
	artboardId: '',
	title: '',
	generation: 0,
	html: '',
	viewport: DEFAULT_VIEWPORT,
	handoffStale: false,
	errorMessage,
});

export const snapshotForChrome = (snapshot: ArtboardSnapshot): ArtboardSnapshot => {
	if (vscode.workspace.isTrusted) {
		return snapshot;
	}
	return {
		...snapshot,
		html: '',
		errorMessage: snapshot.errorMessage ?? UNTRUSTED_WORKSPACE_MESSAGE,
	};
};

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

const snapshotFromMeta = (meta: ArtboardMeta, html: string): ArtboardSnapshot => ({
	artboardId: meta.id,
	title: meta.title,
	generation: meta.generation,
	html,
	viewport: meta.viewport,
	handoffStale: false,
});

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

type LastExportHandoffStaleArgs = {
	workspaceFolder: vscode.WorkspaceFolder;
	lastExport: LastExport | undefined;
	activeArtboardId: string;
	activeHtml: string;
};

const lastExportHandoffStale = async ({
	workspaceFolder,
	lastExport,
	activeArtboardId,
	activeHtml,
}: LastExportHandoffStaleArgs): Promise<boolean> => {
	if (lastExport === undefined) {
		return false;
	}

	let exportedHtml: string | undefined;
	if (lastExport.artboardId === activeArtboardId) {
		exportedHtml = activeHtml;
	} else {
		const exportedHtmlUri = joinWorkspace(
			workspaceFolder,
			artboardHtmlPathSegments(lastExport.artboardId),
		);
		if (await fileExists(exportedHtmlUri)) {
			exportedHtml = await readTextFile(exportedHtmlUri);
		}
	}

	if (exportedHtml === undefined) {
		return true;
	}
	const compared = compareHandoff({
		lastExport,
		activeHash: hashHtml(exportedHtml),
	});
	return compared.exported && compared.stale;
};

const initializeDefaultArtboard = async (
	workspaceFolder: vscode.WorkspaceFolder,
): Promise<ArtboardSnapshot> => {
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
	return snapshotFromMeta(
		effectiveArtboardMeta({
			html,
			meta: storedMeta,
			artboardId: DEFAULT_ARTBOARD_ID,
		}),
		html,
	);
};

const loadExistingArtboard = async (
	workspaceFolder: vscode.WorkspaceFolder,
	manifestUri: vscode.Uri,
): Promise<ArtboardSnapshot> => {
	const manifest = await readManifest(manifestUri);
	if (manifest.activeArtboardId === '') {
		return emptyArtboardSnapshot('No active artboard. Ask the agent to set_artboard.');
	}

	const htmlUri = joinWorkspace(
		workspaceFolder,
		artboardHtmlPathSegments(manifest.activeArtboardId),
	);
	const metaUri = joinWorkspace(
		workspaceFolder,
		artboardMetaPathSegments(manifest.activeArtboardId),
	);
	const parsedMeta = await readParsedMeta(metaUri, manifest.activeArtboardId);
	if (!(await fileExists(htmlUri))) {
		return {
			artboardId: manifest.activeArtboardId,
			title: parsedMeta?.title ?? '',
			generation: parsedMeta?.generation ?? 0,
			html: '',
			viewport: parsedMeta?.viewport ?? DEFAULT_VIEWPORT,
			handoffStale: false,
			errorMessage: new ArtboardNotFoundError(manifest.activeArtboardId).message,
		};
	}

	const html = await readTextFile(htmlUri);
	const snapshot = snapshotFromMeta(
		effectiveArtboardMeta({
			html,
			meta: parsedMeta,
			artboardId: manifest.activeArtboardId,
		}),
		html,
	);
	return {
		...snapshot,
		handoffStale: await lastExportHandoffStale({
			workspaceFolder,
			lastExport: manifest.lastExport,
			activeArtboardId: manifest.activeArtboardId,
			activeHtml: html,
		}),
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
}: LoadActiveSnapshotArgs): Promise<ArtboardSnapshot> => {
	if (!vscode.workspace.isTrusted) {
		return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
	}

	const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);
	try {
		if (!(await fileExists(manifestUri))) {
			if (initializeWhenMissing) {
				return await initializeDefaultArtboard(workspaceFolder);
			}
			return emptyArtboardSnapshot();
		}
		return await loadExistingArtboard(workspaceFolder, manifestUri);
	} catch (error: unknown) {
		logDiskError({ scope, error, outputChannel });
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	}
};

export const initAndLoadArtboard = async (args: WorkspaceDiskArgs): Promise<ArtboardSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.initAndLoad', initializeWhenMissing: true });

export const readActiveArtboardFromDisk = async (
	args: WorkspaceDiskArgs,
): Promise<ArtboardSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.readActive', initializeWhenMissing: false });
