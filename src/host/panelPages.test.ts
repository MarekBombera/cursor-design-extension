import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { clearEditHistories, historyEpoch, historyFlags, recordEdit } from './editHistory';
import { MALFORMED_PAGE_REQUEST_MESSAGE, PAGE_GONE_MESSAGE } from './panelRequestCopy';
import {
	InvalidArgsError,
	LockTimeoutError,
	NoWorkspaceError,
	PageNotFoundError,
} from '../disk/errors';
import { hashHtml } from '../disk/hash';
import type { Project } from '../disk/parse';
import { answerPageRequest } from './panelPages';

// Pinned values: the copy module keeps these private.
const RENAME_REFUSED_MESSAGE = 'A page title needs 1 to 80 characters and no control characters.';
const LAST_PAGE_MESSAGE = 'The last page cannot be deleted.';

// One shared, ordered log of everything the host does, so order is assertable.
const host = vi.hoisted(() => ({
	isTrusted: true,
	hasFolder: true,
	calls: [] as string[],
	modalChoice: undefined as string | undefined,
}));
const showWarningMessage = vi.hoisted(() =>
	vi.fn(() => {
		host.calls.push('modal');
		return Promise.resolve(host.modalChoice);
	}),
);

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
	window: { showWarningMessage },
}));
vi.mock('./hostFs', () => ({
	firstWorkspaceFolder: () => (host.hasFolder ? { uri: { fsPath: '/ws' } } : undefined),
	logDiskError: vi.fn(),
}));
vi.mock('./refreshPanel', () => ({
	refreshPanel: vi.fn(() => {
		host.calls.push('refresh');
		return Promise.resolve();
	}),
}));
vi.mock('../panel/openArtboardPanel', () => ({
	postAnswerToPanel: vi.fn((answer: { type: string }) => host.calls.push(`answer:${answer.type}`)),
}));
vi.mock('../disk/openPage', () => ({
	resolveOpenPage: vi.fn(({ workspaceRoot }: { workspaceRoot: string }) =>
		Promise.resolve({ workspaceRoot, pageId: 'page-1' }),
	),
}));
vi.mock('../disk/layoutFs', () => ({ readProjectFile: vi.fn() }));
// listedPage stays real: it is the one listed-page rule the delete pre-check relies on.
vi.mock('../disk/pageOps', async (importOriginal) => ({
	listedPage: (await importOriginal<typeof import('../disk/pageOps')>()).listedPage,
	openPage: vi.fn(() => host.calls.push('write:open')),
	createPage: vi.fn(() => host.calls.push('write:create')),
	renamePage: vi.fn(() => host.calls.push('write:rename')),
	deletePage: vi.fn(() => host.calls.push('write:delete')),
}));

const { postAnswerToPanel } = await import('../panel/openArtboardPanel');
const { readProjectFile } = await import('../disk/layoutFs');
const { createPage, deletePage, openPage, renamePage } = await import('../disk/pageOps');
const { resolveOpenPage } = await import('../disk/openPage');

const outputChannel = {} as vscode.OutputChannel;
const answers = (): unknown[] => vi.mocked(postAnswerToPanel).mock.calls.map(([answer]) => answer);

const open = { type: 'page:open', requestId: 'req-1', pageId: 'page-2' };
const create = { type: 'page:create', requestId: 'req-2' };
const rename = { type: 'page:rename', requestId: 'req-3', pageId: 'page-2', title: 'Pricing' };
const remove = { type: 'page:delete', requestId: 'req-4', pageId: 'page-2' };

const project = (...ids: string[]): Project =>
	({
		version: 1,
		openPageId: 'page-1',
		pages: ids.map((id) => ({ id, title: `Title of ${id}` })),
	}) as Project;

const editFrame = (pageId: string): void => {
	const entry = (html: string): { html: string; hash: string } => ({ html, hash: hashHtml(html) });
	recordEdit({
		pageId,
		frameId: 'hero',
		base: entry('a'),
		next: entry('b'),
		epoch: historyEpoch(),
	});
};

beforeEach(() => {
	host.isTrusted = true;
	host.hasFolder = true;
	host.calls.length = 0;
	host.modalChoice = undefined;
	vi.clearAllMocks();
	clearEditHistories();
	vi.mocked(readProjectFile).mockResolvedValue(project('page-1', 'page-2'));
});

test('each request type answers page:saved after its write, then refreshes', async () => {
	host.modalChoice = 'Delete';
	const cases = [
		[open, 'open'],
		[create, 'create'],
		[rename, 'rename'],
		[remove, 'delete'],
	] as const;
	for (const [value, write] of cases) {
		host.calls.length = 0;
		vi.mocked(postAnswerToPanel).mockClear();
		await answerPageRequest({ value, outputChannel });
		assert.equal(host.calls.at(-3), `write:${write}`);
		assert.deepEqual(host.calls.slice(-2), ['answer:page:saved', 'refresh']);
		assert.deepEqual(answers(), [{ type: 'page:saved', requestId: value.requestId }]);
	}
	assert.deepEqual(vi.mocked(openPage).mock.calls[0]?.[0], {
		workspaceRoot: '/ws',
		pageId: 'page-2',
	});
	assert.deepEqual(vi.mocked(createPage).mock.calls[0]?.[0], {
		workspaceRoot: '/ws',
		writeEnsurePanelMarker: false,
	});
	assert.deepEqual(vi.mocked(renamePage).mock.calls[0]?.[0], {
		workspaceRoot: '/ws',
		pageId: 'page-2',
		title: 'Pricing',
	});
	// One resolve per request, never one that creates a project.
	assert.deepEqual(
		vi.mocked(resolveOpenPage).mock.calls.map(([args]) => args),
		cases.map(() => ({ workspaceRoot: '/ws', createIfFresh: false })),
	);
});

test('no usable requestId: nothing answered, nothing refreshed, nothing written', async () => {
	for (const value of [
		{ ...rename, requestId: 'a b' },
		{ type: 'page:delete', pageId: 'page-2' },
	]) {
		await answerPageRequest({ value, outputChannel });
	}
	assert.deepEqual(host.calls, []);
});

test('untrusted, no folder and malformed requests answer ui:error, then refresh, writing nothing', async () => {
	host.isTrusted = false;
	await answerPageRequest({ value: open, outputChannel });
	host.isTrusted = true;
	host.hasFolder = false;
	await answerPageRequest({ value: create, outputChannel });
	host.hasFolder = true;
	await answerPageRequest({ value: { ...rename, title: 7 }, outputChannel });
	await answerPageRequest({ value: { ...remove, pageId: '../x' }, outputChannel });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-1', message: UNTRUSTED_WORKSPACE_MESSAGE },
		{ type: 'ui:error', requestId: 'req-2', message: new NoWorkspaceError().message },
		{ type: 'ui:error', requestId: 'req-3', message: MALFORMED_PAGE_REQUEST_MESSAGE },
		{ type: 'ui:error', requestId: 'req-4', message: MALFORMED_PAGE_REQUEST_MESSAGE },
	]);
	assert.deepEqual(host.calls, [
		'answer:ui:error',
		'refresh',
		'answer:ui:error',
		'refresh',
		'answer:ui:error',
		'refresh',
		'answer:ui:error',
		'refresh',
	]);
	assert.equal(vi.mocked(resolveOpenPage).mock.calls.length, 0);
});

test('delete of an unlisted id, with no project.json, or of the last page refuses before the modal', async () => {
	vi.mocked(readProjectFile).mockResolvedValueOnce(project('page-1', 'page-3'));
	await answerPageRequest({ value: remove, outputChannel });
	vi.mocked(readProjectFile).mockResolvedValueOnce(undefined);
	await answerPageRequest({ value: remove, outputChannel });
	vi.mocked(readProjectFile).mockResolvedValueOnce(project('page-2'));
	await answerPageRequest({ value: remove, outputChannel });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-4', message: PAGE_GONE_MESSAGE },
		{ type: 'ui:error', requestId: 'req-4', message: PAGE_GONE_MESSAGE },
		{ type: 'ui:error', requestId: 'req-4', message: LAST_PAGE_MESSAGE },
	]);
	assert.equal(showWarningMessage.mock.calls.length, 0);
	assert.equal(vi.mocked(deletePage).mock.calls.length, 0);
	assert.equal(host.calls.filter((call) => call === 'refresh').length, 3);
});

test('a cancelled modal answers page:saved, deletes nothing and refreshes', async () => {
	editFrame('page-2');
	await answerPageRequest({ value: remove, outputChannel });
	assert.deepEqual(host.calls, ['modal', 'answer:page:saved', 'refresh']);
	assert.equal(vi.mocked(deletePage).mock.calls.length, 0);
	assert.equal(historyFlags({ pageId: 'page-2', frameId: 'hero' }).canUndo, true);
	assert.deepEqual(showWarningMessage.mock.calls[0], [
		'Delete "Title of page-2"?',
		{ modal: true, detail: 'Its files move to .cursor-design/deleted/.' },
		'Delete',
	]);
});

test("a confirmed delete deletes, forgets only that page's histories, answers page:saved", async () => {
	host.modalChoice = 'Delete';
	for (const pageId of ['page-2', 'page-1', 'page-20']) {
		editFrame(pageId);
	}
	await answerPageRequest({ value: remove, outputChannel });
	assert.deepEqual(host.calls, ['modal', 'write:delete', 'answer:page:saved', 'refresh']);
	assert.equal(vi.mocked(deletePage).mock.calls[0]?.[0].pageId, 'page-2');
	assert.equal(historyFlags({ pageId: 'page-2', frameId: 'hero' }).canUndo, false);
	assert.equal(historyFlags({ pageId: 'page-1', frameId: 'hero' }).canUndo, true);
	assert.equal(historyFlags({ pageId: 'page-20', frameId: 'hero' }).canUndo, true);
});

test('a busy lock answers its own copy; Agent copy never reaches the panel', async () => {
	const busy = new LockTimeoutError();
	vi.mocked(renamePage).mockRejectedValueOnce(busy);
	await answerPageRequest({ value: rename, outputChannel });
	const agentRefusal = new InvalidArgsError('title must be 1 to 80 characters. Call list_pages.');
	vi.mocked(renamePage).mockRejectedValueOnce(agentRefusal);
	await answerPageRequest({ value: rename, outputChannel });
	const gone = new PageNotFoundError('page-2', { reason: 'unlisted' });
	vi.mocked(openPage).mockRejectedValueOnce(gone);
	await answerPageRequest({ value: open, outputChannel });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'req-3', message: busy.message },
		{ type: 'ui:error', requestId: 'req-3', message: RENAME_REFUSED_MESSAGE },
		{ type: 'ui:error', requestId: 'req-1', message: PAGE_GONE_MESSAGE },
	]);
	assert.deepEqual(host.calls, [
		'answer:ui:error',
		'refresh',
		'answer:ui:error',
		'refresh',
		'answer:ui:error',
		'refresh',
	]);
});
