# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-11 [P3] open - The host snapshot, frame-place and export entry points have no test of their resolver wiring

**File:** src/host/artboardDisk.ts:125
**Found:** 2026-11-22 by /audit independent (scope: current; lens: tests; reviewer: claude-opus-5-5, fresh subagent)
**Why it matters:** 10a adds new logic to three host entry points that no test runs: `loadActiveSnapshot` passes `createIfFresh: initializeWhenMissing` (true only for Open Artboard) and gates on the page manifest `manifestPathSegments(page.pageId)`; `placeFrameFromChrome` (line 181) and `commands/exportHandoff.ts:24` resolve with `createIfFresh: false`; and a resolver error must become the snapshot `errorMessage` or `showErrorMessage`. No `*.test.ts` imports `artboardDisk.ts` or `exportHandoff.ts`. Flipping the refresh path to `createIfFresh: true`, which would let a panel-visible read create `.cursor-design/` on a fresh root, or dropping the page from the manifest gate would pass `pnpm verify`. `panelEdit` and `panelComments` already have these tests (F-02). The production code reads correctly today.
**Suggested fix:** Add one small `src/host/artboardDisk.test.ts` that mocks `vscode` and `resolveOpenPage` the way `panelEdit.test.ts` does. Assert that Open Artboard resolves with `createIfFresh: true`, the refresh and `placeFrameFromChrome` resolve with `false`, and a rejected resolve yields one logged error and a snapshot `errorMessage` equal to the error's message. No production change. Optional before /complete, since 10e's real-Cursor run covers the same paths by hand.
**Resolution:**
