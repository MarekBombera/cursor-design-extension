import { mkdir, rename, writeFile } from 'node:fs/promises';

import {
	DiskError,
	MigrationConflictError,
	PageNotFoundError,
	isErrno,
	logStderr,
	throwDiskError,
} from './errors';
import {
	ARTBOARDS_DIR,
	ARTBOARDS_TOMBSTONE_TEXT,
	VIBEBOARD_DIR,
	FIRST_PAGE_ID,
	MAX_PAGES,
	PAGE_ENTRIES,
	PROJECT_SCHEMA_VERSION,
	type PageEntry,
	artboardsTombstoneSegments,
	isPageId,
	pageDirSegments,
	pageEntrySegments,
	pagesDirSegments,
	projectPathSegments,
	rootEntrySegments,
} from './layout';
import {
	type PageLocation,
	assertDirOwned,
	layoutEntryKind,
	lstatOrUndefined,
	pageFolderExists,
	readProjectFile,
	readdirOrEmpty,
	workspaceJoin,
	workspaceLayoutFile,
	writeUtf8,
} from './layoutFs';
import { type Project, serializeProject } from './parse';
import { withWorkspaceLock } from './workspaceLock';

type PageIds = readonly [string, ...string[]];

type FolderState =
	| { kind: 'indexed'; project: Project }
	| { kind: 'legacy'; names: readonly PageEntry[] }
	| { kind: 'indexLost'; pageIds: PageIds }
	| { kind: 'fresh' };

export const pageNumberText = (pageId: string): string => pageId.slice(pageId.indexOf('-') + 1);

// The default title: "Page <n>".
export const pageTitle = (pageId: string): string => `Page ${pageNumberText(pageId)}`;

// The 0.4 entries still at the root, in PAGE_ENTRIES order: artboards only as a real directory
// (the tombstone, or any other non-directory, is not legacy), a JSON name as any kind.
const legacyRootEntries = async (workspaceRoot: string): Promise<PageEntry[]> => {
	const present: PageEntry[] = [];
	for (const name of PAGE_ENTRIES) {
		const entryStats = await lstatOrUndefined(
			workspaceJoin(workspaceRoot, rootEntrySegments(name)),
		);
		if (entryStats !== undefined && (name !== ARTBOARDS_DIR || entryStats.isDirectory())) {
			present.push(name);
		}
	}
	return present;
};

const scanPageFolders = async (workspaceRoot: string): Promise<string[]> => {
	const names = await readdirOrEmpty(workspaceJoin(workspaceRoot, pagesDirSegments));
	const pageIds: string[] = [];
	for (const name of names.filter(isPageId)) {
		if (await pageFolderExists(workspaceRoot, name)) {
			pageIds.push(name);
		}
	}
	pageIds.sort((left, right) => Number(pageNumberText(left)) - Number(pageNumberText(right)));
	if (pageIds.length > MAX_PAGES) {
		// ponytail: folders past MAX_PAGES stay on disk, unlisted. Upgrade path: page search (0.5.1).
		logStderr(
			'page folder scan',
			new Error(`${pageIds.length - MAX_PAGES} page folders past ${MAX_PAGES} are not listed`),
		);
	}
	return pageIds.slice(0, MAX_PAGES);
};

const classifyFolder = async (workspaceRoot: string): Promise<FolderState> => {
	await assertDirOwned(workspaceRoot, [VIBEBOARD_DIR]);
	await assertDirOwned(workspaceRoot, pagesDirSegments);
	const project = await readProjectFile(workspaceRoot);
	if (project !== undefined) {
		return { kind: 'indexed', project };
	}
	const names = await legacyRootEntries(workspaceRoot);
	if (names.length > 0) {
		return { kind: 'legacy', names };
	}
	const [openPageId, ...otherPageIds] = await scanPageFolders(workspaceRoot);
	if (openPageId !== undefined) {
		return { kind: 'indexLost', pageIds: [openPageId, ...otherPageIds] };
	}
	return { kind: 'fresh' };
};

// ponytail: 0.4's createArtboard takes no lock, so it can mkdir the root artboards folder between
// the move and this write. In create and rebuild the tombstone comes first, so nothing else was
// written yet; in a migration the next call's conflict check names the folder. Upgrade path: none
// needed while the tombstone exists.
const writeArtboardsTombstone = async (workspaceRoot: string): Promise<void> => {
	const tombstonePath = workspaceJoin(workspaceRoot, artboardsTombstoneSegments);
	try {
		await writeFile(tombstonePath, ARTBOARDS_TOMBSTONE_TEXT, { encoding: 'utf8', flag: 'wx' });
	} catch (error: unknown) {
		if (!isErrno(error, 'EEXIST')) {
			throwDiskError(error);
		}
		if ((await lstatOrUndefined(tombstonePath))?.isDirectory() === true) {
			throw new DiskError(
				`${artboardsTombstoneSegments.join('/')} became a folder while vibeboard was replacing it. An older vibeboard MCP server may still be running: quit and reopen Cursor, then retry.`,
				{ cause: error },
			);
		}
	}
};

// EEXIST is fine only for a real directory; anything else at that name is the directory DiskError.
export const makeLayoutDir = async ({
	workspaceRoot,
	segments,
	recursive,
}: {
	workspaceRoot: string;
	segments: readonly string[];
	recursive: boolean;
}): Promise<void> => {
	try {
		await mkdir(workspaceJoin(workspaceRoot, segments), { recursive });
	} catch (error: unknown) {
		if (!isErrno(error, 'EEXIST')) {
			throwDiskError(error);
		}
		await assertDirOwned(workspaceRoot, segments);
	}
};

const makeFirstPageFolder = async (workspaceRoot: string): Promise<void> => {
	await makeLayoutDir({ workspaceRoot, segments: pagesDirSegments, recursive: true });
	await makeLayoutDir({
		workspaceRoot,
		segments: pageDirSegments(FIRST_PAGE_ID),
		recursive: false,
	});
};

export const writeProjectFile = async (workspaceRoot: string, project: Project): Promise<void> => {
	await writeUtf8({
		...workspaceLayoutFile(workspaceRoot, projectPathSegments),
		contents: serializeProject(project),
	});
};

// project.json from the scanned page folders, titled "Page <n>"; the first (lowest number) is open.
const writeIndexFromFolders = async (workspaceRoot: string, pageIds: PageIds): Promise<string> => {
	const [openPageId] = pageIds;
	await writeProjectFile(workspaceRoot, {
		version: PROJECT_SCHEMA_VERSION,
		openPageId,
		pages: pageIds.map((id) => ({ id, title: pageTitle(id) })),
	});
	return openPageId;
};

// Resumable: each step skips what an earlier, interrupted run already moved, and nothing is
// overwritten.
// ponytail (D5): a 0.4 addComment or placeFrame already waiting on the lock re-reads "missing =
// empty" after this and writes an orphan root file, which 0.5 ignores while project.json exists.
// Upgrade path: none; the tombstone stops 0.4's artboard writes, and 0.4 goes away with a reload.
const migrateLegacyFolder = async (
	workspaceRoot: string,
	names: readonly PageEntry[],
): Promise<void> => {
	// A file at pages/page-1 would fail the conflict lstat with ENOTDIR, not the directory message.
	await assertDirOwned(workspaceRoot, pageDirSegments(FIRST_PAGE_ID));
	const conflicts: PageEntry[] = [];
	for (const name of names) {
		const pageEntryPath = workspaceJoin(workspaceRoot, pageEntrySegments(FIRST_PAGE_ID, name));
		if ((await layoutEntryKind(pageEntryPath)) !== 'missing') {
			conflicts.push(name);
		}
	}
	if (conflicts.length > 0) {
		throw new MigrationConflictError({ pageId: FIRST_PAGE_ID, names: conflicts });
	}
	await makeFirstPageFolder(workspaceRoot);
	const moveToFirstPage = async (name: PageEntry): Promise<void> => {
		try {
			await rename(
				workspaceJoin(workspaceRoot, rootEntrySegments(name)),
				workspaceJoin(workspaceRoot, pageEntrySegments(FIRST_PAGE_ID, name)),
			);
		} catch (error: unknown) {
			throwDiskError(error);
		}
	};
	if (names.includes(ARTBOARDS_DIR)) {
		await moveToFirstPage(ARTBOARDS_DIR);
	}
	await writeArtboardsTombstone(workspaceRoot);
	for (const name of names) {
		if (name !== ARTBOARDS_DIR) {
			await moveToFirstPage(name);
		}
	}
	// The scan runs after the move: page-1 exists now, and as a real directory it sorts first.
	const [openPageId = FIRST_PAGE_ID, ...otherPageIds] = await scanPageFolders(workspaceRoot);
	await writeIndexFromFolders(workspaceRoot, [openPageId, ...otherPageIds]);
};

const rebuildProjectIndex = async (workspaceRoot: string, pageIds: PageIds): Promise<string> => {
	await writeArtboardsTombstone(workspaceRoot);
	return writeIndexFromFolders(workspaceRoot, pageIds);
};

const createFreshProject = async (workspaceRoot: string): Promise<void> => {
	await writeArtboardsTombstone(workspaceRoot);
	await makeFirstPageFolder(workspaceRoot);
	await writeProjectFile(workspaceRoot, {
		version: PROJECT_SCHEMA_VERSION,
		openPageId: FIRST_PAGE_ID,
		pages: [{ id: FIRST_PAGE_ID, title: pageTitle(FIRST_PAGE_ID) }],
	});
};

// The only write on an Indexed path: restores a deleted tombstone. A root artboards folder next to
// an index is a stale 0.4 write the user must sort out.
const openIndexedPage = async (workspaceRoot: string, project: Project): Promise<PageLocation> => {
	const rootArtboards = await lstatOrUndefined(
		workspaceJoin(workspaceRoot, artboardsTombstoneSegments),
	);
	if (rootArtboards === undefined) {
		await writeArtboardsTombstone(workspaceRoot);
	} else if (rootArtboards.isDirectory()) {
		throw new MigrationConflictError({ pageId: project.openPageId, names: [ARTBOARDS_DIR] });
	}
	return { workspaceRoot, pageId: project.openPageId };
};

const settleFolderLocked = async (
	workspaceRoot: string,
	createIfFresh: boolean,
): Promise<PageLocation> => {
	const state = await classifyFolder(workspaceRoot);
	switch (state.kind) {
		case 'indexed':
			return openIndexedPage(workspaceRoot, state.project);
		case 'legacy':
			await migrateLegacyFolder(workspaceRoot, state.names);
			return { workspaceRoot, pageId: FIRST_PAGE_ID };
		case 'indexLost':
			return { workspaceRoot, pageId: await rebuildProjectIndex(workspaceRoot, state.pageIds) };
		case 'fresh':
			if (createIfFresh) {
				await createFreshProject(workspaceRoot);
			}
			return { workspaceRoot, pageId: FIRST_PAGE_ID };
	}
};

// The open page for one call: migrates a 0.4 folder, rebuilds a lost index, and creates a fresh
// project only when createIfFresh. Takes the workspace lock itself, so never call it inside one.
export const resolveOpenPage = async ({
	workspaceRoot,
	createIfFresh,
}: {
	workspaceRoot: string;
	createIfFresh: boolean;
}): Promise<PageLocation> => {
	const state = await classifyFolder(workspaceRoot);
	if (state.kind === 'indexed') {
		return openIndexedPage(workspaceRoot, state.project);
	}
	if (state.kind === 'fresh' && !createIfFresh) {
		return { workspaceRoot, pageId: FIRST_PAGE_ID };
	}
	return withWorkspaceLock({
		workspaceRoot,
		operation: () => settleFolderLocked(workspaceRoot, createIfFresh),
	});
};

// The page a panel request names, checked against the index and its folder. The open page comes
// back unchanged (no extra check); any other page must be indexed and have a folder. Writes
// nothing beyond what resolveOpenPage writes, and takes no lock itself beyond its call.
// ponytail: a page deleted between this check and the op's write: createArtboard hits the
// page-scoped write guard; every other op fails on writeUtf8 with the generic disk copy, not
// PAGE_NOT_FOUND. Nothing recreates the folder, so no data is at risk. Upgrade path: re-check the
// folder inside each op's lock.
export const resolveRequestedPage = async ({
	workspaceRoot,
	pageId,
}: {
	workspaceRoot: string;
	pageId: string;
}): Promise<PageLocation> => {
	if (!isPageId(pageId)) {
		throw new PageNotFoundError(pageId);
	}
	const openPage = await resolveOpenPage({ workspaceRoot, createIfFresh: false });
	if (pageId === openPage.pageId) {
		return openPage;
	}
	const project = await readProjectFile(workspaceRoot);
	if (project === undefined || !project.pages.some((entry) => entry.id === pageId)) {
		throw new PageNotFoundError(pageId, { reason: 'unlisted' });
	}
	if (!(await pageFolderExists(workspaceRoot, pageId))) {
		throw new PageNotFoundError(pageId);
	}
	return { workspaceRoot, pageId };
};
