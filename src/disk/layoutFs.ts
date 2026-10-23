import { type Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type CanvasLayout, parseCanvasLayout } from './canvasLayout';
import {
	ArtboardNotFoundError,
	CorruptCanvasError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	InvalidArtboardIdError,
	isErrno,
	throwDiskError,
} from './errors';
import {
	CANVAS_SCHEMA_VERSION,
	CURSOR_DESIGN_DIR,
	artboardHtmlFileName,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	handoffRootSegments,
	manifestPathSegments,
} from './layout';
import { type ArtboardManifest, type ArtboardMeta, parseManifest, parseMeta } from './parse';

// Layout-safe fs primitives and the manifest / meta / canvas.json reads every disk job shares.

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
// symlinks here keeps layout I/O under {workspaceRoot}/.cursor-design/ without realpath.
// ponytail: reads still check-then-act; writeUtf8 unlinks tmp then wx-writes so a leftover
// symlink tmp cannot redirect the payload; rename replaces the dest name (does not follow it).
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

export const assertLayoutDirsOwned = async (workspaceRoot: string): Promise<void> => {
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

export const requireHtmlFile = async (htmlFilePath: string, artboardId: string): Promise<void> => {
	const entryKind = await layoutEntryKind(htmlFilePath);
	if (entryKind === 'missing') {
		throw new ArtboardNotFoundError(artboardId);
	}
	if (entryKind !== 'file') {
		throw new DiskError(regularFileRequiredMessage(artboardHtmlPathSegments(artboardId).join('/')));
	}
};

export const requireExactHtmlFileName = async (
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

const parseManifestText = (text: string): ArtboardManifest => {
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(text) as unknown;
	} catch (error: unknown) {
		throw new CorruptManifestError({ cause: error });
	}
	return parseManifest(parsedJson);
};

export const readManifestFile = async (
	workspaceRoot: string,
): Promise<ArtboardManifest | undefined> => {
	const text = await readUtf8IfExists(workspaceLayoutFile(workspaceRoot, manifestPathSegments));
	if (text === undefined) {
		return undefined;
	}
	return parseManifestText(text);
};

export const readManifestFileLenient = async (
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
export const readCanvasLayoutFile = async (workspaceRoot: string): Promise<CanvasLayout> => {
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
export const readStoredMeta = async (
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

export const requireArtboardHtml = async (
	workspaceRoot: string,
	artboardId: string,
): Promise<string> => {
	const html = await readUtf8IfExists(
		workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(artboardId)),
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
