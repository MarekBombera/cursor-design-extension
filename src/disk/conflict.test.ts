import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { createArtboard, listArtboards, readArtboard, updateArtboard } from './artboardFs';
import { conflictFields } from './conflict';
import {
	ArtboardNotFoundError,
	ConflictError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
} from './errors';
import { hashHtml } from './hash';
import {
	ARTBOARDS_DIR,
	CURSOR_DESIGN_DIR,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	manifestPathSegments,
} from './layout';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-conflict-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

test('conflictFields includes only compared generation on mismatch', () => {
	assert.deepEqual(
		conflictFields({
			baseGeneration: 1,
			actualGeneration: 2,
			actualHash: hashHtml('<p>a</p>'),
		}),
		{ expectedGeneration: 1, actualGeneration: 2 },
	);
});

test('conflictFields includes only compared hash on mismatch', () => {
	const actualHash = hashHtml('<p>a</p>');
	const expectedHash = hashHtml('<p>b</p>');
	assert.deepEqual(
		conflictFields({
			baseHash: expectedHash,
			actualGeneration: 1,
			actualHash,
		}),
		{ expectedHash, actualHash },
	);
});

test('conflictFields returns undefined when generation and hash match', () => {
	const actualHash = hashHtml('<p>a</p>');
	const mixedCaseHash = `sha256:${actualHash.slice('sha256:'.length).toUpperCase()}`;
	assert.equal(
		conflictFields({
			baseGeneration: 3,
			baseHash: mixedCaseHash,
			actualGeneration: 3,
			actualHash,
		}),
		undefined,
	);
});

test('wrong generation does not change HTML', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	await assert.rejects(
		updateArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>clobber</p>',
			baseGeneration: created.generation + 1,
		}),
		(error: unknown) => {
			assert.ok(error instanceof ConflictError);
			assert.equal(error.code, 'conflict');
			assert.equal(error.artboardId, 'hero');
			assert.equal(error.compared.expectedGeneration, created.generation + 1);
			assert.equal(error.compared.actualGeneration, created.generation);
			assert.equal(error.compared.expectedHash, undefined);
			return true;
		},
	);
	const htmlOnDisk = await readFile(
		join(workspaceRoot, ...artboardHtmlPathSegments('hero')),
		'utf8',
	);
	assert.equal(htmlOnDisk, html);
});

test('conflictFields matches hash case-insensitively on both sides', () => {
	const lowerHash = hashHtml('<p>a</p>');
	const upperHash = `sha256:${lowerHash.slice('sha256:'.length).toUpperCase()}`;
	assert.equal(
		conflictFields({ baseHash: lowerHash, actualGeneration: 1, actualHash: upperHash }),
		undefined,
	);
});

test('uppercase on-disk hash does not conflict or extra-bump', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments('hero'));
	const storedMeta = (await readFile(metaPath, 'utf8').then((text) => JSON.parse(text))) as {
		hash: string;
	};
	storedMeta.hash = `sha256:${storedMeta.hash.slice('sha256:'.length).toUpperCase()}`;
	await writeFile(metaPath, JSON.stringify(storedMeta), 'utf8');
	const updated = await updateArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html,
		baseHash: hashHtml(html),
	});
	assert.equal(updated.generation, created.generation);
});

test('empty or invalid active id reads as not-found but still lists', async () => {
	for (const activeArtboardId of ['', 'has space!']) {
		const workspaceRoot = await makeTempRoot();
		await createArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>hero</p>',
			writeEnsurePanelMarker: false,
		});
		await writeFile(
			join(workspaceRoot, ...manifestPathSegments),
			JSON.stringify({
				version: 1,
				activeArtboardId,
				workspaceFolder: workspaceRoot,
				updatedAt: new Date().toISOString(),
			}),
			'utf8',
		);
		await assert.rejects(readArtboard({ workspaceRoot }), (error: unknown) => {
			assert.ok(error instanceof ArtboardNotFoundError);
			return true;
		});
		const listed = await listArtboards({ workspaceRoot });
		assert.equal(listed.activeArtboardId, '');
		assert.deepEqual(
			listed.artboards.map((entry) => entry.artboardId),
			['hero'],
		);
	}
});

test('meta id mismatch reads as corrupt meta', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments('hero'));
	const storedMeta = (await readFile(metaPath, 'utf8').then((text) => JSON.parse(text))) as {
		id: string;
	};
	storedMeta.id = 'other';
	await writeFile(metaPath, JSON.stringify(storedMeta), 'utf8');
	await assert.rejects(readArtboard({ workspaceRoot, artboardId: 'hero' }), (error: unknown) => {
		assert.ok(error instanceof CorruptMetaError);
		return true;
	});
	const listed = await listArtboards({ workspaceRoot });
	assert.equal(listed.artboards[0]?.title, '');
	assert.equal(listed.artboards[0]?.generation, undefined);
});

test('corrupt manifest does not block create or explicit read', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(join(workspaceRoot, ...manifestPathSegments), '{not json', 'utf8');
	const read = await readArtboard({ workspaceRoot, artboardId: 'hero' });
	assert.equal(read.html, '<p>hero</p>');
	assert.equal(read.active, false);
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'second',
		html: '<p>second</p>',
		writeEnsurePanelMarker: false,
	});
	assert.equal(created.generation, 1);
	const listed = await listArtboards({ workspaceRoot });
	assert.equal(listed.activeArtboardId, 'second');
});

test('corrupt manifest still fails list and default read', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(join(workspaceRoot, ...manifestPathSegments), '{not json', 'utf8');
	await assert.rejects(listArtboards({ workspaceRoot }), (error: unknown) => {
		assert.ok(error instanceof CorruptManifestError);
		return true;
	});
	await assert.rejects(readArtboard({ workspaceRoot }), (error: unknown) => {
		assert.ok(error instanceof CorruptManifestError);
		return true;
	});
});

test('symlinked html is rejected without touching the target', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'secret.txt');
	await writeFile(outsidePath, 'secret', 'utf8');
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments('hero'));
	await rm(htmlPath);
	await symlink(outsidePath, htmlPath);
	await assert.rejects(readArtboard({ workspaceRoot, artboardId: 'hero' }), (error: unknown) => {
		assert.ok(error instanceof DiskError);
		return true;
	});
	await assert.rejects(
		updateArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>clobber</p>',
			baseGeneration: 1,
		}),
		(error: unknown) => {
			assert.ok(error instanceof DiskError);
			return true;
		},
	);
	assert.equal(await readFile(outsidePath, 'utf8'), 'secret');
});

test('directory named like html is skipped by list', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR, ARTBOARDS_DIR, 'weird.html'));
	const listed = await listArtboards({ workspaceRoot });
	assert.deepEqual(
		listed.artboards.map((entry) => entry.artboardId),
		['hero'],
	);
});

test('symlinked artboards dir is rejected', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR));
	await symlink(outsideDir, join(workspaceRoot, CURSOR_DESIGN_DIR, ARTBOARDS_DIR));
	await assert.rejects(
		createArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>hero</p>',
			writeEnsurePanelMarker: false,
		}),
		(error: unknown) => {
			assert.ok(error instanceof DiskError);
			return true;
		},
	);
});
