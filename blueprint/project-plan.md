# Project Plan

Product SoT is the Notion spec and `.cursor/rules/`. This plan is the Blueprint-owned distill, not a second product spec. Do not invent features outside that spec.

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

Match build phases in `.cursor/rules/01-phase-protocol.mdc` and Notion section 12:

- Empty Artboard WebviewPanel + MCP `registerServer` on activate (Phase 0).
- Disk `.cursor-design/` as SoT; file saves refresh the nested iframe; generation bumps (Phase 1).
- MCP tools: `set_artboard`, `update_artboard` (requires `baseGeneration`), `read_artboard`, `list_artboards`, `set_active_artboard`; conflict path; MCP-offline banner (Phase 2).
- `export_artboard` + `handoff_status` stale mark; usable `IMPLEMENT.md` (Phase 3).
- Release polish: MIT, honest limits (Phase 4).

Shipped demo: Agent designs a landing hero+CTA on the artboard, export, then implement that section into a tiny Vite + plain HTML sample. Handoff is HTML+CSS+JS.

**0.2 Interact** (Notion 0.2 page: https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e): pan/zoom the live artboard with trackpad/mouse. Chrome scales the artboard iframe itself inside a clip well (CSSOM transform), so fixed/sticky/`vh` render as in a real viewport and zoomed-out artboards letterbox. A small gesture-forwarding runtime is injected by chrome at blob-build only, never written to disk; it never restyles artboard HTML; export/handoff assert pristine HTML. Pinch / ctrl+wheel zoom around cursor, plain wheel pans only when the artboard cannot scroll, zoom presets 50–200% via allowlisted postMessage, zoom persisted by chrome across refresh. Deliberate deviation from the Notion 0.2 lock ("pan host = body", "never CSS-scale the host iframe"), decided 2026-09-30. 0.2 out of scope: Edit mode, click-to-edit, layers, GrapesJS/Webstudio, comment overlays, multi-frame stage, space-drag pan.

**v1 non-goals:** in-extension chat, `vscode.lm` / external model keys, Next.js / TanStack Start / SvelteKit / Chrome extension, CustomTextEditor, OS auxiliary window, gallery UI, Grok Build messaging, MCP auto-writing production app source.

## 4. Data - What are we storing?

No database. User-workspace disk under `.cursor-design/` (gitignored by default):

- `manifest.json` - `version`, `activeArtboardId`, `workspaceFolder`, `updatedAt`, `lastExport`
- `artboards/<id>.html` - full HTML document
- optional `artboards/<id>.meta.json` - `id`, `title`, `generation`, `hash`, `viewport`, `updatedAt`
- `assets/`, stub `tokens.json`, `handoff/<exportId>/` including `IMPLEMENT.md`

Multi-artboard, one active. No gallery. MCP serializes writes per artboard id.

## 5. Tech - What stack are we using?

- **Product:** Cursor/VS Code extension (WebviewPanel + local MCP stdio). Not a Next.js app, not SvelteKit, not a Chrome extension.
- **Host:** TypeScript, esbuild, `pnpm`. `vscode.cursor.mcp.registerServer` (stdio). Never `vscode.lm.registerMcpServerDefinitionProvider`.
- **Chrome:** Svelte 5 + Vite (no Kit). Theme tokens `var(--vscode-*)`.
- **Artboard:** nested sandboxed HTML iframe (`sandbox="allow-scripts"`). Scripts allowed; parent never `eval`s artboard HTML.
- **MCP:** `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`. Two esbuild outfiles: `dist/extension.js` and `dist/mcp.js`.
- **Brain:** Cursor Agent only. Disk is SoT. Brand: `cursor-design`.
- **Verify:** F5 Extension Development Host (`fixtures/dev-workspace`), plus `pnpm check-types` / `pnpm lint` / `pnpm compile`.
- **Coding SoT:** `.cursor/rules/00` through `07`, skills `cursor-design-build` and `cursor-design-agent-loop`.

## 6. Monetize - How will this make money?

Not in v1. MIT open-source core. Paid kits only if traction, later.

## 7. UI/UX - How should this look and feel?

Panel-only MVP. No in-panel chat (chat stays in Cursor Agent).

Chrome: active artboard id, generation badge, handoff-stale badge, MCP-unavailable banner (still show disk artboard), Reveal / Export actions. Commands: Open Artboard, Reveal Design Folder, Export Handoff.

Artboard HTML is user/Agent content, not themed as chrome. No gallery. Variants are new ids + `set_active_artboard`.

0.2: default mode is Interact (no Edit chrome). Host shows a clip well and zoom menu; zoom scales the artboard iframe inside the well. Empty/error artboard disables the zoom menu.

## 8. Deployment - Where and how will this ship?

This is a VS Code/Cursor extension, not a Vercel/Render web app.

- Develop: `pnpm compile` or `pnpm watch`, then **F5** (Extension Development Host opens `fixtures/dev-workspace`). Confirm `dist/mcp.js` exists before testing MCP.
- Package: `pnpm package` -> `.vsix`.
- No app start command, no health check path, no database, no env API keys.
- `/release` Render/Vercel is not the v1 ship path.
