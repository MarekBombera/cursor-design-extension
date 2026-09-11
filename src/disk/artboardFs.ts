import { type Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { conflictFields } from './conflict';
import {
	ArtboardExistsError,
	ArtboardNotFoundError,
	ConflictError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	InvalidArgsError,
	InvalidArtboardIdError,
	UnsupportedSchemaVersionError,
} from './errors';
import { nextGeneration } from './generation';
import { hashHtml, isArtboardHash, normalizeHash } from './hash';
import {
	CURSOR_DESIGN_DIR,
	DEFAULT_ARTBOARD_TITLE,
	DEFAULT_VIEWPORT,
	SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	ensurePanelPathSegments,
	manifestPathSegments,
} from './layout';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	parseArtboardId,
	parseManifest,
	parseMeta,
	serializeManifest,
	serializeMeta,
} from './parse';

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
};

export type SetActiveArtboardArgs = {
	workspaceRoot: string;
	artboardId: unknown;
};

const isErrno = (error: unknown, code: string): boolean =>
	typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code;

const isExpectedError = (error: unknown): boolean =>
	error instanceof ArtboardExistsError ||
	error instanceof ArtboardNotFoundError ||
	error instanceof ConflictError ||
	error instanceof CorruptManifestError ||
	error instanceof CorruptMetaError ||
	error instanceof DiskError ||
	error instanceof InvalidArgsError ||
	error instanceof InvalidArtboardIdError ||
	error instanceof UnsupportedSchemaVersionError;

const throwDiskError = (error: unknown): never => {
	if (isExpectedError(error)) {
		throw error;
	}
	throw new DiskError({ cause: error });
};

const workspaceJoin = (workspaceRoot: string, segments: readonly string[]): string =>
	join(workspaceRoot, ...segments);

type LayoutEntryKind = 'missing' | 'symlink' | 'file' | 'other';

const layoutEntryKind = async (filePath: string): Promise<LayoutEntryKind> => {
	try {
		const fileStats = await lstat(filePath);
		if (fileStats.isSymbolicLink()) {
			return 'symlink';
		}
		return fileStats.isFile() ? 'file' : 'other';
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return 'missing';
		}
		return throwDiskError(error);
	}
};

// lstat (never stat) at every level: the id charset already blocks `..`, so rejecting
// symlinks here keeps layout I/O under {workspaceRoot}/.cursor-design/ without realpath.
// ponytail: check-then-act, no fd holding; a swap between lstat and read/write still wins.
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
	const dirPaths = [
		join(workspaceRoot, CURSOR_DESIGN_DIR),
		workspaceJoin(workspaceRoot, artboardsDirSegments),
	];
	for (const dirPath of dirPaths) {
		const dirStats = await lstatOrUndefined(dirPath);
		if (dirStats === undefined) {
			continue;
		}
		if (dirStats.isSymbolicLink() || !dirStats.isDirectory()) {
			throw new DiskError();
		}
	}
};

const requireHtmlFile = async (htmlFilePath: string, artboardId: string): Promise<void> => {
	const entryKind = await layoutEntryKind(htmlFilePath);
	if (entryKind === 'missing') {
		throw new ArtboardNotFoundError(artboardId);
	}
	if (entryKind !== 'file') {
		throw new DiskError();
	}
};

const readUtf8IfExists = async (filePath: string): Promise<string | undefined> => {
	const entryKind = await layoutEntryKind(filePath);
	if (entryKind === 'missing') {
		return undefined;
	}
	if (entryKind !== 'file') {
		throw new DiskError();
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

const writeUtf8 = async (filePath: string, contents: string): Promise<void> => {
	const entryKind = await layoutEntryKind(filePath);
	if (entryKind === 'symlink' || entryKind === 'other') {
		throw new DiskError();
	}
	try {
		await writeFile(filePath, contents, 'utf8');
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
	try {
		return parseManifest(parsedJson);
	} catch (error: unknown) {
		if (error instanceof InvalidArtboardIdError) {
			throw new CorruptManifestError({ cause: error });
		}
		throw error;
	}
};

const readManifestFile = async (workspaceRoot: string): Promise<ArtboardManifest | undefined> => {
	const text = await readUtf8IfExists(workspaceJoin(workspaceRoot, manifestPathSegments));
	if (text === undefined) {
		return undefined;
	}
	return parseManifestText(text);
};

const parseManifestTextLenient = (text: string): ArtboardManifest | undefined => {
	try {
		return parseManifestText(text);
	} catch (error: unknown) {
		if (error instanceof CorruptManifestError || error instanceof UnsupportedSchemaVersionError) {
			return undefined;
		}
		throw error;
	}
};

const readManifestFileLenient = async (
	workspaceRoot: string,
): Promise<ArtboardManifest | undefined> => {
	try {
		return await readManifestFile(workspaceRoot);
	} catch (error: unknown) {
		if (error instanceof CorruptManifestError || error instanceof UnsupportedSchemaVersionError) {
			return undefined;
		}
		throw error;
	}
};

const isBenignMetaParseError = (error: unknown): boolean =>
	error instanceof SyntaxError ||
	error instanceof CorruptMetaError ||
	error instanceof InvalidArtboardIdError;

const parseMetaFromJsonText = (text: string): ArtboardMeta => parseMeta(JSON.parse(text) as unknown);

const readMetaForHtml = async (workspaceRoot: string, artboardId: string): Promise<ArtboardMeta> => {
	const text = await readUtf8IfExists(workspaceJoin(workspaceRoot, artboardMetaPathSegments(artboardId)));
	if (text === undefined) {
		throw new CorruptMetaError(artboardId);
	}
	try {
		const meta = parseMetaFromJsonText(text);
		if (meta.id !== artboardId) {
			throw new CorruptMetaError(artboardId);
		}
		return meta;
	} catch (error: unknown) {
		if (isBenignMetaParseError(error)) {
			throw new CorruptMetaError(artboardId, { cause: error });
		}
		return throwDiskError(error);
	}
};

const requireHtmlString = (html: unknown): string => {
	if (typeof html !== 'string') {
		throw new InvalidArgsError('html must be a string. Fix args and retry.');
	}
	return html;
};

const requireArtboardIdString = (artboardId: unknown): string => {
	if (typeof artboardId !== 'string') {
		throw new InvalidArgsError('artboardId is required. Fix args and retry.');
	}
	return parseArtboardId(artboardId);
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
	await writeUtf8(workspaceJoin(workspaceRoot, manifestPathSegments), serializeManifest(manifest));
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
	if (title !== undefined && typeof title !== 'string') {
		throw new InvalidArgsError('title must be a string. Fix args and retry.');
	}
	if (viewport !== undefined && typeof viewport !== 'string') {
		throw new InvalidArgsError('viewport must be a string. Fix args and retry.');
	}

	await assertLayoutDirsOwned(workspaceRoot);
	const htmlFilePath = workspaceJoin(workspaceRoot, artboardHtmlPathSegments(resolvedId));
	const metaFilePath = workspaceJoin(workspaceRoot, artboardMetaPathSegments(resolvedId));
	const manifestFilePath = workspaceJoin(workspaceRoot, manifestPathSegments);
	const existingManifestText = await readUtf8IfExists(manifestFilePath);
	const existingManifest =
		existingManifestText === undefined ? undefined : parseManifestTextLenient(existingManifestText);

	try {
		await mkdir(workspaceJoin(workspaceRoot, artboardsDirSegments), { recursive: true });
	} catch (error: unknown) {
		throwDiskError(error);
	}

	const existingHtmlKind = await layoutEntryKind(htmlFilePath);
	if (existingHtmlKind === 'file') {
		throw new ArtboardExistsError(resolvedId);
	}
	if (existingHtmlKind !== 'missing') {
		throw new DiskError();
	}
	try {
		await writeFile(htmlFilePath, resolvedHtml, { encoding: 'utf8', flag: 'wx' });
	} catch (error: unknown) {
		if (isErrno(error, 'EEXIST')) {
			throw new ArtboardExistsError(resolvedId);
		}
		throwDiskError(error);
	}

	const resolvedTitle = title ?? DEFAULT_ARTBOARD_TITLE;
	const resolvedViewport = viewport ?? DEFAULT_VIEWPORT;
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
	await writeUtf8(metaFilePath, serializeMeta(meta));
	await writeManifestActive({ workspaceRoot, artboardId: resolvedId, existing: existingManifest });

	let panelEnsured = false;
	if (writeEnsurePanelMarker) {
		await writeUtf8(workspaceJoin(workspaceRoot, ensurePanelPathSegments), '');
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
		throw new InvalidArgsError('update_artboard requires baseGeneration and/or baseHash. Fix args and retry.');
	}
	if (
		baseGeneration !== undefined &&
		(typeof baseGeneration !== 'number' || !Number.isInteger(baseGeneration) || baseGeneration < 1)
	) {
		throw new InvalidArgsError('baseGeneration must be an integer >= 1. Fix args and retry.');
	}
	if (baseHash !== undefined && (typeof baseHash !== 'string' || !isArtboardHash(baseHash))) {
		throw new InvalidArgsError('baseHash must be sha256: plus 64 hex characters. Fix args and retry.');
	}
	if (title !== undefined && typeof title !== 'string') {
		throw new InvalidArgsError('title must be a string. Fix args and retry.');
	}
	if (viewport !== undefined && typeof viewport !== 'string') {
		throw new InvalidArgsError('viewport must be a string. Fix args and retry.');
	}

	await assertLayoutDirsOwned(workspaceRoot);
	const htmlFilePath = workspaceJoin(workspaceRoot, artboardHtmlPathSegments(resolvedId));
	await requireHtmlFile(htmlFilePath, resolvedId);

	const currentMeta = await readMetaForHtml(workspaceRoot, resolvedId);
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
		title: title ?? currentMeta.title,
		generation:
			htmlHash === normalizeHash(currentMeta.hash) ? currentMeta.generation : nextGeneration(currentMeta.generation),
		hash: htmlHash,
		viewport: viewport ?? currentMeta.viewport,
		updatedAt: new Date().toISOString(),
	};
	await writeUtf8(htmlFilePath, resolvedHtml);
	await writeUtf8(workspaceJoin(workspaceRoot, artboardMetaPathSegments(resolvedId)), serializeMeta(nextMeta));
	return {
		artboardId: resolvedId,
		generation: nextMeta.generation,
		hash: nextMeta.hash,
		title: nextMeta.title,
		viewport: nextMeta.viewport,
	};
};

export const readArtboard = async ({ workspaceRoot, artboardId }: ReadArtboardArgs): Promise<ReadArtboardResult> => {
	await assertLayoutDirsOwned(workspaceRoot);
	const manifest =
		artboardId === undefined
			? await readManifestFile(workspaceRoot)
			: await readManifestFileLenient(workspaceRoot);
	let resolvedId: string;
	if (artboardId === undefined) {
		const activeId = manifest?.activeArtboardId;
		if (activeId === undefined || activeId.length === 0) {
			throw new ArtboardNotFoundError('');
		}
		resolvedId = activeId;
	} else if (typeof artboardId !== 'string') {
		throw new InvalidArgsError('artboardId must be a string. Fix args and retry.');
	} else {
		resolvedId = parseArtboardId(artboardId);
	}

	const html = await readUtf8IfExists(workspaceJoin(workspaceRoot, artboardHtmlPathSegments(resolvedId)));
	if (html === undefined) {
		throw new ArtboardNotFoundError(resolvedId);
	}
	const meta = await readMetaForHtml(workspaceRoot, resolvedId);
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

export const listArtboards = async ({ workspaceRoot }: ListArtboardsArgs): Promise<ListArtboardsResult> => {
	await assertLayoutDirsOwned(workspaceRoot);
	const artboardsDirectory = workspaceJoin(workspaceRoot, artboardsDirSegments);
	if ((await layoutEntryKind(artboardsDirectory)) === 'missing') {
		return { activeArtboardId: '', artboards: [] };
	}

	let fileNames: string[];
	try {
		fileNames = await readdir(artboardsDirectory, { encoding: 'utf8' });
	} catch (error: unknown) {
		return throwDiskError(error);
	}

	const manifest = await readManifestFile(workspaceRoot);
	const activeArtboardId = manifest?.activeArtboardId ?? '';
	const artboards: ListedArtboard[] = [];
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

		if (
			(await layoutEntryKind(workspaceJoin(workspaceRoot, artboardHtmlPathSegments(candidateId)))) !== 'file'
		) {
			continue;
		}
		const listed: ListedArtboard = {
			artboardId: candidateId,
			title: '',
			active: candidateId === activeArtboardId,
		};
		const metaText = await readUtf8IfExists(workspaceJoin(workspaceRoot, artboardMetaPathSegments(candidateId)));
		if (metaText !== undefined) {
			try {
				const meta = parseMetaFromJsonText(metaText);
				if (meta.id === candidateId) {
					listed.title = meta.title;
					listed.generation = meta.generation;
				}
			} catch (error: unknown) {
				if (!isBenignMetaParseError(error)) {
					throwDiskError(error);
				}
			}
		}
		artboards.push(listed);
	}
	artboards.sort((left, right) => left.artboardId.localeCompare(right.artboardId));
	return { activeArtboardId, artboards };
};

export const setActiveArtboard = async ({
	workspaceRoot,
	artboardId,
}: SetActiveArtboardArgs): Promise<{ activeArtboardId: string }> => {
	const resolvedId = requireArtboardIdString(artboardId);
	await assertLayoutDirsOwned(workspaceRoot);
	await requireHtmlFile(workspaceJoin(workspaceRoot, artboardHtmlPathSegments(resolvedId)), resolvedId);
	const existing = await readManifestFile(workspaceRoot);
	await writeManifestActive({ workspaceRoot, artboardId: resolvedId, existing });
	return { activeArtboardId: resolvedId };
};
