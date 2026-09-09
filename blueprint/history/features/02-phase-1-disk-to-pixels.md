# Feature: Phase 1 Disk to pixels

**From build-plan:** feature 2
**Build attempt:** 1
**Branch:** `feature/phase-1-disk-to-pixels`
**Status:** verified

## Goal

Workspace `.cursor-design/` becomes the artboard SoT: init manifest + first artboard, watch HTML/meta/manifest with ~200ms debounce, bump generation only when HTML hash changes, and refresh a nested sandboxed iframe when the active board changes on disk. Done when a manual HTML edit updates the panel.

## In scope

- Disk layout under `.cursor-design/`: `manifest.json`, `artboards/<id>.html`, optional `artboards/<id>.meta.json`. Path segments and schema version live in `src/disk/` only.
- Manifest: `version` (number, `1`), `activeArtboardId` (string), `workspaceFolder` (first-folder `fsPath`), `updatedAt` (ISO). Do not write `lastExport`.
- Meta: `id`, `title`, `generation` (monotonic integer), `hash` (`sha256:` + hex of UTF-8 HTML bytes), `viewport` (string, default `"1280x800"`), `updatedAt` (ISO).
- Artboard ids: parse module rejects anything outside `[a-zA-Z0-9._-]+` so `../` cannot leave `.cursor-design/artboards/`.
- Pure helpers (no `vscode`): parse/validate, hash, next generation, named `Error` subclasses. Host I/O via `vscode.workspace.fs` only. MCP stays tool-less.
- Init and load follow the **decision table** in Data / contracts. Never overwrite existing HTML. Do not create `tokens.json`, `assets/`, or `handoff/`.
- Untrusted: no write, no iframe HTML apply (`isTrusted` even though `untrustedWorkspaces.supported` is already `false`).
- No folder: Reveal-style toast; no disk; empty chrome may still open. No `globalStorage` SoT.
- Watcher: `createFileSystemWatcher` on first-folder `.cursor-design/**`, debounce ~200ms, `clearTimeout` on dispose. Subscribe watcher + timer via `context.subscriptions`. If no folder at activate, skip and `ensureWatcher` from Open Artboard. Do not open the panel from the watcher. Do not walk the workspace on activate.
- Chrome stays host-built in `src/panel/`. `enableScripts: true`. Chrome CSP (no `http:` / `unsafe-inline` / `unsafe-eval`): `default-src 'none'`; nonce'd `style-src` and `script-src` plus `webview.cspSource`; `frame-src blob:` (`'self'` only if F5 proves it). One nonce'd chrome script: `acquireVsCodeApi()` once.
- Nested iframe: `sandbox="allow-scripts"`; **omit** `allow-same-origin`. Chrome JS sets `iframe.src` to a **blob:** URL of the posted HTML and revokes the previous blob. Parent never `eval`s or `innerHTML`s artboard HTML. Literal `srcdoc` is forbidden here because it inherits chrome CSP and blocks artboard `<script>` (Notion requires artboard JS). Treat rule 07 "srcdoc" as "nested document, not parent HTML."
- `localResourceRoots` = extension URI only, never the workspace. Relative artboard assets and CDNs do not load in Phase 1. Do not widen CSP to fix that.
- Messages: host → chrome `artboard:updated` `{ artboardId, generation, html, title, viewport }` and `artboard:error` `{ message }` (safe copy). Chrome → host: only `artboard:ready` (then host posts current state). Ignore unknown types. No export/reveal handlers.
- First paint: do not rely on `postMessage` immediately after setting `webview.html`. Hide/show: `onDidChangeViewState` visible → reload from disk. Do not set `retainContextWhenHidden`.
- Chrome UI: empty copy **No artboard yet.** when no HTML; iframe always present; badges for active id + generation.
- First-folder only (`ponytail:`). Multi-root `ambiguous_workspace` is Phase 2. Two windows, same folder: last clean writer wins (`ponytail:`).
- Do not push the panel onto `context.subscriptions` (Phase 0).

## Out of scope

- MCP tools, `baseGeneration` conflicts, MCP-offline banner (feature 3).
- Svelte 5 + Vite + `src/webview/` (even though Notion §6 and coding-standards list them). This branch overrides that for the Phase 1 gate.
- Export, stale badge, `IMPLEMENT.md`, `lastExport` (feature 4).
- Asset pipeline, `asWebviewUri` for workspace files, size warnings, `tokens.json`.
- Gallery, CustomTextEditor, aux window, in-panel chat, `vscode.lm`, `@modelcontextprotocol/sdk`.
- Spreading `process.env`; `activationEvents: ["*"]`; engines bump back to `^1.136`.
- Blueprint Verify / `/tests` / changing `.vscode-test.mjs`. `pnpm test` does not run `src/disk/*.test.ts`.

## Build loop

`workflow.stepReview` is `feature`: one review packet after all steps. `workflow.checkpointCommits` is `disabled`. `/complete` creates the final feature commit.

## Build steps

- [x] **Step 1 - Disk layout + pure SoT helpers** - `src/disk/` paths, `SCHEMA_VERSION = 1`, hash, next generation, id charset, typed parse errors. No `vscode` in parse modules. *Done when:* `pnpm check-types` and `pnpm lint` pass. Compile-only; no new test runner.

- [x] **Step 2 - Host read/write + init on Open Artboard** - Host module using `vscode.workspace.fs`. Open Artboard: trusted + first folder → decision table → load → open panel → wait for `artboard:ready` then post. No folder → toast, no writes, empty chrome OK. *Done when:* `pnpm compile` passes; first Open Artboard creates layout once; second does not overwrite HTML.

- [x] **Step 3 - Nested iframe chrome + postMessage** - `openArtboardPanel.ts`: scripts on; nonce CSP + `frame-src blob:`; `acquireVsCodeApi` once; blob iframe `sandbox="allow-scripts"`; badges; ready + unhide reload; never parent-eval HTML. *Done when:* types and lint pass; pixels are in the iframe, not parent `innerHTML`.

- [x] **Step 4 - Debounced disk watcher** - Watcher + 200ms debounce; hash-equality bump only; post if panel open; dispose watcher + timer. *Done when:* `pnpm compile` passes; saving active HTML refreshes the iframe after debounce; a meta write does not loop generation.

- [x] **Step 5 - Run Extension Phase 1 gate** - Run Extension → `fixtures/dev-workspace` → Open Artboard → edit `artboards/artboard.html` → iframe updates after debounce; generation badge follows one bump per save; chrome console has no CSP error on the chrome script; artboard inline script can run inside the iframe. *Done when:* that pass is recorded. Do not claim it without running it.

## Files / areas

- `src/disk/layout.ts` and new siblings (paths, schema, hash, parse, errors)
- Host I/O + watcher (new host module; not `server.ts`, not parse-only `layout.ts`)
- `src/panel/openArtboardPanel.ts`
- `src/extension.ts` — wire watcher; no panel-on-activate
- Leave MCP, Reveal/Export stubs, `esbuild.js` dual outfiles, engines `^1.128.0`

## Data / contracts

**Decision table (Open Artboard, trusted folder):**

1. `manifest.json` absent (or `.cursor-design/` missing) → create id `artboard`, minimal full HTML document (not the hero+CTA demo), meta `generation: 1` + hash, `activeArtboardId: "artboard"`.
2. Manifest present, JSON corrupt or `version !== 1` → no init, no overwrite; `artboard:error` + OutputChannel; empty copy.
3. Manifest valid, active HTML missing → empty copy + `artboard:error`; do **not** mint a second id. Init may write default HTML only if that HTML file is missing; keep existing generation if meta parses.
4. HTML present, meta missing/corrupt → show HTML; create/update meta on hash change (`generation: 1` if none).
5. Existing active HTML → load; init is a no-op. Never `writeFile` over existing HTML.

**Watcher bump:** after ~200ms, read HTML + meta (coalesce bursts). If `sha256(html) === meta.hash`, do not write; post if panel open. If hash changed or meta missing, write meta (`generation+1` or `1`) then `artboard:updated`. Manifest-only / title-only: refresh badges, no generation bump. Bump even if panel is closed; `postMessage` only if `currentPanel` exists.

- Tenant: first `workspaceFolders[0]` only.
- Errors: named codes; no stacks, home, install paths, or HTML bodies in UI.
- Messages: unknown `type` ignored.

## Testing

No Verify command. Prove with `pnpm compile` / `pnpm check-types` / `pnpm lint` and Step 5. Do not add `*.test.ts` expecting `pnpm test` to pick it up.

Step 5 (Bombic, Extension Development Host on `fixtures/dev-workspace`): Open Artboard init created `.cursor-design/` (manifest + `artboards/artboard.html` + meta, generation 1); editing `artboard.html` refreshes the Artboard panel iframe after ~200ms debounce. Debounce + HTML edit refresh confirmed; CSP console dump and second-open-no-overwrite were not separately reported.

## Notes for the AI

- Review consensus (2026-09-09): Notion §12 is the gate. Svelte and MCP stay out. Blob iframe wins over literal `srcdoc` so artboard JS is not killed by chrome CSP (rule 02/07 intent = isolation + no parent eval, not a CSP inheritance bug).
- Hash-compare is mandatory. Init only when the table says so.
- Host owns watchers and `postMessage`. Pure disk owns schema. Do not put `vscode` in the MCP bundle.
- Leave `engines` at `^1.128.0`.
- Never claim Run Extension evidence that was not run.
- Step 5 evidence (2026-09-09): debounce + HTML edit refresh confirmed by Bombic; CSP console / second-open overwrite not separately dumped.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":9016,"specSha256":"657371dada82e952e66daefea25af425a0c5454bd752082469b4e70ec1d41452","branch":"refs/heads/feature/phase-1-disk-to-pixels","head":"ed3f6eff290542fb61e5b16f4e2d3597c653a8e3","baseRef":"refs/heads/main","baseCommit":"ed3f6eff290542fb61e5b16f4e2d3597c653a8e3","sourceTree":"51690263463ad9f28f464bd9575964b1f5540c60","absentOptional":[]} -->
