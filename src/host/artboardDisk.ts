import * as vscode from 'vscode';

import {
	ArtboardHtmlMissingError,
	CorruptManifestError,
	CorruptMetaError,
	InvalidArtboardIdError,
	UnsupportedSchemaVersionError,
} from '../disk/errors';
import { nextGeneration } from '../disk/generation';
import { hashHtml } from '../disk/hash';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	DEFAULT_ARTBOARD_TITLE,
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
	parseManifest,
	parseMeta,
	serializeManifest,
	serializeMeta,
} from '../disk/parse';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

const UNTRUSTED_WORKSPACE_MESSAGE =
	'This workspace is not trusted. Cursor Design will not write files or preview artboard HTML.';

export type ArtboardSnapshot = {
	artboardId: string;
	title: string;
	generation: number;
	html: string;
	viewport: string;
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

const toSafeArtboardErrorMessage = (error: unknown): string => {
	if (
		error instanceof CorruptManifestError ||
		error instanceof UnsupportedSchemaVersionError ||
		error instanceof ArtboardHtmlMissingError ||
		error instanceof InvalidArtboardIdError ||
		error instanceof CorruptMetaError
	) {
		return error.message;
	}
	return 'Could not load artboard. Check the Output panel: Cursor Design.';
};

const isFileNotFound = (error: unknown): boolean =>
	error instanceof vscode.FileSystemError &&
	(error.code === 'FileNotFound' || error.code === 'EntryNotFound');

const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return false;
		}
		throw error;
	}
};

const joinWorkspace = (workspaceFolder: vscode.WorkspaceFolder, segments: readonly string[]): vscode.Uri =>
	vscode.Uri.joinPath(workspaceFolder.uri, ...segments);

const readTextFile = async (uri: vscode.Uri): Promise<string> => {
	const bytes = await vscode.workspace.fs.readFile(uri);
	return textDecoder.decode(bytes);
};

const writeTextFile = async (uri: vscode.Uri, contents: string): Promise<void> => {
	await vscode.workspace.fs.writeFile(uri, textEncoder.encode(contents));
};

const logDiskError = (scope: string, error: unknown, outputChannel: vscode.OutputChannel): void => {
	outputChannel.appendLine(
		`${scope}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
	);
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
});

const readParsedMeta = async (metaUri: vscode.Uri): Promise<ArtboardMeta | undefined> => {
	if (!(await fileExists(metaUri))) {
		return undefined;
	}
	try {
		return parseMeta(JSON.parse(await readTextFile(metaUri)) as unknown);
	} catch (error: unknown) {
		if (isExpectedMetaParseError(error)) {
			return undefined;
		}
		throw error;
	}
};

type ReconcileMetaArgs = {
	artboardId: string;
	html: string;
	metaUri: vscode.Uri;
	titleFallback: string;
};

const reconcileMeta = async ({
	artboardId,
	html,
	metaUri,
	titleFallback,
}: ReconcileMetaArgs): Promise<ArtboardSnapshot> => {
	const htmlHash = hashHtml(html);
	const parsedMeta = await readParsedMeta(metaUri);
	if (parsedMeta !== undefined && parsedMeta.hash === htmlHash) {
		return snapshotFromMeta(parsedMeta, html);
	}

	const nextMeta: ArtboardMeta = {
		id: artboardId,
		title: parsedMeta?.title ?? titleFallback,
		generation: nextGeneration(parsedMeta?.generation),
		hash: htmlHash,
		viewport: parsedMeta?.viewport ?? DEFAULT_VIEWPORT,
		updatedAt: new Date().toISOString(),
	};
	await writeTextFile(metaUri, serializeMeta(nextMeta));
	return snapshotFromMeta(nextMeta, html);
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

	const snapshot = await reconcileMeta({
		artboardId: DEFAULT_ARTBOARD_ID,
		html,
		metaUri,
		titleFallback: DEFAULT_ARTBOARD_TITLE,
	});

	const manifest: ArtboardManifest = {
		version: SCHEMA_VERSION,
		activeArtboardId: DEFAULT_ARTBOARD_ID,
		workspaceFolder: workspaceFolder.uri.fsPath,
		updatedAt: new Date().toISOString(),
	};
	await writeTextFile(manifestUri, serializeManifest(manifest));
	return snapshot;
};

const loadExistingArtboard = async (
	workspaceFolder: vscode.WorkspaceFolder,
	manifestUri: vscode.Uri,
): Promise<ArtboardSnapshot> => {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(await readTextFile(manifestUri)) as unknown;
	} catch (error: unknown) {
		throw new CorruptManifestError({ cause: error });
	}

	const manifest = parseManifest(parsedJson);
	const htmlUri = joinWorkspace(workspaceFolder, artboardHtmlPathSegments(manifest.activeArtboardId));
	const metaUri = joinWorkspace(workspaceFolder, artboardMetaPathSegments(manifest.activeArtboardId));
	if (!(await fileExists(htmlUri))) {
		const parsedMeta = await readParsedMeta(metaUri);
		return {
			artboardId: manifest.activeArtboardId,
			title: parsedMeta?.title ?? '',
			generation: parsedMeta?.generation ?? 0,
			html: '',
			viewport: parsedMeta?.viewport ?? DEFAULT_VIEWPORT,
			errorMessage: new ArtboardHtmlMissingError(manifest.activeArtboardId).message,
		};
	}

	const html = await readTextFile(htmlUri);
	return reconcileMeta({
		artboardId: manifest.activeArtboardId,
		html,
		metaUri,
		titleFallback: DEFAULT_ARTBOARD_TITLE,
	});
};

export const initAndLoadArtboard = async ({
	workspaceFolder,
	outputChannel,
}: WorkspaceDiskArgs): Promise<ArtboardSnapshot> => {
	if (!vscode.workspace.isTrusted) {
		return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
	}

	const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);
	try {
		if (!(await fileExists(manifestUri))) {
			return await initializeDefaultArtboard(workspaceFolder);
		}
		return await loadExistingArtboard(workspaceFolder, manifestUri);
	} catch (error: unknown) {
		logDiskError('artboardDisk.initAndLoad', error, outputChannel);
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	}
};

export const readActiveArtboardFromDisk = async ({
	workspaceFolder,
	outputChannel,
}: WorkspaceDiskArgs): Promise<ArtboardSnapshot> => {
	if (!vscode.workspace.isTrusted) {
		return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
	}

	const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);
	try {
		if (!(await fileExists(manifestUri))) {
			return emptyArtboardSnapshot();
		}
		return await loadExistingArtboard(workspaceFolder, manifestUri);
	} catch (error: unknown) {
		logDiskError('artboardDisk.readActive', error, outputChannel);
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	}
};
