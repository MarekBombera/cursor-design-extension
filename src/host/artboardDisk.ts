import * as vscode from 'vscode';

import { fileExists, isFileNotFound, logDiskError } from './hostFs';
import {
	ArtboardHtmlMissingError,
	ArtboardNotFoundError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	InvalidArtboardIdError,
	UnsupportedSchemaVersionError,
} from '../disk/errors';
import { nextGeneration } from '../disk/generation';
import { buildHandoffFiles, compareHandoff } from '../disk/handoff';
import { hashHtml } from '../disk/hash';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	DEFAULT_ARTBOARD_TITLE,
	DEFAULT_VIEWPORT,
	HANDOFF_INDEX_FILE,
	IMPLEMENT_FILE,
	SCHEMA_VERSION,
	TOKENS_FILE,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	handoffDirSegments,
	handoffRootSegments,
	manifestPathSegments,
	workspaceTokensPathSegments,
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

const joinWorkspace = (workspaceFolder: vscode.WorkspaceFolder, segments: readonly string[]): vscode.Uri =>
	vscode.Uri.joinPath(workspaceFolder.uri, ...segments);

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

const readManifest = async (manifestUri: vscode.Uri): Promise<ArtboardManifest> => {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(await readTextFile(manifestUri)) as unknown;
	} catch (error: unknown) {
		throw new CorruptManifestError({ cause: error });
	}
	return parseManifest(parsedJson);
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
	const manifest = await readManifest(manifestUri);
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
			handoffStale: false,
			errorMessage: new ArtboardHtmlMissingError(manifest.activeArtboardId).message,
		};
	}

	const html = await readTextFile(htmlUri);
	const snapshot = await reconcileMeta({
		artboardId: manifest.activeArtboardId,
		html,
		metaUri,
		titleFallback: DEFAULT_ARTBOARD_TITLE,
	});
	const compared = compareHandoff({
		lastExport: manifest.lastExport,
		activeHash: hashHtml(html),
	});
	return {
		...snapshot,
		handoffStale: compared.exported && compared.stale,
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

const readTokensJsonForHostExport = async (
	workspaceFolder: vscode.WorkspaceFolder,
): Promise<string | undefined> => {
	const tokensUri = joinWorkspace(workspaceFolder, workspaceTokensPathSegments);
	try {
		const tokensStat = await vscode.workspace.fs.stat(tokensUri);
		if (tokensStat.type !== vscode.FileType.File) {
			throw new DiskError('.cursor-design/tokens.json must be a regular file.');
		}
		return await readTextFile(tokensUri);
	} catch (error: unknown) {
		if (isFileNotFound(error)) {
			return undefined;
		}
		if (error instanceof DiskError) {
			throw error;
		}
		throw new DiskError({ cause: error });
	}
};

export const exportActiveArtboardHandoff = async ({
	workspaceFolder,
	outputChannel,
}: WorkspaceDiskArgs): Promise<{ exportId: string }> => {
	try {
		const manifestUri = joinWorkspace(workspaceFolder, manifestPathSegments);
		if (!(await fileExists(manifestUri))) {
			throw new ArtboardNotFoundError('');
		}

		const manifest = await readManifest(manifestUri);
		const artboardId = manifest.activeArtboardId;
		if (artboardId.length === 0) {
			throw new ArtboardNotFoundError('');
		}

		const htmlUri = joinWorkspace(workspaceFolder, artboardHtmlPathSegments(artboardId));
		if (!(await fileExists(htmlUri))) {
			throw new ArtboardNotFoundError(artboardId);
		}
		const html = await readTextFile(htmlUri);
		// Watcher skips reconcile while the panel is closed; export must heal meta to match the HTML it copies.
		const snapshot = await reconcileMeta({
			artboardId,
			html,
			metaUri: joinWorkspace(workspaceFolder, artboardMetaPathSegments(artboardId)),
			titleFallback: DEFAULT_ARTBOARD_TITLE,
		});
		const tokensJson = await readTokensJsonForHostExport(workspaceFolder);
		const exportNow = new Date();
		const meta: ArtboardMeta = {
			id: artboardId,
			title: snapshot.title,
			generation: snapshot.generation,
			hash: hashHtml(html),
			viewport: snapshot.viewport,
			updatedAt: exportNow.toISOString(),
		};
		const files = buildHandoffFiles({
			artboardId,
			html,
			meta,
			tokensJson,
			now: exportNow,
		});

		await vscode.workspace.fs.createDirectory(joinWorkspace(workspaceFolder, handoffRootSegments));
		const leafUri = joinWorkspace(workspaceFolder, handoffDirSegments(files.exportId));
		if (await fileExists(leafUri)) {
			throw new DiskError();
		}
		await vscode.workspace.fs.createDirectory(leafUri);
		await writeTextFile(vscode.Uri.joinPath(leafUri, HANDOFF_INDEX_FILE), files.indexHtml);
		await writeTextFile(vscode.Uri.joinPath(leafUri, IMPLEMENT_FILE), files.implementMd);
		await writeTextFile(vscode.Uri.joinPath(leafUri, TOKENS_FILE), files.tokensJson);
		// ponytail: no journal / rollback; orphan dirs are harmless and never deleted

		const nextManifest: ArtboardManifest = {
			version: SCHEMA_VERSION,
			activeArtboardId: manifest.activeArtboardId,
			workspaceFolder: manifest.workspaceFolder,
			updatedAt: files.lastExport.exportedAt,
			lastExport: files.lastExport,
		};
		await writeTextFile(manifestUri, serializeManifest(nextManifest));
		return { exportId: files.exportId };
	} catch (error: unknown) {
		if (
			error instanceof ArtboardNotFoundError ||
			error instanceof CorruptManifestError ||
			error instanceof CorruptMetaError ||
			error instanceof InvalidArtboardIdError ||
			error instanceof UnsupportedSchemaVersionError
		) {
			throw error;
		}
		logDiskError({ scope: 'artboardDisk.exportHandoff', error, outputChannel });
		if (error instanceof DiskError) {
			throw error;
		}
		throw new DiskError({ cause: error });
	}
};
