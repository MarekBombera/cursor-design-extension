---
description: Tests - Vitest unit tests (colocated, cover the extracted job, temp dirs for disk) and Playwright browser tests (one harness, behavior not pixels)
globs: **/*.test.ts,tests/browser/**
paths:
  - "**/*.test.ts"
  - tests/browser/**
alwaysApply: false
---

# Tests

- Runner: `pnpm test` / `vp test` (Vitest) over `src/**/*.test.ts`.
- Colocate `foo.test.ts` next to `foo.ts`. Cover the extracted job (parse, layout, conflict, handoff, tool handlers), not the `activate` wrapper.
- One runnable check per non-trivial logic (03). Assert edge cases: empty, missing, malformed, stale generation.
- Edge cases over volume: one happy path per rule is enough. Spend tests on the case that would break it (a message from the wrong frame, a key someone else owns, a null rect, the last frame leaving), not on twenty variations of the normal flow. A test earns its place when deleting the guard it covers makes it fail.
- Disk tests write to a fresh `mkdtemp(join(tmpdir(), ...))` workspace and remove it after. Never touch `fixtures/dev-workspace` or a real `.vibeboard/`.
- MCP behavior goes through the real tool handlers or the client contract test (`artboardTools.contract.test.ts`, InMemoryTransport), not hand-built JSON-RPC.
- Properties (`fast-check`) for geometry and parsing invariants. Snapshots only for generated artifacts (handoff markdown, canvas HTML); update them on purpose, never blindly.
- Do not test Svelte chrome or the artboard iframe as unit tests. The one exception is `src/webview/ui/theme.test.ts`: a static text scan of the chrome's CSS and markup (rule 08 Guard); it renders nothing. Chrome and iframe behavior is proven by the browser tests (`pnpm test:browser`) through the one harness `tests/browser/harness.ts`; pass `vscodeHost` to `openHarness` to run under Cursor's theme variables and `_defaultStyles` (`tests/browser/vscodeHost.ts`), otherwise the page has neither.
- Browser tests assert behavior through roles, `data-cd-*` hooks, captured messages and boxes, never pixels or timing sleeps beyond the one stability quiet window. Shared locators and helpers live in `harness.ts`; a spec imports them, never re-declares them.
- Tests run in parallel (`parallel` project, `tests/browser/playwright.config.ts`). A test that needs the CPU to itself (the quiet window, a CDP gesture, shared output files) or flakes under `--repeat-each=3` takes `{ tag: '@serial' }`: the `serial` project runs it alone, after the rest.
- The one exception to the no-wait rule is `gallery.spec.ts` (`pnpm gallery`, `CD_GALLERY=1`, local only, never Verify or CI): evidence, not a gate. It takes screenshots and measures contrast, so it may wait for paint and settle animations.
- Local factories stay in the test file. Lint relaxes `id-length` and return types in tests only.
