# Fix: Page ops P3 follow-ups

**Type:** Fix
**Status:** verified (2026-11-24: steps 1-2 built; `pnpm verify` green)
**Branch:** fix/page-ops-p3-follow-ups
**Fixes:** F-05, F-29, F-30, F-31

## The problem

Four open P3 findings left after 10c:

- **F-05:** `GENERATED_PREFIXES` in `src/webview/frame/selector.ts` lists `'sc-'`, which finder's own word check (every word of 2 letters or fewer fails) never lets through. Dead entry.
- **F-29:** `claimPageFolder` (`src/disk/pageOps.ts`) claims `pages/page-<n>` with a non-recursive `mkdir` and moves to the next id on `EEXIST`. That retry is the only guard against two creators claiming one id, and no test pins it.
- **F-30:** `readdirOrEmpty` (`pageOps.ts`) twins the inline ENOENT `readdir` in `scanPageFolders` (`src/disk/openPage.ts`).
- **F-31:** the archived 10c spec's step 2a (`blueprint/history/features/10c-page-ops-mcp-tools.md`) differs from the shipped blank-page adoption: shipped code also requires the `page-1` folder to exist and its `artboards/` to be empty, and when the locked re-check of "sole `page-1` titled Page 1" fails it falls through to a new page instead of throwing `PAGE_NOT_FOUND`.

## The fix

- F-05: drop `'sc-'`; fix the selector test comment that mentions it. Behavior-neutral.
- F-30: move `readdirOrEmpty` to `src/disk/layoutFs.ts` (low-level reads owner), export it, use it in `scanPageFolders` and `pageOps.ts`; name it in rule 05's catalog. No behavior change.
- F-29: one `pageOps.test.ts` case: another creator makes `pages/page-<n>` between `nextPageNumber` and the claim (a `node:fs/promises` `mkdir` wrapper pre-creates the first target once); `createPage` claims and indexes `page-<n+1>`.
- F-31: code stays (it is the better behavior and is pinned by "createPage makes a new page when page-1 was renamed while the adoption waited for the lock"). The archived spec is history and is not rewritten; record the shipped conditions in `blueprint/reference/0.5-pages-plan.md`'s "Built (10c)" note and in this fix's archive.

## Build steps

- [x] 1. F-05, F-29, F-30 code and tests. Done when: `pnpm exec vp test run src/webview/frame/selector.test.ts src/disk/pageOps.test.ts src/disk/openPage.test.ts` passes, and a probe that makes the claim `mkdir` recursive fails the new F-29 test.
- [x] 2. F-31 plan note and rule 05 catalog. Done when: the plan note names the folder, empty-`artboards/` and fall-through rules.

## Verify

`pnpm verify` green. No chrome or message change, so no browser run.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":2493,"specSha256":"a6921110f6f7473f62ba9a005ee228307c30686683aeb24db00b8dd03257f6bc","branch":"refs/heads/fix/page-ops-p3-follow-ups","head":"f44418411455a3e5e87db0fc300ca99faa57fe77","baseRef":"refs/heads/main","baseCommit":"f44418411455a3e5e87db0fc300ca99faa57fe77","sourceTree":"eb093c91eba588aec7939a9fa8585de9bbb20191","landing":"local-merge","absentOptional":[]} -->

## Findings

### page-ops-p3-follow-ups/F-05 [P3] closed - `sc-` in GENERATED_PREFIXES is unreachable behind finder's word check

**File:** src/webview/frame/selector.ts:12
**Found:** 2026-11-23 by /audit (scope: current; lens: quality; F-02 re-audit)
**Why it matters:** finder's `wordLike` rejects every word of 2 letters or fewer, so no `sc-*` name ever reaches `isGeneratedName`; the entry is dead today and only guards against a future finder change.
**Suggested fix:** drop `'sc-'`, or keep it with a `ponytail:` note that it guards a finder upgrade. Pre-existing (not introduced by 11f); behavior-neutral either way.
**Resolution:** 2026-11-24 fixed (fix/page-ops-p3-follow-ups): `'sc-'` dropped from `GENERATED_PREFIXES`; selector test comment updated. Closed 2026-11-24 by /audit re-review (fresh Sonnet 5.5): finder `wordLike` rejects any first word of 2 letters, so the entry was unreachable; snapshot diff is only the four `"sc-"` lines.

### page-ops-p3-follow-ups/F-29 [P3] closed - `claimPageFolder`'s EEXIST retry is unpinned

**File:** src/disk/pageOps.ts:108
**Found:** 2026-11-24 by /audit independent (scope: current; lens: tests)
**Why it matters:** the non-recursive `mkdir` + `EEXIST` → next id loop is the only guard against two creators (two MCP processes, or the 10d panel) claiming the same id between `nextPageNumber` and the claim. Probe: making the claim `mkdir(..., { recursive: true })` (never `EEXIST`) leaves all 31 tests in `pageOps.test.ts` and `pageTools.contract.test.ts` green; the "skips an existing orphan" case is caught earlier by `nextPageNumber`, not by the retry.
**Suggested fix:** one test that creates `pages/page-<n>` after `nextPageNumber` ran (for example a `vi.mock('node:fs/promises')` `mkdir` wrapper that pre-creates the first target once) and asserts `page-<n+1>` is claimed and indexed.
**Resolution:** 2026-11-24 fixed: `pageOps.test.ts` "createPage moves to the next id when another creator takes the number between the scan and the claim" (mkdir wrapper pre-creates page-2 once); probe (recursive claim mkdir) fails it. Closed 2026-11-24 by /audit re-review (fresh Sonnet 5.5): probe (recursive claim mkdir) fails only the new test; the fs mock passes through by default.

### page-ops-p3-follow-ups/F-30 [P3] closed - `readdirOrEmpty` twins `scanPageFolders`' inline ENOENT readdir

**File:** src/disk/pageOps.ts:68
**Found:** 2026-11-24 by /audit independent (scope: current; lens: quality)
**Why it matters:** rule 03/05: a twin helper is a bug. `readdirOrEmpty` (new) is the same "missing dir lists nothing, other failures `throwDiskError`" logic `scanPageFolders` inlines at src/disk/openPage.ts:71-78; the next reader will add a third copy.
**Suggested fix:** move `readdirOrEmpty` to `layoutFs.ts` (low-level reads owner), use it in `scanPageFolders`, and name it in the rule 05 catalog. No behavior change; no requirement lost.
**Resolution:** 2026-11-24 fixed: `readdirOrEmpty` moved to `layoutFs.ts`, used by `pageOps.ts` and `scanPageFolders`; rule 05 catalog names it. Closed 2026-11-24 by /audit re-review (fresh Sonnet 5.5): identical body; remaining `readdir` sites deliberately do not swallow ENOENT, so no twin left.

### page-ops-p3-follow-ups/F-31 [P3] closed - Spec step 2a no longer matches shipped blank-page adoption

**File:** blueprint/context/current-feature.md:87
**Found:** 2026-11-24 by /audit independent (scope: current; lens: quality)
**Why it matters:** code > plan, so the spec must record the shipped choice. Step 2a says the locked re-read throws `PageNotFoundError('page-1', { reason: 'unlisted' })` when page-1 is no longer listed and adopts on a missing manifest alone. Shipped code (src/disk/pageOps.ts:223-229, 266-268) also requires the page-1 folder to exist and `artboards/` to be empty, and when the locked re-check of "sole page-1 titled Page 1" fails it falls through to a new page instead of throwing (pinned by "createPage makes a new page when page-1 was renamed while the adoption waited for the lock").
**Suggested fix:** rewrite step 2a to the shipped conditions and fall-through; no code change.
**Resolution:** 2026-11-24 fixed: code kept (fall-through pinned by the "page-1 was renamed while the adoption waited" test); the archived 10c spec stays history; `0.5-pages-plan.md` "Built (10c)" note records the shipped conditions and fall-through. Closed 2026-11-24 by /audit re-review (fresh Sonnet 5.5): plan note matches `isBlankFirstPage` / `adoptBlankFirstPage` / `createPage` fall-through.
