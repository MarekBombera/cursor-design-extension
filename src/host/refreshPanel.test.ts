import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { emptyArtboardSnapshot, UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import type { CanvasSnapshot } from './canvasSnapshot';
import { refreshPanel } from './refreshPanel';

// One shared, ordered log of everything the host posts, so order is assertable.
const host = vi.hoisted(() => ({
	isTrusted: true,
	folder: { uri: { fsPath: '/ws' } } as unknown,
	calls: [] as string[],
}));

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
}));
vi.mock('./hostFs', () => ({
	firstWorkspaceFolder: () => host.folder,
	logDiskError: vi.fn(),
}));
vi.mock('./artboardDisk', () => ({
	initAndLoadArtboard: vi.fn(),
	readActiveArtboardFromDisk: vi.fn(),
}));
vi.mock('./panelComments', () => ({
	postPanelComments: vi.fn(() => {
		host.calls.push('comments');
		return Promise.resolve();
	}),
}));
vi.mock('../panel/openArtboardPanel', () => ({
	postArtboardSnapshotToPanel: vi.fn((snapshot: CanvasSnapshot) =>
		host.calls.push(`snapshot:${snapshot.pageId}`),
	),
}));

const { initAndLoadArtboard, readActiveArtboardFromDisk } = await import('./artboardDisk');
const { postArtboardSnapshotToPanel } = await import('../panel/openArtboardPanel');
const { postPanelComments } = await import('./panelComments');
const { logDiskError } = await import('./hostFs');

const outputChannel = {} as vscode.OutputChannel;
const page = (pageId: string, errorMessage?: string): CanvasSnapshot => ({
	...emptyArtboardSnapshot(errorMessage),
	pageId,
});
const posted = (): CanvasSnapshot[] =>
	vi.mocked(postArtboardSnapshotToPanel).mock.calls.map(([snapshot]) => snapshot);

beforeEach(() => {
	host.isTrusted = true;
	host.folder = { uri: { fsPath: '/ws' } };
	host.calls.length = 0;
	vi.clearAllMocks();
	vi.mocked(readActiveArtboardFromDisk).mockResolvedValue(page('page-1'));
	vi.mocked(initAndLoadArtboard).mockResolvedValue(page('page-init'));
});

test('a slow read overtaken by a newer refresh posts nothing; the newer posts snapshot then comments', async () => {
	let finishOlder: (snapshot: CanvasSnapshot) => void = () => {};
	vi.mocked(readActiveArtboardFromDisk)
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishOlder = resolve;
				}),
		)
		.mockResolvedValueOnce(page('page-new'));
	const older = refreshPanel({ outputChannel });
	await refreshPanel({ outputChannel });
	finishOlder(page('page-old'));
	await older;
	assert.deepEqual(host.calls, ['snapshot:page-new', 'comments']);
});

test('a superseded frame-place refresh hands its error to the newer post, once', async () => {
	let finishPlace: (snapshot: CanvasSnapshot) => void = () => {};
	vi.mocked(readActiveArtboardFromDisk)
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishPlace = resolve;
				}),
		)
		.mockResolvedValueOnce(page('page-new'))
		.mockResolvedValueOnce(page('page-later'));
	const place = refreshPanel({ outputChannel, errorMessage: 'busy' });
	await refreshPanel({ outputChannel });
	finishPlace(page('page-old'));
	await place;
	await refreshPanel({ outputChannel });
	assert.deepEqual(
		posted().map((snapshot) => [snapshot.pageId, snapshot.errorMessage]),
		[
			['page-new', 'busy'],
			['page-later', undefined],
		],
	);
});

test('initialize reads with initAndLoadArtboard, otherwise readActiveArtboardFromDisk', async () => {
	await refreshPanel({ outputChannel, initialize: true });
	await refreshPanel({ outputChannel });
	assert.equal(vi.mocked(initAndLoadArtboard).mock.calls.length, 1);
	assert.equal(vi.mocked(readActiveArtboardFromDisk).mock.calls.length, 1);
	assert.deepEqual(host.calls, ['snapshot:page-init', 'comments', 'snapshot:page-1', 'comments']);
});

test('errorMessage shows when the snapshot has none; a snapshot error wins over it', async () => {
	await refreshPanel({ outputChannel, errorMessage: 'Could not move the frame. Try again.' });
	vi.mocked(readActiveArtboardFromDisk).mockResolvedValueOnce(page('page-1', 'Layout broken.'));
	await refreshPanel({ outputChannel, errorMessage: 'Could not move the frame. Try again.' });
	assert.deepEqual(
		posted().map(({ pageId, errorMessage }) => ({ pageId, errorMessage })),
		[
			{ pageId: 'page-1', errorMessage: 'Could not move the frame. Try again.' },
			{ pageId: 'page-1', errorMessage: 'Layout broken.' },
		],
	);
});

test('no folder posts one empty snapshot with no disk read; untrusted shows the untrusted copy', async () => {
	host.folder = undefined;
	await refreshPanel({ outputChannel, errorMessage: 'place copy' });
	host.isTrusted = false;
	await refreshPanel({ outputChannel });
	assert.deepEqual(posted(), [
		emptyArtboardSnapshot('place copy'),
		emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE),
	]);
	assert.equal(vi.mocked(readActiveArtboardFromDisk).mock.calls.length, 0);
	assert.equal(vi.mocked(initAndLoadArtboard).mock.calls.length, 0);
	assert.equal(vi.mocked(postPanelComments).mock.calls.length, 2);
});

test('a throwing snapshot post resolves and logs once under refreshPanel', async () => {
	const failure = new Error('panel gone');
	vi.mocked(postArtboardSnapshotToPanel).mockImplementationOnce(() => {
		throw failure;
	});
	await refreshPanel({ outputChannel });
	assert.deepEqual(
		vi.mocked(logDiskError).mock.calls.map(([args]) => [args.scope, args.error]),
		[['refreshPanel', failure]],
	);
});
