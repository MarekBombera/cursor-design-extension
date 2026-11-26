export const VIBEBOARD_DIR = '.vibeboard' as const;

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

// cd:pick field caps, also enforced on comments.json. Chars are UTF-16 code units.
export const MAX_SELECTOR_CHARS = 1000;

export const MAX_PICK_TEXT_CHARS = 200;

export const MAX_STYLE_VALUE_CHARS = 200;

// The inline properties an edit can change, in list order.
export const EDIT_STYLE_FIELDS = [
	'font-size',
	'color',
	'padding',
	'margin',
	'font-weight',
	'font-style',
	'text-decoration-line',
	'text-align',
	'line-height',
	'letter-spacing',
	'text-transform',
	'background-color',
	'border-radius',
	'overflow',
	'opacity',
	'gap',
	'border-width',
	'border-style',
	'border-color',
] as const;

// Shared by the panel's artboard:history type and the host's zod enum.
export const HISTORY_STEPS = ['undo', 'redo'] as const;

// Undo steps held per frame, shared by the host's history store and the chrome's queue cap.
export const MAX_HISTORY_STEPS = 20;

// Here, not in sourceTags.ts, so the frame runtime and the chrome never import parse5.
export const SOURCE_TAG_ATTRIBUTE = 'data-cd-src';

// Elements whose text parse5 reads as raw text: an encoded edit would show its entities. The edit
// core refuses text edits on them; the inspector shows no Text field.
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
	'iframe',
	'noembed',
	'noframes',
	'noscript',
	'xmp',
	'plaintext',
]);

// They can never hold text, so the inspector shows no Text field.
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr',
]);

// An Edit-mode pick's style attribute as the frame reports it; a longer one is reported as null.
export const MAX_PICK_STYLE_CHARS = 5000;

// Cap on an edit's new text and its liveText.
export const MAX_EDIT_TEXT_CHARS = 5000;

// ponytail: caps only the disk HTML per frame; source tags add about 17+ chars per element, so the
// posted copy can be about 8x larger (1.5M chars of bare `<p>` post about 12M), and nothing caps
// the total across frames. Edits that start or end over it are refused. Upgrade path: cap the
// tagged copy and the total per snapshot.
export const MAX_POSTED_ARTBOARD_HTML_CHARS = 1_500_000;

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

// Comment and reply ids in comments.json, and the comment ids cd:anchors / cd:anchor-rects carry.
export const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// User replies stop at MAX - 1; the last slot is the resolve note's.
export const MAX_COMMENT_REPLIES = 100;

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
		console.log('vibeboard artboard');
	</script>
</body>
</html>
`;

export const manifestPathSegments = (pageId: string): readonly [string, string, string, string] =>
	pageEntrySegments(pageId, MANIFEST_FILE);

export const canvasPathSegments = (pageId: string): readonly [string, string, string, string] =>
	pageEntrySegments(pageId, CANVAS_FILE);

export const commentsPathSegments = (pageId: string): readonly [string, string, string, string] =>
	pageEntrySegments(pageId, COMMENTS_FILE);

export const artboardsDirSegments = (pageId: string): readonly [string, string, string, string] =>
	pageEntrySegments(pageId, ARTBOARDS_DIR);

export const artboardHtmlFileName = (artboardId: string): string => `${artboardId}.html`;

const artboardMetaFileName = (artboardId: string): string => `${artboardId}.meta.json`;

export const artboardHtmlPathSegments = (
	pageId: string,
	artboardId: string,
): readonly [string, string, string, string, string] => [
	...artboardsDirSegments(pageId),
	artboardHtmlFileName(artboardId),
];

export const artboardMetaPathSegments = (
	pageId: string,
	artboardId: string,
): readonly [string, string, string, string, string] => [
	...artboardsDirSegments(pageId),
	artboardMetaFileName(artboardId),
];

export const ensurePanelPathSegments = [VIBEBOARD_DIR, ENSURE_PANEL_FILE] as const;

export const handoffRootSegments = [VIBEBOARD_DIR, HANDOFF_DIR] as const;

export const workspaceTokensPathSegments = [VIBEBOARD_DIR, TOKENS_FILE] as const;

export const handoffDirSegments = (exportId: string): readonly [string, string, string] => [
	...handoffRootSegments,
	exportId,
];

const PROJECT_FILE = 'project.json' as const;

const PAGES_DIR = 'pages' as const;

const DELETED_DIR = 'deleted' as const;

export const PROJECT_SCHEMA_VERSION = 1 as const;

export const FIRST_PAGE_ID = 'page-1' as const;

// ponytail: the 10d menu lists every page; search is 0.5.1.
export const MAX_PAGES = 100;

export const MAX_PAGE_TITLE_CHARS = 80;

const PAGE_ID_PATTERN = /^page-[1-9][0-9]{0,5}$/;

// The one page-id check: project.json entries, the page-folder scan, chrome messages and later MCP
// args.
export const isPageId = (value: unknown): value is string =>
	typeof value === 'string' && PAGE_ID_PATTERN.test(value);

// The four per-page names, in migration order (artboards first).
export const PAGE_ENTRIES = [ARTBOARDS_DIR, MANIFEST_FILE, CANVAS_FILE, COMMENTS_FILE] as const;

export type PageEntry = (typeof PAGE_ENTRIES)[number];

export const projectPathSegments = [VIBEBOARD_DIR, PROJECT_FILE] as const;

export const pagesDirSegments = [VIBEBOARD_DIR, PAGES_DIR] as const;

// Where deletePage moves a page folder; never emptied by vibeboard.
export const deletedDirSegments = [VIBEBOARD_DIR, DELETED_DIR] as const;

export const deletedPageDirSegments = (
	pageId: string,
	stamp: string,
): readonly [string, string, string] => [...deletedDirSegments, `${pageId}-${stamp}`];

// A regular file where 0.4 kept its artboards folder, so a stale server that still expects that folder fails
// instead of writing (cursor-design 0.4 itself uses only .cursor-design/).
export const artboardsTombstoneSegments = [VIBEBOARD_DIR, ARTBOARDS_DIR] as const;

// Where a page entry lived before pages (0.4).
export const rootEntrySegments = (name: PageEntry): readonly [string, string] => [
	VIBEBOARD_DIR,
	name,
];

export const pageDirSegments = (pageId: string): readonly [string, string, string] => [
	...pagesDirSegments,
	pageId,
];

export const pageEntrySegments = (
	pageId: string,
	name: PageEntry,
): readonly [string, string, string, string] => [...pageDirSegments(pageId), name];

// Constants only, no builder call: a module-level call would survive tree-shaking into the frame
// runtime IIFE that imports this file.
export const ARTBOARDS_TOMBSTONE_TEXT = `vibeboard keeps artboards in ${VIBEBOARD_DIR}/${PAGES_DIR}/<page id>/${ARTBOARDS_DIR}/ now.
Do not delete or replace this file. It stops an older vibeboard MCP server from writing artboards here, where the extension no longer reads them.
If a vibeboard tool fails with "${VIBEBOARD_DIR}/${ARTBOARDS_DIR} must be a directory (symlinks rejected).", quit and reopen your editor or restart your agent.
`;
