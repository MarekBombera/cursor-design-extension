import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';
import * as z from 'zod/mini';

import { VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import {
	parseToolArgs,
	rootPathArg,
	runOnOpenPage,
	toMcpToolError,
	zodToolInput,
} from './mcpToolResult';

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
			tool: 'test_tool',
			schema: z.strictObject({ rootPath: rootPathArg }),
			args: {},
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

const placeLike = z.strictObject({
	id: z.string({ error: 'id must be a string. Fix args and retry.' }),
	rootPath: rootPathArg,
});

const argsError = (
	args: unknown,
	schema: z.ZodMiniType<{ rootPath?: string | undefined }> = placeLike,
) =>
	assert.throws(
		() => parseToolArgs({ tool: 'place_frame', schema, args }),
		(error: unknown) => error instanceof Error && 'code' in error && error.code === 'INVALID_ARGS',
	);

const argsMessage = (
	args: unknown,
	schema: z.ZodMiniType<{ rootPath?: string | undefined }> = placeLike,
): string => {
	try {
		parseToolArgs({ tool: 'place_frame', schema, args });
	} catch (error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}
	return 'parsed';
};

test('an unknown key is named even when a required field is missing too', () => {
	argsError({ artboardId: 'hero' });
	assert.equal(
		argsMessage({ artboardId: 'hero' }),
		'place_frame does not take artboardId. Fix args and retry.',
	);
	assert.equal(
		argsMessage({ id: 'hero', a: 1, b: 2 }),
		'place_frame does not take a, b. Fix args and retry.',
	);
});

test('the unknown-key message lists at most 3 keys, each cut to 64 characters', () => {
	assert.equal(
		argsMessage({ id: 'hero', a: 1, b: 2, c: 3, d: 4, e: 5 }),
		'place_frame does not take a, b, c and 2 more. Fix args and retry.',
	);
	assert.equal(
		argsMessage({ id: 'hero', ['k'.repeat(200)]: 1 }),
		`place_frame does not take ${'k'.repeat(64)}. Fix args and retry.`,
	);
});

test("a field's authored error is the message; omitted args parse as {}", () => {
	assert.equal(argsMessage({ id: 5 }), 'id must be a string. Fix args and retry.');
	assert.equal(
		argsMessage({ id: 'hero', rootPath: {} }),
		'rootPath must be a string. Fix args and retry.',
	);
	assert.deepEqual(
		parseToolArgs({
			tool: 'list_pages',
			schema: z.strictObject({ rootPath: rootPathArg }),
			args: undefined,
		}),
		{},
	);
});

test('non-object args get the root message; an object-level refine keeps its own message', () => {
	assert.equal(argsMessage('x'), 'place_frame args must be an object. Fix args and retry.');
	const refined = z
		.strictObject({ rootPath: rootPathArg })
		.check(z.refine(() => false, { error: 'needs a base. Fix args and retry.' }));
	assert.equal(argsMessage({}, refined), 'needs a base. Fix args and retry.');
});

test('zodToolInput advertises the strict JSON Schema and never rejects', () => {
	const input = zodToolInput(
		z.strictObject({
			id: z.string().check(z.describe('Required id.')),
			rootPath: rootPathArg,
		}),
	);
	const json = input['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
	assert.equal(json.type, 'object');
	assert.equal(json.additionalProperties, false);
	assert.deepEqual(json.required, ['id']);
	assert.deepEqual(json.properties, {
		id: { type: 'string', description: 'Required id.' },
		rootPath: {
			type: 'string',
			description:
				'Optional string. Workspace folder fsPath. Pass when more than one folder is open; error roots lists valid values.',
		},
	});
	assert.equal(
		'required' in
			zodToolInput(z.strictObject({ rootPath: rootPathArg }))['~standard'].jsonSchema.input({
				target: 'draft-2020-12',
			}),
		false,
	);
	const value = { anything: 1 };
	assert.deepEqual(input['~standard'].validate(value), { value });
});
