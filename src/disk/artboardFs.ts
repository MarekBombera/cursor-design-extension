import { type Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
	type CanvasFrame,
	type CanvasLayout,
	parseCanvasLayout,
	placeCanvasFrame,
	resolveCanvasFrames,
	serializeCanvasLayout,
} from './canvasLayout';
import { conflictFields } from './conflict';
import { effectiveArtboardMeta } from './effectiveMeta';
import {
	ArtboardExistsError,
	ArtboardNotFoundError,
	ConflictError,
	CorruptCanvasError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	FrameMovedError,
	InvalidArgsError,
	InvalidArtboardIdError,
	NoArtboardsToExportError,
	UnsupportedCanvasVersionError,
	isErrno,
	throwDiskError,
} from './errors';
import { nextGeneration } from './generation';
import {
	STUB_TOKENS_JSON,
	assignGroupFolders,
	buildCanvasImplementMarkdown,
	compareCanvasHandoff,
	makeCanvasExportId,
} from './handoff';
import { buildCanvasPreviewHtml } from './handoffCanvasHtml';
import { hashHtml, isArtboardHash, normalizeHash } from './hash';
import {
	CANVAS_PREVIEW_FILE,
	CANVAS_SCHEMA_VERSION,
	CURSOR_DESIGN_DIR,
	DEFAULT_ARTBOARD_TITLE,
	DEFAULT_VIEWPORT,
	HANDOFF_INDEX_FILE,
	IMPLEMENT_FILE,
	SCHEMA_VERSION,
	TOKENS_FILE,
	UNGROUPED_FOLDER,
	artboardHtmlFileName,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	ensurePanelPathSegments,
	handoffDirSegments,
	handoffRootSegments,
	manifestPathSegments,
	workspaceTokensPathSegments,
} from './layout';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	type ExportedFrame,
	type LastExport,
	parseArtboardId,
	parseManifest,
	parseMeta,
	serializeManifest,
	serializeMeta,
} from './parse';
import { withWorkspaceLock } from './workspaceLock';

export type CreateArtboardArgs = {
	workspaceRoot: string;
	artboardId: unknown;
	html: unknown;
	title?: unknown;
	viewport?: unknown;
	writeEnsurePanelMarker: boolean;
};

export type CreateArtboardResult = {
	artboardId: string;
	generation: number;
	hash: string;
	title: string;
	viewport: string;
	active: true;
	panelEnsured: boolean;
};

export type UpdateArtboardArgs = {
	workspaceRoot: string;
	artboardId: unknown;
	html: unknown;
	baseGeneration?: unknown;
	baseHash?: unknown;
	title?: unknown;
	viewport?: unknown;
};

export type UpdateArtboardResult = {
	artboardId: string;
	generation: number;
	hash: string;
	title: string;
	viewport: string;
};

export type ReadArtboardArgs = {
	workspaceRoot: string;
	artboardId?: unknown;
};

export type ReadArtboardResult = {
	artboardId: string;
	title: string;
	generation: number;
	hash: string;
	viewport: string;
	html: string;
	updatedAt: string;
	active: boolean;
};

export type ListArtboardsArgs = {
	workspaceRoot: string;
};

export type ListedArtboard = {
	artboardId: string;
	title: string;
	active: boolean;
	generation?: number;
};

export type ListArtboardsResult = {
	activeArtboardId: string;
	artboards: ListedArtboard[];
	frames: CanvasFrame[];
};

export type CanvasViewFrame = CanvasFrame & {
	generation: number;
	html: string;
	errorMessage?: string;
};

export type CanvasViewHtmlReadError = {
	artboardId: string;
	error: DiskError;
};

export type CanvasView = {
	activeArtboardId: string;
	frames: CanvasViewFrame[];
	layoutErrorMessage?: string;
	htmlReadErrors?: CanvasViewHtmlReadError[];
};

export type ReadCanvasViewArgs = {
	workspaceRoot: string;
};

export const FRAME_READ_ERROR_MESSAGE =
	'Could not read this artboard file. Check the Output panel: Cursor Design.';

export type PlaceFrameArgs = {
	workspaceRoot: string;
	id: unknown;
	x?: unknown;
	y?: unknown;
	width?: unknown;
	label?: unknown;
	group?: unknown;
	// Host-only (panel drag): the frame's x/y/width when the gesture started. The MCP tool never passes it.
	base?: Pick<CanvasFrame, 'x' | 'y' | 'width'>;
};

export type PlaceFrameResult = {
	frames: CanvasFrame[];
};

export type SetActiveArtboardArgs = {
	workspaceRoot: string;
	artboardId: unknown;
};

export type ExportArtboardArgs = {
	workspaceRoot: string;
	now?: Date;
};

export type ExportedFrameResult = ExportedFrame & {
	path: string;
};

export type ExportArtboardResult = {
	exportId: string;
	exportedAt: string;
	handoffPath: string;
	frames: ExportedFrameResult[];
};

export type HandoffStatusResult = {
	stale: boolean;
	activeArtboardId: string;
	activeHash: string;
	lastExport?: LastExport;
};

const workspaceJoin = (workspaceRoot: string, segments: readonly string[]): string =>
	join(workspaceRoot, ...segments);

const workspaceLayoutFile = (
	workspaceRoot: string,
	segments: readonly string[],
): { filePath: string; relativePath: string } => ({
	filePath: workspaceJoin(workspaceRoot, segments),
	relativePath: segments.join('/'),
});

const regularFileRequiredMessage = (relativePath: string): string =>
	`${relativePath} must be a regular file (symlinks rejected).`;

const directoryRequiredMessage = (relativePath: string): string =>
	`${relativePath} must be a directory (symlinks rejected).`;

type LayoutEntryKind = 'missing' | 'symlink' | 'file' | 'other';

const layoutEntryKind = async (filePath: string): Promise<LayoutEntryKind> => {
	const fileStats = await lstatOrUndefined(filePath);
	if (fileStats === undefined) {
		return 'missing';
	}
	if (fileStats.isSymbolicLink()) {
		return 'symlink';
	}
	return fileStats.isFile() ? 'file' : 'other';
};

// lstat (never stat) at every level: the id charset already blocks `..`, so rejecting
// symlinks here keeps layout I/O under {workspaceRoot}/.cursor-design/ without realpath.
// ponytail: reads still check-then-act; writeUtf8 unlinks tmp then wx-writes so a leftover
// symlink tmp cannot redirect the payload; rename replaces the dest name (does not follow it).
const lstatOrUndefined = async (filePath: string): Promise<Stats | undefined> => {
	try {
		return await lstat(filePath);
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return undefined;
		}
		return throwDiskError(error);
	}
};

const assertLayoutDirsOwned = async (workspaceRoot: string): Promise<void> => {
	const dirLayouts: readonly (readonly string[])[] = [
		[CURSOR_DESIGN_DIR],
		artboardsDirSegments,
		handoffRootSegments,
	];
	for (const segments of dirLayouts) {
		const dirPath = join(workspaceRoot, ...segments);
		const dirStats = await lstatOrUndefined(dirPath);
		if (dirStats === undefined) {
			continue;
		}
		if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
			throw new DiskError(directoryRequiredMessage(segments.join('/')));
		}
	}
};

const requireHtmlFile = async (htmlFilePath: string, artboardId: string): Promise<void> => {
	const entryKind = await layoutEntryKind(htmlFilePath);
	if (entryKind === 'missing') {
		throw new ArtboardNotFoundError(artboardId);
	}
	if (entryKind !== 'file') {
		throw new DiskError(regularFileRequiredMessage(artboardHtmlPathSegments(artboardId).join('/')));
	}
};

const requireExactHtmlFileName = async (
	workspaceRoot: string,
	artboardId: string,
): Promise<void> => {
	const artboardsDirectory = workspaceJoin(workspaceRoot, artboardsDirSegments);
	let fileNames: string[];
	try {
		fileNames = await readdir(artboardsDirectory, { encoding: 'utf8' });
	} catch (error: unknown) {
		return throwDiskError(error);
	}
	if (!fileNames.includes(artboardHtmlFileName(artboardId))) {
		throw new ArtboardNotFoundError(artboardId);
	}
};

const readUtf8IfExists = async ({
	filePath,
	relativePath,
}: {
	filePath: string;
	relativePath: string;
}): Promise<string | undefined> => {
	const entryKind = await layoutEntryKind(filePath);
	if (entryKind === 'missing') {
		return undefined;
	}
	if (entryKind !== 'file') {
		throw new DiskError(regularFileRequiredMessage(relativePath));
	}
	try {
		return await readFile(filePath, 'utf8');
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return undefined;
		}
		return throwDiskError(error);
	}
};

const writeUtf8 = async ({
	filePath,
	contents,
	relativePath,
}: {
	filePath: string;
	contents: string;
	relativePath: string;
}): Promise<void> => {
	const entryKind = await layoutEntryKind(filePath);
	if (entryKind === 'symlink' || entryKind === 'other') {
		throw new DiskError(regularFileRequiredMessage(relativePath));
	}
	const tempFilePath = `${filePath}.${process.pid}.tmp`;
	try {
		await unlink(tempFilePath);
	} catch (error: unknown) {
		if (!isErrno(error, 'ENOENT')) {
			throwDiskError(error);
		}
	}
	try {
		await writeFile(tempFilePath, contents, { encoding: 'utf8', flag: 'wx' });
		await rename(tempFilePath, filePath);
	} catch (error: unknown) {
		throwDiskError(error);
	}
};

const ensureDir = async (dirPath: string): Promise<void> => {
	try {
		await mkdir(dirPath, { recursive: true });
	} catch (error: unknown) {
		throwDiskError(error);
	}
};

const parseManifestText = (text: string): ArtboardManifest => {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptManifestError({ cause: error });
	}
	return parseManifest(parsedJson);
};

const readManifestFile = async (workspaceRoot: string): Promise<ArtboardManifest | undefined> => {
	const text = await readUtf8IfExists(workspaceLayoutFile(workspaceRoot, manifestPathSegments));
	if (text === undefined) {
		return undefined;
	}
	return parseManifestText(text);
};

const readManifestFileLenient = async (
	workspaceRoot: string,
): Promise<ArtboardManifest | undefined> => {
	try {
		return await readManifestFile(workspaceRoot);
	} catch (error: unknown) {
		if (error instanceof CorruptManifestError) {
			return undefined;
		}
		throw error;
	}
};

// Reads the stored canvas.json; a missing file is an empty layout, a bad one throws and is never overwritten.
const readCanvasLayoutFile = async (workspaceRoot: string): Promise<CanvasLayout> => {
	const text = await readUtf8IfExists(workspaceLayoutFile(workspaceRoot, canvasPathSegments));
	if (text === undefined) {
		return { version: CANVAS_SCHEMA_VERSION, frames: [] };
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptCanvasError({ cause: error });
	}
	return parseCanvasLayout(parsedJson);
};

const isBenignMetaParseError = (error: unknown): boolean =>
	error instanceof SyntaxError ||
	error instanceof CorruptMetaError ||
	error instanceof InvalidArtboardIdError;

const parseMetaFromJsonText = (text: string): ArtboardMeta =>
	parseMeta(JSON.parse(text) as unknown);

// Tolerant by default: an unparsable meta reads as missing. Export passes rejectUnparsable so a
// broken meta fails before any write instead of being silently restamped.
const readStoredMeta = async (
	workspaceRoot: string,
	artboardId: string,
	{ rejectUnparsable = false }: { rejectUnparsable?: boolean } = {},
): Promise<ArtboardMeta | undefined> => {
	const text = await readUtf8IfExists(
		workspaceLayoutFile(workspaceRoot, artboardMetaPathSegments(artboardId)),
	);
	if (text === undefined) {
		return undefined;
	}
	let meta: ArtboardMeta;
	try {
		meta = parseMetaFromJsonText(text);
	} catch (error: unknown) {
		if (isBenignMetaParseError(error)) {
			if (rejectUnparsable) {
				throw new CorruptMetaError(artboardId, { cause: error });
			}
			return undefined;
		}
		return throwDiskError(error);
	}
	if (meta.id !== artboardId) {
		throw new CorruptMetaError(artboardId);
	}
	return meta;
};

const requireArtboardHtml = async (workspaceRoot: string, artboardId: string): Promise<string> => {
	const html = await readUtf8IfExists(
		workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(artboardId)),
	);
	if (html === undefined) {
		throw new ArtboardNotFoundError(artboardId);
	}
	return html;
};

const requireHtmlString = (html: unknown): string => {
	if (typeof html !== 'string') {
		throw new InvalidArgsError('html must be a string. Fix args and retry.');
	}
	return html;
};

const requireArtboardIdString = (artboardId: unknown): string => {
	if (typeof artboardId !== 'string') {
		throw new InvalidArgsError('artboardId must be a string. Fix args and retry.');
	}
	return parseArtboardId(artboardId);
};

const requireOptionalString = (value: unknown, fieldName: string): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new InvalidArgsError(`${fieldName} must be a string. Fix args and retry.`);
	}
	if (fieldName === 'viewport' && value.length === 0) {
		throw new InvalidArgsError('viewport must be a non-empty string. Fix args and retry.');
	}
	return value;
};

const requireActiveManifest = (manifest: ArtboardManifest | undefined): ArtboardManifest => {
	if (manifest === undefined || manifest.activeArtboardId.length === 0) {
		throw new ArtboardNotFoundError('');
	}
	return manifest;
};

const writeManifestActive = async ({
	workspaceRoot,
	artboardId,
	existing,
}: {
	workspaceRoot: string;
	artboardId: string;
	existing: ArtboardManifest | undefined;
}): Promise<void> => {
	const manifest: ArtboardManifest = {
		version: SCHEMA_VERSION,
		activeArtboardId: artboardId,
		workspaceFolder: existing?.workspaceFolder ?? workspaceRoot,
		updatedAt: new Date().toISOString(),
	};
	if (existing?.lastExport !== undefined) {
		manifest.lastExport = existing.lastExport;
	}
	await writeUtf8({
		...workspaceLayoutFile(workspaceRoot, manifestPathSegments),
		contents: serializeManifest(manifest),
	});
};

export const createArtboard = async ({
	workspaceRoot,
	artboardId,
	html,
	title,
	viewport,
	writeEnsurePanelMarker,
}: CreateArtboardArgs): Promise<CreateArtboardResult> => {
	const resolvedId = requireArtboardIdString(artboardId);
	const resolvedHtml = requireHtmlString(html);
	const validatedTitle = requireOptionalString(title, 'title');
	const validatedViewport = requireOptionalString(viewport, 'viewport');

	await assertLayoutDirsOwned(workspaceRoot);
	const htmlLayout = workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(resolvedId));
	const metaLayout = workspaceLayoutFile(workspaceRoot, artboardMetaPathSegments(resolvedId));
	const existingManifest = await readManifestFileLenient(workspaceRoot);

	await ensureDir(workspaceJoin(workspaceRoot, artboardsDirSegments));

	const existingHtmlKind = await layoutEntryKind(htmlLayout.filePath);
	if (existingHtmlKind === 'file') {
		throw new ArtboardExistsError(resolvedId);
	}
	if (existingHtmlKind !== 'missing') {
		throw new DiskError(regularFileRequiredMessage(htmlLayout.relativePath));
	}
	try {
		await writeFile(htmlLayout.filePath, resolvedHtml, { encoding: 'utf8', flag: 'wx' });
	} catch (error: unknown) {
		if (isErrno(error, 'EEXIST')) {
			throw new ArtboardExistsError(resolvedId);
		}
		throwDiskError(error);
	}

	const resolvedTitle = validatedTitle ?? DEFAULT_ARTBOARD_TITLE;
	const resolvedViewport = validatedViewport ?? DEFAULT_VIEWPORT;
	const htmlHash = hashHtml(resolvedHtml);
	const meta: ArtboardMeta = {
		id: resolvedId,
		title: resolvedTitle,
		generation: 1,
		hash: htmlHash,
		viewport: resolvedViewport,
		updatedAt: new Date().toISOString(),
	};
	// ponytail: no journal; if meta/manifest/marker fails after wx HTML, Agent re-reads
	await writeUtf8({ ...metaLayout, contents: serializeMeta(meta) });
	await writeManifestActive({ workspaceRoot, artboardId: resolvedId, existing: existingManifest });

	let panelEnsured = false;
	if (writeEnsurePanelMarker) {
		await writeUtf8({
			...workspaceLayoutFile(workspaceRoot, ensurePanelPathSegments),
			contents: '',
		});
		panelEnsured = true;
	}

	return {
		artboardId: resolvedId,
		generation: meta.generation,
		hash: meta.hash,
		title: meta.title,
		viewport: meta.viewport,
		active: true,
		panelEnsured,
	};
};

export const updateArtboard = async ({
	workspaceRoot,
	artboardId,
	html,
	baseGeneration,
	baseHash,
	title,
	viewport,
}: UpdateArtboardArgs): Promise<UpdateArtboardResult> => {
	const resolvedId = requireArtboardIdString(artboardId);
	const resolvedHtml = requireHtmlString(html);
	if (baseGeneration === undefined && baseHash === undefined) {
		throw new InvalidArgsError(
			'update_artboard requires baseGeneration and/or baseHash. Fix args and retry.',
		);
	}
	if (
		baseGeneration !== undefined &&
		(typeof baseGeneration !== 'number' || !Number.isInteger(baseGeneration) || baseGeneration < 1)
	) {
		throw new InvalidArgsError('baseGeneration must be an integer >= 1. Fix args and retry.');
	}
	if (baseHash !== undefined && (typeof baseHash !== 'string' || !isArtboardHash(baseHash))) {
		throw new InvalidArgsError(
			'baseHash must be sha256: plus 64 hex characters. Fix args and retry.',
		);
	}
	const validatedTitle = requireOptionalString(title, 'title');
	const validatedViewport = requireOptionalString(viewport, 'viewport');

	await assertLayoutDirsOwned(workspaceRoot);
	const htmlLayout = workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(resolvedId));
	await requireHtmlFile(htmlLayout.filePath, resolvedId);
	const currentHtml = await readUtf8IfExists(htmlLayout);
	if (currentHtml === undefined) {
		throw new ArtboardNotFoundError(resolvedId);
	}
	const currentMeta = effectiveArtboardMeta({
		html: currentHtml,
		meta: await readStoredMeta(workspaceRoot, resolvedId),
		artboardId: resolvedId,
	});
	const compared = conflictFields({
		baseGeneration,
		baseHash,
		actualGeneration: currentMeta.generation,
		actualHash: currentMeta.hash,
	});
	if (compared !== undefined) {
		throw new ConflictError(resolvedId, compared);
	}

	const htmlHash = hashHtml(resolvedHtml);
	const nextMeta: ArtboardMeta = {
		id: resolvedId,
		title: validatedTitle ?? currentMeta.title,
		generation:
			htmlHash === normalizeHash(currentMeta.hash)
				? currentMeta.generation
				: nextGeneration(currentMeta.generation),
		hash: htmlHash,
		viewport: validatedViewport ?? currentMeta.viewport,
		updatedAt: new Date().toISOString(),
	};
	await writeUtf8({ ...htmlLayout, contents: resolvedHtml });
	await writeUtf8({
		...workspaceLayoutFile(workspaceRoot, artboardMetaPathSegments(resolvedId)),
		contents: serializeMeta(nextMeta),
	});
	return {
		artboardId: resolvedId,
		generation: nextMeta.generation,
		hash: nextMeta.hash,
		title: nextMeta.title,
		viewport: nextMeta.viewport,
	};
};

export const readArtboard = async ({
	workspaceRoot,
	artboardId,
}: ReadArtboardArgs): Promise<ReadArtboardResult> => {
	await assertLayoutDirsOwned(workspaceRoot);
	const manifest =
		artboardId === undefined
			? await readManifestFile(workspaceRoot)
			: await readManifestFileLenient(workspaceRoot);
	const resolvedId =
		artboardId === undefined
			? requireActiveManifest(manifest).activeArtboardId
			: requireArtboardIdString(artboardId);

	const html = await requireArtboardHtml(workspaceRoot, resolvedId);
	const meta = effectiveArtboardMeta({
		html,
		meta: await readStoredMeta(workspaceRoot, resolvedId),
		artboardId: resolvedId,
	});
	return {
		artboardId: resolvedId,
		title: meta.title,
		generation: meta.generation,
		hash: meta.hash,
		viewport: meta.viewport,
		html,
		updatedAt: meta.updatedAt,
		active: manifest?.activeArtboardId === resolvedId,
	};
};

type ScannedArtboard = {
	artboardId: string;
	title: string;
	active: boolean;
	generation?: number;
	html: string;
	errorMessage?: string;
	htmlReadError?: DiskError;
};

type ScannedArtboards = {
	activeArtboardId: string;
	artboards: ScannedArtboard[];
	artboardsDirMissing: boolean;
	manifest?: ArtboardManifest;
};

const listedFromScan = (scanned: ScannedArtboard): ListedArtboard => {
	const listed: ListedArtboard = {
		artboardId: scanned.artboardId,
		title: scanned.title,
		active: scanned.active,
	};
	if (scanned.generation !== undefined) {
		listed.generation = scanned.generation;
	}
	return listed;
};

const pushUnreadableMeta = ({
	artboards,
	candidateId,
	activeArtboardId,
	html,
	errorMessage,
	htmlReadError,
}: {
	artboards: ScannedArtboard[];
	candidateId: string;
	activeArtboardId: string;
	html: string;
	errorMessage?: string;
	htmlReadError?: DiskError;
}): void => {
	const entry: ScannedArtboard = {
		artboardId: candidateId,
		title: '',
		active: candidateId === activeArtboardId,
		html,
	};
	if (errorMessage !== undefined) {
		entry.errorMessage = errorMessage;
	}
	if (htmlReadError !== undefined) {
		entry.htmlReadError = htmlReadError;
	}
	artboards.push(entry);
};

// Shared artboard scan for list_artboards (strict HTML) and the panel canvas view (tolerant HTML).
const scanArtboardFiles = async ({
	workspaceRoot,
	tolerateHtmlDiskError,
}: {
	workspaceRoot: string;
	tolerateHtmlDiskError: boolean;
}): Promise<ScannedArtboards> => {
	await assertLayoutDirsOwned(workspaceRoot);
	const artboardsDirectory = workspaceJoin(workspaceRoot, artboardsDirSegments);
	if ((await layoutEntryKind(artboardsDirectory)) === 'missing') {
		return { activeArtboardId: '', artboards: [], artboardsDirMissing: true };
	}

	let fileNames: string[];
	try {
		fileNames = await readdir(artboardsDirectory, { encoding: 'utf8' });
	} catch (error: unknown) {
		return throwDiskError(error);
	}

	const manifest = await readManifestFile(workspaceRoot);
	const activeArtboardId = manifest?.activeArtboardId ?? '';
	const artboards: ScannedArtboard[] = [];
	for (const fileName of fileNames) {
		if (!fileName.endsWith('.html')) {
			continue;
		}
		const candidateId = fileName.slice(0, -'.html'.length);
		try {
			parseArtboardId(candidateId);
		} catch (error: unknown) {
			if (error instanceof InvalidArtboardIdError) {
				continue;
			}
			throw error;
		}

		const htmlLayout = workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(candidateId));
		if ((await layoutEntryKind(htmlLayout.filePath)) !== 'file') {
			continue;
		}

		let html: string | undefined;
		let htmlErrorMessage: string | undefined;
		let htmlReadError: DiskError | undefined;
		try {
			html = await readUtf8IfExists(htmlLayout);
		} catch (error: unknown) {
			if (tolerateHtmlDiskError && error instanceof DiskError) {
				html = '';
				htmlErrorMessage = FRAME_READ_ERROR_MESSAGE;
				htmlReadError = error;
			} else {
				throw error;
			}
		}
		if (html === undefined) {
			continue;
		}

		let storedMeta: ArtboardMeta | undefined;
		try {
			storedMeta = await readStoredMeta(workspaceRoot, candidateId);
		} catch (error: unknown) {
			if (error instanceof DiskError || error instanceof CorruptMetaError) {
				// ponytail: list is scan-tolerant; symlink / foreign-id meta omits generation
				// instead of failing the whole list (read_artboard still errors on those ids).
				pushUnreadableMeta({
					artboards,
					candidateId,
					activeArtboardId,
					html,
					errorMessage: htmlErrorMessage,
					htmlReadError,
				});
				continue;
			}
			throw error;
		}

		if (htmlErrorMessage !== undefined) {
			const entry: ScannedArtboard = {
				artboardId: candidateId,
				title: storedMeta?.title ?? '',
				active: candidateId === activeArtboardId,
				html,
				errorMessage: htmlErrorMessage,
			};
			if (storedMeta !== undefined) {
				entry.generation = storedMeta.generation;
			}
			if (htmlReadError !== undefined) {
				entry.htmlReadError = htmlReadError;
			}
			artboards.push(entry);
			continue;
		}

		const effective = effectiveArtboardMeta({
			html,
			meta: storedMeta,
			artboardId: candidateId,
		});
		artboards.push({
			artboardId: candidateId,
			title: effective.title,
			active: candidateId === activeArtboardId,
			generation: effective.generation,
			html,
		});
	}
	artboards.sort((left, right) => left.artboardId.localeCompare(right.artboardId));
	const scanned: ScannedArtboards = { activeArtboardId, artboards, artboardsDirMissing: false };
	if (manifest !== undefined) {
		scanned.manifest = manifest;
	}
	return scanned;
};

const resolveLayoutOrEmpty = async (
	workspaceRoot: string,
): Promise<{ stored: CanvasFrame[]; layoutErrorMessage?: string }> => {
	try {
		return { stored: (await readCanvasLayoutFile(workspaceRoot)).frames };
	} catch (error: unknown) {
		if (error instanceof CorruptCanvasError || error instanceof UnsupportedCanvasVersionError) {
			return { stored: [], layoutErrorMessage: error.message };
		}
		throw error;
	}
};

// Lists artboard ids plus resolved stage frames (stored canvas.json entries, then auto-placed). Read-only.
export const listArtboards = async ({
	workspaceRoot,
}: ListArtboardsArgs): Promise<ListArtboardsResult> => {
	const scanned = await scanArtboardFiles({ workspaceRoot, tolerateHtmlDiskError: false });
	const artboards = scanned.artboards.map(listedFromScan);
	if (scanned.artboardsDirMissing) {
		return { activeArtboardId: '', artboards: [], frames: [] };
	}
	const layout = await readCanvasLayoutFile(workspaceRoot);
	const frames = resolveCanvasFrames({
		stored: layout.frames,
		artboards: artboards.map(({ artboardId, title }) => ({ artboardId, title })),
	});
	return { activeArtboardId: scanned.activeArtboardId, artboards, frames };
};

// Panel canvas snapshot: same resolved frames as list_artboards, plus each artboard's HTML. Never writes.
export const readCanvasView = async ({
	workspaceRoot,
}: ReadCanvasViewArgs): Promise<CanvasView> => {
	const scanned = await scanArtboardFiles({ workspaceRoot, tolerateHtmlDiskError: true });
	if (scanned.artboardsDirMissing) {
		return { activeArtboardId: '', frames: [] };
	}
	const { stored, layoutErrorMessage } = await resolveLayoutOrEmpty(workspaceRoot);
	const byId = new Map(scanned.artboards.map((entry) => [entry.artboardId, entry]));
	const htmlReadErrors: CanvasViewHtmlReadError[] = [];
	const frames = resolveCanvasFrames({
		stored,
		artboards: scanned.artboards.map(({ artboardId, title }) => ({ artboardId, title })),
	}).map((frame) => {
		const scannedFrame = byId.get(frame.id);
		const viewFrame: CanvasViewFrame = {
			...frame,
			generation: scannedFrame?.generation ?? 0,
			html: scannedFrame?.html ?? '',
		};
		if (scannedFrame?.errorMessage !== undefined) {
			viewFrame.errorMessage = scannedFrame.errorMessage;
		}
		if (scannedFrame?.htmlReadError !== undefined) {
			htmlReadErrors.push({ artboardId: frame.id, error: scannedFrame.htmlReadError });
		}
		return viewFrame;
	});
	const view: CanvasView = { activeArtboardId: scanned.activeArtboardId, frames };
	if (layoutErrorMessage !== undefined) {
		view.layoutErrorMessage = layoutErrorMessage;
	}
	if (htmlReadErrors.length > 0) {
		view.htmlReadErrors = htmlReadErrors;
	}
	return view;
};

const requireOptionalFiniteNumber = (value: unknown, fieldName: string): number | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new InvalidArgsError(`${fieldName} must be a finite number. Fix args and retry.`);
	}
	return value;
};

// Backs the place_frame MCP tool: validate args, require the artboard, then write only this frame's entry to canvas.json.
export const placeFrame = async ({
	workspaceRoot,
	id,
	x,
	y,
	width,
	label,
	group,
	base,
}: PlaceFrameArgs): Promise<PlaceFrameResult> => {
	const resolvedId = parseArtboardId(id);
	const placement = {
		x: requireOptionalFiniteNumber(x, 'x'),
		y: requireOptionalFiniteNumber(y, 'y'),
		width: requireOptionalFiniteNumber(width, 'width'),
		label: requireOptionalString(label, 'label'),
		group: requireOptionalString(group, 'group'),
	};

	await assertLayoutDirsOwned(workspaceRoot);
	await requireHtmlFile(
		workspaceJoin(workspaceRoot, artboardHtmlPathSegments(resolvedId)),
		resolvedId,
	);
	await requireExactHtmlFileName(workspaceRoot, resolvedId);
	const listed = await listArtboards({ workspaceRoot });
	if (!listed.artboards.some(({ artboardId }) => artboardId === resolvedId)) {
		throw new ArtboardNotFoundError(resolvedId);
	}

	// Only the canvas.json read-modify-write runs under the lock, so the hold stays tiny.
	const next = await withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const stored = await readCanvasLayoutFile(workspaceRoot);
			const current = resolveCanvasFrames({
				stored: stored.frames,
				artboards: listed.artboards,
			}).find((frame) => frame.id === resolvedId);
			if (current === undefined) {
				throw new ArtboardNotFoundError(resolvedId);
			}
			if (
				base !== undefined &&
				(base.x !== current.x || base.y !== current.y || base.width !== current.width)
			) {
				throw new FrameMovedError(resolvedId);
			}
			const placed = placeCanvasFrame({ layout: stored, current, placement });
			await writeUtf8({
				...workspaceLayoutFile(workspaceRoot, canvasPathSegments),
				contents: serializeCanvasLayout(placed),
			});
			return placed;
		},
	});
	return {
		frames: resolveCanvasFrames({ stored: next.frames, artboards: listed.artboards }),
	};
};

export const setActiveArtboard = async ({
	workspaceRoot,
	artboardId,
}: SetActiveArtboardArgs): Promise<{ activeArtboardId: string }> => {
	const resolvedId = requireArtboardIdString(artboardId);
	await assertLayoutDirsOwned(workspaceRoot);
	await requireHtmlFile(
		workspaceJoin(workspaceRoot, artboardHtmlPathSegments(resolvedId)),
		resolvedId,
	);
	await requireExactHtmlFileName(workspaceRoot, resolvedId);
	let existing: ArtboardManifest | undefined;
	try {
		existing = await readManifestFile(workspaceRoot);
	} catch (error: unknown) {
		// ponytail: corrupt manifest is overwritten on set_active; Agent can restore from git
		if (!(error instanceof CorruptManifestError)) {
			throw error;
		}
	}
	await writeManifestActive({ workspaceRoot, artboardId: resolvedId, existing });
	return { activeArtboardId: resolvedId };
};

const readTokensJsonForExport = async (workspaceRoot: string): Promise<string | undefined> => {
	const tokensPath = workspaceJoin(workspaceRoot, workspaceTokensPathSegments);
	const entryKind = await layoutEntryKind(tokensPath);
	if (entryKind === 'missing') {
		return undefined;
	}
	if (entryKind !== 'file') {
		throw new DiskError(regularFileRequiredMessage(workspaceTokensPathSegments.join('/')));
	}
	try {
		return await readFile(tokensPath, 'utf8');
	} catch (error: unknown) {
		return throwDiskError(error);
	}
};

type HandoffLeafFile = {
	segments: readonly string[];
	contents: string;
};

// Creates handoff/<exportId>/ (never reused) and writes files in order, creating subfolders as needed.
const writeHandoffLeaf = async ({
	workspaceRoot,
	exportId,
	files,
}: {
	workspaceRoot: string;
	exportId: string;
	files: readonly HandoffLeafFile[];
}): Promise<void> => {
	await ensureDir(workspaceJoin(workspaceRoot, handoffRootSegments));

	const leafSegments = handoffDirSegments(exportId);
	try {
		await mkdir(workspaceJoin(workspaceRoot, leafSegments), { recursive: false });
	} catch (error: unknown) {
		if (isErrno(error, 'EEXIST')) {
			throw new DiskError('Handoff folder already exists. Retry export_artboard.');
		}
		throwDiskError(error);
	}

	for (const { segments, contents } of files) {
		if (segments.length > 1) {
			await ensureDir(workspaceJoin(workspaceRoot, [...leafSegments, ...segments.slice(0, -1)]));
		}
		await writeUtf8({
			...workspaceLayoutFile(workspaceRoot, [...leafSegments, ...segments]),
			contents,
		});
	}
	// ponytail: no journal / rollback; orphan dirs are harmless and never deleted
};

const writeManifestLastExport = async ({
	workspaceRoot,
	existing,
	artboardId,
	lastExport,
}: {
	workspaceRoot: string;
	existing: ArtboardManifest | undefined;
	artboardId: string;
	lastExport: LastExport;
}): Promise<void> => {
	const manifest: ArtboardManifest = {
		version: SCHEMA_VERSION,
		activeArtboardId: existing?.activeArtboardId || artboardId,
		workspaceFolder: existing?.workspaceFolder ?? workspaceRoot,
		updatedAt: lastExport.exportedAt,
		lastExport,
	};
	await writeUtf8({
		...workspaceLayoutFile(workspaceRoot, manifestPathSegments),
		contents: serializeManifest(manifest),
	});
};

// `.` and `..` pass the artboard-id charset but cannot be a handoff folder name.
const requireExportableFolderId = (artboardId: string): void => {
	if (artboardId === '.' || artboardId === '..') {
		throw new DiskError(
			`Artboard id "${artboardId}" cannot be exported as a folder. Rename ${artboardHtmlPathSegments(artboardId).join('/')}.`,
		);
	}
};

type ExportPlanFrame = CanvasFrame & {
	folder: string;
	html: string;
	storedMeta: ArtboardMeta | undefined;
	effective: ArtboardMeta;
};

// Exports every resolved canvas frame. All reads (and every read error) happen before the
// leaf mkdir; the scan's HTML string is the only source for index.html, hashes, and meta.
export const exportArtboard = async ({
	workspaceRoot,
	now,
}: ExportArtboardArgs): Promise<ExportArtboardResult> => {
	const exportNow = now ?? new Date();
	await assertLayoutDirsOwned(workspaceRoot);
	const scanned = await scanArtboardFiles({ workspaceRoot, tolerateHtmlDiskError: false });
	const layout = await readCanvasLayoutFile(workspaceRoot);
	const htmlById = new Map(scanned.artboards.map(({ artboardId, html }) => [artboardId, html]));
	const resolved = resolveCanvasFrames({
		stored: layout.frames,
		artboards: scanned.artboards.map(({ artboardId, title }) => ({ artboardId, title })),
	});
	if (resolved.length === 0) {
		throw new NoArtboardsToExportError();
	}
	for (const frame of resolved) {
		requireExportableFolderId(frame.id);
	}

	const folders = assignGroupFolders(resolved);
	const planned: ExportPlanFrame[] = [];
	for (const frame of resolved) {
		const html = htmlById.get(frame.id) ?? '';
		const storedMeta = await readStoredMeta(workspaceRoot, frame.id, { rejectUnparsable: true });
		planned.push({
			...frame,
			folder: folders.get(frame.id) ?? UNGROUPED_FOLDER,
			html,
			storedMeta,
			effective: effectiveArtboardMeta({ html, meta: storedMeta, artboardId: frame.id }),
		});
	}
	const tokensJson = (await readTokensJsonForExport(workspaceRoot)) ?? STUB_TOKENS_JSON;

	const exportId = makeCanvasExportId({ now: exportNow });
	const exportedAt = exportNow.toISOString();
	const exportedFrames: ExportedFrameResult[] = planned.map(({ id, folder, effective }) => ({
		artboardId: id,
		artboardHash: effective.hash,
		path: `${folder}/${id}/${HANDOFF_INDEX_FILE}`,
	}));
	const activeArtboardId = scanned.manifest?.activeArtboardId ?? '';
	const legacyFrame =
		exportedFrames.find(({ artboardId }) => artboardId === activeArtboardId) ?? exportedFrames[0];
	if (legacyFrame === undefined) {
		throw new NoArtboardsToExportError();
	}
	const lastExport: LastExport = {
		exportId,
		artboardId: legacyFrame.artboardId,
		artboardHash: legacyFrame.artboardHash,
		exportedAt,
		frames: exportedFrames.map(({ artboardId, artboardHash }) => ({ artboardId, artboardHash })),
	};
	const implementMd = buildCanvasImplementMarkdown({
		exportId,
		exportedAt,
		frames: planned.map(({ id, label, width, group, folder, effective }) => {
			const implementFrame = { id, label, width, folder, artboardHash: effective.hash };
			return group === undefined ? implementFrame : { ...implementFrame, group };
		}),
	});
	const canvasHtml = buildCanvasPreviewHtml({ exportId, frames: planned });

	await writeHandoffLeaf({
		workspaceRoot,
		exportId,
		files: [
			{ segments: [IMPLEMENT_FILE], contents: implementMd },
			{ segments: [CANVAS_PREVIEW_FILE], contents: canvasHtml },
			{ segments: [TOKENS_FILE], contents: tokensJson },
			...planned.map(({ id, folder, html }) => ({
				segments: [folder, id, HANDOFF_INDEX_FILE],
				contents: html,
			})),
		],
	});
	for (const { id, storedMeta, effective } of planned) {
		if (storedMeta === undefined || normalizeHash(storedMeta.hash) !== effective.hash) {
			await writeUtf8({
				...workspaceLayoutFile(workspaceRoot, artboardMetaPathSegments(id)),
				contents: serializeMeta({ ...effective, updatedAt: exportedAt }),
			});
		}
	}
	await writeManifestLastExport({
		workspaceRoot,
		existing: scanned.manifest,
		artboardId: legacyFrame.artboardId,
		lastExport,
	});

	return {
		exportId,
		exportedAt,
		handoffPath: handoffDirSegments(exportId).join('/'),
		frames: exportedFrames,
	};
};

export const readHandoffStatus = async ({
	workspaceRoot,
}: {
	workspaceRoot: string;
}): Promise<HandoffStatusResult> => {
	await assertLayoutDirsOwned(workspaceRoot);
	const manifest = requireActiveManifest(await readManifestFile(workspaceRoot));
	const activeArtboardId = manifest.activeArtboardId;
	const activeHtml = await requireArtboardHtml(workspaceRoot, activeArtboardId);
	const activeMeta = effectiveArtboardMeta({
		html: activeHtml,
		meta: await readStoredMeta(workspaceRoot, activeArtboardId),
		artboardId: activeArtboardId,
	});

	// Never exported stays stale. Layout never affects staleness, so canvas.json is not read.
	let stale = true;
	if (manifest.lastExport !== undefined) {
		const scanned = await scanArtboardFiles({ workspaceRoot, tolerateHtmlDiskError: true });
		stale = compareCanvasHandoff({
			lastExport: manifest.lastExport,
			frames: scanned.artboards.map(({ artboardId, html, errorMessage }) => ({
				artboardId,
				hash: errorMessage === undefined ? hashHtml(html) : undefined,
			})),
		}).stale;
	}

	const status: HandoffStatusResult = {
		stale,
		activeArtboardId,
		activeHash: activeMeta.hash,
	};
	if (manifest.lastExport !== undefined) {
		status.lastExport = manifest.lastExport;
	}
	return status;
};
