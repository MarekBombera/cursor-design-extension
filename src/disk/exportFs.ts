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

export type ExportArtboardArgs = {
	workspaceRoot: string;
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
	const tokensJson =
		(await readUtf8IfExists(workspaceLayoutFile(workspaceRoot, workspaceTokensPathSegments))) ??
		STUB_TOKENS_JSON;

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
