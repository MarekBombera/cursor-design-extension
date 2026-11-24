# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-20 [P3] unverified - `listPages` stats sequentially inside the MCP queue

**File:** src/disk/pageOps.ts:142
**Found:** 2026-11-24 by /audit (scope: current; lens: performance)
**Why it matters:** about pages × (3 + 2 × frames) awaited `lstat`s (≈2,500 at 100 pages × 10 frames) while other MCP calls queue. Already marked `ponytail:`; no measurement.
**Suggested fix:** none now; `Promise.all` per page if it ever shows.
**Resolution:**

### F-29 [P3] fixed - System map rename answer lines omit the focus condition

**File:** blueprint/context/system-map.md:395
**Found:** 2026-11-24 by /audit independent (scope: current; lens: quality)
**Why it matters:** the Pages menu chart says a rename `ui:error` leaves the field "editable and refocused" (`:395`) and a rename `page:saved` focuses "that row's Rename" (`:398`) unconditionally. Since the F-22 repair, `handleAnswer` (`pagesMenuState.svelte.ts:170-183`) moves focus on both only when `focusInMenu({ orBody: true })` holds; the open / create / delete line (`:384`) already states that condition. Docs drift in the normative system map, no behavior impact.
**Suggested fix:** append "if focus was in the menu or on body" to the chart lines at `:395` and `:398` (or one sentence under the Chrome answers bullet). Nothing is deleted; no requirement lost.
**Resolution:** 2026-11-24 /complete (10d): both chart lines in the system map "Pages menu (10d)" section now say "if focus was in the menu or on body", matching `handleAnswer`. Not yet re-reviewed.
