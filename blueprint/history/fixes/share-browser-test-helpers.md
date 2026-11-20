# Fix: Share browser test helpers

**Type:** Fix
**Status:** verified
**Branch:** fix/share-browser-test-helpers

## The problem

Rule 09 (`.claude/rules/09-tests.md`): shared locators and helpers live in `tests/browser/harness.ts`;
a spec imports them instead of re-declaring them. Five Playwright specs re-declare the same helpers
(read against main `ca0f407`):

| Twin | Copies today | Same job? |
|---|---|---|
| `picksOf` | `picking.spec.ts:85`, `commentPopover.spec.ts:236` `(page, frameId)`; `editMode.spec.ts:50` `(page)` with `frameId` fixed to `'a'` | Yes: identical body (`messagesOfType` + `parseFrameMessage` + `FRAME_PICK_MESSAGE` filter) |
| `lastPick` | `commentPopover.spec.ts:241` `(page, frameId)`, throws when there is no pick; `editMode.spec.ts:55` `(page)`, returns `undefined`; inline copy of the throwing body in `picking.spec.ts:139-143` (`pickInFrame`) | Yes, see the difference below |
| `reload` | `commentPopover.spec.ts:567`, `commentsPanel.spec.ts:341`; inline `await openHarness(page, { state: await savedState(page) })` at `commentsPanel.spec.ts:334`, `editMode.spec.ts:303` and `:312` | Yes: identical |
| `openThread` | `commentsPanel.spec.ts:119`, `pins.spec.ts:463` | Yes, see the difference below |
| harness `frameElementBox` re-implemented | `picking.spec.ts:65` `elementRect` + `:78` `screenBox`; `commentPopover.spec.ts:112` `pointInFrame`; `pins.spec.ts:115` `elementBox`; `commentsPanel.spec.ts:754` `elementRect` (+ `:742` `screenRectOf`) | Yes for the element reads; `screenRectOf` stays (below) |

Checked and **not** twins (stay where they are):

- `inside` (`commentPopover.spec.ts:510`, strict) vs `isInside` (`stage.spec.ts:329`, 1 px slack): different tolerance.
- `withinOnePx` (`pins.spec.ts:133`, point → boolean, polled) vs harness `expectBoxNear` (box, asserts): different shape.
- `inFrame` (`editMode.spec.ts:352` returns a locator; `pins.spec.ts:167` evaluates a script): different jobs.
- `comment` factories (`pins.spec.ts:48`, `commentsPanel.spec.ts:54`): local factories stay in the test file (rule 09).
- `commentsPanel.spec.ts` `screenRectOf`: still needed for `:815`, which maps a stored comment rect (no element exists) to the screen. No harness helper does that; keeping it adds no abstraction.
- `nextPickSelector` / `.at(-1)?.` reads in `picking.spec.ts` (`:149`, `:268`, `:588`): they want `null`/`undefined`, not a throw. Unchanged.
- Gallery helpers in `tests/browser/gallery/interact.ts`, out of scope:
  - `openThread` (`:130`) is a different job. It clicks near the pin **tip** with `clickAt`
    (a target at the frame's left edge puts the pin body off the stage edge at the gallery view),
    then calls `settle` for the screenshot. The harness one clicks the pin with `clickChrome`. Only
    `gallery/states/thread.ts` uses it, and it imports from `../interact` by name. `interact.ts`
    imports from `../harness` by explicit name, so the shared name does not collide. Do **not** add
    `openThread` to that import list.
  - `pointIn` (`:75`) returns a point at a fraction (`fx`, `fy`) of the element, with a manual
    `zoom`. Its rect read overlaps `frameElementBox`, but the gallery is evidence, not a gate
    (rule 09: `pnpm gallery` only, never Verify, CI or `pnpm test:browser`). This fix's gates cannot
    prove a gallery change, and folding it in would need a `pnpm gallery` run. Left for a gallery
    pass.

## The fix

Test-only. No `src/` change, no new abstraction: helpers move into `harness.ts`, specs import them.
Every test keeps asserting what it asserts today.

Line numbers are from `ca0f407`. Edits above a line shift it, so find each site by its content.
Each deleted helper takes its own comment with it.

### Into `harness.ts`

Add `FRAME_PICK_MESSAGE`, `type FramePickMessage` and `parseFrameMessage` to the existing
`../../src/webview/frame/frameMessages` import.

- After `messagesOfType`, move `picksOf` verbatim from `picking.spec.ts`, with its one-line comment,
  and export it:
  `export const picksOf = async (page: Page, frameId: string): Promise<FramePickMessage[]>`.
- Right after it, move `lastPick` verbatim from `commentPopover.spec.ts` (it throws
  `'No cd:pick was captured.'`) and export it:
  `export const lastPick = async (page: Page, frameId: string): Promise<FramePickMessage>`.
- After `savedRecord`, move `reload` verbatim from `commentPopover.spec.ts`, with its "A tab
  switch…" comment, and export it: `export const reload = async (page: Page): Promise<void>`.
- After `threadButton`, move `openThread` verbatim from `commentsPanel.spec.ts` and export it:
  `export const openThread = async (page: Page, id: string): Promise<void>`. It waits for the pin
  to be visible, calls `clickChrome(pinOf(...))`, waits for the thread to be visible and checks
  that `threadButton(page, 'Close')` has focus.
- `openHarness` comment: "(a reload passes what savedState returned)" becomes "(`reload` passes
  what savedState returned)".
- `frameElementBox` is unchanged. It replaces every element-box twin.

### Spec by spec

Each spec deletes the moved declarations and their comments, adds the new names to its
`./harness` import, and drops imports that become unused (lint `no-unused-vars` fails them).

**`picking.spec.ts`**
- Delete `picksOf`, `elementRect` and `screenBox`, with their comments. Keep `type FrameTarget`
  (`reveal` uses it).
- `screenBox(target)` → `frameElementBox(target)` at `:102` and `:112` (inside `reveal`), and
  `screenBox({ page, frameId: 'a', selector: … })` → `frameElementBox({ … })` at `:564` and `:577`
  (same object argument shape).
- `pickInFrame`: the five lines after the `expect.poll` (`const pick = … at(-1)` through
  `return pick;`) become `return lastPick(page, frameId);`.
- The `:515` comment ("which picksOf already runs") stays: still true.
- Imports: add `frameElementBox`, `lastPick`, `picksOf`; drop `type FrameRect`.

**`commentPopover.spec.ts`**
- Delete `picksOf`, `lastPick`, `reload`.
- `pointInFrame` keeps its name, signature and call sites (`:150`, `:162`, `:174`, `:274`, `:398`,
  `:485`, `:521`). Its body becomes
  `centerOf(await frameElementBox({ page, frameId, selector }))`, and its comment drops "at zoom 1".
- Imports: add `frameElementBox`, `lastPick`, `picksOf`, `reload`; drop `FRAME_PICK_MESSAGE`,
  `type FramePickMessage`, `parseFrameMessage` (keep `FRAME_KEY_MESSAGE`) and `savedState`.

**`editMode.spec.ts`**
- Delete `picksOf`, `lastPick`.
- Every `picksOf(page)` → `picksOf(page, 'a')` (`:65`, `:68`, `:87`, `:187`, `:189`, `:203`, `:205`,
  `:210`, `:212`, `:273`, `:373`, `:379`); every `lastPick(page)` → `lastPick(page, 'a')` (`:98`,
  `:140`, `:145`, `:167`, `:178`, `:190`, `:202`, `:206`, `:207`, `:213`, `:243`, `:378`, `:385`,
  `:393`, `:396`). The existing `?.` stay. They are legal on a non-optional value and lint does not
  flag them.
- `await openHarness(page, { state: await savedState(page) });` → `await reload(page);` at `:303`
  and `:312`.
- Imports: add `lastPick`, `picksOf`, `reload`; drop `type FramePickMessage`, `savedState` (keep
  `FRAME_PICK_MESSAGE` and `parseFrameMessage`, used by the forged-pick test).

**`commentsPanel.spec.ts`**
- Delete `openThread`, `reload` and `elementRect`, with their comments. Keep `screenRectOf` for
  the stored rect at `:815`.
- `:334` inline reopen → `await reload(page);`.
- `screenRectOf(page, await elementRect(page, '#target'))` (`:768`) →
  `frameElementBox({ page, frameId: JUMP_FRAME.id, selector: '#target' })`; same for `'#tall'`
  (`:793`).
- Imports: add `frameElementBox`, `openThread`, `reload`; drop `savedState`.

**`pins.spec.ts`**
- Delete `elementBox` and `openThread`, with their comments.
- `elementBox(page, selector)` → `frameElementBox({ page, frameId: 'a', selector })` at `:149`
  (in `expectPinOn`) and `'#doomed'` at `:437` and `:543`.
- Imports: add `frameElementBox`, `openThread`.

### Differences between copies, and how each is resolved

A throw inside an `expect.poll` callback fails the test at once; the poll does not retry it.
Playwright 1.65.1 `invokePollMatcher` awaits the callback outside its `try`. Where a surviving
helper throws and the old copy returned `undefined` or auto-waited, it is safe only because an
earlier step already waited for the pick or element. A future poll that runs before that state
exists will fail fast instead of retrying.

| Twin | Difference | Resolution |
|---|---|---|
| `lastPick` | commentPopover throws on no pick; editMode returns `undefined` | The throwing version survives. Every editMode call follows a step that already waited for a new pick: `clickElement` polls the count up, or an explicit `expect.poll` on `picksOf` does. So a pick always exists, and each `?.` read returns what it returns today. At `:243`, `?.edit` being `undefined` still means "the pick has no edit". `:378`, `:393` and `:396` call it inside `expect.poll`, after `clickElement(page, '#title')` already captured a pick, so the throw cannot fire there. |
| `openThread` | pins skips the `toBeVisible` wait on the pin and finds Close with `{ name: 'Close' }` (not exact) | commentsPanel's survives. For pins, the added `toBeVisible` wait is stricter: it is strict-mode, and every pins `pinOf(id)` is unique. The thread has exactly one button named "Close" (commentsPanel asserts that same button with `exact: true`), so the focus check asserts the same element. The browser run confirms both. |
| `picking` `screenBox` | No scale (frame box + raw rect) | `frameElementBox` scales by wrapper width / `innerWidth`. `picking.spec.ts` never leaves zoom 1 (only `openHarness` sets a view, `zoom: 1`; `reveal` pans), so the scale is exactly 1 and the boxes are identical. |
| `commentPopover` `pointInFrame` | No scale, own frame-local read | Same as above: the spec never leaves zoom 1 (frames A and B, widths 400 / 700). |
| `pins` `elementBox` | Playwright `boundingBox` via `frameLocator`: auto-waits for attach, uses a strict locator, throws on a `null` box. It then scales `element - frame` by wrapper width / `innerWidth` | `frameElementBox` reads `getBoundingClientRect` in the frame and scales by the same ratio, so the box is the same at 100% and at 50% (the zoom test) and during the drag and resize. It uses `querySelector` (first match, not strict). That is harmless because each selector (`#title`, `#mover`, `body`, `#doomed`) matches one element. It does not auto-wait, and inside `expectPinOn`'s `expect.poll` a missing element fails at once (see above). Every selector exists when it is read: the reload test reads after `anchorAnswers` moved past the old count, so the new document is there. `frameOf` already threw on a missing frame in both versions. Sub-pixel differences between `boundingBox` and the client rect sit inside `withinOnePx` and the `+6` px click offsets. |
| `commentsPanel` `elementRect` + `screenRectOf` | Scale from `JUMP_FRAME.width` (1400) not `innerWidth`; a missing element reads as a zero box instead of throwing | The iframe's `innerWidth` is the frame's CSS width (1400), so the scale is equal (1 and 2 in the two tests). `#target` and `#tall` exist in the jump fixture, so the zero-box path never ran. |
| `picksOf` (editMode) | `frameId` fixed to `'a'` | Call sites pass `'a'`. |

Must not break: every browser test's assertions and pass/skip count; `vp check` format, lint and
type check over `tests/browser`.

## Build steps

1. **Move every twin in one pass.** Apply "Into `harness.ts`" and all five "Spec by spec" blocks
   together. Each spec's import list is final only once both its helper moves and its element-box
   swap are in. A partial pass breaks lint: for example, `frameElementBox` would be imported with
   no caller, or `type FrameRect` would be dropped while `picking`'s `elementRect` still uses it.
   Then run `pnpm exec vp check --fix` so formatting reflows the moved declarations and imports.
   Done when:
   - `pnpm verify` passes.
   - `pnpm test:browser` reports 164 passed, 198 skipped.
   - `git grep -nE "^const (picksOf|lastPick|reload|openThread|elementRect|screenBox|elementBox) " -- tests/browser/*.spec.ts`
     prints nothing.
   - `git grep -n "state: await savedState" -- tests/browser/*.spec.ts` prints nothing.

## Verify

- `pnpm verify`. `vp check` covers the specs: it formats, lints and type-checks `tests/browser/**`
  (type-aware lint with `typeCheck: true`; a probe file with a type error under `tests/browser`
  failed `vp lint` with TS2322). So a wrong import, a dropped-but-used name or a signature mismatch
  fails here. The `tsc` and `vp test` steps do not include `tests/browser`: `tsconfig.json` is
  `src` only, `tsconfig.webview-tests.json` is `src/webview/**/*.test.ts`, and Vitest runs
  `src/**/*.test.ts`.
- `pnpm test:browser` (local only, not Verify or CI): same count as main `ca0f407` today,
  **164 passed, 198 skipped** (recorded 2026-11-20, 2.7 min).
- The greps cover only `*.spec.ts` and the names listed. They do not cover the out-of-scope
  gallery helpers (`gallery/interact.ts` `openThread`, `pointIn`).
- No change under `src/`: `git diff --stat main -- src` is empty.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":13133,"specSha256":"934d2dc3c58974b57c9026eb33e81e9cd4ac503fe572fff61fab9198cb4d7bff","branch":"refs/heads/fix/share-browser-test-helpers","head":"ca0f407eafa48c427ea18b1291b48c3a396288f9","baseRef":"refs/heads/main","baseCommit":"ca0f407eafa48c427ea18b1291b48c3a396288f9","sourceTree":"7ef31e26bcfc6b3e998c25705b128c5626ee950d","landing":"local-merge","absentOptional":[]} -->

## Completion gates

- Verify: `pnpm verify` passed at completion (`vp check` clean over 202 files; Vitest 59 files, 729 tests; pack and webview build).
- Browser: `pnpm test:browser` reported 164 passed, 198 skipped, the same as main `ca0f407`.
- Audit: `/audit current` ran, clean; no findings recorded for this fix.
- Independent review: not selected (`when-sensitive`; test-only refactor, no sensitive category).
- Check: `manual`, not requested.
- Try guide: skipped. Test-only change with no user-observable behavior; the browser suite count above is the only observation, and it is a check, not a manual try path.
