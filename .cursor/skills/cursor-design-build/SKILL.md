---
name: cursor-design-build
description: Use when implementing or scaffolding the cursor-design VS Code/Cursor extension (webview, MCP server, phases 0–4).
---

# Build cursor-design extension

## Steps

1. Fetch Notion spec via Notion MCP: https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4
2. Confirm phase gate you are targeting (0–4). Do not skip gates.
3. For Cursor MCP registration use **only** `vscode.cursor.mcp.registerServer` with stdio. Never `vscode.lm.registerMcpServerDefinitionProvider`.
4. Webview chrome = Svelte 5 + Vite; artboard = nested sandboxed iframe with scripts allowed.
5. Before webview/CSP HTML work: `npx -y modern-web-guidance@latest search "<use case>"` then retrieve.
6. Use Context7 for current VS Code webview / MCP docs when unsure.
7. Verify with **F5** Extension Development Host in Cursor.
8. Keep tools allowlist-friendly; disk under `.cursor-design/` remains fallback if MCP is denied.
9. Do not add in-panel chat, Next.js, CustomTextEditor, or Grok Build messaging in v1.

## Host / MCP wiring

- Cursor types: paste `declare module "vscode"` from https://cursor.com/docs/extension-api into `src/types/vscode.cursor.d.ts` **verbatim**. No imports in that file.
- MCP package: `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`.
- Two `esbuild.context()` builds (two `outfile`s): host `src/extension.ts` → `dist/extension.js` (`external: ['vscode']`); MCP `src/mcp/server.ts` → `dist/mcp.js` (bundle the server package). Never `entryPoints: [a, b]` + one `outfile`.
- Spawn with `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. Env is explicit (`ELECTRON_RUN_AS_NODE`, `CURSOR_DESIGN_WORKSPACE_ROOT` only). Do **not** spread `process.env`.
- `unregisterServer` then `registerServer` on activate; dispose unregisters. Stdio child: never `console.log` (stdout is MCP).
