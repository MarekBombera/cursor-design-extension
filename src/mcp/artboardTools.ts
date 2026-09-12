import { type CallToolResult, fromJsonSchema, type McpServer } from '@modelcontextprotocol/server';

import {
	createArtboard,
	exportArtboard,
	listArtboards,
	readArtboard,
	readHandoffStatus,
	setActiveArtboard,
	updateArtboard,
} from '../disk/artboardFs';
import {
	AmbiguousWorkspaceError,
	ArtboardExistsError,
	ArtboardNotFoundError,
	ConflictError,
	CorruptManifestError,
	CorruptMetaError,
	DiskError,
	InvalidArgsError,
	InvalidArtboardIdError,
	InvalidRootError,
	NoWorkspaceError,
	UnsupportedSchemaVersionError,
} from '../disk/errors';
import { CURSOR_DESIGN_WORKSPACE_ROOT_ENV } from './mcpIdentity';
import { enqueueDiskOp } from './mcpQueue';
import { parseWorkspaceRootsEnv, resolveWorkspaceRoot } from './resolveWorkspaceRoot';
import {
	EXPORT_ARTBOARD_TOOL,
	HANDOFF_STATUS_TOOL,
	LIST_ARTBOARDS_TOOL,
	READ_ARTBOARD_TOOL,
	SET_ACTIVE_ARTBOARD_TOOL,
	SET_ARTBOARD_TOOL,
	UPDATE_ARTBOARD_TOOL,
} from './toolNames';

type ToolArgs = {
	artboardId?: unknown;
	html?: unknown;
	title?: unknown;
	viewport?: unknown;
	rootPath?: unknown;
	baseGeneration?: unknown;
	baseHash?: unknown;
};

type McpErrorBody = {
	code: string;
	artboardId?: string;
	expectedGeneration?: number;
	actualGeneration?: number;
	expectedHash?: string;
	actualHash?: string;
	message: string;
};

// Schemas stay permissive on purpose: wrong-typed args must reach the handler so the
// agent gets authored INVALID_ARGS JSON, not an SDK "Input validation error".
const ROOT_PATH_DESCRIPTION = 'Workspace folder fsPath. Pass when more than one folder is open.';

const toolInputSchema = (properties: Record<string, { description: string }>) =>
	fromJsonSchema<ToolArgs>({
		type: 'object',
		properties,
		additionalProperties: true,
	});

const setArtboardInputSchema = toolInputSchema({
	artboardId: { description: 'New artboard id (letters, digits, dot, underscore, hyphen).' },
	html: { description: 'Full HTML document. Empty string allowed.' },
	title: { description: 'Optional title.' },
	viewport: { description: 'Optional viewport label, e.g. 1280x800.' },
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const updateArtboardInputSchema = toolInputSchema({
	artboardId: { description: 'Existing artboard id.' },
	html: { description: 'Replacement HTML document.' },
	baseGeneration: {
		description: 'Generation from read_artboard. Required unless baseHash is sent.',
	},
	baseHash: { description: 'Hash from read_artboard. Required unless baseGeneration is sent.' },
	title: { description: 'Optional title. Keeps the stored title when omitted.' },
	viewport: { description: 'Optional viewport label. Keeps the stored viewport when omitted.' },
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const readArtboardInputSchema = toolInputSchema({
	artboardId: { description: 'Artboard id. Defaults to the active artboard when omitted.' },
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const listArtboardsInputSchema = toolInputSchema({
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const setActiveArtboardInputSchema = toolInputSchema({
	artboardId: { description: 'Existing artboard id to make active.' },
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const exportArtboardInputSchema = toolInputSchema({
	artboardId: {
		description: 'Artboard id to export. Defaults to the active artboard when omitted.',
	},
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const handoffStatusInputSchema = toolInputSchema({
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

export const artboardToolInputSchemas = {
	[SET_ARTBOARD_TOOL]: setArtboardInputSchema,
	[UPDATE_ARTBOARD_TOOL]: updateArtboardInputSchema,
	[READ_ARTBOARD_TOOL]: readArtboardInputSchema,
	[LIST_ARTBOARDS_TOOL]: listArtboardsInputSchema,
	[SET_ACTIVE_ARTBOARD_TOOL]: setActiveArtboardInputSchema,
	[EXPORT_ARTBOARD_TOOL]: exportArtboardInputSchema,
	[HANDOFF_STATUS_TOOL]: handoffStatusInputSchema,
};

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

const toMcpToolError = (error: unknown): CallToolResult => {
	if (
		error instanceof AmbiguousWorkspaceError ||
		error instanceof ArtboardExistsError ||
		error instanceof ArtboardNotFoundError ||
		error instanceof ConflictError ||
		error instanceof CorruptManifestError ||
		error instanceof CorruptMetaError ||
		error instanceof DiskError ||
		error instanceof InvalidArgsError ||
		error instanceof InvalidArtboardIdError ||
		error instanceof InvalidRootError ||
		error instanceof NoWorkspaceError ||
		error instanceof UnsupportedSchemaVersionError
	) {
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
		return jsonResult(body, true);
	}
	process.stderr.write(
		`cursor-design MCP: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	return jsonResult(
		{
			code: 'DISK_ERROR',
			message:
				'Could not read or write artboard files. Check Output/stderr; fix folder permissions.',
		},
		true,
	);
};

const runQueued = async (
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

const firstFolderRoot = (): string => process.env[CURSOR_DESIGN_WORKSPACE_ROOT_ENV] ?? '';

const shouldWriteEnsurePanelMarker = (workspaceRoot: string): boolean => {
	const firstRoot = firstFolderRoot();
	return firstRoot.length > 0 && workspaceRoot === firstRoot;
};

export const registerArtboardTools = (server: McpServer): void => {
	server.registerTool(
		SET_ARTBOARD_TOOL,
		{
			title: 'Set artboard',
			description:
				'Create a new artboard HTML id on disk. html is required (empty string allowed). Does not overwrite an existing id. Pass rootPath when more than one folder is open.',
			inputSchema: setArtboardInputSchema,
		},
		async ({ artboardId, html, title, viewport, rootPath }) =>
			runQueued(rootPath, (workspaceRoot) =>
				createArtboard({
					workspaceRoot,
					artboardId,
					html,
					title,
					viewport,
					writeEnsurePanelMarker: shouldWriteEnsurePanelMarker(workspaceRoot),
				}),
			),
	);

	server.registerTool(
		UPDATE_ARTBOARD_TOOL,
		{
			title: 'Update artboard',
			description:
				'Replace HTML for an existing artboard. Requires baseGeneration and/or baseHash from read_artboard. Mismatch returns conflict without clobbering HTML.',
			inputSchema: updateArtboardInputSchema,
		},
		async ({ artboardId, html, title, viewport, rootPath, baseGeneration, baseHash }) =>
			runQueued(rootPath, (workspaceRoot) =>
				updateArtboard({
					workspaceRoot,
					artboardId,
					html,
					baseGeneration,
					baseHash,
					title,
					viewport,
				}),
			),
	);

	server.registerTool(
		READ_ARTBOARD_TOOL,
		{
			title: 'Read artboard',
			description:
				'Read artboard HTML and meta. artboardId optional (defaults to active). Does not write or bump generation.',
			inputSchema: readArtboardInputSchema,
		},
		async ({ artboardId, rootPath }) =>
			runQueued(rootPath, (workspaceRoot) =>
				readArtboard({
					workspaceRoot,
					artboardId,
				}),
			),
	);

	server.registerTool(
		LIST_ARTBOARDS_TOOL,
		{
			title: 'List artboards',
			description:
				'List artboards/*.html ids. Omits generation when meta is missing or corrupt. Does not write.',
			inputSchema: listArtboardsInputSchema,
		},
		async ({ rootPath }) =>
			runQueued(rootPath, (workspaceRoot) => listArtboards({ workspaceRoot })),
	);

	server.registerTool(
		SET_ACTIVE_ARTBOARD_TOOL,
		{
			title: 'Set active artboard',
			description:
				'Set manifest activeArtboardId to an id whose HTML exists. Does not open the panel. Host watcher reloads if the panel is already open on the first folder.',
			inputSchema: setActiveArtboardInputSchema,
		},
		async ({ artboardId, rootPath }) =>
			runQueued(rootPath, (workspaceRoot) =>
				setActiveArtboard({
					workspaceRoot,
					artboardId,
				}),
			),
	);

	server.registerTool(
		EXPORT_ARTBOARD_TOOL,
		{
			title: 'Export artboard',
			description:
				'Export an artboard to .cursor-design/handoff/<exportId>/ (index.html, IMPLEMENT.md, tokens.json) and record lastExport. artboardId optional (defaults to active). Call this before implementing from a handoff. Does not bump generation. Pass rootPath when more than one folder is open.',
			inputSchema: exportArtboardInputSchema,
		},
		async ({ artboardId, rootPath }) =>
			runQueued(rootPath, (workspaceRoot) =>
				exportArtboard({
					workspaceRoot,
					artboardId,
				}),
			),
	);

	server.registerTool(
		HANDOFF_STATUS_TOOL,
		{
			title: 'Handoff status',
			description:
				'Read whether the recorded handoff is stale versus the active artboard hash. Call this before implementing; if stale is true, re-export with export_artboard. Does not write. Pass rootPath when more than one folder is open.',
			inputSchema: handoffStatusInputSchema,
		},
		async ({ rootPath }) =>
			runQueued(rootPath, (workspaceRoot) => readHandoffStatus({ workspaceRoot })),
	);
};
