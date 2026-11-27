# Feature: Host tests on real disk

**From build-plan:** feature 11c2
**Build attempt:** 1
**Branch:** feature/host-tests-on-real-disk
**Status:** verified (all eight steps built, steps 7-8 = audit repairs F-06..F-08; 24/24 spec probes plus the F-06 and F-08 repair probes killed; `pnpm verify` passed 2026-11-27 after step 8: 74 files, 892 tests)

## Goal

The five host request and refresh test files that still mock the disk lib or a sibling host module
(`panelEdit`, `panelComments`, `panelPages`, `artboardDisk`, `refreshPanel`) run over a real temp
workspace plus the fake `PanelPorts` that 11c1 introduced. `panelEdit.history.test.ts` is already
there (11f AP6, done in 11c1) and changes only in one header comment. Afterwards the six host
request and refresh test files hold no `vi.mock`, `vi.importActual` or `vi.spyOn`, and the five
rewritten ones assert what a user would see: the answers and posts, the requested page's bytes
changed, the other page's bytes untouched, and a refused attempt leaving the workspace
byte-identical (11f AP1-AP3).

This is a test-only change, with one exception added by the audit (step 8, F-08, Bombic's
decision 2026-11-27): `toArtboardEdit` moves unchanged from `panelEdit.ts` to `chromeMessages.ts`
(exported, with a unit test). Apart from that, no file under `src/` other than these five
`*.test.ts` files and the `panelEdit.history.test.ts` header comment changes. If a test cannot be
expressed without a source change, a module mock or a spy on a module export, stop and report it; do
not add a seam.

## In scope

- Rewrite `src/host/artboardDisk.test.ts`, `refreshPanel.test.ts`, `panelPages.test.ts`,
  `panelComments.test.ts` and `panelEdit.test.ts` onto a real temp workspace per test plus a fresh
  fake ports object per test.
- Every guard the old tests covered stays covered (the probe list in each step is the check).
  Assertions on mock call order or mock arguments become assertions on answers, posts, logs and
  disk.
- Fix the header comment of `panelEdit.history.test.ts`, which says `panelEdit.test.ts` "mocks the
  disk lib instead". Nothing else in that file changes; its module-level `ports` and `vi.hoisted`
  host stay (it is exempt from the fresh-ports convention below).

## Out of scope

- Any change to source modules, messages, disk format, MCP tools, the Agent skill or the chrome
  (except step 8's behavior-preserving `toArtboardEdit` move).
  The private copy constants in `panelRequestCopy.ts` stay private: tests keep pinning them as local
  constants, as today.
- `canvasSnapshot.test.ts` and `hostFs.test.ts` mocks (11f AP4, AP5: the plan keeps them).
- `openArtboardPanel.test.ts` (the vscode edge).
- The watcher (11c3), webview post ports (11c4), `parseHostMessage` (11d).
- New coverage beyond what the old tests guarded. A new assertion is fine only where the real disk
  makes an old mock assertion observable (for example "page-1's bytes untouched").
- Browser tests and `pnpm gallery`: no chrome change.

## Build loop

`workflow.stepReview: feature`: build every step, then present the whole feature for review once.
`workflow.checkpointCommits: disabled`: no commit per step; `/complete` makes the one commit.
Iterate per file with `pnpm exec vp test run src/host/<file>.test.ts`; run `pnpm test` at the end
of each step and `pnpm verify` once after the last step.

Probes (each step's done-when): apply the named source change, run only that step's test file,
confirm at least one test fails, then revert it with `git checkout -- <file>`. Exception until `/complete`: step 5
a-c and step 8 edit `chromeMessages.ts` or `panelEdit.ts`, which hold the uncommitted step-8 repair,
so revert those probes by hand. After the last probe
of a step, `git diff --name-only -- src/host ':!src/host/*.test.ts'` prints nothing (after step 8:
only `chromeMessages.ts` and `panelEdit.ts`, the repair itself). Probes edit
the shared tree: never run them while another agent runs tests on this tree.

## Build steps

1. [x] **`artboardDisk.test.ts` on real disk.** Drop the four `vi.mock` calls (`../disk/openPage`,
   `../disk/artboardFs`, `../disk/canvasView`, `../disk/pageOps`) and every `vi.importActual`.
   The fake `workspaceRoot` returns the test's temp root (no more `'/ws'`). Unless a bullet says
   otherwise, a test runs on the two-page workspace with **`page-2` open** (Data / contracts:
   Fixtures; skip the final `openPage` back to `page-1`). Cover:
   - Open vs refresh in a fresh empty root: `readActiveArtboardFromDisk` returns an empty snapshot
     of `page-1` and the root stays empty (no `.vibeboard/`); `initAndLoadArtboard` then creates
     `project.json` and the default artboard (the snapshot has one frame, `DEFAULT_ARTBOARD_ID`).
     This replaces the `createIfFresh` flag assertions (AP3: project.json is created only by Open).
   - `frame:place` of `hero` on `page-1` while `page-2` is open: `page-1`'s `canvas.json` has the
     frame at `x: 10, y: 20, width: 400`, `page-2`'s `canvas.json` bytes are unchanged, the result
     is `undefined`. Before the request, place `hero` with the disk lib's `placeFrame` (no `base`)
     at a known `{ x, y, width }` and send exactly that as `base`.
   - A stale `base` (one that differs from the stored placement) returns
     `toSafeArtboardErrorMessage(new FrameMovedError(...))` (build it the way its constructor
     takes) and leaves `page-1`'s `canvas.json` unchanged (AP3).
   - A `frame:place` naming a page that is not indexed (`page-9`) returns `PAGE_GONE_MESSAGE` and
     the tree is byte-identical.
   - A corrupt `project.json` (text `{`): both loaders log once and return
     `new CorruptProjectError().message`, `pageId: ''`, no frames, no pages, and the one log's scope
     is the loader's (`artboardDisk.initAndLoad` / `artboardDisk.readActive`), never
     `artboardDisk.listPages` (replaces "never reads the list").
   - The open page (`page-2`) without a manifest: delete `pages/page-2/manifest.json` after the
     fixture is built (its `artboards/` folder stays). The refresh returns an empty snapshot of
     `page-2` even though `page-1` has a manifest and frames (the gate checks the resolved page).
     Rebuild `page-2`'s manifest by giving it an artboard with `createArtboard` (id `two`); the
     refresh now returns `page-2`'s frame ids, which never include `page-1`'s `hero`.
   - A missing manifest (same deletion): the refresh creates nothing (tree compare); Open then makes
     `page-2` readable again (`createArtboard` of the default id fails with "exists", so it makes
     the existing default artboard active) and its snapshot has no `errorMessage`.
   - A read failure after the resolve keeps the resolved page id: `pages/page-2/manifest.json`
     holding `{` (its `artboards/` folder stays; `readManifestFile` throws `CorruptManifestError`).
     Assert `pageId: 'page-2'`, an `errorMessage`, one log.
   - Untrusted Open, refresh and `frame:place` on the tripwire workspace (Data / contracts:
     Tripwire): the two snapshots and the place result are `UNTRUSTED_WORKSPACE_MESSAGE`, and the
     tree is byte-identical.
   - A malformed `frame:place` (`x: 'far'`) on the tripwire workspace returns
     `'Could not move the frame. Try again.'` and the tree is byte-identical (no resolve ran;
     `placeFrameFromChrome` starts no refresh, so the tripwire holds here).
   - Keep, minus the mock plumbing and the `vi.importActual` wiring (the real `createArtboard` and
     `setActiveArtboard` now run anyway): "Open on a page with artboard.html but no manifest keeps
     its bytes and makes it active", "an indexed open page with no folder shows the noFolder
     error...", "a page Open just initialized is listed with its new files time". These three keep
     their own hand-built state, which the disk lib cannot produce: they may hand-write
     `project.json` with `openPageId: 'page-2'` (the existing `writeProject` helper) on the test's
     temp root. They no longer need their own `ownRoot`: use the `beforeEach` root.
   - The page list rides on the frames, empty and failed snapshots: one test per row (`test.each`
     or four tests), each on its own fresh two-page workspace with `page-2` open and renamed
     `Checkout` with the disk lib's `renamePage` (so the list is not the default titles). Rows:
     `frames` (refresh), `frames on Open` (`initAndLoadArtboard`), `empty` (`page-2`'s manifest
     deleted, refresh), `failed` (`page-2`'s manifest holding `{`, refresh). In each, the
     snapshot's `pageId` is `page-2` and its `pages` deep-equals
     `(await listPages({ workspaceRoot: root })).pages` read after the load.
   - A list failure is logged and lists nothing: on the `failed` arrangement, the fake `log`
     overwrites `project.json` with `{` (`writeFileSync`) when it receives the scope
     `artboardDisk.readActive`, the one log `loadActiveSnapshot` writes before it lists. Assert
     `pages: []`, the read's `errorMessage` (not the list's), `pageId: 'page-2'`, and the log
     scopes `['artboardDisk.readActive', 'artboardDisk.listPages']`.
   - Done when: `grep -c "vi.mock(\|vi.importActual" src/host/artboardDisk.test.ts` prints 0; the
     file passes; each probe turns at least one test red, then is reverted:
     a. `artboardDisk.ts`: drop `base: message.base,` from the `placeFrame` call;
     b. `artboardDisk.ts`: `x: message.y, y: message.x,` in the `placeFrame` call;
     c. `artboardDisk.ts`: `readPostedPages` becomes
        `return (await listPages({ workspaceRoot: page.workspaceRoot })).pages;` (no `try` / `catch`);
     d. `artboardDisk.ts`: `loadActiveSnapshot`'s `if (!ports.isTrusted())` becomes `if (false)`;
     e. `artboardDisk.ts`: `createIfFresh: true` in `loadActiveSnapshot`'s `resolveOpenPage` call.

2. [x] **`refreshPanel.test.ts` on real disk.** Drop the `./artboardDisk` and `./panelComments`
   mocks. The real loader and the real `postPanelComments` run against the temp root, which holds
   the two-page workspace with `page-1` open unless a bullet says otherwise. The fake
   `postSnapshot` pushes `snapshot:<pageId>` and the fake `postComments` pushes `comments` to the
   shared call log. Cover:
   - Last started wins: start one refresh without awaiting it, await a second, then await the
     first, then wait for the comments post. Exactly one snapshot post and one comments post
     happen, in the order `['snapshot:page-1', 'comments']`. (The old test also named which read
     was newer; with one real disk both reads see the same page, so the count is the check. The
     generation guard suppresses the older post whichever read finishes first.)
   - A superseded refresh hands its error to the newer post, once: start
     `refreshPanel({ ports, errorMessage: 'busy' })` without awaiting, await a plain second
     refresh, await the first, then await a plain third. Posted `[pageId, errorMessage]` pairs are
     `[['page-1', 'busy'], ['page-1', undefined]]`.
   - `initialize`, in a fresh empty root: a plain refresh posts an empty `page-1` snapshot and
     creates nothing (the root stays empty); `refreshPanel({ ports, initialize: true })` then posts
     a snapshot with the default artboard frame and `project.json` exists.
   - `errorMessage` shows when the snapshot has none; a snapshot error wins:
     `refreshPanel({ ports, errorMessage: 'Could not move the frame. Try again.' })` on the healthy
     workspace posts that copy; then `project.json` is overwritten with `{` and
     `refreshPanel({ ports, errorMessage: 'Could not move the frame. Try again.' })` posts
     `new CorruptProjectError().message`, so the pending copy and the snapshot error compete.
   - No folder (`workspaceRoot` returns `undefined`) with `errorMessage: 'place copy'` posts one
     empty snapshot with the place copy; untrusted with a folder posts the untrusted copy. Both are
     followed by a comments post (two in total).
   - A throwing snapshot post resolves and logs once under `refreshPanel` (unchanged).
   - Done when: `grep -c "vi.mock(" src/host/refreshPanel.test.ts` prints 0; the file passes; each
     probe turns at least one test red, then is reverted:
     a. `refreshPanel.ts`: delete the `if (token !== refreshGeneration) { return; }` block;
     b. `refreshPanel.ts`: delete `pendingErrorMessage = undefined;`;
     c. `refreshPanel.ts`: `const shownError = pendingErrorMessage ?? snapshot.errorMessage;`;
     d. `refreshPanel.ts`: `await readActiveArtboardFromDisk({ workspaceRoot, ports })` in place of
        the `initialize ? ... : ...` choice.

3. [x] **`panelPages.test.ts` on real disk.** Drop the four mocks (`./refreshPanel`,
   `../disk/openPage`, `../disk/layoutFs`, `../disk/pageOps`). The real `refreshPanel` runs, so
   every answer is followed by a snapshot post and a comments post; the test waits for both before
   its next request and before it ends. The fake `postAnswer` pushes `answer:<type>`,
   `postSnapshot` pushes `snapshot:<pageId>`, `postComments` pushes `comments`, and `confirmModal`
   pushes `modal` and resolves `host.confirmed`. Unless a bullet says otherwise, the workspace is
   the two-page one with `page-1` open. Cover:
   - Each request type answers `page:saved` after its write, then refreshes: one test per request
     type (`test.each` or four tests), each on its own fresh workspace. After the waits, the call
     log ends with `['answer:page:saved', 'snapshot:<id>', 'comments']`, and disk shows the write:
     - `page:open` `page-2`: `project.json` `openPageId` is `page-2`; the snapshot is `page-2`.
     - `page:create`: `pages/page-3/` exists, `project.json` lists and opens `page-3`, the snapshot
       is `page-3`, and `.vibeboard/.ensure-panel` does not exist (`writeEnsurePanelMarker: false`).
     - `page:rename` `page-2` to `Pricing`: `project.json` titles `page-2` `Pricing`; snapshot
       `page-1`.
     - `page:delete` `page-2`, confirmed: `pages/page-2/` is gone, one `deleted/page-2-*` folder
       exists, `project.json` no longer lists `page-2`; snapshot `page-1`.
   - The handler resolves before a page op: on the tripwire workspace, `page:rename` `page-1` to
     `Pricing` answers `page:saved`, and the rebuilt `project.json` titles `page-1` `Pricing` (the
     handler's resolve rebuilt the index before `renamePage`, which never resolves).
   - Never a resolve that creates a project: in a fresh empty root, `page:rename` `page-1` answers
     `ui:error` with the copy the real run gives (`PAGE_GONE_MESSAGE` expected; pin what it is),
     then refreshes, and the root holds no `.vibeboard/project.json`. Assert only that file: the
     lock may leave an empty `.vibeboard/`, so no tree compare here.
   - No usable requestId (`requestId: 'a b'`; no `requestId`): nothing answered, the fake
     `workspaceRoot` was never called (so no refresh and no disk read started), the tree is
     byte-identical.
   - Untrusted on the tripwire workspace: answers `UNTRUSTED_WORKSPACE_MESSAGE`, then refreshes
     (the refresh is untrusted too and resolves nothing), and the tree is byte-identical. No folder
     (`workspaceRoot` returns `undefined`): answers `new NoWorkspaceError().message`, then refreshes.
   - Malformed title (`7`) and malformed page id (`'../x'`) on the two-page workspace: each answers
     `MALFORMED_PAGE_REQUEST_MESSAGE`, then refreshes; the tree is byte-identical (an indexed
     workspace's refresh reads only); the only log of each request is an `InvalidArgsError` under
     its own scope (`panelPages.rename` / `panelPages.delete`). "No resolve ran before the refusal"
     is not observable on disk here, because the trusted refresh that follows resolves; the log
     check stands in for it.
   - Delete refused before the modal: an unlisted id (`page-3`) and a fresh root with no
     `project.json` answer `PAGE_GONE_MESSAGE`; deleting `page-1` in a one-page project
     (`resolveOpenPage` with `createIfFresh: true` plus `createArtboard` of `hero`) answers
     `LAST_PAGE_MESSAGE`. `confirmModal` is never called, no page folder or `project.json` changes
     (compare those bytes; the fresh-root case only asserts no `project.json`), and each answer is
     followed by a refresh.
   - A cancelled modal answers `page:saved`, deletes nothing (tree byte-identical), keeps
     `page-2`'s undo history, and the modal prompt is
     `{ message: 'Delete "<page-2 title>"?', detail: 'Its files move to .vibeboard/deleted/.', action: 'Delete' }`
     with the title read from the fixture's `project.json` (`Page 2` expected).
   - A confirmed delete forgets only that page's histories (`page-2` cleared, `page-1` and
     `page-20` kept; histories recorded with `recordEdit` as today).
   - Panel copy, never Agent copy: a held lock (`withWorkspaceLock` around the call, test timeout
     10 s as in `panelEdit.history.test.ts`) answers `new LockTimeoutError().message` for a
     rename; a whitespace-only title (`'   '`, refused by `parsePageTitle` with Agent copy)
     answers `RENAME_REFUSED_MESSAGE`; `page:open` of an unlisted `page-9` answers
     `PAGE_GONE_MESSAGE`. Each followed by a refresh (for the held lock, wait for it after the lock
     is released).
   - Done when: `grep -c "vi.mock(" src/host/panelPages.test.ts` prints 0; the file passes; each
     probe turns at least one test red, then is reverted:
     a. `panelPages.ts`, `confirmAndDeletePage`: move the `const confirmed = await ports.confirmModal({...});`
        statement (and its `if (!confirmed) { return; }`) above the
        `if (project.pages.length === 1) { throw ... }` block;
     b. `panelPages.ts`: delete `forgetPageHistories(pageId);`;
     c. `panelPages.ts`: `createIfFresh: true` in `answerPageRequest`'s `resolveOpenPage` call;
     d. `panelPages.ts`: delete `void refreshPanel({ ports });` after the `page:saved` post;
     e. `panelPages.ts`: `writeEnsurePanelMarker: true` in the `createPage` call;
     f. `panelPages.ts`: delete `await resolveOpenPage({ workspaceRoot, createIfFresh: false });`.

4. [x] **`panelComments.test.ts` on real disk.** Drop the `../disk/openPage` and
   `../disk/comments` mocks. The workspace: the two-page one with `page-1` open, where both
   `hero` artboards hold `<h1>Hi</h1>`; requests name `page-2`. Seed comments with the disk lib's
   `addComment` and read their ids from its result (ids are random UUIDs). A `comment:create`
   message's `generation` is read from disk. "Then refreshes" means: wait for the fake
   `postComments` call. Cover:
   - A bad requestId: nothing posted, the fake `workspaceRoot` never called, tree byte-identical.
   - Untrusted `comment:create` on the tripwire workspace: one `ui:error` with the untrusted copy,
     tree byte-identical.
   - A resolver error on `comment:reply` (a non-copy type, so no refresh follows): seed a comment on
     `page-2`, then replace the `.vibeboard/artboards` tombstone file with a directory, which makes
     the resolve throw `MigrationConflictError`. One `ui:error` with its message, exactly one log,
     whose error is a `MigrationConflictError`, and `page-2`'s `comments.json` bytes unchanged.
   - A malformed `comment:reply` (`body: 7`) answers the change copy.
   - Create, reply and set-status each answer once (`comment:added`, `comment:saved`,
     `comment:saved`), each followed by a refresh; the call log for each is
     `[answer:<type>, 'comments']`. Afterwards `page-2`'s `comments.json` holds the comment with the
     reply and status `resolved`, and `page-1` has no `comments.json`. This folds in the old
     "request for page-2 while page-1 is open acts on page-2's location" test; copy and copy-open on
     `page-2` are asserted on `page-2`'s file in the tests below.
   - A reply to an unknown id answers `COMMENT_GONE_MESSAGE`. (The old "and no refresh" clause is
     dropped: a non-copy refusal triggering a refresh is not a contract, and the absence of a
     fire-and-forget post cannot be awaited.)
   - Copy: clipboard first, then mark sent, then answer, then refresh. The fake `writeClipboard`
     reads `page-2`'s `comments.json` synchronously and records the comment's status (`open`);
     after the answer the file says `sent`; the answer is `{ type: 'ui:copied', requestId, count: 1 }`;
     the clipboard text starts with `Handle vibeboard comment <id> only.`; call log
     `['clipboard', 'answer:ui:copied', 'comments']`.
   - Copy-open sends the open ids in `listComments` order and answers the marked count: three open
     comments; the fake `writeClipboard` resolves the second one through the disk lib's
     `resolveComment` (it takes a non-empty `note`) before it returns, as the Agent would between
     the read and the lock. The clipboard lists all three ids in disk order, the answer `count` is
     2, and on disk the two others are `sent` and the resolved one stays `resolved`.
   - A rejected clipboard write: answers the copy-failed copy, the comment stays `open` on disk,
     then refreshes.
   - A `markCommentsSent` failure: hold the lock around the call (10 s timeout); answers
     `COPIED_NOT_MARKED_MESSAGE`, the comment stays `open`, then refreshes (wait after the lock is
     released).
   - Copy-open with nothing open (all comments resolved): `NOTHING_OPEN_MESSAGE`, no clipboard
     call, then refreshes. Copying an unknown id: `COMMENT_GONE_MESSAGE`, no clipboard call, then
     refreshes. Untrusted `comment:copy` on the tripwire workspace: the untrusted copy, no clipboard
     call, then refreshes (the refresh is untrusted too and resolves nothing), tree byte-identical.
   - A gone page: `comment:create` naming unlisted `page-9` answers `PAGE_GONE_MESSAGE`, tree
     byte-identical.
   - The posted list: names the open page with its comments (seed one on `page-1`); a corrupt
     `pages/page-1/comments.json` (`{`) still names `page-1` and carries an `error`; a corrupt
     `project.json` posts `pageId: ''` with an `error`; untrusted posts
     `{ pageId: '', comments: [] }`.
   - A slow read never posts over a newer one: start one `postPanelComments` without awaiting,
     await a second, await the first: exactly one post.
   - Done when: `grep -c "vi.mock(" src/host/panelComments.test.ts` prints 0; the file passes; each
     probe turns at least one test red, then is reverted:
     a. `panelComments.ts`, `case 'comment:copy'`: swap the two lines so it reads
        `const count = await markSent([comment.id]);` then
        `await ports.writeClipboard(singleCommentPrompt(comment));` (the `if (count === undefined)`
        check stays after both);
     b. `panelComments.ts`, `markSent`: `return ids.length;` in place of
        `return (await markCommentsSent({ page, ids })).length;` (keep the `await markCommentsSent`
        call as its own statement before it);
     c. `panelComments.ts`: the success post's `if (token === readGeneration)` becomes `if (true)`;
     d. `panelComments.ts`: `afterRefuse: undefined` for every type;
     e. `panelComments.ts`: `await resolveOpenPage({ workspaceRoot, createIfFresh: false })` in place
        of `await resolveRequestedPage({ workspaceRoot, pageId: message.pageId })` in
        `answerCommentRequest`.

5. [x] **`panelEdit.test.ts` on real disk.** Drop the `../disk/openPage`, `../disk/artboardEditFs`
   and `./canvasSnapshot` mocks. The workspace: the two-page one with `page-1` open, where both
   `hero` artboards hold the history test's fixture
   `'<main>\n  <p style="padding: 1px">x</p>\n</main>\n'`; edits name `page-2`, target
   `sourceNumber: 1` (the `<p>`), and every request reads the current hash from `page-2`'s disk file
   just before it is sent. Keep the file separate from `panelEdit.history.test.ts` (edit answers
   here, undo/redo there); its fixture code is its own (rule 09). Cover:
   - A valid edit (`padding` `'8'`): `page-2`'s file has `padding: 8px`, `page-1`'s bytes are
     unchanged, one answer `artboard:edited` with `hashHtml` of `page-2`'s new disk bytes, the next
     generation, `canUndo: true`, `canRedo: false`, and `html` that is the tagged copy
     (`/data-cd-src="1"/`) of the disk bytes.
   - A conflict (a stale hash) answers `EDIT_CONFLICT_MESSAGE`; a text edit
     (`field: 'text'`, `value: 'New'`, `liveText: 'Other'` against disk text `x`) answers
     `EditRefusedError('text-changed')`'s message; each logs once; `page-2`'s bytes unchanged.
   - A resolver error (the tombstone replaced by a directory, as in step 4) answers
     `EDIT_FALLBACK_MESSAGE`, logs once, and `page-2`'s bytes are unchanged.
   - Malformed (`field: 'border'`), untrusted and folderless attempts answer their copy; on the
     tripwire workspace the tree is byte-identical (panel edits start no refresh, so the tripwire
     holds for the malformed case too).
   - No usable requestId: one log, no answer, tree byte-identical.
   - Same bytes: `padding` `'1'` (the value already on disk) answers `canUndo: false, canRedo: false`;
     then `padding` `'8'` answers `true / false`; then `padding` `'8'` again answers `true / false`.
     The history holds one step and its undo target is the original fixture's hash. First confirm
     the `'1'` edit leaves the file byte-identical; if it does not, pick the value that does and
     note it in the review.
   - A gone page (`page-9`) answers `PAGE_GONE_MESSAGE`, tree byte-identical.
   - Nothing to undo or redo: both answer their copy and the tripwire tree is byte-identical (no
     resolve).
   - Update the header comment of `panelEdit.history.test.ts` ("panelEdit.test.ts mocks the disk
     lib instead") to say what is true (both files run on a real temp workspace; this one covers
     undo / redo).
   - Done when: `grep -c "vi.mock(" src/host/panelEdit.test.ts` prints 0; the file passes; each
     probe turns at least one test red, then is reverted:
     a. `panelEdit.ts`, `postEdited`: `html: written.html` in place of `html: posted.html`;
     b. `panelEdit.ts`: `await resolveOpenPage({ workspaceRoot, createIfFresh: false })` in place of
        `await resolveRequestedPage({ workspaceRoot, pageId: message.pageId })` in
        `answerEditRequest` (import it);
     c. `panelEdit.ts`: delete the `if (edited.html !== edited.baseHtml)` condition, keeping its body
        (always record);
     d. `panelRequest.ts`: delete the `if (!ports.isTrusted()) { ... }` block in
        `checkedPanelMessage`.

6. [x] **Gate.** Run `pnpm verify` once.
   - Done when: `pnpm verify` passes;
     `grep -c "vi.mock(\|vi.importActual\|vi.spyOn" src/host/{panelEdit,panelEdit.history,panelComments,panelPages,artboardDisk,refreshPanel}.test.ts`
     prints 0 for every file; `git diff --name-only main -- src` lists exactly the six files
     `src/host/{artboardDisk,refreshPanel,panelPages,panelComments,panelEdit,panelEdit.history}.test.ts`
     (after step 8, nine: plus `src/host/chromeMessages.ts`, `chromeMessages.test.ts`, `panelEdit.ts`);
     the six files pass three runs in a row
     (`pnpm exec vp test run src/host/{panelEdit,panelEdit.history,panelComments,panelPages,artboardDisk,refreshPanel}.test.ts`)
     with no flake, and their total duration is reported in the review.

7. [x] **Audit repairs (F-06, F-07).** `refreshPanel.test.ts`: the untrusted refresh also runs with no
   folder, so `refreshPanel.ts`'s own untrusted copy (`workspaceRoot === undefined` branch) stays
   covered next to the loader's. `panelComments.test.ts`: `createMessage`'s parameter is
   `requestedPageId`, with a why comment on the page-2 generation.
   - Done when: probe `emptyArtboardSnapshot(undefined)` in place of the untrusted ternary in
     `refreshPanel.ts` turns `refreshPanel.test.ts` red, then is reverted; `pnpm verify` passes.

8. [x] **Audit repair F-08 (source change, Bombic's decision).** Bombic declined to accept the
   gap ("all findings need to be fixed", 2026-11-27), which overrides this spec's test-only rule for
   this one item. `toArtboardEdit` moves unchanged from `panelEdit.ts` (private) to
   `chromeMessages.ts` (exported, next to its twin `toNewComment`); `panelEdit.ts` imports it. One
   unit test in `chromeMessages.test.ts` pins that a styles message and a text message each reach
   the edit core as exactly `{ sourceNumber, styles }` / `{ sourceNumber, field, value, liveText }`.
   Rule `05-single-job.md`'s `chromeMessages.ts` entry names the mappings. Behavior unchanged.
   - Done when: probe `? (message as unknown as ArtboardEdit)` in place of the styles branch turns
     `chromeMessages.test.ts` red, then is reverted; `pnpm verify` passes.

## Files / areas

- `src/host/artboardDisk.test.ts`, `refreshPanel.test.ts`, `panelPages.test.ts`,
  `panelComments.test.ts`, `panelEdit.test.ts`: rewritten.
- `src/host/panelEdit.history.test.ts`: header comment only.
- Step 8 (F-08): `src/host/chromeMessages.ts` (exports `toArtboardEdit`), `chromeMessages.test.ts`
  (its unit test), `panelEdit.ts` (imports it); `.claude/rules/05-single-job.md` (catalog line).
- Read only (for fixtures and probes): `src/disk/openPage.ts`, `pageOps.ts`, `artboardFs.ts`,
  `comments.ts`, `workspaceLock.ts`, `layout.ts`, `errors.ts`; `src/host/*.ts` under test.

## Data / contracts

No message, disk, MCP or Agent contract changes; the one source change is step 8's
`toArtboardEdit`, now exported from `chromeMessages.ts` with unchanged behavior. Test conventions this item fixes (for the
five rewritten files; `panelEdit.history.test.ts` is exempt):

- **Workspace.** A fresh `mkdtemp(join(tmpdir(), 'vibeboard-<file>-'))` root per test in
  `beforeEach`, removed in `afterEach` (rule 09). `beforeEach` only makes the empty root; each test
  builds the fixture it needs on it with the file's local builder. A test that needs a second
  workspace (a per-row loop, the tripwire control) makes another `mkdtemp` and removes it in a
  `finally`.
- **Fresh ports per test.** Each file's local factory builds a new fake `PanelPorts` in
  `beforeEach` (shape as in 11c1, `satisfies PanelPorts`), so a late post can never land in the
  next test's spies. `workspaceRoot`, `log`, `postAnswer`, `postSnapshot`, `postComments`,
  `writeClipboard` and `confirmModal` are `vi.fn`s (so "never called" and `vi.waitFor` counts
  compile); `isTrusted` may stay a plain getter.
- **Fixtures.** Built through the disk lib, in this order (`createPage` adopts a blank sole `page-1`
  instead of adding a page, and opens the page it makes):
  1. `resolveOpenPage({ workspaceRoot, createIfFresh: true })`;
  2. `createArtboard({ page: page-1, artboardId: 'hero', html, writeEnsurePanelMarker: false })`;
  3. `createPage({ workspaceRoot, writeEnsurePanelMarker: false })`: makes `page-2` with its default
     artboard and opens it;
  4. `createArtboard` of `hero` on `page-2` (same flag);
  5. `openPage({ workspaceRoot, pageId: 'page-1' })` where `page-1` must be open (steps 2-5).
  Every fixture `createPage` / `createArtboard` passes `writeEnsurePanelMarker: false`. Other disk-
  lib ops a test may use: `renamePage`, `placeFrame`, `addComment`, `resolveComment`, `recordEdit`
  (host). Hand-written or hand-deleted files only for deliberately broken or inconsistent state:
  `{` in `project.json`, `comments.json` or `manifest.json`; a deleted `manifest.json` or
  `project.json`; the tombstone replaced by a directory; and the three kept `artboardDisk` tests'
  own `project.json`. Read each needed `generation`, hash, title and comment id from disk or from
  the op's result; never assume one.
- **Tree compare.** "Writes nothing" means a local helper's map of every entry under the root
  (relative path to file bytes; directories listed too, so a new empty folder counts) is deep-equal
  before and after. The helper uses `lstat` and never follows a symlink.
- **Tripwire.** A refusal that must happen before any resolve, and that starts no trusted refresh,
  runs on an index-lost workspace: the two-page fixture (steps 1-4 above) with `project.json`
  deleted. Any `resolveOpenPage` there rebuilds `project.json`, so a byte-identical tree proves no
  resolve ran. Used only where no trusted refresh follows: untrusted requests (their refresh is
  untrusted too), panel edits, `frame:place`, and answers with no requestId. In each of
  `artboardDisk`, `panelPages`, `panelComments` and `panelEdit`, one test asserts the control once
  on its own second tripwire workspace: a trusted
  `resolveOpenPage({ workspaceRoot, createIfFresh: false })` there does write `project.json`.
- **Waiting.** `answerPageRequest`, `answerCommentRequest` and `refreshPanel` start fire-and-forget
  posts (`void refreshPanel`, `void postPanelComments`). A test waits for each expected post with
  `vi.waitFor(() => assert.equal(<fake>.mock.calls.length, n), { timeout: 5000 })` before its next
  request and before it ends, and awaits every refresh or comment-read promise it started itself,
  so no disk read is in flight when `afterEach` removes the root. Never a fixed sleep. The absence
  of a fire-and-forget post is asserted only where nothing could have started it (the fake
  `workspaceRoot` was never called).
- **Order through disk.** Where order is the contract (clipboard before `markCommentsSent`), the
  fake port reads the file synchronously (`readFileSync`, allowed in tests) at the moment it is
  called.
- **Held lock.** A busy case wraps the call in `withWorkspaceLock({ workspaceRoot, operation })`
  as `panelEdit.history.test.ts` does, with a 10 s test timeout (the lock waits 2 s).
- **Copy constants.** The private copy in `panelRequestCopy.ts` (`LAST_PAGE_MESSAGE`,
  `RENAME_REFUSED_MESSAGE`, `EDIT_CONFLICT_MESSAGE`, `EDIT_FALLBACK_MESSAGE`,
  `COMMENT_GONE_MESSAGE` and the like) stays pinned as local constants in each test file, as today.
- **Module state.** `beforeEach` calls `clearEditHistories()` where histories are touched. The
  module-level refresh and comment-read generations need no reset: every test ends with its last
  refresh posted, which also clears `refreshPanel`'s pending error.

## Testing

- The five rewritten files are the tests; the probes in each step prove they still catch what the
  mocked versions caught (11f's surviving-mutant method, one probe at a time, reverted).
- `pnpm test` after each step, `pnpm verify` once at the end. Test count may change (tests are
  merged or split); the review lists each old test and the new test that covers it.
- No browser tests, no F5: no chrome, frame, message or host-runtime change.

## Notes for the AI

- Lint: rule 04 names (no `ab`), local factories may skip return types (rule 09), no `any`, no
  thrown literals. `vi.waitFor` comes from `vite-plus/test`'s `vi`.
- Do not import `src/host/*` test helpers across files; each file keeps its own fixture code.
- Keep each test's name close to today's where the behavior is the same, so the old-to-new map in
  the review is easy to read.
- If a fixture behaves differently from what this spec predicts (a copy other than the one named,
  a title other than `Page 2`, a same-value edit that is not byte-identical), use the real behavior
  and note it in the review; if the behavior looks like a product bug, stop and report it instead
  of asserting it.
- Do not touch `canvasSnapshot.test.ts` or `hostFs.test.ts`.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":35218,"specSha256":"da8095d4460b80407fe4bf1d55b929afae89835e46d1db444fdd8fb6f64d4402","branch":"refs/heads/feature/host-tests-on-real-disk","head":"6b900543406c223179885b1943cd58828170e5c1","baseRef":"refs/heads/main","baseCommit":"6b900543406c223179885b1943cd58828170e5c1","sourceTree":"e1194ab78837ccacc78e19610780920747593a0b","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11c2/F-01 [P3] closed - Self-rooted artboardDisk tests shadow the module root

**File:** src/host/artboardDisk.test.ts:242
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Three tests declare `const root` over the module `let root`; inside them `args`, `manifestPath()` and `writeManifest()` still target the beforeEach root. Harmless today, a silent wrong-folder trap for 11c2.
**Suggested fix:** Rename the locals (`ownRoot`).
**Resolution:** Locals renamed to `ownRoot` in the three self-rooted tests. (fixed 2026-11-27, awaiting re-review) Re-review: 11c2 rewrote artboardDisk.test.ts: the only `root` is the module `let root` (line 55); the kept tests use the beforeEach root and the one extra root is `controlRoot`. Nothing shadows it. (closed 2026-11-27 by /audit current, 11c2, fresh Opus reviewer)

### 11c2/F-02 [P3] closed - createPanelPorts test leaves shared mock state changed

**File:** src/panel/openArtboardPanel.test.ts:88
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** It flips `panelMock.isTrusted`/`root` and grows `warnings` with no reset; a later test would inherit an untrusted, folderless vscode.
**Suggested fix:** Reset the mock state in a `beforeEach`.
**Resolution:** `beforeEach` resets isTrusted, root, warnings, choice and the new clipboardError. (fixed 2026-11-27, awaiting re-review) Re-review: openArtboardPanel.test.ts beforeEach resets isTrusted, root, warnings, choice and clipboardError; the repair added nothing new. (closed 2026-11-27 by /audit current, 11c2, fresh Opus reviewer)

### 11c2/F-03 [P3] closed - Spec names the wrong row for the step-2 mutation probe

**File:** blueprint/context/current-feature.md:118
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** beforeEach already writes the manifest, so dropping the per-row write fails on the `failed` row, not `frames` (confirmed by a real probe in /implement).
**Suggested fix:** Correct the row name.
**Resolution:** Spec step 2 done-when now names the `failed` row and why. (fixed 2026-11-27, awaiting re-review) Re-review: Archived 11c1 spec (blueprint/history/features/11c1-host-ports.md:118) names the `failed` row and why. (closed 2026-11-27 by /audit current, 11c2, fresh Opus reviewer)

### 11c2/F-04 [P3] closed - Spec drift: verbatimModuleSyntax and WorkspaceDiskArgs

**File:** blueprint/context/current-feature.md:228
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** `verbatimModuleSyntax` is set only in tsconfig.webview.json, not the host tsconfig; step 3 says `WorkspaceDiskArgs` goes, the code keeps it reshaped (used 3x, rule 04 allows it).
**Suggested fix:** Reword both lines to match the code.
**Resolution:** Spec reworded: `WorkspaceDiskArgs` becomes `{ workspaceRoot, ports }`; the `import type` note says `verbatimModuleSyntax` is webview-only today. (fixed 2026-11-27, awaiting re-review) Re-review: Archived 11c1 spec lines 144-145 and 229-230 match artboardDisk.ts:148 and the tsconfigs. (closed 2026-11-27 by /audit current, 11c2, fresh Opus reviewer)

### 11c2/F-05 [P3] closed - No test covers the awaited clipboard write in createPanelPorts

**File:** src/panel/openArtboardPanel.ts:90
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Dropping the `await` in `writeClipboard` would let a rejected clipboard write still reach `markCommentsSent` (rule 02), and no automated test would fail.
**Suggested fix:** Assert in the createPanelPorts test that a rejecting `env.clipboard.writeText` rejects `writeClipboard`.
**Resolution:** New test `createPanelPorts: a rejected clipboard write rejects writeClipboard`; probe replacing the `await` with a swallowed write fails it. (fixed 2026-11-27, awaiting re-review) Re-review: openArtboardPanel.ts:90-92 awaits writeText; the rejected-write test fails if the await is dropped. (closed 2026-11-27 by /audit current, 11c2, fresh Opus reviewer)

### 11c2/F-06 [P3] closed - refreshPanel's untrusted no-folder banner is no longer tested

**File:** src/host/refreshPanel.test.ts:141
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: Opus reviewer)
**Why it matters:** The old test ran its untrusted refresh with no folder, the only test of `refreshPanel.ts:35` (`emptyArtboardSnapshot(ports.isTrusted() ? undefined : UNTRUSTED_WORKSPACE_MESSAGE)`). The rewrite gives it a folder, so `loadActiveSnapshot`'s trust check answers instead. Probe run: replacing the ternary with `emptyArtboardSnapshot(undefined)` leaves refreshPanel.test.ts green (6/6), so an untrusted empty window could lose its banner unnoticed. Breaks the spec's "every guard the old tests covered stays covered" (the spec text said "untrusted with a folder").
**Suggested fix:** Make the untrusted refresh folderless too (`ports.workspaceRoot.mockReturnValueOnce(undefined)`), and keep one untrusted refresh with a folder so both paths stay covered.
**Resolution:** The test's untrusted refresh now runs folderless (refreshPanel's own copy) and again with a folder (the loader's); probe `emptyArtboardSnapshot(undefined)` at refreshPanel.ts:35 now fails it (1 failed), source restored. (fixed 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by Opus (Breaker) and Sonnet (Literalist) re-review: defect gone, repair adds nothing new.

### 11c2/F-07 [P3] closed - createMessage's pageId parameter does not pick the generation page

**File:** src/host/panelComments.test.ts:180
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: Opus reviewer)
**Why it matters:** `createMessage(pageId)` always reads `generation` from `page-2`, whatever page it names. Intended for the `page-9` case (no artboard there), but the signature reads as if the page drives both.
**Suggested fix:** Rename the parameter `requestedPageId` or add a one-line why comment.
**Resolution:** Parameter renamed `requestedPageId`, with a one-line why comment on the page-2 generation. (fixed 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by Opus (Breaker) and Sonnet (Literalist) re-review: defect gone, repair adds nothing new.

### 11c2/F-08 [P3] closed - toArtboardEdit's key-by-key narrowing is no longer observable

**File:** src/host/panelEdit.ts:114
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: Opus reviewer)
**Why it matters:** The old mocked test pinned `editArtboard`'s `edit` argument to exactly `{ sourceNumber, styles }`. On real disk that argument is invisible. Probe run: `edit: message as unknown as ArtboardEdit` leaves panelEdit.test.ts and panelEdit.history.test.ts green (19/19). No behavior difference was found either: `parseChromeMessage` already shapes the message and the edit core reads only the keys it knows, so this is a lost mock-only assertion, not a known defect.
**Suggested fix:** None in tests without a seam (the spec forbids one). Accept (the narrowing is defense in depth) or cover it with a small `toArtboardEdit` export and unit test (a source change, out of 11c2's scope). Bombic's call.
**Resolution:** Bombic declined to accept the gap (2026-11-27). `toArtboardEdit` moved unchanged to `chromeMessages.ts` (exported next to `toNewComment`, imported by `panelEdit.ts`); new unit test in `chromeMessages.test.ts` pins the exact edit for a styles and a text message. Probe (styles branch returns the whole message) fails it; source restored. Rule 05 catalog updated. (fixed 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by Opus (Breaker) and Sonnet (Literalist) re-review: defect gone, repair adds nothing new.

### 11c2/F-09 [P2] closed - Spec and overview still call 11c2 test-only after the F-08 source repair

**File:** blueprint/context/current-feature.md:19
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** After step 8 moved `toArtboardEdit` into `chromeMessages.ts`, the spec's Goal ("No file under `src/` other than these five `*.test.ts` files..."), Out of scope, step 6's gate ("lists exactly the six files"; it now lists nine), Files / areas and Data / contracts, plus the overview's "No source file changes", Out column and "Test-only" decision, no longer matched the diff. A reader re-running step 6's gate would see it fail.
**Suggested fix:** Note the F-08 exception in each place; list the three step-8 files.
**Resolution:** Spec Goal, Out of scope, step 6 gate (nine files after step 8), Files / areas and Data / contracts amended; overview's What you will see, scope table and Test-only decision amended. (fixed 2026-11-27, awaiting re-review) Re-review (Sonnet, 2026-11-27) found two missed spots, now fixed: the overview's gate line (nine files) and the spec's per-step probe check (after step 8 it lists the repair's two source files). (fixed again 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by a fresh Sonnet re-review against the diff and a test run (74 files, 892 tests).

### 11c2/F-10 [P3] closed - Spec Status line kept the pre-step-8 test count

**File:** blueprint/context/current-feature.md:6
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** Status said `pnpm verify` passed with 891 tests; step 8 added the `toArtboardEdit` test, so the suite is 892.
**Suggested fix:** Update the count from the post-step-8 Verify run.
**Resolution:** Status now cites the post-step-8 run (74 files, 892 tests) and names the repair probes. (fixed 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by a fresh Sonnet re-review against the diff and a test run (74 files, 892 tests).

### 11c2/F-11 [P3] closed - Probe revert command would discard the uncommitted step-8 repair

**File:** blueprint/context/current-feature.md:58
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** The Build loop tells probes to revert with `git checkout -- <file>`. Before `/complete`, `chromeMessages.ts` and `panelEdit.ts` hold the uncommitted F-08 repair, so re-running step 8's probe that way would wipe the repair.
**Suggested fix:** Say step 8's probe is reverted by hand.
**Resolution:** Build loop now says any probe on `chromeMessages.ts` or `panelEdit.ts` (step 5 a-c, step 8) is reverted by hand until `/complete`, since both hold the uncommitted step-8 repair. First wording covered only step 8; re-review caught step 5 a-c. (fixed 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by a fresh Sonnet re-review (the note names exactly step 5 a-c and step 8, matching the diff).

### 11c2/F-12 [P3] closed - F-11's revert note is awkwardly punctuated

**File:** blueprint/context/current-feature.md:59
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** "revert by hand, not with `git checkout`, any probe on ..." reads ambiguously in an instruction an implementer follows literally.
**Suggested fix:** Split it into a plain exception sentence.
**Resolution:** Reworded: "Exception until `/complete`: step 5 a-c and step 8 edit `chromeMessages.ts` or `panelEdit.ts`, which hold the uncommitted step-8 repair, so revert those probes by hand." Same probes, same files. (fixed 2026-11-27, awaiting re-review) Re-review: closed 2026-11-27 by a fresh Sonnet re-review (single reading, same probes and files).
