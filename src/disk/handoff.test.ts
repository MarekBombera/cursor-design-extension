import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import {
	createArtboard,
	exportArtboard,
	placeFrame,
	readHandoffStatus,
	setActiveArtboard,
	updateArtboard,
} from './artboardFs';
import { serializeCanvasLayout } from './canvasLayout';
import {
	CorruptCanvasError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	NoArtboardsToExportError,
} from './errors';
import {
	assignGroupFolders,
	buildCanvasImplementMarkdown,
	compareCanvasHandoff,
	makeCanvasExportId,
} from './handoff';
import { hashHtml } from './hash';
import {
	CANVAS_PREVIEW_FILE,
	CANVAS_SCHEMA_VERSION,
	IMPLEMENT_FILE,
	TOKENS_FILE,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	handoffDirSegments,
	handoffRootSegments,
	manifestPathSegments,
	workspaceTokensPathSegments,
} from './layout';
import { type ArtboardManifest, type LastExport, parseManifest, serializeManifest } from './parse';

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
const FIXED_EXPORT_ID = 'canvas-20260911T173900123Z';
const HERO_HTML = '<p>hero</p>';

const FRAME_HTML: Record<string, string> = {
	a: '<!DOCTYPE html><html><head><title>a</title></head><body>"a" &amp;</body></html>',
	b: '<p>b</p>',
	c: '',
	d: '<script>console.log("</script>")</script>',
};

const readManifestJson = async (workspaceRoot: string): Promise<ArtboardManifest> =>
	parseManifest(
		JSON.parse(await readFile(join(workspaceRoot, ...manifestPathSegments), 'utf8')) as unknown,
	);

const createFrame = async (workspaceRoot: string, artboardId: string, html: string) =>
	createArtboard({ workspaceRoot, artboardId, html, writeEnsurePanelMarker: false });

const writeCanvas = async (
	workspaceRoot: string,
	frames: { id: string; label: string; x: number; y: number; width: number; group?: string }[],
): Promise<void> => {
	await writeFile(
		join(workspaceRoot, ...canvasPathSegments),
		serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames }),
		'utf8',
	);
};

// a, b in Desktop; c with a row and no group; d auto-placed. Active ends on d (last created).
const createFourFrameCanvas = async (
	workspaceRoot: string,
	{ withCanvas }: { withCanvas: boolean } = { withCanvas: true },
): Promise<void> => {
	for (const id of ['a', 'b', 'c', 'd']) {
		await createFrame(workspaceRoot, id, FRAME_HTML[id] ?? '');
	}
	if (withCanvas) {
		await writeCanvas(workspaceRoot, [
			{ id: 'a', label: 'A', x: 0, y: 0, width: 1280, group: 'Desktop' },
			{ id: 'b', label: 'B', x: 1304, y: 0, width: 1280, group: 'Desktop' },
			{ id: 'c', label: 'C', x: 0, y: 1000, width: 390 },
		]);
	}
};

const listTree = async (dir: string, prefix = ''): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relative = `${prefix}${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...(await listTree(join(dir, entry.name), `${relative}/`)));
		} else {
			files.push(relative);
		}
	}
	return files.sort();
};

const handoffLeaves = async (workspaceRoot: string): Promise<string[]> => {
	try {
		return await readdir(join(workspaceRoot, ...handoffRootSegments));
	} catch {
		return [];
	}
};

const lastExportOf = (
	frames: { artboardId: string; artboardHash: string }[] | undefined,
	legacy = { artboardId: 'a', artboardHash: hashHtml('<p>a</p>') },
): LastExport => {
	const lastExport: LastExport = {
		exportId: 'canvas-x',
		...legacy,
		exportedAt: FIXED_NOW.toISOString(),
	};
	if (frames !== undefined) {
		lastExport.frames = frames;
	}
	return lastExport;
};

// --- pure planning -------------------------------------------------------------------------

test('makeCanvasExportId strips ISO punctuation', () => {
	assert.equal(makeCanvasExportId({ now: FIXED_NOW }), FIXED_EXPORT_ID);
});

test('assignGroupFolders slugs, caps, falls back, reserves ungrouped, and suffixes', () => {
	const folders = assignGroupFolders([
		{ id: 'f1', group: 'Desktop' },
		{ id: 'f2', group: 'desktop' },
		{ id: 'f3', group: 'Desktop' },
		{ id: 'f4' },
		{ id: 'f5', group: 'Ungrouped' },
		{ id: 'f6', group: '  --Mobile / Tablet!!--  ' },
		{ id: 'f7', group: '   ' },
		{ id: 'f8', group: '!!!' },
		{ id: 'f9', group: `${'x'.repeat(63)} y` },
		{ id: 'f10', group: 'Desktop!' },
	]);
	assert.deepEqual(Object.fromEntries(folders), {
		f1: 'desktop',
		f2: 'desktop-2',
		f3: 'desktop',
		f4: 'ungrouped',
		f5: 'ungrouped-2',
		f6: 'mobile-tablet',
		f7: 'group',
		f8: 'group-2',
		f9: 'x'.repeat(63),
		f10: 'desktop-3',
	});
});

test('assignGroupFolders does not reserve ungrouped when every frame has a group', () => {
	assert.deepEqual(Object.fromEntries(assignGroupFolders([{ id: 'a', group: 'Ungrouped' }])), {
		a: 'ungrouped',
	});
});

test('buildCanvasImplementMarkdown orders sections and frames, collapses newlines, lists paths', () => {
	const hash = hashHtml('x');
	const markdown = buildCanvasImplementMarkdown({
		exportId: 'canvas-1',
		exportedAt: FIXED_NOW.toISOString(),
		frames: [
			{ id: 'c', label: 'Card\r\nAlt', width: 390, folder: 'ungrouped', artboardHash: hash },
			{
				id: 'a',
				label: 'A',
				width: 1280,
				group: 'Desk\ntop',
				folder: 'desk-top',
				artboardHash: hash,
			},
			{ id: 'd', label: 'D', width: 1280, folder: 'ungrouped', artboardHash: hash },
			{
				id: 'b',
				label: 'B',
				width: 1280,
				group: 'Desk\ntop',
				folder: 'desk-top',
				artboardHash: hash,
			},
		],
	});
	assert.match(
		markdown,
		/^# Implement this canvas\n\nexportId: canvas-1\nexportedAt: \S+\nframes: 4\n/,
	);
	const headings = markdown.split('\n').filter((line) => line.startsWith('### '));
	assert.deepEqual(headings, ['### (no group) (`ungrouped/`)', '### Desk top (`desk-top/`)']);
	const frameLines = markdown.split('\n').filter((line) => / - id `/.test(line));
	assert.deepEqual(frameLines, [
		`- Card Alt - id \`c\`, width 390, hash \`${hash}\`, file \`ungrouped/c/index.html\``,
		`- D - id \`d\`, width 1280, hash \`${hash}\`, file \`ungrouped/d/index.html\``,
		`- A - id \`a\`, width 1280, hash \`${hash}\`, file \`desk-top/a/index.html\``,
		`- B - id \`b\`, width 1280, hash \`${hash}\`, file \`desk-top/b/index.html\``,
	]);
	for (const path of ['ungrouped/c', 'desk-top/a', 'ungrouped/d', 'desk-top/b']) {
		assert.ok(markdown.includes(`- ${path}/index.html - one complete document per frame`));
	}
	assert.ok(markdown.includes('- canvas.html - view-only preview'));
	assert.ok(markdown.includes('call `export_artboard` again (it exports the whole canvas)'));
	const instructionsStart = markdown.indexOf('## Instructions\n');
	assert.ok(instructionsStart >= 0);
	assert.equal(
		markdown.slice(instructionsStart),
		[
			'## Instructions',
			'',
			'1. Call `handoff_status` first. If `stale` is true, call `export_artboard` again (it exports the whole canvas) before implementing.',
			"2. If MCP is unavailable, compare each frame's `hash` above with `.cursor-design/artboards/<id>.meta.json` `hash`, and the frame list with `.cursor-design/artboards/*.html`. On any difference, re-export, or ask the user to run **Export Handoff**.",
			'3. Implement each frame from its own `index.html` (HTML+CSS+JS inline), not from screenshots or `canvas.html`.',
			"4. Each frame is a complete design at its `width`. In the implemented app, frames that show the same page at different widths (for example desktop and mobile, usually in the same `group`) are variants: build one responsive page that matches each frame at its width, combining their styles with media queries instead of pasting each frame's CSS and JS side by side, and keep each frame's classes and JS behavior. If it is unclear which frames are variants of one page, ask the user. Frames with no narrow variant should adapt to small screens in the implemented app. Never hard-code a frame's width on `body`.",
			"5. Target the user's app entry files. Never copy `.cursor-design/` into the app.",
			'6. Keep semantic structure, classes, and behavior.',
			'7. Assets referenced as `assets/...` resolve against `.cursor-design/assets/`. Copy them manually.',
			'',
		].join('\n'),
	);
	assert.ok(!markdown.includes('Never merge their CSS or JS'));
});

test('compareCanvasHandoff covers never exported, unchanged, changed, added, removed, unreadable, order', () => {
	const hashA = hashHtml('<p>a</p>');
	const hashB = hashHtml('<p>b</p>');
	const recorded = lastExportOf([
		{ artboardId: 'a', artboardHash: hashA },
		{ artboardId: 'b', artboardHash: hashB },
	]);
	const current = [
		{ artboardId: 'a', hash: hashA },
		{ artboardId: 'b', hash: hashB },
	];
	assert.deepEqual(compareCanvasHandoff({ lastExport: undefined, frames: current }), {
		exported: false,
		stale: false,
	});
	assert.deepEqual(compareCanvasHandoff({ lastExport: recorded, frames: current }), {
		exported: true,
		stale: false,
	});
	const staleOf = (frames: { artboardId: string; hash: string | undefined }[]): boolean =>
		compareCanvasHandoff({ lastExport: recorded, frames }).stale;
	assert.equal(staleOf([...current].reverse()), false);
	assert.equal(
		staleOf([
			{ artboardId: 'a', hash: hashA.toUpperCase().replace('SHA256:', 'sha256:') },
			current[1]!,
		]),
		false,
	);
	assert.equal(staleOf([{ artboardId: 'a', hash: hashHtml('changed') }, current[1]!]), true);
	assert.equal(staleOf([...current, { artboardId: 'c', hash: hashA }]), true);
	assert.equal(staleOf([current[0]!]), true);
	assert.equal(staleOf([{ artboardId: 'a', hash: undefined }, current[1]!]), true);
	assert.equal(staleOf([current[0]!, { artboardId: 'c', hash: hashB }]), true);
});

test('compareCanvasHandoff treats legacy lastExport as a one-frame set', () => {
	const hashA = hashHtml('<p>a</p>');
	const legacy = lastExportOf(undefined, { artboardId: 'a', artboardHash: hashA });
	const staleOf = (frames: { artboardId: string; hash: string | undefined }[]): boolean =>
		compareCanvasHandoff({ lastExport: legacy, frames }).stale;
	assert.equal(staleOf([{ artboardId: 'a', hash: hashA }]), false);
	assert.equal(staleOf([{ artboardId: 'a', hash: hashHtml('changed') }]), true);
	assert.equal(
		staleOf([
			{ artboardId: 'a', hash: hashA },
			{ artboardId: 'b', hash: hashA },
		]),
		true,
	);
});

// --- disk export ---------------------------------------------------------------------------

test('canvas export writes one tree, pristine frames, and lastExport.frames', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	const beforeManifest = await readManifestJson(workspaceRoot);
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	assert.equal(exported.exportId, FIXED_EXPORT_ID);
	assert.equal(exported.exportedAt, FIXED_NOW.toISOString());
	assert.equal(exported.handoffPath, handoffDirSegments(FIXED_EXPORT_ID).join('/'));

	const leafDir = join(workspaceRoot, ...handoffDirSegments(FIXED_EXPORT_ID));
	assert.deepEqual(
		await listTree(leafDir),
		[
			CANVAS_PREVIEW_FILE,
			IMPLEMENT_FILE,
			TOKENS_FILE,
			'desktop/a/index.html',
			'desktop/b/index.html',
			'ungrouped/c/index.html',
			'ungrouped/d/index.html',
		].sort(),
	);
	const expectedPaths: Record<string, string> = {
		a: 'desktop/a/index.html',
		b: 'desktop/b/index.html',
		c: 'ungrouped/c/index.html',
		d: 'ungrouped/d/index.html',
	};
	for (const [id, path] of Object.entries(expectedPaths)) {
		const exportedHtml = await readFile(join(leafDir, path), 'utf8');
		const diskHtml = await readFile(join(workspaceRoot, ...artboardHtmlPathSegments(id)), 'utf8');
		assert.equal(exportedHtml, diskHtml);
		assert.equal(exportedHtml, FRAME_HTML[id]);
		assert.ok(!exportedHtml.includes('data-cd-'));
		assert.ok(!exportedHtml.includes('cd:frame-'));
	}
	for (const file of [IMPLEMENT_FILE, TOKENS_FILE]) {
		assert.ok(!(await readFile(join(leafDir, file), 'utf8')).includes('cd:frame-height'));
	}
	assert.ok(
		(await readFile(join(leafDir, CANVAS_PREVIEW_FILE), 'utf8')).includes('cd:frame-height'),
	);

	const expectedFrames = ['a', 'b', 'c', 'd'].map((id) => ({
		artboardId: id,
		artboardHash: hashHtml(FRAME_HTML[id] ?? ''),
	}));
	assert.deepEqual(
		exported.frames,
		expectedFrames.map((frame) => ({ ...frame, path: expectedPaths[frame.artboardId] })),
	);
	const manifest = await readManifestJson(workspaceRoot);
	assert.equal(manifest.activeArtboardId, beforeManifest.activeArtboardId);
	assert.equal(manifest.updatedAt, FIXED_NOW.toISOString());
	assert.deepEqual(manifest.lastExport, {
		exportId: FIXED_EXPORT_ID,
		artboardId: 'd',
		artboardHash: hashHtml(FRAME_HTML.d ?? ''),
		exportedAt: FIXED_NOW.toISOString(),
		frames: expectedFrames,
	});
	assert.deepEqual(JSON.parse(await readFile(join(leafDir, TOKENS_FILE), 'utf8')), {
		version: 1,
		tokens: {},
	});
});

test('legacy lastExport frame falls back to the first frame when active is not exported', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	const existing = await readManifestJson(workspaceRoot);
	await writeFile(
		join(workspaceRoot, ...manifestPathSegments),
		serializeManifest({ ...existing, activeArtboardId: '' }),
	);
	await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const manifest = await readManifestJson(workspaceRoot);
	assert.equal(manifest.lastExport?.artboardId, 'a');
	assert.equal(manifest.activeArtboardId, 'a');
});

test('export without canvas.json puts every frame under ungrouped', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot, { withCanvas: false });
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	assert.deepEqual(
		await listTree(join(workspaceRoot, ...handoffDirSegments(exported.exportId))),
		[
			CANVAS_PREVIEW_FILE,
			IMPLEMENT_FILE,
			TOKENS_FILE,
			'ungrouped/a/index.html',
			'ungrouped/b/index.html',
			'ungrouped/c/index.html',
			'ungrouped/d/index.html',
		].sort(),
	);
});

test('export with a missing meta succeeds and creates that meta', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	const metaPath = join(workspaceRoot, ...artboardMetaPathSegments('d'));
	await rm(metaPath);
	await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
	assert.deepEqual(meta, {
		id: 'd',
		title: 'Artboard',
		generation: 1,
		hash: hashHtml(FRAME_HTML.d ?? ''),
		viewport: '1280x800',
		updatedAt: FIXED_NOW.toISOString(),
	});
	assert.equal((await readHandoffStatus({ workspaceRoot })).stale, false);
});

test('export with no manifest creates it active on the legacy frame', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	await rm(join(workspaceRoot, ...manifestPathSegments));
	await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const manifest = await readManifestJson(workspaceRoot);
	assert.equal(manifest.activeArtboardId, 'a');
	assert.equal(manifest.lastExport?.artboardId, 'a');
	assert.equal(manifest.lastExport?.frames?.length, 4);
});

test('read failures write no handoff leaf and keep their codes', async () => {
	const emptyRoot = await makeTempRoot();
	await mkdir(join(emptyRoot, ...artboardsDirSegments), { recursive: true });
	await assert.rejects(
		exportArtboard({ workspaceRoot: emptyRoot, now: FIXED_NOW }),
		(error: unknown) => {
			assert.ok(error instanceof NoArtboardsToExportError);
			assert.equal(error.code, 'ARTBOARD_NOT_FOUND');
			assert.equal(error.message, 'No artboards to export. Ask the agent to `set_artboard` first.');
			return true;
		},
	);
	assert.deepEqual(await handoffLeaves(emptyRoot), []);

	const missingDirRoot = await makeTempRoot();
	await assert.rejects(
		exportArtboard({ workspaceRoot: missingDirRoot, now: FIXED_NOW }),
		(error: unknown) => error instanceof NoArtboardsToExportError,
	);

	const corruptCanvasRoot = await makeTempRoot();
	await createFourFrameCanvas(corruptCanvasRoot);
	await writeFile(join(corruptCanvasRoot, ...canvasPathSegments), '{ not json', 'utf8');
	await assert.rejects(
		exportArtboard({ workspaceRoot: corruptCanvasRoot, now: FIXED_NOW }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptCanvasError);
			assert.equal(error.code, 'CORRUPT_CANVAS');
			return true;
		},
	);
	assert.deepEqual(await handoffLeaves(corruptCanvasRoot), []);

	const corruptMetaRoot = await makeTempRoot();
	await createFourFrameCanvas(corruptMetaRoot);
	const bMetaPath = join(corruptMetaRoot, ...artboardMetaPathSegments('b'));
	const bMeta = JSON.parse(await readFile(bMetaPath, 'utf8')) as Record<string, unknown>;
	await writeFile(bMetaPath, JSON.stringify({ ...bMeta, id: 'other' }), 'utf8');
	await assert.rejects(
		exportArtboard({ workspaceRoot: corruptMetaRoot, now: FIXED_NOW }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptMetaError);
			assert.equal(error.code, 'CORRUPT_META');
			return true;
		},
	);
	assert.deepEqual(await handoffLeaves(corruptMetaRoot), []);

	const dotIdRoot = await makeTempRoot();
	await createFourFrameCanvas(dotIdRoot);
	await writeFile(join(dotIdRoot, ...artboardsDirSegments, '..html'), '<p>dot</p>', 'utf8');
	await assert.rejects(
		exportArtboard({ workspaceRoot: dotIdRoot, now: FIXED_NOW }),
		(error: unknown) => {
			assert.ok(error instanceof DiskError);
			assert.equal(error.code, 'DISK_ERROR');
			assert.equal(
				error.message,
				'Artboard id "." cannot be exported as a folder. Rename .cursor-design/artboards/..html.',
			);
			return true;
		},
	);
	assert.deepEqual(await handoffLeaves(dotIdRoot), []);
});

test('missing tokens writes stub; present tokens are copied byte-for-byte', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFrame(workspaceRoot, 'hero', HERO_HTML);
	const first = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const stubTokens = await readFile(
		join(workspaceRoot, ...handoffDirSegments(first.exportId), TOKENS_FILE),
		'utf8',
	);
	assert.deepEqual(JSON.parse(stubTokens), { version: 1, tokens: {} });

	const tokensBytes = '{\n  "version": 1,\n  "tokens": { "color": " #fff " }\n}';
	await writeFile(join(workspaceRoot, ...workspaceTokensPathSegments), tokensBytes, 'utf8');
	const second = await exportArtboard({ workspaceRoot, now: new Date('2026-09-11T17:40:00.000Z') });
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
	await createFrame(workspaceRoot, 'hero', HERO_HTML);
	await mkdir(join(workspaceRoot, ...workspaceTokensPathSegments));
	await assert.rejects(exportArtboard({ workspaceRoot, now: FIXED_NOW }), (error: unknown) => {
		assert.ok(error instanceof DiskError);
		assert.equal(
			error.message,
			`${workspaceTokensPathSegments.join('/')} must be a regular file (symlinks rejected).`,
		);
		return true;
	});
	assert.deepEqual(await handoffLeaves(workspaceRoot), []);
});

test('export collision on an existing handoff dir is authored DiskError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFrame(workspaceRoot, 'hero', HERO_HTML);
	await mkdir(join(workspaceRoot, ...handoffDirSegments(FIXED_EXPORT_ID)), { recursive: true });
	await assert.rejects(exportArtboard({ workspaceRoot, now: FIXED_NOW }), (error: unknown) => {
		assert.ok(error instanceof DiskError);
		assert.equal(error.message, 'Handoff folder already exists. Retry export_artboard.');
		return true;
	});
	assert.deepEqual(await readdir(join(workspaceRoot, ...handoffDirSegments(FIXED_EXPORT_ID))), []);
});

test('unparsable or invalid meta fails export with CORRUPT_META and writes nothing', async () => {
	const corruptMetas = ['{ not json', JSON.stringify({ id: 'b', title: 'B', generation: 0 })];
	for (const metaText of corruptMetas) {
		const workspaceRoot = await makeTempRoot();
		await createFourFrameCanvas(workspaceRoot);
		const bMetaPath = join(workspaceRoot, ...artboardMetaPathSegments('b'));
		await writeFile(bMetaPath, metaText, 'utf8');
		await assert.rejects(exportArtboard({ workspaceRoot, now: FIXED_NOW }), (error: unknown) => {
			assert.ok(error instanceof CorruptMetaError);
			assert.equal(error.code, 'CORRUPT_META');
			assert.equal(error.artboardId, 'b');
			return true;
		});
		assert.deepEqual(await handoffLeaves(workspaceRoot), []);
		assert.equal(await readFile(bMetaPath, 'utf8'), metaText);
	}
});

// --- writers keep lastExport.frames --------------------------------------------------------

test('setActiveArtboard and updateArtboard preserve lastExport.frames byte-for-byte', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const lastExportText = async (): Promise<string> =>
		JSON.stringify((await readManifestJson(workspaceRoot)).lastExport);
	const before = await lastExportText();
	await setActiveArtboard({ workspaceRoot, artboardId: 'b' });
	assert.equal(await lastExportText(), before);
	await updateArtboard({ workspaceRoot, artboardId: 'a', html: '<p>a2</p>', baseGeneration: 1 });
	assert.equal(await lastExportText(), before);
	const raw = await readFile(join(workspaceRoot, ...manifestPathSegments), 'utf8');
	assert.ok(raw.includes('"frames": ['));
});

// --- handoff_status ------------------------------------------------------------------------

test('status is stale=false right after a canvas export and keeps active fields', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	const exported = await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, false);
	assert.equal(status.activeArtboardId, 'd');
	assert.equal(status.activeHash, hashHtml(FRAME_HTML.d ?? ''));
	assert.equal(status.lastExport?.exportId, exported.exportId);
});

test('status turns stale on any frame HTML change, add, or delete', async () => {
	const cases: { name: string; change: (workspaceRoot: string) => Promise<void> }[] = [
		{
			name: 'update_artboard on one frame',
			change: async (workspaceRoot) => {
				await updateArtboard({
					workspaceRoot,
					artboardId: 'b',
					html: '<p>b2</p>',
					baseGeneration: 1,
				});
			},
		},
		{
			name: 'set_artboard of a new id',
			change: async (workspaceRoot) => {
				await createFrame(workspaceRoot, 'e', '<p>e</p>');
			},
		},
		{
			name: 'deleting one artboard file',
			change: async (workspaceRoot) => {
				await rm(join(workspaceRoot, ...artboardHtmlPathSegments('c')));
			},
		},
		{
			name: 'direct HTML write without meta',
			change: async (workspaceRoot) => {
				await writeFile(
					join(workspaceRoot, ...artboardHtmlPathSegments('a')),
					'<p>hand</p>',
					'utf8',
				);
			},
		},
	];
	for (const { name, change } of cases) {
		const workspaceRoot = await makeTempRoot();
		await createFourFrameCanvas(workspaceRoot);
		await exportArtboard({ workspaceRoot, now: FIXED_NOW });
		await change(workspaceRoot);
		assert.equal((await readHandoffStatus({ workspaceRoot })).stale, true, name);
	}
});

test('status stays fresh after place_frame and set_active_artboard', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFourFrameCanvas(workspaceRoot);
	await exportArtboard({ workspaceRoot, now: FIXED_NOW });
	await placeFrame({ workspaceRoot, id: 'a', x: 5000, y: 300, label: 'Moved' });
	await placeFrame({ workspaceRoot, id: 'd', group: 'Mobile' });
	assert.equal((await readHandoffStatus({ workspaceRoot })).stale, false);
	await setActiveArtboard({ workspaceRoot, artboardId: 'a' });
	assert.equal((await readHandoffStatus({ workspaceRoot })).stale, false);
});

test('legacy lastExport without frames is stale once a second artboard exists', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFrame(workspaceRoot, 'hero', HERO_HTML);
	const existing = await readManifestJson(workspaceRoot);
	await writeFile(
		join(workspaceRoot, ...manifestPathSegments),
		serializeManifest({
			...existing,
			lastExport: {
				exportId: 'hero-20260911T173900123Z',
				artboardId: 'hero',
				artboardHash: hashHtml(HERO_HTML),
				exportedAt: FIXED_NOW.toISOString(),
			},
		}),
	);
	assert.equal((await readHandoffStatus({ workspaceRoot })).stale, false);
	await createFrame(workspaceRoot, 'other', '<p>other</p>');
	assert.equal((await readHandoffStatus({ workspaceRoot })).stale, true);
});

test('never exported is stale without lastExport', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFrame(workspaceRoot, 'hero', HERO_HTML);
	const status = await readHandoffStatus({ workspaceRoot });
	assert.equal(status.stale, true);
	assert.equal(status.lastExport, undefined);
});

test('malformed lastExport hash or date is CorruptManifestError', async () => {
	const workspaceRoot = await makeTempRoot();
	await createFrame(workspaceRoot, 'hero', HERO_HTML);
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
	await assert.rejects(
		readHandoffStatus({ workspaceRoot }),
		(error: unknown) => error instanceof CorruptManifestError,
	);
	assert.throws(
		() =>
			parseManifest({
				...validBase,
				lastExport: {
					...badHash.lastExport,
					artboardHash: hashHtml(HERO_HTML),
					exportedAt: 'not-a-date',
				},
			}),
		(error: unknown) => error instanceof CorruptManifestError,
	);
});
