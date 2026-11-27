import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import { UNTRUSTED_WORKSPACE_MESSAGE } from './canvasSnapshot';
import {
	MALFORMED_EDIT_MESSAGE,
	NOTHING_TO_REDO_MESSAGE,
	NOTHING_TO_UNDO_MESSAGE,
	PAGE_GONE_MESSAGE,
} from './panelRequestCopy';
import { createArtboard, readArtboard } from '../disk/artboardFs';
import { EditRefusedError, MigrationConflictError, NoWorkspaceError } from '../disk/errors';
import { hashHtml } from '../disk/hash';
import {
	FIRST_PAGE_ID,
	artboardHtmlPathSegments,
	artboardsTombstoneSegments,
	pageDirSegments,
	projectPathSegments,
} from '../disk/layout';
import { resolveOpenPage } from '../disk/openPage';
import { createPage, openPage } from '../disk/pageOps';
import { clearEditHistories, historyFlags, historyStepTarget } from './editHistory';
import { answerEditRequest, answerHistoryRequest } from './panelEdit';
import type { PanelPorts } from '../panel/openArtboardPanel';

// Edit answers over a real temp workspace; only the ports are faked. Undo and redo live in
// panelEdit.history.test.ts.

// Pinned values: the module keeps these private.
const EDIT_FALLBACK_MESSAGE = 'Could not save the edit. Check the Output panel: Vibeboard.';
const EDIT_CONFLICT_MESSAGE = 'This artboard changed on disk. Make the edit again.';

const ORIGINAL = '<main>\n  <p style="padding: 1px">x</p>\n</main>\n';
const PAGE_2 = 'page-2';
const PADDING_8 = { styles: [{ field: 'padding', value: '8' }] };

type Answer = {
	type: string;
	requestId: string;
	message?: string;
	frameId?: string;
	hash?: string;
	generation?: number;
	html?: string;
	canUndo?: boolean;
	canRedo?: boolean;
};

let root = '';
let trusted = true;
let requestCount = 0;

const makePorts = () =>
	({
		isTrusted: () => trusted,
		workspaceRoot: vi.fn((): string | undefined => root),
		log: vi.fn((_scope: string, _error: unknown) => undefined),
		postAnswer: vi.fn(),
		postSnapshot: vi.fn(),
		postComments: vi.fn(),
		writeClipboard: vi.fn(() => Promise.resolve()),
		confirmModal: vi.fn(() => Promise.resolve(true)),
	}) satisfies PanelPorts;

let ports = makePorts();

const answers = (): Answer[] => ports.postAnswer.mock.calls.map(([answer]) => answer as Answer);

// Every entry under dir: relative path to bytes, directories listed too; never follows a symlink.
const readTree = async (dir: string): Promise<Record<string, string>> => {
	const tree: Record<string, string> = {};
	const walk = async (relative: string): Promise<void> => {
		for (const name of await readdir(join(dir, relative))) {
			const entry = join(relative, name);
			const stats = await lstat(join(dir, entry));
			if (stats.isSymbolicLink()) {
				tree[entry] = `symlink:${await readlink(join(dir, entry))}`;
			} else if (stats.isDirectory()) {
				tree[entry] = 'dir';
				await walk(entry);
			} else {
				tree[entry] = (await readFile(join(dir, entry))).toString('base64');
			}
		}
	};
	await walk('');
	return tree;
};

const pageTree = (pageId: string): Promise<Record<string, string>> =>
	readTree(join(root, ...pageDirSegments(pageId)));

const heroHtml = (pageId: string): Promise<string> =>
	readFile(join(root, ...artboardHtmlPathSegments(pageId, 'hero')), 'utf8');

// page-1 gets its artboard first, so createPage adds page-2 instead of adopting a blank page-1.
const buildPages = async (workspaceRoot: string): Promise<void> => {
	await resolveOpenPage({ workspaceRoot, createIfFresh: true });
	await createArtboard({
		page: { workspaceRoot, pageId: FIRST_PAGE_ID },
		artboardId: 'hero',
		html: ORIGINAL,
		writeEnsurePanelMarker: false,
	});
	const created = await createPage({ workspaceRoot, writeEnsurePanelMarker: false });
	assert.equal(created.page.id, PAGE_2);
	await createArtboard({
		page: { workspaceRoot, pageId: PAGE_2 },
		artboardId: 'hero',
		html: ORIGINAL,
		writeEnsurePanelMarker: false,
	});
};

// Two pages, page-1 open.
const buildWorkspace = async (workspaceRoot: string): Promise<void> => {
	await buildPages(workspaceRoot);
	await openPage({ workspaceRoot, pageId: FIRST_PAGE_ID });
};

// Index lost: any resolve rebuilds project.json, so a byte-identical tree proves none ran.
const buildTripwire = async (workspaceRoot: string): Promise<void> => {
	await buildPages(workspaceRoot);
	await rm(join(workspaceRoot, ...projectPathSegments));
};

// One edit of page-2's <p> (source number 1) against the hash on disk right now.
const sendEdit = async (overrides: Record<string, unknown> = PADDING_8): Promise<void> => {
	requestCount += 1;
	await answerEditRequest({
		value: {
			type: 'artboard:edit',
			requestId: `edit-${requestCount}`,
			pageId: PAGE_2,
			frameId: 'hero',
			sourceNumber: 1,
			hash: hashHtml(await heroHtml(PAGE_2)),
			...overrides,
		},
		ports,
	});
};

beforeEach(async () => {
	trusted = true;
	requestCount = 0;
	ports = makePorts();
	clearEditHistories();
	root = await mkdtemp(join(tmpdir(), 'vibeboard-panelEdit-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test('a valid edit is written, then answered once with the tagged frame copy', async () => {
	await buildWorkspace(root);
	const pageOne = await pageTree(FIRST_PAGE_ID);
	const before = await readArtboard({
		page: { workspaceRoot: root, pageId: PAGE_2 },
		artboardId: 'hero',
	});
	await sendEdit();
	const written = await heroHtml(PAGE_2);
	assert.match(written, /padding: 8px/);
	assert.deepEqual(await pageTree(FIRST_PAGE_ID), pageOne);
	const [answer] = answers();
	assert.equal(answers().length, 1);
	assert.deepEqual(answer, {
		type: 'artboard:edited',
		requestId: 'edit-1',
		frameId: 'hero',
		hash: hashHtml(written),
		generation: before.generation + 1,
		html: answer?.html,
		canUndo: true,
		canRedo: false,
	});
	// The tagged copy of the disk bytes, never the raw ones.
	assert.match(answer?.html ?? '', /data-cd-src="1"/);
	assert.equal(answer?.html?.replaceAll(/ data-cd-src="\d+"/g, ''), written);
});

test('a conflict or a refusal is logged and answered once with panel copy', async () => {
	await buildWorkspace(root);
	const pageTwo = await pageTree(PAGE_2);
	await sendEdit({ ...PADDING_8, hash: hashHtml('<p>stale</p>') });
	await sendEdit({ field: 'text', value: 'New', liveText: 'Other' });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'edit-1', message: EDIT_CONFLICT_MESSAGE },
		{
			type: 'ui:error',
			requestId: 'edit-2',
			message: new EditRefusedError('text-changed').message,
		},
	]);
	assert.equal(ports.log.mock.calls.length, 2);
	assert.deepEqual(await pageTree(PAGE_2), pageTwo);
});

test('a resolver error is logged and answered once, and nothing is edited', async () => {
	await buildWorkspace(root);
	const tombstone = join(root, ...artboardsTombstoneSegments);
	await rm(tombstone);
	await mkdir(tombstone);
	const pageTwo = await pageTree(PAGE_2);
	await sendEdit();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'edit-1', message: EDIT_FALLBACK_MESSAGE },
	]);
	assert.equal(ports.log.mock.calls.length, 1);
	assert.ok(ports.log.mock.calls[0]?.[1] instanceof MigrationConflictError);
	assert.deepEqual(await pageTree(PAGE_2), pageTwo);
});

test('malformed, untrusted and folderless attempts are refused before any disk call', async () => {
	await buildTripwire(root);
	const tree = await readTree(root);
	await sendEdit({ styles: [{ field: 'border', value: '1px' }] });
	trusted = false;
	await sendEdit();
	trusted = true;
	ports.workspaceRoot.mockReturnValueOnce(undefined);
	await sendEdit();
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'edit-1', message: MALFORMED_EDIT_MESSAGE },
		{ type: 'ui:error', requestId: 'edit-2', message: UNTRUSTED_WORKSPACE_MESSAGE },
		{ type: 'ui:error', requestId: 'edit-3', message: new NoWorkspaceError().message },
	]);
	// The resolver may migrate or create files, so it never runs before these checks.
	assert.deepEqual(await readTree(root), tree);

	// Control: a trusted resolve on a tripwire workspace does write project.json.
	const control = await mkdtemp(join(tmpdir(), 'vibeboard-panelEdit-control-'));
	try {
		await buildTripwire(control);
		await resolveOpenPage({ workspaceRoot: control, createIfFresh: false });
		assert.ok((await lstat(join(control, ...projectPathSegments))).isFile());
	} finally {
		await rm(control, { recursive: true, force: true });
	}
});

test('an attempt without a usable requestId is logged once and never answered', async () => {
	await buildTripwire(root);
	const tree = await readTree(root);
	await sendEdit({ ...PADDING_8, requestId: 'bad id' });
	assert.equal(ports.log.mock.calls.length, 1);
	assert.equal(ports.postAnswer.mock.calls.length, 0);
	assert.equal(ports.workspaceRoot.mock.calls.length, 0);
	assert.deepEqual(await readTree(root), tree);
});

test('a same-bytes edit records nothing and answers the current flags', async () => {
	await buildWorkspace(root);
	await sendEdit({ styles: [{ field: 'padding', value: '1' }] });
	// The value already on disk: the file stays byte-identical.
	assert.equal(await heroHtml(PAGE_2), ORIGINAL);
	await sendEdit();
	await sendEdit();
	assert.deepEqual(
		answers().map(({ type, canUndo, canRedo }) => ({ type, canUndo, canRedo })),
		[
			{ type: 'artboard:edited', canUndo: false, canRedo: false },
			{ type: 'artboard:edited', canUndo: true, canRedo: false },
			{ type: 'artboard:edited', canUndo: true, canRedo: false },
		],
	);
	assert.deepEqual(historyFlags({ pageId: PAGE_2, frameId: 'hero' }), {
		canUndo: true,
		canRedo: false,
	});
	// The same-bytes edits pushed no step: the one undo still restores the original fixture.
	assert.equal(
		historyStepTarget({ pageId: PAGE_2, frameId: 'hero', step: 'undo' })?.target.hash,
		hashHtml(ORIGINAL),
	);
});

test('a gone page is answered once with the page copy, and nothing is edited', async () => {
	await buildWorkspace(root);
	const tree = await readTree(root);
	await sendEdit({ ...PADDING_8, pageId: 'page-9' });
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'edit-1', message: PAGE_GONE_MESSAGE },
	]);
	assert.deepEqual(await readTree(root), tree);
});

test('nothing to undo or redo is answered without resolving a page', async () => {
	await buildTripwire(root);
	const tree = await readTree(root);
	for (const step of ['undo', 'redo']) {
		await answerHistoryRequest({
			value: {
				type: 'artboard:history',
				requestId: `step-${step}`,
				pageId: PAGE_2,
				frameId: 'hero',
				step,
			},
			ports,
		});
	}
	assert.deepEqual(answers(), [
		{ type: 'ui:error', requestId: 'step-undo', message: NOTHING_TO_UNDO_MESSAGE },
		{ type: 'ui:error', requestId: 'step-redo', message: NOTHING_TO_REDO_MESSAGE },
	]);
	assert.deepEqual(await readTree(root), tree);
});
