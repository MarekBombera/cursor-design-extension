// Proven import path: `{ Client, InMemoryTransport }` from `@modelcontextprotocol/client`.
// Both pair halves come from `InMemoryTransport.createLinkedPair()` on that same import.
import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { registerArtboardTools } from './artboardTools';
import { canvasPathSegments } from '../disk/layout';
import {
	CURSOR_DESIGN_MCP_SERVER_NAME,
	CURSOR_DESIGN_WORKSPACE_ROOT_ENV,
	CURSOR_DESIGN_WORKSPACE_ROOTS_ENV,
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

const ARTBOARD_TOOL_NAMES = [
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
	READ_ARTBOARD_TOOL,
	LIST_ARTBOARDS_TOOL,
	SET_ACTIVE_ARTBOARD_TOOL,
	EXPORT_ARTBOARD_TOOL,
	HANDOFF_STATUS_TOOL,
	PLACE_FRAME_TOOL,
] as const;

type ArtboardToolName = (typeof ARTBOARD_TOOL_NAMES)[number];

type HappyPathArgs = {
	client: Client;
	workspaceRoot: string;
};

const tempRoots: string[] = [];
let contractClient: Client | undefined;
let contractServer: McpServer | undefined;

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-contract-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

const connectContractPair = async (): Promise<Client> => {
	contractServer = new McpServer({
		name: CURSOR_DESIGN_MCP_SERVER_NAME,
		version: process.env.CURSOR_DESIGN_VERSION ?? '0.0.0',
	});
	registerArtboardTools(contractServer);
	contractClient = new Client({ name: 'cursor-design-contract', version: '0.0.0' });
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
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = JSON.stringify([workspaceRoot]);
	process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV] = workspaceRoot;
	try {
		await run();
	} finally {
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const withoutWorkspaceEnv = async (run: () => Promise<void>): Promise<void> => {
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	delete process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	delete process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	try {
		await run();
	} finally {
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const sortedUnique = (names: readonly string[]): string[] => [...new Set(names)].sort();

const assertSortedSetEqual = (left: readonly string[], right: readonly string[]): void => {
	assert.deepEqual(sortedUnique(left), sortedUnique(right));
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

const happyPath: Record<ArtboardToolName, (args: HappyPathArgs) => Promise<CallToolResult>> = {
	[LIST_ARTBOARDS_TOOL]: async ({ client }) => {
		const result = await callArtboardTool(client, LIST_ARTBOARDS_TOOL);
		const body = assertToolSuccess(result);
		assert.deepEqual(body.artboards, []);
		assert.deepEqual(body.frames, []);
		return result;
	},
	[SET_ARTBOARD_TOOL]: async ({ client }) => {
		const result = await callArtboardTool(client, SET_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: '<p>hero</p>',
		});
		assertToolSuccess(result);
		return result;
	},
	[UPDATE_ARTBOARD_TOOL]: async ({ client }) => {
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const result = await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: '<p>v2</p>',
			baseGeneration: 1,
		});
		assertToolSuccess(result);
		return result;
	},
	[READ_ARTBOARD_TOOL]: async ({ client }) => {
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const result = await callArtboardTool(client, READ_ARTBOARD_TOOL, { artboardId: 'hero' });
		assertToolSuccess(result);
		return result;
	},
	[SET_ACTIVE_ARTBOARD_TOOL]: async ({ client }) => {
		await seedArtboard(client, 'hero', '<p>hero</p>');
		await seedArtboard(client, 'hero-alt', '<p>hero-alt</p>');
		const result = await callArtboardTool(client, SET_ACTIVE_ARTBOARD_TOOL, {
			artboardId: 'hero',
		});
		assertToolSuccess(result);
		const readResult = await callArtboardTool(client, READ_ARTBOARD_TOOL);
		assert.equal(assertToolSuccess(readResult).artboardId, 'hero');
		return result;
	},
	[EXPORT_ARTBOARD_TOOL]: async ({ client }) => {
		await seedArtboard(client, 'hero', '<p>hero</p>');
		const result = await callArtboardTool(client, EXPORT_ARTBOARD_TOOL);
		assertToolSuccess(result);
		return result;
	},
	[HANDOFF_STATUS_TOOL]: async ({ client }) => {
		await seedArtboard(client, 'hero', '<p>hero</p>');
		assertToolSuccess(await callArtboardTool(client, EXPORT_ARTBOARD_TOOL));
		const result = await callArtboardTool(client, HANDOFF_STATUS_TOOL);
		const body = assertToolSuccess(result);
		assert.equal(body.stale, false);
		assert.ok(body.lastExport !== undefined);
		assert.equal('exported' in body, false);
		return result;
	},
	[PLACE_FRAME_TOOL]: async ({ client, workspaceRoot }) => {
		await seedArtboard(client, 'hero', '<p>hero</p>');
		await seedArtboard(client, 'hero-alt', '<p>hero-alt</p>');
		const result = await callArtboardTool(client, PLACE_FRAME_TOOL, { id: 'hero' });
		const body = assertToolSuccess(result);
		assert.ok(Array.isArray(body.frames));
		assert.ok(body.frames.length > 0);
		const canvasText = await readFile(join(workspaceRoot, ...canvasPathSegments), 'utf8');
		assert.ok(canvasText.length > 0);
		return result;
	},
};

test('happyPath keys sorted-set equal ARTBOARD_TOOL_NAMES', () => {
	assertSortedSetEqual(Object.keys(happyPath), ARTBOARD_TOOL_NAMES);
});

test('listTools names sorted-set equal ARTBOARD_TOOL_NAMES', async () => {
	const client = await connectContractPair();
	const { tools } = await client.listTools();
	assertSortedSetEqual(
		tools.map((tool) => tool.name),
		ARTBOARD_TOOL_NAMES,
	);
});

test('list_artboards on an empty temp dir succeeds with empty artboards and frames', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[LIST_ARTBOARDS_TOOL]({ client, workspaceRoot });
	});
});

test('set_artboard hero succeeds', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[SET_ARTBOARD_TOOL]({ client, workspaceRoot });
	});
});

test('update_artboard hero with baseGeneration 1 succeeds', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[UPDATE_ARTBOARD_TOOL]({ client, workspaceRoot });
	});
});

test('read_artboard hero succeeds', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[READ_ARTBOARD_TOOL]({ client, workspaceRoot });
	});
});

test('set_active_artboard hero then omit-id read returns hero', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[SET_ACTIVE_ARTBOARD_TOOL]({ client, workspaceRoot });
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

test('export_artboard after set_artboard succeeds', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[EXPORT_ARTBOARD_TOOL]({ client, workspaceRoot });
	});
});

test('handoff_status after export is HandoffStatusResult with stale false and lastExport', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[HANDOFF_STATUS_TOOL]({ client, workspaceRoot });
	});
});

test('place_frame hero after hero and hero-alt succeeds and writes canvas.json', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		await happyPath[PLACE_FRAME_TOOL]({ client, workspaceRoot });
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
		assert.equal(body.message, 'export_artboard exports every frame. Omit artboardId and retry.');
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
		requireErrorCode(htmlResult, 'INVALID_ARGS');

		const generationResult = await callArtboardTool(client, UPDATE_ARTBOARD_TOOL, {
			artboardId: 'hero',
			html: '<p>hero</p>',
			baseGeneration: '1',
		});
		requireErrorCode(generationResult, 'INVALID_ARGS');

		const rootPathResult = await callArtboardTool(client, LIST_ARTBOARDS_TOOL, {
			rootPath: { path: workspaceRoot },
		});
		requireErrorCode(rootPathResult, 'INVALID_ARGS');
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
