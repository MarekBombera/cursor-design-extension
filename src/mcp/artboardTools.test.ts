import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { type CallToolResult, type McpServer } from '@modelcontextprotocol/server';

import { artboardToolInputSchemas, registerArtboardTools } from './artboardTools';
import { serializeCanvasLayout } from '../disk/canvasLayout';
import {
	CANVAS_SCHEMA_VERSION,
	DEFAULT_FRAME_WIDTH,
	FRAME_GAP,
	artboardsDirSegments,
	canvasPathSegments,
} from '../disk/layout';
import { CURSOR_DESIGN_WORKSPACE_ROOT_ENV, CURSOR_DESIGN_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import {
	EXPORT_ARTBOARD_TOOL,
	LIST_ARTBOARDS_TOOL,
	PLACE_FRAME_TOOL,
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

test('export_artboard with any artboardId returns the authored INVALID_ARGS result', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		const result = await handlerFor(EXPORT_ARTBOARD_TOOL)({ artboardId: 'hero' });
		assert.equal(result.isError, true);
		assert.deepEqual(bodyOf(result), {
			code: 'INVALID_ARGS',
			message: 'export_artboard exports every frame. Omit artboardId and retry.',
		});
	});
});

const canvasFileOf = (workspaceRoot: string): string => join(workspaceRoot, ...canvasPathSegments);

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

test('place_frame keeps orphan entries and never stores unplaced siblings', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero', 'hero-alt']);
		const orphan = { id: 'gone', label: 'Gone', x: 5000, y: 0, width: 400 };
		await writeFile(
			canvasFileOf(workspaceRoot),
			serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [orphan] }),
		);

		const result = await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero-alt', width: 390 });
		assert.equal(result.isError, false);

		const heroAlt = {
			id: 'hero-alt',
			label: 'hero-alt',
			x: DEFAULT_FRAME_WIDTH + FRAME_GAP,
			y: 0,
			width: 390,
		};
		assert.equal(
			await readCanvasText(workspaceRoot),
			serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [orphan, heroAlt] }),
		);
		assert.deepEqual(bodyOf(result).frames, [
			heroAlt,
			{
				id: 'hero',
				label: 'hero',
				x: heroAlt.x + heroAlt.width + FRAME_GAP,
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

test('place_frame rejects wrong-typed args with INVALID_ARGS and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const placeFrame = handlerFor(PLACE_FRAME_TOOL);
		for (const badArgs of [{ x: '10' }, { x: null }, { width: '300' }, { group: 3 }]) {
			const result = await placeFrame({ id: 'hero', ...badArgs });
			assert.equal(errorCodeOf(result), 'INVALID_ARGS', JSON.stringify(badArgs));
			assert.match(String(bodyOf(result).message), new RegExp(`^${Object.keys(badArgs)[0]} `));
		}
		assert.equal(errorCodeOf(await placeFrame({ id: 42 })), 'INVALID_ARTBOARD_ID');
		assert.equal(await readCanvasText(workspaceRoot), undefined);
	});
});

test('place_frame never rewrites a corrupt or unsupported canvas.json', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const cases = [
			{ text: '{ not json', code: 'CORRUPT_CANVAS' },
			{ text: '{"version":1,"frames":[{"id":"hero"}]}', code: 'CORRUPT_CANVAS' },
			{ text: '{"version":2,"frames":[]}\n', code: 'UNSUPPORTED_CANVAS_VERSION' },
		];
		for (const { text, code } of cases) {
			await writeFile(canvasFileOf(workspaceRoot), text);
			assert.equal(errorCodeOf(await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero', x: 10 })), code);
			assert.equal(errorCodeOf(await handlerFor(LIST_ARTBOARDS_TOOL)({})), code);
			assert.equal(await readCanvasText(workspaceRoot), text);
		}
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
		assert.equal(
			errorCodeOf(await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero', x: 10 })),
			'DISK_ERROR',
		);
		assert.equal(await readFile(targetPath, 'utf8'), targetText);
	});
});

const frameAt = (id: string, x: number, group?: string) => ({
	id,
	label: id,
	x,
	y: 0,
	width: DEFAULT_FRAME_WIDTH,
	...(group === undefined ? {} : { group }),
});

test('place_frame with group "" clears a stored group through the MCP handler', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const placeFrame = handlerFor(PLACE_FRAME_TOOL);
		assert.equal((await placeFrame({ id: 'hero', group: 'Desktop' })).isError, false);
		assert.equal((await placeFrame({ id: 'hero', group: '' })).isError, false);
		assert.equal(
			await readCanvasText(workspaceRoot),
			serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [frameAt('hero', 0)] }),
		);
	});
});

test('place_frame pins a later id among several unplaced frames', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['artboard', 'hero', 'hero-alt']);
		const result = await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero' });
		assert.equal(result.isError, false);

		const slot = DEFAULT_FRAME_WIDTH + FRAME_GAP;
		assert.equal(
			await readCanvasText(workspaceRoot),
			serializeCanvasLayout({ version: CANVAS_SCHEMA_VERSION, frames: [frameAt('hero', slot)] }),
		);
		assert.deepEqual(bodyOf(result).frames, [
			frameAt('hero', slot),
			frameAt('artboard', 2 * slot),
			frameAt('hero-alt', 3 * slot),
		]);
	});
});

test('place_frame rejects null y and non-string label with INVALID_ARGS', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		for (const [field, badArgs] of [
			['y', { y: null }],
			['label', { label: 3 }],
		] as const) {
			const result = await handlerFor(PLACE_FRAME_TOOL)({ id: 'hero', ...badArgs });
			assert.equal(errorCodeOf(result), 'INVALID_ARGS');
			assert.match(String(bodyOf(result).message), new RegExp(`^${field} `));
		}
		assert.equal(await readCanvasText(workspaceRoot), undefined);
	});
});

test('list_artboards fails with DISK_ERROR on a symlinked canvas.json', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		const targetPath = join(workspaceRoot, 'elsewhere.json');
		await writeFile(targetPath, '{}');
		await symlink(targetPath, canvasFileOf(workspaceRoot));
		assert.equal(errorCodeOf(await handlerFor(LIST_ARTBOARDS_TOOL)({})), 'DISK_ERROR');
	});
});

test('place_frame surfaces a corrupt manifest and writes nothing', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceRootsEnv(workspaceRoot, async () => {
		await seedArtboards(['hero']);
		await writeFile(join(workspaceRoot, '.cursor-design', 'manifest.json'), '{ not json');
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
		await mkdir(join(workspaceRoot, '.cursor-design'));
		await writeFile(canvasFileOf(workspaceRoot), '{ not json');
		const result = await handlerFor(LIST_ARTBOARDS_TOOL)({});
		assert.equal(result.isError, false);
		assert.deepEqual(bodyOf(result).frames, []);
		assert.deepEqual(bodyOf(result).artboards, []);
	});
});
