# Fix: Lean export and helper sweep

**Type:** Fix
**Status:** verified
**Branch:** fix/lean-export-and-helper-sweep

Quality wave 1, from the Opus 5.5 + Sonnet 5.5 adversarial quality review (2026-11-23); spec rewritten after the Breaker + Literalist review. Deletions and dedupe only: no behavior change, no new dependency, no new abstraction, no custom scripts.

## The problem

- **Test-only exports are invisible.** `knip.json` lists `src/**/*.test.ts` as entries, so an export only a test uses counts as used. knip 6.45.1 production mode (config below) reports **1 unused file and 51 unused exports** today, for example `parseCommentsFile`, `serializeCommentsFile`, the `HINT_*` and `*_MESSAGE` constants, `artboardToolInputSchemas`, `PAGE_ID_PATTERN`. Each one widens a module interface an agent must read. Verify does not run knip at all, so nothing stops new dead or test-only exports.
- **Twin helpers.** `isFiniteNumber` is written three times (`src/webview/hostMessages.ts:244`, `src/webview/frame/frameMessages.ts:167`, `src/disk/canvasLayout.ts:39`). `isRecord` (`hostMessages.ts:238`) and `asRecord` (`frameMessages.ts:206`) are the same array-accepting check in two shapes. Rule 05 calls a twin a bug.
- **Pass-through re-exports.** `src/disk/artboardFs.ts:64-71` re-exports `canvasView` and `exportFs` while `artboardEditFs` is deliberately not re-exported, an exception agents must remember. `src/host/artboardDisk.ts:32` re-exports from `canvasSnapshot`.
- **Noisy passing tests.** Green `pnpm test` runs print `cursor-design MCP: DiskError: ... (symlinks rejected)` stacks, written by the private `logMcpError` in `src/mcp/mcpToolResult.ts:53` (`process.stderr.write`) when MCP tool tests hit the symlinked `canvas.json` path, plus one `cursor-design: comment target read failed:` line from `logStderr`.

Out of scope: exported `*Args` / other types used only in their own file (knip production mode does not report types, so no gate can hold them; hand-cleaning without a gate drifts back); the twin dispose-hooked flags, request preamble, refresh path, frame cache key, ports and `parseHostMessage` (build-plan item 11).

## The fix

**knip production gate.** `knip.json`:
- Mark with `!` the three shipped entries (`src/extension.ts!`, `src/mcp/server.ts!`, `src/webview/main.ts!`; there are no other bundle entries) **and** the two source project globs (`src/**/*.ts!`, `src/webview/**/*.{ts,svelte}!`). Leave the test, browser-test, `vite.webview.config.ts` and `scripts/` patterns unmarked.
- Test-only support files leave the production project with a negated production glob: `"!src/**/*.cases.ts!"` (today only `src/disk/selectorMatch.cases.ts`, shared by unit, oracle and browser tests).
- Before any code change, `pnpm exec knip --production` lists 1 file and 51 exports; if it does not, stop and report.

`package.json` `verify` becomes exactly:
`vp check && node scripts/check-agent-rules.mjs && knip && knip --production && svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings && tsc -p tsconfig.webview-tests.json && vp test && vp pack && vp build -c vite.webview.config.ts`

Docs in the same diff: the AGENTS.md Verify command string (Commands section), its `Other scripts` line (knip now also in Verify), and `blueprint/context/coding-standards.md:17` (knip runs in Verify, both modes).

**Each production finding** resolves one way, in this order:
1. **Un-export** when the test can assert through the module's real interface (assert copy through the function that returns it, not the constant).
2. **Delete** when nothing but the test uses it.
3. **Keep as a seam** with a `/** @internal */` JSDoc tag only when the test must pin it and cannot reach it otherwise. Expected keeps: `artboardToolInputSchemas` and `commentToolInputSchemas` (the `agentSkill.test.ts` drift guard AGENTS.md names). `@internal` hides an export from `--production` only; plain `knip` still counts the test import, which is intended. Every keep is listed in the implementation notes with its reason.

A test never loses an assertion, only its import path.

**One helper each.**
- `src/webview/frame/frameMessages.ts` (already on rule 05's "chrome reused by host or disk" list and already in the frame runtime bundle) exports the one `isFiniteNumber` and the one array-accepting `isRecord` (`value !== null && typeof value === 'object'`).
- Callers import from it: `hostMessages.ts`, `canvasLayout.ts`, `savedState.ts` (today `./hostMessages`). `hostMessages.ts` stops exporting both; no re-export anywhere.
- `asRecord`'s 8 sites in `frameMessages.ts` become `if (!isRecord(value)) return undefined;` and use `value` directly.
- `src/disk/parse.ts` `isJsonRecord` stays: it rejects arrays for disk JSON, a different job. Rule 05 says so.
- The frame runtime iife is embedded in the exported `canvas.html`, so the `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` copies change. Regenerate them on purpose and confirm the diff is only the helper rename and move.

**No pass-throughs.** Delete the re-export blocks in `artboardFs.ts` and `artboardDisk.ts`; every caller imports from the owner. Wherever a production import path changes, repoint the matching `vi.mock(...)` / dynamic `import()` in tests (known case: `src/host/artboardDisk.test.ts:34` mocks `../disk/artboardFs` for `readCanvasView`; grep `vi.mock` for `artboardFs`, `canvasSnapshot`, `hostMessages`).

**Catalogs (same diff).**
- Rule 05: reword the `artboardFs.ts` line to its real job (artboard create / update / set-active / place ops and `validateNewArtboardArgs`), drop "the one artboard-ops import path" and the `artboardEditFs` exception note; the `canvasView.ts` / `exportFs.ts` lines say callers import them directly; the "Chrome reused by host or disk" line adds `isFiniteNumber`, `isRecord`; the `parse.ts` line names `isJsonRecord` as disk's array-rejecting guard.
- Rule 08: the `frame/frameMessages.ts` line adds the two helpers.
- The catalogs list exported helpers only: an un-exported "the one X" helper (for example `colorDisplay` in rule 08) leaves its catalog line if it becomes internal.

**Quiet tests.** In the MCP tool tests that hit the symlinked `canvas.json` path, `vi.spyOn(process.stderr, 'write')` (restored after each test) and assert it was called with the `DiskError` line where that log is the expected behavior. Same for the test that triggers `comment target read failed` (spy `process.stderr.write`, assert the line).

Must not break: every existing unit and browser test (836 unit, 209 browser) keeps its assertions; all four bundles build (`dist/extension.js`, `dist/mcp.js`, `dist/webview/chrome.js`, frame runtime iife); the shipped Agent skill and wire contracts are untouched.

## Build steps

- [x] **1. One helper each, no pass-throughs.**
  - Twin helpers into `frameMessages.ts`; callers and `vi.mock` targets repointed; both re-export blocks deleted; snapshot regenerated and reviewed; rule 05 and 08 catalog lines updated.
  - **Done when:** `grep -rnE "const (isFiniteNumber|isRecord|asRecord) =" src --include='*.ts'` prints one `isFiniteNumber` and one `isRecord`, both in `frameMessages.ts`, and no `asRecord`; `grep -nE "^export (type )?\{|^export \* from" src/disk/artboardFs.ts src/host/artboardDisk.ts` prints nothing; the `.snap` diff touches only the helper code; `pnpm test` green.
- [x] **2. knip production gate.**
  - `knip.json` as above; sanity run lists 1 file and 51 exports (minus any removed in step 1, e.g. the `FRAME_READ_ERROR_MESSAGE` re-export), then resolve every finding by the three-way rule; `verify` string and docs updated.
  - **Done when:** `pnpm exec knip` and `pnpm exec knip --production` both exit 0; the implementation notes list every `@internal` keep with its reason and the unit-test count delta with each deleted test named.
- [x] **3. Quiet passing tests.**
  - stderr spies as above.
  - **Done when:** on a green run, `pnpm test 2>&1 | grep -c "DiskError"` prints 0 and `pnpm test 2>&1 | grep -c "comment target read failed"` prints 0.

## Verify

- `pnpm verify` green (now including both knip runs).
- `pnpm test:browser` green, 209 pass.
- Mutation checks: (a) re-add `export` to `HINT_UNCHECKED` in `src/disk/commentTarget.ts` after it is resolved: `pnpm exec knip --production` fails; (b) remove `@internal` from `artboardToolInputSchemas`: `pnpm exec knip --production` fails; restore both.

## Implementation notes

**Baseline.** With the new `knip.json`, `pnpm exec knip --production` listed 0 files and 51 exports before any code change; without the `!src/**/*.cases.ts!` negation it listed the 1 file (`selectorMatch.cases.ts`) and the same 51. Plain `knip` already failed at HEAD on `PAGE_ID_PATTERN` (unused even by tests). Step 1 removed the `FRAME_READ_ERROR_MESSAGE` re-export, leaving 50 names.

**After.** `pnpm exec knip` and `pnpm exec knip --production` both exit 0. Of the 50: 41 un-exported (tests pin the copy, caps and lists as test-local literals, or reach the function through its exported caller), 0 deleted, 9 kept with `/** @internal */`.

**`@internal` keeps** (each carries a `// Exported for tests:` line; the JSDoc is bare so the runtime iifes embedded in `canvas.html` ship no prose):

- `artboardToolInputSchemas` (`src/mcp/artboardTools.ts`), `commentToolInputSchemas` (`src/mcp/commentTools.ts`): `agentSkill.test.ts` reads the tool names, the skill drift guard AGENTS.md names.
- `editableSections` (`src/webview/editInspector.ts`): one test pins `inspectorView` as exactly this model plus `kind` and `target`; through `inspectorView` alone that assertion is a tautology.
- `isGeneratedName`, `buildSelector`, `textExcerpt` (`src/webview/frame/selector.ts`): the tests pin the prefix list on raw names, pass a finder timeout (`buildSelector(element, -1)`), and pin collapse and cut on raw strings; `describeElement` takes neither a timeout nor a raw string.
- `pinPoint`, `pinLabel` (`src/webview/pins.ts`): the tests pin the stage point and the label per badge and number; `layoutPins` offsets, hides and stacks the point and derives badge and number.
- `frameBounds` (`src/webview/stageGeometry.ts`): the fit property test uses it as the union oracle; `layoutCanvasChrome` adds label and heading boxes.

**Rewritten through the real interface** (assertions and inputs kept): `parseCommentsFile` / `serializeCommentsFile` via `readCommentsFile` / `writeCommentsFile` on a temp workspace; `buildPreviewFrameHtml` via the decoded `srcdoc` of `buildCanvasPreviewHtml` (the `decoded === preview` equality now compares against an explicit expected string per input); `copyAnnouncement` via `answerAction` / `answerCopyOpen`; `colorDisplay` via the colour field's `placeholder` / `swatch` / `none`; `toHexColor` via the same field (a parsed string fills the swatch, an unparsed one is echoed as text over the black fallback); `isTransparentColor` via `paintsFromStyle` on `backgroundColor`; `roundToPixel(-0)` via `dragFrame` from `-0`; `MIN_STAGE_ZOOM` / `MAX_STAGE_ZOOM` pinned via `zoomStageTo` to 0 and 1000; `ZOOM_PRESETS` as a literal in `zoomChoices.test.ts` and via `zoomChoices(1).options` in `tests/browser/stage.spec.ts`; the padding and margin longhands from a test-local side list.

**Unit test count:** 836 before, 836 after; no test deleted.

**Snapshot.** `handoffCanvasHtml.test.ts.snap` changed by the `isRecord` move (step 1: `asRecord` gone, `isRecord` added, the two parsers read `data`), then by step 2: one bare `/** @internal */` line per runtime-bundled seam and the `stageGeometry` iife's `exports.MIN_STAGE_ZOOM`, `exports.MAX_STAGE_ZOOM` and `exports.roundToPixel` lines gone (`canvas.html` reads only `stageGeometry.nextFrameHeight`).

**Docs.** AGENTS.md no longer spells out the Verify string (leaned in `7e96e57`), so only its `Other scripts` line changed. Rule 08 drops `colorDisplay` (now internal).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":11860,"specSha256":"9a8e69d080bc89b6b6fd7cd15b4b2ba1ae65ea5f9c5ec6306fc2b133fd1aa23a","branch":"refs/heads/fix/lean-export-and-helper-sweep","head":"7e96e577577feb1fc4b76fd5cda24dac08186d21","baseRef":"refs/heads/main","baseCommit":"7e96e577577feb1fc4b76fd5cda24dac08186d21","sourceTree":"6beb8af3b04126644ae105a270ecb834def41b68","landing":"local-merge","absentOptional":[]} -->

## Findings

### lean-export-and-helper-sweep/F-01 [P3] closed - `toHexColor` @internal keep is not needed

**File:** src/webview/editInspector.ts:49
**Found:** 2026-11-23 by /audit (scope: current; lens: all)
**Why it matters:** The implementation notes say the tests pin which strings parse and that "an unparsed string and the black fallback look the same". They do not: for a parsed colour `colorDisplay` returns `swatch` = the hex and `text` = the hex (opaque) or the input (translucent); for an unparsed one it returns `text` = the input as given and `swatch` = `FALLBACK_HEX`. Every case in `editInspector.test.ts:139-153` (three valid inputs, six invalid) is distinguishable through the colour field, and the test file already has a `colorDisplay` helper over `fieldOf(sectionsOf(...), 'color')`. Step order 1 (un-export through the real interface) applies; the keep widens the module interface for no reason.
**Suggested fix:** Drop `export` and the `Exported for tests` / `@internal` lines on `toHexColor`; rewrite the test through the existing `colorDisplay` helper (valid: swatch is the hex; invalid: text echoes the input and swatch is the fallback). Nothing is lost.
**Resolution:** Fixed 2026-11-23 by /implement: `toHexColor` un-exported (no `@internal`); its test now runs all 9 inputs through the colour field via the `colorDisplay` helper (valid: swatch is the hex; invalid: `{ text: input, swatch: '#000000', none: false }`). Spec implementation notes: 41 un-exported, 9 `@internal` keeps. Closed 2026-11-23 by /audit (scope: current): `toHexColor` is `const` with no `export`/`@internal` and no other reference in `src`; the test helper `colorDisplay` reads the colour field, and all 9 cases stay distinguishable (valid: distinct swatch hex; invalid: text echoes the input over `#000000`); no new defect in the repair hunk.

### lean-export-and-helper-sweep/F-02 [P3] closed - Padding / margin longhand length assertions became tautologies

**File:** src/disk/inlineStyle.test.ts:123
**Found:** 2026-11-23 by /audit (scope: current; lens: tests)
**Why it matters:** `PADDING_LONGHANDS` and `MARGIN_LONGHANDS` are now test-local arrays built from a test-local `SIDES`, so `assert.equal(PADDING_LONGHANDS.length, 10)` and `assert.equal(MARGIN_LONGHANDS.length, 10)` can never fail. At `main` they asserted the production lists. The spec says a test never loses an assertion. Padding is still pinned by `clearedProperties('padding')` (line 115); margin's list is pinned nowhere, only `margin-top` is exercised (line 131). Production derives both from one `SIDES`, so a padding break would still show, but a margin-only change would not.
**Suggested fix:** Delete the two length asserts and add `assert.deepEqual(clearedProperties('margin'), ['margin', ...MARGIN_LONGHANDS])` next to line 115.
**Resolution:** Fixed 2026-11-23 by /implement: the two length asserts deleted; the test-local longhand lists written out literally and `clearedProperties('margin')` pinned next to padding. Mutation check: dropping the last production margin longhand fails `clearedProperties is the field plus only its own longhands`; restored. Closed 2026-11-23 by /audit (scope: current): `clearedProperties('padding')` and `clearedProperties('margin')` are both `deepEqual` against the literal longhand lists (production `PADDING_LONGHANDS` / `MARGIN_LONGHANDS` now private, derived from `SIDES`); a margin-only change fails the margin assert; the tautological length asserts are gone; no new defect.

### lean-export-and-helper-sweep/F-03 [P3] closed - `FRAME_MODES` copied into commentPick.test.ts no longer follows production

**File:** src/webview/commentPick.test.ts:21
**Found:** 2026-11-23 by /audit (scope: current; lens: tests)
**Why it matters:** The `pressedMode` matrix (line 227) iterated the production `FRAME_MODES`, so a new mode joined the test automatically. The local literal is not tied to the `FrameMode` type, so adding a mode leaves it untested with no failure. Unlike the copy strings, which still fail when production output changes, this list is test input only.
**Suggested fix:** Make the list exhaustive by type: `const MODES: Record<FrameMode, true> = { interact: true, comment: true, edit: true }; const FRAME_MODES = Object.keys(MODES) as FrameMode[];` (a new mode then fails the type check).
**Resolution:** Fixed 2026-11-23 by /implement: `FRAME_MODES = Object.keys(MODES) as FrameMode[]` over `MODES: Record<FrameMode, true>`. Mutation check: dropping `edit` from `MODES` fails `vp check` with TS2741; restored. Closed 2026-11-23 by /audit (scope: current): `MODES: Record<FrameMode, true>` is exhaustive by type (missing or extra key is a TS error), `FRAME_MODES` feeds the `pressedMode` matrix, production `FRAME_MODES` stays private to `frameMessages.ts`; `vp check` clean; no new defect.

### lean-export-and-helper-sweep/F-04 [P3] closed - Blank lines inserted between every import in 22 test files

**File:** src/disk/canvasView.test.ts:1 (also comments.test.ts, canvasSnapshot.test.ts, panelEdit.history.test.ts, panelEdit.test.ts, and 17 more)
**Found:** 2026-11-23 by /audit (scope: current; lens: quality)
**Why it matters:** About 80 added blank lines between consecutive imports, unrelated to the fix (for example `canvasView.test.ts` has 11, `panelEdit.history.test.ts` 13). It buries the real import changes in the diff and drifts from the neighbouring files' style. `vp check` accepts it, so it is not a format error.
**Suggested fix:** Remove the blank lines between imports in the touched test files (keep the blank line before the new `// Pinned values` blocks). Review-only noise, no behaviour.
**Resolution:** Fixed 2026-11-23 by /implement: import-block blank lines in the touched test files reset to main's positions (plus the external/relative group gap); every changed test file's import blank lines now match `main`; `vp check --fix` clean. Closed 2026-11-23 by /audit (scope: current): every blank-line change in the touched `*.test.ts` files (`git diff main -U0`) sits next to a `// Pinned values` block, an import-group gap, or a deleted block; none between consecutive imports; `vp check` clean.

### lean-export-and-helper-sweep/F-05 [P3] closed - `PROVISIONAL_FRAME_HEIGHT = 800` is a twin in disk and chrome

**File:** src/disk/handoffCanvasHtml.ts:15 (twin: src/webview/canvasFrames.ts:48)
**Found:** 2026-11-23 by /audit (scope: current; lens: quality)
**Why it matters:** Same name, same value, same meaning (an iframe's height before its first `cd:frame-height`), written twice; the exported `canvas.html` must match the panel. Rule 05 calls a twin a bug. It predates this branch (both exist at `main`), but this change un-exports the chrome copy and adds a third literal in `canvasFrames.test.ts:21`, so the duplication is now more visible. Not in the spec's scope list.
**Suggested fix:** Out of this fix's scope: record for the next sweep. Move the constant into `stageGeometry.ts` (already embedded in `canvas.html` and imported by chrome), import it from both, and let the test pin the literal. Nothing is lost.
**Resolution:** 2026-11-23, folded into this fix: `PROVISIONAL_FRAME_HEIGHT` is exported once from `src/webview/stageGeometry.ts` and imported by `canvasFrames.ts` and `handoffCanvasHtml.ts`; `canvasFrames.test.ts` keeps pinning the literal 800; the `canvas.html` snapshot gains only the stageGeometry export line; rule 08 catalog updated. Closed 2026-11-23 by /audit (scope: current): one definition at `src/webview/stageGeometry.ts:34`, imported by `canvasFrames.ts:9` and `handoffCanvasHtml.ts:11` (no other literal in production code); the snapshot gains only the `var PROVISIONAL_FRAME_HEIGHT = 800;` and `exports.PROVISIONAL_FRAME_HEIGHT` lines for this finding (other snapshot hunks come from the branch's un-export sweep); rule 08 catalog names it; handoffCanvasHtml, canvasFrames and stageGeometry tests pass; no new defect.
