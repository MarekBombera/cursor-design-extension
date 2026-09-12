export class InvalidArtboardIdError extends Error {
	readonly code = 'INVALID_ARTBOARD_ID' as const;

	constructor(
		readonly artboardId: string,
		options?: { cause?: unknown },
	) {
		super('Artboard id is invalid. Use only letters, digits, dot, underscore, or hyphen.', options);
		this.name = 'InvalidArtboardIdError';
	}
}

export class CorruptManifestError extends Error {
	readonly code = 'CORRUPT_MANIFEST' as const;

	constructor(options?: { cause?: unknown }) {
		super(
			'Artboard manifest is invalid. Fix or restore .cursor-design/manifest.json (version 1).',
			options,
		);
		this.name = 'CorruptManifestError';
	}
}

export class UnsupportedSchemaVersionError extends Error {
	readonly code = 'UNSUPPORTED_SCHEMA_VERSION' as const;

	constructor(
		readonly version: number,
		options?: { cause?: unknown },
	) {
		super(
			`Artboard manifest version ${version} is unsupported. Expected version 1. Fix or restore .cursor-design/manifest.json.`,
			options,
		);
		this.name = 'UnsupportedSchemaVersionError';
	}
}

export class ArtboardHtmlMissingError extends Error {
	readonly code = 'ARTBOARD_HTML_MISSING' as const;

	constructor(
		readonly artboardId: string,
		options?: { cause?: unknown },
	) {
		super(
			`Artboard "${artboardId}" HTML is missing. Restore .cursor-design/artboards/${artboardId}.html.`,
			options,
		);
		this.name = 'ArtboardHtmlMissingError';
	}
}

export class CorruptMetaError extends Error {
	readonly code = 'CORRUPT_META' as const;

	constructor(
		readonly artboardId: string,
		options?: { cause?: unknown },
	) {
		super(
			`Artboard "${artboardId}" meta is invalid. Restore .cursor-design/artboards/${artboardId}.meta.json or set_artboard a new id.`,
			options,
		);
		this.name = 'CorruptMetaError';
	}
}

export class InvalidArgsError extends Error {
	readonly code = 'INVALID_ARGS' as const;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'InvalidArgsError';
	}
}

export class ArtboardExistsError extends Error {
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

export class ArtboardNotFoundError extends Error {
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

export class NoWorkspaceError extends Error {
	readonly code = 'NO_WORKSPACE' as const;

	constructor(options?: { cause?: unknown }) {
		super('No workspace folder is available. Open a workspace folder.', options);
		this.name = 'NoWorkspaceError';
	}
}

export class AmbiguousWorkspaceError extends Error {
	readonly code = 'ambiguous_workspace' as const;

	constructor(options?: { cause?: unknown }) {
		super('Workspace root is ambiguous. Pass rootPath.', options);
		this.name = 'AmbiguousWorkspaceError';
	}
}

export class InvalidRootError extends Error {
	readonly code = 'INVALID_ROOT' as const;

	constructor(options?: { cause?: unknown }) {
		super(
			'rootPath is not an exact host-passed folder. Pass a rootPath from CURSOR_DESIGN_WORKSPACE_ROOTS.',
			options,
		);
		this.name = 'InvalidRootError';
	}
}

export class DiskError extends Error {
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

export class ConflictError extends Error {
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
