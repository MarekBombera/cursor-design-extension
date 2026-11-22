import { mkdir } from 'node:fs/promises';

import { type CanvasFrame, resolveCanvasFrames } from './canvasLayout';
import { compareScannedHandoff, scanArtboardFiles } from './canvasView';
import { effectiveArtboardMeta } from './effectiveMeta';
import { DiskError, NoArtboardsToExportError, isErrno, throwDiskError } from './errors';
import {
	STUB_TOKENS_JSON,
	assignGroupFolders,
	buildCanvasImplementMarkdown,
	makeCanvasExportId,
} from './handoff';
import { buildCanvasPreviewHtml } from './handoffCanvasHtml';
import { normalizeHash } from './hash';
import {
	CANVAS_PREVIEW_FILE,
	HANDOFF_INDEX_FILE,
	IMPLEMENT_FILE,
	SCHEMA_VERSION,
	TOKENS_FILE,
	UNGROUPED_FOLDER,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	handoffDirSegments,
	handoffRootSegments,
	manifestPathSegments,
	workspaceTokensPathSegments,
} from './layout';
import {
	type PageLocation,
	assertLayoutDirsOwned,
	ensureDir,
	readCanvasLayoutFile,
	readManifestFile,
	readStoredMeta,
	readUtf8IfExists,
	requireActiveManifest,
	requireArtboardHtml,
	workspaceJoin,
	workspaceLayoutFile,
	writeUtf8,
} from './layoutFs';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	type ExportedFrame,
	type LastExport,
	serializeManifest,
	serializeMeta,
} from './parse';
import { withWorkspaceLock } from './workspaceLock';

export type ExportArtboardArgs = {
	page: PageLocation;
	now?: Date;
};

type ExportedFrameResult = ExportedFrame & {
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

type HandoffLeafFile = {
	segments: readonly string[];
	contents: string;
};

// The leaf is never reused: an existing handoff/<exportId>/ fails the export.
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
	// ponytail: no rollback; a failed write leaves an orphan leaf (harmless, never deleted).
	// Upgrade path: remove the leaf when a write fails.
};

const writeManifestLastExport = async ({
	page,
	existing,
	artboardId,
	lastExport,
}: {
	page: PageLocation;
	existing: ArtboardManifest | undefined;
	artboardId: string;
	lastExport: LastExport;
}): Promise<void> => {
	const manifest: ArtboardManifest = {
		version: SCHEMA_VERSION,
		activeArtboardId: existing?.activeArtboardId || artboardId,
		workspaceFolder: existing?.workspaceFolder ?? page.workspaceRoot,
		updatedAt: lastExport.exportedAt,
		lastExport,
	};
	await writeUtf8({
		...workspaceLayoutFile(page.workspaceRoot, manifestPathSegments(page.pageId)),
		contents: serializeManifest(manifest),
	});
};

// `.` and `..` pass the artboard-id charset but cannot be a handoff folder name.
const requireExportableFolderId = (page: PageLocation, artboardId: string): void => {
	if (artboardId === '.' || artboardId === '..') {
		throw new DiskError(
			`Artboard id "${artboardId}" cannot be exported as a folder. Rename ${artboardHtmlPathSegments(page.pageId, artboardId).join('/')}.`,
		);
	}
};

type ExportPlanFrame = CanvasFrame & {
	folder: string;
	html: string;
	storedMeta: ArtboardMeta | undefined;
	effective: ArtboardMeta;
	refreshMeta: boolean;
};

// Both scans saw no meta, or both saw the same hash and generation (same file format, so no
// normalizeHash).
const isSameStoredMeta = (
	scanned: ArtboardMeta | undefined,
	current: ArtboardMeta | undefined,
): boolean =>
	scanned === undefined || current === undefined
		? scanned === current
		: scanned.hash === current.hash && scanned.generation === current.generation;

// Scan reads (and their errors) happen before the leaf mkdir; the scan's HTML string is the only
// source for index.html, hashes, and meta.
export const exportArtboard = async ({
	page,
	now,
}: ExportArtboardArgs): Promise<ExportArtboardResult> => {
	const exportNow = now ?? new Date();
	await assertLayoutDirsOwned(page);
	const scanned = await scanArtboardFiles({ page, tolerateHtmlDiskError: false });
	const layout = await readCanvasLayoutFile(page);
	const htmlById = new Map(scanned.artboards.map(({ artboardId, html }) => [artboardId, html]));
	const resolved = resolveCanvasFrames({
		stored: layout.frames,
		artboards: scanned.artboards.map(({ artboardId, title }) => ({ artboardId, title })),
	});
	if (resolved.length === 0) {
		throw new NoArtboardsToExportError();
	}
	for (const frame of resolved) {
		requireExportableFolderId(page, frame.id);
	}

	const folders = assignGroupFolders(resolved);
	const planned: ExportPlanFrame[] = [];
	for (const frame of resolved) {
		const html = htmlById.get(frame.id) ?? '';
		const storedMeta = await readStoredMeta(page, frame.id, { rejectUnparsable: true });
		const effective = effectiveArtboardMeta({ html, meta: storedMeta, artboardId: frame.id });
		planned.push({
			...frame,
			folder: folders.get(frame.id) ?? UNGROUPED_FOLDER,
			html,
			storedMeta,
			effective,
			refreshMeta: storedMeta === undefined || normalizeHash(storedMeta.hash) !== effective.hash,
		});
	}
	const tokensJson =
		(await readUtf8IfExists(
			workspaceLayoutFile(page.workspaceRoot, workspaceTokensPathSegments),
		)) ?? STUB_TOKENS_JSON;

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
		pageId: page.pageId,
		frames: planned.map(({ id, label, width, group, folder, effective }) => {
			const implementFrame = { id, label, width, folder, artboardHash: effective.hash };
			return group === undefined ? implementFrame : { ...implementFrame, group };
		}),
	});
	const canvasHtml = buildCanvasPreviewHtml({ exportId, frames: planned });

	await writeHandoffLeaf({
		workspaceRoot: page.workspaceRoot,
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
	// The tail re-reads under the lock, all reads before any write, so a locked write that landed
	// since the scan is never overwritten and a read error writes nothing. An unlocked write (an
	// editor save) can still land between the re-read and the meta write.
	await withWorkspaceLock({
		workspaceRoot: page.workspaceRoot,
		operation: async () => {
			const metaWrites: { id: string; contents: string }[] = [];
			for (const { id, html, storedMeta, effective, refreshMeta } of planned) {
				if (!refreshMeta) {
					continue;
				}
				const currentHtml = await readUtf8IfExists(
					workspaceLayoutFile(page.workspaceRoot, artboardHtmlPathSegments(page.pageId, id)),
				);
				if (currentHtml !== html) {
					continue;
				}
				const currentMeta = await readStoredMeta(page, id, { rejectUnparsable: true });
				if (!isSameStoredMeta(storedMeta, currentMeta)) {
					continue;
				}
				metaWrites.push({
					id,
					contents: serializeMeta({ ...effective, updatedAt: exportedAt }),
				});
			}
			const currentManifest = await readManifestFile(page);
			for (const { id, contents } of metaWrites) {
				await writeUtf8({
					...workspaceLayoutFile(page.workspaceRoot, artboardMetaPathSegments(page.pageId, id)),
					contents,
				});
			}
			// ponytail: set_artboard / set_active_artboard (artboardFs.ts:writeManifestActive) take no
			// lock, so they can land between this re-read and this write, and can write back an older
			// lastExport; two racing exports stay last-writer-wins on lastExport. This narrows the
			// manifest window to the locked tail. Upgrade path: take the lock in writeManifestActive.
			await writeManifestLastExport({
				page,
				existing: currentManifest,
				artboardId: legacyFrame.artboardId,
				lastExport,
			});
		},
	});

	return {
		exportId,
		exportedAt,
		handoffPath: handoffDirSegments(exportId).join('/'),
		frames: exportedFrames,
	};
};

export const readHandoffStatus = async ({
	page,
}: {
	page: PageLocation;
}): Promise<HandoffStatusResult> => {
	await assertLayoutDirsOwned(page);
	const manifest = requireActiveManifest(await readManifestFile(page));
	const activeArtboardId = manifest.activeArtboardId;
	const activeHtml = await requireArtboardHtml(page, activeArtboardId);
	const activeMeta = effectiveArtboardMeta({
		html: activeHtml,
		meta: await readStoredMeta(page, activeArtboardId),
		artboardId: activeArtboardId,
	});

	// Never exported stays stale. Layout never affects staleness, so canvas.json is not read.
	let stale = true;
	if (manifest.lastExport !== undefined) {
		const scanned = await scanArtboardFiles({ page, tolerateHtmlDiskError: true });
		stale = compareScannedHandoff(scanned).stale;
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
