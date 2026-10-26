// Creates a new artboard HTML file on disk; never overwrites an existing id.
export const SET_ARTBOARD_TOOL = 'set_artboard' as const;

// Replaces the HTML of an existing artboard, guarded by baseGeneration/baseHash from read_artboard.
export const UPDATE_ARTBOARD_TOOL = 'update_artboard' as const;

// Reads an artboard's HTML and meta (defaults to the active one) without writing.
export const READ_ARTBOARD_TOOL = 'read_artboard' as const;

// Lists artboard ids and the stage frames (from canvas.json, unplaced ones auto-placed on read); read-only.
export const LIST_ARTBOARDS_TOOL = 'list_artboards' as const;

// Sets which artboard is active in the manifest; does not open the panel.
export const SET_ACTIVE_ARTBOARD_TOOL = 'set_active_artboard' as const;

// Exports every frame to .cursor-design/handoff/<exportId>/ (IMPLEMENT.md, canvas.html, tokens.json, <group>/<id>/index.html) for implementation.
export const EXPORT_ARTBOARD_TOOL = 'export_artboard' as const;

// Reports whether the last export is stale (a frame's HTML changed, or a frame was added or removed); read-only.
export const HANDOFF_STATUS_TOOL = 'handoff_status' as const;

// Positions, sizes, labels, or groups one frame on the stage (writes .cursor-design/canvas.json only).
export const PLACE_FRAME_TOOL = 'place_frame' as const;

// Lists comments from .cursor-design/comments.json with stale / targetMissing flags; read-only.
export const LIST_COMMENTS_TOOL = 'list_comments' as const;

// Reads one comment with stale / targetMissing checked against the artboard on disk; read-only.
export const GET_COMMENT_TOOL = 'get_comment' as const;

// Resolves a comment with the Agent's one-line note, stored as an agent reply.
export const RESOLVE_COMMENT_TOOL = 'resolve_comment' as const;
