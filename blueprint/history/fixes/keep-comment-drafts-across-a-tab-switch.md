# Fix: Keep comment drafts across a tab switch

**Type:** Fix
**Status:** verified (2026-11-18, agent-run)
**Branch:** `fix/keep-comment-drafts-across-a-tab-switch`
**Create-from:** local `main` at `ef28a21`.

**Found:** 2026-11-18, Bombic's hand check during 8i (`blueprint/history/features/08i-verify.md`, Results › Manual). Bombic does not want to test manually: agents prove it with unit and browser tests.

## The problem

Cursor destroys the webview when its tab is hidden and rebuilds it on return (we use `getState` / `setState`, not `retainContextWhenHidden`, rule 07). The chrome saves only `stageView` and `commentsPanelOpen` (`src/webview/hostBridge.svelte.ts`). Everything else is lost on a tab switch:

- the open pin thread (`openThreadId` in `App.svelte`);
- the Add-comment popover and its typed text (`draft` in `App.svelte`; `body` local to `CommentPopover.svelte`), and Comment mode itself (`picking.commentMode`);
- any reply being typed in a thread or a panel card (`actions` › `CommentAction.reply` in `App.svelte`).

Typed text disappearing is the real harm. Separately, 8i found that Alt+click picking the parent (a Notion 0.3 done-when) has no committed test.

## The fix

Extend the one saved webview state record with the comment UI state, reading it through a parser and restoring each item only once the thing it points at exists again. The saved value of each key is always **the live value, or the held (waiting) restore value while one is held**. It is written from one `$effect`, so closing, cancelling, a successful add or a dropped restore removes the key too.

### Contract

```ts
// src/webview/hostMessages.ts (beside parseSavedStageView)
export type SavedCommentUi = {
	commentMode: boolean; // missing or non-boolean → false
	commentDraft?: CommentDraft; // never has pendingRequestId or error
	openThreadId?: string;
	replyDrafts: Readonly<Record<string, string>>; // comment id → reply text; '' = composer open, empty
};
export const parseSavedCommentUi = (state: unknown): SavedCommentUi;

// src/webview/hostBridge.svelte.ts: replaces nothing; the existing saves keep working
export const readSavedCommentUi = (): SavedCommentUi;
export const saveCommentUi = (ui: SavedCommentUi): void;
```

- **`CommentDraft` gains `body: string`** (`src/webview/commentPopover.ts`), so the text lives and dies with the draft by construction. `draftFromPick` keeps `body` on a retarget (a user pick while a draft exists, in this frame or another) and starts `''` for a new draft. `CommentPopover.svelte` takes the draft's `body` and an `oninput` callback (like `Composer`). App updates `draft.body` through a small rule (for example `editDraftBody`); a pending draft ignores edits, the same as today's read-only pending composer.
- **Parse rules** (rule 04; never cast). Each key is checked on its own, and a bad key is dropped without affecting the others:
  - `commentMode`: `true` only when the value is exactly `true`.
  - `commentDraft`:
    - `frameId` must be a non-empty string, matching what `parseHostMessage` accepts for `canvas:updated` frame ids. It is only ever compared against live frame ids (`resolveHeldDraft`), so no pattern is needed, and zod-based `src/disk/parse.ts` stays out of the chrome.
    - `generation` must satisfy `Number.isSafeInteger(value) && value >= 0`.
    - `target` goes through a new exported `parsePickFields(record)` in `src/webview/frame/frameMessages.ts`. It holds the field guards `parseFramePick` uses today (selector, tagName, text, rect, point, box, styles, isPage, page-pick rule), minus `type` and `repost`. `parseFramePick` calls it, so there is no twin guard.
    - `body` must be a string of at most `MAX_COMMENT_BODY_CHARS` (`src/disk/layout.ts`). Over the cap drops the draft; nothing is truncated.
    - Any other field (`pendingRequestId`, `error`) is ignored.
  - `openThreadId`: a string matching `COMMENT_ID_PATTERN`.
  - `replyDrafts`: must be a plain JSON object (`Object.getPrototypeOf(value) === Object.prototype`). It is rebuilt entry by entry: keep an entry when its key matches `COMMENT_ID_PATTERN` and its value is a string of at most `MAX_COMMENT_BODY_CHARS`, and keep at most the first `MAX_COMMENTS` entries. Bad entries are dropped one by one.
  - Both `commentDraft` and `openThreadId` present: the draft wins and `openThreadId` is dropped (pins are `inert` while a draft exists).
- **Saving.** One `$effect` in App computes `SavedCommentUi` from the live state plus the held state and calls `saveCommentUi`. That function:
  - passes `$state.snapshot(...)` (a deep `$state` proxy throws on clone);
  - writes JSON-plain values only (a plain object for `replyDrafts`, never a `Map`);
  - **omits a key when it is the default** (`commentMode` false, no draft, no thread, empty `replyDrafts`), and deletes keys that became default;
  - keeps every other key (`stageView`, `commentsPanelOpen`). The existing `saveStageView` / `saveCommentsPanelOpen` already spread the record, so they keep the new keys.

  A pending draft is not saved (key omitted). A reply is not saved while its own reply request is pending (`replyPending`); a status or copy request on that comment does not stop its reply text from saving. It saves on every keystroke, with no debounce: `setState` is cheap, and a debounce would race the tab hide.

  Add a `ponytail:` comment at the save naming the ceiling: text whose add or reply was in flight when the tab hid is not restored, because the host never replays an answer (`postAnswer`). If that request failed, the text is gone. If it succeeded, the comment or reply arrives via `comments:updated`.
- **Held state** (separate from live state, so the existing live rules never see it):
  - `heldDraft: CommentDraft | undefined` and `heldThreadId: string | undefined` in App, set from `readSavedCommentUi()` at init. `picking.commentMode` starts from `commentMode`. Frames get `cd:mode` through the existing send on `cd:ready`.
  - `replyDrafts` go straight into `actions` at init as `{ reply: text }`. The existing `keepLiveActions` on `comments:updated` drops unknown ids.
  - **Draft rule** in `commentPopover.ts`: `resolveHeldDraft({ held, commentMode, frames }): { draft?: CommentDraft }`, called in the `canvas:updated` handler. On the **first** `canvas:updated` after load, it returns the draft when `commentMode` is true and `liveIframeIds(frames).has(held.frameId)` (an iframe frame, not a tile). Either way the hold ends there. A user pick, a mode toggle or opening a thread before then also drops `heldDraft`.
  - **Thread rule** in `pins.ts`: `resolveHeldThread({ held, pins, comments, liveFrameIds, anchorAnswered }): 'open' | 'hold' | 'drop'`. It runs in the existing `$effect.pre` beside `keepOpenThread`, and checks in this order:
    - **open** when `pins` has the held id;
    - **drop** when comments are known (a `comments:updated` without `error` arrived) and the id is missing;
    - **drop** when frames are known and the comment's frame is not a live iframe;
    - **drop** when that frame has already answered anchors for the id (`anchorAnswered`, from the anchor state) and no pin was placed (target missing or scrolled out);
    - **hold** otherwise.

    A user pick, a draft opening or a user thread open drops `heldThreadId`. These drop rules apply only to the held id and never change live thread behavior (out of scope).
- **Focus.** A restored item takes focus only when `document.hasFocus()` and `document.activeElement` is `null` or `document.body`, so it never steals focus from something the user is already typing in.
  - Thread: `CommentThread.svelte` gains a prop `focusOnOpen: boolean` (default `true`); App passes the gate result for a restored thread.
  - Popover: App calls the existing popover focus path for a restored draft under the same gate, then puts the caret at the end (`setSelectionRange(length, length)`).
- **Harness matches Cursor.** VS Code's webview `setState` serializes the state as JSON. Change the harness `getState` / `setState` (`tests/browser/harness.ts`) from `structuredClone` to a JSON round trip, so a `Map`, `undefined` or proxy bug shows up in tests the same way it would in Cursor. Move the `savedRecord` / `savedState` helpers from `commentsPanel.spec.ts` into `harness.ts` (rule 09: shared helpers live there).
- **Must not break:**
  - the existing `stageView` / `commentsPanelOpen` round trip, including the strict `toEqual` in `commentsPanel.spec.ts › the panel toggle keeps the saved view …`, which passes unchanged because default keys are omitted;
  - the draft's live rules (retarget keeps text, leaving Comment mode discards the draft, Escape cancels, a frame that left or became a tile drops it);
  - `keepOpenThread`;
  - the copy and reply one-request rules;
  - Parent / Child stay disabled after a restore until a new pick (`canStep` false);
  - a stale `generation` still reaches the host, which answers with the existing pick-outdated `ui:error` and keeps the text.

### Alt+click test

Add to `tests/browser/picking.spec.ts`: `Comment mode: Alt+click picks the parent, and ↓ returns to the child`. It reuses that file's helpers `openPickingStage`, `toggleComment`, `revealChangeButton`, `picksOf`, `nextPickSelector`, `resolvesTo`, `pickInFrame` and `centerOf`. Steps:

1. Open the stage and turn Comment mode on. Reveal `#change-button` and take `point = centerOf(button)`. Record `count = (await picksOf(page, 'a')).length`.
2. `page.mouse.move(point)`, then `keyboard.down('Alt')`, `mouse.click(point)`, `keyboard.up('Alt')`. Expect `resolvesTo({ selector: await nextPickSelector(page, count), expected: 'parent' })` to be true.
3. Press `ArrowDown`. Expect `resolvesTo({ selector: await nextPickSelector(page, count + 1), expected: '#change-button' })` to be true.
4. Control: `pickInFrame({ frameId: 'a', point })`. The last pick's `tagName` is `button`.

## Out of scope

- `retainContextWhenHidden`.
- Saving scroll positions, hover, the frame's pick or pick path, banners, the copy feedback, errors or pending requests.
- Changing when drafts or threads open or close in a live session.
- Any host, MCP or disk change.

## Build steps

- [x] **1. Parser and rules (pure, unit-tested)**
  The pieces:
  - `parsePickFields` (export plus the `parseFramePick` refactor);
  - `body` on `CommentDraft`, with `draftFromPick` keeping it and an edit rule;
  - `parseSavedCommentUi`, `resolveHeldDraft` and `resolveHeldThread`.

  Tests in `src/webview/hostMessages.test.ts`, `src/webview/frame/frameMessages.test.ts` (existing pick cases still pass through the refactor), `src/webview/commentPopover.test.ts` and `src/webview/pins.test.ts` cover:
  - round trip;
  - each malformed key dropped alone (non-object state, wrong types, over-cap body, bad `frameId`, a negative or fractional `generation`, bad target fields, `pendingRequestId` and `error` ignored, a bad thread id);
  - `replyDrafts` entries dropped one by one (bad id, over-cap value, non-string), the `MAX_COMMENTS` cap, and a non-plain object dropped;
  - draft wins over thread;
  - a retarget keeps the body and a new draft starts empty, and a pending draft ignores edits;
  - `resolveHeldDraft`: restored, dropped when the frame is missing or a tile, dropped when `commentMode` is false;
  - `resolveHeldThread`: each branch.
  **Done when:** `vp test` passes on those files, and one case per new rule fails with that rule's key line removed (mutation-checked).

- [x] **2. Wire save and restore in the chrome**
  - `hostBridge.svelte.ts`: `readSavedCommentUi` / `saveCommentUi`.
  - `App.svelte`: held state, the one save `$effect`, the `canvas:updated` and `$effect.pre` hooks, user actions dropping held items, and the focus gate.
  - `CommentPopover.svelte`: `body` and `oninput` props.
  - `CommentThread.svelte`: `focusOnOpen` prop.
  - Update the rule 05 owner catalog: the new helpers and saved keys; "each keep the other key" becomes "each keeps the other keys".

  Run Svelte MCP `svelte-autofixer` until clean on every touched `.svelte` / `.svelte.ts` file (rule 08).
  **Done when:** `svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings`, `pnpm run check` and `vp test` pass, and `pnpm test:browser` still passes its existing tests (after the harness JSON change).

- [x] **3. Browser tests (a harness reload with the saved state = a tab switch)**
  Use `openHarness(page, { state: await savedState(page) })` as the reload.
  1. **Thread:** an open pin thread is open again after reload. Post `comments:updated` before `canvas:updated`.
  2. **Draft:** Comment mode on, Add-comment popover with typed text. After reload, the mode is on, the popover is on the same target, the text is intact, the textarea is focused and the caret is at the end. Enter posts one `comment:create` with that body. Post `canvas:updated` before `comments:updated`.
  3. **Replies:** a reply typed in a panel card and one in a pin thread both come back after reload.
  4. **Pending:** before Enter, `savedRecord` has `commentDraft` with the body. After Enter (no host answer), it has no `commentDraft`. After reload, Comment mode is on and there is no popover.
  5. **Frame gone:** the reloaded `canvas:updated` lacks the draft's frame. No popover, `pageerror` count 0, and no `comment:*` or `ui:error` traffic caused by the restore.
  6. **Double reload:** reload twice with no `canvas:updated` in between. The draft still comes back on a third load that posts the frame.
  7. **Cancelled:** a draft cancelled with Escape is not in `savedRecord` and does not come back.
  8. **Missing comment:** a held thread whose comment is missing from the reloaded `comments:updated` does not open.
  9. **No stray keys:** with no comment UI open, the saved record holds exactly `stageView` and `commentsPanelOpen`, and the existing strict test passes unchanged.

  Plus the Alt+click test in `picking.spec.ts`.
  **Done when:** all new tests pass, and tests 1, 2 and 3 each fail with their restore wiring removed (comment out the restore call, run, put it back; record the failure).

- [x] **4. Final gates**
  `pnpm verify`, `caffeinate -i pnpm test:browser`, `pnpm knip`. Record counts.
  **Done when:** all three exit 0 (knip was clean on `main` at `ef28a21`).

## Results

- **Step 1:** `vp test` on `hostMessages.test.ts`, `frame/frameMessages.test.ts`, `commentPopover.test.ts`, `pins.test.ts`: 4 files, 68 tests pass. Mutation-checked, each removal fails a test (13): `parsePickFields` page-label rule, `generation < 0`, body cap, thread id pattern, draft wins over thread, `replyDrafts` `MAX_COMMENTS` slice, `replyDrafts` plain-object check, `draftFromPick` keeps `body`, `editDraftBody` ignores pending, `resolveHeldDraft` live check, each of the three `resolveHeldThread` drop branches.
- **Step 2:** `svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings` 0/0 (124 files); `tsc -p tsconfig.webview-tests.json` ok; `pnpm run check` ok; `svelte-autofixer` clean on `CommentPopover.svelte` and `CommentThread.svelte`; `App.svelte` / `hostBridge.svelte.ts` no issues, advisory suggestions only (same kind as on `main`, plus the spec-mandated `$effect.pre` / save effect). Existing browser tests pass after the harness JSON change (124).
- **Step 3:** 10 new browser tests (spec tests 1–9 + Alt+click) pass. Restore-removed proofs: test 1 fails with `openThreadId = held;` removed, test 2 with `restoreHeldDraft();` removed, test 3 with the reply-drafts init replaced by `[]` (each: target element not found). The existing strict `the panel toggle keeps the saved view …` test passes unchanged.
- **Step 4:** `pnpm verify` exit 0 (41 files, 565 tests); `caffeinate -i pnpm test:browser` exit 0 (134 passed, 182 skipped gallery); `pnpm knip` exit 0.
- **Deviations (accepted by the parent, both found by the new tests):**
  1. `anchorAnswered` counts only once the stage has a committed view (`committedView !== undefined && liveAnchor(...) !== undefined`). Before that `layoutPins` places no pins at all, so in Cursor's order (`canvas:updated`, then `comments:updated`) an early anchor answer dropped a valid held thread. The rule's signature is unchanged.
  2. A restored draft's focus waits for the popover to mount: `restoreHeldDraft` sets a flag, and an `$effect` on the `popover` binding applies `canTakeFocus` and calls `focusBody(true)` (caret at end). The stage commits its view only after measuring, so an immediate call found no popover.
- **Bombic's follow-up (2026-11-18, same fix):** the comment composers start at a usable height: `rows={4}` for both the reply (`CommentCard.svelte`, was 2) and the Add-comment popover (`CommentPopover.svelte`, was 3); still resizable. `svelte-autofixer` clean on both. Re-run: `pnpm verify` exit 0 (565), `pnpm test:browser` exit 0 (134 passed, 182 skipped).
- **Known leftovers (P3, not fixed):** the `focusRestoredDraft` flag can stay true when a restored draft is dropped before its popover mounts; the next mount re-checks `canTakeFocus`, so it is harmless. A held thread can still drop early if its frame answers anchors before `cd:frame-height` while the target lies below the provisional height (narrow timing window, not hit by tests).

## Verify

All agent-run: unit tests (step 1), browser reload tests (step 3), and full gates (step 4). No manual step. Optional for Bombic: switch tabs with a comment half-typed and see it come back.

## Notes for the AI

- `/complete` updates `blueprint/context/system-map.md`: the webview-state node (`stageView, commentsPanelOpen`) and the Panel-state note gain the four keys.
- Svelte edits: prefer the `svelte-file-editor` agent; run `svelte-autofixer` until clean.
- `generation` is a number on `CommentDraft`; keep it that way in the saved shape.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":17761,"specSha256":"db3b94f6c85582e435d37ace0f4d5bbe0fd5c1d5c947652786ca54b5d5cbf0b5","branch":"refs/heads/fix/keep-comment-drafts-across-a-tab-switch","head":"ef28a21fce0edee5a1a26927204def744ce66687","baseRef":"refs/heads/main","baseCommit":"ef28a21fce0edee5a1a26927204def744ce66687","sourceTree":"bd287dd7a9fa2430d8318a575f19725686f9ef63","landing":"local-merge","absentOptional":[]} -->
