import type { EditRefusal } from './artboardEdit';
import {
	ARTBOARDS_DIR,
	CANVAS_SCHEMA_VERSION,
	COMMENTS_SCHEMA_VERSION,
	PROJECT_SCHEMA_VERSION,
	type PageEntry,
	SCHEMA_VERSION,
	artboardMetaPathSegments,
	canvasPathSegments,
	commentsPathSegments,
	manifestPathSegments,
	pageDirSegments,
	pageEntrySegments,
	projectPathSegments,
	rootEntrySegments,
} from './layout';

export abstract class VibeboardError extends Error {
	abstract readonly code: string;
}

// Our authored copy for a domain error; the fallback for anything else (it may carry a path).
export const toSafeArtboardErrorMessage = (
	error: unknown,
	fallback = 'Could not load artboard. Check the Output panel: Vibeboard.',
): string => (error instanceof VibeboardError ? error.message : fallback);

export const isErrno = (error: unknown, code: string): boolean =>
	typeof error === 'object' &&
	error !== null &&
	'code' in error &&
	(error as { code: unknown }).code === code;

export class InvalidArtboardIdError extends VibeboardError {
	readonly code = 'INVALID_ARTBOARD_ID' as const;

	constructor(
		readonly artboardId: string,
		options?: { cause?: unknown },
	) {
		super('Artboard id is invalid. Use only letters, digits, dot, underscore, or hyphen.', options);
		this.name = 'InvalidArtboardIdError';
	}
}

export class CorruptManifestError extends VibeboardError {
	readonly code = 'CORRUPT_MANIFEST' as const;

	readonly pageId: string;

	constructor({ pageId }: { pageId: string }, options?: { cause?: unknown }) {
		super(
			`Artboard manifest is invalid. Fix or restore ${manifestPathSegments(pageId).join('/')} (version ${SCHEMA_VERSION}).`,
			options,
		);
		this.name = 'CorruptManifestError';
		this.pageId = pageId;
	}
}

export class UnsupportedSchemaVersionError extends VibeboardError {
	readonly code = 'UNSUPPORTED_SCHEMA_VERSION' as const;

	readonly pageId: string;

	readonly version: number;

	constructor(
		{ pageId, version }: { pageId: string; version: number },
		options?: { cause?: unknown },
	) {
		super(
			`Artboard manifest version ${version} is unsupported. Expected version ${SCHEMA_VERSION}. Fix or restore ${manifestPathSegments(pageId).join('/')}.`,
			options,
		);
		this.name = 'UnsupportedSchemaVersionError';
		this.pageId = pageId;
		this.version = version;
	}
}

export class CorruptCanvasError extends VibeboardError {
	readonly code = 'CORRUPT_CANVAS' as const;

	readonly pageId: string;

	constructor({ pageId }: { pageId: string }, options?: { cause?: unknown }) {
		super(
			`Canvas layout is invalid. Fix or restore ${canvasPathSegments(pageId).join('/')} (version ${CANVAS_SCHEMA_VERSION}), or delete it to auto-place every frame.`,
			options,
		);
		this.name = 'CorruptCanvasError';
		this.pageId = pageId;
	}
}

export class UnsupportedCanvasVersionError extends VibeboardError {
	readonly code = 'UNSUPPORTED_CANVAS_VERSION' as const;

	readonly pageId: string;

	readonly version: number;

	constructor(
		{ pageId, version }: { pageId: string; version: number },
		options?: { cause?: unknown },
	) {
		super(
			`Canvas layout version ${version} is unsupported (expected ${CANVAS_SCHEMA_VERSION}). Fix ${canvasPathSegments(pageId).join('/')} or delete it to auto-place every frame.`,
			options,
		);
		this.name = 'UnsupportedCanvasVersionError';
		this.pageId = pageId;
		this.version = version;
	}
}

export class CorruptMetaError extends VibeboardError {
	readonly code = 'CORRUPT_META' as const;

	readonly pageId: string;

	readonly artboardId: string;

	constructor(
		{ pageId, artboardId }: { pageId: string; artboardId: string },
		options?: { cause?: unknown },
	) {
		super(
			`Artboard "${artboardId}" meta is invalid. Restore ${artboardMetaPathSegments(pageId, artboardId).join('/')} or set_artboard a new id.`,
			options,
		);
		this.name = 'CorruptMetaError';
		this.pageId = pageId;
		this.artboardId = artboardId;
	}
}

export class InvalidArgsError extends VibeboardError {
	readonly code = 'INVALID_ARGS' as const;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'InvalidArgsError';
	}
}

export class ArtboardExistsError extends VibeboardError {
	readonly code = 'ARTBOARD_EXISTS' as const;

	constructor(
		readonly artboardId: string,
		options?: { cause?: unknown },
	) {
		super(
			`Artboard "${artboardId}" already exists. Call update_artboard or use a new id.`,
			options,
		);
		this.name = 'ArtboardExistsError';
	}
}

export class ArtboardNotFoundError extends VibeboardError {
	readonly code = 'ARTBOARD_NOT_FOUND' as const;

	constructor(
		readonly artboardId: string,
		options?: { cause?: unknown },
	) {
		super(
			artboardId.length === 0
				? 'Artboard not found. Call list_artboards, then set_artboard or set_active_artboard.'
				: `Artboard "${artboardId}" not found. Call list_artboards, then set_artboard or set_active_artboard.`,
			options,
		);
		this.name = 'ArtboardNotFoundError';
	}
}

// Export has nothing to write: no artboards dir, or no artboard files. Same code as not-found.
export class NoArtboardsToExportError extends VibeboardError {
	readonly code = 'ARTBOARD_NOT_FOUND' as const;

	constructor(options?: { cause?: unknown }) {
		super('No artboards to export. Ask the agent to `set_artboard` first.', options);
		this.name = 'NoArtboardsToExportError';
	}
}

export class NoWorkspaceError extends VibeboardError {
	readonly code = 'NO_WORKSPACE' as const;

	constructor(options?: { cause?: unknown }) {
		super('No workspace folder is available. Open a workspace folder.', options);
		this.name = 'NoWorkspaceError';
	}
}

export class InvalidRootError extends VibeboardError {
	readonly code = 'INVALID_ROOT' as const;

	constructor(
		readonly roots: readonly string[],
		options?: { cause?: unknown },
	) {
		super(
			'rootPath is not an open workspace folder. Retry with rootPath set to one of roots.',
			options,
		);
		this.name = 'InvalidRootError';
	}
}

export class DiskError extends VibeboardError {
	readonly code = 'DISK_ERROR' as const;

	constructor(message?: string | { cause?: unknown }, options?: { cause?: unknown }) {
		const authoredMessage =
			typeof message === 'string'
				? message
				: 'Could not read or write artboard files. Check Output/stderr; fix folder permissions.';
		super(authoredMessage, typeof message === 'string' ? options : message);
		this.name = 'DiskError';
	}
}

export type ConflictCompared = {
	expectedGeneration?: number;
	actualGeneration?: number;
	expectedHash?: string;
	actualHash?: string;
};

export class ConflictError extends VibeboardError {
	readonly code = 'conflict' as const;

	constructor(
		readonly artboardId: string,
		readonly compared: ConflictCompared,
		options?: { cause?: unknown },
	) {
		super(
			`Artboard "${artboardId}" is stale. Call read_artboard, then retry update_artboard with the current baseGeneration.`,
			options,
		);
		this.name = 'ConflictError';
	}
}

export class LockTimeoutError extends VibeboardError {
	readonly code = 'WORKSPACE_BUSY' as const;

	constructor(options?: { cause?: unknown }) {
		super('Another Vibeboard write is in progress. Retry in a moment.', options);
		this.name = 'LockTimeoutError';
	}
}

// The panel's frame:place base no longer matches disk (the Agent or another write moved it).
export class FrameMovedError extends VibeboardError {
	readonly code = 'FRAME_MOVED' as const;

	constructor(
		readonly frameId: string,
		options?: { cause?: unknown },
	) {
		super('This frame moved while you were dragging it. Showing its current position.', options);
		this.name = 'FrameMovedError';
	}
}

export class CorruptCommentsError extends VibeboardError {
	readonly code = 'CORRUPT_COMMENTS' as const;

	readonly pageId: string;

	constructor({ pageId }: { pageId: string }, options?: { cause?: unknown }) {
		super(
			`Comments file is invalid. Fix or restore ${commentsPathSegments(pageId).join('/')} (version ${COMMENTS_SCHEMA_VERSION}), or delete it to drop every comment.`,
			options,
		);
		this.name = 'CorruptCommentsError';
		this.pageId = pageId;
	}
}

export class UnsupportedCommentsVersionError extends VibeboardError {
	readonly code = 'UNSUPPORTED_COMMENTS_VERSION' as const;

	readonly pageId: string;

	readonly version: number;

	constructor(
		{ pageId, version }: { pageId: string; version: number },
		options?: { cause?: unknown },
	) {
		super(
			`Comments file version ${version} is unsupported (expected ${COMMENTS_SCHEMA_VERSION}). Update the vibeboard extension, or fix ${commentsPathSegments(pageId).join('/')}.`,
			options,
		);
		this.name = 'UnsupportedCommentsVersionError';
		this.pageId = pageId;
		this.version = version;
	}
}

export class CommentNotFoundError extends VibeboardError {
	readonly code = 'COMMENT_NOT_FOUND' as const;

	// found: the id is on another, unopened page (the Agent's get_comment / resolve_comment hint).
	constructor({
		found,
		...options
	}: {
		found?: { id: string; pageId: string; tool: 'get_comment' | 'resolve_comment' };
		cause?: unknown;
	} = {}) {
		super(
			found === undefined
				? 'Comment not found. Call list_comments to see current comment ids.'
				: `Comment "${found.id}" is on page ${found.pageId}, which is not open. Call open_page("${found.pageId}"), then ${found.tool} again.`,
			options,
		);
		this.name = 'CommentNotFoundError';
	}
}

export class CommentResolvedError extends VibeboardError {
	readonly code = 'COMMENT_RESOLVED' as const;

	constructor(options?: { cause?: unknown }) {
		super(
			"Comment is already resolved. Call list_comments({ status: 'open' }) for open work.",
			options,
		);
		this.name = 'CommentResolvedError';
	}
}

// The panel's comment pick no longer matches the artboard's generation on disk.
export class PickOutdatedError extends VibeboardError {
	readonly code = 'PICK_OUTDATED' as const;

	constructor(
		readonly frameId: string,
		options?: { cause?: unknown },
	) {
		super('This artboard changed since the element was picked. Pick it again.', options);
		this.name = 'PickOutdatedError';
	}
}

// Why an Edit-mode change was refused: the edit core's refusal, or the file is (or the edit would
// make it) larger than the panel previews.
export type EditRefusedReason = EditRefusal | 'too-large';

// Panel copy: only the panel's edit path throws EditRefusedError.
const EDIT_REFUSED_MESSAGES: Record<EditRefusedReason, string> = {
	'unknown-number': 'This element cannot be edited here. Ask the Agent to change it.',
	'shared-number': 'This element cannot be edited here. Ask the Agent to change it.',
	'not-plain-text': 'This element contains other elements. Ask the Agent to change its text.',
	'text-changed': 'A script on the page changed this text. Ask the Agent to change it.',
	'invalid-value': 'That value cannot be saved. Check it and try again.',
	'unsupported-style': "This element's style cannot be edited here. Ask the Agent to change it.",
	'too-large': 'This artboard is too large to edit here. Ask the Agent to change it.',
};

export class EditRefusedError extends VibeboardError {
	readonly code = 'EDIT_REFUSED' as const;

	constructor(
		readonly reason: EditRefusedReason,
		options?: { cause?: unknown },
	) {
		super(EDIT_REFUSED_MESSAGES[reason], options);
		this.name = 'EditRefusedError';
	}
}

export class PageNotFoundError extends VibeboardError {
	readonly code = 'PAGE_NOT_FOUND' as const;

	// noFolder: indexed but its folder is gone; unlisted: project.json does not list the id.
	readonly reason: 'noFolder' | 'unlisted';

	constructor(
		readonly pageId: string,
		{ reason = 'noFolder', ...options }: { reason?: 'noFolder' | 'unlisted'; cause?: unknown } = {},
	) {
		super(
			reason === 'unlisted'
				? `Page "${pageId}" does not exist. Call list_pages for the page ids.`
				: `Page "${pageId}" has no folder. Restore ${pageDirSegments(pageId).join('/')}/, or delete ${projectPathSegments.join('/')} to rebuild the page list from the page folders.`,
			options,
		);
		this.reason = reason;
		this.name = 'PageNotFoundError';
	}
}

export class CorruptProjectError extends VibeboardError {
	readonly code = 'CORRUPT_PROJECT' as const;

	constructor(options?: { cause?: unknown }) {
		super(
			`Project index is invalid. Fix ${projectPathSegments.join('/')} (version ${PROJECT_SCHEMA_VERSION}), or delete it to rebuild the page list from the page folders. Page titles then reset to "Page <n>".`,
			options,
		);
		this.name = 'CorruptProjectError';
	}
}

export class UnsupportedProjectVersionError extends VibeboardError {
	readonly code = 'UNSUPPORTED_PROJECT_VERSION' as const;

	constructor(
		readonly version: number,
		options?: { cause?: unknown },
	) {
		super(
			`Project index version ${version} is unsupported (expected ${PROJECT_SCHEMA_VERSION}). Update the vibeboard extension, or fix ${projectPathSegments.join('/')}.`,
			options,
		);
		this.name = 'UnsupportedProjectVersionError';
	}
}

const migrationConflictMessage = (pageId: string, names: readonly PageEntry[]): string => {
	const rootArtboards = rootEntrySegments(ARTBOARDS_DIR).join('/');
	const pageArtboards = pageEntrySegments(pageId, ARTBOARDS_DIR).join('/');
	const clauses = names.map((name) =>
		name === ARTBOARDS_DIR
			? `${rootArtboards}/ is a folder, but artboards now live in ${pageArtboards}/`
			: `${rootEntrySegments(name).join('/')} and ${pageEntrySegments(pageId, name).join('/')} both exist`,
	);
	const artboardsStep = names.includes(ARTBOARDS_DIR)
		? ` Move the files you want from ${rootArtboards}/ into ${pageArtboards}/, then delete ${rootArtboards}/ (quit and reopen your editor or restart your agent first if an older vibeboard MCP server may still be running).`
		: '';
	const jsonStep = names.some((name) => name !== ARTBOARDS_DIR)
		? ' Keep one copy of each JSON file: move or delete the other by hand.'
		: '';
	return `Cannot move the existing design into ${pageDirSegments(pageId).join('/')}/: ${clauses.join('; ')}.${artboardsStep}${jsonStep} Then retry.`;
};

// A 0.4 entry and its page-folder twin both exist: the migration never picks one, the user does.
export class MigrationConflictError extends VibeboardError {
	readonly code = 'MIGRATION_CONFLICT' as const;

	readonly pageId: string;

	readonly names: readonly PageEntry[];

	constructor(
		{ pageId, names }: { pageId: string; names: readonly PageEntry[] },
		options?: { cause?: unknown },
	) {
		super(migrationConflictMessage(pageId, names), options);
		this.name = 'MigrationConflictError';
		this.pageId = pageId;
		this.names = names;
	}
}

// The disk lib has no OutputChannel, so disk-lib failures (and the MCP's ROOTS parse) go to stderr.
export const logStderr = (scope: string, error: unknown): void => {
	try {
		process.stderr.write(
			`vibeboard: ${scope} failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	} catch {
		// ponytail: a sync throw (a throwing message getter or toString, a sync write failure) is
		// dropped so the caller's original failure wins; an async EPIPE is a stream 'error' event and is
		// not covered. In the extension host this lands in the Extension Host log, not the Cursor
		// Design Output channel. Upgrade path: host callers log through logDiskError.
	}
};

// Rethrows a domain error as is; any other fs failure becomes DISK_ERROR with the cause kept.
export const throwDiskError = (error: unknown): never => {
	if (error instanceof VibeboardError) {
		throw error;
	}
	throw new DiskError({ cause: error });
};
