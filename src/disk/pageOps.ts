import { type Stats } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';

import { type CreateArtboardResult, createArtboard, writeEnsurePanelFile } from './artboardFs';
import {
	ArtboardExistsError,
	DiskError,
	InvalidArgsError,
	PageNotFoundError,
	isErrno,
	logStderr,
	throwDiskError,
} from './errors';
import { compactIsoTime } from './handoff';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	FIRST_PAGE_ID,
	MAX_PAGES,
	artboardsDirSegments,
	canvasPathSegments,
	commentsPathSegments,
	deletedDirSegments,
	deletedPageDirSegments,
	isPageId,
	manifestPathSegments,
	pageDirSegments,
	pagesDirSegments,
	projectPathSegments,
} from './layout';
import {
	assertDirOwned,
	lstatOrUndefined,
	pageFolderExists,
	readProjectFile,
	readdirOrEmpty,
	workspaceJoin,
} from './layoutFs';
import {
	makeLayoutDir,
	pageNumberText,
	pageTitle,
	resolveOpenPage,
	writeProjectFile,
} from './openPage';
import { type Project, parsePageTitle } from './parse';
import { withWorkspaceLock } from './workspaceLock';

type PageSummary = { id: string; title: string };

type ListedPage = PageSummary & { updatedAt: string | null };

const DELETED_PAGE_NAME_PATTERN = /^page-([1-9][0-9]{0,5})-/;

const NO_PAGE_IDS_LEFT_MESSAGE = `No page ids are left. Remove unused folders from ${pagesDirSegments.join('/')}/ and ${deletedDirSegments.join('/')}/.`;

const PAGE_ID_MESSAGE =
	'pageId must be a page id such as page-2. Call list_pages for the page ids.';

// The one pageId arg guard (open_page, renamePage, deletePage); the message never echoes the value.
export const requirePageId = (pageId: unknown): string => {
	if (!isPageId(pageId)) {
		throw new InvalidArgsError(PAGE_ID_MESSAGE);
	}
	return pageId;
};

// Ids are never reused: counts every indexed id, every page-id name under pages/ (any kind,
// no cap) and every deleted/<id>-<stamp> name.
const nextPageNumber = async (workspaceRoot: string): Promise<number> => {
	await assertDirOwned(workspaceRoot, deletedDirSegments);
	const project = await readProjectFile(workspaceRoot);
	const pageNames = await readdirOrEmpty(workspaceJoin(workspaceRoot, pagesDirSegments));
	const deletedNames = await readdirOrEmpty(workspaceJoin(workspaceRoot, deletedDirSegments));
	const numbers = [
		...(project?.pages ?? []).map(({ id }) => id),
		...pageNames.filter(isPageId),
	].map((pageId) => Number(pageNumberText(pageId)));
	for (const name of deletedNames) {
		const match = DELETED_PAGE_NAME_PATTERN.exec(name);
		if (match?.[1] !== undefined) {
			numbers.push(Number(match[1]));
		}
	}
	return Math.max(0, ...numbers) + 1;
};

// A non-recursive mkdir claims the id: another creator's folder (EEXIST) moves on to the next one.
const claimPageFolder = async (workspaceRoot: string): Promise<string> => {
	const firstNumber = await nextPageNumber(workspaceRoot);
	for (let offset = 0; offset < MAX_PAGES; offset += 1) {
		const pageId = `page-${firstNumber + offset}`;
		if (!isPageId(pageId)) {
			throw new DiskError(NO_PAGE_IDS_LEFT_MESSAGE);
		}
		try {
			await mkdir(workspaceJoin(workspaceRoot, pageDirSegments(pageId)));
			return pageId;
		} catch (error: unknown) {
			if (!isErrno(error, 'EEXIST')) {
				throwDiskError(error);
			}
		}
	}
	throw new DiskError(
		`Could not claim a new page folder in ${pagesDirSegments.join('/')}/. Retry in a moment.`,
	);
};

// Never writes a new index: rebuilding one is resolveOpenPage's job.
const requireProject = async (workspaceRoot: string): Promise<Project> => {
	const project = await readProjectFile(workspaceRoot);
	if (project === undefined) {
		throw new DiskError(
			`The page list ${projectPathSegments.join('/')} disappeared. Retry; vibeboard rebuilds it from the page folders.`,
		);
	}
	return project;
};

// The one listed-page rule. No project.json, or the id not in it: the unlisted PAGE_NOT_FOUND.
export const listedPage = (
	project: Project | undefined,
	pageId: string,
): { project: Project; entry: PageSummary } => {
	const entry = project?.pages.find(({ id }) => id === pageId);
	if (project === undefined || entry === undefined) {
		throw new PageNotFoundError(pageId, { reason: 'unlisted' });
	}
	return { project, entry };
};

const isNamedFile = (name: string): boolean =>
	name.endsWith('.html') || name.endsWith('.meta.json');

// Newest mtime among the page's design files, else the folder's own; null when the folder is gone.
// Keeps its own lstat (not pageFolderExists): the folder's mtime is the fallback.
const pageUpdatedAt = async (workspaceRoot: string, pageId: string): Promise<string | null> => {
	const folderStats = await lstatOrUndefined(workspaceJoin(workspaceRoot, pageDirSegments(pageId)));
	if (folderStats?.isDirectory() !== true) {
		return null;
	}
	const artboardsSegments = artboardsDirSegments(pageId);
	// A symlinked artboards/ would leak mtimes from outside the workspace; the caller logs the throw.
	await assertDirOwned(workspaceRoot, artboardsSegments);
	const artboardNames = (
		await readdirOrEmpty(workspaceJoin(workspaceRoot, artboardsSegments))
	).filter(isNamedFile);
	const filePaths = [
		workspaceJoin(workspaceRoot, manifestPathSegments(pageId)),
		workspaceJoin(workspaceRoot, canvasPathSegments(pageId)),
		workspaceJoin(workspaceRoot, commentsPathSegments(pageId)),
		...artboardNames.map((name) => workspaceJoin(workspaceRoot, [...artboardsSegments, name])),
	];
	const fileStats: Stats[] = [];
	for (const filePath of filePaths) {
		const stats = await lstatOrUndefined(filePath);
		if (stats !== undefined) {
			fileStats.push(stats);
		}
	}
	const newestMs = Math.max(...fileStats.map(({ mtimeMs }) => mtimeMs));
	return new Date(fileStats.length > 0 ? newestMs : folderStats.mtimeMs).toISOString();
};

// Lock-free reader: never resolves, so the caller resolved first. No project.json lists nothing.
// ponytail: O(pages × frames) lstats per call. Upgrade path: build the list only while the Pages
// menu is open.
export const listPages = async ({
	workspaceRoot,
}: {
	workspaceRoot: string;
}): Promise<{ openPageId: string | null; pages: ListedPage[] }> => {
	const project = await readProjectFile(workspaceRoot);
	if (project === undefined) {
		return { openPageId: null, pages: [] };
	}
	const pages: ListedPage[] = [];
	for (const { id, title } of project.pages) {
		let updatedAt: string | null = null;
		try {
			updatedAt = await pageUpdatedAt(workspaceRoot, id);
		} catch (error: unknown) {
			// ponytail: one unreadable page lists with updatedAt null so the rest still list. The panel lists
			// on every refresh, so a page that stays unreadable logs on each one; log once per id if it ever shows.
			logStderr(`page ${id} updatedAt`, error);
		}
		pages.push({ id, title, updatedAt });
	}
	return { openPageId: project.openPageId, pages };
};

type CreatePageResult = {
	page: PageSummary;
	artboardId: typeof DEFAULT_ARTBOARD_ID;
	generation: number;
	hash: string;
};

const isSoleUntitledFirstPage = (project: Project): boolean => {
	const [onlyPage, ...otherPages] = project.pages;
	return (
		onlyPage !== undefined &&
		otherPages.length === 0 &&
		onlyPage.id === FIRST_PAGE_ID &&
		onlyPage.title === pageTitle(FIRST_PAGE_ID)
	);
};

// The sole page-1, still titled "Page 1", its folder present, with no manifest and no artboard
// files: a folder never opened, or a fresh create whose artboard write failed. Filling it beats
// leaving an empty extra page. A hand-deleted folder is not adopted: the artboard write would fail
// with PAGE_NOT_FOUND. An artboard file without a manifest (a failed set_artboard) is the user's page, not blank.
const isBlankFirstPage = async (workspaceRoot: string, project: Project): Promise<boolean> =>
	isSoleUntitledFirstPage(project) &&
	(await pageFolderExists(workspaceRoot, FIRST_PAGE_ID)) &&
	(await lstatOrUndefined(workspaceJoin(workspaceRoot, manifestPathSegments(FIRST_PAGE_ID)))) ===
		undefined &&
	(await readdirOrEmpty(workspaceJoin(workspaceRoot, artboardsDirSegments(FIRST_PAGE_ID))))
		.length === 0;

const createDefaultArtboard = (
	workspaceRoot: string,
	pageId: string,
): Promise<CreateArtboardResult> =>
	createArtboard({
		page: { workspaceRoot, pageId },
		artboardId: DEFAULT_ARTBOARD_ID,
		html: DEFAULT_ARTBOARD_HTML,
		writeEnsurePanelMarker: false,
	});

// Undefined when page-1 stopped being blank meanwhile (the host's init filled it, another create
// added a page, a rename retitled it): the caller makes a new page instead.
// ponytail: when the locked re-check fails, the default artboard written here stays in page-1. It
// was blank when checked, so it ends up with what the host's init gives a blank page. Upgrade path:
// write the artboard only after the locked check, under a lock createArtboard does not take.
const adoptBlankFirstPage = async ({
	workspaceRoot,
	title,
}: {
	workspaceRoot: string;
	title: string | undefined;
}): Promise<CreatePageResult | undefined> => {
	let artboard: CreateArtboardResult;
	try {
		artboard = await createDefaultArtboard(workspaceRoot, FIRST_PAGE_ID);
	} catch (error: unknown) {
		if (error instanceof ArtboardExistsError) {
			return undefined;
		}
		throw error;
	}
	const page = await withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const project = await requireProject(workspaceRoot);
			if (!isSoleUntitledFirstPage(project)) {
				return undefined;
			}
			const adopted = { id: FIRST_PAGE_ID, title: title ?? pageTitle(FIRST_PAGE_ID) };
			await writeProjectFile(workspaceRoot, {
				...project,
				openPageId: FIRST_PAGE_ID,
				pages: [adopted],
			});
			return adopted;
		},
	});
	if (page === undefined) {
		return undefined;
	}
	return {
		page,
		artboardId: DEFAULT_ARTBOARD_ID,
		generation: artboard.generation,
		hash: artboard.hash,
	};
};

const assertRoomForPage = (project: Project): void => {
	if (project.pages.length >= MAX_PAGES) {
		throw new InvalidArgsError(`A project holds at most ${MAX_PAGES} pages. Delete a page first.`);
	}
};

// Claims the next id, writes its default artboard, then appends and opens it under the lock. An
// index rebuilt meanwhile (project.json deleted) may already list the claimed id: that entry is
// retitled and opened, never listed twice.
// ponytail: any failure after the folder claim leaves an orphan pages/page-<n>/ (never reused; an
// index rebuild lists it as "Page <n>"), and repeated WORKSPACE_BUSY at the index write piles them
// up, each with a default artboard. Upgrade path: remove the claimed folder when the locked index
// write fails before it writes.
const appendNewPage = async ({
	workspaceRoot,
	title,
	project,
}: {
	workspaceRoot: string;
	title: string | undefined;
	project: Project;
}): Promise<CreatePageResult> => {
	assertRoomForPage(project);
	const pageId = await claimPageFolder(workspaceRoot);
	const artboard = await createDefaultArtboard(workspaceRoot, pageId);
	const page = await withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const current = await requireProject(workspaceRoot);
			const rebuilt = current.pages.find(({ id }) => id === pageId);
			if (rebuilt === undefined) {
				assertRoomForPage(current);
			}
			const created = { id: pageId, title: title ?? rebuilt?.title ?? pageTitle(pageId) };
			await writeProjectFile(workspaceRoot, {
				...current,
				openPageId: pageId,
				pages:
					rebuilt === undefined
						? [...current.pages, created]
						: current.pages.map((listed) => (listed.id === pageId ? created : listed)),
			});
			return created;
		},
	});
	return {
		page,
		artboardId: DEFAULT_ARTBOARD_ID,
		generation: artboard.generation,
		hash: artboard.hash,
	};
};

// A page with one blank artboard, opened. In a folder never opened it fills the blank page-1
// instead of adding an empty extra page. Resolves first, so never call it inside withWorkspaceLock.
export const createPage = async ({
	workspaceRoot,
	title,
	writeEnsurePanelMarker,
}: {
	workspaceRoot: string;
	// The caller parsed it (parsePageTitle at the boundary).
	title?: string;
	writeEnsurePanelMarker: boolean;
}): Promise<CreatePageResult> => {
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	const project = await requireProject(workspaceRoot);
	const adopted = (await isBlankFirstPage(workspaceRoot, project))
		? await adoptBlankFirstPage({ workspaceRoot, title })
		: undefined;
	const result = adopted ?? (await appendNewPage({ workspaceRoot, title, project }));
	// After the index write, so the panel never opens for an unindexed page.
	if (writeEnsurePanelMarker) {
		try {
			await writeEnsurePanelFile(workspaceRoot);
		} catch (error: unknown) {
			// ponytail: the page is created and open, and an error would make the Agent retry into a
			// second page; the panel just may not open. Upgrade path: report panelEnsured in the result.
			logStderr('create_page .ensure-panel', error);
		}
	}
	return result;
};

// The caller checked isPageId. Resolves first, so never call it inside withWorkspaceLock.
export const openPage = async ({
	workspaceRoot,
	pageId,
}: {
	workspaceRoot: string;
	pageId: string;
}): Promise<{ page: PageSummary }> => {
	await resolveOpenPage({ workspaceRoot, createIfFresh: false });
	// Lock-free first: in a fresh folder the lock would create an empty .vibeboard/.
	listedPage(await readProjectFile(workspaceRoot), pageId);
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const { project, entry } = listedPage(await readProjectFile(workspaceRoot), pageId);
			if (!(await pageFolderExists(workspaceRoot, pageId))) {
				throw new PageNotFoundError(pageId);
			}
			if (project.openPageId !== pageId) {
				await writeProjectFile(workspaceRoot, { ...project, openPageId: pageId });
			}
			return { page: { id: entry.id, title: entry.title } };
		},
	});
};

// Retitles an indexed page; id and folder stay. Never resolves (the 10d host resolved first).
export const renamePage = async ({
	workspaceRoot,
	pageId: rawPageId,
	title: rawTitle,
}: {
	workspaceRoot: string;
	pageId: unknown;
	title: unknown;
}): Promise<{ page: PageSummary }> => {
	const pageId = requirePageId(rawPageId);
	const title = parsePageTitle(rawTitle);
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const { project, entry } = listedPage(await readProjectFile(workspaceRoot), pageId);
			if (entry.title !== title) {
				await writeProjectFile(workspaceRoot, {
					...project,
					pages: project.pages.map((listed) =>
						listed.id === pageId ? { id: pageId, title } : listed,
					),
				});
			}
			return { page: { id: pageId, title } };
		},
	});
};

// Unlists the page, then moves its folder to deleted/<id>-<stamp>/. Never resolves (the 10d host
// resolved first). An open page hands off to its previous neighbour, else the next.
export const deletePage = async ({
	workspaceRoot,
	pageId: rawPageId,
	now,
}: {
	workspaceRoot: string;
	pageId: unknown;
	now: Date;
}): Promise<{ deletedPageId: string; openPageId: string }> => {
	const pageId = requirePageId(rawPageId);
	return withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			const { project } = listedPage(await readProjectFile(workspaceRoot), pageId);
			if (project.pages.length === 1) {
				throw new InvalidArgsError('The last page cannot be deleted.');
			}
			// Before the index write: a file or symlink at deleted/ fails with nothing changed.
			await makeLayoutDir({ workspaceRoot, segments: deletedDirSegments, recursive: false });
			const index = project.pages.findIndex(({ id }) => id === pageId);
			const pages = project.pages.filter(({ id }) => id !== pageId);
			const neighbour = pages[index - 1] ?? pages[index];
			const openPageId =
				project.openPageId === pageId ? (neighbour?.id ?? project.openPageId) : project.openPageId;
			await writeProjectFile(workspaceRoot, { ...project, openPageId, pages });
			try {
				await rename(
					workspaceJoin(workspaceRoot, pageDirSegments(pageId)),
					workspaceJoin(workspaceRoot, deletedPageDirSegments(pageId, compactIsoTime(now))),
				);
			} catch (error: unknown) {
				// ponytail: the page is already unlisted, so a failed move leaves an unindexed orphan in
				// pages/ (its id is still never reused). Upgrade path: retry the move on the next delete.
				logStderr(`page ${pageId} move to ${deletedDirSegments.join('/')}`, error);
			}
			return { deletedPageId: pageId, openPageId };
		},
	});
};
