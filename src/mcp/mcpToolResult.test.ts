import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';

import { VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import { runOnOpenPage, toMcpToolError } from './mcpToolResult';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
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

test('runOnOpenPage reads the page title before the operation, so a project.json the operation corrupts still yields page', async () => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-result-'));
	try {
		vi.stubEnv(VIBEBOARD_WORKSPACE_ROOTS_ENV, JSON.stringify([workspaceRoot]));
		const result = await runOnOpenPage({
			server: new McpServer({ name: 'vibeboard-test', version: '0.0.0' }),
			rootPath: undefined,
			createIfFresh: true,
			operation: async () => {
				await writeFile(join(workspaceRoot, '.vibeboard', 'project.json'), '{ not json');
				return { done: true };
			},
		});
		assert.notEqual(result.isError, true);
		const [block] = result.content;
		assert.equal(block?.type, 'text');
		assert.deepEqual(JSON.parse(block?.type === 'text' ? block.text : ''), {
			done: true,
			page: { id: 'page-1', title: 'Page 1' },
		});
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});
