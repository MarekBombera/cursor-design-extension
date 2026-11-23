---
description: MCP tools, disk layout and lock, webview CSP and message invariants
globs: src/**,package.json
paths:
  - src/**
  - package.json
alwaysApply: false
---

# MCP + webview contracts

## MCP tools

Names: `src/mcp/toolNames.ts`; Agent-facing contract: shipped `skills/cursor-design/SKILL.md` (sync rule: `AGENTS.md`). Non-obvious facts:

- No `open_artboard`: `set_artboard` creates and may set active and open the panel.
- `update_artboard` requires `baseGeneration` or `baseHash`; mismatch is a conflict. `read_artboard` defaults to the active artboard.
- `export_artboard` writes every frame to `handoff/<exportId>/` and takes no `artboardId` (a stray one is rejected). `handoff_status` is stale when a frame's HTML changed or a frame was added or removed since the last export.
- `place_frame` returns every frame. `list_comments` defaults to every unresolved comment and returns `replyCount`, not `replies` (`targetMissing: null` = unchecked); `get_comment` has replies, flags checked against disk; `resolve_comment`'s `note` is stored as an agent reply.

## Disk and lock

`.cursor-design/`: `project.json` (version 1: `openPageId`, `pages`); `pages/<pageId>/` with `manifest.json`, `canvas.json`, `comments.json`, `artboards/<id>.html` + optional meta; `artboards`, a tombstone FILE (never a directory) so a stale 0.4 MCP fails instead of writing; and at the root `handoff/<exportId>/`, `tokens.json`, `assets/`, `.lock`, `.ensure-panel`. Multi-artboard per page, one active, no gallery. Users gitignore it.

- Every MCP handler and host entry point calls `resolveOpenPage` (`src/disk/openPage.ts`) once per call, after the trust check, and passes the `PageLocation` down; never re-resolve inside an op. It migrates a 0.4 root layout into `pages/page-1/` (resumable, never overwrites; `MIGRATION_CONFLICT` when both copies exist), rebuilds a lost `project.json` from the page folders, and creates a fresh project only with `createIfFresh` (`set_artboard`, Open Artboard). Per-page paths come from the `pageId` builders in `layout.ts`; root files take `page.workspaceRoot`. Panel requests resolve through `resolveRequestedPage` instead: it calls `resolveOpenPage` once, then checks the requested id is indexed with a folder.
- MCP serializes its writes (`enqueueDiskOp`). Every `canvas.json` / `comments.json` read-modify-write, `updateArtboard`'s HTML + meta read-compare-write and the export tail (meta refresh + manifest write, after a re-read) run under the cross-process `withWorkspaceLock` (`.cursor-design/.lock`, `WORKSPACE_BUSY` after 2 s), shared by MCP and the panel.
- The lock is not re-entrant: never call a disk-lib function that takes it (`resolveOpenPage`, `resolveRequestedPage`, `updateArtboard`, `editArtboard`, `exportArtboard`, `placeFrame`, `addComment`, `replyToComment`, `setCommentStatus`, `markCommentsSent`, `resolveComment`) inside `withWorkspaceLock`.
- MCP denied: edit `.cursor-design/pages/<openPageId>/**` directly; tell the user to allowlist the tools. No `project.json` yet: the user opens the panel once to migrate; never create `pages/` or `project.json` by hand.

## Webview CSP and messages

Before CSP or webview work: `npx -y modern-web-guidance@latest search "<use case>"`, then retrieve.

1. Never eval artboard HTML in parent chrome.
2. Nested iframe `sandbox="allow-scripts"`; artboard JS is required. The blob frame inherits the chrome CSP, so `stampArtboardHtml` puts the chrome nonce on every artboard script and style, and adds `FRAME_CSP` (inline only, no sources) first in head (after the artboard's meta charset, which moves up): a nonce'd `<script src>`, including one a script injects with the nonce it read at runtime, never loads. The chrome CSP allows style attributes (`style-src-attr 'unsafe-inline'`); inline `on*` handlers stay blocked.
3. Iframe-to-chrome `postMessage` is untrusted.
4. `asWebviewUri` + `localResourceRoots`.
5. Message invariants. Shapes and per-message rules: `src/webview/hostMessages.ts`, `src/webview/frame/frameMessages.ts` and the "Message contract (shipped)" table in `blueprint/context/system-map.md`, which is the normative contract.
   - Chrome to host is untrusted: parsed by `parseChromeMessage`. Each attempt with a valid `requestId` is answered once, never replayed.
   - Page-bound chrome requests carry `pageId`. The host acts on that page via `resolveRequestedPage`, never the page open now.
   - Host to chrome state (canvas, status, comments) is held until `artboard:ready` and re-sent on a webview reload.
   - Frame to chrome is allowlisted by source window and typed (`parseFrameMessage`). The runtime accepts chrome to frame only from the parent it captured at load (`parseChromeFrameMessage`).
   - The tagged frame copy (`data-cd-src="N"`, `sourceTags.ts`) never reaches disk, export, comment flags or `read_artboard`; frame `hash` is `hashHtml` of the disk HTML, never the tagged copy.
   - Copy for Agent writes `vscode.env.clipboard` before `markCommentsSent`: a failed write marks nothing sent.
   - Undo / redo writes only bytes the host's history holds, never HTML from the chrome. `cd:key` undo / redo counts only in Edit mode, from the history frame while it holds focus.
6. A design's own script can post any cd:* message. Chrome renders frame data as text or geometry only, never `{@html}`. cd:pick fields are capped and charset-checked (caps in `layout.ts`, checks in `frameMessages.ts`; `comments.json` reuses them); Edit mode's `edit.*` fields are shown only as field values and placeholders, never put in an Agent prompt. Anything bound for an Agent prompt is sanitized again first (`commentPrompt`, `toOneLine`).
