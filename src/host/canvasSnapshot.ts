import { type CanvasView, type CanvasViewFrame } from '../disk/canvasView';
import { cachedArtboardDocument, frameCacheKey } from '../disk/commentViews';
import { ArtboardNotFoundError, DiskError } from '../disk/errors';
import { MAX_POSTED_ARTBOARD_HTML_CHARS } from '../disk/layout';
import { sourceTaggedHtml } from '../disk/sourceTags';
import type { PostedCanvasFrame } from '../webview/hostMessages';

export const UNTRUSTED_WORKSPACE_MESSAGE =
	'This workspace is not trusted. Cursor Design will not write files or preview artboard HTML.';

const ARTBOARD_HTML_TOO_LARGE_MESSAGE = 'Artboard HTML is too large to preview in the panel.';

export type CanvasSnapshot = {
	// The page the snapshot was read from; '' when no page was resolved (never with frames).
	pageId: string;
	activeArtboardId: string;
	generation: number;
	frames: CanvasViewFrame[];
	handoffStale: boolean;
	errorMessage?: string;
};

export const emptyArtboardSnapshot = (errorMessage?: string): CanvasSnapshot => ({
	pageId: '',
	activeArtboardId: '',
	generation: 0,
	frames: [],
	handoffStale: false,
	errorMessage,
});

// The last posted copy per workspace, page and frame, reused while the disk HTML is identical, so an
// unchanged frame is never re-parsed or re-tagged on a watcher event.
// ponytail: a changed frame (and every frame on the first load) is parsed and tagged synchronously
// on the extension host thread; a pathological 1.5M-char file costs about 0.5 s. Upgrade path:
// parse and tag in a worker thread.
const taggedFrames = new Map<string, { html: string; posted: string }>();

// Seeds the memo, so the next panelFrames call with the same disk HTML (the watcher echo after an
// edit) posts this exact string. A tagging failure is reported once per HTML and posts untagged.
export const panelFrameHtml = ({
	workspaceRoot,
	pageId,
	frameId,
	html,
	onTagError,
}: {
	workspaceRoot: string;
	pageId: string;
	frameId: string;
	html: string;
	onTagError: (frameId: string, error: unknown) => void;
}): { html: string; errorMessage?: string } => {
	if (html.length > MAX_POSTED_ARTBOARD_HTML_CHARS) {
		return { html: '', errorMessage: ARTBOARD_HTML_TOO_LARGE_MESSAGE };
	}
	const key = frameCacheKey({ workspaceRoot, pageId, frameId });
	const memo = taggedFrames.get(key);
	if (memo?.html === html) {
		return { html: memo.posted };
	}
	let posted = html;
	try {
		posted = sourceTaggedHtml({
			html,
			document: cachedArtboardDocument({ workspaceRoot, pageId, frameId, html }),
		});
	} catch (error: unknown) {
		onTagError(frameId, error);
	}
	taggedFrames.set(key, { html, posted });
	return { html: posted };
};

// Every frame stays on the stage; memo entries of frames no longer posted are dropped.
export const panelFrames = ({
	workspaceRoot,
	pageId,
	frames,
	onTagError,
}: {
	workspaceRoot: string;
	pageId: string;
	frames: readonly CanvasViewFrame[];
	onTagError: (frameId: string, error: unknown) => void;
}): CanvasViewFrame[] => {
	const keys = new Set<string>();
	const posted = frames.map((frame) => {
		keys.add(frameCacheKey({ workspaceRoot, pageId, frameId: frame.id }));
		// Size cap first: an over-cap frame is the too-large tile whatever else it carries.
		if (
			frame.html.length <= MAX_POSTED_ARTBOARD_HTML_CHARS &&
			(frame.errorMessage !== undefined || frame.html === '')
		) {
			return { ...frame };
		}
		return {
			...frame,
			...panelFrameHtml({
				workspaceRoot,
				pageId,
				frameId: frame.id,
				html: frame.html,
				onTagError,
			}),
		};
	});
	for (const key of taggedFrames.keys()) {
		if (!keys.has(key)) {
			taggedFrames.delete(key);
		}
	}
	return posted;
};

// The outbox adds the history flags at send time.
export type UnflaggedPostedFrame = Omit<PostedCanvasFrame, 'canUndo' | 'canRedo'>;

// Frames arrive capped and tagged by panelFrames; this only maps the fields.
export const postedFrameFromSnapshot = (frame: CanvasViewFrame): UnflaggedPostedFrame => {
	const posted: UnflaggedPostedFrame = {
		id: frame.id,
		label: frame.label,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		generation: frame.generation,
		hash: frame.hash,
		html: frame.html,
	};
	if (frame.group !== undefined) {
		posted.group = frame.group;
	}
	if (frame.errorMessage !== undefined) {
		posted.errorMessage = frame.errorMessage;
	}
	return posted;
};

type CanvasSnapshotErrorMessageArgs = {
	activeArtboardId: string;
	frames: ReadonlyArray<{ id: string }>;
	layoutErrorMessage?: string;
};

export const canvasSnapshotErrorMessage = ({
	activeArtboardId,
	frames,
	layoutErrorMessage,
}: CanvasSnapshotErrorMessageArgs): string | undefined => {
	if (activeArtboardId !== '' && frames.every((frame) => frame.id !== activeArtboardId)) {
		return new ArtboardNotFoundError(activeArtboardId).message;
	}
	return layoutErrorMessage;
};

export type CanvasViewReadLog = {
	scope: string;
	tileMessage: string;
	error?: DiskError;
};

export const canvasViewReadLogs = (view: CanvasView): CanvasViewReadLog[] => {
	const errorsById = new Map(
		(view.htmlReadErrors ?? []).map((entry) => [entry.artboardId, entry.error]),
	);
	const logs: CanvasViewReadLog[] = [];
	for (const frame of view.frames) {
		if (frame.errorMessage === undefined) {
			continue;
		}
		const readError = errorsById.get(frame.id);
		const log: CanvasViewReadLog = {
			scope: `artboardDisk.frameRead:${frame.id}`,
			tileMessage: frame.errorMessage,
		};
		if (readError !== undefined) {
			log.error = readError;
		}
		logs.push(log);
	}
	return logs;
};
