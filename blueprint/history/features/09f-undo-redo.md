# Feature: Undo/redo

**From build-plan:** feature 9f
**Build attempt:** 1
**Branch:** feature/undo-redo
**Status:** verified (pnpm verify 729 unit; test:browser 164/164 at normal load after the F-146 repair (earlier runs under heavy machine load had 1–2 different frame-load timeouts, each passing on rerun); pnpm gallery 198 incl. contrast; Cursor run A–J by an agent over CDP plus Bombic's real Cmd+Z / Cmd+Shift+Z); independent review pending

## Goal

Undo and Redo for the user's own Edit-mode saves. The host keeps whole-file snapshots of each
frame's artboard HTML in extension memory: at most 20 steps per frame, for as long as the panel
is open. Undo writes the previous file back through the same checked write an edit uses
(`updateArtboard` with `baseHash`, under the workspace lock), so it never overwrites a change
made by the Agent or the editor. A change to the file from anywhere else clears that frame's
history; the extension's own watcher echo does not count. A new edit clears redo. Undo and Redo
buttons in the inspector are the guaranteed path. Cmd+Z / Cmd+Shift+Z ships only for the focus
paths a recorded F5 spike proves.

Source: build-plan 9f; Notion 0.4 Decisions ("Undo and redo", "Saves happen on commit": one save
= one undo step, "Comments on an edited element read stale": undo makes them fresh again,
"Agent conflicts"); `project-overview.md` 0.4 data model ("Undo snapshots (20 per frame) live in
extension memory for the panel session, never on disk"); the 9e archive ("Escape in a field does
not revert … undo arrives in 9f").

## In scope

- A host-side history store (`src/host/editHistory.ts`, no `vscode`): per frame, up to 20 whole-file
  snapshots split between undo and redo, plus the file the extension last wrote; the transition
  rules; the outside-change rule; `canUndo` / `canRedo` flags; a clear epoch.
- Every written `artboard:edit` records one undo step (a same-bytes edit records nothing).
- A new chrome → host request `artboard:history { requestId, frameId, step: 'undo' | 'redo' }`,
  answered once like `artboard:edit`: `artboard:edited` on success, `ui:error` on refusal.
- `artboard:edited` and every `canvas:updated` frame carry `canUndo` / `canRedo`.
- Outside-change detection on every snapshot the outbox receives, plus the checked write as the
  backstop: a conflict or a missing file on undo/redo forgets that frame's history.
- History cleared when the panel closes and when the workspace folders change, including for
  requests still in flight at that moment.
- Chrome: steps share the one-in-flight save queue; open drafts commit before a step; a
  successful step adopts the answer and reloads that frame from the restored file.
- Inspector: Undo and Redo icon buttons (new `undo` / `redo` icons), labelled with the frame they
  act on, `aria-disabled` when unavailable, and a polite announcement after each step.
- Keyboard (F5 spike): Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z in Edit mode, from chrome focus and from
  frame focus (`cd:key` gains `undo` / `redo`), kept only for the paths the spike passes.
- Docs: rules 02 and 05, the system map.

## Out of scope

- Undoing Agent or editor changes. The history holds only the panel's own writes.
- History on disk, or across a panel close or window reload (the Notion decision is "for the
  panel session").
- Keeping scroll and page state across an undo or redo (the frame reloads; `ponytail:` upgrade
  path below). Restoring the pick after that reload.
- A history list, step counts on the buttons, Undo/Redo outside Edit mode, Ctrl+Y.
- Undo of frame drag/resize (`canvas.json`) or of comment actions.
- Escape-to-revert in a field (9e: blur commits; undo is the way back).
- Any MCP tool, Agent-visible error code, runtime limit or CSP change, so the shipped Agent skill
  is unchanged.
- 9g's verification items (real-frame five-field round trip, export, Agent stale-base conflict on a
  real frame, `.vsix` smoke). 0.4.1. Open P3 findings F-141 / F-142.

## Build loop

`workflow.stepReview: feature`: build all steps, then present the whole feature for review.
`workflow.checkpointCommits: disabled`: no per-step commits; `/complete` makes the feature
commit. After each step run its named checks; after the last, `pnpm verify` and
`pnpm test:browser`. Every `.svelte` / `.svelte.ts` edit runs `svelte-autofixer` until clean
(rule 08). `qualityGates.regular.independentReview: when-sensitive`: undo and redo write whole
artboard files from extension memory into the user's workspace, so treat this as sensitive and
run the independent review before `/complete`.

## Build steps

### 1. History store (host, pure rules) ✓

- New `src/host/editHistory.ts`, no `vscode` import (unit-testable like `chromeMessages.ts`).
  It holds one module-level `Map<frameId, FrameHistory>` and one epoch counter, and exports the
  API in Data / contracts.
- `MAX_HISTORY_STEPS = 20`. Invariant after any sequence: `undo.length + redo.length ≤ 20`
  (an edit grows undo by one, capped, and empties redo; a step moves one entry between them).
  The current copy is held on top, so a frame holds at most 21 files.
- The epoch: `clearEditHistories` bumps it. A handler reads `historyEpoch()` before its awaited
  write and passes it to `recordEdit` / `recordStep`, which do nothing when it changed. A request
  in flight when the panel closes or the folders change therefore records nothing.
- `recordStep` on a frame with no history does nothing; it never creates one.
- `ponytail:` comments:
  - Memory: up to 21 whole files per frame, each at most `MAX_POSTED_ARTBOARD_HTML_CHARS`, and
    no cap on the number of frames, so the total is unbounded across frames. Upgrade path: store
    per-element inverses instead of whole files, or evict the oldest steps against a global byte
    budget.
  - The outside-change rule: a hash the history holds counts as its own, so a stale refresh does
    not wipe the history. An outside write that recreates exactly those bytes (an editor undo in
    the `.html`, a `git checkout`) is caught only by the next step's checked write, which then
    forgets the history.

**Done when:** `src/host/editHistory.test.ts` passes (`pnpm test`):
- first `recordEdit` → `undo = [base]`, `canUndo` true, `canRedo` false;
- a chained edit (base hash = current hash) pushes the current copy; an edit whose base hash
  is not the current hash starts a fresh history `[base]`;
- 21 chained edits → undo holds 20 entries and the very first base is gone;
- undo then redo moves one entry each way and flips the flags; a new edit after an undo empties redo;
- `recordStep` with a base hash other than the current one forgets the frame; `recordStep` on an
  unknown frame leaves the store empty;
- `clearEditHistories` between `historyEpoch()` and `recordEdit` / `recordStep` leaves the store
  empty (the stale epoch is ignored);
- `keepUnchangedHistories` keeps a frame whose posted hash is its current, an undo or a redo
  hash; forgets it on any other hash and on `''`; leaves frames without history and histories of
  frames absent from the list alone;
- `clearEditHistories` empties everything; `historyFlags` of an unknown frame is both false;
- one fast-check property over random edit / undo / redo sequences. Each generated edit writes
  fresh, unique bytes (for example a counter in the HTML), so no step is vacuous. Checks:
  `undo + redo ≤ 20`, and an undo followed by a redo returns the same current hash.

### 2. Host: record edits, flags on the wire ✓

- `editArtboard` (`src/disk/artboardEditFs.ts`) returns two more fields on both the written and
  the same-bytes path: `baseHtml` (the string it already read and checked, never a re-read) and
  `baseHash` (the normalized `expectedHash`).
- `answerEditRequest` (`src/host/panelEdit.ts`): read `historyEpoch()` before `editArtboard`.
  Right after it resolves and `edited.html !== edited.baseHtml`, call `recordEdit` (base =
  `baseHtml` / `baseHash`, next = `edited.html` / `edited.hash`, epoch), then post. Still no await
  between the write and the post. `artboard:edited` gains `canUndo` / `canRedo` from
  `historyFlags(frameId)` after recording; a same-bytes edit records nothing and answers the
  current flags.
- `ArtboardEditedMessage` and `PostedCanvasFrame` (`src/webview/hostMessages.ts`) gain
  `canUndo: boolean` and `canRedo: boolean`. `parseHostMessage` requires both as booleans on
  `artboard:edited` and on every `canvas:updated` frame, under the same reject rule as `hash`.
- Outbox (`src/host/panelOutbox.ts`): `createPanelOutbox` takes two more injected functions,
  `readHistoryFlags(frameId)` and `keepUnchangedHistories(frames)`, injected like `readCspNonce`.
  - `postSnapshot` calls `keepUnchangedHistories(snapshot.frames)` first, so every snapshot posted
    to the panel is checked, whatever its caller.
  - The cached `CanvasHostView.updated.frames` become `Omit<PostedCanvasFrame, 'canUndo' |
    'canRedo'>[]`; `postedFrameFromSnapshot` returns that type and is otherwise unchanged.
  - `flushView` maps each frame to `{ ...frame, ...readHistoryFlags(frame.id) }` as it sends, so
    the first send and every replay after a webview reload read the flags live.
  - `openArtboardPanel.ts` injects `historyFlags` and `keepUnchangedHistories`.
- `clearEditHistories()` in `openArtboardPanel`'s `onDidDispose` and in `extension.ts`'s
  `onDidChangeWorkspaceFolders` handler (`ponytail:` any folder change clears, not only a new
  first folder).
- Chrome records (`src/webview/canvasFrames.ts`): `StageFrame` gains `canUndo` / `canRedo`;
  `newRecord` sets both false; `mergeRecord` takes the entry's (a stale pre-write post keeps the
  record's); `adoptEditAnswer` takes the answer's. No UI yet.
- Fixtures: every builder of a `PostedCanvasFrame` or `ArtboardEditedMessage` gains the flags:
  unit tests, `tests/browser/harness.ts` and `vscodeHost.ts`, the gallery scene and states, and
  the stage / pins / picking / comments specs. Prefer one default (`false`, `false`) in the shared
  harness builder over editing each call site.

**Done when:** tests pass:
- `artboardEditFs.test.ts`: `baseHtml` / `baseHash` on the written and the same-bytes path.
- `panelEdit.test.ts`: a written edit answers `canUndo: true, canRedo: false`; a same-bytes edit
  with no history answers both false; a same-bytes edit after a written one leaves the history
  untouched and answers `canUndo: true`.
- `panelOutbox.test.ts`: `keepUnchangedHistories` gets each new snapshot's frames and is not
  called on a replay; flags are read at send; a replay after `markReady` reflects a history change
  made after the first send.
- `hostMessages.test.ts`: missing or non-boolean flags reject `artboard:edited` and
  `canvas:updated`.
- `canvasFrames.test.ts`: merge takes the flags, a stale pre-write post keeps the record's,
  adopt takes the answer's.
- `pnpm verify` green.

### 3. Host: `artboard:history` ✓

- `src/disk/layout.ts`: `HISTORY_STEPS = ['undo', 'redo'] as const`, next to `EDIT_FIELDS` and
  for the same reason: the panel's message type and the host's zod enum share it.
  `src/webview/hostMessages.ts`: `HistoryStep = (typeof HISTORY_STEPS)[number]` and
  `ArtboardHistoryMessage` in the `ChromeMessage` union.
- `src/host/chromeMessages.ts`:
  - `artboardHistorySchema` in `chromeMessageSchema` (`requestId` by `REQUEST_ID_PATTERN`,
    `frameId` string, `step` `z.enum(HISTORY_STEPS)`);
  - `isArtboardHistoryAttempt` (claims the type, valid or not);
  - the history copy constants (Data / contracts);
  - `editRequestErrorMessage(error: unknown, kind: 'edit' | 'history'): string` instead of a twin
    function. Existing call sites pass `'edit'`.
- `src/panel/openArtboardPanel.ts`: the edit route takes both claimed types
  (`isArtboardEditAttempt || isArtboardHistoryAttempt` → the `setArtboardPanelOnEditRequest`
  handler); its comment says so.
- `src/extension.ts` imports `isArtboardHistoryAttempt`: its edit-request handler calls
  `answerHistoryRequest` for a claimed `artboard:history`, else `answerEditRequest`. Both never
  reject.
- `src/host/panelEdit.ts` `answerHistoryRequest` (log scope `panelEdit.history`), in this order:
  1. no valid `requestId`: log, no answer;
  2. untrusted workspace: `UNTRUSTED_WORKSPACE_MESSAGE`;
  3. no folder: `NoWorkspaceError` copy;
  4. `parseChromeMessage` not `artboard:history`: `MALFORMED_HISTORY_MESSAGE`;
  5. `parseArtboardId(frameId)` before the store lookup; its `InvalidArtboardIdError` maps to the
     same malformed copy through `editRequestErrorMessage(…, 'history')`, by design: both mean the
     request was malformed;
  6. `historyStepTarget` undefined: `NOTHING_TO_UNDO_MESSAGE` / `NOTHING_TO_REDO_MESSAGE`;
  7. read `historyEpoch()`, then `updateArtboard({ workspaceRoot, artboardId, html: target.html,
     baseHash: base.hash })`, never wrapped in the lock (it takes it);
  8. written: `recordStep` (with that epoch), `panelFrameHtml` (tag, seed the memo), post
     `artboard:edited` with the new hash, generation, tagged html and flags. No await between the
     write and the post;
  9. `ConflictError` or `ArtboardNotFoundError`: `forgetHistory(frameId)`, then the copy;
     `LockTimeoutError` / `DiskError` / anything else: history kept, then the copy.
- Undo and redo write only bytes the host holds (disk reads and edit-core outputs), never HTML
  from the chrome.
- `ponytail:` comments in `panelEdit.ts`:
  - The host trusts the chrome's one-in-flight queue and has no guard of its own. A webview
    reload while a step awaits the lock lets the new chrome send a second step on the same
    target. That step conflicts with the first's write and forgets a valid history, with the
    "changed on disk" copy. No data loss.
  - After `forgetHistory` on a conflict whose disk hash the last snapshot already carried, no
    new post arrives. Undo stays enabled in the chrome and answers "Nothing to undo in this frame."
    until the next post.

**Done when:**
- `panelEdit.test.ts` (real temp workspace, like the 9c tests) proves:
  - one edit then undo → file bytes equal the original exactly, generation +1, answer
    `canUndo: false, canRedo: true`, `html` carries `data-cd-src`;
  - redo → bytes equal the edited file;
  - 21 edits → 20 undos succeed and the 21st answers `NOTHING_TO_UNDO_MESSAGE`;
  - an edit after an undo → redo answers `NOTHING_TO_REDO_MESSAGE`;
  - the file rewritten directly on disk, then undo → `HISTORY_CLEARED_MESSAGE`, the outside bytes
    untouched, and the next undo answers nothing to undo;
  - the file deleted, then undo → `EDIT_FRAME_GONE_MESSAGE` and the history forgotten;
  - the lock held (the held-lock approach of the existing busy tests in `panelComments.test.ts` /
    `artboardTools.contract.test.ts`) → the busy copy, and a later undo still succeeds;
  - untrusted → refusal; no `requestId` → logged, no answer; bad `step` or frame id →
    `MALFORMED_HISTORY_MESSAGE`.
- `chromeMessages.test.ts`: schema accept / reject, `isArtboardHistoryAttempt`, copy per kind
  (conflict, malformed and fallback differ by kind; not found, busy and disk copy are shared).
- `pnpm verify` green.

### 4. Chrome: Undo / Redo buttons ✓

- `src/webview/editRequests.ts` (types in Data / contracts):
  - `waiting` holds `QueuedRequest`s and the in-flight entry is the `InFlight` union, both with
    `kind: 'edit' | 'step'`.
  - `enqueueStep(state, { frameId, step })` clears the error like `enqueueEdit`.
  - `nextSend` keeps one request in flight per panel for both kinds. `SendFrame` gains `canUndo`
    / `canRedo`, and `send` becomes `ArtboardEditMessage | ArtboardHistoryMessage | undefined`.
    A step at the head is sent only while its frame is in the list as an `iframe` and its
    `canUndo` (undo) / `canRedo` (redo) is true; otherwise it is dropped with no copy. A sent
    step's in-flight entry records the frame's `hash` as `baseHash`.
  - `answerEdit` matches the frame by `inFlight.key.frameId` (edit) or `inFlight.frameId` (step).
    For a step:
    - `artboard:edited` → `adopt` with that base, no `reloadFrameIds`, and
      `stepDone: { frameId, step }`;
    - `ui:error` → error `{ message, key: undefined }`. Every waiting request is dropped: waiting
      steps silently, waiting edits by reloading their frames (`reloadFrameIds`). The step's own
      frame is reloaded only when a dropped edit is in it, since a step has no preview.
    - Edit answers behave as in 9e (`stepDone` undefined).
  - `ponytail:` a step reloads the frame (scroll and page state reset). Upgrade path: the answer
    carries the restored text or style for `cd:edit-apply`.
- `src/webview/canvasState.svelte.ts`: `adoptEditAnswer` returns `true` when it changed the
  record (`record.hash === baseHash`), else `false`.
- `src/webview/editInspector.ts`: `historyTarget({ frames, frameId })` → `{ frameId, label,
  canUndo, canRedo }`, or undefined when `frameId` is undefined or the frame left. `label` is
  `frameLabel` (`commentsPanel.ts`). Undefined disables both buttons.
- `src/webview/editState.svelte.ts`:
  - `historyFrameId`: the frame of the latest accepted Edit-mode pick (`handlePick` with
    `message.edit`). It stays after the pick drops (an undo reload drops it) and across mode
    switches, and clears in `handleFramesChanged` when that frame leaves. Not saved in webview
    state, so a webview reload loses it until the next pick.
  - `history = $derived(historyTarget(...))`.
  - `handleHistoryStep(step)`: no target or flag false → nothing. Otherwise commit every open
    draft through the existing commit path (`keepInvalid: false`), then `enqueueStep`, then pump.
  - In `handleEditAnswer`, when `stepDone` is set:
    - reload that frame only if `canvas.adoptEditAnswer` returned `true`; when it returned
      `false`, a newer post already won and already reloaded it;
    - set the announcement `{ text, sequence }` either way, since the step was written: "Undone
      in <label>." / "Redone in <label>.", rendered through `liveRegionText` so a repeat is
      announced again.
- `src/webview/hostBridge.svelte.ts`: `postEditRequest` takes `ArtboardEditMessage |
  ArtboardHistoryMessage`.
- `src/webview/ui/icons.ts`: `undo` and `redo` shapes (curved arrows on the existing 16 px grid).
- `src/webview/Inspector.svelte`:
  - an Undo and a Redo `IconButton` in the head, before the parent/child steps (Tab order: Undo,
    Redo, parent, child);
  - labels "Undo in <label>" / "Redo in <label>", or "Undo" / "Redo" without a target;
  - `aria-disabled` when unavailable, and the click is ignored then (same reason as the step
    buttons: focus stays on the button);
  - a visually hidden polite live region with the announcement;
  - props `history`, `historyAnnouncement`, `onUndo`, `onRedo`; `App.svelte` wires them.

**Done when:**
- Unit tests pass:
  - `editRequests.test.ts`:
    - a step waits behind an in-flight edit and goes out after its answer, with no `hash` field;
    - a step whose flag is false, or whose frame is a tile, at send time is dropped with no copy;
    - a step success returns `adopt` and `stepDone` and no reload;
    - a step refusal shows the copy with `key: undefined`, drops waiting steps silently, and
      reloads only the frames of dropped waiting edits;
    - an edit committed while a step is in flight, whose frame then reloads (its
      `documentVersion` moved), is dropped with `NOT_SAVED_COPY`;
    - `enqueueStep` clears the error.
  - `editInspector.test.ts`: `historyTarget` for an undefined id, a frame that left, and label
    and flags.
- Browser tests pass (`tests/browser/editMode.spec.ts`):
  - after an edit answered with `canUndo: true`, "Undo in <frame>" is enabled and its click posts
    `artboard:history { step: 'undo' }`;
  - the stubbed answer (restored html) reloads the frame showing the original text, the inspector
    shows no element, and Redo is enabled for that frame;
  - the live region says "Undone in <frame>."; Redo posts `step: 'redo'`;
  - an open text draft is posted as `artboard:edit` first, and the step goes out only after that
    answer;
  - an `aria-disabled` button ignores a click and keeps focus;
  - a `canvas:updated` with `canUndo: false` disables Undo.
- `svelte-autofixer` clean, `theme.test.ts` green, `pnpm verify` and `pnpm test:browser` green.

### 5. Keyboard (F5 spike) ✓

`modeKeyAction` (C / Escape) stays unchanged. Undo/redo keys get their own pure rule in
`src/webview/editInspector.ts`, so `CommentPicker` (created before `EditState`) never needs
`EditState`.

- Chrome-focus path:
  - `historyKeyStep({ key, ctrlKey, metaKey, altKey, shiftKey, repeat, isComposing, inTextEntry,
    mode })` → `'undo' | 'redo' | undefined`. It returns a step only in Edit mode, for key `z` / `Z`
    with `metaKey` or `ctrlKey`, no `altKey`, not `repeat`, not composing, and not `inTextEntry`
    (a text field keeps its own native undo). Shift means redo. It ignores `defaultPrevented`.
    Ctrl+Y is not added.
  - `App.svelte` registers it as a capture-phase window keydown listener (Svelte 5's capture
    event form on `<svelte:window>`; check the docs). When it returns a step, the listener calls
    `preventDefault()` and `stopPropagation()`, then `edit.handleHistoryStep(step)`. It does this
    even when nothing can be undone. Capture runs before VS Code's own webview keydown routing on
    the window, so the workbench never sees a Cmd+Z the chrome handled. The spike checks this.
    Every other keydown goes on to the existing bubble handler as today.
- Frame-focus path:
  - `src/webview/frame/runtime.ts` adds a branch to its keydown listener, before the existing
    modifier guard. Key `z` / `Z` with `metaKey` or `ctrlKey`, no `altKey`, not `repeat`, not
    composing, from a non-editable origin (the same `composedPath` test) posts `cd:key { key:
    shiftKey ? 'redo' : 'undo' }`. Like C / Escape, it is forwarded in every mode, never
    prevented, and the chrome decides. Keep the addition small: the exported `canvas.html` embeds
    it.
  - `frameMessages.ts` accepts the two keys.
  - The chrome treats a forwarded `undo` / `redo` as a request to check, not as a keypress, because
    a design's own script can post any `cd:*` message. `App.svelte` sends `cd:key` `undo` / `redo`
    to `edit.handleFrameHistoryKey(frameId, key, senderHasFocus)` and never to the picker.
    `senderHasFocus` is `document.activeElement === canvas.iframes.get(frameId)`.
  - The pure rule `forwardedHistoryStep({ key, mode, senderFrameId, historyFrameId,
    senderHasFocus })` (`editInspector.ts`) returns the step only in Edit mode, when the sender is
    the history frame and holds focus. Otherwise the message is ignored. That step then goes
    through `handleHistoryStep`.
- Tests:
  - `editInspector.test.ts`: the `historyKeyStep` table (Meta and Ctrl, Shift, Alt, repeat,
    composing, text entry, other modes) and the `forwardedHistoryStep` table (other mode, another
    frame, no focus, no history frame);
  - `frameMessages.test.ts`: new keys accepted, others still rejected;
  - browser: Meta+Z with focus on the Undo button posts `artboard:history`; Meta+Z in the Text
    field does not; Meta+Z with focus in the history frame posts it; a `cd:key undo` posted by a
    design script in a frame without focus, or in another frame, posts nothing.
- F5 (user, in Cursor; launch the dev host from the Cursor CLI if F5 times out). Open an artboard
  in Edit mode, save one edit, and open a text editor beside it with some typed text:
  1. focus on the inspector's Undo button (Tab to it): Cmd+Z undoes once, Cmd+Shift+Z redoes, and
     the text editor's content is unchanged (no Cursor undo elsewhere, no Cursor prompt);
  2. click an element in the frame, then press the keys without touching the inspector (focus
     stays in the frame): same three results;
  3. focus in the Text field with typed text: Cmd+Z undoes typing in the field only; the artboard
     file is unchanged;
  4. Interact and Comment mode: Cmd+Z changes nothing in the artboard.
- Record pass/fail per path in this spec's Notes ("Keyboard spike result"). If check 1 fails,
  remove the chrome path's code and tests; if check 2 fails, the frame path's; if check 3 or 4
  fails, both. If both are removed, ship buttons only.

**Done when:** the spike result is recorded, the shipped code matches it, and its tests pass.

### 6. Docs + final gates ✓

- Rule 02:
  - `artboard:history` (boundary, one answer);
  - `canUndo` / `canRedo` on `artboard:edited` and on `canvas:updated` frames;
  - the history rules in one sentence: memory only, 20 per frame, an outside change clears, the
    extension's own echo and stale refreshes do not;
  - `cd:key` `undo` / `redo` and the chrome's sender-and-focus check, only if the frame path
    shipped.
- Rule 05 owner catalog:
  - `editHistory.ts` (store, epoch and rules);
  - `answerHistoryRequest`, and the `extension.ts` dispatch by `isArtboardHistoryAttempt`;
  - `artboardHistorySchema`, `isArtboardHistoryAttempt`, the history copy constants and
    `editRequestErrorMessage`'s kind in the `chromeMessages.ts` entry;
  - `HISTORY_STEPS` in `layout.ts`;
  - the outbox's `readHistoryFlags` / `keepUnchangedHistories`;
  - the queue's steps in `editRequests.ts`;
  - `historyTarget` / `historyKeyStep` / `forwardedHistoryStep` in `editInspector.ts`;
  - `postEditRequest`'s second type;
  - `adoptEditAnswer`'s boolean.
- `blueprint/context/system-map.md`: an "Undo / redo (9f)" section and chart from the shipped code
  (run its Chart checklist), the message contract table rows, the "Last verified" line.
- The Agent skill stays unchanged (no MCP tool, error code, limit or CSP change); say so in the
  handoff.

**Done when:** `node scripts/check-agent-rules.mjs` passes, `pnpm verify` and
`pnpm test:browser` are green, and the system map chart passes its checklist.

## Files / areas

- New: `src/host/editHistory.ts`, `src/host/editHistory.test.ts`.
- Host: `src/disk/layout.ts`, `src/disk/artboardEditFs.ts` (+ test), `src/host/panelEdit.ts`
  (+ test), `src/host/chromeMessages.ts` (+ test), `src/host/panelOutbox.ts` (+ test),
  `src/host/canvasSnapshot.ts` (`postedFrameFromSnapshot` return type), `src/panel/openArtboardPanel.ts`,
  `src/extension.ts`.
- Chrome: `src/webview/hostMessages.ts` (+ test), `canvasFrames.ts` (+ test), `canvasState.svelte.ts`,
  `editRequests.ts` (+ test), `editInspector.ts` (+ test), `editState.svelte.ts`, `Inspector.svelte`,
  `App.svelte`, `hostBridge.svelte.ts`, `ui/icons.ts`. Keyboard: `frame/runtime.ts`,
  `frame/frameMessages.ts` (+ test).
- Browser: `tests/browser/editMode.spec.ts`, `harness.ts`, `vscodeHost.ts`, the gallery scene and
  states, and any spec that builds a `canvas:updated` frame.
- Docs: `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`,
  `blueprint/context/system-map.md`. Not `skills/cursor-design/SKILL.md`.

## Data / contracts

History store (`src/host/editHistory.ts`, extension memory only, never on disk):

```ts
export const MAX_HISTORY_STEPS = 20;
type HistoryEntry = { html: string; hash: string }; // hash = hashHtml(html), sha256: lowercase
type FrameHistory = { undo: readonly HistoryEntry[]; redo: readonly HistoryEntry[]; current: HistoryEntry };

historyEpoch(): number
recordEdit({ frameId, base, next, epoch }): void
  // epoch !== historyEpoch() → nothing
  // current.hash === base.hash → undo = [...undo, current].slice(-20), redo = [], current = next
  // otherwise (no history, or another base) → undo = [base], redo = [], current = next
historyStepTarget({ frameId, step }): { base: HistoryEntry; target: HistoryEntry } | undefined
  // base = current; target = undo.at(-1) (undo) or redo.at(-1) (redo); undefined when empty
recordStep({ frameId, step, baseHash, epoch }): void
  // epoch !== historyEpoch() or no history → nothing; current.hash !== baseHash → forget; else
  // undo: undo.slice(0, -1), redo = [...redo, current], current = old undo top
  // redo: undo = [...undo, current], redo.slice(0, -1), current = old redo top
forgetHistory(frameId): void
keepUnchangedHistories(frames: ReadonlyArray<{ id: string; hash: string }>): void
  // per listed frame with a history: hash ∈ {current, undo…, redo…}.hash → keep, else forget
clearEditHistories(): void // empties the map, epoch + 1
historyFlags(frameId): { canUndo: boolean; canRedo: boolean } // undo / redo non-empty
```

Wire (`src/webview/hostMessages.ts`; `HISTORY_STEPS` in `src/disk/layout.ts`):

- chrome → host `artboard:history { requestId, frameId, step: 'undo' | 'redo' }`. Untrusted
  input: `parseChromeMessage` checks shape; the host owns the bytes written. Refused in untrusted
  workspaces. Every attempt with a valid `requestId` is answered once and never replayed.
- host → chrome `artboard:edited { requestId, frameId, hash, generation, html, canUndo, canRedo }`
  answers `artboard:edit` and `artboard:history`. `html` is the tagged frame copy the watcher echo
  will post.
- `canvas:updated` frames: `{ …, canUndo: boolean, canRedo: boolean }`, read from the store when
  the outbox sends (first send and every replay); both false for a frame without history.
- `ui:error { requestId, message }` for a refused step.
- Only if the keyboard spike's frame path ships: frame → chrome
  `cd:key { key: 'c' | 'Escape' | 'undo' | 'redo' }`; the chrome acts on `undo` / `redo` only
  from the focused history frame in Edit mode.

Chrome queue (`src/webview/editRequests.ts`):

```ts
type QueuedRequest = { kind: 'edit'; commit: EditCommit } | { kind: 'step'; frameId: string; step: HistoryStep };
type InFlight =
	| { kind: 'edit'; requestId: string; key: EditKey; baseHash: string }
	| { kind: 'step'; requestId: string; frameId: string; step: HistoryStep; baseHash: string };
// EditError.key stays EditKey | undefined: undefined for a step's refusal.
// EditAnswerStep gains stepDone: { frameId: string; step: HistoryStep } | undefined.
```

Panel copy (`src/host/chromeMessages.ts`, `editRequestErrorMessage(error, 'history')` and the
handler):

| Case | Constant | `history` copy |
|---|---|---|
| nothing to undo | `NOTHING_TO_UNDO_MESSAGE` | `Nothing to undo in this frame.` |
| nothing to redo | `NOTHING_TO_REDO_MESSAGE` | `Nothing to redo in this frame.` |
| `ConflictError` (history forgotten) | `HISTORY_CLEARED_MESSAGE` | `This artboard changed on disk, so its undo history was cleared.` |
| `ArtboardNotFoundError` (history forgotten) | `EDIT_FRAME_GONE_MESSAGE` (shared) | `This frame no longer exists.` |
| malformed, `InvalidArgsError`, `InvalidArtboardIdError` | `MALFORMED_HISTORY_MESSAGE` | `Could not undo or redo. Try again.` |
| `LockTimeoutError`, `DiskError` | (the error's own message, shared rule) | |
| anything else | `HISTORY_FALLBACK_MESSAGE` | `Could not undo or redo. Check the Output panel: Cursor Design.` |

Lifecycle: history starts at the first written edit of a frame and ends at the first of these:
- the panel closes;
- the workspace folders change;
- a posted snapshot shows an outside change;
- a step's checked write finds the file changed or missing.

A request in flight at a clear records nothing (epoch). History survives the webview being hidden
and shown. A write changes `meta.generation` (+1) and `meta.hash` as any `updateArtboard` does.
Comment flags follow the file bytes: undo back to the commented bytes makes a stale comment
fresh.

Chrome, Inspector strings: "Undo in <label>", "Redo in <label>", "Undo", "Redo"; announcements
"Undone in <label>." and "Redone in <label>.".

## Testing

- Unit (Vitest, `pnpm test`): the files named in each step. `editHistory.test.ts` includes one
  fast-check property (already installed, 7f).
- Browser (`pnpm test:browser`, local): `editMode.spec.ts` button flow, focus, live region; the
  keyboard and forged-`cd:key` cases for whatever path ships.
- `pnpm gallery` (local): the inspector shots now include the two buttons; check the contrast
  report for the `aria-disabled` look.
- F5 (user, Cursor-only): the step 5 keyboard checks, plus:
  1. after one edit, wait a second: Undo stays enabled (the echo keeps it);
  2. after one edit, have the Agent `update_artboard` the frame (or save the `.html` in the
     editor): the frame reloads and Undo greys out with no click;
  3. after one edit, switch to another editor tab and back, click an element in the same frame:
     Undo works (history survived the webview reload);
  4. close the panel, reopen it, click an element: Undo is disabled.
- Not claimed here: a real-frame round trip of all five fields, export, an Agent stale-base
  conflict, a comment stale then fresh after undo, `.vsix` (all 9g).

## Build deviations (implement)

- Step 2: the browser fixtures gained `canUndo: false, canRedo: false` inline on each frame (and
  `editedAnswer` in `editMode.spec.ts` answers `canUndo: true`) instead of one harness default,
  which keeps every fixture typed as the exact `PostedCanvasFrame`.
- Step 3: the real-disk history tests live in a new `src/host/panelEdit.history.test.ts`;
  `panelEdit.test.ts` mocks the disk lib for the 9c answer contract, so it cannot hold them.
- Step 3: `panelEdit.ts` shares the request prelude between both handlers (`refuser`,
  `checkedWorkspaceRoot`, `postEdited`) instead of copying it into `answerHistoryRequest`.
- Step 4: `EditState.history` is a getter, not a field `$derived`: `#canvas` is assigned in the
  constructor, after field initializers run (svelte-check error otherwise).
- Step 4: the `aria-disabled` browser case activates the focused button with Enter: Playwright
  refuses to click an `aria-disabled` button.
- Step 5: the key handlers live in `EditState` (`handleHistoryKeydown`, `handleFrameHistoryKey`);
  `App.svelte` registers them (`onkeydowncapture` on `<svelte:window>`, the `cd:key` route).
  `isTextEntry` is exported from `commentPicker.svelte.ts` and reused, not copied.
- Step 5: the runtime's key filter became one `frameKey` helper; the exported `canvas.html`
  snapshot (`handoffCanvasHtml.test.ts`) was updated on purpose for it, and the runtime size test
  still passes.
- Step 6: `frameMessages.test.ts` keeps a literal copy of rule 02's message line; it was updated
  with the rule.
- Step 5: `handleHistoryKeydown` also ends the scroll-sink gesture: its `stopPropagation` skips
  App's bubble keydown, which normally does (F-148).
- Audit repairs (findings F-145, F-147, F-148, F-152, all `fixed`): `enqueueStep` caps waiting
  steps at `MAX_HISTORY_STEPS` (moved to `layout.ts`); handler-level epoch tests; the sink-gesture
  comment; the same-bytes test asserts the undo target. F-150 / F-151 go to the refactor pass;
  F-149 is unverified.
- F-146 (Bombic's choice, 2026-11-20): `EditState.handlePick` moves the history frame only on a
  pick from the frame that holds focus, so a design script cannot retarget Undo / Redo; browser
  test `F-146: a pick from a frame without focus never retargets Undo / Redo`.
- Refactor pass (Opus 5.5 subagent, behaviour unchanged; F-150 / F-151 `fixed`):
  - `editInspector.ts` (four jobs) split into `editInspector.ts` (inspector view rules),
    `editDrafts.ts` (the 9e field drafts) and `undoRedo.ts` (the 9f `historyTarget`,
    `historyKeyStep`, `forwardedHistoryStep` and a shared `canStep`), tests split alike. The spec's
    step 4 / step 5 references to `editInspector.ts` for those rules now mean `undoRedo.ts`.
  - `chromeMessages.ts` keeps parsing and mapping; all panel answer copy (comment and edit /
    history constants, `editRequestErrorMessage`, `commentRequestErrorMessage`,
    `malformedRequestMessage`, `isCopyType`) moved to `src/host/panelRequestCopy.ts`.
  - `InFlight` is `QueuedRequest & { requestId, baseHash }` (an in-flight edit carries its whole
    `commit`); `editHistory.ts` has one `stepEntry`; `FRAME_KEYS` / `FrameKey` / `isFrameKey` type
    the frame keys; `Inspector.svelte` has one `runIf` guard for its four aria-disabled buttons.

## Notes for the AI

- Judgment calls, not in Notion. Confirm them before `/implement`, and patch Notion's "Undo and
  redo" decision at `/complete` (code over Notion):
  1. a step reloads the frame (scroll and page state reset), unlike a saved edit; the restored
     file is not in the live page;
  2. Undo/Redo act on the frame of the latest Edit-mode pick, kept after the pick drops, so you can
     undo repeatedly after the reload clears the pick. After a webview reload (tab switch) they
     wait for the next pick;
  3. `artboard:edited` answers both requests (one adopt path); the in-flight entry's kind decides
     reload or not;
  4. an outside change clears history silently (the frame reload already shows it); copy appears
     only when a step is refused;
  5. any workspace-folder change clears all history;
  6. the outside-change check accepts any hash the history holds (current, undo or redo), not
     only the last hash written as Notion says. Reason: a refresh that read disk before the
     user's own write (the 9c ceiling the chrome handles with `isStalePreWrite`) must not wipe
     the history. Cost: an outside write that recreates a held state is caught only at the next
     step.
- The checked write is the guarantee that undo never overwrites the Agent's work; the snapshot
  check only keeps the buttons honest. `updateArtboard` takes `withWorkspaceLock` itself: never
  wrap it.
- Extend the existing `ponytail:` in `panelEdit.ts` for one case. When lock release takes over
  200 ms, the echo's snapshot can arrive before `recordEdit`. Its new hash is unknown, so the older
  steps are forgotten and that edit then starts a fresh history. The echo also carries
  `canUndo: false`, and the chrome may have kept the answer's flags or the echo's, so Undo can
  read disabled until the next post. Accepted: no data loss.
- No await between a write and its answer, in both handlers.
- Svelte: `list-sections` / `get-documentation` before `.svelte` edits (the capture-phase event on
  `<svelte:window>` included), `svelte-autofixer` after every edit (rule 08); prefer the
  `svelte-file-editor` agent.
- Subagents: Sonnet 5.5 high or Opus 5.5 only (memory: subagent model floor).
- `Keyboard spike result` (2026-11-20, agent-driven in a separate Cursor 3.29.9 instance over CDP,
  copy of the dev workspace, a text editor open beside the panel; evidence in the session scratchpad
  `f5/results.jsonl` and screenshots): every check passed. A edit saves; B Undo restores the exact
  original sha; C Redo restores the edited sha; D Cmd+Z / Cmd+Shift+Z with focus on the Undo button
  undo and redo one step each and leave the editor's "hello world" untouched; E Cmd+Z with focus
  inside the frame undoes (and Cmd+Shift+Z redoes after the reload, focus still in the frame); F
  Cmd+Z in the Text field undoes only the field; G Interact and Comment mode: Cmd+Z changes nothing;
  H an outside write disables Undo within 411 ms; I history survives a tab switch (Undo works after
  a new pick); J after close and reopen Undo is disabled. Limit: CDP-injected keys reach the page
  and Cursor's JavaScript keybinding layer but not the macOS menu-bar key-equivalent layer, so a real
  press was owed: Bombic confirmed 2026-11-20 that real Cmd+Z / Cmd+Shift+Z work in Cursor. Both
  key paths ship. Side
  observation (9e, not 9f): Playwright typing right after Cmd+A in the Text field lost characters
  because Cursor's webview select-all lands a few milliseconds later.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":39518,"specSha256":"0f682f05e3877269fe8c7afb4364be861fe8c850b373e7eec9a57ab491e94454","branch":"refs/heads/feature/undo-redo","head":"cf238c4d595d9af7fcaef7db72636fee6e979211","baseRef":"refs/heads/main","baseCommit":"fa00de9cce722dcabd8625326ff829e756117c5a","sourceTree":"e7eae0d17a972e9a5a668af4464d421ff4fe23d4","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9f/F-145 [P2] closed - A design script can queue unbounded undo / redo steps that keep writing

**File:** src/webview/editRequests.ts:77 (`enqueueStep`), src/webview/editState.svelte.ts (`handleHistoryStep`)
**Found:** 2026-11-20 by /audit (scope: current; lens: security, performance; fresh subagent claude-opus-5-5)
**Why it matters:** In Edit mode with focus in the history frame, the frame's own script can post `cd:key {undo|redo}` in a loop. Each passes `handleHistoryStep`'s flag check (the record's flags only change when an answer arrives) and `enqueueStep` copies the whole waiting array, so a burst costs quadratic time on the chrome thread (measured: 1e5 calls ≈ 17 s). Nothing caps the queue, and an alternating undo / redo burst keeps both flags true, so every queued step becomes a real `updateArtboard` write plus a synchronous re-tag on the extension host. No data loss: each write is a state the history holds for that frame.
**Suggested fix:** Cap the waiting steps in `enqueueStep` at `MAX_HISTORY_STEPS` (a 21st waiting step is ignored; no real press pattern reaches it). No current requirement lost.
**Resolution:** Fixed 2026-11-20 (/implement repair): `enqueueStep` ignores a step once `MAX_HISTORY_STEPS` steps wait (the constant moved to `src/disk/layout.ts`, shared by the host store and the chrome queue). Test: `editRequests.test.ts` `F-145: at most MAX_HISTORY_STEPS steps wait`. Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): `enqueueStep` returns the state unchanged once `MAX_HISTORY_STEPS` steps wait (src/webview/editRequests.ts:79-89); the queue and the per-burst work are bounded, and `editRequests.test.ts` `F-145` covers it. No new defect.

### 9f/F-146 [P3] closed - A forged Edit-mode pick can make its own frame the history frame

**File:** src/webview/editState.svelte.ts (`handlePick` sets `historyFrameId`), src/webview/editInspector.ts (`forwardedHistoryStep`)
**Found:** 2026-11-20 by /audit (scope: current; lens: security; fresh subagent claude-opus-5-5)
**Why it matters:** `applyPickMessage` accepts a non-repost `cd:pick` with `edit` from any frame in Edit mode, focused or not, and `handlePick` then makes that frame the history frame. So a design script can retarget the Undo / Redo buttons (and the chrome-focus Cmd+Z) to its own frame, and the "sender is the history frame" half of the forwarded-key guard is satisfied by the forging frame itself; the guard that really holds is Edit mode plus focus. Damage stays inside that frame: steps only write states its own history holds.
**Suggested fix:** User decision: either set `historyFrameId` only from a pick whose frame holds focus (risk: a click in Edit mode may not focus the iframe, which would break the buttons; needs an F5 check), or document in rule 02 and the spec that the effective guard is Edit mode plus focus and a forged pick can retarget the buttons to its own frame.
**Resolution:** Fixed 2026-11-20 (/implement repair, Bombic chose the focus gate): `EditState.handlePick` moves `historyFrameId` only when the sending frame holds focus (`document.activeElement === iframe`, passed by App). The Cursor run showed a real click in Edit mode focuses its frame, and every existing click-driven browser case still passes. Test: `editMode.spec.ts` `F-146: a pick from a frame without focus never retargets Undo / Redo` (fails with the gate removed, checked by a temporary mutation). Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): `EditState.handlePick` sets `historyFrameId` only when `senderHasFocus` (App passes `document.activeElement === iframe`); browser case `F-146` passes. No new defect.

### 9f/F-147 [P2] closed - The in-flight epoch rule has no handler-level test

**File:** src/host/panelEdit.ts (the `historyEpoch()` reads in `answerEditRequest` and `answerHistoryRequest`)
**Found:** 2026-11-20 by /audit (scope: current; lens: tests; fresh subagent claude-sonnet-5-5)
**Why it matters:** The spec requires that a request in flight when the panel closes or the folders change records nothing. Only the store test passes a stale epoch by hand; moving the `historyEpoch()` read after the await, or dropping the `epoch` argument, passes all 726 unit tests and would let history outlive the panel.
**Suggested fix:** In `panelEdit.history.test.ts`, clear the history while an edit and while a step await the held lock; expect the answer still `artboard:edited` and `historyFlags('hero')` both false. Test only.
**Resolution:** Fixed 2026-11-20 (/implement repair): `panelEdit.history.test.ts` clears the history while an edit and a step await a held lock (`clearWhileLocked`); the edit case fails when `recordEdit` reads the epoch after the await (checked by a temporary mutation, reverted). Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): `panelEdit.history.test.ts` `clearWhileLocked` cases for an edit and a step are present and pass; both handlers read `historyEpoch()` before their awaited write.

### 9f/F-148 [P3] closed - The history keydown's endSinkGesture call is unexplained

**File:** src/webview/editState.svelte.ts (`handleHistoryKeydown`)
**Found:** 2026-11-20 by /audit (scope: current; lens: quality; fresh subagent claude-sonnet-5-5)
**Why it matters:** The call is correct (its `stopPropagation` skips App's bubble `handleWindowKeydown`, which normally ends the sink gesture), but neither the code nor the spec says so; the next reader sees a stray twin of App's call.
**Suggested fix:** One comment line, and a Build-deviations line in the spec.
**Resolution:** Fixed 2026-11-20 (/implement repair): comment in `handleHistoryKeydown`; Build-deviations line in the spec. Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): the comment in `handleHistoryKeydown` explains the `endSinkGesture` call.

### 9f/F-150 [P3] closed - requestFrameId tells the two edit shapes apart by a structural `in` check

**File:** src/webview/editRequests.ts (`requestFrameId`)
**Found:** 2026-11-20 by /audit (scope: current; lens: quality; fresh subagent claude-sonnet-5-5)
**Why it matters:** The queued edit and the in-flight edit both carry `kind: 'edit'`, so `requestFrameId` uses `'commit' in request` to pick the frame id: a structural check across two union types that breaks silently if either shape changes.
**Suggested fix:** Give both edit shapes their frame id directly, or use two small helpers, one per union.
**Resolution:** Fixed 2026-11-20 (refactor pass, Opus 5.5 subagent): `InFlight` is now `QueuedRequest & { requestId, baseHash }` (an in-flight edit carries its `commit`), so one `requestFrameId(request: QueuedRequest)` serves both with no `in` check; the error key reads `inFlight.commit.key`. Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): `InFlight = QueuedRequest & { requestId, baseHash }`; one `requestFrameId` switches on `kind`, no `in` check.

### 9f/F-151 [P3] closed - The undo / redo stack-top lookup is written twice

**File:** src/host/editHistory.ts (`historyStepTarget`, `recordStep`)
**Found:** 2026-11-20 by /audit (scope: current; lens: quality; fresh subagent claude-sonnet-5-5)
**Why it matters:** `step === 'undo' ? history.undo.at(-1) : history.redo.at(-1)` appears in both; a later change to one can drift from the other.
**Suggested fix:** One local helper both call.
**Resolution:** Fixed 2026-11-20 (refactor pass, Opus 5.5 subagent): one local `stepEntry(history, step)` used by `historyStepTarget` and `recordStep`. Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): one `stepEntry` serves `historyStepTarget` and `recordStep`.

### 9f/F-152 [P3] closed - The same-bytes test's third call does not prove the history stayed untouched

**File:** src/host/panelEdit.test.ts (`9f: a same-bytes edit records nothing and answers the current flags`)
**Found:** 2026-11-20 by /audit (scope: current; lens: tests; fresh subagent claude-sonnet-5-5)
**Why it matters:** The flags after the third (same-bytes) call would read the same even if a same-bytes edit pushed a step, so that call proves nothing; the guard is covered only by the first call (no history, both flags false).
**Suggested fix:** Assert the undo target after the third call (still the first base), or drop the call.
**Resolution:** Fixed 2026-11-20 (/implement repair): the test now asserts the undo target after the third call is still the first base. Closed 2026-11-20 by independent /audit (fresh subagent claude-opus-5-5, cf238c4): the same-bytes test asserts the undo target is still the first base after the third call.

## Independent review

**Status:** passed
**Target commit:** cf238c4d595d9af7fcaef7db72636fee6e979211
**Base commit:** fa00de9cce722dcabd8625326ff829e756117c5a
**Base ref:** main
**Spec hash:** 0f682f05e3877269fe8c7afb4364be861fe8c850b373e7eec9a57ab491e94454
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-20T08:57:53Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-20T09:03:09Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `fa00de9cce722dcabd8625326ff829e756117c5a..cf238c4d595d9af7fcaef7db72636fee6e979211` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain --untracked-files=all`: pass (HEAD = target, merge base = base, spec hash matches, only `review.md` differs)
- `pnpm verify`: pass (vp check clean over 202 files, agent rules check, svelte-check, webview tests tsc, 59 files / 729 unit tests, vp pack, webview build)
- `pnpm test:browser`: pass (164 passed, 198 gallery cases skipped by design)

## Evidence

- Host store `src/host/editHistory.ts`: `recordEdit` chains only on `current.hash === base.hash`, caps undo at `MAX_HISTORY_STEPS`, empties redo; `recordStep` forgets on a moved base and never creates a history; epoch guards both; `keepUnchangedHistories` keeps any held hash and forgets on `''` or an unknown hash.
- `src/host/panelEdit.ts` `answerHistoryRequest`: requestId, trust and folder checks first; `parseArtboardId` before the store lookup; writes only `historyStepTarget` bytes through `updateArtboard` with the history's current hash (lock taken inside, not wrapped); no await between the write, `recordStep` and the post; `ConflictError` / `ArtboardNotFoundError` forget the history, busy / disk keep it. `updateArtboard` recomputes the hash from disk bytes (`effectiveArtboardMeta`), so the written hash equals the held target hash.
- `src/host/panelOutbox.ts`: every `postSnapshot` runs `keepUnchangedHistories` before caching; `flushView` reads flags at each send, replays included; `clearEditHistories` on panel dispose (`openArtboardPanel.ts`) and folder change (`extension.ts`).
- Wire: `artboardHistorySchema` (requestId pattern, `z.enum(HISTORY_STEPS)`); `parseHostMessage` requires boolean `canUndo` / `canRedo` on `artboard:edited` and every `canvas:updated` frame; panel copy allowlist in `panelRequestCopy.ts` keeps Agent copy out of the panel.
- Chrome: `editRequests.ts` one-in-flight queue for edits and steps, step flags read at send time, waiting steps capped at 20; `adoptEditAnswer` boolean drives the step reload; stale pre-write skip (`replacedHashes` + generation) stays correct across undo / redo; `handleHistoryKeydown` skips text entry and non-Edit modes; forwarded `cd:key` undo / redo acts only from the focused history frame; `historyFrameId` moves only on a pick from the focused frame.
- Frame runtime `frameKey`: Ctrl/Meta+C and other modified keys still produce nothing; editable-origin check unchanged.
- Re-reviewed and closed: F-145, F-146, F-147, F-148, F-150, F-151, F-152 (see findings ledger).
- No `.only` / unconditional skip added; the fast-check property in `editHistory.test.ts` and the real-disk `panelEdit.history.test.ts` cases (exact bytes, cap, outside write, deleted file, held lock, clear across an in-flight request) exercise the host rules.

## Findings

- None new. Closed this pass: F-145, F-146, F-147, F-148, F-150, F-151, F-152. F-149 [P3] stays `unverified`.

## Remaining risk

- Cursor-only behavior (real Cmd+Z / Cmd+Shift+Z routing, webview hide/show, MCP-side conflicts) was not re-run by this reviewer; it rests on the spec's recorded Cursor run.
- Timing ceiling: if a step's watcher echo is posted before `recordStep` (lock release slower than the 200 ms debounce), the chrome keeps the echo's pre-step flags (for example Redo disabled after an undo) until the next post. No data loss; same class as the documented 9c/9f edit ceiling.
- `answerHistoryRequest`'s catch-path `forgetHistory` is not epoch-guarded: only a panel close, reopen and a new edit of the same frame landing inside one step's 2 s lock wait could make it drop the new panel's history. Contrived; no data loss.
- History memory is unbounded across frames (up to 21 files of at most 1.5M chars per frame), marked `ponytail:` in `editHistory.ts`.
- `pnpm gallery` (contrast of the new `aria-disabled` buttons) was not run.

## Try it now

Run or do:

`pnpm compile`, then press F5 (or run `/Applications/Cursor.app/Contents/Resources/app/bin/cursor --extensionDevelopmentPath="$PWD" "$PWD/fixtures/dev-workspace"`). Run `shasum -a 256 fixtures/dev-workspace/.cursor-design/artboards/hero.html` and note the hash. In the dev host, run **Cursor Design: Open Artboard** and switch to **Edit**. Click the heading "Ship faster with Cursor Design" in the hero frame, change Text to `Ship faster`, press Enter, then click **Undo** in the inspector head. Run the same `shasum` again.

Expected:

After Enter the frame shows "Ship faster" without reloading. After Undo the frame reloads showing "Ship faster with Cursor Design", and the inspector says "No element selected". "Redo in hero" is enabled, and the second `shasum` matches the first. Clicking Redo brings back "Ship faster".

This proves: undo writes back the exact original bytes through the panel, and redo restores the edit.
