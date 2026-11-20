---
description: MCP tools, disk layout and lock, webview CSP and message invariants
globs: src/**,package.json
paths:
  - src/**
  - package.json
alwaysApply: false
---

# MCP + webview contracts

## MCP tools (v1), no open_artboard

- `set_artboard`: create / init; may set active and open the panel
- `update_artboard`: requires `baseGeneration` and/or `baseHash`; conflict on mismatch
- `read_artboard` / `list_artboards` / `set_active_artboard`
- `export_artboard`: every frame to `handoff/<exportId>/`; takes no `artboardId`
- `handoff_status`: stale when a frame's HTML changed or a frame was added or removed since the last export
- `place_frame`: one frame's x / y / width / label / group in `canvas.json`; returns every frame
- `list_comments({status})`: default every unresolved; `stale` / `targetMissing` (`null` = unchecked), `replyCount` instead of `replies`
- `get_comment(id)`: one comment with replies, flags checked against disk
- `resolve_comment(id, note)`: resolve after changing the target; `note` is stored as an agent reply

Changing a tool, its args, an Agent-visible error code, an artboard runtime limit or either CSP updates the shipped Agent skill `skills/cursor-design/SKILL.md` in the same change (`src/mcp/agentSkill.test.ts` guards names, codes and frame width; `syncAgentSkill` copies it to `~/.cursor/skills/` on activate).

## Disk and lock

`.cursor-design/`: `manifest.json`, `canvas.json`, `comments.json`, `artboards/<id>.html`, optional meta, `assets/`, `tokens.json`, `handoff/<exportId>/`. Multi-artboard, one active, no gallery. Users gitignore it.

- MCP serializes its writes (`enqueueDiskOp`). Every `canvas.json` / `comments.json` read-modify-write, `updateArtboard`'s HTML + meta read-compare-write and the export tail (meta refresh + manifest write, after a re-read) run under the cross-process `withWorkspaceLock` (`.cursor-design/.lock`, `WORKSPACE_BUSY` after 2 s), shared by MCP and the panel.
- The lock is not re-entrant: never call a disk-lib function that takes it (`updateArtboard`, `editArtboard`, `exportArtboard`, `placeFrame`, `addComment`, `replyToComment`, `setCommentStatus`, `markCommentsSent`, `resolveComment`) inside `withWorkspaceLock`.
- MCP denied: edit `.cursor-design/**` directly; tell the user to allowlist the tools.

## Webview CSP and messages

1. Never eval artboard HTML in parent chrome.
2. Nested iframe `sandbox="allow-scripts"`; artboard JS is required. The blob frame inherits the chrome CSP, so `stampArtboardHtml` puts the chrome nonce on every artboard script and style, and adds `FRAME_CSP` (inline only, no sources) first in head (after the artboard's meta charset, which moves up): a nonce'd `<script src>`, including one a script injects with the nonce it read at runtime, never loads. The chrome CSP allows style attributes (`style-src-attr 'unsafe-inline'`); inline `on*` handlers stay blocked.
3. Iframe-to-chrome `postMessage` is untrusted.
4. `asWebviewUri` + `localResourceRoots`.
5. Message invariants. Shapes and per-message rules: `src/webview/hostMessages.ts`, `src/webview/frame/frameMessages.ts` and the "Message contract (shipped)" table in `blueprint/context/system-map.md`, which is the normative contract.
   - Chrome to host is untrusted: parsed by `parseChromeMessage`, refused in untrusted workspaces. Each attempt with a valid `requestId` is answered once, never replayed.
   - Host to chrome state (canvas, status, comments) is held until `artboard:ready` and re-sent on a webview reload.
   - Frame to chrome is allowlisted by source window and typed (`parseFrameMessage`). The runtime accepts chrome to frame only from the parent it captured at load (`parseChromeFrameMessage`).
   - The tagged frame copy (`data-cd-src="N"`, `sourceTags.ts`) never reaches disk, export, comment flags or `read_artboard`; frame `hash` is `hashHtml` of the disk HTML, never the tagged copy.
   - Copy for Agent writes `vscode.env.clipboard` before `markCommentsSent`: a failed write marks nothing sent.
   - Undo / redo writes only bytes the host's history holds, never HTML from the chrome. `cd:key` undo / redo counts only in Edit mode, from the history frame while it holds focus.
6. A design's own script can post any cd:* message. Chrome renders frame data as text or geometry only (never `{@html}`). cd:pick text fields are capped (`layout.ts`) and free of control characters and line separators, except Edit mode's `edit.text` and `edit.style` (the page's own source text, shown only as field values, never put in an Agent prompt); style keys come from `COMMENT_STYLE_KEYS` and values allow only letters and digits in any script, `_`, space and `#%.,()'"/+-`. `comments.json` reuses them on parse and add. Anything bound for an Agent prompt is sanitized again first (`commentPrompt`).

## Stack

- Host: TS + `vp pack` (tsdown)
- Chrome: Svelte 5 + Vite (no Kit)
- MCP: `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk` (lint)
