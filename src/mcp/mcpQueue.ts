// ponytail: one process-wide queue for every tool, reads included. Upgrade path: let read-only
// tools skip it; writes stay serialized (they share the one workspace lock anyway).
let diskOpQueue: Promise<void> = Promise.resolve();

export const enqueueDiskOp = <T>(operation: () => Promise<T>): Promise<T> => {
	const run = diskOpQueue.then(operation, operation);
	diskOpQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
};
