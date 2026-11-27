# Comments module (11e2) - Overview for review

Source of truth: `blueprint/history/features/11e2-comments-module.md`. This file is the steering summary, not the build spec.

## TL;DR

Built the five picks from the 11e1 report (C1, C2, C3, C4a, C5). The comments chrome has fewer pass-throughs, one dead path less, no outside writes into `PinThread`, and one more pure rule with a test. Nothing the user sees changed.

## What changed

- **C1, one answer entry:** `CommentsState.handleAnswer` takes every comment answer; `DesignPage` no longer splits one answer across two methods.
- **C2, dead code gone:** the held draft is always cleared by the page's start canvas, so its extra clears and `DesignPage`'s `handlePinOpen` wrapper went. `heldDraft`, `anchors` and `flash` are private.
- **C3, one draft-pick entry:** `CommentPicker` calls `pinThread.handleDraftPick` instead of writing `PinThread`'s held thread; `savedThreadId` replaces the public held id.
- **C4a, id-taking callbacks:** `CommentCard` passes `comment.id` itself, so the panel and the thread hand handlers straight through.
- **C5, jump view rule:** `jumpView` in `pins.ts`, unit-tested; `handleJump` is find → view → commit → flash.

## Architecture decisions

- No single comments module: the three classes keep their three jobs (11e1's answer).
- The draft hold's "always empty after mount" depends on App mounting a page with its start canvas; the comment in `commentPicker.svelte.ts` names that dependency.
- Skipping copy-open for `comment:saved` is an equivalence (request ids never cross-match), so it has no test.

## Out of scope

C4b, C6, C7, D1, D3; any behavior, message or disk change; the Baseline re-measure and the Stage / Inspector helpers (11e3).

## Done means

- New browser guard: a pick during a held thread cancels the restore (fails with the guard removed).
- New unit test: `jumpView` (fails with the fit zoom dropped).
- `pnpm test:browser` 232 passed; `pnpm verify` 75 files, 927 tests.
