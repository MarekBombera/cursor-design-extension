# Feature: Panel refresh + frame key

**From build-plan:** feature 11a
**Build attempt:** 1
**Status:** verified
**Branch:** feature/panel-refresh-frame-key

## Goal

The host has one way to refresh the panel: `refreshPanel()`, last started wins. A refresh never
posts after a newer refresh has started, so a slow read overtaken by a newer refresh can no longer
put old frames on the stage or wipe undo history through `keepUnchangedHistories`. Writes that
start no refresh of their own (the `artboard:edited` answer, an MCP write still inside the 200 ms
watcher debounce) can still be straddled by the latest refresh; its watcher echo corrects the stage
(see the `ponytail:` in Data / contracts). The frame caches key by page as well as frame id, so the
same frame id on two pages never shares or thrashes one cache entry. This lands before 10c, whose
`open_page` / `create_page` switch pages under a live panel.

## In scope

- New `src/host/refreshPanel.ts` exporting `refreshPanel` (contract in Data / contracts). It holds the
  one module-level refresh generation and is the one place the snapshot-then-comments pair is
  posted.
- Every snapshot post goes through it:
  - `handleOpenArtboard.ts`: Open Artboard (`initAndLoadArtboard`) and
    `reloadVisibleArtboardFromDisk` (panel became visible, workspace folders changed). Both post a
    snapshot, then comments, today. The reload function is deleted; its callers in `extension.ts`
    call `void refreshPanel({ outputChannel })` (safe as a bare `void`: `refreshPanel` never
    rejects).
  - `watchArtboardDisk.ts`: posts a snapshot, then comments, today. `refreshWatchedArtboard`
    becomes `({ outputChannel }) => hasCurrentArtboardPanel() ? refreshPanel({ outputChannel }) :
    undefined` (async; `workspaceFolder` and `token` params go). Both `watchGeneration` lines go:
    the `watchGeneration += 1` in `disposeArtboardWatcher` and `const token = ++watchGeneration` in
    `runDebouncedWatch`, plus the `let watchGeneration` declaration. A folder change always starts a
    newer `refreshPanel`, which supersedes an in-flight old-folder read. Drop the now-unused imports
    (`readActiveArtboardFromDisk`, `postArtboardSnapshotToPanel`, `postPanelComments`);
    `firstWorkspaceFolder` stays (used by `runDebouncedWatch` and `replaceArtboardWatcher`).
  - `extension.ts` frame place: posts only a snapshot today (no comments). `placeFrameFromChrome`
    keeps its write and its error rules but no longer reads or returns a snapshot; it returns
    `Promise<string | undefined>`, the error copy or `undefined`. `extension.ts` calls
    `refreshPanel({ outputChannel, errorMessage })` inside the `.then` of `placeFrameFromChrome`,
    so the refresh's generation is taken after the write, at read start.
- **Decision (diverges from the build-plan wording):** the plan calls frame place a "post snapshot,
  then post comments" path; it posts only a snapshot today. Going through the one refresh, frame
  place now also re-reads the comment list: one more `resolveOpenPage` + `readComments` + flag check
  per drag or resize commit (the watcher echo of a successful place already does the same). Accepted
  for one way to refresh; no message shape changes. `/complete` records this in the Notion note.
- **One behaviour change in frame place:** its outer catch (unreachable in practice: the inner reads
  never reject) used to post an empty snapshot that cleared the stage; now it returns
  `toSafeArtboardErrorMessage(error)` and the refresh shows that banner over the real page. Update
  the doc comment above `placeFrameFromChrome` (today "every attempt is answered with one fresh
  snapshot") to: "Never rejects: returns the error copy for the banner, or undefined; the caller
  refreshes the panel after it."
- `frameCacheKey` in `src/disk/commentViews.ts` takes `{ workspaceRoot, pageId, frameId }` and
  returns `` `${workspaceRoot}\0${pageId}\0${frameId}` ``. Param shapes:
  `cachedArtboardDocument({ workspaceRoot, pageId, frameId, html })`,
  `panelFrameHtml({ workspaceRoot, pageId, frameId, html, onTagError })`,
  `panelFrames({ workspaceRoot, pageId, frames, onTagError })`. Callers pass `page.pageId`:
  `commentViews.ts` `loadArtboardDocument` (both its key and its `cachedArtboardDocument` call),
  `artboardEditFs.ts` `editArtboard`, `panelEdit.ts` `postEdited`, `artboardDisk.ts`
  `snapshotFromCanvasView`; the untrusted memo clear in `loadActiveSnapshot` passes `pageId: ''`
  with no frames.
- `editHistory` keys stay `{ pageId, frameId }` (10b): no change, the existing
  `editHistory.test.ts` page tests stay green.
- Docs, exact targets:
  - Rule 05 (`.claude/rules/05-single-job.md`), the `src/commands/` bullet: replace
    "`handleOpenArtboard.ts` → Open Artboard and reload of the visible artboard." with
    "`handleOpenArtboard.ts` → Open Artboard; `refreshPanel.ts` → the one panel refresh (snapshot,
    then comments, last started wins; every snapshot post goes through it)."
  - System map (`blueprint/context/system-map.md`), Panel open and handshake, the bullet at line 243
    today: "When the panel becomes visible, the workspace folders change, the watcher fires, Open
    Artboard runs or a frame place is written, `refreshPanel` (11a) reads a fresh snapshot and, unless
    a newer refresh started meanwhile, posts it and then the comment list. The comment read keeps
    its own last-started-wins generation." Lines 74 and 108 stay as they are (`placeFrameFromChrome`
    still resolves the requested page; `readActiveArtboardFromDisk` is still the read).

## Out of scope

- 11b–11e (request preamble, comments write shell, MCP open-page wrapper, handlers object, ports,
  watcher pure step, host message guard, comments review).
- Comment-only refreshes after a comment request (`panelComments.ts`, the two
  `void postPanelComments` calls in `answerCommentRequest` and its `refuse`) keep calling
  `postPanelComments` directly; it keeps its own last-started-wins `readGeneration`.
- The 10b `ponytail:` "only the latest list is held" in the chrome, and the snapshot and comment
  reads resolving the open page separately (a `project.json` change between them shows the next
  page's list late; the watcher refresh that change causes corrects it).
- The edit answer path (`artboard:edited`, `panelEdit.ts`): it posts an answer, not a snapshot.
- Any chrome, MCP, Agent skill, disk format or message change.

## Build loop

`workflow.stepReview: feature`: build all steps, then one review at the end. Checkpoint commits
disabled; `/complete` makes the commit. Per step: the step's unit tests (`pnpm test <file>`), then
`pnpm run check`. After the last step: `pnpm verify`, and one `pnpm test:browser` run (host-only
change; the browser suite uses a mocked host, so it is a regression check only).

## Build steps

1. [x] **Frame cache key carries the page.** Change `frameCacheKey` and the three param shapes as in
   In scope, and their callers. Update the existing tests' call sites: `canvasSnapshot.test.ts`
   (including the `cachedArtboardDocument` calls `deepEqual` near line 91, which now include
   `pageId`), `artboardEditFs.test.ts`, and `comments.test.ts` "cachedArtboardDocument and a later
   flag read share one parse" (pass `pageId: FIRST_PAGE_ID`, the page its `readComments` uses, so it
   still proves the shared parse). Add one test in `canvasSnapshot.test.ts` with HTML unique to that
   test (the `taggedFrames` memo is module state shared across the file): `panelFrameHtml` for frame
   `hero` on `page-1` (HTML A), then `hero` on `page-2` (HTML B), then `hero` on `page-1` with HTML A
   again: the third call makes no new `cachedArtboardDocument` call and returns the first call's
   tagged string.
   **Done when:** that test fails against today's two-part key and passes after; `pnpm test` and
   `pnpm run check` green.
2. [x] **`refreshPanel`.** Add `src/host/refreshPanel.ts` (contract below) and
   `src/host/refreshPanel.test.ts`. Mocks, in the style of `panelComments.test.ts`: `vscode`
   (`workspace.isTrusted` only), `./hostFs` (`firstWorkspaceFolder`, `logDiskError`),
   `./artboardDisk` (`initAndLoadArtboard`, `readActiveArtboardFromDisk` with controllable
   promises), `./panelComments` (`postPanelComments`), `../panel/openArtboardPanel`
   (`postArtboardSnapshotToPanel`). `./canvasSnapshot` is real. Tests:
   - two refreshes, the first one's read resolving after the second's: exactly one snapshot posted
     (the second's), and `postPanelComments` called once, after it;
   - `initialize: true` reads with `initAndLoadArtboard`, otherwise `readActiveArtboardFromDisk`;
   - `errorMessage` shows when the snapshot has none (the snapshot's `pageId` kept); a snapshot
     error wins over it;
   - no folder: one empty snapshot (`pageId: ''`, no frames) carrying `errorMessage`, no disk read;
     untrusted with no folder: the untrusted copy;
   - a throwing `postArtboardSnapshotToPanel`: `refreshPanel` resolves and `logDiskError` is called
     once with scope `refreshPanel`.
   **Done when:** those tests pass, and the first one fails when the generation check is removed.
3. [x] **Route the three paths through it.**
   - `handleOpenArtboard.ts`: keeps only `handleOpenArtboard`. `firstWorkspaceFolder()` stays as a
     guard only (no-folder branch unchanged: error message, open the panel, no post); otherwise
     `await refreshPanel({ outputChannel, initialize: true })`, then `openArtboardPanel`, then
     `ensureArtboardWatcher`. Drop the unused imports (`initAndLoadArtboard`,
     `readActiveArtboardFromDisk`, `emptyArtboardSnapshot`, `UNTRUSTED_WORKSPACE_MESSAGE`,
     `postPanelComments`, `postArtboardSnapshotToPanel`).
   - `extension.ts`: visible and folder-change handlers call `void refreshPanel({ outputChannel })`;
     frame place is `void placeFrameFromChrome({ value, outputChannel }).then((errorMessage) =>
     refreshPanel({ outputChannel, errorMessage })).catch(...)` (the existing log). Drop the
     `postArtboardSnapshotToPanel` and `reloadVisibleArtboardFromDisk` imports.
   - `watchArtboardDisk.ts`: as in In scope (the marker path still opens the panel, refreshes, then
     deletes the marker).
   - `artboardDisk.ts` `placeFrameFromChrome`: returns the copy, no read; doc comment as in In scope.
   - `artboardDisk.test.ts`, each affected test:
     - "Open resolves with createIfFresh; the refresh and frame:place's refresh do not": drop the
       `placeFrameFromChrome` call, assert `[false]` after the refresh, retitle to "Open resolves
       with createIfFresh; the refresh does not".
     - "a frame:place for page-1 while page-2 is open places on page-1's location": keep the
       `resolveRequestedPage` and `placeFrame` asserts; the result is `undefined`; drop the
       `snapshot.pageId` assert and its "answer is the open page's snapshot" comment (step 2's
       `errorMessage` test covers that the refresh keeps the open page).
     - "a frame:place for a gone page answers the open page with the page copy": the result equals
       `PAGE_GONE_MESSAGE`, no `placeFrame` call; retitle "... returns the page copy".
     - "an untrusted Open, refresh or frame:place touches no page": the two loads keep asserting
       `.errorMessage`; the place result is asserted on its own to equal
       `UNTRUSTED_WORKSPACE_MESSAGE`; no resolver and no `placeFrame` call as today.
     - "a malformed frame:place places nothing and answers the move copy": the result equals
       `'Could not move the frame. Try again.'`.
   - Rule 05 and system map edits as in In scope.
   **Done when:** `grep -rn "postArtboardSnapshotToPanel(" src` shows only its definition in
   `openArtboardPanel.ts`, the call in `refreshPanel.ts` and its test mock;
   `grep -rn "reloadVisibleArtboardFromDisk\|watchGeneration" src blueprint/context/system-map.md`
   is empty; `grep -n "refreshPanel" src/extension.ts` shows the frame-place call
   `refreshPanel({ outputChannel, errorMessage })` inside the `.then` of `placeFrameFromChrome`
   (the wiring is untested: rule 09 excludes `activate`); `pnpm verify` green; one
   `pnpm test:browser` run green.
4. [x] **Audit repairs (F-06, F-07).** F-06: hold the frame-place error from the refresh's start
   until the next post (Data / contracts, Pending error); one test in `refreshPanel.test.ts` (a
   place refresh superseded by one that posts first: that post carries the error, the next does
   not). F-07: system-map lines 200 and 334 name the page; the drag chart shows the refresh and
   the held error.
   **Done when:** the new test fails with the old `snapshot.errorMessage ?? errorMessage` overlay
   and passes after; `pnpm verify` green.

## Files / areas

- New: `src/host/refreshPanel.ts`, `src/host/refreshPanel.test.ts`.
- Changed: `src/host/handleOpenArtboard.ts`, `src/host/watchArtboardDisk.ts`, `src/extension.ts`,
  `src/host/artboardDisk.ts` (+ test), `src/host/canvasSnapshot.ts` (+ test),
  `src/disk/commentViews.ts`, `src/disk/artboardEditFs.ts` (+ test), `src/host/panelEdit.ts`,
  `src/disk/comments.test.ts`.
- Docs: `.claude/rules/05-single-job.md` (catalog), `blueprint/context/system-map.md` (line 243
  bullet).

## Data / contracts

```ts
// src/host/refreshPanel.ts
export const refreshPanel = async ({
	outputChannel,
	initialize = false,
	errorMessage,
}: {
	outputChannel: vscode.OutputChannel;
	initialize?: boolean; // Open Artboard only: initAndLoadArtboard (createIfFresh)
	errorMessage?: string; // shown when the snapshot carries none (frame place copy)
}): Promise<void>;
```

- `const token = ++refreshGeneration` first, before any await.
- The whole body after the token sits in one `try`; the `catch` logs once with
  `logDiskError({ scope: 'refreshPanel', error, outputChannel })` and posts nothing. So
  `refreshPanel` never rejects, and its callers may use a bare `void` (rule 06 #5 satisfied at one
  site).
- Folder: `firstWorkspaceFolder()`. None: snapshot `emptyArtboardSnapshot(isTrusted ? undefined :
  UNTRUSTED_WORKSPACE_MESSAGE)` (as `reloadVisibleArtboardFromDisk` today), no disk call. Otherwise
  `initialize ? initAndLoadArtboard(...) : readActiveArtboardFromDisk(...)` (both catch their own
  disk errors; untrusted is handled inside `loadActiveSnapshot` without the resolver).
- Pending error (F-06): at start, `pendingErrorMessage = errorMessage ?? pendingErrorMessage`. The
  refresh that posts shows `snapshot.errorMessage ?? pendingErrorMessage` (a layout error is the
  more severe one, as today) and clears it. A failed place writes nothing, so only
  `artboard:error` ends the chrome's committing drag (`failFrameGesture`); a superseded place
  refresh must not drop it.
- `if (token !== refreshGeneration) return;`: a superseded refresh posts neither snapshot nor
  comments; the newer one posts both.
- Then `postArtboardSnapshotToPanel(snapshot)` and `void postPanelComments({ outputChannel })`
  (not awaited: Open does not wait on the comment read, as today; `postPanelComments` never
  rejects). Resolves after the snapshot post or the drop.
- One `ponytail:` comment on the generation naming two ceilings, each corrected by the next
  refresh (the watcher echo):
  1. the latest refresh can still straddle a write that starts no refresh of its own (an
     `artboard:edited` answer, an MCP write inside the 200 ms debounce) and post the pre-write
     frames; history survives (the pre-edit hash is held in undo);
  2. a non-initializing refresh that starts during Open's `initialize: true` read can read disk
     before the default artboard and `project.json` are written, and win.
  Upgrade path: a disk-side generation the read can compare.
- No message, disk or MCP contract changes. `canvas:updated`, `artboard:error`, `ui:status` and
  `comments:updated` keep their shapes and outbox order.

## Testing

- Unit (Vitest, colocated): `refreshPanel.test.ts` (new, step 2), the memo test in
  `canvasSnapshot.test.ts` (step 1), updated place tests in `artboardDisk.test.ts` (step 3).
- `pnpm verify` after the last step; one `pnpm test:browser` run as a regression check.
- No live claim: the race is proved by the unit test's controlled promise order, not in Cursor.
  10e's real-Cursor run covers page switching end to end.
- `extension.ts` wiring (the frame-place `.then` order, the `errorMessage` pass-through) has no test
  (rule 09 excludes `activate`); step 3's grep done-when is its check.

## Notes for the AI

- The race today: `handleOpenArtboard`, `reloadVisibleArtboardFromDisk` and frame place post
  whatever their read returns, with no generation; only the watcher checks its own token, and only
  against other watcher runs. A read that started earlier but resolves later posts old frames, and
  `outbox.postSnapshot` runs `keepUnchangedHistories` on them first, which forgets any history
  whose held hashes miss that stale hash.
- Taking the token after the place write matters: a token taken before the write would let a
  refresh started during a lock wait (reading pre-write disk) supersede the place's correct read.
- The watcher calls `refreshPanel` only after `hasCurrentArtboardPanel()`, so a watcher run with no
  panel takes no token and cannot supersede Open.
- `refreshPanel.ts` is a new file, not in `handleOpenArtboard.ts`: the watcher imports it and
  `handleOpenArtboard.ts` imports the watcher, so putting it there would make an import cycle.
  `refreshPanel.ts` imports only `artboardDisk`, `panelComments`, `openArtboardPanel`, `hostFs` and
  `canvasSnapshot`, none of which imports the watcher.
- Rule 04: `frameCacheKey` gains a third value, so it takes one object. Page ids cannot contain
  `\0`.
- Keep `postPanelComments`'s own generation: comment-request refreshes still use it directly.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":17753,"specSha256":"f91fe995e710d9f7a0c198e5945aadd7c7a814efcd2598d59553cd90a1d807dd","branch":"refs/heads/feature/panel-refresh-frame-key","head":"7963c1dd54f2c3cb8120e96cef42f1f33d6f9f44","baseRef":"refs/heads/main","baseCommit":"7963c1dd54f2c3cb8120e96cef42f1f33d6f9f44","sourceTree":"5a949f24d1ca0bacd3f270ec44f836536f775716","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11a/F-06 [P2] closed - A superseded failed frame place leaves the frame stuck with no banner

**File:** src/host/refreshPanel.ts:11
**Found:** 2026-11-23 by /audit (scope: current; lens: all)
**Why it matters:** ponytail ceiling 1 says "the frame snaps to the newer snapshot", but it does not. A failed place writes nothing, so the disk placement still equals the gesture's `base`; `settleFrameGesture` (src/webview/frameGesture.ts:178) keeps the `committing` gesture, and only `artboard:error` (`failFrameGesture`, :248) ends it. When the place's refresh is superseded, its error is dropped, so the frame shows a position never written, with no banner, until the next gesture. No watcher echo corrects it (nothing was written). Reachable on the typical failure: `WORKSPACE_BUSY` while the MCP holds the lock, the place refresh's `resolveOpenPage` waits on that lock, and the MCP write's watcher refresh starts and supersedes it. Before 11a the place snapshot (with its error) was posted unconditionally, so this is a regression.
**Suggested fix:** the spec's own upgrade path: a module-level carried error in `refreshPanel`. A superseded refresh with `errorMessage` stores it; the winning refresh posts `snapshot.errorMessage ?? errorMessage ?? carried` and clears it. One test in `refreshPanel.test.ts` (superseded refresh with an error; the newer one posts it). Correct the ceiling 1 text. About 3 lines.
**Resolution:** fixed 2026-11-23 by /implement (spec step 4): `refreshPanel` holds `pendingErrorMessage` from the refresh's start; the posting refresh shows `snapshot.errorMessage ?? pendingErrorMessage` and clears it. Test "a superseded frame-place refresh hands its error to the newer post, once" fails with the old overlay. Ceiling 1 removed from the `ponytail:`. Closed 2026-11-23 by /audit re-review: both orderings safe (error set before the first await), two mutation probes fail the test, a snapshot's own error still posts `artboard:error` so the drag ends; no new defect.

### 11a/F-07 [P3] closed - system-map still describes the two-part frame key and an unconditional place snapshot

**File:** blueprint/context/system-map.md:200
**Found:** 2026-11-23 by /audit (scope: current; lens: quality)
**Why it matters:** line 200 says "a parse cached per workspace and frame", line 334 "memo hit (same frame id, same disk HTML)", and the drag chart (958-961) shows `canvas:updated (always)` with no refresh step. All three are stale after 11a; agents read this map before changing cross-process flows.
**Suggested fix:** add the page to lines 200 and 334; mark the drag chart's `canvas:updated` as "via refreshPanel (dropped when a newer refresh started)".
**Resolution:** fixed 2026-11-23 by /implement (spec step 4): lines 200 and 334 name the page; the drag chart shows `refreshPanel` and the held `artboard:error`. Closed 2026-11-23 by /audit re-review: all three match the code; no other stale text in src, rules, skills or the map.
