# Browser tests (8d3) - Overview for review

> **Generated file.** Human-facing steering summary of the active work item:
> same content as `current-feature.md`, trimmed. Written at `/feature` when the
> spec is created, and kept current if the spec is revised. `/complete` may
> polish this into the archive-ready one-pager; it is not the first write.
> Open in Markdown preview to render the diagrams.

Source of truth: `blueprint/history/features/08d3-browser-tests.md`. This file is the steering summary, not the build spec.

## TL;DR

`pnpm test:browser` runs 37 Playwright tests (Chromium only) against the **real built chrome** and
the **real frame runtime**, inside a harness page with a fake VS Code host. 36 pass, and 1 is a
`test.fixme` for the open F-26 bug. It replaces the scratch harness and most F5 clicking for chrome
and iframe behavior. Local only: not in Verify or CI. No product code changed.

## What you will see

- Frames don't reload-loop (F-51); a trackpad pan that leaves a frame keeps panning (F-52). Both
  tests were shown to fail with their fix reverted.
- Wheel pan and ctrl+wheel zoom at the cursor (over frames, off the stage origin, and over the empty
  stage), Fit all, zoom presets.
- Drag and resize (whole-px, minimum width, at 100% and 50% zoom), arrow nudge, Escape revert,
  Agent wins mid-drag, a refused `frame:place`, error and status banners.
- Comment mode: hover and pick outlines, clicks blocked (including `<details>` default actions),
  Parent and ↑/↓ from chrome and frame focus, picks moving between frames, a frame leaving or
  reloading under a pick, forged `cd:*` messages from a design ignored.
- Real-click selectors on `fixtures/picking.html` that match exactly one named element (identical
  cards, duplicate and colon ids, SVG, mutated list, hit-test trap, scrolled box).
- After the audit, each test that guards behavior failed under at least one deliberate product
  mutation (F-61 to F-72, archived).

## Data flow (8d3 test harness)

```mermaid
sequenceDiagram
  participant T as Playwright test (Node)
  participant R as Route handler (https://cd-harness.test)
  participant P as Harness page (stub acquireVsCodeApi + capture)
  participant C as Chrome (built chrome.js)
  participant F as Frame iframes (blob + real runtime)
  T->>R: openHarness: page.goto('/') (savedView seeded into getState)
  R-->>P: harness HTML; /chrome.js, /chrome.css (files in dist/webview)
  C->>P: getState() → { stageView } (cloned)
  C->>P: postMessage artboard:ready (recorded in posted)
  T->>C: postToChrome canvas:updated / ui:status / artboard:error (routeMessage: host)
  C->>F: blob URL: stamped HTML + runtime
  F->>C: cd:ready, cd:frame-height, cd:frame-wheel, cd:hover, cd:pick
  F-->>P: same messages copied to frameMessages by frame id (observe only)
  C->>F: cd:mode, cd:pick-parent, cd:pick-child
  T->>C: real mouse / wheel / keyboard; CDP scroll gesture for the latched pan
  C->>P: postMessage frame:place (recorded) · setState { stageView } (cloned)
  R--xP: any other origin aborted (counted)
  T->>F: read frame DOM (status text, details state, selector match)
```

The chrome runs unmodified: host messages arrive as `window` messages with a non-`null` origin,
exactly as in the webview. The shipped product flows are unchanged (system map).

## Decisions locked

- Playwright routing from a fake HTTPS origin: no dev server, no port, no network.
- The harness has **no CSP**; CSP stays an F5 check.
- One harness module (`tests/browser/harness.ts`), two spec files, one worker, full Chromium
  (`channel: 'chromium'`) so sandboxed frames are out of process, as in Cursor.
- The F-52 pan uses CDP `Input.synthesizeScrollGesture`; plain `mouse.wheel` cannot reproduce the
  latched gesture.
- Bugs the suite finds go to `/fix`; this feature never edited `src/`.

## Out of scope

Verify / CI integration, Firefox and WebKit, screenshots, CSP, MCP, Extension Host, hide/show,
Cursor focus, `canvas.html` (F-28), and everything from 8e on.

## Glossary

| Term | Why it exists |
|---|---|
| Harness | A fake webview page that loads the real chrome bundle and records what it sends to the host |
| Mutation check | Breaking the product code on purpose to prove a test can fail |
| Latched gesture | Chromium keeps a trackpad scroll on the frame where it started, even after the frame moves away |
| `test.fixme` | A test kept but skipped until its bug (F-26) is fixed |

## Your actions

- Once per machine: `pnpm exec playwright install chromium`.
- `pnpm test:browser` (add `--repeat-each=3` with no `--` before it to check for flakes).
- F-26 (stage stuck after the Agent removes a dragged frame) needs its own `/fix`; that fix enables
  the `fixme` test.

## Done means

`pnpm verify` passes (307 unit tests), `pnpm knip` is clean, and `pnpm test:browser` gives
36 passed and 1 skipped. Checked 2026-10-26.
