import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { conflictFields } from './conflict';
import { hashHtml } from './hash';

test('conflictFields includes only compared generation on mismatch', () => {
	assert.deepEqual(
		conflictFields({
			baseGeneration: 1,
			actualGeneration: 2,
			actualHash: hashHtml('<p>a</p>'),
		}),
		{ expectedGeneration: 1, actualGeneration: 2 },
	);
});

test('conflictFields includes only compared hash on mismatch', () => {
	const actualHash = hashHtml('<p>a</p>');
	const expectedHash = hashHtml('<p>b</p>');
	assert.deepEqual(
		conflictFields({
			baseHash: expectedHash,
			actualGeneration: 1,
			actualHash,
		}),
		{ expectedHash, actualHash },
	);
});

test('conflictFields returns undefined when generation and hash match', () => {
	const actualHash = hashHtml('<p>a</p>');
	const mixedCaseHash = `sha256:${actualHash.slice('sha256:'.length).toUpperCase()}`;
	assert.equal(
		conflictFields({
			baseGeneration: 3,
			baseHash: mixedCaseHash,
			actualGeneration: 3,
			actualHash,
		}),
		undefined,
	);
});

test('conflictFields matches hash case-insensitively on both sides', () => {
	const lowerHash = hashHtml('<p>a</p>');
	const upperHash = `sha256:${lowerHash.slice('sha256:'.length).toUpperCase()}`;
	assert.equal(
		conflictFields({ baseHash: lowerHash, actualGeneration: 1, actualHash: upperHash }),
		undefined,
	);
});
