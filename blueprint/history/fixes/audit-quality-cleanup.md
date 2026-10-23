# Fix: Audit quality cleanup

**Type:** Fix
**Status:** verified
**Branch:** `fix/audit-quality-cleanup`
**Fixes:** F-27, F-29, F-30, F-31, F-32, F-33, F-34, F-35, F-36, F-37

> Written at `/complete` from the four commits already on the branch. The branch was built
> batch by batch from the `/audit full quality` findings (2026-10-23) instead of from a `/fix`
> spec, so this file records what was done; it was not a plan.

## The problem

A full-scope quality audit after 8d1 found no bugs but nine structure problems (F-29 to F-37).
Together with the older F-27, they were:
- **F-30:** the host kept its own copies of disk-library logic, and its writes skipped the disk
  lib's symlink and ownership checks.
- **F-29:** `src/disk/artboardFs.ts` was 1278 lines doing five jobs.
- **F-31:** the panel's message queue was untested state spread across module globals.
- **F-32:** the exported `canvas.html` copied the stage's label and heading layout.
- **F-33:** `App.svelte` still held deciding logic inline, past rule 08's ~300-line mark.
- **F-34 to F-37, F-27:** twin helpers, dead code, `knip` not reporting unused exports, stale
  comments, tests not next to what they test, and a test that only matched source text.

## The fix

Four batches, one commit each, no product feature change:

1. **Disk consolidation (`eeb00cd`; F-27, F-29, F-30, F-37).** The host goes through the disk
   lib for default-artboard setup and the handoff-stale badge (`readCanvasView` now returns
   `handoffStale`). `artboardFs.ts` is split into `layoutFs.ts`, `canvasView.ts` and
   `exportFs.ts`, and re-exports the old names. Tests moved next to their modules; the
   source-text test became three real stale-badge tests.
2. **Cleanup (`91bb025`; F-34, F-35, F-36).** One `firstWorkspaceFolder` helper, one trust gate,
   twin helpers and `generation.ts` removed, `knip` now reports unused exports and types, stale
   comments fixed.
3. **Extractions (`a1700a9`; F-31, F-32).** Pure `createPanelOutbox` in `src/host/panelOutbox.ts`
   with edge-case tests; the export reuses `layoutCanvasChrome`. `system-map.md` corrected: on
   `artboard:ready` the host sends `canvas:updated`, then `artboard:error`, then `ui:status`.
4. **Webview rules (`28e56e1`; F-33).** `wheelToView`, `applyFrameHeight`, `demoteToTile`,
   `withGestureOverride`, `toChromeFrames` and `frameOutline` moved into `frameGesture.ts` and
   `canvasFrames.ts`; App's script went from 354 to 302 lines. Stage's pointer-capture code was
   left alone pending F-26.

## Behavior changes

Both are stricter, and both come from default-artboard setup now using the disk lib:
- A symlinked or non-file `artboard.html` is refused with the disk lib's error.
- A `meta.json` whose id does not match its file is no longer overwritten; it reads as
  unreadable meta (generation 0), the same as MCP.

Everything else is unchanged: same messages, same order, same export markup.

## Verify

- `pnpm verify`: 286 tests (272 before the branch), svelte-check clean.
- `pnpm knip`, now including exports and types: clean.
- Every new guard was mutation-checked by its batch: removing it made a named test fail.
- F5 after the refactor: not yet run by the user (frame tab switch, drag save, ctrl+wheel zoom,
  picking).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":3259,"specSha256":"f20e69f8f0c2957ba72e7a72d8d404c3c9a4755a09ca42c30bf005516ff45b69","branch":"refs/heads/fix/audit-quality-cleanup","head":"8f18796509f7bb4470e2a7375770c4f10c175280","baseRef":"refs/heads/main","baseCommit":"ac2dd8c30d25741320b72c4c80a5abb6a40977bb","sourceTree":"17bd3a20278ebfe4086560f717f62b665d4f3bfb","landing":"local-merge","absentOptional":[]} -->

## Findings

### audit-quality-cleanup/F-23 [P3] closed - Crashed-breaker recovery in the workspace lock has no test

**File:** src/disk/workspaceLock.ts:99
**Found:** 2026-10-22 by /audit (scope: current; lens: tests)
**Why it matters:** The new break protocol adds one recovery branch: a `.lock.break` older than `staleMs` (left by a breaker that crashed) is removed so the next attempt can break the stale lock. If that branch regressed, one crash would leave every writer on `WORKSPACE_BUSY` permanently (the sub-lock would never age out of the way). The stress test and the stale-lock tests only ever see a live breaker, so nothing fails if lines 99-102 are deleted. Rule 03: non-trivial logic leaves one runnable check.
**Suggested fix:** Add one test next to the existing stale-lock ones: write a foreign `.lock` and a foreign `.lock.break`, both with `utimes` 60s ago, then assert `withWorkspaceLock` runs the operation (give it a `timeoutMs` of about 1000) and `lockDirEntries` is empty afterward. No product change.
**Resolution:** 2026-10-22 /implement: added the suggested test to `src/disk/workspaceLock.test.ts`. A foreign `.lock` and a foreign `.lock.break`, both aged 60s with `utimes`: the operation runs and `.cursor-design/` ends empty. No product change.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read `src/disk/workspaceLock.ts:94-101` and `workspaceLock.test.ts:154-171`. A foreign `.lock` and `.lock.break` both aged 60s: the operation runs within a 2s timeout and the dir ends empty; deleting the stale-break removal leaves `tryCreateLock(breakPath)` failing forever, so the test times out. No new defect. Closed.

### audit-quality-cleanup/F-27 [P3] closed - String-match test on artboardDisk.ts proves nothing

**File:** src/panel/canvasSnapshot.test.ts:146
**Found:** 2026-10-23 by review (Sonnet 5.5 test-gap pass, 8d1 refactor)
**Why it matters:** The test reads `src/host/artboardDisk.ts` as text and asserts it contains certain substrings. Changing what the code does still passes; only renaming the text fails it. That breaks rule 09 ("a test earns its place when deleting the guard makes it fail").
**Suggested fix:** Delete it, or extract `handoffStaleFor({ lastExport, frames })` from `artboardDisk.ts:181-201` and test the fail-closed case directly.
**Resolution:**
2026-10-23 /audit (scope: full; lens: quality) re-read `src/panel/canvasSnapshot.test.ts:146` and `src/host/artboardDisk.ts:181-201`. Defect unchanged. Better home for the extraction: that block duplicates `readHandoffStatus` in `src/disk/artboardFs.ts:1256-1267`, so the fix is to compute `{ exported, stale }` once in the disk lib and test it there (see F-30). The test is also in the wrong folder (F-37).
2026-10-23 fixed: deleted the string-match test. The stale rule now lives in the disk lib (`compareScannedHandoff` + `CanvasView.handoffStale`, src/disk/canvasView.ts) and src/disk/canvasView.test.ts covers it on temp dirs: off before and right after export, on after an HTML edit, fail-closed on an unreadable frame whose exported bytes were empty (fails if the `errorMessage` hash guard is removed), and off once every exported frame is deleted (fails if the `frames.length > 0` guard is removed). Both mutations checked.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read: the string-match test is gone (src/panel/canvasSnapshot.test.ts no longer exists); the stale rule is `compareScannedHandoff` + `CanvasView.handoffStale` (src/disk/canvasView.ts:253-260, 325) with three temp-dir tests in canvasView.test.ts that hit the `errorMessage` hash guard and the `frames.length > 0` guard. Closed.

### audit-quality-cleanup/F-29 [P2] closed - artboardFs.ts is a 1278-line module with five jobs

**File:** src/disk/artboardFs.ts:215
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** One file owns (1) layout-safe fs primitives (`layoutEntryKind`, `readUtf8IfExists`, `writeUtf8`, `assertLayoutDirsOwned`, lines 215-363), (2) manifest / meta reads (365-448), (3) create / update / read / setActive (518-697, 1019-1041), (4) the artboard scan, `listArtboards` and the panel `readCanvasView` (699-945), and (5) the whole export pipeline (`writeHandoffLeaf`, `writeManifestLastExport`, `exportArtboard`, `readHandoffStatus`, 1043-1278). Rule 05 says a module that grows a second hero gets extracted, and 03 says a file that mixes unrelated concerns for hundreds of lines is split by concern. The test files already mirror the split but are named for other modules (see F-37). Every new tool lands in this file.
**Suggested fix:** Split along the seams that already exist, keeping `artboardFs.ts` as the thin barrel rule 05 allows so callers keep one import path: `layoutFs.ts` (primitives + `assertLayoutDirsOwned`), `canvasView.ts` (scan, `listArtboards`, `readCanvasView`), `exportFs.ts` (export + `readHandoffStatus`). No behavior change; update the owner catalog in 05. Nothing is lost.
**Resolution:**
2026-10-23 fixed: pure moves. `src/disk/layoutFs.ts` (layout-safe primitives, `assertLayoutDirsOwned`, manifest / meta / canvas.json reads), `src/disk/canvasView.ts` (scan, `listArtboards`, `readCanvasView`, plus the shared `compareScannedHandoff` from F-30), `src/disk/exportFs.ts` (export pipeline, `readHandoffStatus`). `artboardFs.ts` keeps create / update / read / place / setActive and re-exports the public names of the other two, so every existing import path still works. Owner catalog in rule 05 updated.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) compared every top-level block of the base `artboardFs.ts` against `artboardFs.ts` + `layoutFs.ts` + `canvasView.ts` + `exportFs.ts`: all are byte-equivalent moves except the intended edits (`nextGeneration` inlined, `handoffStale` added to `readCanvasView`, `readTokensJsonForExport` replaced, `compareScannedHandoff` shared). Import graph inside `src/disk/` has no cycle. Every name imported outside the disk lib resolves through the barrel. Closed.

### audit-quality-cleanup/F-30 [P2] closed - Host artboardDisk.ts re-implements disk-lib reads, init and the handoff-stale check

**File:** src/host/artboardDisk.ts:77
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** The host keeps a second copy of disk SoT logic over `vscode.workspace.fs`: `isExpectedMetaParseError` (77) is a twin of `isBenignMetaParseError` (src/disk/artboardFs.ts:411), `readManifest` (103) of `parseManifestText` (artboardFs.ts:365), `readParsedMeta` (82) of `readStoredMeta` (artboardFs.ts:421), `initializeDefaultArtboard` (113-151) of `createArtboard` (artboardFs.ts:518), and the handoff-stale block (181-201) of `readHandoffStatus` (artboardFs.ts:1256-1267). Rule 07 explicitly lets the workspace host call the disk lib so MCP and the command cannot drift, and the host copy already does less: it writes through `vscode.workspace.fs` without the symlink and ownership checks (`assertLayoutDirsOwned`, `writeUtf8`) every disk-lib write gets. The file also mixes four jobs in 303 lines (read, init, snapshot compose, drag commit), and the handoff-stale branch it contains is the one F-27's string-match test tries to cover.
**Suggested fix:** Delete `readTextFile` / `readManifest` / `readParsedMeta` / `isExpectedMetaParseError` and the stale block. Have `readCanvasView` (or one small `handoffStale` field next to it in the disk lib) return `{ exported, stale }` from the same `compareCanvasHandoff` call, tested with temp dirs (this also replaces F-27's string-match test). Init through `createArtboard` for `DEFAULT_ARTBOARD_ID` and fall back to `setActiveArtboard` when `ArtboardExistsError` says the HTML is already there. Nothing is lost; it removes `TextEncoder` / `TextDecoder` and about 90 lines.
**Resolution:**
2026-10-23 fixed: deleted `readTextFile` / `writeTextFile` / `readManifest` / `readParsedMeta` / `isExpectedMetaParseError`, the `TextEncoder` / `TextDecoder` pair and the host stale block. Init is `createArtboard` for `DEFAULT_ARTBOARD_ID`, falling back to `setActiveArtboard` on `ArtboardExistsError`, so host writes get the disk lib's symlink and ownership checks. `readCanvasView` returns `handoffStale` from the same scan (`compareScannedHandoff`, also used by `readHandoffStatus`), so the host no longer re-reads manifest.json. Untrusted refusal, safe copy and `logDiskError` are unchanged. Edge-case differences, both intended: a symlinked or non-file `artboard.html` at init is now refused with the disk lib's DiskError, and a foreign-id `artboard.meta.json` at init is no longer overwritten (it reads as unreadable meta, as it does for MCP). The host-side catch that forced stale on a manifest re-read error is gone with the re-read; a corrupt manifest already failed `readCanvasView` first. Rule 07's host fs note now lists panel read / init and drag commit next to export.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read `src/host/artboardDisk.ts` against the base: host reads go through `readCanvasView`, init through `createArtboard` / `setActiveArtboard`, so writes get `assertLayoutDirsOwned` + `writeUtf8`; untrusted refusal is still the first check in `loadActiveSnapshot` and `placeFrameFromChrome`; error copy still goes through `toSafeArtboardErrorMessage` (authored `CursorDesignError` messages only). `handoffStale` is equivalent to the old host block (same frames, same hashes, same never-exported rule). Repair correct. Two follow-ups recorded separately: F-38 (the createArtboard branches the init now depends on are untested) and F-39 (a third init behavior change the spec does not list). Closed.

### audit-quality-cleanup/F-31 [P2] closed - Panel outbox rules live as module globals in openArtboardPanel.ts, untested

**File:** src/panel/openArtboardPanel.ts:24
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** Seven module globals (`currentPanel`, `chromeReady`, `pendingView`, `pendingUiStatus`, `onPanelBecameVisible`, `onFramePlace`, `chromeCspNonce`) hold a small state machine whose rules decide what the chrome sees: nothing is posted before `artboard:ready`; `ui:status` waits until `mcpAvailable` is known; `artboard:error` follows `canvas:updated`; a dispose clears `handoffStale` but keeps `mcpAvailable` (152-155); a second `artboard:ready` re-flushes the cached view. None of it has a test (the only file under src/panel for this module is the shell HTML test), so a regression shows only in F5. Same idea as rule 08 for chrome: the deciding logic belongs in a pure module, and the vscode-bound file should only create the panel and post what the module returns. `watchArtboardDisk.ts:24-29,97-128` has the same shape (six module globals plus a marker / token state machine) and no test either. The two `setArtboardPanelOn*` setters are also module-global callbacks, so the order of `setArtboardPanelOn*` versus the first `openArtboardPanel` is an implicit contract.
**Suggested fix:** Extract `createPanelOutbox()` (pure, no `vscode`) in `src/host/` with `setView`, `setStatus`, `markReady`, `reset` returning the messages to post; keep `openArtboardPanel` as the vscode glue; add one test per rule above (the edge cases are the value: ready twice, status before mcp known, dispose then reopen). Do the same for the marker / token decisions in `watchArtboardDisk.ts` only if it grows; leave as is for now. Nothing is lost.
**Resolution:**
2026-10-23 fixed: `createPanelOutbox({ post, readCspNonce })` in `src/host/panelOutbox.ts` (no `vscode`) owns `chromeReady`, the pending view and the pending ui status (`postSnapshot`, `postUiStatus`, `markReady`, `reset`). `openArtboardPanel.ts` keeps the panel, the nonce and the two handler globals, and posts through `currentPanel?.webview.postMessage`. Behavior unchanged. `panelOutbox.test.ts` (6 tests) pins: nothing before ready; ready flushes canvas:updated, artboard:error, ui:status in that order and a second ready re-sends the same; no artboard:error without an error; nonce read at flush; ui:status held until `mcpAvailable` is known, and a snapshot posts ui:status before canvas:updated; reset drops view, stale flag and readiness but keeps `mcpAvailable`. Each guard mutation-checked (11 mutants, all killed). System map handshake order corrected to the code's (canvas:updated, then ui:status on ready). `watchArtboardDisk.ts` left as is.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read `src/host/panelOutbox.ts` against the base `openArtboardPanel.ts` globals: same flush guards, same order (live snapshot: ui:status then canvas:updated then artboard:error; on ready: canvas:updated, artboard:error, ui:status), same dispose reset; `currentPanel?.` replaces the old `!currentPanel` guard. System map matches. The 6 tests pin each rule. Closed.

### audit-quality-cleanup/F-32 [P2] closed - handoffCanvasHtml.ts copies the stage chrome geometry it says it mirrors

**File:** src/disk/handoffCanvasHtml.ts:20
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** `FRAME_LABEL_BAND` (24), `GROUP_HEADING_BAND` (32) and `PAGE_PADDING` (48) are hand-copied from `stageGeometry.ts:33,163-164` ("Mirrors layoutCanvasChrome", line 20), and `groupHeadings` (76-97) re-implements the per-group min/max accumulation inside `layoutCanvasChrome` (stageGeometry.ts:168-222). The file already embeds `stageGeometry.ts` as an IIFE and imports `frameMessages` from the webview, so a direct import is allowed. If a band or heading rule changes in the panel, the exported canvas.html silently disagrees (labels and headings drift from the live stage). Rule 05 says a twin helper is a bug.
**Suggested fix:** Import `layoutCanvasChrome` (and export the three constants) from `src/webview/stageGeometry.ts` and derive headings and label boxes from it; keep only `PROVISIONAL_FRAME_HEIGHT` local. The existing handoffCanvasHtml snapshot tests guard the output. Nothing is lost.
**Resolution:**
2026-10-23 fixed: `buildCanvasPreviewHtml` takes label boxes, heading boxes and the page offset (`bounds`) from `layoutCanvasChrome`; the copied bands, `PAGE_PADDING` and `groupHeadings` are gone. `FIT_PADDING` is exported from `stageGeometry.ts` and used as the page padding; the bands stay private there. Rendered markup is unchanged; the one snapshot update is the inlined `stageGeometry` IIFE gaining `var FIT_PADDING = 48;` and `exports.FIT_PADDING = FIT_PADDING;`.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read `buildCanvasPreviewHtml`: label boxes, heading boxes and `bounds` come from `layoutCanvasChrome`; `bounds.x/y` equal the old min-left / min-top (labels and headings above frames, frame x is the min x). Snapshot diff touches only the inlined `stageGeometry` IIFE, so markup is unchanged. Closed.

### audit-quality-cleanup/F-33 [P2] closed - App.svelte (355-line script) and Stage.svelte keep rules inline

**File:** src/webview/App.svelte:233
**Found:** 2026-10-23 by /audit (scope: full; lens: quality; webview light pass)
**Why it matters:** Rule 08 requires a container past about 300 lines to extract its rules first, and a rule left in a `.svelte` file is a rule only F5 can catch. Inline today: `handleFrameMessage` (233-268) applies the frame-height guard to a `FrameRecord` (mutates `measuredHeight`, `guard`, `height` by `kind`) and turns a wheel message into zoom or pan; `handleStageWheel` (270-285) repeats the same zoom-vs-pan branch for the stage wheel; `handleRenderError` (339-348) demotes a frame to a tile (`kind`, `tileText`, `height`); `applyInitialView` (142-155) is a once-only latch over saved-vs-fit. In Stage.svelte the pointer-capture bookkeeping (`captured`, `isCaptured`, held arrows, lines 80-230) and wheel classification (~232-265) are decisions too, and F-26 lives in that capture code. None has a test.
**Suggested fix:** Move the three pure decisions into the existing rule modules with a colocated test each: `wheelToView({ view, wheel })` in `stageGeometry.ts` (used by both wheel handlers), `applyFrameHeight({ record, reported })` and `demoteToTile(record)` in `canvasFrames.ts` (edge cases: frozen guard, unknown id, tile height). Leave Stage's capture state for the F-26 repro; do not add a wrapper just to shrink the file. Nothing is lost.
**Resolution:**
2026-10-23 fixed: `wheelToView` (zoom-vs-pan) and the `StageWheel` type moved to `frameGesture.ts`, used by both the stage wheel and the forwarded frame wheel (not `stageGeometry.ts`, which is inlined into the exported canvas.html, so the handoff snapshot is untouched). `canvasFrames.ts` gains `applyFrameHeight` (tile tracks `measuredHeight`, keeps tile height; iframe draws it), `demoteToTile` (+ `RENDER_ERROR_COPY`), `withGestureOverride`, `toChromeFrames` (empty group has no key) and `frameOutline`; all return new objects, and App replaces records via `updateFrame` instead of mutating `$state`. App.svelte script 354 to 302 lines. `applyInitialView` stays: its decision is a one-line saved-vs-fit ternary and the rest is the once-only latch over `let` state, so extracting it would only move state. Stage's wheel classification is `ctrlKey || metaKey`, a one-liner, left inline. Deliberately NOT touched: Stage's pointer-capture bookkeeping (`captured`, `lostpointercapture`, Escape effect); it waits on the F-26 F5 repro. 7 tests added (279 to 286), each mutation-checked.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read App.svelte and the new rules: `wheelToView`, `applyFrameHeight`, `demoteToTile`, `withGestureOverride`, `toChromeFrames`, `frameOutline` reproduce the removed inline code; records are now replaced, and `Frame.svelte` takes primitive props with an effect that reads only `html` / `nonce`, so a replaced record does not reload an iframe. Each new test fails if its guard is removed. F5 still not run (see remaining risk). Closed.

### audit-quality-cleanup/F-34 [P3] closed - Twin helpers and repeated first-folder / trust checks

**File:** src/mcp/registerCursorDesignMcp.ts:23
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** Small duplicates the owner catalog says not to have: `logMcpOutput` (registerCursorDesignMcp.ts:23-27) has the same body as `logDiskError` (src/host/hostFs.ts:25); `isJsonRecord` is defined in both src/disk/parse.ts:14 and src/disk/canvasLayout.ts:25; `readTokensJsonForExport` (artboardFs.ts:1043-1057) is `readUtf8IfExists` (artboardFs.ts:304) with the same messages; `vscode.workspace.workspaceFolders?.[0]` plus a "no folder" message is repeated in handleOpenArtboard.ts:23,36, artboardDisk.ts:265, watchArtboardDisk.ts:89,99, exportHandoff.ts:12 and revealDesignFolder.ts:7, with three different copies of the text. Trust is gated twice on the panel path: `loadActiveSnapshot` returns the untrusted snapshot (artboardDisk.ts:223) and every caller then runs `snapshotForChrome` again (extension.ts:39, handleOpenArtboard.ts:29,45, watchArtboardDisk.ts:63), and the name `snapshotForChrome` exists twice (canvasSnapshot.ts:34, a wrapper at artboardDisk.ts:53 that imports the first under an alias).
**Suggested fix:** Use `logDiskError` in registerCursorDesignMcp; export `isJsonRecord` once from parse.ts; call `readUtf8IfExists` for tokens.json; add `firstWorkspaceFolder()` to hostFs.ts and one no-folder copy; drop the second `snapshotForChrome` pass (or the first check) and the alias wrapper. Nothing is lost.
**Resolution:**
2026-10-23 fixed: `registerCursorDesignMcp` logs through `logDiskError` (`logMcpOutput` deleted). `isJsonRecord` is exported once from `parse.ts` and imported by `canvasLayout.ts`. `exportFs.ts` reads tokens.json with `readUtf8IfExists` (`readTokensJsonForExport` deleted; a file that vanishes mid-read now reads as missing instead of throwing). `hostFs.ts` gains `firstWorkspaceFolder()` and `NO_FOLDER_MESSAGE`; all seven first-folder lookups use the former, and the identical "Open a workspace folder first..." toast copy in `handleOpenArtboard` and `revealDesignFolder` is the latter. The export command's and the panel banner's different no-folder texts stay as they were (user-visible copy unchanged). Trust is gated once, in `loadActiveSnapshot` / `placeFrameFromChrome`; the second `snapshotForChrome` pass, the alias wrapper and the pure `snapshotForChrome` with its test are gone. Only the no-folder reload branch needed the untrusted copy, now a one-line ternary in `reloadVisibleArtboardFromDisk`.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read: `logMcpOutput` gone, `isJsonRecord` single, tokens via `readUtf8IfExists`, every host first-folder lookup uses `firstWorkspaceFolder()` (`registerCursorDesignMcp` still reads all folders, which it needs). Trust: every `postArtboardSnapshotToPanel` caller gets its snapshot from a trust-gated function or the no-folder ternary, so dropping `snapshotForChrome` loses no gate. Closed.

### audit-quality-cleanup/F-35 [P3] closed - Dead parameter, dead default and unused exports (knip does not check exports)

**File:** src/host/canvasSnapshot.ts:71
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** `loadErrorMessage` (canvasSnapshot.ts:71,78,83) is passed only by a test (panel/canvasSnapshot.test.ts:87); production never sets it. `nextGeneration(currentGeneration: number | undefined)` (src/disk/generation.ts:1-2) has an `undefined` branch no caller reaches (both callers pass a number, artboardFs.ts:648 and effectiveMeta.ts:22), and the 2-line module is a forwarder for `n + 1`. `knip --include exports,types` reports 9 unused exports (`HASH_PREFIX`, `MANIFEST_FILE`, `ENSURE_PANEL_FILE`, `HANDOFF_DIR`, `CANVAS_FILE`, `artboardMetaFileName`, `toSafeArtboardErrorMessage`, `frameModeMessage`, `GESTURE_THRESHOLD_PX`) and 6 unused types (`ListedArtboard`, `CanvasViewHtmlReadError`, `ExportedFrameResult`, `FrameSend`, `FrameHeightMessage`, `FrameWheelMessage`) because knip.json `include` omits `exports` and `types`. `pnpm knip` also prints 6 stale config hints (knip.json ignore / ignoreDependencies / redundant patterns). `MAX_TAG_NAME_CHARS` (src/disk/layout.ts:45) is only used by src/webview/frame/frameMessages.ts:71, so a webview constant sits in the disk layout file.
**Suggested fix:** Delete `loadErrorMessage` and its test case; inline `generation + 1` and delete generation.ts (update the catalog line in 05); drop `export` from the unused names (keep it where a test imports it); move `MAX_TAG_NAME_CHARS` next to `TAG_NAME_PATTERN`; add `exports` and `types` to knip.json `include` and clear its hints, or accept that dead exports are only found by hand. Nothing is lost.
**Resolution:**
2026-10-23 fixed: deleted `loadErrorMessage` and its test assertion; deleted `generation.ts` (callers use `generation + 1`; the `undefined` branch was unreachable) and its catalog entry; unexported the 9 unused exports and 6 unused types, and dropped nine unused type re-exports from the `artboardFs.ts` barrel. knip.json now includes `exports` and `types`, and the 6 stale hints are cleared (redundant `vite.config.ts` entries, the `ignore` entry, `vscode` / `@types/vscode` ignoreDependencies); `pnpm knip` is clean. `MAX_TAG_NAME_CHARS` moved next to `TAG_NAME_PATTERN` in `frame/frameMessages.ts` (its only user). Side effect: `GESTURE_THRESHOLD_PX` is no longer exported, so the inline `stageGeometry` bundle in the exported canvas.html inlines the literal 3; one handoffCanvasHtml snapshot updated, no behavior change. Tests: 274 to 273, the removed one covered the deleted `snapshotForChrome` (F-34).
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read: `loadErrorMessage`, `generation.ts` gone; knip (exports + types) clean this pass. Correction to the note above: the snapshot diff shows the opposite of what it says. Before, the IIFE inlined the literal `3` and exported `GESTURE_THRESHOLD_PX`; now it references `var GESTURE_THRESHOLD_PX = 3` and no longer exports it. Same value, no behavior change. Closed.

### audit-quality-cleanup/F-36 [P3] closed - Stale comments describe the old single-artboard contract

**File:** src/mcp/toolNames.ts:16
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** `toolNames.ts:16` says export writes "an artboard ... (index.html, IMPLEMENT.md, tokens.json)", but export now writes every frame plus canvas.html (rule 02); `toolNames.ts:19` says `handoff_status` compares "the artboard's current HTML", but it compares every frame and the frame set. `artboardFs.ts:957` says `placeFrame` "Backs the place_frame MCP tool" although the panel drag commit calls it too (the `base` arg, line 179-180). `artboardFs.ts:245-248` is a comment about `lstatOrUndefined` that sits above it but after `layoutEntryKind` (line 234), which uses it first. The registered tool descriptions in artboardTools.ts:367,383 are correct, so the comments mislead only a reader.
**Suggested fix:** Rewrite the two toolNames comments to match the descriptions (or delete them, since artboardTools.ts carries the contract); one-line fix for artboardFs.ts:957; move the lstat comment block above its function's first use. None lost.
**Resolution:**
2026-10-23 fixed: `toolNames.ts` export and handoff_status comments now match the tool descriptions (every frame, canvas.html, frame set); `placeFrame` comment names both callers (MCP tool and panel drag commit); the lstat comment block moved above `layoutEntryKind` in `layoutFs.ts`, its first use.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read `toolNames.ts:16-19`, `artboardFs.ts:389` and `layoutFs.ts:50-54`: the comments match the code. Closed.

### audit-quality-cleanup/F-37 [P3] closed - Test files named and placed for other modules

**File:** src/disk/conflict.test.ts:1
**Found:** 2026-10-23 by /audit (scope: full; lens: quality)
**Why it matters:** Rule 09 says colocate `foo.test.ts` next to `foo.ts`. `conflict.test.ts` (638 lines, 23 tests) is the artboardFs suite (create / update / read / list / setActive / symlink cases); only 4 tests touch `conflict.ts` (36 lines). `canvasView.test.ts` tests `readCanvasView` in artboardFs.ts. `src/panel/canvasSnapshot.test.ts` tests `src/host/canvasSnapshot.ts` (and F-27's string-match test reads `src/host/artboardDisk.ts`). A reader looking for the tests of `createArtboard` or `host/canvasSnapshot` will not find them where the rule points.
**Suggested fix:** Move the panel test to src/host/canvasSnapshot.test.ts; rename the disk tests with the F-29 split (`artboardFs.test.ts` / `canvasView.test.ts` / `exportFs`), keeping only the `conflictFields` cases in `conflict.test.ts`. Pure file moves; no test is lost.
**Resolution:**
2026-10-23 fixed: `conflict.test.ts` keeps only the 4 `conflictFields` tests; its 19 artboardFs tests moved to `src/disk/artboardFs.test.ts`, along with the 3 `placeFrame` tests from `canvasView.test.ts` (placeFrame stays in artboardFs.ts). `canvasView.test.ts` now sits next to `canvasView.ts`. `src/panel/canvasSnapshot.test.ts` moved to `src/host/canvasSnapshot.test.ts`. Bodies unchanged except imports, one `handoffStale` field on two CanvasView literals, and the deleted F-27 test. Left: `handoff.test.ts` still holds the exportArtboard / readHandoffStatus disk tests; moving them would split shared factories and its snapshot file, so it is not a pure move.
2026-10-23 /audit independent (scope: current; fresh subagent, claude-opus-5-5) re-read: `conflict.test.ts` holds only the 4 `conflictFields` tests; the 19 artboardFs tests and 3 placeFrame tests are in `artboardFs.test.ts` under the same names; `src/host/canvasSnapshot.test.ts` sits next to its module. Closed.

## Independent review

**Status:** passed
**Target commit:** 8f18796509f7bb4470e2a7375770c4f10c175280
**Base commit:** ac2dd8c30d25741320b72c4c80a5abb6a40977bb
**Base ref:** refs/heads/main
**Spec hash:** f20e69f8f0c2957ba72e7a72d8d404c3c9a4755a09ca42c30bf005516ff45b69
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-10-23T14:19:25Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-23T14:24:43Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `ac2dd8c30d25741320b72c4c80a5abb6a40977bb..8f18796509f7bb4470e2a7375770c4f10c175280` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `git rev-parse HEAD` / `git merge-base refs/heads/main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain=v1`: pass (target, base, spec hash match; only `blueprint/context/review.md` dirty)
- `pnpm verify`: pass (vp check clean on 88 files, agent-rules check, svelte-check, webview test tsc, 27 test files / 286 tests, vp pack, webview build)
- `pnpm knip` (now including exports and types): pass (no issues)

## Evidence

- Full delta reviewed: 45 files across 5 commits (`eeb00cd`, `91bb025`, `a1700a9`, `28e56e1`, `8f18796`), plus the spec.
- Disk split: compared every top-level block of the base `src/disk/artboardFs.ts` against `artboardFs.ts` + `layoutFs.ts` + `canvasView.ts` + `exportFs.ts`. They match except the intended edits: `nextGeneration` inlined, `handoffStale` added, `readTokensJsonForExport` swapped for `readUtf8IfExists` (same messages), `compareScannedHandoff` shared. `src/disk/` has no import cycles. Every name imported from outside the disk lib still goes through the barrel.
- Host write path: `initializeDefaultArtboard` now goes through `createArtboard` / `setActiveArtboard`, so writes get `assertLayoutDirsOwned` + lstat + `writeUtf8`. It is reached only after the `isTrusted` check in `loadActiveSnapshot`. Errors show only authored `CursorDesignError` copy with relative paths.
- Trust: every `postArtboardSnapshotToPanel` caller gets a snapshot from a trust-gated function or from the no-folder ternary, so removing `snapshotForChrome` drops no gate.
- Panel outbox: the message order matches the base globals. A live snapshot sends ui:status, canvas:updated, artboard:error. On ready it sends canvas:updated, artboard:error, ui:status. This matches `system-map.md:91-100` and `panelOutbox.test.ts`.
- Handoff badge: `CanvasView.handoffStale` equals the removed host block (same frames, hashes and never-exported rule). The export reuses `layoutCanvasChrome`. In the canvas.html snapshot only the inlined IIFE changed; the markup did not.
- Webview: the extracted rules reproduce the inline code. Records are now replaced instead of mutated, and `Frame.svelte` reads only primitive props (its effect reads `html` / `nonce`), so an iframe does not reload.
- Both behavior changes stated in the spec are confirmed in code. Two more unlisted init differences are recorded as F-39.
- New tests: each one fails if the guard it names is removed (outbox rules, stale badge fail-closed and emptied canvas, `applyFrameHeight` / `demoteToTile` / `frameOutline` / `wheelToView`). Moved tests keep their names and bodies.

## Findings

- Added: F-38 [P3] open (createArtboard exists / symlink branches that the host init depends on are untested), F-39 [P3] open (the spec lists two of four init behavior differences).
- Closed after re-review: F-23, F-27, F-29, F-30, F-31, F-32, F-33, F-34, F-35, F-36, F-37 (F-35's Resolution note about the `GESTURE_THRESHOLD_PX` snapshot was corrected).
- No P0 or P1 finding is open or fixed.

## Remaining risk

- F5 (Extension Development Host) has not been run after the refactor: frame tab switch, drag save, ctrl+wheel zoom, picking, and first open of a workspace with `artboard.html` but no manifest. Check was not required, and no runtime evidence was inspected.
- Electron suite (`pnpm test`) not run: it needs a display and is not part of Verify.
- The host default-artboard init and `openArtboardPanel` glue are `vscode`-bound and have no unit coverage (see F-38 for the disk side).

## Try it now

F5 (user, 2026-10-23, after the refactor): frame tab switch, drag save, ctrl+wheel zoom and picking all work.

1. F5 (Run Extension): frames render and survive switching editor tabs without reloading.
2. Drag a frame by its label and release: the new position is saved to `canvas.json`.
3. Export a handoff (Agent `export_artboard`): `canvas.html` renders as before.
4. `pnpm verify` (286 tests) and `pnpm knip` (exports and types) both stay clean.
