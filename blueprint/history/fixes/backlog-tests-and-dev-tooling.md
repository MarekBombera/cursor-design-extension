# Fix: Backlog: tests and dev tooling

**Type:** Fix
**Status:** verified
**Branch:** fix/backlog-tests-and-dev-tooling
**Fixes:** F-15, F-38, F-83, F-112, F-143, F-149, plus the host ↔ chrome message drift guard
(no finding id; user-approved scope 2026-11-20: Bombic asked to fix every open problem from that
day's audits, and this was one)

## The problem

Open ledger findings that need no product behaviour change: missing test guards, a noisy watch
task, and one undocumented accepted look. Plus one guard with no finding id: the system map's
message table is checked only for `cd:*` names, not for host ↔ chrome names.

Every entry was re-read in full (Why it matters, Suggested fix, Resolution) and checked against
main `805018a`. Line numbers below are from `805018a`; find each site by its content.

### In scope

| Id | Gap today (verified) |
|---|---|
| F-15 | `.vscode/tasks.json:59` `npm: watch:webview` uses `pattern.regexp` `^.*$`, `message: 0`, so every Vite line becomes a Problem. Its background patterns are also wrong for the real output (below): `endsPattern` contains `watching for file changes`, which Vite prints **before** the first build, so the task reports ready about 1 s before `dist/webview/chrome.js` is written; a failed build (`Build failed with 1 error:`) never ends the cycle. |
| F-38 | No test calls `createArtboard` on an existing artboard. No test in `src/` references `ArtboardExistsError` / `ARTBOARD_EXISTS`. `artboardFs.test.ts:221` (symlinked html) covers only read and update. `initializeDefaultArtboard` (`src/host/artboardDisk.ts:42-56`) depends on both branches (`src/disk/artboardFs.ts:217-223`). |
| F-83 | `chromeMessages.test.ts:101` rejects test has 8 broken variants. No variant breaks `tagName`, `text` (cap, control chars), `generation` (negative, fractional), rect `width` / `height` (negative), `point` / `box` above `MAX_FRAME_COORDINATE`, a non-string `styles` value, or a non-string `frameId` / `body`. |
| F-143 | `canvasFrames.test.ts:273-299`: every post of a replaced hash uses generation 1 against 2 or 3, so deleting `&& entry.generation < record.generation` (`canvasFrames.ts:85`) fails no test. |
| F-149 | `handleEditAnswer` (`editState.svelte.ts:253-277`): when `adoptEditAnswer` returns `false` (a newer `canvas:updated` already reloaded the frame), the step is still announced and the frame is **not** reloaded again. No browser case reaches that branch. Only this one path (the finding's suggested fix); the other two paths it names (`historyFrameId` clearing, a repeated announcement) stay out and stay untested. |
| F-112 (remainder, per its 2026-11-18 Resolution) | (a) `pins.spec.ts:298`, `:302` count `.badge.stale svg` / `.badge.unchecked svg`, so a wrong icon passes. (b) No spec asserts the Comment-mode hint pill (`Stage.svelte:464`, `.mode-hint`) is `aria-hidden`; `picking.spec.ts:319-328` only checks visible / hidden by text. (c) `theme.spec.ts:97-104` checks the `--cd-spin` token, not a spinner's computed animation, so `Icon.svelte`'s `.spin { animation: var(--cd-spin) }` could become a literal and stay green. (d) The focused-frame ring (`Frame.svelte:139-143`) also shows on a mouse click into the frame; not documented as accepted. |
| (no id) | `frameMessages.test.ts:452-466` compares only the table's `cd:*` names with the frame constants. A `HostMessage` / `ChromeMessage` type missing from the "Message contract (shipped)" table in `blueprint/context/system-map.md`, or a table row naming an unknown type, fails nothing. |

Real watch output, captured 2026-11-20 on `805018a` (pipes, ANSI codes shown stripped). A pty
capture of `pnpm watch:webview` (Python `pty.fork`, as VS Code runs tasks in a pty) prints the
same lines plus `\x1b[2K\r` progress rewrites of `transforming (n) …` / `rendering chunks (n)...`;
`build started...` and `built in 451ms.` still arrive as whole lines wrapped only in colour codes:

| Command | First cycle | Rebuild after a touch | Failed build |
|---|---|---|---|
| `pnpm watch:webview` | `watching for file changes...`, `build started...`, `transforming...`, `✓ 180 modules transformed.`, `rendering chunks...`, `computing gzip size...`, two `dist/webview/...` size lines, `built in 1044ms.` | `build started...` … `built in 666ms.` | `build started...`, `transforming...`, `Build failed with 1 error:`, `[builtin:vite-transform] Unexpected token`, code frame lines (scratch entry with a syntax error, same `vp build --watch`) |
| `pnpm watch:pack` | `ℹ Build start`, dependency hints, size lines, `✔ Rebuilt in 193ms.` (extension), then `✔ Rebuilt in 245ms.` (mcp) | `ℹ Found …/src/extension.ts changed, rebuilding...` … `✔ Rebuilt in 189ms.` | `ℹ Build start`, `error: Build failed with 1 error:`, `[PARSE_ERROR] Unexpected token`, code frame lines (scratch entry, `vp pack --no-config --watch`) |

### Dropped, with evidence (no build step; `/audit` re-examines and marks them)

`/implement` does not touch these ledger entries. `/audit` re-reads each against the evidence
below and records the status given here; archived history under `blueprint/history/` is never
rewritten.

| Id | Status for `/audit` | Resolution to record |
|---|---|---|
| F-14 | `invalid`: re-examination shows the defect does not exist in watch mode | The finding extrapolated from one-shot `vp pack` (`✔ Build complete`). `vp pack --watch` prints `✔ Rebuilt in <n>ms.` on its **first** cycle too (table above), which `endsPattern` `Rebuilt in \d+ms` matches; a failed build prints `error: Build failed with 1 error:`, matched by `Build failed`; its `[PARSE_ERROR] Unexpected token` line matches the error `pattern`. `.vscode/tasks.json` `npm: watch:pack` stays unchanged. Known and accepted: the first cycle ends on the extension config's `Rebuilt in`, about 50 ms before the mcp config's. This evidence is a pipe capture: if the manual Cursor check in Verify shows `watch:pack` never reaching ready, `/audit` reopens F-14 (`open`) instead. |
| F-39 | `accepted`: user decision 2026-11-20 (Bombic) | Reason: the spec it would edit is archived (`blueprint/history/fixes/audit-quality-cleanup.md`), history is never rewritten, and there is no code impact. The finding itself and that archive's audit log (lines 105, 224, 229) already record the two unlisted init differences. |
| F-140 | `accepted` for parts 1-2: user decision 2026-11-20 (Bombic); part 3 resolved | Parts 1-2 (`--cd-placeholder` vs `--cd-fg-2`; the stale `chooseMode` done-when) target the archived 9e spec (`blueprint/history/features/09e-edit-fields-save.md`). Reason: history is never rewritten and there is no code impact; the code (`Inspector.svelte`) is the source of truth. Part 3 is resolved by the rules 05/08 rewrite: rule 05 no longer has a design-system entry, and rule 08's catalog (`.claude/rules/08-svelte-chrome.md:82`) says `theme.css` owns "host-competing element rules" without an element list, which covers the `input` rules. No live doc edit is left. |

### Out of scope

- Product code changes (the Fix B batch), including F-140's untested `CommentPicker.#setMode`
  same-mode guard and F-149's other two paths (`historyFrameId` clearing, a repeated announcement).
- The "never reload" test (`editMode.spec.ts:390`) uses the same one-animation-frame `loadsOf`
  check, which likely cannot see an out-of-process reload. A follow-up, not this fix.
- Findings still `unverified` that need triage (except F-149's one case above).
- Gallery helpers (`tests/browser/gallery/`).

## The fix

Tests, one dev-tooling config, one doc sentence (`system-map.md`) and one code comment
(`Frame.svelte`). No product behaviour change,
no new helper module, no dependency.

### 1. F-15: `.vscode/tasks.json` `npm: watch:webview`

- `pattern.regexp` `^.*$` → `(?!)` (never matches; keep `"message": 0`). Add one JSONC comment
  above it: build errors stay in the terminal, `svelte-check` reports diagnostics. Not `^$`: that
  matches every blank line.
- `beginsPattern` → `build started` (Vite's real start line, first cycle and every rebuild).
- `endsPattern` → `built in|Build failed` (drop `watching for file changes`, which fires before
  the first build; add the failure line so a failed rebuild ends the cycle; no `\\d+ms`, so a
  `built in 1.20s` still ends it).
- `npm: watch:pack` unchanged (F-14 above).

### 2. F-38: `src/disk/artboardFs.test.ts`

One temp-dir test after the "symlinked html is rejected" test (`:221`), named for the contract,
e.g. `createArtboard over an existing artboard: a file is ARTBOARD_EXISTS, a symlink is refused, nothing changes`.
Add `ArtboardExistsError` to the `./errors` import.

1. `createArtboard` `hero`. Read the html and meta bytes.
2. `createArtboard` `hero` again with other html: rejects with `ArtboardExistsError`
   (`error.code === 'ARTBOARD_EXISTS'`); html and meta bytes unchanged.
3. Replace the html with a symlink to an outside file (as `:221` does): `createArtboard` `hero`
   rejects with `DiskError` and the message
   `.cursor-design/artboards/hero.html must be a regular file (symlinks rejected).`; the outside
   file still reads its original text.

Guards it pins: deleting the `existingHtmlKind === 'file'` branch turns case 2 into a `DiskError`
(the next check throws for any non-missing kind); deleting the `!== 'missing'` branch turns case 3
into `ArtboardExistsError` (the `wx` write fails `EEXIST` on the link).

### 3. F-83: `src/host/chromeMessages.test.ts`

Add one line per missing variant to the existing array in
`comment:create rejects bad ids, selectors, numbers and shapes` (`:101`). Import
`MAX_FRAME_COORDINATE` and `MAX_PICK_TEXT_CHARS` beside `MAX_EDIT_TEXT_CHARS`.

`rect.width` / `rect.height`, `point` and `box` share one `size` schema (`chromeMessages.ts:30`),
and `point: { x: -1 }` already pins its lower bound. The four `size` rows pin each field's wiring
to it: each fails alone when only that field's schema becomes `z.number()` (or `coordinate`,
which allows negatives).

| Variant | Guard it pins (`chromeMessages.ts`) |
|---|---|
| `tagName: 'DIV'` | `isTagName` refine |
| `text: 'a'.repeat(MAX_PICK_TEXT_CHARS + 1)` | text `maxLength` |
| `text: 'a\u2028b'` (write the escape: U+2028 line separator, never a literal character) | text `noControlChars` |
| `generation: -1` | `z.gte(0)` |
| `generation: 1.5` | `z.int()` |
| `rect: { ...validCreate.rect, width: -1 }` | `rect.width` uses `size` |
| `rect: { ...validCreate.rect, height: -1 }` | `rect.height` uses `size` |
| `point: { x: MAX_FRAME_COORDINATE + 1, y: 0 }` | `size` upper bound (via `point.x`) |
| `box: { width: MAX_FRAME_COORDINATE + 1, height: 40 }` | `box.width` uses `size` |
| `styles: { color: 1 }` | `z.record(z.string(), z.string())` value |
| `frameId: 7` | `frameId: z.string()` |
| `body: 7` | `body: z.string()` |

The test title may grow to name the new kinds (for example "…bad ids, tags, text, numbers,
styles and shapes").

### 4. F-143: `src/webview/canvasFrames.test.ts`

In `after an adopt, the echo and any late pre-write read change nothing` (`:273`), after the
`kept` asserts: merge `posted('a', { generation: 2 })` (the replaced hash `sha256:a`, the same
generation as `echoed`) into `echoed` and assert the merged record's `hash === 'sha256:a'`,
`html === '<p>a</p>'`, `documentVersion === base().documentVersion + 1` and `replacedHashes` `[]`.
Not `documentHtml`: it is already `'<p>a</p>'` before the merge (adopting does not reload), so it
cannot tell the outcomes apart. One short comment: an outside revert to the replaced bytes keeps
the meta generation, so it must reload.

### 5. Message drift guard: `src/webview/frame/frameMessages.test.ts`

Smallest robust check: the TypeScript unions are the source, a typed literal makes the test's name
list provably complete, and the table is compared at runtime.

- Hoist the existing section read (`:453-457`) into a module-level arrow
  `const contractSection = (): string => …` that both tests call (one copy, not a twin; a missing
  map still fails inside the tests, not at import).
- `import type { ChromeMessage, HostMessage } from '../hostMessages'`.
- Two typed literals:
  `const HOST_TO_CHROME: Record<HostMessage['type'], true> = { 'canvas:updated': true, … }` (9
  keys) and `const CHROME_TO_HOST: Record<ChromeMessage['type'], true> = { 'artboard:ready': true, … }`
  (9 keys). A union type the literal lacks is a missing-property error; a key the union lacks is
  an excess-property error. Both fail `pnpm verify` (type-aware `vp check`, and
  `tsc -p tsconfig.webview-tests.json`, which includes `src/webview/**/*.test.ts`). One comment
  says so: a new message type fails as a missing property, a removed one as an excess property.
- New test, e.g. `system map message contract names exactly the host and chrome messages`: for
  each `matchAll` of `/^\| (host → chrome|chrome → host) \| ([^|]+) \|/gm`, group 1 is the
  direction and group 2 the Message cell; every backticked name in the cell (`/`([^`]+)`/g`)
  counts, so a future multi-name row (like the frame table's `cd:pick-parent`, `cd:pick-child`)
  is checked too. `assert.deepEqual` each direction's `Set` with `new Set(Object.keys(…))`.
- The host parser needs no extra name check: `parseChromeMessage` returns `ChromeMessage`, and
  each of the 18 type names already appears in its parser's test file (`chromeMessages.test.ts`,
  `hostMessages.test.ts`), so this guard checks names only.
- `blueprint/context/system-map.md:778` closing sentence: say the test also fails when the
  `host → chrome` / `chrome → host` names differ from the `HostMessage` / `ChromeMessage` types.

### 6. F-149: `tests/browser/editMode.spec.ts`

One new test after `Undo posts a step; its answer reloads…` (`:667`), e.g.
`a canvas:updated before the step answer reloads once; the answer still announces`:

1. `openEditStage`, `enterEditMode`, `saveTitleEdit`; `loads = await loadsOf(page, 'a')`.
2. Click Undo; poll `historyPosted` to 1; keep the request.
3. Post the watcher's refresh first:
   `canvasUpdated([{ ...EDIT_FRAME, hash: 'sha256:restored', generation: 3, canUndo: false, canRedo: true }])`.
   Poll `loadsOf` to `loads + 1`; `#title` reads `Title`.
4. Post `stepAnswer({ request: undo, html: EDIT_FRAME.html, hash: 'sha256:restored', generation: 3, canUndo: false, canRedo: true })`.
   The record's hash is no longer the step's base (`sha256:new`), so `adoptEditAnswer` returns
   `false`. Just before posting it, read the iframe's blob URL:
   `const src = await page.locator('[data-cd-frame-id="a"] iframe').getAttribute('src')`.
5. `historyAnnouncement` matches `/^Undone in Edit\.\s?$/` (as at `:699`); then
   `expect(await page.locator('[data-cd-frame-id="a"] iframe').getAttribute('src')).toBe(src)`
   and `expect(await loadsOf(page, 'a')).toBe(loads + 1)`. Redo is enabled.

Why `src`, not a `loadsOf` wait: a wrongful reload is a new out-of-process blob document whose
`cd:ready` arrives well after one animation frame, so counting loads cannot see it in time.
`reloadFrame` and the announcement happen in the same `handleEditAnswer` call; Svelte applies both
in one flush, in which `Frame.svelte`'s `attachIframe` effect sets `iframe.src` to a new blob URL.
So once the announcement shows, any reload has already changed `src`. No extra wait.

### 7. F-112 remainder

- (a) `tests/browser/pins.spec.ts:298`, `:302`: import `ICONS` from `../../src/webview/ui/icons`
  and replace each `svg` count with its icon's one `path`:
  `await expect(pinOf(page, TITLE.id).locator('.badge.stale svg path')).toHaveAttribute('d', ICONS.warning[0].path)`
  and `await expect(pinOf(page, MOVER.id).locator('.badge.unchecked svg path')).toHaveAttribute('d', ICONS.question[1].path)`.
  `ICONS` is `as const`, so those indexes type-check as `path` shapes (warning = path, circle;
  question = circle, path, circle), and `toHaveAttribute` fails if more than one `path` matches.
  A literal icon name, not `flagBadge`, so a wrong mapping fails.
- (b) `tests/browser/picking.spec.ts`, after `:323` (Comment mode, hint visible):
  `await expect(page.locator('.mode-hint')).toHaveAttribute('aria-hidden', 'true')`.
- (c) `tests/browser/commentsPanel.spec.ts`, in `Reply opens a focused composer…` after the
  pending `aria-busy` check (`:183`) and **before** `comment:saved` is posted (the spinner is gone
  after it): the pending button's `svg.spin` computed `animationName` is `cd-spin`; after
  `page.emulateMedia({ reducedMotion: 'reduce' })` it polls to `none`. The emulation stays on for
  the rest of the test; nothing after it depends on motion. It lives here, not in `theme.spec.ts`,
  because this is the spec that already renders a pending spinner; `theme.spec.ts` keeps its token
  checks (including Cursor's `vscode-reduce-motion` class).
- (d) `src/webview/Frame.svelte:139`: extend the existing CSS comment
  `/* Drawn inside: the frame clips anything outside its box. */` by one sentence, e.g. "The ring
  follows `document.activeElement` (Stage's `focusedFrameId`), so it also shows after a mouse
  click into the frame; accepted." No claim about `:focus-visible`. Comment only; rule 08 still
  applies: in Claude Code the edit goes to the `svelte-file-editor` agent, `list-sections` first,
  `svelte-autofixer` on the full file after.

Must not break: every existing unit and browser assertion; `vp check` format, lint and type check;
the `cd:*` half of the drift guard.

## Build steps

1. **Dev tooling (F-15).** Edit `.vscode/tasks.json` as in fix 1. Done when:
   - each new pattern, run as a JS `RegExp` over the captured lines in the table above: `(?!)`
     matches none; `beginsPattern` matches `build started...`; `endsPattern` matches
     `built in 1044ms.`, `built in 1.20s.` and `Build failed with 1 error:` but not
     `watching for file changes...`;
   - a fresh `pnpm watch:webview` capture under a pty (Python `pty.fork`; `script` needs a real
     terminal), run about 10 s, touch a `.svelte` file, stop, ANSI stripped: still prints
     `build started...` and `built in …` as whole lines; nothing under `src/` changed and no
     watcher is left running;
   - `pnpm verify` passes.
2. **Unit guards (F-38, F-83, F-143, drift guard).** Fixes 2-5. Done when:
   - `pnpm verify` passes, with Vitest at 731 tests (729 + the F-38 test + the drift-guard test);
   - each new assertion was seen failing once with its guard removed, then the guard restored
     (not committed): the two `createArtboard` branches; each of the 12 F-83 rows (or every one
     you can break without a type error), the four `size` rows each with only that field's schema
     set to `z.number()`; `&& entry.generation < record.generation`;
     the drift guard with one table row deleted, with a bogus `host → chrome` row added, and
     (`tsc -p tsconfig.webview-tests.json` / `vp check`) with `| { type: 'ui:bogus' }` added to
     `HostMessage`;
   - `git diff --stat` shows no `src/` file changed other than the four test files.
3. **Browser guards and the ring note (F-149, F-112).** Fixes 6-7. Done when:
   - `pnpm test:browser` reports **165 passed, 198 skipped** (baseline 164 / 198 on `805018a`,
     recorded 2026-11-20; +1 for the F-149 test);
   - seen failing once with the guard removed, then restored: F-149 with `if (adopted)` dropped
     (reload always; run that test with `--repeat-each 3`; it fails on the `src` assertion every
     time), the hint with `aria-hidden` removed, the spinner with `.spin`'s `animation` set to a
     literal `cd-spin 0.9s linear infinite`, a flag with another icon name in `FLAG_BADGES`;
   - `git diff --stat` shows `src/webview/Frame.svelte` as the only `src/` file this step changed,
     and otherwise only `tests/browser/editMode.spec.ts`, `pins.spec.ts`, `picking.spec.ts` and
     `commentsPanel.spec.ts` (so `editState.svelte.ts`, `Stage.svelte`, `Icon.svelte` and
     `pins.ts` are restored);
   - `svelte-autofixer` is clean on `Frame.svelte`; `pnpm verify` passes.

## Verify

- `pnpm verify` (Vitest 731 tests; `vp check` formats, lints and type-checks `tests/browser/**`).
- `pnpm test:browser` (local only): 165 passed, 198 skipped.
- Manual, Cursor only (an agent cannot run a VS Code task): Terminal → Run Task → `watch`. Both
  watchers reach ready without a file touch, the Problems panel stays empty, and saving a
  `.svelte` file runs one more webview cycle that ends.
- If the manual check shows `watch:pack` never reaching ready, F-14 is reopened (see Dropped).
- Ledger: `/implement` marks F-15, F-38, F-83, F-112, F-143, F-149 `fixed`. F-149's Resolution
  says only the adopt-`false` path is now covered; its other two paths (`historyFrameId`
  clearing, a repeated announcement) remain untested and out of scope. `/audit` re-examines them
  and records F-14 (`invalid`), F-39 (`accepted`) and F-140 (`accepted`, part 3 resolved) as in
  Dropped.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":20881,"specSha256":"665f28553d92e8edf23d27f1b1e1f119fded2ff9fdd1ff7a5a248cc112e785e3","branch":"refs/heads/fix/backlog-tests-and-dev-tooling","head":"805018acf2ab9d61c58cc775c439f5b3e6637ac4","baseRef":"refs/heads/main","baseCommit":"805018acf2ab9d61c58cc775c439f5b3e6637ac4","sourceTree":"23788b1fddf2090210e60fce638af24bacc0ef38","landing":"local-merge","absentOptional":[]} -->

## Completion gates

- Verify: `pnpm verify` passed at completion (`vp check` clean over 202 files; Vitest 59 files, 731 tests; pack and webview build).
- Browser: `pnpm test:browser` reported 165 passed, 198 skipped at completion (main `805018a`: 164 / 198).
- Audit: `/audit current` ran, clean; nine findings closed, F-14 `invalid`, F-39 and F-140 `accepted` (Bombic's decision 2026-11-20).
- Independent review: not selected (`when-sensitive`; tests, dev tooling and one comment, no sensitive category).
- Check: `manual`, not requested.
- Try guide: `when-testable`; the watch task config is directly observable in Cursor (below).

## Findings

### backlog-tests-and-dev-tooling/F-14 [P2] invalid - Watch matcher misses the `vp pack` success line

**File:** .vscode/tasks.json:41
**Found:** 2026-10-20 by /audit (scope: current; lens: quality)
**Why it matters:** The `npm: watch:pack` matcher is `activeOnStart: true` and ends only on `Rebuilt in <n>ms` or `Build failed`. Both `vp pack` and `vp pack --minify --no-sourcemap` in this pass printed `Build start` then `✔ Build complete in <n>ms` (once per pack config). That success line does not match `endsPattern`. If the first watch cycle uses the same logger as one-shot pack, the VS Code `watch` task never becomes ready until a later incremental `Rebuilt in` (the spec captured that string after a file touch; this pass could not re-run watch outside the sandbox). F5 still uses `preLaunchTask: compile`, so the Extension Host path is not blocked.
**Suggested fix:** Add `Build complete` to `endsPattern`, or wrap `watch:pack` so it prints the old `[watch] build started` / `[watch] build finished` lines the spec already allowed. Confirm the VS Code `watch` task reaches ready without a file touch.
**Resolution:** 2026-10-21 /audit (scope: current; 7b vp check) re-read `.vscode/tasks.json:41`. `endsPattern` is still `Rebuilt in \\d+ms|Build failed`. 7b dropped `watch:tsc`, so the VS Code `watch` task now depends only on this matcher. This pass's `pnpm compile` printed `Build start` then `✔ Build complete in 38ms` / `79ms` and no `Rebuilt in`. Defect remains. VS Code watch ready still not observed.
2026-10-21 /audit (scope: current; 7d Electron suite home) re-read `.vscode/tasks.json:41` after the watch-tests deletion. `endsPattern` is unchanged (`Rebuilt in \\d+ms|Build failed`). 7d left the matcher as the spec required. This pass's `vp pack` printed `✔ Build complete in 36ms` / `78ms` and no `Rebuilt in`. Defect remains. Watch task ready still not observed.
2026-10-21 /audit (scope: current; 8a Svelte toolchain) re-read `.vscode/tasks.json:41` after `watch` gained `npm: watch:webview`. `endsPattern` is still `Rebuilt in \\d+ms|Build failed`. This pass's `vp pack` printed `Build start` then `✔ Build complete in 31ms` / `70ms` and no `Rebuilt in`. Defect remains. The composite watch task now also waits on this matcher, so 8a's webview watcher cannot make `watch` ready by itself. VS Code watch ready still not observed.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): invalid. The finding extrapolated from one-shot `vp pack` (`✔ Build complete`). `vp pack --watch` prints `✔ Rebuilt in <n>ms.` on its first cycle too (pipe capture recorded in the fix spec), which `endsPattern` `Rebuilt in \\d+ms` matches; a failed build prints `error: Build failed with 1 error:` (matched by `Build failed`) and `[PARSE_ERROR] Unexpected token` matches the error `pattern`. `npm: watch:pack` stays unchanged. Known and accepted: the first cycle ends on the extension config's `Rebuilt in`, about 50 ms before the mcp config's. Pipe capture only: if the manual Cursor Run Task check shows `watch:pack` never reaching ready, reopen as `open`.

### backlog-tests-and-dev-tooling/F-15 [P2] closed - Watch:webview matcher reports every Vite line as a problem

**File:** .vscode/tasks.json:59
**Found:** 2026-10-21 by /audit (scope: current; lens: quality)
**Why it matters:** 8a added `npm: watch:webview` with `pattern.regexp` `^.*$` and `message: 0`. VS Code applies that pattern to task output, so every Vite log line becomes a Problem (`transforming...`, `built in`, rebuilds). The background `beginsPattern` / `endsPattern` already match this pass's one-shot Vite output (`transforming...`, `built in`). F5 uses `compile`, so the Extension Host path is not blocked, but the new watch task 8a added is noisy as soon as someone runs `watch`.
**Suggested fix:** Use a never-matching regexp (`^$`) or an error-only pattern. Keep the existing background begins/ends. Confirm the Problems panel stays clean during `watch:webview`.
**Resolution:** 2026-11-20 /implement (fix/backlog-tests-and-dev-tooling): `npm: watch:webview` `pattern.regexp` is now `(?!)` (never matches; `^$` would match blank lines), `beginsPattern` `build started`, `endsPattern` `built in|Build failed` (drops `watching for file changes`, which Vite prints before the first build). Patterns checked as JS `RegExp` over captured watch lines; a pty capture of `pnpm watch:webview` still prints `build started...` and `built in …` as whole lines. Manual Cursor Run Task check (Problems panel empty, both watchers ready) still pending.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. `.vscode/tasks.json` `npm: watch:webview`: `pattern.regexp` `(?!)` matches no line (checked as JS `RegExp` over the captured lines, the blank line included), so no output becomes a Problem; `beginsPattern` matches only `build started...`, `endsPattern` matches `built in 1044ms.`, `built in 1.20s.` and `Build failed with 1 error:` and not `watching for file changes...`. The pty capture (what VS Code tasks read) prints both lines whole. Closed on that evidence; the in-Cursor Run Task check (Problems empty, both watchers ready) is still a manual Verify step for Bombic, and a failure there reopens this entry.

### backlog-tests-and-dev-tooling/F-38 [P3] closed - Default-artboard init depends on createArtboard branches no test covers

**File:** src/host/artboardDisk.ts:48
**Found:** 2026-10-23 by /audit independent (scope: current; lens: tests)
**Why it matters:** `initializeDefaultArtboard` now falls back to `setActiveArtboard` only when `createArtboard` throws exactly `ArtboardExistsError`, and the spec's first behavior change (a symlinked or non-file `artboard.html` is refused) rests on `createArtboard`'s `layoutEntryKind` check (src/disk/artboardFs.ts:218-224). No unit test calls `createArtboard` on an existing regular file, a symlink, or a directory: no test in `src/` references `ArtboardExistsError` / `ARTBOARD_EXISTS`, and the symlink test (artboardFs.test.ts:221) covers only read and update. If that branch changed (another error class for an existing file, or following the symlink), first panel open in a workspace that has `artboard.html` but no manifest would show an error banner, or write through a link, and nothing in `pnpm verify` would fail. The host glue itself is `vscode`-bound and F5-only (rule 09), so the disk contract is the place to pin it. F5 after the refactor has not run.
**Suggested fix:** Add one temp-dir test in `src/disk/artboardFs.test.ts`: create `hero`, then `createArtboard` again rejects with `ArtboardExistsError` and leaves html and meta bytes unchanged. Then replace the html with a symlink to an outside file: `createArtboard` rejects with `DiskError` and the target is untouched. No product change.
**Resolution:** 2026-11-20 /implement (fix/backlog-tests-and-dev-tooling): `artboardFs.test.ts` `createArtboard over an existing artboard…`: a regular file rejects with `ArtboardExistsError` (`ARTBOARD_EXISTS`) and leaves html and meta bytes unchanged; a symlinked html rejects with the `DiskError` regular-file message and leaves the target untouched. Seen failing with each branch removed.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. Re-read the new `artboardFs.test.ts` case against `createArtboard` (`artboardFs.ts:217-223`). Proved: deleting the `existingHtmlKind === 'file'` branch fails it, and deleting the `!== 'missing'` branch fails it (file restored each time).

### backlog-tests-and-dev-tooling/F-39 [P3] accepted - Fix spec lists two init behavior changes; a third is unlisted

**File:** blueprint/context/current-feature.md:52
**Found:** 2026-10-23 by /audit independent (scope: current; lens: quality)
**Why it matters:** The spec (and F-30's Resolution) says "Everything else is unchanged" after two stricter init cases. Comparing with the base host code, there are two more. (1) No manifest, `artboard.html` missing, but a valid `artboard.meta.json` (same id) present: the old host kept that meta, so the recreated artboard read at stored generation + 1. `createArtboard` now overwrites it with generation 1, so the generation moves backward (same as MCP `set_artboard`). (2) No manifest, `artboard.html` present, corrupt-JSON meta: the old host rewrote the meta, but the new path leaves the corrupt file. It still reads as missing, so the panel output is the same. Neither is a defect (both match MCP), but this spec is the archived record of what the branch changed. A later generation-conflict report would point at the wrong commit.
**Suggested fix:** Add one bullet to the spec's Behavior changes: "a leftover meta for a deleted `artboard.html` is replaced (generation restarts at 1), and a corrupt meta beside an existing `artboard.html` is left in place." Docs only.
**Resolution:** 2026-11-20 /audit current: accepted by Bombic's explicit decision in this session (2026-11-20). Reason: the spec it would edit is archived (`blueprint/history/fixes/audit-quality-cleanup.md`), history is never rewritten, and there is no code impact. The finding and that archive's audit log already record the two unlisted init differences.

### backlog-tests-and-dev-tooling/F-59 [P3] closed - sameRect is only pinned on x, so a dropped y, width or height comparison passes every test

**File:** src/webview/frame/pickTarget.test.ts:189
**Found:** 2026-10-25 by /audit (scope: current; lens: tests)
**Why it matters:** `sameRect` (`pickTarget.ts:42`) now decides whether a scroll re-post is skipped, and it is the only thing that sees a vertical scroll: `point` is relative to the target box, so it stays equal when the anchor and target scroll together. The new test moves only `x` (`rect(11, 20, 30, 40)`), and nothing else imports `sameRect`. In a scratch copy, removing the `y`, the `width` or the `height` comparison left all 12 `pickTarget.test.ts` tests green. With `y` dropped, a vertical page or box scroll would be skipped as "unchanged" and the outline would stay behind the moved element; only the snapshot (which mirrors the source text) would notice a source change, and it is regenerated on purpose.
**Suggested fix:** In the existing `isUnchangedPick` test, add three lines that change only `y`, only `width` and only `height` of the rect and expect `false`. No product change.
**Resolution:** 2026-10-25 /implement (audit repair): `isUnchangedPick`'s test now also changes only the rect's `y`, `width` and `height`, each expecting `false`. Dropping `left.y === right.y` from `sameRect` fails it (mutation-checked, file restored byte for byte).
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. `pickTarget.test.ts:198-202` changes only x, y, width and height in turn and expects `false`; `sameRect` (`pickTarget.ts:41-47`) compares all four.

### backlog-tests-and-dev-tooling/F-83 [P3] closed - Host comment:create guards for tagName, text, generation, rect size and styles have no test that fails when they go

**File:** src/host/chromeMessages.test.ts:96 (guards at src/host/chromeMessages.ts:30-40)
**Found:** 2026-10-27 by independent /audit (scope: current; lens: tests, security)
**Why it matters:** `commentCreateSchema` is the host's only parse of untrusted chrome input before `addComment`. The rejects test covers requestId, selector length and newline, a NaN rect x, a negative point, a missing box and a string isPage. Nothing exercises `tagName` (`isTagName`), `text` (cap and control characters), a negative or fractional `generation`, a negative rect width or height, a point or box above `MAX_FRAME_COORDINATE`, a non-string `styles` value or a non-string `frameId`/`body`. Removing any of those checks keeps every test green (rule 09: a test earns its place when deleting its guard fails it). `addComment` re-validates most of them, so this is a missing check, not an open hole.
**Suggested fix:** Add the missing broken variants to the existing array in the rejects test (one line each). No product change.
**Resolution:** 2026-11-20 /implement (fix/backlog-tests-and-dev-tooling): `chromeMessages.test.ts` comment:create rejects test gained 12 rows (tagName, text cap, U+2028, negative and fractional generation, negative rect width / height, point and box above `MAX_FRAME_COORDINATE`, non-string style value, frameId, body). Each seen failing with its guard removed (`point.x` upper bound via `size`'s `z.lte`; with `point.x` alone as `z.number()` the existing `x: -1` row fails first).
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. The rejects test holds the 12 new rows. Spot-proved: `size` without its `z.lte(MAX_FRAME_COORDINATE)` and `generation` as `z.number()` each fail the test (file restored).

### backlog-tests-and-dev-tooling/F-91 [P3] closed - The host's copy-type check twins chromeMessages' private isCopyType

**File:** src/host/panelComments.ts:105 (owner at src/host/chromeMessages.ts:83)
**Found:** 2026-11-17 by independent /audit (scope: current; lens: quality)
**Why it matters:** `refuse` re-spells `type === 'comment:copy' || type === 'comment:copy-open'`, while `chromeMessages.ts` already owns that rule as the unexported `isCopyType` (used by `fallbackMessage` and `malformedRequestMessage`). Rule 05 asks for one owner per rule. A future copy request type must be added in both places, or its failures stop being followed by the `comments:updated` refresh while its error copy still says "Could not copy". No current behavior is wrong.
**Suggested fix:** Export `isCopyType` from `chromeMessages.ts`, use it in `refuse`, and add it to the rule 05 catalog line. Nothing to delete beyond the inline condition; no current requirement is lost.
**Resolution:**
2026-11-17 fix/share-the-copy-type-check: `isCopyType` exported from `chromeMessages.ts`, `refuse` in `panelComments.ts` calls it, rule 05 lists it. `pnpm verify` green (512 tests); the copy-failure tests in `panelComments.test.ts` still assert the refresh. Awaits `/audit` to close.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. One owner: `isCopyType` in `src/host/panelRequestCopy.ts:38` (rule 05 lists it there); `panelComments.ts:105` calls it; no other `=== 'comment:copy'` check outside tests.

### backlog-tests-and-dev-tooling/F-112 [P3] closed - Accessibility polish from the critical review

**File:** several (src/webview/ui/Badge.svelte:22, CommentsPanel.svelte:215, CommentCard.svelte:270, :185, zoomChoices.ts, tests/browser/pins.spec.ts)
**Found:** 2026-11-17 by critical review (accessibility and behavior)
**Why it matters:**
- Badge descriptions are exposed twice (title and hidden text).
- "Copied N comments" renders in the disabled look.
- The kbd hints are read aloud as symbols.
- PinChip reads a bare number.
- A non-preset zoom option sits before 50%, so arrow keys jump.
- The frame inset ring also shows on mouse click (accept and document).
- The stale / unchecked pin assertion moved from glyph text to "has an svg".
- Untested: the reply composer's pending state, the hint pill being `aria-hidden`, and the spinner actually stopping under reduced motion.

**Suggested fix:**
- Put `title` on an `aria-hidden` wrapper.
- No disabled look while copied (a click guard instead).
- `aria-hidden` on the hints.
- Visually hidden "Comment " before the number.
- Insert the current zoom in sorted position.
- Assert the flag icon by name.
- Add the three missing assertions.
- Name the zoom select in the inset-ring contrast exception.

**Resolution:**
2026-11-17 Batch A part: the zoom select slots a non-preset zoom in sorted place (`zoomChoices.test.ts`). The rest (Badge description, Copied look, kbd hints, PinChip context, flag icon, the three missing assertions) is Batch B.
2026-11-17 Batch B part: Badge's `title` sits on an `aria-hidden` face with the label and description as hidden text (exposed once); "Copied N comments" is never drawn disabled (`handoffCopy`), and `submitCopyOpen` ignores a click while the feedback shows (tested); the composer key hints are `aria-hidden`; PinChip reads "Comment N"; the reply composer's pending "Adding…" with `aria-busy` is asserted. Still open: the flag icon asserted by name, the hint-pill `aria-hidden` and reduced-motion spinner assertions.
2026-11-18 /audit current (fresh reviewer, all lenses): re-examined; still open for: the stale / unchecked flag icon asserted by name (`pins.spec.ts` still counts `svg`); an assertion that the Comment-mode hint pill is `aria-hidden` (specs only check visible / hidden by text); the spinner itself stopping under reduced motion (`theme.spec.ts` checks the `--cd-dur` / `--cd-spin` tokens, not the spinner's computed animation); the frame inset ring showing on mouse focus is not yet documented as accepted. Confirmed done: Badge description exposed once, Copied never disabled-looking with the `copiedShowing` click guard, `aria-hidden` key hints (Composer, toolbar C), PinChip "Comment N", sorted non-preset zoom, the zoom select named in the step 5 contrast exception, reply pending `aria-busy` asserted.
2026-11-20 /implement (fix/backlog-tests-and-dev-tooling): the remainder. (a) `pins.spec.ts` asserts the stale / unchecked badge path `d` against `ICONS.warning` / `ICONS.question`; (b) `picking.spec.ts` asserts `.mode-hint` is `aria-hidden`; (c) `commentsPanel.spec.ts` asserts the pending spinner's computed `animationName` is `cd-spin`, then `none` under reduced motion; each seen failing with its guard broken. (d) the focus ring on a mouse click is documented as accepted in `Frame.svelte`'s ring comment.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. The remainder holds: pins badge paths asserted against `ICONS.warning[0]` / `ICONS.question[1]` (`pins.spec.ts:299-309`), `.mode-hint` `aria-hidden` asserted (`picking.spec.ts:324`), the pending spinner's computed `animationName` goes `cd-spin` to `none` under reduced motion (`commentsPanel.spec.ts:184-190`), and the mouse-focus ring is documented as accepted (`Frame.svelte:139-141`). The touched specs pass (108 passed).

### backlog-tests-and-dev-tooling/F-117 [P3] closed - Pin stacking only catches tips that round to the same pixel, with no ponytail note

**File:** src/webview/pins.ts:262 (`layoutPins`, the `tip` key)
**Found:** 2026-11-18 by /audit (scope: current; lens: quality)
**Why it matters:** The stack key is the tip rounded to whole screen px. Two tips 0.2 px apart that straddle a .5 boundary (10.45 and 10.55) get different keys and still draw one pin over the other; so do nested targets whose corners differ by a 1 px border or a few px of padding (the later 24 px pin covers almost all of the earlier one, at any zoom above 1 more so). Same-element comments (the reported case) always share a key, so F-115 holds; this is the near-coincident remainder. It is a deliberate heuristic with a known ceiling, and rule 03 asks for a `ponytail:` comment naming it and the upgrade path; there is none.
**Suggested fix:** Add a `ponytail:` note on `pinsAtTip` naming the ceiling (exact-pixel match; near-coincident tips still overlap) and the upgrade path (step a pin whose tip is within one pin width of an earlier placed tip). No behavior change needed unless Bombic wants the wider rule.
**Resolution:**
2026-11-18 fix/pin-stacking-and-zero-copy: `ponytail:` note on `pinsAtTip` in `layoutPins` names the exact-pixel ceiling and the upgrade path (step any pin within one pin width of an earlier tip). Comment only; awaits a later `/audit` to close.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. The `ponytail:` note on `pinsAtTip` (`pins.ts:226-228`) names the exact-pixel ceiling and the upgrade path.

### backlog-tests-and-dev-tooling/F-140 [P3] accepted - Spec and owner catalog drift: computed colour token, stale chooseMode done-when, input rules missing from rule 05

**File:** blueprint/context/current-feature.md:213
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** Three places where the archived spec or the owner catalog no longer says what the code does: (1) the spec says the computed colour text uses the placeholder colour (`--cd-placeholder`); `Inspector.svelte:181-184` deliberately uses `--cd-fg-2` (its comment: the placeholder colour misses 4.5:1 on light themes). The code is the better choice, the spec is stale. (2) Step 3 done-when (current-feature.md:185) still asks `commentPick.test.ts` to cover "`chooseMode` ... same mode sends nothing", but the same-mode guard moved to `CommentPicker.#setMode` (spec line 138) and `chooseMode` always sends; no test pins that guard (low stakes: only Interact → Interact reaches it, with no pick or draft to lose). (3) Rule 05's design-system entry lists the host-competing element rules as `kbd`, `textarea`, `select`; `theme.css` now also owns the global `input:not([type])` / `input[type='text']` rules and `textarea:disabled, input:disabled`. Rule 05 says keeping the catalog current is part of the change.
**Suggested fix:** Docs only: in the spec, say the computed colour text uses `--cd-fg-2` and drop "same mode sends nothing" from the `chooseMode` done-when; in `.claude/rules/05-single-job.md` add the text `input` rules to the host-competing element list. No code change, no requirement lost.
**Resolution:** 2026-11-20 /audit current: parts 1-2 accepted by Bombic's explicit decision in this session (2026-11-20). Reason: they target the archived 9e spec (`blueprint/history/features/09e-edit-fields-save.md`), history is never rewritten, there is no code impact, and the code (`Inspector.svelte`) is the source of truth. Part 3 is resolved by the rules 05/08 rewrite: rule 05 no longer has a design-system entry, and rule 08's catalog says `theme.css` owns "host-competing element rules" without an element list, which covers the `input` rules.

### backlog-tests-and-dev-tooling/F-143 [P3] closed - The stale pre-write skip's generation guard has no test that fails without it

**File:** src/webview/canvasFrames.ts:87
**Found:** 2026-11-19 by /audit independent (scope: current; lens: tests; fresh subagent claude-opus-5-5)
**Why it matters:** `isStalePreWrite` skips a post only when its hash is in `replacedHashes` **and** `entry.generation < record.generation`. The generation half is load-bearing: an outside revert to the replaced content (the user undoes the panel save in the editor and saves) posts the replaced hash with the same meta generation (`canvasView.ts:223`, an editor save does not bump meta), and must merge and reload. Without the guard the frame keeps showing the adopted copy while disk holds the reverted bytes, and the next save is refused as a conflict. Every `canvasFrames.test.ts` case that posts a replaced hash uses an older generation (`posted('a', { x: 40 })`, generation 1 against 2/3), so deleting `&& entry.generation < record.generation` fails no test (rule 09: a test earns its place when deleting its guard makes it fail).
**Suggested fix:** One assertion in `after an adopt, the echo and any late pre-write read change nothing`: merge `posted('a', { generation: 2 })` (replaced hash, same generation) into `echoed` and expect `documentHtml === '<p>a</p>'`, a version bump and `replacedHashes` `[]`. Test only; no requirement lost.
**Resolution:** 2026-11-20 /implement (fix/backlog-tests-and-dev-tooling): `canvasFrames.test.ts` now merges a post of the replaced hash at the record's own generation after the echo and asserts it reloads (hash, html, `documentVersion + 1`, empty `replacedHashes`). Seen failing with `&& entry.generation < record.generation` removed.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed. The new merge of the replaced hash at the record's own generation reloads (hash, html, `documentVersion + 1`, empty `replacedHashes`). Proved: removing `&& entry.generation < record.generation` (`canvasFrames.ts:85`) fails `after an adopt, the echo and any late pre-write read change nothing` (file restored).

### backlog-tests-and-dev-tooling/F-149 [P3] closed - Chrome-side step paths have thin evidence

**File:** src/webview/editState.svelte.ts (`handleEditAnswer`, `handleFramesChanged`), src/webview/canvasState.svelte.ts (`adoptEditAnswer`)
**Found:** 2026-11-20 by /audit (scope: current; lens: tests; fresh subagent claude-sonnet-5-5)
**Why it matters:** Only browser specs cover these, and three paths have none: a step answer whose adopt returns `false` (a newer post won: no reload, still announced), `historyFrameId` clearing when its frame leaves, and a repeated announcement re-speaking. The spec's Done-when list does not require them; no failing path found.
**Suggested fix:** Optional: one browser case posting a `canvas:updated` before the step answer covers the `false` branch.
**Resolution:** 2026-11-20 /implement (fix/backlog-tests-and-dev-tooling): only the adopt-`false` path is now covered: `editMode.spec.ts` `a canvas:updated before the step answer reloads once; the answer still announces` (iframe `src` unchanged after the answer, one reload, announcement shown). Seen failing 3/3 with `if (adopted)` dropped. The other two paths (`historyFrameId` clearing, a repeated announcement) remain untested and out of scope.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): closed for its suggested fix (the adopt-`false` branch). Proved: with `if (adopted)` forced true the new `editMode.spec.ts` case fails 3/3 on the iframe `src` assertion (file restored). The other two paths (`historyFrameId` clearing, a repeated announcement) remain untested, out of this fix's scope by the spec.

## Try it now

In Cursor, with this repo open: Terminal > Run Task > `watch`.

- Expected: `watch` reaches ready (both `watch:pack` and `watch:webview`) without a file touch, and the Problems panel stays clean while `watch:webview` rebuilds after you save a `.svelte` file.
- Incorrect: Vite lines (`transforming...`, `built in …`) show up as Problems (reopens F-15), or `watch:pack` never reaches ready (reopens F-14).
