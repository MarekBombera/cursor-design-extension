# Feature: Blob inject

**From build-plan:** feature 6a
**Build attempt:** 1
**Branch:** `feature/blob-inject`
**Status:** verified

## Goal

First slice of the 0.2 Interact canvas. Chrome puts the artboard iframe inside a clip well and zooms by applying a CSSOM `translate(x, y) scale(z)` to the **iframe element**, with origin `0 0`. The artboard lays out in a real, unscaled viewport, so `position: fixed`, `sticky`, and `vh` behave as they will after implementation, and a zoomed-out artboard letterboxes inside the well.

When chrome builds the blob URL, it injects a small gesture-forwarding runtime stamped with the chrome CSP nonce. The runtime never touches artboard styles. It catches pinch / ctrl+wheel inside the artboard and posts one allowlisted message to chrome. Chrome zooms from the top-left, clamped to 50–200%. Disk, MCP, and export/handoff HTML stay pristine, and tests assert it. Nothing is stripped on export.

Architecture follows the approved deviation from the Notion 0.2 lock (scale the host iframe, not artboard `body`). See `blueprint/project-plan.md` §3.

## Current code (facts the spec relies on)

From `src/panel/artboardChromeHtml.ts` and `src/panel/openArtboardPanel.ts` at spec time:

- Chrome is one TS template literal returned by `buildArtboardChromeHtml`. Its single inline `<script nonce="${nonce}">` holds all chrome JS. Any chrome-JS template literal would be interpolated by TS at build time, so new chrome JS uses string concatenation (as `stampArtboardHtml` already does), not backtick templates.
- `const iframe = document.getElementById('artboard-frame')` is captured once. The element is never recreated. `applyArtboardHtml` refreshes by revoking the old blob and setting `iframe.src` to a new blob URL, so an inline `style.transform` on the element survives every refresh, and `iframe.contentWindow` (the browsing context's WindowProxy) stays the same object across navigations.
- `applyArtboardHtml` returns early when `html === lastHtml`. Empty HTML sets `iframe.hidden = true`, removes `src`, and shows `#empty-copy`; non-empty does the reverse. `artboard:error` only shows `#artboard-error`; it does not hide the frame. HTML over the host size limit arrives as empty HTML plus an error.
- `stampArtboardHtml(rawHtml, nonceValue)` parses with `new DOMParser().parseFromString(rawHtml, 'text/html')` (always synthesizes `head`/`body`), removes every `meta[http-equiv]`, sets `nonce` on every `script, style`, and returns `'<!DOCTYPE html>' + parsed.documentElement.outerHTML`. The blob is created as `type: 'text/html'` (no charset), so the parser relies on the artboard's `<meta charset>` being within the first 1024 bytes.
- `nonceValue` is `data.cspNonce` from `artboard:updated`, i.e. the chrome nonce posted by the host.
- Blob CSP: chrome CSP is `default-src 'none'; style-src 'nonce-…' <cspSource>; script-src 'nonce-…' <cspSource>; frame-src blob:`. A document loaded from a `blob:` URL inherits the creator's policy container (HTML spec, Chromium behaves this way), which is why stamping works today; the chrome comment above `stampArtboardHtml` states the same. Nonce'd `<script>`/`<style>` run; inline handlers and `style=""` attributes stay blocked (v1 limit).
- The message listener today checks `event.origin === 'null'` **first**, then drops `event.source === iframe.contentWindow`, then requires a non-null object.
- Chrome HTML today has exactly one `<script nonce="` and one `</script>`. (The `<script` substring also appears once in the `stampArtboardHtml` comment, so count `<script nonce="` not `<script`.)
- `artboardChromeHtml.test.ts` asserts `iframe.hidden = true` for the empty case. `handoff.test.ts` (test "export writes three files…") already asserts handoff `index.html` is byte-equal to the authored HTML.
- The panel has no `retainContextWhenHidden`, so the chrome reloads when the panel tab is hidden and shown again.

## In scope

- New runtime module `src/panel/artboardCanvasRuntime.ts` (its script runs in the artboard iframe; module has no `vscode` / Node imports and exports only):
  - `CANVAS_RUNTIME_ATTRIBUTE = 'data-cd-canvas-runtime'` (only marker; `data-cd-*` prefix).
  - `CANVAS_WHEEL_MESSAGE = 'canvas:wheel'` (the one iframe → chrome message type in 6a).
  - `ARTBOARD_CANVAS_RUNTIME_SOURCE: string`, a self-contained IIFE built as a TS template string that interpolates `${JSON.stringify(CANVAS_WHEEL_MESSAGE)}` (never re-types the literal). At IIFE start it captures `const host = window.parent`. `parent` is a replaceable global, and the runtime runs before every artboard script (see injection position), so a later artboard `var parent = …` cannot break forwarding. It registers `window.addEventListener('wheel', …, { passive: false, capture: true })`. When `event.ctrlKey || event.metaKey` is true (Chromium reports trackpad pinch as ctrl+wheel; macOS Cmd+wheel is the Figma-style zoom), it calls `event.preventDefault()` and `host.postMessage({ type: <CANVAS_WHEEL_MESSAGE>, deltaY: event.deltaY }, '*')`. Plain wheel is left alone, so the artboard scrolls natively.
  - No style writes, no `classList`, no DOM changes, no other messages, no `clientX`/`clientY` (6b), and no `<` character anywhere in the source (so `textContent` serialization can never produce `</script`).
- `src/panel/artboardChromeHtml.ts` (chrome JS follows rule 04: arrow functions, full names):
  - Markup: wrap `#artboard-frame` in `<div id="artboard-well" hidden>` in the iframe's current place in the body flex column; drop `hidden` from the iframe. Static `<style nonce>` rules: well `flex: 1 1 auto; position: relative; overflow: hidden; background: var(--vscode-sideBar-background, var(--vscode-editorWidget-background))` and **no `display`** (so the `hidden` attribute keeps working). Replace the current `#artboard-frame` rule with `position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: var(--vscode-editor-background)`.
  - Visibility: `const artboardWell = document.getElementById('artboard-well')`. In `applyArtboardHtml`, replace `iframe.hidden = true/false` with `artboardWell.hidden = true/false`. `iframe.removeAttribute('src')` and `#empty-copy` handling stay. Error handling is unchanged.
  - Chrome view state `const canvasView = { x: 0, y: 0, zoom: 1 }`. `x`/`y` stay `0` in 6a; kept so the transform already has the 6b shape. `applyCanvasView = () => { … }` sets `iframe.style.transformOrigin = '0 0'` and `iframe.style.transform = 'translate(' + canvasView.x + 'px, ' + canvasView.y + 'px) scale(' + canvasView.zoom + ')'`. Call it once at chrome startup and after each zoom change. No refresh hook is needed because the element is never recreated; keep it a single element.
  - Zoom is panel-global for the chrome session: it survives `artboard:updated`, including active-artboard switches, and resets to 100% when the chrome reloads (6c adds persistence).
  - Message listener, new order: first `if (iframe.contentWindow !== null && event.source === iframe.contentWindow) { handleCanvasMessage(event.data); return; }`, replacing today's drop. The iframe branch does not check `event.origin` (the sandboxed blob without `allow-same-origin` has origin `'null'`; source identity is the check). The existing `event.origin === 'null'` drop follows and still covers every other source. Host branches are unchanged.
  - `handleCanvasMessage = (data) => { … }` accepts only `data !== null && typeof data === 'object' && data.type === <CANVAS_WHEEL_MESSAGE> && Number.isFinite(data.deltaY)` (type interpolated from the imported constant). Then `canvasView.zoom = Math.min(2, Math.max(0.5, canvasView.zoom * Math.exp(Math.min(0.2, Math.max(-0.2, -data.deltaY * 0.01)))))` and `applyCanvasView()`. No `clamp` helper. Negative `deltaY` (pinch out / ctrl+wheel up) zooms in. The per-message step cap of ±0.2 in log space (×1.22 in, ×0.82 out) means one mouse notch (`deltaY` about 100, which uncapped would be ×2.7) moves about 20%, and 100% → 200% takes 4 notches. Trackpad pinch events (`|deltaY|` usually under 20) stay under the cap. `0.01` and `0.2` are temporary; 6b may retune. `deltaMode` is ignored in 6a. Anything else is ignored with no log (`ponytail:` comment: wheel fires at 60+ Hz, so logging rejects would spam; upgrade path is a debug-only counter).
  - Embed chain (host → chrome → blob):
    1. Host TS: exported `embedScriptSource = (source: string): string => JSON.stringify(source).replaceAll('<', '\\u003c')`. The chrome template inlines `${embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE)}` as a JS string literal (`const canvasRuntimeSource = …;`) inside the existing chrome `<script nonce>`. Constants (`CANVAS_RUNTIME_ATTRIBUTE`, `CANVAS_WHEEL_MESSAGE`) are interpolated the same way (`${JSON.stringify(…)}`), never re-typed.
    2. Chrome JS: `injectCanvasRuntime = (parsed, nonceValue) => { … }`, called from `stampArtboardHtml` after the existing meta-strip and nonce-stamp loops. It removes every `script[data-cd-canvas-runtime]` already in the artboard (artboard HTML could ship a spoof; non-script elements with the attribute are left alone). It builds the script with `parsed.createElement('script')`, `setAttribute('nonce', nonceValue)`, `setAttribute(<CANVAS_RUNTIME_ATTRIBUTE>, '')`, and `textContent = canvasRuntimeSource` (no HTML string concatenation). Position: immediately after `parsed.head.querySelector('meta[charset]')` if present, otherwise as the first child of `parsed.head`. That keeps the charset meta inside the sniffing window and runs the runtime before every artboard script, which the captured `window.parent` and the capture-phase listener order depend on. Head also keeps it out of artboard `body > …` queries.
    3. Existing serialize + blob build, unchanged.
  - Update the comment above `stampArtboardHtml` to mention runtime injection.
  - Letterbox zoom (exception triggered at F5, see Notes): the clamp/cap math lives once in `applyZoomDelta = (deltaY) => { … }`, called by `handleCanvasMessage` and by a `wheel` listener on `#artboard-well` (`{ passive: false }`) that acts only on `event.ctrlKey || event.metaKey`, calls `preventDefault()`, and passes `event.deltaY`. Wheel events inside the iframe never reach the chrome document, so there is no double-zoom.
- `.cursor/rules/02-mcp-webview.mdc` Webview CSP item 5: keep the host ↔ chrome list and add a separate clause `iframe → chrome: canvas:wheel (allowlisted by source; zoom only). Chrome → iframe: none.`
- Tests (existing `node:test` files):
  - `src/panel/artboardChromeHtml.test.ts`:
    - `embedScriptSource('a</script><b')` contains `\u003c` and no raw `<`. This fails if the `replaceAll` is removed.
    - Chrome HTML: `<div id="artboard-well" hidden>` precedes `<iframe id="artboard-frame" sandbox="allow-scripts"`. It contains `CANVAS_RUNTIME_ATTRIBUTE` and `embedScriptSource(ARTBOARD_CANVAS_RUNTIME_SOURCE)`. `<script nonce="` and `</script>` each appear exactly once (6a adds no chrome script tag). It contains `transformOrigin` and `style.transform`. `event.source === iframe.contentWindow` appears before `event.origin === 'null'`.
    - Update the empty-case test from `iframe.hidden = true` to `artboardWell.hidden = true`; keep the `removeAttribute('src')` assert.
    - `ARTBOARD_CANVAS_RUNTIME_SOURCE` alone contains `passive: false`, `ctrlKey`, `preventDefault`, `window.parent`, and `JSON.stringify(CANVAS_WHEEL_MESSAGE)`, and contains none of `<`, `.style`, `classList`, `clientX`, `data-dc-`, `sc-host`, `design_doc_mode`.
  - `src/disk/handoff.test.ts`: in the existing "export writes three files…" test, which already asserts handoff `index.html` byte-equals `HERO_HTML`, add one assert that the disk artboard HTML (`artboardHtmlPathSegments('hero')`) also byte-equals `HERO_HTML`. Byte-equality covers any injected junk without importing panel code into disk tests. Nothing is stripped on export.

## Out of scope

- Zoom around the cursor, plain-wheel pan, nested-scroll walk, pure/tested geometry module, `clientX/Y` in the message, `deltaMode` normalization, message throttling (6b).
- Zoom menu/presets, ready-handshake, `getState`/`setState` persistence, disabling zoom on empty/error, keyboard zoom (6c).
- Letterbox pan or cursor-anchored zoom (6b). Letterbox ctrl/meta zoom moved into 6a (F5 exception).
- Migrating chrome to Svelte / `src/webview/`. Chrome stays the template string in `artboardChromeHtml.ts`.
- `src/panel/openArtboardPanel.ts`, host ↔ chrome messages, `src/disk/**` source, `src/mcp/**`, `package.json`, chrome CSP string, iframe `sandbox`, blob MIME type.
- Any chrome → iframe postMessage.
- A runtime export guard that rejects HTML. The assert is test-level only.
- Space-drag pan, Edit mode, `data-dc-*`, `.sc-host`, meta canvas flag.
- Adding a Blueprint Verify / test gate to `AGENTS.md` Commands.

## Build loop

`workflow.stepReview: "feature"`: implement both steps, then one review packet. `checkpointCommits: "disabled"`. `/complete` makes the feature commit on `feature/blob-inject`.

## Build steps

- [x] **Step 1 - Well, iframe transform, runtime injection, allowlisted zoom** - Add `artboardCanvasRuntime.ts`. In `artboardChromeHtml.ts` add `embedScriptSource`, the well markup/styles and `artboardWell` visibility swap, `canvasView` + `applyCanvasView`, `handleCanvasMessage` with the source-first listener order, and `injectCanvasRuntime` at the head position above. Update the 02 rule line. Extend and update `artboardChromeHtml.test.ts`. If the code no longer matches "Current code" above, stop and report before editing. *Done when:* `pnpm check-types`, `pnpm lint`, and `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js` all pass (73 at spec time, plus the new cases). The new chrome tests fail if the injection, marker, listener order, CSSOM transform, well visibility, or `<` escape are removed.
- [x] **Step 2 - Export clean-assert + F5 dogfood** - Add the disk byte-equality assert to `handoff.test.ts`. `pnpm compile`, then F5 with `fixtures/dev-workspace`. Use a throwaway artboard under the gitignored `.cursor-design/` with `<meta charset="utf-8">` and a non-ASCII heading (for example `Café`); a `<head>` `<script>` containing top-level `var parent = 1;`; a `<body>` with no `style` attribute; a `position: fixed` header styled from a `<style>` block; content taller than the panel; and a `<button>` whose text changes on click via an inline body `<script>` (no `onclick` attribute; inline handlers are CSP-blocked). *Done when:*
  - The test suite passes.
  - Pinch / ctrl+wheel over the artboard zooms the frame from its top-left despite the head `var parent = 1;`. In **Developer: Open Webview Developer Tools** (chrome context), `#artboard-frame.style.transform` stops at `scale(0.5)` and `scale(2)`.
  - One mouse ctrl+wheel notch changes zoom by about 20%, not straight to a clamp.
  - At 50% the well background shows right of and below the frame.
  - The fixed header stays pinned to the artboard's own viewport at any zoom.
  - Plain wheel scrolls the artboard natively.
  - At 50%, clicking the visible scaled button triggers it. Clicking the letterbox (well background) triggers nothing in the artboard.
  - Pinch / ctrl+wheel over the letterbox at 50%: record what happens in the review packet (expected: no artboard zoom; flag it if the whole Cursor window zooms).
  - In the frame context, `document.body.getAttribute('style') === null`, `document.documentElement.getAttribute('style') === null`, exactly one `script[data-cd-canvas-runtime]` exists, it is in `head` before the artboard's `<script>`, and `Café` renders correctly.
  - The button script runs (no new CSP violations).
  - Editing the artboard file refreshes it (~200ms) and keeps the current zoom, and zoom keeps working after that refresh. Switching the active artboard also keeps the current zoom.
  - After **Export Handoff**, `rg data-cd- .cursor-design/` finds nothing.
  - *Status:* automatable part done (disk byte-equality assert, `pnpm compile`, fixture artboard `canvas-6a` active in `fixtures/dev-workspace`).
  - *F5 run 1 (Bombic, 2026-10-12):* clamps pass; fixed header + native scroll pass; clicks at 50% and inert letterbox pass; export clean (`rg data-cd-` empty) pass. **Fail:** macOS Cmd+wheel did not zoom; fixed by accepting `metaKey` in runtime and well listener. **Triggered:** pinch over the letterbox zoomed outside our path; letterbox exception implemented (well `wheel` listener). **Observed, deferred to 6c:** zoom resets when switching to another editor tab and back (webview torn down when hidden, no `retainContextWhenHidden`); 6c `getState`/`setState` owns it.
  - *F5 run 2 (Bombic, 2026-10-12):* Cmd+wheel over the artboard zooms within clamps: pass. Pinch / Cmd+wheel over the letterbox zooms the artboard frame, not the Cursor window: pass. Plain wheel over the letterbox does not pan (6b).

## Files / areas

- `src/panel/artboardCanvasRuntime.ts` (new)
- `src/panel/artboardChromeHtml.ts`
- `src/panel/artboardChromeHtml.test.ts`
- `src/disk/handoff.test.ts`
- `.cursor/rules/02-mcp-webview.mdc` (Webview CSP item 5)

## Data / contracts

- Marker: `data-cd-canvas-runtime` (empty value) on the one injected `<script>` in `head`, which also carries `nonce="<chrome nonce>"`. Import `CANVAS_RUNTIME_ATTRIBUTE` and `CANVAS_WHEEL_MESSAGE` and interpolate them into the runtime source and chrome template; never re-type them.
- Blob CSP: inherited from chrome (see Current code). The injected script runs because it carries the same chrome nonce `stampArtboardHtml` already stamps on artboard scripts. No new CSP string.
- Iframe → chrome: `{ type: 'canvas:wheel', deltaY: number }`, sent only for ctrl+wheel or meta (Cmd)+wheel. Chrome also zooms from ctrl/meta wheel on `#artboard-well` directly (no message). Chrome accepts it only from `iframe.contentWindow` with a non-null object payload and finite `deltaY`, and ignores everything else from the iframe. `targetOrigin '*'` is acceptable because the payload is a non-sensitive number and the null-origin blob cannot name the webview origin. Chrome → iframe: nothing in 6a.
- Chrome view state `{ x: number, y: number, zoom: number }`, chrome-only, panel-global, not persisted in 6a. `x`/`y` stay `0` until 6b. Zoom clamp `[0.5, 2]` per build-plan 6a (50–200%); per-message step capped at ±0.2 in log space.
- Transform target: `#artboard-frame` element in chrome (CSSOM only). The artboard document is never restyled.
- Exported TS helpers carry explicit return types (`embedScriptSource(source: string): string`). `applyCanvasView`, `handleCanvasMessage`, `injectCanvasRuntime` are arrow functions inside the chrome template's JS, not TS.
- Disk, MCP results, `handoff/<exportId>/index.html`: no injected content. No schema or version change. Host ↔ chrome messages unchanged.

## Testing

No Verify command is declared; `AGENTS.md` Commands does not list `compile-tests`, but `package.json` defines it (`tsc -p . --outDir out`). Runner: `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`. If `pnpm` aborts on the no-TTY modules purge prompt, use `./node_modules/.bin/tsc -p . --outDir out && node --test …` (73/73 passing at spec time). Chrome and runtime code are template strings, so tests are string-level (Node has no `DOMParser` and no wheel events). CSSOM, hit-testing, injection order, charset, clamps, step cap, and refresh persistence are proven only by the F5 checks in Step 2. The zoom formula moves to a unit-tested module in 6b. No browser tests.

## Notes for the AI

- Letterbox gestures (decided by Bombic): default was to wait for 6b, with an exception if F5 showed pinch over the well zooming outside our path. F5 run 1 triggered it, so 6a adds the ctrl/meta `wheel` listener on `#artboard-well` through the shared `applyZoomDelta`.
- Chrome is a template-string document in `artboardChromeHtml.ts`, not Svelte, even though the stack docs say Svelte 5 + `src/webview/`. Stay in the template pattern; do not migrate in 6a.
- Why the iframe is the pan host: a transform on artboard `body` re-roots `position: fixed`, stops letterboxing (body background propagates to the canvas), and fights native scroll. Scaling the iframe element avoids all three and leaves agent HTML untouched.
- The iframe's layout size stays equal to the well at every zoom. Only its visual scale changes, so artboard media queries and `vh` see the panel size, as before 0.2.
- Above 100% with no pan (6b), the right and bottom of the artboard viewport are clipped by the well and unreachable, including fixed elements anchored there. Accepted in 6a.
- Spoofing: artboard scripts can post `canvas:wheel` themselves. The worst case is zoom changing within the clamps, or a flood of messages thrashing `transform`. Both are accepted in 6a; throttling is a 6b option.
- An artboard script that appears before `<meta charset>`, or that registers its own capture-phase `wheel` listener and stops propagation, is accepted in 6a.
- Empty state: the well is hidden, no runtime runs, and zoom can't change. Error state: the frame keeps its last content and zoom keeps working. The view is retained for the next load. Disabling is 6c.
- In-artboard navigation (the artboard replacing its own document) loads a page without the runtime, so zoom stops until the next refresh. Accepted in 6a.
- Hiding and re-showing the panel tab reloads the chrome (no `retainContextWhenHidden`), so zoom resets to 100%. Observed at F5 run 1 (switching editor tabs and back). Accepted until 6c `getState`/`setState`.
- Accessibility: 6a zoom is pointer-only. Keyboard and menu access arrive in 6c. The well adds no focusable element.
- Error handling: the runtime can't throw on load (one listener). Malformed or unknown iframe messages are ignored without logging, by design (untrusted, high-frequency input, no user-facing error). There are no new user/MCP messages.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":21975,"specSha256":"d4d9c50aa8d87d44c70dba681f616bf104f15f7784950c834b6793e1b592d7d3","branch":"refs/heads/feature/blob-inject","head":"7fae09b7c02bc9c86cb04567f79fa1581d131279","baseRef":"refs/heads/main","baseCommit":"579133ef1c71ad43cb182897b1a1c43a99df75ad","sourceTree":"2c70630c5921b00bc768c84342ac1493c62b82ed","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 7fae09b7c02bc9c86cb04567f79fa1581d131279
**Base commit:** 579133ef1c71ad43cb182897b1a1c43a99df75ad
**Base ref:** origin/main
**Spec hash:** d4d9c50aa8d87d44c70dba681f616bf104f15f7784950c834b6793e1b592d7d3
**Prepared by:** codex
**Builder model:** Claude Opus 5.5
**Requested reviewer:** codex
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-12T20:38:44Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** codex
**Reviewer model:** Claude Opus 5.5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-12T20:41:00Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD` / `git merge-base origin/main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain -uall`: pass (target, base, spec hash match; only `review.md` dirty; `origin/HEAD` -> `origin/main`)
- `pnpm check-types`: pass
- `pnpm lint`: pass
- `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`: pass (78/78)
- `pnpm compile`: pass

## Evidence

- Full `579133e..7fae09b` delta reviewed: `src/panel/artboardCanvasRuntime.ts`, `src/panel/artboardChromeHtml.ts`, `src/panel/artboardChromeHtml.test.ts`, `src/disk/handoff.test.ts`, `.cursor/rules/00,02`, `.cursor/skills/{complete,cursor-design-build,doctor}`, `AGENTS.md`, blueprint plan/overview docs, `pnpm-lock.yaml`, and the f4c9edd adapter symlinks.
- Security: iframe messages are matched by `event.source === iframe.contentWindow` and only reach `handleCanvasMessage` (type + finite `deltaY`, zoom clamped to [0.5, 2]); they never reach host branches. Other null-origin sources are still dropped. The runtime is embedded via `JSON.stringify` + `<` escape and contains no `<`, and it is injected with `textContent`, not HTML concatenation. Spoofed runtime scripts are removed. Chrome CSP, sandbox, and blob MIME are unchanged.
- Spec conformance: well markup/styles (no `display`), `artboardWell.hidden` swap, `canvasView` + `applyCanvasView`, listener order, injection position after `meta[charset]`, shared `applyZoomDelta` for the letterbox path, and the rule 02 item 5 clause all match `current-feature.md`.
- Disk/export pristine: handoff test now asserts that both the disk artboard and the handoff `index.html` byte-equal the authored HTML.
- Plumbing: the deleted `.agents/skills` files are byte-identical to `.cursor/skills` except the three intentionally edited skills, so no skill was lost. The lockfile specifier `^2.2.0` now matches `package.json`, which already said `^2.2.0` at base.

## Findings

- F-08 [P3] open: no test pins the finite-`deltaY` guard on iframe messages
- F-09 [P3] open: Blueprint manifest still hashes the replaced adapter copies
- F-07 [P3] open: pre-existing, not in this delta, unchanged

## Remaining risk

- Chrome and runtime behavior (CSSOM transform, hit-testing, injection order, charset, clamps, step cap, refresh persistence) is proven only by builder-reported F5 runs recorded in the spec. No browser test harness exists, and this reviewer did not run F5.
- Tests are string-level assertions on template source (Node has no `DOMParser` or wheel events). Zoom math becomes unit-testable in 6b.
- Accepted 6a limits per spec: artboard scripts can spoof `canvas:wheel` (zoom within clamps, possible transform thrash), scripts placed before `<meta charset>` run before the runtime, and zoom resets when the panel is hidden.
- No Verify command or CI workflow is declared; `/check` was not required and was not run.
