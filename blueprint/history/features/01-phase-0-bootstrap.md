# Feature: Phase 0 Bootstrap

**From build-plan:** feature 1
**Build attempt:** 1
**Branch:** `feature/phase-0-bootstrap`
**Status:** verified

## Goal

Phase 0 wiring is already on disk (empty panel, `registerServer` on activate, F5 fixture). Feature 1 hardens leftover host gaps and records F5 evidence. It does not rebuild the panel or MCP stub, and it does not turn on chrome scripts.

## In scope

- Treat existing `src/extension.ts`, `esbuild.js`, `src/mcp/server.ts`, `package.json`, launch/tasks, and command stubs as shipped. Do not rewrite them unless a listed gap is in that file.
- F5 **Run Extension** against `fixtures/dev-workspace`.
- `activate` already registers stdio MCP and must not open the panel. Keep `activationEvents: ["onStartupFinished"]` (not `"*"`, not commands-only).
- One Artboard panel: reveal on repeat **Open Artboard**; close then reopen creates a new panel; copy **No artboard yet.**; complete HTML; `var(--vscode-*)` tokens.
- Empty Phase 0 chrome stays scriptless: `enableScripts: false`. CSP is `default-src 'none'` plus nonce'd `style-src` via `webview.cspSource`. Do **not** add `script-src`, `acquireVsCodeApi()`, or a dummy chrome `<script>`. Rule 07's `enableScripts: true` / nonce'd `script-src` / acquire-once applies when chrome actually has JS (feature 2).
- `localResourceRoots` must not include the workspace. Keep `context.extensionUri` until a `media/` folder exists. Do not create `media/` here.
- Panel lifetime: module singleton + `onDidDispose` clears `currentPanel`. Do **not** `context.subscriptions.push(panel)`.
- MCP: name `cursor-design`; zero tools allowed; `process.execPath` + `dist/mcp.js`; env only `ELECTRON_RUN_AS_NODE=1` and `CURSOR_DESIGN_WORKSPACE_ROOT` (first folder or `""`). Do not spread `process.env`.
- Missing `vscode.cursor.mcp`: OutputChannel `Cursor Design` only. No crash, no UI toast, no stack in UI.
- `registerServer` throw: OutputChannel full detail; short `showErrorMessage`; no stack or install path in UI.
- `unregisterServer` on activate must not block `registerServer` (separate try). Dispose unregister throw: OutputChannel only, no UI.
- Missing `dist/mcp.js`: host must not crash; OutputChannel may name relative `dist/mcp.js`; UI must not include the extension install path.
- Untrusted workspaces: keep `capabilities.untrustedWorkspaces.supported: false`.
- No-folder / empty window: Open Artboard may still show empty chrome; MCP env `""`; no `.cursor-design/` writes; no Phase 0 folder-error toast (Notion 14b is disk, later).
- README load + allowlist + 0-tools note already exists. Do not rewrite README unless F5/CSP instructions are wrong.

## Out of scope

- Disk SoT under `.cursor-design/`, watchers, generation, hash (feature 2).
- Nested sandboxed iframe, `frame-src`, Svelte 5 / Vite chrome, `src/webview/`, `enableScripts: true` (feature 2). v1 stack tables and rule 07 chrome-script lines do not move into Phase 0.
- MCP tools, `baseGeneration`, MCP-offline banner, multi-root `ambiguous_workspace` (feature 3).
- Real export / `IMPLEMENT.md` (feature 4). Release polish (feature 5).
- Opening the panel from `activate`, CustomTextEditor, auxiliary windows, in-panel chat, `vscode.lm`, `@modelcontextprotocol/sdk`.
- Deleting Reveal / Export stubs; adding dummy MCP tools; spreading `process.env`; `retainContextWhenHidden`; `onWebviewPanel` serializer.
- Declaring a Blueprint Verify or test gate (`/ci`, `/tests`). Tests for `activate`.

## Build loop

`workflow.stepReview` is `feature`: one review packet after all steps, not after each step. `workflow.checkpointCommits` is `disabled`. `/complete` creates the final feature commit.

## Build steps

- [x] **Step 1 - Empty chrome stays scriptless** - Change `src/panel/openArtboardPanel.ts` only if needed. Keep `enableScripts: false`. Keep CSP without `script-src`. Keep **No artboard yet.** Stop pushing the panel onto `context.subscriptions`; keep reveal singleton and `onDidDispose`. Do not add `acquireVsCodeApi` or chrome JS. *Done when:* `pnpm check-types` and `pnpm lint` pass; HTML is a complete document; `enableScripts` is false; CSP has `default-src 'none'` and nonce'd `style-src` only; panel is not in `context.subscriptions`.

- [x] **Step 2 - Isolate MCP unregister from register** - Do not recreate the stdio server or esbuild. In `src/mcp/registerCursorDesignMcp.ts`, catch `unregisterServer` separately so a miss cannot skip `registerServer`. Keep missing-API and register-throw channels. Optional: if `dist/mcp.js` is absent, log relative `dist/mcp.js` on OutputChannel and use the existing safe register-failure UI (no install path). *Done when:* `pnpm compile` still writes `dist/extension.js` and `dist/mcp.js`; unregister-absent cannot block register; missing MCP API still has no toast; dispose unregister still has no toast.

- [x] **Step 3 - F5 Phase 0 gate** - Recorded from Bombic's **Run Extension** (not Mac F5 dictation) against `fixtures/dev-workspace`. First launch failed: `engines.vscode` was `^1.136.0` vs Cursor VS Code 1.128.0; unblocked with `package.json` `engines` `^1.128.0` plus `publisher`, plus `.vscode` compile preLaunchTask / compile task / `npm.autoDetect` off / inline esbuild matcher. After relaunch: Command Palette showed **Cursor Design: Open Artboard** (and the other two Cursor Design commands); that command opened an **Artboard** tab with **No artboard yet.** Screenshot confirmed empty chrome. Host did not crash. *Done when:* that empty-panel host gate is recorded. Do not claim CSP console, MCP settings list, second-open-reveal, or close/reopen — those were not dumped.

## Files / areas

- `src/panel/openArtboardPanel.ts` - drop `context.subscriptions.push(panel)` if still present; leave scripts off
- `src/mcp/registerCursorDesignMcp.ts` - unregister/register try split; optional mcp.js preflight log
- Leave unless a listed field is wrong: `src/extension.ts`, `src/mcp/server.ts`, `src/mcp/mcpIdentity.ts`, `esbuild.js`, `package.json`, `.vscode/launch.json`, `.vscode/tasks.json`, `src/types/vscode.cursor.d.ts`, `src/commands/*`

## Data / contracts

- No `.cursor-design/` writes. Disk schema is later.
- ViewType `cursorDesign.artboard`. Title `Artboard`. Command `cursor-design.openArtboard`.
- MCP `name`: `cursor-design`. Stdio child: `process.execPath` + `dist/mcp.js`. Env keys only as in scope.
- `CURSOR_DESIGN_WORKSPACE_ROOT`: first `workspaceFolders` `fsPath` or `""` (first-folder ceiling until feature 3).
- Trusted actor: workspace-kind extension; untrusted does not activate; UI/MCP text must not include stacks, install paths, or home paths.
- Webview: do **not** register `onDidReceiveMessage`. Do **not** enable scripts or call `acquireVsCodeApi` in this feature. Parent must not `eval` or execute artboard HTML (none exists).
- Idempotency: second Open Artboard reveals; activate unregister miss still registers; dispose unregisters without throwing to the host.

## Testing

AGENTS.md has no Verify command and does not list a test gate. Do not add tests for `activate`. Prove with `pnpm compile` / `pnpm check-types` / `pnpm lint` and the F5 step. No Browser tests command. CSP console / MCP list were not dumped; no errors were reported.

## Notes for the AI

- Rule 07 chrome-script lines (`enableScripts: true`, nonce'd `script-src`, `acquireVsCodeApi` once) are the contract for chrome that has JS. Phase 0 empty HTML is not that. VS Code disables webview scripts by default; do not add a no-op script to satisfy 07 early.
- Host owns the panel and `registerServer`. MCP process owns tools later. Do not put `vscode` in the MCP bundle.
- Do not invent MCP tools, disk watchers, or an MCP-offline banner.
- Ponytail: first workspace folder only is already marked; do not expand to multi-root.
- Never claim F5 or CSP-console evidence that was not run.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":7814,"specSha256":"49faac5ef1825105479d460864d514ea47d3f9f02f2b64de9bf031b68b182e96","branch":"refs/heads/feature/phase-0-bootstrap","head":"b4e51fbcebcb850953a3cbc113ca5304bbc33028","baseRef":"refs/heads/main","baseCommit":"b4e51fbcebcb850953a3cbc113ca5304bbc33028","sourceTree":"343f0d0e2af16340441e37f9c93788476a9d867d","absentOptional":[]} -->
