# Build Plan

Ordered MVP phases from Notion section 12. Details belong in `/feature`. Do not add items outside that spec.

## Your features

- [x] 1. **Phase 0 Bootstrap** - F5 Extension Host, empty Artboard panel, `registerServer` on activate, no CSP errors
- [x] 2. **Phase 1 Disk to pixels** - `.cursor-design/` HTML save refreshes the nested iframe (~200ms); generation bumps
- [x] 3. **Phase 2 MCP loop** - `set_artboard` / `update_artboard` / `read_artboard` / `list_artboards` / `set_active_artboard`; `baseGeneration` conflicts; MCP-offline banner
- [x] 4. **Phase 3 Export** - `export_artboard` + `handoff_status` stale mark; `IMPLEMENT.md` usable for Vite + plain HTML sample
- [x] 5. **Phase 4 Release polish** - MIT, honest limits

## 0.2 Multi-frame canvas

From the Notion 0.2 page (rewritten 2026-10-13): https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e

- [x] 6. **0.2 Multi-frame canvas** - Figma-style stage in the panel holding many fixed-width, full-height frames; Interact is the default; disk and export HTML stay pristine
  - [x] 6a. **Blob inject** - clip well + CSSOM `translate/scale` on the host iframe (origin `0 0`); gesture-forwarding runtime + chrome CSP nonce injected only at blob-build; pinch / ctrl+wheel forwarded as an allowlisted typed message; chrome zooms from the top-left within 50–200%; `data-cd-*` only; export/handoff asserts no inject junk (no strip). Shipped under the earlier single-frame plan; its nonce injection, typed allowlist, clean-export assert, `data-cd-*` prefix, and transform code carry forward (transform moves from the iframe to the stage).
  - [x] 6b. **Contract** - `canvas.json` read/write + `place_frame`; `list_artboards` returns layout; geometry module + unit tests (zoom, clamps, fit-all, screen-to-stage)
  - [x] 6c. **Stage** - pinch/ctrl+wheel zoom at cursor, wheel + empty-drag pan, presets, fit-all, persisted view
  - [x] 6d. **Frames** - one blob iframe per frame at fixed width, full height via `cd:frame-height`, frames forward wheel/pinch to the stage, labels + group headings, error tiles
  - [x] 6e. **Canvas export** - `export_artboard` exports every frame: one `handoff/<exportId>/` with `<group-slug>/<frame-id>/index.html` (ungrouped frames under `ungrouped/`), one `IMPLEMENT.md` index, a view-only `canvas.html` preview of the layout; `manifest.lastExport.frames`; `handoff_status` stale when any frame changed, was added, or was removed
  - [x] 6f. **Verify** - F5 dogfood with a desktop page, a mobile page and two section frames on one canvas; export clean

## 0.2.1 Tooling

From the Notion 0.2.1 page (2026-10-18): https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc
Rule: no product features and no behavior changes. Plan review findings (read before each `/feature`): `blueprint/reference/0.2.1-tooling-review.md`.

- [x] 7. **0.2.1 Tooling** - repo moves onto Vite+, replaced tools removed, quality checks added; F5 behavior unchanged
  - [x] 7a. **Pack spike** - `vp pack` reproduces `esbuild.js` (two CJS entries, `vscode` external on extension only, version define on mcp only, `dist/*.js` names, MCP SDK + zod bundled); `node dist/mcp.js` handshakes, `.vsix` lists no `node_modules`, F5 works; `compile` / `package` / `vscode:prepublish` / watch task + matcher re-pointed; tsconfig fixed for root `vite.config.ts`; result recorded (pass removes esbuild, fail keeps it for the bundle only)
  - [x] 7b. **vp check** - oxlint + oxfmt config moved into `vite.config.ts`; `vp check` replaces `check-types` / `lint` / `fmt`; rc files, deps, `watch:tsc` and `pretest` removed; formatting drift in its own commit
  - [x] 7c. **vp test** - Vitest runs the 178 `src/**/*.test.ts` tests from TS (`node:test` imports rewritten, `src/test/**` excluded, forks pool); Test command declared in AGENTS.md
  - [x] 7d. **Electron suite home** - decide how `@vscode/test-electron` builds once `out/` goes; remove `compile-tests` / `watch-tests`, `@types/mocha` from the main tsconfig, and now-dead `@vscode/test-cli` / `npm-run-all`; suite stays out of Verify
  - [x] 7e. **Stricter static checks** - Oxlint type-aware rules on and clean with pure fixes only (`void` or already-ordered `await`, per site); knip with explicit entries clean, dead deps removed
  - [x] 7f. **Test depth** - fast-check properties (stage geometry, stale check, zod round-trips); scrubbed snapshots for `IMPLEMENT.md` / `canvas.html`; coverage script via `@vitest/coverage-v8`, no thresholds
  - [x] 7g. **MCP contract tests** - `@modelcontextprotocol/client` over `InMemoryTransport` through the real server for all 8 tools plus the full `listTools` set; tests characterise current errors, never change product
  - [x] 7h. **Verify + CI** - one Verify command (check, test, pack) in AGENTS.md and README; `.github/workflows/verify.yml` on push/PR (Node 24, Vite+ install, `contents: read`); final F5 + `.vsix` smoke

## 0.3 Comments for Agent + frame drag/resize

From the Notion 0.3 page (scope changed 2026-10-21: comments only, no editing): https://app.notion.com/p/3fd500344e088171925dd51bc542c00c
Plan, library choices, decisions D1-D4 (Bombic 2026-10-21), error and status tables, gotchas and edge-case tests (read before each `/feature`; adversarial review applied 2026-10-21): `blueprint/reference/0.3-comments-plan.md`. Order: 8a, 8b, 8c, 8d1, 8d2, 8d3, 8e, 8f1, 8f2, 8g, 8h, 8i.

- [ ] 8. **0.3 Comments for Agent** - Svelte chrome, frame drag/resize, precise element picking, comments on disk as Agent references with copy-prompt handoff; disk and export HTML stay pristine
  - [x] 8a. **Svelte toolchain** - Svelte 5 + vite-plugin-svelte bundle in `dist/webview/` under the existing CSP (one Vite instance); frame runtime bundled to an IIFE string; `svelte-check` on TS 6 (lint stays TS 7 via tsgolint) and the webview build in Verify and CI; `src/webview/**` lint override; chrome behavior unchanged
  - [x] 8b. **Svelte port** - template-string chrome replaced by Svelte components with one host bridge; stage geometry and frame runtime become real TS modules; every 0.2 behavior passes the F5 parity checklist; rules 04/05 updated
  - [x] 8c. **Frame drag/resize** - drag by label, resize width by right handle, 8px snap, width 120-3840, one `canvas.json` write on pointer-up through a cross-process workspace lock with a `base` conflict check; per-frame generation on the wire; in-house, no Moveable; Agent `place_frame` mid-drag wins
  - [x] 8d1. **Picking channel** - chrome-to-frame channel; Comment-mode click blocking in the frame runtime; `elementsFromPoint` + overlay rules; hover outline drawn in chrome; Alt+click or ↑ parent, ↓ child; untrusted-message guards
  - [x] 8d2. **Selectors** - `@medv/finder` selectors with generated-name filters; tag, text, styles, sanitizers; happy-dom round-trip tests on the picking fixture
  - [ ] 8d3. **Browser tests** - Playwright (Chromium only) drives the built chrome bundle in a harness page with a stubbed VS Code host and the real frame runtime; covers frame stability (no reload loop), wheel/zoom and trackpad pan over frames, drag/resize, Comment-mode picking and selectors; `Browser tests` command in AGENTS.md, local only (out of Verify and CI for now); rules 08/09 say browser tests prove chrome and iframe behavior, F5 only for Cursor-only checks
  - [ ] 8e. **Comments disk + MCP** - `comments.json` CRUD under the lock with a status machine; creation cross-check (tag, text, generation); `list_comments`, `get_comment` (stale when the target element's own hash changed, targetMissing, via parse5 + css-select, bundled), `resolve_comment`; comment errors never blank the canvas; contract tests
  - [ ] 8f1. **Comment mode + popover** - `C` toggles mode; popover adds comments with D3 keys; panel replay of comment messages
  - [ ] 8f2. **Pins** - pins follow elements (resize, scroll, load, font, animation), show open/sent/resolved/stale/missing/unchecked; page comments
  - [ ] 8g. **Comments panel** - Reply, Resolve, Reopen, Agent notes as replies, click to jump
  - [ ] 8h. **Copy prompt** - locked template word for word (literal test), Copy all open, marks sent only after the clipboard write, host clipboard
  - [ ] 8i. **Verify** - F5 dogfood of every Notion done-when line; `.vsix` smoke; docs checked against shipped code
