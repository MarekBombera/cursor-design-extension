import { randomUUID } from 'node:crypto';
import { type FileHandle, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { LockTimeoutError, isErrno, throwDiskError } from './errors';
import { CURSOR_DESIGN_DIR, LOCK_FILE } from './layout';

export type WithWorkspaceLockArgs<T> = {
	workspaceRoot: string;
	operation: () => Promise<T>;
	timeoutMs?: number;
	staleMs?: number;
};

// The disk lib has no output channel; lock housekeeping failures go to stderr once each.
const logLockError = (action: string, error: unknown): void => {
	process.stderr.write(
		`cursor-design: workspace lock ${action} failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
};

// `wx` create: true when this caller now holds the lock, false when another holder exists.
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
		// that could not be unlinked is broken as stale after staleMs.
		await handle.close().catch((closeError: unknown) => {
			logLockError('close', closeError);
		});
		await unlink(lockPath).catch((unlinkError: unknown) => {
			logLockError('cleanup', unlinkError);
		});
		return throwDiskError(error);
	}
	return true;
};

// Age of a lock file in ms, or undefined when it is gone.
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

// ponytail: stale = mtime older than staleMs, no PID liveness or heartbeat. A hold is one small
// JSON read-modify-write, far below 30s. Upgrade path: heartbeat the mtime during long holds.
// Only the holder of `.lock.break` (wx) may remove a stale lock, and it re-checks staleness
// under it. Nothing else removes a lock it does not own, so the re-check cannot race: a fresh
// lock a waiter just created is never broken. True when the next attempt should run at once.
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
		// staleMs old; that removal can race only after such a crash.
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
			logLockError('break release', error);
		});
	}
	return true;
};

// ponytail: check-then-unlink is not atomic; a breaker could replace the file between the read
// and the unlink. Only possible after a 30s+ hold, which a canvas write never reaches.
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
		// leftover lock is broken as stale after staleMs.
		logLockError('release', error);
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
