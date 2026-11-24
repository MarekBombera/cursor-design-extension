import { type CallToolResult, fromJsonSchema } from '@modelcontextprotocol/server';

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
import { parseWorkspaceRootsEnv, resolveWorkspaceRoot } from './resolveWorkspaceRoot';

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

export const ROOT_PATH_DESCRIPTION =
	'Optional string. Workspace folder fsPath. Pass when more than one folder is open; error roots lists valid values.';

export const toolInputSchema = <Args>(
	properties: Record<string, { description: string }>,
): ReturnType<typeof fromJsonSchema<Args>> =>
	fromJsonSchema<Args>({
		type: 'object',
		properties,
		additionalProperties: true,
	});

export const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false } as const;

const jsonResult = (body: unknown, isError = false): CallToolResult => ({
	content: [{ type: 'text', text: JSON.stringify(body) }],
	isError,
});

const optionalRootPath = (value: unknown): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new InvalidArgsError('rootPath must be a string. Fix args and retry.');
	}
	return value;
};

const logMcpError = (error: unknown): void => {
	process.stderr.write(
		`vibeboard MCP: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
};

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

export const runQueued = async (
	rootPath: unknown,
	operation: (workspaceRoot: string) => Promise<unknown>,
): Promise<CallToolResult> => {
	try {
		const result = await enqueueDiskOp(async () => {
			const roots = parseWorkspaceRootsEnv(process.env);
			const workspaceRoot = resolveWorkspaceRoot({
				roots,
				rootPath: optionalRootPath(rootPath),
			});
			return operation(workspaceRoot);
		});
		return jsonResult(result);
	} catch (error: unknown) {
		return toMcpToolError(error);
	}
};

// Every existing tool's handler: resolve the open page once, then add `page` to the success result.
// The title is read before the operation so no read after a write can fail (a corrupt index
// already fails in the resolver). page is null when the read found no project.json or no entry
// (a fresh folder, or a race).
export const runOnOpenPage = async ({
	rootPath,
	createIfFresh,
	beforeResolve,
	operation,
}: {
	rootPath: unknown;
	createIfFresh: boolean;
	beforeResolve?: () => void;
	operation: (page: PageLocation) => Promise<object>;
}): Promise<CallToolResult> =>
	runQueued(rootPath, async (workspaceRoot) => {
		beforeResolve?.();
		const page = await resolveOpenPage({ workspaceRoot, createIfFresh });
		const entry = (await readProjectFile(workspaceRoot))?.pages.find(
			({ id }) => id === page.pageId,
		);
		const result = await operation(page);
		return { ...result, page: entry === undefined ? null : { id: entry.id, title: entry.title } };
	});
