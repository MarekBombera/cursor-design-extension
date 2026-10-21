# Feature: MCP contract tests

**From build-plan:** feature 7g
**Build attempt:** 1
**Branch:** `feature/mcp-contract-tests`
**Status:** verified

Planned archive: `blueprint/history/features/07g-mcp-contract-tests.md`

Parent: 7. **0.2.1 Tooling** - no product features and no behavior changes.

Stack tip: branch from `feature/test-depth` at `6634262`. That SHA is the **create-from tip** only. Do not branch from `main` (`main` is still 7b, `43cce2c`). After step 1, HEAD will move; steps 2-4 must not require `git rev-parse HEAD` to stay `6634262`.

## Goal

Add MCP contract tests that drive the real `McpServer` plus `registerArtboardTools` through `@modelcontextprotocol/client` over a real in-memory transport. Cover all 8 tools and lock the full `listTools` name set. Characterise **current** client-visible success and error shapes. Never change product behavior, schemas, handlers, or the stub handler suite.

## In scope

- Create `feature/mcp-contract-tests` from the 7f tip (`6634262`) and re-measure the `vp test` baseline before adding the client.
- Add `@modelcontextprotocol/client` as a **direct `devDependency` used only by tests**, range `^2.2.0`. Record the resolved version in implement chat notes. Do not add it as a runtime dependency. Do not add it to `vite.config.ts` `deps.alwaysBundle`.
- Prove `import { Client, InMemoryTransport } from '@modelcontextprotocol/client'` and `InMemoryTransport.createLinkedPair()` from that same import (both pair halves). Record that path in the new test file. If that export is missing after install, **stop and ask Bombic**.
- New contract file `src/mcp/artboardTools.contract.test.ts` only. Per test: `mkdtemp`, `new McpServer({ name: CURSOR_DESIGN_MCP_SERVER_NAME, version: process.env.CURSOR_DESIGN_VERSION ?? '0.0.0' })`, `registerArtboardTools(server)`, `new Client({ name: 'cursor-design-contract', version: '0.0.0' })`, one `createLinkedPair()`, connect both. Do not spawn `dist/mcp.js`. Do not use `StdioServerTransport`.
- Happy path through `client.callTool` (or the equivalent published Client method) using one local `ARTBOARD_TOOL_NAMES` array and one happy-path record keyed by those constants (mechanism below).
- `listTools` sorted names equal that same array. Extra or missing name fails. Do not invent a 9th product tool. Do not lock title, description, or schemas.
- Failure / edge through the real client, characterising the **observed resolved** client-visible result (`isError`, text, `structuredContent`). Do not require stub-identical `CallToolResult` wrapping.
- Contract tests run **serially within the file** (plain `test()`). Set and restore both workspace-root env vars per test. `afterEach` closes the client, then the server, then removes temp dirs. Keep `vite.config.ts` `test` keys unchanged (`pool: 'forks'`).
- Keep `src/mcp/artboardTools.test.ts` (stub `registerTool` suite). Prefer local helpers in the new file. Extract a tiny shared helper only if both files would otherwise copy more than a few lines.
- `pnpm knip` stays exit 0 because the contract file imports the client. Do not add knip ignores.
- `pnpm compile` still writes `dist/extension.js` and `dist/mcp.js`. No product file imports the client.
- Import `test` / `afterEach` from `vite-plus/test`. Use `node:assert/strict`. Do not add a direct `vitest` dependency.

## Out of scope

- 7h Verify + CI + F5 / `.vsix` smoke
- Product, MCP, disk, or panel edits, including schema tightening and handler refactors
- Replacing or deleting `src/mcp/artboardTools.test.ts`
- Re-proving stub-only disk / symlink / chmod cases in the contract file
- Adding the client to the vsix bundle or `alwaysBundle`
- Electron suite (`src/test/**`, `pnpm test`), Playwright, coverage thresholds
- Inventing a fake in-process transport, or changing the server so a transport can be invented
- Switching to `handler.fetch` / `StreamableHTTPClientTransport` unless Bombic says so after a failed pair
- Editing `vite.config.ts` `test` keys (`fileParallelism`, `singleFork`, `sequence.concurrent`, pool)
- Exporting a shared tool-name array from `toolNames.ts` (product edit)
- Adding a repo implement-notes log file (chat notes for `/implement` are enough)
- Editing `blueprint/build-plan.md` or `blueprint/context/project-overview.md`

## Build loop

- `workflow.stepReview: feature` - one review packet after all steps
- `workflow.checkpointCommits: disabled` - no checkpoint commits. `/complete` makes the feature commit
- `verification.logicTests: when-configured` - Test command exists (`vp test`)
- `verification.uiEvidence: when-available` - no Browser tests command; no F5 required for 7g
- Verify command: **skipped because undeclared** (7h owns it). Do not invent a Verify script or claim a Verify run.

Each step leaves the project working. `/complete` creates the feature commit.

## Build steps

- [x] **1. Branch from 7f and re-measure the `vp test` baseline**
  Create `feature/mcp-contract-tests` from `feature/test-depth` at `6634262`. Do not add dependencies or new files yet. Run `vp test` and record the observed file count and pass count (7f lock to re-measure: 186 passed across 13 files, or 184 + 2 skipped if uid 0). Do not hard-code a new final count.
  **Done when:** this step's `git rev-parse HEAD` is `6634262` on `feature/mcp-contract-tests` (create-from tip only; later steps change HEAD); `vp test` output is recorded (files + passed / skipped); `package.json` still has no `@modelcontextprotocol/client`; product sources are unchanged.

- [x] **2. Add the MCP client and prove one in-memory smoke**
  Add `@modelcontextprotocol/client` as a direct `devDependency` with range `^2.2.0`. Record the resolved version in implement chat notes. After install, import `Client` and `InMemoryTransport` from `@modelcontextprotocol/client` and call `InMemoryTransport.createLinkedPair()` for **both** halves. Do not import `InMemoryTransport` from the server package in this file (pair copies are private per package). If the client export is missing, **stop and ask Bombic**. Do not invent a fake transport. Do not switch to `handler.fetch`. Do not add the client to `alwaysBundle`.
  Add `src/mcp/artboardTools.contract.test.ts` (this is the only new test file). Comment the proven import path including `createLinkedPair`.
  Per test: `mkdtemp`; `new McpServer({ name: CURSOR_DESIGN_MCP_SERVER_NAME, version: process.env.CURSOR_DESIGN_VERSION ?? '0.0.0' })`; `registerArtboardTools(server)`; `new Client({ name: 'cursor-design-contract', version: '0.0.0' })`; one linked pair; connect both.
  `afterEach` (imported from `vite-plus/test`) owns teardown: close the client first, then `server.close()` (exists on installed `McpServer`), then `rm` temp roots. Copy the stub suite's `tempRoots` pattern into this file; do not edit the stub.
  Two smokes that stay as the step-3 table entries for those names: `listTools` returns tool names; `list_artboards` on an empty temp dir with both env root vars set and restored succeeds with empty `artboards` and `frames` (not an error). Import the 8 constants from `src/mcp/toolNames.ts` into one local `ARTBOARD_TOOL_NAMES` array (do not re-type strings; do not edit `toolNames.ts`). Use `node:assert/strict`.
  **Done when:** the client is a direct `devDependency` `^2.2.0` only; the contract file imports `InMemoryTransport` from `@modelcontextprotocol/client` and uses `createLinkedPair` from that same import (comment the path); `vp test` is green including the new file; `listTools` and one successful empty-dir `list_artboards` run through the real server; `afterEach` closes client then server and removes temps; no product file changed; if the client pair cannot be proven, work is stopped for Bombic (no invented transport).

- [x] **3. Cover the remaining tools, the `listTools` lock, and current errors**
  Same file as step 2. Do not add a second contract file. Keep the step-2 `list_artboards` smoke as that tool's happy-path case. Do not delete the smokes.
  Keep the file serial: plain `test()` only. Do not use `test.concurrent` or `describe.concurrent`. Do not add `test.sequential` (removed in Vitest 5). Do not set `sequence.concurrent`. Do not change `vite.config.ts` `test` keys.
  Restore both `CURSOR_DESIGN_WORKSPACE_ROOTS_ENV` and `CURSOR_DESIGN_WORKSPACE_ROOT_ENV` in `try/finally` on every case that touches env, including delete when previously unset.
  In this file only, one `ARTBOARD_TOOL_NAMES` array of the eight imported constants. `listTools` asserts `tools.map((tool) => tool.name)` sorted-set equals that array. Happy-path is a record/map keyed by those constants; `Object.keys(happyPath)` sorted-set equals the same array. One successful `callTool` per key. A new registered tool that is not in the array, or an array name with no record case, fails.
  Assert tool outcomes on the **resolved** `callTool` value (`isError`, content, `structuredContent`). Do not wrap `callTool` in try/catch and treat a throw as a passing tool-error characterisation. Lock a throw only when a required case actually throws (SDK reject before the handler).
  Happy-path calls (keys of that record):

  | Constant | Seed | Success call |
  |---|---|---|
  | `LIST_ARTBOARDS_TOOL` | empty temp dir, both env roots set, no `set_artboard` | `{}` → success, `artboards: []`, `frames: []` (the step-2 smoke) |
  | `SET_ARTBOARD_TOOL` | empty temp dir, both env roots set | `{ artboardId: 'hero', html: '<p>hero</p>' }` → success |
  | `UPDATE_ARTBOARD_TOOL` | `set_artboard` hero as above | `{ artboardId: 'hero', html: '<p>v2</p>', baseGeneration: 1 }` → success |
  | `READ_ARTBOARD_TOOL` | `set_artboard` hero as above | `{ artboardId: 'hero' }` → success |
  | `SET_ACTIVE_ARTBOARD_TOOL` | `set_artboard` `hero` then `hero-alt` (second is active) | `{ artboardId: 'hero' }` → success; then omit-id `read_artboard` returns `hero` |
  | `EXPORT_ARTBOARD_TOOL` | `set_artboard` hero (creates HTML and sets active) | `{}` → success |
  | `HANDOFF_STATUS_TOOL` | `set_artboard` hero, then `export_artboard` | `{}` → success; characterise client JSON as `HandoffStatusResult` (`stale: false`, `lastExport` present; **no** `exported` key) |
  | `PLACE_FRAME_TOOL` | `set_artboard` `hero` and `hero-alt` | `{ id: 'hero' }` → success; returned `frames` present; `canvas.json` was written |

  Extra characterisations (same 8 names; not a 9th tool):
  - Current rule: `set_artboard` always sets active (`CreateArtboardResult.active` is `true`). After one successful `set_artboard`, omit-id `read_artboard` reads that id. That does **not** replace the two-id `SET_ACTIVE_ARTBOARD_TOOL` row.
  - Do not call `handoff_status` or `export_artboard` on an empty temp dir as the happy path (`export` is `ARTBOARD_NOT_FOUND` / `NoArtboardsToExportError`; status is `ARTBOARD_NOT_FOUND` via `requireActiveManifest`).
  - `place_frame` uses the stub seed (`hero` + `hero-alt`). Do not copy disk/symlink/chmod cases.
  Failure / edge through the real client (characterise observed resolved `isError` / text / `structuredContent`; if the SDK wraps differently than stub `CallToolResult`, lock the wrapper; do not change product):
  - No workspace env (delete `CURSOR_DESIGN_WORKSPACE_ROOTS_ENV` and `CURSOR_DESIGN_WORKSPACE_ROOT_ENV`) - current handler code is `NO_WORKSPACE`.
  - Unknown `rootPath` - current handler code is `INVALID_ROOT` plus `roots`.
  - `update_artboard` stale generation - current handler code is `conflict` with expected / actual compared fields.
  - `place_frame` unknown id - current handler code is `ARTBOARD_NOT_FOUND`.
  - `export_artboard` with `artboardId` present - current handler authors `INVALID_ARGS` and `export_artboard exports every frame. Omit artboardId and retry.` (passthrough schema still delivers `artboardId` today). If the client path differs, lock the observed shape.
  - Wrong-typed args sent as `html: 42`, `baseGeneration: '1'`, `rootPath: {path}`. JSON-RPC / the client SDK may reject, coerce, or drop the value before the handler. Lock the observed resolved shape, or the thrown name/message if that case actually throws. Do not require handler-side `INVALID_ARGS` if the SDK rejects first. Do not tighten schemas.
  - Concurrent `update_artboard` on one generation: one connected `McpServer` + one client + one linked pair; `Promise.all` two updates with `baseGeneration: 1` after one `set_artboard`. Queue is in-process FIFO (`enqueueDiskOp`). Match the stub: first `Promise.all` element succeeds, second is `conflict` with `expectedGeneration` / `actualGeneration`; HTML is the first update.
  **Done when:** `vp test` is green; the new file covers all 8 tools plus the `listTools` exact-name-set lock plus the failure list above; cases are serial, restore both env vars, and close the pair; `src/mcp/artboardTools.test.ts` still exists and still uses the stub `registerTool`; no product sources changed.

- [x] **4. Confirm knip, compile, and observed test counts**
  Run `pnpm knip` (must exit 0; the contract file import is what knip sees; no new ignores). Run `pnpm compile` and confirm it still writes `dist/extension.js` and `dist/mcp.js`. Re-run `vp test` and record observed file count and pass count versus the step-1 baseline in implement chat notes (do not add a repo log file). The new file must increase the unit-test file count by 1 and add the contract cases. Do not invent a final number you did not observe. Electron (`src/test/**`, `pnpm test`) stays out. No F5 / `.vsix` proof.
  **Done when:** `pnpm knip` exits 0; `pnpm compile` wrote both `dist/` files; no product source files changed; `vp test` file count is baseline + 1; observed before/after pass counts are recorded in implement chat notes; `alwaysBundle` is still only `/^@modelcontextprotocol\/server(\/|$)/` and `/^zod(\/|$)/`.

## Files / areas

| Path | Role |
|---|---|
| `src/mcp/artboardTools.contract.test.ts` | **New.** Real client + in-memory transport contract suite. Locked name. Owns `ARTBOARD_TOOL_NAMES` array. |
| `src/mcp/server.ts` | Construction pattern only (`McpServer` + `registerArtboardTools`, version fallback `'0.0.0'`). Do not spawn this entry. Do not edit. |
| `src/mcp/artboardTools.ts` | Registers the 8 tools; permissive `fromJsonSchema`; `toMcpToolError`. Do not edit. |
| `src/mcp/toolNames.ts` | Import these 8 constants. Do not re-type tool name strings. Do not edit. Do not add an exported array. |
| `src/mcp/mcpIdentity.ts` | `CURSOR_DESIGN_MCP_SERVER_NAME`, `CURSOR_DESIGN_WORKSPACE_ROOT_ENV`, `CURSOR_DESIGN_WORKSPACE_ROOTS_ENV`. Do not edit. |
| `src/mcp/artboardTools.test.ts` | Existing stub `registerTool` suite. Keep. Disk / symlink / chmod cases stay here. Copy `tempRoots` pattern only. |
| `src/mcp/mcpQueue.ts` | In-process FIFO write queue (concurrent update characterisation). Do not edit. |
| `src/disk/errors.ts` | Current codes (`NO_WORKSPACE`, `INVALID_ROOT`, `INVALID_ARGS`, `ARTBOARD_NOT_FOUND`, `conflict`). Characterise through the client; do not edit. |
| `src/disk/artboardFs.ts` | `HandoffStatusResult`, `readHandoffStatus` (needs active HTML), `set_artboard` sets active. Do not edit. |
| `package.json` / lockfile | Direct `devDependency` `@modelcontextprotocol/client` `^2.2.0` only. |
| `vite.config.ts` | Keep current `test` keys and `alwaysBundle`. Do not add the client. |
| `knip.json` | Entries already include `src/**/*.test.ts`. Do not add ignores. |

## Data / contracts

Locked product rule: no product features and no behavior changes. Tests characterise **current** behavior. If the real client path returns a different error than the stub tests (for example an SDK "Input validation error"), fix the test, not the product.

**Tools** (import constants; do not re-type strings):

`set_artboard`, `update_artboard`, `read_artboard`, `list_artboards`, `set_active_artboard`, `export_artboard`, `handoff_status`, `place_frame`

`registerArtboardTools` in `src/mcp/artboardTools.ts` registers exactly those 8. In the contract file only, collect them into `ARTBOARD_TOOL_NAMES`. `listTools` compares sorted names only. Schemas are permissive `fromJsonSchema` with `additionalProperties: true` and description-only properties so wrong-typed args can reach the handler. Comment in source: "Schemas stay permissive on purpose". Do not tighten them.

**Handler error envelope today** (stub suite sees this directly):

`toMcpToolError` returns `{ content: [{ type: 'text', text: JSON.stringify(body) }], isError: true }` with `code`, `message`, optional `artboardId` / conflict compared fields / `roots`. Disk errors log stack to stderr and omit paths / errno from the tool text.

Published client testing docs: a handler `isError` **resolves**; there is nothing to `catch`. Contract tests must **not** assume `JSON.parse` of the first text block still works. Capture the resolved client-visible result (`isError`, text blocks, `structuredContent`) and lock what the real path returns. Current codes to expect when the handler still runs:

| Case | Current handler code |
|---|---|
| No workspace env | `NO_WORKSPACE` |
| Unknown `rootPath` | `INVALID_ROOT` + `roots` |
| Stale `update_artboard` | `conflict` (`expectedGeneration` / `actualGeneration`, `artboardId`) |
| `place_frame` unknown id | `ARTBOARD_NOT_FOUND` |
| `export_artboard` with `artboardId` | `INVALID_ARGS` + authored omit-id message |
| Wrong-typed args that reach the handler | `INVALID_ARGS` |
| `export_artboard` / `handoff_status` with no active HTML | `ARTBOARD_NOT_FOUND` (not a happy-path) |

If the SDK rejects before the handler, lock that observed thrown name/message for that case only.

**Workspace roots:** `parseWorkspaceRootsEnv(process.env)` at call time (`CURSOR_DESIGN_WORKSPACE_ROOTS_ENV` / `CURSOR_DESIGN_WORKSPACE_ROOT_ENV`). Set env per test; restore both in `try/finally`, including delete when previously unset.

**Active artboard:** `set_artboard` / `createArtboard` always writes the id as active (`active: true`). After one `set_artboard`, omit-id `read_artboard` reads that id. A later `set_artboard` becomes the new active. The `set_active_artboard` happy path therefore seeds two ids, activates the first, and omit-id read must return the first.

**Empty temp dir vs seeded canvas:**

- `list_artboards` with env roots and no `.cursor-design/artboards/` → success `{ activeArtboardId: '', artboards: [], frames: [] }`.
- `export_artboard` with no artboards → `ARTBOARD_NOT_FOUND` (`NoArtboardsToExportError`).
- `handoff_status` with no active artboard → `ARTBOARD_NOT_FOUND` (`requireActiveManifest` / `requireArtboardHtml`).
- Happy-path export+status seed is `set_artboard` then `export_artboard` then `handoff_status`.

**Handoff after export:** `HandoffStatusResult` is `{ stale, activeArtboardId, activeHash, lastExport? }`. After a successful export, current disk behavior is `stale: false` with `lastExport` present. Characterise the client-visible JSON. `compareCanvasHandoff` returns `{ exported, stale }` (`HandoffCompare`); `readHandoffStatus` uses only `.stale` and never copies `exported` onto the MCP result. Do not add an `exported` field to product. Do not assert `exported` on `handoff_status`.

**Transport:** Official v2 testing docs: `import { InMemoryTransport } from '@modelcontextprotocol/client'` then `createLinkedPair()` for both halves. Installed `@modelcontextprotocol/server` `2.2.0` root barrel also exports the class (there is no `./inMemory` subpath), but this file must not mix packages. Step 2 proves the client export + pair. If it cannot be imported, stop and ask Bombic. Do not invent a transport. Do not use `handler.fetch` unless Bombic says so.

**McpServer version:** `process.env.CURSOR_DESIGN_VERSION ?? '0.0.0'` (production fallback). Client identity: `{ name: 'cursor-design-contract', version: '0.0.0' }`.

**Concurrency:** Vitest 5 in-file default is sequential (`sequence.concurrent` default `false`). Plain `test()` is enough. Concurrent-update case uses one connected server; first `Promise.all` element wins.

**Teardown:** `afterEach` closes client then server (both have `close` on the installed APIs), then removes temp dirs.

## Testing

- Test command: `vp test` (Vite+ / Vitest). Not `pnpm test` (Electron).
- Verify: skipped because undeclared. 7h owns Verify + CI. Do not invent Verify.
- Browser tests: none declared. No F5 required for 7g.
- Re-measure the 7f-tip baseline in step 1, then require file count +1 and the new contract cases. Implement records observed before/after in chat notes. Do not hard-code a final count in this spec.
- Logic-bearing work is the contract file itself. Import `test` / `afterEach` from `vite-plus/test`. Use `node:assert/strict`.
- `vite.config.ts` already includes `src/**/*.test.ts` and excludes `src/test/**`. `passWithNoTests` is false. Do not change `test` keys.
- knip: `pnpm knip` must stay exit 0. Client must be imported from a unit test. Do not add knip ignores without asking.
- Electron suite stays out.

## Notes for the AI

- 0.2.1 rule: no product behavior change. Fix the test, not the product.
- Identity is frozen: feature 7g, attempt 1, branch `feature/mcp-contract-tests`, archive `blueprint/history/features/07g-mcp-contract-tests.md`. Do not auto-bump.
- Do not edit `blueprint/build-plan.md` or `blueprint/context/project-overview.md`.
- Call sites import tool name constants from `src/mcp/toolNames.ts`. Collect `ARTBOARD_TOOL_NAMES` in the contract file only.
- `6634262` is the create-from tip / step-1 done-when only.
- Prove client `InMemoryTransport.createLinkedPair` in step 2 or stop and ask Bombic.
- Do not add the client to `alwaysBundle` or to `dependencies`.
- Do not spawn stdio / `dist/mcp.js`. Do not start `startCursorDesignMcpServer`.
- Keep the stub suite. Do not fold it into the contract file.
- Characterise resolved client-visible errors. Do not catch `callTool` as a passing tool error.
- Serial within the contract file. Restore both env names. Close the pair. Do not change the forks pool.
- No Verify claim. No F5 / `.vsix` proof. No coverage thresholds. No direct `vitest` dependency.
- No em dashes (U+2014) in generated spec text, comments, or notes.
- Plan-review checks (`blueprint/reference/0.2.1-tooling-review.md` § 7g): real client + in-memory transport through the real server; all 8 tools; full `listTools` set; characterise current errors; env at call time; serial within the file.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":22366,"specSha256":"bdc2a6e919b2bf5cb34a0c8dbfc3c3f59fa3212ff549d45b26a98d841d86f482","branch":"refs/heads/feature/mcp-contract-tests","head":"6634262081f9d5a36de1b8cde1e4b720f5dcacfb","baseRef":"refs/heads/main","baseCommit":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","sourceTree":"eb27e7110b1fa423c78babc0b51f0bbb03e0c1dc","absentOptional":[]} -->
