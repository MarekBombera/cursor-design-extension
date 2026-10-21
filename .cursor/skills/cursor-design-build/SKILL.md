---
name: cursor-design-build
description: Use when changing how the cursor-design extension is wired - extension host activation, MCP server registration and spawn, the two vp pack bundles, Cursor API types, or the webview chrome build.
---

# Build cursor-design extension

Product constraints are in `.claude/rules/00-cursor-design-core.md`; the MCP / webview contract in `02`. This skill holds the wiring details those rules do not repeat.

## Before you start

1. Fetch the active Notion version page (link in `AGENTS.md`) via Notion MCP when the change touches product behavior.
2. Use Context7 for current VS Code webview / MCP docs when unsure. Before webview or CSP HTML work, run `npx -y modern-web-guidance@latest search "<use case>"` and retrieve.
3. Prove the result with **F5** (Extension Development Host). Confirm `dist/mcp.js` exists first.

## Host / MCP wiring

- Cursor types: paste `declare module "vscode"` from https://cursor.com/docs/extension-api into `src/types/vscode.cursor.d.ts` **verbatim**. No imports in that file.
- MCP package: `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`.
- Two `pack` configs (array in `vite.config.ts`, one entry each): host `src/extension.ts` → `dist/extension.js` (`deps.neverBundle: ['vscode']`); MCP `src/mcp/server.ts` → `dist/mcp.js` (bundle the server package via `deps.alwaysBundle`). Never one config with both entries (shared chunks).
- Spawn with `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. Env is explicit (`ELECTRON_RUN_AS_NODE`, `CURSOR_DESIGN_WORKSPACE_ROOT` only). Do **not** spread `process.env`.
- `unregisterServer` then `registerServer` on activate; dispose unregisters. Stdio child: never write to stdout (it is the MCP protocol); log to stderr.
- Keep tools allowlist-friendly; editing `.cursor-design/**` directly remains the fallback when MCP is denied.

## Webview chrome

- Chrome = Svelte 5 + Vite (no Kit), see `08-svelte-chrome` (Svelte MCP docs before writing, `svelte-autofixer` after every edit, `svelte-check` in Verify). Today it is inlined JS from `src/panel/artboardChrome*.ts`.
- Artboard = nested sandboxed iframe (`allow-scripts`), never chrome-themed, never `{@html}` in chrome.
