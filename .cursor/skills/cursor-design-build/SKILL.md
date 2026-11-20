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
- Third bundle (webview chrome): `vp build -c vite.webview.config.ts` → `dist/webview/chrome.js` + `dist/webview/chrome.css`. `vp pack` does not emit this; `compile` / `package` / `verify` run the webview build after pack.
- Spawn with `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. Env is explicit (`ELECTRON_RUN_AS_NODE`, `CURSOR_DESIGN_WORKSPACE_ROOT`, `CURSOR_DESIGN_WORKSPACE_ROOTS` only). Do **not** spread `process.env`.
- `unregisterServer` then `registerServer` on activate; dispose unregisters. Stdio child: never write to stdout (it is the MCP protocol); log to stderr.
- Keep tools allowlist-friendly; editing `.cursor-design/**` directly remains the fallback when MCP is denied.

## Webview chrome

- Chrome = Svelte 5 + Vite (no Kit), see `08-svelte-chrome` (Svelte MCP docs before writing, `svelte-autofixer` after every edit, `svelte-check` in Verify). The chrome lives in `src/webview/` (from 0.3, 8b); `src/panel/artboardChromeHtml.ts` is only the shell (CSP, `chrome.css`, `chrome.js`, `#svelte-root`).
- `?iife` imports (`scripts/iifeStringPlugin.ts`) inline a TS module as an IIFE string: the iframe runtime (`src/webview/frame/runtime.ts`) and the stage geometry for the exported `canvas.html`. The plugin is registered in the webview build, both `pack` entries and `vp test`.
- Styling: one global `src/webview/ui/theme.css` (the only reader of `--vscode-*`), imported first in `main.ts` so it precedes every component style in `chrome.css`, typed by `src/types/css.d.ts`. `src/webview/ui/theme.test.ts` guards it in `vp test`; `pnpm test:browser` runs under Cursor's theme (`vscodeHost`), and `pnpm gallery` gives look and contrast evidence (local only). Rules 08 and 09.
- Artboard = nested sandboxed iframe (`allow-scripts`), never chrome-themed, never `{@html}` in chrome.
- Type gates: `svelte-check` (tsc does not type-check `.svelte`; Oxlint lints `<script>` blocks), then `tsc -p tsconfig.webview-tests.json` (DOM lib + node types over `src/webview/**/*.test.ts`). `src/webview/tsconfig.json` is solution-style (references both webview configs, no options) so tsrs type-aware lint finds them.
- `typescript` is `~6.0.3` only until `svelte-check` supports TS 7 (then `^7`). If `svelte-check` fails on TS 6, fall back to `svelte-check-native` and record it here; never weaken lint, remove `typeAware` / `typeCheck`, or downgrade.
- `?iife` plugin: escapes every `</` as `<\/`, `addWatchFile`s each bundled module so `pnpm watch` rebuilds; lint `import/default` is off because its resolver cannot see the virtual default export (type checking still catches a missing one).
- `happy-dom` (`// @vitest-environment happy-dom`) is only for pure DOM helper tests (`stampArtboardHtml.test.ts`, `frame/selector.test.ts`, `frame/selectorMatch.oracle.test.ts`, `frame/commentTarget.roundtrip.test.ts`), never components or iframe behavior (browser tests).
