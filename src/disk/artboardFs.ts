import { mkdir, writeFile } from 'node:fs/promises';

import {
	type CanvasFrame,
	placeCanvasFrame,
	resolveCanvasFrames,
	serializeCanvasLayout,
} from './canvasLayout';
import { listArtboards } from './canvasView';
import { conflictFields } from './conflict';
import { effectiveArtboardMeta } from './effectiveMeta';
import {
	ArtboardExistsError,
	ArtboardNotFoundError,
	ConflictError,
	CorruptManifestError,
	DiskError,
	FrameMovedError,
	InvalidArgsError,
	PageNotFoundError,
	isErrno,
	throwDiskError,
} from './errors';
import { hashHtml, isArtboardHash, normalizeHash } from './hash';
import {
	DEFAULT_ARTBOARD_TITLE,
	DEFAULT_VIEWPORT,
	SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	ensurePanelPathSegments,
	manifestPathSegments,
} from './layout';
import {
	type PageLocation,
	assertLayoutDirsOwned,
	layoutEntryKind,
	readCanvasLayoutFile,
	readManifestFile,
	readManifestFileLenient,
	readStoredMeta,
	readUtf8IfExists,
	regularFileRequiredMessage,
	requireActiveManifest,
	requireArtboardHtml,
	requireExactHtmlFileName,
	requireHtmlFile,
	workspaceJoin,
	workspaceLayoutFile,
	writeUtf8,
} from './layoutFs';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	parseArtboardId,
	serializeManifest,
	serializeMeta,
} from './parse';
import { withWorkspaceLock } from './workspaceLock';

export type CreateArtboardArgs = {
	page: PageLocation;
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
	page: PageLocation;
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
	page: PageLocation;
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

export type PlaceFrameArgs = {
	page: PageLocation;
	id: unknown;
	x?: unknown;
	y?: unknown;
	width?: unknown;
	label?: unknown;
	group?: unknown;
	// Panel drag only: the frame's x/y/width when the gesture started; MCP never passes it.
	base?: Pick<CanvasFrame, 'x' | 'y' | 'width'>;
};

export type PlaceFrameResult = {
	frames: CanvasFrame[];
};

export type SetActiveArtboardArgs = {
	page: PageLocation;
	artboardId: unknown;
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

// set_artboard's arg checks, run by createArtboard and by the handler before it resolves the page,
// so invalid args on a fresh root create nothing.
export const validateNewArtboardArgs = ({
	artboardId,
	html,
	title,
	viewport,
}: {
	artboardId: unknown;
	html: unknown;
	title?: unknown;
	viewport?: unknown;
}): {
	artboardId: string;
	html: string;
	title: string | undefined;
	viewport: string | undefined;
} => ({
	artboardId: requireArtboardIdString(artboardId),
	html: requireHtmlString(html),
	title: requireOptionalString(title, 'title'),
	viewport: requireOptionalString(viewport, 'viewport'),
});

// No page-folder mkdir anywhere else, so no page-scoped write recreates a missing page.
const makeArtboardsDir = async (page: PageLocation): Promise<void> => {
	try {
		await mkdir(workspaceJoin(page.workspaceRoot, artboardsDirSegments(page.pageId)));
	} catch (error: unknown) {
		if (isErrno(error, 'EEXIST')) {
			return;
		}
		if (isErrno(error, 'ENOENT')) {
			throw new PageNotFoundError(page.pageId, { cause: error });
		}
		throwDiskError(error);
	}
};

const writeManifestActive = async ({
	page,
	artboardId,
	existing,
}: {
	page: PageLocation;
	artboardId: string;
	existing: ArtboardManifest | undefined;
}): Promise<void> => {
	const manifest: ArtboardManifest = {
		version: SCHEMA_VERSION,
		activeArtboardId: artboardId,
		workspaceFolder: existing?.workspaceFolder ?? page.workspaceRoot,
		updatedAt: new Date().toISOString(),
	};
	if (existing?.lastExport !== undefined) {
		manifest.lastExport = existing.lastExport;
	}
	await writeUtf8({
		...workspaceLayoutFile(page.workspaceRoot, manifestPathSegments(page.pageId)),
		contents: serializeManifest(manifest),
	});
};

// The host's watcher opens the panel when this marker is written.
export const writeEnsurePanelFile = async (workspaceRoot: string): Promise<void> => {
	await writeUtf8({ ...workspaceLayoutFile(workspaceRoot, ensurePanelPathSegments), contents: '' });
};

export const createArtboard = async ({
	page,
	artboardId,
	html,
	title,
	viewport,
	writeEnsurePanelMarker,
}: CreateArtboardArgs): Promise<CreateArtboardResult> => {
	const {
		artboardId: resolvedId,
		html: resolvedHtml,
		title: validatedTitle,
		viewport: validatedViewport,
	} = validateNewArtboardArgs({ artboardId, html, title, viewport });

	await assertLayoutDirsOwned(page);
	const htmlLayout = workspaceLayoutFile(
		page.workspaceRoot,
		artboardHtmlPathSegments(page.pageId, resolvedId),
	);
	const metaLayout = workspaceLayoutFile(
		page.workspaceRoot,
		artboardMetaPathSegments(page.pageId, resolvedId),
	);
	const existingManifest = await readManifestFileLenient(page);

	// ponytail: only this mkdir maps a missing page folder to PAGE_NOT_FOUND; a writeUtf8 into a page
	// folder deleted by hand mid-call surfaces as the generic DISK_ERROR. 10c's delete revisits it.
	await makeArtboardsDir(page);

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
	// ponytail: no journal. A failed meta write after the wx HTML leaves default meta
	// (effectiveArtboardMeta); a failed manifest or marker write leaves it inactive and unopened.
	// Upgrade path: unlink the HTML when a later write fails.
	await writeUtf8({ ...metaLayout, contents: serializeMeta(meta) });
	await writeManifestActive({ page, artboardId: resolvedId, existing: existingManifest });

	let panelEnsured = false;
	if (writeEnsurePanelMarker) {
		await writeEnsurePanelFile(page.workspaceRoot);
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
	page,
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

	await assertLayoutDirsOwned(page);
	const htmlLayout = workspaceLayoutFile(
		page.workspaceRoot,
		artboardHtmlPathSegments(page.pageId, resolvedId),
	);
	// Before the lock: a missing artboard must not create .vibeboard/ through the lock's mkdir,
	// and a case variant (`HERO` for hero.html on a case-insensitive disk) must never rename it.
	await requireHtmlFile(page, resolvedId);
	await requireExactHtmlFileName(page, resolvedId);

	// ponytail: a write that skips the lock (the Agent's direct file edit, an editor save) can land
	// between the compare and the rename and be overwritten. Upgrade path: re-hash right before the
	// rename (narrows the window; writers outside the extension can never be locked out).
	return withWorkspaceLock({
		workspaceRoot: page.workspaceRoot,
		operation: async () => {
			const currentHtml = await readUtf8IfExists(htmlLayout);
			if (currentHtml === undefined) {
				throw new ArtboardNotFoundError(resolvedId);
			}
			const currentMeta = effectiveArtboardMeta({
				html: currentHtml,
				meta: await readStoredMeta(page, resolvedId),
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
						: currentMeta.generation + 1,
				hash: htmlHash,
				viewport: validatedViewport ?? currentMeta.viewport,
				updatedAt: new Date().toISOString(),
			};
			await writeUtf8({ ...htmlLayout, contents: resolvedHtml });
			await writeUtf8({
				...workspaceLayoutFile(
					page.workspaceRoot,
					artboardMetaPathSegments(page.pageId, resolvedId),
				),
				contents: serializeMeta(nextMeta),
			});
			return {
				artboardId: resolvedId,
				generation: nextMeta.generation,
				hash: nextMeta.hash,
				title: nextMeta.title,
				viewport: nextMeta.viewport,
			};
		},
	});
};

export const readArtboard = async ({
	page,
	artboardId,
}: ReadArtboardArgs): Promise<ReadArtboardResult> => {
	await assertLayoutDirsOwned(page);
	const manifest =
		artboardId === undefined ? await readManifestFile(page) : await readManifestFileLenient(page);
	const resolvedId =
		artboardId === undefined
			? requireActiveManifest(manifest).activeArtboardId
			: requireArtboardIdString(artboardId);

	const html = await requireArtboardHtml(page, resolvedId);
	const meta = effectiveArtboardMeta({
		html,
		meta: await readStoredMeta(page, resolvedId),
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

const requireOptionalFiniteNumber = (value: unknown, fieldName: string): number | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new InvalidArgsError(`${fieldName} must be a finite number. Fix args and retry.`);
	}
	return value;
};

// Backs place_frame and the panel drag commit; writes only this frame's canvas.json entry.
export const placeFrame = async ({
	page,
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

	await assertLayoutDirsOwned(page);
	await requireHtmlFile(page, resolvedId);
	await requireExactHtmlFileName(page, resolvedId);
	const listed = await listArtboards({ page });
	if (!listed.artboards.some(({ artboardId }) => artboardId === resolvedId)) {
		throw new ArtboardNotFoundError(resolvedId);
	}

	// Only the canvas.json read-modify-write runs under the lock, so the hold stays tiny.
	const next = await withWorkspaceLock({
		workspaceRoot: page.workspaceRoot,
		operation: async () => {
			const stored = await readCanvasLayoutFile(page);
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
				...workspaceLayoutFile(page.workspaceRoot, canvasPathSegments(page.pageId)),
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
	page,
	artboardId,
}: SetActiveArtboardArgs): Promise<{ activeArtboardId: string }> => {
	const resolvedId = requireArtboardIdString(artboardId);
	await assertLayoutDirsOwned(page);
	await requireHtmlFile(page, resolvedId);
	await requireExactHtmlFileName(page, resolvedId);
	let existing: ArtboardManifest | undefined;
	try {
		existing = await readManifestFile(page);
	} catch (error: unknown) {
		// ponytail: a corrupt manifest is overwritten here (git can restore it). Upgrade path:
		// keep a .bak copy before overwriting.
		if (!(error instanceof CorruptManifestError)) {
			throw error;
		}
	}
	await writeManifestActive({ page, artboardId: resolvedId, existing });
	return { activeArtboardId: resolvedId };
};
