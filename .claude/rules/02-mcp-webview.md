---
description: MCP tool contract, artboard disk layout, webview CSP and message contract
globs: src/**,package.json
paths:
  - src/**
  - package.json
alwaysApply: false
---

# MCP + webview contracts

## MCP tools (v1), no open_artboard

- `set_artboard`: create/init; may set active / open panel
- `update_artboard`: requires `baseGeneration`; conflict on mismatch
- `read_artboard` / `list_artboards` / `set_active_artboard`
- `export_artboard`: exports every frame to `handoff/<exportId>/` (IMPLEMENT.md, canvas.html, tokens.json, `<group>/<id>/index.html`); takes no `artboardId`
- `handoff_status`: stale when any frame's HTML changed or a frame was added or removed since the last export
- `place_frame`: one frame's x / y / width / label / group in `canvas.json`; returns every frame
- `list_comments({status})`: comments from `comments.json` with `stale` / `targetMissing` (`null` = unchecked) and `replyCount` instead of `replies`; omitted status is every unresolved comment
- `get_comment(id)`: one comment, with its replies and those flags checked against the artboard on disk
- `resolve_comment(id, note)`: resolve after changing the target; `note` is stored as an agent reply

The shipped Agent skill `skills/cursor-design/SKILL.md` documents the MCP tools, Agent-visible error codes, artboard runtime limits and workflows; changing any of them updates the skill in the same change. `src/mcp/agentSkill.test.ts` fails on tool-name, error-code and frame-width drift. The extension copies it to `~/.cursor/skills/cursor-design/` on activate (`syncAgentSkill`).

Serialize writes (`enqueueDiskOp`). `canvas.json` and `comments.json` read-modify-writes run under the cross-process `withWorkspaceLock` (`.cursor-design/.lock`), shared with the panel's drag commit. MCP denied: edit `.cursor-design/**` directly and tell the user to allowlist the tools.

## Disk (user workspace)

`.cursor-design/`: `manifest.json`, `canvas.json`, `comments.json`, `artboards/<id>.html`, optional meta, `assets/`, `tokens.json`, `handoff/<exportId>/`. Multi-artboard + one active. No gallery. Users gitignore `.cursor-design/`.

## Webview CSP and messages

1. Never eval artboard HTML in parent chrome.
2. Nested iframe `sandbox="allow-scripts"`; artboard JS is required. The blob frame inherits the chrome CSP, so `stampArtboardHtml` puts the chrome nonce on every artboard script and style, and adds `FRAME_CSP` (inline only, no sources) first in head: a nonce'd `<script src>`, or one artboard JS injects with the nonce it read, never loads. Changing either policy updates the shipped Agent skill.
3. Iframe-to-chrome `postMessage` is untrusted.
4. `asWebviewUri` + `localResourceRoots`.
5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: `parseChromeMessage`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure); canvas:updated (frames carry `generation`)|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed (`parseFrameMessage`): cd:frame-height { height }, cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y }, cd:ready, cd:hover { rect|null }, cd:pick { selector|null, tagName, text, rect|null, point, styles, isPage } (`rect` is frame-local CSS px; `point` is CSS px relative to the current target's border box; chrome drops cd:hover and cd:pick outside Comment mode). Chrome → iframe (runtime accepts only from the parent it captured at load, `parseChromeFrameMessage`): cd:mode { mode: interact|comment }, cd:pick-parent, cd:pick-child.
6. A design's own script can post any cd:* message. Chrome renders frame data as text or geometry only (never `{@html}`). cd:pick text fields are capped (`layout.ts`) and free of control characters and line separators; style keys come from `COMMENT_STYLE_KEYS` and values allow only letters and digits in any script, `_`, space and `#%.,()'"/+-`. `comments.json` reuses those same guards on parse and on add. Anything that will reach an Agent prompt is sanitized again first (8h `commentPrompt`).

## Stack

- Host: TS + `vp pack` (tsdown)
- Chrome: Svelte 5 + Vite (no Kit)
- MCP: `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk` (lint)
