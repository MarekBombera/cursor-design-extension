import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';

import { registerArtboardTools } from './artboardTools';
import { addComment } from '../disk/comments';
import { commentsPathSegments } from '../disk/layout';
import { registerCommentTools } from './commentTools';
import {
	CURSOR_DESIGN_MCP_SERVER_NAME,
	CURSOR_DESIGN_WORKSPACE_ROOT_ENV,
	CURSOR_DESIGN_WORKSPACE_ROOTS_ENV,
} from './mcpIdentity';
import {
	EXPORT_ARTBOARD_TOOL,
	GET_COMMENT_TOOL,
	HANDOFF_STATUS_TOOL,
	LIST_ARTBOARDS_TOOL,
	LIST_COMMENTS_TOOL,
	PLACE_FRAME_TOOL,
	READ_ARTBOARD_TOOL,
	RESOLVE_COMMENT_TOOL,
	SET_ACTIVE_ARTBOARD_TOOL,
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
} from './toolNames';

const TOOL_NAMES = [
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
	READ_ARTBOARD_TOOL,
	LIST_ARTBOARDS_TOOL,
	SET_ACTIVE_ARTBOARD_TOOL,
	EXPORT_ARTBOARD_TOOL,
	HANDOFF_STATUS_TOOL,
	PLACE_FRAME_TOOL,
	LIST_COMMENTS_TOOL,
	GET_COMMENT_TOOL,
	RESOLVE_COMMENT_TOOL,
] as const;

const HERO_HTML = '<!DOCTYPE html><html><body><main><h1>Hello</h1></main></body></html>';

const tempRoots: string[] = [];
let contractClient: Client | undefined;
let contractServer: McpServer | undefined;

const makeTempRoot = async (): Promise<string> => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), 'cursor-design-comment-contract-'));
	tempRoots.push(workspaceRoot);
	return workspaceRoot;
};

const connectContractPair = async (): Promise<Client> => {
	contractServer = new McpServer({
		name: CURSOR_DESIGN_MCP_SERVER_NAME,
		version: process.env.CURSOR_DESIGN_VERSION ?? '0.0.0',
	});
	registerArtboardTools(contractServer);
	registerCommentTools(contractServer);
	contractClient = new Client({ name: 'cursor-design-comment-contract', version: '0.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await Promise.all([
		contractClient.connect(clientTransport),
		contractServer.connect(serverTransport),
	]);
	return contractClient;
};

afterEach(async () => {
	try {
		if (contractClient !== undefined) {
			await contractClient.close();
		}
	} finally {
		contractClient = undefined;
		try {
			if (contractServer !== undefined) {
				await contractServer.close();
			}
		} finally {
			contractServer = undefined;
			await Promise.all(
				tempRoots
					.splice(0)
					.map((workspaceRoot) => rm(workspaceRoot, { recursive: true, force: true })),
			);
		}
	}
});

const restoreEnvVar = (name: string, previous: string | undefined): void => {
	if (previous === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = previous;
};

const withWorkspaceEnv = async (workspaceRoot: string, run: () => Promise<void>): Promise<void> => {
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = JSON.stringify([workspaceRoot]);
	process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV] = workspaceRoot;
	try {
		await run();
	} finally {
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const withMultiRootEnv = async (
	roots: readonly string[],
	run: () => Promise<void>,
): Promise<void> => {
	const previousRoots = process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV];
	const previousRoot = process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV];
	process.env[CURSOR_DESIGN_WORKSPACE_ROOTS_ENV] = JSON.stringify(roots);
	process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV] = roots[0];
	try {
		await run();
	} finally {
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOTS_ENV, previousRoots);
		restoreEnvVar(CURSOR_DESIGN_WORKSPACE_ROOT_ENV, previousRoot);
	}
};

const textOf = (result: CallToolResult): string =>
	JSON.stringify({
		isError: result.isError,
		content: result.content,
		structuredContent: result.structuredContent,
	});

const parsedBody = (result: CallToolResult): Record<string, unknown> => {
	const [block] = Array.isArray(result.content) ? result.content : [];
	assert.ok(
		block !== undefined &&
			typeof block === 'object' &&
			block !== null &&
			'text' in block &&
			typeof block.text === 'string',
		textOf(result),
	);
	const parsed: unknown = JSON.parse(block.text);
	assert.ok(
		typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed),
		textOf(result),
	);
	return parsed as Record<string, unknown>;
};

const assertSuccess = (result: CallToolResult): Record<string, unknown> => {
	assert.notEqual(result.isError, true, textOf(result));
	return parsedBody(result);
};

const requireErrorCode = (result: CallToolResult, code: string): Record<string, unknown> => {
	assert.equal(result.isError, true, textOf(result));
	const body = parsedBody(result);
	assert.equal(body.code, code, textOf(result));
	return body;
};

const callTool = (
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<CallToolResult> => client.callTool({ name, arguments: args });

const seedHeroComment = async (
	client: Client,
	workspaceRoot: string,
): Promise<{ commentId: string }> => {
	assertSuccess(await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: HERO_HTML }));
	const comment = await addComment({
		workspaceRoot,
		comment: {
			frameId: 'hero',
			generation: 1,
			selector: 'h1',
			tagName: 'h1',
			text: 'Hello',
			rect: { x: 0, y: 0, width: 10, height: 10 },
			pin: { x: 0.5, y: 0.25 },
			styles: { color: 'rgb(0, 0, 0)' },
			body: 'Make this bolder',
			isPage: false,
		},
	});
	return { commentId: comment.id };
};

const assertNoLeak = (result: unknown, workspaceRoot: string): void => {
	const text = JSON.stringify(result);
	assert.equal(text.includes(workspaceRoot), false, text);
	assert.equal(text.includes(tmpdir()), false, text);
	assert.equal(/\n\s+at /.test(text), false, text);
};

test('listTools returns the 8 artboard names plus the 3 comment names', async () => {
	const client = await connectContractPair();
	const { tools } = await client.listTools();
	assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
});

test('happy paths: list, get, stale after update, resolve', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const { commentId } = await seedHeroComment(client, workspaceRoot);
		const listed = assertSuccess(await callTool(client, LIST_COMMENTS_TOOL));
		assert.ok(Array.isArray(listed.comments));
		const [first] = listed.comments as Record<string, unknown>[];
		assert.equal(first?.id, commentId);
		// list_comments carries the thread length only; get_comment carries the thread.
		assert.equal(first?.replyCount, 0);
		assert.equal('replies' in (first ?? {}), false);
		const got = assertSuccess(await callTool(client, GET_COMMENT_TOOL, { id: commentId }));
		assert.equal(got.id, commentId);
		assert.deepEqual(got.replies, []);
		assert.equal(got.stale, false);
		assert.equal(got.targetMissing, false);
		assertSuccess(
			await callTool(client, UPDATE_ARTBOARD_TOOL, {
				artboardId: 'hero',
				html: HERO_HTML.replace('Hello', 'Hi'),
				baseGeneration: 1,
			}),
		);
		const stale = assertSuccess(await callTool(client, GET_COMMENT_TOOL, { id: commentId }));
		assert.equal(stale.stale, true);
		const resolved = assertSuccess(
			await callTool(client, RESOLVE_COMMENT_TOOL, { id: commentId, note: 'Bolded the heading' }),
		);
		assert.equal(resolved.status, 'resolved');
		assertNoLeak(listed, workspaceRoot);
		assertNoLeak(got, workspaceRoot);
		assertNoLeak(stale, workspaceRoot);
		assertNoLeak(resolved, workspaceRoot);
	});
});

test('COMMENT_NOT_FOUND and COMMENT_RESOLVED', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const { commentId } = await seedHeroComment(client, workspaceRoot);
		const missing = await callTool(client, GET_COMMENT_TOOL, { id: 'missing' });
		requireErrorCode(missing, 'COMMENT_NOT_FOUND');
		assertSuccess(await callTool(client, RESOLVE_COMMENT_TOOL, { id: commentId, note: 'done' }));
		const again = await callTool(client, RESOLVE_COMMENT_TOOL, {
			id: commentId,
			note: 'again',
		});
		requireErrorCode(again, 'COMMENT_RESOLVED');
		assertNoLeak(missing, workspaceRoot);
		assertNoLeak(again, workspaceRoot);
	});
});

test('status filter and invalid status', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const { commentId } = await seedHeroComment(client, workspaceRoot);
		assertSuccess(await callTool(client, RESOLVE_COMMENT_TOOL, { id: commentId, note: 'done' }));
		const unresolved = assertSuccess(await callTool(client, LIST_COMMENTS_TOOL));
		assert.deepEqual(unresolved.comments, []);
		const resolved = assertSuccess(
			await callTool(client, LIST_COMMENTS_TOOL, { status: 'resolved' }),
		);
		assert.equal((resolved.comments as { id: string }[]).length, 1);
		const invalid = await callTool(client, LIST_COMMENTS_TOOL, { status: 'nope' });
		requireErrorCode(invalid, 'INVALID_ARGS');
		assertNoLeak(invalid, workspaceRoot);
	});
});

test('missing note, non-string id and empty note are INVALID_ARGS', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		const { commentId } = await seedHeroComment(client, workspaceRoot);
		requireErrorCode(
			await callTool(client, RESOLVE_COMMENT_TOOL, { id: commentId }),
			'INVALID_ARGS',
		);
		requireErrorCode(await callTool(client, GET_COMMENT_TOOL, { id: 1 }), 'INVALID_ARGS');
		requireErrorCode(
			await callTool(client, RESOLVE_COMMENT_TOOL, { id: commentId, note: '' }),
			'INVALID_ARGS',
		);
	});
});

test('multi-root without rootPath matches list_artboards', async () => {
	const first = await makeTempRoot();
	const second = await makeTempRoot();
	await withMultiRootEnv([first, second], async () => {
		const client = await connectContractPair();
		// Without rootPath both tools use the first folder; a wrong rootPath is INVALID_ROOT for both.
		const artboards = await callTool(client, LIST_ARTBOARDS_TOOL);
		const comments = await callTool(client, LIST_COMMENTS_TOOL);
		assert.notEqual(artboards.isError, true);
		assert.notEqual(comments.isError, true);
		assert.deepEqual(parsedBody(comments), { comments: [] });
		const wrongRoot = { rootPath: join(first, 'not-a-root') };
		const artboardsWrong = await callTool(client, LIST_ARTBOARDS_TOOL, wrongRoot);
		const commentsWrong = await callTool(client, LIST_COMMENTS_TOOL, wrongRoot);
		assert.equal(parsedBody(artboardsWrong).code, 'INVALID_ROOT');
		assert.equal(parsedBody(commentsWrong).code, 'INVALID_ROOT');
		assertNoLeak(comments, first);
		assertNoLeak(comments, second);
	});
});

test('corrupt comments.json is CORRUPT_COMMENTS and names the relative path', async () => {
	const workspaceRoot = await makeTempRoot();
	await withWorkspaceEnv(workspaceRoot, async () => {
		const client = await connectContractPair();
		assertSuccess(
			await callTool(client, SET_ARTBOARD_TOOL, { artboardId: 'hero', html: HERO_HTML }),
		);
		await writeFile(join(workspaceRoot, ...commentsPathSegments), '{', 'utf8');
		const result = await callTool(client, LIST_COMMENTS_TOOL);
		const body = requireErrorCode(result, 'CORRUPT_COMMENTS');
		assert.ok(String(body.message).includes('.cursor-design/comments.json'));
		assertNoLeak(result, workspaceRoot);
	});
});
