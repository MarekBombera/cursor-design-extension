# Page test gaps and parallel browser tests (fix) - Overview for review

Source of truth: `blueprint/history/fixes/page-test-gaps-and-parallel-browser-tests.md`. This file is the steering summary, not the build spec.

## TL;DR

Three small follow-ups to 10b. The comments panel tests now check that reply, status and copy requests name their page (F-20). The panel stops holding a page's first canvas snapshot and comment list after the page has used them (F-21). The browser tests run in parallel, apart from a few timing-sensitive ones that still run alone, after the rest.

## What you will see

- Nothing in the panel: no behavior change.
- `pnpm test:browser` finishes faster: the Playwright run went from 170 s to about 85 s. The output shows two projects, `parallel` and `serial`; all 209 tests pass.
- `pnpm gallery` works as before.

## Scope at a glance

| In | Out |
|---|---|
| `pageId` in four `commentsPanel.spec.ts` assertions | New tests for other requests (already pinned) |
| Drop `stage.canvas` / `stage.comments` after mount; no `initial` object | Heap-profile test |
| `parallel` (5 workers, `CD_BROWSER_WORKERS`) and `serial` (`@serial`, 1 worker, after) projects | Browser tests in Verify or CI |
| AGENTS.md and rule 09 lines | Other config changes |

## Constraints

- The page must not remount when App drops the payload (`{#key stage.pageId}`).
- Serial tests never share CPU with parallel ones: the serial project depends on the parallel one. If a parallel test fails, the serial tests are skipped.
- Fixes F-20 and F-21, both closed by `/audit current`. The `page-9` mutation now fails exactly the 4 updated tests.
