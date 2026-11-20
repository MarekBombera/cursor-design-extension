# System map

> **Durable file.** The data flow of the **shipped** code on the default branch: processes,
> messages, and disk. It is for humans steering the project and for agents about to change it.
> `/complete` merges each finished work item's flows in, after checking them against the built
> code. `/feature` and `/fix` read it as the baseline and repair any drift they find.
> Planned flows never go here; they live in `current-feature-overview.md` until shipped.
> Open in Markdown preview to render the diagrams.

**Last verified against code:** fix Share browser test helpers (`fix/share-browser-test-helpers`): no message, disk format or process flow change; test-only, the Playwright specs' twin helpers move into `tests/browser/harness.ts`. Before it, fix Audit code problems (`fix/audit-code-problems`): no message, disk format or process flow change; the disk lib's two stderr writers become one `logStderr` (same bytes), and the MCP logs an invalid `CURSOR_DESIGN_WORKSPACE_ROOTS` to stderr once per process before the unchanged fallback to ROOT. Before it, feature 9f Undo/redo (`feature/undo-redo`): new chrome → host `artboard:history {requestId, frameId, step}` (the inspector's Undo / Redo, sharing the edit route, the one-in-flight queue and the one-answer rule), answered by `artboard:edited` (which, like every `canvas:updated` frame, now carries `canUndo` / `canRedo`) or `ui:error`; the host keeps whole-file undo snapshots per frame in memory (`editHistory.ts`, 20 steps) and writes a step through `updateArtboard` with the history's current hash; the outbox checks every new snapshot against the history (`keepUnchangedHistories`) and reads the flags at every `canvas:updated` send, replays included; a written step reloads the frame; `cd:key` gains `undo` / `redo` (Cmd/Ctrl+Z with frame focus; the chrome acts only from the focused history frame in Edit mode), and a capture-phase window listener handles Cmd/Ctrl+Z with chrome focus. Before it, feature 9e Edit fields + save (`feature/edit-fields-save`): the Edit-mode inspector is the first `artboard:edit` sender (drafts keyed to the element they started on, one save in flight, the next with the answered hash); new chrome → frame `cd:pick-refresh` and `cd:edit-apply` (Edit mode only; the runtime's one design-DOM write is that preview); `edit.style` is `''` when absent and `null` only over the cap; the chrome parses `artboard:edited` and adopts it without a frame reload (`documentHtml` / `documentVersion` vs `html`), skips stale pre-write posts (`replacedHashes`), and reloads a refused edit's frame from the latest adopted copy; a pick re-post keeps its announcement `sequence`; no host or disk change. Before it, feature 9d Edit mode + selection (`feature/edit-mode-selection`): no host or disk change; `cd:mode` gains `edit`, and in Edit mode the frame picker (shared with Comment mode) adds `edit {sourceNumber|null, sharedNumber, textState, text, style|null}` to each `cd:pick` (`describeEditTarget`, DOM reads only); the chrome's one acceptance rule `pickCounts` drops a `cd:hover` / `cd:pick` in Interact mode and a `cd:pick` whose `edit` does not match the mode, for the pick and the comment draft alike; the Edit-mode inspector (`inspectorView`, disabled fields) and the saved `mode` key (replacing `commentMode`). Before it, feature 9c Checked write + edit message (`feature/checked-write-edit-message`): `update_artboard`'s read-compare-write now runs under `withWorkspaceLock` (pre-checks for the file and its exact-case name first; `WORKSPACE_BUSY` after a 2 s wait); every `canvas:updated` frame carries `hash` (`hashHtml` of the disk HTML, `''` when unreadable); new chrome → host `artboard:edit`, answered once by `artboard:edited` (the tagged frame copy the watcher echo will post) or `ui:error`, through `editArtboard` → `updateArtboard`; no chrome sender until 9e. Before it, feature 9b Edit core (`feature/edit-core`): no flow change; a pure disk module (`artboardEdit.ts` over `inlineStyle.ts`, sharing `numberedElements` with the source tags) that nothing calls yet; 9c wires it into the checked write and the panel edit message. Before it, feature 9a Source tags + inline-style CSP (`feature/source-tags-inline-style-csp`): no new message; each `canvas:updated` frame's `html` is now the disk HTML with host-added `data-cd-src="N"` source numbers (`panelFrames` in `canvasSnapshot.ts`: size cap on disk HTML, then `sourceTaggedHtml` over the comment flags' shared parse cache, with a tagged-copy memo per frame), and the chrome CSP gains `style-src-attr 'unsafe-inline'`. Before it, fix Drop the Electron test suite and css-select (`fix/drop-the-electron-test-suite-and-css-select`): no message or process change; comment flags now match through the in-house `selectMatches` (`selectorMatch.ts`) over parse5's own tree, unchecked past `MAX_MATCH_WORK`. Before it, fix Keep comment drafts across a tab switch (`fix/keep-comment-drafts-across-a-tab-switch`): no host or frame message change; the webview state record gains `commentMode`, `commentDraft`, `openThreadId` and `replyDrafts`. Before it, feature 8i Verify (`feature/verify`): no flow change; docs and agent-run checks only (headless stdio Agent loop, `.vsix` smoke). Before it, fix Pin stacking and zero-count copy (`fix/pin-stacking-and-zero-copy`): no flow change; coinciding pins line up in the chrome, and a 0-count `ui:copied` shows no Copied feedback. Before it, fix Chrome design system (`fix/chrome-design-system`): no flow change; the Parent / Child and Copy labels follow the restyled chrome. Before it, fix Share the copy-type check (`fix/share-the-copy-type-check`): no flow change; `refuse` reuses `isCopyType` for the refresh after every copy `ui:error`. Before it, feature 8h Copy prompt (`feature/copy-prompt`): `comment:copy` / `comment:copy-open` answered once by `ui:copied` or `ui:error`, the host clipboard written before `markCommentsSent`, a `comments:updated` refresh after every copy answer, and one copy at a time in the chrome.

## Chart checklist

Every chart here and in `current-feature-overview.md` must pass all of these before it is written.
A chart that only looks plausible is wrong.

1. **Trace, don't recall.** Follow each user or Agent action end to end through the source of
   truth: the code for this map, the spec's Data / contracts for a planned overview. Note where the
   event is actually handled (which process or document has it, given focus and event routing),
   what state changes, and what the user sees.
2. **One arrow = one real message or call.** Use the exact wire name (`canvas:updated`, `cd:pick`)
   or function, the real sender and receiver, and the payload fields with their nullability as the
   contract states them.
3. **Complete in both directions.**
   - Every message the contract defines appears at least once.
   - No arrow exists without a contract line or code behind it.
   - Every participant that sends or receives one is shown.
4. **Include the non-happy paths the contract defines:**
   - startup and reload handshakes;
   - mode or state toggles;
   - messages that are dropped (guards, wrong source, wrong mode);
   - failure replies;
   - the two-instance case (two frames, Agent plus user) when the contract has a rule for it.
5. **Planned vs shipped.** An overview chart is labelled with the feature it plans. This map holds
   only shipped flows.
6. **Re-check after every rewrite.** Any spec revision (`/feature-review-fix`, a user-requested
   change) re-runs this list on the overview chart. The text around a chart must agree with it.

## Runtime map

```mermaid
flowchart LR
  Agent["Cursor Agent"]
  subgraph MCP["MCP process (dist/mcp.js, stdio)"]
    Tools["tools: set_artboard, update_artboard, read_artboard,<br/>list_artboards, set_active_artboard, place_frame,<br/>export_artboard, handoff_status,<br/>list_comments, get_comment, resolve_comment<br/>serialized by enqueueDiskOp"]
  end
  subgraph Host["Extension host (dist/extension.js)"]
    Watcher["watcher .cursor-design/**<br/>200ms debounce, skips .lock / *.tmp"]
    Panel["openArtboardPanel + panelComments<br/>postMessage, parseChromeMessage"]
    Cmds["commands: Open Artboard,<br/>Export Handoff, Reveal Folder"]
    Skill["syncAgentSkill on activate (Cursor only)"]
  end
  subgraph Webview["Webview (chrome CSP, nonce)"]
    Chrome["Svelte chrome<br/>hostBridge.svelte.ts"]
    Frames["one sandboxed blob iframe per artboard<br/>head: charset, FRAME_CSP, runtime (frame/runtime.ts)<br/>body: disk HTML + data-cd-src numbers (9a)"]
  end
  Disk[(".cursor-design/<br/>manifest.json, canvas.json, comments.json,<br/>artboards/id.html + meta,<br/>.ensure-panel, .lock, handoff/")]
  Home[("~/.cursor/skills/cursor-design/SKILL.md")]
  State[("webview state<br/>stageView, commentsPanelOpen,<br/>mode, commentDraft, openThreadId, replyDrafts")]
  Clip[("system clipboard")]

  Agent -->|MCP tool calls| Tools
  Tools -->|disk lib, withWorkspaceLock for canvas.json, comments.json<br/>and update_artboard's html + meta| Disk
  Skill -->|copy shipped skills/cursor-design/SKILL.md when bytes differ; never through a symlink| Home
  Disk -->|fs events| Watcher
  Watcher --> Panel
  Cmds --> Panel
  Cmds -->|exportHandoff via disk lib| Disk
  Panel -->|canvas:updated, artboard:error, ui:status,<br/>comments:updated, comment:added, comment:saved, ui:copied,<br/>artboard:edited, ui:error| Chrome
  Chrome -->|artboard:ready, frame:place, comment:create,<br/>comment:reply, comment:set-status, comment:copy, comment:copy-open,<br/>artboard:edit (Edit-mode inspector, 9e), artboard:history (Undo / Redo, 9f)| Panel
  Panel -->|placeFrameFromChrome, addComment, replyToComment,<br/>setCommentStatus, markCommentsSent, editArtboard → updateArtboard under the lock,<br/>undo / redo: updateArtboard with a snapshot from editHistory (9f);<br/>readComments, getComment, listComments| Disk
  Panel -->|vscode.env.clipboard.writeText: the locked Agent prompt (8h)| Clip
  Chrome -->|getState on load (parseSavedCommentUi), setState: each save keeps the other keys| State
  Chrome -->|blob URL: stamped HTML + runtime| Frames
  Frames -->|cd:frame-height, cd:frame-wheel,<br/>cd:ready, cd:hover, cd:pick, cd:key,<br/>cd:anchor-rects| Chrome
  Chrome -->|postToFrame: cd:mode (interact, comment, edit),<br/>cd:pick-parent, cd:pick-child, cd:anchors,<br/>cd:pick-refresh, cd:edit-apply (Edit mode, 9e)| Frames
```

Each blob frame's head starts with the artboard's `<meta charset>`, then `FRAME_CSP` (inline
script and style only, no sources), then the runtime: a nonce'd `<script src>`, even one injected
at runtime or by a script placed before `<meta charset>`, never loads. Style attributes render: the
chrome CSP allows them (`style-src-attr 'unsafe-inline'`, 9a); inline `on*` handlers stay blocked, and a
`url(…)` inside a style is still a blocked subresource. Chrome → frame messages (8d1) go only through `postToFrame`, to registered iframes; the frame
runtime accepts them only from the parent it captured at load; its one write to the design DOM is
`cd:edit-apply`'s Edit-mode preview (9e). Chrome never touches disk or MCP. The MCP
process never touches the panel; it reaches the user only through disk and the watcher.

## Comments for the Agent (8e)

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as MCP
  participant D as Disk
  participant H as Host
  A->>M: list_comments {status?} / get_comment {id}
  M->>D: read comments.json; artboards/<frameId>.html (parse5, once per frame per call)
  M-->>A: comment + stale, targetMissing, hint? (list: replyCount instead of replies)
  A->>M: update_artboard (existing)
  A->>M: resolve_comment {id, note}
  M->>D: withWorkspaceLock: re-read comments.json, resolved + agent reply, write
  alt resolved / unknown / thread full / corrupt / lock busy
    M-->>A: isError COMMENT_RESOLVED / COMMENT_NOT_FOUND / INVALID_ARGS / CORRUPT_COMMENTS / WORKSPACE_BUSY
  end
  D-->>H: watcher (comments.json changed)
  H->>H: identical canvas:updated, no frame reload
```

- `stale` and `targetMissing` come from disk only (`commentTarget.ts`): the stored selector runs
  through the in-house `selectMatches` (`selectorMatch.ts`: finder grammar only, one linear walk
  with Chromium's matching rules); a selector outside that grammar, or a match past
  `MAX_MATCH_WORK` element-steps, leaves both flags `null`.
- Every flag read (MCP and panel) shares one path: a parse cached per workspace and frame while
  the HTML text is identical (32 frames at most, oldest evicted), and a 200 ms target-check budget
  timed after the parse. Past the budget, a comment that needs a match reports `null` flags and a
  hint to read again.
- The panel reads the same flags (`readComments`, 8f2) and shows a broken file as its own banner;
  nothing on the canvas or export path reads it, so it never blanks the stage.

## Panel open and handshake

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as MCP
  participant D as Disk
  participant H as Host
  participant C as Chrome
  A->>M: set_artboard
  M->>D: write html + meta + manifest, then .ensure-panel
  D-->>H: watcher (debounced)
  H->>H: openArtboardPanel (preserveFocus), webview.html = chrome shell
  H->>D: delete .ensure-panel
  C->>H: artboard:ready (after the message listener exists)
  H->>H: panelFrames (9a): cap on disk HTML, tag changed frames with data-cd-src (memo)
  H->>C: canvas:updated {activeArtboardId, generation, cspNonce, frames[{id, label, x, y, width, group?, generation, hash, html}]}
  opt snapshot has an error
    H->>C: artboard:error {message}
  end
  H->>C: ui:status {mcpAvailable, handoffStale}
  H->>C: comments:updated {comments, error?}
```

- Before `artboard:ready`, the host keeps only the latest snapshot, status and comment list, and
  flushes them on ready in that order (`createPanelOutbox`). A later `artboard:ready` (webview
  reload) re-sends all three; `ui:status` waits until `mcpAvailable` is known. Answers to a chrome
  request (`comment:added`, `comment:saved`, `ui:error`) are posted only while ready and never
  replayed.
- The panel can also open from the **Open Artboard** command.
- When the panel becomes visible, `reloadVisibleArtboardFromDisk` posts a fresh snapshot and
  comment list. Every watcher refresh re-reads the comment list too; the last read started wins.
- In an untrusted workspace the host posts `frames: []` plus the untrusted error, and `ui:status`
  reports `mcpAvailable: false`. No watcher runs and no artboard script loads.

## Agent edit to live frame

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as MCP
  participant D as Disk
  participant H as Host
  participant C as Chrome
  participant F as Frame iframe
  A->>M: update_artboard {baseGeneration|baseHash}
  M->>D: requireHtmlFile + exact-case name (no lock yet)
  alt missing or case variant
    M-->>A: isError: ARTBOARD_NOT_FOUND
  else lock held past 2 s
    M-->>A: isError: WORKSPACE_BUSY (nothing written)
  else base matches (under withWorkspaceLock)
    M->>D: read, compare, write html + meta (generation + 1)
  else stale base (under withWorkspaceLock)
    M-->>A: isError: conflict, read_artboard and retry
  end
  D-->>H: watcher (debounced)
  H->>D: readCanvasView (disk HTML; frame hash = hashHtml, hashed once with the handoff compare)
  alt disk HTML over 1.5M chars
    H->>H: html '' + too-large message (tile)
  else memo hit (same frame id, same disk HTML)
    H->>H: memoized tagged copy, no parse
  else changed frame
    H->>H: cachedArtboardDocument (parse shared with comment flags), sourceTaggedHtml
    opt tagging throws
      H->>H: log artboardDisk.sourceTags:<id> once, post untagged
    end
  end
  H->>C: ui:status + canvas:updated
  C->>C: html changed: new blob URL, height guard reset
  C->>F: load stamped document (runtime first in head)
  F->>C: cd:frame-height {height} (debounced, clamped 20000)
  F->>C: cd:frame-wheel {deltaX, deltaY, ctrlKey, x, y} (when nothing inside can scroll)
```

Chrome routes every window message with `routeMessage`: a registered iframe's window is a frame
message (then `parseFrameMessage`), any other opaque-origin sender is dropped, the rest goes to
`parseHostMessage`. Source tags (9a) number every element written in the file by start-tag
order (`sourceTags.ts`; implied elements, `script`/`style`/`title`/`textarea`, template content and SVG
`text` get none) and are deterministic, so an unchanged frame re-posts identical HTML. Disk, export,
`read_artboard`, comment flags and comment selectors never see them; the memo is pruned to the
posted frames (and emptied on the untrusted path). Each `canvas:updated` is merged by `mergeCanvasFrames`: an identical re-post
(tab switch) changes nothing; new html reloads that frame and restarts its height guard.

Stage pan and zoom have three inputs, all through `wheelToView` / `panStage`: a wheel on the stage
(Stage's non-passive listener), `cd:frame-wheel` from a frame, and the root scroll sink. Chromium
latches a trackpad gesture to the out-of-process frame it started over and, once the frame slides
out from under the pointer, hands the rest to the chrome as native root scroll. The chrome is
`position: fixed` over a body with hidden scroll room, so `CanvasState` turns each root scroll into a pan and
scrolls back (`scrollSinkStep`), but only within a second of a frame wheel or an earlier sink pan.

## Panel edit message (9c)

The host side; the chrome side (sender, queue, adopt) is the next section (9e).

```mermaid
sequenceDiagram
  participant C as Chrome
  participant H as Host
  participant D as Disk
  C->>H: artboard:edit {requestId, frameId, sourceNumber, hash, field, value, liveText?}
  alt no valid requestId
    H->>H: log panelEdit.answer, no answer
  else untrusted / no folder / malformed
    H->>C: ui:error {requestId, message}
  else valid (parseChromeMessage: shape and size only)
    H->>D: editArtboard: read file, exact-case name, size cap, hash check, cached parse, editArtboardHtml
    alt missing / too large / hash differs / refusal
      H->>C: ui:error {requestId, message} (panel copy allowlist)
    else same bytes
      H->>C: artboard:edited {requestId, frameId, hash, generation, html} (no write)
    else changed
      H->>D: updateArtboard {html, baseHash}: pre-checks, lock, re-check hash, write html + meta
      alt changed meanwhile / busy
        H->>C: ui:error {requestId, message}
      else written
        H->>H: panelFrameHtml: tag the new HTML, seed the memo (no await before the post)
        H->>C: artboard:edited {requestId, frameId, hash, generation, html}
        D-->>H: watcher echo (200 ms debounce)
        H->>C: canvas:updated (that frame: the same html, hash, generation)
      end
    end
  end
```

- The answer is posted with no awaited I/O after the write, so it beats the 200 ms echo; a
  write-plus-lock-release over 200 ms, or a refresh that read disk before the write, can still
  post the old frame after it (`ponytail:` in `panelEdit.ts`). The chrome (9e): an echo first
  reloads the frame and the answer is then a no-op; a stale pre-write post is skipped.
- Panel copy comes from `editRequestErrorMessage`, an allowlist: Agent copy (`ConflictError`,
  `CorruptMetaError`) never reaches the panel; refusals carry their own copy (`EditRefusedError`).

## Comment-mode picking (8d1)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (App + commentPick)
  participant A as Frame A runtime
  participant B as Frame B runtime
  A->>C: cd:ready (load or reload)
  C->>C: clear A's hover/pick
  C->>A: cd:mode {current mode}
  U->>C: Comment toggle
  C->>A: cd:mode {comment}
  C->>B: cd:mode {comment}
  U->>A: pointer move
  A->>C: cd:hover {rect|null} (once per animation frame, on change)
  U->>A: click (picked, then blocked; frame takes focus)
  A->>C: cd:pick {selector|null, tagName, text, rect|null, point, box, styles, isPage, repost}
  U->>A: ↑ / ↓ (focus in frame)
  A->>C: cd:pick (parent / child)
  U->>C: parent / child icon buttons, or ↑/↓ with chrome focus
  C->>A: cd:pick-parent / cd:pick-child
  A->>C: cd:pick
  U->>B: click in frame B
  B->>C: cd:pick
  C->>A: cd:mode {comment} (A forgets its path)
```

- Chrome drops `cd:hover` and `cd:pick` in Interact mode, and a `cd:pick` whose `edit` does not
  match the mode (`pickCounts`, 9d); a design's own script can post them.
- Only iframe frames hold a pick: a frame that becomes a tile or leaves the stage drops it; an
  empty stage leaves Comment mode.
- Frame data reaches the UI only as chip text and outline geometry (never `{@html}`).

## Edit mode and selection (9d)

The 8d1 picker serves Edit mode too: same blocked events, keys, hover and re-posts. No host
message and no disk write from picking itself; the inspector's fields save through the 9e flow below.

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (Toolbar, CommentPicker, Inspector)
  participant A as Frame A runtime
  participant B as Frame B runtime
  participant S as Webview state
  U->>C: Edit button, or C / Escape (chrome keydown, or cd:key from a frame)
  C->>C: #setMode(pressedMode(...)): same mode = nothing; focus in the inspector → stage viewport first
  C->>A: cd:mode {edit}
  C->>B: cd:mode {edit}
  C->>S: saveCommentUi {mode: 'edit'} (previous mode dropped first; omitted for interact)
  A->>C: cd:ready (load or reload)
  C->>C: if A held the pick: drop it (inspector empty, a focused step button keeps focus)
  C->>A: cd:mode {current mode}
  U->>A: click (blocked, picked; frame takes focus)
  A->>C: cd:pick {..., edit {sourceNumber|null, sharedNumber, textState, text, style|null}}
  alt pickCounts false (Interact; Edit without edit; Comment with edit, e.g. forged)
    C->>C: dropped: no pick, no draft, nothing sent
  else Edit mode with edit
    C->>C: inspectorView: empty / not-editable / editable; pickAnnouncementText in the toolbar
  end
  U->>C: Select parent / Select child (inspector)
  C->>A: cd:pick-parent / cd:pick-child
  A->>C: cd:pick {..., edit}
  U->>B: click in frame B
  B->>C: cd:pick {..., edit}
  C->>A: cd:mode {edit} (A forgets its path)
```

- `parsePickEdit` rejects the whole `cd:pick` on any bad `edit` field and rebuilds it: number
  `null` or a safe non-negative integer, `sharedNumber` only with a number, `text` (raw text node,
  at most `MAX_EDIT_TEXT_CHARS`, `''` unless plain), `style` (at most `MAX_PICK_STYLE_CHARS`).
  Both are the page's own text, shown only as field values.
- The frame reads the edit target through `getAttribute`, `childNodes` and `querySelectorAll` only
  (`editTarget.ts`); a page pick edits `body`. The exported `canvas.html` never sends `cd:mode`, so
  this code stays dormant there.
- Inspector fields: the inline value as typed (`inlineValue`: the last declaration, read after the
  tokenizer's own colon), the computed value from the pick's `styles` as placeholder; not editable
  for no source number or a number shared by two live elements; "ask the Agent" for mixed content
  or text over the cap.

## Edit fields + save (9e)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (Inspector, EditState, CanvasState)
  participant F as Frame runtime
  participant H as Host
  participant D as Disk
  U->>C: focus a field
  C->>F: cd:pick-refresh
  F->>C: cd:pick {..., edit, repost: true} (describeContent, selector reused; sequence kept)
  U->>C: first input
  C->>C: startDraft: key {frameId, sourceNumber, documentVersion}, baseline liveText + style
  C->>F: cd:edit-apply {sourceNumber, text | style} (draftPreview: previewText / setStyleProperty)
  F->>F: Edit mode, exactly one [data-cd-src=N]: textContent (plain only) or setAttribute style
  F->>C: cd:pick (rAF re-post, refreshed edit, repost: true)
  U->>C: Enter / blur (text, size, spacing), change (colour), or a new pick of another element
  alt unchanged
    C->>F: cd:edit-apply {baseline} (only if a preview was sent)
  else invalid (normalizeStyleValue, open or over-cap style, control characters)
    C->>C: field error (aria-invalid, Message), draft kept
    C->>F: cd:edit-apply {baseline}
  else save
    C->>C: enqueueEdit; nextSend: one in flight, drop heads whose frame left, is a tile or reloaded (NOT_SAVED_COPY)
    C->>H: artboard:edit {requestId, frameId, sourceNumber, hash, field, value, liveText?}
    H->>D: editArtboard → updateArtboard (9c)
    alt written or same bytes
      H->>C: artboard:edited {requestId, frameId, hash, generation, html}
      C->>C: adoptEditAnswer (record.hash === base): html, hash, generation; replacedHashes += base; no reload; send next
      H->>C: canvas:updated (echo: same html and hash): nothing reloads
      opt refresh that read disk before the write
        H->>C: canvas:updated (a replaced hash, older generation): placement only
      end
    else refused
      H->>C: ui:error {requestId, message}
      C->>C: request error (aria-live), waiting saves dropped
      C->>F: reloadFrame: new blob from the latest adopted html
      F->>C: cd:ready
      C->>C: drafts of that frame end
      C->>F: cd:mode {edit}
    end
  end
```

- A draft and its save target the draft's key, never the current pick: the frame posts `cd:pick`
  before it takes focus, so a click on another element can arrive before the field's blur
  (`draftFate` commits the open draft against its own key).
- `FrameRecord.html` is the latest known copy; `documentHtml` / `documentVersion` are what the
  iframe was built from, and only they re-run Frame's blob effect. A post whose hash is in
  `replacedHashes` with an older generation is a stale pre-write read; a post with the record's
  own hash keeps the list; any other post is an outside change: it reloads and clears the list.
- An outside change (Agent, editor) reloads the frame as before; open drafts and waiting saves
  for it end with "Not saved: the frame changed. Try again." A refusal's copy wins over that
  copy in the same event. The request error clears on the next commit or a new pick of another
  element and survives a mode switch.
- One `artboard:edit` in flight per panel, no timeout (`ponytail:` in `editRequests.ts`).

## Undo / redo (9f)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (Inspector, EditState, CanvasState)
  participant F as Frame runtime
  participant H as Host (panelEdit, editHistory)
  participant O as Host outbox
  participant D as Disk
  participant A as Agent / editor
  C->>H: artboard:edit {…} (9e)
  H->>D: editArtboard → updateArtboard
  H->>H: recordEdit (same epoch): base onto undo (max 20), redo emptied; same bytes: nothing
  H->>C: artboard:edited {requestId, frameId, hash, generation, html, canUndo, canRedo}
  alt Undo / Redo button (aria-disabled without the flag: click ignored)
    U->>C: click
  else Cmd/Ctrl+Z (Shift = redo), chrome focus, not a text field
    U->>C: keydown, capture phase on window: preventDefault, stopPropagation (historyKeyStep)
  else Cmd/Ctrl+Z, frame focus
    F->>C: cd:key {undo | redo} (not from editable targets)
    C->>C: forwardedHistoryStep: Edit mode, sender = history frame, sender holds focus; else ignored
  end
  C->>C: handleHistoryStep: open drafts commit, enqueueStep; nextSend: one in flight, drop a step whose frame left, is a tile or lost its flag
  C->>H: artboard:history {requestId, frameId, step}
  alt no requestId
    H->>H: log panelEdit.history, no answer
  else untrusted / no folder / malformed / bad frame id / nothing held
    H->>C: ui:error {requestId, message}
  else
    H->>D: updateArtboard {html: snapshot, baseHash: history current} (lock, compare, write html + meta)
    alt conflict or missing file
      H->>H: forgetHistory
      H->>C: ui:error {requestId, message}
    else busy / disk error
      H->>C: ui:error {requestId, message} (history kept)
    else written
      H->>H: recordStep (same epoch): one snapshot moves between undo and redo
      H->>C: artboard:edited {requestId, frameId, hash, generation, html, canUndo, canRedo}
      C->>C: adoptEditAnswer; announce "Undone / Redone in <frame>."
      opt the adopt applied
        C->>F: reloadFrame: new blob from the restored html
        F->>C: cd:ready
        C->>F: cd:mode {edit} (the pick drops; the history frame stays)
      end
    end
  end
  D-->>H: watcher (200 ms)
  H->>O: postSnapshot
  O->>O: keepUnchangedHistories: a held hash keeps, any other (or '') forgets
  O->>C: canvas:updated (frames + canUndo, canRedo read at send)
  H->>C: comments:updated (via the outbox)
  A->>D: update_artboard / editor save
  D-->>H: watcher
  H->>O: postSnapshot
  O->>O: keepUnchangedHistories: unknown hash, forget
  O->>C: canvas:updated (canUndo false, canRedo false): the frame reloads as today
```

- History lives in extension memory (`editHistory.ts`): per frame, up to 20 whole-file steps
  between undo and redo plus the file last written. It is cleared on panel dispose and on any
  workspace-folder change (`clearEditHistories`, which bumps an epoch so a request still awaiting
  the lock records nothing). It survives the webview being hidden: the outbox replays
  `canvas:updated` with flags read at send time.
- The outside-change rule accepts any hash the history holds, so a stale refresh (the 9c ceiling)
  does not wipe it; an outside write that recreates a held state is caught at the next step's
  checked write.
- Undo / Redo act on the frame of the latest accepted Edit-mode pick from a frame that holds focus
  (`historyFrameId`; a pick without focus, e.g. one a design script posts, never moves it, F-146),
  kept after the pick drops and across mode switches, lost on a webview reload.
- The host trusts the chrome's one-in-flight queue (`ponytail:` in `panelEdit.ts`): two
  overlapping steps after a webview reload can forget a valid history. No data loss.
- The keyboard paths ship only as far as the 9f F5 spike in Cursor allows (the spec records it).

## Comment mode and popover (8f1)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (App, CommentPopover)
  participant F as Frame runtime
  participant H as Host (panelComments, outbox)
  participant D as Disk (.cursor-design)
  alt key with chrome focus
    U->>C: c / Escape
  else key with frame focus (not editable, no Ctrl/Meta/Alt, no repeat)
    U->>F: c / Escape
    F->>C: cd:key {key: 'c' | 'Escape'}
    Note over C: ignored while the popover is open
  end
  C->>F: cd:mode {comment | interact} (every live frame)
  U->>F: click (blocked, picked)
  F->>C: cd:pick {..., box, repost: false}
  C->>C: open or retarget the popover, focus the box next frame
  F->>C: cd:pick {..., repost: true} (scroll / resize)
  Note over C: moves the open draft only; never opens one
  U->>C: ↑ / ↓ (box empty, focus in popover)
  C->>F: cd:pick-parent / cd:pick-child
  F->>C: cd:pick {repost: false}
  U->>C: Enter (box has text)
  C->>H: comment:create {requestId (UUID), frameId, generation, pick fields, body}
  alt no valid requestId
    H->>H: logged, no answer
  else untrusted, no folder, malformed, or addComment fails (PICK_OUTDATED, busy, corrupt)
    H->>C: ui:error {requestId, message} (text kept)
  else ok
    H->>D: addComment under withWorkspaceLock
    H->>C: comment:added {requestId}
    C->>F: cd:mode {comment} (pick cleared, popover closed)
    H->>D: readComments
    H->>C: comments:updated {comments}
  end
  U->>C: Escape in popover (mode stays)
  C->>F: cd:mode {comment} (pick cleared, focus to frame)
  U->>F: Escape again
  F->>C: cd:key {Escape}
  C->>F: cd:mode {interact}
```

- An answer whose `requestId` is not the pending one is ignored; Cancel is disabled while a save
  is pending. Toggling the mode drops the draft, so a late answer finds nothing.
- An Agent edit reloads the frame and drops the pick; the popover keeps its text and greys out
  the parent and child buttons, and the next Add gets "Pick it again" (`PICK_OUTDATED`).
- A forged `cd:key` from a design script cannot discard a draft. A forged user `cd:pick` can
  retarget it; the text is kept and the chip changes.
- After Add, the new comment's pin arrives with that `comments:updated` (8f2, next section).

## Pins (8f2)

```mermaid
sequenceDiagram
  participant D as Disk (.cursor-design)
  participant H as Host (panelComments)
  participant C as Chrome (App, Pins)
  participant F as Frame runtime (pinAnchors)
  Note over D,H: watcher refresh, comment:create success, panel opened or shown
  H->>D: readComments (comments.json + artboards/id.html)
  Note over H: parse cached by HTML text, matches within 200 ms, then null flags
  H->>C: comments:updated {comments[ + stale|null, targetMissing|null ], error?}
  C->>F: cd:anchors {anchors[{id, selector}]} (every live frame, [] with no element comments)
  alt from a sender other than the captured parent, or any bad entry
    F->>F: message dropped
  else empty list
    F->>F: observers off, pending measurement cancelled
  else non-empty list
    F->>F: ResizeObserver, MutationObserver, scroll, resize, transitionend, animationend
  end
  F->>C: cd:anchor-rects {anchors[{id, box|null, visible|null}]} (forced once per cd:anchors)
  loop any trigger, one measurement per animation frame
    opt a target moved more than 0.5px, or a null flipped, or the id list changed
      F->>C: cd:anchor-rects {all anchors}
    end
  end
  alt not a registered iframe, or any bad entry
    C->>C: message dropped
  else valid
    C->>C: store under the sender's frame id (any mode), layoutPins from drawn frames + view
  end
  opt frame reload (cd:ready)
    F->>C: cd:ready
    C->>F: cd:mode {current}
    C->>C: drop that frame's anchors, pins fall back to the stored rect
    C->>F: cd:anchors {that frame's list}
  end
```

- A pin is placed only for a comment on a live iframe frame. Frame-local point: a page comment is
  its fraction of the frame record; an element comment is its fraction of the live `box`, or of
  the stored `rect` until the frame answers or when `box` is `null`.
- A pin is hidden when the live `box` exists and `visible` is `null` or the point is outside it,
  and when the point is outside the frame. A forged `cd:anchor-rects` only moves or hides that
  frame's own pins: it is stored under the sender's id and never draws over a neighbor frame.
- Badge (`pinBadge`): none for a resolved comment, else `missing` (live `box: null` or
  `targetMissing: true`), else `stale`, else `unchecked` (both flags `null`).
- `cd:anchors` is ignored by `commentPicking`, so it never steps an open pick. The pin layer is
  `inert` while a draft is open, so a click there picks the element under it.
- A pin click opens `CommentThread` with no message to the host. Escape or Close returns focus to
  the pin. The thread closes when its comment or pin goes away, or a draft opens; focus inside it
  then moves to the stage viewport. One `$effect.pre` in `PinThread` closes it whenever `pins` no longer
  holds it, before it unmounts, so it never stays open while hidden.

## Comments panel (8g)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (App, CommentCard in the panel or a pin thread)
  participant H as Host (answerCommentRequest, outbox)
  participant D as Disk (.cursor-design)
  participant M as MCP
  participant A as Agent
  alt Reply
    U->>C: Reply, type, Enter
    C->>H: comment:reply {requestId (UUID), id, body (trimmed)}
  else Resolve or Reopen
    U->>C: Resolve / Reopen
    C->>H: comment:set-status {requestId (UUID), id, status: resolved | open}
  end
  Note over C: nothing is sent for blank text, or while this comment has a request pending
  alt no valid requestId
    H->>H: logged, no answer
  else untrusted, no folder, malformed (status sent too), or the write fails (gone, reply cap, corrupt, busy)
    H->>C: ui:error {requestId, message}
    C->>C: reply text kept, error shown inline and announced
  else ok
    H->>D: replyToComment / setCommentStatus (each takes withWorkspaceLock itself)
    H->>C: comment:saved {requestId}
    C->>C: answerAction: reply box emptied but kept open, or the new status announced
    H->>D: readComments
    H->>C: comments:updated {comments, error?}
    Note over C: keepLiveActions, focus kept, then cd:anchors (Pins)
  end
  A->>M: resolve_comment {id, note}
  M->>D: withWorkspaceLock: re-read comments.json, resolved + agent reply, write
  alt already resolved (the user resolved first)
    M-->>A: isError COMMENT_RESOLVED (nothing written)
  end
  D-->>H: watcher (comments.json changed, 200 ms debounce)
  H->>C: ui:status + canvas:updated (identical, no frame reload)
  H->>D: readComments
  H->>C: comments:updated (note as an Agent reply, item under Resolved)
```

- `openArtboardPanel` hands every message that claims `comment:create`, `comment:reply` or
  `comment:set-status` (`commentRequestType`, read before any parse) to `answerCommentRequest`,
  valid or not. It checks the `requestId`, trust, the folder, then a parse whose type must match
  the claim, then writes. `comment:create` takes the same handler and is unchanged on the wire
  (answered by `comment:added`, 8f1).
- The answer is posted before `postPanelComments`, so `comment:saved` arrives before the
  `comments:updated` it causes; a failure posts no refresh. A deleted comment reads "This comment
  no longer exists." (`commentRequestErrorMessage`), never the Agent copy.
- A user Resolve after the Agent's is a no-op that writes nothing and still answers
  `comment:saved`. A reply keeps the status. The host's own write also fires the watcher, which
  posts the same snapshot and list again.
- Chrome: one request in flight per comment, matched only by `requestId`. A `ui:error` is offered
  to both the draft (8f1) and the actions; UUIDs never cross-match. A `comments:updated` without
  `error` drops actions for comments no longer listed; one with `error` keeps them, so typed text
  survives a failed read. A webview reload resets the actions (a lost answer leaves `pending` set
  until then, `ponytail:`).
- The panel and the pin thread render the same `CommentCard`, and actions are keyed by comment
  id, so a reply box open in one is open in the other with the same text. The panel is always
  mounted and renders its list only while open. When an update rebuilds the focused item and focus
  fell to body, it goes back to the same control, but only while the webview has focus.
- Panel state: the toolbar toggle saves `commentsPanelOpen` (`saveCommentsPanelOpen`) in the one
  webview state record beside `stageView`; each save keeps the other keys. A missing or
  non-boolean value reads as closed. Nothing new on disk.
- Comment UI across a tab switch (fix, chrome-only; 9d renamed the mode key to `mode`, Comment or Edit): one `$effect` saves `mode`,
  `commentDraft` (with its `body`; never a pending one), `openThreadId` and `replyDrafts` through
  `saveCommentUi`, omitting default keys. On load `parseSavedCommentUi` drops bad keys one by one.
  Comment mode and reply text come back at once; the draft is held until the first
  `canvas:updated` (`resolveHeldDraft`: back on a live iframe frame, else dropped), the thread
  until its pin is placed (`resolveHeldThread`). A restored item takes focus only when nothing else
  has it. No message to the host.
- Click to jump is chrome-only, with no message to the host or a frame. The target chip of a
  comment on a live iframe frame runs `jumpTarget` from the frame's latest `cd:anchor-rects` (else
  the stored rect), then `jumpStageView` (keeps the zoom, zooms out only to fit) through
  `commitStageView`, which clamps and saves `stageView`. `Overlay` draws the `data-cd-flash`
  outline for `JUMP_FLASH_MS` (1.5 s), following pan, zoom and later `cd:anchor-rects`. Nothing
  scrolls inside the frame.

## Copy for Agent (8h)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome (App + commentsPanel.ts rules, CommentCard / CommentsPanel)
  participant H as Host (answerCommentRequest)
  participant CB as vscode.env.clipboard
  participant D as Disk (comments.json)
  participant A as Agent chat
  U->>C: Copy for Agent (panel card or pin thread) / Copy N open comments for Agent
  alt any copy pending (copyPending), anything pending on that comment, or N = 0
    C->>C: nothing posted (button aria-disabled)
  else
    C->>H: comment:copy {requestId (UUID), id} / comment:copy-open {requestId}
    alt no valid requestId
      H->>H: logged, no answer
    else untrusted, no folder, malformed, gone id, zero open, clipboard rejects
      H->>C: ui:error {requestId, message}
      H->>C: comments:updated (refresh)
    else
      H->>D: getComment / listComments {status: open} (no lock)
      H->>CB: await writeText(singleCommentPrompt / openCommentsPrompt)
      H->>D: markCommentsSent(ids) (takes withWorkspaceLock; open → sent only)
      alt mark throws (busy, corrupt)
        H->>C: ui:error {requestId, COPIED_NOT_MARKED}
        H->>C: comments:updated (refresh)
      else
        H->>C: ui:copied {requestId, count}
        H->>D: readComments
        H->>C: comments:updated
        D-->>H: watcher (only when a comment changed): ui:status + canvas:updated (identical) + comments:updated
      end
    end
    C->>C: answerAction / answerCopyOpen: "Copied" (or "Copied N comments") for 1.5 s, announcement, or the error linked to its button
  end
  U->>A: paste the prompt by hand
```

- The prompt is built in the host from disk (`commentPrompt.ts`): artboard, version and styles
  never reach the chrome. Both templates are locked word for word and pinned by a literal test.
  Frame-sourced fields (`artboard`, `selector`, `text`) pass `toOneLine` (control, format and
  white-space runs become one space, capped, no lone surrogate); `{text}` also loses its `"`. The
  body keeps its newlines (the user's own text, `ponytail:`).
- The clipboard is written before `markCommentsSent`, so a rejected write marks nothing sent.
  `count` is how many comments moved open → sent: 0 for a re-copy, or when the Agent resolved them
  first (they stay resolved). `markCommentsSent` writes nothing when nothing changed, so a re-copy
  fires no watcher.
- Copy N open comments for Agent lists the open ids in `comments.json` (creation) order. Zero open answers
  "There are no open comments to copy." with no clipboard write. Every copy answer, success or
  failure, is followed by a `comments:updated`, so a stale N corrects itself.
- Chrome: one copy at a time across the panel and threads (`copyPending`), so the clipboard holds
  the prompt of the last answered copy. `ui:copied` matches only a pending copy and never touches a
  reply draft. `comments:updated` never clears the batch's pending request. A lost answer keeps
  every Copy button blocked until a webview reload (the 8g `ponytail:`).

## Frame drag / resize (8c)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Chrome
  participant H as Host
  participant D as canvas.json
  U->>C: drag label / right handle (or arrow nudge)
  C->>C: local preview (frameGesture), Escape reverts
  U->>C: release (or last arrow up)
  C->>H: frame:place {id, x, y, width, base: {x, y, width}}
  H->>H: parseChromeMessage, refuse if untrusted
  H->>D: withWorkspaceLock: compare base, write
  H->>C: canvas:updated (always)
  opt failure (FRAME_MOVED, WORKSPACE_BUSY, corrupt)
    H->>C: artboard:error, preview dropped
  end
```

An Agent `place_frame` takes the same lock. If it lands mid-drag, the next `canvas:updated`
settles the gesture to disk (the Agent wins).

## Export

`export_artboard` (MCP) and the **Export Handoff** command both call the disk lib.

- They write `handoff/<exportId>/`: `IMPLEMENT.md`, `canvas.html`, `tokens.json`, and
  `<group>/<id>/index.html`.
- They record `lastExport` in `manifest.json`.
- `canvas.html` embeds the frame runtime and a preview controller that accepts only
  `cd:frame-height` and `cd:frame-wheel` from its own frames. It never sends `cd:anchors`, so the
  runtime's pin observers stay off there.
- `handoff_status`, and `ui:status.handoffStale`, compare the current frames with `lastExport`.

## Message contract (shipped)

| Direction | Message | Payload |
|---|---|---|
| chrome → host | `artboard:ready` | none |
| chrome → host | `frame:place` | `{id, x, y, width, base: {x, y, width}}` |
| chrome → host | `comment:create` | `{requestId, frameId, generation, selector, tagName, text, rect \| null, point, box, styles, isPage, body}` |
| chrome → host | `comment:reply` | `{requestId, id, body}` |
| chrome → host | `comment:set-status` | `{requestId, id, status: 'open' \| 'resolved'}` |
| chrome → host | `comment:copy` | `{requestId, id}` (8h) |
| chrome → host | `comment:copy-open` | `{requestId}` (8h) |
| chrome → host | `artboard:edit` | `{requestId, frameId, sourceNumber, hash, field: 'text' \| 'font-size' \| 'color' \| 'padding' \| 'margin', value, liveText?}` (9c; `liveText` iff text; sent by the Edit-mode inspector since 9e, one in flight per panel) |
| chrome → host | `artboard:history` | `{requestId, frameId, step: 'undo' \| 'redo'}` (9f; the inspector's Undo / Redo or Cmd/Ctrl+Z; one in flight per panel, shared with `artboard:edit`) |
| host → chrome | `canvas:updated` | `{activeArtboardId, generation, cspNonce, frames[]}` (each frame's `html` is the disk HTML with host-added `data-cd-src="N"` numbers, 9a; each frame's `hash` is `hashHtml` of the disk HTML, `''` when unreadable, 9c; each frame's `canUndo` / `canRedo` is read from the undo history when the outbox sends, 9f) |
| host → chrome | `artboard:error` | `{message}` (safe copy) |
| host → chrome | `ui:status` | `{mcpAvailable, handoffStale}` |
| host → chrome | `comments:updated` | `{comments[], error?}` (each comment has `stale` and `targetMissing`, `true`, `false` or `null` = unchecked) |
| host → chrome | `comment:added` | `{requestId}` |
| host → chrome | `comment:saved` | `{requestId}` (answer to `comment:reply` / `comment:set-status`, posted before the `comments:updated` it causes) |
| host → chrome | `ui:copied` | `{requestId, count}` (answer to `comment:copy` / `comment:copy-open`; `count` = comments moved open → sent; posted before the `comments:updated` it causes) |
| host → chrome | `artboard:edited` | `{requestId, frameId, hash, generation, html, canUndo, canRedo}` (9c answer to `artboard:edit`, 9f also to `artboard:history`; `html` = the tagged copy the echo will post; the chrome adopts it without a reload, 9e, and reloads the frame after a step, 9f) |
| host → chrome | `ui:error` | `{message, requestId?}` (safe copy) |
| frame → chrome | `cd:frame-height` | `{height}` |
| frame → chrome | `cd:frame-wheel` | `{deltaX, deltaY, ctrlKey, x, y}` (frame-local CSS px) |
| frame → chrome | `cd:ready` | none |
| frame → chrome | `cd:hover` | `{rect \| null}` (frame-local CSS px) |
| frame → chrome | `cd:pick` | `{selector \| null, tagName, text, rect \| null, point, box, styles, isPage, repost, edit?}` (selector from finder inside the frame; `point` relative to the target's box, `box` its unclipped size; `repost` true for a scroll or resize re-post; `edit` `{sourceNumber \| null, sharedNumber, textState, text, style \| null}` only in Edit mode, 9d; `style` `''` when absent, `null` only over the cap, 9e) |
| frame → chrome | `cd:key` | `{key: 'c' \| 'Escape' \| 'undo' \| 'redo'}` (frame focus, not editable, no Alt or repeat; C / Escape without Ctrl/Meta; undo / redo are Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z, 9f, acted on only from the focused history frame in Edit mode) |
| frame → chrome | `cd:anchor-rects` | `{anchors: [{id, box \| null, visible \| null}]}` (frame-local CSS px; `box` unclipped, `visible` clipped by every ancestor whose overflow is not visible (html and body excluded) and the frame viewport; `box: null` requires `visible: null`) |
| chrome → frame | `cd:mode` | `{mode: 'interact' \| 'comment' \| 'edit'}` |
| chrome → frame | `cd:pick-parent`, `cd:pick-child` | none |
| chrome → frame | `cd:anchors` | `{anchors: [{id, selector}]}` (the frame's element comments, every status; replaces its previous list) |
| chrome → frame | `cd:pick-refresh` | none (9e, Edit mode only; the frame re-describes its pick, selector reused, and re-posts it with `repost: true`) |
| chrome → frame | `cd:edit-apply` | `{sourceNumber, text}` or `{sourceNumber, style}` (9e, Edit mode only; the live preview of the one element with that number; display only) |

This table is the normative message contract; rule 02 keeps only the cross-cutting invariants.
If the table and the code disagree, fix whichever is wrong. `frameMessages.test.ts` fails when
this section's `cd:*` names differ from the frame message constants.
