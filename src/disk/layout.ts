export const CURSOR_DESIGN_DIR = '.cursor-design' as const;

export const ARTBOARDS_DIR = 'artboards' as const;

export const MANIFEST_FILE = 'manifest.json' as const;

export const SCHEMA_VERSION = 1 as const;

export const DEFAULT_ARTBOARD_ID = 'artboard' as const;

export const DEFAULT_ARTBOARD_TITLE = 'Artboard' as const;

export const DEFAULT_VIEWPORT = '1280x800' as const;

export const ENSURE_PANEL_FILE = '.ensure-panel' as const;

export const HANDOFF_DIR = 'handoff' as const;

export const TOKENS_FILE = 'tokens.json' as const;

export const HANDOFF_INDEX_FILE = 'index.html' as const;

export const IMPLEMENT_FILE = 'IMPLEMENT.md' as const;

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

export const artboardsDirSegments = [CURSOR_DESIGN_DIR, ARTBOARDS_DIR] as const;

export const artboardHtmlFileName = (artboardId: string): string => `${artboardId}.html`;

export const artboardMetaFileName = (artboardId: string): string => `${artboardId}.meta.json`;

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
