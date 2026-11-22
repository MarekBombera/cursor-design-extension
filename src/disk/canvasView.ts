import { readdir } from 'node:fs/promises';

import { type CanvasFrame, resolveCanvasFrames } from './canvasLayout';
import { effectiveArtboardMeta } from './effectiveMeta';
import {
	CorruptCanvasError,
	CorruptMetaError,
	DiskError,
	InvalidArtboardIdError,
	UnsupportedCanvasVersionError,
	throwDiskError,
} from './errors';
import { type HandoffCompare, compareCanvasHandoff } from './handoff';
import { hashHtml } from './hash';
import { artboardHtmlPathSegments, artboardsDirSegments } from './layout';
import {
	type PageLocation,
	assertLayoutDirsOwned,
	layoutEntryKind,
	readCanvasLayoutFile,
	readManifestFile,
	readStoredMeta,
	readUtf8IfExists,
	workspaceJoin,
	workspaceLayoutFile,
} from './layoutFs';
import { type ArtboardManifest, type ArtboardMeta, parseArtboardId } from './parse';

export type ListArtboardsArgs = {
	page: PageLocation;
};

type ListedArtboard = {
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
	// hashHtml of the disk HTML as read (the panel's edit base); '' when it was not readable.
	hash: string;
	html: string;
	errorMessage?: string;
};

type CanvasViewHtmlReadError = {
	artboardId: string;
	error: DiskError;
};

export type CanvasView = {
	activeArtboardId: string;
	frames: CanvasViewFrame[];
	// Panel badge: frames changed, added, removed, or unreadable since the last export.
	handoffStale: boolean;
	layoutErrorMessage?: string;
	htmlReadErrors?: CanvasViewHtmlReadError[];
};

export type ReadCanvasViewArgs = {
	page: PageLocation;
};

export const FRAME_READ_ERROR_MESSAGE =
	'Could not read this artboard file. Check the Output panel: Cursor Design.';

type ScannedArtboard = {
	artboardId: string;
	title: string;
	active: boolean;
	generation?: number;
	html: string;
	errorMessage?: string;
	htmlReadError?: DiskError;
};

export type ScannedArtboards = {
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

export const scanArtboardFiles = async ({
	page,
	tolerateHtmlDiskError,
}: {
	page: PageLocation;
	tolerateHtmlDiskError: boolean;
}): Promise<ScannedArtboards> => {
	await assertLayoutDirsOwned(page);
	const artboardsDirectory = workspaceJoin(page.workspaceRoot, artboardsDirSegments(page.pageId));
	if ((await layoutEntryKind(artboardsDirectory)) === 'missing') {
		return { activeArtboardId: '', artboards: [], artboardsDirMissing: true };
	}

	let fileNames: string[];
	try {
		fileNames = await readdir(artboardsDirectory, { encoding: 'utf8' });
	} catch (error: unknown) {
		return throwDiskError(error);
	}

	const manifest = await readManifestFile(page);
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

		const htmlLayout = workspaceLayoutFile(
			page.workspaceRoot,
			artboardHtmlPathSegments(page.pageId, candidateId),
		);
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
			storedMeta = await readStoredMeta(page, candidateId);
		} catch (error: unknown) {
			if (error instanceof DiskError || error instanceof CorruptMetaError) {
				// ponytail: an unreadable meta (symlink, corrupt, foreign id) lists the artboard
				// without a generation instead of failing the list; read_artboard still errors on
				// it. Upgrade path: carry the meta error on the listed entry.
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

// hashHtml of the disk HTML as read, never the stored meta hash (its hex case is as written);
// undefined when the file was not readable.
const scannedHashes = (scanned: ScannedArtboards): Map<string, string | undefined> =>
	new Map(
		scanned.artboards.map(({ artboardId, html, errorMessage }) => [
			artboardId,
			errorMessage === undefined ? hashHtml(html) : undefined,
		]),
	);

// An unreadable frame has no hash, so it counts as changed (fail closed).
export const compareScannedHandoff = (
	scanned: ScannedArtboards,
	hashes: ReadonlyMap<string, string | undefined> = scannedHashes(scanned),
): HandoffCompare =>
	compareCanvasHandoff({
		lastExport: scanned.manifest?.lastExport,
		frames: scanned.artboards.map(({ artboardId }) => ({
			artboardId,
			hash: hashes.get(artboardId),
		})),
	});

const resolveLayoutOrEmpty = async (
	page: PageLocation,
): Promise<{ stored: CanvasFrame[]; layoutErrorMessage?: string }> => {
	try {
		return { stored: (await readCanvasLayoutFile(page)).frames };
	} catch (error: unknown) {
		if (error instanceof CorruptCanvasError || error instanceof UnsupportedCanvasVersionError) {
			return { stored: [], layoutErrorMessage: error.message };
		}
		throw error;
	}
};

export const listArtboards = async ({ page }: ListArtboardsArgs): Promise<ListArtboardsResult> => {
	const scanned = await scanArtboardFiles({ page, tolerateHtmlDiskError: false });
	const artboards = scanned.artboards.map(listedFromScan);
	if (scanned.artboardsDirMissing) {
		return { activeArtboardId: '', artboards: [], frames: [] };
	}
	const layout = await readCanvasLayoutFile(page);
	const frames = resolveCanvasFrames({
		stored: layout.frames,
		artboards: artboards.map(({ artboardId, title }) => ({ artboardId, title })),
	});
	return { activeArtboardId: scanned.activeArtboardId, artboards, frames };
};

export const readCanvasView = async ({ page }: ReadCanvasViewArgs): Promise<CanvasView> => {
	const scanned = await scanArtboardFiles({ page, tolerateHtmlDiskError: true });
	if (scanned.artboardsDirMissing) {
		return { activeArtboardId: '', frames: [], handoffStale: false };
	}
	const { stored, layoutErrorMessage } = await resolveLayoutOrEmpty(page);
	const byId = new Map(scanned.artboards.map((entry) => [entry.artboardId, entry]));
	const hashes = scannedHashes(scanned);
	const htmlReadErrors: CanvasViewHtmlReadError[] = [];
	const frames = resolveCanvasFrames({
		stored,
		artboards: scanned.artboards.map(({ artboardId, title }) => ({ artboardId, title })),
	}).map((frame) => {
		const scannedFrame = byId.get(frame.id);
		const viewFrame: CanvasViewFrame = {
			...frame,
			generation: scannedFrame?.generation ?? 0,
			hash: hashes.get(frame.id) ?? '',
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
	const view: CanvasView = {
		activeArtboardId: scanned.activeArtboardId,
		frames,
		// Never exported compares as not stale; an emptied canvas keeps the badge off.
		handoffStale: frames.length > 0 && compareScannedHandoff(scanned, hashes).stale,
	};
	if (layoutErrorMessage !== undefined) {
		view.layoutErrorMessage = layoutErrorMessage;
	}
	if (htmlReadErrors.length > 0) {
		view.htmlReadErrors = htmlReadErrors;
	}
	return view;
};
