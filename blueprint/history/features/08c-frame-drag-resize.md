# Feature: Frame drag/resize

**From build-plan:** feature 8c
**Build attempt:** 1
**Branch:** feature/frame-drag-resize
**Status:** verified (pnpm verify + user-reported F5, 2026-10-22).

## Goal

Let the user drag a frame by its label and resize its width by a right-edge handle, rounded to
whole stage px (no grid; decided in F5 on 2026-10-22, the 8px grid felt inconsistent), with width
clamped to 120-3840. The result is written to `canvas.json` once, on release,
through the same `placeFrame` write path the Agent's `place_frame` uses, under a new cross-process
workspace lock with a `base` conflict check. An Agent `place_frame` during or after a drag wins and
the chrome re-renders from disk. Built in-house with no drag library (D1). Per-frame `generation`
goes on the wire for later features.

Notion done-when lines this closes:

- Frame drag/resize works with no Moveable dependency.
- Drag a frame by its label and resize its width; positions persist in canvas.json after reload.
- Agent place_frame during or after a drag is reflected correctly.

## In scope

- `src/disk/workspaceLock.ts`: `withWorkspaceLock` (lock file `.cursor-design/.lock`, `wx`
  create, jittered retry up to 2s, stale break after 30s under a `.lock.break` sub-lock, owner-checked release).
- Two new `CursorDesignError` subclasses in `src/disk/errors.ts`: `LockTimeoutError`
  (`WORKSPACE_BUSY`) and `FrameMovedError` (`FRAME_MOVED`).
- `placeFrame` runs its `canvas.json` read-modify-write under the lock and accepts an optional
  `base: {x, y, width}`. On mismatch it writes nothing and throws `FrameMovedError`. The MCP
  `place_frame` input schema does not change and never passes `base`.
- The host watcher ignores `.lock`, `.lock.break` and `*.tmp` paths.
- Chrome → host message `frame:place {id, x, y, width, base: {x, y, width}}`. Its type lives in
  `src/webview/hostMessages.ts`; it is parsed with `zod/mini` in a new `src/host/chromeMessages.ts`.
- A host handler that refuses in untrusted workspaces, calls `placeFrame`, logs failures once,
  never throws, and always answers with one fresh snapshot. On failure that snapshot carries an
  `errorMessage`, which the panel posts as `artboard:error`.
- `PostedCanvasFrame` gains a required `generation` (that frame's artboard generation).
- Chrome: the label becomes a focusable button that drags the frame; a focusable right-edge
  separator resizes the width. Local preview override while the gesture runs; one `frame:place`
  on release, sent only when the position or width changed. Escape cancels. Agent wins mid-drag.
- Keyboard: arrow keys on the label nudge 8px (Shift: 64px); Left/Right on the handle resize by 8px
  (Shift: 64px). The change is committed once no arrow key is held, or on blur.
- Pure gesture helpers in `src/webview/stageGeometry.ts` with unit and property tests.
- Rule 02 (message contract), rule 04 (message type homes) and rule 05 (owner catalog) updated
  in the same change.

## Out of scope

- Comment mode, picking, chrome → frame messages (8d1+). Making drag inert in comment mode is
  8f1's job, since comment mode does not exist yet.
- Per-frame `hash` on the wire. The plan doc lists it, but the build-plan line names generation
  only and nothing in 8c or 8e reads a wire hash. Add it in the feature that needs it.
- Locking any writer other than the `canvas.json` read-modify-write (manifest, meta and HTML
  writes stay as they are; 8e adds `comments.json`).
- Height editing (height stays content-driven; nothing writes height).
- Changing label or group from the chrome. `frame:place` is the existing partial update, and
  `label` / `group` stay unchanged.
- Multi-select, drag to reorder groups, alignment guides, snapping to other frames, undo.
- A coordinate bound on the MCP `place_frame` tool (the ±100000 bound applies to chrome messages only).
- Any change to artboard HTML, export HTML, or the frame runtime.

## Build loop

`workflow.stepReview` is `feature`: build the steps in order, run each step's check, and do not
stop for review between steps. Review the whole feature once at the end. `checkpointCommits` is
`disabled`: no per-step commits. `/complete` creates the one feature commit. Run `pnpm verify`
after each step that touches code and before handing off.

## Build steps

- [x] **1. Workspace lock + locked `placeFrame` with `base`.**
  - Add two `CursorDesignError` subclasses to `src/disk/errors.ts`, so the existing
    `toMcpToolError` and `toSafeArtboardErrorMessage` pass their messages through:
    - `LockTimeoutError`: code `WORKSPACE_BUSY`, message
      `Another Cursor Design write is in progress. Retry in a moment.`
    - `FrameMovedError`: code `FRAME_MOVED`, readonly `frameId`, message
      `This frame moved while you were dragging it. Showing its current position.`
  - Add `LOCK_FILE = '.lock'` to `src/disk/layout.ts`.
  - `src/disk/workspaceLock.ts` exports
    `withWorkspaceLock<T>({ workspaceRoot, operation, timeoutMs = 2000, staleMs = 30000 }): Promise<T>`
    and `isLockOrTempPath(fsPath: string): boolean`:
    - `mkdir -p` `.cursor-design/`, then `open(lockPath, 'wx')`, write `"<pid> <randomUUID>"`, and
      close the handle. If the write or close fails, `unlink` the lock (best effort) and throw
      `DiskError`, so a half-made lock never waits out the 30s stale age.
    - On `EEXIST`: `lstat` the lock. If its `mtimeMs` is older than `staleMs`, take the
      `.lock.break` sub-lock (`wx`), re-check the lock's age under it, `unlink` it if still stale,
      release the sub-lock, and retry at once. A waiter that cannot take the sub-lock keeps
      waiting; a sub-lock older than `staleMs` (crashed breaker) is removed. Audit F-18 (2026-10-22)
      replaced the original rename-to-`.lock.stale.*` break, which let two callers hold at once
      under contention. Otherwise sleep a random 10-50ms and retry until
      `timeoutMs` has passed since the first attempt, then throw `LockTimeoutError`.
    - Run `operation` in `try`, and in `finally` release: read the lock file and `unlink` it only if
      its content still equals this holder's token. A missing file is fine. A release error is
      written to stderr once (`process.stderr.write`; lint bans `console`), then swallowed with a `ponytail:` comment (rule 06: no empty
      `catch`), so the operation's own result or error wins. The disk lib has no output channel.
    - Other fs errors map to `DiskError` through `throwDiskError` / `isErrno`, shared from
      `src/disk/errors.ts` with `artboardFs.ts` (audit F-20).
    - `ponytail:` comments on the mtime stale break (no PID liveness, no heartbeat; holds are one
      small JSON read-modify-write, far below 30s) and on the check-then-unlink release.
  - `placeFrame` in `src/disk/artboardFs.ts`: keep validation, `assertLayoutDirsOwned`, the HTML
    checks and `listArtboards` **before** the lock. Inside `withWorkspaceLock`: read
    `canvas.json`, resolve the current frame with
    `resolveCanvasFrames({ stored: stored.frames, artboards: listed.artboards })`, compare
    `x`, `y`, `width` with `base` when given (exact number equality; mismatch → throw
    `FrameMovedError`, nothing written), then `placeCanvasFrame` + `writeUtf8`. Add
    `base?: { x: number; y: number; width: number }` to `PlaceFrameArgs` (typed, host-only; the MCP
    handler never passes it).
  - Confirm with grep that `placeFrame` is the only writer of `canvas.json`; if another exists, wrap it too.
  - `src/host/watchArtboardDisk.ts`: `onArtboardDiskEvent` and the delete handler return early for
    `isLockOrTempPath(uri.fsPath)`.
  - MCP `place_frame` keeps `enqueueDiskOp` on top. `toMcpToolError` already maps any
    `CursorDesignError` to `isError` with its message (`artboardTools.ts:180`).
  - Tests: `src/disk/workspaceLock.test.ts` and the existing `placeFrame` disk tests (grep
    `placeFrame(` under `src/disk/*.test.ts`), listed under Testing.
  - **Done when:** the lock and `placeFrame` tests pass, the existing MCP contract tests for
    `place_frame` pass unchanged, and `pnpm verify` is green.

- [x] **2. Wire contract: `frame:place`, host handler, per-frame generation.**
  - `src/disk/layout.ts`: `MAX_FRAME_COORDINATE = 100_000`.
  - `src/webview/hostMessages.ts` is the one home for message types (rule 04). Add
    `FramePlaceMessage = { type: 'frame:place'; id: string; x: number; y: number; width: number; base: { x: number; y: number; width: number } }`
    and `ChromeMessage = { type: 'artboard:ready' } | FramePlaceMessage`. Update rule 04's
    "Webview message types" line to say chrome → host types live there too.
  - `src/host/chromeMessages.ts` (new, no `vscode` import so it is unit-testable; `import type`s
    from `hostMessages.ts`):
    - `parseChromeMessage(value: unknown): ChromeMessage | undefined` uses a `zod/mini` schema:
      - `id`: a string. Artboard id rules are enforced by `placeFrame`'s `parseArtboardId`.
      - `x`, `y`: finite and within ±`MAX_FRAME_COORDINATE`.
      - `width`: finite with `0 < width <= MAX_FRAME_COORDINATE`. The disk lib clamps to 120-3840.
      - `base`: the same rules as the top-level fields.
      - Unknown `type`, non-object, or any failing field returns `undefined`. Never throws.
    - `isFramePlaceAttempt(value: unknown): boolean`: true when `value` is an object with
      `type === 'frame:place'`.
  - `PostedCanvasFrame.generation: number` (required). `parsePostedFrame` rejects a frame whose
    `generation` is not finite. `postedFrameFromSnapshot` (`src/host/canvasSnapshot.ts`) copies
    `frame.generation`. This is always a number already: `readCanvasView` sets
    `generation: scannedFrame?.generation ?? 0`, so a missing meta gives 0 and no frame is dropped.
    The chrome parses it and does not use it yet.
  - `src/panel/openArtboardPanel.ts`:
    - `onDidReceiveMessage` uses `parseChromeMessage` for `artboard:ready`.
    - Add `setArtboardPanelOnFramePlace(handler: (value: unknown) => void)` next to
      `setArtboardPanelOnVisible`.
    - Any message where `isFramePlaceAttempt` is true, valid or not, is passed **raw** to that
      handler. The panel itself never answers, so there is one answer path.
    - Other messages are ignored as today.
  - `src/host/artboardDisk.ts`: `placeFrameFromChrome({ value, outputChannel }): Promise<CanvasSnapshot>`.
    It never rejects: the whole body is in one `try`/`catch`, and the outer failure path also
    returns a snapshot.
    - Untrusted workspace: return `emptyArtboardSnapshot(UNTRUSTED_WORKSPACE_MESSAGE)`, no write.
    - No workspace folder: return `emptyArtboardSnapshot(new NoWorkspaceError().message)`.
    - `parseChromeMessage(value)` is not a `frame:place`: `logDiskError` once with an
      `InvalidArgsError('Malformed frame:place message from the panel.')`, and set
      `placeErrorMessage = 'Could not move the frame. Try again.'`.
    - Otherwise `await placeFrame({ workspaceRoot, id, x, y, width, base })`. On failure:
      `logDiskError` once (scope `artboardDisk.placeFrame`) and set
      `placeErrorMessage = toSafeArtboardErrorMessage(error)`. That helper returns a
      `CursorDesignError`'s own message and a generic safe copy for anything else.
    - Always re-read with `readActiveArtboardFromDisk`, which already catches its own errors. On
      failure, return it with `errorMessage: snapshot.errorMessage ?? placeErrorMessage` (a layout
      error already on the snapshot is the more severe one).
  - `src/extension.ts`: wire it as
    `setArtboardPanelOnFramePlace((value) => { void placeFrameFromChrome({ value, outputChannel }).then(postArtboardSnapshotToPanel).catch((error: unknown) => { logDiskError({ scope: 'extension.framePlace', error, outputChannel }); }); })`
    (rule 06: fire-and-forget gets a `.catch`). `postArtboardSnapshotToPanel` runs the snapshot
    through `snapshotForChrome` as the watcher does. `flushPendingArtboardView` posts
    `canvas:updated` and then, when the snapshot has an `errorMessage`, `artboard:error`. So every
    failed `frame:place` reaches the chrome as an `artboard:error` after a fresh `canvas:updated`.
  - `src/webview/hostBridge.svelte.ts`: `postFramePlace(message: FramePlaceMessage): void`.
  - Rule 02 messages line: chrome → host `artboard:ready`, `frame:place {id, x, y, width, base}`;
    `canvas:updated` frames carry `generation`. Rule 05 catalog: `withWorkspaceLock` /
    `isLockOrTempPath` (`src/disk/workspaceLock.ts`), `parseChromeMessage` / `isFramePlaceAttempt`
    (`src/host/chromeMessages.ts`), `placeFrameFromChrome` (`src/host/artboardDisk.ts`), new errors.
  - **Done when:** `chromeMessages.test.ts` and the updated `hostMessages.test.ts` pass, F5 still
    renders every frame exactly as before (no UI change in this step), and `pnpm verify` is green.

- [x] **3. Pure gesture helpers.**
  - In `src/webview/stageGeometry.ts` (imports `MIN_FRAME_WIDTH`, `MAX_FRAME_WIDTH`,
    `MAX_FRAME_COORDINATE` from `src/disk/layout.ts`, which has no imports):
    - `GESTURE_THRESHOLD_PX = 3`, `NUDGE_STEP = 8`, `NUDGE_STEP_LARGE = 64`.
    - `roundToPixel(value)`: `Math.round(value)`, normalizing `-0` to `0`.
    - `dragFrame({ start: {x, y}, stageDelta: {x, y} })` → `{x, y}`: round the absolute
      `start + stageDelta` to whole px, then clamp each to ±`MAX_FRAME_COORDINATE`.
    - `resizeFrameWidth({ startWidth, stageDeltaX })` → `roundToPixel(startWidth + stageDeltaX)`,
      clamped to `MIN_FRAME_WIDTH`..`MAX_FRAME_WIDTH`.
    - `passedGestureThreshold({ startScreen, screen })`: true once `|dx| >= 3` or `|dy| >= 3`
      (either axis on its own, not the diagonal distance). So a plain click on a label never moves
      a frame.
    - `placementChanged(base, next)`: any of x, y, width differs.
  - The chrome turns pointer positions into stage space with the existing `screenToStage` at
    the current view (D1). So a wheel pan or zoom during a drag stays correct on the next pointer move.
  - The export `canvas.html` embeds `stageGeometry.ts?iife`. If the
    `handoffCanvasHtml.test.ts` snapshot changes only by the new helpers inside the embedded
    IIFE, update it on purpose (rule 09) and say so in the step notes.
  - **Done when:** the geometry unit and property tests listed under Testing pass and `pnpm verify` is green.

- [x] **4. Pointer drag and resize in the chrome.**
  - `Stage.svelte` (view, props in / callbacks out):
    - **Label:** renders as `<button type="button">` with `data-cd-frame-label`:
      - `pointer-events: auto`, `cursor: move`, `aria-label="Move frame {label}"`.
      - A `--vscode-focusBorder` focus ring, and the existing ellipsis styling.
    - **Resize handle:** one per frame, `<div role="separator" aria-orientation="vertical" tabindex="0">`:
      - Attributes: `aria-label="Resize width of {label}"`, `aria-valuenow={width}`,
        `aria-valuemin={MIN_FRAME_WIDTH}`, `aria-valuemax={MAX_FRAME_WIDTH}`,
        `data-cd-frame-resize={id}`, `cursor: ew-resize`, `pointer-events: auto`.
      - It sits on the frame's right edge, centered on it, as tall as the frame. Its width is a
        fixed 8 screen px (stage width `8 / zoom`, so Stage gets a `zoom` prop).
      - Handles render in the layer **after** the frames, in their own `{#each}`, so they paint
        above the iframes (no frame sets a `z-index`). Labels stay outside the frame boxes, as today.
    - **Pointer events:** pointerdown (button 0) on a label or handle calls `setPointerCapture`
      on that element and sets a local `capturedId`. Stage then reports
      `onFrameGesture({ id, kind: 'move' | 'resize', phase, screenX, screenY })` with
      viewport-relative screen coordinates, like the wheel path:
      - `'start'` on pointerdown.
      - `'move'` on pointermove.
      - `'end'` on pointerup. This also clears `capturedId`.
      - `'end'` also on pointercancel, or on `lostpointercapture` while `capturedId` is still set
        (a release outside the panel never delivers pointerup). F5 2026-10-22: these used to
        cancel, which snapped the frame back; only Escape reverts, like Figma.
      - `'cancel'` on Escape. A `lostpointercapture` that follows a `pointerup` finds `capturedId` cleared and
        reports nothing. Escape comes from a `window` keydown listener that exists only while
        `capturedId` is set; it also calls `releasePointerCapture`.
    - **No pan:** pointerdown on a label or handle never starts the empty-stage pan. `startDrag`
      returns early when the target is inside `[data-cd-frame-label]` or `[data-cd-frame-resize]`,
      checked with `closest`, in addition to the existing `onEmptyStage` test.
    - While `capturedId` is set, the viewport gets a `frame-gesture-move` or
      `frame-gesture-resize` class. Either one sets iframes to `pointer-events: none`; the cursor is
      `move` or `ew-resize` respectively. This backs up pointer capture over sandboxed iframes.
      Capture and class last until pointerup or cancel even if App dropped the gesture. App
      ignores those events (see below), and the iframes stay inert only while the button is held.
  - `App.svelte` (container) owns
    `gesture: { id, kind, source: 'pointer' | 'keyboard', base: {x, y, width}, startStage, startScreen, override?: {x, y, width}, phase: 'active' | 'committing' } | undefined`:
    - `start`: ignored when any gesture exists (one at a time, either source, including while
      committing). Otherwise it creates the gesture with `phase: 'active'`. `base` is the frame's
      current disk `x`, `y` and `width`.
    - `move`: handled only while `phase === 'active'` and the gesture's `id` matches. Until
      `passedGestureThreshold`, nothing happens. After that, the stage delta is
      `screenToStage(now) - startStage` at the current view. The override is `dragFrame` (x/y;
      width unchanged) or `resizeFrameWidth` (width; x/y unchanged).
    - `end`: handled only while `phase === 'active'` and the gesture's `id` matches:
      - If an override exists and `placementChanged(base, override)`: call
        `postFramePlace({ type: 'frame:place', id, x: override.x, y: override.y, width: override.width, base })`
        and set `phase: 'committing'`. The override stays, so the frame does not jump back.
      - Otherwise clear the gesture.
      - A second `end` (keyup then blur) is a no-op because the phase is no longer `active`.
    - `cancel`: handled only while `phase === 'active'`; it clears the gesture, and the frame
      renders its disk position. During `committing`, `cancel` is ignored.
    - Display: a `$derived` list applies the override to the gestured frame. `Stage` frames,
      labels, headings and handles all use it, so the label and handle follow the preview. Frames
      keep their keyed order. Changing `left`, `top` or `width` never reloads an iframe (the blob
      effect reads only `html` and `nonce`).
    - On `canvas:updated`, for the gestured id:
      - If the frame is missing, clear the gesture.
      - While `active`: if disk `x`/`y`/`width` differ from `base`, the Agent wins and the gesture
        is cleared. Later Stage events for that pointer are ignored because no gesture exists.
      - While `committing`: clear the gesture unless disk still equals `base` (the host's answer
        has not arrived yet).
    - On `artboard:error` while a gesture exists, in either phase: clear it. The host posts
      `artboard:error` after the answering `canvas:updated` on every failed `frame:place`. That is
      how a failure that leaves disk equal to `base` (lock timeout, disk error) drops the preview.
  - Audit F-19 (2026-10-22): the gesture rules (start, move, nudge, end, cancel, settle) live in
    pure `src/webview/frameGesture.ts` (`stepFrameGesture`, `settleFrameGesture`, the
    `StageFrameGesture` / `FrameGesture` types) with `frameGesture.test.ts`. App owns the `$state`
    and posts the returned commit.
  - F5 fixes (2026-10-22): `postFramePlace` sends `$state.snapshot(message)` (a `$state` proxy
    throws `DataCloneError` in `postMessage`, so release never committed). The viewport uses
    `overflow: clip` (focusing a label scrolled an `overflow: hidden` viewport under the stage
    math and broke zoom), and keyboard focus (`:focus-visible`) on a label or handle pans it into
    view via `onDragPan`. Pointer focus never pans (it jumped the camera when a drag started).
  - Follow rule 08: Svelte MCP docs before writing, `svelte-autofixer` on every edited `.svelte`
    file until clean (prefer the `svelte-file-editor` agent).
  - **Done when:** in F5 (`fixtures/dev-workspace`), all of these hold and `pnpm verify` is green:
    - Dragging a label moves the frame 1:1 with the cursor (whole px).
    - Resizing the handle changes width with the cursor, stopping at 120 and 3840.
    - Release writes `canvas.json` once, and the position survives closing and reopening the panel.
    - Escape mid-drag snaps back with no write.
    - A drag across another frame's iframe keeps tracking.
    - A plain click on a label writes nothing.

- [x] **5. Keyboard move and resize.**
  - Keyboard gestures use `source: 'keyboard'` and skip `passedGestureThreshold`.
  - Label `keydown` ArrowLeft/Right/Up/Down (handled on the element):
    - Start a `kind: 'move'` gesture if none exists, with `base` = the disk position.
    - Then set `override = dragFrame({ start: override ?? base, stageDelta: step })`, where
      `step` is ±`NUDGE_STEP` on that axis (Shift: ±`NUDGE_STEP_LARGE`). Width is unchanged.
    - Call `preventDefault`.
  - Handle `keydown` ArrowLeft/Right: same, with
    `width = resizeFrameWidth({ startWidth: override?.width ?? base.width, stageDeltaX: ±step })`.
    ArrowUp/Down on the handle are ignored.
  - A nudge moves exactly one step from the current position (a fractional Agent-written
    position is rounded to whole px by `dragFrame`).
  - Escape keydown on the focused element cancels the gesture.
  - The element tracks the set of arrow keys held. It commits through the `end` path once a
    `keyup` empties that set, or on `blur`. The `end` guard makes keyup followed by blur send one
    `frame:place` at most.
  - Key auto-repeat keeps moving the override. No keyboard gesture starts while a pointer gesture
    exists, and the reverse.
  - **Done when:** in F5, all of these hold and `pnpm verify` is green:
    - Tab reaches each label and handle, with a visible focus ring.
    - Arrow keys move or resize in 8px steps (64 with Shift).
    - Holding two arrows and releasing one keeps nudging.
    - Release writes once. Escape restores the disk position.

- [x] **6. Agent-wins and failure checks, final verify.**
  - Run every F5 check under Testing, including Agent-wins mid-drag and a failed write.
  - Re-read rules 02, 04 and 05 against the shipped code.
  - **Done when:** every F5 line passes, every new colocated test listed under Testing exists, and
    `pnpm verify` is green.

- [x] **7. F-17: held-key auto-repeat must not restart a keyboard gesture after Agent-wins.**
  - The keyboard `nudge` event carries `repeat` (`KeyboardEvent.repeat`). App starts a keyboard
    gesture only on a non-repeat keydown; an existing active keyboard gesture still follows
    auto-repeat. After `canvas:updated` (Agent-wins) or `artboard:error` clears the gesture,
    repeats of the still-held key are ignored; a fresh press starts a new gesture.
  - **Done when:** svelte-check and `pnpm verify` are green, and the F5 Agent-wins check includes
    holding an arrow key on a label while the Agent write lands: the frame stays at the Agent's
    position after keyup.

## Files / areas

- New: `src/disk/workspaceLock.ts` + `workspaceLock.test.ts`; `src/host/chromeMessages.ts` + `chromeMessages.test.ts`.
- Edit:
  - Disk: `src/disk/errors.ts`, `src/disk/layout.ts`, `src/disk/artboardFs.ts` (`placeFrame`),
    and the `placeFrame` disk test file.
  - Host: `src/host/watchArtboardDisk.ts`, `src/host/artboardDisk.ts`,
    `src/host/canvasSnapshot.ts`, `src/panel/openArtboardPanel.ts`, `src/extension.ts`.
  - Chrome: `src/webview/hostMessages.ts` + test, `src/webview/hostBridge.svelte.ts`,
    `src/webview/stageGeometry.ts` + test, `src/webview/Stage.svelte`, `src/webview/App.svelte`.
  - Maybe the `handoffCanvasHtml` snapshot (step 3).
  - Rules: `.claude/rules/02-mcp-webview.md`, `04-code-conventions.md`, `05-single-job.md`.
- Not touched: `src/mcp/artboardTools.ts` input schemas, `src/webview/frame/**`, `Frame.svelte`'s
  blob effect, export code paths.
- No new dependency (`zod` is already a dependency and already bundled into `dist/extension.js`).

## Data / contracts

- **`canvas.json`:** unchanged schema (version 1). Writes come only from `placeFrame`, now under
  the lock. A chrome placement is the existing partial update: `label` and `group` stay unchanged.
  Chrome-written x/y are whole px within ±100000 (a nudge adds ±8 or ±64). Widths are whole px
  within 120-3840.
  The Agent may still write any finite values; the disk lib clamps width.
- **Lock file** `.cursor-design/.lock`: content `"<pid> <uuid>"`, created with `wx`. Stale after
  30s by `mtime`. Broken only by the holder of the `.lock.break` sub-lock, which re-checks the
  age, then unlinks. Transient,
  never read by anything but the lock. Ignored by the host watcher.
- **chrome → host `frame:place`:** `{ type: 'frame:place', id: string, x: number, y: number, width: number, base: { x: number, y: number, width: number } }`.
  `base` is the frame's x/y/width from the last `canvas:updated` at gesture start (resolved values,
  so auto-placed frames work). Sent once per gesture, only when changed. Untrusted input: parsed by
  `parseChromeMessage`, refused in untrusted workspaces.
- **host → chrome `canvas:updated`:** each frame gains `generation: number` (the artboard's meta
  generation, 0 when meta is absent, as `readCanvasView` already resolves it). Top-level
  `generation` (active artboard) stays.
- **Answers to `frame:place`:** every attempt, valid or malformed, gets exactly one
  `canvas:updated` (fresh disk). On failure an `artboard:error` follows with:

  | Failure | Error / code | Banner copy |
  |---|---|---|
  | disk moved since gesture start | `FrameMovedError` / `FRAME_MOVED` | This frame moved while you were dragging it. Showing its current position. |
  | lock held past 2s | `LockTimeoutError` / `WORKSPACE_BUSY` | Another Cursor Design write is in progress. Retry in a moment. |
  | corrupt / newer `canvas.json` | existing canvas errors | existing copy (file never overwritten) |
  | artboard deleted | `ArtboardNotFoundError` | existing copy |
  | malformed `frame:place` | `InvalidArgsError` (logged only) | Could not move the frame. Try again. |
  | untrusted workspace | refused | existing untrusted copy |
  | other fs failure | `DiskError` | existing safe copy |

  No stack or absolute path in any copy. Each failure is logged once with `logDiskError`.
- **MCP:** `place_frame` input and output are unchanged. A lock timeout surfaces as `isError`
  with `WORKSPACE_BUSY`'s message.

## Testing

Unit (`vp test`, colocated):

- `workspaceLock.test.ts` (fresh `mkdtemp` workspace each test):
  - `.cursor-design/` missing is created and the operation runs; the lock file is gone afterwards.
  - The operation throws: the lock is released and the error is rethrown unchanged.
  - A lock with `mtime` backdated past `staleMs` (via `utimes`) is broken and the operation runs.
  - A fresh foreign lock held longer than `timeoutMs` (small value in the test) gives
    `LockTimeoutError`, and the foreign lock file is untouched (younger than stale, so never broken).
  - 20 concurrent callers each read, increment and write a counter JSON under the lock: the final
    count is 20 and an in-test holder counter never exceeds 1. The lock keeps no in-memory state,
    so this runs the same file protocol a second process would. `ponytail:` no spawned-process
    test; upgrade path is a child-process harness if a cross-process bug shows up.
  - Two callers racing on the same stale lock: both finish and the holder counter never exceeds 1.
  - Release is owner-checked: if the operation replaces the lock file with a foreign token, the
    foreign file survives release.
  - `isLockOrTempPath`: `.lock`, `.lock.break`, `canvas.json.123.tmp` → true; `canvas.json`,
    `artboards/a.html` → false.
  - Both new errors are `instanceof CursorDesignError` with codes `WORKSPACE_BUSY` / `FRAME_MOVED`.
- `placeFrame` disk tests:
  - `base` equal to disk → writes; `base` with a different x, y or width → `FrameMovedError`, and
    `canvas.json` bytes are unchanged (or the file stays absent for an auto-placed frame).
  - An auto-placed frame (no stored entry) with a matching `base` gets appended.
  - Width 119 → 120, 3841 → 3840 through the disk path; negative x/y stored as given.
  - `label` and `group` survive a `base` placement unchanged.
  - Lock timeout is covered in `workspaceLock.test.ts` only. Do not add a `placeFrame` timeout
    argument just for tests.
- `chromeMessages.test.ts`:
  - Accepts a valid `artboard:ready` and a valid `frame:place`.
  - Rejects NaN and Infinity (not finite).
  - Rejects `1e308` and x = 100001 (finite but outside ±`MAX_FRAME_COORDINATE`).
  - Rejects width 0, a missing `base`, a `base` with a string field, a non-object, an array, an
    unknown `type` and a numeric `id`.
  - `isFramePlaceAttempt` is true for a malformed `frame:place` and false for `artboard:ready`.
- `hostMessages.test.ts`: a frame without a finite `generation` is dropped; a valid one keeps it.
- `stageGeometry.test.ts`:
  - `resizeFrameWidth` with targets 119/120/3840/3841 lands on 120/120/3840/3840.
  - `dragFrame` follows the delta and rounds the absolute position: start 13 + 0 → 13, 13 + 5 → 18,
    17366 + 8 → 17374, 13.4 + 0 → 13.
  - `-0` is normalized; ±`MAX_FRAME_COORDINATE` clamp.
  - `passedGestureThreshold`: (2, 0) → false, (3, 0) → true, (0, 3) → true, (2, 2) → false.
  - `placementChanged` true/false cases.
  - fast-check properties:
    - Inputs: integer or double start in ±`MAX_FRAME_COORDINATE`, delta in ±`MAX_FRAME_COORDINATE`,
      start width in 120-3840, and a view with zoom in [0.05, 10] going through `screenToStage`.
    - `dragFrame` output is an integer within ±`MAX_FRAME_COORDINATE`.
    - `resizeFrameWidth` output is an integer within 120-3840.
- `placeFrameFromChrome` imports `vscode`, so it is proven in F5 (rule 09). Its pure parts
  (`parseChromeMessage`, `placeFrame` with `base`) are covered above.

F5 (`fixtures/dev-workspace`, Extension Development Host; not unit-testable per rule 09):

1. Drag a label: the frame follows the cursor 1:1, the label and handle follow, the iframe does
   not reload (its state, e.g. a scrolled box, survives). Release, then check `canvas.json` shows
   whole px. Close and reopen the panel: the position is unchanged.
2. Resize via the handle: width follows the cursor, content reflows, height re-measures, and it stops at
   120 and 3840.
3. A drag that crosses another frame's iframe keeps tracking. Releasing over an iframe still commits.
4. Escape mid-drag snaps back. `canvas.json` mtime is unchanged.
5. A plain click on a label does not move the frame or write canvas.json.
6. Agent wins mid-drag. Pick a frame id `<id>` that has a stored `canvas.json` entry (drag it once
   first if needed). Run this in the dev workspace terminal and start dragging that frame within 5s:
   `sleep 5 && node -e "const f='.cursor-design/canvas.json',fs=require('fs'),c=JSON.parse(fs.readFileSync(f));c.frames.find((e)=>e.id==='<id>').x+=400;fs.writeFileSync(f,JSON.stringify(c,null,2))"`
   The drag cancels and the frame jumps to the new disk position. Also call `place_frame` from the
   Agent after a drag: the panel shows the Agent's position.
7. Failed write reverts: make `canvas.json` invalid JSON, drag a frame. The banner shows the
   corrupt-canvas copy, the frame returns to its auto-placed position, and the file is not overwritten.
8. Lock busy: create `.cursor-design/.lock` by hand (fresh mtime), then drag a frame. After about
   2s the `WORKSPACE_BUSY` banner shows and the frame returns to its disk position. Delete the
   lock, drag again: it commits.
9. Keyboard: Tab to a label (an off-screen one pans into view), arrows move by 8 (Shift 64),
   release commits. Tab to the handle, Left/Right resizes. Escape restores.
10. Zoom 25% (reachable by ctrl+wheel; `MIN_STAGE_ZOOM` is 0.05) and 200%: the drag tracks the
    cursor 1:1 on screen and stored values are whole px.
11. Export after a drag: `canvas.html` shows the new layout, and each frame's exported
    `index.html` is byte-identical to its artboard file.
12. While dragging, the lock and `.tmp` files cause no extra re-render flicker from the watcher.

## Notes for the AI

- Read `blueprint/reference/0.3-comments-plan.md` §8c and D1 before coding. This spec deliberately
  differs from it in four places:
  - `FrameMovedError` replaces reuse of `ConflictError`, because that error's compared fields and
    message are about `update_artboard` generations.
  - No wire `hash`.
  - Gesture math runs in stage space via `screenToStage` rather than `pointerDelta / zoom`. It is
    the same at a fixed view and correct if the view changes mid-drag.
  - A 3px click threshold.
- The host answers every `frame:place` with one fresh snapshot, plus `artboard:error` on failure.
  The chrome's `committing` rule (keep the preview while disk still equals `base`) is what
  prevents a snap-back flicker on success; `artboard:error` is what ends it on failure. Do not
  replace either with a timer.
- Gesture events are handled only in the phase named in step 4. Every event outside it is a no-op.
  That is what stops `lostpointercapture`, keyup + blur, and late moves from fighting the commit.
- Keep the lock hold tiny. Only the `canvas.json` read, base check, place and write run inside
  `withWorkspaceLock`; `listArtboards` and the HTML checks stay outside.
- Do not lock other writers or add a lock to MCP tools other than `place_frame` (through
  `placeFrame`). 8e reuses `withWorkspaceLock` for `comments.json`.
- `src/disk/**` stays `vscode`-free (lint). `src/host/chromeMessages.ts` must not import `vscode`
  either, so it can be unit tested.
- Svelte edits follow rule 08 (MCP docs, autofixer). Theme tokens only. Native button for the label.
- Untrusted workspaces already post zero frames, so no drag UI exists there. The host refusal is defense in depth.
- 8f1 must make the label and handle inert in Comment mode. Do not pre-build a mode flag.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":34637,"specSha256":"c841a91b07bc7b91e61644a60c3a5d3ab5550cbe2971dbc632969f6373bcb964","branch":"refs/heads/feature/frame-drag-resize","head":"73a39cab8b15f2625ad63af4ee430b4186dbc5b4","baseRef":"refs/heads/main","baseCommit":"73a39cab8b15f2625ad63af4ee430b4186dbc5b4","sourceTree":"eb0b82ca21b30b6801f6363350dd067a1f3ed8e8","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8c/F-17 [P1] closed - Keyboard auto-repeat restarts a gesture after Agent-wins and overwrites the Agent

**File:** src/webview/App.svelte:350
**Found:** 2026-10-22 by /audit (scope: current; lens: quality)
**Why it matters:** Agent-wins is a 8c done-when. `settleGestureOnCanvasUpdated` and `artboard:error` correctly clear the in-flight gesture, but the next keyboard `nudge` does `gesture ?? startGesture(event)`. A held arrow keeps firing `keydown` (including `repeat`), so after the Agent's `place_frame` lands the chrome starts a new gesture from the Agent position and commits it on keyup. Pointer moves do not restart (no gesture, ignored). Keyboard does.
**Suggested fix:** When `canvas:updated` or `artboard:error` clears a keyboard gesture, ignore keyboard starts until the next keyboard `end` or `cancel` (keyup emptying `heldArrows`, or blur). Same latch covers a failed `frame:place` while a key is still down. Pointer already ignores later events. Add the held-arrow + Agent-write case to the F5 Agent-wins check.
**Resolution:** 2026-10-22 /implement (spec step 7): the keyboard `nudge` event now carries `KeyboardEvent.repeat`, and `App.svelte` starts a keyboard gesture only on a non-repeat keydown (`gesture ?? (event.repeat ? undefined : startGesture(event))`). An auto-repeat that arrives after `canvas:updated` or `artboard:error` cleared the gesture is ignored, and so is its keyup `end`, because no gesture exists. A fresh press starts a new gesture. This replaces the suggested latch, which would also have swallowed the first press after a successful keyboard commit. F5 proof still pending: hold an arrow while the Agent write lands.
2026-10-22 /audit (scope: current; 8c, step 7) re-read `src/webview/App.svelte:353` and `src/webview/Stage.svelte:263`. `handleFrameKeydown` passes `repeat: event.repeat` on every nudge, and App starts a keyboard gesture only on `gesture ?? (event.repeat ? undefined : startGesture(event))`. Traced the held-arrow case: Agent write lands, `settleGestureOnCanvasUpdated` (`App.svelte:281`) or the `artboard:error` branch (`App.svelte:215`) clears the gesture, further repeats find no gesture and `repeat === true`, so nothing restarts. The keyup `end` finds no gesture and is a no-op (`App.svelte:370`). A fresh press (`repeat === false`) starts a new gesture from the current disk position, and an active keyboard gesture still follows auto-repeat. The repair introduced no new defect in this path. User-reported F5 (2026-10-22, not re-run by this audit): the held-arrow Agent-wins case passes. Closed; the line moved from 350 to 353.

### 8c/F-18 [P2] closed - Stale-lock link-back branch goes beyond the spec, has no test, and can orphan a lock

**File:** src/disk/workspaceLock.ts:83
**Found:** 2026-10-22 by /audit (scope: current; lens: quality)
**Why it matters:** The spec's stale break is rename, unlink, retry. `breakIfStale` adds an `lstat` inode compare and a `link()` back for the case where a waiter renames a live lock another waiter just took. No test reaches that branch (the "two callers racing on a stale lock" test cannot hit it deterministically). Two reachable defects: (1) if the live holder finishes inside the rename-to-link window, `releaseLock` sees `ENOENT` and returns, then `link()` restores a lock nobody owns, so every writer gets `WORKSPACE_BUSY` until it ages out (30s). (2) ext4 and other Linux filesystems reuse freed inode numbers (the workspace-kind host runs on remote/WSL Linux), so `moved.ino !== staleIno` can be false for a live lock and the branch silently does nothing. Needs a crashed holder plus two or more simultaneous waiters, so rare, but the existing `ponytail:` comment on line 89 documents only the EEXIST overlap.
**Suggested fix:** Either delete the `lstat`/`link` branch and keep the spec's rename + unlink (the stale-break ponytail comment already accepts a brief double hold for this race), or keep it and add a test that forces the interleaving, and extend the `ponytail:` comment with the orphan case and the inode-reuse ceiling. Current requirement lost by deleting: none in the spec.
**Resolution:** 2026-10-22 /implement: the stress test the audit asked for (6 callers racing one stale lock, 15 rounds) failed on every run against the rename + inode + link-back break, with a lost counter update (two holders). The finding understated it: the double hold was not rare. `breakIfStale` (`src/disk/workspaceLock.ts`) now removes a stale lock only while holding the `.lock.break` sub-lock (`wx`), re-checks the age under it, then unlinks. Nothing else removes a lock it does not own, so a fresh lock is never broken. There is no inode compare and no link. A sub-lock left by a crashed breaker is removed once it is `staleMs` old, which is the one remaining `ponytail:` edge. The test now runs 0/20 failures. The spec's step 1, data contract and watcher line were updated, and `isLockOrTempPath` covers `.lock.break`.
2026-10-22 /audit (scope: current; 8c re-audit) re-read `src/disk/workspaceLock.ts:79-116` and `workspaceLock.test.ts`. Only the `.lock.break` (`wx`) holder removes a lock, and it re-checks the age under that sub-lock, so a lock a waiter just created is never unlinked by a slower waiter (that was the double-hold). Traced: stale-lock holder cannot recreate a lock while the file exists, so the recheck-to-unlink window needs a live holder past `staleMs`, which the existing `ponytail:` comment on `releaseLock` and the breaker documents. The remaining edge is a crashed breaker's sub-lock, removed unconditionally after `staleMs` (`:99-102`); two breakers racing that removal can briefly both hold the sub-lock, the ponytail comment names it. No starvation: a waiter that loses the sub-lock sleeps and retries until `timeoutMs`; worst case a crashed holder plus a crashed breaker blocks writers for about 60s, then self-heals. `isLockOrTempPath` now matches `.lock.*` and the test asserts it. Ran `vp test src/disk/workspaceLock.test.ts` 10 more times: 10/10 pass each run. The new stress test (6 callers x 15 rounds, `maxHolders === 1`, empty dir after) would fail on a double hold. I did not re-run the old code, so "failed every run before" is the implementer's report. The crashed-breaker recovery has no test: F-23. Closed.

### 8c/F-19 [P2] closed - Frame gesture state machine has no runnable check, including the F-17 regression

**File:** src/webview/App.svelte:345
**Found:** 2026-10-22 by /audit (scope: current; lens: tests)
**Why it matters:** `handleFrameGesture`, `startGesture`, `commitGesture`, `settleGestureOnCanvasUpdated` and the `artboard:error` clear are about 130 lines of phase/source/id/kind guards (one-at-a-time, committing ignores cancel, Agent-wins, keyup-then-blur single send, `repeat` start rule). The only evidence is user-run F5. Rule 03 asks for one runnable check on non-trivial logic, and rule 09 excludes Svelte components, not pure logic. Nothing fails if someone drops the F-17 `repeat` guard or the `phase === 'active'` guard, and those are exactly the sequences F5 covers by hand.
**Suggested fix:** Move the transition logic into a pure module next to `stageGeometry.ts` (for example `frameGesture.ts`: state + event in, state + optional `frame:place` out) and add one colocated `*.test.ts` for: second start ignored, cancel ignored while committing, end twice sends once, Agent-wins on `canvas:updated`, repeat nudge ignored with no gesture. `App.svelte` keeps the `$state` and the `postFramePlace` call. Loses no behavior.
**Resolution:** 2026-10-22 /implement: the gesture rules moved to pure `src/webview/frameGesture.ts` (`stepFrameGesture`, `settleFrameGesture`, and the `StageFrameGesture` / `FrameGesture` types). `App.svelte` keeps the `$state` and posts the returned `commit`. `frameGesture.test.ts` covers eight cases: pointer threshold and whole-px preview, one commit with base, a plain click writing nothing, resize clamping, a zoom change mid-drag, one gesture at a time with source and id matching, keyboard nudge and commit, F-17 auto-repeat after Agent-wins, and settle in both phases. Rule 05 catalog updated.
2026-10-22 /audit (scope: current; 8c re-audit) re-read `src/webview/frameGesture.ts`, `frameGesture.test.ts` and the `App.svelte` call sites (`handleFrameGesture`, `settleGestureOnCanvasUpdated`, the `artboard:error` clear). Rules match spec step 4/5 and the F-17 resolution: one gesture at a time (`gesture ?? newGesture`), `ownsEvent` requires `phase === 'active'` plus matching source, id and kind (so a late `lostpointercapture` end, a second keyup/blur end, or a cancel while committing is a no-op), a plain click under the 3px threshold clears without a commit, `end` commits once and moves to `committing`, `nudge` starts only when `!event.repeat`, and `settleFrameGesture` drops an active gesture whose frame moved or vanished and holds a committing one until disk differs from base. The `commit` is posted once through `postFramePlace` (`$state.snapshot`). Tests would fail if the `repeat` guard (`:109`) or the `phase` guard (`:59-60`) were removed. `vp test` runs the suite: 233 passed. Cancel-while-committing is covered only through the shared `ownsEvent` guard, not asserted directly; acceptable. Closed.

### 8c/F-20 [P3] closed - Errno and DiskError helpers duplicated in workspaceLock.ts

**File:** src/disk/workspaceLock.ts:25
**Found:** 2026-10-22 by /audit (scope: current; lens: quality)
**Why it matters:** `errnoCode` + `toDiskError` re-implement `isErrno` + `throwDiskError` (`src/disk/artboardFs.ts:214-225`). Rule 03 step 2 and rule 05 name a twin helper with a different name as a bug. artboardFs imports workspaceLock, so the lock cannot import the private helpers back; the fix is to share them, not copy them.
**Suggested fix:** Export `isErrno` and a `toDiskError(error): CursorDesignError` from `src/disk/errors.ts` (the domain-error owner), import them in both files, delete the local copies. Loses nothing.
**Resolution:** 2026-10-22 /implement: `isErrno` and `throwDiskError` are exported once from `src/disk/errors.ts`. `artboardFs.ts` and `workspaceLock.ts` import them, and the twin `errnoCode` / `toDiskError` were deleted. Rule 05 catalog updated.
2026-10-22 /audit (scope: current; 8c re-audit) grep shows `'code' in` only in `src/disk/errors.ts:16`. `artboardFs.ts` and `workspaceLock.ts` import `isErrno` / `throwDiskError` from `./errors`; `errnoCode` / `toDiskError` are gone from `src`. Rule 05 catalog line updated. Closed.

### 8c/F-21 [P3] closed - Best-effort lock cleanup swallows errors silently

**File:** src/disk/workspaceLock.ts:49
**Found:** 2026-10-22 by /audit (scope: current; lens: quality)
**Why it matters:** Rule 06 principle 5: a deliberate silent path logs first and carries a `ponytail:` comment. `handle.close().catch(() => undefined)` and `unlink(lockPath).catch(() => undefined)` (lines 49-50) do neither (line 48 explains intent but names no ceiling, and lint does not flag arrow-function catches). A failed unlink here leaves a half-made lock that blocks writers for 30s with nothing in any log.
**Suggested fix:** Route both through the same `process.stderr.write` used by `releaseLock` (a tiny local `logLockError`), and add the `ponytail:` ceiling (a leftover lock ages out after `staleMs`).
**Resolution:** 2026-10-22 /implement: the half-made-lock cleanup logs `close` and `unlink` failures through `logLockError` (stderr, the same helper as release) and carries a `ponytail:` comment naming the ceiling. There are no silent catches left in `workspaceLock.ts`.
2026-10-22 /audit (scope: current; 8c re-audit) `workspaceLock.ts:41-46` logs the `close` and `unlink` cleanup failures through `logLockError` before the original error is rethrown, with a `ponytail:` comment naming the staleMs ceiling. Every other catch in the file either narrows `ENOENT` and rethrows, logs (`release`, `break release`), or throws. No silent catch left. Closed.

### 8c/F-22 [P3] closed - Two more copies of the frame placement shape

**File:** src/webview/stageGeometry.ts:324
**Found:** 2026-10-22 by /audit (scope: current; lens: quality)
**Why it matters:** `FramePlacementBox` (`stageGeometry.ts:324`) is the same type as `FramePlacement` (`hostMessages.ts:42`), and `PlaceFrameArgs.base` (`artboardFs.ts:179`) inlines it again. `App.svelte` mixes the two names for the same value. Rule 04: reusable types live next to one owner.
**Suggested fix:** Delete `FramePlacementBox`; `import type { FramePlacement } from './hostMessages'` in `stageGeometry.ts` (hostMessages already imports `StageView` from there as a type, so there is no runtime cycle). Leave the disk copy, since disk cannot import webview types, or give disk the one definition and let `hostMessages` import it as a type.
**Resolution:** 2026-10-22 /implement: deleted `FramePlacementBox`. `stageGeometry.ts` imports the type `FramePlacement` from `hostMessages.ts`, and `PlaceFrameArgs.base` uses `Pick<CanvasFrame, 'x' | 'y' | 'width'>` so the disk lib does not import webview types.
2026-10-22 /audit (scope: current; 8c re-audit) `FramePlacementBox` is gone (grep over `src`, `.claude`, spec: no hits). `stageGeometry.ts:7` imports type `FramePlacement` from `hostMessages.ts` (type-only both ways, erased at build, so no runtime cycle and the `?iife` bundle for `canvas.html` is unaffected). `PlaceFrameArgs.base` is `Pick<CanvasFrame, 'x' | 'y' | 'width'>`, structurally what `parseChromeMessage` yields, so disk imports no webview type. Closed.

## Try it now

Run or do:

F5 (Run Extension), then Cursor Design: Open Artboard in `fixtures/dev-workspace`. Drag a frame by its label, then resize it by the right-edge handle, and release.

Expected:

The frame follows the cursor in whole pixels. After release, `.cursor-design/canvas.json` has the new x/y/width. Close and reopen the panel: the frame stays put.

This proves:

Label drag and handle resize persist through the same `placeFrame` write as the Agent.
