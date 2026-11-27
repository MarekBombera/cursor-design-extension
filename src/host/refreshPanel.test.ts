import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import { createArtboard } from '../disk/artboardFs';
import { CorruptProjectError } from '../disk/errors';
import { DEFAULT_ARTBOARD_ID, FIRST_PAGE_ID, projectPathSegments } from '../disk/layout';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, openPage } from '../disk/pageOps';
import { emptyArtboardSnapshot, UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import type { CanvasSnapshot } from './canvasSnapshot';
import { refreshPanel } from './refreshPanel';
import type { PanelPorts } from '../panel/openArtboardPanel';

// End to end over a real temp workspace: the real loader and comment read run; only the ports are
// faked. Every refresh posts comments fire-and-forget, so each test waits for that post.

const PLACE_MESSAGE = 'Could not move the frame. Try again.';
const HTML = '<h1>Hi</h1>';

let root = '';
let trusted = true;
// One ordered log of everything the host posts, so order is assertable.
let calls: string[] = [];

const createPorts = () => ({
	isTrusted: () => trusted,
	workspaceRoot: vi.fn((): string | undefined => root),
	log: vi.fn(),
	postAnswer: vi.fn(),
	postSnapshot: vi.fn((snapshot: CanvasSnapshot) => {
		calls.push(`snapshot:${snapshot.pageId}`);
	}),
	postComments: vi.fn(() => {
		calls.push('comments');
	}),
	writeClipboard: vi.fn(() => Promise.resolve()),
	confirmModal: vi.fn(() => Promise.resolve(true)),
});
let ports = createPorts() satisfies PanelPorts;

const posted = (): CanvasSnapshot[] => ports.postSnapshot.mock.calls.map(([snapshot]) => snapshot);

const waitForComments = (count: number): Promise<void> =>
	vi.waitFor(
		() => {
			assert.equal(ports.postComments.mock.calls.length, count);
		},
		{ timeout: 5000 },
	);

// page-1 and page-2, each with a hero artboard; page-1 open.
const buildTwoPageWorkspace = async (): Promise<void> => {
	await resolveOpenPage({ workspaceRoot: root, createIfFresh: true });
	await createArtboard({
		page: { workspaceRoot: root, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: HTML,
		writeEnsurePanelMarker: false,
	});
	const { page } = await createPage({ workspaceRoot: root, writeEnsurePanelMarker: false });
	await createArtboard({
		page: { workspaceRoot: root, pageId: page.id },
		artboardId: 'hero',
		html: HTML,
		writeEnsurePanelMarker: false,
	});
	await openPage({ workspaceRoot: root, pageId: FIRST_PAGE_ID });
};

beforeEach(async () => {
	trusted = true;
	calls = [];
	ports = createPorts();
	root = await mkdtemp(join(tmpdir(), 'vibeboard-refreshPanel-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test('a slow read overtaken by a newer refresh posts nothing; the newer posts snapshot then comments', async () => {
	await buildTwoPageWorkspace();
	const older = refreshPanel({ ports });
	await refreshPanel({ ports });
	await older;
	await waitForComments(1);
	assert.deepEqual(calls, ['snapshot:page-1', 'comments']);
});

test('a superseded frame-place refresh hands its error to the newer post, once', async () => {
	await buildTwoPageWorkspace();
	const place = refreshPanel({ ports, errorMessage: 'busy' });
	await refreshPanel({ ports });
	await place;
	await waitForComments(1);
	await refreshPanel({ ports });
	await waitForComments(2);
	assert.deepEqual(
		posted().map((snapshot) => [snapshot.pageId, snapshot.errorMessage]),
		[
			['page-1', 'busy'],
			['page-1', undefined],
		],
	);
});

test('initialize creates the project and default artboard; a plain refresh of a fresh root creates nothing', async () => {
	await refreshPanel({ ports });
	await waitForComments(1);
	assert.deepEqual(posted(), [{ ...emptyArtboardSnapshot(), pageId: FIRST_PAGE_ID, pages: [] }]);
	assert.deepEqual(await readdir(root), []);

	await refreshPanel({ ports, initialize: true });
	await waitForComments(2);
	assert.deepEqual(
		posted()[1]?.frames.map((frame) => frame.id),
		[DEFAULT_ARTBOARD_ID],
	);
	await access(join(root, ...projectPathSegments));
});

test('errorMessage shows when the snapshot has none; a snapshot error wins over it', async () => {
	await buildTwoPageWorkspace();
	await refreshPanel({ ports, errorMessage: PLACE_MESSAGE });
	await waitForComments(1);
	await writeFile(join(root, ...projectPathSegments), '{');
	await refreshPanel({ ports, errorMessage: PLACE_MESSAGE });
	await waitForComments(2);
	assert.deepEqual(
		posted().map(({ pageId, errorMessage }) => ({ pageId, errorMessage })),
		[
			{ pageId: 'page-1', errorMessage: PLACE_MESSAGE },
			{ pageId: '', errorMessage: new CorruptProjectError().message },
		],
	);
});

// Untrusted runs twice: with no folder refreshPanel picks the copy itself, with one the loader does.
test('no folder posts one empty snapshot with the place copy; untrusted shows the untrusted copy', async () => {
	await buildTwoPageWorkspace();
	ports.workspaceRoot.mockReturnValueOnce(undefined);
	await refreshPanel({ ports, errorMessage: 'place copy' });
	await waitForComments(1);
	trusted = false;
	ports.workspaceRoot.mockReturnValueOnce(undefined);
	await refreshPanel({ ports });
	await waitForComments(2);
	await refreshPanel({ ports });
	await waitForComments(3);
	assert.deepEqual(posted(), [
		emptyArtboardSnapshot('place copy'),
		emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE),
		emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE),
	]);
});

test('a throwing snapshot post resolves and logs once under refreshPanel', async () => {
	await buildTwoPageWorkspace();
	const failure = new Error('panel gone');
	ports.postSnapshot.mockImplementationOnce(() => {
		throw failure;
	});
	await refreshPanel({ ports });
	assert.deepEqual(
		ports.log.mock.calls.map(([scope, error]) => [scope, error]),
		[['refreshPanel', failure]],
	);
});
