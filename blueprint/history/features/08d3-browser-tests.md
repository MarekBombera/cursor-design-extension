# Feature: Browser tests

**From build-plan:** feature 8d3
**Build attempt:** 1
**Branch:** feature/browser-tests
**Status:** verified

## Goal

A local Playwright suite (Chromium only) drives the **built** chrome bundle (`dist/webview/chrome.js`
+ `chrome.css`) in a harness page, with a stubbed VS Code host and the real frame runtime inside real
sandboxed blob iframes. It covers the chrome and iframe behavior that unit tests cannot reach (rules
08/09) and that so far only a scratch harness or F5 proved: frame stability (no reload loop, F-51),
wheel/zoom and trackpad pan over frames (F-52), frame drag/resize, Comment-mode picking and
selectors. One `Browser tests` command in `AGENTS.md`; it stays out of Verify and CI for now. F5 is
kept only for checks that need Cursor itself.

No product behavior changes. Product code under `src/` is not edited by this feature.

## In scope

- Dev dependency `@playwright/test` (latest release at implement time, caret range like the other
  dev deps) and its Chromium browser (`pnpm exec playwright install chromium`, one-time, local).
- `tests/browser/`: Playwright config, one harness module, two spec files.
- The harness page is served by Playwright request routing from a fixed fake HTTPS origin; no dev
  server, no port.
- Stub `acquireVsCodeApi` that records chrome → host posts and webview state, with a seedable
  saved stage view.
- An observation-only capture of frame → chrome messages, keyed by frame id.
- Specs for: frame stability, wheel pan and ctrl+wheel zoom over a frame and over the empty stage,
  trackpad pan that leaves a frame, drag and resize with pixel snap and clamp, Escape revert,
  Agent-wins mid-drag, Comment-mode picking (hover, click blocking, pick, parent via button and ↑
  with frame focus, two-frame handoff, mode off), and real-click selectors on
  `fixtures/picking.html`.
- Mutation checks: the F-51 and F-52 regression tests fail with their fix reverted locally.
- Package script `test:browser`; `Browser tests` line in `AGENTS.md` Commands.
- Rules 00, 08 and 09 and `coding-standards.md` say browser tests prove chrome and iframe behavior,
  and F5 is only for Cursor-only checks. Rules 04 and 09 gain the `tests/browser/**` scope.
- `.gitignore` / `.vscodeignore` / `knip.json` / lint config entries needed so `pnpm verify`,
  `pnpm knip` and the `.vsix` stay clean.

## Out of scope

- Adding browser tests to `pnpm verify` or `.github/workflows/verify.yml` (plan: local only for now).
- Firefox / WebKit, screenshot or visual-diff assertions, a coverage report for browser tests.
- The webview CSP: the harness page has no CSP. CSP, `asWebviewUri`, MCP registration, Extension
  Host, webview hide/show reload and Cursor focus (chat panel stealing ↑/↓) stay F5 checks
  (`coding-standards.md`).
- The exported `canvas.html` preview (F-28) and anything from 8e onward (comments, pins, panel,
  copy prompt).
- Any change under `src/`. A product bug the suite finds is recorded as a finding and goes to
  `/fix`, not patched here.
- Running `/tests browser`: this feature is that opt-in.

## Build loop

`workflow.stepReview` is `feature`: build all steps in order, run each step's checks, then present
one review at the end. `workflow.checkpointCommits` is `disabled`: no commits during the build;
`/complete` creates the feature commit.

Per step: make the change, run the step's `Done when` checks, fix until green, move on. Run
`pnpm verify` and `pnpm test:browser` after every step that touches config or specs. "Three runs in
a row" means one `pnpm test:browser --repeat-each=3` that passes.

## Build steps

- [x] **1. Toolchain, harness and smoke spec.**
  - `pnpm add -D @playwright/test`; `pnpm exec playwright install chromium`.
  - `tests/browser/playwright.config.ts`: `testDir` is its own folder, one project with
    `browserName: 'chromium'`, headless, viewport 1280×800, `deviceScaleFactor: 1`,
    `fullyParallel: false`, `retries: 0`, `forbidOnly: true`, `reporter: 'list'`. Output folder
    default (repo-root `test-results/`), git- and vsix-ignored.
  - `tests/browser/harness.ts` (one module, see Data / contracts for every export).
  - `package.json` script `"test:browser": "vp build -c vite.webview.config.ts && playwright test -c tests/browser"`
    so the suite always runs the bundle built from the current source.
  - Lint and type check: `vp check` must cover `tests/browser/**`. If type-aware lint reports the
    files are outside every tsconfig, add `tests/browser/tsconfig.json` (ES2022 + DOM lib,
    `types: ["node"]`, `module` / `moduleResolution` as in the root tsconfig, `noEmit`, strict) the
    same way `src/webview/tsconfig.json` was added. Add `tests/browser/**` to the lint override
    that relaxes `id-length` / `explicit-module-boundary-types` for tests.
  - Knip: its Playwright plugin looks for the config at the workspace root, so expect to add
    `tests/browser/playwright.config.ts` and `tests/browser/*.spec.ts` to `entry`.
  - `.gitignore`: `test-results/`. `.vscodeignore`: `tests/**`, `test-results/**`.
  - Smoke spec in `tests/browser/stage.spec.ts`: `window.isSecureContext` is `true`; the first
    chrome → host post is `{type: 'artboard:ready'}`; after `postToChrome(canvas:updated)` with two
    frames, both `[data-cd-frame-id]` hold an iframe, each frame posts at least one `cd:ready`
    (step 2 owns the reload count), and the "No artboard yet." text is hidden;
    `abortedRequests()` is 0 after load. Then the network probe:
    `page.evaluate(() => fetch('https://example.invalid/').then(() => 'ok', () => 'blocked'))`
    returns `'blocked'` and `abortedRequests()` becomes 1.
  - **Done when:** `pnpm test:browser` passes the smoke spec; `pnpm verify` passes (still 307 unit
    tests); `pnpm knip` is clean; `pnpm dlx @vscode/vsce@3.9.2 ls --no-dependencies` lists nothing
    under `tests/` or `test-results/`.

- [x] **2. Frame stability and stage input** (`stage.spec.ts`).
  - Frames for this step and step 3: frame A at (0, 0), width 400, inline page with a 1200 px tall
    body that does not scroll internally; frame B at (1000, 0), width 400, short inline page. Both
    are strings in the spec. Every test seeds `{x: 0, y: 0, zoom: 1}` and, before its first
    gesture, asserts the zoom readout shows `100%` and frame A's box is at screen (0, 0) plus the
    stage's offset in the page (measured once from the stage element).
  - Stability: after the first loads settle (each frame's `cd:frame-height` reported), no frame
    posts another `cd:ready` within a 1 s quiet window (`ponytail:` fixed quiet window, not an
    event; raise it if it flakes, never remove it). Re-posting the identical `canvas:updated`
    reloads nothing. Changing frame A's `html` (posted with A's `generation` + 1, as the host sends
    an `update_artboard`) gives exactly one new `cd:ready` from A and none from B, counted after a
    second quiet window. Changing A's `x`, `label` or `width` (`generation` unchanged) reloads
    nothing.
  - Wheel pan: a plain `mouse.wheel(0, 120)` with the pointer over frame A moves A's screen box by
    the same amount as the same wheel over the empty stage (right of frame B), within 1 px; A posts
    `cd:frame-wheel` (captured).
  - Zoom at cursor: `keyboard.down('Control')`, `mouse.wheel(0, -120)`, `keyboard.up('Control')` in
    a `finally`. Over frame A: the zoom readout and the saved `stageView.zoom` change, and the
    frame-local point under the cursor stays put (its fraction of A's box is equal before and
    after, within 1 px of screen space). Same over the empty stage.
  - Trackpad pan leaving a frame: pointer at A's vertical middle, 50 px left of A's right screen
    edge. 20 `mouse.wheel(30, 0)` steps (600 px total, content moves left, so A's right edge
    crosses the pointer after about 2 steps). Assert `state.stageView.x` decreased by at least 590
    and A's box moved left by at least 590 px. The bounds (two frames, 1400 px wide) leave room for
    the pan inside the view clamp. CDP fallback if needed:
    `Input.synthesizeScrollGesture` with `x`/`y` = that pointer, `xDistance: -600`, `yDistance: 0`,
    `speed: 800`, `gestureSourceType: 'touch'` (CDP distance sign is the reverse of wheel delta),
    same assertions.
  - Mutation checks, run locally, results recorded in Notes for the AI: (a) in
    `src/webview/Frame.svelte`, make the attachment and blob effect read `html` / `id` instead of
    `frameHtml` / `frameId`: the stability test fails; (b) make `handleSinkScroll` in
    `src/webview/App.svelte` return immediately: the trackpad test fails. If (b) cannot be made to
    fail with the wheel steps, use the CDP gesture above. If neither reproduces the latched
    gesture, stop and report: a pan test that cannot fail is not shipped. Revert each mutation with
    `git checkout -- src/`, then run `pnpm test:browser` once more so `dist/webview` is rebuilt from
    clean source.
  - **Done when:** all of the above pass with the fixes in place, (a) and (b) fail with them
    reverted, `git diff src/` is empty afterwards, `dist/webview` was rebuilt after the last revert,
    and the suite passes three runs in a row.

- [x] **3. Drag and resize** (`stage.spec.ts`, same frames and seeded view as step 2).
  - Snap rule (shipped, `stageGeometry.ts`): gestures land on whole stage px (`Math.round`, no
    grid), start after a 3 px screen threshold, and resize clamps to `MIN_FRAME_WIDTH` /
    `MAX_FRAME_WIDTH`. At zoom 1, stage delta = screen delta.
  - Drag: `mouse.down` on A's label (`[data-cd-frame-label="<id>"]`), `mouse.move` by (+53, +21)
    with `steps: 10`, `mouse.up`: exactly one new `frame:place` is posted with `id`,
    `x = start.x + 53`, `y = start.y + 21` exactly, `width` unchanged and `base` equal to A's
    placement at gesture start. No `cd:ready` from A during the drag.
  - Resize: drag A's right handle (`[data-cd-frame-resize="<id>"]`) to viewport x = 1 (inside the
    viewport, more than A's width left of its left edge after a stage offset, so the raw width goes
    below the minimum): one `frame:place` with `width === MIN_FRAME_WIDTH` (imported from
    `src/disk/layout.ts`), `x`/`y` unchanged. If A's left edge is too close to the viewport edge for
    that, first pan the stage right with a wheel over the empty stage.
  - Escape mid-drag: the frame returns to its start box and nothing is posted on release.
  - Agent wins: mid-drag (after the threshold), `postToChrome` the same `canvas:updated` with only
    A's `x` changed to start.x + 200 (`generation` unchanged, as after an MCP `place_frame`, which
    writes `canvas.json`, not the artboard). A shows the posted placement, and after release no
    `frame:place` was added to `posted`.
  - Host answer: after a successful drag, posting `canvas:updated` with the placed values keeps the
    frame there and reloads nothing.
  - **Done when:** those cases pass; the suite passes three runs in a row; `pnpm verify` still
    passes.

- [x] **4. Comment-mode picking and selectors** (`picking.spec.ts`; frame A =
  `fixtures/picking.html` at (0, 0) width 800; frame B at (1000, 0) width 400 with
  `<button id="b-target">B</button>`; seeded `{x: 0, y: 0, zoom: 1}`).
  - Clicks and hovers use `page.mouse` at the center of the target's screen box (frame box +
    element rect, zoom 1), never `locator.click()` (its scroll-into-view would scroll the root
    scroll sink and pan the stage). A target below the viewport is brought into view by a wheel
    over the empty stage first.
  - Interact (default): clicking `#change-button` in frame A changes `#status` text.
  - Toggle the Comment button (`aria-pressed` becomes `true`); hovering `#change-button` in A and
    `#b-target` in B each posts `cd:hover` (proof both frames got `cd:mode`).
  - Hover: the hover outline (`.overlay .outline.hover`) screen box equals frame box + element
    rect, within 1 px.
  - Click blocking, two sub-cases: a real click on `#change-button` leaves `#status` unchanged and
    posts one `cd:pick` with `tagName: 'button'`, and shows the pick outline and the chip
    (`.bar .chip` visible); a real click on `#link` leaves frame A's `location.hash` unchanged and
    posts one `cd:pick`.
  - Parent: after the `#change-button` pick, the toolbar "Select parent element" button posts a
    `cd:pick` whose selector resolves in A to `#change-button`'s `parentElement`; then, after
    another real click on `#change-button`, `ArrowUp` (frame focus) does the same.
  - Two frames: a pick in frame B, after one in frame A, leaves one pick outline (over B).
  - Toggling Comment off removes both outlines and clicks act again.
  - Selectors, real clicks in Comment mode. Expected element per case, located by a fixed locator
    in frame A (never recomputed with `elementsFromPoint` in the test):

    | Case | Click target / expected element |
    |---|---|
    | identical cards | `.cards > .card:nth-child(3)` |
    | duplicate id | second `p#dup` (`.traps > p:nth-child(2)`) |
    | colon id | `[id="a:b"]` |
    | scroll box | `.scroll-box > li:nth-child(12)` after scrolling `.scroll-box` to its bottom |
    | SVG | click the `path` in `svg.icon-paths`; expected `svg.icon-paths` (SVG internals pick the outermost `<svg>`) |
    | mutated list | the `li` the script inserted (`#mutated-list > li:nth-child(2)`) |
    | hit-test trap | click the center of `.trap .covered`; expected `.trap .covered`, not `.trap .overlay` |

    For each: the captured `selector` is non-null, `querySelectorAll(selector)` in frame A has
    length 1 and `=== expected`, and `selector` / `text` lengths stay within `MAX_SELECTOR_CHARS` /
    `MAX_PICK_TEXT_CHARS` (from `src/disk/layout.ts`).
  - `abortedRequests()` is not asserted in this spec (the fixture's media may hit it).
  - **Done when:** those cases pass; the suite passes three runs in a row.

- [x] **5. Docs and rules.**
  - `AGENTS.md` Commands: add `Browser tests: \`pnpm test:browser\`` (builds the chrome bundle, then
    Playwright Chromium over `tests/browser/`; first run needs
    `pnpm exec playwright install chromium`; local only, not Verify or CI). Replace the
    "Browser testing is opt-in" paragraph with that line.
  - `.claude/rules/09-tests.md`: add `tests/browser/**` to both `globs:` and `paths:`; replace "Do
    not test Svelte chrome or the artboard iframe as brittle unit tests. Prove those with F5." with:
    chrome and iframe behavior is proven by the browser tests (harness in
    `tests/browser/harness.ts`, reuse it), F5 only for Cursor-only checks (CSP, MCP registration,
    Extension Host, webview hide/show, Cursor focus); browser tests assert behavior through roles,
    `data-cd-*` hooks, captured messages and boxes, never pixels or timing sleeps beyond the one
    quiet window.
  - `.claude/rules/04-code-conventions.md`: add `tests/browser/**` to its `globs:` / `paths:` if it
    is scoped (lint enforces the mechanical part either way).
  - `.claude/rules/08-svelte-chrome.md`: the happy-dom line says components and iframe behavior are
    proven by the browser tests (09), not F5.
  - `.claude/rules/00-cursor-design-core.md` "Prove UI with **F5**": chrome and iframe behavior via
    `pnpm test:browser`, F5 for Cursor-only checks.
  - `blueprint/context/coding-standards.md`: the Stack "Verify UI" line (18), Testing "What not to
    test" (33) and Browser Verification (40–43) match rule 09 (drop "Do not add Playwright
    mid-feature"; keep "not part of default Verify/CI").
  - **Done when:** `pnpm verify` passes (it runs `scripts/check-agent-rules.mjs`, which fails on
    `globs:` / `paths:` drift); the `.cursor/rules/*.mdc` symlinks still resolve.

## Files / areas

- `package.json`, `pnpm-lock.yaml`: `@playwright/test` dev dep, `test:browser` script.
- `tests/browser/playwright.config.ts`, `tests/browser/harness.ts`, `tests/browser/stage.spec.ts`,
  `tests/browser/picking.spec.ts`; `tests/browser/tsconfig.json` only if step 1 needs it.
- `vite.config.ts` (lint override files list only), `knip.json`, `.gitignore`, `.vscodeignore`.
- `AGENTS.md`, `.claude/rules/00-cursor-design-core.md`, `.claude/rules/04-code-conventions.md`
  (scope only), `.claude/rules/08-svelte-chrome.md`, `.claude/rules/09-tests.md`,
  `blueprint/context/coding-standards.md`.
- Read, never edited: `dist/webview/*` (built), `fixtures/picking.html`, `src/webview/**`,
  `src/disk/layout.ts`, `src/panel/artboardChromeHtml.ts`.

## Data / contracts

No product contract changes. The harness reproduces the shipped host side of the webview
contract (rule 02, system map) closely enough for the chrome to run unmodified.

**Harness origin and routing.** Base URL `https://cd-harness.test/` (`.test` is a reserved TLD;
HTTPS so the page is a secure context like the webview). `context.route('**/*')`:

| Request | Response |
|---|---|
| `/` | the harness page (string from `harness.ts`) |
| `/<file>` that exists directly in `dist/webview/` | that file, content type from the extension (`.js`, `.css`, `.map`); a path with `/` or `..` after the leading slash is 404 |
| anything else on the harness origin | 404 |
| any other origin | aborted, counted |

Blob URLs are not routed; the chrome creates them in the page, as in the webview. Images or nested
frames in the fixture that would hit the network are aborted (in the webview CSP blocks them).

**Harness page.** Mirrors the body of `buildArtboardChromeHtml` (`src/panel/artboardChromeHtml.ts`)
exactly except the CSP meta, the nonce attributes and `asWebviewUri`: `<!DOCTYPE html>`,
`<html lang="en">`, head with `charset`, `viewport`, `<title>Cursor Design</title>` and
`<link rel="stylesheet" href="/chrome.css">`; body `<div id="svelte-root"></div>`, then one inline
classic script (the stub, before the chrome) and `<script type="module" src="/chrome.js">`. The
inline script defines:

```ts
// window.__cdHarness, read by the tests through page.evaluate
type HarnessRecord = {
	posted: unknown[]; // every chrome → host postMessage, in order (artboard:ready, frame:place)
	state: unknown; // last setState value (a structuredClone); getState returns a clone of it
	frameMessages: { frameId: string; data: unknown }[]; // window messages from a frame iframe
};
// acquireVsCodeApi() returns {
//   postMessage(m) { posted.push(structuredClone(m)) },
//   getState() { return structuredClone(state) },
//   setState(s) { state = structuredClone(s) },
// }
// Initial state from openHarness({ savedView }): { stageView: savedView } (the shape
// readSavedStageView in hostBridge.svelte.ts reads) or undefined.
```

The frame capture is a `message` listener added before the chrome loads. It records only events
whose `source` is the `contentWindow` of an iframe inside a `[data-cd-frame-id]` element (the
attribute is on the frame's wrapper `div`; frameId is its value); other messages are not recorded.
It never stops propagation and does not change what the chrome receives.

**Harness exports** (`tests/browser/harness.ts`):

```ts
openHarness(page: Page, options?: { savedView?: StageView }): Promise<{ abortedRequests: () => number }>
// routes, goto('/'), waits for artboard:ready in posted
postToChrome(page: Page, message: HostMessage): Promise<void> // window.postMessage(message, '*')
posted(page: Page): Promise<unknown[]>
savedState(page: Page): Promise<unknown>
frameMessages(page: Page, frameId?: string): Promise<{ frameId: string; data: unknown }[]>
loadsOf(page: Page, frameId: string): Promise<number> // cd:ready count for that frame
frameOf(page: Page, frameId: string): Promise<Frame> // Playwright Frame of that iframe
readPickingFixture(): string // fixtures/picking.html text
```

`StageView` and the host message types are `import type`d from `src/webview/`.

**Host → chrome.** `postToChrome` runs `window.postMessage(message, '*')` in the page.
`routeMessage` treats it as a host message (source is not a registered frame, origin is
`https://cd-harness.test`, not `'null'`). Messages use the shipped shapes from `hostMessages.ts`
(`CanvasUpdatedMessage`, `ui:status`, `artboard:error`). `openHarness` waits for `artboard:ready`
before returning, like `createPanelOutbox`. `CanvasUpdatedMessage.cspNonce` is a fixed string
(stamping still runs; no CSP enforces it). Frame `generation`: `html` changes bump it, placement
and label changes keep it.

**Observables the specs use.** Chrome DOM: `[data-cd-frame-id]` boxes, `[data-cd-frame-label]`,
`[data-cd-frame-resize]`, toolbar buttons by accessible name ("Comment", "Select parent element",
"Fit all"), the zoom readout `.bar .readout`, `.overlay .outline.hover` / `.pick`, the chip
`.bar .chip`. Harness record: `posted`, `state.stageView`, `frameMessages` (reload count =
`cd:ready` count per frame id). Frame DOM: `frameOf` for `#status` text, `location.hash`, element
boxes and `querySelectorAll(selector)` checks.

**Input.** Real Playwright mouse, keyboard and wheel events (trusted, `detail: 1` clicks), or CDP
`Input.synthesizeScrollGesture` for the latched pan if step 2 needs it. No synthetic
`dispatchEvent` in chrome or frames.

## Testing

- The specs above are the deliverable. Each asserts behavior a user would see or the host would
  receive; each regression test is mutation-checked where the plan names a past bug (F-51, F-52).
- Unit suite (`vp test`) unchanged: 307 tests, 28 files at the baseline (2026-10-25). No new pure
  logic in `src/`, so no new unit tests.
- Baseline `pnpm verify`: pass (2026-10-25, `main` at `9f3344d`).
- Not claimed by this suite: CSP, Cursor's Electron Chromium version, MCP, disk, Extension Host,
  hide/show state restore. Those stay F5.

## Notes for the AI

- Never edit `src/` in this feature. Mutation checks are local, reverted with
  `git checkout -- src/`, confirmed by an empty `git diff src/`, and followed by a rebuild of
  `dist/webview`. A real product bug found by the suite: stop, record it in
  `blueprint/context/findings.md` as the next `F-NN`, and tell the user (`/fix`).
- One harness module. Specs share it; no per-spec copies of the stub or routes, no page-object
  layer, no fixtures folder (inline frame pages are strings in the spec).
- Prefer `expect.poll` / auto-waiting locators over sleeps. The only fixed wait is the stability
  quiet window.
- The harness is the chrome's top-level document; in Cursor it is a webview iframe. Root scroll
  (the scroll sink) and out-of-process sandboxed frames behave the same in both, which is why the
  F-52 mutation check is required, not assumed.
- Prior scratch-harness evidence (08d2 archive, F-51 / F-52): about 8 reloads per second per frame
  before the F-51 fix; 98.5 of 600 px panned before F-52 and 600.1 after. Use these to sanity-check
  the new tests, not as asserted values.
- Rule 04 conventions apply to the test code (arrow functions, full names, `catch (error)`); lint
  enforces the mechanical part.
- The chrome uses pointer capture for drag and resize, but keep every pointer inside the viewport
  anyway so a test never depends on it.
- Record the mutation-check results and the chosen pan mechanism (mouse.wheel or CDP) here when
  step 2 is done.
- **Step 2 results (2026-10-26, /implement).** Pan mechanism: CDP `Input.synthesizeScrollGesture`
  with `gestureSourceType: 'mouse'` (not `'touch'`), and the config runs `channel: 'chromium'`
  (full Chromium, new headless) instead of the default headless shell. Why: in the headless shell
  `Target.getTargets` shows only `page` (the sandboxed blob frames are in process), so no input
  reproduces the latched gesture; with `channel: 'chromium'` both frames are `iframe` targets
  (out of process, as in Cursor). `mouse.wheel` steps pass with (b) applied in both builds (each
  event is hit-tested again). `'touch'` produces no wheel events: 0 px panned with or without the
  fix. Mutation (a) (`Frame.svelte` effect reads `html` / `id`): the stability test fails, A
  reloaded 12 times in about 1 s (the F-52 test also fails, 26.7 px). Mutation (b)
  (`handleSinkScroll` returns at once): only the F-52 test fails, 85.1 of 600 px (77.9 to 78.3 px
  in three earlier runs). Clean source: 600 px. Reverted with `git checkout -- src/`
  (`git diff src/` empty), then `pnpm test:browser --repeat-each=3` rebuilt `dist/webview` and
  passed 18/18. Deviation from the step text: the empty-stage wheel and zoom points are between
  frames A and B (x 700), since the stage right of frame B (x > 1400) is outside the 1280 px
  viewport at zoom 1.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":24494,"specSha256":"51a7785543fa2e70871de98eca06fe0702460df9340ee9fc953522e356eda57c","branch":"refs/heads/feature/browser-tests","head":"9f3344de8bd56832a8a2c062e221bb1020e1c474","baseRef":"refs/heads/main","baseCommit":"9f3344de8bd56832a8a2c062e221bb1020e1c474","sourceTree":"e4484bf3d81c41f01cdc2e98e573ff86db51ba36","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8d3/F-61 [P2] closed - The Comment-mode `#link` check cannot fail: sandboxed blob frames never follow a fragment link

**File:** tests/browser/picking.spec.ts:240
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** The sub-case says a Comment-mode click on `#link` "leaves `location.hash` unchanged". It can never fail in this harness. In a scratch probe, `location.hash` stayed `""` after a real Interact-mode click on `#link`, after `link.click()`, and even after `location.hash = '#manual'`. Removing `event.preventDefault()` from `blockInComment` (`src/webview/frame/commentPicking.ts`) still passes the test, so the one guard that stops a design's default actions in Comment mode has no browser check. (The button sub-case only proves `stopImmediatePropagation`.) The link pick is not even checked to be the link: only the pick count is asserted.
**Suggested fix:** Use the fixture's `<details><summary>`. In Comment mode, a real click on `summary` must leave `details.open === false` and post one `cd:pick` with `tagName: 'summary'`. Add an Interact-mode control where the same click opens it, so the probe is known to work. Scratch-probe evidence: with `preventDefault` removed, `details.open` became `true` (caught); on clean source it stayed `false`. Either drop the `#link` lines or keep them with `expect(pick.tagName).toBe('a')`.
**Resolution:** 2026-10-26 /implement (mutation-checked): the `#link` sub-case is replaced by `<details><summary>`. "Comment mode: clicks pick instead of acting" clicks `summary` and expects `tagName: 'summary'` and `details.open === false`; "Interact mode: a click reaches the design" is the control (the same click opens it). Removing `event.preventDefault()` from `blockInComment` turned the Comment-mode test red (`details.open` was `true`). Reverted, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-62 [P2] closed - The zoom-over-frame test cannot catch a wrong frame-wheel anchor

**File:** tests/browser/stage.spec.ts:192
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** The test zooms over frame A, which sits at stage (0, 0) under the seeded identity view `{0, 0, 1}`. So `stageToScreen({ view, stageX: frame.x + message.x, ... })` in `src/webview/App.svelte:237` equals the raw frame-local point. Mutation `const anchor = { x: message.x, y: message.y }`, which drops both the frame offset and the view, passes all four wheel and zoom tests. This anchor math lives only in the `.svelte` container, so no unit test reaches it either. Zooming over any frame not at the origin, or after any pan, would then zoom about the wrong point.
**Suggested fix:** Run the over-frame zoom with a non-identity mapping. Over frame B (stage x 1000, visible at screen x 1000 to 1280), and/or after a wheel pan of the empty stage (as `openDraggableStage` does), assert the same fraction-of-box invariant. Expected to fail under the mutation above.
**Resolution:** 2026-10-26 /implement (mutation-checked): "ctrl+wheel over a frame off the stage origin zooms at the cursor" now pans the view by (40, -60) first, then zooms over frame B (stage x 1000) and checks the fraction-of-box invariant. Red with `anchor = { x: message.x, y: message.y }` (212 px off) and with the view dropped but the frame offset kept (8.9 px off; this second mutation passed before the pan was added). Reverted, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-63 [P2] closed - Keyboard nudge, chrome-focus ↑/↓, Fit all and zoom presets have no browser test, and their handlers live only in `.svelte` files

**File:** src/webview/Stage.svelte:197
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** Rule 08 says a rule left in a `.svelte` file is a rule only the browser tests or F5 can catch. These pass the whole browser suite and are out of `vp test`'s reach: (1) `handleFrameKeyup` never committing (`heldArrows.size === -1`), so a keyboard nudge never writes; (2) `handleFit` returning early; (3) `handleWindowKeydown` never applying `arrowPickStep`, so ↑/↓ with chrome focus does nothing. Presets (`handlePreset`) are equally untested.
**Suggested fix:** Add to `stage.spec.ts`: Tab to label A (keyboard focus, so `revealFocused` runs), press ArrowRight three times and release. Expect exactly one `frame:place` with `x = 3 * NUDGE_STEP` (import from `stageGeometry.ts`), and `y` / `width` unchanged. Holding two arrows and releasing one posts nothing; Escape mid-nudge reverts and posts nothing. Pan the stage off the frames, click "Fit all": both frame boxes are inside `.viewport` and the readout is at most `100%`. Click a preset: the readout and the saved `stageView.zoom` match it, and the stage point at the viewport centre stays put. Add to `picking.spec.ts`: after a pick, click "Select parent element" (focus is now chrome), press ArrowDown, and expect one more `cd:pick` resolving back to `#change-button`.
**Resolution:** 2026-10-26 /implement (mutation-checked): "arrow keys on a focused label nudge and commit once on release" (red with `heldArrows.size === -1`, and with the size check removed: two posts instead of one), "Escape mid-nudge reverts and the release posts nothing" (red with the keyboard Escape `cancel` removed), "Fit all brings every frame into the viewport" (red with `handleFit` returning at once), "a zoom preset sets the zoom about the viewport centre" (red with `handlePreset` returning at once), "Comment mode: Parent, ↑/↓ with chrome focus, and ↑ with frame focus step the pick" (red with `handleWindowKeydown` never applying `arrowPickStep`). Reverted after each, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-64 [P2] closed - A failed `frame:place` answer and the banners are untested

**File:** src/webview/App.svelte:154
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** The host answers a failed drag commit with `canvas:updated` (disk equal to base) and then `artboard:error`. Only `failFrameGesture` in `handleHostMessage` drops the stuck preview. Removing `gesture = failFrameGesture(gesture)` from App passes the whole suite (the pure rule is unit-tested; the wiring is not). Without it, the frame stays drawn at the refused position and the next drag on it is swallowed. The `artboard:error` and `ui:status` banners (`Banners.svelte`) are not asserted anywhere.
**Suggested fix:** In `stage.spec.ts`: drag A, then post `canvas:updated` with A's base placement and `artboard:error { message }`. A's box returns to its base, the banner shows the message text, and a second drag posts a new `frame:place` with the same `base`. Also re-post a standing `artboard:error` mid-drag (active gesture): the preview must survive. Post `ui:status` with `mcpAvailable: false` and expect the MCP banner, and with `handoffStale: true` expect the toolbar's stale marker.
**Resolution:** 2026-10-26 /implement (mutation-checked): "a refused frame:place returns the frame, shows the error, and the next drag posts" (red with `gesture = failFrameGesture(gesture)` removed, and with the error banner forced hidden), "a standing artboard:error mid-drag keeps the drag preview" (red with `gesture = undefined` on every `artboard:error`), "ui:status shows the MCP banner and the stale-handoff marker" (red with `mcpUnavailable` or `handoffStale` forced false). Reverted after each, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-65 [P2] closed - No browser test for a frame that leaves or reloads while picked or hovered

**File:** src/webview/App.svelte:139
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** `applyCanvasUpdated` and `handleRenderError` call `keepLiveFrames`, and `cd:ready` re-sends the current `cd:mode`. Dropping the `keepLiveFrames` call from `applyCanvasUpdated` passes the whole suite. A deleted frame's pick then keeps its chip, the parent/child buttons send to a missing frame, and a last-frame delete leaves Comment mode on over an empty stage. The Agent `update_artboard` mid-pick path (new `html`, `generation` + 1, reload) is untested end to end, including "after a reload the frame is in Comment mode again".
**Suggested fix:** In `picking.spec.ts`, in Comment mode with a pick in A: (a) post `canvas:updated` without A: no `.outline.pick`, the chip is hidden, and Comment stays `aria-pressed=true` (B is live); (b) then post an empty frame list: `aria-pressed=false` and "No artboard yet." is visible; (c) on a fresh stage, pick in A, then post A with changed `html` and `generation` + 1: `loadsOf(A)` becomes 2, the pick outline is gone, and a new real click in A posts a `cd:pick` while `#status` stays unchanged (the reload got `cd:mode comment`).
**Resolution:** 2026-10-26 /implement (mutation-checked): "Comment mode: a picked frame leaving takes its pick; an empty stage ends Comment mode" (red with `keepLiveFrames` removed from `applyCanvasUpdated`: the chip stayed visible) and "Comment mode: an Agent edit reloads the picked frame once, drops the pick, and the reload picks again" (red with the `cd:ready` mode re-send removed from `applyPickMessage`, and with `cd:ready` keeping the frame's old pick). Reverted after each, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-66 [P3] closed - The "host answer keeps it" half of the drag test cannot fail

**File:** tests/browser/stage.spec.ts:282
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** After the host posts the placed values, the committing override and disk are equal, so the box is the same whether or not the gesture settled. Mutation: `settleFrameGesture` returns a committing gesture unchanged. That would leave every later drag on the frame swallowed (`start` keeps the old gesture), yet the browser suite passes. Only the unit test catches it.
**Suggested fix:** After the host answer, run a second label drag and expect a second `frame:place` with `base: { x: 53, y: 21, width: 400 }`.
**Resolution:** 2026-10-26 /implement (mutation-checked): "dragging a label posts one whole-pixel frame:place; after the host answer the next drag posts again" now runs a second drag and expects a second `frame:place` with `base: { x: 53, y: 21, width: 400 }`. Red with `settleFrameGesture` returning a committing gesture unchanged (one post instead of two). Reverted, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-67 [P3] closed - Drag and resize are tested only at zoom 1, so the gesture's view wiring is unpinned

**File:** src/webview/App.svelte:292
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** At zoom 1 a constant view offset cancels out of the stage delta. Passing a fixed `{ x: 0, y: 0, zoom: 1 }` instead of `stageView` to `stepFrameGesture` passes every drag, resize, Escape and Agent-wins test. A drag at 50% or 200% would then move the frame by the screen delta, not the stage delta.
**Suggested fix:** Zoom to a non-1 level first (a preset once F-63 lands, or ctrl+wheel and read the saved zoom). Drag the label by (+60, +20) screen px and expect `x = Math.round(60 / zoom)` and `y = Math.round(20 / zoom)` exactly. Drag the handle by +100 and expect `width = 400 + Math.round(100 / zoom)`.
**Resolution:** 2026-10-26 /implement (mutation-checked): "drag and resize at 50% zoom move by stage px, not screen px" sets the 50% preset, drags the label by (53, 21) screen px and expects (106, 42), then drags the handle by +100 and expects width 600. Red with `stepFrameGesture` given a fixed `{ x: 0, y: 0, zoom: 1 }` view. Reverted, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-68 [P3] closed - The cap assertions in the selector tests are circular

**File:** tests/browser/picking.spec.ts:85
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** `picksOf` keeps only picks that `parseFrameMessage` accepts, and that parser rejects a selector over `MAX_SELECTOR_CHARS` or text over `MAX_PICK_TEXT_CHARS` (`frameMessages.ts:150`, `:157`). So the `<= MAX_*` assertions (`:324`, `:325`, `:350`, `:351`) can never fail. A runtime that over-ran a cap would show up as a 5 s poll timeout in `pickInFrame`, with a misleading message.
**Suggested fix:** Check the raw captured `cd:pick` (`typedMessages`): assert the lengths on it, then assert that `parseFrameMessage(raw)` is defined. Or delete the four lines, since the sanitizers are unit-tested. No requirement is lost.
**Resolution:** 2026-10-26 /implement (verified by reading): the four circular `<= MAX_*` assertions are deleted, as the suggested fix allows. `picksOf` still runs captured picks through `parseFrameMessage`, which enforces the caps and is unit-tested; the selector cases assert a non-null selector that resolves to exactly the expected element. No `MAX_` import is left in `tests/browser/`. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-69 [P3] closed - Hostile `cd:*` messages from a design's own script are only unit-tested

**File:** tests/browser/picking.spec.ts
**Found:** 2026-10-26 by /audit (scope: current; lens: tests, security)
**Why it matters:** Rule 02 says a design's script can post any `cd:*` message. The guards (`routeMessage` by real `event.source`, `parseFrameMessage`, and `applyPickMessage` dropping hover and pick outside Comment mode) are unit-tested, with the mutation caught by `vp test`. Nothing proves them with a real window identity: a nested iframe inside a design, or a design posting a forged pick in Interact mode.
**Suggested fix:** An inline page for frame A whose script posts a valid-looking `cd:pick` and `cd:hover` to `parent` on load (Interact mode): no `.overlay .outline`, chip hidden. A nested `srcdoc` iframe in A posts `cd:frame-height { height: 5000 }` to `window.top`: A's box height is unchanged. In Comment mode, a forged `cd:pick` whose `text` has a control character: no chip change.
**Resolution:** 2026-10-26 /implement (mutation-checked): "Interact mode: a forged cd:hover and cd:pick from the design draw nothing" (red with the `!state.commentMode` guard removed from `applyPickMessage`: two outlines drawn), "Comment mode: a forged cd:pick with a control character changes nothing" (red with `hasControlChars` weakened: the chip showed `#forged`), "a nested iframe inside a design cannot post as its frame" (red with `routeMessage` treating an opaque-origin message as the frame: A grew to 5000 px). Reverted after each, `git diff src/` empty. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-70 [P3] closed - Spec helpers take 3 positional arguments (rule 04), and twin helpers are copied across the two specs

**File:** tests/browser/picking.spec.ts:66
**Found:** 2026-10-26 by /audit (scope: current; lens: quality)
**Why it matters:** Rule 04 (now scoped to `tests/browser/**`) wants an object for 3 or more parameters. `screenBox(page, frameId, selector)` and `elementRect(...)` take two swappable strings, and so do `typedMessages(page, frameId, type)`, `resolvesTo(page, selector, expected)`, `pickInFrame(page, frameId, point)`, `reveal(page, stage, target)` and `stage.spec.ts` `messageCount(page, frameId, type)`. These are helpers, not local factories. Ponytail: `boxOf` exists twice with different signatures, as do `centerOf` and `canvasUpdated`. `messageCount` and `typedMessages` are the same filter. The `typeof data === 'object' && data !== null && 'type' in data && data.type === T` guard appears five times (harness `isReady` and the `openHarness` wait, `framePlaces`, `messageCount`, `typedMessages`).
**Suggested fix:** Put one `messagesOfType({ page, frameId, type })` and one `boxOf(locator)` in `harness.ts` and use them from both specs. Pass object args to the 3-parameter helpers. No requirement is lost.
**Resolution:** 2026-10-26 /implement (verified by reading): every spec helper with 3 or more parameters takes one object (`elementRect`, `screenBox`, `pickInFrame`, `resolvesTo`, `reveal`, `zoomKeepsPointUnderCursor`). `harness.ts` owns the one `messagesOfType({ page, frameId, type })`, `isMessageOfType` (the only `type` guard), `boxOf(locator)`, `centerOf`, `canvasUpdated`, `frameBox`, `stageBox`, `clickAt`, `clickChrome`, and now `untilHeightReported`, which replaced the four copied height-report polls in the two specs' open helpers. No twin helper is left. Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-71 [P3] closed - The two spec files run in parallel on two workers

**File:** tests/browser/playwright.config.ts:6
**Found:** 2026-10-26 by /audit (scope: current; lens: tests)
**Why it matters:** `fullyParallel: false` only serializes tests within a file, and the run reports "using 2 workers". The 1 s stability quiet window and the 800 px/s CDP scroll gesture (F-52) share CPU with the other file. No flake was seen in 6 full runs this pass.
**Suggested fix:** If either test flakes, set `workers: 1` (about +5 s per run) before raising the quiet window.
**Resolution:** 2026-10-26 /implement (verified by reading and running): `tests/browser/playwright.config.ts` sets `workers: 1`, and every run reports "using 1 worker". Closed. 2026-10-26 /audit re-review (scope: current; all lenses): re-read the cited test(s) against the current code; the covering test is present, the builder's mutation evidence matches the assertions, and no new defect was introduced. Confirmed closed (the builder had set `closed`; this pass is the review that closes it).

### 8d3/F-72 [P3] closed - Rule 09's description still says it covers only Vitest unit tests

**File:** .claude/rules/09-tests.md:2
**Found:** 2026-10-26 by /audit (scope: current; lens: quality)
**Why it matters:** 8d3 scoped rule 09 to `tests/browser/**` and added the browser-test bullets, but the frontmatter `description` still reads "Vitest unit tests - colocated, cover the extracted job, temp dirs for disk, no Electron in the unit gate". Cursor and Claude Code use that line to decide relevance, so an agent touching browser tests may skip the rule that now governs them.
**Suggested fix:** Reword the description to cover both suites, for example "Tests - Vitest unit tests (colocated, extracted job, temp dirs, no Electron) and Playwright browser tests (one harness, behavior not pixels)". No requirement is lost.
**Resolution:** 2026-10-26 /implement: `.claude/rules/09-tests.md` description now names both suites (Vitest unit tests and Playwright browser tests). 2026-10-26 /audit re-check (scope: `.claude/rules/09-tests.md`; lens: quality): description matches the rule body and its `globs:` / `paths:` scope; `scripts/check-agent-rules.mjs` passes. Closed.

## Try it now

1. Once per machine: `pnpm exec playwright install chromium`.
2. `pnpm test:browser`: expect 36 passed and 1 skipped (the F-26 `test.fixme`, enabled by its own `/fix`).
3. Optional mutation check: in `src/webview/Frame.svelte`, make the blob effect read `html` instead of `frameHtml`, rerun, and see "frames load once and reload only when their html changes (F-51)" fail; then `git checkout -- src/`.
4. F5 stays for Cursor-only checks: CSP, MCP registration, webview hide/show, chat focus.
