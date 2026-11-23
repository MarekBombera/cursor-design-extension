import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';

import { FRAME_READ_ERROR_MESSAGE, type CanvasViewFrame } from '../disk/artboardFs';
import { parseArtboardDocument } from '../disk/commentTarget';
import { cachedArtboardDocument } from '../disk/commentViews';
import { ArtboardNotFoundError, DiskError } from '../disk/errors';
import { hashHtml } from '../disk/hash';
import { MAX_POSTED_ARTBOARD_HTML_CHARS } from '../disk/layout';
import { sourceTaggedHtml } from '../disk/sourceTags';
import {
	ARTBOARD_HTML_TOO_LARGE_MESSAGE,
	canvasSnapshotErrorMessage,
	canvasViewReadLogs,
	emptyArtboardSnapshot,
	panelFrameHtml,
	panelFrames,
	postedFrameFromSnapshot,
	type CanvasSnapshot,
} from './canvasSnapshot';

// The real implementations behind counters; a case overrides one call with mockImplementationOnce.
vi.mock('../disk/sourceTags', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../disk/sourceTags')>();
	return { ...actual, sourceTaggedHtml: vi.fn(actual.sourceTaggedHtml) };
});
vi.mock('../disk/commentTarget', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../disk/commentTarget')>();
	return { ...actual, parseArtboardDocument: vi.fn(actual.parseArtboardDocument) };
});
vi.mock('../disk/commentViews', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../disk/commentViews')>();
	return { ...actual, cachedArtboardDocument: vi.fn(actual.cachedArtboardDocument) };
});

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
		hash: overrides.hash ?? hashHtml(overrides.html ?? '<p>ok</p>'),
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
	pageId: 'page-1',
	activeArtboardId: frames[0]?.id ?? '',
	generation: frames[0]?.generation ?? 0,
	frames,
	handoffStale: false,
});

test('postedFrameFromSnapshot maps fields only: no cap, errorMessage and group passed through', () => {
	const huge = 'x'.repeat(MAX_POSTED_ARTBOARD_HTML_CHARS + 1);
	const posted = postedFrameFromSnapshot(
		viewFrame({ id: 'huge', html: huge, errorMessage: FRAME_READ_ERROR_MESSAGE, group: 'Desktop' }),
	);
	assert.equal(posted.html, huge);
	assert.equal(posted.errorMessage, FRAME_READ_ERROR_MESSAGE);
	assert.equal(posted.group, 'Desktop');
	const sibling = postedFrameFromSnapshot(viewFrame({ id: 'hero' }));
	assert.equal('errorMessage' in sibling, false);
	assert.equal('group' in sibling, false);
	assert.equal(snapshotWithFrames([]).errorMessage, undefined);
	assert.equal(emptyArtboardSnapshot().errorMessage, undefined);
});

const ROOT = '/workspace';
const onTagError = vi.fn<(frameId: string, error: unknown) => void>();
const tagCalls = (): number => vi.mocked(sourceTaggedHtml).mock.calls.length;
const parseCalls = (): number => vi.mocked(parseArtboardDocument).mock.calls.length;

const postFrames = (frames: CanvasViewFrame[]): CanvasViewFrame[] =>
	panelFrames({ workspaceRoot: ROOT, frames, onTagError });

beforeEach(() => {
	// An empty list prunes every memo entry (every root's: the prune keeps only the keys posted).
	postFrames([]);
	vi.clearAllMocks();
});

test('panelFrames tags a normal frame', () => {
	const [posted] = postFrames([viewFrame({ id: 'hero', html: '<p>ok</p>' })]);
	assert.equal(posted?.html, '<p data-cd-src="0">ok</p>');
	assert.equal(onTagError.mock.calls.length, 0);
	// The comment flags' cache key: one parse per workspace and frame while the html is identical.
	assert.deepEqual(vi.mocked(cachedArtboardDocument).mock.calls, [
		[{ workspaceRoot: ROOT, frameId: 'hero', html: '<p>ok</p>' }],
	]);
});

test('the size cap is on the disk HTML: exactly MAX is tagged past it, MAX + 1 is not parsed', () => {
	const atCap = `<p>${'x'.repeat(MAX_POSTED_ARTBOARD_HTML_CHARS - 3)}`;
	const tooLarge = viewFrame({
		id: 'huge',
		html: `${atCap}x`,
		errorMessage: FRAME_READ_ERROR_MESSAGE,
	});
	const [postedAtCap, postedHuge] = postFrames([viewFrame({ id: 'cap', html: atCap }), tooLarge]);
	assert.ok(postedAtCap?.html.startsWith('<p data-cd-src="0">'));
	assert.ok((postedAtCap?.html.length ?? 0) > MAX_POSTED_ARTBOARD_HTML_CHARS);
	assert.equal(postedHuge?.html, '');
	assert.equal(postedHuge?.errorMessage, ARTBOARD_HTML_TOO_LARGE_MESSAGE);
	assert.equal(parseCalls(), 1);
});

test('the posted hash is the disk html hash, not the tagged copy hash', () => {
	const html = '<p>ok</p>';
	const [panel] = postFrames([viewFrame({ id: 'hero', html })]);
	assert.ok(panel !== undefined);
	const posted = postedFrameFromSnapshot(panel);
	assert.notEqual(posted.html, html);
	assert.equal(posted.hash, hashHtml(html));
	assert.notEqual(posted.hash, hashHtml(posted.html));
});

test('panelFrameHtml returns the identical string for the same disk html', () => {
	const args = { workspaceRoot: ROOT, frameId: 'hero', html: '<p>ok</p>', onTagError };
	const first = panelFrameHtml(args);
	const before = tagCalls();
	assert.equal(panelFrameHtml(args).html, first.html);
	assert.equal(tagCalls(), before);
	assert.equal(first.errorMessage, undefined);
});

test('a frame with errorMessage or empty html is copied unchanged and never parsed', () => {
	const broken = viewFrame({
		id: 'broken',
		html: '<p>x</p>',
		errorMessage: FRAME_READ_ERROR_MESSAGE,
	});
	const empty = viewFrame({ id: 'empty', html: '' });
	assert.deepEqual(postFrames([broken, empty]), [broken, empty]);
	assert.equal(parseCalls(), 0);
	assert.equal(tagCalls(), 0);
});

test('an unchanged frame comes from the memo; changed html is tagged again', () => {
	const first = postFrames([viewFrame({ id: 'hero', html: '<p>ok</p>' })]);
	const [tagCount, parseCount] = [tagCalls(), parseCalls()];
	const second = postFrames([viewFrame({ id: 'hero', html: '<p>ok</p>' })]);
	assert.equal(tagCalls() - tagCount, 0);
	assert.equal(parseCalls() - parseCount, 0);
	assert.equal(second[0]?.html, first[0]?.html);
	const changed = postFrames([viewFrame({ id: 'hero', html: '<p>new</p>' })]);
	assert.equal(changed[0]?.html, '<p data-cd-src="0">new</p>');
	assert.equal(tagCalls() - tagCount, 1);
});

test('a frame dropped and re-added with the same html is tagged again', () => {
	const hero = viewFrame({ id: 'hero', html: '<p>ok</p>' });
	postFrames([hero]);
	postFrames([viewFrame({ id: 'other', html: '<p>x</p>' })]);
	const before = tagCalls();
	postFrames([hero]);
	assert.equal(tagCalls() - before, 1);
});

test('a tag failure posts the untagged html, reports once and is not retried', () => {
	const failure = new Error('boom');
	vi.mocked(sourceTaggedHtml).mockImplementationOnce(() => {
		throw failure;
	});
	const hero = viewFrame({ id: 'hero', html: '<p>ok</p>' });
	assert.equal(postFrames([hero])[0]?.html, '<p>ok</p>');
	assert.deepEqual(onTagError.mock.calls, [['hero', failure]]);
	const before = tagCalls();
	assert.equal(postFrames([hero])[0]?.html, '<p>ok</p>');
	assert.equal(tagCalls() - before, 0);
	assert.equal(onTagError.mock.calls.length, 1);
});

test('a document parsed from other html takes the untagged path', () => {
	vi.mocked(cachedArtboardDocument).mockImplementationOnce(() =>
		parseArtboardDocument('ab<p>x</p>'),
	);
	const [posted] = postFrames([viewFrame({ id: 'hero', html: '<p>abcdef</p>' })]);
	assert.equal(posted?.html, '<p>abcdef</p>');
	assert.equal(onTagError.mock.calls.length, 1);
	assert.equal(onTagError.mock.calls[0]?.[0], 'hero');
});

test('panelFrames never mutates the input frames', () => {
	const frames = [
		viewFrame({ id: 'hero', html: '<p>ok</p>' }),
		viewFrame({ id: 'huge', html: 'x'.repeat(MAX_POSTED_ARTBOARD_HTML_CHARS + 1) }),
	];
	const copy = structuredClone(frames);
	const posted = postFrames(frames);
	assert.deepEqual(frames, copy);
	assert.notEqual(posted[0], frames[0]);
	assert.notEqual(posted, frames);
});

test('canvasSnapshotErrorMessage prefers a missing active artboard over layoutError', () => {
	const frames = [viewFrame({ id: 'hero' })];
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
		handoffStale: false,
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
