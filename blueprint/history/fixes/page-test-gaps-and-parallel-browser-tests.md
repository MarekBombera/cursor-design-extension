# Fix: Page test gaps and parallel browser tests

**Type:** Fix
**Status:** verified (pnpm verify exit 0: 836 unit tests; pnpm test:browser 209 passed; pnpm gallery 208 passed)
**Branch:** fix/page-test-gaps-and-parallel-browser-tests
**Fixes:** F-20, F-21

## The problem

- **F-20 (test gap).** `CommentsState` sends `comment:reply`, `comment:set-status`, `comment:copy`
  and `comment:copy-open` with its constructor `pageId`, but `tests/browser/commentsPanel.spec.ts`
  asserts those requests with `toMatchObject` and no `pageId`. Hard-coding the id to `page-9`
  passes every browser test.
- **F-21 (retention).** `App.svelte` keeps the staging `canvas:updated` (every frame's first HTML,
  up to 1.5 M chars each) and `comments:updated` in `stage` for the page's whole life, and
  `DesignPage.svelte` holds the same object as `initial`. Both are read once at mount.
- **Slow browser suite.** `tests/browser/playwright.config.ts` runs every test on one worker
  (`workers: 1`, `fullyParallel: false`) because the stability quiet window and the CDP trackpad
  pan must not share CPU. Only a handful of tests need that.

## The fix

- **F-20:** add `pageId: 'page-1'` to the existing `toMatchObject` assertions for one request of
  each of the four types in `commentsPanel.spec.ts`. Test-only.
- **F-21:** in `DesignPage.svelte`, destructure the start fields from `untrack(() => start)`
  instead of holding `initial`; in `App.svelte`, after `flushSync()` in `stagePage`, replace
  `stage` with a copy whose `canvas` and `comments` are `undefined`. The `{#key}` reads only
  `stage.pageId`, so nothing remounts, and the mounted page reads `start` only at mount, so no
  behavior changes. Covered by the existing `pages.spec.ts` (switch, return, held draft, saved
  thread) and the rest of the suite; no new assert (a heap check is not cheap or stable).
- **Parallel browser tests:** two Playwright projects in the one config:
  - `parallel`: every test without the `@serial` tag, `fullyParallel: true`, the worker count from
    `CD_BROWSER_WORKERS` (default 5 on this 10-core Mac).
  - `serial`: tests tagged `@serial`, one worker, `dependencies: ['parallel']` so it starts only
    after the parallel project finishes and never shares CPU with it. Serial: the stage tests that
    use the quiet window (`frames load once…`, `dragging a label…`), the CDP trackpad pan, and the
    whole gallery (its `beforeAll` / `afterAll` share one output folder and manifest across tests).
  - A test that flakes under `--repeat-each=3` in the parallel project gets the `@serial` tag.
  - `pnpm test:browser` keeps working unchanged. `pnpm gallery` adds `--no-deps`: a file filter
    does not apply to dependency projects, so without it the gallery first runs the whole parallel
    project. Known ceiling: a failure in the parallel project skips the serial project
    (Playwright dependency rule).
  - Update the AGENTS.md "Browser tests" line and rule 09 to name the split and the tag.
- No new dependency, no production change outside F-21.

## Build steps

- [x] 1. F-20: add `pageId` to the four request assertions.
  **Done when:** `commentsPanel.spec.ts` passes, and in a scratch copy with
  `this.#pageId = 'page-9'` in `CommentsState` it fails.
- [x] 2. F-21: drop the staging payload after mount.
  **Done when:** svelte-autofixer is clean on both files, `svelte-check` passes, and the full
  browser suite passes.
- [x] 3. Split the browser projects and tag the serial tests; update docs.
  **Done when:** the full suite passes twice, the parallel project passes with `--repeat-each=3`,
  `pnpm gallery` runs the gallery only, and wall time before / after is recorded here.

## Verify

- `pnpm verify` exit 0.
- `pnpm test:browser` passes; `pnpm gallery` writes `test-results/gallery/`.
- Mutation: `page-9` in `CommentsState` fails `commentsPanel.spec.ts`.

## Results

- Mutation (scratch copy, `this.#pageId = 'page-9'`): the 4 updated `commentsPanel.spec.ts` tests
  fail, 32 pass.
- Browser wall time (Playwright run only, gallery skipped): before 170 s (1 worker); after 86 s and
  81 s (5 workers, then serial); `pnpm test:browser` including the build 78 s.
- `--project=parallel --repeat-each=3`: 618 passed, 0 flaky (195 s). Full suite twice: 209 passed
  each time. No test moved to `serial` for flakiness.
- Gallery: its `contrast` tests are tagged too (in another worker they left `contrast.json` with no
  pairs); 144 pairs, 328 manifest entries.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":4468,"specSha256":"d19ac9528bfa40c87f03ec1383629164b41891e347257edbdd9dd7523f024f21","branch":"refs/heads/fix/page-test-gaps-and-parallel-browser-tests","head":"f8c842b6e2cf06398df81099d3816e053d794ec0","baseRef":"refs/heads/main","baseCommit":"f8c842b6e2cf06398df81099d3816e053d794ec0","sourceTree":"b59a61f1ce4b7021b46f16281dc9a4d57b105610","landing":"local-merge","absentOptional":[]} -->

## Findings

### page-test-gaps-and-parallel-browser-tests/F-20 [P2] closed - No test pins the `pageId` on the reply, status and copy requests

**File:** src/webview/commentsState.svelte.ts:63
**Found:** 2026-11-23 by /audit independent (scope: current; lens: tests; reviewer: claude-fable-5-2, fresh subagent)
**Why it matters:** `CommentsState` sends four of the eight page-bound requests (`comment:reply`, `comment:set-status`, `comment:copy`, `comment:copy-open`) with its constructor `pageId`. Mutation probe in a scratch copy: setting `this.#pageId = 'page-9'` passes `pages.spec`, `commentPopover.spec`, `stage.spec`, `commentsPanel.spec`, `pins.spec` and `editMode.spec`. The browser tests pin the page only on `comment:create`, `artboard:edit` and `frame:place`; `commentsPanel.spec.ts` asserts these four requests with `toMatchObject` and no `pageId`. A wrong or stale id here would make the host act on another page's `comments.json` or answer "That page no longer exists." for every reply, status change and copy, and `pnpm verify` plus `pnpm test:browser` would stay green. The production code reads correctly today.
**Suggested fix:** Add `pageId: 'page-1'` to the existing `toMatchObject` assertions in `tests/browser/commentsPanel.spec.ts` for one request of each of the four types (lines 133, 180, 863, 933), or one `pages.spec` case that replies on B after a switch and expects `pageId: 'page-2'`. No production change.
**Resolution:** 2026-11-23 /implement (fix/page-test-gaps-and-parallel-browser-tests): `commentsPanel.spec.ts` now expects `pageId: 'page-1'` on one `comment:set-status`, `comment:reply`, `comment:copy` and `comment:copy-open` request. Mutation probe in a scratch copy (`this.#pageId = 'page-9'` in `CommentsState`): exactly those 4 tests fail, 32 pass. Test-only. 2026-11-23 /audit current (lean, all lenses, fresh reviewer): closed. Re-ran the same probe in a scratch copy: `commentsPanel.spec.ts` 4 failed (set-status, reply, copy, copy-open), 32 passed; unmutated tree green. No new defect.

### page-test-gaps-and-parallel-browser-tests/F-21 [P3] closed - The staging `canvas:updated` stays referenced for the page's whole life

**File:** src/webview/App.svelte:44
**Found:** 2026-11-23 by /audit independent (scope: current; lens: performance; reviewer: claude-fable-5-2, fresh subagent)
**Why it matters:** `stage` (`PageStart`) keeps the `canvas:updated` and `comments:updated` that staged the page, and `DesignPage.svelte:49` keeps the same object as `initial`. Both are read once at mount, but neither reference is dropped, so every frame's first-posted HTML (up to `MAX_POSTED_ARTBOARD_HTML_CHARS`, 1.5 M chars per frame) stays alive after later refreshes replaced it in `CanvasState.frames`. The cost is one stale copy of each frame's HTML until the next page change or webview reload. Unverified by a heap profile; read from the code.
**Suggested fix:** In `DesignPage.svelte`, destructure what the page needs from `untrack(() => start)` instead of holding `initial`, and in `App.svelte` drop the payload after the mount: `stage = { ...stage, canvas: undefined, comments: undefined }` after `flushSync()` (the `{#key}` reads only `stage.pageId`, so nothing remounts). No requirement is lost.
**Resolution:** 2026-11-23 /implement (fix/page-test-gaps-and-parallel-browser-tests): `App.svelte` `stagePage` replaces `stage` with a copy whose `canvas` and `comments` are `undefined` right after `flushSync()` (the `{#key}` reads only `stage.pageId`: no remount), and `DesignPage.svelte` destructures its start fields from `untrack(() => start)` instead of holding `initial`. Covered by the full browser suite (209 passed); no heap profile. 2026-11-23 /audit current (lean, all lenses, fresh reviewer): closed. Re-read: the second `stage` write keeps `pageId`, so `{#key stage.pageId}` sees an equal string and does not remount; `DesignPage` reads `start` only inside `untrack` at creation (no other read), so the dropped fields are never re-applied; `isPageChange` and `nextPageStart` read only `stage.pageId`/`stage.mode`, so later messages route as before. `latestComments` still holds the last list by design (its own `ponytail:`). No new defect.

## Try it now

Run or do:

`pnpm test:browser`

Expected:

Playwright runs two projects: `parallel` (5 workers by default, `CD_BROWSER_WORKERS` overrides) first, then `serial` (the `@serial` tests, one worker). All 209 tests pass, in roughly half the old wall time. `pnpm gallery` still runs only the gallery and writes `test-results/gallery/`.

This proves:

The browser suite runs in parallel, while the timing-sensitive and gallery tests still run alone after it.
