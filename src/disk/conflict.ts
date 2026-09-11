import { type ConflictCompared } from './errors';
import { normalizeHash } from './hash';

export type ConflictCheckArgs = {
	baseGeneration?: number;
	baseHash?: string;
	actualGeneration: number;
	actualHash: string;
};

export const conflictFields = ({
	baseGeneration,
	baseHash,
	actualGeneration,
	actualHash,
}: ConflictCheckArgs): ConflictCompared | undefined => {
	const compared: ConflictCompared = {};
	let mismatched = false;
	if (baseGeneration !== undefined) {
		compared.expectedGeneration = baseGeneration;
		compared.actualGeneration = actualGeneration;
		if (baseGeneration !== actualGeneration) {
			mismatched = true;
		}
	}
	if (baseHash !== undefined) {
		const expectedHash = normalizeHash(baseHash);
		const normalizedActualHash = normalizeHash(actualHash);
		compared.expectedHash = expectedHash;
		compared.actualHash = normalizedActualHash;
		if (expectedHash !== normalizedActualHash) {
			mismatched = true;
		}
	}
	return mismatched ? compared : undefined;
};
