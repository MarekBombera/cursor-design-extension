# Share browser test helpers - Overview for review

Source of truth: `blueprint/history/fixes/share-browser-test-helpers.md`. This file is the steering summary, not the build spec.

**Branch:** `fix/share-browser-test-helpers` · **Type:** Fix · **Status:** verified

## TL;DR

A test-only cleanup. Five Playwright specs re-declared helpers that belong in
`tests/browser/harness.ts` (rule 09). Those helpers now live in the harness, or the specs use the
harness helper that already existed. Every test asserts exactly what it asserted before. No
product code, message, disk format or process flow changed, so there is no data-flow chart.

## What you will see

No change in the product. `harness.ts` gained four exported helpers, the five specs got shorter,
and the browser suite still reports the same pass and skip count as main.

## Architecture decisions

| Before | After |
|---|---|
| `picksOf` in 3 specs (editMode's fixed to frame `a`) | One `picksOf(page, frameId)` in the harness |
| `lastPick` in 2 specs (one throws, one returns `undefined`) plus an inline copy in `picking` | One throwing `lastPick(page, frameId)` in the harness |
| `reload` in 2 specs plus 3 inline copies | One `reload(page)` in the harness |
| `openThread` in 2 specs | One in the harness (commentsPanel's, which also waits for the pin) |
| Four hand-rolled "element box on screen" readers | The existing harness `frameElementBox` |

## Decisions locked

- **One build step.** Each spec's import list mixed the helper moves and the element-box swap, so
  a partial pass would have failed lint.
- **The throwing `lastPick` won.** Every Edit-mode caller reads it after a pick has landed, so
  nothing it asserts changed. A throw inside `expect.poll` fails at once instead of retrying; that
  is safe here only because of the earlier wait.
- **Element-box readers.** The readers that skipped the zoom scale only ran at 100%, where the
  harness scale is exactly 1. The pins reader used the same scale formula, so its 50% check is
  unchanged.
- **Not twins, left alone:** `inside` vs `isInside` (tolerance), `withinOnePx` vs `expectBoxNear`
  (shape), the two `inFrame`s (jobs), the local `comment` factories, and `commentsPanel`'s
  `screenRectOf` (maps a stored rect where no element exists).

## Out of scope

- Any `src/` change.
- New helper abstractions.
- The gallery helpers in `gallery/interact.ts` (`openThread` does a different job; `pointIn` would
  need a `pnpm gallery` run to prove).

## Glossary

| Term | Why it exists |
|---|---|
| Harness | `tests/browser/harness.ts`: the one home for shared Playwright locators and helpers (rule 09) |
| Twin | A helper re-declared under the same or a near name in another file; rule 05 treats it as a bug |
| `frameElementBox` | Reads an element's box inside an artboard frame and maps it to screen pixels at any zoom |

## Done means

- `pnpm verify` passes. Its `vp check` formats, lints and type-checks `tests/browser`.
- `pnpm test:browser` reports 164 passed, 198 skipped, the same as main.
- No spec declares `picksOf`, `lastPick`, `reload`, `openThread` or its own element-box reader.
