# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-20 [P2] open - No test pins the `pageId` on the reply, status and copy requests

**File:** src/webview/commentsState.svelte.ts:63
**Found:** 2026-11-23 by /audit independent (scope: current; lens: tests; reviewer: claude-fable-5-2, fresh subagent)
**Why it matters:** `CommentsState` sends four of the eight page-bound requests (`comment:reply`, `comment:set-status`, `comment:copy`, `comment:copy-open`) with its constructor `pageId`. Mutation probe in a scratch copy: setting `this.#pageId = 'page-9'` passes `pages.spec`, `commentPopover.spec`, `stage.spec`, `commentsPanel.spec`, `pins.spec` and `editMode.spec`. The browser tests pin the page only on `comment:create`, `artboard:edit` and `frame:place`; `commentsPanel.spec.ts` asserts these four requests with `toMatchObject` and no `pageId`. A wrong or stale id here would make the host act on another page's `comments.json` or answer "That page no longer exists." for every reply, status change and copy, and `pnpm verify` plus `pnpm test:browser` would stay green. The production code reads correctly today.
**Suggested fix:** Add `pageId: 'page-1'` to the existing `toMatchObject` assertions in `tests/browser/commentsPanel.spec.ts` for one request of each of the four types (lines 133, 180, 863, 933), or one `pages.spec` case that replies on B after a switch and expects `pageId: 'page-2'`. No production change.
**Resolution:**

### F-21 [P3] open - The staging `canvas:updated` stays referenced for the page's whole life

**File:** src/webview/App.svelte:44
**Found:** 2026-11-23 by /audit independent (scope: current; lens: performance; reviewer: claude-fable-5-2, fresh subagent)
**Why it matters:** `stage` (`PageStart`) keeps the `canvas:updated` and `comments:updated` that staged the page, and `DesignPage.svelte:49` keeps the same object as `initial`. Both are read once at mount, but neither reference is dropped, so every frame's first-posted HTML (up to `MAX_POSTED_ARTBOARD_HTML_CHARS`, 1.5 M chars per frame) stays alive after later refreshes replaced it in `CanvasState.frames`. The cost is one stale copy of each frame's HTML until the next page change or webview reload. Unverified by a heap profile; read from the code.
**Suggested fix:** In `DesignPage.svelte`, destructure what the page needs from `untrack(() => start)` instead of holding `initial`, and in `App.svelte` drop the payload after the mount: `stage = { ...stage, canvas: undefined, comments: undefined }` after `flushSync()` (the `{#key}` reads only `stage.pageId`, so nothing remounts). No requirement is lost.
**Resolution:**
