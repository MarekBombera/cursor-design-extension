# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-05 [P3] open - `sc-` in GENERATED_PREFIXES is unreachable behind finder's word check

**File:** src/webview/frame/selector.ts:12
**Found:** 2026-11-23 by /audit (scope: current; lens: quality; F-02 re-audit)
**Why it matters:** finder's `wordLike` rejects every word of 2 letters or fewer, so no `sc-*` name ever reaches `isGeneratedName`; the entry is dead today and only guards against a future finder change.
**Suggested fix:** drop `'sc-'`, or keep it with a `ponytail:` note that it guards a finder upgrade. Pre-existing (not introduced by 11f); behavior-neutral either way.
**Resolution:**

### F-20 [P3] unverified - `listPages` stats sequentially inside the MCP queue

**File:** src/disk/pageOps.ts:142
**Found:** 2026-11-24 by /audit (scope: current; lens: performance)
**Why it matters:** about pages × (3 + 2 × frames) awaited `lstat`s (≈2,500 at 100 pages × 10 frames) while other MCP calls queue. Already marked `ponytail:`; no measurement.
**Suggested fix:** none now; `Promise.all` per page if it ever shows.
**Resolution:**

### F-29 [P3] open - `claimPageFolder`'s EEXIST retry is unpinned

**File:** src/disk/pageOps.ts:108
**Found:** 2026-11-24 by /audit independent (scope: current; lens: tests)
**Why it matters:** the non-recursive `mkdir` + `EEXIST` → next id loop is the only guard against two creators (two MCP processes, or the 10d panel) claiming the same id between `nextPageNumber` and the claim. Probe: making the claim `mkdir(..., { recursive: true })` (never `EEXIST`) leaves all 31 tests in `pageOps.test.ts` and `pageTools.contract.test.ts` green; the "skips an existing orphan" case is caught earlier by `nextPageNumber`, not by the retry.
**Suggested fix:** one test that creates `pages/page-<n>` after `nextPageNumber` ran (for example a `vi.mock('node:fs/promises')` `mkdir` wrapper that pre-creates the first target once) and asserts `page-<n+1>` is claimed and indexed.
**Resolution:**

### F-30 [P3] open - `readdirOrEmpty` twins `scanPageFolders`' inline ENOENT readdir

**File:** src/disk/pageOps.ts:68
**Found:** 2026-11-24 by /audit independent (scope: current; lens: quality)
**Why it matters:** rule 03/05: a twin helper is a bug. `readdirOrEmpty` (new) is the same "missing dir lists nothing, other failures `throwDiskError`" logic `scanPageFolders` inlines at src/disk/openPage.ts:71-78; the next reader will add a third copy.
**Suggested fix:** move `readdirOrEmpty` to `layoutFs.ts` (low-level reads owner), use it in `scanPageFolders`, and name it in the rule 05 catalog. No behavior change; no requirement lost.
**Resolution:**

### F-31 [P3] open - Spec step 2a no longer matches shipped blank-page adoption

**File:** blueprint/context/current-feature.md:87
**Found:** 2026-11-24 by /audit independent (scope: current; lens: quality)
**Why it matters:** code > plan, so the spec must record the shipped choice. Step 2a says the locked re-read throws `PageNotFoundError('page-1', { reason: 'unlisted' })` when page-1 is no longer listed and adopts on a missing manifest alone. Shipped code (src/disk/pageOps.ts:223-229, 266-268) also requires the page-1 folder to exist and `artboards/` to be empty, and when the locked re-check of "sole page-1 titled Page 1" fails it falls through to a new page instead of throwing (pinned by "createPage makes a new page when page-1 was renamed while the adoption waited for the lock").
**Suggested fix:** rewrite step 2a to the shipped conditions and fall-through; no code change.
**Resolution:**
