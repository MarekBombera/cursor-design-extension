import * as z from 'zod/mini';

import {
	CorruptManifestError,
	CorruptMetaError,
	CorruptProjectError,
	InvalidArtboardIdError,
	UnsupportedProjectVersionError,
	UnsupportedSchemaVersionError,
} from './errors';
import { isArtboardHash } from './hash';
import {
	DEFAULT_VIEWPORT,
	MAX_PAGES,
	MAX_PAGE_TITLE_CHARS,
	PAGE_ID_PATTERN,
	PROJECT_SCHEMA_VERSION,
	SCHEMA_VERSION,
} from './layout';
import { hasControlChars } from '../webview/frame/frameMessages';

const ARTBOARD_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value);

const toPrettyJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

// zod/mini (functional API, no bundled locale messages): zod text never reaches users anyway.
const nonEmptyString = z.string().check(z.minLength(1));

const artboardHashString = z.string().check(z.refine(isArtboardHash));

const artboardIdString = z.string().check(z.regex(ARTBOARD_ID_PATTERN));

const exportedFrameSchema = z.object({
	artboardId: artboardIdString,
	artboardHash: artboardHashString,
});

// Key order of each shape is the serialized key order; zod strips unknown keys.
// frames is absent on older single-artboard exports; when present it is non-empty, ids unique.
const lastExportSchema = z.object({
	exportId: nonEmptyString,
	artboardId: artboardIdString,
	artboardHash: artboardHashString,
	exportedAt: nonEmptyString.check(z.refine((value) => !Number.isNaN(Date.parse(value)))),
	frames: z.optional(
		z.array(exportedFrameSchema).check(
			z.minLength(1),
			z.refine(
				(frames) => new Set(frames.map(({ artboardId }) => artboardId)).size === frames.length,
			),
		),
	),
});

// Empty or charset-invalid active is "no valid active" (ARTBOARD_NOT_FOUND), not a corrupt file.
const manifestSchema = z.object({
	version: z.literal(SCHEMA_VERSION),
	activeArtboardId: z.pipe(
		z.string(),
		z.transform((value) => (ARTBOARD_ID_PATTERN.test(value) ? value : '')),
	),
	workspaceFolder: nonEmptyString,
	updatedAt: nonEmptyString,
	lastExport: z.optional(lastExportSchema),
});

const metaSchema = z.object({
	id: z.string(),
	title: z.string(),
	generation: z.int().check(z.gte(1)),
	hash: artboardHashString,
	viewport: z.catch(nonEmptyString, DEFAULT_VIEWPORT),
	updatedAt: nonEmptyString,
});

// The one page-id check: project.json entries, the page-folder scan, and later MCP args.
export const isPageId = (value: unknown): value is string =>
	typeof value === 'string' && PAGE_ID_PATTERN.test(value);

const pageTitleString = z.string().check(
	z.minLength(1),
	z.maxLength(MAX_PAGE_TITLE_CHARS),
	z.refine((value) => value === value.trim() && !hasControlChars(value)),
);

// Array order is menu order.
const projectSchema = z
	.object({
		version: z.literal(PROJECT_SCHEMA_VERSION),
		openPageId: z.string(),
		pages: z
			.array(z.object({ id: z.string().check(z.refine(isPageId)), title: pageTitleString }))
			.check(
				z.minLength(1),
				z.maxLength(MAX_PAGES),
				z.refine((pages) => new Set(pages.map(({ id }) => id)).size === pages.length),
			),
	})
	.check(z.refine((project) => project.pages.some(({ id }) => id === project.openPageId)));

export type Project = z.infer<typeof projectSchema>;

export type ExportedFrame = z.infer<typeof exportedFrameSchema>;

export type LastExport = z.infer<typeof lastExportSchema>;

export type ArtboardManifest = z.infer<typeof manifestSchema>;

export type ArtboardMeta = z.infer<typeof metaSchema>;

export const parseArtboardId = (value: unknown): string => {
	if (typeof value === 'string' && ARTBOARD_ID_PATTERN.test(value)) {
		return value;
	}
	throw new InvalidArtboardIdError(typeof value === 'string' ? value : '');
};

export const parseManifest = (value: unknown, pageId: string): ArtboardManifest => {
	// Version dispatch runs before the schema so corrupt and unsupported stay distinct errors.
	if (!isJsonRecord(value)) {
		throw new CorruptManifestError({ pageId });
	}
	if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
		throw new CorruptManifestError({ pageId });
	}
	if (value.version !== SCHEMA_VERSION) {
		throw new UnsupportedSchemaVersionError({ pageId, version: value.version });
	}
	const parsed = manifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new CorruptManifestError({ pageId }, { cause: parsed.error });
	}
	return parsed.data;
};

export const parseMeta = (value: unknown, pageId: string): ArtboardMeta => {
	if (!isJsonRecord(value)) {
		throw new CorruptMetaError({ pageId, artboardId: '' });
	}
	const artboardId = parseArtboardId(value.id);
	const parsed = metaSchema.safeParse(value);
	if (!parsed.success) {
		throw new CorruptMetaError({ pageId, artboardId }, { cause: parsed.error });
	}
	return parsed.data;
};

export const parseProject = (value: unknown): Project => {
	if (!isJsonRecord(value)) {
		throw new CorruptProjectError();
	}
	if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
		throw new CorruptProjectError();
	}
	if (value.version !== PROJECT_SCHEMA_VERSION) {
		throw new UnsupportedProjectVersionError(value.version);
	}
	const parsed = projectSchema.safeParse(value);
	if (!parsed.success) {
		throw new CorruptProjectError({ cause: parsed.error });
	}
	return parsed.data;
};

export const serializeProject = (project: Project): string => toPrettyJson(project);

export const serializeManifest = (manifest: ArtboardManifest): string => toPrettyJson(manifest);

export const serializeMeta = (meta: ArtboardMeta): string => toPrettyJson(meta);
