import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, test, vi } from 'vite-plus/test';

import { InvalidRootError, NoWorkspaceError } from '../disk/errors';
import { VIBEBOARD_DIR } from '../disk/layout';
import { registerArtboardTools } from './artboardTools';
import { VIBEBOARD_WORKSPACE_ROOT_ENV, VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import { parseWorkspaceRootsEnv, resolveWorkspaceRoot } from './resolveWorkspaceRoot';
import { SET_ARTBOARD_TOOL } from './toolNames';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-roots-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await Promise.all(closers.splice(0).map((close) => close()));
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

test('exact rootPath match wins', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	assert.equal(
		resolveWorkspaceRoot({ roots: [firstRoot, secondRoot], rootPath: secondRoot }),
		secondRoot,
	);
});

test('rootPath with a trailing slash resolves to the host root', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.equal(
		resolveWorkspaceRoot({ roots: [workspaceRoot], rootPath: `${workspaceRoot}/` }),
		workspaceRoot,
	);
});

test('relative or empty rootPath is INVALID_ROOT even when cwd is a root', () => {
	const cwdRoot = process.cwd();
	for (const rootPath of ['.', '', './']) {
		assert.throws(
			() => resolveWorkspaceRoot({ roots: [cwdRoot], rootPath }),
			(error: unknown) => error instanceof InvalidRootError,
		);
	}
});

test('rootPath that only shares a prefix with a root is INVALID_ROOT', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.throws(
		() => resolveWorkspaceRoot({ roots: [workspaceRoot], rootPath: `${workspaceRoot}-evil` }),
		(error: unknown) => error instanceof InvalidRootError,
	);
});

test('rootPath outside the host list is INVALID_ROOT', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.throws(
		() => resolveWorkspaceRoot({ roots: [workspaceRoot], rootPath: join(workspaceRoot, '..') }),
		(error: unknown) => {
			assert.ok(error instanceof InvalidRootError);
			assert.deepEqual(error.roots, [workspaceRoot]);
			return true;
		},
	);
});

test('malformed ROOTS is NO_WORKSPACE naming the env, never a ROOT fallback; empty ROOTS is unset', async () => {
	const workspaceRoot = await makeTempRoot();
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	for (const rootsRaw of ['null', '{}', '[1]', '[""]', '["", "x"]', '["a", 1]', 'not json']) {
		assert.throws(
			() =>
				parseWorkspaceRootsEnv({
					[VIBEBOARD_WORKSPACE_ROOTS_ENV]: rootsRaw,
					[VIBEBOARD_WORKSPACE_ROOT_ENV]: workspaceRoot,
				}),
			(error: unknown) =>
				error instanceof NoWorkspaceError &&
				error.message ===
					`${VIBEBOARD_WORKSPACE_ROOTS_ENV} must be a JSON array of folder paths. Fix the vibeboard MCP server env.` &&
				error.cause instanceof Error,
			rootsRaw,
		);
	}
	assert.equal(stderr.mock.calls.length, 7);
	assert.match(String(stderr.mock.calls[0]?.[0]), /parse failed: expected a JSON array/);
	assert.deepEqual(
		parseWorkspaceRootsEnv({
			[VIBEBOARD_WORKSPACE_ROOTS_ENV]: '',
			[VIBEBOARD_WORKSPACE_ROOT_ENV]: workspaceRoot,
		}),
		[workspaceRoot],
	);
});

test('valid ROOTS wins over ROOT', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	assert.deepEqual(
		parseWorkspaceRootsEnv({
			[VIBEBOARD_WORKSPACE_ROOTS_ENV]: JSON.stringify([firstRoot, secondRoot]),
			[VIBEBOARD_WORKSPACE_ROOT_ENV]: firstRoot,
		}),
		[firstRoot, secondRoot],
	);
});

test('missing roots is NO_WORKSPACE', () => {
	assert.throws(
		() => parseWorkspaceRootsEnv({}),
		(error: unknown) => {
			assert.ok(error instanceof NoWorkspaceError);
			return true;
		},
	);
	assert.throws(
		() => parseWorkspaceRootsEnv({ [VIBEBOARD_WORKSPACE_ROOTS_ENV]: '[]' }),
		(error: unknown) => {
			assert.ok(error instanceof NoWorkspaceError);
			assert.equal(error.message, 'No workspace folder is available. Open a workspace folder.');
			return true;
		},
	);
});

test('omitted rootPath uses the first root', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	await mkdir(join(secondRoot, VIBEBOARD_DIR));
	assert.equal(resolveWorkspaceRoot({ roots: [firstRoot, secondRoot] }), firstRoot);
});

// clientRoots undefined = a client without the roots capability; current undefined = roots/list fails.
const connectClient = async (clientRoots?: { current: string[] | undefined }): Promise<Client> => {
	const server = new McpServer({ name: 'vibeboard-roots', version: '0.0.0' });
	registerArtboardTools(server);
	const client = new Client(
		{ name: 'vibeboard-roots-client', version: '0.0.0' },
		clientRoots === undefined ? {} : { capabilities: { roots: { listChanged: true } } },
	);
	if (clientRoots !== undefined) {
		client.setRequestHandler('roots/list', () => {
			if (clientRoots.current === undefined) {
				throw new Error('roots unavailable');
			}
			return { roots: clientRoots.current.map((root) => ({ uri: pathToFileURL(root).href })) };
		});
	}
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	closers.push(async () => {
		await client.close();
		await server.close();
	});
	return client;
};

const setArtboard = async (client: Client, rootPath?: string): Promise<CallToolResult> =>
	client.callTool({
		name: SET_ARTBOARD_TOOL,
		arguments: { artboardId: `a${Date.now()}`, html: '<p>x</p>', rootPath },
	});

const hasVibeboardDir = async (workspaceRoot: string): Promise<boolean> =>
	access(join(workspaceRoot, VIBEBOARD_DIR)).then(
		() => true,
		() => false,
	);

const errorCode = (result: CallToolResult): unknown => {
	const [block] = result.content;
	return result.isError === true && block?.type === 'text'
		? (JSON.parse(block.text) as { code?: unknown }).code
		: undefined;
};

test('a client with roots: tools act on its root, not the env root, and rootPath must be one of them', async () => {
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const clientRoot = await makeTempRoot();
	const envRoot = await makeTempRoot();
	vi.stubEnv(VIBEBOARD_WORKSPACE_ROOTS_ENV, JSON.stringify([envRoot]));
	const client = await connectClient({ current: [clientRoot] });

	assert.notEqual((await setArtboard(client)).isError, true);
	assert.equal(await hasVibeboardDir(clientRoot), true);
	assert.equal(await hasVibeboardDir(envRoot), false);
	assert.equal(errorCode(await setArtboard(client, envRoot)), 'INVALID_ROOT');
});

test('roots/list_changed: the next call sees the new roots', async () => {
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	vi.stubEnv(VIBEBOARD_WORKSPACE_ROOTS_ENV, '[]');
	const clientRoots = { current: [firstRoot] };
	const client = await connectClient(clientRoots);

	assert.notEqual((await setArtboard(client)).isError, true);
	clientRoots.current = [secondRoot];
	await client.sendRootsListChanged();
	assert.notEqual((await setArtboard(client)).isError, true);
	assert.equal(await hasVibeboardDir(secondRoot), true);
	assert.equal(errorCode(await setArtboard(client, firstRoot)), 'INVALID_ROOT');
});

test('a client without roots: the env roots are used', async () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const envRoot = await makeTempRoot();
	vi.stubEnv(VIBEBOARD_WORKSPACE_ROOTS_ENV, JSON.stringify([envRoot]));
	const client = await connectClient();

	assert.notEqual((await setArtboard(client)).isError, true);
	assert.equal(await hasVibeboardDir(envRoot), true);
	assert.ok(stderr.mock.calls.some(([line]) => String(line).includes('env fallback')));
});

test('a client with roots that reports none, or fails roots/list, is NO_WORKSPACE, never the env roots; a failure is not cached', async () => {
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const clientRoot = await makeTempRoot();
	const envRoot = await makeTempRoot();
	vi.stubEnv(VIBEBOARD_WORKSPACE_ROOTS_ENV, JSON.stringify([envRoot]));
	const clientRoots: { current: string[] | undefined } = { current: [] };
	const client = await connectClient(clientRoots);

	assert.equal(errorCode(await setArtboard(client)), 'NO_WORKSPACE');
	clientRoots.current = undefined;
	assert.equal(errorCode(await setArtboard(client)), 'NO_WORKSPACE');
	assert.equal(await hasVibeboardDir(envRoot), false);
	clientRoots.current = [clientRoot];
	assert.notEqual((await setArtboard(client)).isError, true);
	assert.equal(await hasVibeboardDir(clientRoot), true);
});
