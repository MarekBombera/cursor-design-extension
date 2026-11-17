# Feature: Comments panel

**From build-plan:** feature 8g
**Build attempt:** 1
**Branch:** feature/comments-panel
**Status:** verified

## Goal

A collapsible Comments panel on the right of the stage lists every comment in `comments.json`.
Unresolved comments (open and sent) come first, resolved ones last and dimmed. Each comment shows
its author, a relative time, the target chip with its frame, the body, its replies (the Agent's
`resolve_comment` notes appear as Agent replies), the stale / missing / unchecked badge, and the
actions Reply and Resolve / Reopen. Clicking the target chip jumps the stage to the comment and
flashes the target's outline. The pin thread popover from 8f2 gets the same Reply and
Resolve / Reopen actions.

Notion done-when lines advanced (0.3 brief): "Comments panel: Reply, Resolve, Reopen work";
"click to jump", "Agent notes" from "Copy all open, pin states, click to jump, pins following
elements, page comments and Agent notes all work"; "Resolved comments gray out" (Contracts →
Pins and panel).

## In scope

1. **Two chrome → host requests.** `comment:reply {requestId, id, body}` and
   `comment:set-status {requestId, id, status: 'open' | 'resolved'}`. The host answers each attempt
   that has a valid `requestId` exactly once: `comment:saved {requestId}` on success, or
   `ui:error {requestId, message}` on failure. The write goes through the disk lib's existing
   `replyToComment` / `setCommentStatus`, which take `withWorkspaceLock` themselves (the host never
   wraps them in the lock: it is not reentrant). The host then re-reads and posts
   `comments:updated`. Untrusted workspaces are refused.
2. **Comment actions** in the chrome, shared by the panel and the pin thread: a reply composer
   (Enter adds, Shift+Enter is a newline, Escape cancels), Resolve / Reopen, one request in flight
   per comment, inline errors, and announcements in one polite live region.
3. **Comments panel**: a toolbar toggle with the unresolved count, open / closed state kept in
   webview state, two groups (Unresolved, Resolved), comments on frames that are not drawn still
   listed, empty and error states, and focus kept when an item moves between groups.
4. **Click to jump**: the target chip pans the stage to the target and keeps the zoom, zooming out
   only when the target would not fit. A 1.5 s outline then flashes on the target's last live
   position (or its stored position when missing). Page comments outline the whole frame.
5. **Thread popover** (8f2) renders the same comment card, with Reply and Resolve / Reopen.
6. Rule 02 message line, rule 05 owner catalog, and the 0.3 plan's message contract plus
   "8g as shipped" notes, in the same change.

## Out of scope

- **Copy prompt, Copy all open, `comment:copy*`, `ui:copied`, marking `sent` (8h).** The 0.3
  plan's 8g item 1 lists "Copy prompt" in the panel. 8h owns it and adds the button to the same
  card.
- Any MCP tool, error code, runtime limit or frame CSP change. `skills/cursor-design/SKILL.md` is
  unchanged: it already says user replies refine the request.
- Deleting or editing comments or replies, and threads deeper than one level of replies.
- Scrolling an element inside its frame into view on jump (no chrome → frame message for it). A
  target scrolled out of its scroll box gets the pan but no outline.
- Animating the jump, resizing the panel, a keyboard shortcut for the panel, filters or search.
- Highlighting the panel item when a pin is clicked.
- Pins or jumps for comments whose frame is not a live iframe (absent from the canvas, or an
  error tile). The panel lists them without a jump.
- A host-level answer timeout (see Notes, `ponytail:` on a lost answer).
- `blueprint/context/system-map.md` (updated by `/complete` after the build).

## Build loop

`workflow.stepReview: feature`: build every step, then one review at the end. Checkpoint commits
are disabled; `/complete` makes the commit. After each step, run `pnpm exec vp test` on the
touched tests. After steps 3, 4 and 5, run `pnpm test:browser`. Every `.svelte` edit follows rule
08: Svelte MCP docs before writing, and `svelte-autofixer` until clean (prefer the
`svelte-file-editor` agent). Before handoff, `pnpm verify` and `pnpm test:browser` must both be
green. Work on `feature/comments-panel`: create it from `main` first (the spec edits are
uncommitted on `main`).

## Build steps

- [x] **1. Host contract for reply and set-status.**
  - `src/webview/hostMessages.ts`: add the types in Data / contracts (`CommentReplyMessage`,
    `CommentSetStatusMessage`, `CommentRequestMessage`, `CommentSavedMessage`). `ChromeMessage`
    becomes `{type: 'artboard:ready'} | FramePlaceMessage | CommentRequestMessage`, and
    `HostMessage` gains `CommentSavedMessage`. `parseHostMessage` accepts `comment:saved` only
    when `requestId` is a string; otherwise it returns undefined. It is reached only from
    `routeMessage`'s host branch, never from a frame source (unchanged routing).
  - `src/disk/errors.ts`: `toSafeArtboardErrorMessage(error, fallback?)` moves here from
    `src/host/artboardDisk.ts` unchanged (it never used `vscode`), beside `CursorDesignError`, so
    the pure copy rule below can reuse it. `artboardDisk.ts` and `panelComments.ts` import it from
    here.
  - `src/host/chromeMessages.ts` (no `vscode`):
    - `chromeMessageSchema` gains the two request schemas (Data / contracts). `id` must match
      `COMMENT_ID_PATTERN`, and `status` must be exactly `open` or `resolved`, so `sent` fails the
      parse.
    - Generalize, don't twin: `isCommentCreateAttempt` becomes `commentRequestType(value)`, the
      claimed raw `type` when it is `comment:create`, `comment:reply` or `comment:set-status`,
      else undefined (it reads the claim before any parse). `commentCreateRequestId` becomes
      `commentRequestId(value)`, the `REQUEST_ID_PATTERN` id of any of the three.
    - New `commentRequestErrorMessage({type, error})` and the copy constants
      (Data / contracts → Failure copy). The create copy constants move here from
      `panelComments.ts` unchanged.
  - `src/host/panelComments.ts`: `createCommentFromChrome` becomes `answerCommentRequest({value,
    outputChannel})` with the same contract: it never rejects and answers once. Order:
    1. `requestId = commentRequestId(value)` and `type = commentRequestType(value)`. Log scope is
       `panelComments.create`, `panelComments.reply` or `panelComments.setStatus` by `type`. No
       `requestId`: log and return, no answer.
    2. Untrusted workspace, then no folder: refuse with the existing copy.
    3. `parseChromeMessage(value)`. When the parse fails or its `type` differs from the claimed
       `type`: refuse with the claimed type's malformed copy.
    4. Dispatch: `comment:create` → `addComment`, answer `comment:added` (unchanged);
       `comment:reply` → `replyToComment({workspaceRoot, id, body})`, answer `comment:saved`;
       `comment:set-status` → `setCommentStatus({workspaceRoot, id, status})`, answer
       `comment:saved`. Never wrap these in `withWorkspaceLock`.
    5. Post the answer first, then `void postPanelComments({outputChannel})`.
    6. Any throw: refuse with `commentRequestErrorMessage({type, error})`.
  - `src/panel/openArtboardPanel.ts`: `setArtboardPanelOnCommentCreate` becomes
    `setArtboardPanelOnCommentRequest`, routed when `commentRequestType(value) !== undefined`.
    `postAnswerToPanel` and the outbox `postAnswer` accept `CommentSavedMessage` too.
  - `src/extension.ts`: wire `answerCommentRequest`. Update every renamed call site and test.
  - Rule 02 message line: the two requests, `comment:saved`, and the one-answer rule. (Rule 05 is
    updated once, in step 6.)
  - Done when `src/host/chromeMessages.test.ts` passes for each of these:
    - each new request parses;
    - `status: 'sent'`, a bad `id`, a missing `body` and a bad `requestId` are each rejected;
    - `commentRequestId` returns the id for all three types and undefined for `frame:place`;
    - `commentRequestType` returns `comment:reply` for a malformed reply and undefined for
      `frame:place` or a non-object;
    - `commentRequestErrorMessage`: `CommentNotFoundError` gives `This comment no longer
      exists.`; an `InvalidArgsError` (reply cap) gives its own message; a plain `Error` gives
      the change fallback for reply / set-status and the create fallback for create.

    Also `hostMessages.test.ts` passes for `comment:saved`, valid and without a `requestId`, and
    `pnpm verify` is green. No chrome sends these messages yet.

- [x] **2. Pure rules.**
  - New `src/webview/commentsPanel.ts` (+ `commentsPanel.test.ts`), with no DOM use. It holds
    `panelItems`, `unresolvedCount`, `relativeTime`, the action state (`openReply`, `editReply`,
    `closeReply`, `canSubmitReply`, `submitReply`, `submitStatus`, `answerAction`,
    `keepLiveActions`) and `liveRegionText`. Exact shapes and rules are in Data / contracts.
  - `src/webview/Toolbar.svelte`: the inline alternating no-break-space line in
    `pickAnnouncement` becomes `liveRegionText({text, sequence: pick.sequence})` (one rule, two
    live regions).
  - `src/webview/pins.ts`: `liveAnchor({anchors, comment})` (the one live-anchor lookup;
    `layoutPins` switches its inline `anchors.get(...)?.get(...)` to it), `jumpTarget` and
    `JUMP_FLASH_MS = 1500` (+ tests in `pins.test.ts`).
  - `src/webview/stageGeometry.ts`: `fitZoom`, extracted from `fitStageView` (which then uses
    it), and `jumpStageView` (+ tests in `stageGeometry.test.ts`).
  - Done when unit tests pass for each of these, and `pnpm verify` is green:
    - grouping: unresolved (open and sent) then resolved, each in `comments.json` order;
    - `panelItems`: a badge from a live `box: null` beats disk flags (via `pinBadge`); `canJump`
      is false for a frame that is absent or a tile; the label falls back to the frame id when
      the frame is absent or its label is empty;
    - `relativeTime` boundaries: 59 s gives "just now"; 60 s gives "1 minute ago"; 24 h gives
      "yesterday"; a future time gives "just now"; an unparsable string gives undefined;
    - actions:
      - a blank or whitespace-only reply sends nothing;
      - a second request while one is pending sends nothing;
      - `submitStatus` sends `resolved` for open and for sent, and `open` for resolved;
      - a matching `comment:saved` empties the composer but leaves it open (reply), or announces
        "Comment resolved." / "Comment reopened." (status);
      - a matching `ui:error` keeps the reply text and sets the error;
      - a non-matching answer, or a `ui:error` with no `requestId`, returns the same object;
      - `closeReply` while a reply is pending changes nothing; while only a status request is
        pending it closes the composer;
      - `keepLiveActions` drops ids that are no longer listed, and returns the same object when
        the update carries `error` (typed text survives a transient read failure);
    - `liveAnchor`: undefined for a page comment and for an unknown frame or id;
    - `jumpTarget` for each case:
      - page comment: no `fit`, outline is the whole frame;
      - live `box`: `fit` is that box, outline is `visible`;
      - live `visible: null`: no outline;
      - live `box: null`, or no live answer: the stored rect;
      - a box outside the frame, or with zero width or height: no `fit`, center is the pin
        clamped into the frame;
    - `fitZoom`: undefined for a zero-size box or a viewport no larger than `2 × FIT_PADDING`;
      `fitStageView`'s existing tests stay green;
    - `jumpStageView`:
      - keeps the zoom when the target fits, and zooms out to fit when it doesn't;
      - never zooms in;
      - an undefined `fitZoom` keeps the zoom;
      - the center lands at the viewport center.

- [x] **3. Actions in the pin thread, and the live region.**
  - New `src/webview/CommentCard.svelte`: one comment as a view. Props and markup are in
    Data / contracts. Text only, never `{@html}`.
  - `src/webview/CommentThread.svelte` renders `CommentCard` (`surface: 'thread'`), then its
    Close button. Focus on open stays on Close. Its Escape handler ignores events that are
    already `defaultPrevented`, so the first Escape in the composer closes only the composer and
    a second one closes the thread. Props: the existing ones plus `now`, `action`, and the
    card's reply and status callbacks, passed through unchanged.
  - `src/webview/hostBridge.svelte.ts`: `postCommentCreate` becomes
    `postCommentRequest(message: CommentRequestMessage)`, with the same `$state.snapshot`. Update
    `handleAdd`'s call site.
  - `src/webview/App.svelte`, wiring only:
    - `actions: CommentActions` (empty map), `announcement: {text: string; sequence: number}`
      (`{text: '', sequence: 0}`), and `now: number` (`Date.now()`) state. One `$effect` runs a
      60 s `setInterval` that sets `now = Date.now()`, with `clearInterval` cleanup;
    - every announcement sets `announcement = {text, sequence: announcement.sequence + 1}`;
    - the reply / status handlers call the rules with `requestId: crypto.randomUUID()` (as
      `handleAdd` does) and post the returned message through `postCommentRequest`;
    - `comment:saved` → `answerAction`. `ui:error` → both `answerDraft` (unchanged) and
      `answerAction` (UUIDs never cross-match). `ui:error` has no other surface: it shows only
      inline where its `requestId` matches;
    - `comments:updated` → `keepLiveActions({actions, comments, error})` as well;
    - the one comments live region, a root node after `Stage`:
      `<span class="visually-hidden" aria-live="polite">{liveRegionText(announcement)}</span>`.
      It is always mounted, so it announces whether or not the panel is open;
    - `.visually-hidden` becomes one global rule in App's `<style>` (`:global(.visually-hidden)`,
      the same declarations), and Toolbar's scoped copy is deleted.
  - `tests/browser/pins.spec.ts`: the thread test no longer asserts that Close is the only
    button. It asserts Reply, Resolve and Close.
  - Done when `pnpm test:browser` passes the step 3 cases in `tests/browser/commentsPanel.spec.ts`
    (Testing) and the updated pins spec, and `pnpm verify` is green.

- [x] **4. Comments panel.**
  - New `src/webview/CommentsPanel.svelte` (Data / contracts → Panel view): an `<aside>` that
    precedes `Stage` in the DOM and sits on the right through CSS `order`; two groups, rendered
    only while open; empty and error states; and focus kept across list updates.
  - `src/webview/Toolbar.svelte`: new props `commentsPanelOpen: boolean`,
    `unresolvedCount: number` and `onToggleCommentsPanel: () => void`. A "Comments" toggle button
    right after the Comment-mode toggle, with `aria-expanded={commentsPanelOpen}` and
    `aria-controls="cd-comments-panel"`. Its text is `Comments (N)` with N = `unresolvedCount`,
    or `Comments` when N is 0. It is never disabled.
  - `src/webview/hostBridge.svelte.ts`: `readSavedCommentsPanelOpen()` (`true` only when the saved
    state's `commentsPanelOpen === true`) and `saveCommentsPanelOpen(open)`. Both saves keep the
    other key: `setState({...currentRecord, key: value})`, so the stage view and the panel state
    never erase each other.
  - `src/webview/App.svelte`: `commentsPanelOpen` state (default closed, restored from webview
    state); `panelItems` derived from `comments`, `anchors` and `displayFrames`. Markup order:
    Toolbar, Banners, `<p class="empty">` (unchanged, outside the row), then
    `<div class="workspace">` holding `CommentsPanel` then `Stage`, then the live region. CSS:
    `.workspace { display: flex; flex: 1 1 auto; min-height: 0; }` (a row in the
    `#svelte-root` column). `Stage.svelte` `.viewport` gains `min-width: 0`; its
    `flex: 1 1 auto` now grows across the row and the row's default stretch keeps its height. The
    stage shrinks when the panel opens, and the existing ResizeObserver (`onViewportSize`)
    updates `viewportWidth` / `viewportHeight` and re-clamps the view. The comment and thread
    popovers already place themselves with those sizes (`placePopover`), so they stay inside
    the narrower stage.
  - Done when `pnpm test:browser` passes the step 4 cases and `pnpm verify` is green.

- [x] **5. Click to jump.**
  - `CommentsPanel`: the target chip is a button when `canJump`, and calls `onJump(id)`. The chip
    is the only jump control.
  - `App.svelte` `handleJump(id)`:
    - `frame` = the `displayFrames` entry with the comment's `frameId`, only when that id is in
      `liveIframeIds(frames)`;
    - stops when the comment, that `frame` or `committedView` is missing, or `viewportWidth` /
      `viewportHeight` is 0;
    - otherwise runs `jumpTarget({comment, live: liveAnchor({anchors, comment}), frame})`, then
      `commitStageView(jumpStageView({view: committedView, center, fitZoom, viewportWidth,
      viewportHeight}))`, with `center` moved to stage coordinates (`frame.x + center.x`,
      `frame.y + center.y`) and `fitZoom` from `fitZoom({width, height, viewportWidth,
      viewportHeight})` when `fit` exists. The sizes are App's `viewportWidth` / `viewportHeight`
      (Stage's ResizeObserver), the same ones `commitStageView` clamps with;
    - then sets `flash = {commentId, sequence}`.
  - `flashOutline` is derived through `frameOutline` from the current `jumpTarget(...).outline`,
    so it follows pan, zoom and new `cd:anchor-rects`. It is undefined when the comment or its
    live frame is gone. One `$effect` clears `flash` after `JUMP_FLASH_MS` and cancels the timer
    when it re-runs.
  - `Overlay.svelte`: a third outline, `flash`, on an element with `data-cd-flash`.
  - Done when `pnpm test:browser` passes the step 5 cases and `pnpm verify` is green.

- [x] **6. Docs and the full gate.**
  - Rule 05 owner catalog (the one update for this feature):
    - `commentsPanel.ts` rules and the `CommentsPanel.svelte` / `CommentCard.svelte` views;
    - `liveAnchor` / `jumpTarget` / `JUMP_FLASH_MS` (pins.ts) and `fitZoom` / `jumpStageView`
      (stageGeometry.ts);
    - `answerCommentRequest`, `commentRequestType` / `commentRequestId` /
      `commentRequestErrorMessage` (chromeMessages.ts), replacing the old names;
    - `toSafeArtboardErrorMessage` now in `src/disk/errors.ts`;
    - `postCommentRequest` and the panel-state save in hostBridge;
    - `liveRegionText` as the one alternating live-region rule, and App's global
      `.visually-hidden`.
  - `blueprint/reference/0.3-comments-plan.md`: the "Message contract after 0.3" lines for
    `comment:reply` / `comment:set-status` (with `requestId`) and `comment:saved`. Add an "8g as
    shipped" block listing the deviations from Notes.
  - Done when `pnpm verify` and `pnpm test:browser` are both green, and
    `grep` finds every name the docs add in `src/`.

- [x] **7. Audit follow-ups (F-84 to F-93, except F-90).** Each repaired finding is marked
  `fixed` in `blueprint/context/findings.md`; only a later `/audit` closes it.
  - Host: F-93, the dispatch in `answerCommentRequest` ends in a compile-time exhaustiveness
    check and returns early when no request type is claimed (no `'comment:create'` default).
    F-84, a colocated `src/host/panelComments.test.ts` with `vi.mock('vscode')` (precedent:
    `src/panel/artboardChromeHtml.test.ts`): a bad `requestId` posts nothing; an untrusted
    workspace posts one `ui:error` and writes nothing; a malformed reply posts one `ui:error`
    with the change copy; create answers `comment:added`, reply and set-status answer
    `comment:saved`, each once and before the `comments:updated` refresh. F-92, one assert per
    type for `malformedRequestMessage`.
  - Chrome: F-86, `focusedItem` records nothing unless `document.hasFocus()`. F-87, Escape on
    the composer's buttons closes only the composer (one key handler on a wrapper around the
    textarea and both buttons; Enter-to-add stays on the textarea). F-88, the status button
    gets the same `aria-describedby` as the textarea while there is an error. F-89, the jump
    button's name becomes `Show on canvas: {frameLabel} · {targetChipText}`. F-92,
    `canSubmitReply` accepts exactly `MAX_COMMENT_BODY_CHARS`.
  - Tests: F-85, the panel-wheel browser test wheels over a frame first, then over the panel
    within 1 s, and fails with the aside's `overscroll-behavior` removed. F-91, the reload test
    also asserts the saved state right after a toggle with no frames posted. F-87 gets a browser
    case (Escape on Cancel keeps the thread open).
  - F-90 stays `unverified` (no profile shows a cost). F-86 still needs the F5 check in its
    entry.
  - Done when `pnpm verify` and `pnpm test:browser` are both green.

## Files / areas

- Host: `src/host/chromeMessages.ts` (+ test), `src/host/panelComments.ts`,
  `src/host/artboardDisk.ts` (import only), `src/panel/openArtboardPanel.ts`,
  `src/host/panelOutbox.ts` (answer type only), `src/extension.ts`.
- Disk: `src/disk/errors.ts` (`toSafeArtboardErrorMessage` moves in; no behavior change).
- Chrome contract and bridge: `src/webview/hostMessages.ts` (+ test),
  `src/webview/hostBridge.svelte.ts`.
- Chrome rules: new `src/webview/commentsPanel.ts` (+ test); `src/webview/pins.ts` (+ test);
  `src/webview/stageGeometry.ts` (+ test).
- Chrome views: new `src/webview/CommentCard.svelte`, new `src/webview/CommentsPanel.svelte`,
  `CommentThread.svelte`, `Toolbar.svelte`, `Overlay.svelte`, `Stage.svelte` (one CSS line, and
  a `flashOutline` prop passed to `Overlay`, which Stage renders), `App.svelte`.
- Browser fixture: new `fixtures/jump.html` (a frame larger than the stage with a centered and a
  tall target for the step 5 cases); `tests/browser/harness.ts` (`openHarness` takes a saved
  state, so a second open acts as a reload).
- Browser tests: new `tests/browser/commentsPanel.spec.ts` (reuse `tests/browser/harness.ts` and
  the `pins.spec.ts` comment factory pattern), `tests/browser/pins.spec.ts` (one assertion).
- Docs: `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`,
  `blueprint/reference/0.3-comments-plan.md`.
- Unchanged: the rest of `src/disk/**` (`replyToComment` and `setCommentStatus` already exist,
  take the lock and check the body before it; their status and cap rules are covered in
  `comments.test.ts`, including "replyToComment keeps the status"), `src/mcp/**`,
  `skills/cursor-design/SKILL.md`, `src/webview/frame/**`.

## Data / contracts

### Messages (host ↔ chrome)

```ts
// src/webview/hostMessages.ts
export type CommentReplyMessage = {
	type: 'comment:reply';
	requestId: string;
	id: string;
	body: string;
};
export type CommentSetStatusMessage = {
	type: 'comment:set-status';
	requestId: string;
	id: string;
	status: 'open' | 'resolved';
};
export type CommentRequestMessage =
	| CommentCreateMessage
	| CommentReplyMessage
	| CommentSetStatusMessage;
// Success answer to comment:reply and comment:set-status (comment:create keeps comment:added).
export type CommentSavedMessage = { type: 'comment:saved'; requestId: string };
```

Host boundary (`parseChromeMessage`):

- `requestId`: `REQUEST_ID_PATTERN` (existing).
- `id`: `COMMENT_ID_PATTERN`.
- `body`: a string, like `comment:create`'s `body`. The chrome sends it trimmed and capped by
  `maxlength`; the disk lib's `requireCommentBody` trims again and requires 1 to
  `MAX_COMMENT_BODY_CHARS` characters before it takes the lock.
- `status`: exactly `open` or `resolved`.

Answer rule (same as `comment:create`):

- Every attempt that has a valid `requestId` gets exactly one answer: `comment:saved` or
  `ui:error {requestId, message}`. It is posted only while the chrome is ready and never
  replayed.
- An attempt without a valid `requestId` is logged and gets no answer.
- On success, the answer is posted before `postPanelComments` runs, so `comment:saved` arrives
  before the `comments:updated` it causes.
- A no-op status change (already in that state, for example after the Agent resolved it first)
  still answers `comment:saved`.

Failure copy (`ui:error.message`). Constants live in `src/host/chromeMessages.ts`:

| Failure | Copy |
|---|---|
| untrusted workspace | `UNTRUSTED_WORKSPACE_MESSAGE` (existing) |
| no folder | `NoWorkspaceError` message (existing) |
| malformed reply / set-status (`MALFORMED_CHANGE_MESSAGE`) | `Could not save the change. Try again.` |
| malformed create (`MALFORMED_CREATE_MESSAGE`, moved) | unchanged |
| `CommentNotFoundError` (`COMMENT_GONE_MESSAGE`) | `This comment no longer exists.` |
| reply cap, blank body | existing `InvalidArgsError` copy ("This comment has the maximum number of replies.", "Comment text must be 1 to 2000 characters.") |
| corrupt or newer `comments.json`, lock busy | existing domain messages |
| anything else, reply / set-status (`CHANGE_FALLBACK_MESSAGE`) | `Could not save the change. Check the Output panel: Cursor Design.` |
| anything else, create (`CREATE_FALLBACK_MESSAGE`, moved) | unchanged |

`commentRequestErrorMessage({type, error})` = `COMMENT_GONE_MESSAGE` when `error` is a
`CommentNotFoundError` (never the Agent copy that says to call `list_comments`), else
`toSafeArtboardErrorMessage(error, fallbackFor(type))`.

### Chrome rules (`src/webview/commentsPanel.ts`)

```ts
export type CommentAction = {
	// Composer text; undefined = composer closed.
	reply?: string;
	// The one request in flight for this comment.
	pending?:
		| { requestId: string; kind: 'reply' }
		| { requestId: string; kind: 'status'; status: 'open' | 'resolved' };
	// The last failed request's host copy.
	error?: string;
};
// Keyed by comment id. An entry with no reply, pending or error is deleted.
export type CommentActions = ReadonlyMap<string, CommentAction>;

export type PanelItem = {
	comment: PostedComment;
	badge: PinBadge | undefined; // pinBadge({comment, live: liveAnchor(...)})
	frameLabel: string; // drawn frame's label; frame id when absent or empty
	canJump: boolean; // the frame is a live iframe (liveIframeIds)
};
```

- `panelItems({comments, anchors, frames})` → `{unresolved: PanelItem[], resolved: PanelItem[]}`.
  `unresolved` holds open and sent, and `resolved` holds resolved, each in `comments.json` order.
  `unresolvedCount(comments)` is the length of the first group.
- `relativeTime({iso, now})` → `string | undefined`, `now` in epoch ms.
  - Unparsable (`Date.parse` is NaN): undefined.
  - Under 60 s, or in the future: `just now`.
  - Otherwise `Intl.RelativeTimeFormat('en', {numeric: 'auto'})` with whole floored units:
    minutes under 60 min, hours under 24 h, days under 30 days, months (days / 30) under 365
    days, then years (days / 365).
- Busy rules, one definition each:
  - **reply pending** = `pending?.kind === 'reply'`;
  - **anything pending** = `pending !== undefined`.
- `openReply` (no change when already open), `editReply` (ignored while a reply is pending),
  and `closeReply` (no change while a reply is pending; otherwise closes and clears `error`).
  - `canSubmitReply(action: CommentAction | undefined)`: the composer is open, the trimmed text
    is non-empty and at most `MAX_COMMENT_BODY_CHARS`, and nothing is pending for this comment.
- `submitReply({actions, id, requestId})` → `{actions, message?: CommentReplyMessage}`.
  - A message only when `canSubmitReply`.
  - The body is trimmed.
  - Sets `pending` and clears `error`.
- `submitStatus({actions, comment, requestId})` → `{actions, message?}`.
  - The target is `open` for a resolved comment, otherwise `resolved`.
  - No message while anything is pending for the comment.
  - Clears `error`.
- `answerAction({actions, answer: CommentSavedMessage | UiErrorMessage})` →
  `{actions, announcement?: string}`.
  - Matches only the entry whose `pending.requestId` equals `answer.requestId`. No match: the same
    `actions` object and no announcement.
  - Saved reply: `reply: ''` (the composer stays open and empty), then announces `Reply added.`
  - Saved status: announces `Comment resolved.` or `Comment reopened.`
  - `ui:error`: keeps `reply`, sets `error: message`, and announces the message.
  - Every match clears `pending`.
- `keepLiveActions({actions, comments, error})`: when `error` is set, returns `actions`
  unchanged (the list is not usable, and typed text must survive a transient read failure).
  Otherwise drops ids that are no longer listed, so a late answer finds nothing. Returns the
  same object when nothing was dropped.
- `liveRegionText({text, sequence})`: `text` plus a trailing no-break space on even sequences, so
  repeated text is announced again. Toolbar's pick announcement uses it too.

### Jump rules

- `liveAnchor({anchors, comment})` (pins.ts) → the frame's live answer for an element comment,
  `anchors.get(comment.frameId)?.get(comment.id)`, and undefined for a page comment. `layoutPins`,
  `panelItems` and `handleJump` all use it.
- `jumpTarget({comment, live, frame: {width, height}})` →
  `{center: StagePoint; fit: {width; height} | undefined; outline: FrameRect | undefined}`, all
  frame-local CSS px. `frameRect = {x: 0, y: 0, width, height}`.
  - Page comment:
    - `center` = `pinPoint` clamped into `frameRect`;
    - `fit` undefined (the zoom is kept);
    - `outline` = `frameRect`.
  - Element comment:
    - `box` = `live?.box ?? comment.rect`;
    - `fitBox` = `box` intersected with `frameRect`. An absent box, or an intersection with zero
      width or zero height, gives none;
    - `center` = the center of `fitBox`, else `pinPoint` clamped into `frameRect`;
    - `fit` = `fitBox` size;
    - `outline` = `live.visible ?? undefined` when `live` exists with a non-null `box`, else
      `comment.rect ?? undefined`. So a missing target outlines its stored position, and a
      target scrolled out of its box gets no outline.
- `fitZoom({width, height, viewportWidth, viewportHeight})` → `number | undefined`: undefined
  when `width` or `height` is at most 0, or the viewport is no larger than `2 × FIT_PADDING` on
  either axis; else `min((viewportWidth − 2P) / width, (viewportHeight − 2P) / height)`,
  unclamped. `fitStageView` keeps its behavior: it returns its default view where `fitZoom` is
  undefined, and otherwise uses `clampStageZoom(min(fitZoom, 1))`.
- `jumpStageView({view, center, fitZoom, viewportWidth, viewportHeight})` → `StageView`, where
  `center` is in stage coordinates.
  - `zoom` = `clampStageZoom(min(view.zoom, fitZoom ?? view.zoom))`. It never zooms in.
  - `x = viewportWidth / 2 − center.x × zoom`, and the same for `y`.
  - App commits it through `commitStageView`, which clamps as usual.
  - Why not `zoomStageTo`: it keeps one screen point fixed while zooming; the jump moves a stage
    point to the viewport center, so it is a separate job. Why not `fitStageView`: it caps the
    zoom at 1, which would zoom out a target that already fits at 200%.
- Flash: App state `flash: {commentId, sequence} | undefined`, cleared after `JUMP_FLASH_MS`. It
  is drawn by `Overlay` (`data-cd-flash`, 2px solid
  `var(--vscode-editorInfo-foreground, var(--vscode-focusBorder))`), pointer-events none like the
  other outlines.

### Comment card (`CommentCard.svelte`)

- Props:
  - `comment`, `badge`, `now: number`;
  - `action: CommentAction | undefined`;
  - `surface: 'panel' | 'thread'`;
  - `target: {frameLabel: string; canJump: boolean} | undefined` (panel only);
  - callbacks `onJump?`, `onReplyOpen`, `onReplyInput(text)`, `onReplyCancel`, `onReplySubmit`,
    `onToggleStatus`.

  The root carries `data-cd-comment-card`.
- The composer is one per comment, not per surface: `actions` is keyed by comment id, so a
  composer open in the panel is open in the thread too, with the same text. This is intended;
  do not add per-surface state.
- Header:
  - Panel, when `canJump`: the target is a `<button data-cd-focus="jump">` whose text is
    `{frameLabel} · {targetChipText}` (title = selector) and whose accessible name is
    `Show on canvas: {frameLabel} · {targetChipText}` (the visible text is part of the name).
  - Panel, when not `canJump`: the same text in a span, plus `Frame not shown.`.
  - Thread: the chip span as today.
  - Then `You`, `<time datetime={createdAt} title={new Date(createdAt).toLocaleString()}>
    {relativeTime}</time>` (omitted when undefined; no test asserts the title), the status
    (`THREAD_STATUS_COPY`), and the badge text (`THREAD_BADGE_COPY`).
- Body (`white-space: pre-wrap`), then the replies `<ol>`: each `<li>` shows `You` or `Agent`, its
  time and its body.
- Actions:
  - `Reply` (`data-cd-focus="reply"`), shown only while the composer is closed. A click calls
    `onReplyOpen`, then after `tick()` focuses this card's textarea (never on mount, so the panel
    and the thread never fight over focus). Reply is offered even when the reply cap is reached;
    the host's `ui:error` then explains it.
  - One status `<button data-cd-focus="status">` whose label is `Reopen` for resolved and
    `Resolve` otherwise.
- Composer (while `action.reply !== undefined`):
  - A `<textarea aria-label="Reply" data-cd-focus="reply-text">` with
    `maxlength={MAX_COMMENT_BODY_CHARS}`. It is `readonly` while a reply is pending, and has
    `aria-describedby` pointing at the error when there is one.
  - `Add reply` (`data-cd-focus="reply-send"`) and `Cancel` (`data-cd-focus="reply-cancel"`).
  - Keys go through `popoverKeyAction({... , bodyEmpty: false, inTextarea: true})`:
    - `add` → `preventDefault`, then `onReplySubmit`;
    - `cancel` → `preventDefault`, then the close path below.
  - Close path, shared by Escape and the Cancel button (click or keyboard): while a reply is
    pending it does nothing; otherwise `onReplyCancel`, then after `tick()` focus this card's
    Reply button.
- Busy state: action buttons use `aria-disabled="true"` (never `disabled`, which would drop
  focus to body), and their click then does nothing:
  - `Add reply`: while `canSubmitReply` is false;
  - `Cancel`: while a reply is pending;
  - status: while anything is pending.
- Error: `<p class="error" id={$props.id()-based}>{action.error}</p>` below the actions. Ids come
  from `$props.id()`, because the same comment can render in the panel and the thread at once.
- Resolved cards (panel) are dimmed: text uses `--vscode-descriptionForeground`.

### Panel view (`CommentsPanel.svelte`)

- Props: `open: boolean`, `items: {unresolved: PanelItem[]; resolved: PanelItem[]}`,
  `error: string | undefined`, `now: number`, `actions: CommentActions`, and callbacks `onJump`,
  `onReplyOpen(id)`, `onReplyInput(id, text)`, `onReplyCancel(id)`, `onReplySubmit(id)`,
  `onToggleStatus(id)`.
- `<aside id="cd-comments-panel" aria-label="Comments" tabindex="-1" data-cd-comments-panel
  hidden={!open}>`, always mounted (so `aria-controls` always resolves):
  - `flex: none; width: 20rem; max-width: 50%`. No `display` declaration, so `[hidden]` hides it;
  - `overflow: auto; overscroll-behavior: contain`;
  - `border-left` `--vscode-panel-border`, background `--vscode-sideBar-background`;
  - `order: 1`, so it sits to the right of the stage while it comes first in the DOM (Tab reaches
    the panel before the stage's labels, handles and pins, as the 0.3 plan's "focus order
    panel → stage" asks). `margin-left: auto` keeps it on the right when the stage is hidden.
- Content renders only while `open` (`{#if open}`), so a closed panel costs nothing on each
  `cd:anchor-rects`. Each non-empty group gets an `<h2>` (`Unresolved (N)`, `Resolved (N)`) and
  an `<ol>`. Each `<li data-cd-comment-item={id} data-cd-status={status}>` holds one
  `CommentCard` (`surface: 'panel'`).
- No comments and no error: `No comments yet. Press C, then click an element to add one.` An
  error from `comments:updated`: `Comments are unavailable.` (the banner carries the detail).
- Focus kept across list updates (a `$effect.pre` / `$effect` pair on `items`):
  - Every pre-pass overwrites one record: `{id, key}` when `document.activeElement` is inside a
    `[data-cd-comment-item]` (`key` = the focused element's `data-cd-focus`), else undefined.
  - The post effect reads the record and clears it. It does nothing unless the record is set
    and `document.activeElement` is now `body` or null. Then:
    - when the item still exists, it focuses
      `[data-cd-comment-item="${CSS.escape(id)}"] [data-cd-focus="${key}"]` with
      `preventScroll`, falling back to that item's status button, and puts a textarea caret at
      the end;
    - when the item is gone, it focuses the aside.

  This covers Resolve / Reopen moving an item between the groups, and the Agent resolving a
  comment while you type a reply to it. Focus that is outside the panel is never moved. Reply
  text lives in App's `actions`, so it survives the move.

### Webview state

`vscodeApi.setState({stageView, commentsPanelOpen})`. Each save keeps the other key. A missing or
non-boolean `commentsPanelOpen` reads as closed. Nothing new on disk.

## Testing

- Unit (`vp test`): the step 1 and 2 cases. Edge cases over volume (rule 09). These must fail when
  their guard is deleted:
  - `sent` rejected at the boundary;
  - `commentRequestId` for all three types; `commentRequestType` for a malformed reply;
  - `commentRequestErrorMessage` remaps `CommentNotFoundError`;
  - `comment:saved` without a `requestId` dropped;
  - a non-matching answer returns the same object;
  - a second request while one is pending sends nothing;
  - an error keeps the reply text;
  - `keepLiveActions` drops removed ids, and keeps everything on an update with `error`;
  - `relativeTime` with a future or invalid time;
  - `jumpTarget` with a box outside the frame, and with `visible: null`;
  - `jumpStageView` never zooms in; `fitZoom` is undefined for a zero-size box.
- Browser (`pnpm test:browser`), new `tests/browser/commentsPanel.spec.ts`. Assert through roles,
  `data-cd-*` hooks, captured posted messages and element boxes, never pixels.
  - Step 3 (thread):
    - Resolve posts one `comment:set-status {status: 'resolved'}`, and a second click while
      pending posts nothing. After `comment:saved` plus a resolved `comments:updated`, the button
      reads Reopen and keeps focus. Reopen posts `status: 'open'`. A sent comment offers
      Resolve.
    - Reply opens a focused composer. Enter on blank text posts nothing. Shift+Enter adds a
      newline. Enter posts `comment:reply` with the trimmed body. The textarea is readonly while
      pending. `comment:saved` empties it and keeps it open and focused. The live region reads
      "Reply added.".
    - `ui:error` with the request's `requestId` keeps the text, shows the error linked through
      `aria-describedby`, and announces it. A `ui:error` with another `requestId` changes
      nothing.
    - The first Escape in the composer closes only the composer and focuses Reply. The second
      Escape closes the thread. Clicking Cancel also focuses Reply.
    - Typing `c` in the reply textarea inserts the letter and leaves Comment mode as it was;
      Escape in the composer while Comment mode is on closes the composer and Comment mode stays
      on.
    - A reply body with markup shows as literal text.
  - Step 4 (panel):
    - The toggle sets `aria-expanded`, the stage viewport gets narrower, and `savedState` holds
      both `stageView` and `commentsPanelOpen: true`. After a reload the panel is still open.
    - Order: open and sent under Unresolved in file order, resolved under Resolved with
      `data-cd-status="resolved"`. The toolbar reads `Comments (N)`.
    - Item content: `You`, `time[datetime]` equal to `createdAt`, chip text with the frame
      label, badge copy, and an Agent reply labelled `Agent`.
    - Keyboard Resolve in the panel puts focus on that comment's Reopen in the Resolved group. A
      `comments:updated` that resolves a comment while you type its panel reply keeps focus in
      that textarea and keeps the text.
    - With focus outside the panel (on the stage viewport, and on body), a `cd:anchor-rects`
      and a `comments:updated` leave `document.activeElement` unchanged.
    - A `comments:updated` with `error` keeps an open composer's text.
    - With the panel open, a pin's thread popover box does not overlap the panel's box.
    - A wheel over the open panel with a short list leaves the saved `stageView` unchanged. If
      it fails, the panel stops the wheel itself (an `onwheel` that only stops propagation),
      and the spec's Notes record it.
    - A comment whose frame is absent is listed with `Frame not shown.` and no jump button.
    - The empty state and the error state copy.
  - Step 5 (jump), using a fixture whose fit zoom stays above `MIN_STAGE_ZOOM`:
    - Jumping to an element comment that fits puts its target's center at the viewport center
      (±1 px) with the zoom readout unchanged. The fixture places the target near the middle of
      a frame larger than the viewport, so `clampStageView` does not move the result. The
      `[data-cd-flash]` box equals the target's box, and the flash is hidden within 3 s (an
      expect timeout, not a sleep).
    - A target taller than the viewport at 200% zooms out until it fits.
    - A missing target (live `box: null`) flashes at its stored rect.
    - A page comment flashes the whole frame and keeps the zoom.
  - `pins.spec.ts`: the thread shows Reply, Resolve and Close.
- F5 (Cursor-only, recorded in `/check`):
  - Reply, Resolve and Reopen write `comments.json`, and `get_comment` in an Agent chat shows the
    user reply.
  - A reply to a resolved comment keeps it resolved.
  - An Agent `resolve_comment` note appears as an Agent reply in the panel and the thread.
  - The panel state survives a hide / show (webview reload).
  - No CSP violation in the webview console.
- Not claimed: VoiceOver output (the live region and labels are asserted by role and text only).

## Notes for the AI

- **Plan deviations**, recorded in step 6:
  - `requestId` on `comment:reply` and `comment:set-status`, plus the `comment:saved` answer. The
    plan listed `{id, body}` / `{id, status}` and allowed omitting `requestId`. Without it, a
    failure cannot be tied to the composer that sent it, so typed text would be lost and buttons
    could stay stuck.
  - Copy prompt stays in 8h.
  - The target chip is the only jump control (the plan says "click a comment"): a whole-card
    click target would swallow the card's own buttons and text selection.
  - The jump centers the target box (the pin is always inside it) rather than the pin, so both
    stay on screen, and uses `jumpStageView` instead of the plan's `zoomStageTo` (see Jump
    rules). A page comment centers its pin.
  - The flash follows the frame's latest `cd:anchor-rects`, falling back to the stored rect.
  - "Focus order panel → stage" is read as DOM / Tab order: the panel comes first, and CSS
    places it on the right.
- `App.svelte` is already ~690 lines (rule 08 aims for ~300). Add wiring only; every decision
  lives in `commentsPanel.ts`, `pins.ts`, `stageGeometry.ts` or `chromeMessages.ts`, with tests.
- Reuse, don't re-derive: `pinBadge`, `pinPoint`, `liveAnchor`, `targetChipText`,
  `THREAD_STATUS_COPY`, `THREAD_BADGE_COPY`, `frameOutline`, `liveIframeIds`, `popoverKeyAction`,
  `placePopover`, `clampNumber`, `clampStageZoom`, `FIT_PADDING`, `fitZoom`, `commitStageView`,
  `toSafeArtboardErrorMessage`, and `postPanelComments`.
- Buttons use `aria-disabled`, not `disabled`: Chromium drops focus to body when a focused button
  becomes disabled.
- Comment-mode keys need no new guard: App's window keydown passes `inTextEntry` for a textarea,
  so `modeKeyAction` ignores `c` and Escape typed in a composer. The step 3 browser case pins
  that down.
- `ponytail:` a lost answer (the host dies between the request and its answer) leaves that
  comment's `pending` set until the webview reloads. The host always answers while the chrome is
  ready, and a reload resets `actions`, so no timeout is added. Put this comment on `pending` in
  `commentsPanel.ts`.
- An untrusted or folderless workspace posts `comments:updated {comments: []}` without `error`,
  so `keepLiveActions` drops every action there. Nothing can be written in that state, so this
  is accepted.
- A design script cannot reach these messages. They are chrome → host, and the frame → chrome
  allowlist is unchanged.
- Never render comment or reply data with `{@html}`.
- `comments.json` is never written by the chrome. Every write goes through the host and the disk
  lib, which takes the lock.
- `skills/cursor-design/SKILL.md` stays unchanged (no MCP change). `agentSkill.test.ts` must stay
  green.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":44778,"specSha256":"88121ddd5c8ee6e1a13238e9b71269b886adc37327a0c9628cf0bd692927202b","branch":"refs/heads/feature/comments-panel","head":"d72811dd367c9e53f3569ec84b794d71c5fc1650","baseRef":"refs/heads/main","baseCommit":"609701122872a1b5c55602b7581ad48f863b91f0","sourceTree":"e8726588286dd4909bb44ba910740ca3f1f16854","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8g/F-84 [P3] closed - createCommentFromChrome's untrusted-workspace refusal, answer ordering and one-answer rule have no automated check

**File:** src/host/panelComments.ts:59
**Found:** 2026-10-27 by independent /audit (scope: current; lens: tests, security)
**Why it matters:** The function decides, in order: no usable requestId (log only), untrusted workspace (refuse, never write), no folder, malformed message, then `addComment`. The write refusal for an untrusted workspace is a trust boundary (rule 07), and the spec accepted the missing F5 run for it ("no repeatable test observes the host refusal"). Nothing in `vp test` fails if the `isTrusted` check, its position before the parse, or the single-answer behaviour is removed. The file is glue by design, but the ordering is logic, and a `vi.mock('vscode')` unit test of two or three cases is possible without a display.
**Suggested fix:** Optional: a colocated `panelComments.test.ts` with a mocked `vscode` (untrusted gives one `ui:error` and no `addComment` call; a bad requestId posts nothing; a malformed message gives one `ui:error`). Or keep it as an F5 item. Needs the user's decision because the spec chose glue-without-test.
**Resolution:** fixed 2026-11-16 by /implement step 7. New src/host/panelComments.test.ts mocks `vscode` and the panel and disk modules and pins a bad requestId (nothing posted), the untrusted refusal (one `ui:error`, no write), a malformed reply (one `ui:error`, change copy), create / reply / set-status answering once with the right type before the `comments:updated` refresh, and a missing comment (one `ui:error`). Checked by breaking the `isTrusted` check and moving the refresh ahead of the write: both fail a test.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. src/host/panelComments.test.ts exists and pins a bad requestId (nothing posted or written), the untrusted refusal (one ui:error, no write), a malformed reply (change copy), create / reply / set-status each answering once before the comments:updated refresh, and CommentNotFoundError (one ui:error, no refresh). `vp test` green.

### 8g/F-85 [P2] closed - The wheel-over-panel browser test passes with its guard deleted

**File:** tests/browser/commentsPanel.spec.ts:482
**Found:** 2026-11-16 by /audit (scope: current; lens: tests)
**Why it matters:** The test wheels over the open panel without a frame wheel first, so `lastSinkGestureAt` stays `-Infinity` and `scrollSinkStep` never pans, with or without the aside's `overscroll-behavior: contain` (src/webview/CommentsPanel.svelte:164). A scratch Playwright probe (outside the repo) showed the guard is needed: within 1 s of a trackpad pan over a frame, a panel wheel panned the stage (y 20 → 220) once the aside's `overscroll-behavior` was set back to `auto`, and did not with the shipped CSS. Nothing in the suite pins that.
**Suggested fix:** In that test, first wheel over the frame (as the F-52 test in `tests/browser/stage.spec.ts` does), then wheel over the panel within 1 s and assert the saved `stageView` is unchanged.
**Resolution:** fixed 2026-11-16 by /implement step 7. The test (now "a wheel over the open panel right after a frame wheel leaves the saved stage view", tests/browser/commentsPanel.spec.ts) first wheels over frame A (outside its `.scroll-box`) and waits for the pan, then wheels over the panel inside the 1 s sink window. With the aside's `overscroll-behavior` set to `auto` it fails (saved `stageView` moves); restored, it passes.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. The browser test "a wheel over the open panel right after a frame wheel leaves the saved stage view" wheels over frame A, waits for the pan, then wheels over the panel inside the sink window and asserts the saved stageView unchanged; the aside keeps `overscroll-behavior: contain`. `pnpm test:browser` 104/104 green.

### 8g/F-86 [P2] closed - Panel focus restore may pull focus into an unfocused webview

**File:** src/webview/CommentsPanel.svelte:52
**Found:** 2026-11-16 by /audit (scope: current; lens: correctness, accessibility)
**Why it matters:** `focusedItem` records the item whenever `document.activeElement` is inside it, even when the webview itself does not have focus (the user moved to Cursor's Agent chat, so the iframe keeps its stale `activeElement`). The flagship flow is the Agent calling `resolve_comment` while the user types in chat: the item moves to Resolved, its `<li>` is recreated, `activeElement` falls to body, and `restoreFocus` calls `.focus()`. If the unfocused webview may take focus that way, keyboard focus jumps out of the chat, against the spec rule "Focus that is outside the panel is never moved". Playwright cannot model a separate focused host window, so this is unconfirmed.
**Suggested fix:** Record nothing in the pre-pass unless `document.hasFocus()` (one condition in `focusedItem`). Confirm under F5: an Agent `resolve_comment` while typing in chat, with the panel's last-focused control inside that comment.
**Resolution:** fixed 2026-11-16 by /implement step 7. `focusedItem` (src/webview/CommentsPanel.svelte) records nothing unless `document.hasFocus()`, so an unfocused webview never restores focus. No automated test (Playwright cannot model a separately focused host window); the F5 check is still owed: an Agent `resolve_comment` while typing in chat, with the panel's last-focused control inside that comment, must leave focus in chat.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. `focusedItem` (src/webview/CommentsPanel.svelte) returns undefined unless `document.hasFocus()`, so neither restore path (item control or aside) runs for an unfocused webview. Supporting reported F5 evidence from /check (user-observed, not reproduced here): an Agent resolve_comment note appeared live while the text cursor stayed in the Agent chat box.

### 8g/F-87 [P3] closed - Escape on the composer's buttons closes the whole thread

**File:** src/webview/CommentCard.svelte:108
**Found:** 2026-11-16 by /audit (scope: current; lens: correctness, accessibility)
**Why it matters:** Only the textarea's keydown prevents Escape. With focus on "Add reply" or "Cancel", Escape reaches `CommentThread`'s handler (src/webview/CommentThread.svelte:60) and closes the thread while the composer stays open in `actions`. The spec's "the first Escape in the composer closes only the composer" holds for the textarea only.
**Suggested fix:** Handle the cancel key on a wrapper around the textarea and both composer buttons, or record the textarea-only reading in the spec.
**Resolution:** fixed 2026-11-16 by /implement step 7. One keydown handler on a wrapper around the textarea and both composer buttons (src/webview/CommentCard.svelte) takes the cancel key; Enter adds only from the textarea. Pinned by the browser test "Escape on the composer Cancel button closes only the composer".
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. One keydown handler on the `.composer` wrapper (textarea and both buttons) prevents Escape and closes only the composer; CommentThread ignores `defaultPrevented` Escape. Pinned by "Escape on the composer Cancel button closes only the composer" (green).

### 8g/F-88 [P3] closed - A failed Resolve / Reopen is not linked to the status button

**File:** src/webview/CommentCard.svelte:197
**Found:** 2026-11-16 by /audit (scope: current; lens: accessibility)
**Why it matters:** `aria-describedby={errorId}` is set only on the textarea (line 205). A failed status request with the composer closed shows `.error` under the status button, but the button has no description; only the polite live region speaks the error once.
**Suggested fix:** Give the status button the same `aria-describedby={action?.error === undefined ? undefined : errorId}`.
**Resolution:** fixed 2026-11-16 by /implement step 7. The status button gets `aria-describedby={action?.error === undefined ? undefined : errorId}` (src/webview/CommentCard.svelte). Pinned by the browser test "a failed Resolve is the accessible description of the status button".
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. The status button carries `aria-describedby={errorId}` while `action.error` is set; pinned by "a failed Resolve is the accessible description of the status button" (green).

### 8g/F-89 [P3] closed - The jump chip's accessible name does not contain its visible text

**File:** src/webview/CommentCard.svelte:143
**Found:** 2026-11-16 by /audit (scope: current; lens: accessibility)
**Why it matters:** The visible text is `{frameLabel} · {chipText}` and the name is `Show on canvas: {frameLabel}, {chipText}`. With `·` versus `,` the visible label is not a substring of the name (WCAG 2.5.3 Label in Name), so speech-input users cannot say what they see. The spec prescribed this name, so the fix changes spec copy.
**Suggested fix:** Use the same separator in both, e.g. `Show on canvas: {frameLabel} · {chipText}`, and update the spec line.
**Resolution:** fixed 2026-11-16 by /implement step 7. The jump button's name is `Show on canvas: {frameLabel} · {chipText}`, the same separator as its visible text (src/webview/CommentCard.svelte). The browser test "a panel item shows author, time, target chip, badge and an Agent reply" asserts the new name.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. The jump button name is `Show on canvas: {frameLabel} · {chipText}`, matching its visible text; asserted by the panel item browser test (green).

### 8g/F-91 [P3] closed - The reload test does not pin saveCommentsPanelOpen's merge

**File:** tests/browser/commentsPanel.spec.ts:300
**Found:** 2026-11-16 by /audit (scope: current; lens: tests)
**Why it matters:** Opening the panel narrows the stage, so the ResizeObserver runs `commitStageView` → `saveStageView`, which writes `stageView` back after the toggle. A `saveCommentsPanelOpen` that dropped `stageView` (src/webview/hostBridge.svelte.ts:46) would still pass. Only `saveStageView`'s merge is pinned; the code is correct today.
**Suggested fix:** Assert the saved state right after toggling with no frames posted (`commitStageView` returns early while `bounds` is null), so only `saveCommentsPanelOpen` writes.
**Resolution:** fixed 2026-11-16 by /implement step 7. The reload test (now "the panel toggle keeps the saved view, narrows the stage, and both keys survive a reload") first seeds a `stageView`, toggles the panel with no frames posted, and asserts the saved state equals `{ stageView, commentsPanelOpen: true }`. It fails when `saveCommentsPanelOpen` drops the merge (probed, then restored).
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. The reload test seeds a stageView, toggles with no frames posted, and polls the saved state to equal `{stageView, commentsPanelOpen: true}`, so only saveCommentsPanelOpen writes and a dropped merge fails it (green).

### 8g/F-92 [P3] closed - Two copy and cap rules can break without a unit test failing

**File:** src/host/chromeMessages.ts:132
**Found:** 2026-11-16 by /audit (scope: current; lens: tests)
**Why it matters:** Swapping the create and change copy in `malformedRequestMessage` fails no test (chromeMessages.test.ts covers only `commentRequestErrorMessage`). In `canSubmitReply` (src/webview/commentsPanel.ts:177), `length <= MAX_COMMENT_BODY_CHARS` turned into `<` would refuse a 2000-character reply, and the only cap test checks MAX + 1 (commentsPanel.test.ts:130). Rule 09: a test earns its place when deleting its guard fails it.
**Suggested fix:** One assert per type for `malformedRequestMessage`, and `canSubmitReply({reply: 'x'.repeat(MAX_COMMENT_BODY_CHARS)}) === true`.
**Resolution:** Chrome half, 2026-11-16 by /implement step 7: src/webview/commentsPanel.test.ts asserts `canSubmitReply({ reply: 'x'.repeat(MAX_COMMENT_BODY_CHARS) })` is true (exactly the cap sends). host half done 2026-11-16 by /implement step 7: chromeMessages.test.ts asserts `malformedRequestMessage` per type (create gets the create copy, reply and set-status the change copy). The chrome half (`canSubmitReply` at exactly `MAX_COMMENT_BODY_CHARS`) is pending; status stays `open` until the coordinator sets it.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. Both halves are present: chromeMessages.test.ts asserts malformedRequestMessage per type, and commentsPanel.test.ts asserts canSubmitReply is true at exactly MAX_COMMENT_BODY_CHARS and false at +1. The earlier "pending" wording in this resolution is superseded.

### 8g/F-93 [P3] closed - The host dispatch's last branch is not exhaustive

**File:** src/host/panelComments.ts:114
**Found:** 2026-11-16 by /audit (scope: current; lens: quality)
**Why it matters:** The dispatch ends in `else if (message.type === 'comment:set-status')` with no `else`, and `type` defaults to `'comment:create'` (line 71) when no request type is claimed. Both are unreachable today (routing calls the handler only for a claimed type, and the parse must match it), but a fourth request type added later would refresh the list and post no answer for a valid `requestId` instead of failing to compile, breaking the one-answer rule silently.
**Suggested fix:** Close the chain with an exhaustiveness check (`message satisfies never` style on the remaining type, or a `switch` with a `never` default), and return early instead of defaulting `type`.
**Resolution:** fixed 2026-11-16 by /implement step 7. `answerCommentRequest` returns early (logged, no answer) when no request type is claimed, and the dispatch is a `switch` on `message.type` ending in `message satisfies never`, so a fourth request type fails to compile. Behavior for the three types is unchanged and pinned by the F-84 tests in src/host/panelComments.test.ts.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): closed. answerCommentRequest returns early (logged, no answer) when no type is claimed, and the dispatch is a `switch` ending in `message satisfies never`; `vp check` / svelte-check green.

## Independent review

**Status:** passed
**Target commit:** d72811dd367c9e53f3569ec84b794d71c5fc1650
**Base commit:** 609701122872a1b5c55602b7581ad48f863b91f0
**Base ref:** main
**Spec hash:** 88121ddd5c8ee6e1a13238e9b71269b886adc37327a0c9628cf0bd692927202b
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-17T08:50:31Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-17T08:54:00Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain --untracked-files=all`: pass (HEAD, merge base and spec hash match the request; only blueprint/context/review.md differs)
- `pnpm verify`: pass (vp check clean on 124 files, agent rules check, svelte-check, webview tests tsc, vp test 38 files / 487 tests, vp pack, webview build)
- `pnpm test:browser`: pass (104/104 Playwright Chromium, including tests/browser/commentsPanel.spec.ts and the updated pins.spec.ts)
- `pnpm knip`: pass (no unused files, exports or dependencies reported)

### Evidence

- Host boundary: `chromeMessageSchema` parses `comment:reply` / `comment:set-status` with `REQUEST_ID_PATTERN`, `COMMENT_ID_PATTERN` and `status` in {open, resolved}; `answerCommentRequest` orders requestId, trust, folder, parse-type match, then an exhaustive `switch` over `replyToComment` / `setCommentStatus` / `addComment` (none wrapped in `withWorkspaceLock`), answers before `postPanelComments`, and maps `CommentNotFoundError` to panel copy (src/host/chromeMessages.ts, src/host/panelComments.ts, src/disk/comments.ts:633-710).
- Chrome rules: pending guards, answer matching by requestId, `keepLiveActions` on error, `relativeTime`, `jumpTarget` / `fitZoom` / `jumpStageView` match the spec's Data / contracts; all comment data renders as text (no `{@html}` in the delta).
- Focus restore in CommentsPanel records only under `document.hasFocus()` and moves focus only when it fell to body; webview state saves keep the other key (hostBridge.svelte.ts).
- Reported (not reproduced) F5 evidence from /check on 2026-11-17: Reply / Resolve / Reopen wrote comments.json; reply kept a resolved comment resolved; Agent `resolve_comment` note appeared live while the cursor stayed in Agent chat; panel state survived hide / show; no CSP violation besides the dev-only source-map line.
- Fixed findings re-examined against the code and tests and closed: F-84, F-85, F-86, F-87, F-88, F-89, F-91, F-92, F-93.

### Findings

- None new. Closed this pass: F-84, F-85, F-86, F-87, F-88, F-89, F-91, F-92, F-93. F-90 stays `unverified` (P3). No P0 or P1 finding is `open` or `fixed`.

### Remaining risk

- F5-only behavior (Cursor focus with F-86's guard, CSP, hide / show, disk writes through the Extension Host) rests on the builder's /check report, not on this reviewer's observation.
- F-90 (panel item rebuild on each cd:anchor-rects / drag move with up to 500 comments) is unprofiled.
- VoiceOver output for the live region and labels is not claimed (asserted by role and text only).

## Try it now

Run or do:

Press **F5** (the Extension Development Host opens `fixtures/dev-workspace`), run **Cursor Design: Open Artboard**, and click **Comments** in the toolbar. On an open comment click **Reply**, type a note and press Enter, then click **Resolve**, then **Reopen**. Finally click a comment's target chip.

Expected:

The panel opens on the right with Unresolved and Resolved groups, and the toolbar reads `Comments (N)`. Your reply appears under the comment as `You`, and the composer stays open and empty. Resolve moves the comment to Resolved and its button reads Reopen; Reopen moves it back. The chip click pans the canvas so the target sits in the middle and flashes an outline around it for about a second and a half. `.cursor-design/comments.json` holds the reply and the final status.

This proves:

Reply, Resolve and Reopen write through the host to disk and come back to the panel and the pin thread, and click-to-jump finds a comment's element on the canvas.
