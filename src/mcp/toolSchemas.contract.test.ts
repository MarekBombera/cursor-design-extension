import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';

import { VIBEBOARD_WORKSPACE_ROOT_ENV, VIBEBOARD_WORKSPACE_ROOTS_ENV } from './mcpIdentity';
import { createVibeboardMcpServer } from './vibeboardMcpServer';

// The advertised contract every client sees, and proof that our parse (not the SDK's) answers.
const REQUIRED: Record<string, readonly string[]> = {
	set_artboard: ['artboardId', 'html'],
	update_artboard: ['artboardId', 'html'],
	read_artboard: [],
	list_artboards: [],
	set_active_artboard: ['artboardId'],
	export_artboard: [],
	handoff_status: [],
	place_frame: ['id'],
	list_comments: [],
	get_comment: ['id'],
	resolve_comment: ['id', 'note'],
	list_pages: [],
	create_page: ['title'],
	open_page: ['pageId'],
};

const connect = async (): Promise<{ client: Client; close: () => Promise<void> }> => {
	const server = createVibeboardMcpServer(join(process.cwd(), 'dist'));
	const client = new Client({ name: 'vibeboard-tool-schemas', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
};

const bodyOf = (result: CallToolResult): Record<string, unknown> => {
	const [block] = result.content;
	assert.equal(block?.type, 'text');
	return JSON.parse(block?.type === 'text' ? block.text : '') as Record<string, unknown>;
};

test('every tool advertises a strict, typed, described input schema', async () => {
	const { client, close } = await connect();
	try {
		const { tools } = await client.listTools();
		assert.deepEqual(tools.map(({ name }) => name).sort(), Object.keys(REQUIRED).sort());
		for (const { name, inputSchema } of tools) {
			assert.equal(inputSchema.type, 'object', name);
			assert.equal(inputSchema.additionalProperties, false, name);
			const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
			assert.deepEqual([...required].sort(), [...(REQUIRED[name] ?? [])].sort(), name);
			for (const [key, property] of Object.entries(inputSchema.properties ?? {})) {
				const field = property as Record<string, unknown>;
				assert.ok('type' in field || 'enum' in field, `${name}.${key} has no type`);
				assert.equal(typeof field.description, 'string', `${name}.${key} has no description`);
			}
		}
		const property = (tool: string, key: string): Record<string, unknown> =>
			tools.find(({ name }) => name === tool)?.inputSchema.properties?.[key] as Record<
				string,
				unknown
			>;
		assert.equal(property('update_artboard', 'baseGeneration').type, 'integer');
		assert.equal(property('update_artboard', 'baseGeneration').minimum, 1);
		assert.deepEqual(property('list_comments', 'status').enum, ['open', 'sent', 'resolved']);
	} finally {
		await close();
	}
});

// Each tool names its schema twice (zodToolInput and the handler's parse): a call that sends every
// advertised field must pass the parse and reach the roots, which answer NO_WORKSPACE with no env.
const EVERY_FIELD_ARGS: Record<string, Record<string, unknown>> = {
	set_artboard: {
		artboardId: 'hero',
		html: '',
		title: 'Hero',
		viewport: '1280x800',
		rootPath: '/x',
	},
	update_artboard: {
		artboardId: 'hero',
		html: '',
		baseGeneration: 1,
		baseHash: `sha256:${'0'.repeat(64)}`,
		title: 'Hero',
		viewport: '1280x800',
		rootPath: '/x',
	},
	read_artboard: { artboardId: 'hero', rootPath: '/x' },
	list_artboards: { rootPath: '/x' },
	set_active_artboard: { artboardId: 'hero', rootPath: '/x' },
	export_artboard: { rootPath: '/x' },
	handoff_status: { rootPath: '/x' },
	place_frame: { id: 'hero', x: 0, y: 0, width: 400, label: 'Hero', group: '', rootPath: '/x' },
	list_comments: { status: 'open', rootPath: '/x' },
	get_comment: { id: 'c1', rootPath: '/x' },
	resolve_comment: { id: 'c1', note: 'done', rootPath: '/x' },
	list_pages: { rootPath: '/x' },
	create_page: { title: 'Page', rootPath: '/x' },
	open_page: { pageId: 'page-2', rootPath: '/x' },
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

test('every tool parses a call carrying every field it advertises', async () => {
	vi.stubEnv(VIBEBOARD_WORKSPACE_ROOTS_ENV, '');
	vi.stubEnv(VIBEBOARD_WORKSPACE_ROOT_ENV, '');
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	const { client, close } = await connect();
	try {
		const { tools } = await client.listTools();
		assert.deepEqual(Object.keys(EVERY_FIELD_ARGS).sort(), Object.keys(REQUIRED).sort());
		for (const { name, inputSchema } of tools) {
			const args = EVERY_FIELD_ARGS[name] ?? {};
			assert.deepEqual(
				Object.keys(args).sort(),
				Object.keys(inputSchema.properties ?? {}).sort(),
				name,
			);
			const body = bodyOf(await client.callTool({ name, arguments: args }));
			assert.equal(body.code, 'NO_WORKSPACE', `${name}: ${String(body.message)}`);
		}
	} finally {
		await close();
	}
});

test('every tool answers an unknown key with our INVALID_ARGS body, never SDK text', async () => {
	const { client, close } = await connect();
	try {
		for (const name of Object.keys(REQUIRED)) {
			const result = await client.callTool({ name, arguments: { notAnArg: 1 } });
			assert.equal(result.isError, true, name);
			const body = bodyOf(result);
			assert.equal(body.code, 'INVALID_ARGS', name);
			assert.match(String(body.message), new RegExp(`^${name} does not take notAnArg\\.`), name);
		}
	} finally {
		await close();
	}
});
