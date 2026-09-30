import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { InvalidRootError, NoWorkspaceError } from '../disk/errors';
import { CURSOR_DESIGN_DIR } from '../disk/layout';
import { CURSOR_DESIGN_WORKSPACE_ROOT_ENV, CURSOR_DESIGN_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import { parseWorkspaceRootsEnv, resolveWorkspaceRoot } from './resolveWorkspaceRoot';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-roots-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
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

test('explicit rootPath wins over a single layout folder elsewhere', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	await mkdir(join(secondRoot, CURSOR_DESIGN_DIR));
	assert.equal(
		resolveWorkspaceRoot({ roots: [firstRoot, secondRoot], rootPath: firstRoot }),
		firstRoot,
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

test('invalid ROOTS falls back to ROOT', async () => {
	const workspaceRoot = await makeTempRoot();
	for (const rootsRaw of ['null', '{}', '[1]', '[""]', '["a", 1]', '{oops']) {
		assert.deepEqual(
			parseWorkspaceRootsEnv({
				[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV]: rootsRaw,
				[CURSOR_DESIGN_WORKSPACE_ROOT_ENV]: workspaceRoot,
			}),
			[workspaceRoot],
		);
	}
});

test('valid ROOTS wins over ROOT', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	assert.deepEqual(
		parseWorkspaceRootsEnv({
			[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV]: JSON.stringify([firstRoot, secondRoot]),
			[CURSOR_DESIGN_WORKSPACE_ROOT_ENV]: firstRoot,
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
		() => parseWorkspaceRootsEnv({ [CURSOR_DESIGN_WORKSPACE_ROOTS_ENV]: '[]' }),
		(error: unknown) => {
			assert.ok(error instanceof NoWorkspaceError);
			return true;
		},
	);
});

test('omitted rootPath uses the first root', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	await mkdir(join(secondRoot, CURSOR_DESIGN_DIR));
	assert.equal(resolveWorkspaceRoot({ roots: [firstRoot, secondRoot] }), firstRoot);
});

test('two folders without rootPath use the first folder', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	await mkdir(join(firstRoot, CURSOR_DESIGN_DIR));
	await mkdir(join(secondRoot, CURSOR_DESIGN_DIR));
	assert.equal(resolveWorkspaceRoot({ roots: [firstRoot, secondRoot] }), firstRoot);
});

test('single root without layout is used', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.equal(resolveWorkspaceRoot({ roots: [workspaceRoot] }), workspaceRoot);
});
