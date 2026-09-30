import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { type CallToolResult, type McpServer } from '@modelcontextprotocol/server';

import { artboardToolInputSchemas, registerArtboardTools } from './artboardTools';
import { artboardsDirSegments } from '../disk/layout';
import { CURSOR_DESIGN_WORKSPACE_ROOT_ENV, CURSOR_DESIGN_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import {
	EXPORT_ARTBOARD_TOOL,
	LIST_ARTBOARDS_TOOL,
	READ_ARTBOARD_TOOL,
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
} from './toolNames';

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

const textOf = (result: CallToolResult): string => {
	const [firstBlock] = result.content;
	assert(firstBlock.type === 'text');
	return firstBlock.text;
};

const bodyOf = (result: CallToolResult): Record<string, unknown> =>
	JSON.parse(textOf(result)) as Record<string, unknown>;

const errorCodeOf = (result: CallToolResult): unknown => {
	assert.equal(result.isError, true);
	return bodyOf(result).code;
};

const handlerFor = (toolName: string): CapturedHandler => {
	const handler = captureHandlers().get(toolName);
	assert.ok(handler !== undefined);
	return handler;
};

const captureStderr = async (run: () => Promise<void>): Promise<string> => {
	const originalWrite = process.stderr.write.bind(process.stderr);
	let captured = '';
	process.stderr.write = ((chunk: string | Uint8Array): boolean => {
		captured += String(chunk);
		return true;
	}) as typeof process.stderr.write;
	try {
		await run();
	} finally {
		process.stderr.write = originalWrite;
	}
	return captured;
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

test('unknown rootPath returns INVALID_ROOT with the valid roots', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const result = await handlerFor(EXPORT_ARTBOARD_TOOL)({ rootPath: '/not-open' });
		assert.equal(errorCodeOf(result), 'INVALID_ROOT');
		assert.deepEqual(bodyOf(result).roots, [workspaceRoot]);
	});
});

test('non-string rootPath returns INVALID_ARGS instead of crashing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		assert.equal(
			errorCodeOf(await handlerFor(LIST_ARTBOARDS_TOOL)({ rootPath: { path: workspaceRoot } })),
			'INVALID_ARGS',
		);
	});
});

test('no workspace env returns NO_WORKSPACE as a tool result', async () => {
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	delete process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	delete process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	try {
		assert.equal(errorCodeOf(await handlerFor(LIST_ARTBOARDS_TOOL)({})), 'NO_WORKSPACE');
	} finally {
		if (previousRoots !== undefined) {
			process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = previousRoots;
		}
		if (previousRoot !== undefined) {
			process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV] = previousRoot;
		}
	}
});

test('concurrent updates on one generation: one wins, the other gets conflict details', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const handlers = captureHandlers();
		const setArtboard = handlers.get(SET_ARTBOARD_TOOL);
		const updateArtboard = handlers.get(UPDATE_ARTBOARD_TOOL);
		const readArtboard = handlers.get(READ_ARTBOARD_TOOL);
		assert.ok(setArtboard && updateArtboard && readArtboard);
		assert.equal((await setArtboard({ artboardId: 'hero', html: '<p>v1</p>' })).isError, false);

		const [firstResult, secondResult] = await Promise.all([
			updateArtboard({ artboardId: 'hero', html: '<p>first</p>', baseGeneration: 1 }),
			updateArtboard({ artboardId: 'hero', html: '<p>second</p>', baseGeneration: 1 }),
		]);

		assert.equal(firstResult.isError, false);
		assert.equal(errorCodeOf(secondResult), 'conflict');
		const conflictBody = bodyOf(secondResult);
		assert.equal(conflictBody.artboardId, 'hero');
		assert.equal(conflictBody.expectedGeneration, 1);
		assert.equal(conflictBody.actualGeneration, 2);
		assert.equal(bodyOf(await readArtboard({ artboardId: 'hero' })).html, '<p>first</p>');
	});
});

test('filesystem errno goes to stderr, never into the tool result', async (context) => {
	if (process.getuid?.() === 0) {
		context.skip('root ignores chmod');
		return;
	}
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const setArtboard = handlerFor(SET_ARTBOARD_TOOL);
		assert.equal((await setArtboard({ artboardId: 'hero', html: '<p>v1</p>' })).isError, false);
		const artboardsDir = join(workspaceRoot, ...artboardsDirSegments);
		await chmod(artboardsDir, 0o000);
		let result: CallToolResult | undefined;
		try {
			const stderr = await captureStderr(async () => {
				result = await handlerFor(READ_ARTBOARD_TOOL)({ artboardId: 'hero' });
			});
			assert.match(stderr, /EACCES/);
		} finally {
			await chmod(artboardsDir, 0o755);
		}
		assert.ok(result !== undefined);
		assert.equal(errorCodeOf(result), 'DISK_ERROR');
		const resultText = textOf(result);
		assert.doesNotMatch(resultText, /EACCES|\n\s+at /);
		assert.ok(!resultText.includes(workspaceRoot));
	});
});

test('export_artboard with non-string artboardId returns INVALID_ARGS JSON', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const exportArtboard = captureHandlers().get(EXPORT_ARTBOARD_TOOL);
		assert.ok(exportArtboard !== undefined);
		assert.equal(await errorCodeOf(await exportArtboard({ artboardId: 42 })), 'INVALID_ARGS');
	});
});
