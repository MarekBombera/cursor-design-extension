---
description: Tests - Vitest unit tests (colocated, cover the extracted job, temp dirs for disk, no Electron in the unit gate) and Playwright browser tests (one harness, behavior not pixels)
globs: **/*.test.ts,tests/browser/**
paths:
  - "**/*.test.ts"
  - tests/browser/**
alwaysApply: false
---

# Tests

- Runner: `vp test` (Vitest) over `src/**/*.test.ts`, excluding `src/test/**`. `src/test/**` is the Electron `vscode-test` suite (`pnpm test`); it needs a display and is not the unit gate.
- Colocate `foo.test.ts` next to `foo.ts`. Cover the extracted job (parse, layout, conflict, handoff, tool handlers), not the `activate` wrapper.
- One runnable check per non-trivial logic (03). Assert edge cases: empty, missing, malformed, stale generation.
- Edge cases over volume: one happy path per rule is enough. Spend tests on the case that would break it (a message from the wrong frame, a key someone else owns, a null rect, the last frame leaving), not on twenty variations of the normal flow. A test earns its place when deleting the guard it covers makes it fail.
- Disk tests write to a fresh `mkdtemp(join(tmpdir(), ...))` workspace and remove it after. Never touch `fixtures/dev-workspace` or a real `.cursor-design/`.
- MCP behavior goes through the real tool handlers or the client contract test (`artboardTools.contract.test.ts`, InMemoryTransport), not hand-built JSON-RPC.
- Properties (`fast-check`) for geometry and parsing invariants. Snapshots only for generated artifacts (handoff markdown, canvas HTML); update them on purpose, never blindly.
- Do not test Svelte chrome or the artboard iframe as unit tests. Chrome and iframe behavior is proven by the browser tests (`pnpm test:browser`, Playwright Chromium over the built bundle; harness in `tests/browser/harness.ts`, reuse it). F5 only for Cursor-only checks: CSP, MCP registration, Extension Host, webview hide/show, Cursor focus.
- Browser tests assert behavior through roles, `data-cd-*` hooks, captured messages and boxes, never pixels or timing sleeps beyond the one stability quiet window.
- Local factories stay in the test file. Lint relaxes `id-length` and return types in tests only.
