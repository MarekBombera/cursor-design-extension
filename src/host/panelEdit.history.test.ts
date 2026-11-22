import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { createArtboard, readArtboard } from '../disk/artboardFs';
import { LockTimeoutError } from '../disk/errors';
import { hashHtml } from '../disk/hash';
import { clearEditHistories, historyFlags } from './editHistory';
import { FIRST_PAGE_ID, MAX_HISTORY_STEPS, artboardHtmlPathSegments } from '../disk/layout';
import { resolveOpenPage } from '../disk/openPage';
import { withWorkspaceLock } from '../disk/workspaceLock';
import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import {
	EDIT_FRAME_GONE_MESSAGE,
	HISTORY_CLEARED_MESSAGE,
	MALFORMED_HISTORY_MESSAGE,
	NOTHING_TO_REDO_MESSAGE,
	NOTHING_TO_UNDO_MESSAGE,
} from './panelRequestCopy';
import { answerEditRequest, answerHistoryRequest } from './panelEdit';

// End to end over a real temp workspace: only the vscode glue is stubbed (panelEdit.test.ts mocks
// the disk lib instead).

const host = vi.hoisted(() => ({ isTrusted: true, root: '', logs: 0 }));

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
}));
vi.mock('./hostFs', () => ({
	firstWorkspaceFolder: () => ({ uri: { fsPath: host.root } }),
	logDiskError: vi.fn(() => {
		host.logs += 1;
	}),
}));
vi.mock('../panel/openArtboardPanel', () => ({ postAnswerToPanel: vi.fn() }));

const { postAnswerToPanel } = await import('../panel/openArtboardPanel');

type Answer = {
	type: string;
	requestId: string;
	message?: string;
	hash?: string;
	generation?: number;
	html?: string;
	canUndo?: boolean;
	canRedo?: boolean;
};

const outputChannel = {} as vscode.OutputChannel;
const ORIGINAL = '<main>\n  <p style="padding: 1px">x</p>\n</main>\n';
let requestCount = 0;

const lastAnswer = (): Answer => vi.mocked(postAnswerToPanel).mock.calls.at(-1)?.[0] as Answer;

const htmlPath = (): string => join(host.root, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));

const diskHtml = (): Promise<string> => readFile(htmlPath(), 'utf8');

// One style edit on the <p> (source number 1) against the file's current hash.
const editStyles = async (styles: Array<{ field: string; value: string }>): Promise<Answer> => {
	requestCount += 1;
	await answerEditRequest({
		value: {
			type: 'artboard:edit',
			requestId: `edit-${requestCount}`,
			frameId: 'hero',
			sourceNumber: 1,
			hash: hashHtml(await diskHtml()),
			styles,
		},
		outputChannel,
	});
	return lastAnswer();
};

const editPadding = (value: string): Promise<Answer> => editStyles([{ field: 'padding', value }]);

const historyStep = async (
	step: string,
	overrides: Record<string, unknown> = {},
): Promise<Answer | undefined> => {
	requestCount += 1;
	const before = vi.mocked(postAnswerToPanel).mock.calls.length;
	await answerHistoryRequest({
		value: {
			type: 'artboard:history',
			requestId: `step-${requestCount}`,
			frameId: 'hero',
			step,
			...overrides,
		},
		outputChannel,
	});
	return vi.mocked(postAnswerToPanel).mock.calls.length > before ? lastAnswer() : undefined;
};

beforeEach(async () => {
	host.isTrusted = true;
	host.logs = 0;
	vi.clearAllMocks();
	clearEditHistories();
	host.root = await mkdtemp(join(tmpdir(), 'cursor-design-history-'));
	await resolveOpenPage({ workspaceRoot: host.root, createIfFresh: true });
	await createArtboard({
		page: { workspaceRoot: host.root, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: ORIGINAL,
		writeEnsurePanelMarker: false,
	});
});

afterEach(async () => {
	await rm(host.root, { recursive: true, force: true });
});

test('undo restores the exact original bytes, redo the edited ones', async () => {
	const edited = await editPadding('8');
	assert.equal(edited.type, 'artboard:edited');
	assert.deepEqual([edited.canUndo, edited.canRedo], [true, false]);
	const editedHtml = await diskHtml();
	assert.notEqual(editedHtml, ORIGINAL);

	const undone = await historyStep('undo');
	assert.equal(await diskHtml(), ORIGINAL);
	assert.equal(undone?.type, 'artboard:edited');
	assert.equal(undone?.hash, hashHtml(ORIGINAL));
	assert.equal(undone?.generation, (edited.generation ?? 0) + 1);
	assert.deepEqual([undone?.canUndo, undone?.canRedo], [false, true]);
	assert.match(undone?.html ?? '', /data-cd-src="1"/);
	const read = await readArtboard({
		page: { workspaceRoot: host.root, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
	});
	assert.equal(read.generation, undone?.generation);

	const redone = await historyStep('redo');
	assert.equal(await diskHtml(), editedHtml);
	assert.deepEqual([redone?.canUndo, redone?.canRedo], [true, false]);
});

test('a two-change save writes once and one undo restores both declarations', async () => {
	const before = await readArtboard({
		page: { workspaceRoot: host.root, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
	});
	const edited = await editStyles([
		{ field: 'padding', value: '8' },
		{ field: 'font-weight', value: '700' },
	]);
	assert.equal(edited.generation, before.generation + 1);
	assert.equal(
		await diskHtml(),
		'<main>\n  <p style="padding: 8px; font-weight: 700">x</p>\n</main>\n',
	);
	assert.deepEqual([edited.canUndo, edited.canRedo], [true, false]);
	const undone = await historyStep('undo');
	assert.equal(await diskHtml(), ORIGINAL);
	assert.deepEqual([undone?.canUndo, undone?.canRedo], [false, true]);
});

test(`${MAX_HISTORY_STEPS + 1} edits keep ${MAX_HISTORY_STEPS} undo steps`, async () => {
	for (let index = 2; index <= MAX_HISTORY_STEPS + 2; index += 1) {
		await editPadding(String(index));
	}
	for (let index = 0; index < MAX_HISTORY_STEPS; index += 1) {
		assert.equal((await historyStep('undo'))?.type, 'artboard:edited');
	}
	// The very first base (the original file) fell off the end.
	assert.match(await diskHtml(), /padding: 2px/);
	assert.equal((await historyStep('undo'))?.message, NOTHING_TO_UNDO_MESSAGE);
});

test('an edit after an undo empties redo', async () => {
	await editPadding('8');
	await historyStep('undo');
	await editPadding('9');
	assert.equal((await historyStep('redo'))?.message, NOTHING_TO_REDO_MESSAGE);
	assert.equal((await historyStep('undo'))?.type, 'artboard:edited');
	assert.equal(await diskHtml(), ORIGINAL);
});

test('an outside write makes undo refuse, keep the outside bytes and forget the history', async () => {
	await editPadding('8');
	const outside = '<main>\n  <p>agent</p>\n</main>\n';
	await writeFile(htmlPath(), outside);
	assert.equal((await historyStep('undo'))?.message, HISTORY_CLEARED_MESSAGE);
	assert.equal(await diskHtml(), outside);
	assert.equal((await historyStep('undo'))?.message, NOTHING_TO_UNDO_MESSAGE);
});

test('a deleted file makes undo say the frame is gone and forget the history', async () => {
	await editPadding('8');
	await unlink(htmlPath());
	assert.equal((await historyStep('undo'))?.message, EDIT_FRAME_GONE_MESSAGE);
	await writeFile(htmlPath(), ORIGINAL);
	assert.equal((await historyStep('undo'))?.message, NOTHING_TO_UNDO_MESSAGE);
});

test('a held lock answers busy and keeps the history', async () => {
	await editPadding('8');
	let busy: Answer | undefined;
	await withWorkspaceLock({
		workspaceRoot: host.root,
		operation: async () => {
			busy = await historyStep('undo');
		},
	});
	assert.equal(busy?.type, 'ui:error');
	assert.equal(busy?.message, new LockTimeoutError().message);
	assert.equal((await historyStep('undo'))?.type, 'artboard:edited');
	assert.equal(await diskHtml(), ORIGINAL);
}, 10_000);

// A request still awaiting the lock when the panel closes (or the folders change) is
// written, but records nothing: it read the epoch before its first await.
const clearWhileLocked = async <T>(start: () => Promise<T>): Promise<T> => {
	let pending: Promise<T> | undefined;
	await withWorkspaceLock({
		workspaceRoot: host.root,
		operation: async () => {
			pending = start();
			await new Promise((resolve) => setTimeout(resolve, 50));
			clearEditHistories();
		},
	});
	assert.ok(pending !== undefined);
	return pending;
};

test('an edit in flight across a clear is written but starts no history', async () => {
	const answer = await clearWhileLocked(() => editPadding('9'));
	assert.equal(answer.type, 'artboard:edited');
	assert.match(await diskHtml(), /padding: 9px/);
	assert.deepEqual(historyFlags('hero'), { canUndo: false, canRedo: false });
});

test('a step in flight across a clear is written but records nothing', async () => {
	await editPadding('8');
	const answer = await clearWhileLocked(() => historyStep('undo'));
	assert.equal(answer?.type, 'artboard:edited');
	assert.equal(await diskHtml(), ORIGINAL);
	assert.deepEqual(historyFlags('hero'), { canUndo: false, canRedo: false });
});

test('untrusted, malformed and unanswerable attempts write nothing', async () => {
	await editPadding('8');
	const editedHtml = await diskHtml();
	host.isTrusted = false;
	assert.equal((await historyStep('undo'))?.message, UNTRUSTED_WORKSPACE_MESSAGE);
	host.isTrusted = true;
	assert.equal((await historyStep('sideways'))?.message, MALFORMED_HISTORY_MESSAGE);
	assert.equal(
		(await historyStep('undo', { frameId: '../hero' }))?.message,
		MALFORMED_HISTORY_MESSAGE,
	);
	const logsBefore = host.logs;
	assert.equal(await historyStep('undo', { requestId: 'bad id' }), undefined);
	assert.equal(host.logs, logsBefore + 1);
	assert.equal(await diskHtml(), editedHtml);
	assert.equal((await historyStep('undo'))?.type, 'artboard:edited');
});
