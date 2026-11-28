import {
	type CallToolResult,
	type McpServer,
	type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import * as z from 'zod/mini';

import {
	ConflictError,
	VibeboardError,
	DiskError,
	InvalidArgsError,
	InvalidRootError,
} from '../disk/errors';
import { type PageLocation, readProjectFile } from '../disk/layoutFs';
import { resolveOpenPage } from '../disk/openPage';
import { enqueueDiskOp } from './mcpQueue';
import { allowedWorkspaceRoots, resolveWorkspaceRoot } from './resolveWorkspaceRoot';

type McpErrorBody = {
	code: string;
	artboardId?: string;
	expectedGeneration?: number;
	actualGeneration?: number;
	expectedHash?: string;
	actualHash?: string;
	roots?: readonly string[];
	message: string;
};

const ROOT_PATH_DESCRIPTION =
	'Optional string. Workspace folder fsPath. Pass when more than one folder is open; error roots lists valid values.';

export const rootPathArg = z.optional(
	z
		.string({ error: 'rootPath must be a string. Fix args and retry.' })
		.check(z.describe(ROOT_PATH_DESCRIPTION)),
);

type ToolArgsSchema = z.ZodMiniType<{ rootPath?: string | undefined }, unknown>;

// The advertised schema. validate passes everything through so the SDK never answers with its own
// text (it would drop our { code } body); parseToolArgs is the one parse.
export const zodToolInput = (
	schema: ToolArgsSchema,
): StandardSchemaWithJSON<Record<string, unknown>, Record<string, unknown>> => {
	const jsonSchema = (): Record<string, unknown> =>
		z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' });
	return {
		'~standard': {
			version: 1,
			vendor: 'vibeboard',
			validate: (value) => ({ value: value as Record<string, unknown> }),
			jsonSchema: { input: jsonSchema, output: jsonSchema },
		},
	};
};

const MAX_LISTED_KEYS = 3;

const MAX_LISTED_KEY_CHARS = 64;

// Agent-supplied key names: at most 3, each cut, so a flood of keys cannot flood the message.
const listedKeys = (keys: readonly string[]): string => {
	const listed = keys
		.slice(0, MAX_LISTED_KEYS)
		.map((key) => key.slice(0, MAX_LISTED_KEY_CHARS))
		.join(', ');
	return keys.length > MAX_LISTED_KEYS
		? `${listed} and ${keys.length - MAX_LISTED_KEYS} more`
		: listed;
};

// zod lists field issues before unrecognized_keys, so the unknown key is looked for first; it also
// has path [], so it must be matched before the root invalid_type case.
const toolArgsMessage = (tool: string, issues: readonly z.core.$ZodIssue[]): string => {
	const unknownKeys = issues.find((issue) => issue.code === 'unrecognized_keys');
	if (unknownKeys !== undefined) {
		return `${tool} does not take ${listedKeys(unknownKeys.keys)}. Fix args and retry.`;
	}
	const [first] = issues;
	if (first === undefined || (first.code === 'invalid_type' && first.path.length === 0)) {
		return `${tool} args must be an object. Fix args and retry.`;
	}
	return first.message;
};

/** @internal */
export const parseToolArgs = <Schema extends ToolArgsSchema>({
	tool,
	schema,
	args,
}: {
	tool: string;
	schema: Schema;
	args: unknown;
}): z.output<Schema> => {
	const parsed = schema.safeParse(args ?? {});
	if (!parsed.success) {
		throw new InvalidArgsError(toolArgsMessage(tool, parsed.error.issues), {
			cause: parsed.error,
		});
	}
	return parsed.data;
};

// ponytail: readOnlyHint describes the steady state. A read resolves the open page first, which can migrate an older
// design folder once, rebuild a lost project.json or restore a missing tombstone (openPage.ts); the descriptions
// say so. Upgrade path: drop the hint, or make reads never write, if a client ever auto-approves reads on a folder
// that still needs settling.
export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;

const jsonResult = (body: unknown, isError = false): CallToolResult => ({
	content: [{ type: 'text', text: JSON.stringify(body) }],
	isError,
});

const logMcpError = (error: unknown): void => {
	process.stderr.write(
		`vibeboard MCP: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
};

/** @internal */
export const toMcpToolError = (error: unknown): CallToolResult => {
	if (error instanceof VibeboardError) {
		if (error instanceof DiskError) {
			logMcpError(error);
			if (error.cause !== undefined) {
				logMcpError(error.cause);
			}
		}
		const body: McpErrorBody = {
			code: error.code,
			message: error.message,
		};
		if (
			'artboardId' in error &&
			typeof error.artboardId === 'string' &&
			error.artboardId.length > 0
		) {
			body.artboardId = error.artboardId;
		}
		if (error instanceof ConflictError) {
			Object.assign(body, error.compared);
		}
		if (error instanceof InvalidRootError) {
			body.roots = error.roots;
		}
		return jsonResult(body, true);
	}
	logMcpError(error);
	return jsonResult(
		{
			code: 'DISK_ERROR',
			message:
				'Could not read or write artboard files. Check Output/stderr; fix folder permissions.',
		},
		true,
	);
};

// isFirstRoot: the host watches only its first folder for `.ensure-panel`, so only that one gets it.
// Args are parsed first, so a schema error answers before roots/list and never touches disk.
export const runQueued = async <Schema extends ToolArgsSchema>(
	{
		server,
		tool,
		schema,
		args,
	}: { server: McpServer; tool: string; schema: Schema; args: unknown },
	operation: (
		parsed: z.output<Schema>,
		workspaceRoot: string,
		isFirstRoot: boolean,
	) => Promise<unknown>,
): Promise<CallToolResult> => {
	try {
		const parsed = parseToolArgs({ tool, schema, args });
		// Outside the queue: a slow client roots/list must not hold up other writes.
		const roots = await allowedWorkspaceRoots(server);
		const result = await enqueueDiskOp(async () => {
			const workspaceRoot = resolveWorkspaceRoot({ roots, rootPath: parsed.rootPath });
			return operation(parsed, workspaceRoot, workspaceRoot === roots[0]);
		});
		return jsonResult(result);
	} catch (error: unknown) {
		return toMcpToolError(error);
	}
};

// Every existing tool's handler: resolve the open page once, then add `page` to the success result.
// The title is read before the operation so no read after a write can fail (a corrupt index
// already fails in the resolver). page is null when the read found no project.json or no entry
// (a fresh folder, or a race). beforeResolve refuses args the schema cannot judge (set_artboard's
// id characters) before a fresh project is created.
export const runOnOpenPage = async <Schema extends ToolArgsSchema>({
	server,
	tool,
	schema,
	args,
	createIfFresh,
	beforeResolve,
	operation,
}: {
	server: McpServer;
	tool: string;
	schema: Schema;
	args: unknown;
	createIfFresh: boolean;
	beforeResolve?: (parsed: z.output<Schema>) => void;
	operation: (
		parsed: z.output<Schema>,
		page: PageLocation,
		isFirstRoot: boolean,
	) => Promise<object>;
}): Promise<CallToolResult> =>
	runQueued({ server, tool, schema, args }, async (parsed, workspaceRoot, isFirstRoot) => {
		beforeResolve?.(parsed);
		const page = await resolveOpenPage({ workspaceRoot, createIfFresh });
		const entry = (await readProjectFile(workspaceRoot))?.pages.find(
			({ id }) => id === page.pageId,
		);
		const result = await operation(parsed, page, isFirstRoot);
		return { ...result, page: entry === undefined ? null : { id: entry.id, title: entry.title } };
	});
