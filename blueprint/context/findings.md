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
