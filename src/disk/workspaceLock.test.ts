import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { CursorDesignError, FrameMovedError, LockTimeoutError } from './errors';
import { CURSOR_DESIGN_DIR, LOCK_FILE } from './layout';
import { isLockOrTempPath, withWorkspaceLock } from './workspaceLock';

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-lock-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
	);
});

const lockPathOf = (workspaceRoot: string): string =>
	join(workspaceRoot, CURSOR_DESIGN_DIR, LOCK_FILE);

const writeForeignLock = async (workspaceRoot: string, token: string): Promise<void> => {
	await mkdir(join(workspaceRoot, CURSOR_DESIGN_DIR), { recursive: true });
	await writeFile(lockPathOf(workspaceRoot), token, 'utf8');
};

const lockDirEntries = async (workspaceRoot: string): Promise<string[]> =>
	readdir(join(workspaceRoot, CURSOR_DESIGN_DIR));

test('creates .cursor-design/, runs the operation, and removes the lock', async () => {
	const workspaceRoot = await makeTempRoot();
	const result = await withWorkspaceLock({ workspaceRoot, operation: async () => 'done' });
	assert.equal(result, 'done');
	assert.deepEqual(await lockDirEntries(workspaceRoot), []);
});

test('a throwing operation releases the lock and rethrows the same error', async () => {
	const workspaceRoot = await makeTempRoot();
	const thrown = new Error('boom');
	await assert.rejects(
		withWorkspaceLock({
			workspaceRoot,
			operation: async () => {
				throw thrown;
			},
		}),
		(error: unknown) => error === thrown,
	);
	assert.deepEqual(await lockDirEntries(workspaceRoot), []);
});

test('a lock older than staleMs is broken and the operation runs', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeForeignLock(workspaceRoot, '1 dead-holder');
	const longAgo = new Date(Date.now() - 60_000);
	await utimes(lockPathOf(workspaceRoot), longAgo, longAgo);
	const result = await withWorkspaceLock({ workspaceRoot, operation: async () => 7 });
	assert.equal(result, 7);
	assert.deepEqual(await lockDirEntries(workspaceRoot), []);
});

test('a fresh foreign lock times out with LockTimeoutError and is left untouched', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeForeignLock(workspaceRoot, '1 live-holder');
	let ran = false;
	await assert.rejects(
		withWorkspaceLock({
			workspaceRoot,
			timeoutMs: 100,
			operation: async () => {
				ran = true;
			},
		}),
		LockTimeoutError,
	);
	assert.equal(ran, false);
	assert.equal(await readFile(lockPathOf(workspaceRoot), 'utf8'), '1 live-holder');
});

const runCounterIncrements = async ({
	workspaceRoot,
	callers,
}: {
	workspaceRoot: string;
	callers: number;
}): Promise<{ maxHolders: number }> => {
	const counterPath = join(workspaceRoot, 'counter.json');
	let holders = 0;
	let maxHolders = 0;
	await Promise.all(
		Array.from({ length: callers }, async () =>
			withWorkspaceLock({
				workspaceRoot,
				timeoutMs: 10_000,
				operation: async () => {
					holders += 1;
					maxHolders = Math.max(maxHolders, holders);
					const count = JSON.parse(await readFile(counterPath, 'utf8')) as number;
					await new Promise((resolve) => setTimeout(resolve, 1));
					await writeFile(counterPath, JSON.stringify(count + 1), 'utf8');
					holders -= 1;
				},
			}),
		),
	);
	return { maxHolders };
};

// The lock keeps no in-memory state, so concurrent callers here run the same file protocol a
// second process would. ponytail: no spawned-process test; add a child-process harness if a
// cross-process bug shows up.
test('20 concurrent callers serialize a read-increment-write counter', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeFile(join(workspaceRoot, 'counter.json'), '0', 'utf8');
	const { maxHolders } = await runCounterIncrements({ workspaceRoot, callers: 20 });
	assert.equal(JSON.parse(await readFile(join(workspaceRoot, 'counter.json'), 'utf8')), 20);
	assert.equal(maxHolders, 1);
});

test('two callers racing on the same stale lock both finish, one at a time', async () => {
	const workspaceRoot = await makeTempRoot();
	await writeFile(join(workspaceRoot, 'counter.json'), '0', 'utf8');
	await writeForeignLock(workspaceRoot, '1 dead-holder');
	const longAgo = new Date(Date.now() - 60_000);
	await utimes(lockPathOf(workspaceRoot), longAgo, longAgo);
	const { maxHolders } = await runCounterIncrements({ workspaceRoot, callers: 2 });
	assert.equal(JSON.parse(await readFile(join(workspaceRoot, 'counter.json'), 'utf8')), 2);
	assert.equal(maxHolders, 1);
	assert.deepEqual(await lockDirEntries(workspaceRoot), []);
});

// F-18: several callers racing one stale lock. The old rename + inode + link-back break let two
// callers hold at once here; the `.lock.break` sub-lock must not.
test('many rounds of several callers racing a stale lock never overlap', async () => {
	for (let round = 0; round < 15; round += 1) {
		const workspaceRoot = await makeTempRoot();
		await writeFile(join(workspaceRoot, 'counter.json'), '0', 'utf8');
		await writeForeignLock(workspaceRoot, '1 dead-holder');
		const longAgo = new Date(Date.now() - 60_000);
		await utimes(lockPathOf(workspaceRoot), longAgo, longAgo);
		const { maxHolders } = await runCounterIncrements({ workspaceRoot, callers: 6 });
		assert.equal(JSON.parse(await readFile(join(workspaceRoot, 'counter.json'), 'utf8')), 6);
		assert.equal(maxHolders, 1, `round ${round}`);
		assert.deepEqual(await lockDirEntries(workspaceRoot), [], `round ${round}`);
	}
});

// F-23: a breaker that crashed mid-break leaves `.lock.break`; once it is stale too, the next
// waiter must clear it and break the stale lock, or every writer stays WORKSPACE_BUSY forever.
test("a stale lock plus a crashed breaker's stale .lock.break is cleared and the operation runs", async () => {
	const workspaceRoot = await makeTempRoot();
	await writeForeignLock(workspaceRoot, '1 dead-holder');
	const breakPath = `${lockPathOf(workspaceRoot)}.break`;
	await writeFile(breakPath, '2 dead-breaker', 'utf8');
	const longAgo = new Date(Date.now() - 60_000);
	await utimes(lockPathOf(workspaceRoot), longAgo, longAgo);
	await utimes(breakPath, longAgo, longAgo);
	const result = await withWorkspaceLock({
		workspaceRoot,
		timeoutMs: 2000,
		operation: async () => 'ran',
	});
	assert.equal(result, 'ran');
	assert.deepEqual(await lockDirEntries(workspaceRoot), []);
});

test('release is owner-checked: a foreign token survives', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceLock({
		workspaceRoot,
		operation: async () => {
			await writeFile(lockPathOf(workspaceRoot), '2 someone-else', 'utf8');
		},
	});
	assert.equal(await readFile(lockPathOf(workspaceRoot), 'utf8'), '2 someone-else');
});

test('isLockOrTempPath matches the lock, broken locks, and temp files only', () => {
	const base = join('/w', CURSOR_DESIGN_DIR);
	assert.equal(isLockOrTempPath(join(base, '.lock')), true);
	assert.equal(isLockOrTempPath(join(base, '.lock.break')), true);
	assert.equal(isLockOrTempPath(join(base, 'canvas.json.123.tmp')), true);
	assert.equal(isLockOrTempPath(join(base, 'canvas.json')), false);
	assert.equal(isLockOrTempPath(join(base, 'artboards', 'a.html')), false);
});

test('the new errors are CursorDesignErrors with stable codes', () => {
	const busy = new LockTimeoutError();
	const moved = new FrameMovedError('hero');
	assert.ok(busy instanceof CursorDesignError);
	assert.ok(moved instanceof CursorDesignError);
	assert.equal(busy.code, 'WORKSPACE_BUSY');
	assert.equal(moved.code, 'FRAME_MOVED');
	assert.equal(moved.frameId, 'hero');
});
