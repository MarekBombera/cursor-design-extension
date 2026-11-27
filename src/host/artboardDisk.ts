import { checkedPanelMessage } from './panelRequest';
import {
	canvasSnapshotErrorMessage,
	canvasViewReadLogs,
	emptyArtboardSnapshot,
	panelFrames,
	UNTRUSTED_WORKSPACE_MESSAGE,
	type CanvasSnapshot,
} from './canvasSnapshot';
import { createArtboard, placeFrame, setActiveArtboard } from '../disk/artboardFs';
import { type CanvasView, readCanvasView } from '../disk/canvasView';
import { ArtboardExistsError, PageNotFoundError, toSafeArtboardErrorMessage } from '../disk/errors';
import {
	DEFAULT_ARTBOARD_HTML,
	DEFAULT_ARTBOARD_ID,
	manifestPathSegments,
	projectPathSegments,
} from '../disk/layout';
import {
	type PageLocation,
	lstatOrUndefined,
	pageFolderExists,
	workspaceJoin,
} from '../disk/layoutFs';
import { resolveOpenPage, resolveRequestedPage } from '../disk/openPage';
import { listPages } from '../disk/pageOps';
import type { PanelPorts } from '../panel/openArtboardPanel';
import type { PostedPage } from '../webview/hostMessages';
import { PAGE_GONE_MESSAGE } from './panelRequestCopy';

// No manifest yet: create the default artboard, or make an existing artboard.html active.
// Goes through the disk lib so the host gets the same symlink and ownership checks as MCP.
const initializeDefaultArtboard = async (page: PageLocation): Promise<void> => {
	try {
		await createArtboard({
			page,
			artboardId: DEFAULT_ARTBOARD_ID,
			html: DEFAULT_ARTBOARD_HTML,
			writeEnsurePanelMarker: false,
		});
	} catch (error: unknown) {
		if (!(error instanceof ArtboardExistsError)) {
			throw error;
		}
		await setActiveArtboard({ page, artboardId: DEFAULT_ARTBOARD_ID });
	}
};

const logCanvasViewReadErrors = ({
	view,
	ports,
}: {
	view: CanvasView;
	ports: PanelPorts;
}): void => {
	for (const readLog of canvasViewReadLogs(view)) {
		ports.log(readLog.scope, readLog.tileMessage);
		if (readLog.error !== undefined) {
			ports.log(readLog.scope, readLog.error);
		}
	}
};

const snapshotFromCanvasView = async ({
	page,
	ports,
}: {
	page: PageLocation;
	ports: PanelPorts;
}): Promise<Omit<CanvasSnapshot, 'pages'>> => {
	const view = await readCanvasView({ page });
	logCanvasViewReadErrors({ view, ports });
	const activeFrame = view.frames.find((frame) => frame.id === view.activeArtboardId);
	const errorMessage = canvasSnapshotErrorMessage({
		activeArtboardId: view.activeArtboardId,
		frames: view.frames,
		layoutErrorMessage: view.layoutErrorMessage,
	});

	return {
		pageId: page.pageId,
		activeArtboardId: view.activeArtboardId,
		generation: activeFrame?.generation ?? 0,
		// Same root and page as panelComments' readComments, so the shared parse cache keys match.
		frames: panelFrames({
			workspaceRoot: page.workspaceRoot,
			pageId: page.pageId,
			frames: view.frames,
			onTagError: (frameId, error) => {
				ports.log(`artboardDisk.sourceTags:${frameId}`, error);
			},
		}),
		handoffStale: view.handoffStale,
		errorMessage,
	};
};

const readOpenPageSnapshot = async ({
	ports,
	page,
	initializeWhenMissing,
}: {
	ports: PanelPorts;
	page: PageLocation;
	initializeWhenMissing: boolean;
}): Promise<Omit<CanvasSnapshot, 'pages'>> => {
	// ponytail: lstat does not follow a symlink, so a dangling symlinked manifest.json counts as
	// present: the page reads as an empty stage or the manifest ownership error instead of failing
	// Open. Upgrade path: refuse a symlinked manifest here.
	if (
		(await lstatOrUndefined(
			workspaceJoin(page.workspaceRoot, manifestPathSegments(page.pageId)),
		)) === undefined
	) {
		if (!initializeWhenMissing) {
			// An indexed page whose folder is gone is an error. Only a fresh folder resolves with
			// no project.json, and it stays an empty stage.
			if (
				!(await pageFolderExists(page.workspaceRoot, page.pageId)) &&
				(await lstatOrUndefined(workspaceJoin(page.workspaceRoot, projectPathSegments))) !==
					undefined
			) {
				throw new PageNotFoundError(page.pageId);
			}
			return { ...emptyArtboardSnapshot(), pageId: page.pageId };
		}
		await initializeDefaultArtboard(page);
	}
	return await snapshotFromCanvasView({ page, ports });
};

// A list failure never fails the snapshot: it is logged and lists nothing.
const readPostedPages = async ({
	page,
	ports,
}: {
	page: PageLocation;
	ports: PanelPorts;
}): Promise<PostedPage[]> => {
	try {
		return (await listPages({ workspaceRoot: page.workspaceRoot })).pages;
	} catch (error: unknown) {
		ports.log('artboardDisk.listPages', error);
		return [];
	}
};

type WorkspaceDiskArgs = { workspaceRoot: string; ports: PanelPorts };

type LoadActiveSnapshotArgs = WorkspaceDiskArgs & {
	scope: string;
	initializeWhenMissing: boolean;
};

const loadActiveSnapshot = async ({
	workspaceRoot,
	ports,
	scope,
	initializeWhenMissing,
}: LoadActiveSnapshotArgs): Promise<CanvasSnapshot> => {
	if (!ports.isTrusted()) {
		// No frames are posted, so drop every tagged copy the memo still holds.
		panelFrames({
			workspaceRoot,
			pageId: '',
			frames: [],
			onTagError: () => {},
		});
		return emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE);
	}

	const failed = (error: unknown): CanvasSnapshot => {
		ports.log(scope, error);
		return emptyArtboardSnapshot(toSafeArtboardErrorMessage(error));
	};
	// Resolved outside the read's try, so a read failure still names the page it came from.
	let page: PageLocation;
	try {
		page = await resolveOpenPage({ workspaceRoot, createIfFresh: initializeWhenMissing });
	} catch (error: unknown) {
		return failed(error);
	}
	let snapshot: Omit<CanvasSnapshot, 'pages'>;
	try {
		snapshot = await readOpenPageSnapshot({ ports, page, initializeWhenMissing });
	} catch (error: unknown) {
		snapshot = { ...failed(error), pageId: page.pageId };
	}
	// Listed after the read (and any initialize), so a just-created page has its time; a failed
	// read still lists, so the Pages menu offers a way off a broken page.
	return { ...snapshot, pages: await readPostedPages({ page, ports }) };
};

export const initAndLoadArtboard = async (args: WorkspaceDiskArgs): Promise<CanvasSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.initAndLoad', initializeWhenMissing: true });

export const readActiveArtboardFromDisk = async (
	args: WorkspaceDiskArgs,
): Promise<CanvasSnapshot> =>
	loadActiveSnapshot({ ...args, scope: 'artboardDisk.readActive', initializeWhenMissing: false });

const MALFORMED_FRAME_PLACE_MESSAGE = 'Could not move the frame. Try again.';

// Panel drag/resize commit. Never rejects: returns the error copy for the banner, or undefined;
// the caller refreshes the panel after it.
export const placeFrameFromChrome = async ({
	value,
	ports,
}: {
	value: unknown;
	ports: PanelPorts;
}): Promise<string | undefined> => {
	try {
		let refusedMessage: string | undefined;
		const checked = checkedPanelMessage({
			value,
			type: 'frame:place',
			malformedMessage: MALFORMED_FRAME_PLACE_MESSAGE,
			refuse: (message, error) => {
				ports.log('artboardDisk.placeFrame', error);
				refusedMessage = message;
			},
			ports,
		});
		if (checked === undefined) {
			return refusedMessage;
		}
		const { workspaceRoot, message } = checked;
		try {
			await placeFrame({
				page: await resolveRequestedPage({ workspaceRoot, pageId: message.pageId }),
				id: message.id,
				x: message.x,
				y: message.y,
				width: message.width,
				base: message.base,
			});
			return undefined;
		} catch (error: unknown) {
			ports.log('artboardDisk.placeFrame', error);
			// ponytail: a gone requested page is never the open page, so this banner shows over the
			// open page's snapshot and names no page. Upgrade path: 10d's page menu names it.
			return error instanceof PageNotFoundError
				? PAGE_GONE_MESSAGE
				: toSafeArtboardErrorMessage(error);
		}
	} catch (error: unknown) {
		ports.log('artboardDisk.placeFrameFromChrome', error);
		return toSafeArtboardErrorMessage(error);
	}
};
