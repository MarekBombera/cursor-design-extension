# System map

> **Durable file.** The data flow of the **shipped** code on the default branch: processes,
> messages, and disk. It is for humans steering the project and for agents about to change it.
> `/complete` merges each finished work item's flows in, after checking them against the built
> code. `/feature`, `/fix`, and `/rollback` read it as the baseline and repair any drift they find.
> Planned flows never go here; they live in `current-feature-overview.md` until shipped.
> Open in Markdown preview to render the diagrams.

**Last verified against code:** fix Fewer pick re-posts on scroll (`fix/fewer-pick-re-posts-on-scroll`, F-46; no flow change: unchanged `cd:pick` re-posts are skipped and batched per frame).

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
    Tools["tools: set_artboard, update_artboard, read_artboard,<br/>list_artboards, set_active_artboard, place_frame,<br/>export_artboard, handoff_status<br/>serialized by enqueueDiskOp"]
  end
  subgraph Host["Extension host (dist/extension.js)"]
    Watcher["watcher .cursor-design/**<br/>200ms debounce, skips .lock / *.tmp"]
    Panel["openArtboardPanel<br/>postMessage, parseChromeMessage"]
    Cmds["commands: Open Artboard,<br/>Export Handoff, Reveal Folder"]
  end
  subgraph Webview["Webview (chrome CSP, nonce)"]
    Chrome["Svelte chrome<br/>hostBridge.svelte.ts"]
    Frames["one sandboxed blob iframe per artboard<br/>+ frame runtime (frame/runtime.ts)"]
  end
  Disk[(".cursor-design/<br/>manifest.json, canvas.json,<br/>artboards/id.html + meta,<br/>.ensure-panel, .lock, handoff/")]

  Agent -->|MCP tool calls| Tools
  Tools -->|disk lib, withWorkspaceLock for canvas.json| Disk
  Disk -->|fs events| Watcher
  Watcher --> Panel
  Cmds --> Panel
  Cmds -->|exportHandoff via disk lib| Disk
  Panel -->|canvas:updated, artboard:error, ui:status| Chrome
  Chrome -->|artboard:ready, frame:place| Panel
  Panel -->|placeFrameFromChrome under the lock| Disk
  Chrome -->|blob URL: stamped HTML + runtime| Frames
  Frames -->|cd:frame-height, cd:frame-wheel,<br/>cd:ready, cd:hover, cd:pick| Chrome
  Chrome -->|postToFrame: cd:mode,<br/>cd:pick-parent, cd:pick-child| Frames
```

Chrome → frame messages (8d1) go only through `postToFrame`, to registered iframes; the frame
runtime accepts them only from the parent it captured at load. Chrome never touches disk or MCP. The MCP
process never touches the panel; it reaches the user only through disk and the watcher.

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
  H->>C: canvas:updated {activeArtboardId, generation, cspNonce, frames[{id, label, x, y, width, group?, generation, html}]}
  opt snapshot has an error
    H->>C: artboard:error {message}
  end
  H->>C: ui:status {mcpAvailable, handoffStale}
```

- Before `artboard:ready`, the host keeps only the latest snapshot and status, and flushes them on
  ready (`createPanelOutbox`). A later `artboard:ready` (webview reload) re-sends both; `ui:status`
  waits until `mcpAvailable` is known.
- The panel can also open from the **Open Artboard** command.
- When the panel becomes visible, `reloadVisibleArtboardFromDisk` posts a fresh snapshot.
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
  alt base matches
    M->>D: write html + meta (generation + 1)
  else stale base
    M-->>A: isError: conflict, read_artboard and retry
  end
  D-->>H: watcher (debounced)
  H->>C: ui:status + canvas:updated
  C->>C: html changed: new blob URL, height guard reset
  C->>F: load stamped document (runtime first in head)
  F->>C: cd:frame-height {height} (debounced, clamped 20000)
  F->>C: cd:frame-wheel {deltaX, deltaY, ctrlKey, x, y} (when nothing inside can scroll)
```

Chrome routes every window message with `routeMessage`: a registered iframe's window is a frame
message (then `parseFrameMessage`), any other opaque-origin sender is dropped, the rest goes to
`parseHostMessage`. Each `canvas:updated` is merged by `mergeCanvasFrames`: an identical re-post
(tab switch) changes nothing; new html reloads that frame and restarts its height guard.

Stage pan and zoom have three inputs, all through `wheelToView` / `panStage`: a wheel on the stage
(Stage's non-passive listener), `cd:frame-wheel` from a frame, and the root scroll sink. Chromium
latches a trackpad gesture to the out-of-process frame it started over and, once the frame slides
out from under the pointer, hands the rest to the chrome as native root scroll. The chrome is
`position: fixed` over a body with hidden scroll room, so App turns each root scroll into a pan and
scrolls back (`scrollSinkStep`), but only within a second of a frame wheel or an earlier sink pan.

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
  A->>C: cd:pick {selector|null, tagName, text, rect|null, point, styles, isPage}
  U->>A: ↑ / ↓ (focus in frame)
  A->>C: cd:pick (parent / child)
  U->>C: Parent / Child, or ↑/↓ with chrome focus
  C->>A: cd:pick-parent / cd:pick-child
  A->>C: cd:pick
  U->>B: click in frame B
  B->>C: cd:pick
  C->>A: cd:mode {comment} (A forgets its path)
```

- Chrome ignores `cd:hover` and `cd:pick` outside Comment mode; a design's own script can post them.
- Only iframe frames hold a pick: a frame that becomes a tile or leaves the stage drops it; an
  empty stage leaves Comment mode.
- Frame data reaches the UI only as chip text and outline geometry (never `{@html}`).

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
  `cd:frame-height` and `cd:frame-wheel` from its own frames.
- `handoff_status`, and `ui:status.handoffStale`, compare the current frames with `lastExport`.

## Message contract (shipped)

| Direction | Message | Payload |
|---|---|---|
| chrome → host | `artboard:ready` | none |
| chrome → host | `frame:place` | `{id, x, y, width, base: {x, y, width}}` |
| host → chrome | `canvas:updated` | `{activeArtboardId, generation, cspNonce, frames[]}` |
| host → chrome | `artboard:error` | `{message}` (safe copy) |
| host → chrome | `ui:status` | `{mcpAvailable, handoffStale}` |
| frame → chrome | `cd:frame-height` | `{height}` |
| frame → chrome | `cd:frame-wheel` | `{deltaX, deltaY, ctrlKey, x, y}` (frame-local CSS px) |
| frame → chrome | `cd:ready` | none |
| frame → chrome | `cd:hover` | `{rect \| null}` (frame-local CSS px) |
| frame → chrome | `cd:pick` | `{selector \| null, tagName, text, rect \| null, point, styles, isPage}` (selector from finder inside the frame; `point` relative to the target's box) |
| chrome → frame | `cd:mode` | `{mode: 'interact' \| 'comment'}` |
| chrome → frame | `cd:pick-parent`, `cd:pick-child` | none |

Rule 02 is the normative contract. If this table and rule 02 disagree, fix whichever no longer
matches the code.
