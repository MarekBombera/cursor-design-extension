# Feature: Test effectiveness review

**From build-plan:** feature 11f
**Build attempt:** 1
**Branch:** feature/test-effectiveness-review
**Status:** verified (all six steps done; `pnpm verify` 65 files, 794 tests)

## Goal

Prove the tests catch real bugs, not just run. Find the tests that would stay green with the code broken, the tests that only check mocks or restate the code, and the risky paths nothing tests. Write one ranked report, then apply every confirmed item: remake or remove useless tests, strengthen weak ones, and fix real product bugs each behind a test that fails first (Bombic, 2026-11-23: fix bugs inside 11f, no pick stop). Fewer, sharper tests beat more tests: deleting a test that catches nothing is a win.

No product behavior changes except fixing real bugs the review finds (B items, Step 5). No new dependency in `package.json`. Checking the 11f box in `build-plan.md` is `/complete`'s job.

Report sections, in this order: Baseline, Mutation, Coverage gaps, Ranked (B, D, S, M, P, Disputed, Equivalent), After.

## In scope

- **Baseline:** unit and browser test counts, `vi.mock(` calls per test file, coverage summary for all of `src/`.
- **Mutation run (one-off):** StrykerJS over the mutation scope (below) in a throwaway detached git worktree under the session scratchpad. Stryker is installed only inside that worktree; nothing Stryker-related is added to `package.json`, the lockfile, `.gitignore` or any committed file. Raw Stryker output is kept under `test-results/11f-mutation/` (gitignored, survives sessions, never committed).
- **Coverage gaps:** risky paths with no test or no assertion: error paths, lock timeout and stale lock, conflict branches, migration resume, refusal branches in host answers.
- **Two reviewers** (lanes and cross-check below) reading the tests against the surviving mutants, the coverage gaps, the mock-heavy host tests and `tests/browser/`.
- **Ranked report** at `blueprint/reference/11f-test-review.md` (committed).
- **Apply confirmed items:** delete, remake, strengthen, merge duplicates, or move a test to its module's exported functions (D, S, M); fix each confirmed product bug (B) test-first.
- **Re-measure:** one more Stryker run over the full mutation scope with the changed tests; before/after in the report.

### Mutation scope

- `src/disk/*.ts` (not `*.test.ts`, not `selectorMatch.cases.ts`). Files with no unit test (`hash.ts`, `layout.ts`, `layoutFs.ts`, `exportFs.ts`, `commentViews.ts`) are mutated too; their no-coverage mutants are listed once per file (count), not per mutant.
- Pure webview rule modules: `src/webview/*.ts` (non-recursive) excluding `*.svelte.ts`, `main.ts` and test files. `src/webview/ui/*.ts` is out (no tests, UI helpers).
- Pure frame modules with unit tests: `src/webview/frame/{anchorRects,frameMessages,pickPath,pickTarget,selector}.ts`. Not `runtime.ts`, `commentPicking.ts`, `editTarget.ts`, `pinAnchors.ts` (DOM glue; browser tests own them).
- Out of mutation scope (reviewed by reading plus revert probes): `src/host/`, `src/mcp/`, `src/panel/`, `src/commands/`, `src/extension.ts`, `.svelte` files, `tests/browser/`.

## Out of scope

- Product bugs whose fix is more than a local change in the module that owns it (a new message, MCP arg, error code, disk format, or more than about 30 changed product lines): record it as B with "needs own /fix" and ask Bombic; do not build it here. 11f never writes `blueprint/context/findings.md` (`/audit` owns it).
- Rewriting host tests onto ports (11c). The report lists which host tests 11c should rewrite (P ids); 11f only deletes host tests that a probe shows check nothing.
- Raising coverage for its own sake, coverage thresholds, adding Stryker or any mutation tooling to the repo or CI.
- Any test framework beyond Vitest and Playwright; any new fixture directory.
- Refactors of product code (11a to 11e). Updating `project-overview.md` for item 11 (`/overview`'s job).

## Build loop

`workflow.stepReview: feature` and `checkpointCommits: disabled`: run every step, review once at the end. No pick stop (Bombic, 2026-11-23): every confirmed item is applied. Steps 5 and 6 rely only on the report and `test-results/11f-mutation/`, never on the session scratchpad.

**Probe copy** (used by Steps 2, 4 and 6): `git worktree add --detach <scratchpad>/<name> HEAD`, then `pnpm -C <path> install --frozen-lockfile --ignore-scripts`. Remove with `git worktree remove --force <path>`, then `git worktree prune`; `git worktree list` shows only the main tree afterwards.

## Build steps

1. **Branch + baseline.** Create `feature/test-effectiveness-review` from `main`. Create `blueprint/reference/11f-test-review.md` with a Baseline section:
   - unit test files and tests from `pnpm test` (today 64 / 836);
   - browser specs and tests from `pnpm exec playwright test -c tests/browser --list`;
   - `vi.mock(` calls per test file, measured with `grep -c 'vi.mock('` over every `src/**/*.test.ts` (today: `panelEdit` 6, `panelComments` 5, `artboardDisk` 5, `panelEdit.history` 3, `canvasSnapshot` 3, and 1 each in `hostFs`, `artboardChromeHtml`, `disk/comments`, `openPage`, `artboardEditFs`, `frame/selector`). This is the metric 11c compares against; it excludes `vi.mocked`;
   - line and branch coverage per directory from `pnpm coverage --coverage.include='src/**/*.ts' --coverage.reporter=text --coverage.reporter=json-summary` (CLI flags only; `vite.config.ts` unchanged), so files no test imports show as 0%.
   - Done when: the Baseline section has every number above measured on the branch, and `pnpm verify` passes.

2. **Mutation run.** Create the probe copy `stryker-wt`. Inside it only, add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` at their latest versions published at least two weeks earlier (check with `npm view <pkg> time`; record the versions in the report).
   - **One Vitest copy:** every test imports `vite-plus/test`, which re-exports `vitest` from vite-plus's own pnpm copy. Before the dry run, check that `realpath` of the `vitest/package.json` the runner resolves equals the one `vite-plus` resolves. If they differ, add a worktree-only `vitest.config.ts` mirroring the repo test block (`include: ['src/**/*.test.ts']`, `pool: 'forks'`) with `resolve.alias: { 'vite-plus/test': 'vitest' }`. Record which path was used.
   - **Config:** `mutate` = the mutation scope, `testRunner: 'vitest'`, `coverageAnalysis: 'perTest'`, `disableBail: true` (so `killedBy` lists every killing test, needed for the delete rule), `concurrency: 4` (same in Step 6, so runs compare), JSON + HTML reporters into `test-results/11f-mutation/before/` of the main tree.
   - **Dry run** must pass all unit tests. **Time bound, either runner:** estimate from Stryker's ETA after the first 5 minutes; if it exceeds 60 minutes, stop the run and ask Bombic (property tests with `numRuns` up to 3000 are the likely cost).
   - **Fallback** if the vitest runner cannot work: Stryker command runner on `vp test <dir>` per module group, same 60-minute rule. It has no `killedBy`, so D items for mutation-scope tests then need a one-off check (delete the test in the probe copy, re-run Stryker on its source file) or are not proposed.
   - Write to the report: runner and versions; per file the mutation score, killed, survived, timed-out and no-coverage counts (timeouts listed separately, never counted as proof a test asserts something); surviving mutants grouped by file, one full line (`file:line mutator original -> replacement`) for each non-equivalent survivor, equivalents as a count with one line why.
   - Remove the probe copy.
   - Done when: the Mutation section covers every file in scope, the dry run is recorded as all-pass, `git diff --name-only main -- src tests package.json pnpm-lock.yaml vite.config.ts` is empty, and `git worktree list` shows only the main tree.

3. **Coverage gaps.** Two checks, results in the Coverage gaps section as `file:line` plus what breaks if that path is wrong:
   - From the Step 1 coverage run (main tree): lines with zero hits and branches never taken that are error or refusal paths. Disk: lock timeout and stale lock in `workspaceLock.ts`, conflict paths, migration resume in `openPage.ts`. Host and MCP: untrusted-workspace and wrong-page refusals, untested files such as `watchArtboardDisk.ts`, `handleOpenArtboard.ts`. Skip uncovered happy-path glue.
   - Every error code in `src/disk/errors.ts`, grepped against `src/**/*.test.ts`: a code no test asserts (by code value, not just "throws") is a gap.
   - Done when: the section lists both checks' results (empty says "none").

4. **Review + ranked report.** The implementing agent dispatches two subagents at the same time, each `model: opus`, `effort: high` set explicitly. Each gets the report so far and rule 09. Neither edits the main tree.
   - **Lane A (Opus 5.5 high):** `src/host/*.test.ts`, `src/mcp/*.test.ts`, `src/panel/*.test.ts`, `tests/browser/*.spec.ts`. Looks for: assertions that only check a mock was called with no check of what the user or disk sees, tests that pass with the guarded branch deleted, browser specs that pass with the feature broken. Proves claims only in its own probe copy `laneA-wt`: unit revert probes (revert the guarded line, `vp test <file>`, restore) and at most 5 browser revert probes (`vp build -c vite.webview.config.ts`, then `pnpm exec playwright test -c tests/browser <file> --grep "<test>"`). Every host, MCP or browser D item needs one probe result as evidence.
   - **Lane B (Opus 5.5 high):** every `src/disk/*.test.ts` and `src/webview/**/*.test.ts` (including `frame/runtime.test.ts`, `selectorMatch.oracle.test.ts`, `commentTarget.roundtrip.test.ts`) against the survivors and `killedBy`. Looks for: tautologies (expected value computed by the code under test), logic covered only by a snapshot, tests reaching private internals instead of the module's exports, duplicates (same branch, same assertion), and which survivors matter versus equivalent mutants. Runs no browser tests and no probes; its D evidence is `killedBy` (the test is the sole killer of no mutant) plus coverage (it covers no branch other tests miss).
   - **Cross-check:** the implementing agent sends every D and B item from one lane to a fresh Opus 5.5 high subagent (or the other lane's agent) as a read-only check against the recorded evidence (no new probes). Confirmed items enter the ranked lists; rejected or evidence-less items go under Disputed with both reasons.
   - **Ranked sections**, one line per item (format in Data / contracts):
     1. **B, real product bugs** per module: non-equivalent survivors and coverage gaps that show wrong shipped behavior, ranked by impact (disk corruption, lost edit, wrong page, silent refusal first). An untested but correct path is an S item (add the test), not B.
     2. **D, tests to delete**, with the count of tests removed.
     3. **S, tests to strengthen**: the assertion to add and the mutant or probe it must kill.
     4. **M, tests to move** to the module's exported function (named).
     5. **P, for 11c**: host tests whose value depends on module mocks, with what a ports version should assert.
     6. **Disputed** and **Equivalent mutants** (one line each, why).
   - Remove `laneA-wt`.
   - Done when: every section is present (empty says "none"), every ranked item carries evidence, and `git worktree list` shows only the main tree. All confirmed B, D, S and M items go to Step 5; P items are informational for 11c.

5. **Apply confirmed items.** Order: B bug fixes, then deletions, then strengthened or remade tests, then moved tests. Several Opus 5.5 subagents (medium or high effort, explicit) may work in parallel, one per disjoint module group (no two touch the same file); each probe runs in that agent's own probe copy, never two reverts in one tree; the main tree only receives finished diffs. A "useless" test is remade when the behavior it targets matters (rule 09), removed when it does not.
   - **B fix:** write the test that exposes the bug first and show it red on current code, then make the smallest fix in the owning module, show it green. Over the out-of-scope size limit: stop that item and ask Bombic.
   - A strengthened or moved test must fail with its target mutant or revert applied (apply the one-line change to the product file, `vp test <file>`, see red, `git checkout -- <product file>`, see green). After every probe `git diff --quiet main -- <product file>` holds.
   - If a strengthened test fails on current code, it found a product bug: it becomes a B item and follows the B fix rule.
   - A deleted test that was the only user of a `/** @internal */` export takes the export with it.
   - If a B fix changes an MCP tool, Agent-visible error code or message, update the Agent skill and system map in the same change (AGENTS.md).
   - Done when: every confirmed item is marked done (or not applied, with why) in the report with its probe result, every product-file change in `git diff --name-only main -- src` maps to a B item or a dropped `@internal` export, `pnpm verify` passes, and if any browser spec changed, the changed specs pass with `--grep`, then one full `pnpm test:browser` passes.

6. **Re-measure.** Create the probe copy `stryker-wt` again, then bring the uncommitted Step 5 changes in: `git diff main -- src tests | git -C <wt> apply`. Check `git -C <wt> diff --stat` lists exactly the Step 5 changed files. Run Stryker with the Step 2 config, `mutate` narrowed to every source file whose before-run `killedBy` or `coveredBy` includes a changed or deleted test plus every file a B fix touched (Bombic, 2026-11-23: the full scope took about 1h40m), reports into `test-results/11f-mutation/after/`. Remove the probe copy.
   - **No-drop check, per source file:** every mutant killed (not timed out) before is killed after, matched by file, line, mutator and replacement. A mutant that flips to survived means a deletion or change lost a real check: restore that test, mark its item "reverted" with the mutant, re-run Stryker on that source file only, repeat until no drop.
   - Done when: the After section has, per source file, score and survivors before -> after, total unit and browser test counts before -> after, the no-drop check passes for every file, `git worktree list` shows only the main tree, and `pnpm verify` passes.

## Files / areas

- New: `blueprint/reference/11f-test-review.md` (the report).
- Changed (Step 5 only): product files a B fix needs; `src/**/*.test.ts`, `tests/browser/*.spec.ts`, `tests/browser/harness.ts` if a shared helper changes; an `@internal` export a deleted test was the only user of.
- Not changed: product source beyond B fixes, `package.json`, lockfile, `vite.config.ts`, CI, rules, `blueprint/context/findings.md`.
- Never committed: probe copies, Stryker config, `test-results/11f-mutation/`, `coverage/`.

## Data / contracts

No product contract, message, MCP tool, error code, disk format or CSP changes, so the Agent skill and system map are untouched.

Report item format, one line, no em dashes: `<id>. [<module>] <claim> | evidence: <mutant file:line mutator | killedBy: none-unique | probe: reverted X, <test> stayed green | assertion file:line> | action: <delete | remake: ... | strengthen: assert ... | move to <export> | fix: <one line> | 11c>`. Ids are stable per section (`B1`, `D1`, `S1`, `M1`, `P1`).

## Testing

- The review itself tests the tests. Each B fix lands with a test shown red before and green after. Each other Step 5 change is proven by a mutant or revert it kills (red with it, green without), and Step 6 proves no killed mutant was lost.
- Gates: `pnpm verify` after Steps 1, 5 and 6; full `pnpm test:browser` once after Step 5 only if a browser spec changed (iterate with `vp build -c vite.webview.config.ts` and `pnpm exec playwright test -c tests/browser <file> --grep "<test>"`; `pnpm test:browser -- <name>` does not filter).
- No mutation number in the report that Stryker did not produce; if the fallback runner is used, the report says so.

## Notes for the AI

- Rule 09 is the yardstick: a test earns its place when deleting the guard it covers makes it fail. Edge cases over volume.
- Bombic's bias: fewer, properly written tests over many that do nothing; useless tests are remade or removed. A borderline test is kept unless the cross-check confirms it is the sole killer of no mutant and covers no unique branch.
- Subagents: Opus 5.5 only, `effort` medium or high passed explicitly; never Fable, never xhigh.
- Equivalent mutants (no observable difference) are not bugs; one line why.
- Timeouts (likely on `workspaceLock.ts` real-timer tests) never count as evidence that a test asserts something.
- Snapshot tests (`handoff`, `handoffCanvasHtml`) are allowed for generated artifacts (rule 09); flag them only when logic is tested by snapshot alone.
- Never run two browser-running agents on one tree; only Lane A runs probes during Step 4, and only in `laneA-wt`.
- Run Stryker in the background and do not poll; it can take tens of minutes.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":17080,"specSha256":"44dc066816c6e6f62e9e185e56704b8627d3273d08aecb06c2b2c0a56b40b4e8","branch":"refs/heads/feature/test-effectiveness-review","head":"ef9211e6aeaa68fb52281f66ef0b181508fd53f7","baseRef":"refs/heads/main","baseCommit":"ef9211e6aeaa68fb52281f66ef0b181508fd53f7","sourceTree":"60bc2664cc9d541143a8f322996691f4871549ba","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11f/F-01 [P2] closed - Untrusted-folder test asserts only that mocks were not called

**File:** src/host/artboardDisk.test.ts:169
**Found:** 2026-11-23 by /audit (scope: current; lens: all)
**Why it matters:** AS5 is marked done, but the test drops the three returned snapshots and only checks that `resolveOpenPage`, `resolveRequestedPage` and `placeFrame` were not called. If the untrusted branch (artboardDisk.ts:117, :168) returned `emptyArtboardSnapshot()` without the message, the panel would go blank with no banner and the test would stay green.
**Suggested fix:** keep the three snapshots and assert `errorMessage === UNTRUSTED_WORKSPACE_MESSAGE` on each (import from `./canvasSnapshot`).
**Resolution:** Snapshots from all three untrusted calls are kept and each asserts `errorMessage === UNTRUSTED_WORKSPACE_MESSAGE`. Probe: artboardDisk.ts:168 returning `emptyArtboardSnapshot()` turns the test red; restored, green. Re-audit 2026-11-23 (fresh Opus 5.5 reviewer): closed; both untrusted branches (artboardDisk.ts:117, :168) fail the test without the message.

### 11f/F-02 [P3] closed - Generated-name prefixes and case folding lost their test with the isGeneratedName move

**File:** src/webview/frame/selector.test.ts:91
**Found:** 2026-11-23 by /audit (scope: current; lens: all)
**Why it matters:** B2M2 deleted the test that listed all six `GENERATED_PREFIXES` plus `SVELTE-abc123`. The remaining rows reach only `css-`; dropping `sc-`, `jsx-`, `emotion-`, `astro-` or `.toLowerCase()` fails no test. Stryker never removes a single array element, so the Step 6 no-drop check cannot see it.
**Suggested fix:** in the id block, loop word-like ids `sc-header`, `jsx-header`, `emotion-header`, `astro-header`, `SVELTE-header` through `roundTrip(...)` and assert none is used.
**Resolution:** selector.test.ts loops `css-`, `svelte-`, `jsx-`, `emotion-`, `astro-` ids and `emoTion-header` through `roundTrip`. Probes: dropping each prefix turns it red (5 of 5); removing `.toLowerCase()` turns it red. `sc-` is unreachable: finder's word check rejects every 2-letter word. Re-audit 2026-11-23 kept it open because the first version claimed the case folding was unreachable (finder accepts a mid-word capital such as `emoTion-header`); fixed with that row. Re-audit 2026-11-23 (second pass): closed; all six ids pass finder's own check, so only `isGeneratedName` excludes them.

### 11f/F-03 [P3] closed - Report overstates browser coverage of frame input blocking

**File:** src/webview/frame/runtime.test.ts:77
**Found:** 2026-11-23 by /audit (scope: current; lens: all)
**Why it matters:** B2S47 removed the source-grep checks, saying `picking.spec.ts:192` and `editMode.spec.ts:126` own input blocking. They prove click, `<details>` and Arrow keys only; `submit`, `dblclick`, `auxclick`, `contextmenu` and Enter/Space `keydown` blocking (commentPicking.ts:281, :320-331) now have no test, so a design's button could act in Comment or Edit mode unnoticed.
**Suggested fix:** one `picking.spec.ts` test: focus a design button, press Enter in Comment mode, assert the design's counter is unchanged; otherwise correct the report sentence and log the gap.
**Resolution:** New browser test `picking.spec.ts` 'Comment mode: Enter and Space on a focused design button do not act' with an Interact control (Enter reaches the design's keydown handler and click). Probe: removing Enter and Space from `BLOCKED_KEYS` turns it red; passes 3 of 3 with `--repeat-each=3`. Report sentence corrected; `submit`, `dblclick`, `auxclick`, `contextmenu` recorded there as a known gap. Re-audit 2026-11-23: closed; no sleeps, harness helpers, the Interact control proves both handlers fire, Space is covered by the same keydown recorder.

### 11f/F-04 [P3] closed - Report misstates the handoffCanvasHtml snapshot change

**File:** blueprint/reference/11f-test-review.md:604
**Found:** 2026-11-23 by /audit (scope: current; lens: all)
**Why it matters:** lines 604 and 713 say the snapshot only loses `exports.frameBounds` and that the `isGeneratedName` un-export does not change it; the diff also removes the `/** @internal */` lines above `var isGeneratedName` in the four inlined runtime copies. The snapshot is right; the prose is wrong.
**Suggested fix:** reword both sentences to name the removed `exports.frameBounds` and `/** @internal */` comment lines.
**Resolution:** Both report statements corrected: the snapshot loses `exports.frameBounds` and the `/** @internal */` lines above `frameBounds` and `var isGeneratedName`. Re-audit 2026-11-23: closed; snapshot diff is exactly those 6 lines.

## Try it now

Skipped: test-only work with no user-facing behavior change; the evidence is `pnpm verify` (65 files, 794 tests), `pnpm test:browser` (210 passed) and the before/after Stryker runs in `blueprint/reference/11f-test-review.md`.
