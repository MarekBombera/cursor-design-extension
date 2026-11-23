import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { createArtboard, setActiveArtboard } from './artboardFs';
import { listArtboards, readCanvasView } from './canvasView';
import { exportArtboard } from './exportFs';
import { serializeCanvasLayout } from './canvasLayout';
import { CorruptCanvasError, DiskError, UnsupportedCanvasVersionError } from './errors';
import { hashHtml } from './hash';
import {
	FIRST_PAGE_ID,
	CANVAS_SCHEMA_VERSION,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
	artboardsDirSegments,
	canvasPathSegments,
	commentsPathSegments,
	manifestPathSegments,
} from './layout';
import { resolveOpenPage } from './openPage';
import { serializeMeta } from './parse';

// Pinned values: the module keeps these private.
const FRAME_READ_ERROR_MESSAGE =
	'Could not read this artboard file. Check the Output panel: Cursor Design.';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-canvas-view-'));
	tempRoots.push(workspaceRoot);
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const canvasFileOf = (workspaceRoot: string): string =>
	join(workspaceRoot, ...canvasPathSegments(FIRST_PAGE_ID));

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
	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.deepEqual(view, { activeArtboardId: '', frames: [], handoffStale: false });
	assert.equal('layoutErrorMessage' in view, false);
});

test('readCanvasView matches listArtboards geometry and keeps html plus generation', async () => {
	const workspaceRoot = await makeTempRoot();
	const heroHtml = '<p>hero</p>';
	const mobileHtml = '<p>mobile</p>';
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: heroHtml,
		title: 'Hero',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
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

	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
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

test('a page whose manifest.json was deleted by hand still reads its frames', async () => {
	const workspaceRoot = await makeTempRoot();
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	await createArtboard({
		page,
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await rm(join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID)));
	const view = await readCanvasView({ page });
	assert.deepEqual(
		view.frames.map((frame) => frame.id),
		['hero'],
	);
	assert.equal(view.activeArtboardId, '');
	assert.equal(view.handoffStale, false);
});

test('corrupt canvas.json auto-places frames and leaves the file unchanged', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'mobile',
		html: '<p>mobile</p>',
		writeEnsurePanelMarker: false,
	});
	const corruptText = '{ not json';
	await writeFile(canvasFileOf(workspaceRoot), corruptText);
	await assert.rejects(
		listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }),
		(error: unknown) => {
			assert.ok(error instanceof CorruptCanvasError);
			assert.ok(error.cause instanceof SyntaxError);
			return true;
		},
	);

	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(view.activeArtboardId, 'mobile');
	assert.equal(
		view.layoutErrorMessage,
		'Canvas layout is invalid. Fix or restore .cursor-design/pages/page-1/canvas.json (version 1), or delete it to auto-place every frame.',
	);
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const unsupportedText = '{"version":2,"frames":[]}\n';
	await writeFile(canvasFileOf(workspaceRoot), unsupportedText);

	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(view.activeArtboardId, 'hero');
	assert.equal(
		view.layoutErrorMessage,
		new UnsupportedCanvasVersionError({ pageId: FIRST_PAGE_ID, version: 2 }).message,
	);
	assert.deepEqual(
		view.frames.map(({ id, x, y, width }) => ({ id, x, y, width })),
		[{ id: 'hero', x: 0, y: 0, width: DEFAULT_FRAME_WIDTH }],
	);
	assert.equal(await readFile(canvasFileOf(workspaceRoot), 'utf8'), unsupportedText);
});

test('a zero-length HTML file is listed with empty html and no errorMessage', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'empty',
		html: '<p>temp</p>',
		writeEnsurePanelMarker: false,
	});
	await writeFile(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'empty')), '');

	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
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
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'linked',
		html: '<p>linked</p>',
		writeEnsurePanelMarker: false,
	});
	await rm(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'linked')));
	await symlink(
		outsidePath,
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'linked')),
	);
	await mkdir(join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID), 'weird.html'));
	// Not a valid artboard id: every tool would refuse it, so it is never listed.
	await writeFile(
		join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID), 'my page.html'),
		'<p>x</p>',
	);

	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
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

test('unreadable meta maps generation to 0 and keeps the active flag', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	await writeFile(
		join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero')),
		serializeMeta({
			id: 'other',
			title: 'Nope',
			generation: 99,
			hash: hashHtml(html),
			viewport: '1280x800',
			updatedAt: '2026-01-01T00:00:00.000Z',
		}),
	);

	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(view.frames.length, 1);
	assert.equal(view.frames[0]?.generation, 0);
	assert.equal(view.frames[0]?.html, html);

	// list_artboards' active flag holds on both the readable and the unreadable-meta entry.
	const page = { workspaceRoot, pageId: FIRST_PAGE_ID };
	await createArtboard({ page, artboardId: 'mobile', html, writeEnsurePanelMarker: false });
	const activeFlags = async (): Promise<boolean[]> =>
		(await listArtboards({ page })).artboards.map((entry) => entry.active);
	assert.deepEqual(await activeFlags(), [false, true]);
	await setActiveArtboard({ page, artboardId: 'hero' });
	assert.deepEqual(await activeFlags(), [true, false]);
});

test('the frame hash is hashHtml of the disk html even when the stored meta hash is upper-case', async () => {
	const workspaceRoot = await makeTempRoot();
	const html = '<p>hero</p>';
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html,
		writeEnsurePanelMarker: false,
	});
	const lower = hashHtml(html);
	await writeFile(
		join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero')),
		serializeMeta({
			id: 'hero',
			title: 'hero',
			generation: 1,
			hash: `sha256:${lower.slice('sha256:'.length).toUpperCase()}`,
			viewport: '1280x800',
			updatedAt: '2026-01-01T00:00:00.000Z',
		}),
	);

	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(view.frames[0]?.hash, lower);
});

test('unreadable html tiles FRAME_READ_ERROR_MESSAGE and keeps siblings', async (context) => {
	if (process.getuid?.() === 0) {
		context.skip('root ignores chmod');
		return;
	}
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'broken',
		html: '<p>broken</p>',
		writeEnsurePanelMarker: false,
	});
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'mobile',
		html: '<p>mobile</p>',
		writeEnsurePanelMarker: false,
	});
	const brokenPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'broken'));
	await chmod(brokenPath, 0o000);
	try {
		const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
		const broken = view.frames.find((frame) => frame.id === 'broken');
		const readError = view.htmlReadErrors?.find((entry) => entry.artboardId === 'broken');
		assert.deepEqual(
			view.frames.map((frame) => frame.id),
			['broken', 'hero', 'mobile'],
		);
		assert.equal(broken?.html, '');
		assert.equal(broken?.errorMessage, FRAME_READ_ERROR_MESSAGE);
		assert.equal(broken?.hash, '');
		assert.equal(view.frames.find((frame) => frame.id === 'hero')?.hash, hashHtml('<p>hero</p>'));
		assert.ok(readError?.error instanceof DiskError);
		assert.notEqual(readError?.error.message, FRAME_READ_ERROR_MESSAGE);
		assert.equal(view.frames.find((frame) => frame.id === 'hero')?.html, '<p>hero</p>');
		assert.equal(view.frames.find((frame) => frame.id === 'mobile')?.html, '<p>mobile</p>');
	} finally {
		await chmod(brokenPath, 0o644);
	}
});

test('handoffStale is off before export and right after it, on after an HTML change', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	assert.equal(
		(await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } })).handoffStale,
		false,
	);

	await exportArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.equal(
		(await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } })).handoffStale,
		false,
	);

	await writeFile(
		join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')),
		'<p>edited</p>',
	);
	assert.equal(
		(await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } })).handoffStale,
		true,
	);
});

test('handoffStale fails closed on an unreadable frame even when its bytes match the export', async (context) => {
	if (process.getuid?.() === 0) {
		context.skip('root ignores chmod');
		return;
	}
	const workspaceRoot = await makeTempRoot();
	// Exported empty, so a read error that tiles as '' would hash equal without the guard.
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'blank',
		html: '',
		writeEnsurePanelMarker: false,
	});
	await exportArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	const blankPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'blank'));
	await chmod(blankPath, 0o000);
	try {
		assert.equal(
			(await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } })).handoffStale,
			true,
		);
	} finally {
		await chmod(blankPath, 0o644);
	}
});

test('a corrupt comments.json does not change readCanvasView or listArtboards', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	const listed = await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	await writeFile(join(workspaceRoot, ...commentsPathSegments(FIRST_PAGE_ID)), '{', 'utf8');
	assert.deepEqual(await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }), view);
	assert.deepEqual(await listArtboards({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } }), listed);
});

test('handoffStale stays off once every exported frame is deleted', async () => {
	const workspaceRoot = await makeTempRoot();
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: '<p>hero</p>',
		writeEnsurePanelMarker: false,
	});
	await exportArtboard({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	await unlink(join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero')));
	const view = await readCanvasView({ page: { workspaceRoot, pageId: FIRST_PAGE_ID } });
	assert.deepEqual(view.frames, []);
	assert.equal(view.handoffStale, false);
});
