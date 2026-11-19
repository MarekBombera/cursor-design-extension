import { type CanvasView, type CanvasViewFrame } from '../disk/artboardFs';
import { cachedArtboardDocument } from '../disk/commentViews';
import { ArtboardNotFoundError, DiskError } from '../disk/errors';
import { sourceTaggedHtml } from '../disk/sourceTags';
import type { PostedCanvasFrame } from '../webview/hostMessages';

export const UNTRUSTED_WORKSPACE_MESSAGE =
	'This workspace is not trusted. Cursor Design will not write files or preview artboard HTML.';

// ponytail: 1.5M char ceiling per frame on the disk HTML; the posted copy is larger, since source
// tags add about 17 or more chars per element: up to about 8x for a file of bare tiny tags
// (1.5M chars of `<p>` posts about 12M). No total payload cap across frames.
export const MAX_POSTED_ARTBOARD_HTML_CHARS = 1_500_000;
export const ARTBOARD_HTML_TOO_LARGE_MESSAGE =
	'Artboard HTML is too large to preview in the panel.';

export type CanvasSnapshot = {
	activeArtboardId: string;
	generation: number;
	frames: CanvasViewFrame[];
	handoffStale: boolean;
	errorMessage?: string;
};

export const emptyArtboardSnapshot = (errorMessage?: string): CanvasSnapshot => ({
	activeArtboardId: '',
	generation: 0,
	frames: [],
	handoffStale: false,
	errorMessage,
});

// The last posted copy per workspace and frame, reused while the disk HTML is identical, so an
// unchanged frame is never re-parsed or re-tagged on a watcher event.
// ponytail: a changed frame (and every frame on the first load) is parsed and tagged synchronously
// on the extension host thread; a pathological 1.5M-char file costs about 0.5 s. Upgrade path:
// parse and tag in a worker thread.
const taggedFrames = new Map<string, { html: string; posted: string }>();

// What the panel gets for each frame: the size cap on the disk HTML, then source tags. A tagging
// failure is reported once per HTML and posts the untagged copy; the stage keeps every frame.
export const panelFrames = ({
	workspaceRoot,
	frames,
	onTagError,
}: {
	workspaceRoot: string;
	frames: readonly CanvasViewFrame[];
	onTagError: (frameId: string, error: unknown) => void;
}): CanvasViewFrame[] => {
	const keys = new Set<string>();
	const posted = frames.map((frame) => {
		const key = `${workspaceRoot}\0${frame.id}`;
		keys.add(key);
		if (frame.html.length > MAX_POSTED_ARTBOARD_HTML_CHARS) {
			return { ...frame, html: '', errorMessage: ARTBOARD_HTML_TOO_LARGE_MESSAGE };
		}
		if (frame.errorMessage !== undefined || frame.html === '') {
			return { ...frame };
		}
		const memo = taggedFrames.get(key);
		if (memo?.html === frame.html) {
			return { ...frame, html: memo.posted };
		}
		let html = frame.html;
		try {
			html = sourceTaggedHtml({
				html: frame.html,
				document: cachedArtboardDocument({ workspaceRoot, frameId: frame.id, html: frame.html }),
			});
		} catch (error: unknown) {
			onTagError(frame.id, error);
		}
		taggedFrames.set(key, { html: frame.html, posted: html });
		return { ...frame, html };
	});
	for (const key of taggedFrames.keys()) {
		if (!keys.has(key)) {
			taggedFrames.delete(key);
		}
	}
	return posted;
};

// Frames arrive capped and tagged by panelFrames; this only maps the fields.
export const postedFrameFromSnapshot = (frame: CanvasViewFrame): PostedCanvasFrame => {
	const posted: PostedCanvasFrame = {
		id: frame.id,
		label: frame.label,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		generation: frame.generation,
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
