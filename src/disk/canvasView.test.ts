import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import {
	createArtboard,
	FRAME_READ_ERROR_MESSAGE,
	listArtboards,
	readCanvasView,
} from './artboardFs';
import { serializeCanvasLayout } from './canvasLayout';
import { CorruptCanvasError, DiskError, UnsupportedCanvasVersionError } from './errors';
import { hashHtml } from './hash';
import {
	ARTBOARDS_DIR,
	CANVAS_SCHEMA_VERSION,
	CURSOR_DESIGN_DIR,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	canvasPathSegments,
} from './layout';
import { serializeMeta } from './parse';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-canvas-view-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const canvasFileOf = (workspaceRoot: string): string => join(workspaceRoot, ...canvasPathSegments);

const frameGeometry = ({
	id,
	label,
	x,
	y,
	width,
	group,
}: {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	group?: string;
}): { id: string; label: string; x: number; y: number; width: number; group?: string } => {
	if (group === undefined) {
		return { id, label, x, y, width };
	}
	return { id, label, x, y, width, group };
};

test('readCanvasView is empty when artboards and canvas.json are missing', async () => {
	const workspaceRoot = await makeTempRoot();
	const view = await readCanvasView({ workspaceRoot });
	assert.deepEqual(view, { activeArtboardId: '', frames: [] });
	assert.equal('layoutErrorMessage' in view, false);
});

test('readCanvasView matches listArtboards geometry and keeps html plus generation', async () => {
	const workspaceRoot = await makeTempRoot();
	const heroHtml = '<p>hero</p>';
	const mobileHtml = '<p>mobile</p>';
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: heroHtml,
		title: 'Hero',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		workspaceRoot,
		artboardId: 'mobile',
		html: mobileHtml,
		title: 'Mobile',
		writeEnsurePanelMarker: false,
	});
	const storedHero = {
		id: 'hero',
		label: 'Home',
		x: 40,
		y: 80,
		width: 960,
		group: 'Desktop',
	};
	await writeFile(
		canvasFileOf(workspaceRoot),
		serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [storedHero] }),
	);

	const listed = await listArtboards({ workspaceRoot });
	const view = await readCanvasView({ workspaceRoot });
	assert.equal(view.activeArtboardId, listed.activeArtboardId);
	assert.equal('layoutErrorMessage' in view, false);
	const listedArtboard = listed.artboards[0];
	assert.ok(listedArtboard);
	assert.equal('html' in listedArtboard, false);
	assert.deepEqual(view.frames.map(frameGeometry), listed.frames.map(frameGeometry));
	assert.deepEqual(
		view.frames.map(({ id, html, generation }) => ({ id, html, generation })),
		[
			{ id: 'hero', html: heroHtml, generation: 1 },
			{ id: 'mobile', html: mobileHtml, generation: 1 },
		],
	);
	assert.equal(listed.frames[1]?.x, storedHero.x + storedHero.width + FRAME_GAP);
	assert.equal(listed.frames[1]?.width, DEFAULT_FRAME_WIDTH);
});

test('corrupt canvas.json auto-places frames and leaves the file unchanged', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		workspaceRoot,
		artboardId: 'mobile',
		html: '<p>mobile</p>',
		writeEnsurePanelMarker: false,
	});
	const corruptText = '{ not json';
	await writeFile(canvasFileOf(workspaceRoot), corruptText);
	await assert.rejects(listArtboards({ workspaceRoot }), (error: unknown) => {
		assert.ok(error instanceof CorruptCanvasError);
		return true;
	});

	const view = await readCanvasView({ workspaceRoot });
	assert.equal(view.activeArtboardId, 'mobile');
	assert.equal(view.layoutErrorMessage, new CorruptCanvasError().message);
	assert.deepEqual(view.frames.map(frameGeometry), [
		{ id: 'hero', label: 'Artboard', x: 0, y: 0, width: DEFAULT_FRAME_WIDTH },
		{
			id: 'mobile',
			label: 'Artboard',
			x: DEFAULT_FRAME_WIDTH + FRAME_GAP,
			y: 0,
			width: DEFAULT_FRAME_WIDTH,
		},
	]);
	assert.equal(await readFile(canvasFileOf(workspaceRoot), 'utf8'), corruptText);
});

test('unsupported canvas.json version auto-places frames and leaves the file unchanged', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const unsupportedText = '{"version":2,"frames":[]}\n';
	await writeFile(canvasFileOf(workspaceRoot), unsupportedText);

	const view = await readCanvasView({ workspaceRoot });
	assert.equal(view.activeArtboardId, 'hero');
	assert.equal(view.layoutErrorMessage, new UnsupportedCanvasVersionError(2).message);
	assert.deepEqual(
		view.frames.map(({ id, x, y, width }) => ({ id, x, y, width })),
		[{ id: 'hero', x: 0, y: 0, width: DEFAULT_FRAME_WIDTH }],
	);
	assert.equal(await readFile(canvasFileOf(workspaceRoot), 'utf8'), unsupportedText);
});

test('a zero-length HTML file is listed with empty html and no errorMessage', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'empty',
		html: '<p>temp</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(join(workspaceRoot, ...artboardHtmlPathSegments('empty')), '');

	const view = await readCanvasView({ workspaceRoot });
	assert.equal(view.frames.length, 1);
	assert.equal(view.frames[0]?.id, 'empty');
	assert.equal(view.frames[0]?.html, '');
	assert.equal('errorMessage' in (view.frames[0] ?? {}), false);
});

test('directory and symlink html files are skipped the same as listArtboards', async () => {
	const workspaceRoot = await makeTempRoot();
	const outsideDir = await makeTempRoot();
	const outsidePath = join(outsideDir, 'secret.html');
	await writeFile(outsidePath, 'secret', 'utf8');
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		workspaceRoot,
		artboardId: 'linked',
		html: '<p>linked</p>',
		writeEnsurePanelMarker: false,
	});
	await rm(join(workspaceRoot, ...artboardHtmlPathSegments('linked')));
	await symlink(outsidePath, join(workspaceRoot, ...artboardHtmlPathSegments('linked')));
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR, ARTBOARDS_DIR, 'weird.html'));

	const listed = await listArtboards({ workspaceRoot });
	const view = await readCanvasView({ workspaceRoot });
	assert.deepEqual(
		listed.artboards.map((entry) => entry.artboardId),
		['hero'],
	);
	assert.deepEqual(
		view.frames.map((frame) => frame.id),
		listed.frames.map((frame) => frame.id),
	);
	assert.deepEqual(
		view.frames.map((frame) => frame.id),
		['hero'],
	);
});

test('unreadable meta maps generation to 0', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	await writeFile(
		join(workspaceRoot, ...artboardMetaPathSegments('hero')),
		serializeMeta({
			id: 'other',
			title: 'Nope',
			generation: 99,
			hash: hashHtml(html),
			viewport: '1280x800',
			updatedAt: '2026-01-01T00:00:00.000Z',
		}),
	);

	const view = await readCanvasView({ workspaceRoot });
	assert.equal(view.frames.length, 1);
	assert.equal(view.frames[0]?.generation, 0);
	assert.equal(view.frames[0]?.html, html);
});

test('unreadable html tiles FRAME_READ_ERROR_MESSAGE and keeps siblings', async (context) => {
	if (process.getuid?.() === 0) {
		context.skip('root ignores chmod');
		return;
	}
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		workspaceRoot,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		workspaceRoot,
		artboardId: 'broken',
		html: '<p>broken</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		workspaceRoot,
		artboardId: 'mobile',
		html: '<p>mobile</p>',
		writeEnsurePanelMarker: false,
	});
	const brokenPath = join(workspaceRoot, ...artboardHtmlPathSegments('broken'));
	await chmod(brokenPath, 0o000);
	try {
		const view = await readCanvasView({ workspaceRoot });
		const broken = view.frames.find((frame) => frame.id === 'broken');
		const readError = view.htmlReadErrors?.find((entry) => entry.artboardId === 'broken');
		assert.deepEqual(
			view.frames.map((frame) => frame.id),
			['broken', 'hero', 'mobile'],
		);
		assert.equal(broken?.html, '');
		assert.equal(broken?.errorMessage, FRAME_READ_ERROR_MESSAGE);
		assert.ok(readError?.error instanceof DiskError);
		assert.notEqual(readError?.error.message, FRAME_READ_ERROR_MESSAGE);
		assert.equal(view.frames.find((frame) => frame.id === 'hero')?.html, '<p>hero</p>');
		assert.equal(view.frames.find((frame) => frame.id === 'mobile')?.html, '<p>mobile</p>');
	} finally {
		await chmod(brokenPath, 0o644);
	}
});
