import { type McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/mini';

import {
	createArtboard,
	placeFrame,
	readArtboard,
	setActiveArtboard,
	updateArtboard,
} from '../disk/artboardFs';
import { listArtboards } from '../disk/canvasView';
import { exportArtboard, readHandoffStatus } from '../disk/exportFs';
import { isArtboardHash } from '../disk/hash';
import { MAX_FRAME_WIDTH, MIN_FRAME_WIDTH } from '../disk/layout';
import { parseArtboardId } from '../disk/parse';
import { READ_ONLY_ANNOTATIONS, rootPathArg, runOnOpenPage, zodToolInput } from './mcpToolResult';
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

// Mirrors skills/vibeboard/SKILL.md § Writing artboard HTML; both change with the frame CSPs
// (artboardChromeHtml.ts, FRAME_CSP).
const ARTBOARD_HTML_RULES =
	'The panel renders it in a sandbox: put CSS in <style> and JS in <script> (addEventListener). style="" attributes work: keep any already in the file (the user may have set them in the panel) and prefer classes for your own CSS. Inline on* handlers and anything loaded from outside the document (images, fonts, stylesheets, CDN scripts) do not work. Avoid vh units: frame height follows the content.';

const stringArg = (field: string, description: string): z.ZodMiniString<string> =>
	z
		.string({ error: `${field} must be a string. Fix args and retry.` })
		.check(z.describe(description));

const finiteNumberArg = (field: string, description: string) =>
	z.optional(
		z
			.number({ error: `${field} must be a finite number. Fix args and retry.` })
			.check(z.describe(description)),
	);

const viewportArg = (description: string) =>
	z.optional(
		z
			.string({ error: 'viewport must be a non-empty string. Fix args and retry.' })
			.check(z.minLength(1), z.describe(description)),
	);

const setArtboardInputSchema = z.strictObject({
	artboardId: stringArg(
		'artboardId',
		'Required string. New artboard id (letters, digits, dot, underscore, hyphen).',
	),
	html: stringArg(
		'html',
		`Required string. Full standalone HTML document. Empty string allowed. ${ARTBOARD_HTML_RULES}`,
	),
	title: z.optional(stringArg('title', 'Optional string title.')),
	viewport: viewportArg('Optional string viewport label, e.g. 1280x800.'),
	rootPath: rootPathArg,
});

const updateArtboardInputSchema = z.strictObject({
	artboardId: stringArg('artboardId', 'Required string. Existing artboard id.'),
	html: stringArg(
		'html',
		`Required string. Replacement HTML document (the whole document). ${ARTBOARD_HTML_RULES}`,
	),
	baseGeneration: z.optional(
		z
			.int({ error: 'baseGeneration must be an integer >= 1. Fix args and retry.' })
			.check(
				z.gte(1),
				z.describe('Integer generation from read_artboard. Required unless baseHash is sent.'),
			),
	),
	baseHash: z.optional(
		z
			.string({ error: 'baseHash must be sha256: plus 64 hex characters. Fix args and retry.' })
			.check(
				z.refine(isArtboardHash),
				z.describe(
					'String hash from read_artboard (sha256: plus 64 hex characters). Required unless baseGeneration is sent.',
				),
			),
	),
	title: z.optional(
		stringArg('title', 'Optional string title. Keeps the stored title when omitted.'),
	),
	viewport: viewportArg('Optional string viewport label. Keeps the stored viewport when omitted.'),
	rootPath: rootPathArg,
});

const readArtboardInputSchema = z.strictObject({
	artboardId: z.optional(
		stringArg(
			'artboardId',
			'Optional string artboard id. Defaults to the active artboard when omitted.',
		),
	),
	rootPath: rootPathArg,
});

const rootPathOnlyInputSchema = z.strictObject({ rootPath: rootPathArg });

const setActiveArtboardInputSchema = z.strictObject({
	artboardId: stringArg('artboardId', 'Required string. Existing artboard id to make active.'),
	rootPath: rootPathArg,
});

const placeFrameInputSchema = z.strictObject({
	id: stringArg(
		'id',
		'Required string. Existing artboard id to place on the stage (named id here, artboardId in the other tools).',
	),
	x: finiteNumberArg(
		'x',
		'Optional finite number. Stage x in px. Keeps the current value when omitted.',
	),
	y: finiteNumberArg(
		'y',
		'Optional finite number. Stage y in px. Keeps the current value when omitted.',
	),
	width: finiteNumberArg(
		'width',
		`Optional finite number. Frame width in px, clamped to ${MIN_FRAME_WIDTH}..${MAX_FRAME_WIDTH}. Keeps the current value when omitted.`,
	),
	label: z.optional(
		stringArg('label', 'Optional string label. Keeps the current label when omitted.'),
	),
	group: z.optional(
		stringArg(
			'group',
			'Optional string group name. Empty string clears the group. Keeps the current group when omitted.',
		),
	),
	rootPath: rootPathArg,
});

// Exported for tests: agentSkill.test.ts reads the tool names (skill drift guard).
/** @internal */
export const artboardToolInputSchemas = {
	[SET_ARTBOARD_TOOL]: setArtboardInputSchema,
	[UPDATE_ARTBOARD_TOOL]: updateArtboardInputSchema,
	[READ_ARTBOARD_TOOL]: readArtboardInputSchema,
	[LIST_ARTBOARDS_TOOL]: rootPathOnlyInputSchema,
	[SET_ACTIVE_ARTBOARD_TOOL]: setActiveArtboardInputSchema,
	[EXPORT_ARTBOARD_TOOL]: rootPathOnlyInputSchema,
	[HANDOFF_STATUS_TOOL]: rootPathOnlyInputSchema,
	[PLACE_FRAME_TOOL]: placeFrameInputSchema,
};

export const registerArtboardTools = (server: McpServer): void => {
	server.registerTool(
		SET_ARTBOARD_TOOL,
		{
			title: 'Set artboard',
			description:
				'Create a new artboard HTML id on disk. html is required (empty string allowed). Does not overwrite an existing id. Pass rootPath when more than one folder is open.',
			inputSchema: zodToolInput(setArtboardInputSchema),
			annotations: { destructiveHint: false, openWorldHint: false },
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: SET_ARTBOARD_TOOL,
				schema: setArtboardInputSchema,
				args,
				createIfFresh: true,
				// A bad-character id refuses before the resolver, so it never creates a fresh project.
				beforeResolve: ({ artboardId }) => {
					parseArtboardId(artboardId);
				},
				operation: ({ artboardId, html, title, viewport }, page, isFirstRoot) =>
					createArtboard({
						page,
						artboardId,
						html,
						title,
						viewport,
						writeEnsurePanelMarker: isFirstRoot,
					}),
			}),
	);

	server.registerTool(
		UPDATE_ARTBOARD_TOOL,
		{
			title: 'Update artboard',
			description:
				'Replace HTML for an existing artboard. Requires baseGeneration and/or baseHash from read_artboard. Mismatch returns conflict without clobbering HTML. WORKSPACE_BUSY when another Vibeboard write holds the lock: retry; after a crashed write it can last up to 30 s.',
			inputSchema: zodToolInput(updateArtboardInputSchema),
			annotations: { destructiveHint: true, openWorldHint: false },
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: UPDATE_ARTBOARD_TOOL,
				schema: updateArtboardInputSchema,
				args,
				createIfFresh: false,
				operation: ({ artboardId, html, baseGeneration, baseHash, title, viewport }, page) =>
					updateArtboard({ page, artboardId, html, baseGeneration, baseHash, title, viewport }),
			}),
	);

	server.registerTool(
		READ_ARTBOARD_TOOL,
		{
			title: 'Read artboard',
			description:
				'Read artboard HTML and meta. artboardId optional (defaults to active). Does not bump generation. May first settle the design folder (move an older one into pages once, or restore a missing project.json or artboards file); otherwise does not write.',
			inputSchema: zodToolInput(readArtboardInputSchema),
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: READ_ARTBOARD_TOOL,
				schema: readArtboardInputSchema,
				args,
				createIfFresh: false,
				operation: ({ artboardId }, page) => readArtboard({ page, artboardId }),
			}),
	);

	server.registerTool(
		LIST_ARTBOARDS_TOOL,
		{
			title: 'List artboards',
			description:
				'List artboards/*.html ids on the open page. Generation matches read_artboard when stored meta is usable. Omits generation when meta is unreadable or id-mismatched. Also returns frames: the stage layout from the open page (.vibeboard/pages/<pageId>/canvas.json), with artboards missing from it auto-placed to the right. May first settle the design folder (move an older one into pages once, or restore a missing project.json or artboards file); otherwise does not write.',
			inputSchema: zodToolInput(rootPathOnlyInputSchema),
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: LIST_ARTBOARDS_TOOL,
				schema: rootPathOnlyInputSchema,
				args,
				createIfFresh: false,
				operation: (_parsed, page) => listArtboards({ page }),
			}),
	);

	server.registerTool(
		PLACE_FRAME_TOOL,
		{
			title: 'Place frame',
			description:
				'Update one frame (x, y, width, label, group) in the open page (.vibeboard/pages/<pageId>/canvas.json) and return every frame. Omitted fields keep their current value; place_frame({ id }) pins an auto-placed frame. Call list_artboards first and avoid overlapping frames. Height is never stored. Pass rootPath when more than one folder is open.',
			inputSchema: zodToolInput(placeFrameInputSchema),
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: PLACE_FRAME_TOOL,
				schema: placeFrameInputSchema,
				args,
				createIfFresh: false,
				operation: ({ id, x, y, width, label, group }, page) =>
					placeFrame({ page, id, x, y, width, label, group }),
			}),
	);

	server.registerTool(
		SET_ACTIVE_ARTBOARD_TOOL,
		{
			title: 'Set active artboard',
			description:
				'Set manifest activeArtboardId to an id whose HTML exists. Does not open the panel. Host watcher reloads if the panel is already open on the first folder.',
			inputSchema: zodToolInput(setActiveArtboardInputSchema),
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: SET_ACTIVE_ARTBOARD_TOOL,
				schema: setActiveArtboardInputSchema,
				args,
				createIfFresh: false,
				operation: ({ artboardId }, page) => setActiveArtboard({ page, artboardId }),
			}),
	);

	server.registerTool(
		EXPORT_ARTBOARD_TOOL,
		{
			title: 'Export artboard',
			description:
				'Export every frame on the canvas to .vibeboard/handoff/<exportId>/ (IMPLEMENT.md, canvas.html, tokens.json, <group>/<id>/index.html) and record lastExport. Takes no artboardId. Call this before implementing from a handoff. Does not bump generation. Pass rootPath when more than one folder is open. WORKSPACE_BUSY when another Vibeboard write holds the lock: retry; after a crashed write it can last up to 30 s. The handoff folder is still written; a retry writes a new one.',
			inputSchema: zodToolInput(rootPathOnlyInputSchema),
			annotations: { destructiveHint: false, openWorldHint: false },
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: EXPORT_ARTBOARD_TOOL,
				schema: rootPathOnlyInputSchema,
				args,
				createIfFresh: false,
				operation: (_parsed, page) => exportArtboard({ page }),
			}),
	);

	server.registerTool(
		HANDOFF_STATUS_TOOL,
		{
			title: 'Handoff status',
			description:
				"Read whether the recorded handoff is stale: any frame's HTML changed, or a frame was added or removed since the last export. Call this before implementing; if stale is true, call export_artboard again. May first settle the design folder (move an older one into pages once, or restore a missing project.json or artboards file); otherwise does not write. Pass rootPath when more than one folder is open.",
			inputSchema: zodToolInput(rootPathOnlyInputSchema),
			annotations: READ_ONLY_ANNOTATIONS,
		},
		async (args) =>
			runOnOpenPage({
				server,
				tool: HANDOFF_STATUS_TOOL,
				schema: rootPathOnlyInputSchema,
				args,
				createIfFresh: false,
				operation: (_parsed, page) => readHandoffStatus({ page }),
			}),
	);
};
