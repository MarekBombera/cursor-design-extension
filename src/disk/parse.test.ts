import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { test } from 'vite-plus/test';

import * as z from 'zod/mini';

import { CorruptManifestError, CorruptMetaError } from './errors';
import { hashHtml } from './hash';
import { DEFAULT_VIEWPORT } from './layout';
import {
	type ArtboardManifest,
	type ArtboardMeta,
	parseManifest,
	parseMeta,
	serializeManifest,
	serializeMeta,
} from './parse';

const HASH = hashHtml('<p>hero</p>');

const BASE_MANIFEST: ArtboardManifest = {
	version: 1,
	activeArtboardId: 'hero',
	workspaceFolder: '/tmp/ws',
	updatedAt: '2026-10-18T10:00:00.000Z',
};

const FULL_META: ArtboardMeta = {
	id: 'hero',
	title: 'Hero',
	generation: 3,
	hash: HASH,
	viewport: '390x844',
	updatedAt: '2026-10-18T10:00:00.000Z',
};

const roundTripManifest = (text: string): string =>
	serializeManifest(parseManifest(JSON.parse(text) as unknown));

test('manifest without lastExport round-trips byte-equal', () => {
	const text = serializeManifest(BASE_MANIFEST);
	assert.equal(roundTripManifest(text), text);
	assert.ok(!('lastExport' in parseManifest(JSON.parse(text) as unknown)));
});

test('manifest with lastExport round-trips byte-equal', () => {
	const text = serializeManifest({
		...BASE_MANIFEST,
		lastExport: {
			exportId: 'hero-20261018T100000000Z',
			artboardId: 'hero',
			artboardHash: HASH,
			exportedAt: '2026-10-18T10:00:00.000Z',
		},
	});
	assert.equal(roundTripManifest(text), text);
});

test('full meta round-trips byte-equal', () => {
	const text = serializeMeta(FULL_META);
	assert.equal(serializeMeta(parseMeta(JSON.parse(text) as unknown)), text);
});

test('meta without viewport parses to the default and serializes it', () => {
	const { viewport: _viewport, ...withoutViewport } = FULL_META;
	const parsed = parseMeta(withoutViewport);
	assert.equal(parsed.viewport, DEFAULT_VIEWPORT);
	assert.equal(serializeMeta(parsed), serializeMeta({ ...FULL_META, viewport: DEFAULT_VIEWPORT }));
});

test('corrupt manifest error has authored message and ZodError cause', () => {
	assert.throws(
		() => parseManifest({ ...BASE_MANIFEST, workspaceFolder: '' }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptManifestError);
			assert.equal(error.message, new CorruptManifestError().message);
			assert.ok(error.cause instanceof z.core.$ZodError);
			return true;
		},
	);
});

test('corrupt meta error has authored message and ZodError cause', () => {
	assert.throws(
		() => parseMeta({ ...FULL_META, generation: 0 }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptMetaError);
			assert.equal(error.message, new CorruptMetaError('hero').message);
			assert.ok(error.cause instanceof z.core.$ZodError);
			return true;
		},
	);
});

const LAST_EXPORT = {
	exportId: 'canvas-20261018T100000000Z',
	artboardId: 'hero',
	artboardHash: HASH,
	exportedAt: '2026-10-18T10:00:00.000Z',
};

const manifestWithFrames = (frames: unknown): unknown => ({
	...BASE_MANIFEST,
	lastExport: { ...LAST_EXPORT, frames },
});

test('lastExport.frames round-trips byte-equal in serialized key order', () => {
	const otherHash = hashHtml('<p>other</p>');
	const text = serializeManifest({
		...BASE_MANIFEST,
		lastExport: {
			...LAST_EXPORT,
			frames: [
				{ artboardId: 'hero', artboardHash: HASH },
				{ artboardId: 'other', artboardHash: otherHash },
			],
		},
	});
	assert.equal(roundTripManifest(text), text);
	const keys = Object.keys(
		(JSON.parse(text) as { lastExport: Record<string, unknown> }).lastExport,
	);
	assert.deepEqual(keys, ['exportId', 'artboardId', 'artboardHash', 'exportedAt', 'frames']);
	// Reordered input keys still serialize in schema order.
	const reordered = parseManifest(
		manifestWithFrames([{ artboardHash: otherHash, artboardId: 'other' }]),
	);
	assert.deepEqual(Object.keys(reordered.lastExport?.frames?.[0] ?? {}), [
		'artboardId',
		'artboardHash',
	]);
});

test('legacy lastExport without frames stays valid and frames-free', () => {
	const parsed = parseManifest({ ...BASE_MANIFEST, lastExport: LAST_EXPORT });
	assert.ok(parsed.lastExport !== undefined);
	assert.ok(!('frames' in parsed.lastExport));
});

test('corrupt lastExport.frames is CorruptManifestError', () => {
	const cases: unknown[] = [
		{ artboardId: 'hero', artboardHash: HASH },
		[],
		[{ artboardId: 'bad id', artboardHash: HASH }],
		[{ artboardId: 'hero', artboardHash: 'sha256:dead' }],
		[
			{ artboardId: 'hero', artboardHash: HASH },
			{ artboardId: 'hero', artboardHash: HASH },
		],
	];
	for (const frames of cases) {
		assert.throws(
			() => parseManifest(manifestWithFrames(frames)),
			(error: unknown) => error instanceof CorruptManifestError,
		);
	}
});

const artboardIdArb = fc.stringMatching(/^[a-zA-Z0-9._-]{1,64}$/);
const hashArb = fc.stringMatching(/^[0-9a-fA-F]{64}$/).map((hex) => `sha256:${hex}`);
const nonEmptyTextArb = fc.string({ minLength: 1, maxLength: 64, unit: 'grapheme-ascii' });
const exportedAtArb = fc
	.date({
		min: new Date('1970-01-01T00:00:00.000Z'),
		max: new Date('9999-12-31T23:59:59.999Z'),
		noInvalidDate: true,
	})
	.map((date) => date.toISOString());
const exportedFrameArb = fc.record({
	artboardId: artboardIdArb,
	artboardHash: hashArb,
});
const exportedFramesArb = fc.uniqueArray(exportedFrameArb, {
	minLength: 1,
	maxLength: 6,
	selector: (frame) => frame.artboardId,
});

const lastExportArb = fc
	.record({
		exportId: nonEmptyTextArb,
		artboardId: artboardIdArb,
		artboardHash: hashArb,
		exportedAt: exportedAtArb,
		frames: fc.option(exportedFramesArb, { nil: undefined }),
	})
	.map(({ frames, ...lastExport }) =>
		frames === undefined ? lastExport : { ...lastExport, frames },
	);

const manifestArb = fc
	.record({
		activeArtboardId: artboardIdArb,
		workspaceFolder: nonEmptyTextArb,
		updatedAt: nonEmptyTextArb,
		lastExport: fc.option(lastExportArb, { nil: undefined }),
	})
	.map(({ lastExport, ...fields }): ArtboardManifest => {
		const manifest: ArtboardManifest = {
			version: 1,
			activeArtboardId: fields.activeArtboardId,
			workspaceFolder: fields.workspaceFolder,
			updatedAt: fields.updatedAt,
		};
		if (lastExport !== undefined) {
			manifest.lastExport = lastExport;
		}
		return manifest;
	});

const metaArb = fc.record({
	id: artboardIdArb,
	title: fc.string({ maxLength: 64, unit: 'grapheme-ascii' }),
	generation: fc.integer({ min: 1, max: 1_000_000_000 }),
	hash: hashArb,
	viewport: nonEmptyTextArb,
	updatedAt: nonEmptyTextArb,
});

test('property: valid manifest serialize-parse is byte-equal', () => {
	fc.assert(
		fc.property(manifestArb, (valid) => {
			assert.equal(
				serializeManifest(parseManifest(JSON.parse(serializeManifest(valid)))),
				serializeManifest(valid),
			);
		}),
	);
});

test('property: valid meta serialize-parse is byte-equal', () => {
	fc.assert(
		fc.property(metaArb, (valid) => {
			assert.equal(
				serializeMeta(parseMeta(JSON.parse(serializeMeta(valid)))),
				serializeMeta(valid),
			);
		}),
	);
});
