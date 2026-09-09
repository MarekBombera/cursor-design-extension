import { CorruptManifestError, CorruptMetaError, InvalidArtboardIdError, UnsupportedSchemaVersionError } from './errors';
import { HASH_PREFIX } from './hash';
import { DEFAULT_VIEWPORT, SCHEMA_VERSION } from './layout';

const ARTBOARD_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const HASH_PATTERN = new RegExp(`^${HASH_PREFIX}[a-fA-F0-9]{64}$`);

export type ArtboardManifest = {
	version: typeof SCHEMA_VERSION;
	activeArtboardId: string;
	workspaceFolder: string;
	updatedAt: string;
};

export type ArtboardMeta = {
	id: string;
	title: string;
	generation: number;
	hash: string;
	viewport: string;
	updatedAt: string;
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const toPrettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const parseArtboardId = (value: unknown): string => {
	if (typeof value === 'string' && ARTBOARD_ID_PATTERN.test(value)) {
		return value;
	}
	throw new InvalidArtboardIdError(typeof value === 'string' ? value : '');
};

export const parseManifest = (value: unknown): ArtboardManifest => {
	if (!isJsonRecord(value)) {
		throw new CorruptManifestError();
	}
	if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
		throw new CorruptManifestError();
	}
	if (value.version !== SCHEMA_VERSION) {
		throw new UnsupportedSchemaVersionError(value.version);
	}
	if (!isNonEmptyString(value.workspaceFolder) || !isNonEmptyString(value.updatedAt)) {
		throw new CorruptManifestError();
	}
	return {
		version: SCHEMA_VERSION,
		activeArtboardId: parseArtboardId(value.activeArtboardId),
		workspaceFolder: value.workspaceFolder,
		updatedAt: value.updatedAt,
	};
};

export const parseMeta = (value: unknown): ArtboardMeta => {
	if (!isJsonRecord(value)) {
		throw new CorruptMetaError('');
	}
	const id = parseArtboardId(value.id);
	if (typeof value.title !== 'string') {
		throw new CorruptMetaError(id);
	}
	if (typeof value.generation !== 'number' || !Number.isInteger(value.generation) || value.generation < 1) {
		throw new CorruptMetaError(id);
	}
	if (typeof value.hash !== 'string' || !HASH_PATTERN.test(value.hash)) {
		throw new CorruptMetaError(id);
	}
	if (!isNonEmptyString(value.updatedAt)) {
		throw new CorruptMetaError(id);
	}
	return {
		id,
		title: value.title,
		generation: value.generation,
		hash: value.hash,
		viewport: isNonEmptyString(value.viewport) ? value.viewport : DEFAULT_VIEWPORT,
		updatedAt: value.updatedAt,
	};
};

export const serializeManifest = (manifest: ArtboardManifest): string => toPrettyJson(manifest);

export const serializeMeta = (meta: ArtboardMeta): string => toPrettyJson(meta);
