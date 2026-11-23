import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vite-plus/test';

import { toMcpToolError } from './mcpToolResult';

afterEach(() => {
	vi.restoreAllMocks();
});

test('a foreign error reaches the Agent as the authored DISK_ERROR copy; its text goes to stderr only', () => {
	const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const result = toMcpToolError(new Error('/Users/x/secret: EACCES'));
	assert.equal(result.isError, true);
	assert.deepEqual(result.content, [
		{
			type: 'text',
			text: JSON.stringify({
				code: 'DISK_ERROR',
				message:
					'Could not read or write artboard files. Check Output/stderr; fix folder permissions.',
			}),
		},
	]);
	assert.match(String(stderr.mock.calls[0]?.[0]), /\/Users\/x\/secret: EACCES\n\s+at /);
});
