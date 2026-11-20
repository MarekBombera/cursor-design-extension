import { writeFile } from 'node:fs/promises';

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
	assertLayoutDirsOwned,
	ensureDir,
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

// Re-exported so callers import the disk jobs from one path.
export {
	FRAME_READ_ERROR_MESSAGE,
	listArtboards,
	readCanvasView,
	type CanvasView,
	type CanvasViewFrame,
} from './canvasView';
export { exportArtboard, readHandoffStatus } from './exportFs';

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

export type PlaceFrameArgs = {
	workspaceRoot: string;
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
	workspaceRoot: string;
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
	// ponytail: no journal. A failed meta write after the wx HTML leaves default meta
	// (effectiveArtboardMeta); a failed manifest or marker write leaves it inactive and unopened.
	// Upgrade path: unlink the HTML when a later write fails.
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
	// Before the lock: a missing artboard must not create .cursor-design/ through the lock's mkdir,
	// and a case variant (`HERO` for hero.html on a case-insensitive disk) must never rename it.
	await requireHtmlFile(htmlLayout.filePath, resolvedId);
	await requireExactHtmlFileName(workspaceRoot, resolvedId);

	// ponytail: a write that skips the lock (the Agent's direct file edit, an editor save) can land
	// between the compare and the rename and be overwritten. Upgrade path: re-hash right before the
	// rename (narrows the window; writers outside the extension can never be locked out).
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
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
						: currentMeta.generation + 1,
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
		},
	});
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
		// ponytail: a corrupt manifest is overwritten here (git can restore it). Upgrade path:
		// keep a .bak copy before overwriting.
		if (!(error instanceof CorruptManifestError)) {
			throw error;
		}
	}
	await writeManifestActive({ workspaceRoot, artboardId: resolvedId, existing });
	return { activeArtboardId: resolvedId };
};
