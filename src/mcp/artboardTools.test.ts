import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { type CallToolResult, type McpServer } from '@modelcontextprotocol/server';

import { artboardToolInputSchemas, registerArtboardTools } from './artboardTools';
import { CURSOR_DESIGN_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import { SET_ARTBOARD_TOOL, UPDATE_ARTBOARD_TOOL } from './toolNames';

type CapturedHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-tools-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const captureHandlers = (): Map<string, CapturedHandler> => {
	const handlers = new Map<string, CapturedHandler>();
	const stubServer = {
		registerTool: (name: string, config: unknown, handler: CapturedHandler): void => {
			void config;
			handlers.set(name, handler);
		},
	} as unknown as McpServer;
	registerArtboardTools(stubServer);
	return handlers;
};

const withWorkspaceRootsEnv = async (
	workspaceRoot: string,
	run: () => Promise<void>,
): Promise<void> => {
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = JSON.stringify([workspaceRoot]);
	try {
		await run();
	} finally {
		if (previousRoots === undefined) {
			delete process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
		} else {
			process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = previousRoots;
		}
	}
};

const errorCodeOf = (result: CallToolResult): unknown => {
	assert.equal(result.isError, true);
	const [firstBlock] = result.content;
	assert(firstBlock.type === 'text');
	return (JSON.parse(firstBlock.text) as { code: unknown }).code;
};

test('set schema accepts wrong-typed args for handler-side validation', async () => {
	const validation = await artboardToolInputSchemas[SET_ARTBOARD_TOOL]['~standard'].validate({
		artboardId: 'hero',
		html: 42,
	});
	assert.ok(!('issues' in validation));
});

test('wrong-typed html reaches the handler as INVALID_ARGS JSON', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const setArtboard = captureHandlers().get(SET_ARTBOARD_TOOL);
		assert.ok(setArtboard !== undefined);
		assert.equal(
			await errorCodeOf(await setArtboard({ artboardId: 'hero', html: 42 })),
			'INVALID_ARGS',
		);
	});
});

test('wrong-typed baseGeneration returns INVALID_ARGS JSON', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const updateArtboard = captureHandlers().get(UPDATE_ARTBOARD_TOOL);
		assert.ok(updateArtboard !== undefined);
		assert.equal(
			await errorCodeOf(
				await updateArtboard({ artboardId: 'hero', html: '<p>hero</p>', baseGeneration: '1' }),
			),
			'INVALID_ARGS',
		);
	});
});
