# Fix: Pin stacking and zero-count copy

**Type:** Fix
**Status:** verified
**Branch:** fix/pin-stacking-and-zero-copy
**Fixes:** F-115, F-116 (and lets F-108 close with F-115)

Follow-ups from the `/audit` of the chrome design system (2026-11-18). Bombic approved this scope ("fix") and it goes straight to `/implement`: there is no spec-review round, so every step below is literal.

## The problem

1. **F-115 [P2]: pins on one element stack on one point.**
   - The F-108 repair puts an element pin's tip on its target box's top-left corner (`pinPoint`, `src/webview/pins.ts`).
   - Two comments on the same element, or on nested elements that share a corner, therefore draw at exactly the same screen point.
   - The later pin covers the earlier one completely, so a mouse user can't open the earlier thread from the canvas. Tab and the panel's jump still reach it.
   - No test covers two comments on one target.
2. **F-116 [P3]: a copy-open answer of 0 draws an enabled primary "Nothing new to send".**
   - `answerCopyOpen` (`src/webview/commentsPanel.ts`) reports `copiedCount: 0`, so App shows the 1.5s copy feedback.
   - `handoffCopy` with `copied: 0` and `open: 0` returns "Nothing new to send" with `disabled: false`. The button looks like an active primary, and it silently ignores clicks while the feedback shows.
   - `commentsPanel.test.ts` pins that state.

## The fix

1. **F-115, in `layoutPins` (`pins.ts`), the one owner of pin screen positions.**
   - **Stacking rule.** When a placed pin's tip, rounded to whole screen px, equals the tip of a pin already placed in this call, shift it left by `PIN_STACK_STEP_PX` times the number of pins already at that tip.
   - **Order.** Earlier comments (comments.json order) keep the corner; later ones line up to the left.
   - **The step constant.** `PIN_STACK_STEP_PX = 30` in screen px: the 24px pin (`--cd-pin`), its 2px ring on both sides, and a 2px gap. Pins don't scale with zoom, so screen px are right.
   - **Implementation.** One `Map` from the rounded tip key to its count, so the pass stays O(n).
   - **Unchanged:** `pinPoint`, the visibility and clipping checks (they use the unshifted frame-local point), page pins (a page pin at a stored fraction rarely coincides; the same rule covers it if it does), the pin's `aria-label` and its number.
2. **F-116, in `commentsPanel.ts`.**
   - `answerCopyOpen` returns `copiedCount` only when `answer.count > 0`. The announcement is unchanged.
   - `handoffCopy` treats `copied` of 0 the same as `undefined`: the copied branch needs a positive count, and `disabled` is `open === 0` whenever no positive copied count shows. A 0 that ever reaches it can no longer draw an enabled "Nothing new to send".
   - The copy-open click guard (it ignores clicks while the Copied feedback shows) then never engages for a 0, because App only shows feedback for a positive count.

**Must not break:** pin placement and visibility for single pins, every pin browser spec (tips on corners), the Copied feedback and its 1.5s revert, the copy-open guard, live-region announcements.

## Build steps

- [x] **1. Rules and tests.**
  - **F-115 in `pins.ts`:**
    - `PIN_STACK_STEP_PX` and the stacking map in `layoutPins`.
    - `pins.test.ts` cases: two comments on one target, the second 30px left of the first with the same y; a third, 60px left; a pin on another element unchanged.
  - **F-116 in `commentsPanel.ts`:**
    - the `answerCopyOpen` and `handoffCopy` changes;
    - `commentsPanel.test.ts`: an answer with `count: 0` gives no `copiedCount`; `handoffCopy({ open: 0, sent: 2, copied: 0 })` is "Nothing new to send" with `disabled: true`; `handoffCopy({ open: 2, sent: 0, copied: 0 })` is the copy label, enabled. Replace the old `open: 2, copied: 0` expectation.
  - **Owner catalog:** rule 05's `layoutPins` text names the stacking.
  - **Done when:** `pnpm exec vp test src/webview/pins.test.ts src/webview/commentsPanel.test.ts` passes, and removing the stacking or the `> 0` guard makes a test fail.
- [x] **2. Browser case.**
  - In `tests/browser/pins.spec.ts`: two comments on the same element give two pins whose boxes don't overlap, and clicking each opens its own thread (dialog content names the right comment).
  - **Done when:** `pnpm verify` and `pnpm test:browser` are green.

## Verify

- `pnpm verify`, `pnpm test:browser` (incl. the new two-pins case).
- `/audit current` re-reviews F-115 and F-116, and F-108 with them, before `/complete`.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":4475,"specSha256":"07e481cc94269a2b7f2557f947d23287348b78e4365944581103d6bb9b2c03b7","branch":"refs/heads/fix/pin-stacking-and-zero-copy","head":"120c16979cba37e67996af3aabc7f2bc8c1859b4","baseRef":"refs/heads/main","baseCommit":"120c16979cba37e67996af3aabc7f2bc8c1859b4","sourceTree":"4dec9146b0adb60d70823c8d8fda258ca8ac4b7b","landing":"local-merge","absentOptional":[]} -->

## Findings

### pin-stacking-and-zero-copy/F-108 [P2] closed - Pins still cover the words they point at

**File:** src/webview/pins.ts (`pinPoint`)
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** The tip sits on the stored click point and the body grows up-left over the text ("d●signs", "boa●d"). The approved mockup puts the tip on the element's top-left corner with the body in the margin.
**Suggested fix:** Element comments anchor the tip at the target box's top-left corner; page comments keep the stored fraction.
**Resolution:**
2026-11-17 Batch A: `pinPoint` puts an element pin's tip on its target box's top-left corner (page comments keep the stored fraction); `pins.test.ts` and the `pins.spec.ts` tip assertions updated on purpose.
2026-11-18 /audit current (fresh reviewer, all lenses): left `fixed`. The original defect is gone (`pinPoint` returns the box top-left for element comments; `pins.spec.ts` covers the frame-corner case), but the repair makes pins on one element, or on nested elements sharing a top-left corner, stack on the identical point: see F-115. Close together with F-115 (or on Bombic's explicit acceptance of it).
2026-11-18 /audit current (fix/pin-stacking-and-zero-copy, fresh reviewer, all lenses): closed with F-115. `pinPoint` is unchanged (element tip on the box top-left, page pin at its fraction); the stacking side effect it caused is repaired in `layoutPins` (see F-115).

### pin-stacking-and-zero-copy/F-115 [P2] closed - Pins on one element, or on nested elements sharing a corner, now stack on one point

**File:** src/webview/pins.ts:186 (`pinPoint`), src/webview/Pins.svelte:42
**Found:** 2026-11-18 by /audit (scope: current; lens: quality, tests)
**Why it matters:** F-108 anchors every element pin's tip at its target box's top-left corner. Before, each pin sat at its own click fraction, so two pins rarely coincided. Now two comments on the same element always draw at the identical tip. So do comments on a container and its first child when the container has no padding (a `section` and its heading, a `header` and its `nav`). The later pin fully covers the earlier one: pointer users cannot open the earlier thread from the canvas (Tab and the panel's jump still reach it). "Grouping overlapping pins" was ruled out of scope when overlaps were incidental; this change makes them deterministic. No test covers two comments on one target.
**Suggested fix:** In `layoutPins`, step a pin whose tip equals an earlier placed pin's tip left by one pin width plus a gap. That is one pass over the placed list, with a `ponytail:` note for the O(n²) check. Add one `pins.test.ts` case with two comments on one target. Or Bombic explicitly accepts the overlap as a known ceiling. Either way, F-108 closes with this.
**Resolution:**
2026-11-18 fix/pin-stacking-and-zero-copy: `layoutPins` lines up pins whose rounded screen tips coincide 30 screen px apart to the left, in file order (`PIN_STACK_STEP_PX`, one Map, O(n)); `pins.test.ts` covers two and three pins on one target and an unshifted pin elsewhere (fails without the shift); `pins.spec.ts` shows two non-overlapping pins on `#title`, each opening its own thread; the missing-badge fixture moved its stored rect off the mover's corner. Verify 556, browser 124. Awaits `/audit` to close, with F-108.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `layoutPins` keys each placed pin by its rounded screen tip and shifts later ones `before * 30` px left; visibility and clipping still use the unshifted frame-local point, so a hidden target never draws a shifted pin. The thread anchors to the shifted `PlacedPin` (`App.svelte` `anchor={openPin}`), so it opens beside the clicked pin; the jump flash uses the target rect (`jumpTarget`), unaffected. Order is comments.json order, stable across zoom and pan (both tips scale together). Resolved pins (smaller) still clear a 30 px step. The DOOMED fixture move keeps the missing-pin test meaningful: it still asserts the tip at the stored rect, now at a point that differs from both the live element and the mover. `pnpm exec vp test` on pins + commentsPanel: 47 passed. Residual ceiling (near-coincident tips) recorded as F-117.

### pin-stacking-and-zero-copy/F-116 [P3] closed - A copy-open answer of 0 draws an enabled primary "Nothing new to send"

**File:** src/webview/commentsPanel.ts:132 (`handoffCopy`), src/webview/App.svelte:586 (`handleCopyOpenAnswer`)
**Found:** 2026-11-18 by /audit (scope: current; lens: quality, tests)
**Why it matters:** `ui:copied` can carry `count: 0` when nothing was open on disk at copy time (for example, the Agent or another window sent them first). App still shows the feedback, so `handoffCopy` gets `copied = 0`. That returns "Nothing new to send" with `disabled: false` (`disabled = copied === undefined && open === 0`), drawn as the primary button with the sparkle. For `COPY_FEEDBACK_MS`, `submitCopyOpen` silently ignores clicks on it (`copiedShowing`). The spec's contract says the button is disabled at zero open. `commentsPanel.test.ts` pins the odd state (`open: 2, copied: 0` gives `disabled: false`).
**Suggested fix:** Show the copy-open feedback only for a count above zero (`answerCopyOpen` returns `copiedCount` only when `count > 0`; the announcement stays). Then delete `handoffCopy`'s zero branch and its test case. Nothing current is lost.
**Resolution:**
2026-11-18 fix/pin-stacking-and-zero-copy: `answerCopyOpen` returns `copiedCount` only for a positive count (announcement unchanged); `handoffCopy` treats a copied count of 0 as no feedback, so `disabled` is `open === 0`; tests cover count 0 (fails without the `> 0` guard) and `copied: 0` with and without open comments. Awaits `/audit` to close.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `answerCopyOpen` omits `copiedCount` for 0, and `App.svelte` `handleCopyOpenAnswer` shows feedback only when it is defined, so `submitCopyOpen`'s `copiedShowing` guard never engages for a 0; the announcement is still made. `handoffCopy` now disables at `open === 0` whenever no positive copied count shows (the only caller, `CommentsPanel.svelte`, passes `copied` only for kind `open`). Tests fail without the `> 0` guard.
