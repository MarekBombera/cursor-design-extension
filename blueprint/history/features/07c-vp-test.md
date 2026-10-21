# Feature: vp test

**From build-plan:** feature 7c
**Build attempt:** 1
**Branch:** feature/vp-test
**Status:** verified

## Goal

`vp test` runs the existing unit suite from TypeScript through Vite+'s bundled Vitest. The 13 files next to source keep the same cases; `src/test/**` stays out (Electron / mocha). AGENTS.md gains a Test command. Product behavior does not change.

Source: Notion [0.2.1 — Tooling](https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc) and `blueprint/reference/0.2.1-tooling-review.md` § 7c. Every § 7c item is carried into the steps below. **This spec wins** if the plan's "178" count disagrees: the live inventory is **177** (see Data / contracts). Do not edit the build plan or `project-overview.md` to reconcile the wording.

## In scope

- A `test` block in the existing root `vite.config.ts` (no `vitest.config.ts`).
- Rewrite the 13 unit files' `node:test` imports to `vite-plus/test`. Keep `node:assert/strict`. Keep the two `context.skip('root ignores chmod')` tests.
- `pool: 'forks'`. Discover `src/**/*.test.ts` and exclude `src/test/**`.
- Declare `Test: vp test` in AGENTS.md Commands and replace the opt-in Testing paragraph plus `blueprint/context/coding-standards.md` § Testing so the Blueprint test gate is on.
- Record the step 1 `vp test` output. The lock is **177** (non-root) or the named root line. That record is the done-when print, not a new number in this spec or the build plan.

## Out of scope

- Electron suite home, `compile-tests` / `watch-tests`, `.vscode-test.mjs`, the `package.json` `test` script (`vscode-test`), `@types/mocha` on the main tsconfig, `@vscode/test-cli`, `npm-run-all` (7d).
- Type-aware lint rules and knip (7e).
- fast-check, snapshots, coverage / `@vitest/coverage-v8` (7f).
- MCP client + `InMemoryTransport` contract tests (7g).
- A Verify command, README CI blurb, `.github/workflows/verify.yml` (7h).
- Adding `vitest` as a direct dependency, `import from 'vitest'`, `vitest/*` references, `vite-plus/test/globals`, a second tsconfig, or editing `src/` product modules.
- Running `/tests` or `$tests` (would invent a runner / `package.json` work this spec forbids).
- Changing F5, `pnpm compile` / `pnpm package` / watch, or any artboard / MCP / disk behavior.
- Editing the user-owned build plan's "178" wording or `project-overview.md` (those keep "178").

## Build loop

`workflow.stepReview: feature`: implement every step, then present one review packet.
`workflow.checkpointCommits: disabled`: no checkpoint commits. `/complete` makes the feature commit.

## Build steps

- [x] **1. Config + rewrite so `vp test` is the runner.** On `feature/vp-test`:

  **a. `test` block.** Add this next to the existing `pack` / `lint` / `fmt` blocks in `vite.config.ts` (Vite+ docs: configure Vitest here, not in `vitest.config.ts`):

  ```ts
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/test/**'],
    pool: 'forks',
    passWithNoTests: false,
  },
  ```

  Do not add `globals`, coverage, `fileParallelism`, `test.server`, `deps`, or a `vitest` package. Do not spread Vitest `defaultExclude` (that needs a `vitest/config` import this spec forbids; `include` already scopes to `src/**/*.test.ts`).

  **Type set (7c).** `@types/mocha` stays on the main tsconfig until 7d. Do not enable `vite-plus/test/globals`. Imported `test` / `afterEach` from `vite-plus/test` shadow mocha's globals, so mocha is not in the Vitest type set. Prove after the first rewritten file plus this block that `pnpm compile` still writes `dist/extension.js` and `dist/mcp.js` (`pnpm compile` is the F5 proxy from 7a: `vp check --no-fmt` then `vp pack`).

  **Stop and ask** — do not invent a second tsconfig, remove mocha types, add a `vitest` package, or add `vitest/*` references — if any of these happen:

  - `pnpm run check` or `pnpm compile` fails on `vite-plus/test` vs `@types/mocha`, on unresolved `vite-plus/test`, or on the new `test` key
  - a listed file fails to *load* (MCP ESM, `vscode` in the graph, Vite transform)
  - `vp test` fails from cross-file `process.env` or temp-dir leakage after `pool: 'forks'`
  - any of the 13 files imports a `node:test` binding other than `test` / `afterEach`, or uses a `TestContext` method other than `skip`
  - `vp test` prints any totals other than the two locked lines below

  Isolation is `pool: 'forks'` (cross-file processes). Do not change test bodies or `fileParallelism`. `artboardTools.test.ts` already restores the env keys it mutates in `try/finally`; `artboardChromeHtml.test.ts` does not mutate env.

  **b. Imports.** In the 13 files listed under Files / areas, replace only `from 'node:test'` with `from 'vite-plus/test'`. Leave `node:assert/strict` on every one of those 13. Do not rename imported bindings (`test`, `afterEach`) or test titles. Leave the two `async (context) => { if (process.getuid?.() === 0) { context.skip('root ignores chmod'); return; } … }` bodies (`vite-plus/test` re-exports Vitest 5 `TestContext.skip`).

  *Done when:* `vp test` exits 0. Lock the **numbers**, not Vitest's English phrasing (do not add a custom reporter):

  - Non-root: **177** passed, **0** failed, **0** skipped
  - Root: **175** passed, **2** skipped (the chmod cases), **0** failed

  Any other number: stop and ask. The collected set is exactly those 13 paths and does not include `src/test/extension.test.ts`. Grep of the 13 files has no `node:test` import; the set still contains `node:assert/strict` (do not remove it from any of the 13). `pnpm run check` passes. `pnpm compile` writes `dist/extension.js` and `dist/mcp.js`. `package.json` `scripts.test` is still `vscode-test`. `compile-tests` / `watch-tests` stay in `package.json` and may fail to typecheck `vite-plus/test` until 7d — do not fix them here. Do not use `tsc --outDir out && node --test out/…` after the rewrite — those files no longer register with `node:test`.

- [x] **2. Declare the Test command.** Do not run `/tests`. In `AGENTS.md` Commands, insert this line **immediately after Check**:

  ```text
  - Test: `vp test` (unit suite via Vite+ / Vitest; not `pnpm test`)
  ```

  Replace the Commands Testing paragraph (the one that says testing is opt-in and to run `/tests`) with exactly:

  ```text
  The unit Test command is `vp test` (Vite+ / Vitest; the 13 `src/**/*.test.ts` files excluding `src/test/**`). It is not `pnpm test` (`vscode-test`, Electron).
  ```

  Leave the Browser-testing paragraph. Leave the Core skills bullet for `tests` and the `/tests` skill file as written.

  In `blueprint/context/coding-standards.md` § Testing, replace only the first two paragraphs with exactly:

  ```text
  The Blueprint test gate is on via `vp test` (declared as `Test` in `AGENTS.md` Commands). Logic-bearing steps use that command. `package.json`'s `vscode-test` script (`pnpm test`) does not count as this gate. `/ci` still owns a `Verify` command.

  Do not run `/tests` to add or replace the runner. The Core skills bullet for `tests` in `AGENTS.md` and the `/tests` skill stay as written until a later edit of those files.
  ```

  Keep the existing bullets under that heading (`What to test`, empty suite, file placement).

  *Done when:* those three doc surfaces match the sentences above; `vp test` still matches step 1's totals; no Verify command was added; `/tests` was not run.

## Files / areas

- `vite.config.ts` — add `test` only
- `src/disk/parse.test.ts`
- `src/disk/conflict.test.ts`
- `src/disk/effectiveMeta.test.ts`
- `src/disk/canvasLayout.test.ts`
- `src/disk/canvasView.test.ts`
- `src/disk/handoff.test.ts`
- `src/disk/handoffCanvasHtml.test.ts`
- `src/mcp/artboardTools.test.ts`
- `src/mcp/mcpQueue.test.ts`
- `src/mcp/resolveWorkspaceRoot.test.ts`
- `src/panel/artboardChromeHtml.test.ts`
- `src/panel/canvasSnapshot.test.ts`
- `src/panel/stageGeometry.test.ts`
- `AGENTS.md` — Commands list + Testing paragraph only (not the Core skills `tests` bullet)
- `blueprint/context/coding-standards.md` — § Testing opening paragraphs only

Do not edit `src/test/extension.test.ts`, `.vscode-test.mjs`, `package.json` scripts, `project-overview.md`, the build plan, or `.cursor/skills/tests`. Stop and ask instead of expanding that set.

## Data / contracts

**Count (locked).** Source `test(` inventory at spec time, matching 7a/7b archives. Re-counted for this review: the 13 unit files sum to **177**; `src/test/extension.test.ts` is the mocha sample (**1** `test(`). Together they are the plan / Notion / 7c-review "178". The 7c review's "13 files, 178 tests" mixed that mocha file into the `src/**/*.test.ts` glob. The mocha file is excluded from `vp test` and is not the unit lock.

| File | tests |
|---|---|
| `src/disk/handoff.test.ts` | 23 |
| `src/disk/conflict.test.ts` | 23 |
| `src/panel/stageGeometry.test.ts` | 23 |
| `src/panel/artboardChromeHtml.test.ts` | 25 |
| `src/mcp/artboardTools.test.ts` | 23 |
| `src/disk/canvasLayout.test.ts` | 13 |
| `src/mcp/resolveWorkspaceRoot.test.ts` | 12 |
| `src/disk/parse.test.ts` | 9 |
| `src/disk/canvasView.test.ts` | 8 |
| `src/disk/handoffCanvasHtml.test.ts` | 7 |
| `src/panel/canvasSnapshot.test.ts` | 5 |
| `src/disk/effectiveMeta.test.ts` | 4 |
| `src/mcp/mcpQueue.test.ts` | 2 |
| **Unit total** | **177** |

**177 is frozen.** The only other acceptable `vp test` totals are the named root case (175 passed, 2 skipped). Any other number: stop and ask. Do not reprint a new lock into this spec.

**Runner.** Command: `vp test` (Vite+ 1.3.0, bundled Vitest 5.0.5). Not watch by default (`vp test watch` is optional and not a gate). `vp test` resolves Vitest from `vite-plus` first. APIs come from `vite-plus/test`, which re-exports `vitest`. Do not `import from 'vitest'` (`node_modules/vitest` is not hoisted).

**Config shape.**

```ts
test: {
  include: ['src/**/*.test.ts'],
  exclude: ['src/test/**'],
  pool: 'forks',
  passWithNoTests: false,
}
```

`include` + `exclude` are both required: Vitest's default glob would also see `src/test/**`. `pool: 'forks'` is required so `artboardTools.test.ts` `process.env` stubs and the temp-dir files cannot share a process. `fileParallelism` stays at the Vitest default. `passWithNoTests: false` is required so an empty suite fails (coding-standards).

**Imports.** Only `test` and `afterEach` are imported from the runner today (verified). Rewrite those. `node:assert/strict` stays on all 13. No `describe` / `it` / `expect` / `vi` migration. If a file has another `node:test` binding or another `TestContext` method, stop and ask.

**Skip.** `artboardTools.test.ts` ("filesystem errno…") and `canvasView.test.ts` ("unreadable html…") call `context.skip('root ignores chmod')` when `process.getuid?.() === 0`. Keep that behavior. Vitest 5 `TestContext.skip(note?: string): never` matches.

**Isolation (repo fact, not a new product rule).** `artboardTools.test.ts` mutates `CURSOR_DESIGN_WORKSPACE_ROOTS_ENV` / `CURSOR_DESIGN_WORKSPACE_ROOT_ENV` (restored in `try/finally`) and stubs `McpServer.registerTool`. Several disk/MCP files use `mkdtemp` + `afterEach` cleanup. `artboardChromeHtml.test.ts` does **not** mutate env (the 0.2.1 review note is stale). Forks is process isolation across files, not an env restore.

**Docs / gate.**

- AGENTS.md Test command: `vp test`, placed immediately after Check, with the replacement Testing paragraph above
- `package.json` `"test": "vscode-test"` unchanged (Electron; 7d)
- No project Verify command (7h). `/feature` did not run one.
- Empty suite must fail (`passWithNoTests: false`).
- `/tests` is not run in this feature. The skill catalog line stays.

**Unchanged product contracts.** Disk SoT, MCP tools, chrome CSP, F5 panel, handoff, and exported HTML are out of this diff. `pnpm compile` staying green is the F5 proxy; this feature does not require a live Extension Host run and does not allow F5 to break.

## Testing

After step 2 the Test command exists: `vp test`. Logic-bearing steps later in 0.2.1 use it. This feature adds no product logic and no new cases.

No Browser tests command. No Verify command. Do not run `/tests`. Do not claim a live F5, `.vsix`, or live MCP run as 7c evidence. Compile (`pnpm compile` writing both `dist/` files) is the F5 proxy from the 7a chain — "do not claim F5" means no Extension Host demo, not that F5 may break.

The 177 count above is a source inventory plus 7a/7b archive agreement, not a `/feature`-time run of `vp test` (that run is step 1).

Do not keep the unofficial `tsc --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js` runner as a gate after step 1.

## Notes for the AI

- Read `blueprint/reference/0.2.1-tooling-review.md` § 7c first. Rule for the whole 0.2.1 release: **no product behavior changes.**
- Planned archive path (frozen, attempt 1): `blueprint/history/features/07c-vp-test.md`. Do not bump the attempt.
- Import from `vite-plus/test`, not `vitest`. 7a already recorded the unmet `vitest@5.0.5` peer on `vite-plus-core`; leave `overrides` alone.
- `@types/mocha` stays on the main tsconfig until 7d. Do not enable Vitest globals. That is the 7c-legal type-set fix.
- Leave `compile-tests` / `watch-tests` / `pnpm test` in place so 7d can decide the Electron `out/` story. Those two tsc scripts may go red after the specifier rewrite; that is expected until 7d, not a 7c fail.
- `pretest` is already gone (7b). `.npmrc` `enable-pre-post-scripts` is 7d.
- Do not run `vp migrate`.
- Ponytail: the rewrite is the import line (plus the `test` block and the two doc files). Do not restyle assertions or rename tests.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":13569,"specSha256":"695885997f205cf497a84b63ecb8d330c91121652313df23a04f63929f0ab2f0","branch":"refs/heads/feature/vp-test","head":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","baseRef":"refs/heads/main","baseCommit":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","sourceTree":"2dd733c1c0ff91ff616852c06249cc07485b695e","absentOptional":[]} -->
