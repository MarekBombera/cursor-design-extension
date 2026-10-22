import { type CanvasView, type CanvasViewFrame } from '../disk/artboardFs';
import { ArtboardNotFoundError, DiskError } from '../disk/errors';
import type { PostedCanvasFrame } from '../webview/hostMessages';

export const UNTRUSTED_WORKSPACE_MESSAGE =
	'This workspace is not trusted. Cursor Design will not write files or preview artboard HTML.';

// ponytail: 1.5M char ceiling per frame; no total payload cap across frames
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

type SnapshotForChromeArgs = {
	snapshot: CanvasSnapshot;
	isTrusted: boolean;
};

export const snapshotForChrome = ({
	snapshot,
	isTrusted,
}: SnapshotForChromeArgs): CanvasSnapshot => {
	if (isTrusted) {
		return snapshot;
	}
	return {
		...snapshot,
		frames: [],
		errorMessage: snapshot.errorMessage ?? UNTRUSTED_WORKSPACE_MESSAGE,
	};
};

export const postedFrameFromSnapshot = (frame: CanvasViewFrame): PostedCanvasFrame => {
	const htmlTooLarge = frame.html.length > MAX_POSTED_ARTBOARD_HTML_CHARS;
	const posted: PostedCanvasFrame = {
		id: frame.id,
		label: frame.label,
		x: frame.x,
		y: frame.y,
		width: frame.width,
		html: htmlTooLarge ? '' : frame.html,
	};
	if (frame.group !== undefined) {
		posted.group = frame.group;
	}
	if (htmlTooLarge) {
		posted.errorMessage = ARTBOARD_HTML_TOO_LARGE_MESSAGE;
	} else if (frame.errorMessage !== undefined) {
		posted.errorMessage = frame.errorMessage;
	}
	return posted;
};

type CanvasSnapshotErrorMessageArgs = {
	loadErrorMessage?: string;
	activeArtboardId: string;
	frames: ReadonlyArray<{ id: string }>;
	layoutErrorMessage?: string;
};

export const canvasSnapshotErrorMessage = ({
	loadErrorMessage,
	activeArtboardId,
	frames,
	layoutErrorMessage,
}: CanvasSnapshotErrorMessageArgs): string | undefined => {
	if (loadErrorMessage !== undefined) {
		return loadErrorMessage;
	}
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
