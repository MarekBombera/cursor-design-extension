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

Serialize writes (`enqueueDiskOp`). The `canvas.json` read-modify-write also runs under the cross-process `withWorkspaceLock` (`.cursor-design/.lock`), shared with the panel's drag commit. MCP denied: edit `.cursor-design/**` directly and tell the user to allowlist the tools.

## Disk (user workspace)

`.cursor-design/`: `manifest.json`, `canvas.json`, `artboards/<id>.html`, optional meta, `assets/`, `tokens.json`, `handoff/<exportId>/`. Multi-artboard + one active. No gallery. Users gitignore `.cursor-design/`.

## Webview CSP and messages

1. Never eval artboard HTML in parent chrome.
2. Nested iframe `sandbox="allow-scripts"`; artboard JS is required.
3. Iframe-to-chrome `postMessage` is untrusted.
4. `asWebviewUri` + `localResourceRoots`.
5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: `parseChromeMessage`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure); canvas:updated (frames carry `generation`)|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed (`parseFrameMessage`): cd:frame-height { height }, cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y }, cd:ready, cd:hover { rect|null }, cd:pick { tagName, rect|null, isPage } (frame-local CSS px; chrome drops cd:hover and cd:pick outside Comment mode). Chrome → iframe (runtime accepts only from the parent it captured at load, `parseChromeFrameMessage`): cd:mode { mode: interact|comment }, cd:pick-parent, cd:pick-child.
6. A design's own script can post any cd:* message. Chrome renders frame data as text or geometry only (never `{@html}`), and anything that will reach an Agent prompt is sanitized first (8h `commentPrompt`).

## Stack

- Host: TS + `vp pack` (tsdown)
- Chrome: Svelte 5 + Vite (no Kit)
- MCP: `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk` (lint)
