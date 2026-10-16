# Feature: Stage

**From build-plan:** feature 6c
**Build attempt:** 1
**Branch:** `feature/stage`
**Status:** verified

## Goal

Turn the panel into the 0.2 stage. A clipped stage viewport holds a stage layer moved by CSSOM `translate(x, y) scale(zoom)` (origin `0 0`). Gestures:

- Pinch / ctrl+wheel / Cmd+wheel zooms around the cursor, over the empty stage and over the frame. Chromium reports a trackpad pinch as a ctrl/meta `wheel` event; there is no `GestureEvent` or touch-pinch handling.
- Plain wheel and dragging the empty stage pan.

A toolbar shows the current zoom and offers presets and Fit all. The view survives the panel being hidden and shown again.

Until 6d renders every frame, the stage holds one frame: the active artboard's live iframe at a provisional fixed 1280×800. Zoom and pan never reflow it. The transform moves from the iframe (6a) to the stage layer, as the plans say. Disk, MCP, and export stay untouched.

## In scope

- `src/panel/stageGeometry.ts` (6b module, not yet inlined anywhere):
  - Change `MIN_STAGE_ZOOM` to `0.05` and `MAX_STAGE_ZOOM` to `10` (5–1000%, Bombic 2026-10-13).
  - Add `zoomStageTo({ view, zoom, screenX, screenY })`. It clamps the target zoom to `[MIN, MAX]`, clamps `view.zoom` as the from-zoom, and keeps the stage point under `(screenX, screenY)` fixed, with the same formula as `zoomStageAt`.
  - `zoomStageAt` computes its target zoom and returns `zoomStageTo(...)`, so there is one anchor formula. Its exported signature `({ view, deltaY, screenX, screenY })` is unchanged.
  - Fit stays capped at 100%. The step cap (0.2 in log space) and sensitivity (0.01) are unchanged: a trackpad pinch moves in fine steps, and one mouse notch (`deltaY` about 100) scales the current zoom by about ×1.22 or ×0.82.
  - Source rules are unchanged: no backtick, no `${`, no `</`.
- `src/panel/artboardCanvasRuntime.ts`: the ctrl/meta message gains the cursor, `{ type: canvas:wheel, deltaY, clientX: event.clientX, clientY: event.clientY }`, in iframe viewport CSS px. The type name is unchanged in 6c; 6d renames it to `cd:frame-wheel`. All other runtime rules hold: no `<`, captured `window.parent`, no style writes, same injection position.
- `src/panel/artboardChromeHtml.ts` (chrome stays the template-string document; new chrome JS uses string concatenation, rule 04 names, arrow functions):
  - Keep every 6a behavior not listed below, unchanged:
    - `acquireVsCodeApi()` once, and posting `artboard:ready` at startup.
    - `applyArtboardHtml`: the blob build, `stampArtboardHtml`, `injectCanvasRuntime`, blob revoke, and `pagehide`.
    - The `artboard:updated`, `artboard:error`, and `ui:status` handlers, the badges, the error banner, and the MCP banner.
    - The source-first message listener, and the `event.origin === 'null'` drop.
  - Only the well → viewport swap, the transform move, and the additions below change.
  - Markup:
    - Replace `#artboard-well` with `<div id="stage-viewport" hidden>`. It takes the well's place in the body flex column and is the flex item that fills the panel; the iframe is not.
      - Its CSS rule copies the 6a well rule exactly (`flex: 1 1 auto; position: relative; overflow: hidden; background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background))`) and adds `min-height: 0; touch-action: none; cursor: grab`.
      - It has no `display` property, so `hidden` keeps working.
    - There is no letterbox concept any more. The empty stage around the frame is just the viewport background.
    - Inside it, `<div id="stage-layer">` (`position: absolute; left: 0; top: 0; transform-origin: 0 0`).
    - Inside the layer, the existing `<iframe id="artboard-frame" sandbox="allow-scripts">` at `position: absolute; left: 0; top: 0; width: 1280px; height: 800px; border: 0`.
    - The iframe no longer gets any transform.
  - Toolbar: three controls appended, in this order, as the last children of the existing `header.chrome-bar`:
    - `<span id="zoom-readout" class="badge">100%</span>`.
    - `<select id="zoom-preset" aria-label="Zoom preset" disabled>`.
      - The first option is a selected, disabled placeholder `value=""` with text "Zoom".
      - Then the presets, in order (Bombic 2026-10-13): text `50%, 75%, 90%, 100%, 110%, 125%, 150%, 175%, 200%`, values `0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2`.
    - `<button id="zoom-fit" type="button" disabled>Fit all</button>`.
    - Styles use only `var(--vscode-dropdown-background)`, `var(--vscode-dropdown-foreground)`, `var(--vscode-dropdown-border)`, `var(--vscode-button-secondaryBackground)`, `var(--vscode-button-secondaryForeground)`, and `var(--vscode-focusBorder)` for the focus outline.
  - Inline `${STAGE_GEOMETRY_SOURCE}` at the top of the chrome `<script>`. Chrome calls the 6b globals it declares (`zoomStageAt`, `zoomStageTo`, `panStage`, `clampStageView`, `fitStageView`, `frameBounds`) directly. The source stays plain JS with no `import`, `export`, or types.
  - View state:
    - `let stageView`, plus `PROVISIONAL_FRAME_WIDTH = 1280` and `PROVISIONAL_FRAME_HEIGHT = 800`, with a `ponytail:` comment: 6d replaces them with the canvas.json width and the reported height.
    - `stageBounds()` returns `frameBounds({ frames: [{ x: 0, y: 0, width: PROVISIONAL_FRAME_WIDTH, height: PROVISIONAL_FRAME_HEIGHT }] })` while the viewport is shown, and `null` when it is hidden.
    - `commitStageView(nextView)`, in order:
      1. `bounds = stageBounds()`, `viewportWidth = stageViewport.clientWidth`, `viewportHeight = stageViewport.clientHeight`.
      2. If `bounds === null`, `viewportWidth === 0`, or `viewportHeight === 0`, return without changing anything (no throw).
      3. `stageView = clampStageView({ view: nextView, bounds, viewportWidth, viewportHeight })`. This reassigns the module-level `let`.
      4. From that same `stageView`:
         - `stageLayer.style.transform = 'translate(' + stageView.x + 'px, ' + stageView.y + 'px) scale(' + stageView.zoom + ')'`;
         - the readout text is `Math.round(stageView.zoom * 100) + '%'`;
         - `vscodeApi.setState({ stageView })`.
    - Every gesture, the presets, Fit all, the resize re-clamp, and the initial view go through `commitStageView`. Each always passes a view built from the current `stageView`.
  - Initial view (one algorithm):
    - At startup, `vscodeApi.getState()` is accepted only when it is a non-null object whose `stageView` has finite `x`, `y`, and `zoom` with `zoom > 0`. Then `stageView` is that value and `hasSavedView = true`. Otherwise `stageView = { x: 0, y: 0, zoom: 1 }` and `hasSavedView = false`. `initialViewApplied = false`.
    - `applyInitialView()`:
      - Return when `initialViewApplied` is true, or when the bounds or the viewport size are unusable (as in `commitStageView` step 2).
      - Otherwise run `commitStageView(hasSavedView ? stageView : fitStageView({ bounds: stageBounds(), viewportWidth: stageViewport.clientWidth, viewportHeight: stageViewport.clientHeight }))`, then set `initialViewApplied = true`.
    - It is called right after a non-empty `artboard:updated` un-hides `#stage-viewport`, and from the `ResizeObserver` callback, which covers a panel that was not laid out yet.
    - After it has run once, nothing auto-fits again: artboard edits and active-artboard switches keep the view.
    - The view is panel-global. It survives the panel being hidden and shown, because the webview reloads and `getState` restores it.
  - Screen point: `screenX = event.clientX - viewportRect.left` and `screenY = event.clientY - viewportRect.top`, with `viewportRect = stageViewport.getBoundingClientRect()`.
  - Gestures:
    - **Wheel on `#stage-viewport`** (`{ passive: false }`, always `preventDefault()`):
      - ctrl/meta: `commitStageView(zoomStageAt({ view: stageView, deltaY: event.deltaY, screenX, screenY }))`.
      - Otherwise: `commitStageView(panStage({ view: stageView, deltaX: event.deltaX, deltaY: event.deltaY }))`, with no extra negation. 6b's `panStage` subtracts the delta, so a wheel down moves the stage up.
      - Wheel events inside the iframe never reach this listener.
    - **Forwarded zoom from the frame.** `handleCanvasMessage` (still source-first, before the `event.origin === 'null'` drop) accepts `canvas:wheel` only with finite `deltaY`, `clientX`, and `clientY`. The anchor is the frame's screen origin plus the scaled cursor: `screenX = stageView.x + data.clientX * stageView.zoom` (same for y; the frame sits at stage `(0, 0)`), then `zoomStageAt`. Anything else from the iframe is ignored with no log, and the 6a `ponytail:` comment stays.
    - **Drag the empty stage.**
      - `pointerdown` on `#stage-viewport` starts a drag only for the primary button (`event.button === 0`) and a target of `stageViewport` or `stageLayer`. Events inside the iframe stay in the frame.
        - It calls `stageViewport.setPointerCapture(event.pointerId)`, stores `lastPointerX = event.clientX` and `lastPointerY = event.clientY`, and sets `stageViewport.style.cursor = 'grabbing'`.
      - `pointermove` while dragging: `commitStageView(panStage({ view: stageView, deltaX: lastPointerX - event.clientX, deltaY: lastPointerY - event.clientY }))`, then update `lastPointerX/Y`. Moving the pointer right moves the stage right.
      - `pointerup`, `pointercancel`, and `lostpointercapture` end the drag and clear the inline cursor (back to the CSS `grab`).
    - **Preset select.** On `change` with a non-empty value:
      - `commitStageView(zoomStageTo({ view: stageView, zoom: Number(select.value), screenX: stageViewport.clientWidth / 2, screenY: stageViewport.clientHeight / 2 }))`, which zooms around the stage viewport's center.
      - Then reset the select to the placeholder.
    - **Fit all.** On `click`: `commitStageView(fitStageView({ bounds: stageBounds(), viewportWidth: stageViewport.clientWidth, viewportHeight: stageViewport.clientHeight }))`.
  - `ResizeObserver` on `#stage-viewport`: when both dimensions are non-zero, call `applyInitialView()`, then `commitStageView(stageView)` to re-clamp. A zero size (hidden for empty) is skipped.
  - Empty and error states:
    - Wherever 6a toggled `artboardWell.hidden`, toggle `stageViewport.hidden`.
    - `#zoom-preset` and `#zoom-fit` start `disabled` in the markup. They are enabled on a non-empty `artboard:updated` and disabled again on an empty one.
    - Error behavior is unchanged: the frame keeps its last content and gestures keep working.
  - Remove `applyZoomDelta`, `applyCanvasView`, `canvasView`, and the iframe transform writes. The `Math.exp` call lives only in the inlined geometry.
- `.cursor/rules/02-mcp-webview.mdc` Webview CSP item 5 becomes exactly: `5. Messages: artboard:ready (chrome → host), artboard:updated|error, ui:status (host → chrome). iframe → chrome: canvas:wheel { deltaY, clientX, clientY } (allowlisted by source; stage zoom at the cursor; renamed cd:frame-wheel in 6d). Chrome → iframe: none.`
- Tests (existing `node:test` setup):
  - `src/panel/stageGeometry.test.ts`:
    - Update the clamp constants and cases to `0.05` and `10`.
    - Add `zoomStageTo` cases with numeric expected `x`, `y`, `zoom`:
      - The anchor is fixed: from `{ x: 100, y: 50, zoom: 1 }`, target `2` at screen `(300, 200)` gives exactly `{ x: -100, y: -100, zoom: 2 }`.
      - The target is clamped at both ends (`0.01` → `0.05`, `50` → `10`).
      - A from-zoom of 0 gives a finite view.
    - Keep the existing fit-cap and keep-visible cases.
  - `src/panel/artboardChromeHtml.test.ts`:
    - Replace the 6a well, iframe-transform, and letterbox-wheel tests with the stage facts below. No letterbox assert remains.
    - `<div id="stage-viewport" hidden>` precedes `<div id="stage-layer">`, which precedes `<iframe id="artboard-frame" sandbox="allow-scripts"`.
    - Chrome HTML contains the `STAGE_GEOMETRY_SOURCE` string value verbatim (the interpolation inlines it byte for byte), `stageView = clampStageView(`, `stageLayer.style.transform`, `initialViewApplied`, `lastPointerX - event.clientX`, `stageViewport.clientWidth / 2`, `vscodeApi.setState`, `vscodeApi.getState`, `Number.isFinite(data.clientX)`, `Number.isFinite(data.clientY)`, `setPointerCapture`, `ResizeObserver`, and `fitStageView`.
    - It contains the nine preset option values in order, `aria-label="Zoom preset" disabled`, `id="zoom-readout"`, and `<button id="zoom-fit" type="button" disabled>`.
    - It contains no `iframe.style.transform` and no `applyZoomDelta`.
    - `<script nonce="` and `</script>` appear once each, and `Math.exp(` once.
    - The source-check is still ordered before the origin-check.
  - Runtime test: `clientX` and `clientY` are now required, and `clientX` leaves the forbidden list. The other forbidden strings stay.

## Out of scope

- Multiple frames, canvas.json widths and positions, `cd:frame-height`, full-height frames, labels, group headings, error tiles, the `cd:frame-wheel` rename, and the nested-scroll walk (6d). Plain wheel over the frame keeps scrolling inside it, as in 6a.
- Canvas export (6e).
- Keyboard shortcuts for zoom (the select and button are keyboard reachable), space-drag pan, inertia, and dragging or resizing frames.
- Persisting the view across a full window reload (no webview serializer), and any host-side state.
- `src/panel/openArtboardPanel.ts`, `src/host/**`, `src/disk/**`, `src/mcp/**`, host ↔ chrome messages, chrome CSP string, iframe `sandbox`, `package.json`.
- Svelte (deferred).

## Build loop

`workflow.stepReview: "feature"`: implement all steps, then one review packet. `checkpointCommits: "disabled"`. `/complete` makes the feature commit on `feature/stage`. Per Bombic, stop at Step 4 for an F5 check before `/complete`.

## Build steps

- [x] **Step 1 - Geometry range + `zoomStageTo`** - Update the constants, add `zoomStageTo`, route `zoomStageAt` through it, and update the geometry tests. *Done when:* `pnpm check-types`, `pnpm lint`, and `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js` pass, including the new cases. The tests fail if the range, the anchor, or the target clamp is broken.
- [x] **Step 2 - Stage layer, gestures, saved view** - If the chrome no longer matches the 6a facts in Notes, stop and report. Build:
  - the markup and styles;
  - the geometry inline, `stageView`, and `commitStageView`;
  - the saved view (with first-load fit);
  - the viewport wheel;
  - the forwarded `canvas:wheel` with the cursor, including the runtime change;
  - the empty-stage drag;
  - the resize re-clamp and the empty-state swap;
  - the chrome and runtime test updates, and the rule 02 line.
  *Done when:* the same three commands pass, and the chrome tests fail if the stage transform target, geometry inline, clamp reassignment, initial-view guard, saved view, finite cursor checks, drag direction, or listener order is removed.
- [x] **Step 3 - Toolbar** - Add the readout, preset select, Fit all button, their disabled state while empty, and their tests. *Done when:* the same three commands pass, and the chrome tests fail if the readout, any of the nine preset values, `zoom-fit`, the markup `disabled`, or the viewport-center anchor is missing.
- [x] **Step 4 - F5 check** - `pnpm compile`, then F5 on `fixtures/dev-workspace` with a tall active artboard (for example `canvas-6b`). *Done when:*
  - First open with no saved view fits the 1280×800 frame in the panel, at 100% or less.
  - Pinch, ctrl+wheel, and Cmd+wheel zoom around the cursor, over the empty stage and over the frame. Trackpad pinch is fine-grained, and a mouse notch moves about 20%. Zoom stops at 5% and 1000%.
  - Plain wheel over the empty stage pans. Plain wheel over the frame scrolls inside it.
  - Dragging the empty stage pans, and the frame can never be panned fully out of view.
  - Each preset zooms around the stage viewport's center, Fit all re-fits, and the readout tracks every change.
  - Before the first artboard arrives, and while it is empty, the preset select and Fit all are disabled.
  - The frame stays 1280px wide at every zoom and panel size (a fixed header stays at the frame's top), and clicks inside it still land.
  - Switching to another editor tab and back keeps zoom and position. Editing the artboard file and switching the active artboard keep them too.
  - The empty state disables the preset select and Fit all.
  - After **Export Handoff**, `rg data-cd- .cursor-design/` finds nothing.

## Files / areas

- `src/panel/stageGeometry.ts`, `src/panel/stageGeometry.test.ts`
- `src/panel/artboardCanvasRuntime.ts`
- `src/panel/artboardChromeHtml.ts`, `src/panel/artboardChromeHtml.test.ts`
- `.cursor/rules/02-mcp-webview.mdc` (Webview CSP item 5)

## Data / contracts

- Stage view `{ x, y, zoom }`: chrome-only. `screen = stage * zoom + (x, y)`. Zoom is in `[0.05, 10]`. Fit-all is at most 1. The keep-visible clamp is 48px (6b).
- Webview state: `vscodeApi.setState({ stageView: { x, y, zoom } })` is the only key. On read, a malformed state is ignored, never thrown.
- Iframe → chrome: `{ type: 'canvas:wheel', deltaY, clientX, clientY }`, all finite, accepted only from `iframe.contentWindow`. Chrome → iframe: nothing.
- Presets: `0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2` (Bombic confirmed 150, not 250), applied around the stage viewport center (`clientWidth / 2`, `clientHeight / 2`).
- Provisional frame: the stage rect `(0, 0, 1280, 800)`. It is chrome constants only and never stored.
- Disk, MCP, export, and host ↔ chrome messages: unchanged.

## Testing

No Verify command is declared. Runner: `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`. The gate is these commands passing, not a test count. If `pnpm` aborts on the no-TTY prompt, use `./node_modules/.bin/tsc -p . --outDir out && node --test …`. The geometry is unit-tested through `node:vm` on the shipped source string. The chrome and runtime are string-level tests (Node has no DOM, wheel, or pointer events). These are proven only by Step 4 F5: CSSOM, hit-testing, pointer capture, `getState` restore, `ResizeObserver`, and gesture feel. No browser tests.

## Notes for the AI

- Repository facts at spec time (`src/panel/artboardChromeHtml.ts`, unchanged since 6a):
  - The chrome is one TS template literal with a single `<script nonce>`.
  - `#artboard-well` (hidden when empty) wraps `#artboard-frame`. `applyCanvasView` writes the iframe transform, and `applyZoomDelta` holds the only `Math.exp`.
  - The well `wheel` listener zooms on ctrl/meta only.
  - The message listener checks source first, then the `'null'` origin drop.
  - `iframe` is captured once and never recreated. `applyArtboardHtml` swaps the blob `src`.
  - `vscodeApi = acquireVsCodeApi()` exists, and `getState`/`setState` are unused.
  - `stageGeometry.ts` came from 6b, is tested, and is not inlined.
- The superseded old-6b stash ("old-6b gestures-zoom-math") has a similar well-clamp geometry. Do not unstash it; the stage geometry from 6b replaces it. Its nested-scroll walk is for 6d.
- Zoom over the frame works because the frame sits at stage `(0, 0)` in 6c. 6d generalizes the anchor to each frame's stage position.
- The fixed 1280px width means a mobile artboard renders at desktop width until 6d reads canvas.json widths. Accepted for this phase.
- `setState` on every commit is cheap (in-process). There is no throttle; wheel events are already coalesced by the browser.
- Accessibility: the preset select has an `aria-label`, and Fit all is a real button. Both are keyboard reachable. The readout is plain text, not `aria-live`, because zoom changes at gesture rate.
- Security: the iframe input is still the one validated message type. Saved state comes from our own webview and is still validated. No new host messages.
- No em dashes in docs or comments.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":19857,"specSha256":"8044648853afbe3656c2138500192c82b8af2e5121c98726b8392d6f14571a6c","branch":"refs/heads/feature/stage","head":"a86f091fda31cb84f7c677598b22346414cd5589","baseRef":"refs/heads/main","baseCommit":"a86f091fda31cb84f7c677598b22346414cd5589","sourceTree":"b7ba6623d32b58b48433b1c28d19802f48d3bd54","absentOptional":[]} -->
