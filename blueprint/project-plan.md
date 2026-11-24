# Project Plan

Product SoT is the Notion spec and `.claude/rules/`. This plan is the Blueprint-owned distill, not a second product spec. Do not invent features outside that spec.

Spec: https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4

## 1. Problem - What problem are we solving?

Cursor has no Claude Design-style live HTML artboard. Design talk stays in chat; the human cannot watch pixels change while the Agent iterates, then hand off implementable HTML into the real repo.

**vibeboard** is that canvas inside Cursor: describe, live artboard, iterate via Agent, export a handoff, implement. Runtime is the user's MCP-capable agent (Cursor Agent, Copilot, Claude Code, Codex, ...) + local MCP + this extension only. The extension never calls models.

## 2. Users - Who is this for?

- **People using Cursor** who want a live HTML artboard the Agent can iterate in the editor, then export into a real repo.
- **The user's agent** (Cursor Agent, Copilot, Claude Code, Codex, any MCP-capable agent) implementing and iterating artboards through MCP (or disk files if MCP is denied).
- **A second Agent session** implementing from the export handoff (`IMPLEMENT.md` + HTML/CSS/JS), not from screenshots.

Open-source (MIT). Not a multi-tenant SaaS. No accounts in v1.

## 3. Features - What does the MVP need?

Match build phases in Notion section 12:

- Empty Artboard WebviewPanel + MCP `registerServer` on activate (Phase 0).
- Disk `.vibeboard/` as SoT; file saves refresh the nested iframe; generation bumps (Phase 1).
- MCP tools: `set_artboard`, `update_artboard` (requires `baseGeneration`), `read_artboard`, `list_artboards`, `set_active_artboard`; conflict path; MCP-offline banner (Phase 2).
- `export_artboard` + `handoff_status` stale mark; usable `IMPLEMENT.md` (Phase 3).
- Release polish: MIT, honest limits (Phase 4).

Shipped demo: Agent designs a landing hero+CTA on the artboard, export, then implement that section into a tiny Vite + plain HTML sample. Handoff is HTML+CSS+JS.

**0.2 Multi-frame canvas** (Notion 0.2 page, rewritten 2026-10-13: https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e): the panel is one Figma-style stage. The stage holds many frames; each frame is its own artboard file at a fixed width, rendered at full page height in its own sandboxed blob iframe (no inner scroll). Zoom, pan, or panel resize never reflows a frame, so a fixed header sticks to its frame's top. Pan/zoom is a CSSOM `translate(x,y) scale(z)` on the stage layer (origin `0 0`). Pinch / ctrl+wheel zooms around the cursor; plain wheel and drag on empty stage pan; scroll boxes inside a design scroll first. Frames forward wheel/pinch to chrome as typed allowlisted messages and report height with `cd:frame-height`, so the stage moves with the cursor over a frame and frames stay clickable. Zoom presets, fit-all, and a persisted view. Chrome draws frame labels and group headings above frames; broken frames show an error tile. The Agent places frames through MCP `place_frame`. One active artboard stays (badge, stage highlight, `set_active_artboard`). Export covers the whole canvas: every frame's pristine `index.html` (HTML+CSS+JS inline) in a folder per group, one `IMPLEMENT.md` index, and a view-only `canvas.html` that lays the frames out like the stage; `handoff_status` is stale when any frame changed since export. Canvas code is injected at blob-build only, never written to disk; export asserts pristine HTML. This replaces the earlier single-frame in-iframe zoom plan (decided 2026-10-13); shipped 6a (blob inject) carries forward. 0.2 out of scope: Edit mode, layers, inspector, click-to-edit, dragging/resizing frames by hand, frame list or sidebar, comments, drawing, multiplayer, GrapesJS/Webstudio, repo design-system import.

**0.4 Edit-lite** (Notion 0.4 page, decisions 2026-11-18 and 2026-11-19: https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d): an Edit mode next to Interact (default) and Comment. Click an element in a frame and change its text, font size, colour, padding or margin in a small in-house inspector; the save changes only that element's text or one inline style declaration in `artboards/<id>.html`, and every other byte stays the same. Elements are found through `data-cd-src` source numbers the host adds to the frame copy only. Inline styles only; text only on plain-text elements. Undo/redo (20 per frame per panel session). Comments on an edited element read stale until the file returns to the commented content (undo turns them fresh again). Zero new dependencies. 0.4 out of scope: classes and style blocks, border and per-side spacing, editing one text piece inside mixed content, layers, drag-reordering, GrapesJS/Webstudio/Puck, brand kit.

**v1 non-goals:** in-extension chat, `vscode.lm` model / chat / tool APIs (its MCP server registration is allowed) / external model keys, Next.js / TanStack Start / SvelteKit / Chrome extension, CustomTextEditor, OS auxiliary window, gallery UI, Grok Build messaging, MCP auto-writing production app source.

## 4. Data - What are we storing?

No database. User-workspace disk under `.vibeboard/` (gitignored by default):

- `project.json` (0.5, 10a) - `{ version: 1, openPageId, pages: [{ id, title }] }`. Page ids are `page-<n>` (1 to 100 pages); array order is menu order. It names the open page every tool and the panel work on.
- `pages/<pageId>/` (0.5, 10a) - one page's design files, schemas unchanged from 0.4:
  - `manifest.json` - `version`, `activeArtboardId`, `workspaceFolder`, `updatedAt`, `lastExport` (0.2 adds `lastExport.frames: [{ artboardId, artboardHash }]`, additive, manifest stays version 1)
  - `artboards/<id>.html` - full HTML document
  - optional `artboards/<id>.meta.json` - `id`, `title`, `generation`, `hash`, `viewport`, `updatedAt`
  - `canvas.json` (0.2) - `{ version: 1, frames: [{ id, label, x, y, width, group? }] }`. `id` matches `artboards/<id>.html`; width default 1280, clamped 120–3840 by `place_frame`; height is never stored (it comes from rendered content). A frame missing from `canvas.json` is auto-placed right of the last frame with a 24px gap. Stage view (zoom, pan) is chrome state, not design data.
  - `comments.json` (0.3) - `{ version: 1, comments }`, at most 500.
- `artboards` (0.5, 10a) - a tombstone text FILE where 0.4 kept its artboards folder, so a still-running 0.4 MCP fails instead of writing there. Never a directory.
- Root, shared by every page: `assets/`, stub `tokens.json`, `.lock`, `.ensure-panel`, `handoff/<exportId>/` including `IMPLEMENT.md`. 0.2 layout: `IMPLEMENT.md` (index of groups and frames), `canvas.html` (view-only layout preview), `<group-slug>/<frame-id>/index.html` per frame (`ungrouped/` when no group; colliding slugs get a numeric suffix), `tokens.json`

0.5 (10a): the first call or panel open moves a 0.4 root layout into `pages/page-1/` ("Page 1") once, resumable and never overwriting; an entry in both places stops with `MIGRATION_CONFLICT`. A lost `project.json` is rebuilt from the page folders.

Multi-artboard, one active. No gallery. MCP serializes writes per artboard id.

0.4: the panel becomes a second writer of `artboards/<id>.html` (Edit-lite), through `updateArtboard`'s compare-and-write, checked by content hash; 0.4 puts that compare-and-write under the workspace lock for both writers (it is unlocked today). Undo snapshots live in extension memory for the panel session only, never on disk.

## 5. Tech - What stack are we using?

- **Product:** Cursor/VS Code extension (WebviewPanel + local MCP stdio). Not a Next.js app, not SvelteKit, not a Chrome extension.
- **Host:** TypeScript, `pnpm`. Bundler esbuild through 0.2; from 0.2.1 Vite+ (`vp check` / `vp test` on Vitest / `vp pack` on tsdown), with esbuild kept for the bundle only if the 0.2.1 pack spike fails. `vscode.cursor.mcp.registerServer` (stdio) in Cursor, else `vscode.lm.registerMcpServerDefinitionProvider` in VS Code, never both; other agents add the stdio server by hand.
- **Chrome:** Svelte 5 + Vite under `src/webview/` from 0.3 (8b); shell in `src/panel/artboardChromeHtml.ts`. Through 0.2 it was a TS template-string document (decided 2026-10-13). Theme tokens `var(--vscode-*)`.
- **Artboard:** nested sandboxed HTML iframe (`sandbox="allow-scripts"`). Scripts allowed; parent never `eval`s artboard HTML.
- **MCP:** `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`. Two esbuild outfiles: `dist/extension.js` and `dist/mcp.js`.
- **Brain:** the user's agent over MCP; the extension never calls an LLM. Disk is SoT. Brand: `vibeboard`.
- **Verify:** F5 Extension Development Host (`fixtures/dev-workspace`), plus `pnpm check-types` / `pnpm lint` / `pnpm compile`. From 0.2.1: one Verify command (check, test, pack) run locally and by GitHub CI on push/PR.
- **Coding SoT:** `.claude/rules/` (00, 02-09), skills `vibeboard-build` (repo) and the shipped Agent skill `vibeboard` (`skills/vibeboard/SKILL.md`).

## 6. Monetize - How will this make money?

Not in v1. MIT open-source core. Paid kits only if traction, later.

## 7. UI/UX - How should this look and feel?

Panel-only MVP. No in-panel chat (chat stays in the agent).

Chrome: active artboard id, generation badge, handoff-stale badge, MCP-unavailable banner (still show disk artboard), Reveal / Export actions. Commands: Open Artboard, Reveal Design Folder, Export Handoff.

Artboard HTML is user/Agent content, not themed as chrome. No gallery. Variants are new ids + `set_active_artboard`.

0.2: default mode is Interact (no Edit chrome). The panel is a stage: frames at their own positions and fixed widths, full page height, with a chrome label above each and one heading per `group`. Toolbar has zoom presets and fit-all. No frame list or sidebar. A broken frame shows an error tile and never breaks the stage.

## 8. Deployment - Where and how will this ship?

This is a VS Code/Cursor extension, not a Vercel/Render web app.

- Develop: `pnpm compile` or `pnpm watch`, then **F5** (Extension Development Host opens `fixtures/dev-workspace`). Confirm `dist/mcp.js` exists before testing MCP.
- Package: `pnpm package` -> `.vsix`.
- No app start command, no health check path, no database, no env API keys.
- `/release` Render/Vercel is not the v1 ship path.
