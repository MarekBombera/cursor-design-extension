// ponytail: one process-wide queue (coarser than per-id); upgrade if a second writer is proven
let diskOpQueue: Promise<void> = Promise.resolve();

export const enqueueDiskOp = <T>(operation: () => Promise<T>): Promise<T> => {
	const run = diskOpQueue.then(operation, operation);
	diskOpQueue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
};
