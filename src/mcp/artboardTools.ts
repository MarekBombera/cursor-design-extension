import { type McpServer } from '@modelcontextprotocol/server';

import {
	createArtboard,
	exportArtboard,
	listArtboards,
	placeFrame,
	readArtboard,
	readHandoffStatus,
	setActiveArtboard,
	updateArtboard,
} from '../disk/artboardFs';
import { InvalidArgsError } from '../disk/errors';
import { MAX_FRAME_WIDTH, MIN_FRAME_WIDTH } from '../disk/layout';
import { CURSOR_DESIGN_WORKSPACE_ROOT_ENV } from './mcpIdentity';
import {
	READ_ONLY_ANNOTATIONS,
	ROOT_PATH_DESCRIPTION,
	runQueued,
	toMcpToolError,
	toolInputSchema,
} from './mcpToolResult';
import {
	EXPORT_ARTBOARD_TOOL,
	HANDOFF_STATUS_TOOL,
	LIST_ARTBOARDS_TOOL,
	PLACE_FRAME_TOOL,
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
	id?: unknown;
	x?: unknown;
	y?: unknown;
	width?: unknown;
	label?: unknown;
	group?: unknown;
};

// Shown to the Agent on set_artboard / update_artboard. Mirrors skills/cursor-design/SKILL.md
// § Writing artboard HTML; both change with the frame CSPs (artboardChromeHtml.ts, FRAME_CSP).
const ARTBOARD_HTML_RULES =
	'The panel renders it in a sandbox: put CSS in <style> and JS in <script> (addEventListener). style="" attributes, inline on* handlers and anything loaded from outside the document (images, fonts, stylesheets, CDN scripts) do not work. Avoid vh units: frame height follows the content.';

const toolSchema = (properties: Record<string, { description: string }>) =>
	toolInputSchema<ToolArgs>(properties);

const setArtboardInputSchema = toolSchema({
	artboardId: {
		description: 'Required string. New artboard id (letters, digits, dot, underscore, hyphen).',
	},
	html: {
		description: `Required string. Full standalone HTML document. Empty string allowed. ${ARTBOARD_HTML_RULES}`,
	},
	title: { description: 'Optional string title.' },
	viewport: { description: 'Optional string viewport label, e.g. 1280x800.' },
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const updateArtboardInputSchema = toolSchema({
	artboardId: { description: 'Required string. Existing artboard id.' },
	html: {
		description: `Required string. Replacement HTML document (the whole document). ${ARTBOARD_HTML_RULES}`,
	},
	baseGeneration: {
		description: 'Integer generation from read_artboard. Required unless baseHash is sent.',
	},
	baseHash: {
		description: 'String hash from read_artboard. Required unless baseGeneration is sent.',
	},
	title: { description: 'Optional string title. Keeps the stored title when omitted.' },
	viewport: {
		description: 'Optional string viewport label. Keeps the stored viewport when omitted.',
	},
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const readArtboardInputSchema = toolSchema({
	artboardId: {
		description: 'Optional string artboard id. Defaults to the active artboard when omitted.',
	},
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const listArtboardsInputSchema = toolSchema({
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const setActiveArtboardInputSchema = toolSchema({
	artboardId: { description: 'Required string. Existing artboard id to make active.' },
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const exportArtboardInputSchema = toolSchema({
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const EXPORT_TAKES_NO_ARTBOARD_ID_MESSAGE =
	'export_artboard exports every frame. Omit artboardId and retry.';

const handoffStatusInputSchema = toolSchema({
	rootPath: { description: ROOT_PATH_DESCRIPTION },
});

const placeFrameInputSchema = toolSchema({
	id: {
		description:
			'Required string. Existing artboard id to place on the stage (named id here, artboardId in the other tools).',
	},
	x: {
		description: 'Optional finite number. Stage x in px. Keeps the current value when omitted.',
	},
	y: {
		description: 'Optional finite number. Stage y in px. Keeps the current value when omitted.',
	},
	width: {
		description: `Optional finite number. Frame width in px, clamped to ${MIN_FRAME_WIDTH}..${MAX_FRAME_WIDTH}. Keeps the current value when omitted.`,
	},
	label: { description: 'Optional string label. Keeps the current label when omitted.' },
	group: {
		description:
			'Optional string group name. Empty string clears the group. Keeps the current group when omitted.',
	},
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
	[PLACE_FRAME_TOOL]: placeFrameInputSchema,
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
			annotations: { destructiveHint: false, openWorldHint: false },
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
			annotations: { destructiveHint: true, openWorldHint: false },
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
			annotations: READ_ONLY_ANNOTATIONS,
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
				'List artboards/*.html ids. Generation matches read_artboard when stored meta is usable. Omits generation when meta is unreadable or id-mismatched. Also returns frames: the stage layout from .cursor-design/canvas.json, with artboards missing from it auto-placed to the right. Does not write.',
			inputSchema: listArtboardsInputSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async ({ rootPath }) =>
			runQueued(rootPath, (workspaceRoot) => listArtboards({ workspaceRoot })),
	);

	server.registerTool(
		PLACE_FRAME_TOOL,
		{
			title: 'Place frame',
			description:
				'Update one frame (x, y, width, label, group) in .cursor-design/canvas.json and return every frame. Omitted fields keep their current value; place_frame({ id }) pins an auto-placed frame. Call list_artboards first and avoid overlapping frames. Height is never stored. Pass rootPath when more than one folder is open.',
			inputSchema: placeFrameInputSchema,
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ id, x, y, width, label, group, rootPath }) =>
			runQueued(rootPath, (workspaceRoot) =>
				placeFrame({
					workspaceRoot,
					id,
					x,
					y,
					width,
					label,
					group,
				}),
			),
	);

	server.registerTool(
		SET_ACTIVE_ARTBOARD_TOOL,
		{
			title: 'Set active artboard',
			description:
				'Set manifest activeArtboardId to an id whose HTML exists. Does not open the panel. Host watcher reloads if the panel is already open on the first folder.',
			inputSchema: setActiveArtboardInputSchema,
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
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
				'Export every frame on the canvas to .cursor-design/handoff/<exportId>/ (IMPLEMENT.md, canvas.html, tokens.json, <group>/<id>/index.html) and record lastExport. Takes no artboardId. Call this before implementing from a handoff. Does not bump generation. Pass rootPath when more than one folder is open.',
			inputSchema: exportArtboardInputSchema,
			annotations: { destructiveHint: false, openWorldHint: false },
		},
		// The passthrough schema still delivers a stray artboardId; reject it before any disk work.
		async ({ artboardId, rootPath }) =>
			artboardId === undefined
				? runQueued(rootPath, (workspaceRoot) => exportArtboard({ workspaceRoot }))
				: toMcpToolError(new InvalidArgsError(EXPORT_TAKES_NO_ARTBOARD_ID_MESSAGE)),
	);

	server.registerTool(
		HANDOFF_STATUS_TOOL,
		{
			title: 'Handoff status',
			description:
				"Read whether the recorded handoff is stale: any frame's HTML changed, or a frame was added or removed since the last export. Call this before implementing; if stale is true, call export_artboard again. Does not write. Pass rootPath when more than one folder is open.",
			inputSchema: handoffStatusInputSchema,
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async ({ rootPath }) =>
			runQueued(rootPath, (workspaceRoot) => readHandoffStatus({ workspaceRoot })),
	);
};
