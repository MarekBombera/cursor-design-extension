# Feature: Frames

**From build-plan:** feature 6d
**Build attempt:** 1
**Branch:** feature/frames
**Status:** verified

## Goal

Turn the 6c single-provisional-frame stage into the real multi-frame canvas: every artboard file is its own sandboxed blob iframe on the stage, at its `canvas.json` position and fixed width, at full content height reported by `cd:frame-height`, with no inner scroll. Wheel and pinch over a frame are forwarded to the stage as `cd:frame-wheel`, unless a scroll box inside the design can take the wheel first. Chrome draws a label above each frame, one heading per `group`, highlights the active frame, and shows an error tile for an empty or broken frame without breaking the rest of the stage. Disk and export HTML stay untouched.

Sources: build-plan 6d, `project-overview.md` "0.2 canvas model" and "Canvas layout", Notion 0.2 page (locked contracts, 2026-10-13), 6b/6c archives.

## In scope

- Host reads every artboard plus the resolved layout and posts one canvas snapshot to the chrome (replaces the active-only `artboard:updated`).
- One blob iframe per frame at `(x, y)` and `width` from the resolved layout (stored `canvas.json` entries, then auto-placed ones, exactly as `list_artboards` returns them).
- Full height from `cd:frame-height`, with a vh feedback guard (see Data / contracts).
- `cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y }` replaces `canvas:wheel`. Plain wheel over a frame pans the stage unless a nested scroll box under the cursor can scroll that way; ctrl/meta wheel (pinch) always zooms at the cursor.
- Frame labels (`textContent`), one heading per group (`textContent`), active-frame highlight, error tiles.
- Per-frame reconcile: editing one artboard reloads only that frame's iframe. Moved, resized, relabeled, regrouped, or re-activated frames update in place without reloading. Removed artboards disappear and their blob URL is revoked.
- Stage bounds (fit-all, clamps) cover frames, labels, headings, and tiles at their current heights.
- `.cursor/rules/02-mcp-webview.mdc` message list updated to the new contract.

## Out of scope

- Canvas export, `canvas.html`, `manifest.lastExport.frames`, multi-frame stale logic (6e). `export_artboard` and `handoffStale` keep today's active-artboard behavior.
- F5 dogfood with the reference four-frame canvas and export-clean proof (6f). This feature runs its own F5 check only.
- Dragging or resizing frames by hand, frame list or sidebar, Edit mode, any MCP tool change, any `canvas.json` schema change.
- Labels that stay a constant screen size while zooming (labels scale with the stage in 0.2).
- Rewriting `vh` units in the blob copy.
- Dropping late `cd:frame-wheel` from a frame's previous document (accepted; see Notes).
- Svelte.

## Build loop

`workflow.stepReview` is `feature`: build all steps, run the gates after each step, and present one review packet after the last step, including the Step 5 F5 observations. `workflow.checkpointCommits` is `disabled`: no checkpoint commits. `/complete` creates the feature commit.

Gates after every step: `pnpm check-types`, `pnpm lint`, and the spec test runner from Testing (not a declared Blueprint test gate; AGENTS.md has no Test/Verify command). Step 5 adds F5.

## Build steps

- [x] **1. Disk: canvas view reader.** In `src/disk/artboardFs.ts`, extract the artboard scan inside `listArtboards` into an internal helper. The scan already reads each artboard's HTML to compute effective meta; the helper returns that string internally instead of discarding it, so MCP I/O does not change. The helper takes a per-file tolerance flag: `listArtboards` calls it strict (today's behavior: a `DiskError` on one HTML read throws), and its result shape and behavior stay exactly as today (no `html` in its result, still throws on a corrupt or unsupported `canvas.json`). Add exported `readCanvasView({ workspaceRoot })` returning `CanvasView` (see Data / contracts). It calls the helper tolerant: a `DiskError` while reading one artboard's HTML lists that artboard with `html: ''` and `errorMessage: FRAME_READ_ERROR_MESSAGE`, and the other artboards still return. It reads the layout with the existing `readCanvasLayoutFile`; on `CorruptCanvasError` or `UnsupportedCanvasVersionError` it resolves frames from an empty stored list (all auto-placed), keeps the manifest `activeArtboardId`, and sets `layoutErrorMessage` to that error's `message` (both are authored, workspace-relative copy in `src/disk/errors.ts`, so rule 06 allows them). Any other error propagates. It never writes.
  - Done when: new tests in `src/disk/canvasView.test.ts` (temp-dir pattern from `src/mcp/artboardTools.test.ts`) prove: no `artboards/` dir and no `canvas.json` → `{ activeArtboardId: '', frames: [] }` with no `layoutErrorMessage`; two artboards with one stored and one auto-placed frame give the same `id/label/x/y/width/group` as `listArtboards().frames` plus `html` and `generation`; corrupt `canvas.json` → auto-placed frames, the manifest `activeArtboardId`, the `CorruptCanvasError` message, and the file bytes unchanged; unsupported version → same with that message; a zero-length HTML file is listed with `html: ''` and no `errorMessage`; an artboard whose `.html` is a directory or symlink is skipped exactly as `listArtboards` skips it today. Existing `listArtboards` / `place_frame` tests pass unchanged.

- [x] **2. Host snapshot + chrome multi-frame stage.** Replace the active-only path end to end in one step so the panel never breaks:
  - `src/host/artboardDisk.ts`: the loaded snapshot becomes `CanvasSnapshot` (Data / contracts). After the existing trust check and default-artboard init, it calls `readCanvasView({ workspaceRoot: workspaceFolder.uri.fsPath })`. `generation` comes from the active frame (`0` when none). `handoffStale` keeps today's computation against the active artboard's HTML. `errorMessage` is, in order: an existing load error (corrupt manifest, untrusted), `ArtboardNotFoundError` text when `activeArtboardId` is non-empty and not among the frames, `layoutErrorMessage`, else absent. A throw from `readCanvasView` goes through the existing `loadActiveSnapshot` catch: `logDiskError` to the OutputChannel, then the empty snapshot with `toSafeArtboardErrorMessage(error)` as `errorMessage`. `emptyArtboardSnapshot(errorMessage?)` returns `{ activeArtboardId: '', generation: 0, frames: [], handoffStale: false, errorMessage }`. `snapshotForChrome` returns `frames: []` (not blanked frames) and the untrusted message when the workspace is untrusted, so only the banner shows.
  - `src/panel/openArtboardPanel.ts`: `ArtboardUpdatedMessage` is replaced by `CanvasUpdatedMessage`. Each posted frame carries `label` from the layout frame, `html` from disk, and `errorMessage` only for a per-frame failure. The 1.5M-char cap applies per frame: an over-cap frame is posted with `html: ''` and `errorMessage: ARTBOARD_HTML_TOO_LARGE_MESSAGE` (the existing constant, `'Artboard HTML is too large to preview in the panel.'`); it does not set the global banner. After `canvas:updated`, `artboard:error` is posted if and only if the snapshot has `errorMessage` (today's flush order).
  - `src/host/handleOpenArtboard.ts`, `src/host/watchArtboardDisk.ts`: post the canvas snapshot. The watcher already covers `.cursor-design/**`, so `canvas.json` edits refresh with the same 200ms debounce; no watcher change beyond types.
  - `src/panel/artboardChromeHtml.ts`: remove the single static `#artboard-frame`; `#stage-layer` starts empty. Add styles: `.cd-frame` (absolute, `overflow: hidden`, `pointer-events: none`), `.cd-frame > iframe` (block, full wrapper width and height, border 0, chrome editor background, `pointer-events: auto`), `.cd-frame-active` (outline `2px solid var(--vscode-focusBorder)`), and `.cd-frame-tile` (full wrapper size, `var(--vscode-errorForeground)` text, `var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground))` 1px border, padding, `box-sizing: border-box`, wraps long text). Tiles inherit `pointer-events: none`, so wheel, pinch, and drag on a tile use the empty-stage path.
  - `src/panel/artboardChromeScript.ts`: a `Map` of frame records keyed by id, each with one `.cd-frame` wrapper `div` (`data-cd-frame-id`) holding either an iframe or a tile. On every valid `canvas:updated` (validation in Data / contracts), reconcile by id in message order: set the wrapper's `left/top/width/height` in stage px (height = the iframe's current height, or `ERROR_TILE_HEIGHT` for a tile); toggle `.cd-frame-active` with `id === activeArtboardId`; update the iframe `title` to `'Frame: ' + label`. A frame with `errorMessage` or `html.trim() === ''` shows a tile (see Error tile). Otherwise, only when `html` differs from the record's last html (or the record was a tile), revoke the old blob URL, build a new one with the existing `stampArtboardHtml`, and reset the record's height-guard state; a throw from stamping or blob creation turns that frame into a tile. Records whose ids are missing from the message (or were skipped as invalid) are removed and their blob URLs revoked. Every iframe is created with `sandbox="allow-scripts"` and `scrolling="no"`. Iframe height starts at `PROVISIONAL_FRAME_HEIGHT = 800` and is kept across html changes. Zero frames → empty copy and disabled toolbar, as today. `stageBounds()` is `frameBounds` over the records' current wrapper rects (Step 3 replaces it). Initial view, unchanged rule from 6c: a valid persisted view is restored and never refit; with none, fit once per webview load over the current rects (provisional heights allowed); later updates and height reports only re-clamp. `pagehide` revokes every blob URL. Frame messages are routed by looking up `event.source` among the records' iframe `contentWindow`s, before the `'null'` origin drop. For this step only, the existing `canvas:wheel` zoom stays, anchored at that frame's stage origin (`frame.x + clientX`, `frame.y + clientY`); Step 4 replaces it.
  - Done when: string tests prove the static iframe is gone, `canvas:updated` replaces `artboard:updated` in host types and chrome, the message and per-frame validation exists, per-frame html diffing exists, removed frames revoke, the active class is toggled per update, frame lookup happens before the null-origin drop, and every created iframe gets `sandbox="allow-scripts"` and `scrolling="no"`. Types, lint, and all tests pass.

- [x] **3. Labels and group headings.** Add pure `layoutCanvasChrome({ frames })` to `STAGE_GEOMETRY_SOURCE` (contract in Data / contracts). The chrome renders each label and heading as an absolutely positioned `div` appended to `#stage-layer` after the frame wrappers (so they paint above), sized to the box `layoutCanvasChrome` returns, with `textContent` only, `pointer-events: none`, `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`. Headings are reused per group and removed when their group empties. `stageBounds()` now returns `layoutCanvasChrome(...).bounds`. On every `canvas:updated` and every applied height change, labels and headings are reconciled (label text, positions, add/move/remove headings).
  - Done when: vm tests in `src/panel/stageGeometry.test.ts` prove label boxes, one heading per group with the group-span width at the documented position, no heading for ungrouped frames, bounds that include label and heading boxes, and `bounds: null` for no frames. A chrome string test proves labels and headings use `textContent` and never `innerHTML`. Types, lint, tests pass.

- [x] **4. Frame runtime: height, wheel forwarding, nested scroll.** In `src/panel/artboardCanvasRuntime.ts` replace `CANVAS_WHEEL_MESSAGE` with `FRAME_WHEEL_MESSAGE = 'cd:frame-wheel'` and add `FRAME_HEIGHT_MESSAGE = 'cd:frame-height'`, both per Data / contracts. Add pure `nextFrameHeight` to `STAGE_GEOMETRY_SOURCE`. In the chrome, `cd:frame-height` updates that record's iframe and wrapper height through `nextFrameHeight` (state reset to `{ lastGrowth: 0, frozen: false }` on every html change, height kept), then reconciles labels and headings and re-commits the view (clamp only, no refit). `cd:frame-wheel` with `ctrlKey: true` → `zoomStageAt({ view: stageView, deltaY, screenX, screenY })` with the raw `deltaY` and the frame anchor from Data / contracts (same call and sensitivity as empty-stage ctrl+wheel); `ctrlKey: false` → `panStage({ view: stageView, deltaX, deltaY })` with raw deltas and no sign flip (same as empty-stage wheel). Payloads failing validation are dropped with no log (keep the existing `ponytail:` comment). Remove every `canvas:wheel` reference from production code and from old tests. Update `.cursor/rules/02-mcp-webview.mdc` item 5 to exactly: `5. Messages: artboard:ready (chrome → host), canvas:updated|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed: cd:frame-height { height }, cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y } (frame-local CSS px). Chrome → iframe: none.`
  - Done when: runtime string tests prove the source has no `<`, captures `window.parent` first, posts only the two message types, never writes styles or attributes, contains the nested-scroll walk, and clamps height to 20000. vm tests prove `nextFrameHeight` for: first report, shrink (including below 800), growth, non-finite input (including `Infinity`) ignored, clamp to `[1, 20000]`, feedback detection freezing growth, shrink still applying while frozen, and reset state. Chrome string tests prove both handlers validate every field, the wheel handler passes raw `deltaY` to `zoomStageAt` and raw deltas to `panStage`, `canvas:wheel` appears in neither `src/panel/artboardCanvasRuntime.ts` nor `src/panel/artboardChromeScript.ts`, and the rule line matches. Types, lint, tests pass.

- [x] **5. F5 check.** `pnpm compile`, confirm `dist/mcp.js`, F5 into `fixtures/dev-workspace`. Through MCP (or hand-written files) create: a 1280px page taller than 2000px, a 390px page, a 600px section shorter than 800px with an inner `overflow: auto` box, a 1280px page with a `min-height: 100vh` hero followed by more content, and one zero-length HTML file; `place_frame` two of them into group `Desktop`. Observe and record each item below. Fix what fails within this feature's scope.
  - Done when, observed in F5: each frame renders at its width with full content height and no inner scrollbar; the short section shrinks below 800px to its content height; the `100vh` page's final height is recorded and is not 20000px; labels show above frames and one `Desktop` heading shows above the grouped frames; the empty file shows a tile while the others work; ctrl+wheel/pinch over a frame zooms at the cursor; plain wheel over a frame pans the stage; wheel over the inner scroll box scrolls it until its edge, then pans; wheel and drag over a tile pan the stage; a CSS hover and an inline-script click handler inside a frame still work (no navigation required; sandbox is `allow-scripts` only); `set_artboard` on one frame reloads only that frame; `place_frame` moves or relabels a frame without reloading it; `set_active_artboard` moves the highlight and badge; deleting an artboard file removes its frame; hide/show restores the view without refitting; no CSP errors in webview devtools; HTML files that existed before the check are byte-unchanged, and each file created during the check equals what MCP or the hand edit wrote (no injected runtime).
  - Observed 2026-10-17 (Bombic + agent in the real Artboard panel): no in-scope fail. Widths after Fit all; tall full height, no inner scrollbar; short well under 800px; vhhero ≈ 1600px (hero visible, below-fold clipped, not 20000); labels + Desktop heading; empty tile `Empty artboard file.`; zoom/pan over frames; nested scroll then stage pan; tile pan; hover + dogfood click (`Clicked`, no navigation); set_active moves outline/badge; delete removes frame; hide/show restores view; no CSP in webview DevTools; pre-existing hashes unchanged, no runtime in disk HTML. O–P: MCP/disk earlier; iframe flash not watched (accepted).

- [x] **6. F-10: log framed HTML read errors.** Keep each tolerant `DiskError` on `CanvasView.htmlReadErrors` (`{ artboardId, error }`). After a successful `readCanvasView`, the host logs each framed `errorMessage` as `artboardDisk.frameRead:<id>: <message>` and `logDiskError` of that `DiskError` (stack/code). Tile text stays `FRAME_READ_ERROR_MESSAGE`; never `error.message`.
  - Done when: an unreadable regular `.html` view has `errorMessage === FRAME_READ_ERROR_MESSAGE`, `htmlReadErrors[0].error instanceof DiskError`, and `error.message !==` the tile text. Host calls `logDiskError` with `artboardDisk.frameRead:<id>`. Types, lint, tests pass.

- [x] **7. F-11: isolate handoff-stale I/O.** Wrap the `lastExportHandoffStale` vscode.fs work in its own try. On failure, `logDiskError` with scope `artboardDisk.handoffStale`, keep `view.frames`, set `handoffStale: true`.
  - Done when: that try/catch exists; a handoff-stale throw cannot take the `readCanvasView` catch that posts `frames: []`. Types, lint, tests pass.

- [x] **8. F-12: stamp/blob catch ponytail.** In `showFrameIframe`, keep the tile on stamp/blob throw. Add `// ponytail: stamp/blob throw is per-frame tile copy only; no chrome log`.
  - Done when: that comment sits on the catch and the tile copy is unchanged. Types, lint, tests pass.

- [x] **9. F-13: pin scan tiles and list html omission.** In `src/disk/canvasView.test.ts`: listed artboards omit `html`; unreadable meta → `generation === 0`; unreadable regular `.html` → `FRAME_READ_ERROR_MESSAGE` and siblings still return.
  - Done when: those three assertions exist and pass. Types, lint, tests pass.

- [x] **10. F-14: pin chrome reconcile contract.** In `src/panel/artboardChromeHtml.test.ts`: `removeFrameRecord(entry.id)` after `isValidPostedFrame`; `lastGrowth: 0, frozen: false` on the html-reload path; the three tile strings in priority order (`errorMessage`, `'Empty artboard file.'`, `'Could not render this frame.'`).
  - Done when: those pins exist and pass. Types, lint, tests pass.

- [x] **11. F-15: pure host snapshot tests.** Extract vscode-free `snapshotForChrome`, `postedFrameFromSnapshot`, and banner-order (`canvasSnapshotErrorMessage`) and test them: untrusted → `frames: []`; 1.5M cap per frame uses `ARTBOARD_HTML_TOO_LARGE_MESSAGE` and does not set a global banner; `errorMessage` order is load error → missing active → `layoutErrorMessage`.
  - Done when: those tests pass without a VS Code mock. Types, lint, tests pass.

## Files / areas

- `src/disk/artboardFs.ts` (scan helper, `readCanvasView`, `FRAME_READ_ERROR_MESSAGE`), new `src/disk/canvasView.test.ts`
- `src/host/artboardDisk.ts`, `src/host/canvasSnapshot.ts`, `src/host/handleOpenArtboard.ts`, `src/host/watchArtboardDisk.ts`
- `src/panel/openArtboardPanel.ts`, `src/panel/artboardChromeHtml.ts`, `src/panel/artboardChromeScript.ts`, `src/panel/artboardCanvasRuntime.ts`, `src/panel/stageGeometry.ts`
- `src/panel/artboardChromeHtml.test.ts`, `src/panel/stageGeometry.test.ts`
- `.cursor/rules/02-mcp-webview.mdc` (item 5 only)
- Not touched: MCP tools, `canvas.json` schema, `src/disk/canvasLayout.ts` semantics, export/handoff code, `package.json`.

## Data / contracts

**`CanvasView`** (disk, `src/disk/artboardFs.ts`):

```ts
type CanvasViewFrame = CanvasFrame & { generation: number; html: string; errorMessage?: string };
type CanvasView = { activeArtboardId: string; frames: CanvasViewFrame[]; layoutErrorMessage?: string };
```

`frames` order and geometry equal `resolveCanvasFrames` over the scanned artboards (sorted by id, stored entries first). `label` is the resolved layout label (stored label, or the effective title / id for auto-placed frames, as `resolveCanvasFrames` already does). `generation` is `0` when meta is unreadable. `FRAME_READ_ERROR_MESSAGE = 'Could not read this artboard file. Check the Output panel: Cursor Design.'`.

**`CanvasSnapshot`** (host, `src/host/artboardDisk.ts`): `{ activeArtboardId: string; generation: number; frames: CanvasViewFrame[]; handoffStale: boolean; errorMessage?: string }`.

**Host → chrome `canvas:updated`** (replaces `artboard:updated`):

```ts
type CanvasUpdatedMessage = {
  type: 'canvas:updated';
  activeArtboardId: string;   // '' when none
  generation: number;         // active frame's; 0 when none
  cspNonce: string;
  frames: Array<{ id: string; label: string; x: number; y: number; width: number; group?: string; html: string; errorMessage?: string }>;
};
```

Chrome validation (no log on reject): drop the whole message unless `activeArtboardId` and `cspNonce` are strings, `generation` is finite, and `frames` is an array. Skip a frame entry unless `id`, `label`, and `html` are strings, `x`/`y`/`width` are finite, and `group` and `errorMessage` are each absent or a string; a skipped entry's record (if any) is removed; one bad entry never aborts the loop. Badges: id badge = `activeArtboardId`, generation badge = `generation` (empty when `activeArtboardId` is `''`). After a valid `canvas:updated` the error banner is cleared; the host then posts `artboard:error` when it has an `errorMessage`. `artboard:error { message }` and `ui:status` are unchanged.

**Error tile:** shown inside the frame's wrapper at the frame's `x`, `y`, `width`, height `ERROR_TILE_HEIGHT = 160` stage px. Text (`textContent`), in priority: the frame's `errorMessage`; `'Empty artboard file.'` when `html.trim() === ''`; `'Could not render this frame.'` when stamping or blob creation threw. The label still shows above the tile and the active highlight applies to the wrapper. A tile never posts or receives messages and takes no pointer events.

**`cd:frame-height`** (frame → chrome): `{ type: 'cd:frame-height', height: number }`. Runtime measures `Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height, document.body ? document.body.scrollHeight : 0))`. In standards mode (the blob copy always starts with `<!DOCTYPE html>`) the `html` box with `height: auto` and `body.scrollHeight` are content-sized and can be smaller than the iframe, so frames shrink; `documentElement.scrollHeight` is not used because it never drops below the iframe viewport. A design that sets `html`/`body` to `height: 100%` or `vh` sizes ties the measure to the iframe height; that is the `vh` case below. It observes `document.documentElement` with a `ResizeObserver` from injection time, observes `document.body` once it exists (`DOMContentLoaded`), and also measures on `load`. Reports are debounced 100ms trailing, capped at 20000, and sent only when the value differs from the last sent one. Chrome accepts only a finite number and applies it through `nextFrameHeight`.

**`nextFrameHeight({ current, reported, state })` → `{ height, state }`** (pure, in `STAGE_GEOMETRY_SOURCE`). `state` is `{ lastGrowth: number, frozen: boolean }`; initial and after every html change: `{ lastGrowth: 0, frozen: false }`. Rules, in order: if `reported` is not finite return `current` and `state` unchanged; clamp `reported` to `[1, 20000]`; `growth = reported - current`. If `growth <= 0`: return `reported`, `lastGrowth: 0`, `frozen` unchanged. If `frozen`: return `current`, state unchanged. If `lastGrowth > 0` and `Math.abs(growth - lastGrowth) <= 1`: return `current`, `{ lastGrowth, frozen: true }` (vh feedback detected). Otherwise return `reported`, `lastGrowth: growth`.

**`cd:frame-wheel`** (frame → chrome): `{ type: 'cd:frame-wheel', deltaX: number, deltaY: number, ctrlKey: boolean, x: number, y: number }`. `ctrlKey` is `event.ctrlKey || event.metaKey`. `x`/`y` are `event.clientX`/`clientY` (frame-local CSS px; equal to frame stage px because frames are unscaled and never scroll). Runtime rules, one capture-phase non-passive `wheel` listener:
- ctrl/meta: `preventDefault()` and forward.
- Plain wheel: dominant axis is Y when `Math.abs(deltaY) >= Math.abs(deltaX)`, else X. Walk from `event.target` (or its parent element if it is not an element) up through ancestors, stopping before `document.body` and `document.documentElement`. An element can take the wheel when its computed `overflow-y` (or `overflow-x` for X) is `auto`, `scroll`, or `overlay`, and it has room in the delta's direction (Y down: `scrollHeight - 1 > scrollTop + clientHeight`; Y up: `scrollTop > 0`; X likewise with width/left). If one can, do nothing (native scroll). Otherwise `preventDefault()` and forward.
- The source must stay free of the less-than character (write comparisons with `>` and swapped operands).

Chrome accepts `cd:frame-wheel` only with finite `deltaX`, `deltaY`, `x`, `y` and boolean `ctrlKey`. Anchor: `screenX = stageView.x + (frame.x + x) * stageView.zoom`, `screenY = stageView.y + (frame.y + y) * stageView.zoom`.

**Frame message routing:** only messages whose `event.source` equals a current record's iframe `contentWindow` are frame messages; anything else with origin `'null'` is dropped. Messages are typed and allowlisted; nothing from a frame is trusted beyond these numbers.

**`layoutCanvasChrome({ frames })` → `{ labels, headings, bounds }`** (pure, in `STAGE_GEOMETRY_SOURCE`; inputs `{ id, x, y, width, height, group? }`, callers pass `ERROR_TILE_HEIGHT` as a tile's height). Constants `FRAME_LABEL_BAND = 24`, `GROUP_HEADING_BAND = 32` (stage px).
- `labels`: one `{ id, x: frame.x, y: frame.y - 24, width: frame.width, height: 24 }` per frame.
- `headings`: one per distinct non-empty `group`, in first-seen order: `{ group, x: minX, y: minY - 24 - 32, width: max(member.x + member.width) - minX, height: 32 }`, where `minX`/`minY` are the members' min `x`/`y`.
- `bounds`: `frameBounds` over every frame rect, label box, and heading box; `null` when there are no frames.

**Rendering safety:** label, heading, tile text, and iframe `title` are set with `textContent` / `setAttribute` only. Chrome-owned attributes on created elements use the `data-cd-*` prefix (e.g. `data-cd-frame-id`). The blob copy keeps the 6a stamping and single runtime injection; disk and export HTML are never modified.

## Testing

No Verify or Test command is declared in AGENTS.md. Spec test runner (same as 6c): `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`. Baseline at spec time: 131 tests, all pass; `pnpm check-types` and `pnpm lint` clean.

- Disk: `src/disk/canvasView.test.ts` with temp dirs.
- Geometry: `layoutCanvasChrome` and `nextFrameHeight` through `node:vm` on the shipped `STAGE_GEOMETRY_SOURCE` string, like the existing stage geometry tests. The chrome inlines that same string (as 6c does); no second copy of the math.
- Chrome and runtime: string-level tests (Node has no DOM, wheel, ResizeObserver, or iframes).
- Proven only by Step 5 F5: real iframe sizing, height reports, shrink, vh guard, nested scroll, gesture forwarding, tile pass-through, per-frame reloads, CSP. No browser tests exist; none added.

## Notes for the AI

- Repository facts at spec time: the chrome is one template literal with a single `<script nonce>`; `STAGE_GEOMETRY_SOURCE` and the chrome script must stay free of backtick, dollar-brace, and less-than-slash; the runtime must stay free of `<`. `stampArtboardHtml` / `injectCanvasRuntime` already handle nonce stamping and single injection; reuse them per frame. `commitStageView` is the single view write path; keep it. `flushPendingArtboardView` already posts the view, then `artboard:error` when set.
- The extension host already uses `src/disk/artboardFs.ts` with `workspaceFolder.uri.fsPath` (`src/commands/exportHandoff.ts`); the host reading frames through it follows that precedent and gets its symlink/ownership guards. `listArtboards` already reads every artboard's HTML through `readUtf8IfExists`.
- `listArtboards` result shape is an MCP contract (6b). Do not add `html` to it.
- `CorruptCanvasError` and `UnsupportedCanvasVersionError` messages are authored, path-relative copy; passing them to the banner follows rule 06.
- `cspNonce` is fixed for the webview lifetime, so skipping restamp when `html` is unchanged is safe.
- Keep `ponytail:` comments for accepted limits: no total payload cap across frames (per-frame 1.5M cap only); labels scale with zoom; a late `cd:frame-height` or `cd:frame-wheel` from a frame's previous document is accepted (wheel can only pan/zoom within clamps, which an artboard script could already spoof per 6a); `deltaMode` ignored (Chromium sends pixels); content positioned outside the body's scrollable overflow is not measured.
- `PROVISIONAL_FRAME_WIDTH` goes away; width always comes from the layout.

## Open questions

- **`100vh` layouts.** A frame's iframe height is its viewport height, so content sized in `vh` grows with the frame. Without a guard, a page with a `100vh` hero plus more content grows to the 20000px cap. This spec's default is the `nextFrameHeight` guard: growth stops once the same growth repeats. The frame then shows the hero at the grown height and clips the content below it (no inner scroll: `scrolling="no"`, wrapper `overflow: hidden`). A rare false positive is two equal real growths in a row (e.g. two same-size images loading in separate debounce windows); that frame stays frozen until its HTML changes. Alternatives for a later feature: rewrite `vh` to px in the blob copy only, or tell the Agent (via the agent-loop skill) to avoid `vh` in frames. Implementation proceeds with the default unless Bombic picks another.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":29524,"specSha256":"92c3967ce3a09fe5ba0315acc2e1189b7788b6f02836b4b798cc345aebcdb73b","branch":"refs/heads/feature/frames","head":"7ae3101652f8f194a9b2664422fb009daa437193","baseRef":"refs/heads/main","baseCommit":"571cc69d75328b51de34d6991bd9d0e97ef3e747","sourceTree":"0c2b080c13af77f52ebfc1d8b25adcb7aea36b23","absentOptional":[]} -->

## Findings

### 6d/F-08 [P3] closed - No test pins the finite-deltaY guard on untrusted iframe messages

**File:** src/panel/artboardChromeHtml.ts:151
**Found:** 2026-10-12 by /audit (scope: current; lens: tests)
**Why it matters:** `handleCanvasMessage` is the only validation on iframe → chrome input. If `Number.isFinite(data.deltaY)` is dropped, one spoofed `{ type: 'canvas:wheel', deltaY: NaN }` makes `canvasView.zoom` NaN (the `Math.min`/`Math.max` clamp passes NaN through), and every later multiply stays NaN, so zoom is dead until the chrome reloads. No test in `artboardChromeHtml.test.ts` fails if the guard is removed.
**Suggested fix:** Add `assert.ok(chrome.html.includes('Number.isFinite(data.deltaY)'))` to the existing listener-order or wheel test. The 6b zoom-math module can replace it with a real unit test.
**Resolution:** 2026-10-16 dual `/audit` (scope: current) re-read chrome. `canvas:wheel` is gone. `cd:frame-wheel` validates finite `deltaX`/`deltaY`/`x`/`y` and boolean `ctrlKey`; `artboardChromeHtml.test.ts` pins those guards. Original untested path no longer exists. 2026-10-18 independent review (scope: current; target 7ae31016): re-read chrome and runtime; `canvas:wheel` still absent from production; finite-field guards remain. Closed.

### 6d/F-10 [P1] closed - Frame-read tiles tell the user to check Output, but nothing is logged

**File:** src/disk/artboardFs.ts:782
**Found:** 2026-10-16 by /audit (scope: current; lens: quality)
**Why it matters:** Tolerant scan catches `DiskError` on one artboard HTML, sets `html: ''` and `FRAME_READ_ERROR_MESSAGE` (`Check the Output panel: Cursor Design.`), and drops `cause`. Host `loadActiveSnapshot` only logs throws from `readCanvasView`. Rule 06 pairs that sentence with `logDiskError`. The tile's next step is a dead end.
**Suggested fix:** After a successful `readCanvasView`, log each framed `errorMessage` (id + message) on the OutputChannel. Keep the `DiskError` long enough to log stack/code in Output, then still tile. Do not put `error.message` in the tile.
**Resolution:** 2026-10-16 /implement: `readCanvasView` keeps each `DiskError` on `htmlReadErrors`. Host logs `artboardDisk.frameRead:<id>: <FRAME_READ_ERROR_MESSAGE>` then `logDiskError` of that error. Tile text stays `FRAME_READ_ERROR_MESSAGE`. 2026-10-17 /audit (scope: current): re-read `artboardFs.ts`, `artboardDisk.ts`, `canvasSnapshot.ts`, and tests. Tolerant `DiskError` is kept; `postedFrameFromSnapshot` still posts the constant, not `error.message`; host `logCanvasViewReadErrors` writes the tile line plus `logDiskError`. Repair introduced no new defect. Closed. 2026-10-18 independent review (scope: current; target 7ae31016): re-read the same path; tile copy is still the constant; Output still gets the DiskError. Closed.

### 6d/F-11 [P2] closed - Handoff-stale vscode.fs I/O can empty the whole stage

**File:** src/host/artboardDisk.ts:221
**Found:** 2026-10-16 by /audit (scope: current; lens: quality)
**Why it matters:** `readCanvasView` can succeed with every frame. Then `lastExportHandoffStale` re-reads the manifest and may `stat`/`readFile` another HTML via `vscode.workspace.fs`. Any throw hits the same catch as a view failure and posts `frames: []`. Spec only names emptying on a `readCanvasView` throw.
**Suggested fix:** Wrap stale computation in its own try; on failure log, keep `view.frames`, set `handoffStale: true` (or leave false).
**Resolution:** 2026-10-16 /implement: `lastExportHandoffStale` vscode.fs work is in its own try. Failure logs `artboardDisk.handoffStale`, keeps `view.frames`, sets `handoffStale: true`. 2026-10-17 /audit (scope: current): re-read `snapshotFromCanvasView`. `readCanvasView` is outside that try; only vscode.fs stale I/O is inside. Failure cannot take the `loadActiveSnapshot` `frames: []` catch. Repair introduced no new defect. Closed. 2026-10-18 independent review (scope: current; target 7ae31016): re-read `snapshotFromCanvasView`; isolation still holds. Closed.

### 6d/F-12 [P2] closed - Stamp/blob failure is an empty catch with no ponytail

**File:** src/panel/artboardChromeScript.ts:472
**Found:** 2026-10-16 by /audit (scope: current; lens: quality)
**Why it matters:** Rule 06 forbids empty `catch {}` unless there is a log plus a named ceiling. The tile (`Could not render this frame.`) is the only signal. A later change can log `error.message` into the tile or let the throw abort the rest of reconcile.
**Suggested fix:** Keep the tile. Add `// ponytail: stamp/blob throw is per-frame tile copy only; no chrome log`.
**Resolution:** 2026-10-16 /implement: catch still tiles `Could not render this frame.` and now has that ponytail comment. 2026-10-17 /audit (scope: current): re-read `showFrameIframe`. Catch is per-frame, uses the fixed tile copy (not `error.message`), and carries that ponytail. Reconcile continues. Repair introduced no new defect. Closed. 2026-10-18 independent review (scope: current; target 7ae31016): re-read `showFrameIframe`; ponytail and fixed copy remain. Closed.

### 6d/F-13 [P2] closed - DiskError tiles, generation 0, and list html-omission are untested

**File:** src/disk/canvasView.test.ts:169
**Found:** 2026-10-16 by /audit (scope: current; lens: tests)
**Why it matters:** `listedFromScan` strips `html`, view maps unreadable meta to `generation: 0`, and DiskError HTML becomes `FRAME_READ_ERROR_MESSAGE`. None of that is pinned. Adding `html` to listed artboards, omitting generation, or throwing on one unreadable file would still pass step 1 Done-whens. MCP `JSON.stringify` would then leak every artboard body.
**Suggested fix:** Assert `'html' in listed.artboards[0] === false`; unreadable meta → `generation === 0`; chmod/unreadable regular `.html` → `errorMessage === FRAME_READ_ERROR_MESSAGE` and siblings still return.
**Resolution:** 2026-10-16 /implement: `canvasView.test.ts` pins list html omission, unreadable meta → generation 0, and unreadable `.html` tiles plus siblings. 2026-10-17 /audit (scope: current): re-read those tests and `listedFromScan`. The three pins exist and passed in this run (`unreadable html` 8.3ms, not skipped). Repair introduced no new defect. Closed. 2026-10-18 independent review (scope: current; target 7ae31016): re-read `listedFromScan` and those tests; they passed again (`unreadable html` 10.2ms, not skipped). Closed.

### 6d/F-14 [P2] closed - Chrome Done-whens are substring mirrors, not the contract

**File:** src/panel/artboardChromeHtml.test.ts:267
**Found:** 2026-10-16 by /audit (scope: current; lens: tests)
**Why it matters:** Step 2/3/4 Done-whens only require that names exist in the template. Deleting `removeFrameRecord(entry.id)` still passes because tests pin `removeFrameRecord(id)` (the missing-id sweep). Skipping `heightGuard` reset or changing tile copy also still passes.
**Suggested fix:** Pin `removeFrameRecord(entry.id)` after `isValidPostedFrame`, `lastGrowth: 0, frozen: false` on the html-reload path, and the three tile strings in priority order. That is not F5.
**Resolution:** 2026-10-16 /implement: `artboardChromeHtml.test.ts` pins invalid-entry revoke, height-guard reset on reload, and tile copy order. 2026-10-17 /audit (scope: current): re-read those pins and `artboardChromeScript.ts`. Invalid entries call `removeFrameRecord(entry.id)` after `isValidPostedFrame`; html reload resets `heightGuard`; `tileCopy` order is errorMessage, empty, render-failed. Repair introduced no new defect. Closed. 2026-10-18 independent review (scope: current; target 7ae31016): re-read chrome reconcile and those pins; contract still matches. Closed.

### 6d/F-15 [P2] closed - Host snapshot, 1.5M cap, and banner order have no tests

**File:** src/host/artboardDisk.ts:61
**Found:** 2026-10-16 by /audit (scope: current; lens: tests)
**Why it matters:** Spec: untrusted → `frames: []` not blanked html; 1.5M cap per frame with `ARTBOARD_HTML_TOO_LARGE_MESSAGE` and no global banner; `errorMessage` order load error → missing active → `layoutErrorMessage`. No host test exists. Two implementers can blank html (empty-file tiles while untrusted), apply a total cap, or put too-large on `artboard:error`.
**Suggested fix:** Pure tests of `snapshotForChrome`, `postedFrameFromSnapshot`, and banner-order. No VS Code mock required if those stay extractable.
**Resolution:** 2026-10-16 /implement: extracted vscode-free helpers in `src/host/canvasSnapshot.ts`; `src/panel/canvasSnapshot.test.ts` covers untrusted `frames: []`, per-frame 1.5M cap, and banner order. 2026-10-17 /audit (scope: current): re-read `canvasSnapshot.ts`, the host wrapper, `openArtboardPanel.ts`, and those tests. Untrusted blanks `frames`; cap is per-frame and does not set `snapshot.errorMessage`; banner helper order matches the spec. Repair introduced no new defect. Closed. 2026-10-18 independent review (scope: current; target 7ae31016): re-read host snapshot helpers, `postArtboardSnapshotToPanel`, and those tests; still matches. Closed.

## Independent review

**Status:** passed
**Target commit:** 7ae3101652f8f194a9b2664422fb009daa437193
**Base commit:** 571cc69d75328b51de34d6991bd9d0e97ef3e747
**Base ref:** refs/heads/main
**Spec hash:** 92c3967ce3a09fe5ba0315acc2e1189b7788b6f02836b4b798cc345aebcdb73b
**Prepared by:** cursor
**Builder model:** Cursor Grok 4.6
**Requested reviewer:** cursor
**Requested model:** Cursor Grok 4.6
**Requested execution:** automatic
**Requested at:** 2026-10-18T11:35:00+02:00
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** cursor
**Reviewer model:** Cursor Grok 4.6
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-18T11:41:07+02:00
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `pnpm check-types`: pass
- `pnpm lint`: pass
- `pnpm compile`: pass (`dist/mcp.js` and `dist/extension.js` present)
- `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`: pass (155 pass, 0 fail, 0 skipped)
- Verify: unavailable
- `/check`: not-required (not run)
- security scanner: unavailable
- performance scanner: unavailable
- browser harness: unavailable

## Evidence

- Adapter/model match requested (`cursor` / `Cursor Grok 4.6`); reviewer context `fresh subagent`; actual execution `automatic`.
- `HEAD` = Target `7ae3101652f8f194a9b2664422fb009daa437193`; `git merge-base HEAD refs/heads/main` = Base `571cc69d75328b51de34d6991bd9d0e97ef3e747`; SHA-256 of raw `blueprint/context/current-feature.md` = Spec hash `92c3967ce3a09fe5ba0315acc2e1189b7788b6f02836b4b798cc345aebcdb73b`.
- Working tree vs Target differed only by `blueprint/context/review.md` and `blueprint/context/findings.md`.
- Reviewed `571cc69d..7ae31016` plus those evidence files: disk canvas view (`src/disk/artboardFs.ts`, `src/disk/canvasView.test.ts`), host snapshot (`src/host/artboardDisk.ts`, `src/host/canvasSnapshot.ts`, `src/host/handleOpenArtboard.ts`, `src/host/watchArtboardDisk.ts`), panel chrome/runtime/geometry (`src/panel/openArtboardPanel.ts`, `src/panel/artboardChromeHtml.ts`, `src/panel/artboardChromeScript.ts`, `src/panel/artboardCanvasRuntime.ts`, `src/panel/stageGeometry.ts`) and matching tests, plus `.cursor/rules/02-mcp-webview.mdc` item 5.
- Spec contracts checked in code: `canvas:updated` replaces `artboard:updated`; per-frame blob iframes with `sandbox="allow-scripts"` and `scrolling="no"`; `cd:frame-height` / `cd:frame-wheel` allowlisted by `contentWindow` before the null-origin drop; labels/headings/tiles use `textContent` / `setAttribute` only (no parent `innerHTML`); per-frame 1.5M cap does not set the global banner; untrusted posts `frames: []`; DiskError tiles log to Output without putting `error.message` in the tile; handoff-stale I/O cannot empty the stage; disk/export HTML writers not in the delta.
- Builder F5 notes in the spec were not used as this review's evidence.

## Findings

- None added this pass
- F-07 [P3] open - pre-existing docs path; not in this delta
- F-09 [P3] open - pre-existing Blueprint manifest; not in this delta
- F-08, F-10, F-11, F-12, F-13, F-14, F-15 remain closed (re-read repaired code; original defects still gone; no new defect from those repairs)

## Remaining risk

- No Verify command is declared in AGENTS.md
- `/check` was not required and was not run
- No security scanner is declared or was run
- No performance scanner is declared or was run
- No browser harness is declared; iframe height, vh freeze, nested-scroll-then-pan, tile pointer pass-through, per-frame reload, and CSP were not executed in a live webview in this session
- Accepted spec ceilings were not treated as defects: no total payload cap across frames, labels scale with zoom, late frame messages, `deltaMode` ignored
