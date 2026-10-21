# Build Plan

Ordered MVP phases from Notion section 12 and `.cursor/rules/01-phase-protocol.mdc`. Details belong in `/feature`. Do not add items outside that spec.

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

- [ ] 7. **0.2.1 Tooling** - repo moves onto Vite+, replaced tools removed, quality checks added; F5 behavior unchanged
  - [x] 7a. **Pack spike** - `vp pack` reproduces `esbuild.js` (two CJS entries, `vscode` external on extension only, version define on mcp only, `dist/*.js` names, MCP SDK + zod bundled); `node dist/mcp.js` handshakes, `.vsix` lists no `node_modules`, F5 works; `compile` / `package` / `vscode:prepublish` / watch task + matcher re-pointed; tsconfig fixed for root `vite.config.ts`; result recorded (pass removes esbuild, fail keeps it for the bundle only)
  - [x] 7b. **vp check** - oxlint + oxfmt config moved into `vite.config.ts`; `vp check` replaces `check-types` / `lint` / `fmt`; rc files, deps, `watch:tsc` and `pretest` removed; formatting drift in its own commit
  - [ ] 7c. **vp test** - Vitest runs the 178 `src/**/*.test.ts` tests from TS (`node:test` imports rewritten, `src/test/**` excluded, forks pool); Test command declared in AGENTS.md
  - [ ] 7d. **Electron suite home** - decide how `@vscode/test-electron` builds once `out/` goes; remove `compile-tests` / `watch-tests`, `@types/mocha` from the main tsconfig, and now-dead `@vscode/test-cli` / `npm-run-all`; suite stays out of Verify
  - [ ] 7e. **Stricter static checks** - Oxlint type-aware rules on and clean with pure fixes only (`void` or already-ordered `await`, per site); knip with explicit entries clean, dead deps removed
  - [ ] 7f. **Test depth** - fast-check properties (stage geometry, stale check, zod round-trips); scrubbed snapshots for `IMPLEMENT.md` / `canvas.html`; coverage script via `@vitest/coverage-v8`, no thresholds
  - [ ] 7g. **MCP contract tests** - `@modelcontextprotocol/client` over `InMemoryTransport` through the real server for all 8 tools plus the full `listTools` set; tests characterise current errors, never change product
  - [ ] 7h. **Verify + CI** - one Verify command (check, test, pack) in AGENTS.md and README; `.github/workflows/verify.yml` on push/PR (Node 24, Vite+ install, `contents: read`); final F5 + `.vsix` smoke
