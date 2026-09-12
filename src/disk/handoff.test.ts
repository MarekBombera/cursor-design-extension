import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
	createArtboard,
	exportArtboard,
	readHandoffStatus,
	setActiveArtboard,
	updateArtboard,
} from './artboardFs';
import { ArtboardNotFoundError, CorruptManifestError, CorruptMetaError, DiskError } from './errors';
import { compareHandoff, makeExportId } from './handoff';
import { hashHtml } from './hash';
import {
	HANDOFF_INDEX_FILE,
	IMPLEMENT_FILE,
	TOKENS_FILE,
	artboardMetaPathSegments,
	handoffDirSegments,
	manifestPathSegments,
	workspaceTokensPathSegments,
} from './layout';
import { type ArtboardManifest, parseManifest, serializeManifest } from './parse';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-handoff-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const FIXED_NOW = new Date('2026-09-11T17:39:00.123Z');
const HERO_HTML = '<p>hero</p>';
const OTHER_HTML = '<p>other</p>';

const readManifestJson = async (workspaceRoot: string): Promise<ArtboardManifest> =>
	parseManifest(
		JSON.parse(await readFile(join(workspaceRoot, ...manifestPathSegments), 'utf8')) as unknown,
	);

const createHero = async (workspaceRoot: string) =>
	createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: HERO_HTML,
		writeEnsurePanelMarker: false,
	});

test('makeExportId strips ISO punctuation', () => {
	assert.equal(makeExportId({ artboardId: 'hero', now: FIXED_NOW }), 'hero-20260911T173900123Z');
});

test('compareHandoff reports exported=false when never exported', () => {
	assert.deepEqual(compareHandoff({ lastExport: undefined, activeHash: hashHtml(HERO_HTML) }), {
		exported: false,
		stale: false,
	});
});

test('export writes three files, lastExport, bumped updatedAt, unchanged generation', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createHero(workspaceRoot);
	const beforeManifest = await readManifestJson(workspaceRoot);
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	assert.equal(exported.exportId, 'hero-20260911T173900123Z');
	assert.equal(exported.artboardId, 'hero');
	assert.equal(exported.artboardHash, created.hash);
	assert.equal(exported.exportedAt, FIXED_NOW.toISOString());
	assert.equal(exported.generation, created.generation);
	assert.equal(exported.handoffPath, handoffDirSegments(exported.exportId).join('/'));

	const leafDir = join(workspaceRoot, ...handoffDirSegments(exported.exportId));
	assert.equal(await readFile(join(leafDir, HANDOFF_INDEX_FILE), 'utf8'), HERO_HTML);
	const implementMd = await readFile(join(leafDir, IMPLEMENT_FILE), 'utf8');
	assert.match(implementMd, /exportId: hero-20260911T173900123Z/);
	assert.match(implementMd, /artboardId: hero/);
	assert.doesNotMatch(implementMd, /<p>hero<\/p>/);
	assert.deepEqual(JSON.parse(await readFile(join(leafDir, TOKENS_FILE), 'utf8')), {
		version: 1,
		tokens: {},
	});

	const afterManifest = await readManifestJson(workspaceRoot);
	assert.equal(afterManifest.updatedAt, FIXED_NOW.toISOString());
	assert.notEqual(afterManifest.updatedAt, beforeManifest.updatedAt);
	assert.equal(afterManifest.activeArtboardId, 'hero');
	assert.deepEqual(afterManifest.lastExport, {
		exportId: exported.exportId,
		artboardId: 'hero',
		artboardHash: created.hash,
		exportedAt: FIXED_NOW.toISOString(),
	});
	const meta = JSON.parse(
		await readFile(join(workspaceRoot, ...artboardMetaPathSegments('hero')), 'utf8'),
	) as {
		generation: number;
	};
	assert.equal(meta.generation, created.generation);
});

test('status is stale=false right after export', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createHero(workspaceRoot);
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, false);
	assert.equal(status.activeArtboardId, 'hero');
	assert.equal(status.activeHash, created.hash);
	assert.deepEqual(status.lastExport, {
		exportId: exported.exportId,
		artboardId: 'hero',
		artboardHash: created.hash,
		exportedAt: FIXED_NOW.toISOString(),
	});
});

test('updateArtboard with new HTML makes status stale and keeps old handoff', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createHero(workspaceRoot);
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	await updateArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>next</p>',
		baseGeneration: created.generation,
	});
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, true);
	assert.equal(status.lastExport?.exportId, exported.exportId);
	assert.equal(
		await readFile(
			join(workspaceRoot, ...handoffDirSegments(exported.exportId), HANDOFF_INDEX_FILE),
			'utf8',
		),
		HERO_HTML,
	);
});

test('setActiveArtboard keeps lastExport', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	await createArtboard({
		workspaceRoot,
		artboardId: 'other',
		html: OTHER_HTML,
		writeEnsurePanelMarker: false,
	});
	await setActiveArtboard({ workspaceRoot, artboardId: 'hero' });
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	await setActiveArtboard({ workspaceRoot, artboardId: 'other' });
	const manifest = await readManifestJson(workspaceRoot);
	assert.equal(manifest.activeArtboardId, 'other');
	assert.equal(manifest.lastExport?.exportId, exported.exportId);
	assert.equal(manifest.lastExport?.artboardId, 'hero');
});

test('export of a non-active id leaves status stale', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	await createArtboard({
		workspaceRoot,
		artboardId: 'other',
		html: OTHER_HTML,
		writeEnsurePanelMarker: false,
	});
	await setActiveArtboard({ workspaceRoot, artboardId: 'hero' });
	await exportArtboard({ workspaceRoot, artboardId: 'other', now: FIXED_NOW });
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, true);
	assert.equal(status.activeArtboardId, 'hero');
	assert.equal(status.lastExport?.artboardId, 'other');
});

test('never exported is stale without lastExport', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, true);
	assert.equal(status.lastExport, undefined);
	assert.deepEqual(compareHandoff({ lastExport: undefined, activeHash: status.activeHash }), {
		exported: false,
		stale: false,
	});
});

test('malformed lastExport hash or date is CorruptManifestError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	const validBase = await readManifestJson(workspaceRoot);
	const badHash = {
		...validBase,
		lastExport: {
			exportId: 'hero-x',
			artboardId: 'hero',
			artboardHash: 'sha256:dead',
			exportedAt: FIXED_NOW.toISOString(),
		},
	};
	assert.throws(
		() => parseManifest(badHash),
		(error: unknown) => error instanceof CorruptManifestError,
	);
	await writeFile(
		join(workspaceRoot, ...manifestPathSegments),
		`${JSON.stringify(badHash)}\n`,
		'utf8',
	);
	await assert.rejects(readHandoffStatus({ workspaceRoot }), (error: unknown) => {
		assert.ok(error instanceof CorruptManifestError);
		return true;
	});

	const badDate = {
		...validBase,
		lastExport: {
			exportId: 'hero-x',
			artboardId: 'hero',
			artboardHash: hashHtml(HERO_HTML),
			exportedAt: 'not-a-date',
		},
	};
	assert.throws(
		() => parseManifest(badDate),
		(error: unknown) => error instanceof CorruptManifestError,
	);
});

test('export with unknown id is ArtboardNotFoundError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	await assert.rejects(
		exportArtboard({ workspaceRoot, artboardId: 'missing' }),
		(error: unknown) => {
			assert.ok(error instanceof ArtboardNotFoundError);
			assert.equal(error.artboardId, 'missing');
			return true;
		},
	);
});

test('export with omitted id and no active is ArtboardNotFoundError', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(exportArtboard({ workspaceRoot }), (error: unknown) => {
		assert.ok(error instanceof ArtboardNotFoundError);
		return true;
	});
});

test('export with explicit id and no manifest creates the manifest active on that id', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createHero(workspaceRoot);
	await rm(join(workspaceRoot, ...manifestPathSegments));
	const exported = await exportArtboard({ workspaceRoot, artboardId: 'hero', now: FIXED_NOW });
	assert.equal(exported.artboardId, 'hero');
	assert.equal(exported.exportId, 'hero-20260911T173900123Z');
	const manifest = await readManifestJson(workspaceRoot);
	assert.equal(manifest.activeArtboardId, 'hero');
	assert.deepEqual(manifest.lastExport, {
		exportId: exported.exportId,
		artboardId: 'hero',
		artboardHash: created.hash,
		exportedAt: FIXED_NOW.toISOString(),
	});
});

test('export with explicit id and empty activeArtboardId activates that id', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createHero(workspaceRoot);
	const existing = await readManifestJson(workspaceRoot);
	await writeFile(
		join(workspaceRoot, ...manifestPathSegments),
		serializeManifest({ ...existing, activeArtboardId: '' }),
	);
	const exported = await exportArtboard({ workspaceRoot, artboardId: 'hero', now: FIXED_NOW });
	const manifest = await readManifestJson(workspaceRoot);
	assert.equal(manifest.activeArtboardId, 'hero');
	assert.deepEqual(manifest.lastExport, {
		exportId: exported.exportId,
		artboardId: 'hero',
		artboardHash: created.hash,
		exportedAt: FIXED_NOW.toISOString(),
	});
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, false);
	assert.equal(status.activeArtboardId, 'hero');
});

test('export with HTML but no meta is CorruptMetaError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	await rm(join(workspaceRoot, ...artboardMetaPathSegments('hero')));
	await assert.rejects(exportArtboard({ workspaceRoot, artboardId: 'hero' }), (error: unknown) => {
		assert.ok(error instanceof CorruptMetaError);
		assert.equal(error.artboardId, 'hero');
		return true;
	});
});

test('missing tokens writes stub; present tokens are copied byte-for-byte', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	const first = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const stubTokens = await readFile(
		join(workspaceRoot, ...handoffDirSegments(first.exportId), TOKENS_FILE),
		'utf8',
	);
	assert.deepEqual(JSON.parse(stubTokens), { version: 1, tokens: {} });

	const tokensBytes = '{\n  "version": 1,\n  "tokens": { "color": " #fff " }\n}';
	await writeFile(join(workspaceRoot, ...workspaceTokensPathSegments), tokensBytes, 'utf8');
	const laterNow = new Date('2026-09-11T17:40:00.000Z');
	const second = await exportArtboard({ workspaceRoot, now: laterNow });
	assert.equal(
		await readFile(
			join(workspaceRoot, ...handoffDirSegments(second.exportId), TOKENS_FILE),
			'utf8',
		),
		tokensBytes,
	);
});

test('tokens.json that is not a regular file is authored DiskError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	await mkdir(join(workspaceRoot, ...workspaceTokensPathSegments));
	await assert.rejects(exportArtboard({ workspaceRoot, now: FIXED_NOW }), (error: unknown) => {
		assert.ok(error instanceof DiskError);
		assert.equal(error.message, '.cursor-design/tokens.json must be a regular file.');
		return true;
	});
});

test('export collision on an existing handoff dir is authored DiskError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createHero(workspaceRoot);
	const exportId = makeExportId({ artboardId: 'hero', now: FIXED_NOW });
	await mkdir(join(workspaceRoot, ...handoffDirSegments(exportId)), { recursive: true });
	await assert.rejects(exportArtboard({ workspaceRoot, now: FIXED_NOW }), (error: unknown) => {
		assert.ok(error instanceof DiskError);
		assert.equal(error.message, 'Handoff folder already exists. Retry export_artboard.');
		return true;
	});
	const leafNames = await readdir(join(workspaceRoot, ...handoffDirSegments(exportId)));
	assert.deepEqual(leafNames, []);
});
