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
