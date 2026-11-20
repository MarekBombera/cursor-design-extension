# Backlog: tests and dev tooling - Overview for review

Source of truth: `blueprint/history/fixes/backlog-tests-and-dev-tooling.md`. This file is the steering summary, not the build spec.

**Branch:** `fix/backlog-tests-and-dev-tooling` · **Type:** Fix · **Status:** verified, completing

## TL;DR

Clears the open findings that need no product behaviour change: missing test guards (F-38, F-83,
F-143, F-149, the F-112 remainder), a noisy watch task (F-15), and one new guard with no finding
id (user-approved scope) that checks the system map's message table against the host ↔ chrome
message types. Three findings left the ledger without a build step: F-14 `invalid` with evidence,
F-39 and F-140 `accepted` by Bombic's decision (2026-11-20). `/audit current` was clean and also
closed F-59, F-91 and F-117. No message, disk format or process
flow changes, so there is no data-flow chart.

## What you will see

No change in the product. The `watch` task no longer fills the Problems panel with every Vite
line and reports ready only after the chrome bundle is written. Vitest grows by two tests
(729 → 731) and the browser suite by one (164 → 165 passed, 198 skipped).

## Architecture decisions

| Finding | Before | After |
|---|---|---|
| F-15 | Webview watch matcher turns every line into a Problem; ends on `watching for file changes`, which Vite prints before the first build | Never-matching problem pattern; begins on `build started`, ends on `built in` or `Build failed` (checked against a pty capture) |
| F-38 | No test for `createArtboard` over an existing artboard | One temp-dir test: a file is `ARTBOARD_EXISTS`, a symlink is refused, nothing changes |
| F-83 | Host `comment:create` rejects test misses 12 guards | One broken variant per guard in the same array; the four shared-`size` rows each pin one field's wiring |
| F-143 | Deleting the stale-skip generation check fails nothing | A replaced hash at the same generation merges and reloads (asserted on `hash`, `html`, `documentVersion`) |
| F-149 | No case for a step answer that lost to a newer `canvas:updated` | One browser test: one reload, still announced; no second reload, proved by the iframe `src` staying put once the announcement shows |
| F-112 | Flag icons counted, hint pill and spinner untested, frame ring on click undocumented | Icon asserted by its path, hint `aria-hidden` asserted, spinner stops under reduced motion, a comment accepts the ring |
| (no id) | Table checked for `cd:*` names only | Also host → chrome and chrome → host names, against typed `Record<…['type'], true>` lists |

## Decisions locked

- **F-14 is wrong, not open.** Real `vp pack --watch` prints `✔ Rebuilt in <n>ms.` on its first
  cycle, so the pack matcher already ends; its failure line matches too. No change.
- **F-14 is `invalid` unless the manual check disagrees.** A `watch:pack` that never reaches ready
  in Cursor reopens it.
- **F-39 and F-140 (parts 1-2) are `accepted`:** Bombic's decision 2026-11-20. They target archived
  specs, history is never rewritten, no code impact. F-140 part 3 is resolved by the rules 05/08
  rewrite.
- **F-149's no-reload check reads the iframe `src`.** Reload and announcement land in one Svelte
  flush, so `src` is final once the announcement shows; counting `cd:ready` after one animation
  frame would miss an out-of-process reload.
- **Drift guard is names only.** The typed literals make the test's lists complete at type-check
  time; each type already has a parse test, so parser coverage needs nothing new.
- **Spinner check lives in `commentsPanel.spec.ts`,** the spec that already renders a pending
  spinner; `theme.spec.ts` keeps the token checks.
- **Every new assertion is seen failing once** with its guard removed, then the guard restored;
  `git diff --stat` after each step proves the product files are back.

## Your actions

- In Cursor: Terminal > Run Task > `watch`. Both watchers reach ready without a file touch and the
  Problems panel stays clean while `watch:webview` rebuilds. A failure reopens F-15 (Problems) or
  F-14 (`watch:pack` never ready).

## Out of scope

- Product code changes (Fix B), including F-149's other two paths (they stay untested) and F-140's
  untested same-mode guard.
- The older "never reload" test's same one-frame blind spot (a follow-up).
- Unverified findings that need triage.
- Gallery helpers.

## Glossary

| Term | Why it exists |
|---|---|
| Problem matcher | VS Code reads a task's output with regexes: `pattern` makes Problems, `beginsPattern` / `endsPattern` mark a background task busy or ready |
| Message contract table | The "Message contract (shipped)" table in `system-map.md`, the normative list of every message between host, chrome and frame |
| Stale pre-write skip | A refresh that read disk before the user's own save is ignored, but only when its generation is older |

## Done means

- `pnpm verify` passes with 731 Vitest tests (passed at completion).
- `pnpm test:browser` reports 165 passed, 198 skipped (passed at completion).
- In Cursor, Run Task `watch`: both watchers reach ready and the Problems panel stays empty (yours, above).
- Ledger: F-15, F-38, F-83, F-112, F-143, F-149 (and F-59, F-91, F-117) `closed`; F-14 `invalid`;
  F-39 and F-140 `accepted`; all archived with the fix. F-56 and F-57 stay `fixed` in the ledger.
