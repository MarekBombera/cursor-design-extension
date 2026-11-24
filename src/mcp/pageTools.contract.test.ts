import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { hashHtml } from '../disk/hash';
import {
	CURSOR_DESIGN_DIR,
	DEFAULT_ARTBOARD_HTML,
	FIRST_PAGE_ID,
	LOCK_FILE,
	MAX_PAGES,
	artboardHtmlPathSegments,
	canvasPathSegments,
	ensurePanelPathSegments,
	pageDirSegments,
	projectPathSegments,
} from '../disk/layout';
import { registerArtboardTools } from './artboardTools';
import { registerCommentTools } from './commentTools';
import {
	CURSOR_DESIGN_MCP_SERVER_NAME,
	CURSOR_DESIGN_WORKSPACE_ROOT_ENV,
	CURSOR_DESIGN_WORKSPACE_ROOTS_ENV,
} from './mcpIdentity';
import { registerPageTools } from './pageTools';
import {
	CREATE_PAGE_TOOL,
	LIST_ARTBOARDS_TOOL,
	LIST_COMMENTS_TOOL,
	LIST_PAGES_TOOL,
	OPEN_PAGE_TOOL,
	PLACE_FRAME_TOOL,
	READ_ARTBOARD_TOOL,
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
} from './toolNames';

const PAGE_ID_MESSAGE =
	'pageId must be a page id such as page-2. Call list_pages for the page ids.';

const tempRoots: string[] = [];
let contractClient: Client | undefined;
let contractServer: McpServer | undefined;

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-page-contract-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

const connectContractPair = async (): Promise<Client> => {
	contractServer = new McpServer({ name: CURSOR_DESIGN_MCP_SERVER_NAME, version: '0.0.0' });
	registerArtboardTools(contractServer);
	registerCommentTools(contractServer);
	registerPageTools(contractServer);
	contractClient = new Client({ name: 'cursor-design-page-contract', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([
		contractClient.connect(clientTransport),
		contractServer.connect(serverTransport),
	]);
	return contractClient;
};

afterEach(async () => {
	try {
		await contractClient?.close();
		await contractServer?.close();
	} finally {
		contractClient = undefined;
		contractServer = undefined;
		await Promise.all(
			tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
		);
	}
});

const restoreEnvVar = (name: string, previous: string | undefined): void => {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
};

// The first root is the one whose create_page writes .ensure-panel.
const withRootsEnv = async (roots: readonly string[], run: () => Promise<void>): Promise<void> => {
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = JSON.stringify(roots);
	process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV] = roots[0];
	try {
		await run();
	} finally {
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const textOf = (result: CallToolResult): string =>
	JSON.stringify({ isError: result.isError, content: result.content });

const parsedBody = (result: CallToolResult): Record<string, unknown> => {
	const [block] = Array.isArray(result.content) ? result.content : [];
	assert.ok(
		block !== undefined && 'text' in block && typeof block.text === 'string',
		textOf(result),
	);
	return JSON.parse(block.text) as Record<string, unknown>;
};

const assertSuccess = (result: CallToolResult): Record<string, unknown> => {
	assert.notEqual(result.isError, true, textOf(result));
	return parsedBody(result);
};

const requireErrorCode = (result: CallToolResult, code: string): Record<string, unknown> => {
	assert.equal(result.isError, true, textOf(result));
	const body = parsedBody(result);
	assert.equal(body.code, code, textOf(result));
	return body;
};

const callTool = (
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<CallToolResult> => client.callTool({ name, arguments: args });

const exists = async (path: string): Promise<boolean> =>
	lstat(path).then(
		() => true,
		() => false,
	);

const fileBytes = async (dir: string): Promise<Record<string, string>> => {
	const files: Record<string, string> = {};
	for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
		if (entry.isFile()) {
			const path = join(entry.parentPath, entry.name);
			files[path] = await readFile(path, 'utf8');
		}
	}
	return files;
};

const writeProject = (root: string, project: unknown): Promise<void> =>
	writeFile(join(root, ...projectPathSegments), JSON.stringify(project));

test('a fresh folder: list_pages is empty, open_page is PAGE_NOT_FOUND, a bad title refuses; nothing is written', async () => {
	const root = await makeTempRoot();
	await withRootsEnv([root], async () => {
		const client = await connectContractPair();
		assert.deepEqual(assertSuccess(await callTool(client, LIST_PAGES_TOOL)), {
			openPageId: null,
			pages: [],
		});
		requireErrorCode(
			await callTool(client, OPEN_PAGE_TOOL, { pageId: 'page-2' }),
			'PAGE_NOT_FOUND',
		);
		for (const title of [undefined, 7, '   ', 'x'.repeat(81), 'a\nb']) {
			const body = requireErrorCode(
				await callTool(client, CREATE_PAGE_TOOL, { title }),
				'INVALID_ARGS',
			);
			assert.equal(
				body.message,
				'title must be 1 to 80 characters with no control characters. Fix args and retry.',
			);
		}
		assert.deepEqual(await readdir(root), []);
	});
});

test('create_page, list_pages and open_page success shapes', async () => {
	const root = await makeTempRoot();
	await withRootsEnv([root], async () => {
		const client = await connectContractPair();
		assertSuccess(await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: '' }));
		assert.deepEqual(
			assertSuccess(await callTool(client, CREATE_PAGE_TOOL, { title: ' Second ' })),
			{
				page: { id: 'page-2', title: 'Second' },
				artboardId: 'artboard',
				generation: 1,
				hash: hashHtml(DEFAULT_ARTBOARD_HTML),
			},
		);
		const listed = assertSuccess(await callTool(client, LIST_PAGES_TOOL));
		assert.equal(listed.openPageId, 'page-2');
		const pages = listed.pages as { id: string; title: string; updatedAt: unknown }[];
		assert.deepEqual(
			pages.map(({ id, title }) => ({ id, title })),
			[
				{ id: 'page-1', title: 'Page 1' },
				{ id: 'page-2', title: 'Second' },
			],
		);
		assert.ok(pages.every(({ updatedAt }) => typeof updatedAt === 'string'));
		assert.deepEqual(assertSuccess(await callTool(client, OPEN_PAGE_TOOL, { pageId: 'page-1' })), {
			page: { id: 'page-1', title: 'Page 1' },
		});
		assert.equal(assertSuccess(await callTool(client, LIST_PAGES_TOOL)).openPageId, 'page-1');
	});
});

test('open_page refuses a non-string or malformed pageId without echoing it, and an unknown id', async () => {
	const root = await makeTempRoot();
	await withRootsEnv([root], async () => {
		const client = await connectContractPair();
		assertSuccess(await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: '' }));
		for (const pageId of [undefined, 2, '../page-1', 'page-0', 'Page-2']) {
			const body = requireErrorCode(
				await callTool(client, OPEN_PAGE_TOOL, { pageId }),
				'INVALID_ARGS',
			);
			assert.equal(body.message, PAGE_ID_MESSAGE);
		}
		const body = requireErrorCode(
			await callTool(client, OPEN_PAGE_TOOL, { pageId: 'page-9' }),
			'PAGE_NOT_FOUND',
		);
		assert.equal(body.message, 'Page "page-9" does not exist. Call list_pages for the page ids.');
		await writeProject(root, {
			version: 1,
			openPageId: FIRST_PAGE_ID,
			pages: [
				{ id: FIRST_PAGE_ID, title: 'Page 1' },
				{ id: 'page-2', title: 'Page 2' },
			],
		});
		const noFolder = requireErrorCode(
			await callTool(client, OPEN_PAGE_TOOL, { pageId: 'page-2' }),
			'PAGE_NOT_FOUND',
		);
		assert.equal(
			noFolder.message,
			'Page "page-2" has no folder. Restore .cursor-design/pages/page-2/, or delete .cursor-design/project.json to rebuild the page list from the page folders.',
		);
	});
});

test('create_page at MAX_PAGES is INVALID_ARGS and writes no page', async () => {
	const root = await makeTempRoot();
	await withRootsEnv([root], async () => {
		const client = await connectContractPair();
		assertSuccess(await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: '' }));
		const pages = Array.from({ length: MAX_PAGES }, (_, index) => ({
			id: `page-${index + 1}`,
			title: `Page ${index + 1}`,
		}));
		await writeProject(root, { version: 1, openPageId: FIRST_PAGE_ID, pages });
		const body = requireErrorCode(
			await callTool(client, CREATE_PAGE_TOOL, { title: 'One more' }),
			'INVALID_ARGS',
		);
		assert.equal(body.message, `A project holds at most ${MAX_PAGES} pages. Delete a page first.`);
		assert.deepEqual(await readdir(join(root, CURSOR_DESIGN_DIR, 'pages')), [FIRST_PAGE_ID]);
	});
});

test('project codes, MIGRATION_CONFLICT, WORKSPACE_BUSY and DISK_ERROR reach the Agent', async () => {
	const root = await makeTempRoot();
	await withRootsEnv([root], async () => {
		const client = await connectContractPair();
		const calls: [string, Record<string, unknown>][] = [
			[LIST_PAGES_TOOL, {}],
			[CREATE_PAGE_TOOL, { title: 'Next' }],
			[OPEN_PAGE_TOOL, { pageId: 'page-1' }],
		];
		assertSuccess(await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: '' }));
		const projectPath = join(root, ...projectPathSegments);
		await writeFile(projectPath, '{ not json');
		for (const [name, args] of calls) {
			requireErrorCode(await callTool(client, name, args), 'CORRUPT_PROJECT');
		}
		await writeProject(root, { version: 2, openPageId: 'page-1', pages: [] });
		for (const [name, args] of calls) {
			requireErrorCode(await callTool(client, name, args), 'UNSUPPORTED_PROJECT_VERSION');
		}
		await rm(projectPath);
		await mkdir(projectPath);
		for (const [name, args] of calls.slice(0, 2)) {
			requireErrorCode(await callTool(client, name, args), 'DISK_ERROR');
		}
		await rm(projectPath, { recursive: true });
		await writeProject(root, {
			version: 1,
			openPageId: 'page-1',
			pages: [{ id: 'page-1', title: 'Page 1' }],
		});
		await writeFile(join(root, CURSOR_DESIGN_DIR, LOCK_FILE), '1 live-holder', 'utf8');
		for (const [name, args] of calls.slice(1)) {
			requireErrorCode(await callTool(client, name, args), 'WORKSPACE_BUSY');
		}
	});
	const legacyRoot = await makeTempRoot();
	await withRootsEnv([legacyRoot], async () => {
		const client = await connectContractPair();
		// A 0.4 root canvas.json next to a page-1 copy: the migration refuses to overwrite.
		await mkdir(join(legacyRoot, ...pageDirSegments(FIRST_PAGE_ID)), { recursive: true });
		await writeFile(join(legacyRoot, CURSOR_DESIGN_DIR, 'canvas.json'), '{"version":1}\n');
		await writeFile(join(legacyRoot, ...canvasPathSegments(FIRST_PAGE_ID)), '{"version":1}\n');
		for (const [name, args] of [
			[LIST_PAGES_TOOL, {}],
			[CREATE_PAGE_TOOL, { title: 'Next' }],
		] as const) {
			requireErrorCode(await callTool(client, name, args), 'MIGRATION_CONFLICT');
		}
	});
});

test('after open_page("page-2") the artboard and comment tools act on page-2 only', async () => {
	const root = await makeTempRoot();
	await withRootsEnv([root], async () => {
		const client = await connectContractPair();
		assertSuccess(
			await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: '<p>1</p>' }),
		);
		assertSuccess(await callTool(client, CREATE_PAGE_TOOL, { title: 'Second' }));
		assertSuccess(await callTool(client, OPEN_PAGE_TOOL, { pageId: 'page-1' }));
		assertSuccess(await callTool(client, OPEN_PAGE_TOOL, { pageId: 'page-2' }));
		const pageOneDir = join(root, ...pageDirSegments(FIRST_PAGE_ID));
		const pageOneBefore = await fileBytes(pageOneDir);
		const pageTwo = { id: 'page-2', title: 'Second' };

		const listed = assertSuccess(await callTool(client, LIST_ARTBOARDS_TOOL));
		assert.deepEqual(
			(listed.artboards as { artboardId: string }[]).map(({ artboardId }) => artboardId),
			['artboard'],
		);
		const read = assertSuccess(await callTool(client, READ_ARTBOARD_TOOL));
		assert.equal(read.artboardId, 'artboard');
		requireErrorCode(
			await callTool(client, READ_ARTBOARD_TOOL, { artboardId: 'hero' }),
			'ARTBOARD_NOT_FOUND',
		);
		const updated = assertSuccess(
			await callTool(client, UPDATE_ARTBOARD_TOOL, {
				artboardId: 'artboard',
				html: '<p>2</p>',
				baseGeneration: 1,
			}),
		);
		const placed = assertSuccess(
			await callTool(client, PLACE_FRAME_TOOL, { id: 'artboard', x: 40, y: 0 }),
		);
		const comments = assertSuccess(await callTool(client, LIST_COMMENTS_TOOL));
		assert.deepEqual(comments.comments, []);
		for (const body of [listed, read, updated, placed, comments]) {
			assert.deepEqual(body.page, pageTwo);
		}

		assert.deepEqual(await fileBytes(pageOneDir), pageOneBefore);
		assert.equal(
			await readFile(join(root, ...artboardHtmlPathSegments('page-2', 'artboard')), 'utf8'),
			'<p>2</p>',
		);
		assert.ok(
			(await readFile(join(root, ...canvasPathSegments('page-2')), 'utf8')).includes('"x": 40'),
		);
	});
});

test('create_page writes .ensure-panel only for the first root', async () => {
	const first = await makeTempRoot();
	const second = await makeTempRoot();
	await withRootsEnv([first, second], async () => {
		const client = await connectContractPair();
		const created = assertSuccess(
			await callTool(client, CREATE_PAGE_TOOL, { title: 'Elsewhere', rootPath: second }),
		);
		// A never-opened folder adopts its blank page-1 instead of adding page-2.
		assert.deepEqual(created.page, { id: 'page-1', title: 'Elsewhere' });
		assert.equal(await exists(join(second, ...ensurePanelPathSegments)), false);
		assertSuccess(await callTool(client, CREATE_PAGE_TOOL, { title: 'Here' }));
		assert.equal(await exists(join(first, ...ensurePanelPathSegments)), true);
	});
});
