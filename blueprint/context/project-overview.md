# vibeboard - Project Overview

<!-- blueprint:source-hash ed86e6a506d12d720baca8be0cad280ee72b8b5d91bbbe89f9532a865587c300 -->

> Agent-driven live HTML artboards inside Cursor and VS Code, driven by any MCP-capable agent: WebviewPanel chrome, sandboxed blob iframes, local MCP, disk SoT under `.vibeboard/`. 0.2 made the panel a Figma-style multi-frame stage; 0.2.1 moved the repo onto Vite+; 0.3 shipped Svelte chrome, frame drag/resize, element picking and comments for the Agent; 0.4 Edit-lite shipped an Edit mode that saves text and inline styles straight to disk; 0.5 added pages: several designs per workspace, each with its own frames, layout and comments. A quality pass (item 11) follows.

Coding SoT: `.claude/rules/` (00, 02-09; `.cursor/rules/*.mdc` link to them) and skills `vibeboard-build` (repo) and the shipped Agent skill `vibeboard` (`skills/vibeboard/SKILL.md`). Notion hub: https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4

## Problem

Cursor has no Claude Design-style live canvas. Design talk stays in chat; the human cannot watch HTML pixels change while the Agent iterates, then hand off implementable markup into a repo. vibeboard is that loop: prompt, live artboard, export, implement. The extension never calls models.

## Users

- **People using Cursor** who want a live HTML artboard the Agent can iterate, then export into a real repo.
- **The user's agent** (Cursor Agent, Copilot, Claude Code, Codex, any MCP-capable agent) creating, iterating, and placing frames via MCP, or `.vibeboard/**` files if MCP is denied.
- **A second Agent session** implementing from handoff (`IMPLEMENT.md` + HTML/CSS/JS), not screenshots.

No accounts in v1; not multi-tenant.

## Features

Build-plan order. Headline: live Agent -> artboard -> export -> implement.

1. **Phase 0 Bootstrap** - F5 Extension Host, empty Artboard panel, `registerServer` on activate, no CSP errors.
2. **Phase 1 Disk to pixels** - `.vibeboard/` HTML save refreshes the iframe (~200ms); generation bumps.
3. **Phase 2 MCP loop** - `set_artboard`, `update_artboard` (requires `baseGeneration`), `read_artboard`, `list_artboards`, `set_active_artboard`; conflict path; MCP-offline banner.
4. **Phase 3 Export** - `export_artboard` + `handoff_status` stale mark; usable `IMPLEMENT.md`; demo = hero+CTA into Vite + plain HTML.
5. **Phase 4 Release polish** - MIT, honest limits.
6. **0.2 Multi-frame canvas** (shipped) - Figma-style stage holding many fixed-width, full-height frames; Interact is default; disk/export stay pristine. Spec: https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e
   - 6a blob inject (CSP-nonce'd runtime at blob-build only, `data-cd-*`, clean-export assert); 6b `canvas.json` + `place_frame`; 6c stage zoom/pan/fit-all; 6d one blob iframe per frame, `cd:frame-height`; 6e whole-canvas export; 6f dogfood.
7. **0.2.1 Tooling** (shipped) - Vite+ (`vp pack`, `vp check`, `vp test`), Electron suite dropped, type-aware Oxlint, knip, fast-check, snapshots, coverage, MCP contract tests, one Verify command + GitHub CI. No behavior change. Review: `blueprint/reference/0.2.1-tooling-review.md`.
8. **0.3 Comments for Agent** (shipped) - Svelte chrome, frame drag/resize, element picking, comments on disk as Agent references with a Copy prompt handoff. Brief: https://app.notion.com/p/3fd500344e088171925dd51bc542c00c. Plan, D1-D4, error tables: `blueprint/reference/0.3-comments-plan.md`.
   - 8a/8b Svelte 5 port behind one host bridge; 8c drag by label, resize by right handle (width 120-3840), one locked `canvas.json` write with a `base` check; 8d1-8d3 picking channel, `@medv/finder` selectors, Playwright browser tests (local only); 8e `comments.json` + `list_comments` / `get_comment` (stale, targetMissing) / `resolve_comment`, Agent skill synced to `~/.cursor/skills/`, inline-only frame CSP; 8f-8h Comment mode (`C`), pins, comments panel, Copy prompt; 8i verify.
9. **0.4 Edit-lite** (shipped) - Edit mode: click an element, change text and inline styles in an in-house inspector; the save changes only that spot of the artboard HTML on disk; undo/redo; the Agent's next update keeps the edits; zero new dependencies. Notion (Decisions win): https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d
   - 9a `data-cd-src="N"` source tags in the frame copy only, chrome CSP `style-src-attr 'unsafe-inline'`; 9b pure edit core (byte-exact outside the edited spot); 9c `updateArtboard` read-compare-write under `withWorkspaceLock` (MCP too); 9d-9e Edit mode, fields, live preview, save without frame reload; 9f undo/redo (20 whole-file snapshots per frame per session, host memory); 9g verify.
   - 9h **More edit fields: saving** - weight, italic, decoration, align, leading, case, tracking, background, radius, overflow, opacity, gap, border width/style/colour; one save can set or clear several properties as one write and one undo step; frame reports text-only / mixed / elements-only.
   - 9i **Inspector redesign** - sections by selection, compact two-column fields with a set-here dot, per-section Reset, Add border; notes `blueprint/reference/9i-inspector-notes.md`.
10. **0.5 Projects + pages** (done) - several designs per workspace, each a page with its own frames, layout and comments; a Pages menu switches the stage; the Agent lists, creates and opens pages; existing folders migrate to page one; disk and export HTML stay pristine; zero new dependencies. Notion outline: https://app.notion.com/p/405500344e088195914ed9092813184c. Decisions D1-D13, error table, per-step contracts (read before each `/feature`): `blueprint/reference/0.5-pages-plan.md`. Order: 10a, 10b, quality wave 1 `/fix`, 11f, 11a, then 10c, 10d, 10e, then 11b-11e.
   - 10a. **Pages on disk + migration** (shipped) - `project.json` + `pages/<id>/`; `resolveOpenPage` at every entry point (migrate, rebuild, fresh create); tombstone file `artboards`; per-page helpers take `PageLocation`; new error codes in the Agent skill. No new tool, message or UI. Contract: `blueprint/history/features/10a-pages-on-disk-migration.md`.
   - 10b. **Page-scoped panel** (shipped) - `canvas:updated` / `comments:updated` carry `pageId`; chrome recreates per-page state on a page change; comment list shown only for its page; the comment draft and saved stage view carry their page; page-bound chrome requests carry `pageId` (host acts on that page or answers it no longer exists); undo history keyed by page.
   - 10c. **Page ops + MCP tools** (shipped) - disk `listPages` (mtime), `createPage`, `openPage`, `renamePage`, `deletePage` (index first, folder to `deleted/`, open the neighbour, never the last page), ids never reused; MCP `list_pages`, `create_page` (default artboard, opens it), `open_page`; `page` in every success result; `COMMENT_NOT_FOUND` names the page holding the id; `IMPLEMENT.md` names its page.
   - 10d. **Pages menu** (shipped) - toolbar page button + menu: pages with last-edited times, open, New blank page, inline rename, delete behind a host modal; page list rides on `canvas:updated`; `page:*` messages answered once by `page:saved` or `ui:error`, then a direct snapshot post; keyboard and focus; gallery states.
   - 10e. **Verify** (done) - agent-run real Cursor on the `.vsix` (counts as the F5 dogfood): a 0.4 workspace migrates unchanged, a stale server fails on the tombstone (0.4 never touches `.vibeboard/`), Agent page tools drive the panel, other tools stay on the open page, no cross-page leaks, edits/undo stay per page, rename/delete, Copy prompt across pages, per-page export clean; docs (README, skill, system map, project-plan, overview, Notion).
11. **Quality pass** (in progress; 2026-11-23 deep-modules review, Bombic approved the waves) - one way to do each job, smaller interfaces, the panel refresh race fixed, host and chrome state testable without module mocks. No new dependencies; behavior unchanged unless an item names a bug. Dropped: branded ids, host singleton factories (except the watcher), clock and id injection.
   - 11f. **Test effectiveness review** (shipped) - one-off StrykerJS run in a throwaway worktree, ranked report.
   - 11a. **Panel refresh + frame key** (shipped) - one last-started-wins `refreshPanel()`; the frame cache key includes the page.
   - 11b. **Host dedupe** (done) - one request preamble, one comments write shell, one handlers object (MCP wrapper: 10c).
   - 11c. **Ports** - host `answer*` handlers take a small ports object; one page-bound post port per webview state class; the watcher's event handling becomes a pure step.
   - 11d. **Host message guard** - shrink `parseHostMessage`; no zod in the chrome bundle.
   - 11e. **Comments deep review** - report first (Bombic picks): fold `CommentsState`, `PinThread`, `CommentPicker` into one comments module?; extract `Stage.svelte` and `Inspector.svelte` glue to `.svelte.ts`.

**0.5 decisions (Bombic, 2026-11-21):** one open page stored on disk; the Agent's `open_page` / `create_page` move the user's stage; delete goes to `.vibeboard/deleted/`; migrated page titled "Page 1"; no `pageId` argument on existing tools (they act on the open page, resolved once per call).

**Out of scope:** 0.4: classes and style blocks, per-side spacing, editing one text piece inside mixed content, layers, drag-reordering, GrapesJS/Webstudio/Puck, brand kit; 0.4.1 (mode switch opens the matching panel) is separate. 0.5: duplicate page, brand kit, whole-project export, page search and frame links (0.5.1), MCP rename or delete of pages, emptying `deleted/`.

### Canvas model (0.2+)

- **Stage** lives in chrome: pan/zoom is CSSOM `translate(x,y) scale(z)` on the stage layer, origin `0 0`; chrome owns all geometry.
- **Frames** are fixed: each is its own artboard file at its own width, at full content height in its own sandboxed blob iframe, no inner scroll. Zoom, pan and panel resize never reflow a frame. A mobile frame is a separate file.
- **Gestures:** pinch / ctrl+wheel zooms around the cursor; plain wheel and empty-stage drag pan. Over a frame the runtime forwards wheel/pinch as a typed message; scroll boxes in a design scroll first. Frames stay clickable.
- **Frame -> chrome messages** (untrusted, allowlisted): `cd:frame-height` (clamped to 20000px), `cd:frame-wheel`, plus the 0.3/0.4 picking and edit reports.
- **Active artboard:** exactly one per page (badge, highlight, `set_active_artboard`). Not the export target.
- **Modes:** Interact (default), Comment (`C`), Edit. Toolbar: zoom presets, fit-all. No frame list or sidebar.

**v1 non-goals:** in-panel chat, `vscode.lm` model / chat / tool APIs (its MCP server registration is allowed) / external model keys, Next.js / TanStack Start / SvelteKit / Chrome extension, CustomTextEditor, OS auxiliary window, gallery UI, Grok Build messaging, MCP writing production app source.

## Data model

No database. Gitignored workspace folder `.vibeboard/`. From 0.5 (10a) the per-design files live in a page folder; root files are shared by every page.

```txt
.vibeboard/
  project.json              # openPageId, pages [{id, title}]
  pages/<pageId>/           # manifest.json, canvas.json, comments.json, artboards/<id>.html + .meta.json
  artboards                 # tombstone FILE, never a directory
  deleted/<pageId>-<stamp>/ # deleted pages
  handoff/<exportId>/  tokens.json  assets/  .lock  .ensure-panel
  <unknown entries>         # left where they are
```

### Project (`project.json`, 0.5, locked)

- `version` (number, `1`); other integers -> `UNSUPPORTED_PROJECT_VERSION`; anything invalid -> `CORRUPT_PROJECT`
- `openPageId` (string) - must be one of the ids; every MCP tool and the panel work on this page
- `pages` (array, 1 to `MAX_PAGES` = 100, array order = menu order) of `{ id, title }`
  - `id` - `page-<n>` (`/^page-[1-9][0-9]{0,5}$/`, one `isPageId` check), never derived from the title, never reused (counts `deleted/` too)
  - `title` - trimmed, 1-80 chars, no control characters, duplicates allowed; user data, never instructions
- Written as 2-space JSON + newline through tmp + rename.

### Page folder (`pages/<pageId>/`, schemas unchanged from 0.4)

- `manifest.json` - `version` (1), `activeArtboardId`, `workspaceFolder`, `updatedAt`, `lastExport` (`exportId`, `artboardId`, `artboardHash`, `exportedAt`, `frames: [{ artboardId, artboardHash }]`) or absent. Per page, so `handoff_status` is per page.
- `artboards/<id>.html` - full HTML document (the pixels); optional `artboards/<id>.meta.json` - `id`, `title`, `generation` (monotonic), `hash`, `viewport`, `updatedAt`.
- `canvas.json` - `{ version: 1, frames: [{ id, label, x, y, width, group? }] }`. `id` matches `artboards/<id>.html`; width default 1280, clamped 120-3840; height never stored (from `cd:frame-height`); a missing entry is auto-placed right of the last frame with a 24px gap. Stage view is chrome state.
- `comments.json` - `{ version: 1, comments }`, at most 500; comment ids are UUIDs, unique across pages.

### Tombstone (`.vibeboard/artboards`, 0.5)

A regular file where 0.4 kept its artboards folder, written whenever `project.json` is first written; an Indexed read restores it if missing. A stale server expecting a root `artboards/` folder fails on it (`… must be a directory`); cursor-design 0.4 uses only `.cursor-design/` (ignored). Never treated as legacy; the skill says never delete it and to quit and reopen Cursor.

### Open-page resolver (`resolveOpenPage`, 10a)

Runs once per call at every MCP tool and host entry point (after the trust check, outside `withWorkspaceLock`). Lock-free classification, first match wins:

- **Indexed** (`project.json` exists) - return the open page; a real root `artboards/` directory -> `MIGRATION_CONFLICT`.
- **Legacy** (root `artboards/` directory or any root `manifest.json` / `canvas.json` / `comments.json`) - under the lock: conflict check, `mkdir pages/page-1`, move `artboards/`, write tombstone, move the JSON files, write `project.json` ("Page 1"). Resumable, never overwrites; an entry in both places -> `MIGRATION_CONFLICT`, nothing moves. Unknown entries stay.
- **Index lost** (page folders, no index) - rebuild `project.json` from folder names, titles `Page <n>`, open = lowest.
- **Fresh** - reads write nothing and create no folder; only `createIfFresh` callers (`set_artboard`, `create_page`, Open Artboard) create the tombstone, `pages/page-1` and `project.json`.

Page-scoped writes never recreate a missing page folder (`createArtboard` makes only `artboards/`, non-recursively; no folder -> `PAGE_NOT_FOUND`). Per-page helpers take `PageLocation = { workspaceRoot, pageId }`; root files and the lock keep `workspaceRoot`. Untrusted workspaces never migrate or create. Accepted (F-08): reads may migrate or restore the tombstone; a read-only `.vibeboard/` is unsupported.

New codes (10a): `PAGE_NOT_FOUND`, `CORRUPT_PROJECT`, `UNSUPPORTED_PROJECT_VERSION`, `MIGRATION_CONFLICT`. Per-page error messages name `.vibeboard/pages/<id>/...`.

### Writes and locking

- One cross-process lock `.vibeboard/.lock` (`withWorkspaceLock`, not re-entrant) for every page. `updateArtboard` (MCP and panel), `placeFrame`, comment writes, the export tail and migration take it; `createArtboard` and `setActiveArtboard` do not.
- `update_artboard` requires `baseGeneration` (or `baseHash`); mismatch -> conflict, Agent re-reads and retries.
- 0.4: the panel is a second writer through `updateArtboard`'s compare-and-write, checked by content hash. `data-cd-src` numbers exist only in the frame copy. Undo snapshots live in host memory per panel session, keyed by page and frame. An edited element's comments read stale until the bytes return.
- 0.5 MCP: `list_pages()` -> `{ openPageId, pages: [{ id, title, updatedAt }] }` (`updatedAt` = newest mtime of the page's files; fresh folder -> `{ openPageId: null, pages: [] }`); `create_page({ title })` -> `{ page, artboardId, generation, hash }`; `open_page({ pageId })` -> `{ page }`. Existing tools gain `page: { id, title }` in success results only.

### Handoff

- `handoff/<exportId>/` at the root, exporting the open page: `IMPLEMENT.md` (index: groups -> frames with label, width, id, hash; names its page; its MCP-unavailable step names `.vibeboard/pages/<id>/artboards/`), `canvas.html` (view-only layout), `<group-slug>/<frame-id>/index.html` per frame (`ungrouped/`; colliding slugs get a suffix), `tokens.json`. `assets/` referenced, not copied. Old handoffs never deleted.
- Stale when any frame hash changed or a frame was added or removed since that page's export.
- Every exported `index.html` is byte-equal to its disk HTML; canvas code never appears (asserted, not stripped).

## Tech stack

- **Host** - TypeScript Cursor/VS Code extension, `pnpm`, bundled by `vp pack` (tsdown). MCP registers on activate: `vscode.cursor.mcp.registerServer` (stdio) in Cursor, else `vscode.lm.registerMcpServerDefinitionProvider` in VS Code, never both; other agents add the stdio server by hand (README). The server sends the shipped skill body as MCP `instructions`.
- **Chrome** - Svelte 5 + Vite under `src/webview/`; the host keeps only the shell `src/panel/artboardChromeHtml.ts` (CSP, `chrome.css`, `chrome.js`). Theme: `--cd-*` tokens in `src/webview/ui/theme.css`, built from `var(--vscode-*)` (the only file that reads them).
- **Artboard frames** - sandboxed blob iframes (`sandbox="allow-scripts"`, null origin, CSP nonce, inline-only frame CSP); the parent never `eval`s artboard HTML.
- **MCP** - `@modelcontextprotocol/server` (v2), not `@modelcontextprotocol/sdk`; server `vibeboard`, 14 tools. Workspace folders come from the client's MCP roots, else `VIBEBOARD_WORKSPACE_ROOT(S)`. Outfiles: `dist/extension.js`, `dist/mcp.js`.
- **State** - disk `.vibeboard/` is SoT. Brain = the user's agent over MCP; the extension never calls an LLM. Brand: `vibeboard`.
- **Tooling** - Vite+ (`vp check` lint/fmt/types, `vp test` on Vitest, `vp pack`), `svelte-check`; `pnpm verify` locally and in GitHub CI. Browser tests (`pnpm test:browser`) and gallery local only. Cursor-only checks: F5 (`fixtures/dev-workspace`) or the agent-run real-Cursor rig.

Notion still mentions `@modelcontextprotocol/sdk`; this repo and rule 02 lock v2 `@modelcontextprotocol/server`. Follow the repo.

## Monetization

Not in v1. MIT open-source core; paid kits only if traction, later.

## UI/UX

Panel-only. Chat stays in the agent.

- Panel chrome + stage, or the empty state
- Toolbar - page button, active artboard id and generation, handoff-stale badge, Interact / Edit / Comment switch, zoom presets, fit-all, Comments panel toggle; an MCP-unavailable banner still renders disk
- Commands: **Open Artboard**, **Reveal Design Folder**, **Export Handoff**
- Artboard HTML is user/Agent content, not chrome-themed
- Stage with labeled frames and group headings; toolbar zoom presets and fit-all; error tile per broken frame; no frame list
- 0.3: Comment mode (`C`), pins, comments panel, Copy prompt
- 0.4: Edit mode beside Interact (default) and Comment; inspector with sections by selection, Reset, Add border, Undo, Redo, visible only in Edit mode
- 0.5: page button shows the open page's title; menu (arrows, Home, End, Escape) with last-edited times, New blank page, inline rename, delete behind a native modal (not on the last page). A page switch (or the Agent's `open_page` / `create_page`) remounts the stage and fits all; no frame, comment, pin, inspector or Undo target carries over (undo history is per page)

## Deployment

VS Code/Cursor extension, not a web host.

- Develop: `pnpm compile` or `pnpm watch`, then **F5**. Confirm `dist/mcp.js` before MCP tests.
- Package: `pnpm package` / `pnpm vsix` -> `.vsix`
- No start command, health path, database, or model API keys
- After an update Cursor keeps the old MCP process until a full quit and reopen (F-135); that old server already knows pages. A cursor-design 0.4 downgrade sees an empty workspace.
- Blueprint `/release` Vercel/Render is not the v1 ship path
