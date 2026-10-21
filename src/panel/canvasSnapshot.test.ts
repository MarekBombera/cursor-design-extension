import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { FRAME_READ_ERROR_MESSAGE, type CanvasViewFrame } from '../disk/artboardFs';
import { ArtboardNotFoundError, DiskError } from '../disk/errors';
import {
	ARTBOARD_HTML_TOO_LARGE_MESSAGE,
	MAX_POSTED_ARTBOARD_HTML_CHARS,
	UNTRUSTED_WORKSPACE_MESSAGE,
	canvasSnapshotErrorMessage,
	canvasViewReadLogs,
	emptyArtboardSnapshot,
	postedFrameFromSnapshot,
	snapshotForChrome,
	type CanvasSnapshot,
} from '../host/canvasSnapshot';

const viewFrame = (
	overrides: Partial<CanvasViewFrame> & Pick<CanvasViewFrame, 'id'>,
): CanvasViewFrame => {
	const frame: CanvasViewFrame = {
		id: overrides.id,
		label: overrides.label ?? overrides.id,
		x: overrides.x ?? 0,
		y: overrides.y ?? 0,
		width: overrides.width ?? 1280,
		html: overrides.html ?? '<p>ok</p>',
		generation: overrides.generation ?? 1,
	};
	if (overrides.group !== undefined) {
		frame.group = overrides.group;
	}
	if (overrides.errorMessage !== undefined) {
		frame.errorMessage = overrides.errorMessage;
	}
	return frame;
};

const snapshotWithFrames = (frames: CanvasViewFrame[]): CanvasSnapshot => ({
	activeArtboardId: frames[0]?.id ?? '',
	generation: frames[0]?.generation ?? 0,
	frames,
	handoffStale: false,
});

test('snapshotForChrome blanks frames when untrusted and keeps a load error', () => {
	const snapshot = snapshotWithFrames([viewFrame({ id: 'hero', html: '<p>secret</p>' })]);
	const untrusted = snapshotForChrome({ snapshot, isTrusted: false });
	assert.deepEqual(untrusted.frames, []);
	assert.equal(untrusted.errorMessage, UNTRUSTED_WORKSPACE_MESSAGE);
	assert.equal(snapshotForChrome({ snapshot, isTrusted: true }), snapshot);

	const withLoadError = snapshotForChrome({
		snapshot: { ...snapshot, errorMessage: 'Could not load artboard.' },
		isTrusted: false,
	});
	assert.deepEqual(withLoadError.frames, []);
	assert.equal(withLoadError.errorMessage, 'Could not load artboard.');
});

test('postedFrameFromSnapshot caps each frame at 1.5M without a global banner', () => {
	const tooLarge = viewFrame({
		id: 'huge',
		html: 'x'.repeat(MAX_POSTED_ARTBOARD_HTML_CHARS + 1),
		errorMessage: FRAME_READ_ERROR_MESSAGE,
	});
	const sibling = viewFrame({ id: 'hero', html: '<p>ok</p>', group: 'Desktop' });
	const snapshot = snapshotWithFrames([tooLarge, sibling]);
	const postedHuge = postedFrameFromSnapshot(tooLarge);
	const postedSibling = postedFrameFromSnapshot(sibling);

	assert.equal(postedHuge.html, '');
	assert.equal(postedHuge.errorMessage, ARTBOARD_HTML_TOO_LARGE_MESSAGE);
	assert.equal(postedSibling.html, '<p>ok</p>');
	assert.equal(postedSibling.group, 'Desktop');
	assert.equal('errorMessage' in postedSibling, false);
	assert.equal(snapshot.errorMessage, undefined);
	assert.equal(emptyArtboardSnapshot().errorMessage, undefined);
});

test('canvasSnapshotErrorMessage prefers load error, then missing active, then layoutError', () => {
	const frames = [viewFrame({ id: 'hero' })];
	assert.equal(
		canvasSnapshotErrorMessage({
			loadErrorMessage: UNTRUSTED_WORKSPACE_MESSAGE,
			activeArtboardId: 'missing',
			frames,
			layoutErrorMessage: 'Canvas layout is invalid.',
		}),
		UNTRUSTED_WORKSPACE_MESSAGE,
	);
	assert.equal(
		canvasSnapshotErrorMessage({
			activeArtboardId: 'missing',
			frames,
			layoutErrorMessage: 'Canvas layout is invalid.',
		}),
		new ArtboardNotFoundError('missing').message,
	);
	assert.equal(
		canvasSnapshotErrorMessage({
			activeArtboardId: 'hero',
			frames,
			layoutErrorMessage: 'Canvas layout is invalid.',
		}),
		'Canvas layout is invalid.',
	);
	assert.equal(
		canvasSnapshotErrorMessage({
			activeArtboardId: 'hero',
			frames: [viewFrame({ id: 'hero' })],
		}),
		undefined,
	);
});

test('canvasViewReadLogs keeps DiskError for Output and uses the tile message', () => {
	const diskError = new DiskError();
	const logs = canvasViewReadLogs({
		activeArtboardId: 'hero',
		frames: [
			viewFrame({ id: 'broken', html: '', errorMessage: FRAME_READ_ERROR_MESSAGE }),
			viewFrame({ id: 'hero', html: '<p>ok</p>' }),
		],
		htmlReadErrors: [{ artboardId: 'broken', error: diskError }],
	});
	assert.deepEqual(
		logs.map((readLog) => ({
			scope: readLog.scope,
			tileMessage: readLog.tileMessage,
			error: readLog.error,
		})),
		[
			{
				scope: 'artboardDisk.frameRead:broken',
				tileMessage: FRAME_READ_ERROR_MESSAGE,
				error: diskError,
			},
		],
	);
	assert.notEqual(diskError.message, FRAME_READ_ERROR_MESSAGE);
});

test('artboardDisk logs framed reads and isolates handoff-stale I/O', () => {
	const diskSource = readFileSync(join(process.cwd(), 'src/host/artboardDisk.ts'), 'utf8');
	assert.ok(diskSource.includes('canvasViewReadLogs(view)'));
	assert.ok(diskSource.includes('logDiskError({ scope: readLog.scope, error: readLog.error'));
	assert.ok(diskSource.includes("scope: 'artboardDisk.handoffStale'"));
	assert.ok(diskSource.includes('handoffStale = true'));
});
