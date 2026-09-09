# cursor-design - Project Overview

<!-- blueprint:source-hash 09852ad5cf3417f25bf416ec9637db1901d48336a803b4ba975a7b8d1bb81bac -->

> Agent-driven live HTML artboard inside Cursor: WebviewPanel chrome, nested iframe, local MCP, disk SoT under `.cursor-design/`.

Coding SoT remains `.cursor/rules/` (00-07) and skills `cursor-design-build` / `cursor-design-agent-loop`. Notion spec: https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4

## Problem

Cursor has no Claude Design-style live canvas. Design talk stays in chat; the human cannot watch HTML pixels change while the Agent iterates, then hand off implementable markup into a real repo. cursor-design is that loop: prompt, live artboard, export, implement. The extension never calls models.

## Users

- **People using Cursor** who want a live HTML artboard the Agent can iterate, then export into a real repo.
- **Cursor Agent** creating and iterating artboards via MCP, or `.cursor-design/**` files if MCP is denied.
- **A second Agent session** implementing from handoff (`IMPLEMENT.md` + HTML/CSS/JS), not screenshots.

No accounts or access tiers in v1.

## Features

MVP map in build-plan order. Headline: live Agent -> artboard -> export -> implement.

1. **Phase 0 Bootstrap** - F5 Extension Host, empty Artboard panel, `registerServer` on activate, no CSP errors.
2. **Phase 1 Disk to pixels** - `.cursor-design/` HTML save refreshes the nested iframe (~200ms); generation bumps.
3. **Phase 2 MCP loop** - `set_artboard`, `update_artboard` (requires `baseGeneration`), `read_artboard`, `list_artboards`, `set_active_artboard`; conflict path; MCP-offline banner.
4. **Phase 3 Export** - `export_artboard` + `handoff_status` stale mark; `IMPLEMENT.md` usable; demo = hero+CTA into Vite + plain HTML.
5. **Phase 4 Release polish** - MIT, screenshots, honest limits.

**v1 non-goals:** in-panel chat, `vscode.lm` / external model keys, Next.js / TanStack Start / SvelteKit / Chrome extension, CustomTextEditor, OS auxiliary window, gallery UI, Grok Build messaging, MCP writing production app source.

## Data model

No database. Gitignored workspace folder `.cursor-design/`.

### Manifest (`manifest.json`)

- `version` (number)
- `activeArtboardId` (string)
- `workspaceFolder` (string)
- `updatedAt` (ISO timestamp)
- `lastExport` (`exportId`, `artboardId`, `artboardHash`, `exportedAt`) or absent

One active artboard. Panel always shows `activeArtboardId`. No gallery.

### Artboard

- `artboards/<id>.html` - full HTML document (the pixels)
- optional `artboards/<id>.meta.json` - `id`, `title`, `generation` (monotonic), `hash`, `viewport`, `updatedAt`

`update_artboard` requires `baseGeneration` (or `baseHash`). Mismatch -> conflict; Agent re-reads then retries. MCP serializes writes per artboard id.

### Handoff

- `handoff/<exportId>/` including `IMPLEMENT.md` (`artboardId`, `artboardHash`, `exportedAt`, `exportId`)
- If active hash != last export hash -> `stale: true`; do not delete the old handoff
- Also: `assets/`, stub `tokens.json`

## Tech stack

- **Host** - TypeScript + esbuild Cursor/VS Code extension. `vscode.cursor.mcp.registerServer` stdio. Never `vscode.lm.registerMcpServerDefinitionProvider`.
- **Chrome** - Svelte 5 + Vite (no Kit). `var(--vscode-*)` tokens.
- **Artboard** - nested iframe, `sandbox="allow-scripts"`. Parent never `eval`s artboard HTML.
- **MCP** - `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`. Outfiles: `dist/extension.js`, `dist/mcp.js`.
- **State** - disk `.cursor-design/` is SoT. Brain = Cursor Agent only. Brand: `cursor-design`.
- **Tooling** - `pnpm`, oxlint, oxfmt. UI verify = F5 (`fixtures/dev-workspace`).

Notion still mentions `@modelcontextprotocol/sdk`; this repo and `.cursor/rules/02-mcp-webview.mdc` lock v2 `@modelcontextprotocol/server`. Follow the repo.

## Monetization

Not in v1. MIT open-source core. Paid kits only if traction, later.

## UI/UX

Panel-only. Chat stays in Cursor Agent.

- **Open Artboard** - empty or active artboard chrome + iframe
- Chrome badges - active id, generation, handoff stale, MCP unavailable (still render disk)
- **Reveal Design Folder** / **Export Handoff**
- Artboard HTML is user/Agent content, not chrome-themed
- Variants = new ids + `set_active_artboard`, not a gallery

## Deployment

VS Code/Cursor extension, not a web host.

- Develop: `pnpm compile` or `pnpm watch`, then **F5**. Confirm `dist/mcp.js` before MCP tests.
- Package: `pnpm package` -> `.vsix`
- No start command, health path, database, or model API keys
- Blueprint `/release` Vercel/Render is not the v1 ship path
