export const CURSOR_DESIGN_DIR = '.cursor-design' as const;

export const ARTBOARDS_DIR = 'artboards' as const;

const MANIFEST_FILE = 'manifest.json' as const;

export const SCHEMA_VERSION = 1 as const;

export const DEFAULT_ARTBOARD_ID = 'artboard' as const;

export const DEFAULT_ARTBOARD_TITLE = 'Artboard' as const;

export const DEFAULT_VIEWPORT = '1280x800' as const;

const ENSURE_PANEL_FILE = '.ensure-panel' as const;

const HANDOFF_DIR = 'handoff' as const;

export const TOKENS_FILE = 'tokens.json' as const;

export const HANDOFF_INDEX_FILE = 'index.html' as const;

export const IMPLEMENT_FILE = 'IMPLEMENT.md' as const;

export const CANVAS_PREVIEW_FILE = 'canvas.html' as const;

export const UNGROUPED_FOLDER = 'ungrouped' as const;

const CANVAS_FILE = 'canvas.json' as const;

export const CANVAS_SCHEMA_VERSION = 1 as const;

export const DEFAULT_FRAME_WIDTH = 1280;

export const MIN_FRAME_WIDTH = 120;

export const MAX_FRAME_WIDTH = 3840;

// Cap on a frame's content-driven height (frame runtime report and chrome guard).
export const MAX_FRAME_HEIGHT = 20000;

export const FRAME_GAP = 24;

// Bound on chrome-sent frame:place coordinates (the MCP tool stays unbounded).
export const MAX_FRAME_COORDINATE = 100_000;

// Frame → chrome pick fields (8d2); 8e reuses them for comments.json. Chars are UTF-16 code units.
export const MAX_SELECTOR_CHARS = 1000;

export const MAX_PICK_TEXT_CHARS = 200;

export const MAX_STYLE_VALUE_CHARS = 200;

export const COMMENT_STYLE_KEYS = [
	'font-family',
	'font-size',
	'font-weight',
	'line-height',
	'color',
	'background-color',
	'padding',
	'margin',
	'border-radius',
	'display',
	'width',
	'height',
	'gap',
] as const;

const COMMENTS_FILE = 'comments.json' as const;

export const COMMENTS_SCHEMA_VERSION = 1 as const;

// Body, every reply body, the resolve note (after trim).
export const MAX_COMMENT_BODY_CHARS = 2000;

export const MAX_COMMENTS = 500;

// User replies stop at MAX - 1; the last slot is the resolve note's.
export const MAX_COMMENT_REPLIES = 100;

// Cross-process write lock inside .cursor-design/ (see disk/workspaceLock.ts).
export const LOCK_FILE = '.lock' as const;

export const DEFAULT_ARTBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Artboard</title>
</head>
<body>
	<p>Empty artboard.</p>
	<script>
		console.log('cursor-design artboard');
	</script>
</body>
</html>
`;

export const manifestPathSegments = [CURSOR_DESIGN_DIR, MANIFEST_FILE] as const;

export const canvasPathSegments = [CURSOR_DESIGN_DIR, CANVAS_FILE] as const;

export const commentsPathSegments = [CURSOR_DESIGN_DIR, COMMENTS_FILE] as const;

export const artboardsDirSegments = [CURSOR_DESIGN_DIR, ARTBOARDS_DIR] as const;

export const artboardHtmlFileName = (artboardId: string): string => `${artboardId}.html`;

const artboardMetaFileName = (artboardId: string): string => `${artboardId}.meta.json`;

export const artboardHtmlPathSegments = (artboardId: string): readonly [string, string, string] => [
	...artboardsDirSegments,
	artboardHtmlFileName(artboardId),
];

export const artboardMetaPathSegments = (artboardId: string): readonly [string, string, string] => [
	...artboardsDirSegments,
	artboardMetaFileName(artboardId),
];

export const ensurePanelPathSegments = [CURSOR_DESIGN_DIR, ENSURE_PANEL_FILE] as const;

export const handoffRootSegments = [CURSOR_DESIGN_DIR, HANDOFF_DIR] as const;

export const workspaceTokensPathSegments = [CURSOR_DESIGN_DIR, TOKENS_FILE] as const;

export const handoffDirSegments = (exportId: string): readonly [string, string, string] => [
	...handoffRootSegments,
	exportId,
];
