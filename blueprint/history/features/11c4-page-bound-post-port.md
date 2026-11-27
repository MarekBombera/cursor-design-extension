# Feature: Page-bound post port

**From build-plan:** feature 11c4
**Build attempt:** 1
**Branch:** feature/page-bound-post-port
**Status:** verified (steps 1-2 built; probe red; `pnpm test:browser` 231 passed; `pnpm verify` passed 2026-11-27: 75 files, 927 tests)

## Goal

Today four webview state classes each store their page id and call one of three hostBridge post
helpers with it: `CanvasState` calls `postFramePlace(this.pageId, …)`, `CommentsState` and
`CommentPicker` call `postCommentRequest(this.#pageId, …)`, `EditState` calls
`postEditRequest(this.#pageId, …)`. After this item, `DesignPage.svelte` builds one page-bound post
port once, `pageBoundPost(pageId)` from `hostBridge.svelte.ts`, and hands that same function (one
identity, no per-class wrapper) to all four classes. The classes post page-free messages through it
and no longer import a post helper or hold a page id for posting.

Behavior is unchanged: every request leaves the chrome with the same bytes as today
(`{ ...$state.snapshot(message), pageId }`, same key order). No message, host code or disk write
changes.

## In scope

- `src/webview/hostMessages.ts`: one new exported type, `PagePost<Message>`, and the `PageFree`
  comment points at `pageBoundPost` (Data / contracts has both literal texts).
- `src/webview/hostBridge.svelte.ts`: `postFramePlace`, `postCommentRequest` and `postEditRequest`
  are deleted and replaced by one export, `pageBoundPost(pageId)`. `postPageRequest`, `postToFrame`,
  the saved-state helpers and `connectHostBridge` are unchanged.
- `src/webview/DesignPage.svelte`: builds the port once and passes it as `post` to the four
  constructors.
- `src/webview/canvasState.svelte.ts`: constructor becomes `({ pageId, post })`; `pageId` is kept
  only for the saved stage view (`readSavedStageView` match, `saveStageView` stamp) and becomes
  private `readonly #pageId`; the frame place posts through `this.#post`.
- `src/webview/commentsState.svelte.ts`, `src/webview/commentPicker.svelte.ts`,
  `src/webview/editState.svelte.ts`: the `pageId` constructor field and `#pageId` go; a `post`
  constructor field and `readonly #post` take their place; every post site calls
  `this.#post(message)`.
- Each class narrows its port to the requests it sends (Data / contracts: Constructors), so a class
  cannot post another class's request.
- `tests/browser/editMode.spec.ts`: the Undo test's `toMatchObject` gains `pageId: 'page-1'`, so
  `artboard:history` is the last page-bound family with a browser assert on its `pageId`.
- Docs that name the deleted helpers: rule 08 owner catalog, system map "Page-scoped panel (10b)"
  (step 2 has the exact text).

## Out of scope

- The saved-state helpers (`readSavedStageView`, `saveStageView`, `readSavedCommentsPanelOpen`,
  `saveCommentsPanelOpen`, `readSavedCommentUi`, `saveCommentUi`) and `postToFrame`: the 11c4 line
  names only the page-bound post helpers. `CanvasState` and `CommentsState` still import those from
  `hostBridge`, so they stay unit-untestable in Node; a saved-state port would be its own item.
  (`EditState` and `CommentPicker` import nothing from `hostBridge` after this change.)
- `postPageRequest` and `PagesMenuState`: page requests name a target page, not the staged one
  (rule 02), and App owns them.
- `PinThread` (posts nothing to the host) and `App.svelte`.
- A Vitest test of the classes or of `pageBoundPost`: `.svelte.ts` runes and `acquireVsCodeApi` do not
  run in Node Vitest, and `pageBoundPost` is a one-line spread. The browser specs are the check
  (Testing).
- Host code, message shapes, `parseHostMessage` (11d), comments restructuring (11e), Agent skill,
  README, `pnpm gallery` (nothing visual changes).

## Build loop

`workflow.stepReview: feature`: build both steps, then present the whole feature for review once.
`workflow.checkpointCommits: disabled`: no commit per step; `/complete` makes the one commit, so
every step's work stays uncommitted until then. Never `git checkout` or `git restore` a file this
feature touched.

Iterate with `pnpm run check` (lint and types of the `.ts` files) plus
`pnpm exec svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings` (the only type check
of `DesignPage.svelte`, the one `.svelte` call site; `check` does not run it). Run the five browser
specs in step 1's Done when once after step 1, the full `pnpm test:browser` once at the end, then
`pnpm verify`.

## Build steps

1. [x] **One port, four classes.** Add `PagePost` to `hostMessages.ts` and `pageBoundPost` to
   `hostBridge.svelte.ts` exactly as Data / contracts specifies, and delete the three old post
   helpers with their comments. Imports:
   - `hostBridge.svelte.ts` drops `PageFree` from its `./hostMessages` import and adds `PagePost`;
     it keeps the four message types `pageBoundPost` names.
   - Each class imports `PagePost` and its message types with `import type` from `./hostMessages`,
     merged into the file's existing `./hostMessages` import (`canvasState`, `commentsState`,
     `editState` have one; `commentPicker` gets a new `import type` line). Each drops its
     `post*` import from `./hostBridge.svelte`; an import left empty is deleted.

   Rewire the four classes and `DesignPage.svelte` (Data / contracts: Constructors). Comments:
   `CanvasState`'s field comment becomes exactly
   `// The page this state belongs to ('' is "no page"); only the saved stage view is matched to it.`;
   the `#pageId` field comments in the other three classes are deleted with their fields. Add
   `pageId: 'page-1'` to the Undo test's `toMatchObject` in `tests/browser/editMode.spec.ts`
   (`{ type: 'artboard:history', pageId: 'page-1', frameId: 'a', step: 'undo' }`).

   Probe (after the specs pass): copy `src/webview/hostBridge.svelte.ts` to the session scratchpad;
   in the working file change `pageBoundPost`'s body to post `{ ...$state.snapshot(message) }` (no
   `pageId`); rebuild the chrome (`pnpm exec vp build -c vite.webview.config.ts`); run
   `pnpm exec playwright test -c tests/browser editMode.spec.ts --grep "Undo posts a step"` and
   confirm it fails; copy the saved file back; `diff` between the saved copy and the working file
   prints nothing; rebuild the chrome again. Never run the probe while another agent runs browser
   tests on this tree.
   - **Done when:** `pnpm run check` passes;
     `pnpm exec svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings` passes;
     `grep -rn "postFramePlace\|postCommentRequest\|postEditRequest" src tests` prints nothing;
     `grep -n "pageId" src/webview/commentsState.svelte.ts src/webview/commentPicker.svelte.ts src/webview/editState.svelte.ts`
     prints nothing; `grep -c "pageBoundPost(pageId)" src/webview/DesignPage.svelte` prints 1; the
     browser specs `stage.spec.ts`, `commentsPanel.spec.ts`, `commentPopover.spec.ts`,
     `editMode.spec.ts` and `pages.spec.ts` pass; the probe failed the Undo test and its restore
     `diff` printed nothing.
2. [x] **Docs.** Literal edits:
   - `.claude/rules/08-svelte-chrome.md`, Owner catalog, the `hostBridge.svelte.ts` bullet (one
     line in the file): replace
     `` its page-bound post functions are the only place a request gets its `pageId` `` with
     `` `pageBoundPost(pageId)` is the only place a request gets its `pageId`: `DesignPage` builds the page's one post port and hands it to `CanvasState`, `CommentsState`, `CommentPicker` and `EditState` ``.
   - `blueprint/context/system-map.md`, "Page-scoped panel (10b)", the Chrome → host bullet. In the
     file it wraps over two lines:

     ```
     - **Chrome → host.** The 8 page-bound requests carry `pageId`, added in one place by the three post
       functions in `hostBridge.svelte.ts` (the state classes pass their constructor `pageId`). The host
       parser requires `isPageId` before any path is built.
     ```

     Replace the bullet with (re-wrapped at about 100 columns, two-space continuation indent):

     ```
     - **Chrome → host.** The 8 page-bound requests carry `pageId`, added in one place by
       `pageBoundPost(pageId)` in `hostBridge.svelte.ts`: `DesignPage` builds it once per page and the
       state classes post page-free messages through it. The host parser requires `isPageId` before
       any path is built.
     ```
   - **Done when:**
     `grep -rn --exclude='current-feature*' --exclude='feature-review.md' --exclude='findings.md' "post functions\|three post\|postFramePlace\|postCommentRequest\|postEditRequest" .claude/rules blueprint/context skills docs README.md CONTRIBUTING.md AGENTS.md`
     prints nothing (`three post` is the guard for the wrapped map line; the work-item files name
     the old helpers on purpose; archives under `blueprint/history/` keep their text); the full
     `pnpm test:browser` passes once; `pnpm verify` passes.

## Files / areas

- `src/webview/hostMessages.ts` (type + comment)
- `src/webview/hostBridge.svelte.ts`
- `src/webview/DesignPage.svelte`
- `src/webview/canvasState.svelte.ts`
- `src/webview/commentsState.svelte.ts`
- `src/webview/commentPicker.svelte.ts`
- `src/webview/editState.svelte.ts`
- `tests/browser/editMode.spec.ts` (one assert)
- `.claude/rules/08-svelte-chrome.md`, `blueprint/context/system-map.md`

## Data / contracts

No message, disk or host contract changes. The page-bound requests (`frame:place`, the five
`comment:*` writes, `artboard:edit`, `artboard:history`) keep their shapes; the host parser is
untouched.

**Type** (`hostMessages.ts`, directly below `PageFree`):

```ts
// One page's post port: takes a page-free request, posts it with the page's `pageId`. DesignPage
// builds one per page with hostBridge's `pageBoundPost`; each state class narrows it to the
// requests it sends.
export type PagePost<Message> = (message: PageFree<Message>) => void;
```

**`PageFree` comment**, first line becomes exactly:
`// A page-bound request as the pure rules build it; only hostBridge's pageBoundPost adds \`pageId\`.`
(the second line, "Distributive, …", is unchanged).

**Port** (`hostBridge.svelte.ts`, replacing the three helpers and their comments):

```ts
// The only place a page-bound request gets its page: the pure rules build it page-free.
// Snapshot: callers pass gesture fields and drafts that are $state proxies, and postMessage's
// structured clone throws DataCloneError on a Proxy.
export const pageBoundPost =
	(
		pageId: string,
	): PagePost<FramePlaceMessage | CommentRequestMessage | ArtboardEditMessage | ArtboardHistoryMessage> =>
	(message) => {
		vscodeApi.postMessage({ ...$state.snapshot(message), pageId });
	};
```

The format is whatever `vp check --fix` produces; the body and the type are fixed.

**Constructors.** Each class narrows the port to what its pure rules already return
(`frameGesture.ts` `commit`, `commentPopover.ts` `submitDraft`, `commentActions.ts` `submit*`,
`editRequests.ts` `send`). The one port, typed with the wider union, is assignable to each narrower
`PagePost` (parameter contravariance). Fields are `readonly`, declared with the class's existing
`readonly #…` fields.

| Class | Constructor argument | Fields |
| --- | --- | --- |
| `CanvasState` | `{ pageId: string; post: PagePost<FramePlaceMessage> }` | `readonly #pageId`, `readonly #post` |
| `CommentsState` | `{ post: PagePost<Exclude<CommentRequestMessage, CommentCreateMessage>>; replyDrafts }` (`replyDrafts` unchanged) | `readonly #post` |
| `CommentPicker` | `{ canvas; pinThread; post: PagePost<CommentCreateMessage>; mode; heldDraft }` | `readonly #post` |
| `EditState` | `{ canvas; picker; post: PagePost<ArtboardEditMessage \| ArtboardHistoryMessage> }` | `readonly #post` |

`DesignPage.svelte`, in place of today's constructor block:

```ts
const post = pageBoundPost(pageId);
const canvas = new CanvasState({ pageId, post });
const comments = new CommentsState({ post, replyDrafts });
const pinThread = new PinThread({ canvas, comments, heldThreadId });
const picker = new CommentPicker({ canvas, pinThread, post, mode, heldDraft });
const edit = new EditState({ canvas, picker, post });
```

The existing "One module per domain, in dependency order" comment stays above it. `CanvasState`'s
`#post` is set in the constructor before any handler can run (handlers are arrow fields called only
from events).

**Equivalence.** Each old call `postX(this.pageId | this.#pageId, m)` becomes `this.#post(m)` with
the same `m`, at the same place in the same handler. All three old helpers posted
`{ ...$state.snapshot(message), pageId }`, so the posted object is identical. The page id is the same
value: every class got `pageId` from the same `untrack(() => start)` destructure in `DesignPage`.

## Testing

No new test file (Out of scope says why). The check is the existing browser specs, which assert the
`pageId` on every page-bound family:

- `frame:place`: `stage.spec.ts` (`pageId: 'page-2'`).
- `comment:create` on another page: `pages.spec.ts` ("B's request names B").
- `comment:set-status`, `comment:reply`, `comment:copy`, `comment:copy-open`:
  `commentsPanel.spec.ts` (`pageId: 'page-1'`).
- `artboard:edit`: `pages.spec.ts` (`pageId: PAGE_A`).
- `artboard:history`: `editMode.spec.ts` Undo test, after step 1 adds `pageId: 'page-1'`.
- The `$state.snapshot` move: the drag posts in `stage.spec.ts` and the comment draft posts in
  `commentPopover.spec.ts`, which throw `DataCloneError` without it.

These are the five specs step 1 runs. One mutation probe (step 1) proves the `pageId` assert
catches a port that drops it. `pnpm verify` runs no browser spec, so the browser runs are separate
gates.

## Notes for the AI

- Rule 08: `.svelte` and `.svelte.ts` edits go through the Svelte MCP autofixer (or the
  `svelte-file-editor` agent). Never weaken lint.
- `canvas.pageId` has no reader outside `canvasState.svelte.ts` today (`pageStart.ts` reads a
  `CanvasUpdatedMessage.pageId`, not the class). Confirm with
  `grep -rn "canvas\.pageId" src/webview` before making it private; a reader found means stop and ask.
- Keep each post at its current place in its handler; do not merge or reorder state writes around
  it (answers match on `requestId`, set before the post).
- Do not add a comment in `DesignPage.svelte` that names `pageBoundPost(pageId)` (the grep counts 1).
- `knip` must stay clean: the three deleted helpers leave no orphan import.
- Browser runs: one browser-running agent per tree (shared `dist/`).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":14431,"specSha256":"88a92fcc63b7207fa380751457b547047fb219d9e281ff94154503fc15122038","branch":"refs/heads/feature/page-bound-post-port","head":"c52b5b3ee6208bb57add1623cdd58c5eb6867c2f","baseRef":"refs/heads/main","baseCommit":"c52b5b3ee6208bb57add1623cdd58c5eb6867c2f","sourceTree":"e21ba34ea235377fd4d83afcbeeda01263432aa2","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11c4/F-01 [P3] closed - `PagePost` comment says hostBridge builds the port; DesignPage does

**File:** src/webview/hostMessages.ts:241
**Found:** 2026-11-27 by /audit (scope: current; lens: all; found by: breaker)
**Why it matters:** The comment names the wrong builder: `pageBoundPost` is the factory, and `DesignPage` calls it once per page. An agent reading the type looks in the wrong place for where a page gets its port.
**Suggested fix:** Reword to "`DesignPage` builds one per page with hostBridge's `pageBoundPost`", here and in the spec's Data / contracts copy.
**Resolution:** Reworded in `hostMessages.ts` and the spec's Data / contracts block (2026-11-27). Closed 2026-11-27 by a fresh Opus 5.5 re-review: the comment matches `DesignPage.svelte` (one `pageBoundPost(pageId)` per mount) and the spec copy is identical; no new finding.

## Gates

- Audit: dual review (Breaker Opus 5.5, Literalist Sonnet 5.5), both PASS; F-01 (P3) found by breaker, fixed, closed by a fresh Opus 5.5 re-review.
- Independent review: not selected (`when-sensitive`; no sensitive category).
- Try it now: skipped; a pure refactor with no safe direct observation (request bytes unchanged).
