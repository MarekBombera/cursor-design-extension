# Feature: Svelte port

**From build-plan:** feature 8b
**Build attempt:** 1
**Branch:** feature/svelte-port
**Status:** verified (automated gates + F5 parity checklist, 2026-10-22).

## Goal

Notion 0.3 done-when #1: "Panel runs on Svelte with no behaviour change; svelte-check passes in the check pipeline."
Replace the template-string chrome (`artboardChromeScript.ts` plus the inline CSS and markup in
`artboardChromeHtml.ts`) with Svelte 5 components behind one host bridge. Stage geometry and the
frame runtime become real TS modules with a single source each, shared by the panel chrome and the
exported `canvas.html`. Every 0.2 behavior passes the F5 parity checklist. Disk, MCP tools, the
message contract and the CSP stay unchanged.

Sources: build-plan item 8b, `blueprint/reference/0.3-comments-plan.md` section "8b" (plus the 8a.5
step the 8a spec moved here), Notion 0.3 page, rules 02, 04, 05, 07, 08, 09.

## In scope

- `?iife` build plugin: imports ending in `?iife` resolve to the module bundled as an IIFE string.
  Registered for the webview build, `vp pack` (both entries) and `vp test`.
- Frame runtime moved to `src/webview/frame/runtime.ts` (same behavior); message type names and
  frame payload guards in `src/webview/frame/frameMessages.ts`.
- Stage geometry moved to `src/webview/stageGeometry.ts` as normal exported TS; tests import it
  directly (no `node:vm`), every existing test and property kept.
- Export `canvas.html` (`src/disk/handoffCanvasHtml.ts`) consumes the same runtime and geometry
  through `?iife` instead of the deleted source strings.
- Pure chrome modules with tests: `hostMessages.ts` (host → chrome types + parsers, saved-view
  parser), `stampArtboardHtml.ts` (DOMParser stamp, happy-dom test).
- Svelte components: `App` (container), `Toolbar`, `Banners`, `Stage`, `Frame`, plus
  `hostBridge.svelte.ts`.
- Host shell `artboardChromeHtml.ts` reduced to CSP + one stylesheet link + one module script + one
  mount element. Shell test rewritten.
- Delete `artboardChromeScript.ts`, `artboardCanvasRuntime.ts`, `STAGE_GEOMETRY_SOURCE`,
  `ARTBOARD_CANVAS_RUNTIME_SOURCE`, `embedScriptSource`.
- Type gate for webview tests (`tsconfig.webview-tests.json`) added to Verify.
- Same change: rules 04, 05, 08; AGENTS.md and README Verify line; `cursor-design-build` skill;
  `blueprint/project-plan.md` "Chrome:" line.

## Out of scope

- Any new behavior: frame drag/resize (8c), chrome → frame messages and picking (8d1), selectors
  and `@medv/finder` (8d2), comments (8e+). No new message `type` on any channel.
- Changing the CSP, `localResourceRoots`, disk layout, MCP tools, `canvas:updated` payload, or the
  host side of the panel beyond importing message types.
- Restyling. Same tokens, same layout, same copy.
- Splitting the runtime into a measuring part and a picking part (8d1 decides).
- Fixing behavior that looks odd but ships today (late `cd:*` from a previous document is accepted;
  rejects are not logged). Port it as is.

## Build loop

`workflow.stepReview` is `feature`: build all steps, then one review at the end.
`workflow.checkpointCommits` is `disabled`: no per-step commits; `/complete` makes the feature commit.

Per step: implement, run the step's check, keep `vp test` green. Every `.svelte` / `.svelte.ts`
edit follows rule 08: Svelte MCP `list-sections` + `get-documentation` for the matching sections
(runes, `$props`, `$effect`, `{#each}` keys, `style:` directive, `bind:`), write from the docs,
then `svelte-autofixer` on the full file until it reports no issues. In Claude Code, delegate
Svelte file edits to the `svelte-file-editor` agent. Never call `playground-link`.
Run `pnpm verify` at the end of each step and once more at the end.

## Build steps

- [x] **1. `?iife` plugin, frame runtime module, webview test gate.**
  - Add `scripts/iifeStringPlugin.ts`: for an import id ending in `?iife`, bundle that file with the
    bundler API Vite+ exposes (Vite `build` from `vite-plus` with `write: false`, `configFile: false`;
    or Rolldown if Vite+ re-exports it) to `format: 'iife'`, `minify: false`, no sourcemap, and
    return `export default <JSON string>`. The IIFE global name is the file stem (`stageGeometry`);
    a module with no exports emits a bare IIFE. Replace every `</` in the code with `<\/` before
    returning. Call `this.addWatchFile` for every module in the nested bundle so `pnpm watch`
    rebuilds when `runtime.ts` or `stageGeometry.ts` changes; guard the call
    (`typeof this.addWatchFile === 'function'`) so a host without it still builds.
  - Register it in `vite.webview.config.ts` `plugins`, `vite.config.ts` top-level `plugins` (used by
    `vp test`) and the `shared` pack options (both `extension` and `mcp` entries).
  - Add `src/types/iife.d.ts`: `declare module '*?iife' { const source: string; export default source; }`.
    Add it to `tsconfig.webview.json` `include`. The root tsconfig already includes `src`.
  - Move `ARTBOARD_CANVAS_RUNTIME_SOURCE` into `src/webview/frame/runtime.ts` as real TS with the
    same statements, timings (100ms debounce, 20000 clamp), `window.parent` captured first, capture
    + non-passive wheel listener. Move `FRAME_HEIGHT_MESSAGE`, `FRAME_WHEEL_MESSAGE`,
    `CANVAS_RUNTIME_ATTRIBUTE` to `src/webview/frame/frameMessages.ts`; `runtime.ts` imports them.
    Delete `src/panel/artboardCanvasRuntime.ts`.
  - Re-point consumers: `artboardChromeHtml.ts` (still the template chrome in this step) and
    `src/disk/handoffCanvasHtml.ts` import `../webview/frame/runtime.ts?iife` and the constants from
    `frameMessages.ts`.
  - Add `tsconfig.webview-tests.json` (extends `tsconfig.webview.json`, `types: ["node"]`,
    `include: ["src/webview/**/*.test.ts", "src/types/iife.d.ts"]`, `exclude: []`) and append
    `tsc -p tsconfig.webview-tests.json` to `verify` right after `svelte-check`. Prove it gates: a
    deliberate type error in a webview test fails it (then revert).
  - Tests: `src/webview/frame/runtime.test.ts` imports `./runtime.ts?iife` and ports the assertions
    of the old "canvas runtime posts only frame height and wheel" test, plus: no `</` anywhere, both
    message type literals present. `handoffCanvasHtml.test.ts` builds its expected block from the
    `?iife` string; update the `canvas.html` snapshot once, on purpose, and check the diff touches
    only the embedded runtime text.
  - Done when: `pnpm verify` green; `vp pack` output `dist/mcp.js` and `dist/extension.js` contain
    the runtime IIFE; F5 shows frames growing to content height and wheel forwarding as before
    (template chrome still active).

- [x] **2. Stage geometry as real TS.**
  - Move `src/panel/stageGeometry.ts` to `src/webview/stageGeometry.ts`: same constants and
    functions, exported, typed (`StageView`, `StageRect`, frame and box types next to the owner).
    Keep the "screen = stage * zoom + (x, y)" comment; drop the "no backtick / dollar-brace" rules.
  - Move `stageGeometry.test.ts` beside it; import functions directly, drop `runInNewContext` and the
    cross-realm `assertClose` workaround where `deepStrictEqual` now works. Keep every test and
    fast-check property (same count).
  - Interim consumers via `stageGeometry.ts?iife` (global `stageGeometry`):
    - Template chrome: in `artboardChromeHtml.ts`, replace the `${STAGE_GEOMETRY_SOURCE}`
      interpolation inside the **existing** nonce'd inline `<script>` with the `?iife` string,
      followed in that same script by one line
      `const { layoutCanvasChrome, clampStageView, fitStageView, zoomStageAt, zoomStageTo, panStage, nextFrameHeight } = stageGeometry;`
      (exactly the functions the chrome script calls). No new `<script>` tag.
    - Export: the controller in `handoffCanvasHtml.ts` inlines the IIFE at the same spot
      `STAGE_GEOMETRY_SOURCE` sat and calls `stageGeometry.nextFrameHeight`.
    - Update the "Mirrors layoutCanvasChrome" comment path. Update the `canvas.html` snapshot on
      purpose.
  - Test (in `handoffCanvasHtml.test.ts`): evaluating the `stageGeometry.ts?iife` string with
    `node:vm` `runInNewContext` defines `stageGeometry` whose `nextFrameHeight` is a function and
    returns the same result as the direct import for one sample input (the snapshot alone would
    hide a `TypeError`).
  - Done when: `pnpm verify` green with the same geometry test count; F5 zoom, pan, presets and Fit
    all behave as before.

- [x] **3. Pure chrome modules.**
  - `src/webview/hostMessages.ts`: the host → chrome message types (`CanvasUpdatedMessage`,
    `PostedCanvasFrame`, `ArtboardErrorMessage`, `UiStatusMessage`) defined once here.
    `openArtboardPanel.ts` and `src/host/canvasSnapshot.ts` `import type` them and drop their own
    definitions (names kept, so host call sites do not change). Parsers moved verbatim from
    `isValidCanvasUpdated` / `isValidPostedFrame` / the `ui:status` and `artboard:error` branches,
    plus `parseSavedStageView` (from `isUsableStageView`: object with finite `x`, `y`, finite
    `zoom > 0`, else `undefined`). Invalid input returns `undefined`; never throws.
  - `src/webview/frame/frameMessages.ts`: guards for `cd:frame-height` (finite `height`) and
    `cd:frame-wheel` (finite `deltaX`, `deltaY`, `x`, `y`, boolean `ctrlKey`), moved verbatim from
    `handleFrameMessage`.
  - `src/webview/stampArtboardHtml.ts`: `stampArtboardHtml({ html, nonce, runtimeSource }): string`,
    same steps as today: parse with `DOMParser`; remove every `meta[http-equiv]`; set `nonce` on
    every `script` and `style`; remove existing `script[data-cd-canvas-runtime]`; insert one
    nonce'd runtime script with that attribute right after `meta[charset]`, else first in `head`;
    return `'<!DOCTYPE html>' + documentElement.outerHTML`. It never imports `?iife`.
  - Add `happy-dom` (dev), first used here.
  - Tests (colocated, Vitest): `hostMessages.test.ts` (valid message, each field wrong, frames not an
    array, non-object, frame with bad `group`/`errorMessage`, saved view edge cases: `null`, zoom 0,
    `NaN`, missing field); `frameMessages.test.ts` (each guard field, plus the rule 02 message-line
    pin moved from `artboardChromeHtml.test.ts`, built from the constants);
    `stampArtboardHtml.test.ts` with `// @vitest-environment happy-dom` (http-equiv stripped,
    every script/style nonced, runtime once directly after `meta[charset]`, prepended without one,
    a pre-existing runtime script replaced, re-parsing the output yields exactly one runtime script
    whose text equals `runtimeSource` for the real `?iife` string).
  - Done when: `pnpm verify` green, including `tsc -p tsconfig.webview-tests.json`; F5 unchanged.

- [x] **4. Svelte chrome swap.**
  - `src/webview/hostBridge.svelte.ts`: `acquireVsCodeApi()` once (local `declare const`), one
    `window` `message` listener, `getState`/`setState` for `{ stageView }` (same shape as today),
    `postMessage({ type: 'artboard:ready' })` once after the listener is attached. Routing order:
    (1) `event.source` equals a live frame iframe's `contentWindow` → frame guard → frame handler;
    (2) `event.origin === 'null'` → drop; (3) non-object → drop; (4) host parsers; unknown `type`
    ignored. Components never call `postMessage` or add `message` listeners.
  - `App.svelte` (container) owns: frames (in first-seen order), per-frame `lastHtml`, kind
    (`tile` | `iframe`), height and height guard, active id, generation, badges, banners, stage
    view, initial-view flag. App applies `canvas:updated` (parity 4–7): it decides tile vs iframe,
    and when a frame needs a new document (turns from tile to iframe, or `html` differs from
    `lastHtml`) it resets that frame's guard to `{ lastGrowth: 0, frozen: false }` and keeps its
    height in the same update. Frame's blob `$effect` keys on the same inputs (`html`, nonce,
    kind), so App and Frame agree on when a document is new.
  - Global CSS (`html`, `body`, `#svelte-root` as a full-height flex column, VS Code font tokens)
    lives in App's `<style>` via `:global(...)`, the one global place.
  - `Toolbar.svelte`, `Banners.svelte`, `Stage.svelte`, `Frame.svelte`: props in, callbacks out.
    Frame callbacks: `onIframe(id, element | undefined)` (registry, see below) and
    `onRenderError(id)` (stamp or Blob threw; App switches that frame to the
    `Could not render this frame.` tile, 160px).
  - Iframe registry: App keeps a plain non-reactive `Map<string, HTMLIFrameElement>`. Frame calls
    `onIframe(id, element)` when the iframe element is mounted (before its `src` is set, so the
    first `cd:frame-height` is never dropped) and `onIframe(id, undefined)` when it is destroyed
    or replaced by a tile. The bridge matches `event.source` against each registered element's
    `contentWindow` at message time.
  - `Stage.svelte` effects (wheel, empty-stage drag, `ResizeObserver`): each subscribes once in its
    own `$effect`, reads the current view at event time through a callback or getter (never a
    value captured at subscribe time), and returns its cleanup. No effect re-subscribes when the
    view changes.
  - `main.ts` keeps `document.querySelector('#svelte-root')` and mounts App there.
  - Shell: `artboardChromeHtml.ts` keeps the exact CSP string, the nonce'd `<link>` to `chrome.css`
    and the nonce'd `<script type="module">` for `chrome.js`, plus exactly
    `<div id="svelte-root"></div>` (no `hidden`) before the script. No inline `<style>`, no inline
    script, no markup beyond that.
  - Delete `src/panel/artboardChromeScript.ts`, `embedScriptSource`, the `STAGE_GEOMETRY_SOURCE`
    export path, and any `?iife` import the host no longer needs (the chrome imports
    `./frame/runtime.ts?iife` itself and passes it to `stampArtboardHtml`).
  - Rewrite `artboardChromeHtml.test.ts` to the shell: complete document; CSP equals
    `default-src 'none'; style-src 'nonce-N' <cspSource>; script-src 'nonce-N' <cspSource>; frame-src blob:`;
    the same nonce on the link and the script and nowhere else; `<div id="svelte-root"></div>`
    present before the script (pins the id `main.ts` queries); exactly one `<script` and it has
    `type="module"` and a `src` from `asWebviewUri(dist/webview/chrome.js)`; no `<style`, no
    `acquireVsCodeApi`, no `http:`/`https:` URL; fresh nonce per document. Behavior string-grep tests
    are removed; their logic is covered by steps 2–3 tests and the F5 checklist.
  - Done when: `pnpm verify` green; webview devtools show zero CSP violations; every item of the
    parity contract below holds in F5.

- [x] **5. Rules, docs, final F5.**
  - Rule 04 "Single source of truth": webview message types = `src/webview/hostMessages.ts`
    (host → chrome, imported by the host) and `src/webview/frame/frameMessages.ts` (frame ↔ chrome).
  - Rule 05: chrome row = `src/webview/` (Svelte components, `hostBridge.svelte.ts`, pure modules
    `stageGeometry.ts`, `hostMessages.ts`, `stampArtboardHtml.ts`, `frame/`); host keeps
    `artboardChromeHtml.ts` (shell). Owner catalog "Panel" line updated; add the `?iife` plugin and
    note that `src/disk/handoffCanvasHtml.ts` consumes `?iife` strings.
  - Rule 08 Toolchain: the `?iife` plugin (where, which bundler API was used, `</` escaping, watch
    files), `tsconfig.webview-tests.json` and its Verify step, `happy-dom` per-file environment.
  - AGENTS.md Commands Verify line and README Verify line match `package.json`.
  - `cursor-design-build` skill: webview build section names the `?iife` plugin.
  - `blueprint/project-plan.md` line "**Chrome:**": Svelte 5 + Vite under `src/webview/` from 0.3
    (8b); shell in `src/panel/artboardChromeHtml.ts`.
  - Grep the repo (`src/` including `src/test/**`, rules, skills, README, AGENTS.md,
    `blueprint/context/coding-standards.md`) for `artboardChromeScript`, `artboardCanvasRuntime`,
    `STAGE_GEOMETRY_SOURCE`, `ARTBOARD_CANVAS_RUNTIME_SOURCE`, `embedScriptSource`; no live
    reference remains outside `blueprint/history/` and `blueprint/reference/`. Separately, fix any
    line that describes the chrome as a "template-string" document (only chrome descriptions, not
    every use of the word).
  - Run the F5 parity checklist (below) in `fixtures/dev-workspace`; export with `export_artboard`
    and open the new `canvas.html` in a browser: frames grow to content height, and wheel over a
    frame scrolls the page through the controller's `window.scrollBy` exactly as today (the shared
    runtime keeps its non-passive `preventDefault`; do not change either side);
    `pnpm compile-electron-tests` builds; `pnpm vsix` and the `.vsix` lists
    `dist/webview/chrome.js` and no `node_modules`.
  - Done when: `pnpm verify` green; checklist items recorded pass/fail with what was observed.

## Files / areas

- New: `scripts/iifeStringPlugin.ts`, `src/types/iife.d.ts`, `tsconfig.webview-tests.json`,
  `src/webview/frame/runtime.ts` (+ test), `src/webview/frame/frameMessages.ts` (+ test),
  `src/webview/stageGeometry.ts` (+ moved test), `src/webview/hostMessages.ts` (+ test),
  `src/webview/stampArtboardHtml.ts` (+ test), `src/webview/hostBridge.svelte.ts`,
  `src/webview/{Toolbar,Banners,Stage,Frame}.svelte`.
- Changed: `src/webview/App.svelte`, `src/webview/main.ts`, `src/panel/artboardChromeHtml.ts` (+ test),
  `src/panel/openArtboardPanel.ts` (types), `src/host/canvasSnapshot.ts` (type),
  `src/disk/handoffCanvasHtml.ts` (+ test, snapshot), `vite.config.ts`, `vite.webview.config.ts`,
  `tsconfig.webview.json`, `package.json` (`happy-dom`, `verify`), `knip.json` (plugin file in
  `entry`/`project`), `.claude/rules/04-code-conventions.md`, `05-single-job.md`,
  `08-svelte-chrome.md`, `AGENTS.md`, `README.md`, `.cursor/skills/cursor-design-build/`,
  `blueprint/project-plan.md`.
- Deleted: `src/panel/artboardChromeScript.ts`, `src/panel/artboardCanvasRuntime.ts`,
  `src/panel/stageGeometry.ts`, `src/panel/stageGeometry.test.ts` (moved).
- Unchanged on purpose: `src/disk/**` except `handoffCanvasHtml.ts`, `src/mcp/**`,
  `src/host/**` except the type import, CSP, `localResourceRoots`, `.vscodeignore`.

## Data / contracts

No wire, disk, or MCP change. The existing contracts are preserved exactly:

- Host → chrome: `canvas:updated { activeArtboardId, generation, cspNonce, frames[] }`,
  `artboard:error { message }`, `ui:status { mcpAvailable, handoffStale }`. Chrome → host:
  `artboard:ready`. Frame → chrome: `cd:frame-height { height }`,
  `cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y }`. Chrome → frame: none. Rule 02 line 5 unchanged.
- Webview state: `{ stageView: { x, y, zoom } }`.
- Exported frame `index.html` files: byte-identical (existing handoff tests). `canvas.html`: the
  embedded runtime and geometry text changes to the bundled IIFE output; markup, styles, entries and
  behavior unchanged.

### Parity contract (what the Svelte chrome must do; ported from `artboardChromeScript.ts`)

1. Toolbar order: id badge, generation badge, handoff badge (`aria-live="polite"`, hidden unless
   stale, copy `Handoff out of date. Re-export.`), zoom readout `round(zoom*100)%` (starts `100%`),
   preset `<select aria-label="Zoom preset">` with a selected disabled `Zoom` placeholder then
   50/75/90/100/110/125/150/175/200%, `Fit all` `<button type="button">`. Preset and Fit all
   disabled while there are no frames. Focus-visible outline `var(--vscode-focusBorder)`.
2. Generation badge is empty when `activeArtboardId` is `''`, else `String(generation)`.
3. Error banner `role="alert"`, MCP banner `role="status"`: both stay mounted and toggle `hidden`
   (live regions must exist before content). `artboard:error` shows `message` when it is a string,
   else `Could not load artboard.`; the next valid `canvas:updated` clears it. `ui:status` is
   ignored unless `mcpAvailable` is boolean; `false` shows
   `MCP unavailable. Artboard still loads from disk.`; the handoff badge updates from the same
   message (`handoffStale === true` shows it).
4. `canvas:updated` failing top-level validation is ignored entirely. A frame entry failing
   validation is skipped, and if it carries a string `id` that frame is removed. After a valid
   `canvas:updated`, every frame id not among that message's valid entries is removed and its blob
   URL revoked (this is how a deleted artboard file leaves the stage). First-seen order applies to
   the surviving frames plus newly seen ids appended at the end.
5. No valid frames: viewport hidden, `No artboard yet.` shown, toolbar controls disabled.
6. Frame tile when `errorMessage` is a string or `html.trim() === ''`. Tile copy: `errorMessage`,
   else `Empty artboard file.`; a stamp or Blob failure shows `Could not render this frame.`
   Tile height 160px. Iframe height starts at 800px until `cd:frame-height`.
7. Iframe: `sandbox="allow-scripts"`, `scrolling="no"`, `title="Frame: <label>"` (label change
   updates the title without reload). A new blob document is created only when the frame turns
   from tile to iframe or its `html` differs from the last posted `html`; label, position, width,
   group or active changes never reload. Each new document revokes the previous blob URL; App
   resets the height guard to `{ lastGrowth: 0, frozen: false }` (height kept) in the same
   `canvas:updated` application. `lastHtml` is updated for tiles too. Removing a frame revokes
   its blob URL.
8. **Frames render in first-seen order** in a keyed `{#each}` and are never reordered or
   re-inserted (moving an iframe in the DOM reloads it). Labels and headings render in their own
   blocks and may reorder.
9. Wrapper: absolute at `x`, `y`, `width`, height = tile ? 160 : measured height,
   `data-cd-frame-id`, `pointer-events: none` with the iframe `pointer-events: auto`, active frame
   outlined `2px solid var(--vscode-focusBorder)`.
10. Labels and group headings from `layoutCanvasChrome`; text bindings only (`{@html}` is banned),
    `data-cd-frame-label` / `data-cd-group-heading`, ellipsis overflow.
11. One view write path: clamp with `clampStageView` against `layoutCanvasChrome(...).bounds` and the
    viewport size, skip when bounds are null or the viewport is 0×0, set the layer transform
    `translate(xpx, ypx) scale(zoom)` (origin `0 0`), update the readout, `setState`.
12. Initial view once per webview load, when bounds and viewport size are non-zero: the saved view
    if `parseSavedStageView` accepts it, else `fitStageView`. Later updates keep the user's view.
13. Viewport wheel: listener added in an `$effect` with `{ passive: false }`, always
    `preventDefault`; ctrl/meta → `zoomStageAt` at the viewport-relative cursor; else `panStage`.
14. `cd:frame-wheel`: `ctrlKey` true → `zoomStageAt` at
    `(view.x + (frame.x + x) * zoom, view.y + (frame.y + y) * zoom)`; else `panStage` with the raw
    deltas.
15. `cd:frame-height`: `nextFrameHeight` with the frame's guard, then relayout and re-commit the
    current view (re-clamp).
16. Empty-stage drag: primary button only, only when the target is the viewport or the layer;
    pointer capture; pan by previous − current pointer; cursor `grabbing` while dragging, `grab`
    otherwise; ends on `pointerup`, `pointercancel`, `lostpointercapture`. Viewport
    `touch-action: none`.
17. Preset change → `zoomStageTo` at the viewport center, then back to the placeholder. Fit all →
    `fitStageView`.
18. `ResizeObserver` on the viewport (in an `$effect`, disconnected on cleanup): when non-zero,
    apply the initial view if pending, then re-commit the current view.
19. Rejected frame messages are not logged (ponytail: wheel fires at 60+ Hz). Late `cd:*` from a
    previous document of the same iframe is accepted.

CSP rules for components: positions, sizes and the stage layer transform via `style:` directives
(`style:left={...}`, `style:transform={...}`; CSSOM writes) only; no
`style="..."` attribute anywhere in markup (Svelte templates parse it and `style-src` has no
`'unsafe-inline'`). Colors and fonts via `var(--vscode-*)` only.

## Testing

- Test command: `vp test` (baseline before this feature: 14 files, 205 tests, all passing;
  `pnpm verify` exit 0 on `main` at `482b86d`).
- New or moved unit tests: `frame/runtime.test.ts`, `frame/frameMessages.test.ts`,
  `stageGeometry.test.ts` (moved, same test count), `hostMessages.test.ts`,
  `stampArtboardHtml.test.ts` (happy-dom), rewritten `artboardChromeHtml.test.ts`, updated
  `handoffCanvasHtml.test.ts` + snapshot.
- Removed: string-grep behavior tests in `artboardChromeHtml.test.ts` (their logic moves to the pure
  modules; component and iframe behavior is proven by F5 per rule 09).
- Type gates: `vp check` (root + tsgolint), `svelte-check` (webview), `tsc -p tsconfig.webview-tests.json`
  (webview tests).
- F5 parity checklist (from 6d/6f; record each as observed): tall page, mobile page, short page,
  `100vh` page freezes instead of growing forever, empty-file tile, too-large tile, nested scroll
  box scrolls before the stage, ctrl+wheel zooms at the cursor over a frame and over empty stage,
  plain wheel pans, empty-stage drag pans, each preset, Fit all, hide/show the panel restores the
  view, editing one artboard reloads only that iframe, `place_frame` move does not reload,
  deleting an artboard file removes its frame, MCP-offline banner, handoff stale badge, error
  banner on a broken `canvas.json`, zero CSP violations in webview devtools.
- No browser test command exists; none added.

## Notes for the AI

- **Why the export changes.** `src/disk/handoffCanvasHtml.ts` embeds `ARTBOARD_CANVAS_RUNTIME_SOURCE`
  and `STAGE_GEOMETRY_SOURCE` into the exported `canvas.html`. The plan's step 7 deletes both
  without naming this consumer. Keeping string copies for the export would leave two sources of the
  runtime and the geometry (rule 04, rule 03 "a twin helper is a bug"), so the export consumes the
  same modules through `?iife`. The nested bundle is unminified so export bytes do not depend on
  `--minify`.
- **If `vp pack` cannot host the plugin** (tsdown rejects the nested build or the `?query` id),
  stop and report with the exact error. Do not keep a second hand-written copy as a workaround.
- **Disk importing from `src/webview/`** is limited to `frame/frameMessages.ts` (pure constants and
  guards, no DOM types) and `?iife` strings. Keep both DOM-free at the type level so the root
  tsconfig (no `DOM` lib) still type-checks them transitively.
- **`pagehide` blob revoke is dropped.** Blob URLs are revoked by the browser when the creating
  document unloads; no observable change. Per-frame revoke on reload and removal stays (effect
  cleanup in `Frame`).
- **`$effect` dependencies.** The blob effect in `Frame` must depend only on `html`, the nonce and
  tile/iframe kind. Reading `label` or position inside it would reload the iframe; use `untrack`
  or keep those reads outside.
- **Iframe registry** for `event.source` matching is plain non-reactive state (a `Map`), compared
  at message time like today. `contentWindow` stays the same object across `src` changes, so
  registration is per element, not per `load`.
- `acquireVsCodeApi` is declared locally in `hostBridge.svelte.ts`; the webview tsconfig has
  `types: []` and must not gain `@types/vscode`.
- `happy-dom` is used only in `stampArtboardHtml.test.ts` (rule 09 `ponytail:`: pure DOM helpers
  only, never component or iframe behavior). If `pnpm knip` flags it as unused, add it to knip's
  `ignoreDependencies` with a comment; knip is not in Verify.
- Existing comments that only applied to inlined strings ("no backtick, no dollar-brace, no
  less-than-slash") go away with the strings. Keep the why-comments (null-origin drop, runtime
  first in head, nonce stamping rationale, ponytail notes) on the code that carries them.
- `blueprint/context/project-overview.md` line "Chrome" still says template string after this
  feature; refresh it with `/overview` (or at `/complete`), do not hand-edit it.
- Later sub-features extend `frameMessages.ts`, `hostMessages.ts` and the bridge; do not
  pre-build their messages or props here.

## Implementation notes

- Bundler API: Vite `build` re-exported by `vite-plus` (`write: false`, `configFile: false`, lib `iife`). `vp pack` hosts the plugin with no changes.
- Additions not named in the spec, each needed for a gate: `src/webview/tsconfig.json` (solution-style, references both webview configs so tsgolint type-checks webview tests with `iife.d.ts`; a root `references` entry instead makes plain `tsc -p tsconfig.json` fail TS6306/TS6310); lint `import/default` off (its resolver cannot see `?iife` default exports; TS still checks); a lint override letting `src/webview/**/*.test.ts` import Node built-ins (tests run in Node).
- `parseHostMessage` drops invalid frame entries; their ids leave the stage through the "not among valid entries" removal. (Edge case: a message with one id both valid and invalid now keeps the valid entry.)
- `lastHtml` is the record's `html` field (updated for tiles too). Viewport size is taken from the `ResizeObserver` callback (`clientWidth` / `clientHeight`) instead of read live.
- Svelte files were written in the main session with Svelte MCP docs and `svelte-autofixer` (no issues on any file), not delegated to `svelte-file-editor`.
- Evidence: `pnpm verify` exit 0 (201 tests, svelte-check 0/0); type gate proven with a deliberate error (TS2322, exit 2, reverted); `dist/mcp.js` / `dist/extension.js` contain the runtime IIFE; `pnpm compile-electron-tests` exit 0; `pnpm vsix` packs `dist/webview/chrome.js`, no `node_modules`.
- Pre-existing, out of scope: the `.vsix` also packs `.remember/**` (session memory/logs) and root `tsconfig.webview*.json`, because `.vscodeignore` does not exclude them.

## F5 parity checklist (Bombic, 2026-10-22, `fixtures/dev-workspace`)

All pass. Export `.cursor-design/handoff/canvas-20261022T084743493Z/`, handoff not stale after export.

- Pages: tall / mobile / short size correctly; `100vh` freezes (vhhero 1376, t5-vhhero 1600, not 20000); empty-file tile; too-large tile.
- Zoom / pan: nested scroll box scrolls before the stage; ctrl+wheel zooms at the cursor over a frame and over empty stage; plain wheel pans; empty-stage drag pans; every preset and Fit all.
- Editing: hide/show restores the view; editing one artboard reloads only that iframe; `place_frame` move does not reload; deleting an artboard file removes its frame.
- Banners / CSP: MCP-offline banner; stale-handoff badge; error banner on broken `canvas.json`; zero CSP violations in webview DevTools.
- `canvas.html`: frames grow to content height (tall 2548, mobile 732, short 222); wheel over a frame scrolls the page.

## Review gates

- Independent review (`when-sensitive`): user decided on 2026-10-22 that this work is not sensitive for the gate. Evidence instead: a Sonnet 5.5 high-effort read-only code review found no P0/P1. Applied P2/P3 hardening: `?iife` resolve error, identifier-stem check, `\0` ids skipped for watch, `</`-only escape ponytail, and the App/Frame reload-condition comment. `pnpm verify` re-run green (201 tests).
- Audit / Check: `manual`, not requested. Try guide: the F5 parity checklist above is the manual path.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":31218,"specSha256":"9bd9db765c8119738b76e0dbe64245951f9128620369f172a8c0c68682fd41a0","branch":"refs/heads/feature/svelte-port","head":"482b86d1ad247a0cb1ca72334507dd8fac75f59a","baseRef":"refs/heads/main","baseCommit":"482b86d1ad247a0cb1ca72334507dd8fac75f59a","sourceTree":"7645ddf66702b1e5379ad933e938118d0a249872","landing":"local-merge","absentOptional":[]} -->

## Try it now

Run or do:

F5 (Run Extension), then Cursor Design: Open Artboard in `fixtures/dev-workspace`. Ctrl+wheel over a frame, drag the empty stage, pick a zoom preset, and edit one artboard file.

Expected:

Frames grow to their content height, zoom stays anchored at the cursor, only the edited artboard reloads, and the webview DevTools console shows zero CSP violations.

This proves:

The Svelte chrome matches 0.2 behavior under the unchanged CSP.
