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
			'Artboard manifest is invalid. Fix .cursor-design/manifest.json (version 1) or remove it to re-init.',
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
			`Artboard manifest version ${version} is unsupported. Expected version 1.`,
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
		super(`Artboard "${artboardId}" meta is invalid.`, options);
		this.name = 'CorruptMetaError';
	}
}
