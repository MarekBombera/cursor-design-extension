# Feature: Comment mode + popover

**From build-plan:** feature 8f1
**Build attempt:** 1
**Branch:** `feature/comment-mode-popover`
**Status:** verified

## Goal

This feature covers these Notion done-when lines:

- "C toggles Comment mode; links and buttons don't fire in it".
- "Alt+click or ↑ selects the parent, ↓ goes back to the child; Enter, Shift+Enter and Esc
  behave as specified in the comment box".
- The first half of "Adding a comment writes comments.json". Pins are 8f2.

What it builds:

- `C` toggles Comment mode, from the chrome or from a focused frame.
- A user pick opens a popover anchored at the pick.
- Add writes the comment through the host into `comments.json` (8e `addComment`).
- The host posts the comment list to the panel with `comments:updated`, using the same ready /
  replay path as `canvas:updated`.
- A broken `comments.json` shows its own banner and never blanks the stage.

Sources:

- build-plan 8f1;
- `blueprint/reference/0.3-comments-plan.md`: 8f1, D3, the message contract and the error table;
- the Notion 0.3 page: the Comment mode contract and Done when.

Baseline: `main` at `fd193e5`, `pnpm verify` green (33 files, 396 tests). Spec revised by
`/feature-review-fix` after the dual review (both NEEDS-FIXES).

## In scope

1. **Mode keys.**
   - `C` toggles Comment mode and Escape leaves it.
   - The chrome handles them on its own keydown. The frame runtime forwards them as a new frame
     → chrome message `cd:key {key: 'c' | 'Escape'}`.
   - While the popover is open, the popover owns keys (see `modeKeyAction`).
   - Toolbar: the hint "Click to comment." shows in Comment mode. The Comment button gets
     `aria-keyshortcuts="c"` and the title "Comment (C)".
2. **User picks vs re-posts.** `cd:pick` gains two fields:
   - `repost: boolean`: false for a click, Alt+click or ↑/↓ step; true for a scroll or resize
     re-post (the runtime's existing `force` flag, inverted).
   - `box: {width, height}`: the target's unclipped border-box size, so the stored pin fraction
     is right for clipped targets.
3. **Popover** (`CommentPopover.svelte`, rules in `commentPopover.ts`).
   - A user `cd:pick` in Comment mode opens it, or retargets it if it is already open. A re-post
     only refreshes the open draft's geometry.
   - It holds:
     - a target chip;
     - Parent and Child buttons, moved here from the Toolbar;
     - the hint "↑ parent · ↓ child";
     - a textarea with `maxlength`;
     - Add comment and Cancel buttons;
     - one message line.
   - Its keys follow D3. It flips at the viewport edges.
   - Focus moves to the textarea on open, and back to the picked frame on close.
4. **Create path.**
   - Add sends `comment:create` to the host.
   - The host parses it, maps it to `NewComment` and calls `addComment`.
   - The host always answers once, never rejecting: `comment:added {requestId}` or
     `ui:error {requestId, message}`.
   - Typed text survives a failure, an Agent edit to the frame, and a retarget.
5. **Comments read path and replay.**
   - One helper, `postPanelComments`, reads `comments.json` and posts
     `comments:updated {comments, error?}`. It runs:
     - on every watcher refresh;
     - on panel open;
     - when the panel becomes visible;
     - after each successful create.
   - The message is held until `artboard:ready` and re-sent on webview reload
     (`createPanelOutbox`).
   - The read runs in its own try/catch. A corrupt or newer-version `comments.json` posts
     `{comments: [], error}` and the canvas still renders.
   - The chrome stores the list (8f2 draws pins from it) and shows `error` in a second banner
     line.
6. Same change: rule 02 message line, rule 05 owner catalog, and the 0.3 plan's message
   contract.

## Out of scope

- 8f2: pins, `cd:anchors` / `cd:anchor-rects`, and the per-comment `stale` / `targetMissing`
  flags on the wire. 8f1 renders no flag, and computing them on every refresh would run
  parse5 + css-select on the extension host thread (rule 07). 8f2 adds them together with its
  own cost decision.
- 8g: Comments panel, Reply, Resolve, Reopen, `comment:reply`, `comment:set-status`.
- 8h: Copy prompt, `comment:copy*`, `ui:copied`.
- Keeping a draft across a webview reload. Panel hide then show reloads the webview, and the
  frame and its pick reload too, so the draft has nothing to attach to.
- A pending-create timeout. The host always answers, and the Comment toggle always closes the
  draft.
- No MCP tool, error code, runtime limit or frame CSP change, so `skills/cursor-design/SKILL.md`
  is untouched.
- The system map is updated by `/complete`, not here.

## Build loop

- `workflow.stepReview: feature`: one review at the end of the feature, not per step.
- `workflow.checkpointCommits: disabled`.
- Per step: implement, run `pnpm verify` (it includes `svelte-check`), run
  `pnpm test:browser` for chrome steps, and confirm the step's Done when.
- Every `.svelte` / `.svelte.ts` edit follows rule 08: Svelte MCP `list-sections` /
  `get-documentation` before, `svelte-autofixer` after until clean.
- `/complete` makes the feature commit.

## Build steps

- [x] **1. Wire contract + host create and read paths (no visible UI).**
  - `hostMessages.ts`:
    - new types `PostedComment`, `CommentsUpdatedMessage`, `CommentAddedMessage`,
      `UiErrorMessage`, `CommentCreateMessage`, extending the `HostMessage` and `ChromeMessage`
      unions;
    - `parseHostMessage` parses the three new host → chrome messages.
  - `frameMessages.ts`: export the existing rect guard as `parseFrameRect`, for reuse.
  - `chromeMessages.ts`:
    - add `comment:create` to the zod/mini schema;
    - `isCommentCreateAttempt(value)`;
    - `commentCreateRequestId(value)`: a regex check on the raw `requestId`, usable when the
      full parse fails;
    - pure `toNewComment(message)`;
    - pure `toPostedComment(comment)`: an explicit field pick, never a spread;
    - header comment widened to "chrome ↔ host mapping".
  - `comments.ts`: export `readComments({workspaceRoot})`, which runs `assertLayoutDirsOwned`
    then `readCommentsFile`. No flags.
  - `artboardDisk.ts`: export `toSafeArtboardErrorMessage(error, fallback?)`. The default
    fallback stays the current copy.
  - `panelOutbox.ts`:
    - `postComments` caches the latest message and flushes it on ready, after the view and
      status;
    - `postAnswer` posts only while ready and never caches;
    - `reset` drops the cached comments.
  - New `src/host/panelComments.ts` (thin vscode glue; neither function ever rejects):
    - `postPanelComments({outputChannel})`;
    - `createCommentFromChrome({value, outputChannel})`.
  - `openArtboardPanel.ts`:
    - routes `comment:create` attempts to `setArtboardPanelOnCommentCreate`;
    - adds `postCommentsToPanel` and `postAnswerToPanel`.
  - Wiring:
    - `extension.ts` only wires the create handler;
    - `void postPanelComments(...)` goes next to each `postArtboardSnapshotToPanel` in
      `watchArtboardDisk.refreshWatchedArtboard`, `reloadVisibleArtboardFromDisk` and
      `handleOpenArtboard`.
  - `App.svelte` `handleHostMessage` branches on every new type *before* the `ui:status`
    fallthrough:
    - `comments:updated` stores `comments` / `commentsError`;
    - `comment:added` / `ui:error` are ignored until step 4.

    This prevents a false "MCP unavailable" banner.
  - `canvasFrames.ts`: `FrameRecord` / `StageFrame` carry `generation` from
    `PostedCanvasFrame`; `mergeCanvasFrames` copies it.
  - Rule 02 message line updated.

  **Done when:**
  - `pnpm verify` is green, with the step 1 unit tests listed under Testing.
  - `listComments` and the MCP contract tests are unchanged and pass.

- [x] **2. Comments banner.**
  - `Banners.svelte` gets a second always-mounted `role="alert"` line for `commentsError`. It is
    hidden when the value is undefined or `''`.

  **Done when:**
  - `pnpm verify` is green.
  - Browser test: a harness `comments:updated {comments: [], error}` shows the comments banner
    while both frames stay rendered.
  - A `canvas:updated` does not clear it.
  - A later `comments:updated` without `error` hides it.

- [x] **3. Mode keys and the `cd:pick` fields.**
  - `frameMessages.ts`:
    - `FRAME_KEY_MESSAGE = 'cd:key'`; `parseFrameMessage` accepts exactly
      `{key: 'c' | 'Escape'}`;
    - `cd:pick` gains `repost` (boolean) and `box` (finite `{width, height}`, each
      `0..MAX_FRAME_COORDINATE`);
    - a pick missing either field is rejected.
  - `commentPicking.ts`: `postPick` posts `repost: !force` and `box` from the target's
    `getBoundingClientRect()`. For a page pick, `box` comes from `documentElement`, the same box
    `pickPoint` uses.
  - `runtime.ts`: one capture `keydown` listener on `window` that posts `cd:key`.
    - It posts for `c` or `C` (sent as `'c'`) and for `Escape`, and never calls
      `preventDefault`.
    - It skips events with Ctrl, Meta or Alt held, `event.repeat`, and `event.isComposing`.
    - It also skips editable origins. The origin is `event.composedPath()[0]`, so a shadow-DOM
      input counts: `input`, `textarea`, `select`, or `isContentEditable`.
  - `commentPick.ts`:
    - pure `modeKeyAction` (contract below);
    - `clearPick(state)`, which drops the pick and returns a `cd:mode {comment}` send to that
      frame, so its path resets;
    - **delete `arrowPickStep`** and its tests. Arrows with chrome focus belong to the popover
      (step 4); without a popover there is no pick.
  - `App.svelte`:
    - `handleFrameMessage` branches on `cd:key` before the wheel fallthrough, and never touches
      `lastSinkGestureAt` for it;
    - the window keydown and `cd:key` both go through `modeKeyAction`, with `popoverOpen: false`
      until step 4;
    - `hasFrames` is `liveIframeIds(frames).size > 0`;
    - the ↑/↓ branch of `handleWindowKeydown` goes. The scroll-sink reset stays.
  - `Toolbar.svelte`: the hint, `aria-keyshortcuts` and title.
  - Update `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` on purpose (rule 09). The
    exported `canvas.html` embeds the runtime, so it gains the `cd:key` poster. That poster is
    harmless there: the preview controller accepts only `cd:frame-height` / `cd:frame-wheel`.

  **Done when:**
  - `pnpm verify` is green.
  - Browser tests:
    - `c` with chrome focus toggles Comment mode;
    - `c` with frame focus toggles it through `cd:key`;
    - `c` typed into a design `<input>` in Interact mode does not toggle;
    - Escape leaves Comment mode;
    - `c` with no live frames does nothing;
    - a click's `cd:pick` has `repost: false` and a scroll re-post has `repost: true`.

- [x] **4. Popover.**
  - New pure `commentPopover.ts`: `popoverKeyAction`, `popoverAnchor`, `placePopover`,
    `targetChipText`, `blockedTargetCopy` and the draft transitions (contracts below).
  - New `CommentPopover.svelte`, a view whose root is `role="dialog"` with
    `aria-label="Add comment"`. Props:

    ```
    {draft, anchor, viewportWidth, viewportHeight, canStep,
     onAdd(body), onCancel(), onParent(), onChild()}
    ```

    - `canStep` is true when a live pick exists for the draft's frame. After a frame reload it is
      false, and Parent and Child get `aria-disabled`.
    - The textarea value is component state.
  - `Stage.svelte` takes an optional `children` snippet rendered inside the viewport after
    `Overlay`. The popover root stops `pointerdown` and `wheel` propagation, so neither starts a
    stage pan or zoom.
  - The Toolbar chip and Parent/Child buttons move into the popover. They keep their accessible
    names "Select parent element" / "Select child element". The Toolbar keeps its live
    announcement region.
  - `hostBridge.svelte.ts`: `postCommentCreate` (with `$state.snapshot`).
  - App ties it together: draft state, routing of `comment:added` / `ui:error`, the close rules
    and the focus moves.
  - `picking.spec.ts`:
    - chip and Parent locators point at the popover;
    - the F-63 "↑/↓ with chrome focus" test targets focus inside the popover with an empty box;
    - expected `cd:pick` payloads gain `repost` and `box`.

  **Done when:**
  - `pnpm verify` is green.
  - `pnpm test:browser` is green with the popover tests listed under Testing.

- [x] **5. Docs + gate.**
  - Rule 05 owner catalog:
    - change the `toSafeArtboardErrorMessage` line from "private to" to exported, with its
      fallback parameter;
    - add `commentPopover.ts`, `modeKeyAction` / `clearPick` (and drop `arrowPickStep`),
      `toNewComment` / `toPostedComment` / `isCommentCreateAttempt` /
      `commentCreateRequestId`, `readComments`, `panelComments.ts`, `postComments` /
      `postAnswer`, `parseFrameRect`, `CommentPopover.svelte`.
  - Rule 02 message line final.
  - `blueprint/reference/0.3-comments-plan.md` message contract: `cd:key`, the `cd:pick`
    `repost` / `box` fields, `comment:create {requestId, …, body}`, `comment:added`,
    `ui:error {message, requestId?}`, and `comments:updated` without flags until 8f2.
  - Record the `dist/extension.js` size before and after in that plan file. The host now bundles
    `addComment`'s parse5 + css-select (8e recorded `dist/mcp.js` the same way).

  **Done when:**
  - `pnpm verify` is green.
  - `pnpm test:browser` is green.
  - The F5 checks under Testing are done and recorded by `/check`.

## Files / areas

- `src/webview/hostMessages.ts` (+test): types; `parseHostMessage` for `comments:updated`,
  `comment:added`, `ui:error`.
- `src/webview/frame/frameMessages.ts` (+test): `cd:key`, `cd:pick` `repost` / `box`,
  `parseFrameRect` exported.
- `src/webview/frame/commentPicking.ts`, `src/webview/frame/runtime.ts`: post `repost` / `box`;
  `cd:key` listener.
- `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap`: runtime source changes.
- `src/host/chromeMessages.ts` (+test): `comment:create`, `isCommentCreateAttempt`,
  `commentCreateRequestId`, `toNewComment`, `toPostedComment`.
- `src/disk/comments.ts` (+test): `readComments`.
- `src/host/artboardDisk.ts`: `toSafeArtboardErrorMessage` exported with a fallback.
- `src/host/panelOutbox.ts` (+test): `postComments`, `postAnswer`.
- `src/host/panelComments.ts` (new; vscode glue, no unit test per rule 09).
- `src/panel/openArtboardPanel.ts`, `src/extension.ts`, `src/host/watchArtboardDisk.ts`,
  `src/host/handleOpenArtboard.ts`: routing and call sites.
- `src/webview/commentPick.ts` (+test): `modeKeyAction`, `clearPick`; `arrowPickStep` removed.
- `src/webview/commentPopover.ts` (+test, new).
- `src/webview/canvasFrames.ts` (+test): `generation` on the record.
- `src/webview/App.svelte`, `Toolbar.svelte`, `Stage.svelte`, `Banners.svelte`,
  `CommentPopover.svelte` (new), `hostBridge.svelte.ts`.
- `tests/browser/picking.spec.ts` (locators, payloads, F-63);
  `tests/browser/commentPopover.spec.ts` (new; reuse `tests/browser/harness.ts`).
- `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`,
  `blueprint/reference/0.3-comments-plan.md`.

## Data / contracts

### Messages (new or changed in 8f1)

| Direction | Message | Payload |
|---|---|---|
| frame → chrome | `cd:key` | `{key: 'c' \| 'Escape'}` (untrusted; matched by `event.source` like every frame message) |
| frame → chrome | `cd:pick` (changed) | adds `repost: boolean`, `box: {width, height}` (unclipped border-box size, CSS px) |
| chrome → host | `comment:create` | `{requestId, frameId, generation, selector, tagName, text, rect \| null, point, box, styles, isPage, body}` |
| host → chrome | `comment:added` | `{requestId}` |
| host → chrome | `ui:error` | `{message, requestId?}` (8f1 always sets `requestId`; 8g/8h reuse it without) |
| host → chrome | `comments:updated` | `{comments: PostedComment[], error?}` |

**`comment:create`: host parser (zod/mini, untrusted).**

| Field | Rule |
|---|---|
| `requestId` | `/^[A-Za-z0-9_-]{1,64}$/` |
| `frameId` | string. `addComment` checks the id charset |
| `generation` | integer ≥ 0. `addComment` rejects anything below 1 |
| `selector` | 1..`MAX_SELECTOR_CHARS`, no control characters (`hasControlChars`) |
| `tagName` | `isTagName` |
| `text` | ≤ `MAX_PICK_TEXT_CHARS`, no control characters |
| `rect` | `null`, or finite with `x`, `y` within ±`MAX_FRAME_COORDINATE` and `width`, `height` in `0..MAX_FRAME_COORDINATE` |
| `point`, `box` | finite, each value in `0..MAX_FRAME_COORDINATE` |
| `styles` | record of strings. `addComment` drops unsafe keys and values |
| `isPage` | boolean |
| `body` | plain string. `addComment` owns the trim and the 1..`MAX_COMMENT_BODY_CHARS` rule and its copy |

Anything else fails the parse.

**`toNewComment` (pure).**

- `rect: isPage ? null : message.rect`.
- `pin.x = box.width > 0 ? clamp01(point.x / box.width) : 0`; `pin.y` is the same with
  `height`. It never reads `rect`, so a null rect gives no NaN and no throw.
- `generation`, `selector`, `tagName`, `text`, `styles`, `body` and `isPage` pass through.
- A non-page message with `rect: null` maps as is, and `addComment` rejects it. The chrome
  never sends one (`canSubmit`).

**`toPostedComment` (pure).** It picks exactly these fields from `Comment`, and nothing else:

```
{id, frameId, selector, tagName, text, rect | null, pin: {x, y}, body, isPage,
 status: 'open'|'sent'|'resolved', createdAt,
 replies: [{id, author: 'user'|'agent', body, createdAt}]}
```

`artboard`, `version`, `styles` and `targetFingerprint` never reach the chrome. The flags arrive
in 8f2.

**`createCommentFromChrome` (never rejects).**

- An outer try/catch wraps everything. Every failure is logged once with `logDiskError`
  (scope `panelComments.create`), then answered:

| Case | Answer |
|---|---|
| `commentCreateRequestId(value)` undefined | none, log only |
| untrusted workspace | `ui:error` with `UNTRUSTED_WORKSPACE_MESSAGE` |
| no folder | `ui:error` with the `NoWorkspaceError` message |
| malformed fields | `ui:error` "Could not add the comment. Pick the element again." |
| `addComment` throws, or anything unexpected | `ui:error` with `toSafeArtboardErrorMessage(error, 'Could not add the comment. Check the Output panel: Cursor Design.')` |
| success | `comment:added`, then `void postPanelComments(...)` |

- All answers go through `postAnswerToPanel`.
- Messages that reach the user this way:
  - `PICK_OUTDATED`: "This artboard changed since the element was picked. Pick it again.";
  - the `addComment` body rule: "Comment text must be 1 to 2000 characters.";
  - invalid fields;
  - the count cap;
  - artboard not found;
  - corrupt or newer-version `comments.json`;
  - `WORKSPACE_BUSY`;
  - disk errors.

  All of them are authored copy, with no stack and no absolute path.
- `addComment` stamps `id` (`randomUUID`), `createdAt`, `version` and the fingerprint (8e).

**`postPanelComments({outputChannel})` (never rejects).**

- Untrusted workspace or no folder: post `{comments: []}` without reading.
- Otherwise call `readComments`, then `{comments: comments.map(toPostedComment)}`.
- On a read error: `logDiskError` (scope `panelComments.read`), then post
  `{comments: [], error: toSafeArtboardErrorMessage(error, 'Could not read comments. Check the Output panel: Cursor Design.')}`.
- A missing `comments.json` gives `{comments: []}` with no error.
- Last read started wins: a module-level counter is taken before the read, and a read posts only
  if no newer one started meanwhile (the `watchGeneration` pattern).
- `ponytail:` no total payload cap: 500 comments × 100 replies × 2000 chars is the theoretical
  ceiling, the same as for `canvas:updated`.

**Outbox.**

- On `markReady`, flush order: view (`canvas:updated`, `artboard:error`), then `ui:status`,
  then `comments:updated`.
- `postAnswer` before ready drops the answer: the chrome that asked has reloaded and its popover
  is gone.

**Chrome parser rules (`hostMessages.ts`, DOM-free).**

- `comments:updated`:
  - a non-array `comments` rejects the whole message;
  - `error` must be a string when present, otherwise the whole message is rejected; an empty
    string is kept and Banners hides it;
  - each entry is validated field by field, reusing `isTagName`, `hasControlChars` and
    `parseFrameRect`;
  - a malformed entry is dropped, like a malformed frame.
- `comment:added`: `requestId` must be a string, otherwise the message is dropped.
- `ui:error`:
  - `message` must be a string;
  - `requestId`, when present, must be a string;
  - otherwise the message is dropped.
- Bodies are never rendered with `{@html}`. Nothing renders them in 8f1.

### Chrome rules (pure, unit-tested)

**`modeKeyAction` (`commentPick.ts`).**

Input:

```
{key, ctrlKey, metaKey, altKey, repeat, defaultPrevented, inTextEntry,
 commentMode, hasFrames, popoverOpen, forwarded}
```

Output: `'toggle' | 'exit' | 'cancel' | undefined`. Rules, first match wins:

1. `defaultPrevented`, `inTextEntry`, Ctrl / Meta / Alt, or `repeat` → undefined.
2. `popoverOpen`:
   - a chrome (not `forwarded`) `Escape` → `cancel` (focus had left the popover);
   - everything else → undefined, so `C` and a forged `cd:key` never discard a draft.
3. `c` or `C`:
   - with `hasFrames` → `toggle`;
   - otherwise → undefined.
4. `Escape`:
   - in Comment mode → `exit`;
   - otherwise → undefined.
5. Anything else → undefined.

A forwarded `cd:key` passes `forwarded: true`, `repeat: false`, `defaultPrevented: false`,
`inTextEntry: false` and no modifiers; the runtime already filtered those.

**`popoverKeyAction` (`commentPopover.ts`), from the popover root keydown.**

Input:

```
{key, shiftKey, ctrlKey, metaKey, altKey, isComposing, bodyEmpty, inTextarea}
```

`bodyEmpty` means the textarea value is `''`. Output:
`'add' | 'cancel' | 'parent' | 'child' | undefined`. Rules, first match wins:

1. `isComposing` → undefined (IME owns the key).
2. `Escape` → `cancel`.
3. `Enter` in the textarea, with no Shift / Ctrl / Meta / Alt → `add`. It is a no-op unless
   `canSubmit`, but Enter never inserts a newline.
4. Shift+Enter → undefined (native newline).
5. `ArrowUp` / `ArrowDown` with no modifiers and `bodyEmpty` → `parent` / `child`, from any
   focus inside the popover. Once the box has text, arrows do nothing special: they move the
   caret in the textarea and are inert on buttons.
6. Anything else → undefined.

**For every non-undefined result the popover calls `preventDefault()`**, including `cancel`. The
popover's delegated handler runs before `<svelte:window onkeydown>`, and `modeKeyAction` rule 1
then ignores the key. That is what keeps a first Escape from also leaving Comment mode. While
`pendingRequestId` is set, `cancel` is still prevented but does nothing.

**Draft (`commentPopover.ts`), held in App.**

```
CommentDraft = {frameId, generation, target: {selector|null, tagName, text, rect|null,
point, box, styles, isPage}, pendingRequestId?: string, error?: string}
```

The textarea value lives in the component, which stays mounted while the draft exists, so it
survives a retarget, an error and a frame reload.

- App calls `draftFromPick(draft, pick, frameGeneration)` when `message.type === 'cd:pick'` and
  `picking.commentMode` is true. It checks both before `applyPickMessage`, and only when
  `parseFrameMessage` accepted the pick.
  - **User pick** (`repost: false`):
    - opens a draft when there is none;
    - otherwise retargets it: replaces `frameId`, `generation` and `target`, clears `error`,
      keeps `pendingRequestId`.
  - **Re-post** (`repost: true`):
    - with an open draft on the same frame, it replaces only `target.rect`, `target.point` and
      `target.box`;
    - otherwise it is ignored, so it never opens a draft, never moves it to another frame, and
      never clears `error`.
  - `frameGeneration` is that frame record's `generation` when the pick arrives.
  - `ponytail:` a pick from the old document between `canvas:updated` and the frame's reload
    gets the new generation. The window is milliseconds, and 8e's tag + text cross-check marks
    the comment unchecked if the element differs. Upgrade path: track the generation of the
    document the iframe actually shows.
- `canSubmit(draft, body)` holds when all of these are true:
  - no `pendingRequestId`;
  - `body.trim()` is 1..`MAX_COMMENT_BODY_CHARS` (the textarea also has
    `maxlength={MAX_COMMENT_BODY_CHARS}`);
  - `blockedTargetCopy(draft) === undefined`.
- `blockedTargetCopy(draft)`, first match:
  - `generation < 1`: "This artboard has no version yet. Ask the Agent to update it, then pick
    again.";
  - `selector === null`: "This element has no unique selector. Press ↑ to pick its parent.";
  - non-page `rect === null`: "The element is out of view. Scroll it back or pick it again.";
  - otherwise undefined.
- The message line shows `draft.error` (the host's answer) when set, otherwise
  `blockedTargetCopy(draft)`.
  - It is derived live, not only on an Add attempt.
  - It is always mounted with `role="status"` and is empty when there is nothing to say.
- Add is `disabled` exactly when `!canSubmit`.
- Cancel is `disabled` while `pendingRequestId` is set, so a Cancel never hides a comment that
  is being written.
- `submitDraft(draft, body, requestId)`:
  - returns `{draft with pendingRequestId, message}`, or undefined unless `canSubmit`;
  - `requestId` is `crypto.randomUUID()`, unique across webview reloads, so a late answer to a
    previous webview never matches.
- `answerDraft(draft, answer)`:
  - ignores an answer whose `requestId` is not the pending one;
  - `comment:added` closes the draft, and the caller runs `clearPick`;
  - `ui:error` clears `pendingRequestId` and sets `error`.
- **Close**: the draft becomes undefined and the caller runs `clearPick`. Triggers:
  - Cancel, popover Escape or `modeKeyAction` `cancel` (never while pending);
  - the mode exits: the Comment button, `C`, Escape, or the last live frame leaving
    (`keepLiveFrames`);
  - the draft's frame is no longer a live iframe (removed, or demoted to a tile).
- Exiting the mode while a create is pending closes the draft anyway. The comment may still land
  and the late answer is ignored.
- Typed text is discarded by every close. That is intended.
- A frame **reload** (`cd:ready`, Agent edit) keeps the draft:
  - `applyPickMessage` drops the pick and outline as today, so `canStep` becomes false;
  - the popover stays at its last anchor with the old chip;
  - the next `comment:create` gets `PICK_OUTDATED`, shown in the popover with the text kept;
  - a new user pick then retargets the draft.
- Alt+click retargets an open draft after typing too. Notion's "before typing" is about keys;
  a click is an explicit new pick, and the text is kept.
- `ponytail:` a design script can post a forged user `cd:pick` and retarget the open draft. The
  text is kept and the chip shows the new target.

**`targetChipText`.**

- "Whole frame" for a page pick.
- Otherwise the pick text when non-empty, else `<tagName>`.
- Rendered as text and ellipsized, with the full selector (or tag) as `title`.

**`popoverAnchor({view, frame, target})`.** A screen point:

```
stageToScreen(frame.x + rect.x + clamp(point.x, 0, rect.width),
              frame.y + rect.y + clamp(point.y, 0, rect.height))
```

- It uses the `stageToScreen` primitive that `frameRectToScreen` is built on, because a point is
  not a rect, so it is not a twin.
- The point is clamped into the visible rect. For a clipped target the anchor lands on its
  nearest visible spot, which is fine for UI because nothing persists. The pin uses `box`.
- `rect === null`: the frame's top-left in screen space.
- It uses the draft frame's record, drag preview included, so the popover follows pan, zoom and
  frame moves.

**`placePopover({anchor, width, height, viewportWidth, viewportHeight})`.** Returns `{x, y}`,
viewport-local px, with `GAP = 8` and `MARGIN = 8`:

1. Start at `x = anchor.x + GAP` and `y = anchor.y + GAP`.
2. If `x + width > viewportWidth - MARGIN`, set `x = anchor.x - GAP - width`.
3. If `y + height > viewportHeight - MARGIN`, set `y = anchor.y - GAP - height`.
4. Clamp each to `[MARGIN, viewport - size - MARGIN]`, or to `MARGIN` when the viewport is
   smaller than the popover.

The component measures itself (`bind:offsetWidth/Height`) and positions with `style:left` /
`style:top` (CSSOM, no `style=""` under the nonce CSP).

### Focus

- **Open, or user retarget while `document.activeElement` is an `IFRAME`** (the click moved
  focus into the frame): focus the textarea in the next `requestAnimationFrame`. That lets the
  frame's own `window.focus()` settle first. A re-post never moves focus.
- **Close by Cancel or Escape**: focus the draft frame's iframe (`iframe.focus()`). There the
  runtime handles ↑/↓, and a second Escape arrives as `cd:key` and leaves Comment mode.
- **Close by `comment:added`**: move focus to the iframe only if `document.activeElement` is
  still inside the popover.
- **Close because the mode exited or the frame left**: no focus move.

### Untrusted workspaces

"Comment disabled" is today's mechanism. The host posts the empty snapshot, `frames: []`, so the
Comment button is disabled, `hasFrames` is false, and `keepLiveFrames` ends the mode. The host
also refuses `comment:create` with `ui:error`. This is proven by F5.

### Disk

No change to the `comments.json` shape, the lock, or the status machine (8e). The only new writer
is the host's `addComment` call, under `withWorkspaceLock`.

## Testing

**Unit (`vp test`), edge cases over volume (rule 09).**

- `chromeMessages.test.ts`:
  - `comment:create` happy path;
  - rejects: `requestId` with a space or of 65 characters, a selector over the cap or with
    `\n`, a `NaN` rect, a negative point, a missing `box`, an `isPage` that is not a boolean;
  - a 2001-character body parses (`addComment` owns that rule);
  - `isCommentCreateAttempt` is true for a malformed `comment:create`;
  - `commentCreateRequestId` returns the id from a message whose other fields are bad;
  - `toNewComment`: a zero-width `box` gives pin x 0 (no NaN); a point past `box` clamps to 1;
    a clipped target (`rect.height` < `point.y` < `box.height`) gives a fraction below 1;
    a page message gives `rect: null`; a null rect gives no throw;
  - `toPostedComment`: `artboard`, `version`, `styles` and `targetFingerprint` are absent.
- `panelOutbox.test.ts`:
  - comments posted before ready flush after the view and status on ready;
  - a second ready re-sends them;
  - `postAnswer` before ready posts nothing, and a later ready does not replay it;
  - `reset` drops the cached comments.
- `comments.test.ts`: `readComments` returns a resolved comment; a missing file gives `[]`; a
  symlinked `.cursor-design` is refused like `listComments`.
- `hostMessages.test.ts`:
  - `comments:updated` with one malformed entry keeps the valid one;
  - a non-array `comments` is rejected;
  - a non-string `error` is rejected;
  - `comment:added` without `requestId`, or with a numeric one, is dropped;
  - `ui:error` with a numeric `requestId` is dropped;
  - `ui:error` without `requestId` is kept.
- `frameMessages.test.ts`:
  - `cd:key` accepts `c` and `Escape`, and rejects `C`, `Enter`, a number and a missing key;
  - `cd:pick` without `repost` or `box`, or with a negative `box`, is rejected.
- `commentPick.test.ts`:
  - `modeKeyAction`:
    - `c` toggles; Ctrl+C, Cmd+C and Alt+C do nothing;
    - `c` does nothing in text entry, on repeat, after `defaultPrevented`, or with no frames;
    - Escape exits only in Comment mode;
    - with the popover open: a chrome Escape gives `cancel`; a forwarded Escape and `c` do
      nothing; a prevented Escape does nothing;
  - `clearPick` sends `cd:mode {comment}` to the picked frame only.
- `commentPopover.test.ts`:
  - `popoverKeyAction`:
    - Enter with an empty box and with a typed box;
    - Enter during IME composition;
    - Enter on a button (`inTextarea: false`) → undefined;
    - Shift+Enter;
    - ↑ with an empty box, in the textarea and on Cancel → `parent`;
    - ↑ with a typed box → undefined;
    - Escape;
  - `canSubmit` and `blockedTargetCopy`: whitespace-only body, a 2001-character trimmed body,
    generation 0, null selector, non-page null rect, pending;
  - `draftFromPick`: a re-post with no draft opens nothing; a re-post on another frame is
    ignored; a re-post keeps `error`; a user retarget clears `error` and keeps the pending id;
  - `answerDraft` ignores a stale `requestId`; `ui:error` keeps the target and sets `error`;
  - `placePopover`: flips at the right edge, flips at the bottom edge, clamps in a viewport
    smaller than the popover;
  - `popoverAnchor` with a null rect and with a point past the rect.
- `canvasFrames.test.ts`: `generation` is carried and updated by `mergeCanvasFrames`.

**Browser (`pnpm test:browser`, harness with a stubbed host; new
`tests/browser/commentPopover.spec.ts`).**

- Opening:
  - a click in Comment mode opens the popover with focus in the textarea;
  - its chip shows the element text.
- Stepping:
  - ↑ in the empty box posts `cd:pick-parent` and the chip updates;
  - after typing, ↑ posts nothing;
  - ↑ with focus on Cancel and an empty box posts `cd:pick-parent`.
- Adding:
  - Enter posts one `comment:create` whose fields equal the last `cd:pick` (`box` included)
    plus `body`, `frameId`, `generation` and a UUID `requestId`;
  - Enter on an empty box posts nothing;
  - Shift+Enter inserts a newline;
  - while pending, a second Enter posts nothing and Cancel is disabled.
- Answers:
  - a harness `ui:error {requestId, message}` shows the message and keeps the text;
  - `comment:added {requestId}` closes the popover and drops the pick outline;
  - an answer with another `requestId` changes nothing.
- Escape:
  - Escape in the textarea closes the popover, Comment mode stays on, and focus returns to the
    frame;
  - a second Escape, in the frame, leaves Comment mode via `cd:key`;
  - the same first-Escape check passes with focus on the Cancel button.
- Frame reload:
  - a `canvas:updated` with new html for the picked frame keeps the popover and its text;
  - Parent and Child become `aria-disabled`.
- Scroll re-posts:
  - after Cancel, a scroll inside the picked frame's scroll box opens no popover;
  - with the popover open, a re-post moves the anchor.
- A pick near the right and bottom edges keeps the popover box inside the stage viewport.
- A wheel over the popover does not change the stage transform, and a pointerdown on it does not
  pan.
- A forged `cd:key {key: 'c'}` from the design while the popover is open changes nothing.
- The existing `picking.spec.ts` tests pass with the moved locators, the new payload fields and
  the re-pointed F-63 test.

**F5 (Cursor-only, recorded by `/check`).**

- `C` reaches the webview in Cursor (no keybinding steals it), with chrome focus and with frame
  focus.
- The textarea has focus after a click in the frame, inside Cursor.
- Add writes `.cursor-design/comments.json`, and `list_comments` in Cursor Agent returns it.
- Panel hide/show replays `comments:updated`.
- A corrupt `comments.json` shows the comments banner while the frames still render.
- An untrusted workspace has Comment disabled, and the host refuses `comment:create`.
- A new frame added while in Comment mode gets `cd:mode`.
- An Agent `update_artboard` on the picked frame while typing gives the "Pick it again" error
  with the text kept, and re-pick then Add succeeds.

No visual or persisted-data evidence is claimed until these run.

**F5 gaps accepted by Bombic (2026-10-27, `/check` result "verification incomplete").** Not run,
not passed:

- Untrusted workspace: Comment disabled and `comment:create` refused. No repeatable test
  observes the host refusal.
- Panel hide/show and close/reopen replay of comments, with no duplicates. `panelOutbox.test.ts`
  covers the replay on every `artboard:ready`.
- The comments banner for a real corrupt or version-99 `comments.json` in Cursor. The banner is
  covered by the browser test, and the MCP error codes passed live in F5.
- The generation-0 "no version yet" copy, which a missing meta file cannot reach. It is covered
  by the `blockedTargetCopy` unit test.

Every other F5 item passed live in the Extension Development Host on 2026-10-26.

## Notes for the AI

- Follow the rule 08 Svelte MCP workflow on every `.svelte` / `.svelte.ts` edit.
  - Use `style:` directives only (CSP), never `{@html}`.
  - Use theme tokens only: `--vscode-editorWidget-*`, `--vscode-input-*`,
    `--vscode-button-*`, `--vscode-errorForeground`.
- App.svelte is already about 420 lines. Every decision goes in `commentPopover.ts` /
  `commentPick.ts`; App only holds state, applies results, and does I/O. Deleting
  `arrowPickStep` offsets part of the growth.
- `postMessage` structured clone throws on `$state` proxies: snapshot in `hostBridge.svelte.ts`,
  as `postFramePlace` does.
- Stage's wheel listener is non-passive on the viewport. The popover root's `wheel` handler only
  needs `stopPropagation`; Svelte's `onwheel` is passive, which is fine for that.
- Check that Stage's window `keydown` (label arrow nudges) ignores keys from inside the popover.
- `frameMessages.ts` stays DOM-free: the export imports it under the root tsconfig.
- The runtime's `cd:key` listener is separate from `blockInComment`. `c` and Escape are not in
  `BLOCKED_KEYS`, so both modes forward them.
- Keep the host glue thin. Every decision lives in `chromeMessages.ts`, `panelOutbox.ts` or the
  disk lib, which have tests; `panelComments.ts` only sequences calls, catches, logs and posts.
- `ponytail:` notes to write:
  - a design that uses a bare `c` shortcut in Interact mode also toggles Comment mode (spec:
    `C` toggles); editable targets are excluded;
  - `event.key` is layout-dependent, so a non-Latin keyboard layout that never produces `c`
    cannot toggle with the key (the button still works).
- `addComment` parses the artboard once per add on the extension host thread, bounded by the
  8e `commentTarget` caps. That is acceptable for a single user action.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":38110,"specSha256":"663d49caf09de0640b733ebf75e2ae7c7a138ff056908c31cf02b7e954b0498d","branch":"refs/heads/feature/comment-mode-popover","head":"9002215cad6f94945bb4a3ac3fc03e5d9465b118","baseRef":"refs/heads/main","baseCommit":"fd193e5523c986d65d5ad757a121d1bb7fd67cbb","sourceTree":"ae503c0da4f0e1000255b041fa48a586e92e0b9f","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8f1/F-77 [P2] closed - Focus drops to the page body after Add: the pending Add button disables itself, and nothing restores focus on ui:error or comment:added

**File:** src/webview/CommentPopover.svelte:151 (and src/webview/App.svelte:270-280)
**Found:** 2026-10-26 by /audit (scope: current; lens: quality, tests)
**Why it matters:** The Add button is `disabled` whenever `!canSubmit`, and `canSubmit` is false while `pendingRequestId` is set. Pressing Add with the keyboard (type, Tab to Add, Enter) or the mouse disables the focused button, and Chromium then moves focus to `body`. Probe (throwaway Playwright run over the built bundle): Tab to Add, Enter, then `ui:error {requestId}` left `document.activeElement` as `BODY` with the popover still open. Consequences: (1) after an error the keyboard user is outside the popover, so its keydown handler (Enter, ↑/↓, Escape-first-closes-only-the-popover) is dead until they Tab back in, and nothing tells them where focus went; (2) on `comment:added`, `closeDraft(popoverHasFocus())` sees focus on `body`, so the spec's "focus returns to the frame" rule never fires on this path and the user is left on `body`. The browser tests only press Enter inside the textarea, which never disables the focused element, so the spec's Focus section is not proven for the button path.
**Suggested fix:** Keep the Add button focusable while pending (`aria-disabled` with a guarded `onclick`, as Parent and Child already do), or on `ui:error` call `focusBody()` when focus is not inside the popover. For the success path decide the rule from where focus was when Add was pressed, not at answer time. Add one browser test: Tab to Add, Enter, `ui:error`, assert focus is inside the popover.
**Resolution:** Add uses `aria-disabled` with a guarded click (`submitDraft` already refuses a non-submittable draft) instead of `disabled`, so pressing it keeps focus inside the popover; success then returns focus to the frame through the existing `popoverHasFocus` rule. Browser test "Add pressed from the button keeps focus in the popover; on success focus goes to the frame (F-77)". Fixed 2026-10-26. Closed 2026-10-27 by independent /audit: Add uses aria-disabled with a guarded click (CommentPopover.svelte), browser test passes; no new defect in the repair.

### 8f1/F-78 [P3] closed - The popover message line is display:none while empty, so the status region may not announce an error that appears later

**File:** src/webview/CommentPopover.svelte:146 and :198
**Found:** 2026-10-26 by /audit (scope: current; lens: quality)
**Why it matters:** `role="status"` is always mounted (as the spec asks), but `.message:empty { display: none }` takes it out of the accessibility tree until it has text; screen readers often skip a live region that enters the tree together with its content. This is the same shape as F-25 (the old chip) and it carries the host's `ui:error` copy ("Pick it again.") and the blocked-target hints. No screen-reader run backs this up.
**Suggested fix:** Check with VoiceOver in F5. If silent, hide the empty line visually (zero height, `visibility`-safe) instead of `display: none`, so the region stays in the tree.
**Resolution:** Dropped `.message:empty { display: none }`: the empty status line has no height and stays in the accessibility tree. A VoiceOver run in F5 still has to confirm the announcement. Fixed 2026-10-26. Closed 2026-10-27 by independent /audit: CommentPopover.svelte has no `.message:empty` rule; the status line stays in the tree. A VoiceOver run in F5 is still the only announcement proof.

### 8f1/F-79 [P3] closed - cd:pick `box` is not clamped, so a target taller or wider than 100000 px is silently dropped

**File:** src/webview/frame/commentPicking.ts:181 (guard at src/webview/frame/frameMessages.ts:181)
**Found:** 2026-10-26 by /audit (scope: current; lens: security, tests)
**Why it matters:** `point` is clamped to `MAX_FRAME_COORDINATE` so "a pick never fails its own guard" (`pickTarget.ts:90`), but the new `box` posts raw `getBoundingClientRect()` sizes while `parseBox` rejects anything above 100000. Probe: a frame whose body holds a 150000 px tall div, Comment mode, click: the frame posted `cd:pick` with `box.height` 150000, the chrome's `parseFrameMessage` dropped it, no popover opened, no outline, no message. A long virtualized list or an infinite-scroll preview reaches this; the page pick (documentElement box) too. The user sees a click that does nothing.
**Suggested fix:** Clamp `box` in the runtime together with `point`, scaling `point` by the same factor so the pin fraction stays right (or clamp both to the cap and accept a pin at the cap). One unit test through `pointInTarget`'s sibling, plus the existing "described pick passes its own guard" test with a 150000 px box.
**Resolution:** The runtime caps `box` at `MAX_FRAME_COORDINATE` like `point` (`commentPicking.ts`), with a `ponytail:` for the off pin fraction past the cap. Browser test "a target taller than the coordinate cap still opens the popover (F-79)"; export snapshot updated (runtime source only). Fixed 2026-10-26. Closed 2026-10-27 by independent /audit: commentPicking.ts caps box with Math.min(..., MAX_FRAME_COORDINATE); browser test passes.

### 8f1/F-80 [P3] closed - A re-post already in flight when the draft closes puts the pick outline back with no popover

**File:** src/webview/commentPick.ts:102-111 (with src/webview/App.svelte:241-248)
**Found:** 2026-10-26 by /audit (scope: current; lens: quality, tests)
**Why it matters:** `applyPickMessage` sets `pick` for any `cd:pick`, including `repost: true` when the chrome holds no pick for that frame. `closeDraft` runs `clearPick`, which sends the frame `cd:mode` to reset its path, but a scroll or resize re-post the frame posted just before that message is processed still arrives afterwards. `draftFromPick` correctly ignores it (no draft), but `applyPickMessage` stores it as the live pick: an outline with no popover, `canStep` true, and a runtime that has an empty path (↑/↓ do nothing), until the next pick or mode toggle. The spec only requires that a re-post "never opens a draft"; the browser test "after Cancel, a scroll opens no popover" asserts the popover count only, never the outline. The same one-message window is already written down as a `ponytail:` for the cross-frame case; the 8f1 close paths widen it to every Cancel, Escape and Add.
**Suggested fix:** In `applyPickMessage`, ignore a `repost` pick unless `state.pick?.frameId === frameId`. One unit test (a re-post with no pick leaves state untouched) and one `.overlay .outline.pick` count assertion in the existing scroll test.
**Resolution:** `applyPickMessage` ignores a `repost` pick unless chrome holds a pick for that frame. Unit test "a re-post moves only a pick chrome still holds for that frame (F-80)" and an outline-count assertion in the scroll re-post browser test. Fixed 2026-10-26. Closed 2026-10-27 by independent /audit: applyPickMessage ignores a repost unless chrome holds a pick for that frame; unit and browser tests pass.

### 8f1/F-81 [P3] closed - Twin clamp helpers, a redundant host clamp, and an unused export

**File:** src/webview/commentPopover.ts:215, src/host/chromeMessages.ts:81, src/webview/frame/frameMessages.ts:72
**Found:** 2026-10-26 by /audit (scope: current; lens: quality)
**Why it matters:** (1) `commentPopover.ts` defines `clamp(value, min, max)`, a second copy of `clampNumber({ value, min, max })` that `stageGeometry.ts` exports and that this module already imports from (it also takes three positional arguments, against rule 04). (2) `toNewComment` clamps the pin with its own `clamp01`, a third copy of `comments.ts:129`; `addComment` already clamps the pin (`clampedPin`, comments.ts:253), so the host clamp changes no outcome. Only the zero-size-box guard in `toNewComment` is needed (it prevents NaN, which `clampedPin` leaves alone). (3) `FrameKeyMessage` is exported but never imported; `pnpm knip` fails on it (knip is outside Verify).
**Suggested fix:** Use `clampNumber` in `popoverAnchor` and drop `clamp`. Delete `clamp01` from `chromeMessages.ts` and keep `box.width > 0 ? point.x / box.width : 0` (the test "a point past box clamps to 1" then moves to the disk lib, which already tests `clampedPin`, or keeps asserting the stored value). Un-export `FrameKeyMessage`. No behaviour is lost.
**Resolution:** `popoverAnchor` uses `clampNumber`; the twin `clamp` and the host `clamp01` are gone (`addComment` clamps the pin; the zero-box guard stays); `FrameKeyMessage` is no longer exported. `pnpm knip` clean. Fixed 2026-10-26. Closed 2026-10-27 by independent /audit: the twin clamp and clamp01 are gone, FrameKeyMessage is not exported, `pnpm knip` prints nothing.

### 8f1/F-82 [P3] closed - Runtime cd:key filters and the focus rules after Add and Escape have no test that fails when the guard goes

**File:** src/webview/frame/runtime.ts:131 and tests/browser/commentPopover.spec.ts:100
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** Rule 09 asks for a test per guard. The `cd:key` listener's guards `ctrlKey`, `metaKey`, `altKey`, `repeat`, `isComposing` and the `composedPath()[0]` shadow-root check have no test: the only coverage is an Interact-mode `<input>` (the `isContentEditable / matches` branch) and `runtime.test.ts`, which only counts `host.postMessage` strings. Removing the modifier guard makes Cmd+C (copy) inside a frame toggle Comment mode and every test stays green (checked by reading the specs: no spec presses a modifier, repeat or a shadow input in a frame). Also unasserted: focus after `comment:added` (the spec's "move focus to the iframe if it was in the popover") and the pick outline after Cancel (F-80).
**Suggested fix:** Add to `commentPopover.spec.ts`: press `Meta+c` and `Control+c` with frame focus and expect zero `cd:key`; a shadow-root `<input>` in the fixture frame typing `c` expects none; after `comment:added` from the textarea assert `focusedFrameId` is the frame. No product change.
**Resolution:** Browser test "C with a modifier, a held C, or C in a shadow-root input never posts cd:key (F-82)" covers Ctrl/Meta/Alt, `repeat` and the `composedPath` shadow input; focus after `comment:added` is asserted in the F-77 test and the outline after Cancel in the scroll test. `isComposing` stays untested (Playwright cannot drive IME composition). Fixed 2026-10-26. Closed 2026-10-27 by independent /audit: the browser test covers modifiers, repeat and the shadow-root input; isComposing stays untested (Playwright cannot drive IME).

## Independent review

**Status:** passed
**Target commit:** 9002215cad6f94945bb4a3ac3fc03e5d9465b118
**Base commit:** fd193e5523c986d65d5ad757a121d1bb7fd67cbb
**Base ref:** main
**Spec hash:** 663d49caf09de0640b733ebf75e2ae7c7a138ff056908c31cf02b7e954b0498d
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-sonnet-5-5
**Requested execution:** automatic
**Requested at:** 2026-10-27T10:26:41+01:00
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-sonnet-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-27T10:31:30+01:00
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD` and `git merge-base main HEAD`: pass (9002215cad6f94945bb4a3ac3fc03e5d9465b118 and fd193e5523c986d65d5ad757a121d1bb7fd67cbb)
- `shasum -a 256 blueprint/context/current-feature.md`: pass (matches Spec hash)
- `git status --short`: pass (only blueprint/context/review.md before the review)
- `pnpm verify`: pass (exit 0; 34 test files, 425 tests)
- `pnpm test:browser`: pass (59 passed)
- `pnpm knip`: pass (no output)

### Evidence

- Reviewed the full `fd193e5..9002215` delta: host (`panelComments.ts`, `chromeMessages.ts`, `panelOutbox.ts`, `openArtboardPanel.ts`, call sites), disk (`readComments`, `addComment` path), chrome (`App.svelte`, `CommentPopover.svelte`, `commentPopover.ts`, `commentPick.ts`, `hostMessages.ts`, `frameMessages.ts`, `Stage.svelte`, `Toolbar.svelte`, `Banners.svelte`) and frame runtime (`runtime.ts`, `commentPicking.ts`), plus unit and browser tests, against the spec and rules 02, 04, 05, 06, 07, 08, 09.
- Trust boundary traced end to end: frame cd:pick/cd:key parse, draft, comment:create zod parse, untrusted-workspace refusal before parse, `addComment` revalidation and generation check, answered once through `postAnswer`; UI copy goes through `toSafeArtboardErrorMessage` (authored copy only).
- Races checked: frame reload with an open draft (PICK_OUTDATED, text kept), pending create then mode exit (late answer ignored), stale answers by requestId, re-post after close (F-80 guard), last-read-wins for comments:updated, replay on artboard:ready.
- Prior fixes F-77 to F-82 re-examined in code and closed; F-83 and F-84 added.

### Findings

- F-83 [P3] open: host comment:create guards (tagName, text, generation, rect size, styles) have no test that fails when removed
- F-84 [P3] open: createCommentFromChrome (untrusted refusal, ordering, one answer) has no automated check; spec accepted the F5 gap
- Closed this pass: F-77, F-78, F-79, F-80, F-81, F-82

### Remaining risk

- Cursor-only behavior is not covered here: untrusted-workspace refusal, hide/show replay of comments:updated, a real corrupt comments.json banner and the VoiceOver announcement of the popover message line (spec-accepted F5 gaps).
- `isComposing` handling in the runtime and popover is unit-tested only for the popover rule; IME composition cannot be driven by Playwright.
- Performance is unmeasured: every watcher refresh re-reads and re-posts the whole comments list even when comments.json did not change (bounded by the documented 500-comment ceiling; no profiling done).
- A design script can forge cd:key (toggle or exit Comment mode when no popover is open) and cd:pick (retarget an open draft); both are documented ponytail ceilings.
- Fresh-context identity is declared metadata, not proven.

## Try it now

Run **F5** (Extension Development Host opens `fixtures/dev-workspace`), then open the panel with
**Cursor Design: Open Artboard**.

1. **Mode.** Press `C`: the Comment button is pressed. Hover outlines elements; clicks on buttons
   and links no longer act. `Escape` leaves the mode. `C` typed into a design input stays in it.
2. **Popover.** In Comment mode click a heading: the popover opens on it, focus in the box, chip
   shows the heading text. With the box empty, `↑` / `↓` step to the parent / child.
3. **Add.** Type a note and press Enter: the popover closes, Comment mode stays on. In a Cursor
   Agent chat ask "list cursor-design comments": the note is there with its selector, version and
   pin. Nothing is drawn on the canvas yet (pins are 8f2).
4. **Stale pick.** Pick an element and type without Enter. Ask the Agent to `update_artboard` that
   frame. Press Enter: "This artboard changed since the element was picked. Pick it again." with
   the text kept. Click the element again, Enter: one comment is stored.

Expected wrong results: a click in Comment mode fires the design's handler, Enter inserts a
newline, the popover stays open after a successful Add, or the next pick shows the old text.
