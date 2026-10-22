# Project Plan

Product SoT is the Notion spec and `.claude/rules/`. This plan is the Blueprint-owned distill, not a second product spec. Do not invent features outside that spec.

Spec: https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4

## 1. Problem - What problem are we solving?

Cursor has no Claude Design-style live HTML artboard. Design talk stays in chat; the human cannot watch pixels change while the Agent iterates, then hand off implementable HTML into the real repo.

**cursor-design** is that canvas inside Cursor: describe, live artboard, iterate via Agent, export a handoff, implement. Runtime is Cursor Agent + local MCP + this extension only. The extension never calls models.

## 2. Users - Who is this for?

- **People using Cursor** who want a live HTML artboard the Agent can iterate in the editor, then export into a real repo.
- **Cursor Agent** implementing and iterating artboards through MCP (or disk files if MCP is denied).
- **A second Agent session** implementing from the export handoff (`IMPLEMENT.md` + HTML/CSS/JS), not from screenshots.

Open-source (MIT). Not a multi-tenant SaaS. No accounts in v1.

## 3. Features - What does the MVP need?

Match build phases in Notion section 12:

- Empty Artboard WebviewPanel + MCP `registerServer` on activate (Phase 0).
- Disk `.cursor-design/` as SoT; file saves refresh the nested iframe; generation bumps (Phase 1).
- MCP tools: `set_artboard`, `update_artboard` (requires `baseGeneration`), `read_artboard`, `list_artboards`, `set_active_artboard`; conflict path; MCP-offline banner (Phase 2).
- `export_artboard` + `handoff_status` stale mark; usable `IMPLEMENT.md` (Phase 3).
- Release polish: MIT, honest limits (Phase 4).

Shipped demo: Agent designs a landing hero+CTA on the artboard, export, then implement that section into a tiny Vite + plain HTML sample. Handoff is HTML+CSS+JS.

**0.2 Multi-frame canvas** (Notion 0.2 page, rewritten 2026-10-13: https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e): the panel is one Figma-style stage. The stage holds many frames; each frame is its own artboard file at a fixed width, rendered at full page height in its own sandboxed blob iframe (no inner scroll). Zoom, pan, or panel resize never reflows a frame, so a fixed header sticks to its frame's top. Pan/zoom is a CSSOM `translate(x,y) scale(z)` on the stage layer (origin `0 0`). Pinch / ctrl+wheel zooms around the cursor; plain wheel and drag on empty stage pan; scroll boxes inside a design scroll first. Frames forward wheel/pinch to chrome as typed allowlisted messages and report height with `cd:frame-height`, so the stage moves with the cursor over a frame and frames stay clickable. Zoom presets, fit-all, and a persisted view. Chrome draws frame labels and group headings above frames; broken frames show an error tile. The Agent places frames through MCP `place_frame`. One active artboard stays (badge, stage highlight, `set_active_artboard`). Export covers the whole canvas: every frame's pristine `index.html` (HTML+CSS+JS inline) in a folder per group, one `IMPLEMENT.md` index, and a view-only `canvas.html` that lays the frames out like the stage; `handoff_status` is stale when any frame changed since export. Canvas code is injected at blob-build only, never written to disk; export asserts pristine HTML. This replaces the earlier single-frame in-iframe zoom plan (decided 2026-10-13); shipped 6a (blob inject) carries forward. 0.2 out of scope: Edit mode, layers, inspector, click-to-edit, dragging/resizing frames by hand, frame list or sidebar, comments, drawing, multiplayer, GrapesJS/Webstudio, repo design-system import.

**v1 non-goals:** in-extension chat, `vscode.lm` / external model keys, Next.js / TanStack Start / SvelteKit / Chrome extension, CustomTextEditor, OS auxiliary window, gallery UI, Grok Build messaging, MCP auto-writing production app source.

## 4. Data - What are we storing?

No database. User-workspace disk under `.cursor-design/` (gitignored by default):

- `manifest.json` - `version`, `activeArtboardId`, `workspaceFolder`, `updatedAt`, `lastExport` (0.2 adds `lastExport.frames: [{ artboardId, artboardHash }]`, additive, manifest stays version 1)
- `artboards/<id>.html` - full HTML document
- optional `artboards/<id>.meta.json` - `id`, `title`, `generation`, `hash`, `viewport`, `updatedAt`
- `canvas.json` (0.2) - `{ version: 1, frames: [{ id, label, x, y, width, group? }] }`. `id` matches `artboards/<id>.html`; width default 1280, clamped 120–3840 by `place_frame`; height is never stored (it comes from rendered content). A frame missing from `canvas.json` is auto-placed right of the last frame with a 24px gap. Stage view (zoom, pan) is chrome state, not design data.
- `assets/`, stub `tokens.json`, `handoff/<exportId>/` including `IMPLEMENT.md`. 0.2 layout: `IMPLEMENT.md` (index of groups and frames), `canvas.html` (view-only layout preview), `<group-slug>/<frame-id>/index.html` per frame (`ungrouped/` when no group; colliding slugs get a numeric suffix), `tokens.json`

Multi-artboard, one active. No gallery. MCP serializes writes per artboard id.

## 5. Tech - What stack are we using?

- **Product:** Cursor/VS Code extension (WebviewPanel + local MCP stdio). Not a Next.js app, not SvelteKit, not a Chrome extension.
- **Host:** TypeScript, `pnpm`. Bundler esbuild through 0.2; from 0.2.1 Vite+ (`vp check` / `vp test` on Vitest / `vp pack` on tsdown), with esbuild kept for the bundle only if the 0.2.1 pack spike fails. `vscode.cursor.mcp.registerServer` (stdio). Never `vscode.lm.registerMcpServerDefinitionProvider`.
- **Chrome:** Svelte 5 + Vite under `src/webview/` from 0.3 (8b); shell in `src/panel/artboardChromeHtml.ts`. Through 0.2 it was a TS template-string document (decided 2026-10-13). Theme tokens `var(--vscode-*)`.
- **Artboard:** nested sandboxed HTML iframe (`sandbox="allow-scripts"`). Scripts allowed; parent never `eval`s artboard HTML.
- **MCP:** `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`. Two esbuild outfiles: `dist/extension.js` and `dist/mcp.js`.
- **Brain:** Cursor Agent only. Disk is SoT. Brand: `cursor-design`.
- **Verify:** F5 Extension Development Host (`fixtures/dev-workspace`), plus `pnpm check-types` / `pnpm lint` / `pnpm compile`. From 0.2.1: one Verify command (check, test, pack) run locally and by GitHub CI on push/PR; the `@vscode/test-electron` suite stays out of CI.
- **Coding SoT:** `.claude/rules/` (00, 02-09), skills `cursor-design-build` and `cursor-design-agent-loop`.

## 6. Monetize - How will this make money?

Not in v1. MIT open-source core. Paid kits only if traction, later.

## 7. UI/UX - How should this look and feel?

Panel-only MVP. No in-panel chat (chat stays in Cursor Agent).

Chrome: active artboard id, generation badge, handoff-stale badge, MCP-unavailable banner (still show disk artboard), Reveal / Export actions. Commands: Open Artboard, Reveal Design Folder, Export Handoff.

Artboard HTML is user/Agent content, not themed as chrome. No gallery. Variants are new ids + `set_active_artboard`.

0.2: default mode is Interact (no Edit chrome). The panel is a stage: frames at their own positions and fixed widths, full page height, with a chrome label above each and one heading per `group`. Toolbar has zoom presets and fit-all. No frame list or sidebar. A broken frame shows an error tile and never breaks the stage.

## 8. Deployment - Where and how will this ship?

This is a VS Code/Cursor extension, not a Vercel/Render web app.

- Develop: `pnpm compile` or `pnpm watch`, then **F5** (Extension Development Host opens `fixtures/dev-workspace`). Confirm `dist/mcp.js` exists before testing MCP.
- Package: `pnpm package` -> `.vsix`.
- No app start command, no health check path, no database, no env API keys.
- `/release` Render/Vercel is not the v1 ship path.
