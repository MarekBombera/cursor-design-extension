# Fix: Drag stuck after its frame is removed (F-26) - Overview for review

> **Generated file.** Human-facing steering summary of the active work item:
> same content as `current-feature.md`, trimmed. Written at `/feature` when the
> spec is created, and kept current if the spec is revised. `/complete` may
> polish this into the archive-ready one-pager; it is not the first write.
> Open in Markdown preview to render the diagrams.

Source of truth: `blueprint/history/fixes/drag-stuck-after-its-frame-is-removed.md`. This file is the steering summary, not the build spec.

## TL;DR

If the Agent deleted the frame you were dragging or resizing, every later frame drag did nothing
until you pressed Escape. Now the next drag works right away.

## What you will see

- Drag a frame's label (or resize handle); the frame disappears mid-gesture; release.
- Before: dragging another frame did nothing. After: it moves and saves as usual.

## Architecture decisions

- The stage remembers which label or handle holds the pointer. A removed element never got its
  own "capture lost" event, so that memory went stale.
- Fix: when Svelte removes a label or handle, its teardown clears that memory if it still points
  at it. It is tied to the element's lifetime, not the frame list, so a frame re-added with the
  same id cannot revive the stale state.
- No message, disk or system-map flow changed.

## Out of scope

App's gesture logic (already correct), the keyboard nudge path (probed: not affected).

## Done means

`pnpm verify` passes (307 unit tests) and `pnpm test:browser` gives 38 passed with none skipped
(114/114 over three repeats). Both new tests fail with the fix removed. Checked 2026-10-26.
