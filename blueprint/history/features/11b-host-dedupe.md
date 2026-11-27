# Feature: Host dedupe

**From build-plan:** feature 11b
**Build attempt:** 1
**Branch:** feature/host-dedupe
**Status:** verified (steps 1-4 built; `pnpm verify` pass, 74 files, 880 tests after the F-39 routing test, 2026-11-27)

## Goal

One way to do each host job, with no behavior change:

- one panel request preamble (requestId, trust, folder, parse) shared by every chrome request handler;
- one `comments.json` write shell in `src/disk/comments.ts`;
- one six-key handlers object in place of the five `setArtboardPanelOn*` setters and `extension.ts`'s edit / history re-split;
- the twin dispose-hooked flags gone.

The plan's fourth item, one MCP open-page wrapper, already shipped in 10c as `runOnOpenPage` (`blueprint/reference/0.5-pages-plan.md`: "11b drops that item"), so there is nothing to build for it. `/complete` records that on the plan lines (step 4).

## In scope

- `src/host/panelRequest.ts` (new): the request preamble. Used by `answerEditRequest`, `answerHistoryRequest` (`panelEdit.ts`), `answerCommentRequest` (`panelComments.ts`), `answerPageRequest` (`panelPages.ts`) and `placeFrameFromChrome` (`artboardDisk.ts`). `panelPages.ts` is included although the plan line predates it: 10d added the same preamble a fourth time.
- `src/host/chromeMessages.ts`: delete `commentRequestId` and `pageRequestId`. Callers use `claimedRequestId`, since routing already guarantees the type.
- `src/disk/comments.ts`: one private write shell used by `addComment`, `replyToComment`, `setCommentStatus`, `markCommentsSent` and `resolveComment`.
- `src/panel/openArtboardPanel.ts` and `src/extension.ts`: one `setArtboardPanelHandlers` call; the panel routes edit and history to their own handlers.
- `src/host/watchArtboardDisk.ts`, `src/mcp/registerVibeboardMcp.ts`: remove `watcherDisposeHooked` and `mcpDisposeHooked`.
- Rule 05 owner catalog.

## Out of scope

- The MCP open-page wrapper (shipped in 10c).
- 11c ports: handlers keep importing their I/O, and tests keep today's `vi.mock`s.
- 11d `parseHostMessage` and the 11e comments deep review.
- Any change to messages, copy, disk layout, lock discipline, MCP tools or the Agent skill.
- `postPanelComments`: it is a read, not a request, and keeps its own trust / folder check.
- Browser tests and the gallery: chrome is untouched.

## Build loop

- `workflow.stepReview: feature`: one review after the last step, not one per step.
- `checkpointCommits: disabled`: no commits until `/complete`.
- After each step run `pnpm exec vp check` and `pnpm test`. Run `pnpm verify` once at the end.

## Build steps

1. **Comments write shell.** In `src/disk/comments.ts`, `findComment` and `replaceComment` become list helpers: `findComment(comments: readonly Comment[], id: string): Comment` (throws `CommentNotFoundError`; `getComment` passes `file.comments`) and `replaceComment(comments: readonly Comment[], next: Comment): Comment[]`. Then add one private shell:

   ```ts
   const changeCommentsFile = async <T>({ page, ifMissing, change }: {
     page: PageLocation;
     ifMissing?: () => T; // sync; may throw
     change: (comments: readonly Comment[]) => { comments?: Comment[]; result: T }; // sync
   }): Promise<T>
   ```

   The shell runs these steps in order:
   - Call `assertLayoutDirsOwned(page)`.
   - When `ifMissing` is given and `commentsTextIfExists(page)` is `undefined`, return `ifMissing()` without taking the lock.
   - Otherwise take `withWorkspaceLock` and run `readCommentsFile(page)`, then `change(file.comments)`.
   - Only when `change` returns `comments`, call `writeCommentsFile(page, { version: COMMENTS_SCHEMA_VERSION, comments })`. Omitting `comments` means no write.
   - Return `result`.

   Move the five ops onto the shell. Each keeps its argument checks before the shell, in today's order:
   - `replyToComment`, `setCommentStatus`, `resolveComment`: `ifMissing` throws `CommentNotFoundError`; `change` calls `findComment`, then today's checks. A no-op status change returns `{ result: current }`, so nothing is written.
   - `markCommentsSent`: `ifMissing` returns `[]`. When nothing is marked, `change` returns `{ result: [] }`, so nothing is written.
   - `addComment`: no `ifMissing`, so an absent file reads as empty, as today. Its order stays: ownership check, then `validateNewComment`, then the artboard read. The shell repeats the ownership check (one extra lstat, accepted). `change` holds the `MAX_COMMENTS` check and the append.

   Done when:
   - `src/disk/comments.test.ts`, `commentTools.contract.test.ts` and the host comment tests pass unchanged.
   - "No lock when the file is missing" still holds: these tests pass:
     - `resolve, reply, status and mark-sent on a workspace with no .vibeboard create nothing`
     - `open to open and resolved to resolved do not write`
     - `a no-file workspace has no lock file after a missing-comment read`
   - `grep -c "withWorkspaceLock({" src/disk/comments.ts` is 1.

2. **Panel request preamble.** New `src/host/panelRequest.ts` (vscode glue). Neither function throws: each runs only `claimedRequestId`, `isTrusted`, `firstWorkspaceFolder`, `parseChromeMessage`, `logDiskError` and `postAnswerToPanel`, none of which throw. Two exports:

   ```ts
   type Refuse = (message: string, error: unknown) => void; // not exported (knip checks types)

   export const panelRequest = ({ value, type, scope, outputChannel, afterRefuse }: {
     value: unknown; type: string; scope: string;
     outputChannel: vscode.OutputChannel; afterRefuse?: () => void;
   }): { requestId: string; refuse: Refuse } | undefined

   export const checkedPanelMessage = <T extends ChromeMessage['type']>({ value, type, malformedMessage, refuse }: {
     value: unknown; type: T; malformedMessage: string; refuse: Refuse;
   }): { workspaceRoot: string; message: Extract<ChromeMessage, { type: T }> } | undefined
   ```

   - **`panelRequest`.** `requestId = claimedRequestId(value)`. When `requestId` is `undefined`: log `new InvalidArgsError(\`${type} from the panel has no valid requestId.\`)` at `scope` and return `undefined`. Nothing is posted and `afterRefuse` does not run. Otherwise `refuse(message, error)` does three things in order: logs at `scope`, posts `ui:error { requestId, message }`, then runs `afterRefuse`. Callers call it **before** their `try`, so `refuse` stays in scope for the `catch`.
   - **`checkedPanelMessage`.** Runs these checks in order:
     - Untrusted workspace: `refuse(UNTRUSTED_WORKSPACE_MESSAGE, \`${type} refused in an untrusted workspace.\`)`.
     - No folder: `const error = new NoWorkspaceError(); refuse(error.message, error)`.
     - The parsed message's type differs from `type`: `refuse(malformedMessage, new InvalidArgsError(\`Malformed ${type} message from the panel.\`))`.

     All three strings are today's. Narrow with a local type predicate (`(message): message is Extract<ChromeMessage, { type: T }> => message?.type === type`), never an `as` cast. A union `T` (the comment request types) must keep `panelComments`' `switch … satisfies never` compiling.

   Callers:
   - **`panelEdit.ts`.** Delete `refuser` and `checkedWorkspaceRoot`. Both handlers call the two functions:
     - edit: scope `panelEdit.answer`, malformed copy `MALFORMED_EDIT_MESSAGE`;
     - history: scope `panelEdit.history`, malformed copy `MALFORMED_HISTORY_MESSAGE`.

     Everything after the parse is unchanged. History's `catch` still calls `forgetHistory` before `refuse` on `ConflictError` / `ArtboardNotFoundError`.
   - **`panelComments.ts`.**
     - The claimed-type guard stays, with its text and scope `panelComments.answer`.
     - Then call `panelRequest` with the per-type scope.
     - `afterRefuse` is `() => void postPanelComments({ outputChannel })`, for copy types only (`isCopyType`), as today.
     - Malformed copy: `malformedRequestMessage(type)`.
   - **`panelPages.ts`.**
     - The claimed-type guard (type `undefined`) stays, logging today's text `Page request from the panel has no valid requestId.` at `panelPages.answer`.
     - Then call `panelRequest` with the per-type scope. A missing requestId now logs at that scope (log only).
     - `afterRefuse` is `() => void refreshPanel({ outputChannel })`.
     - Malformed copy: `MALFORMED_PAGE_REQUEST_MESSAGE`.
   - **`artboardDisk.ts` `placeFrameFromChrome`** (no requestId) uses only `checkedPanelMessage`, inside the existing outer `try` / `catch` (still scope `artboardDisk.placeFrameFromChrome`):

     ```ts
     let refusedMessage: string | undefined;
     const checked = checkedPanelMessage({
       value, type: 'frame:place', malformedMessage: MALFORMED_FRAME_PLACE_MESSAGE,
       refuse: (message, error) => {
         logDiskError({ scope: 'artboardDisk.placeFrame', error, outputChannel });
         refusedMessage = message;
       },
     });
     if (checked === undefined) {
       return refusedMessage;
     }
     ```

     - `MALFORMED_FRAME_PLACE_MESSAGE` stays in `artboardDisk.ts`.
     - Untrusted and no-folder refusals are now logged too (log only); the returned copy is unchanged.
     - `artboardDisk.ts` now reaches `openArtboardPanel` through `panelRequest.ts`. There is no import cycle, and `artboardDisk.test.ts` needs no new mock.
   - **`chromeMessages.ts`.** Delete `commentRequestId` and `pageRequestId`. In `chromeMessages.test.ts`, keep the invalid-`requestId` asserts, retargeted at `claimedRequestId`, and delete the asserts that only checked "other types return `undefined`".

   Done when:
   - These tests pass with only mock-path or log-scope edits: `panelEdit.test.ts`, `panelEdit.history.test.ts`, `panelComments.test.ts`, `panelPages.test.ts`, `artboardDisk.test.ts`. No assertion on a posted message, a disk call, a refresh or copy changes.
   - The four existing no-requestId tests (one per `answer*` handler) still pass: nothing is posted, refreshed or written.
   - `grep -n "isTrusted" src/host/panelEdit.ts src/host/panelComments.ts src/host/panelPages.ts src/host/artboardDisk.ts src/host/panelRequest.ts` finds `postPanelComments`, `loadActiveSnapshot` and one hit in `checkedPanelMessage`.
   - `knip` and `knip --production` are clean.

3. **Handlers object and dispose flags.**
   - **`openArtboardPanel.ts`.**
     - Export `type ArtboardPanelHandlers = { onVisible: () => void; onFramePlace; onEditRequest; onHistoryRequest; onCommentRequest; onPageRequest }`. All keys are required; each request handler is `(value: unknown) => void`.
     - Add `export const setArtboardPanelHandlers = (next: ArtboardPanelHandlers): void` and one `let handlers: ArtboardPanelHandlers | undefined` slot. These replace the five setters and five slots.
     - Calls go through `handlers?.onX(message)`. Routing order is unchanged: `isArtboardHistoryAttempt` goes to `onHistoryRequest`, `isArtboardEditAttempt` to `onEditRequest`.
     - Export the type only if `extension.ts` annotates with it, otherwise keep it local.
   - **`extension.ts`.** One `setArtboardPanelHandlers` call. The `isArtboardHistoryAttempt` import and the ternary go.
   - **`chromeMessages.ts`.** The "It shares the edit route." comment on `isArtboardHistoryAttempt` goes.
   - **`watchArtboardDisk.ts`.** Remove `watcherDisposeHooked` and export `disposeArtboardWatcher`. `activate` pushes `{ dispose: disposeArtboardWatcher }` right after the output channel, before any `await`. `disposeArtboardWatcher` is a no-op when no watcher exists. This also re-hooks the dispose after a deactivate / activate in one host (the old flag never reset).
   - **`registerVibeboardMcp.ts`.** Remove `mcpDisposeHooked`. `provideVsCodeServer` pushes `{ dispose: () => { vsCodeProvider = undefined; } }` in the same `context.subscriptions.push` as the provider. That push runs once per activation, only while `vsCodeProvider` is unset.

   Done when:
   - `registerVibeboardMcp.test.ts` passes, including `deactivate, then activate in the same host registers a fresh provider` (2 provider registrations).
   - `grep -rn "DisposeHooked\|setArtboardPanelOn" src` is empty.
   - `pnpm exec vp check` is clean.

4. **Docs and Verify.**
   - Rule 05:
     - host catalog: `panelRequest.ts` is the one panel request preamble (`panelRequest`, `checkedPanelMessage`);
     - `openArtboardPanel.ts` names `setArtboardPanelHandlers`;
     - disk catalog: `comments.ts` writes go through its one write shell.
   - Change the `openArtboardPanel.ts` comment "Each handler gets every attempt raw" to describe the object.
   - System map: no flow or message-table change (log scopes are not in it). `/complete` refreshes its "Last verified" line.
   - At `/complete`:
     - the 11b lines in `blueprint/build-plan.md` and `project-overview.md` drop the MCP-wrapper item ("shipped in 10c as `runOnOpenPage`") and name `panelPages` in the preamble;
     - the Notion quality-pass note gets the same change, after Bombic's yes.

   Done when:
   - `pnpm verify` passes.
   - `rg "commentRequestId|pageRequestId|checkedWorkspaceRoot" src` is empty.

## Files / areas

- `src/disk/comments.ts`
- `src/host/panelRequest.ts` (new), `src/host/panelEdit.ts`, `src/host/panelComments.ts`, `src/host/panelPages.ts`, `src/host/artboardDisk.ts`, `src/host/chromeMessages.ts` (+ `chromeMessages.test.ts`), the host tests named in step 2
- `src/panel/openArtboardPanel.ts`, `src/extension.ts`, `src/host/watchArtboardDisk.ts`, `src/mcp/registerVibeboardMcp.ts` (+ test)
- `.claude/rules/05-single-job.md`
- At `/complete`: `blueprint/build-plan.md`, `blueprint/context/project-overview.md`

## Data / contracts

No wire, disk or MCP contract changes. These stay exactly as today:

- **Requests.** Every chrome request with a valid `requestId` is answered once; one without is logged only, with no refresh. The refusal copy and the check order (requestId, trust, folder, parse) are today's.
- **Comments.**
  - Argument checks run before the lock and the comments read; `addComment` keeps ownership, then validation, then the artboard read.
  - When `comments.json` is missing, no lock is taken and nothing is written: reply, status and resolve throw `CommentNotFoundError`, mark-sent returns `[]`, and add reads an empty file.
  - A no-op status change or a mark-sent with nothing marked writes nothing.
  - One lock per op, never taken inside another.

Only log output changes:

| Case | Log scope |
|------|-----------|
| No claimed type (comment / page) | `panelComments.answer` / `panelPages.answer`, as today |
| Claimed type, no valid requestId (all four `answer*`) | the per-type scope (new for `page:*`; others as today) |
| `frame:place` untrusted / no folder | `artboardDisk.placeFrame` (new log line) |

## Testing

- **Unit (Vitest).** The existing tests guard this refactor, since behavior is unchanged. The no-requestId and `afterRefuse` paths are already covered through the real handlers: `panelPages.test.ts` and `panelComments.test.ts` assert no answer and no refresh. So there is no separate `panelRequest.test.ts`.
- **Mock targets.** `vi.mock` targets stay on the same modules (`hostFs`, `openArtboardPanel`, `vscode`).
- **Browser tests.** None: chrome is untouched.
- **Manual.** The panel routing in `openArtboardPanel.ts` has no unit test, because it needs a real webview. `/check` can run a manual F5 smoke: drag a frame, edit and undo a field, add and copy a comment, open and rename a page.
- **Final.** `pnpm verify`. Baseline on `main` (ec14b80) before this work: pass, 73 files, 879 tests.

## Notes for the AI

- The preamble is panelEdit's `refuser` and `checkedWorkspaceRoot`, generalized, plus the parse step. Do not add a third layer.
- `ChromeMessage` comes from `src/webview/hostMessages.ts` (`import type`).
- `changeCommentsFile` stays private to `comments.ts`. Tests go through the five ops, never the shell.
- Lint: arrow functions, object arguments for 3+ parameters, no thrown literals, no `as` on wire unions.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":15887,"specSha256":"c4e4c4ad86183f24f7a1b2a766360d1b636f3d0937853c307d877b884a548d74","branch":"refs/heads/feature/host-dedupe","head":"ec14b80e23ef3d86dff9a2a304e26f5e24614b54","baseRef":"refs/heads/main","baseCommit":"ec14b80e23ef3d86dff9a2a304e26f5e24614b54","sourceTree":"d030fd8d9003b569c85fb5f6c3f8117d16056565","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11b/F-39 [P3] closed - Nothing tests which handler each chrome request type reaches

**File:** src/panel/openArtboardPanel.ts:107
**Found:** 2026-11-27 by /audit (scope: current; lens: tests)
**Why it matters:** 11b moved the edit vs history split from `extension.ts` into the panel's routing (`onHistoryRequest` / `onEditRequest`). No unit test covers the routing, before or after: swapping the two handlers passes Vitest. The routing is correct today (one `type` per message). Pre-existing gap, made more visible by this change.
**Suggested fix:** one small `openArtboardPanel.test.ts` that opens the panel over a mocked `vscode` and asserts each claimed request type reaches exactly its handler. No requirement lost.
**Resolution:** 2026-11-27 /implement: added `src/panel/openArtboardPanel.test.ts` (one test: frame:place, artboard:edit, artboard:history, comment:reply, page:open each reach only their handler; artboard:ready and an unknown type reach none). Probe: routing history to `onEditRequest` fails it. Closed 2026-11-27 by /audit re-review (Sonnet 5.5): real routing exercised; four swap / drop probes all fail the test; no new defect; full suite 74 files, 880 tests.

## Try it now

Behavior is unchanged, so there is nothing new to see. Optional F5 smoke in the Extension Development Host: drag a frame, edit a field and undo it, add a comment and Copy it, open and rename a page. Each should work exactly as before.
