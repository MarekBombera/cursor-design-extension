# Feature: Page-scoped panel

**From build-plan:** feature 10b
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/page-scoped-panel`

## Goal

Make the panel page-aware before any page UI or Agent page tool exists. The host says which page each canvas snapshot and comment list came from. When that page changes, the chrome starts its per-page state again instead of carrying frames, picks, pins, inspector state or comments over to the next page. Every page-bound request from the chrome names its page. The host acts on that page, or answers "That page no longer exists.". Undo history is kept per page and frame. Once this ships, no page switch can leak one page's state into another. 10c adds the Agent's page tools and 10d the Pages menu; this feature is the base they need.

Plan: `blueprint/reference/0.5-pages-plan.md`. It supplies D8 (the panel is page-aware), D12 (watcher unchanged), the error table's `PAGE_NOT_FOUND` panel copy, and the 10b section, over the Notion 0.5 outline. Bombic's answers from 2026-11-21 apply: one open page on disk; the Agent's `open_page` / `create_page` move the user's stage; no `pageId` argument on MCP tools. Q4 was never asked, so fit-all on a page switch stays the default, as the plan proposed. The shipped 10a contract is `blueprint/history/features/10a-pages-on-disk-migration.md`: `resolveOpenPage`, `PageLocation`, `isPageId`, `PageNotFoundError`, and page-scoped writes never recreate a missing page folder.

Folded in: finding F-11 (P3, deferred from 10a to here). `loadActiveSnapshot` and `placeFrameFromChrome` resolve the page, but no test covers that wiring. This feature changes `artboardDisk.ts` anyway, so step 1 adds `src/host/artboardDisk.test.ts`, which is F-11's suggested fix. The export command's wiring (`commands/exportHandoff.ts`) stays untested, as F-11's suggested fix allows; 10e's real-Cursor run covers it by hand.

## In scope

- **Host → chrome `pageId`.**
  - `CanvasSnapshot.pageId` is carried by `canvas:updated.pageId`.
  - `comments:updated.pageId`.
  - `panelOutbox` caches and replays both.
- **Chrome → host `pageId`** on every page-bound request: `frame:place`, `artboard:edit`, `artboard:history`, `comment:create`, `comment:reply`, `comment:set-status`, `comment:copy`, `comment:copy-open`. The host checks it at its trust boundary (`isPageId`).
  - The host acts on that page through one new disk resolver, `resolveRequestedPage`.
  - A page that is gone gets "That page no longer exists.".
- **Undo history keyed by page and frame.** The outbox's outside-change check and the flags it reads at send time use the snapshot's page.
- **Page-scoped chrome.**
  - `App.svelte` keeps the host bridge and the state that spans pages.
  - A new per-page container, `DesignPage.svelte`, sits under `{#key}` on the stage page id. It creates the five per-page objects and holds today's per-page markup, so a page change rebuilds every one of them along with the stage DOM.
  - A comment list is shown only for its own page.
  - The one comment draft slot carries its page.
  - The saved stage view carries its page: fit-all on a switch, restored only for its own page.
- `isPageId` moves to `src/disk/layout.ts`, so the chrome can import it.
- F-11's `artboardDisk.test.ts`.
- Docs updated in the same change:
  - the system map message table, plus the handshake and undo flows;
  - rule 08's chrome catalog;
  - rule 05's catalog (`resolveRequestedPage`, `isPageId` in `layout.ts`);
  - rule 02's message invariants (one line).

## Out of scope

- Any page UI: the toolbar page button, the menu, `page:*` messages, `page:saved`, the `pages` list on `canvas:updated`. All 10d.
- The disk page ops and MCP tools:
  - `listPages`, `createPage`, `openPage`, `renamePage`, `deletePage`;
  - `list_pages`, `create_page`, `open_page`;
  - `page` in tool results;
  - the `COMMENT_NOT_FOUND` page hint;
  - the `IMPLEMENT.md` page line.
  All 10c.
- "Deleting a page forgets its histories" (D8). No delete exists until 10c. The history is keyed by page here, so 10c's delete can drop a page's entries in one call.
- 10a's F-09: an indexed open page whose folder is missing reads as a silently empty stage. Carried to 10c. `resolveRequestedPage` does not change how the open page resolves.
- Keying the comment parse cache, the tagged-copy memo or `frameCacheKey` by page. Both caches compare HTML before reuse (plan, Repo facts).
- Any change to the disk format, an MCP tool, `SKILL.md`, the README or the Copy prompt text. The Agent skill does not change, because no tool, argument, error code, runtime limit or CSP changes.
- Remembering the stage view per page (Q4, never asked: fit-all stays).
- Moving focus after a page switch (10d's menu owns it; see Notes).
- 10e's real-Cursor run and docs pass.

## Build loop

Build one step at a time. `workflow.stepReview` is `feature`: one review packet after all steps. Checkpoint commits are disabled. `/complete` makes the feature commit. Never accept a review packet you have not read. Split any diff too large to review.

After every step, `pnpm test` and `pnpm exec vp check` are green. Every `.svelte` / `.svelte.ts` edit follows rule 08 (Svelte MCP docs first, `svelte-autofixer` until clean, `svelte-file-editor` in Claude Code; without the MCP, `npx -y @sveltejs/mcp`). Steps 1 to 3 change wire shapes and the host; the chrome only threads `pageId` through. Step 4 adds the pure chrome rules. Step 5 is the chrome restructure, so review it on its own.

## Build steps

- [x] **Step 1 - `pageId` on host → chrome state (+ F-11).**
  - Move `isPageId` from `src/disk/parse.ts` to `src/disk/layout.ts`, next to `PAGE_ID_PATTERN`. `parse.ts` imports it from there; no re-export. Update `openPage.ts`, and `parse.test.ts`'s `isPageId` test imports it from `layout` (no new test file). Why: `parse.ts` imports `zod/mini` and `./hash` → `node:crypto`, which must not reach the webview bundle. `layout.ts` has no imports, and the chrome already imports it.
  - `CanvasSnapshot` gains `pageId: string` (contract below). `emptyArtboardSnapshot(errorMessage?)` keeps its signature and always sets `pageId: ''`. The two callers that know a page spread it: `{ ...emptyArtboardSnapshot(message), pageId: page.pageId }`.
  - `loadActiveSnapshot` resolves the page first, outside the try that reads, so the `PageLocation` is in scope for the catch:
    - every snapshot built after a successful resolve carries `page.pageId`: the no-manifest empty one, the normal one, and the error snapshot of a read failure after the resolve;
    - `pageId` is `''` only when the resolve itself threw (or the workspace is untrusted).
  - `placeFrameFromChrome` keeps whatever page the snapshot it returns carries.
  - The outbox's `pendingView` keeps `pageId`, and `canvas:updated` sends it.
  - `postPanelComments` posts `pageId` by the same rule: the resolved page's id, also on a read failure after the resolve; `''` when untrusted, with no folder, or when the resolve threw. The outbox caches it with the list, so `markReady` replays it.
  - `hostMessages.ts`:
    - `CanvasUpdatedMessage.pageId` and `CommentsUpdatedMessage.pageId`, both `string`;
    - `parseCanvasUpdated` and `parseCommentsUpdated` require `''` or a string that passes `isPageId` (imported from `layout.ts`), else the whole message is dropped.
  - Test helpers: the harness `canvasUpdated` builder and every test-built `canvas:updated` / `comments:updated` get `pageId`, default `'page-1'`.
  - The chrome stores nothing new yet.
  - Add `src/host/artboardDisk.test.ts`, mocking `vscode` and `../disk/openPage` the way `panelEdit.test.ts` does. It covers F-11 plus this step:
    - Open Artboard resolves with `createIfFresh: true`;
    - the refresh and `placeFrameFromChrome` resolve with `false`;
    - on the refresh and Open paths, a rejected resolve logs one error and yields a snapshot whose `errorMessage` is the error's safe message and whose `pageId` is `''` (`placeFrameFromChrome` resolves twice, once to place and once to refresh, so it may log twice);
    - a resolved fresh page with no manifest yields an empty snapshot whose `pageId` is the resolved id;
    - a read failure after a successful resolve yields an error snapshot whose `pageId` is the resolved id.

  *Done when:*
  - `artboardDisk.test.ts` passes;
  - `panelOutbox.test.ts` proves `pageId` is sent and replayed for both the view and the comments;
  - `hostMessages.test.ts` drops a `canvas:updated` / `comments:updated` with a missing or malformed `pageId` and accepts `''`;
  - `isPageId` is defined only in `layout.ts`;
  - every existing unit and browser test passes with the helpers updated.

- [x] **Step 2 - Undo history keyed by page.**
  - In `editHistory.ts`, every function that takes a frame takes `{ pageId, frameId }`: `recordEdit`, `historyStepTarget`, `recordStep`, `forgetHistory`, `historyFlags`.
  - `keepUnchangedHistories({ pageId, frames })` checks only that page's histories and leaves every other page's alone.
  - `clearEditHistories` and the epoch are unchanged.
  - The outbox passes the snapshot's `pageId` to `keepUnchangedHistories` and to the flag read it does at send time, replays included. The injected `readHistoryFlags` type in `panelOutbox.ts` / `openArtboardPanel.ts` follows the new signature.
  - `panelEdit.ts` passes the `pageId` of the page it resolved. In this step that is still `resolveOpenPage`; step 3 swaps in the requested page.
  - Update every existing caller and test of the changed signatures: `editHistory.test.ts`, `panelEdit.history.test.ts`, `panelOutbox.test.ts`.

  *Done when:* `editHistory.test.ts` covers:
  - the same frame id on two pages keeps two independent histories;
  - a snapshot of page B neither forgets nor reads page A's history;
  - A's history survives an A → B → A round trip when A's hashes are unchanged.

  The outbox test covers flags read for the posted page only. The updated `panelEdit.history.test.ts` passes.

- [x] **Step 3 - Page-bound requests carry `pageId`; the host acts on that page.**
  - **Message types and schemas.** `FramePlaceMessage`, the five comment request types, `ArtboardEditMessage` and `ArtboardHistoryMessage` gain `pageId: string`. Every schema in `chromeMessages.ts` for those types requires a `pageId` that passes `isPageId`. A missing or malformed `pageId` makes the message malformed: today's malformed answer, with no new copy.
  - **`resolveRequestedPage`.** Add it to `src/disk/openPage.ts` (contract below) with a colocated test. `answerEditRequest`, `answerHistoryRequest`, `answerCommentRequest` and `placeFrameFromChrome` call it once per request, in place of `resolveOpenPage`. Every later disk op in the request uses the returned page.
  - **History keys.** The history functions take `{ pageId: message.pageId, frameId }`, where `message.pageId` is the validated request field. It equals the resolved page's id on success, so the keys and the disk page agree. `answerHistoryRequest` keeps its fast path first: `historyStepTarget` runs before the resolve, so "Nothing to undo" does no I/O, and the `catch`'s `forgetHistory` uses the same `message.pageId`.
  - **Gone-page copy.** `panelRequestCopy.ts` gains `PAGE_GONE_MESSAGE = 'That page no longer exists.'`:
    - `editRequestErrorMessage` and `commentRequestErrorMessage` map `PageNotFoundError` to it;
    - `placeFrameFromChrome` uses it as the `placeErrorMessage` for a `PageNotFoundError` (posted as `artboard:error` after the open page's snapshot, the existing path).
  - **Chrome senders.** The three post functions in `hostBridge.svelte.ts` take the page id as their first argument and the page-free message as their second, and spread `pageId` in:
    - `postFramePlace(pageId, message: Omit<FramePlaceMessage, 'pageId'>)`;
    - `postCommentRequest(pageId, message: Omit<CommentRequestMessage, 'pageId'>)` (distributed over the union);
    - `postEditRequest(pageId, message: Omit<ArtboardEditMessage | ArtboardHistoryMessage, 'pageId'>)`, distributed likewise.

    The pure rules keep returning page-free messages. The 7 call sites pass their state class's `pageId`: `CanvasState` (1, `frame:place`), `CommentPicker` (1, `comment:create`), `EditState` (1, edit and history), `CommentsState` (4, reply, status, copy, copy-open). For now `CanvasState.pageId` is set from each `canvas:updated` with a non-empty `pageId`, and `CommentPicker` / `EditState` read it from their `canvas`; `CommentsState.pageId` is set from each applied `comments:updated` with a non-empty `pageId`. Step 5 makes all four the fixed constructor value.
  - **Test mocks.** Every `vi.mock('../disk/openPage', …)` factory (`panelComments.test.ts`, `panelEdit*.test.ts`, `artboardDisk.test.ts`) also exports `resolveRequestedPage`.

  *Done when:*
  - `chromeMessages.test.ts` refuses each of the 8 types without a `pageId` or with one like `../x`, and accepts a valid one;
  - `openPage.test.ts` (temp dirs, hand-written two-page project) covers `resolveRequestedPage` for: the open page; another indexed page with its folder; an id not in the index; an indexed id whose folder is missing; an id that fails `isPageId`; a fresh folder asking for `page-1` (the open page through step 2, nothing written) and for `page-2` (`PAGE_NOT_FOUND`);
  - `panelEdit.test.ts` / `panelComments.test.ts` (mocked disk) prove that a request for page A while B is open calls `resolveRequestedPage` with A's id and passes the returned `PageLocation` to the disk op (`addComment`, `replyToComment`, `setCommentStatus`, `getComment`, `listComments`, `markCommentsSent`, `editArtboard`, `updateArtboard`), and that a `PageNotFoundError` answers `ui:error` with `That page no longer exists.`. The disk ops' own page scoping is already proven by 10a's disk tests;
  - `panelEdit.history.test.ts` covers undo for page A while B is open: the step reads and records A's history only;
  - `artboardDisk.test.ts` proves a `frame:place` for A passes A's page to `placeFrame`, and that a `PageNotFoundError` becomes the snapshot's `errorMessage` `That page no longer exists.`;
  - a browser test proves a posted request carries the `pageId` of the last `canvas:updated`.

- [x] **Step 4 - Saved state and draft-slot rules (pure).**
  - `savedState.ts`:
    - `parseSavedStageView` returns `{ x, y, zoom, pageId }` and drops the key when `pageId` is missing or fails `isPageId`;
    - `parseSavedCommentUi`'s `commentDraft` gains `pageId`, and a draft with a missing or bad `pageId` drops alone;
    - `parseSavedCommentUi` no longer drops `openThreadId` when a draft exists. The draft-wins rule moves to page creation (Step 5), because the draft and the thread may belong to different pages.
  - `saveStageView` takes the view with its `pageId`.
  - The draft-slot rule `keptCommentDraft` in `src/webview/commentPopover.ts` (contract below) with its test.

  *Done when:* unit tests cover the saved-state parsers (`pageId` required, a bad one dropped alone, a draft and a thread both kept) and `keptCommentDraft` (including: a page read whose `pageId` differs from the slot's leaves the slot alone; no page mounted leaves the slot alone; a `''` page never writes the slot).

- [x] **Step 5 - Page-scoped chrome.** Split `App.svelte` into two parts.
  - **`App.svelte` keeps the state that spans pages:**
    - the host bridge;
    - `stagePageId` (starts at `''`);
    - the latest `ui:status` (`mcpUnavailable`, `handoffStale` move out of `CanvasState`);
    - the latest `comments:updated`;
    - the comment draft slot;
    - the mode to hand to the next page;
    - the saved UI it read once, and whether a page with a real id has mounted yet;
    - the one comment-UI save `$effect`.
  - **The new `src/webview/DesignPage.svelte`** is always rendered, inside `{#key stagePageId}`. It holds the rest:
    - the five objects (`CanvasState`, `CommentsState`, `PinThread`, `CommentPicker`, `EditState`). `CanvasState`, `CommentsState`, `CommentPicker` and `EditState` are built with the page's `pageId`; `PinThread` sends nothing page-bound and does not take it;
    - today's toolbar, banners, workspace and live region;
    - the `<svelte:window>` handlers;
    - `installScrollSink` (idempotent body styles, safe per mount).
  - **Routing (rules in Data / contracts):**
    - a `canvas:updated` whose `pageId` is non-empty and differs from `stagePageId` is a page change;
    - every other host message, including a `canvas:updated` with `pageId: ''`, goes to the mounted page;
    - frame messages are routed against the mounted page's iframes.
  - Step 3's `CanvasState.pageId` / `CommentsState.pageId` become the fixed constructor value; `CommentPicker` and `EditState` take theirs from the constructor too.
  - Update rule 08's catalog: App's new role, `DesignPage.svelte`, `keptCommentDraft`, the post functions' `pageId` argument.

  *Done when:*
  - browser tests (new `tests/browser/pages.spec.ts`), with two pages that each hold an identically blank frame `artboard`, prove:
    - switching drops the pick, the inspector draft, the hover and pick outlines, the pins, the open thread and the reply composers;
    - a comment draft on A is gone on B and returns on A (in Comment mode, frame still there);
    - a new draft on B replaces A's slot;
    - comments for A posted after canvas B never draw a pin or a panel card on B, and B's comments arriving before canvas B show once B is staged;
    - an `artboard:edited` or `ui:error` answer to an A request arriving after the switch to B changes nothing: no `cd:edit-apply` and no reload reaches B's `artboard` iframe;
    - a `canvas:updated` with `pageId: ''` while A is staged does not remount: A's mode and comments panel stay, and the next `canvas:updated` for A merges as today;
    - the stage fits all after a switch;
    - after a webview reload on the same page, the saved view comes back;
    - with a draft saved for A and a thread open on B, a reload that stages B restores B's thread;
    - the mode and the comments panel's open state carry across a switch;
  - every existing browser spec passes (`pnpm test:browser`), `commentPopover.spec.ts`'s "a draft survives two tab switches with no canvas in between" included;
  - the first paint is unchanged: before any `canvas:updated`, the panel shows the disabled toolbar and the empty state, as today;
  - `pnpm gallery` passes its contrast checks, and every state's screenshot shows the same chrome as before this feature.

- [x] **Step 6 - Contract docs and Verify.**
  - System map:
    - the message table: `pageId` on the 2 host → chrome and 8 chrome → host rows;
    - the Panel open and handshake chart (`pageId` on `canvas:updated` / `comments:updated`) plus one bullet on the chrome's page-change rule;
    - the Undo / redo chart and bullets (history keyed by page and frame);
    - a short "Page-scoped panel (10b)" section: the routing and gating rules, and `resolveRequestedPage` on the request path;
    - the Runtime map edge labels that name `resolveOpenPage` for chrome requests;
    - the "Last verified" line.
  - Rule 02: one invariant line under Message invariants ("Page-bound chrome requests carry `pageId`. The host acts on that page via `resolveRequestedPage`, never the page open now").
  - Rule 05: `resolveRequestedPage` in the `openPage.ts` entry; `isPageId` moves from the `parse.ts` entry to the `layout.ts` entry.
  - `blueprint/context/findings.md`: F-11's Resolution names `src/host/artboardDisk.test.ts`.
  - Run `pnpm verify` and `pnpm test:browser`.

  *Done when:* `pnpm verify` passes, `frameMessages.test.ts`'s table drift guard included, and `pnpm test:browser` passes.

## Files / areas

- Disk:
  - `src/disk/layout.ts` (`isPageId`), `src/disk/parse.ts` (+ test; imports it);
  - `src/disk/openPage.ts` (`resolveRequestedPage`, `isPageId` import) with `src/disk/openPage.test.ts`.
- Host:
  - `src/host/canvasSnapshot.ts` (`CanvasSnapshot.pageId`, `emptyArtboardSnapshot`);
  - `src/host/artboardDisk.ts` and the new `src/host/artboardDisk.test.ts`;
  - `src/host/panelOutbox.ts` (+ test);
  - `src/host/panelComments.ts` (+ test);
  - `src/host/panelEdit.ts` (+ tests);
  - `src/host/editHistory.ts` (+ test);
  - `src/host/chromeMessages.ts` (+ test);
  - `src/host/panelRequestCopy.ts` (+ test);
  - `src/panel/openArtboardPanel.ts` (the outbox wiring of `historyFlags` / `keepUnchangedHistories` signatures).
- Chrome:
  - `src/webview/hostMessages.ts` (+ test);
  - `src/webview/App.svelte`;
  - new `src/webview/DesignPage.svelte`;
  - `src/webview/canvasState.svelte.ts`;
  - `src/webview/commentsState.svelte.ts`;
  - `src/webview/commentPicker.svelte.ts`;
  - `src/webview/editState.svelte.ts`;
  - `src/webview/hostBridge.svelte.ts` (`connectHostBridge` iframes getter, the three post functions' `pageId`, `saveStageView` with page);
  - `src/webview/savedState.ts` (+ test);
  - `keptCommentDraft` in `src/webview/commentPopover.ts` (+ test).
- Tests: `tests/browser/harness.ts` (`canvasUpdated` and any comments builder gain `pageId`), the existing specs' message builders, and the new `tests/browser/pages.spec.ts`.
- Docs: `blueprint/context/system-map.md`, `blueprint/context/findings.md` (F-11 resolution), `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`, `.claude/rules/08-svelte-chrome.md`.

## Data / contracts

**No disk format change, no MCP change, no new message type.** The only changes are new required fields on existing messages and on webview state.

**`pageId` on host → chrome state.**
- `canvas:updated` gains `pageId: string` and `comments:updated` gains `pageId: string`.
- The value is the page the snapshot or list was read from: the `PageLocation.pageId` that `resolveOpenPage` returned for that read. A fresh folder therefore reads as `page-1`, with nothing written. A read that fails after a successful resolve still carries the resolved id.
- It is `''` only when no page was resolved:
  - untrusted workspace;
  - no workspace folder;
  - the resolver threw (for example `CORRUPT_PROJECT`, `WORKSPACE_BUSY`);
  - `placeFrameFromChrome`'s outer catch.
- A `''` snapshot always has no frames, and a `''` list always has no comments. `''` means "no page", never a page to switch to (see Chrome page-change rules).
- The outbox holds the latest view and the latest list, each with its `pageId`. `markReady` replays both, as today.
- Parse rule (chrome): the value must be `''` or pass `isPageId`. Anything else drops the whole message, as with any other malformed field of these two messages.

**`pageId` on chrome → host requests.**
- Required on `frame:place`, `comment:create`, `comment:reply`, `comment:set-status`, `comment:copy`, `comment:copy-open`, `artboard:edit` and `artboard:history`. Not on `artboard:ready`.
- `parseChromeMessage` requires `isPageId`. The value is untrusted, and the page-id pattern is what keeps `../x` out of a path.
- A failure is a malformed message:
  - `frame:place`: `MALFORMED_FRAME_PLACE_MESSAGE` on the snapshot;
  - comment requests: `malformedRequestMessage(type)`;
  - edit: `MALFORMED_EDIT_MESSAGE`;
  - history: `MALFORMED_HISTORY_MESSAGE`.
- Answers do not change shape: `artboard:edited`, `comment:added`, `comment:saved`, `ui:copied` and `ui:error` carry no `pageId`. A stale answer is dropped by the chrome because the rebuilt per-page objects hold no matching `requestId`. Request ids are UUIDs, so they never cross-match.

**`resolveRequestedPage({ workspaceRoot, pageId }): Promise<PageLocation>`** (`src/disk/openPage.ts`). Checks in this order:
1. If `pageId` fails `isPageId`, throw `new PageNotFoundError(pageId)`. The host's parser already checked it; this guard keeps 10c's MCP reuse safe.
2. Run `resolveOpenPage({ workspaceRoot, createIfFresh: false })`. It does the migration, index rebuild and tombstone, and runs once per call (rule 02); its errors propagate unchanged. It takes the lock itself, so never call it inside `withWorkspaceLock`. On a fresh folder it returns `page-1` with nothing written, so a request for `page-1` there is the open page.
3. If `pageId` equals the open page's id, return that location unchanged. No extra check, so today's behaviour for the open page stays, F-09 included.
4. Otherwise read `project.json` with `readProjectFile`. If it is absent (fresh), or `pageId` is not one of its `pages` ids, throw `new PageNotFoundError(pageId)`. Then, if `pages/<pageId>/` is not a directory (`lstatOrUndefined`), throw the same. Else return `{ workspaceRoot, pageId }`.
5. It writes nothing beyond what `resolveOpenPage` writes.

Ceilings:
- `ponytail:` a page deleted between this check and the op's write: `createArtboard` hits the 10a page-scoped write guard; every other op (`addComment`, `placeFrame`, `editArtboard`, `updateArtboard`, …) fails on `writeUtf8` and answers the generic disk-error copy, not "That page no longer exists.". Nothing recreates the folder, so no data is at risk.
- `project.json` is read twice outside the lock (once by `resolveOpenPage`, once here). An `openPageId` flip between the reads is harmless: step 4 checks only the index and the folder.
- 10b has no delete, so a gone page is reachable only by hand-editing `project.json` or the folders.

**Panel copy.** `PAGE_GONE_MESSAGE = 'That page no longer exists.'` (`panelRequestCopy.ts`) replaces the safe Agent text for `PageNotFoundError` on every page-bound request:
- edit and history through `editRequestErrorMessage`;
- comments through `commentRequestErrorMessage`;
- `frame:place` through the snapshot's `errorMessage`, which keeps the existing rule that a layout error already on the snapshot wins. A gone requested page is never the open page, so this banner always shows over the open page's snapshot. `ponytail:` accepted; the banner names no page until 10d.

The Open Artboard / refresh snapshot paths keep `toSafeArtboardErrorMessage`.

**Undo history.**
- One map keyed by page and frame (`{ pageId, frameId }` at every function).
- `keepUnchangedHistories({ pageId, frames })` applies the outside-change rule only to `pageId`'s histories.
- `historyFlags({ pageId, frameId })` is read at every `canvas:updated` send, using the posted view's `pageId`.
- Request handlers key the history by the validated `message.pageId` (equal to the resolved id on success).
- The epoch, the 20-step cap, `clearEditHistories` (panel dispose, folder change) and the ponytails are unchanged.
- A page that is not on stage keeps its histories until the panel closes.

**Chrome page-change rules** (`App.svelte`).
- **Staging.**
  - `stagePageId` starts at `''`, so a `DesignPage` for "no page" is mounted from the first paint and shows today's disabled toolbar and empty state. It has no frames, so it never picks, drafts, commits a stage view or sends a page-bound request.
  - A `canvas:updated` with a non-empty `pageId !== stagePageId` is a page change. App reads the mounted page's mode, sets `stagePageId`, holds the message as the new page's initial canvas, and calls `flushSync()` (from `svelte`) so the `{#key}` has mounted the new `DesignPage` before the handler returns. The new page applies the held canvas at creation.
  - Every other `canvas:updated` goes to the mounted page, as today. That includes `pageId: ''`: a resolve or read failure applies to the staged page as today's error snapshot (no frames, the error banner) and never remounts. The page keeps its own `pageId`, so A → `''` → A behaves exactly like today's error snapshot followed by a good refresh.
- **Other host messages.**
  - `artboard:error`, `comment:added`, `comment:saved`, `ui:copied`, `artboard:edited` and `ui:error` go to the mounted page. Its objects drop answers they do not recognise.
  - `ui:status` is held in App and passed down.
- **Comments.**
  - App holds only the latest `comments:updated`.
  - A page applies a list when `list.pageId` equals its own `pageId`, or is `''` (an empty list, with the error banner when it carries one, as today). It checks both at creation, against the held list, and when a list arrives.
  - A list for another page is held, never drawn, and never sent to a frame as `cd:anchors`.
  - `ponytail:` latest-only relies on the host's `readGeneration` (only the last read started posts). Two refreshes whose canvas posts overtake each other can leave a page with no comments until the next refresh. Upgrade path: hold the latest list per page id.
- **What a page change throws away.** Every per-page object and its DOM:
  - frame records and iframes;
  - pick, hover and the frame gesture;
  - pins, anchors and the open thread;
  - reply composers;
  - the edit drafts, queue and in-flight request, `replacedHashes`, and the history frame;
  - copy feedback, request errors and announcements.

  An inspector draft that is still open ends unsaved. A comment request still in flight is answered on its page by the host; the chrome drops the answer.
- **Carried across a page change.**
  - The mode: owned by the page's `CommentPicker` (its one setter, as today). App reads it from the mounted page right before the switch and passes it to the new page's constructor. The first page gets the saved mode.
  - The comments panel's open state (already in webview state, read by each `CommentsState`).
  - `ui:status`.
  - The comment draft slot.
- **Comment draft slot.**
  - Data: `{ pageId, draft } | undefined`, where `draft` is today's saved draft shape: never pending, never with an error. App starts it from the saved `commentDraft`.
  - The page's savable read reports `{ pageId, draft }` with the page's own constructor `pageId`, never `stagePageId`, so a read taken mid-swap stamps the right page.
  - Pure rule `keptCommentDraft({ slot, page })`, where `page` is `{ pageId, draft } | undefined`:
    - `page` undefined (none mounted) or `page.pageId === ''`: the slot stays as it is;
    - `page.draft` defined: the slot becomes `{ pageId: page.pageId, draft: page.draft }`, replacing another page's;
    - no draft and `slot.pageId === page.pageId`: the slot clears (its draft was added, cancelled or dropped);
    - otherwise the slot stays.
  - A new page gets `heldDraft = slot.draft` only when `slot.pageId` equals its `pageId`. It restores through today's `restoreHeldDraft` and `resolveHeldDraft` rules: Comment mode, frame still live.
- **First real page after a webview reload.** The first page with a non-empty `pageId` gets the saved reply drafts and, when it did not get a held draft, the held thread id (the draft still wins, but only on its own page). The `''` page and later pages get neither: both are keyed by comment UUIDs and would be pruned anyway.
- **The save `$effect`.** It writes nothing while no page is mounted or the mounted page's `pageId` is `''`, so the saved UI survives reloads with no canvas in between. Otherwise it writes the page's mode, open or held thread and reply drafts, and the slot from `keptCommentDraft`, through `saveCommentUi`.

**Webview state** (`getState` / `setState`; no host contract).
- `stageView` becomes `{ x, y, zoom, pageId }`. A `CanvasState` restores it only when `pageId` equals its own page; otherwise it fits all on first layout, as today. A page with no frames never commits a view, so the `''` page never writes one.
- `commentDraft` gains `pageId`.
- Both parsers drop the key when `pageId` is missing or fails `isPageId`.
- `parseSavedCommentUi` keeps `openThreadId` next to a draft (the draft-wins rule moves to page creation, above).
- No backward compatibility is needed. The extension registers no `WebviewPanelSerializer`, so a panel never survives the window reload that an update needs, and 0.4 webview state never reaches this chrome.
- `mode`, `replyDrafts` and `commentsPanelOpen` are unchanged.

**Requests from the chrome.**
- `CanvasState`, `CommentPicker`, `EditState` and `CommentsState` send the page's `pageId` from their constructor, through the post functions' first argument. Within one `DesignPage` they are all equal.
- `frame:place` keeps its no-`requestId` path. The host answers with the open page's snapshot. During a switch, the rebuilt `CanvasState` has no gesture to settle.

**Security and trust.**
- Chrome → host stays untrusted: `pageId` is validated before any path is built, and untrusted workspaces are refused before any resolve, as today.
- There is no new rendering of user text. Page titles are not posted until 10d.

## Testing

- Runner: Vitest (`pnpm test`); browser tests: `pnpm test:browser` (local, not Verify). Each step's *Done when* names its tests. Every new host test mocks `vscode` the way `panelEdit.test.ts` does. Disk tests use temp dirs (rule 09) with a hand-written two-page `project.json` and page folders. Host request tests stay mocked at the disk boundary; they prove which page reaches the op.
- Logic that must ship with tests:
  - the `pageId` parse rules on both sides;
  - `resolveRequestedPage`;
  - the history keyed by page;
  - the outbox flag read for the posted page;
  - the gone-page copy mapping;
  - the saved-state parsers;
  - `keptCommentDraft`.
- Browser (`tests/browser/pages.spec.ts`): the stub posts `canvas:updated` / `comments:updated` with two page ids and identical blank `artboard` frames. The step 5 cases above, plus step 3's posted-request `pageId` check. Run `pnpm test:browser` serially, never next to another agent's run (shared `dist/`).
- Not covered here: a real Cursor run. `/check` can drive it in the dev fixture. Add `pages/page-2/` with a copied `artboards/` (and `canvas.json` / `comments.json`), add `page-2` to `project.json` `pages`, then flip `openPageId` by hand. The watcher refresh re-reads it (D12), and the panel should switch with nothing leaking. The `.vsix` run is 10e.
- Verify (`pnpm verify`) was run once at `/feature` time; its result is in the handoff, not here.

## Notes for the AI

- **Read first:**
  - `blueprint/reference/0.5-pages-plan.md` D8 and the 10b section;
  - the 10a archive's Data / contracts for `resolveOpenPage`, `PageLocation`, `isPageId` and `PageNotFoundError`;
  - rules 02, 05, 06 and 08.
- **`isPageId`** lives in `layout.ts` from step 1 on. It is the one guard; never write a second page-id check.
- **Adding `pageId` to requests.** Only the three post functions in `hostBridge.svelte.ts` add it (step 3). Do not thread `pageId` through any pure rule's arguments or return types.
- **`connectHostBridge`.** Its `iframes` becomes a getter (`() => ReadonlyMap`), so frame messages are matched against the mounted page's iframes. No new subscription per page. `artboard:ready` is still posted once, from App.
- **`DesignPage` exposure.** App needs, from the mounted page: the host and frame message handlers, the iframes map, the mode, and a savable read (`{ pageId, mode, draft, threadId, replyDrafts }`, where `draft` is the live or held draft and `threadId` the open or held thread). Svelte MCP docs decide the exact form (exported functions on the component instance via `bind:this`, or a register callback prop). Whatever the form, the read carries the page's own `pageId`, and App treats "no page" as "write nothing".
- **Why `{#key}` and not object replacement.** Replacing the objects in place would leave `Stage`'s keyed `{#each}` reusing the iframe of a same-id frame (`artboard` on both pages) without re-registering it in the new `CanvasState.iframes`. The remount is what makes a same-id frame a new document.
- **Toolbar placement.** It moves inside `DesignPage` for now, so it remounts on a switch. 10d puts the page button there and may lift the toolbar into App to keep menu focus; that is not this feature's concern.
- **Focus after a switch.** Not moved. If focus was inside the old page, it falls to `body`. In 10b only a hand edit or (from 10c) the Agent switches pages; 10d's menu, the first user-driven switch, owns the focus target. Mark this with a `ponytail:` comment in `App.svelte`.
- **Copy prompt across pages.** A `comment:copy` for page A while B is open copies A's comment (the host reads A). The Agent's `get_comment` then looks at the open page; its page hint is 10c. No prompt text change (locked).
- **Locks.** The host never wraps `resolveRequestedPage` or any disk op in `withWorkspaceLock`; both take it themselves.
- **Ceilings to mark with `ponytail:` comments:**
  - `resolveRequestedPage`'s check-then-write race (above).
  - The gone-page `frame:place` banner over the open page (above).
  - Latest-only comment list (above).
  - A comment draft whose Add is in flight at a switch is not kept in the slot. Its comment lands on its page if the write succeeds; if the write fails, the text is lost. This is today's tab-hide ceiling.
  - Focus after a switch (above).
- **Keep out:** no page UI, no `pages` list, no MCP or skill change, no README.
- **Choices taken under "simplest repository-native option".** Each is reversible and has no persisted-data or interoperability effect. A reviewer may flip any of them.
  - The mode carries across a page switch. The plan lists the picker among the rebuilt objects but says nothing about the mode; it is a tool choice, not page data.
  - The comments panel's open state carries across a switch.
  - `''` is "no page": it never remounts a staged page, and it is the stage id of the first paint, so the first paint is unchanged.
  - No focus move after a switch until 10d.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":37322,"specSha256":"f8b6d76a0b3d66db2a92e5285819aa6d276b1a8acc812e555753005a1007c573","branch":"refs/heads/feature/page-scoped-panel","head":"295d84f094f887c5ede26fc50ab16b9a628061ae","baseRef":"refs/heads/main","baseCommit":"5a31aa20ed5a4f20de8429e8030616a45e027b87","sourceTree":"a76a1f927da718927b97c5b62aeccf041c59178a","landing":"local-merge","absentOptional":[]} -->

## Findings

### 10b/F-11 [P3] closed - The host snapshot, frame-place and export entry points have no test of their resolver wiring

**File:** src/host/artboardDisk.ts:125
**Found:** 2026-11-22 by /audit independent (scope: current; lens: tests; reviewer: claude-opus-5-5, fresh subagent)
**Why it matters:** 10a adds new logic to three host entry points that no test runs: `loadActiveSnapshot` passes `createIfFresh: initializeWhenMissing` (true only for Open Artboard) and gates on the page manifest `manifestPathSegments(page.pageId)`; `placeFrameFromChrome` (line 181) and `commands/exportHandoff.ts:24` resolve with `createIfFresh: false`; and a resolver error must become the snapshot `errorMessage` or `showErrorMessage`. No `*.test.ts` imports `artboardDisk.ts` or `exportHandoff.ts`. Flipping the refresh path to `createIfFresh: true`, which would let a panel-visible read create `.cursor-design/` on a fresh root, or dropping the page from the manifest gate would pass `pnpm verify`. `panelEdit` and `panelComments` already have these tests (F-02). The production code reads correctly today.
**Suggested fix:** Add one small `src/host/artboardDisk.test.ts` that mocks `vscode` and `resolveOpenPage` the way `panelEdit.test.ts` does. Assert that Open Artboard resolves with `createIfFresh: true`, the refresh and `placeFrameFromChrome` resolve with `false`, and a rejected resolve yields one logged error and a snapshot `errorMessage` equal to the error's message. No production change. Optional before /complete, since 10e's real-Cursor run covers the same paths by hand.
**Resolution:** 2026-11-22 /implement (10b step 1): added `src/host/artboardDisk.test.ts`. It mocks `vscode` and `../disk/openPage` the way `panelEdit.test.ts` does and asserts: Open Artboard resolves with `createIfFresh: true`, the refresh and `placeFrameFromChrome` with `false`; a rejected resolve logs once and yields the safe message with `pageId: ''`; a fresh page with no manifest and a read failure after the resolve carry the resolved page id; a `frame:place` for another page places on that page, and a gone page answers `That page no longer exists.`. `commands/exportHandoff.ts` stays untested (10e's real-Cursor run covers it). No production change. 2026-11-22 /audit (scope: current; reviewer: claude-sonnet-5-5 subagent, mutation probes in a scratch copy): reopened. The repair is sound and pins the `createIfFresh` flags, the read-failure `pageId`, the resolver-error log and the `frame:place` page and gone-page wiring. Still unpinned, both named in this finding's own text: the manifest gate path (the `fileExists` mock ignores its argument; mutating `manifestPathSegments(page.pageId)` to `'page-1'` survived), and Open Artboard's `initializeDefaultArtboard` on a missing manifest (deleting it survived; so did never initializing on refresh). Fix: assert the `fileExists` path names the resolved page, and that `createArtboard` runs on Open but not on refresh. 2026-11-23 /implement repair: `artboardDisk.test.ts` now asserts the `fileExists` manifest path names the resolved page (mutating `manifestPathSegments(page.pageId)` to `'page-1'` fails) and that `createArtboard` runs on Open for the resolved page but never on the refresh (deleting `initializeDefaultArtboard`, or initializing on refresh, each fail). No production change. 2026-11-23 /audit re-audit (scope: current; reviewer: claude-sonnet-5-5 subagent, fresh): closed. The named mutations now fail in a scratch copy: `manifestPathSegments('page-1')`, deleting `initializeDefaultArtboard`, initializing on refresh and `createIfFresh: true` each fail `artboardDisk.test.ts`; the repair added nothing new.

### 10b/F-12 [P2] closed - The `pageId` that `postPanelComments` posts is untested

**File:** src/host/panelComments.ts:46
**Found:** 2026-11-22 by /audit (scope: current; lens: tests; reviewer: claude-sonnet-5-5 subagent)
**Why it matters:** The step 1 rule (the resolved id, kept on a read failure after the resolve; `''` when untrusted or the resolve threw) has no assertion: `panelComments.test.ts` mocks `postCommentsToPanel` as a bare call record and never inspects its arguments. Deleting `pageId = page.pageId;` passed every host test. If that regresses, every list arrives as `''`, which the chrome applies to any staged page, so one page's comments would draw on another.
**Suggested fix:** Record the mock's arguments and assert `pageId` for a good read, a read failure after the resolve, and a resolve throw or untrusted workspace.
**Resolution:** 2026-11-23 /implement repair: `panelComments.test.ts` records `postCommentsToPanel` args and asserts `pageId` for a good read (`page-1`), a read failure after the resolve (`page-1` kept, with an error), a resolve throw and an untrusted workspace (`''`). Deleting `pageId = page.pageId;`, starting `pageId` as `'page-1'` and posting `'page-1'` when untrusted each fail. 2026-11-23 /audit re-audit (scope: current; reviewer: claude-sonnet-5-5 subagent, fresh): closed. The named mutations now fail in a scratch copy: deleting `pageId = page.pageId`, starting it as `'page-1'` and posting `'page-1'` when untrusted each fail the new `panelComments.test.ts` case.

### 10b/F-13 [P2] closed - The history fast path and the catch's `forgetHistory` key are untested

**File:** src/host/panelEdit.ts:219
**Found:** 2026-11-22 by /audit (scope: current; lens: tests; reviewer: claude-sonnet-5-5 subagent)
**Why it matters:** The spec requires "Nothing to undo" to do no I/O (`historyStepTarget` before `resolveRequestedPage`), and the catch at :250 to forget the requested page's history. Moving the resolve before the fast path survived, and so did keying `forgetHistory` with `pageId: 'page-1'`.
**Suggested fix:** In `panelEdit.test.ts`, assert `resolveRequestedPage` is not called when there is nothing to undo. In `panelEdit.history.test.ts`, fail a page-2 step with a `ConflictError` and assert page-1's history for the same frame is kept.
**Resolution:** 2026-11-23 /implement repair: `panelEdit.test.ts` asserts `resolveRequestedPage` is never called for an undo or redo with nothing held (moving the resolve before `historyStepTarget` fails). `panelEdit.history.test.ts` fails a page-2 step with a `ConflictError` and asserts page-2's history is forgotten and page-1's for the same frame id is kept (keying `forgetHistory` with `pageId: 'page-1'` fails). 2026-11-23 /audit re-audit (scope: current; reviewer: claude-sonnet-5-5 subagent, fresh): closed. The named mutations now fail in a scratch copy: resolving before `historyStepTarget` and keying `forgetHistory` with `page-1` each fail; the two-page history tests use the real history module.

### 10b/F-14 [P2] closed - No test pins that the `''` page never writes the saved comment UI

**File:** src/webview/App.svelte (save `$effect`, the `mounted.pageId === ''` guard)
**Found:** 2026-11-22 by /audit (scope: current; lens: tests; reviewer: claude-opus-5-5 subagent)
**Why it matters:** Without the guard, the first-paint `''` page saves `openThreadId: undefined` and empty reply drafts, so a second tab switch before any canvas loses the open thread and reply drafts (the spec says the saved UI survives reloads with no canvas in between). Removing the guard passed `pages.spec`, `commentPopover.spec` and `commentsPanel.spec` (71/71): the existing two-switch test checks only the draft, which `keptCommentDraft` protects anyway. A throwaway variant of "a tab switch reopens the open pin thread" with a second `reload` before any canvas fails under the mutation and passes today.
**Suggested fix:** Add `await nextAnimationFrame(page); await reload(page);` after the first reload in `tests/browser/commentsPanel.spec.ts:348`, or a sibling test with that change.
**Resolution:** 2026-11-23 /implement repair: `commentsPanel.spec.ts` "a tab switch reopens the open pin thread, even after a second switch before any canvas" now does `reload`, `nextAnimationFrame`, `reload` before any canvas, then expects the thread back. Removing the `mounted.pageId === ''` guard from App's save `$effect` now fails it (thread not visible). No production change. 2026-11-23 /audit re-audit (scope: current; reviewer: claude-opus-5-5 subagent, fresh): closed. Removing the `mounted.pageId === ''` guard fails `commentsPanel.spec.ts:343` (thread not visible); the reload, frame, reload version also covers the single-reload case.

### 10b/F-15 [P3] closed - The `resolveRequestedPage` index check is masked in its test

**File:** src/disk/openPage.ts:324
**Found:** 2026-11-22 by /audit (scope: current; lens: tests; reviewer: claude-sonnet-5-5 subagent)
**Why it matters:** The "not in the index" case uses `page-4`, which also has no folder, so the folder check throws first. Weakening the index check to `project === undefined` survived.
**Suggested fix:** Add a `pages/page-5/` folder that `project.json` does not list and expect `PageNotFoundError`.
**Resolution:** 2026-11-23 /implement repair: `openPage.test.ts` seeds `pages/page-5/` (folder present, not in `project.json`) and expects `PageNotFoundError`; weakening the index check to `project === undefined` now fails. 2026-11-23 /audit re-audit (scope: current; reviewer: claude-sonnet-5-5 subagent, fresh): closed. The named mutations now fail in a scratch copy: weakening the index check to `project === undefined` fails the unindexed `page-5` case.

### 10b/F-16 [P3] closed - Rule 02 still says every host entry point calls `resolveOpenPage`

**File:** .claude/rules/02-mcp-webview.md ("Disk and lock")
**Found:** 2026-11-22 by /audit (scope: current; lens: quality; reviewer: claude-sonnet-5-5 subagent)
**Why it matters:** Panel request handlers now call `resolveRequestedPage`, and the "never inside `withWorkspaceLock`" list does not name it even though it takes the lock through `resolveOpenPage`. Agents follow this rule file. The code is correct (no caller wraps it).
**Suggested fix:** Say panel requests resolve through `resolveRequestedPage` (which calls `resolveOpenPage` once), and add it to the never-inside-the-lock list.
**Resolution:** 2026-11-23 /implement repair: `.claude/rules/02-mcp-webview.md` now says panel requests resolve through `resolveRequestedPage` (which calls `resolveOpenPage` once) and lists it in the never-inside-`withWorkspaceLock` list. 2026-11-23 /audit re-audit (scope: current; reviewer: claude-sonnet-5-5 subagent, fresh): closed. The named mutations now fail in a scratch copy: rule 02 names `resolveRequestedPage` on the panel path and in the never-inside-the-lock list; the inserted sentence's dangling "It" is tracked as F-18.

### 10b/F-17 [P3] closed - Page-start rules sit inline in `App.svelte` and `DesignPage.svelte`

**File:** src/webview/App.svelte (`stagePage`, `handleHostMessage`); src/webview/DesignPage.svelte:94
**Found:** 2026-11-22 by /audit (scope: current; lens: quality; reviewer: claude-opus-5-5 subagent)
**Why it matters:** Rule 08 keeps deciding logic in pure rule modules with unit tests. The page-change test (non-empty, different id), the new page's start (held draft only on its own page; thread only on the first real page and only without a held draft; reply drafts only on the first page) and the comment-list guard are covered only by browser tests. Those do catch removals today (mutation probes M2, M3, M5, M8).
**Suggested fix:** Move the page-change test and the start builder into a pure function next to `keptCommentDraft`, with a colocated edge-case test. No behavior change.
**Resolution:** 2026-11-23 /implement repair: new pure `src/webview/pageStart.ts` (by concern: page start, not the popover draft) holds `PageStart`, `isPageChange`, `nextPageStart` and `isPageComments`; `App.svelte` and `DesignPage.svelte` call them, no behavior change; rule 08's catalog lists it. `pageStart.test.ts` (5 tests) fails on each of nine guard mutations: drop `''` or the staged-id compare in `isPageChange`; hold the draft on any page; give the thread to a later page or over a held draft; give reply drafts to a later page; ignore the leaving page's mode; drop the own-page or the `''` branch of `isPageComments`. 2026-11-23 /audit re-audit (scope: current; reviewer: claude-opus-5-5 subagent, fresh): closed. `src/webview/pageStart.ts` matches the spec's page-change rules with no behavior change; six unit mutations and the `isPageComments` / `page.leave()` call-site probes fail; the `first` flag's call site is tracked as F-19.

### 10b/F-18 [P3] closed - Rule 02's inserted panel sentence left a dangling "It"

**File:** .claude/rules/02-mcp-webview.md ("Disk and lock", first bullet)
**Found:** 2026-11-23 by /audit re-audit (scope: current; lens: quality; reviewer: claude-sonnet-5-5 subagent)
**Why it matters:** The F-16 sentence about `resolveRequestedPage` sat mid-bullet, so the next sentence's "It migrates a 0.4 root layout…" read as `resolveRequestedPage` instead of `resolveOpenPage`. Agents follow this file.
**Suggested fix:** Move the panel sentence to the end of the bullet.
**Resolution:** 2026-11-23 /implement repair (lead): moved the panel sentence to the end of the bullet, so "It" refers to `resolveOpenPage` again. Doc only. 2026-11-23 closure review (reviewer: claude-sonnet-5-5 subagent, fresh): closed. "It" now follows the `resolveOpenPage` sentence, and the moved sentence matches `openPage.ts` and the four panel handlers.

### 10b/F-19 [P3] closed - No test pins the first-real-page flag at its call site

**File:** src/webview/App.svelte:51 (`first: !realPageMounted`)
**Found:** 2026-11-23 by /audit re-audit (scope: current; lens: tests; reviewer: claude-opus-5-5 subagent)
**Why it matters:** The saved thread and reply drafts go only to the first real page after a reload. If the flag broke, an A → B → A trip would reopen the thread and reply drafts saved at load time, which are stale by then. Changing it to `first: true` passed `pages.spec`, `commentsPanel.spec` and `commentPopover.spec` (71/71); `pageStart.test.ts` covers the rule, not this wiring.
**Suggested fix:** One `pages.spec` case: open a thread on A, reload, stage A, close the thread, switch to B and back to A, expect no thread.
**Resolution:** 2026-11-23 /implement repair: `only the first page after a reload gets the saved thread back` in tests/browser/pages.spec.ts; `first: true` now fails it. 2026-11-23 closure review (reviewer: claude-sonnet-5-5 subagent, fresh): closed. `first: true` fails the new test (expected 0 threads, got 1); restored, `pages` passes 36/36 with `--repeat-each=3`.

## Independent review

**Status:** passed
**Target commit:** 295d84f094f887c5ede26fc50ab16b9a628061ae
**Base commit:** 5a31aa20ed5a4f20de8429e8030616a45e027b87
**Base ref:** main
**Spec hash:** f8b6d76a0b3d66db2a92e5285819aa6d276b1a8acc812e555753005a1007c573
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-fable-5-2
**Requested execution:** automatic
**Requested at:** 2026-11-23T10:07:35Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-fable-5-2
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-23T10:39:03Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD`, `git merge-base HEAD main`, `shasum -a 256 blueprint/context/current-feature.md`, `git status --porcelain`: pass (target, base and spec hash match; only `blueprint/context/review.md` differed)
- `pnpm verify`: pass
- `pnpm test:browser`: pass (209 passed, 208 skipped; every skip is the `CD_GALLERY`-gated gallery spec)
- Unit mutation probes in a scratch copy (39 mutants over `openPage.ts`, `panelEdit.ts`, `panelOutbox.ts`, `artboardDisk.ts`, `panelComments.ts`, `panelRequestCopy.ts`, `chromeMessages.ts`, `editHistory.ts`, `hostMessages.ts`, `savedState.ts`, `pageStart.ts`, `commentPopover.ts`; `vp test`): pass (38 killed; 1 equivalent)
- Browser mutation probes in the scratch copy (13 mutants over `App.svelte`, `DesignPage.svelte`, `canvasState.svelte.ts`, `commentsState.svelte.ts`, `hostBridge.svelte.ts`; `pages`, `commentPopover`, `stage`, then survivors on `commentsPanel`, `pins`, `editMode`): pass with gaps (8 killed, 5 survived; see Evidence)
- `node .claude/skills/blueprint-doctor/scripts/run-state.mjs`: unavailable (not run; this reviewer may write only the findings ledger and this receipt)

### Evidence

- Full `5a31aa2..295d84f` delta read: disk (`layout.ts`, `openPage.ts`, `parse.ts`), host (`artboardDisk.ts`, `canvasSnapshot.ts`, `chromeMessages.ts`, `editHistory.ts`, `panelComments.ts`, `panelEdit.ts`, `panelOutbox.ts`, `panelRequestCopy.ts`), chrome (`App.svelte`, `DesignPage.svelte`, `pageStart.ts`, the four state classes, `hostBridge.svelte.ts`, `hostMessages.ts`, `savedState.ts`, `commentPopover.ts`), `tests/browser/pages.spec.ts`, rules 02 / 05 / 08 and the system map's 10b section.
- Security: every page-bound request's `pageId` passes `isPageId` in `parseChromeMessage` before any path is built; `resolveRequestedPage` re-checks it, then the index and an `lstat` directory check (a symlinked page folder is refused); the untrusted-workspace refusals still run before any resolve.
- Quality: the spec's five ceilings carry `ponytail:` comments; `isPageId` is defined once in `layout.ts`; only the three post functions add `pageId`.
- Surviving mutants: the `isPageId` guard in `resolveRequestedPage` (equivalent: the index check refuses the same ids); the pre-switch `keptCommentDraft` call and `flushSync()` in `App.svelte` (belt and braces: the save `$effect` and the microtask flush already cover the tested paths); `heldDraft ??` / `heldThreadId` in `savable` (logic unchanged from `main`, outside this delta); `CommentsState`'s `pageId` (F-20).
- The one `vp test` failure in the scratch copy (`handoffCanvasHtml.test.ts` snapshot) is a path artifact of the symlinked `node_modules`; it passes in the repo.

### Findings

- F-20 [P2] open: no test pins the `pageId` on the reply, status and copy requests
- F-21 [P3] open: the staging `canvas:updated` stays referenced for the page's whole life

### Remaining risk

- No real Cursor run: CSP, webview hide / show, the watcher-driven page switch and the hand-edited `project.json` flow are unproven here (the spec leaves them to `/check` and 10e).
- `pnpm gallery` was not run, so the "same chrome as before" screenshots and contrast checks were not re-verified by this review.
- Dashboard run-state helper not run (unavailable under this reviewer's write limits).
- F-21 is read from the code, not measured with a heap profile.
- A non-gone `frame:place` failure for page A that is answered after a switch shows its banner over page B and names no page (same ceiling as the documented gone-page ponytail).

## Try it now

Run or do:

Press F5 (opens `fixtures/dev-workspace`) and run **Cursor Design: Open Artboard**. Then make a second page by hand: copy `fixtures/dev-workspace/.cursor-design/pages/page-1/` to `pages/page-2/`, add `{ "id": "page-2", "title": "Page 2" }` to `project.json` `pages`, and change `openPageId` to `page-2`. Change it back to `page-1` afterwards.

Expected:

The panel switches to page 2 and fits all its frames in view. Pins, comment cards, the open thread, reply boxes, the pick outline and the inspector start clean, even though both pages have the same frame ids. A comment you were typing on page 1 is gone on page 2 and comes back when you switch back. Your mode and the comments panel's open state stay as they were.

This proves:

A page change starts the panel's per-page state again, so nothing from one page leaks onto another.
