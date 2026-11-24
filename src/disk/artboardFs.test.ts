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
import { afterEach, test } from 'vite-plus/test';

import {
	createArtboard,
	placeFrame,
	readArtboard,
	setActiveArtboard,
	updateArtboard,
} from './artboardFs';
import { serializeCanvasLayout } from './canvasLayout';
import { listArtboards } from './canvasView';
import { exportArtboard, readHandoffStatus } from './exportFs';
import {
	ArtboardExistsError,
	ArtboardNotFoundError,
	ConflictError,
	CorruptCanvasError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	FrameMovedError,
	InvalidArgsError,
	InvalidArtboardIdError,
	UnsupportedCanvasVersionError,
	UnsupportedSchemaVersionError,
} from './errors';
import { hashHtml } from './hash';
import {
	FIRST_PAGE_ID,
	ARTBOARDS_DIR,
	CANVAS_SCHEMA_VERSION,
	VIBEBOARD_DIR,
	DEFAULT_ARTBOARD_TITLE,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	LOCK_FILE,
	SCHEMA_VERSION,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	manifestPathSegments,
} from './layout';
import { resolveOpenPage } from './openPage';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-conflict-'));
	tempRoots.push(workspaceRoot);
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

test('wrong generation does not change HTML', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	const created = await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	await assert.rejects(
		updateArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')),
		'utf8',
	);
	assert.equal(htmlOnDisk, html);
});

// The disk check is the only guard: the MCP handler passes base args through unchecked.
test('updateArtboard with no base or a malformed base is INVALID_ARGS and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	await createArtboard({
		page,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	const before = [await readFile(htmlPath, 'utf8'), await readFile(metaPath, 'utf8')];
	for (const base of [
		{},
		{ baseGeneration: 0 },
		{ baseGeneration: 1.5 },
		{ baseGeneration: '1' },
		{ baseHash: 'sha256:zz' },
	]) {
		await assert.rejects(
			updateArtboard({ page, artboardId: 'hero', html: '<p>clobber</p>', ...base }),
			InvalidArgsError,
			JSON.stringify(base),
		);
		assert.deepEqual([await readFile(htmlPath, 'utf8'), await readFile(metaPath, 'utf8')], before);
	}
});

test('uppercase on-disk hash does not conflict or extra-bump', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	const created = await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	const storedMeta = (await readFile(metaPath, 'utf8').then((text) => JSON.parse(text))) as {
		hash: string;
	};
	storedMeta.hash = `sha256:${storedMeta.hash.slice('sha256:'.length).toUpperCase()}`;
	await writeFile(metaPath, JSON.stringify(storedMeta), 'utf8');
	const updated = await updateArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			artboardId: 'hero',
			html: '<p>hero</p>',
			writeEnsurePanelMarker: false,
		});
		await writeFile(
			join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID)),
			JSON.stringify({
				version: 1,
				activeArtboardId,
				workspaceFolder: workspaceRoot,
				updatedAt: new Date().toISOString(),
			}),
			'utf8',
		);
		await assert.rejects(
			readArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }),
			(error: unknown) => {
				assert.ok(error instanceof ArtboardNotFoundError);
				return true;
			},
		);
		const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	const storedMeta = (await readFile(metaPath, 'utf8').then((text) => JSON.parse(text))) as {
		id: string;
	};
	storedMeta.id = 'other';
	await writeFile(metaPath, JSON.stringify(storedMeta), 'utf8');
	await assert.rejects(
		readArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, artboardId: 'hero' }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptMetaError);
			return true;
		},
	);
	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(listed.artboards[0]?.title, '');
	assert.equal(listed.artboards[0]?.generation, undefined);
});

test('corrupt manifest does not block create or explicit read', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID)), '{not json', 'utf8');
	const read = await readArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
	});
	assert.equal(read.html, '<p>hero</p>');
	assert.equal(read.active, false);
	const created = await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'second',
		html: '<p>second</p>',
		writeEnsurePanelMarker: false,
	});
	assert.equal(created.generation, 1);
	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(listed.activeArtboardId, 'second');
});

test('corrupt manifest still fails list and default read', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID)), '{not json', 'utf8');
	await assert.rejects(
		listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptManifestError);
			return true;
		},
	);
	await assert.rejects(
		readArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptManifestError);
			assert.equal(error.pageId, FIRST_PAGE_ID);
			assert.ok(error.cause instanceof SyntaxError);
			return true;
		},
	);
	// set_active_artboard is the documented recovery: it overwrites the corrupt manifest.
	await setActiveArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, artboardId: 'hero' });
	const read = await readArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(read.artboardId, 'hero');
	assert.equal(read.active, true);
});

test('symlinked html is rejected without touching the target', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'secret.txt');
	await writeFile(outsidePath, 'secret', 'utf8');
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	await rm(htmlPath);
	await symlink(outsidePath, htmlPath);
	await assert.rejects(
		readArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, artboardId: 'hero' }),
		(error: unknown) => {
			assert.ok(error instanceof DiskError);
			assert.equal(
				error.message,
				'.vibeboard/pages/page-1/artboards/hero.html must be a regular file (symlinks rejected).',
			);
			return true;
		},
	);
	await assert.rejects(
		updateArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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

test('createArtboard over an existing artboard: a file is ARTBOARD_EXISTS, a symlink is refused, nothing changes', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'secret.txt');
	await writeFile(outsidePath, 'secret', 'utf8');
	const create = async (): Promise<unknown> =>
		createArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			artboardId: 'hero',
			html: '<p>other</p>',
			writeEnsurePanelMarker: false,
		});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	const htmlBefore = await readFile(htmlPath, 'utf8');
	const metaBefore = await readFile(metaPath, 'utf8');

	await assert.rejects(create(), (error: unknown) => {
		assert.ok(error instanceof ArtboardExistsError);
		assert.equal(error.code, 'ARTBOARD_EXISTS');
		return true;
	});
	assert.equal(await readFile(htmlPath, 'utf8'), htmlBefore);
	assert.equal(await readFile(metaPath, 'utf8'), metaBefore);

	await rm(htmlPath);
	await symlink(outsidePath, htmlPath);
	await assert.rejects(create(), (error: unknown) => {
		assert.ok(error instanceof DiskError);
		assert.equal(
			error.message,
			'.vibeboard/pages/page-1/artboards/hero.html must be a regular file (symlinks rejected).',
		);
		return true;
	});
	assert.equal(await readFile(outsidePath, 'utf8'), 'secret');
});

test('writeUtf8 does not follow a tmp symlink and still replaces dest', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'secret.txt');
	await writeFile(outsidePath, 'secret', 'utf8');
	const created = await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	const tmpPath = `${htmlPath}.${process.pid}.tmp`;
	await symlink(outsidePath, tmpPath);

	await updateArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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

test('the root tombstone passes the dir check; a symlink or a file at the page artboards dir is refused', async () => {
	const workspaceRoot = await makeTempRoot();
	// The seeded root already holds the tombstone file at .vibeboard/artboards.
	assert.ok((await lstat(join(workspaceRoot, VIBEBOARD_DIR, ARTBOARDS_DIR))).isFile());
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});

	const outsideDir = await makeTempRoot();
	const pageArtboards = join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID));
	for (const replace of [
		() => symlink(outsideDir, pageArtboards),
		() => writeFile(pageArtboards, ''),
	]) {
		await rm(pageArtboards, { recursive: true, force: true });
		await replace();
		await assert.rejects(
			createArtboard({
				page: { workspaceRoot, pageId: FIRST_PAGE_ID },
				artboardId: 'side',
				html: '<p>side</p>',
				writeEnsurePanelMarker: false,
			}),
			(error: unknown) => {
				assert.ok(error instanceof DiskError);
				assert.equal(
					error.message,
					'.vibeboard/pages/page-1/artboards must be a directory (symlinks rejected).',
				);
				return true;
			},
		);
	}
});

test('hand-edited HTML bumps read generation without writing meta', async () => {
	const workspaceRoot = await makeTempRoot();
	const originalHtml = '<p>hero</p>';
	const handEditedHtml = '<p>hand-edit</p>';
	const created = await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: originalHtml,
		writeEnsurePanelMarker: false,
	});
	const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	await writeFile(htmlPath, handEditedHtml, 'utf8');

	const read = await readArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
	});
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
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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

	const exported = await exportArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(
		exported.frames.find(({ artboardId }) => artboardId === 'hero')?.artboardHash,
		hashHtml(handEditedHtml),
	);
	const healedMeta = JSON.parse(await readFile(metaPath, 'utf8')) as {
		generation: number;
		hash: string;
	};
	assert.equal(healedMeta.hash, hashHtml(handEditedHtml));
	assert.equal(healedMeta.generation, created.generation + 1);

	await writeFile(htmlPath, '<p>second-edit</p>', 'utf8');
	const status = await readHandoffStatus({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(status.stale, true);
});

test('listArtboards generation matches read after a hand-edit', async () => {
	const workspaceRoot = await makeTempRoot();
	const created = await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')),
		'<p>hand-edit</p>',
		'utf8',
	);
	const read = await readArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
	});
	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(read.generation, created.generation + 1);
	assert.equal(listed.artboards[0]?.generation, read.generation);
});

test('missing meta still reads and updates at generation 1', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	await rm(join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero')));
	const read = await readArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
	});
	assert.equal(read.generation, 1);
	assert.equal(read.hash, hashHtml(html));
	assert.equal(read.title, DEFAULT_ARTBOARD_TITLE);
	const updated = await updateArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>next</p>',
		baseGeneration: 1,
	});
	assert.equal(updated.generation, 2);
	assert.equal(updated.hash, hashHtml('<p>next</p>'));
});

// Only export reads meta strictly; one hand-broken meta must not block read or update.
test('an unparsable or foreign-id meta reads as defaults and the next update rewrites it', async () => {
	for (const brokenMeta of ['{', JSON.stringify({ id: 'has space!' })]) {
		const workspaceRoot = await makeTempRoot();
		const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
		await createArtboard({
			page,
			artboardId: 'hero',
			html: '<p>hero</p>',
			writeEnsurePanelMarker: false,
		});
		const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
		await writeFile(metaPath, brokenMeta, 'utf8');
		const read = await readArtboard({ page, artboardId: 'hero' });
		assert.equal(read.generation, 1);
		assert.equal(read.title, DEFAULT_ARTBOARD_TITLE);
		const updated = await updateArtboard({
			page,
			artboardId: 'hero',
			html: '<p>next</p>',
			baseGeneration: 1,
		});
		assert.equal(updated.generation, 2);
		const stored = JSON.parse(await readFile(metaPath, 'utf8')) as {
			id: string;
			generation: number;
		};
		assert.equal(stored.id, 'hero');
		assert.equal(stored.generation, 2);
	}
});

test('v2 manifest is not rewritten by createArtboard', async () => {
	const workspaceRoot = await makeTempRoot();
	await mkdir(join(workspaceRoot, VIBEBOARD_DIR), { recursive: true });
	const manifestPath = join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID));
	const v2Bytes = `${JSON.stringify({
		version: 2,
		activeArtboardId: 'hero',
		workspaceFolder: workspaceRoot,
		updatedAt: '2026-09-11T17:39:00.123Z',
	})}\n`;
	await writeFile(manifestPath, v2Bytes, 'utf8');
	await assert.rejects(
		createArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
	await assert.rejects(
		access(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'))),
	);
});

test('overlong artboard id is INVALID_ARTBOARD_ID and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	const overlongId = 'a'.repeat(65);
	await assert.rejects(
		createArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
	await assert.rejects(
		access(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, overlongId))),
	);
});

test('setActiveArtboard with a missing id is ARTBOARD_NOT_FOUND', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await assert.rejects(
		setActiveArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, artboardId: 'missing' }),
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const artboardNames = await readdir(join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID)));
	assert.ok(artboardNames.includes('hero.html'));
	assert.ok(!artboardNames.includes('Hero.html'));
	const foldedHtml = await readFile(
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'Hero')),
		'utf8',
	).then(
		(html) => html,
		() => undefined,
	);
	if (foldedHtml !== undefined) {
		assert.equal(foldedHtml, '<p>hero</p>');
	}
	await assert.rejects(
		setActiveArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID }, artboardId: 'Hero' }),
		(error: unknown) => {
			assert.ok(error instanceof ArtboardNotFoundError);
			assert.equal(error.code, 'ARTBOARD_NOT_FOUND');
			assert.equal(error.artboardId, 'Hero');
			return true;
		},
	);
	const manifest = JSON.parse(
		await readFile(join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID)), 'utf8'),
	) as { activeArtboardId: string };
	assert.equal(manifest.activeArtboardId, 'hero');
});

// Without the lock both calls read generation 1 before either writes, and both succeed.
test('two unqueued updateArtboard calls on one base: one wins, the other conflicts', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>v1</p>',
		writeEnsurePanelMarker: false,
	});
	const results = await Promise.allSettled(
		['<p>first</p>', '<p>second</p>'].map((html) =>
			updateArtboard({
				page: { workspaceRoot, pageId: FIRST_PAGE_ID },
				artboardId: 'hero',
				html,
				baseGeneration: 1,
			}),
		),
	);
	const fulfilled = results.flatMap((result, index) =>
		result.status === 'fulfilled' ? [index] : [],
	);
	const rejected = results.flatMap((result) =>
		result.status === 'rejected' ? [result.reason as unknown] : [],
	);
	assert.equal(fulfilled.length, 1);
	assert.equal(rejected.length, 1);
	assert.ok(rejected[0] instanceof ConflictError);
	const winner = fulfilled[0] === 0 ? '<p>first</p>' : '<p>second</p>';
	assert.equal(
		await readFile(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')), 'utf8'),
		winner,
	);
});

// Guards requireExactHtmlFileName only on a case-insensitive disk (macOS, Windows), where the bug
// lives: on Linux (CI) `HERO.html` does not exist, so requireHtmlFile refuses it first.
test('updateArtboard with a case variant id is ARTBOARD_NOT_FOUND and renames nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	const metaBefore = await readFile(metaPath, 'utf8');
	await assert.rejects(
		updateArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			artboardId: 'HERO',
			html: '<p>changed</p>',
			baseHash: hashHtml('<p>hero</p>'),
		}),
		ArtboardNotFoundError,
	);
	const names = await readdir(join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID)));
	assert.ok(names.includes('hero.html'));
	assert.ok(!names.includes('HERO.html'));
	assert.equal(
		await readFile(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')), 'utf8'),
		'<p>hero</p>',
	);
	assert.equal(await readFile(metaPath, 'utf8'), metaBefore);
});

test('empty viewport is InvalidArgsError on create and update', async () => {
	const workspaceRoot = await makeTempRoot();
	await assert.rejects(
		createArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await assert.rejects(
		updateArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'other',
		html: '<p>other</p>',
		writeEnsurePanelMarker: false,
	});
	const heroMeta = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	await rm(heroMeta);
	await symlink(outsidePath, heroMeta);
	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.deepEqual(
		listed.artboards.map((entry) => entry.artboardId),
		['hero', 'other'],
	);
	assert.equal(listed.artboards[0]?.title, '');
	assert.equal(listed.artboards[0]?.generation, undefined);
	assert.equal(listed.artboards[1]?.title, DEFAULT_ARTBOARD_TITLE);
	assert.equal(listed.artboards[1]?.generation, 1);
});

const canvasFileOf = (workspaceRoot: string): string =>
	join(workspaceRoot, ...canvasPathSegments(FIRST_PAGE_ID));

const createPlainArtboard = async (workspaceRoot: string, artboardId: string): Promise<void> => {
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId,
		html: '<p>x</p>',
		writeEnsurePanelMarker: false,
	});
};

test('placeFrame with a matching base writes; a stale base throws FRAME_MOVED and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await createPlainArtboard(workspaceRoot, 'a');
	await placeFrame({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'a',
		x: 8,
		y: 16,
		width: 400,
		label: 'Hero',
		group: 'Web',
	});
	const before = await readFile(canvasFileOf(workspaceRoot), 'utf8');

	for (const base of [
		{ x: 0, y: 16, width: 400 },
		{ x: 8, y: 0, width: 400 },
		{ x: 8, y: 16, width: 408 },
	]) {
		await assert.rejects(
			placeFrame({
				page: { workspaceRoot, pageId: FIRST_PAGE_ID },
				id: 'a',
				x: 64,
				y: 64,
				width: 480,
				base,
			}),
			(error: unknown) => error instanceof FrameMovedError && error.code === 'FRAME_MOVED',
		);
		assert.equal(await readFile(canvasFileOf(workspaceRoot), 'utf8'), before);
	}

	const { frames } = await placeFrame({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'a',
		x: 64,
		y: 72,
		width: 480,
		base: { x: 8, y: 16, width: 400 },
	});
	assert.deepEqual(frames, [{ id: 'a', label: 'Hero', x: 64, y: 72, width: 480, group: 'Web' }]);
});

test('placeFrame with base appends an auto-placed frame, and a stale base leaves canvas.json absent', async () => {
	const workspaceRoot = await makeTempRoot();
	await createPlainArtboard(workspaceRoot, 'a');
	await assert.rejects(
		placeFrame({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			id: 'a',
			x: 8,
			y: 8,
			width: 800,
			base: { x: 1, y: 0, width: DEFAULT_FRAME_WIDTH },
		}),
		FrameMovedError,
	);
	await assert.rejects(readFile(canvasFileOf(workspaceRoot), 'utf8'), { code: 'ENOENT' });

	await placeFrame({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'a',
		x: 8,
		y: 8,
		width: 800,
		base: { x: 0, y: 0, width: DEFAULT_FRAME_WIDTH },
	});
	const stored = JSON.parse(await readFile(canvasFileOf(workspaceRoot), 'utf8')) as unknown;
	assert.deepEqual(stored, {
		version: CANVAS_SCHEMA_VERSION,
		frames: [{ id: 'a', label: 'Artboard', x: 8, y: 8, width: 800 }],
	});
});

test('placeFrame clamps width through the disk path and stores negative x/y as given', async () => {
	const workspaceRoot = await makeTempRoot();
	await createPlainArtboard(workspaceRoot, 'a');
	const narrow = await placeFrame({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'a',
		x: -40,
		y: -8,
		width: 119,
	});
	assert.deepEqual(narrow.frames[0], { id: 'a', label: 'Artboard', x: -40, y: -8, width: 120 });
	const wide = await placeFrame({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'a',
		width: 3841,
		base: { x: -40, y: -8, width: 120 },
	});
	assert.deepEqual(wide.frames[0], { id: 'a', label: 'Artboard', x: -40, y: -8, width: 3840 });
	const entries = await readdir(join(workspaceRoot, VIBEBOARD_DIR));
	assert.ok(!entries.includes(LOCK_FILE), 'lock released');
});

// createArtboard writes a new artboard's meta without reading it first (the manifest is read and
// refused earlier), so writeUtf8's own check is the only guard there.
test('createArtboard refuses a symlink at the new meta path and leaves the link and its target alone', async () => {
	const workspaceRoot = await makeTempRoot();
	const targetPath = join(workspaceRoot, 'elsewhere.json');
	await writeFile(targetPath, 'outside', 'utf8');
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
	await mkdir(join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID)), { recursive: true });
	await symlink(targetPath, metaPath);
	await assert.rejects(
		createArtboard({
			page: { workspaceRoot, pageId: FIRST_PAGE_ID },
			artboardId: 'hero',
			html: '<p>hero</p>',
			writeEnsurePanelMarker: false,
		}),
		DiskError,
	);
	assert.equal((await lstat(metaPath)).isSymbolicLink(), true);
	assert.equal(await readFile(targetPath, 'utf8'), 'outside');
});

test('placeFrame rejects wrong-typed args by field name, a non-string id, and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await createPlainArtboard(workspaceRoot, 'a');
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	for (const [field, badArgs] of [
		['x', { x: '10' }],
		['x', { x: null }],
		['y', { y: null }],
		['width', { width: '300' }],
		['label', { label: 3 }],
		['group', { group: 3 }],
	] as const) {
		await assert.rejects(
			placeFrame({ page, id: 'a', ...badArgs }),
			(error: unknown) =>
				error instanceof InvalidArgsError && error.message.startsWith(`${field} `),
			field,
		);
	}
	await assert.rejects(placeFrame({ page, id: 42 }), InvalidArtboardIdError);
	await assert.rejects(readFile(canvasFileOf(workspaceRoot), 'utf8'), { code: 'ENOENT' });
});

const frameAt = (id: string, x: number, width = DEFAULT_FRAME_WIDTH) => ({
	id,
	label: 'Artboard',
	x,
	y: 0,
	width,
});

test('placeFrame keeps orphan entries and never stores unplaced siblings', async () => {
	const workspaceRoot = await makeTempRoot();
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	await createPlainArtboard(workspaceRoot, 'hero');
	await createPlainArtboard(workspaceRoot, 'hero-alt');
	const orphan = { id: 'gone', label: 'Gone', x: 5000, y: 0, width: 400 };
	await writeFile(
		canvasFileOf(workspaceRoot),
		serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [orphan] }),
	);

	const { frames } = await placeFrame({ page, id: 'hero-alt', width: 390 });

	const heroAlt = frameAt('hero-alt', DEFAULT_FRAME_WIDTH + FRAME_GAP, 390);
	assert.equal(
		await readFile(canvasFileOf(workspaceRoot), 'utf8'),
		serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [orphan, heroAlt] }),
	);
	assert.deepEqual(frames, [heroAlt, frameAt('hero', heroAlt.x + heroAlt.width + FRAME_GAP)]);
});

test('placeFrame pins a later id among several unplaced frames', async () => {
	const workspaceRoot = await makeTempRoot();
	for (const artboardId of ['artboard', 'hero', 'hero-alt']) {
		await createPlainArtboard(workspaceRoot, artboardId);
	}
	const { frames } = await placeFrame({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		id: 'hero',
	});

	const slot = DEFAULT_FRAME_WIDTH + FRAME_GAP;
	assert.equal(
		await readFile(canvasFileOf(workspaceRoot), 'utf8'),
		serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [frameAt('hero', slot)] }),
	);
	assert.deepEqual(frames, [
		frameAt('hero', slot),
		frameAt('artboard', 2 * slot),
		frameAt('hero-alt', 3 * slot),
	]);
});

test('placeFrame with group "" clears a stored group', async () => {
	const workspaceRoot = await makeTempRoot();
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	await createPlainArtboard(workspaceRoot, 'hero');
	await placeFrame({ page, id: 'hero', group: 'Desktop' });
	await placeFrame({ page, id: 'hero', group: '' });
	assert.equal(
		await readFile(canvasFileOf(workspaceRoot), 'utf8'),
		serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [frameAt('hero', 0)] }),
	);
});

test('placeFrame and listArtboards never rewrite a corrupt or unsupported canvas.json', async () => {
	const workspaceRoot = await makeTempRoot();
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	await createPlainArtboard(workspaceRoot, 'hero');
	for (const [text, errorClass] of [
		['{ not json', CorruptCanvasError],
		['{"version":1,"frames":[{"id":"hero"}]}', CorruptCanvasError],
		['{"version":2,"frames":[]}\n', UnsupportedCanvasVersionError],
	] as const) {
		await writeFile(canvasFileOf(workspaceRoot), text);
		await assert.rejects(placeFrame({ page, id: 'hero', x: 10 }), errorClass);
		await assert.rejects(listArtboards({ page }), errorClass);
		assert.equal(await readFile(canvasFileOf(workspaceRoot), 'utf8'), text);
	}
});
