import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { AmbiguousWorkspaceError, InvalidRootError, NoWorkspaceError } from '../disk/errors';
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

test('rootPath outside the host list is INVALID_ROOT', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.throws(
		() => resolveWorkspaceRoot({ roots: [workspaceRoot], rootPath: join(workspaceRoot, '..') }),
		(error: unknown) => {
			assert.ok(error instanceof InvalidRootError);
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

test('unique layout folder wins without rootPath', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	await mkdir(join(secondRoot, CURSOR_DESIGN_DIR));
	assert.equal(resolveWorkspaceRoot({ roots: [firstRoot, secondRoot] }), secondRoot);
});

test('two layout folders without rootPath is ambiguous', async () => {
	const firstRoot = await makeTempRoot();
	const secondRoot = await makeTempRoot();
	await mkdir(join(firstRoot, CURSOR_DESIGN_DIR));
	await mkdir(join(secondRoot, CURSOR_DESIGN_DIR));
	assert.throws(
		() => resolveWorkspaceRoot({ roots: [firstRoot, secondRoot] }),
		(error: unknown) => {
			assert.ok(error instanceof AmbiguousWorkspaceError);
			return true;
		},
	);
});

test('single root without layout is used', async () => {
	const workspaceRoot = await makeTempRoot();
	assert.equal(resolveWorkspaceRoot({ roots: [workspaceRoot] }), workspaceRoot);
});
