# cursor-design - Project Overview

<!-- blueprint:source-hash 5dc04e358d82e5084ec2f56e7a29700fa21d3e591c13945cb5f7301aef722b3d -->

> Agent-driven live HTML artboards inside Cursor: WebviewPanel chrome, sandboxed blob iframes, local MCP, disk SoT under `.cursor-design/`. 0.2 made the panel a Figma-style multi-frame stage; 0.2.1 moved the repo onto Vite+; 0.3 (in progress) adds Svelte chrome, frame drag/resize, element picking and comments for the Agent.

Coding SoT remains `.claude/rules/` (00, 02-09; `.cursor/rules/*.mdc` link to them) and skills `cursor-design-build` / `cursor-design-agent-loop`. Notion hub: https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4

## Problem

Cursor has no Claude Design-style live canvas. Design talk stays in chat; the human cannot watch HTML pixels change while the Agent iterates, then hand off implementable markup into a real repo. cursor-design is that loop: prompt, live artboard, export, implement. The extension never calls models.

## Users

- **People using Cursor** who want a live HTML artboard the Agent can iterate, then export into a real repo.
- **Cursor Agent** creating, iterating, and (0.2) placing frames via MCP, or `.cursor-design/**` files if MCP is denied.
- **A second Agent session** implementing from handoff (`IMPLEMENT.md` + HTML/CSS/JS), not screenshots.

No accounts or access tiers in v1.

## Features

Build-plan order. Headline: live Agent -> artboard -> export -> implement.

1. **Phase 0 Bootstrap** - F5 Extension Host, empty Artboard panel, `registerServer` on activate, no CSP errors.
2. **Phase 1 Disk to pixels** - `.cursor-design/` HTML save refreshes the iframe (~200ms); generation bumps.
3. **Phase 2 MCP loop** - `set_artboard`, `update_artboard` (requires `baseGeneration`), `read_artboard`, `list_artboards`, `set_active_artboard`; conflict path; MCP-offline banner.
4. **Phase 3 Export** - `export_artboard` + `handoff_status` stale mark; usable `IMPLEMENT.md`; demo = hero+CTA into Vite + plain HTML.
5. **Phase 4 Release polish** - MIT, honest limits.
6. **0.2 Multi-frame canvas** - Figma-style stage holding many fixed-width, full-height frames; Interact is default; disk/export stay pristine. Spec (rewritten 2026-10-13): https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e
   - 6a. **Blob inject** (shipped) - CSP-nonce'd runtime injected at blob-build only, typed iframe -> chrome allowlist, CSSOM transform, `data-cd-*` prefix, clean-export assert. Built for the earlier single-frame plan; these pieces carry forward and the transform moves from the iframe to the stage.
   - 6b. **Contract** - `canvas.json` read/write + MCP `place_frame`; `list_artboards` returns layout; pure geometry module + unit tests (zoom, clamps, fit-all, screen-to-stage).
   - 6c. **Stage** - pinch/ctrl+wheel zoom at cursor; plain wheel and empty-stage drag pan; zoom presets; fit-all; persisted view.
   - 6d. **Frames** - one blob iframe per frame at fixed width; full height via `cd:frame-height`; frames forward wheel/pinch to the stage; chrome labels + group headings; error tiles.
   - 6e. **Canvas export** - `export_artboard` exports every frame into one handoff: a folder per group, one `IMPLEMENT.md` index, a view-only `canvas.html`; `handoff_status` stale when any frame changed.
   - 6f. **Verify** - F5 dogfood: desktop page, mobile page, and two section frames on one canvas; export clean.
7. **0.2.1 Tooling** - repo moves onto Vite+; replaced tools removed; quality checks added. No product features or behavior changes. Brief: https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc. Plan review findings every 7x spec must carry: `blueprint/reference/0.2.1-tooling-review.md`.
   - 7a. **Pack spike** - `vp pack` reproduces `esbuild.js` (two CJS entries, `vscode` external, MCP SDK + zod bundled); F5 chain, watch matcher, `package`/prepublish re-pointed; tsconfig fixed; pass removes esbuild, fail keeps it for the bundle.
   - 7b. **vp check** - lint/fmt config into `vite.config.ts`; replaces `check-types`/`lint`/`fmt`; `pretest` removed; format drift in its own commit.
   - 7c. **vp test** - Vitest runs the 178 unit tests from TS; Test command declared.
   - 7d. **Electron suite home** - where `@vscode/test-electron` builds once `out/` goes; dead test deps removed; suite stays out of Verify.
   - 7e. **Stricter static checks** - Oxlint type-aware rules with pure per-site fixes; knip clean.
   - 7f. **Test depth** - fast-check properties, scrubbed snapshots, coverage script (no thresholds).
   - 7g. **MCP contract tests** - real client over `InMemoryTransport` for all 8 tools + `listTools` set; characterise current errors.
   - 7h. **Verify + CI** - one Verify command (check, test, pack); GitHub workflow on push/PR; final F5 + `.vsix` smoke.
8. **0.3 Comments for Agent** (in progress) - Svelte chrome, frame drag/resize, precise element picking, comments on disk as Agent references with a copy-prompt handoff; disk and export HTML stay pristine. Scope changed 2026-10-21 to comments only, no editing. Brief: https://app.notion.com/p/3fd500344e088171925dd51bc542c00c. Plan, decisions D1-D4, error tables and edge-case tests (read before each `/feature`): `blueprint/reference/0.3-comments-plan.md`.
   - 8a. **Svelte toolchain** (shipped) - Svelte 5 + vite-plugin-svelte bundle in `dist/webview/` under the existing CSP; frame runtime as an IIFE string; `svelte-check` and the webview build in Verify and CI.
   - 8b. **Svelte port** (shipped) - Svelte components behind one host bridge; stage geometry and frame runtime are real TS modules; F5 parity checklist passed.
   - 8c. **Frame drag/resize** - drag by label, resize width by right handle, 8px snap, width 120-3840; one `canvas.json` write on pointer-up through a cross-process workspace lock with a `base` conflict check; per-frame generation on the wire; in-house, no Moveable; Agent `place_frame` mid-drag wins.
   - 8d1. **Picking channel** - chrome-to-frame channel; Comment-mode click blocking in the frame runtime; `elementsFromPoint` + overlay rules; hover outline drawn in chrome; Alt+click or ↑ parent, ↓ child; untrusted-message guards.
   - 8d2. **Selectors** - `@medv/finder` selectors with generated-name filters; tag, text, styles, sanitizers; happy-dom round-trip tests.
   - 8e. **Comments disk + MCP** - `comments.json` CRUD under the lock with a status machine; creation cross-check (tag, text, generation); `list_comments`, `get_comment` (stale when the target element's hash changed, targetMissing; parse5 + css-select, bundled), `resolve_comment`; comment errors never blank the canvas.
   - 8f1. **Comment mode + popover** - `C` toggles mode; popover adds comments (D3 keys); panel replay of comment messages.
   - 8f2. **Pins** - pins follow elements (resize, scroll, load, font, animation); open/sent/resolved/stale/missing/unchecked; page comments.
   - 8g. **Comments panel** - Reply, Resolve, Reopen, Agent notes as replies, click to jump.
   - 8h. **Copy prompt** - locked template word for word (literal test); Copy all open; marks sent only after the clipboard write; host clipboard.
   - 8i. **Verify** - F5 dogfood of every Notion done-when line; `.vsix` smoke; docs checked against shipped code.

### 0.2 canvas model

- **Stage** lives in chrome. Pan/zoom is CSSOM `translate(x,y) scale(z)` on the stage layer, origin `0 0`. Chrome owns all geometry.
- **Frames** are fixed: each is its own artboard file at its own width, rendered at full content height in its own sandboxed blob iframe, with no inner scroll. Zoom, pan, and panel resize never reflow a frame, so a fixed header sticks to its frame's top (this reverses the old single-frame "pinned to viewport" check). A mobile frame is a separate file, not a narrowed desktop file.
- **Gestures:** pinch / ctrl+wheel zooms around the cursor; plain wheel and drag on empty stage pan. Over a frame, the injected runtime forwards wheel/pinch as a typed message; scroll boxes inside a design scroll first, and the wheel is forwarded only when nothing under the cursor can scroll that way. Frames stay clickable; no transparent overlay.
- **Messages (frame -> chrome, untrusted, allowlisted by type):** `cd:frame-height` `{ height }` (debounced, clamped to 20000px); `cd:frame-wheel` `{ deltaX, deltaY, ctrlKey, x, y }` (frame-local x/y), replacing 6a's `canvas:wheel`. Chrome -> frame: none planned.
- **Active artboard:** still exactly one. Every artboard file is a frame on the stage; the active one carries the badge, a stage highlight, and is what `set_active_artboard` sets. It is no longer the export target.
- **Chrome UI:** frame label above each frame, one heading per `group`, zoom presets and fit-all in a toolbar, error tile for a broken frame. No frame list or sidebar.

**0.2 out of scope:** Edit mode, layers, inspector, click-to-edit, dragging/resizing frames by hand, frame list or sidebar, comments, drawing, multiplayer, GrapesJS/Webstudio/page-builders, repo design-system import, writing canvas code to disk, strip-on-export.

**v1 non-goals:** in-panel chat, `vscode.lm` / external model keys, Next.js / TanStack Start / SvelteKit / Chrome extension, CustomTextEditor, OS auxiliary window, gallery UI, Grok Build messaging, MCP writing production app source.

## Data model

No database. Gitignored workspace folder `.cursor-design/`.

### Manifest (`manifest.json`)

- `version` (number)
- `activeArtboardId` (string)
- `workspaceFolder` (string)
- `updatedAt` (ISO timestamp)
- `lastExport` (`exportId`, `artboardId`, `artboardHash`, `exportedAt`) or absent
- 0.2 (6e): `lastExport.frames` (array of `{ artboardId, artboardHash }`), additive; manifest stays version 1 and the single-artboard fields stay for older readers.

### Artboard (one per frame)

- `artboards/<id>.html` - full HTML document (the pixels)
- optional `artboards/<id>.meta.json` - `id`, `title`, `generation` (monotonic), `hash`, `viewport`, `updatedAt`

`update_artboard` requires `baseGeneration` (or `baseHash`). Mismatch -> conflict; Agent re-reads then retries. MCP serializes writes per artboard id.

### Canvas layout (`canvas.json`, 0.2, locked)

- `version` (number, `1`)
- `frames` (array of Frame)

**Frame:**

- `id` (string) - matches `artboards/<id>.html`
- `label` (string) - chrome label above the frame
- `x`, `y` (number) - stage position
- `width` (number) - default 1280; `place_frame` clamps to 120-3840
- `group` (string, optional) - frames sharing it get one chrome heading

Height is never stored; it comes from the rendered content (`cd:frame-height`). A frame with no `canvas.json` entry is auto-placed right of the last frame with a 24px gap. Stage view (zoom, pan) is chrome state, persisted by chrome, not design data.

### MCP additions (0.2, locked)

- `place_frame({ id, x?, y?, width?, label?, group? })` - partial update of one frame in `canvas.json`; returns the full frame list.
- `list_artboards` also returns layout, so the Agent can arrange frames without overlap.
- `set_artboard` / `update_artboard` keep working per frame.

### Handoff

- Today (single artboard): `handoff/<exportId>/` with `index.html` (HTML+CSS+JS inline), `IMPLEMENT.md` (`artboardId`, `artboardHash`, `exportedAt`, `exportId`), stub `tokens.json`. `assets/` are referenced, not copied. Stale when active hash != last export hash. Old handoffs are never deleted.
- 0.2 (6e, whole canvas): `handoff/<exportId>/` with `IMPLEMENT.md` (index: groups -> frames with label, width, id, hash), `canvas.html` (view-only: each frame's `index.html` in its own iframe at its stage position and width, with labels and group headings), `<group-slug>/<frame-id>/index.html` per frame (`ungrouped/` when no group; colliding slugs get a numeric suffix), `tokens.json`. Stale when any frame hash changed or a frame was added or removed since export.
- Every exported `index.html` stays byte-equal to its disk HTML; canvas code never appears (asserted, not stripped). Frames are never merged into one document (their CSS/JS would collide).

## Tech stack

- **Host** - TypeScript Cursor/VS Code extension, `pnpm`, bundled by `vp pack` (tsdown) from 0.2.1. `vscode.cursor.mcp.registerServer` stdio. Never `vscode.lm.registerMcpServerDefinitionProvider`.
- **Chrome** - Svelte 5 + Vite under `src/webview/` from 0.3 (8b); the host keeps only the shell `src/panel/artboardChromeHtml.ts` (CSP, `chrome.css`, `chrome.js`). Through 0.2 it was a TS template-string document. `var(--vscode-*)` tokens.
- **Artboard frames** - sandboxed blob iframes, `sandbox="allow-scripts"`, null origin, chrome CSP nonce. Parent never `eval`s artboard HTML.
- **MCP** - `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`. Outfiles: `dist/extension.js`, `dist/mcp.js`.
- **State** - disk `.cursor-design/` is SoT. Brain = Cursor Agent only. Brand: `cursor-design`.
- **Tooling** - Vite+ from 0.2.1 (`vp check` lint/fmt/types, `vp test` on Vitest, `vp pack` on tsdown), plus `svelte-check` for the webview. One Verify command (`pnpm verify`) runs locally and in GitHub CI on push/PR; the `@vscode/test-electron` suite stays out of CI. UI verify = F5 (`fixtures/dev-workspace`).

Notion still mentions `@modelcontextprotocol/sdk`; this repo and `.claude/rules/02-mcp-webview.md` lock v2 `@modelcontextprotocol/server`. Follow the repo.

## Monetization

Not in v1. MIT open-source core. Paid kits only if traction, later.

## UI/UX

Panel-only. Chat stays in Cursor Agent.

- **Open Artboard** - panel chrome + stage (0.2) or the empty state
- Chrome badges - active id, generation, handoff stale, MCP unavailable (still render disk)
- **Reveal Design Folder** / **Export Handoff**
- Artboard HTML is user/Agent content, not chrome-themed
- 0.2: default Interact mode (no Edit chrome); stage with labeled frames and group headings; toolbar with zoom presets and fit-all; error tile per broken frame; no frame list

## Deployment

VS Code/Cursor extension, not a web host.

- Develop: `pnpm compile` or `pnpm watch`, then **F5**. Confirm `dist/mcp.js` before MCP tests.
- Package: `pnpm package` -> `.vsix`
- No start command, health path, database, or model API keys
- Blueprint `/release` Vercel/Render is not the v1 ship path
