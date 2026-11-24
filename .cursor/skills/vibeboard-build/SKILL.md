---
name: vibeboard-build
description: Use when changing how the vibeboard extension is wired - extension host activation, MCP server registration and spawn, the two vp pack bundles, Cursor API types, or the webview chrome build.
---

# Build vibeboard extension

Product constraints: rule 00; MCP / webview contract: rule 02; chrome: rule 08. This skill holds the wiring details those rules do not repeat.

## Before you start

1. Source of truth: rule 00 (code > plan > chat). For product behavior, read the active plan (`blueprint/build-plan.md` names it) and, if needed, the Notion version page via Notion MCP.
2. Context7 for current VS Code webview / MCP docs when unsure. Before webview or CSP HTML work: `npx -y modern-web-guidance@latest search "<use case>"`, then retrieve.

## Host / MCP wiring

- Cursor types: paste `declare module "vscode"` from https://cursor.com/docs/extension-api into `src/types/vscode.cursor.d.ts` **verbatim**. No imports in that file.
- Two `pack` configs (array in `vite.config.ts`), never one config with both entries (shared chunks); both bundle `alwaysBundle` (MCP server package, zod, parse5):
  - host `src/extension.ts` → `dist/extension.js` (plus `deps.neverBundle: ['vscode']`);
  - MCP `src/mcp/server.ts` → `dist/mcp.js`.
- Third bundle (chrome): `vp build -c vite.webview.config.ts` → `dist/webview/chrome.js` + `chrome.css`; `vp pack` does not emit it, `compile` / `package` / `verify` run it after pack.
- Spawn with `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. Env is an explicit allowlist (`ELECTRON_RUN_AS_NODE`, `VIBEBOARD_WORKSPACE_ROOT`, `VIBEBOARD_WORKSPACE_ROOTS`); never spread `process.env`.
- Registration (`registerVibeboardMcp.ts`), feature-detected, never both in one host: Cursor (`vscode.cursor.mcp`) `unregisterServer` then `registerServer` on each sync, dispose unregisters; else VS Code (`lm.registerMcpServerDefinitionProvider`, id `vibeboard` = `contributes.mcpServerDefinitionProviders`) registers one provider per host, and each later sync swaps the launch and fires `onDidChangeMcpServerDefinitions`. Same command / args / env on both paths. `lm` is a named import: lint bans every `.lm` read and every `lm.*` but that one (an aliased or reassigned `lm` slips past it; oxlint's import ban would also flag `import * as vscode`). Never raise `engines.vscode` for it (Cursor must install the extension).
- The MCP server sends `skills/vibeboard/SKILL.md` minus frontmatter as `initialize` `instructions` (`agentInstructions.ts`, also minus the leading managed-file note; `createVibeboardMcpServer(__dirname)` reads it at startup from `dist/..`; `skills/` ships in the `.vsix`; missing file = no instructions, a stderr line).
- The stdio child never writes to stdout (the MCP protocol); log to stderr.

## Chrome build and type gates

- `src/panel/artboardChromeHtml.ts` is only the shell (CSP, `chrome.css`, `chrome.js`, `#svelte-root`).
- `?iife` imports (`scripts/iifeStringPlugin.ts`) inline a TS module as an IIFE string (iframe runtime, stage geometry for `canvas.html`; never hand-copy: rule 05). Registered in the webview build, both `pack` entries and `vp test`. The plugin escapes every `</` as `<\/` and `addWatchFile`s each bundled module so `pnpm watch` rebuilds; lint `import/default` is off because its resolver cannot see the virtual default export (type checking still catches a missing one).
- Type gates: `svelte-check` (tsc does not type-check `.svelte`; Oxlint lints `<script>` blocks), then `tsc -p tsconfig.webview-tests.json` (DOM lib + node types over `src/webview/**/*.test.ts`). `src/webview/tsconfig.json` is solution-style (references both webview configs, no options) so tsrs type-aware lint finds them.
- TypeScript: package `typescript` is `~6.0.3` (svelte-check peer) until `svelte-check` supports TS 7 (then `^7`); lint and type-aware check run TS 7 (tsrs, in vite-plus). If `svelte-check` fails on TS 6, fall back to `svelte-check-native` and record it here; never weaken lint, remove `typeAware` / `typeCheck`, or downgrade.
- `happy-dom` only for pure DOM-helper tests, each marked by a `// @vitest-environment happy-dom` comment; never components or iframe behavior (browser tests).
