import assert from 'node:assert/strict';
import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
	createArtboard,
	exportArtboard,
	listArtboards,
	readArtboard,
	readHandoffStatus,
	setActiveArtboard,
	updateArtboard,
} from './artboardFs';
import { conflictFields } from './conflict';
import {
	ArtboardNotFoundError,
	ConflictError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	InvalidArgsError,
	InvalidArtboardIdError,
	UnsupportedSchemaVersionError,
} from './errors';
import { hashHtml } from './hash';
import {
	ARTBOARDS_DIR,
	CURSOR_DESIGN_DIR,
	DEFAULT_ARTBOARD_TITLE,
	SCHEMA_VERSION,
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
		assert.equal(
			error.message,
			'.cursor-design/artboards/hero.html must be a regular file (symlinks rejected).',
		);
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

test('writeUtf8 does not follow a tmp symlink and still replaces dest', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'secret.txt');
	await writeFile(outsidePath, 'secret', 'utf8');
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments('hero'));
	const tmpPath = `${htmlPath}.${process.pid}.tmp`;
	await symlink(outsidePath, tmpPath);

	await updateArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>new</p>',
		baseGeneration: created.generation,
	});

	assert.equal(await readFile(outsidePath, 'utf8'), 'secret');
	assert.equal(await readFile(htmlPath, 'utf8'), '<p>new</p>');
	const destStats = await lstat(htmlPath);
	assert.equal(destStats.isSymbolicLink(), false);
	assert.equal(destStats.isFile(), true);
	await assert.rejects(access(tmpPath));
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
			assert.equal(
				error.message,
				'.cursor-design/artboards must be a directory (symlinks rejected).',
			);
			return true;
		},
	);
});

test('hand-edited HTML bumps read generation without writing meta', async () => {
	const workspaceRoot = await makeTempRoot();
	const originalHtml = '<p>hero</p>';
	const handEditedHtml = '<p>hand-edit</p>';
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: originalHtml,
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments('hero'));
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments('hero'));
	await writeFile(htmlPath, handEditedHtml, 'utf8');

	const read = await readArtboard({ workspaceRoot, artboardId: 'hero' });
	assert.equal(read.html, handEditedHtml);
	assert.equal(read.hash, hashHtml(handEditedHtml));
	assert.equal(read.generation, created.generation + 1);
	const storedMeta = JSON.parse(await readFile(metaPath, 'utf8')) as {
		generation: number;
		hash: string;
	};
	assert.equal(storedMeta.generation, created.generation);
	assert.equal(storedMeta.hash, created.hash);

	await assert.rejects(
		updateArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>clobber</p>',
			baseGeneration: created.generation,
		}),
		(error: unknown) => {
			assert.ok(error instanceof ConflictError);
			assert.equal(error.compared.actualGeneration, created.generation + 1);
			return true;
		},
	);
	assert.equal(await readFile(htmlPath, 'utf8'), handEditedHtml);

	const exported = await exportArtboard({ workspaceRoot, artboardId: 'hero' });
	assert.equal(exported.artboardHash, hashHtml(handEditedHtml));
	assert.equal(exported.generation, created.generation + 1);
	const healedMeta = JSON.parse(await readFile(metaPath, 'utf8')) as {
		generation: number;
		hash: string;
	};
	assert.equal(healedMeta.hash, hashHtml(handEditedHtml));
	assert.equal(healedMeta.generation, created.generation + 1);

	await writeFile(htmlPath, '<p>second-edit</p>', 'utf8');
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, true);
});

test('listArtboards generation matches read after a hand-edit', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(
		join(workspaceRoot, ...artboardHtmlPathSegments('hero')),
		'<p>hand-edit</p>',
		'utf8',
	);
	const read = await readArtboard({ workspaceRoot, artboardId: 'hero' });
	const listed = await listArtboards({ workspaceRoot });
	assert.equal(read.generation, created.generation + 1);
	assert.equal(listed.artboards[0]?.generation, read.generation);
});

test('missing meta still reads and updates at generation 1', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	await rm(join(workspaceRoot, ...artboardMetaPathSegments('hero')));
	const read = await readArtboard({ workspaceRoot, artboardId: 'hero' });
	assert.equal(read.generation, 1);
	assert.equal(read.hash, hashHtml(html));
	assert.equal(read.title, DEFAULT_ARTBOARD_TITLE);
	const updated = await updateArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>next</p>',
		baseGeneration: 1,
	});
	assert.equal(updated.generation, 2);
	assert.equal(updated.hash, hashHtml('<p>next</p>'));
});

test('v2 manifest is not rewritten by createArtboard', async () => {
	const workspaceRoot = await makeTempRoot();
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR), { recursive: true });
	const manifestPath = join(workspaceRoot, ...manifestPathSegments);
	const v2Bytes = `${JSON.stringify({
		version: 2,
		activeArtboardId: 'hero',
		workspaceFolder: workspaceRoot,
		updatedAt: '2026-09-11T17:39:00.123Z',
	})}\n`;
	await writeFile(manifestPath, v2Bytes, 'utf8');
	await assert.rejects(
		createArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>hero</p>',
			writeEnsurePanelMarker: false,
		}),
		(error: unknown) => {
			assert.ok(error instanceof UnsupportedSchemaVersionError);
			assert.match(error.message, new RegExp(`Expected version ${SCHEMA_VERSION}`));
			return true;
		},
	);
	assert.equal(await readFile(manifestPath, 'utf8'), v2Bytes);
	await assert.rejects(access(join(workspaceRoot, ...artboardHtmlPathSegments('hero'))));
});

test('overlong artboard id is INVALID_ARTBOARD_ID and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	const overlongId = 'a'.repeat(65);
	await assert.rejects(
		createArtboard({
			workspaceRoot,
			artboardId: overlongId,
			html: '<p>x</p>',
			writeEnsurePanelMarker: false,
		}),
		(error: unknown) => {
			assert.ok(error instanceof InvalidArtboardIdError);
			assert.equal(error.code, 'INVALID_ARTBOARD_ID');
			return true;
		},
	);
	await assert.rejects(access(join(workspaceRoot, ...artboardHtmlPathSegments(overlongId))));
});

test('setActiveArtboard with a missing id is ARTBOARD_NOT_FOUND', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await assert.rejects(
		setActiveArtboard({ workspaceRoot, artboardId: 'missing' }),
		(error: unknown) => {
			assert.ok(error instanceof ArtboardNotFoundError);
			assert.equal(error.code, 'ARTBOARD_NOT_FOUND');
			assert.equal(error.artboardId, 'missing');
			return true;
		},
	);
});

test('setActiveArtboard requires an exact html file name', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const artboardNames = await readdir(join(workspaceRoot, CURSOR_DESIGN_DIR, ARTBOARDS_DIR));
	assert.ok(artboardNames.includes('hero.html'));
	assert.ok(!artboardNames.includes('Hero.html'));
	const foldedHtml = await readFile(
		join(workspaceRoot, ...artboardHtmlPathSegments('Hero')),
		'utf8',
	).then(
		(html) => html,
		() => undefined,
	);
	if (foldedHtml !== undefined) {
		assert.equal(foldedHtml, '<p>hero</p>');
	}
	await assert.rejects(
		setActiveArtboard({ workspaceRoot, artboardId: 'Hero' }),
		(error: unknown) => {
			assert.ok(error instanceof ArtboardNotFoundError);
			assert.equal(error.code, 'ARTBOARD_NOT_FOUND');
			assert.equal(error.artboardId, 'Hero');
			return true;
		},
	);
	const manifest = JSON.parse(
		await readFile(join(workspaceRoot, ...manifestPathSegments), 'utf8'),
	) as { activeArtboardId: string };
	assert.equal(manifest.activeArtboardId, 'hero');
});

test('empty viewport is InvalidArgsError on create and update', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(
		createArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>hero</p>',
			viewport: '',
			writeEnsurePanelMarker: false,
		}),
		(error: unknown) => {
			assert.ok(error instanceof InvalidArgsError);
			assert.match(error.message, /viewport must be a non-empty string/);
			return true;
		},
	);
	const created = await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await assert.rejects(
		updateArtboard({
			workspaceRoot,
			artboardId: 'hero',
			html: '<p>hero</p>',
			baseGeneration: created.generation,
			viewport: '',
		}),
		(error: unknown) => {
			assert.ok(error instanceof InvalidArgsError);
			assert.match(error.message, /viewport must be a non-empty string/);
			return true;
		},
	);
});

test('listArtboards keeps other ids when one meta is a symlink', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'poison.json');
	await writeFile(outsidePath, '{"id":"hero"}', 'utf8');
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		workspaceRoot,
		artboardId: 'other',
		html: '<p>other</p>',
		writeEnsurePanelMarker: false,
	});
	const heroMeta = join(workspaceRoot, ...artboardMetaPathSegments('hero'));
	await rm(heroMeta);
	await symlink(outsidePath, heroMeta);
	const listed = await listArtboards({ workspaceRoot });
	assert.deepEqual(
		listed.artboards.map((entry) => entry.artboardId),
		['hero', 'other'],
	);
	assert.equal(listed.artboards[0]?.title, '');
	assert.equal(listed.artboards[0]?.generation, undefined);
	assert.equal(listed.artboards[1]?.title, DEFAULT_ARTBOARD_TITLE);
	assert.equal(listed.artboards[1]?.generation, 1);
});
