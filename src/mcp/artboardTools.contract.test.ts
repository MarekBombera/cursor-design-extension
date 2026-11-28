import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { registerArtboardTools } from './artboardTools';
import {
	ARTBOARDS_TOMBSTONE_TEXT,
	FIRST_PAGE_ID,
	VIBEBOARD_DIR,
	LOCK_FILE,
	artboardHtmlPathSegments,
	artboardMetaPathSegments,
} from '../disk/layout';
import {
	VIBEBOARD_MCP_SERVER_NAME,
	VIBEBOARD_WORKSPACE_ROOT_ENV,
	VIBEBOARD_WORKSPACE_ROOTS_ENV,
} from './mcpIdentity';
import {
	EXPORT_ARTBOARD_TOOL,
	HANDOFF_STATUS_TOOL,
	LIST_ARTBOARDS_TOOL,
	PLACE_FRAME_TOOL,
	READ_ARTBOARD_TOOL,
	SET_ACTIVE_ARTBOARD_TOOL,
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
} from './toolNames';

const tempRoots: string[] = [];
let contractClient: Client | undefined;
let contractServer: McpServer | undefined;

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-contract-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

const connectContractPair = async (): Promise<Client> => {
	contractServer = new McpServer({
		name: VIBEBOARD_MCP_SERVER_NAME,
		version: process.env.VIBEBOARD_VERSION ?? '0.0.0',
	});
	registerArtboardTools(contractServer);
	contractClient = new Client({ name: 'vibeboard-contract', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([
		contractClient.connect(clientTransport),
		contractServer.connect(serverTransport),
	]);
	return contractClient;
};

afterEach(async () => {
	try {
		if (contractClient !== undefined) {
			await contractClient.close();
		}
	} finally {
		contractClient = undefined;
		try {
			if (contractServer !== undefined) {
				await contractServer.close();
			}
		} finally {
			contractServer = undefined;
			await Promise.all(
				tempRoots
					.splice(0)
					.map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
			);
		}
	}
});

const restoreEnvVar = (name: string, previous: string | undefined): void => {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
};

const withWorkspaceEnv = async (workspaceRoot: string, run: () => Promise<void>): Promise<void> => {
	const previousRoots = process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[VIBEBOARD_WORKSPACE_ROOT_ENV];
	process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV] = JSON.stringify([workspaceRoot]);
	process.env[VIBEBOARD_WORKSPACE_ROOT_ENV] = workspaceRoot;
	try {
		await run();
	} finally {
		restoreEnvVar(VIBEBOARD_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(VIBEBOARD_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const withoutWorkspaceEnv = async (run: () => Promise<void>): Promise<void> => {
	const previousRoots = process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[VIBEBOARD_WORKSPACE_ROOT_ENV];
	delete process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV];
	delete process.env[VIBEBOARD_WORKSPACE_ROOT_ENV];
	try {
		await run();
	} finally {
		restoreEnvVar(VIBEBOARD_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(VIBEBOARD_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const describeResult = (result: CallToolResult): string =>
	JSON.stringify({
		isError: result.isError,
		content: result.content,
		structuredContent: result.structuredContent,
	});

const textBlocksOf = (result: CallToolResult): string[] => {
	if (!Array.isArray(result.content)) {
		return [];
	}
	return result.content.flatMap((block) => {
		if (
			typeof block === 'object' &&
			block !== null &&
			'type' in block &&
			block.type === 'text' &&
			'text' in block &&
			typeof block.text === 'string'
		) {
			return [block.text];
		}
		return [];
	});
};

const parsedToolBody = (result: CallToolResult): Record<string, unknown> | undefined => {
	if (
		result.structuredContent !== undefined &&
		typeof result.structuredContent === 'object' &&
		result.structuredContent !== null &&
		!Array.isArray(result.structuredContent)
	) {
		return result.structuredContent as Record<string, unknown>;
	}
	const [firstText] = textBlocksOf(result);
	if (firstText === undefined) {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(firstText);
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return undefined;
	}
	return undefined;
};

const requireToolBody = (result: CallToolResult): Record<string, unknown> => {
	const body = parsedToolBody(result);
	assert.ok(body !== undefined, `expected JSON tool body: ${describeResult(result)}`);
	return body;
};

const assertToolSuccess = (result: CallToolResult): Record<string, unknown> => {
	assert.notEqual(result.isError, true, describeResult(result));
	return requireToolBody(result);
};

const requireErrorCode = (result: CallToolResult, code: string): Record<string, unknown> => {
	assert.equal(result.isError, true, describeResult(result));
	const body = requireToolBody(result);
	assert.equal(body.code, code, describeResult(result));
	assert.equal('page' in body, false, describeResult(result));
	return body;
};

const callArtboardTool = (
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<CallToolResult> => client.callTool({ name, arguments: args });

const seedArtboard = async (
	client: Client,
	artboardId: string,
	html: string,
): Promise<CallToolResult> => {
	const result = await callArtboardTool(client, SET_ARTBOARD_TOOL, { artboardId, html });
	assertToolSuccess(result);
	return result;
};

const PAGE_ONE = { id: 'page-1', title: 'Page 1' };

test('every artboard tool success carries the open page read before the op', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		// set_artboard creates the project first, so its own result already names page-1.
		const created = await seedArtboard(client, 'hero', '<p>hero</p>');
		const calls: [string, Record<string, unknown>][] = [
			[UPDATE_ARTBOARD_TOOL, { artboardId: 'hero', html: '<p>v2</p>', baseGeneration: 1 }],
			[READ_ARTBOARD_TOOL, {}],
			[LIST_ARTBOARDS_TOOL, {}],
			[PLACE_FRAME_TOOL, { id: 'hero', x: 0, y: 0 }],
			[SET_ACTIVE_ARTBOARD_TOOL, { artboardId: 'hero' }],
			[EXPORT_ARTBOARD_TOOL, {}],
			[HANDOFF_STATUS_TOOL, {}],
		];
		const pages = [assertToolSuccess(created).page];
		for (const [name, args] of calls) {
			pages.push(assertToolSuccess(await callArtboardTool(client, name, args)).page);
		}
		assert.deepEqual(pages, Array(calls.length + 1).fill(PAGE_ONE));
	});
});

test('a 0.4 folder migrates on the first call, whose result names page-1', async () => {
	const workspaceRoot = await makeTempRoot();
	await mkdir(join(workspaceRoot, VIBEBOARD_DIR, 'artboards'), { recursive: true });
	await writeFile(join(workspaceRoot, VIBEBOARD_DIR, 'artboards', 'hero.html'), '<p>hero</p>');
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const body = assertToolSuccess(await callArtboardTool(client, LIST_ARTBOARDS_TOOL));
		assert.deepEqual(body.page, PAGE_ONE);
		assert.deepEqual(
			(body.artboards as { artboardId: string }[]).map(({ artboardId }) => artboardId),
			['hero'],
		);
	});
});

test('set_active_artboard hero then omit-id read returns hero', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		await seedArtboard(client, 'hero-alt', '<p>hero-alt</p>');
		assertToolSuccess(
			await callArtboardTool(client, SET_ACTIVE_ARTBOARD_TOOL, { artboardId: 'hero' }),
		);
		const readResult = await callArtboardTool(client, READ_ARTBOARD_TOOL);
		assert.equal(assertToolSuccess(readResult).artboardId, 'hero');
	});
});

test('omit-id read_artboard after one set_artboard returns that id', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const result = await callArtboardTool(client, READ_ARTBOARD_TOOL);
		assert.equal(assertToolSuccess(result).artboardId, 'hero');
	});
});

test('handoff_status after export is HandoffStatusResult with stale false and lastExport', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		assertToolSuccess(await callArtboardTool(client, EXPORT_ARTBOARD_TOOL));
		const body = assertToolSuccess(await callArtboardTool(client, HANDOFF_STATUS_TOOL));
		assert.equal(body.stale, false);
		assert.ok(body.lastExport !== undefined);
		assert.equal('exported' in body, false);
	});
});

test('no workspace env returns NO_WORKSPACE', async () => {
	await withoutWorkspaceEnv(async () => {
		const client = await connectContractPair();
		const result = await callArtboardTool(client, LIST_ARTBOARDS_TOOL);
		requireErrorCode(result, 'NO_WORKSPACE');
	});
});

test('unknown rootPath returns INVALID_ROOT plus roots', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const result = await callArtboardTool(client, LIST_ARTBOARDS_TOOL, {
			rootPath: '/not-open',
		});
		const body = requireErrorCode(result, 'INVALID_ROOT');
		assert.deepEqual(body.roots, [workspaceRoot]);
	});
});

test('update_artboard stale generation returns conflict', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const result = await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: '<p>stale</p>',
			baseGeneration: 2,
		});
		const body = requireErrorCode(result, 'conflict');
		assert.equal(body.artboardId, 'hero');
		assert.equal(body.expectedGeneration, 2);
		assert.equal(body.actualGeneration, 1);
	});
});

test('place_frame unknown id returns ARTBOARD_NOT_FOUND', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const result = await callArtboardTool(client, PLACE_FRAME_TOOL, { id: 'missing' });
		const body = requireErrorCode(result, 'ARTBOARD_NOT_FOUND');
		assert.equal(body.artboardId, 'missing');
	});
});

test('export_artboard with artboardId returns authored INVALID_ARGS', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const result = await callArtboardTool(client, EXPORT_ARTBOARD_TOOL, { artboardId: 'hero' });
		const body = requireErrorCode(result, 'INVALID_ARGS');
		assert.equal(body.message, 'export_artboard does not take artboardId. Fix args and retry.');
	});
});

test('place_frame names each wrong-typed field; a non-string id is INVALID_ARGS', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'a', '<p>a</p>');
		for (const [field, badArgs] of [
			['x', { x: '10' }],
			['x', { x: null }],
			['y', { y: null }],
			['width', { width: '300' }],
			['label', { label: 3 }],
			['group', { group: 3 }],
			['id', { id: 42 }],
		] as const) {
			const body = requireErrorCode(
				await callArtboardTool(client, PLACE_FRAME_TOOL, { id: 'a', ...badArgs }),
				'INVALID_ARGS',
			);
			assert.ok(String(body.message).startsWith(`${field} must be `), field);
		}
	});
});

test('update_artboard rejects a malformed base and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const generationMessage = 'baseGeneration must be an integer >= 1. Fix args and retry.';
		for (const [base, message] of [
			[{ baseGeneration: 0 }, generationMessage],
			[{ baseGeneration: 1.5 }, generationMessage],
			[
				{ baseHash: 'sha256:zz' },
				'baseHash must be sha256: plus 64 hex characters. Fix args and retry.',
			],
		] as const) {
			const body = requireErrorCode(
				await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
					artboardId: 'hero',
					html: '<p>clobber</p>',
					...base,
				}),
				'INVALID_ARGS',
			);
			assert.equal(body.message, message);
		}
		const read = await callArtboardTool(client, READ_ARTBOARD_TOOL, { artboardId: 'hero' });
		assert.equal(assertToolSuccess(read).generation, 1);
	});
});

test('empty viewport is INVALID_ARGS on create and update', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const viewportMessage = 'viewport must be a non-empty string. Fix args and retry.';
		const created = requireErrorCode(
			await callArtboardTool(client, SET_ARTBOARD_TOOL, {
				artboardId: 'hero',
				html: '<p>hero</p>',
				viewport: '',
			}),
			'INVALID_ARGS',
		);
		assert.equal(created.message, viewportMessage);
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const updated = requireErrorCode(
			await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
				artboardId: 'hero',
				html: '<p>hero</p>',
				baseGeneration: 1,
				viewport: '',
			}),
			'INVALID_ARGS',
		);
		assert.equal(updated.message, viewportMessage);
	});
});

test('place_frame with artboardId and no id names the unknown key', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const body = requireErrorCode(
			await callArtboardTool(client, PLACE_FRAME_TOOL, { artboardId: 'hero' }),
			'INVALID_ARGS',
		);
		assert.equal(body.message, 'place_frame does not take artboardId. Fix args and retry.');
	});
});

test('wrong-typed html, baseGeneration, and rootPath are observed at the client', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const htmlResult = await callArtboardTool(client, SET_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: 42,
		});
		assert.equal(
			requireErrorCode(htmlResult, 'INVALID_ARGS').message,
			'html must be a string. Fix args and retry.',
		);
		assert.deepEqual(await readdir(workspaceRoot), []);

		const generationResult = await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: '<p>hero</p>',
			baseGeneration: '1',
		});
		assert.equal(
			requireErrorCode(generationResult, 'INVALID_ARGS').message,
			'baseGeneration must be an integer >= 1. Fix args and retry.',
		);

		const rootPathResult = await callArtboardTool(client, LIST_ARTBOARDS_TOOL, {
			rootPath: { path: workspaceRoot },
		});
		assert.equal(
			requireErrorCode(rootPathResult, 'INVALID_ARGS').message,
			'rootPath must be a string. Fix args and retry.',
		);
	});
});

// update_artboard's read-compare-write runs under the cross-process lock, like the panel's.
test('update_artboard under a fresh foreign lock returns WORKSPACE_BUSY and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>v1</p>');
		const htmlPath = join(workspaceRoot, ...artboardHtmlPathSegments(FIRST_PAGE_ID, 'hero'));
		const metaPath = join(workspaceRoot, ...artboardMetaPathSegments(FIRST_PAGE_ID, 'hero'));
		const metaBefore = await readFile(metaPath, 'utf8');
		await writeFile(join(workspaceRoot, VIBEBOARD_DIR, LOCK_FILE), '1 live-holder', 'utf8');
		const result = await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: '<p>v2</p>',
			baseGeneration: 1,
		});
		requireErrorCode(result, 'WORKSPACE_BUSY');
		assert.equal(await readFile(htmlPath, 'utf8'), '<p>v1</p>');
		assert.equal(await readFile(metaPath, 'utf8'), metaBefore);
	});
});

test('concurrent update_artboard: first Promise.all element wins, second conflicts', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>v1</p>');
		const [firstResult, secondResult] = await Promise.all([
			callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
				artboardId: 'hero',
				html: '<p>first</p>',
				baseGeneration: 1,
			}),
			callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
				artboardId: 'hero',
				html: '<p>second</p>',
				baseGeneration: 1,
			}),
		]);
		assertToolSuccess(firstResult);
		const conflictBody = requireErrorCode(secondResult, 'conflict');
		assert.equal(conflictBody.artboardId, 'hero');
		assert.equal(conflictBody.expectedGeneration, 1);
		assert.equal(conflictBody.actualGeneration, 2);
		const readResult = await callArtboardTool(client, READ_ARTBOARD_TOOL, { artboardId: 'hero' });
		assert.equal(assertToolSuccess(readResult).html, '<p>first</p>');
	});
});

test('set_artboard with an invalid id or no html on a fresh root creates nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		requireErrorCode(
			await callArtboardTool(client, SET_ARTBOARD_TOOL, { artboardId: 'has space!', html: '' }),
			'INVALID_ARTBOARD_ID',
		);
		requireErrorCode(
			await callArtboardTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero' }),
			'INVALID_ARGS',
		);
		assert.deepEqual(await readdir(workspaceRoot), []);
	});
});

test('set_artboard on a fresh root creates the project, the tombstone and the page-1 artboard', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		assert.deepEqual(
			JSON.parse(await readFile(join(workspaceRoot, '.vibeboard/project.json'), 'utf8')),
			{ version: 1, openPageId: 'page-1', pages: [{ id: 'page-1', title: 'Page 1' }] },
		);
		assert.equal(
			await readFile(join(workspaceRoot, '.vibeboard/artboards'), 'utf8'),
			ARTBOARDS_TOMBSTONE_TEXT,
		);
		assert.equal(
			await readFile(join(workspaceRoot, '.vibeboard/pages/page-1/artboards/hero.html'), 'utf8'),
			'<p>hero</p>',
		);
	});
});

test('set_artboard after the open page folder was deleted is PAGE_NOT_FOUND and recreates nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const pageDir = join(workspaceRoot, '.vibeboard/pages/page-1');
		await rm(pageDir, { recursive: true });
		const body = requireErrorCode(
			await callArtboardTool(client, SET_ARTBOARD_TOOL, { artboardId: 'side', html: '' }),
			'PAGE_NOT_FOUND',
		);
		assert.equal(
			body.message,
			'Page "page-1" has no folder. Restore .vibeboard/pages/page-1/, or delete .vibeboard/project.json to rebuild the page list from the page folders.',
		);
		await assert.rejects(access(pageDir));
	});
});

test('a project.json that is not JSON is CORRUPT_PROJECT and is left as it was', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const projectPath = join(workspaceRoot, '.vibeboard/project.json');
		await writeFile(projectPath, '{ not json');
		const body = requireErrorCode(
			await callArtboardTool(client, LIST_ARTBOARDS_TOOL),
			'CORRUPT_PROJECT',
		);
		assert.equal(
			body.message,
			'Project index is invalid. Fix .vibeboard/project.json (version 1), or delete it to rebuild the page list from the page folders. Page titles then reset to "Page <n>".',
		);
		assert.equal(await readFile(projectPath, 'utf8'), '{ not json');
	});
});

test('CORRUPT_META results still carry artboardId and name the page meta path', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await seedArtboard(client, 'hero', '<p>hero</p>');
		await writeFile(
			join(workspaceRoot, '.vibeboard/pages/page-1/artboards/hero.meta.json'),
			'{ not json',
		);
		const body = requireErrorCode(
			await callArtboardTool(client, EXPORT_ARTBOARD_TOOL),
			'CORRUPT_META',
		);
		assert.equal(body.artboardId, 'hero');
		assert.equal(
			body.message,
			'Artboard "hero" meta is invalid. Restore .vibeboard/pages/page-1/artboards/hero.meta.json or set_artboard a new id.',
		);
	});
});
