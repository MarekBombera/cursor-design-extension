# Feature: Comments module

**From build-plan:** feature 11e2
**Build attempt:** 1
**Branch:** feature/comments-module
**Status:** verified (Steps 1-7 done; `pnpm test:browser` 232 passed; `pnpm verify` 75 files, 927 tests)

## Goal

Build the five candidates Bombic picked from the 11e1 report (`blueprint/reference/11e-comments-review.md`, section Picks, 2026-11-27): C1, C2, C3 (its missing browser guard first), C4 variant (a) and C5. Each narrows a seam between `DesignPage.svelte` and the comments classes (`CommentsState`, `PinThread`, `CommentPicker`) or their views. No merge into one comments module (the report's answer to the plan's question is "no"). Behavior unchanged: every existing unit and browser test passes unedited, except the views' prop types in C4a, which no test names.

## In scope

Each item's evidence and `file:line` citations are in the report's Candidates section; this spec fixes the contract. Line numbers below are at `f0991e7`.

### C1. One answer entry on `CommentsState` [Strong]

- `commentsState.svelte.ts`: new public `handleAnswer = (answer: CommentSavedMessage | CopiedMessage | UiErrorMessage): void`. Its body inlines today's two methods, in today's order: first the action step (`answerAction`, then `#showCopied({ kind: 'comment', … })` for a `copiedId`, then `#announce`), then, unless `answer.type === 'comment:saved'`, the copy-open step (`answerCopyOpen`, `#showCopied({ kind: 'open', … })` for a `copiedCount`, `#announce`). The live region and "Copied" order do not move.
- `handleActionAnswer` and `handleCopyOpenAnswer` are deleted (inlined; no private copy kept).
- Skipping copy-open for `comment:saved` is an equivalence, not a behavior change: request ids are UUIDs and never cross-match (`DesignPage.svelte:120-121`), so today's code never routes a `comment:saved` to copy-open, and the step would be a no-op if it ran. No test can tell the two apart; none is added (`CommentsState` has no unit test; rule 09 does not ask for one here).
- The three identical "set `actions`, post the message if any" tails (`commentsState.svelte.ts:130-133`, `:146-149`, `:159-162`) become one private `#send = (submitted: { actions: CommentActions; message?: PageFree<Exclude<CommentRequestMessage, CommentCreateMessage>> }): void` (the `#post` port's parameter type: the `submit*` rules return an optional message without `pageId`). `handleCopyOpen` (sets `copyOpen`, not `actions`) keeps its own tail.
- `DesignPage.svelte` `handleHostMessage`: `ui:error` calls `comments.handleAnswer(message)` once (between `picker.handleCommentAnswer` and `edit.handleEditAnswer`, as today); `comment:saved` and `ui:copied` share one branch that calls `comments.handleAnswer(message)`. No change in `commentActions.ts` or its test.

### C2. Drop the dead held-draft paths, privatize unused members [Strong]

- Fact this item relies on (the report's deletion test): a held draft reaches `CommentPicker` only through `nextPageStart` (`pageStart.ts:48-55`), whose `canvas` parameter is required, so every start that carries a held draft also carries its canvas (the `PageStart` type marks `canvas?` optional only for App's `''` start, which has no held draft). `DesignPage` applies that start canvas in its own script (`DesignPage.svelte:217-219` → `applyCanvas` → `picker.restoreHeldDraft()`), which clears the hold unconditionally. So after construction the hold is always empty. Step 2 re-checks this before deleting anything.
- `commentPicker.svelte.ts`: `heldDraft` becomes a private plain field `#heldDraft: CommentDraft | undefined`. The constructor keeps its `heldDraft` argument and assigns it plainly (`this.#heldDraft = heldDraft`; today's `$state.raw(heldDraft)` wrapper goes: after this change nothing reads it reactively). `restoreHeldDraft` stays (still called from `applyCanvas`; D3 was not picked) and reads and clears `#heldDraft`.
- Delete the clears that never see a value: `#setMode` (`commentPicker.svelte.ts:173`) and the draft clear in `#applyPickToDraft` (`:250`).
- `DesignPage.svelte`: `savable` returns `draft: picker.savedDraft`; delete the `handlePinOpen` wrapper (`:204-208`) and its comment; `Pins` gets `onOpen={pinThread.handlePinOpen}`.
- `pinThread.svelte.ts`: `anchors` and `flash` become private (`#anchors`, `#flash`), keeping `$state.raw`. No reader outside the file (report Map).

### C3. One draft-pick entry on `PinThread` [Worth exploring]

- **Guard first (Step 1):** a browser test that fails if a user pick during a held thread stops cancelling the restore. No such test exists today (report C3, "Missing guard").
- `pinThread.svelte.ts`: new public `handleDraftPick = ({ userPick, draftOpen }: { userPick: boolean; draftOpen: boolean }): void`. When `userPick`, it clears the held thread; when `draftOpen`, it closes the open thread implicitly (today's `closeThreadImplicitly` body: focus inside the thread moves to the stage viewport).
- `CommentPicker.#applyPickToDraft`: after C2 its `if (!pick.repost)` block holds only `this.#pinThread.heldThreadId = undefined`, and its `if (this.draft !== undefined)` block only `closeThreadImplicitly()`. C3 deletes both blocks and calls `this.#pinThread.handleDraftPick({ userPick: !pick.repost, draftOpen: this.draft !== undefined })` once, right after `draftFromPick` and before the `requestAnimationFrame` focus. Today's held-thread clear runs before `draftFromPick`; `draftFromPick` is pure and reads no `PinThread` state, and no effect runs in between, so moving the clear after it changes nothing.
- `closeThreadImplicitly` becomes private (`#closeThreadImplicitly`); its other caller is `PinThread`'s own `$effect.pre`.
- `heldThreadId` becomes private `#heldThreadId: string | undefined = $state()` (still reactive: the `$effect.pre` reads it), set from the constructor argument. `handlePinOpen` still clears it. New public getter `savedThreadId` returns `this.openThreadId ?? this.#heldThreadId`, like `savedDraft` and `savedReplyDrafts`. `DesignPage` `savable` uses `threadId: pinThread.savedThreadId`.
- `CommentPicker` keeps mode, hover, pick and the draft; `EditState` still reads `picker.picking` and imports `isTextEntry`.

### C4 variant (a). Card callbacks without per-id rebinding [Worth exploring]

- `CommentCard.svelte` `Props`: `onJump?: (id: string) => void`, `onReplyOpen`, `onReplyCancel`, `onReplySubmit`, `onToggleStatus` and `onCopy` take `(id: string)`; `onReplyInput` takes `(id: string, text: string)`. The card passes `comment.id` where it calls them today: in `openComposer` (`onReplyOpen`), `closeComposer` (`onReplyCancel`), `handleCopy` (`onCopy`), `handleStatus` (`onToggleStatus`), `handleComposerKeydown` (`onReplySubmit`), and the template's `Composer` `oninput={(text) => onReplyInput(comment.id, text)}` and `onsubmit={() => onReplySubmit(comment.id)}`.
- `TargetRef`: `onjump={onJump === undefined ? undefined : () => onJump(comment.id)}`, so it still gets `undefined` when `onJump` is `undefined`, and `data-cd-focus` and the chip's presence do not change.
- `copied` becomes `copied: CopiedButton | undefined` (the chrome's one feedback value, imported from `commentActions.ts`). The card adds `const copiedHere = $derived(copied?.kind === 'comment' && copied.id === comment.id);` and uses `copiedHere` everywhere it reads `copied` today (the Copy button, `:272-278`).
- `CommentsPanel.svelte`: passes its callback props and `copied` straight through to `CommentCard` (`onJump={item.canJump ? onJump : undefined}`, `onReplyOpen={onReplyOpen}`, … `copied={copied}`); its own `Props` types do not change.
- `DesignPage.svelte` `CommentThread`: `onReplyOpen={comments.handleReplyOpen}` and the other five likewise, `copied={comments.copyFeedback}`.
- `CommentThread.svelte` changes no code: its `Props` follow `CommentCard`'s through `ComponentProps` (`CommentThread.svelte:12`).
- Out: variant (b) (`comments.cardActions(id)`).

### C5. Jump view as a pure rule [Speculative]

- `pins.ts`: new exported `jumpView({ comment, live, frame, view, viewportWidth, viewportHeight }): StageView | undefined`, with `frame: Pick<FrameRecord, 'x' | 'y' | 'width' | 'height'>` and `view: StageView | undefined`. It returns `undefined` when `view` is `undefined` or either viewport side is `0` (today's guards at `pinThread.svelte.ts:207-209`); otherwise it is today's `jumpTarget` → `fitZoom` → `jumpStageView` body (`:213-232`), unchanged. `fitZoom` and `jumpStageView` are imported from `stageGeometry.ts` (the one fit-zoom rule stays there).
- `PinThread.handleJump`: find the comment, `this.#canvas.jumpFrame(comment)`, `jumpView(...)`; on `undefined`, return; else `commitStageView(view)`, then set the flash (commit before flash, as today). `pinThread.svelte.ts` drops its now-unused `fitZoom` / `jumpStageView` import.
- `flashOutline` keeps its own `jumpTarget` call (it needs only the outline).
- One test in `pins.test.ts` (Testing).

### Rule 08 catalog

In the same change: the `commentsState.svelte.ts` line names "the one comment-answer entry `handleAnswer`" (worded so it does not read as a twin of `PagesMenuState`'s page-answer `handleAnswer`, a different job); the `pins.ts` line names "the one jump-view rule `jumpView`". Nothing else in rule 08 moves (owners unchanged).

## Out of scope

- Every candidate not picked: C4 variant (b), C6 (focus predicates module), C7 (rename `CommentPicker`), D1 (stage focus handle off `PinThread`), D3 (fold the draft restore into `keepLiveState`), and all of Not proposed (N1-N12).
- Any behavior, look, focus, live-region or timing change; any message, disk, MCP, Agent skill, CSP or system-map change (none of the touched members appears in `system-map.md`).
- `canvasState.svelte.ts`, `editState.svelte.ts`, `App.svelte`, `pageStart.ts`, `savedState.ts`, `hostBridge.svelte.ts`, `harness.ts` and the frame runtime: unchanged. `PageSavable`'s shape is unchanged.
- Re-measuring the Baseline: 11e3 does it with the report's Method. 11e2 renames no instance or file, so no Method row changes.
- `Stage.svelte` and `Inspector.svelte` helpers (11e3).
- `blueprint/context/project-overview.md`'s 11e line ("fold … into one comments module?"): `/complete` refreshes it from the already-softened build-plan, not this item's steps.
- Gallery: no look changes.

## Build loop

`workflow.stepReview: feature` (one review at the end), `checkpointCommits: disabled` (`/complete` makes the one commit). Per step: make the change, run the step's narrow checks (`pnpm test`, `pnpm run check`, and for browser checks `vp build -c vite.webview.config.ts` then `playwright test -c tests/browser <spec> --grep "<test>"`, per `AGENTS.md` Agent test runs), confirm Done when, move on. One full `pnpm test:browser` at the end (Step 7). Every `.svelte` / `.svelte.ts` edit goes through `svelte-autofixer` until clean (rule 08; in Claude Code, delegate to `svelte-file-editor`). Probes: after reverting a probe, rebuild `dist` (`vp build -c vite.webview.config.ts`) before the next browser run, so no run tests the probe build.

## Build steps

1. [x] **C3 guard test.** In `tests/browser/pins.spec.ts`, next to "a pick in Comment mode closes the thread and opens the draft", add a test with these calls (pattern: `commentsPanel.spec.ts` "a restored thread whose comment is gone does not open, even when it comes back"); add `reload` and `savedRecord` to the file's `./harness` import; no new helper, no `harness.ts` change:
   1. `openPinStage(page, [THREADED, MOVER])`; `expectPinOn({ page, id: TITLE.id, selector: '#title' })`; `openThread(page, TITLE.id)`.
   2. Settle the save: `await expect.poll(async () => (await savedRecord(page)).openThreadId).toBe(TITLE.id)`.
   3. `reload(page)`; `postToChrome(page, canvasUpdated([FRAME]))`; `untilHeightReported(page, 'a')`. No `comments:updated` yet, so the thread is held (comments unknown). Prove the hold: `await expect.poll(async () => (await savedRecord(page)).openThreadId).toBe(TITLE.id)`.
   4. `clickChrome(commentButton(page))`; `await expect(commentButton(page)).toHaveAttribute('aria-pressed', 'true')`; pick `#doomed` as the existing test does (`frameElementBox` + `clickAt`); `await expect(popoverTarget(page)).toHaveText('Doomed')`; then `await expect.poll(async () => (await savedRecord(page)).openThreadId).toBeUndefined()` (catches the guard directly, without render timing).
   5. `postToChrome(page, { type: 'comments:updated', pageId: 'page-1', comments: [THREADED, MOVER] })`; settle the anchor chain: `await expect(pinOf(page, TITLE.id)).toBeVisible()`, then `nextAnimationFrame(page)`.
   6. Assert `await expect(thread(page)).toHaveCount(0)` and `await expect(popoverTarget(page)).toHaveText('Doomed')`.
   - Done when: the test passes on unchanged product code; with `commentPicker.svelte.ts:251` (`this.#pinThread.heldThreadId = undefined`) deleted as a probe (and `dist` rebuilt) it fails; the probe is reverted and `dist` rebuilt; `git diff --stat -- src tests .claude` lists only `tests/browser/pins.spec.ts`.
2. [x] **C2.** Re-check first: `grep -rn heldDraft src` shows a held draft produced only in `pageStart.ts` `nextPageStart` (plus its test and `DesignPage`/`CommentPicker` plumbing), and reading `nextPageStart` shows its `canvas` parameter is required and always returned. If either fails, stop and report (the deletion is no longer dead code). Then the C2 changes from In scope.
   - Done when: no code in `DesignPage.svelte` reads or writes `picker.heldDraft` (only the start destructure and the `CommentPicker` constructor argument name `heldDraft`); `pnpm run check` passes (svelte-check proves no outside reader of `heldDraft`, `anchors` or `flash` is left); `pnpm test` passes; the restore browser tests pass (`commentPopover.spec.ts` restore tests, `pages.spec.ts` "a reload that stages B restores B's thread even with a draft saved for A", `commentsPanel.spec.ts` restored-thread tests).
3. [x] **C3.** The C3 changes from In scope.
   - Done when: no code in `commentPicker.svelte.ts` or `DesignPage.svelte` references `heldThreadId` or `closeThreadImplicitly` except `DesignPage`'s start destructure and the `PinThread` constructor argument (comments aside); `pnpm run check` passes; the Step 1 test and `pins.spec.ts` "a pick in Comment mode closes the thread and opens the draft" pass; `pages.spec.ts` thread-restore tests and `commentsPanel.spec.ts` "a restored thread whose comment is gone does not open, even when it comes back" and "a tab switch reopens the open pin thread, even after a second switch before any canvas" pass.
4. [x] **C1.** The C1 changes from In scope.
   - Done when: `grep -rn 'handleActionAnswer\|handleCopyOpenAnswer' src` prints nothing; `pnpm run check` passes; `commentsPanel.spec.ts` Reply, Resolve, Copy and Copy open tests (including their error and "Copied" tests) pass.
5. [x] **C4a.** The C4a changes from In scope.
   - Done when: `grep -nE '=> (on[A-Z]\w+|comments\.handle\w+)\((id|openComment\.id)' src/webview/CommentsPanel.svelte src/webview/DesignPage.svelte` prints nothing; `pnpm run check` passes (svelte-check covers the prop types); `commentsPanel.spec.ts` and the thread tests in `pins.spec.ts` pass.
6. [x] **C5.** `jumpView` in `pins.ts`, its test in `pins.test.ts`, `handleJump` through it.
   - Done when: the new test passes; under a probe that passes `fitZoom: undefined` to `jumpStageView` inside `jumpView` it fails (zoom stays 1), probe reverted; `pnpm run check` passes; `pins.spec.ts` jump tests pass.
7. [x] **Close.** Rule 08 catalog lines; full `pnpm test:browser` once; `pnpm verify`.
   - Done when: `pnpm verify` passes (75 test files, 927 tests: 926 plus the `jumpView` test); the full browser run passes with gating tests 231 → 232 (the Step 1 test) and no other count change; `git diff --stat -- src tests .claude` lists only the files in Files / areas.

## Files / areas

- `src/webview/commentsState.svelte.ts` (C1)
- `src/webview/commentPicker.svelte.ts` (C2, C3)
- `src/webview/pinThread.svelte.ts` (C2, C3, C5)
- `src/webview/DesignPage.svelte` (C1, C2, C3, C4a)
- `src/webview/CommentCard.svelte`, `src/webview/CommentsPanel.svelte` (C4a)
- `src/webview/pins.ts`, `src/webview/pins.test.ts` (C5)
- `tests/browser/pins.spec.ts` (Step 1)
- `.claude/rules/08-svelte-chrome.md` (catalog lines)

## Data / contracts

No wire, disk or saved-state change. Chrome-internal interfaces after this item:

- `CommentsState`: `handleAnswer(answer: CommentSavedMessage | CopiedMessage | UiErrorMessage)` replaces `handleActionAnswer` and `handleCopyOpenAnswer`. `comment:saved` never runs the copy-open step. Private `#send` as in C1.
- `CommentPicker`: private plain `#heldDraft`; no public `heldDraft`; constructor arguments unchanged.
- `PinThread`: `handleDraftPick({ userPick: boolean; draftOpen: boolean })` and getter `savedThreadId: string | undefined` added; `#heldThreadId` (private `$state`), `#closeThreadImplicitly`, `#anchors`, `#flash` private; constructor arguments unchanged.
- `CommentCard` props: `onJump?(id)`, `onReplyOpen(id)`, `onReplyInput(id, text)`, `onReplyCancel(id)`, `onReplySubmit(id)`, `onToggleStatus(id)`, `onCopy(id)`; `copied: CopiedButton | undefined`. `CommentThread` follows through `ComponentProps`.
- `pins.ts`: `jumpView({ comment: PostedComment; live: LiveAnchor | undefined; frame: Pick<FrameRecord, 'x' | 'y' | 'width' | 'height'>; view: StageView | undefined; viewportWidth: number; viewportHeight: number }): StageView | undefined`.
- `PageSavable` (`DesignPage.svelte:7-13`) unchanged: `draft` is `picker.savedDraft`, `threadId` is `pinThread.savedThreadId` (same values as today's `heldDraft ?? savedDraft` and `openThreadId ?? heldThreadId`).

Expected interface counts (report Baseline method; 11e3 measures them): `CommentsState` public 23 → 22; `CommentPicker` 20 → 19; `PinThread` 20 → 18 (−`anchors`, −`flash`, −`heldThreadId`, −`closeThreadImplicitly`, +`handleDraftPick`, +`savedThreadId`).

## Testing

- **New browser test (Step 1):** a user pick during a held thread cancels the restore. Proven by the revert probe in its Done when.
- **New unit test (Step 6), `pins.test.ts`:** one `test()` using the file's existing `comment()` (stored `rect` 100 × 40 at 10, 20; no live answer), `frame()` (x 1000, y 500, 400 × 300) and `view` (`{ x: 0, y: 0, zoom: 1 }`):
  - `jumpView({ comment: comment(), live: undefined, frame: frame(), view, viewportWidth: 146, viewportHeight: 146 })` deep-equals `{ x: -457, y: -197, zoom: 0.5 }`. Derivation: the fit box is the stored rect, centered at stage (1060, 540); `fitZoom` = min((146 − 2·48) / 100, (146 − 2·48) / 40) = 0.5, below `view.zoom` 1 and above the 0.05 clamp; x = 73 − 1060 · 0.5, y = 73 − 540 · 0.5.
  - The same call with `view: undefined`, and with `viewportWidth: 0`, returns `undefined`.
- **Not tested, by design:** C1's `comment:saved` skip (an equivalence; see C1).
- **Unchanged guards (must pass unedited):** `commentsPanel.spec.ts`, `commentPopover.spec.ts`, `pins.spec.ts`, `pages.spec.ts`, `picking.spec.ts`, `editMode.spec.ts`, `pagesMenu.spec.ts`, `stage.spec.ts`, `theme.spec.ts`; all unit tests.
- No gallery run (no look change). No F5 (no Cursor-only behavior touched).

## Notes for the AI

- Read the report's C1-C5 entries before each step; they cite the code this spec changes.
- Svelte 5 private reactive class fields (`#heldThreadId = $state()`) are supported; confirm with `svelte-autofixer`.
- `handleDraftPick` must run synchronously inside `#applyPickToDraft`, before `requestAnimationFrame`: focus leaves the thread before the popover takes it.
- Keep `picker.restoreHeldDraft()` in `applyCanvas` and the construction order O1 (report N12, D3).
- Comments: rewrite only the comments the change makes untrue, and all of them: `commentPicker.svelte.ts:55-56` (the hold lives only until the start canvas this page applies in its own script; name the dependency: App's `stagePage` mounts a page together with its start canvas, so a page mounted without one would keep the hold and `savable` would no longer save it), `DesignPage.svelte:5-6` (`PageSavable`: `draft` is the live one; `threadId` the live or held one), `DesignPage.svelte:204` (goes with the wrapper), the `PinThread` field comments, `CommentCard.svelte:38` (`onJump` now takes the id) and `:46` (`copied` is the chrome-wide feedback; the card derives its own). No step narration.
- Do not touch `blueprint/reference/11e-comments-review.md`'s Baseline; 11e3 re-measures.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":20460,"specSha256":"54b196235cd4077ee071583acec789f90129f02dd7eb5e8db06468093dec9cd2","branch":"refs/heads/feature/comments-module","head":"f0991e7fd4160ca78e5a8bf867e25153ba027475","baseRef":"refs/heads/main","baseCommit":"f0991e7fd4160ca78e5a8bf867e25153ba027475","sourceTree":"edfd4e0978542e0fe28e822ada31bb762d2b752b","landing":"local-merge","absentOptional":[]} -->
