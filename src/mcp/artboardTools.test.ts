import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';

import { type CallToolResult, type McpServer } from '@modelcontextprotocol/server';

import { registerArtboardTools } from './artboardTools';
import { serializeCanvasLayout } from '../disk/canvasLayout';
import {
	FIRST_PAGE_ID,
	CANVAS_SCHEMA_VERSION,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	artboardsDirSegments,
	canvasPathSegments,
	manifestPathSegments,
} from '../disk/layout';
import { resolveOpenPage } from '../disk/openPage';
import { VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import {
	LIST_ARTBOARDS_TOOL,
	PLACE_FRAME_TOOL,
	READ_ARTBOARD_TOOL,
	SET_ARTBOARD_TOOL,
} from './toolNames';

type CapturedHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-tools-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

// toMcpToolError logs a DiskError to MCP stderr; a test that expects one asserts the line.
const spyStderr = () => vi.spyOn(process.stderr, 'write').mockReturnValue(true);

const loggedSymlinkDiskError = (stderr: ReturnType<typeof spyStderr>): boolean =>
	stderr.mock.calls.some(
		([line]) =>
			String(line).startsWith('vibeboard MCP: DiskError: ') &&
			String(line).includes('canvas.json must be a regular file (symlinks rejected).'),
	);

const captureHandlers = (): Map<string, CapturedHandler> => {
	const handlers = new Map<string, CapturedHandler>();
	const stubServer = {
		registerTool: (name: string, _config: unknown, handler: CapturedHandler): void => {
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
	const previousRoots = process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV];
	process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV] = JSON.stringify([workspaceRoot]);
	try {
		await run();
	} finally {
		if (previousRoots === undefined) {
			delete process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV];
		} else {
			process.env[VIBEBOARD_WORKSPACE_ROOTS_ENV] = previousRoots;
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

test('filesystem errno goes to stderr, never into the tool result', async (context) => {
	if (process.getuid?.() === 0) {
		context.skip('root ignores chmod');
		return;
	}
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const setArtboard = handlerFor(SET_ARTBOARD_TOOL);
		assert.equal((await setArtboard({ artboardId: 'hero', html: '<p>v1</p>' })).isError, false);
		const artboardsDir = join(workspaceRoot, ...artboardsDirSegments(FIRST_PAGE_ID));
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

const canvasFileOf = (workspaceRoot: string): string =>
	join(workspaceRoot, ...canvasPathSegments(FIRST_PAGE_ID));

const readCanvasText = async (workspaceRoot: string): Promise<string | undefined> => {
	try {
		return await readFile(canvasFileOf(workspaceRoot), 'utf8');
	} catch {
		return undefined;
	}
};

const seedArtboards = async (ids: readonly string[]): Promise<void> => {
	const setArtboard = handlerFor(SET_ARTBOARD_TOOL);
	for (const artboardId of ids) {
		const result = await setArtboard({
			artboardId,
			html: `<p>${artboardId}</p>`,
			title: artboardId,
		});
		assert.equal(result.isError, false);
	}
};

test('place_frame writes the stored layout and returns every frame', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero', 'hero-alt']);
		const result = await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero', group: 'Desktop' });
		assert.equal(result.isError, false);

		const heroFrame = {
			id: 'hero',
			label: 'hero',
			x: 0,
			y: 0,
			width: DEFAULT_FRAME_WIDTH,
			group: 'Desktop',
		};
		assert.equal(
			await readCanvasText(workspaceRoot),
			serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [heroFrame] }),
		);
		assert.deepEqual(bodyOf(result).frames, [
			heroFrame,
			{
				id: 'hero-alt',
				label: 'hero-alt',
				x: DEFAULT_FRAME_WIDTH + FRAME_GAP,
				y: 0,
				width: DEFAULT_FRAME_WIDTH,
			},
		]);
	});
});

test('list_artboards returns frames with auto-placed artboards and does not write', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const result = await handlerFor(LIST_ARTBOARDS_TOOL)({});
		assert.equal(result.isError, false);
		assert.deepEqual(bodyOf(result).frames, [
			{ id: 'hero', label: 'hero', x: 0, y: 0, width: DEFAULT_FRAME_WIDTH },
		]);
		assert.equal(await readCanvasText(workspaceRoot), undefined);
	});
});

test('place_frame with an unknown id is ARTBOARD_NOT_FOUND and creates no file', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const placeFrame = handlerFor(PLACE_FRAME_TOOL);
		assert.equal(errorCodeOf(await placeFrame({ id: 'hero' })), 'ARTBOARD_NOT_FOUND');
		await seedArtboards(['hero']);
		const result = await placeFrame({ id: 'missing' });
		assert.equal(errorCodeOf(result), 'ARTBOARD_NOT_FOUND');
		assert.equal(bodyOf(result).artboardId, 'missing');
		assert.equal(await readCanvasText(workspaceRoot), undefined);
	});
});

test('a symlinked canvas.json is DISK_ERROR and is left alone', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const targetPath = join(workspaceRoot, 'elsewhere.json');
		const targetText = serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [] });
		await writeFile(targetPath, targetText);
		await symlink(targetPath, canvasFileOf(workspaceRoot));
		const stderr = spyStderr();
		assert.equal(
			errorCodeOf(await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero', x: 10 })),
			'DISK_ERROR',
		);
		assert.ok(loggedSymlinkDiskError(stderr));
		assert.equal(await readFile(targetPath, 'utf8'), targetText);
	});
});

test('list_artboards fails with DISK_ERROR on a symlinked canvas.json', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const targetPath = join(workspaceRoot, 'elsewhere.json');
		await writeFile(targetPath, '{}');
		await symlink(targetPath, canvasFileOf(workspaceRoot));
		const stderr = spyStderr();
		assert.equal(errorCodeOf(await handlerFor(LIST_ARTBOARDS_TOOL)({})), 'DISK_ERROR');
		assert.ok(loggedSymlinkDiskError(stderr));
	});
});

test('place_frame surfaces a corrupt manifest and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		await writeFile(join(workspaceRoot, ...manifestPathSegments(FIRST_PAGE_ID)), '{ not json');
		assert.equal(
			errorCodeOf(await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero', x: 10 })),
			'CORRUPT_MANIFEST',
		);
		assert.equal(await readCanvasText(workspaceRoot), undefined);
	});
});

test('list_artboards without an artboards dir returns empty frames and skips canvas.json', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		// A page folder with no artboards dir.
		await resolveOpenPage({ workspaceRoot, createIfFresh: true });
		await writeFile(canvasFileOf(workspaceRoot), '{ not json');
		const result = await handlerFor(LIST_ARTBOARDS_TOOL)({});
		assert.equal(result.isError, false);
		assert.deepEqual(bodyOf(result).frames, []);
		assert.deepEqual(bodyOf(result).artboards, []);
	});
});
