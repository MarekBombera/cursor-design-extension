import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';

import { emptyArtboardSnapshot, UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import type { CanvasSnapshot } from './canvasSnapshot';
import { refreshPanel } from './refreshPanel';
import type { PanelPorts } from '../panel/openArtboardPanel';

// One shared, ordered log of everything the host posts, so order is assertable.
const host = vi.hoisted(() => ({
	isTrusted: true,
	folder: { uri: { fsPath: '/ws' } } as unknown,
	calls: [] as string[],
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

const { initAndLoadArtboard, readActiveArtboardFromDisk } = await import('./artboardDisk');
const { postPanelComments } = await import('./panelComments');

const ports = {
	isTrusted: () => host.isTrusted,
	workspaceRoot: () => (host.folder === undefined ? undefined : '/ws'),
	log: vi.fn(),
	postAnswer: vi.fn(),
	postSnapshot: vi.fn((snapshot: CanvasSnapshot) => host.calls.push(`snapshot:${snapshot.pageId}`)),
	postComments: vi.fn(),
	writeClipboard: vi.fn(() => Promise.resolve()),
	confirmModal: vi.fn(() => Promise.resolve(true)),
} satisfies PanelPorts;
const page = (pageId: string, errorMessage?: string): CanvasSnapshot => ({
	...emptyArtboardSnapshot(errorMessage),
	pageId,
});
const posted = (): CanvasSnapshot[] => ports.postSnapshot.mock.calls.map(([snapshot]) => snapshot);

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
	const older = refreshPanel({ ports });
	await refreshPanel({ ports });
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
	const place = refreshPanel({ ports, errorMessage: 'busy' });
	await refreshPanel({ ports });
	finishPlace(page('page-old'));
	await place;
	await refreshPanel({ ports });
	assert.deepEqual(
		posted().map((snapshot) => [snapshot.pageId, snapshot.errorMessage]),
		[
			['page-new', 'busy'],
			['page-later', undefined],
		],
	);
});

test('initialize reads with initAndLoadArtboard, otherwise readActiveArtboardFromDisk', async () => {
	await refreshPanel({ ports, initialize: true });
	await refreshPanel({ ports });
	assert.equal(vi.mocked(initAndLoadArtboard).mock.calls.length, 1);
	assert.equal(vi.mocked(readActiveArtboardFromDisk).mock.calls.length, 1);
	assert.deepEqual(host.calls, ['snapshot:page-init', 'comments', 'snapshot:page-1', 'comments']);
});

test('errorMessage shows when the snapshot has none; a snapshot error wins over it', async () => {
	await refreshPanel({ ports, errorMessage: 'Could not move the frame. Try again.' });
	vi.mocked(readActiveArtboardFromDisk).mockResolvedValueOnce(page('page-1', 'Layout broken.'));
	await refreshPanel({ ports, errorMessage: 'Could not move the frame. Try again.' });
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
	await refreshPanel({ ports, errorMessage: 'place copy' });
	host.isTrusted = false;
	await refreshPanel({ ports });
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
	ports.postSnapshot.mockImplementationOnce(() => {
		throw failure;
	});
	await refreshPanel({ ports });
	assert.deepEqual(
		ports.log.mock.calls.map(([scope, error]) => [scope, error]),
		[['refreshPanel', failure]],
	);
});
