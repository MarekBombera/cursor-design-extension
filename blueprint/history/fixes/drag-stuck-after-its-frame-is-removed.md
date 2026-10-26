# Fix: Drag stuck after its frame is removed

**Type:** Fix
**Status:** verified
**Branch:** fix/drag-stuck-after-its-frame-is-removed
**Fixes:** F-26

## The problem

`src/webview/Stage.svelte` keeps the pointer gesture in `captured` (the label or resize handle
holding pointer capture). It is cleared only by `endFrameGesture` (pointerup, pointercancel,
lostpointercapture on that element) or by Escape.

When a `canvas:updated` removes the frame being dragged (the Agent deletes the artboard
mid-drag), Svelte removes its label and handle. The browser drops the capture, but the
`lostpointercapture` never reaches the removed element's handler, so `captured` stays set.
`startFrameGesture` then returns early for every later drag (`captured !== undefined`), and the
viewport keeps the `frame-gesture-move` class, until the user presses Escape.

App's side is already correct: `settleFrameGesture` drops App's `gesture` when the frame has no
disk placement. Only Stage's local `captured` leaks.

Reproduced in the 8d3 Playwright harness: the `test.fixme` "a frame removed mid-drag does not
block the next drag" in `tests/browser/stage.spec.ts` fails on current `main`.

## The fix

In `Stage.svelte`, one attachment, `releaseOnRemove`, on the resize handle and the label: its
teardown runs when Svelte removes that element, and clears `captured` when it still points at
that element. Nothing is reported through `onFrameGesture` (App already dropped the gesture, and a
report for a frame that is gone has nothing to apply). Clearing `captured` also ends the existing
Escape-listener effect through its cleanup and drops the `frame-gesture-*` class.

- Tie the reset to the element's lifetime, not to the `frames` list: no `$effect` that syncs
  state (Svelte docs and rule 08), and a frame re-added with the same id gets a new element, so a
  stale capture can never revive. (The first draft of this spec said `$effect`; changed at
  `/implement` for that reason. The attachment's body reads no state, so it never re-runs.)
- Covers both gesture kinds (`move` from the label, `resize` from the handle); they share
  `captured`.
- Must not change: a frame that stays but becomes an error tile keeps its label, so its gesture
  is untouched; Agent-wins mid-drag on a frame that still exists (the existing browser test)
  stays as is; no change to `frameGesture.ts`, App, the wire contract or the system map flows.
- Svelte rule 08: `get-documentation` (`$effect`) before the edit, `svelte-autofixer` on
  `Stage.svelte` after it: no issues; its suggestions are identical to those on the pre-edit
  file (the Escape listener and the deliberately non-reactive `heldArrows` set).

## Build steps

- [x] **1. Clear a capture whose frame left, and enable the regression test.**
  - Add the attachment in `Stage.svelte` after the Escape effect, with a short why comment.
  - In `tests/browser/stage.spec.ts`, turn the `test.fixme` into `test` and update its comment
    (drop the "F-26 open" wording). Add the resize case in the same test or a sibling: start a
    resize on A's handle, remove A, release, then a label drag on B posts one `frame:place`.
  - **Done when:** both cases pass; with the attachment removed they fail (mutation check,
    reverted); `pnpm test:browser` passes with 0 skipped; `pnpm verify` passes; F-26 is marked
    `fixed` in `blueprint/context/findings.md`.

## Verify

- `pnpm test:browser`: all tests pass, none skipped.
- `pnpm verify`.
- Optional F5: drag a frame's label, delete that artboard (Agent, or its file in
  `.cursor-design/artboards/`) before releasing, release, then drag another frame: it moves.

## Build notes

- 2026-10-26 /implement: `releaseOnRemove` added; "a frame removed mid-drag does not block the
  next drag" (the 8d3 `fixme`, now enabled) and the new "a frame removed mid-resize does not
  block the next drag" pass. Mutation: both `{@attach releaseOnRemove}` lines removed, both tests
  failed (`.viewport` kept `frame-gesture-*`); restored.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":3998,"specSha256":"0ef12b7d06457256bb7fa8abdadf8f75252f4d30ce0acf8256a26f63347e0774","branch":"refs/heads/fix/drag-stuck-after-its-frame-is-removed","head":"b3b00041c41c224d8423cba2c6fc992e902d4bb5","baseRef":"refs/heads/main","baseCommit":"b3b00041c41c224d8423cba2c6fc992e902d4bb5","sourceTree":"556c5fcef7b7008cc83347a911ec111edcba86fe","landing":"local-merge","absentOptional":[]} -->

## Findings

### drag-stuck-after-its-frame-is-removed/F-26 [P2] closed - Pointer capture may stay stuck when a frame is removed mid-drag

**File:** src/webview/Stage.svelte
**Found:** 2026-10-23 by review (Sonnet 5.5 test-gap pass, 8d1 refactor)
**Why it matters:** If the frame whose label holds pointer capture is removed (the Agent deletes the artboard mid-drag), `lostpointercapture` may go to the document instead of the removed element. Then `endFrameGesture` never runs and `captured` stays set. Every later drag returns early until Escape.
**Suggested fix:** Reproduce at F5 first (delete a frame while dragging its label). If it sticks, clear `captured` when its frame id leaves `frames`.
**Resolution:** 2026-10-26 /audit (scope: current, 8d3 browser tests): reproduced in the Playwright harness (scratch probe, not committed). Frames A and B, label drag on A, then `canvas:updated` without A, then release: afterwards `.viewport` still has `frame-gesture-move` and a full label drag on B posts no `frame:place`. Confirmed, so the status is `open`. Raised to P2: every later drag is dead until Escape. It is a product bug that predates 8d3, so it goes to `/fix` (spec: never edit `src/` here). Test to add with the fix, in `stage.spec.ts`: the probe above, asserting one `frame:place` for B with `base` equal to B's placement. 2026-10-26 /implement (fix/drag-stuck-after-its-frame-is-removed): `releaseOnRemove` attachment on the label and resize handle clears `captured` when that element is removed. Browser tests "a frame removed mid-drag does not block the next drag" and "a frame removed mid-resize does not block the next drag" pass, and fail with the attachment removed. Fixed, awaiting /audit. 2026-10-26 /audit (scope: current, F-26 fix; all lenses): re-read the `Stage.svelte` diff. The attachment body reads no state (never re-runs); its teardown only clears `captured` when it still points at the removed element, so a finished gesture or a gesture on another frame is untouched, and the Escape effect cleans up through `captured`. Labels and handles are keyed by id, so live frames never lose their element mid-gesture. Sibling keyboard path probed in the harness (label removed mid-nudge, then a nudge on B): B commits, no stuck `heldArrows`. Both new browser tests are mutation-checked. No new defect. Closed.

## Try it now

1. `pnpm test:browser`: 38 passed, none skipped, including "a frame removed mid-drag does not block the next drag" and "a frame removed mid-resize does not block the next drag".
2. Optional F5: start dragging a frame label, delete that artboard file in `.cursor-design/artboards/` before releasing, release, then drag another frame: it moves and saves.
