import { randomUUID } from 'node:crypto';
import { type FileHandle, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { LockTimeoutError, isErrno, logStderr, throwDiskError } from './errors';
import { CURSOR_DESIGN_DIR, LOCK_FILE } from './layout';

export type WithWorkspaceLockArgs<T> = {
	workspaceRoot: string;
	operation: () => Promise<T>;
	timeoutMs?: number;
	staleMs?: number;
};

const tryCreateLock = async (lockPath: string, token: string): Promise<boolean> => {
	let handle: FileHandle;
	try {
		handle = await open(lockPath, 'wx');
	} catch (error: unknown) {
		if (isErrno(error, 'EEXIST')) {
			return false;
		}
		return throwDiskError(error);
	}
	try {
		await handle.writeFile(token, 'utf8');
		await handle.close();
	} catch (error: unknown) {
		// A half-made lock must not wait out the stale age: drop it and fail now.
		// ponytail: cleanup failures are logged, not thrown, so the original error wins; a lock
		// left behind is broken as stale after staleMs. Upgrade path: retry the unlink.
		await handle.close().catch((closeError: unknown) => {
			logStderr('workspace lock close', closeError);
		});
		await unlink(lockPath).catch((unlinkError: unknown) => {
			logStderr('workspace lock cleanup', unlinkError);
		});
		return throwDiskError(error);
	}
	return true;
};

const lockAgeMs = async (path: string): Promise<number | undefined> => {
	try {
		return Date.now() - (await lstat(path)).mtimeMs;
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return undefined;
		}
		return throwDiskError(error);
	}
};

const unlinkIfPresent = async (path: string): Promise<void> => {
	try {
		await unlink(path);
	} catch (error: unknown) {
		if (!isErrno(error, 'ENOENT')) {
			throwDiskError(error);
		}
	}
};

// ponytail: stale = mtime older than staleMs, no PID or heartbeat; every hold (one JSON
// read-modify-write, one HTML + meta write, or the export tail's N strict meta re-reads, N meta
// writes and one manifest write) is far below 30 s. Upgrade path: heartbeat the mtime.
// Only the `.lock.break` holder (wx) removes a stale lock, re-checking under it, so a waiter's
// fresh lock is never broken. True = retry at once.
const breakIfStale = async ({
	lockPath,
	token,
	staleMs,
}: {
	lockPath: string;
	token: string;
	staleMs: number;
}): Promise<boolean> => {
	const age = await lockAgeMs(lockPath);
	if (age === undefined) {
		return true;
	}
	if (age <= staleMs) {
		return false;
	}
	const breakPath = `${lockPath}.break`;
	if (!(await tryCreateLock(breakPath, token))) {
		// ponytail: a break lock left by a process that crashed mid-break is removed once it is
		// staleMs old; that removal can race only after such a crash. Upgrade path: a PID check.
		const breakAge = await lockAgeMs(breakPath);
		if (breakAge !== undefined && breakAge > staleMs) {
			await unlinkIfPresent(breakPath);
		}
		return false;
	}
	try {
		const ageNow = await lockAgeMs(lockPath);
		if (ageNow !== undefined && ageNow > staleMs) {
			await unlinkIfPresent(lockPath);
		}
	} finally {
		await unlink(breakPath).catch((error: unknown) => {
			logStderr('workspace lock break release', error);
		});
	}
	return true;
};

// ponytail: check-then-unlink is not atomic; a breaker could replace the file between the read
// and the unlink, only after a 30 s+ hold, which no locked write reaches. Upgrade path: rename to
// a unique name first, then check the token.
const releaseLock = async (lockPath: string, token: string): Promise<void> => {
	try {
		if ((await readFile(lockPath, 'utf8')) === token) {
			await unlink(lockPath);
		}
	} catch (error: unknown) {
		if (isErrno(error, 'ENOENT')) {
			return;
		}
		// ponytail: release failure is logged and swallowed so the operation's own result wins; a
		// leftover lock is broken as stale after staleMs. Upgrade path: retry the unlink.
		logStderr('workspace lock release', error);
	}
};

// Cross-process mutex over `.cursor-design/.lock` (MCP process and extension host share it).
export const withWorkspaceLock = async <T>({
	workspaceRoot,
	operation,
	timeoutMs = 2000,
	staleMs = 30_000,
}: WithWorkspaceLockArgs<T>): Promise<T> => {
	const lockDir = join(workspaceRoot, CURSOR_DESIGN_DIR);
	const lockPath = join(lockDir, LOCK_FILE);
	const token = `${process.pid} ${randomUUID()}`;
	try {
		await mkdir(lockDir, { recursive: true });
	} catch (error: unknown) {
		return throwDiskError(error);
	}
	const startedAt = Date.now();
	while (!(await tryCreateLock(lockPath, token))) {
		if (await breakIfStale({ lockPath, token, staleMs })) {
			continue;
		}
		if (Date.now() - startedAt >= timeoutMs) {
			throw new LockTimeoutError();
		}
		await sleep(10 + Math.random() * 40);
	}
	try {
		return await operation();
	} finally {
		await releaseLock(lockPath, token);
	}
};

// The watcher ignores the lock, its `.lock.break` sub-lock, and writeUtf8 temp files.
export const isLockOrTempPath = (fsPath: string): boolean => {
	const name = basename(fsPath);
	return name === LOCK_FILE || name.startsWith(`${LOCK_FILE}.`) || name.endsWith('.tmp');
};
