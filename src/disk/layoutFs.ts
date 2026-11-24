import { type Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type CanvasLayout, parseCanvasLayout } from './canvasLayout';
import {
	ArtboardNotFoundError,
	CorruptCanvasError,
	CorruptManifestError,
	CorruptMetaError,
	CorruptProjectError,
	DiskError,
	InvalidArtboardIdError,
	isErrno,
	throwDiskError,
} from './errors';
import {
	CANVAS_SCHEMA_VERSION,
	VIBEBOARD_DIR,
	artboardHtmlFileName,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	handoffRootSegments,
	manifestPathSegments,
	pageDirSegments,
	pagesDirSegments,
	projectPathSegments,
} from './layout';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	type Project,
	parseManifest,
	parseMeta,
	parseProject,
} from './parse';

// The page a call works on: per-page files live under it, root files use workspaceRoot.
export type PageLocation = { workspaceRoot: string; pageId: string };

export const workspaceJoin = (workspaceRoot: string, segments: readonly string[]): string =>
	join(workspaceRoot, ...segments);

export const workspaceLayoutFile = (
	workspaceRoot: string,
	segments: readonly string[],
): { filePath: string; relativePath: string } => ({
	filePath: workspaceJoin(workspaceRoot, segments),
	relativePath: segments.join('/'),
});

export const regularFileRequiredMessage = (relativePath: string): string =>
	`${relativePath} must be a regular file (symlinks rejected).`;

const directoryRequiredMessage = (relativePath: string): string =>
	`${relativePath} must be a directory (symlinks rejected).`;

type LayoutEntryKind = 'missing' | 'symlink' | 'file' | 'other';

// lstat (never stat) at every level: the id charset already blocks `..`, so rejecting
// symlinks here keeps layout I/O under {workspaceRoot}/.vibeboard/ without realpath.
// ponytail: reads check then act, so a symlink swapped in between is followed. Writes are safe:
// writeUtf8 unlinks the tmp then wx-writes (a leftover symlink tmp cannot redirect the payload),
// and rename replaces the name without following it. Upgrade path: open reads with O_NOFOLLOW and
// fstat the handle.
export const layoutEntryKind = async (filePath: string): Promise<LayoutEntryKind> => {
	const fileStats = await lstatOrUndefined(filePath);
	if (fileStats === undefined) {
		return 'missing';
	}
	if (fileStats.isSymbolicLink()) {
		return 'symlink';
	}
	return fileStats.isFile() ? 'file' : 'other';
};

export const lstatOrUndefined = async (filePath: string): Promise<Stats | undefined> => {
	try {
		return await lstat(filePath);
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return undefined;
		}
		return throwDiskError(error);
	}
};

// A missing layout folder lists nothing; any other failure throws.
export const readdirOrEmpty = async (dirPath: string): Promise<string[]> => {
	try {
		return await readdir(dirPath, { encoding: 'utf8' });
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return [];
		}
		return throwDiskError(error);
	}
};

// The one page-folder check: a real directory (a symlink or a file there is no page folder).
export const pageFolderExists = async (workspaceRoot: string, pageId: string): Promise<boolean> =>
	(await lstatOrUndefined(workspaceJoin(workspaceRoot, pageDirSegments(pageId))))?.isDirectory() ===
	true;

// A layout directory is a real directory or missing; a symlink or a file there throws.
export const assertDirOwned = async (
	workspaceRoot: string,
	segments: readonly string[],
): Promise<void> => {
	const dirStats = await lstatOrUndefined(workspaceJoin(workspaceRoot, segments));
	if (dirStats === undefined) {
		return;
	}
	if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
		throw new DiskError(directoryRequiredMessage(segments.join('/')));
	}
};

export const assertLayoutDirsOwned = async (page: PageLocation): Promise<void> => {
	// Never root artboards: there it is the 0.4 tombstone file.
	const dirLayouts: readonly (readonly string[])[] = [
		[VIBEBOARD_DIR],
		pagesDirSegments,
		pageDirSegments(page.pageId),
		artboardsDirSegments(page.pageId),
		handoffRootSegments,
	];
	for (const segments of dirLayouts) {
		await assertDirOwned(page.workspaceRoot, segments);
	}
};

export const requireHtmlFile = async (page: PageLocation, artboardId: string): Promise<void> => {
	const htmlLayout = workspaceLayoutFile(
		page.workspaceRoot,
		artboardHtmlPathSegments(page.pageId, artboardId),
	);
	const entryKind = await layoutEntryKind(htmlLayout.filePath);
	if (entryKind === 'missing') {
		throw new ArtboardNotFoundError(artboardId);
	}
	if (entryKind !== 'file') {
		throw new DiskError(regularFileRequiredMessage(htmlLayout.relativePath));
	}
};

export const requireExactHtmlFileName = async (
	page: PageLocation,
	artboardId: string,
): Promise<void> => {
	const artboardsDirectory = workspaceJoin(page.workspaceRoot, artboardsDirSegments(page.pageId));
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

export const readUtf8IfExists = async ({
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

export const writeUtf8 = async ({
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
	// ponytail: the tmp name is per pid and only this pid unlinks it, so a crash between the write
	// and the rename leaves an orphan *.tmp (the watcher and readers skip it). Upgrade path: sweep
	// stale *.tmp files on startup.
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

export const ensureDir = async (dirPath: string): Promise<void> => {
	try {
		await mkdir(dirPath, { recursive: true });
	} catch (error: unknown) {
		throwDiskError(error);
	}
};

const parseManifestText = (text: string, pageId: string): ArtboardManifest => {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptManifestError({ pageId }, { cause: error });
	}
	return parseManifest(parsedJson, pageId);
};

export const readManifestFile = async (
	page: PageLocation,
): Promise<ArtboardManifest | undefined> => {
	const text = await readUtf8IfExists(
		workspaceLayoutFile(page.workspaceRoot, manifestPathSegments(page.pageId)),
	);
	if (text === undefined) {
		return undefined;
	}
	return parseManifestText(text, page.pageId);
};

export const readManifestFileLenient = async (
	page: PageLocation,
): Promise<ArtboardManifest | undefined> => {
	try {
		return await readManifestFile(page);
	} catch (error: unknown) {
		if (error instanceof CorruptManifestError) {
			return undefined;
		}
		throw error;
	}
};

export const readProjectFile = async (workspaceRoot: string): Promise<Project | undefined> => {
	const text = await readUtf8IfExists(workspaceLayoutFile(workspaceRoot, projectPathSegments));
	if (text === undefined) {
		return undefined;
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptProjectError({ cause: error });
	}
	return parseProject(parsedJson);
};

// A missing file is an empty layout; a bad one throws and is never overwritten.
export const readCanvasLayoutFile = async (page: PageLocation): Promise<CanvasLayout> => {
	const text = await readUtf8IfExists(
		workspaceLayoutFile(page.workspaceRoot, canvasPathSegments(page.pageId)),
	);
	if (text === undefined) {
		return { version: CANVAS_SCHEMA_VERSION, frames: [] };
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptCanvasError({ pageId: page.pageId }, { cause: error });
	}
	return parseCanvasLayout(parsedJson, page.pageId);
};

const isBenignMetaParseError = (error: unknown): boolean =>
	error instanceof SyntaxError ||
	error instanceof CorruptMetaError ||
	error instanceof InvalidArtboardIdError;

const parseMetaFromJsonText = (text: string, pageId: string): ArtboardMeta =>
	parseMeta(JSON.parse(text) as unknown, pageId);

// Tolerant by default: an unparsable meta reads as missing. Export passes rejectUnparsable so a
// broken meta fails before any write instead of being silently restamped.
export const readStoredMeta = async (
	page: PageLocation,
	artboardId: string,
	{ rejectUnparsable = false }: { rejectUnparsable?: boolean } = {},
): Promise<ArtboardMeta | undefined> => {
	const text = await readUtf8IfExists(
		workspaceLayoutFile(page.workspaceRoot, artboardMetaPathSegments(page.pageId, artboardId)),
	);
	if (text === undefined) {
		return undefined;
	}
	let meta: ArtboardMeta;
	try {
		meta = parseMetaFromJsonText(text, page.pageId);
	} catch (error: unknown) {
		if (isBenignMetaParseError(error)) {
			if (rejectUnparsable) {
				throw new CorruptMetaError({ pageId: page.pageId, artboardId }, { cause: error });
			}
			return undefined;
		}
		return throwDiskError(error);
	}
	if (meta.id !== artboardId) {
		throw new CorruptMetaError({ pageId: page.pageId, artboardId });
	}
	return meta;
};

export const requireArtboardHtml = async (
	page: PageLocation,
	artboardId: string,
): Promise<string> => {
	const html = await readUtf8IfExists(
		workspaceLayoutFile(page.workspaceRoot, artboardHtmlPathSegments(page.pageId, artboardId)),
	);
	if (html === undefined) {
		throw new ArtboardNotFoundError(artboardId);
	}
	return html;
};

export const requireActiveManifest = (manifest: ArtboardManifest | undefined): ArtboardManifest => {
	if (manifest === undefined || manifest.activeArtboardId.length === 0) {
		throw new ArtboardNotFoundError('');
	}
	return manifest;
};

// TODO(1.0): remove .cursor-design migration
export const LEGACY_DESIGN_DIR = '.cursor-design';

// Moves the pre-rename design folder to VIBEBOARD_DIR; never over an existing one ('both').
export const migrateLegacyDesignDir = async (
	workspaceRoot: string,
): Promise<'moved' | 'both' | 'none'> => {
	const legacyPath = join(workspaceRoot, LEGACY_DESIGN_DIR);
	if ((await lstatOrUndefined(legacyPath)) === undefined) {
		return 'none';
	}
	const currentPath = join(workspaceRoot, VIBEBOARD_DIR);
	if ((await lstatOrUndefined(currentPath)) !== undefined) {
		return 'both';
	}
	await rename(legacyPath, currentPath);
	return 'moved';
};
