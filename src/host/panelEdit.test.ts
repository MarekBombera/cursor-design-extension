import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vite-plus/test';
import type * as vscode from 'vscode';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import { EDIT_CONFLICT_MESSAGE, MALFORMED_EDIT_MESSAGE } from './panelRequestCopy';
import { ConflictError, EditRefusedError, NoWorkspaceError } from '../disk/errors';
import { clearEditHistories, historyFlags, historyStepTarget } from './editHistory';
import { answerEditRequest } from './panelEdit';

// One shared, ordered log of everything the host does, so order is assertable.
const host = vi.hoisted(() => ({ isTrusted: true, hasFolder: true, calls: [] as string[] }));

vi.mock('vscode', () => ({
	workspace: {
		get isTrusted() {
			return host.isTrusted;
		},
	},
}));
vi.mock('./hostFs', () => ({
	firstWorkspaceFolder: () => (host.hasFolder ? { uri: { fsPath: '/ws' } } : undefined),
	logDiskError: vi.fn(() => host.calls.push('log')),
}));
vi.mock('../panel/openArtboardPanel', () => ({
	postAnswerToPanel: vi.fn((answer: { type: string }) => host.calls.push(`answer:${answer.type}`)),
}));
vi.mock('../disk/artboardEditFs', () => ({
	editArtboard: vi.fn(() => {
		host.calls.push('editArtboard');
		return Promise.resolve({
			artboardId: 'hero',
			generation: 4,
			hash: `sha256:${'b'.repeat(64)}`,
			html: '<p style="padding: 8px">x</p>',
			baseHtml: '<p>x</p>',
			baseHash: `sha256:${'a'.repeat(64)}`,
		});
	}),
}));
vi.mock('./canvasSnapshot', async (importOriginal) => {
	const original = await importOriginal<typeof import('./canvasSnapshot')>();
	return {
		...original,
		panelFrameHtml: vi.fn(({ html }: { html: string }) => {
			host.calls.push('panelFrameHtml');
			return { html: `tagged:${html}` };
		}),
	};
});

const { postAnswerToPanel } = await import('../panel/openArtboardPanel');
const { editArtboard } = await import('../disk/artboardEditFs');

const outputChannel = {} as vscode.OutputChannel;
const answers = (): unknown[] => vi.mocked(postAnswerToPanel).mock.calls.map(([answer]) => answer);

const edit = {
	type: 'artboard:edit',
	requestId: 'edit-1',
	frameId: 'hero',
	sourceNumber: 0,
	hash: `sha256:${'a'.repeat(64)}`,
	styles: [{ field: 'padding', value: '8' }],
};

beforeEach(() => {
	host.isTrusted = true;
	host.hasFolder = true;
	host.calls = [];
	vi.clearAllMocks();
	clearEditHistories();
});

test('a valid edit is written, then answered once with the tagged frame copy', async () => {
	await answerEditRequest({ value: edit, outputChannel });
	assert.deepEqual(host.calls, ['editArtboard', 'panelFrameHtml', 'answer:artboard:edited']);
	assert.deepEqual(answers(), [
		{
			type: 'artboard:edited',
			requestId: 'edit-1',
			frameId: 'hero',
			hash: `sha256:${'b'.repeat(64)}`,
			generation: 4,
			html: 'tagged:<p style="padding: 8px">x</p>',
			canUndo: true,
			canRedo: false,
		},
	]);
	assert.deepEqual(vi.mocked(editArtboard).mock.calls[0]?.[0], {
		workspaceRoot: '/ws',
		artboardId: 'hero',
		baseHash: edit.hash,
		edit: { sourceNumber: 0, styles: [{ field: 'padding', value: '8' }] },
	});
});

test('a text edit passes its live text to the edit core', async () => {
	await answerEditRequest({
		value: { ...edit, styles: undefined, field: 'text', value: 'New', liveText: 'Old' },
		outputChannel,
	});
	assert.deepEqual(vi.mocked(editArtboard).mock.calls[0]?.[0].edit, {
		sourceNumber: 0,
		field: 'text',
		value: 'New',
		liveText: 'Old',
	});
});

test('a conflict or a refusal is logged and answered once with panel copy', async () => {
	vi.mocked(editArtboard).mockRejectedValueOnce(new ConflictError('hero', {}));
	await answerEditRequest({ value: edit, outputChannel });
	const refused = new EditRefusedError('text-changed');
	vi.mocked(editArtboard).mockRejectedValueOnce(refused);
	await answerEditRequest({ value: { ...edit, requestId: 'edit-2' }, outputChannel });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'edit-1', message: EDIT_CONFLICT_MESSAGE },
		{ type: 'ui:error', requestId: 'edit-2', message: refused.message },
	]);
	// The rejecting mocks skip the call log: each attempt logs once, then answers.
	assert.deepEqual(host.calls, ['log', 'answer:ui:error', 'log', 'answer:ui:error']);
});

test('malformed, untrusted and folderless attempts are refused before any disk call', async () => {
	await answerEditRequest({
		value: { ...edit, styles: [{ field: 'border', value: '1px' }] },
		outputChannel,
	});
	host.isTrusted = false;
	await answerEditRequest({ value: { ...edit, requestId: 'edit-2' }, outputChannel });
	host.isTrusted = true;
	host.hasFolder = false;
	await answerEditRequest({ value: { ...edit, requestId: 'edit-3' }, outputChannel });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'edit-1', message: MALFORMED_EDIT_MESSAGE },
		{ type: 'ui:error', requestId: 'edit-2', message: UNTRUSTED_WORKSPACE_MESSAGE },
		{ type: 'ui:error', requestId: 'edit-3', message: new NoWorkspaceError().message },
	]);
	assert.equal(vi.mocked(editArtboard).mock.calls.length, 0);
});

test('an attempt without a usable requestId is logged once and never answered', async () => {
	await answerEditRequest({ value: { ...edit, requestId: 'bad id' }, outputChannel });
	assert.deepEqual(host.calls, ['log']);
	assert.equal(vi.mocked(editArtboard).mock.calls.length, 0);
});

test('a same-bytes edit records nothing and answers the current flags', async () => {
	const sameBytes = {
		artboardId: 'hero',
		generation: 4,
		hash: `sha256:${'b'.repeat(64)}`,
		html: '<p style="padding: 8px">x</p>',
		baseHtml: '<p style="padding: 8px">x</p>',
		baseHash: `sha256:${'b'.repeat(64)}`,
	};
	vi.mocked(editArtboard).mockResolvedValueOnce(sameBytes);
	await answerEditRequest({ value: edit, outputChannel });
	// A written edit, then the same-bytes one: the history keeps its one step.
	await answerEditRequest({ value: { ...edit, requestId: 'edit-2' }, outputChannel });
	vi.mocked(editArtboard).mockResolvedValueOnce(sameBytes);
	await answerEditRequest({ value: { ...edit, requestId: 'edit-3' }, outputChannel });
	const flags = answers().map((answer) => {
		const { canUndo, canRedo } = answer as { canUndo: boolean; canRedo: boolean };
		return { canUndo, canRedo };
	});
	assert.deepEqual(flags, [
		{ canUndo: false, canRedo: false },
		{ canUndo: true, canRedo: false },
		{ canUndo: true, canRedo: false },
	]);
	assert.deepEqual(historyFlags('hero'), { canUndo: true, canRedo: false });
	// The same-bytes edit pushed no step: the one undo still restores the written edit's base.
	assert.equal(
		historyStepTarget({ frameId: 'hero', step: 'undo' })?.target.hash,
		`sha256:${'a'.repeat(64)}`,
	);
});
