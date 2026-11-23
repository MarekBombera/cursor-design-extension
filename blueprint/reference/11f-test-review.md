# 11f Test effectiveness review

Report for build-plan item 11f (`blueprint/context/current-feature.md`). Sections: Baseline, Mutation, Coverage gaps, Ranked, After.

Raw output (Stryker JSON and HTML, survivor lists, lane files, worker patches) was kept under the gitignored `test-results/`, which `pnpm test:browser` clears on every run; it is gone. Every number, item and verdict it held is copied into this report. A rerun of the same Stryker config regenerates it.

## Baseline

Measured 2026-11-23 on `feature/test-effectiveness-review` at `ef9211e`.

- **Unit:** 64 files, 836 tests (`pnpm test`).
- **Browser:** 11 spec files; 209 unique tests outside the gallery, plus 208 gallery entries that run only with `CD_GALLERY=1` (`pnpm exec playwright test -c tests/browser --list`, deduplicated across the `parallel` and `serial` projects).
- **`vi.mock(` calls per test file** (`grep -c 'vi.mock('`, excludes `vi.mocked`; the metric 11c compares against):

  | File | `vi.mock(` |
  |---|---|
  | `src/host/panelEdit.test.ts` | 6 |
  | `src/host/panelComments.test.ts` | 5 |
  | `src/host/artboardDisk.test.ts` | 5 |
  | `src/host/panelEdit.history.test.ts` | 3 |
  | `src/host/canvasSnapshot.test.ts` | 3 |
  | `src/host/hostFs.test.ts` | 1 |
  | `src/panel/artboardChromeHtml.test.ts` | 1 |
  | `src/disk/comments.test.ts` | 1 |
  | `src/disk/openPage.test.ts` | 1 |
  | `src/disk/artboardEditFs.test.ts` | 1 |
  | `src/webview/frame/selector.test.ts` | 1 |
  | every other test file | 0 |

- **Coverage** (`pnpm coverage --coverage.include='src/**/*.ts' --coverage.reporter=text --coverage.reporter=json-summary`; % statements / branches / functions / lines):

  | Directory | Stmts | Branch | Funcs | Lines |
  |---|---|---|---|---|
  | all files | 73.45 | 75 | 73.62 | 73.06 |
  | `src` (`extension.ts`) | 0 | 0 | 0 | 0 |
  | `src/commands` | 0 | 0 | 0 | 0 |
  | `src/disk` | 96.43 | 91.46 | 99.16 | 96.31 |
  | `src/host` | 72.27 | 72.24 | 75.89 | 71.9 |
  | `src/mcp` | 76.26 | 72.22 | 87.5 | 76.02 |
  | `src/panel` | 13.88 | 0 | 11.11 | 12.85 |
  | `src/webview` | 61.63 | 74.45 | 60.39 | 61.12 |
  | `src/webview/frame` | 45.19 | 49.47 | 52.63 | 44.66 |
  | `src/webview/ui` | 0 | 0 | 0 | 0 |

  Files at 0%: `extension.ts`, `commandIds.ts`, `exportHandoff.ts`, `agentSkill.ts`, `server.ts`, `main.ts`, `frame/editTarget.ts`, `frame/pinAnchors.ts`, `frame/runtime.ts` (browser-tested), `ui/icons.ts`, `ui/keyRepeat.ts`. `.svelte` files and the frame runtime are proven by browser tests, so low webview numbers are expected.

## Mutation

**Run:** StrykerJS `@stryker-mutator/core` 10.1.1 + `@stryker-mutator/vitest-runner` 10.1.1 (published 2026-10-23), Vitest 5.1.0 (the runner and `vite-plus/test` resolve the same copy, so no alias was needed). Config: `coverageAnalysis: perTest`, `disableBail: true`, `concurrency: 4`, `timeoutMS: 10000`. 47 files, 8,770 mutants, 54 min 32 s. Raw: `test-results/11f-mutation/before/` (`mutation.json`, `mutation.html`, `survivors.txt` with every survived and no-coverage mutant, `tests-kills.tsv` with per-test unique kills).

**Dry run:** all-pass, 783 tests (Stryker's count; Vitest reports 836 because it counts a few table and property cases differently). Six tests were skipped in the throwaway copy only, because instrumented code breaks them, not because they are wrong: three time budgets (`selectorMatch.test.ts` scale x2, `commentTarget.test.ts` MAX_MATCH_WORK), the frame runtime size budget (`runtime.test.ts`), and two that compare bytes of exports embedding the bundled frame runtime (`handoffCanvasHtml.test.ts` snapshot, `handoff.test.ts` comments.json export bytes). Mutants only those tests would catch show as survived.

**Total:** score 85.0 (7,252 killed, 200 timeout, 1,143 survived, 172 no coverage, 3 errors). Timeouts count toward the score but are never used as evidence that a test asserts something.

**Per-test unique kills:** of 783 tests, 388 are the sole killer of no mutant and 47 cover no in-scope mutant at all (host, MCP and contract tests reach disk code through mocks or mostly test out-of-scope code). Zero unique kills alone does not make a test deletable: two tests that kill the same mutants both show zero. Delete decisions keep at least one killer per mutant.

| File | Score | Killed | Survived | Timeout | No coverage |
|---|---|---|---|---|---|
| `src/disk/errors.ts` | 48.1 | 62 | 66 | 0 | 1 |
| `src/disk/workspaceLock.ts` | 58.1 | 43 | 31 | 29 | 21 |
| `src/disk/commentsFile.ts` | 66.1 | 158 | 64 | 0 | 17 |
| `src/disk/layout.ts` | 68.3 | 39 | 19 | 2 | 0 |
| `src/disk/canvasView.ts` | 68.5 | 116 | 52 | 21 | 11 |
| `src/disk/inlineStyle.ts` | 75.1 | 367 | 122 | 7 | 2 |
| `src/disk/artboardFs.ts` | 76.5 | 195 | 35 | 0 | 25 |
| `src/disk/commentViews.ts` | 76.8 | 76 | 15 | 0 | 8 |
| `src/disk/layoutFs.ts` | 77.0 | 134 | 35 | 17 | 10 |
| `src/webview/stampArtboardHtml.ts` | 77.1 | 27 | 8 | 0 | 0 |
| `src/webview/editInspector.ts` | 78.4 | 424 | 116 | 0 | 1 |
| `src/disk/artboardEdit.ts` | 78.5 | 346 | 87 | 0 | 8 |
| `src/disk/parse.ts` | 81.8 | 100 | 17 | 8 | 7 |
| `src/disk/exportFs.ts` | 82.1 | 96 | 27 | 46 | 4 |
| `src/disk/sourceTags.ts` | 84.0 | 78 | 15 | 6 | 1 |
| `src/disk/hash.ts` | 84.2 | 16 | 3 | 0 | 0 |
| `src/disk/handoffCanvasHtml.ts` | 85.3 | 58 | 11 | 6 | 0 |
| `src/disk/openPage.ts` | 85.9 | 195 | 22 | 0 | 10 |
| `src/webview/pageStart.ts` | 86.0 | 37 | 5 | 0 | 1 |
| `src/webview/frameGesture.ts` | 86.3 | 214 | 30 | 0 | 4 |
| `src/webview/frame/pickTarget.ts` | 86.4 | 146 | 23 | 0 | 0 |
| `src/disk/editValues.ts` | 86.5 | 235 | 37 | 2 | 0 |
| `src/disk/commentTarget.ts` | 88.0 | 145 | 17 | 1 | 3 |
| `src/webview/commentsPanel.ts` | 88.0 | 146 | 5 | 0 | 15 |
| `src/disk/artboardEditFs.ts` | 88.1 | 37 | 5 | 0 | 0 |
| `src/webview/hostMessages.ts` | 88.2 | 381 | 41 | 0 | 10 |
| `src/disk/comments.ts` | 88.4 | 245 | 22 | 0 | 10 |
| `src/webview/frame/selector.ts` | 89.3 | 95 | 12 | 13 | 1 |
| `src/webview/frame/anchorRects.ts` | 89.4 | 59 | 7 | 0 | 0 |
| `src/webview/stageGeometry.ts` | 90.6 | 248 | 25 | 11 | 2 |
| `src/disk/canvasLayout.ts` | 91.4 | 124 | 12 | 4 | 0 |
| `src/webview/editDrafts.ts` | 92.2 | 261 | 22 | 0 | 0 |
| `src/webview/commentPopover.ts` | 92.5 | 211 | 17 | 0 | 0 |
| `src/webview/editRequests.ts` | 92.6 | 162 | 13 | 0 | 0 |
| `src/webview/canvasFrames.ts` | 92.7 | 165 | 13 | 0 | 0 |
| `src/webview/commentActions.ts` | 93.1 | 268 | 20 | 0 | 0 |
| `src/disk/selectorMatch.ts` | 93.6 | 285 | 20 | 8 | 0 |
| `src/webview/pins.ts` | 94.6 | 245 | 14 | 0 | 0 |
| `src/webview/frame/pickPath.ts` | 94.7 | 18 | 1 | 0 | 0 |
| `src/disk/handoff.ts` | 95.0 | 98 | 6 | 17 | 0 |
| `src/webview/savedState.ts` | 95.5 | 107 | 5 | 0 | 0 |
| `src/webview/commentPick.ts` | 96.2 | 177 | 7 | 0 | 0 |
| `src/webview/frame/frameMessages.ts` | 96.5 | 492 | 18 | 0 | 0 |
| `src/webview/zoomChoices.ts` | 96.7 | 29 | 1 | 0 | 0 |
| `src/disk/conflict.ts` | 100.0 | 20 | 0 | 0 | 0 |
| `src/disk/effectiveMeta.ts` | 100.0 | 15 | 0 | 2 | 0 |
| `src/webview/undoRedo.ts` | 100.0 | 57 | 0 | 0 | 0 |

Surviving mutants are classified (real gap vs equivalent) in Ranked; the full list stays in `survivors.txt`.

## Coverage gaps

Sources: `pnpm coverage --coverage.include='src/**/*.ts' --coverage.reporter=json --coverage.reportsDirectory=test-results/11f-coverage` (uncovered statements and untaken branches, full list in `test-results/11f-uncovered.txt`, 546 lines) and a grep of every `src/disk/errors.ts` code against `src/**/*.test.ts`.

**Error codes:** every code is asserted by at least one test. `UNSUPPORTED_COMMENTS_VERSION` and `UNSUPPORTED_SCHEMA_VERSION` are asserted by error class (`commentsFile.test.ts:95`, `artboardFs.test.ts:536`), not by code string; that is enough because the class fixes the code.

**Risky paths with no test** (error, refusal, conflict and safety branches only; happy-path glue skipped):

| Where | Path | What breaks if it is wrong |
|---|---|---|
| `src/disk/artboardFs.ts:321-334` | `updateArtboard` with neither `baseGeneration` nor `baseHash`, or a malformed `baseHash` | the conflict guard: an update without a base could overwrite a newer artboard (lost Agent or user edit) |
| `src/disk/artboardFs.ts:470-471, 483-484` | rename / delete-path `ArtboardNotFoundError` | wrong error to the Agent, or a write to a missing artboard |
| `src/disk/artboardFs.ts:267-268` | `ArtboardExistsError` on `EEXIST` race | a create race overwrites an existing artboard |
| `src/disk/comments.ts:60-65` | comment body not a string, empty after trim, or over the max length | empty or oversized comments land on disk (the MCP zod layer may catch some; the disk guard is the last line) |
| `src/disk/comments.ts:209-210, 348-349` | comment action on a page with no `comments.json`, or a missing view | silent no-op or crash instead of `COMMENT_NOT_FOUND` |
| `src/disk/commentsFile.ts:251-253, 285-286, 344-354` | corrupt comment entries, non-object file, invalid fields on write | corrupt `comments.json` read as valid, or invalid comment written |
| `src/disk/parse.ts:119-123, 136-137` | manifest not an object or non-integer version; meta not an object | corrupt manifest or meta accepted instead of `CORRUPT_MANIFEST` / `CORRUPT_META` |
| `src/disk/openPage.ts:123-127` | tombstone `artboards` path exists as a directory | migration guard: a stale 0.4 MCP is not blocked |
| `src/disk/layoutFs.ts:182-183` | refuse a symlink or special file where a regular file is required | a symlinked `canvas.json` or `comments.json` read or written outside the workspace |
| `src/disk/workspaceLock.ts:24-39, 118-123` | lock create failure cleanup; release when the lock file is already gone | a stuck lock (`WORKSPACE_BUSY` forever) or a crash on release |
| `src/disk/canvasView.ts:165-168, 189-194` | invalid artboard folder skipped; unreadable HTML skipped | one bad folder blanks the whole canvas |
| `src/host/watchArtboardDisk.ts` (98 uncovered, no test file) | watcher event handling | refresh races; 11a and 11c own this (pure step + first test) |
| `src/host/handleOpenArtboard.ts`, `src/panel/openArtboardPanel.ts`, `src/mcp/registerCursorDesignMcp.ts`, `src/mcp/server.ts`, `src/extension.ts` | activation and panel glue | covered by F5 / real-Cursor checks; out of scope here |

## Ranked

Three Opus 5.5 high reviewers (Lane A: host, MCP, panel, browser with revert probes; Lane B1: disk unit tests; Lane B2: webview unit tests) and one fresh Opus 5.5 high cross-checker. No lane found a real product bug (B: none); every gap that matters is correct code with no test, so it is an S item.

**Outcome of the cross-check:** D 55 items (56 tests) confirmed, 0 rejected; S 81 items: 71 kept (6 narrowed), 8 cut (AS7, AS11, B1S22, B2S24, B2S32, B2S33, B2S44, B2S45), 2 merged (AS9 into AM2, B2S23 into B2S6); M 4 confirmed; B none. Replay over `mutation.json` with every D test and the four tests S/M items replace removed together: 0 of 7,252 killed mutants left without a killer, provided AM2 carries the y and label rows from `artboardTools.test.ts:477`.

The verdict for each id is in Cross-check below; the lane lists are kept as written (one line per item, evidence and action).

### Lane A: host, MCP, panel, browser

### 11f Lane A: host, MCP, panel, browser

Probe copy `laneA-wt` at `ef9211e` (removed). Unit probes: one-line mutation, `vp test src` (all 836 tests), restore. Browser probes: `vp build -c vite.webview.config.ts`, then `playwright test --grep`. "Killers" = the tests that went red.

#### B (real product bugs)

none. Every gap found is correct shipped code with no test (S items). The browser specs probed held (see S notes).

#### D (delete): 26 tests

AD1. [mcp] update_artboard happy path only asserts success | evidence: probe: update handler writes the constant `<p>x</p>` instead of `html`, `update_artboard hero with baseGeneration 1 succeeds` (artboardTools.contract.test.ts:328) stayed green; killers: artboardTools.contract.test.ts:488, artboardTools.test.ts:191, commentTools.contract.test.ts:212 | action: delete
AD2. [mcp] set_artboard happy path only asserts success | evidence: probe: set handler writes `html: ""`, `set_artboard hero succeeds` (artboardTools.contract.test.ts:320) stayed green; killers: artboardTools.contract.test.ts:531, :468, commentTools.contract.test.ts:212 (seedArtboard asserts success in every other test) | action: delete
AD3. [mcp] read_artboard happy path only asserts success | evidence: probe: read handler returns `html: ""`, `read_artboard hero succeeds` (artboardTools.contract.test.ts:336) stayed green; killers: artboardTools.contract.test.ts:488, artboardTools.test.ts:191 | action: delete
AD4. [mcp] export_artboard happy path only asserts success | evidence: probe: export handler returns `{}` without exporting, `export_artboard after set_artboard succeeds` (artboardTools.contract.test.ts:362) stayed green; killers: artboardTools.contract.test.ts:370, :592, commentTools.contract.test.ts:338 | action: delete
AD5. [mcp] place_frame contract happy path asserts only "canvas.json non-empty" | evidence: probe: place handler forces `group: "X"`, `place_frame hero after hero and hero-alt succeeds and writes canvas.json` (artboardTools.contract.test.ts:378) stayed green; killers: artboardTools.test.ts:288, :320, :383, :443, :457 | action: delete
AD6. [mcp] list_artboards empty-root contract test duplicates two others | evidence: probe: list handler returns a ghost frame on an empty list, killers: artboardTools.contract.test.ts:312 plus commentTools.contract.test.ts:338 (asserts the same artboards [] / frames [] at :342-344) and artboardTools.test.ts:519 | action: delete; then inline the two remaining happyPath bodies (set_active_artboard :344, handoff_status :370) and drop `happyPath`, `HappyPathArgs`, `ARTBOARD_TOOL_NAMES`
AD7. [mcp] `happyPath keys sorted-set equal ARTBOARD_TOOL_NAMES` tests the test's own table | evidence: probe: renamed a happyPath key, tsc fails TS2353 (`happyPath` is `Record<ArtboardToolName, ...>`, artboardTools.contract.test.ts:224) | action: delete (artboardTools.contract.test.ts:299)
AD8. [mcp] artboard-only listTools duplicates the 11-tool listTools | evidence: probe: registered handoff_status under another name, killers: artboardTools.contract.test.ts:303 and commentTools.contract.test.ts:206 (plus :338, :370) | action: delete artboardTools.contract.test.ts:303
AD9. [mcp] concurrent update unit test duplicates the contract one | evidence: probe: dropped `Object.assign(body, error.compared)` (mcpToolResult.ts:79), killers: artboardTools.test.ts:191, artboardTools.contract.test.ts:406, :488 (same assertions as :488) | action: delete artboardTools.test.ts:191
AD10. [mcp] export with artboardId unit tests duplicate the contract one | evidence: probe: export guard forced to run export (artboardTools.ts:289), killers: artboardTools.test.ts:244, :253, artboardTools.contract.test.ts:433 (same authored body) | action: delete artboardTools.test.ts:244 and :253
AD11. [mcp] wrong-typed html unit test duplicates the contract one | evidence: probe: html type check weakened (artboardFs.ts:138), killers: artboardTools.test.ts:129 and artboardTools.contract.test.ts:443 only | action: delete artboardTools.test.ts:129
AD12. [mcp] wrong-typed baseGeneration unit test duplicates the contract one | evidence: probe: handler coerces `Number(baseGeneration)`, killers: artboardTools.test.ts:141 and artboardTools.contract.test.ts:443 only | action: delete artboardTools.test.ts:141
AD13. [mcp] schema passthrough unit test duplicates the contract one | evidence: probe: schema types `html` as string (mcpToolResult.ts:32), killers: artboardTools.test.ts:121 and artboardTools.contract.test.ts:443 (the SDK refusal is not a JSON body) | action: delete artboardTools.test.ts:121
AD14. [mcp] non-string rootPath unit test duplicates the contract one | evidence: probe: `optionalRootPath` type check removed (mcpToolResult.ts:47), killers: artboardTools.test.ts:164 and artboardTools.contract.test.ts:443 | action: delete artboardTools.test.ts:164
AD15. [mcp] unknown rootPath unit test duplicates the contract one | evidence: probe: dropped `body.roots = error.roots` (mcpToolResult.ts:82), killers: artboardTools.test.ts:155 and artboardTools.contract.test.ts:394 | action: delete artboardTools.test.ts:155
AD16. [mcp] no-workspace unit test duplicates the contract one | evidence: probe: last `throw new NoWorkspaceError()` (resolveWorkspaceRoot.ts:45) became InvalidRootError, killers: artboardTools.test.ts:174 and artboardTools.contract.test.ts:386 | action: delete artboardTools.test.ts:174
AD17. [mcp] `explicit rootPath wins over a single layout folder elsewhere` passes rootPath = the first root, so it cannot see a wrong match; the `.cursor-design` dir it makes is never read | evidence: probe: `return matchedRoot` became `return roots[0] ?? matchedRoot` (resolveWorkspaceRoot.ts:63), resolveWorkspaceRoot.test.ts:62 stayed green, only :27 went red | action: delete resolveWorkspaceRoot.test.ts:62
AD18. [mcp] `two folders without rootPath use the first folder` repeats `omitted rootPath uses the first root` | evidence: probe: `roots[0]` became `roots.at(-1)` (resolveWorkspaceRoot.ts:65), killers: resolveWorkspaceRoot.test.ts:133 and :140, same assertion; the mkdir'd layout folders are never read | action: delete resolveWorkspaceRoot.test.ts:140
AD19. [mcp] `single root without layout is used` catches nothing | evidence: same probe as AD18, resolveWorkspaceRoot.test.ts:148 stayed green (one root is both first and last) | action: delete resolveWorkspaceRoot.test.ts:148
AD20. [host editHistory] end-to-end cap test duplicates the editHistory unit test and costs 22 disk edits | evidence: probe: cap `.slice(-MAX_HISTORY_STEPS)` became `-(MAX + 1)` (editHistory.ts:60), killers: editHistory.test.ts:74 and panelEdit.history.test.ts:185 only | action: delete panelEdit.history.test.ts:185
AD21. [host editHistory] end-to-end "edit after undo empties redo" duplicates the unit test | evidence: probe: `redo: []` became `redo: history.redo` (editHistory.ts:61), killers: editHistory.test.ts:86, :179 (property) and panelEdit.history.test.ts:197; the disk bytes after undo are already pinned by panelEdit.history.test.ts:140 | action: delete panelEdit.history.test.ts:197
AD22. [host panelOutbox] the artboard:edited variant repeats the answer-before-ready test | evidence: probe: `if (chromeReady)` in postAnswer forced true (panelOutbox.ts:135), killers: panelOutbox.test.ts:139 and :149, same branch, same assertion | action: delete panelOutbox.test.ts:149
AD23. [host canvasSnapshot] `panelFrameHtml returns the identical string` repeats the memo test | evidence: probe: memo hit disabled (canvasSnapshot.ts:57), killers: canvasSnapshot.test.ts:134, :155, :176 | action: delete canvasSnapshot.test.ts:134
AD24. [host artboardDisk] `a good read carries the resolved page id` repeats an assertion two tests already make | evidence: probe: `pageId: page.pageId` became `""` (artboardDisk.ts:87), killers: artboardDisk.test.ts:81 (asserts pageId at :90), :94, :147 | action: delete artboardDisk.test.ts:147
AD25. [host panelComments] `each copy resolves the requested page once...` is split between two other tests | evidence: probe A: getComment given `{ ...page }` (panelComments.ts:176), killers: panelComments.test.ts:186 and :315; probe B: refresh moved before the answer, killers: :186 and :242 | action: delete panelComments.test.ts:186

#### S (strengthen or remake)

AS1. [mcp] No MCP test runs with an open page other than page-1: a handler hard-wired to page-1 writes the Agent's edit to the wrong page | evidence: probe: update_artboard, resolve_comment and export_artboard each given `{ workspaceRoot, pageId: "page-1" }` instead of `resolveOpenPage(...)` (artboardTools.ts:193, :292, commentTools.ts:106), all 836 green; list_artboards hard-wired was caught only by the CORRUPT_PROJECT test by accident | action: remake: one contract test with project.json `openPageId: "page-2"` (page-1 and page-2 folders, same artboard id on both): set_artboard, update_artboard, read_artboard, list_comments, resolve_comment, export_artboard; assert page-2's files and comments.json change and page-1's bytes stay identical
AS2. [host artboardDisk] frame:place forwarding is untested: dropping `base` lets a panel drag overwrite an Agent placement made mid-drag (FrameMovedError never thrown), swapping x and y misplaces every drag | evidence: probe: removed `base: message.base` (artboardDisk.ts:194), all 836 green; probe: `x: message.y`, all green; artboardDisk.test.ts:88 asserts only `.page` | action: strengthen artboardDisk.test.ts:81: deepEqual the whole placeFrame arg `{ page, id, x, y, width, base }`
AS3. [mcp] the foreign-error fallback of toMcpToolError has no test: a raw error text (paths, errno) could reach the Agent | evidence: probe: fallback message became `String(error)` (mcpToolResult.ts:89), all 836 green; lines 86-87 uncovered (11f-uncovered.txt) | action: add: toMcpToolError(new Error('/Users/x/secret: EACCES')) returns `{ code: 'DISK_ERROR', message: <authored copy> }`, no path in the text, the stack on stderr
AS4. [host panelComments] the last-read-wins guard is untested: a slow comment read can post an older list over a newer one | evidence: probe: `token === readGeneration` forced true (panelComments.ts:62), all 836 green | action: add: two postPanelComments calls, the first readComments resolving after the second; assert one post, with the second list
AS5. [host artboardDisk] untrusted and malformed refusals untested (mock pins `isTrusted: true`, artboardDisk.test.ts:16) | evidence: uncovered artboardDisk.ts:114-117, 167-168, 176-182 | action: add: untrusted Open, refresh and frame:place each return the UNTRUSTED copy with no resolveOpenPage / placeFrame call (the resolver can migrate or create files); a malformed frame:place returns `Could not move the frame. Try again.` with no placeFrame call
AS6. [host artboardDisk] Open on a page with `artboard.html` but no manifest (ArtboardExistsError, then setActiveArtboard) is untested | evidence: uncovered artboardDisk.ts:48-51 | action: add (real temp workspace): an existing artboard.html, no manifest; initAndLoadArtboard leaves its bytes unchanged, makes it active, snapshot has no errorMessage
AS7. [host artboardDisk] the "layout error wins over the place error" rule is untested | evidence: probe: `snapshot.errorMessage ?? placeErrorMessage` became `placeErrorMessage` (artboardDisk.ts:211), all 836 green | action: strengthen artboardDisk.test.ts:94: a readCanvasView with layoutErrorMessage plus a rejected place; assert the layout message
AS8. [host panelEdit] the text-edit route is only checked as mock call args, never on disk | evidence: panelEdit.test.ts:125-135 asserts `editArtboard` mock args only; panelEdit.history.test.ts edits styles only | action: remake in panelEdit.history.test.ts: one text edit writes the new text to disk and one undo restores the original bytes; then delete panelEdit.test.ts:125
AS9. [mcp] place_frame arg checks for y and label sit in their own test | evidence: probe: y and label guards removed (artboardFs.ts:460, :462), only artboardTools.test.ts:477 went red | action: remake: fold the `{ y: null }` and `{ label: 3 }` rows into the table at artboardTools.test.ts:383, delete :477
AS10. [host canvasSnapshot] two assertions check the test's own factory and a trivial default | evidence: canvasSnapshot.test.ts:81 (`snapshotWithFrames([]).errorMessage`, factory at :62-68 used nowhere else) and :82 | action: strengthen: drop lines 81-82 and the `snapshotWithFrames` factory
AS11. [browser stage] the smoke's "network is blocked" half tests the harness, not the product | evidence: the fetch to example.invalid is aborted by the harness route (harness.ts:149-150); stage.spec.ts:79-86 asserts that abort | action: strengthen: drop the fetch probe and `abortedRequests() === 1`; keep `abortedRequests() === 0` after the frames load (that one is product behavior)

Browser probes that held (no item): editMode.spec.ts:491 went red when an adopted answer reloads (canvasFrames.ts:153) and when a stale pre-write refresh is not skipped (canvasFrames.ts:86); pages.spec.ts:210 went red when a leaked ui:error reloads page B's frame (editRequests.ts:183), with its two-frame wait.

#### M (move to the module interface)

AM1. [host panelRequestCopy] a copy-message assertion sits in the parser test | evidence: chromeMessages.test.ts:192 asserts `malformedRequestMessage('comment:copy-open')`; panelRequestCopy.test.ts:77 covers create, reply and set-status only | action: move to `malformedRequestMessage` in panelRequestCopy.test.ts:77, add `comment:copy`
AM2. [mcp] disk placement rules are tested through the MCP handler | evidence: artboardTools.test.ts:320 (orphans), :443 (group ""), :457 (later id), :383 (arg types), :398 (corrupt canvas) exercise `placeFrame` and `listArtboards` rules, not handler wiring; handler wiring is :288 | action: move to `placeFrame` / `listArtboards` in src/disk/artboardFs.test.ts; keep artboardTools.test.ts:288 as the handler test

#### P (for 11c ports)

AP1. [host panelEdit] panelEdit.test.ts (6 vi.mock) checks mock call order and args | evidence: panelEdit.test.ts:100, :149, :160 assert the `host.calls` log; :113-122 assert args to mocked resolveRequestedPage / editArtboard | action: 11c: ports for trust, folder, answer post and log over a real temp workspace; assert the answer, page-2's bytes changed, page-1's untouched, and a refused attempt leaves disk and project.json byte-identical
AP2. [host panelComments] panelComments.test.ts (5 vi.mock) mocks disk/comments and openPage | evidence: panelComments.test.ts:228, :245, :258 assert mock order; :315-336 assert mocked page args | action: 11c: real temp workspace plus fake clipboard and outbox; assert comments.json on the requested page (status sent after a copy, unchanged when the clipboard rejects), the clipboard text, and answer then comments:updated
AP3. [host artboardDisk] artboardDisk.test.ts (5 vi.mock) mocks openPage, artboardFs, canvasView, hostFs and vscode | evidence: artboardDisk.test.ts:74, :78 assert `createIfFresh` flags on a mock; :124-126 a mocked fileExists path | action: 11c: real temp workspace plus trust and folder ports; assert project.json is created only by Open, frame:place changes the requested page's canvas.json, a stale base yields the FRAME_MOVED copy
AP4. [host canvasSnapshot] canvasSnapshot.test.ts (3 vi.mock) wraps the real tagger and parser only to count calls | evidence: canvasSnapshot.test.ts:27-38, counters at :87-88 | action: 11c: inject the tagger and parser; keep the memo-hit and prune assertions
AP5. [host hostFs] hostFs.test.ts mocks `vscode.workspace.fs.stat` | evidence: hostFs.test.ts:16-24 | action: 11c: inject stat; same four cases
AP6. [host panelEdit.history] panelEdit.history.test.ts (3 vi.mock: vscode, hostFs, openArtboardPanel) is already real disk | evidence: panelEdit.history.test.ts:38-51 | action: 11c: swap only the glue for ports; keep every assertion

### Lane B1: disk

### 11f Lane B1: src/disk tests vs survivors

Scope: every `src/disk/*.test.ts` against `src/disk/*.ts` (878 survived or no-coverage mutants, 306 tests). Evidence is `test-results/11f-mutation/before/` only (survivors.txt, tests-kills.tsv, mutation.json killedBy / coveredBy); no probes run. Dominance below = the named test kills a superset of this test's killed mutants and covers a superset of its covered mutants (computed from mutation.json). The six tests skipped in the Stryker copy (selectorMatch scale x2, commentTarget MAX_MATCH_WORK, handoffCanvasHtml snapshot, handoff comments.json export bytes) are not judged, and survivors only they would kill (selectorMatch.ts:253-254 work budget, handoffCanvasHtml.ts:88-203 coordinates and markup) are left for the Step 6 run.

#### B: real product bugs

none. Every candidate traced to correct shipped behavior: the gaps below are untested correct paths (S items). Checked and cleared: `isSameStoredMeta` (exportFs.ts:159) cannot drop a locked title update (a locked update always writes the fresh hash, which differs from the stale scanned hash that triggers a refresh); `resolveRequestedPage` without `isPageId` still refuses through the index check (openPage.ts:322); `keepsStructure` refuses every tested restructuring case.

#### D: tests to delete (18 tests)

B1D1. [handoff] property test restates the example table | evidence: handoff.test.ts:367 "property: never-exported lastExport is not stale" killedBy: none-unique (k7), covers nothing unique; dominated by handoff.test.ts:278 "compareCanvasHandoff covers never exported, unchanged, changed, added, removed, unreadable, order" | action: delete
B1D2. [handoff] property test restates the example table | evidence: handoff.test.ts:378 "property: same id set and hashes is not stale" killedBy: none-unique (k16), covers nothing unique; dominated by handoff.test.ts:278 | action: delete
B1D3. [handoff] property test restates the example table | evidence: handoff.test.ts:401 "property: hash change, add, remove, or unreadable hash is stale" killedBy: none-unique (k22), covers nothing unique; dominated by handoff.test.ts:278 (which asserts change, add, remove, unreadable and swap at :307-311) | action: delete
B1D4. [handoff] property duplicate of the legacy example | evidence: handoff.test.ts:444 "property: legacy lastExport behaves as a one-frame set" killedBy: none-unique (k6); dominated by handoff.test.ts:314 "compareCanvasHandoff treats legacy lastExport as a one-frame set" | action: delete
B1D5. [errors] message pinned twice with the identical literal | evidence: errors.test.ts:12 "MigrationConflictError names both JSON copies and the JSON step" killedBy: none-unique (k21); openPage.test.ts:270 "two JSON conflicts are named together in one message" asserts the same string through resolveOpenPage and dominates it | action: delete
B1D6. [errors] message pinned twice with the identical literal | evidence: errors.test.ts:24 "MigrationConflictError names a root artboards folder and the move step" killedBy: none-unique (k19); openPage.test.ts:284 asserts ARTBOARDS_CONFLICT_MESSAGE (same text) and dominates it | action: delete
B1D7. [workspaceLock] misplaced errors test restating class constants | evidence: workspaceLock.test.ts:193 "the new errors are CursorDesignErrors with stable codes" kills 0 mutants (k0, c4); FRAME_MOVED asserted by code at artboardFs.test.ts:798, WORKSPACE_BUSY by artboardTools.contract.test.ts and handoff.test.ts | action: delete
B1D8. [workspaceLock] two-caller stale race is a subset of the many-round race | evidence: workspaceLock.test.ts:126 "two callers racing on the same stale lock both finish, one at a time" killedBy: none-unique (k30); dominated by workspaceLock.test.ts:140 "many rounds of several callers racing a stale lock never overlap" (same setup, 6 callers x 15 rounds, same three asserts) | action: delete
B1D9. [workspaceLock] single stale-lock break is a subset of the crashed-breaker case | evidence: workspaceLock.test.ts:58 "a lock older than staleMs is broken and the operation runs" killedBy: none-unique (k27); dominated by :156 "a stale lock plus a crashed breaker's stale .lock.break is cleared" (breaks a stale lock, asserts result and empty dir) and :140 | action: delete
B1D10. [workspaceLock] happy path asserted by every other test | evidence: workspaceLock.test.ts:36 "creates .cursor-design/, runs the operation, and removes the lock" killedBy: none-unique (k5, c22); :118 starts without .cursor-design and :156 asserts result plus empty lock dir | action: delete
B1D11. [openPage] same fresh-folder read twice | evidence: openPage.test.ts:428 "a fresh read returns page-1 and creates nothing" killedBy: none-unique (k62); dominated by openPage.test.ts:578 "on a fresh folder page-1 is the open page and page-2 is not found; nothing is written" (same createIfFresh false resolve, same readdir [] check) | action: delete
B1D12. [parse] version-2 project case already in the openPage table | evidence: parse.test.ts:310 "project version 2 is UNSUPPORTED_PROJECT_VERSION" killedBy: none-unique (k17); dominated by openPage.test.ts:407 "a broken project.json throws its code and writes nothing" case 2 (UnsupportedProjectVersionError plus writes nothing) | action: delete
B1D13. [artboardFs] directory-named-html skip asserted again by canvasView | evidence: artboardFs.test.ts:354 "directory named like html is skipped by list" killedBy: none-unique (k170); dominated by canvasView.test.ts:208 "directory and symlink html files are skipped the same as listArtboards" (same weird.html dir, plus a symlink) | action: delete
B1D14. [artboardEditFs] unknown id subset of the missing-dir case | evidence: artboardEditFs.test.ts:261 "an unknown artboard is ARTBOARD_NOT_FOUND" killedBy: none-unique (k150); dominated by artboardEditFs.test.ts:232 "a workspace whose artboards dir is gone is ARTBOARD_NOT_FOUND, not a disk error" | action: delete
B1D15. [commentTarget] attribute edit subsumed by the harder namespaced-attribute edit | evidence: commentTarget.test.ts:49 "editing an attribute inside the target changes the fingerprint" kill and cover sets identical (k114, c214) to commentTarget.test.ts:186 "editing a namespaced SVG attribute inside the target changes the fingerprint" | action: delete (keep :186 and :45 text edit)
B1D16. [commentTarget] tests parse5's quote normalization, not ours | evidence: commentTarget.test.ts:38 "rewriting single-quoted attributes as double-quoted keeps the fingerprint" kill and cover sets identical (k113, c214) to :28 "re-indenting between tags keeps the fingerprint"; a source-slice fingerprint regression also fails :28 and :34 | action: delete
B1D17. [commentTarget] uncheckable-match branch adds nothing over tag mismatch | evidence: commentTarget.test.ts:304 "targetAgrees is false when the match is not checkable" killedBy: none-unique (k4), all 4 also killed by :272 "targetAgrees is false on a tag mismatch" | action: delete
B1D18. [handoff] export id format asserted by the export test | evidence: handoff.test.ts:175 "makeCanvasExportId strips ISO punctuation" killedBy: none-unique (k2); handoff.test.ts:465 (inside :457 "canvas export writes one tree...") asserts exported.exportId === FIXED_EXPORT_ID | action: delete

Kept despite zero unique kills (not D): pure-rule unit tests dominated only by integration tests (conflict.test.ts, effectiveMeta.test.ts, parse.test.ts round-trips, canvasLayout.test.ts:44/:98) localize the rule they pin; handoffCanvasHtml.test.ts:80 holds the only assertion on `sandbox="allow-scripts"` (a template-literal static Stryker cannot mutate); workspaceLock.test.ts:43 (rethrow-same-error, no generated mutant); openPage.test.ts unknown-root-entries and tombstone-not-legacy (data-safety invariants with no mutant to express them); the commentsFile and comments key-order tests (different code paths: zod output vs orderedComment); selectorMatch.test.ts linear-time tests (perf claims kill counts cannot see).

#### S: tests to strengthen or add (23 items), ranked

B1S1. [artboardFs] update_artboard with no base, or a malformed base, is never refused by any test; the disk check is the only guard (artboardTools.ts:190 passes unknown args straight through), so a broken guard overwrites a newer artboard with no conflict check (lost edit) | evidence: artboardFs.ts:321 ConditionalExpression false Survived, block NoCoverage; :328 ConditionalExpression false x2 + LogicalOperator; :332 ConditionalExpression false x2 + LogicalOperator; :334 NoCoverage | action: strengthen artboardFs.test.ts: updateArtboard with neither base throws INVALID_ARGS and leaves HTML and meta bytes unchanged; baseGeneration 0, 1.5 and "1", and baseHash "sha256:zz", each throw INVALID_ARGS (not CONFLICT)
B1S2. [comments] replyToComment's body rule is the only guard (chromeMessages.ts:63 defers to disk) and is untested: a broken guard writes an empty or oversize reply, the next read is CORRUPT_COMMENTS and every comment on the page goes unreadable | evidence: comments.ts:59 BlockStatement, :60 ConditionalExpression false, :63 MethodExpression, :64 ConditionalExpression false x3 + EqualityOperator + LogicalOperator Survived; :61, :65 NoCoverage | action: strengthen comments.test.ts:519 area: replyToComment with body "   ", 42 and "x".repeat(MAX_COMMENT_BODY_CHARS + 1) throws INVALID_ARGS with COMMENT_BODY_MESSAGE and comments.json bytes unchanged; a body of exactly MAX chars plus edge spaces is stored trimmed
B1S3. [commentsFile] validateNewComment's field rules never see an invalid pick: a broken guard writes an invalid comment and bricks the page's comments.json | evidence: commentsFile.ts:347 ConditionalExpression false x5 + LogicalOperator x4, :345 false, :351 false Survived; :352-354 NoCoverage | action: strengthen comments.test.ts:216: addComment with (element comment, rect null), (isPage true, selector "p"), (tagName "P!"), (generation 0) each throw INVALID_ARGS with COMMENT_FIELDS_INVALID_MESSAGE and comments.json stays absent; plus an empty body asserts COMMENT_BODY_MESSAGE (kills commentsFile.ts:341 x6, today shadowed by the schema's min length)
B1S4. [layoutFs / canvasView] a non-JSON canvas.json (the likely hand-edit corruption) is never tested: with the JSON.parse catch gone a SyntaxError escapes resolveLayoutOrEmpty (canvasView.ts:286 catches only Corrupt/Unsupported) and the whole canvas fails to load | evidence: layoutFs.ts:272 BlockStatement, :273 ObjectLiteral Survived | action: strengthen canvasView.test.ts corrupt-canvas test: canvas.json "{" gives auto-placed frames, layoutErrorMessage === new CorruptCanvasError({pageId}).message text, file bytes unchanged; placeFrame on it throws CORRUPT_CANVAS and writes nothing
B1S5. [commentsFile / commentViews] the stored frameId guard is untested: without parseArtboardId a comments.json entry with frameId "../../x" loads, and commentViews.ts:71 reads pages/<id>/artboards/../../x.html (workspaceJoin has no containment) | evidence: commentsFile.ts:225 BlockStatement, :226 CallExpression Survived; :227-228 NoCoverage | action: strengthen commentsFile.test.ts:161: a comment with frameId "../x" (and "") is CORRUPT_COMMENTS
B1S6. [exportFs] ids "." and ".." pass the artboard-id charset (parse.ts:22) and become handoff folder names (`ungrouped/../index.html`); the refusal is untested | evidence: exportFs.ts:142 ConditionalExpression false, StringLiteral "" Survived | action: strengthen handoff.test.ts:800 "read failures write no handoff leaf": a page whose artboards hold `..html` (id ".") and `...html` (id "..") makes exportArtboard throw DISK_ERROR naming the rename, and handoff/ gets no leaf
B1S7. [layoutFs / artboardFs] a non-JSON manifest.json is never tested: the JSON.parse catch and set_active_artboard's documented overwrite-a-corrupt-manifest path are both dead in tests | evidence: layoutFs.ts:216 BlockStatement, :217 ObjectLiteral x2 Survived; artboardFs.ts:516-519 NoCoverage (5) | action: add to artboardFs.test.ts: manifest.json "{" gives readArtboard without id CORRUPT_MANIFEST with a SyntaxError cause; setActiveArtboard on it rewrites a valid manifest with that id; createArtboard on it succeeds
B1S8. [layoutFs] the tolerant meta read is untested: if every meta read were strict, one hand-broken meta would block read_artboard and update_artboard for that frame | evidence: layoutFs.ts:291 BooleanLiteral true, :303 ConditionalExpression true, :304 ConditionalExpression true Survived | action: add to artboardFs.test.ts: hero.meta.json "{" (and a foreign id) gives readArtboard the effectiveArtboardMeta defaults and updateArtboard succeeds and rewrites a valid meta; export on the same file stays CORRUPT_META (already at handoff.test.ts:944)
B1S9. [errors] throwDiskError and DiskError's default copy are untested: with the string check inverted the Agent gets "[object Object]" on every fs failure; the cause can drop; a domain error can be rewrapped as DISK_ERROR | evidence: errors.ts:220 ConditionalExpression true, :222 StringLiteral, :223 ConditionalExpression false, :464 ConditionalExpression false Survived, :464 BlockStatement NoCoverage | action: add to errors.test.ts: throwDiskError(Object.assign(new Error('EACCES: /home/x'), {code: 'EACCES'})) throws DiskError, code DISK_ERROR, message equal to the authored default (no path), cause is the original; throwDiskError(new ArtboardNotFoundError('a')) rethrows that same instance
B1S10. [canvasView] list_artboards' `active` flag is asserted by no test (Agent can be told the wrong artboard is active) | evidence: canvasView.ts:244 ConditionalExpression true/false + EqualityOperator Survived; :222 x3, :122 x3 (unreadable branches) | action: strengthen canvasView.test.ts:208 (or artboardFs list test): with two artboards and manifest active = hero, listed.artboards maps active to [true, false]; include one artboard with a broken meta so :122 is checked too
B1S11. [artboardEdit] whitespace around `=` in a style attribute is untested: a broken skip reads `style = "color: red"` as valueless and rewrites it, dropping the user's declarations | evidence: artboardEdit.ts:270 AssignmentOperator + MethodExpression, :275 AssignmentOperator + MethodExpression Survived; :271-272 NoCoverage | action: strengthen artboardEdit.test.ts:148: style('<p style = "color: red">a</p>', 0, 'margin', '0') equals ok('<p style = "color: red; margin: 0px">a</p>')
B1S12. [artboardEdit] the unquoted-style-with-quote refusal is never decisive: the test input `style=a"b` is already refused by applyStyleChanges, so dropping the guard would write `style="font-family:"x"; ..."` (broken markup) unnoticed | evidence: artboardEdit.ts:315 BlockStatement, ConditionalExpression true/false, EqualityOperator Survived | action: strengthen artboardEdit.test.ts:252: add style('<p style=font-family:"x">a</p>', 0, 'color', '#000000') is refused('unsupported-style')
B1S13. [artboardEdit] clearing an element's text to empty is never tested (the expectedText === '' branch is dead in tests), so a broken branch refuses every clear as not-plain-text | evidence: artboardEdit.ts:186 BlockStatement NoCoverage + ConditionalExpression false + StringLiteral Survived; :187 NoCoverage x3 | action: strengthen artboardEdit.test.ts:39: text('<p>Hi</p>', 0, '', 'Hi') equals ok('<p></p>')
B1S14. [comments] setCommentStatus and markCommentsSent on a workspace with no comments.json must create nothing; without the pre-lock check the lock's mkdir creates .cursor-design/ | evidence: comments.ts:209 ConditionalExpression false Survived, :209-210 NoCoverage; :241 ConditionalExpression false Survived, :241-242 NoCoverage | action: strengthen comments.test.ts:338 "resolve and reply on a workspace with no .cursor-design create nothing": add setCommentStatus (COMMENT_NOT_FOUND) and markCommentsSent ([]), readdir(root) stays []
B1S15. [parse / commentsFile] top-level `null` JSON in manifest, meta, project and comments files is untested: the record guards fall through to a TypeError (generic error) instead of the file's CORRUPT_* code; a manifest with version "1" or 1.5 is never tested | evidence: parse.ts:25 ConditionalExpression true, :119 false (+:119-120 NoCoverage), :122 NoCoverage, :136 false (+:136-137 NoCoverage), :148 BlockStatement + false, :149 CallExpression; commentsFile.ts:285 false (+NoCoverage) | action: one table test in parse.test.ts: null and [] give CORRUPT_MANIFEST, CORRUPT_META, CORRUPT_PROJECT; manifest {version: "1"} and {version: 1.5} give CORRUPT_MANIFEST (not UNSUPPORTED_SCHEMA_VERSION); comments null gives CORRUPT_COMMENTS
B1S16. [exportFs] the export tail's no-scanned-meta case is untested: a locked update that creates a missing meta (same HTML, new title) between scan and tail would be overwritten with the default title | evidence: exportFs.ts:164 ConditionalExpression true Survived (only killed sibling: :164 false by handoff.test.ts:582) | action: add beside handoff.test.ts:711 using exportAroundLockedWrite: hero with no meta, the locked write creates hero.meta.json with title "Renamed"; after export the meta still has "Renamed"
B1S17. [workspaceLock] the `.lock.break` exclusion is unproven: no test holds a live breaker, so breaking without the sub-lock (and deleting a live breaker's `.lock.break`) passes | evidence: workspaceLock.ts:87 BooleanLiteral, ConditionalExpression false, BlockStatement; :91 ConditionalExpression true x3 + LogicalOperator + EqualityOperator; :94 BooleanLiteral Survived | action: add: stale `.lock` plus a FRESH `.lock.break` makes withWorkspaceLock({timeoutMs: 100}) reject LockTimeoutError, operation not run, both files byte-unchanged
B1S18. [workspaceLock] the owner check is only tested with a hand-written foreign token: all-empty tokens (every caller the same owner) pass | evidence: workspaceLock.ts:136 StringLiteral `` Survived; workspaceLock.test.ts:173 writes '2 someone-else' by hand | action: remake workspaceLock.test.ts:173: holder A (staleMs 50) waits past staleMs while B breaks and acquires; when A's release runs, B's `.lock` still exists until B's operation ends
B1S19. [canvasView] a page with artboards but no manifest.json is never read through readCanvasView, so `scanned.manifest?.lastExport` dropping its `?.` (a crash) passes | evidence: canvasView.ts:273 OptionalChaining Survived | action: add to canvasView.test.ts: delete manifest.json after createArtboard; readCanvasView returns the frame, activeArtboardId "", handoffStale false
B1S20. [canvasView] an `.html` file whose name is not a valid id (`my page.html`) is never in a test; a broken skip lists an id every tool then refuses | evidence: canvasView.ts:162 BlockStatement, :163 CallExpression Survived; :164-165 NoCoverage (4) | action: strengthen canvasView.test.ts:208: add `my page.html`; list and canvas still show only valid ids, no throw
B1S21. [layoutFs] writeUtf8's refusal of a symlink or special file is untested (reads refuse first in read-modify-write flows, but createArtboard writes meta and manifest without reading) | evidence: layoutFs.ts:182 ConditionalExpression false x3 + LogicalOperator + StringLiteral x2 Survived, :182-183 NoCoverage | action: add to artboardFs.test.ts: a symlink at pages/page-1/manifest.json pointing outside makes createArtboard throw DISK_ERROR; the link and its target are unchanged
B1S22. [artboardEdit] sourceNumber guard never decisive: a string "0" would index entries["0"] and edit element 0 | evidence: artboardEdit.ts:354 BlockStatement, ConditionalExpression false x4, LogicalOperator x2 Survived | action: strengthen artboardEdit.test.ts:69 "a malformed edit shape is refused": sourceNumber "0", 1.5 and -1 each refused('unknown-number')
B1S23. [openPage] tautological expected value: the per-entry conflict test computes its expected message with the code under test | evidence: openPage.test.ts:265 message: new MigrationConflictError({...}).message | action: strengthen: drop the message compare there (copy is pinned by literals at openPage.test.ts:270 and :284 after B1D5/B1D6), keep names and nothing-moved asserts

#### M: tests to move

none. No disk test reaches a private or `@internal` export (src/disk has none); B1D7 is a misplaced errors test and is deleted rather than moved (its codes are asserted elsewhere).

#### Coverage-gap rows in src/disk (report table), verdict

- artboardFs.ts:321-334 missing or malformed base: S (B1S1).
- artboardFs.ts:470-471, 483-484 placeFrame ArtboardNotFound after requireHtmlFile: unreachable defense (an id that passed requireHtmlFile and requireExactHtmlFileName is always listed); only a delete race between them reaches it. No test.
- artboardFs.ts:267-268 EEXIST on the wx write: race-only (layoutEntryKind at :257 runs first); untestable without fs injection. No test.
- comments.ts:60-65 body rules: S (B1S2); commentsFile.ts:344-354: S (B1S3).
- comments.ts:209-210: S (B1S14). comments.ts:348-349: unreachable (withCommentViews returns one view per comment). No test.
- commentsFile.ts:251-253 non-record entry: equivalent (zod rejects the result anyway); :285-286: S (B1S15).
- parse.ts:119-123, 136-137: S (B1S15).
- openPage.ts:123-127 tombstone path became a directory: race-only (legacyRootEntries classifies a real root artboards dir as legacy first; openIndexedPage handles it at :251). No test.
- layoutFs.ts:182-183: S (B1S21).
- workspaceLock.ts:24-39 create-failure cleanup: needs a failing handle.writeFile, untestable without fs injection; ponytail at :31 already names the ceiling. :118-123 release with the lock gone: equivalent (both branches return; only a stderr line differs). No test.
- canvasView.ts:165-168: S (B1S20). :189-194 html undefined after a 'file' kind: race-only. No test.

#### Equivalent mutants (grouped; survivors not named in S above)

- errors.ts (about 58): StringLiteral on authored copy (Agent copy that matters is pinned by literal tests in openPage.test.ts and the MCP contract tests); isErrno :30-31 (fs errors are always objects with `code`); ArtboardNotFoundError empty-id copy :172-177; migrationConflictMessage :423 some/every (copy for a mixed conflict only).
- Object-literal `{pageId}` -> `{}` and `{cause}` -> `{}` (about 35 across commentsFile, canvasLayout, layoutFs, parse, openPage): the code and class are unchanged, only the path in the message or the cause; low value to pin per site.
- Subexpression ConditionalExpression / LogicalOperator where a sibling clause already decides (about 70: commentsFile.ts:214-215, :235, :263-264, :288; parse.ts:122 (one), :151; artboardEditFs.ts:49; artboardEdit.ts:81-85, :128-130, :174-182, :191-193, :359-360; handoff.ts:164; canvasView.ts:98, :201, :251, :323-330): the other clause or a later check gives the same result.
- Optional chaining on values that are always present (about 25: artboardEdit.ts:79, :115-119, :294-308; sourceTags.ts:28, :52; canvasView.ts:323-330; openPage.ts:81, :126): parse5 locations and scanned frames are always set when reached.
- Timing-only (workspaceLock.ts:80-81, :83, :106, :144, :147, :150; artboardEdit.ts:235 early return; editValues.ts:36): only how fast a retry or result comes, never which result.
- Race-only windows (workspaceLock.ts:47-48, :58-60, :98, :102-103; layoutFs.ts:165, :191-200; openPage.ts:121-129, :146-160, :271; artboardFs.ts:357-358; canvasView.ts:193): reachable only when another process changes the file between two syscalls; not testable without fs injection.
- Redundant option objects and encodings (openPage.ts:71, layoutFs.ts:139, :197, canvasView.ts:149, artboardFs.ts:265, workspaceLock.ts:27, exportFs.ts:95): readdir returns strings by default; the tmp is unlinked before the wx write; the dir already exists.
- 'symlink' vs 'other' kind (layoutFs.ts:73-76): every caller treats both the same.
- Data tables (about 110: inlineStyle.ts LONGHANDS / PARENTS / NAMED_SYNTAX :34-84; editValues.ts keyword sets :73-79 and regexes :24-31; layout.ts RAW_TEXT and VOID element lists :90-111): one representative per table is tested; pinning every entry would restate the table (tautology). Not equivalent strictly, but not worth a test each.
- inlineStyle.ts scanner state (:189-236, :267, :283-285, :321, :332-375; about 30): sub-clauses of the comment / escape / bracket state machine whose effect is covered by the endsOpen and no-split tests; the property test inlineStyle.test.ts:224 (rebuild exactly) holds the invariant.
- selectorMatch.ts (20), sourceTags.ts (16), commentTarget.ts (20), commentViews.ts (23): case folding, cache-size boundary (:56 <=), parse-cache deletes, fingerprint normalization regex variants with the same output for parse5-serialized input, and branches the skipped MAX_MATCH_WORK / scale tests own.
- canvasView.ts:144, :155, :297 activeArtboardId "" -> junk on an empty page, :315 / :344 htmlReadErrors [] vs junk: host-log or empty-page fields no test reads; low value (B1S19 covers the empty-manifest read).
- hash.ts:5 regex anchors, :14 'utf8': a malformed hash that passes still ends in CONFLICT; utf8 is the default.

### Lane B2: webview

### Lane B2: webview and frame unit tests (11f Step 4)

Scope: every `src/webview/**/*.test.ts` against `src/webview/*.ts` and `frame/{anchorRects,frameMessages,pickPath,pickTarget,selector}.ts`. Data: `test-results/11f-mutation/before/` (disableBail, so killedBy is complete). 437 webview survivors (Survived + NoCoverage), every one classified below (script check: 0 unassigned). Unmutated subjects (`runtime.test.ts`, `ui/theme.test.ts`, `selectorMatch.oracle.test.ts`, `commentTarget.roundtrip.test.ts`) judged by reading. No probes run (Lane B rule); D evidence is killedBy plus coveredBy.

Delete-set check: removing all 12 D tests together (plus `stageGeometry.test.ts:46`, remade in B2S17) leaves 0 killed mutants with no killer and 0 covered mutants with no coverer, across all 47 mutated files (`killedBy`/`coveredBy` replay over `mutation.json`).

#### B: real product bugs

none. Every non-equivalent survivor is correct shipped code with a missing assertion (S items). Closest calls, all correct today: `editDrafts.ts:132,150,240` and `frameMessages.ts:335,338` use the same `>` cap as the frame (`editTarget.ts:43,68`); `pins.ts:139` relies on the host setting `stale` and `targetMissing` together (`commentViews.ts:150`); `selector.ts:62` (`!element.isConnected`) is dead because finder throws on a detached element anyway (refactor for 11a, not a bug).

#### D: tests to delete (12 tests)

B2D1. [stageGeometry] duplicates the zoom-at-cursor property: one example of what `property: zoom-at-cursor keeps the screen pixel` (stageGeometry.test.ts:550) asserts for every view | evidence: killedBy none-unique (33 kills, every one also killed by :550 or :34/:111), covers nothing unique | action: delete stageGeometry.test.ts:121 'the stage point under the cursor stays under it while zooming'
B2D2. [stageGeometry] zoomStageTo anchor example duplicated by the same property (which runs zoomStageTo too) and by the exact :111 | evidence: killedBy none-unique (15 kills; co-killers :111, :121, :550, frameGesture.test.ts:169) | action: delete stageGeometry.test.ts:80 'zoomStageTo keeps the screen anchor fixed at the target zoom'
B2D3. [stageGeometry] clamp at both ends duplicates :60 'zoom clamps exactly at the minimum and maximum' (same zoomStageTo 0 and 1000 cases) plus the anchor property | evidence: killedBy none-unique (13 kills; co-killers :52, :60, :80, :111) | action: delete stageGeometry.test.ts:92 'zoomStageTo clamps the target zoom at both ends'
B2D4. [stageGeometry] zero input zoom via zoomStageAt asserts only "finite"; :111 pins the same zero-zoom path exactly and the clamp property (:595, finiteZoom includes 0) covers zoomStageAt | evidence: killedBy none-unique (12 kills; co-killers :46, :52, :60, :121, :111) | action: delete stageGeometry.test.ts:132 'a zero input zoom still yields a finite view'
B2D5. [stageGeometry] tests the `/** @internal */` `frameBounds`, whose only use is inside layoutCanvasChrome; :151 and :172 assert the same union and null bounds through the export; the property's `union` (stageGeometry.test.ts:643) only checks null for [] | evidence: killedBy none-unique (12 kills; co-killers :151, :172, :632, handoffCanvasHtml.test.ts:136) | action: delete stageGeometry.test.ts:199 'frame bounds are the union rect, or null for no frames', drop the `union` lines in :643-647, un-export `frameBounds` (stageGeometry.ts:161-162)
B2D6. [stageGeometry] panStage duplicate: frameGesture.test.ts:169 asserts the same exact pan ({x:35,y:23}) through wheelToView | evidence: killedBy none-unique (4 kills, each also killed by frameGesture.test.ts:169) | action: delete stageGeometry.test.ts:143 'pan moves the view against the wheel delta and keeps zoom'
B2D7. [stageGeometry] dragFrame property asserts only integer + range; :692 (rounding, delta) and :702 (-0, clamp to 100000) pin the same rules exactly | evidence: killedBy none-unique (10 kills; co-killers :692, :702, frameGesture.test.ts:53/:83) | action: delete stageGeometry.test.ts:757 'property: dragFrame lands on a whole px within ±MAX_FRAME_COORDINATE'
B2D8. [stageGeometry] resizeFrameWidth property duplicates :679 (119/120/3840/3841 clamps, 5.4/3.6 rounding) | evidence: killedBy none-unique (8 kills; co-killers :679, frameGesture.test.ts:77) | action: delete stageGeometry.test.ts:779 'property: resizeFrameWidth lands on a whole px within 120..3840'
B2D9. [commentsPanel] frameLabel cases (label, unknown id, empty label) are the same branches :84 ('Home') and :100 ('gone', 'blank') assert through panelItems | evidence: killedBy none-unique (9 kills, all also killed by :84/:100) | action: delete commentsPanel.test.ts:134 'frameLabel: the label, or the id for an unknown frame or an empty label'
B2D10. [commentPick] the Interact row of the pickCounts table (:84) plus the drop path in :101 cover the same `!pickCounts` branch; browser picking.spec.ts:416 proves the forged-in-Interact case end to end | evidence: killedBy none-unique (16 kills), covers nothing unique | action: delete commentPick.test.ts:72 'hover and pick posted in Interact mode are ignored'
B2D11. [frameMessages] parsePickFields guards are the cd:pick guards: :150 (selector newline), :291/:150 (page label) and the savedState draft tests run the same function | evidence: killedBy none-unique (111 kills), covers nothing unique | action: delete frameMessages.test.ts:207 'parsePickFields keeps the pick fields without type and repost, with the same guards'
B2D12. [canvasFrames] one field of mergeRecord's "follows every post" set; generation is also asserted by the stale pre-write tests (:275, :311, :335) and adopt (:260) | evidence: killedBy none-unique (17 kills) | action: delete canvasFrames.test.ts:230 'each post carries the frame generation onto its record'

Kept despite zero unique kills (by reading): editRequests.test.ts:322 (only check that enqueueStep clears the copy; a property removal Stryker cannot mutate), selector.test.ts:52/:60/:73/:99/:144 (distinct DOM edge cases), commentTarget.roundtrip.test.ts:54 (tagged copy never reaches a selector, rule 02), stampArtboardHtml.test.ts:53/:66/:85 (CSP order, html attributes, the real runtime embeds once), stageGeometry.test.ts:459 and frameMessages.test.ts:512 (subject not mutated: `?iife` closing tag, system-map contract), pins.test.ts:88 (forged anchor-rects), savedState.test.ts:58 (old commentMode key).

#### S: tests to strengthen or remake (ranked)

B2S1. [editRequests] the text-edit send shape is never asserted: `field: 'text'` -> '' survives, so every text edit could post a field the host refuses | evidence: editRequests.ts:153 StringLiteral survived; editRequests.test.ts:112 checks only liveText | action: strengthen: deepEqual the whole send in editRequests.test.ts:101 ({type:'artboard:edit', requestId, frameId, sourceNumber, hash, field:'text', value:'New', liveText:' Old '})
B2S2. [editRequests] clearErrorOnPick can wipe the queue or crash: `{...state, error: undefined}` -> {} (drops waiting and inFlight: lost edit) and `state.error?.key` -> `state.error.key` (crash on every pick with no copy) both survive | evidence: editRequests.ts:229 ObjectLiteral, editRequests.ts:224 OptionalChaining survived; editRequests.test.ts:193,197 assert only `.error` | action: strengthen editRequests.test.ts:186: deepEqual the whole state after clearing with an edit waiting, and assert clearErrorOnPick(INITIAL_EDIT_REQUESTS, pick) returns the same object
B2S3. [editRequests] a sent step is never checked to leave the queue (`slice(index + 1)` -> waiting: undo re-sent) and the in-flight early return's state is never read (`{state, send: undefined}` -> {}) | evidence: editRequests.ts:133 MethodExpression, editRequests.ts:120 ObjectLiteral survived | action: strengthen editRequests.test.ts:216: assert `sent.state.waiting` no longer holds the step and `nextSend` while in flight returns the same state object
B2S4. [editDrafts] a changed colour is never committed in a test: `next.toLowerCase() === previous.toLowerCase()` -> true (every typed colour reads unchanged and never saves) survives; `previous === undefined` -> false (crash on an unnormalizable inline colour) too | evidence: editDrafts.ts:174 ConditionalExpression, editDrafts.ts:170 ConditionalExpression survived; editDrafts.test.ts:144 asserts only the unchanged case | action: strengthen editDrafts.test.ts:134: commitDraft(draftOf('color', '#00ff00')).kind === 'save', and a colour draft over `style: 'color: var(--x)'` saves
B2S5. [editDrafts] a text draft's revert is never asserted: `draft.field === 'text'` -> false makes Escape or a refused text send the style baseline, so the frame keeps showing unsaved text | evidence: editDrafts.ts:161 ConditionalExpression/StringLiteral/ObjectLiteral survived (3); editDrafts.test.ts:166-167 asserts only the error | action: strengthen editDrafts.test.ts:155: deepEqual the control-text verdict's revert to {type:'cd:edit-apply', sourceNumber:4, text:'\n    Title\n  '}
B2S6. [commentActions] Resolve's message and pending are never asserted (`'comment:set-status'` -> '' survives) and a status answer is never checked to keep a reply draft (`{...action, pending: undefined}` -> {} deletes typed reply text) | evidence: commentActions.ts:158 StringLiteral, :156 ObjectLiteral x3, :301 ObjectLiteral survived; commentActions.test.ts:89 reads only `.message?.status`, :107 has no reply draft | action: strengthen: deepEqual submitStatus's message and pending in commentActions.test.ts:89; in :107 give c1 `reply: 'Draft'` and assert the answer leaves `{ reply: 'Draft' }`
B2S7. [commentActions] a ui:error answering a pending single copy is never tested: `answer.type !== 'ui:error'` -> true returns early, so a failed Copy for Agent stays pending forever | evidence: commentActions.ts:278:70 ConditionalExpression, :278:86 StringLiteral survived | action: strengthen commentActions.test.ts:278: a ui:error with the copy's requestId clears pending, sets the error and announces it
B2S8. [frameMessages] no accepted cd:anchor-rects entry has a non-null `visible`: `box === null` -> true would drop every live anchor that is on screen (pins never follow the design) | evidence: frame/frameMessages.ts:422 ConditionalExpression survived; frameMessages.test.ts:434-442 accepts only `visible: null` | action: strengthen frameMessages.test.ts:428: add `{ id: 'c3', box: rect, visible: rect }` to the accepted list
B2S9. [hostMessages] the accept paths of comment:added and of ui:error with a requestId are never asserted (the test named for them checks rejections only): `data.type === 'comment:added'` -> false survives, and ui:error drops its requestId (`requestId === undefined` -> true, branch NoCoverage) | evidence: hostMessages.ts:440 ConditionalExpression/StringLiteral, :408 ConditionalExpression, :410 NoCoverage x2 | action: strengthen hostMessages.test.ts:242: deepEqual parseHostMessage({type:'comment:added', requestId:'r1'}) and ({type:'ui:error', message:'x', requestId:'r1'})
B2S10. [frameGesture] pointer move gaps: a sub-threshold move is never checked to keep the gesture (`{ gesture }` -> {} cancels a drag on 1px jitter), a vertical drag from a non-zero start y is never measured (`now.y - startStage.y` -> `+`), and moving back under the threshold after passing it is never tested (`gesture.override === undefined` -> true freezes the last far preview) | evidence: frameGesture.ts:162 ObjectLiteral, :171 ArithmeticOperator, :161 ConditionalExpression survived | action: strengthen frameGesture.test.ts:71: assert the sub-threshold step returns a gesture (not undefined); in :53 start at screenY 40 and move to 47.6, then back to the start, and assert override y and that end commits nothing
B2S11. [frameGesture] only ArrowLeft and ArrowUp are asserted: ArrowRight -> no step and ArrowDown -> negative step both survive (keyboard nudge right/down) | evidence: frameGesture.ts:212 x2, :213, :216 x2, :219 survived (6) | action: strengthen frameGesture.test.ts:139: table of all four arrows for move ({8,0},{-8,0},{0,8},{0,-8}) and Right for resize
B2S12. [frame/anchorRects] x moves are never detected in a test (`|dx| > 0.5` -> false survives: pins stay put after a horizontal shift), a shorter next list is never compared (`last.length !== next.length` -> false), and null-to-null is never quiet (`last !== next` -> true re-posts every frame) | evidence: frame/anchorRects.ts:13 ConditionalExpression, :29 ConditionalExpression, :10 ConditionalExpression, :14-16 EqualityOperator survived (6) | action: strengthen anchorRects.test.ts:17 (loop x, y, width, height at +0.5 false and +0.51 true) and :24 (next drops the last anchor -> true; box and visible null on both sides -> false)
B2S13. [frame/pickTarget] clipRect is never asked for an empty vertical overlap: `top >= bottom` -> false returns a negative-height rect, which parseFrameRect rejects, dropping the whole anchor-rects post | evidence: frame/pickTarget.ts:81 ConditionalExpression and EqualityOperator survived (2) | action: strengthen pickTarget.test.ts:74: a clip above the rect -> null, and a clip touching its bottom edge -> null
B2S14. [commentPick] cd:ready from one frame is never checked against another frame's pick or hover: `state.pick?.frameId === frameId` -> true drops frame A's pick when frame B reloads; hover sends and keepLiveFrames' live hover are unasserted | evidence: commentPick.ts:100, :99, :81 ConditionalExpression, :110/:113 ArrayDeclaration, :112 OptionalChaining survived (6) | action: strengthen commentPick.test.ts:55: cd:ready from 'b' keeps a's pick and drops only b's hover; a hover step returns sends []; keepLiveFrames keeps a live frame's hover
B2S15. [pins] keepOpenThread is only tested with one pin: `pins.some` -> `pins.every` survives, so any comments update with two pins would close the open thread | evidence: pins.ts:319:32 MethodExpression survived | action: strengthen pins.test.ts:290: layout two comments and assert keepOpenThread({openThreadId:'c1', pins}) === 'c1'
B2S16. [editInspector] italic and the set dots are under-asserted: computed 'italic' never tested (pressed and toggle break), the Italic button's own set, the group's set via text-decoration-line, and Align's set are never true in a test | evidence: editInspector.ts:320 ConditionalExpression/StringLiteral, :337, :425, :434 StringLiteral survived (5) | action: strengthen editInspector.test.ts:336: buttons({'font-style':'italic'})[0] pressed true with change 'normal'; buttons({}, 'font-style: italic') sets [true,false,false]; group set for 'text-decoration-line: underline'; in :293 'text-align: center' makes the Align group and its buttons set
B2S17. [stageGeometry] remake the direction-only wheel test: deltaY 10 (0.1, under the 0.2 cap) is never measured, so `-deltaY * ZOOM_SENSITIVITY` -> `/` (every wheel step hits the cap) survives | evidence: stageGeometry.ts:134 ArithmeticOperator survived; stageGeometry.test.ts:48-49 assert only > 1 and < 1 | action: remake stageGeometry.test.ts:46: assertClose zoomStageAt deltaY -10 -> zoom Math.exp(0.1), deltaY 10 -> Math.exp(-0.1)
B2S18. [stageGeometry] a zero-size viewport (hidden webview) is never clamped in a test: `viewportWidth <= 0` -> false shifts the user's view on hide; fitZoom's height and viewportHeight edges are untested | evidence: stageGeometry.ts:301 x4, :338, :340 x3 survived (8) | action: strengthen stageGeometry.test.ts:275 (clampStageView with viewportWidth 0 and with viewportHeight 0 returns the view unchanged) and :333 (height 0 -> undefined; viewportHeight = 2 * FIT_PADDING -> undefined)
B2S19. [stageGeometry] group headings are only tested with frames in left-to-right, same-y order: a later frame further left or higher never moves the heading (`found.minX > frame.x` -> false etc.) and an empty-string group is never tested | evidence: stageGeometry.ts:213, :216 x4, :219 x2, :200 survived (11; the `>=` variants among them are equivalent but die with the same test) | action: strengthen stageGeometry.test.ts:151: a group whose second frame is left of, above and narrower than the first -> heading at min x, min y, width to the max right; a frame with group '' gets no heading
B2S20. [stageGeometry] the height growth guard never sees a first growth of 1px: `state.lastGrowth > 0` -> true freezes a frame on its first 1px growth | evidence: stageGeometry.ts:261:6 ConditionalExpression and EqualityOperator survived | action: strengthen stageGeometry.test.ts:379: from reset state, current 800 reported 801 -> height 801, frozen false
B2S21. [commentPopover] keptCommentDraft is never called with no slot (`slot?.pageId` -> `slot.pageId` crashes the common no-draft save) and keepLiveDraft never with no draft | evidence: commentPopover.ts:250 OptionalChaining, :215 ConditionalExpression survived | action: strengthen commentPopover.test.ts:240: keptCommentDraft({slot: undefined, page: {pageId:'p1', draft: undefined}}) === undefined; :188 resolveHeldDraft({held: undefined, ...}) -> {}
B2S22. [commentActions + commentPopover] an answer without a requestId is only tested against entries that have a pending id: `answer.requestId === undefined` -> false would let a standing ui:error attach to an idle reply draft, an idle Copy button or an idle comment draft | evidence: commentActions.ts:269 ConditionalExpression/BlockStatement, :272 OptionalChaining, :247 ConditionalExpression, :34 OptionalChaining; commentPopover.ts:196 ConditionalExpression survived (6) | action: strengthen commentActions.test.ts:130 (add a draft-only action `c2: { reply: 'x' }`), :293 (answerCopyOpen with state {} and a ui:error without requestId returns the same state), commentPopover.test.ts:122 (a draft with no pending request ignores a ui:error without requestId); also replyPending(undefined) === false
B2S23. [commentActions] an error-only entry is never checked to survive: `error === undefined` -> true deletes it, so a failed Resolve with no reply draft shows no error | evidence: commentActions.ts:51 ConditionalExpression survived | action: strengthen commentActions.test.ts:118: a status pending with no reply answered by ui:error keeps `{ error }`
B2S24. [commentsPanel] relativeTime's hour, month and year branches have no test (NoCoverage), and the minute/hour and day/month boundaries survive | evidence: commentsPanel.ts:131-141 NoCoverage (15), :128, :131, :135 x2 survived (19 total) | action: strengthen commentsPanel.test.ts:118: ago(2h) '2 hours ago', ago(59m59s) '59 minutes ago', ago(29d) '29 days ago', ago(40d) 'last month', ago(400d) 'last year'
B2S25. [pickTarget] only the left border is proven to paint: an element with only a top, right or bottom border (a divider) would be skipped | evidence: frame/pickTarget.ts:185-187 ArrayDeclaration survived (3) | action: strengthen pickTarget.test.ts:125: loop the four sides, each alone with width 1px and a visible colour -> true
B2S26. [hostMessages] only status 'open' is ever parsed (NoCoverage on 'sent' and 'resolved'): dropping either would hide every sent or resolved comment | evidence: hostMessages.ts:328 NoCoverage x6 + Survived x1 | action: strengthen hostMessages.test.ts:167: parse the valid comment fixture with status 'sent' and 'resolved' (one line; 11d may shrink the guard)
B2S27. [frameMessages] a one-character computed value is never checked: the lookahead `(?=.*[^ ])` -> `(?=.[^ ])` rejects '1' (opacity 1) and with it the whole styles record | evidence: frame/frameMessages.ts:205 Regex survived | action: strengthen frameMessages.test.ts:85: isSafeStyleValue('1') === true
B2S28. [frameMessages] parseFrameRect never sees a zero-size or a negative-height rect: `0 > height` -> false accepts negative heights from an untrusted frame | evidence: frame/frameMessages.ts:221 ConditionalExpression/EqualityOperator, :220 EqualityOperator survived (3) | action: strengthen frameMessages.test.ts:311: width 0 and height 0 accepted, height -1 rejected
B2S29. [editDrafts] a value that grows the style past MAX_PICK_STYLE_CHARS is only checked for its preview: `{ error: 'complex-style' }` -> {} makes commitDraft save it | evidence: editDrafts.ts:133 ObjectLiteral/StringLiteral survived; cap boundaries :132, :150 x2, :240 and frameMessages.ts:335, :338 survive too (8 total) | action: strengthen editDrafts.test.ts:155: commitDraft of a padding value that pushes the style over the cap -> {kind:'invalid', error:'complex-style'}; one exactly-at-cap text and style each accepted by draftPreview and parseChromeFrameMessage (same boundary both sides)
B2S30. [pins] layoutPins only hides pins past the left edge in a test: top, right and bottom tolerance arithmetic survives | evidence: pins.ts:181 x2, :182 x2, :183 x3 survived (7) | action: strengthen pins.test.ts:231: a tip 5px past each of top, right and bottom is hidden; one within PIN_TOLERANCE_PX on the right is shown
B2S31. [pins] resolveHeldThread with comments or frames still unknown is never tested (mutants crash on `comment.frameId` / `liveFrameIds.has`) | evidence: pins.ts:346 LogicalOperator, ConditionalExpression x2 survived | action: strengthen pins.test.ts:379: comments undefined with liveFrameIds known -> 'hold'; comments known with liveFrameIds undefined -> 'hold'
B2S32. [editInspector] the section field lists and the wide flags are never asserted as a whole: dropping Tracking or Case, a junk Spacing entry, or a wrong `wide` (layout) all survive | evidence: editInspector.ts:447, :448 StringLiteral, :538 ArrayDeclaration, :435, :443 BooleanLiteral, :184-189 StringLiteral survived (10) | action: strengthen editInspector.test.ts:158: deepEqual each section's field keys in order with their wide flag (one table)
B2S33. [editInspector] Align presses are tested only for start, end, -webkit-center, left: right, -webkit-left, -webkit-right, center, justify map unasserted | evidence: editInspector.ts:247, :248, :250, :251, :253 StringLiteral survived (5) | action: strengthen editInspector.test.ts:293: loop every ALIGN_PRESSED key to its pressed button name
B2S34. [selector] textExcerpt never ends on a whole emoji: `last <= 0xdbff` -> true drops a trailing low surrogate and leaves a lone high one | evidence: frame/selector.ts:94:27 ConditionalExpression survived | action: strengthen selector.test.ts:173: textExcerpt('Hi \u{1F44B}') === 'Hi \u{1F44B}'
B2S35. [frameGesture] scroll sink is never fed a horizontal-only scroll or a large x jump: `deltaX === 0` -> true drops horizontal pans; `|deltaX| <= MAX_STEP` -> true pans 5000px on Home/End in x | evidence: frameGesture.ts:308, :313:3 ConditionalExpression survived | action: strengthen frameGesture.test.ts:184: scrollX 5040 scrollY 4999.5 -> pan {40, 0}; scrollX 9999 in the window -> recentre, no pan
B2S36. [frameGesture] revealOffset is only tested with viewStart 0: the "larger than the view" test (`viewEnd - viewStart` -> `+`, `2 * MARGIN` -> `/`) survives | evidence: frameGesture.ts:239 x4 survived | action: strengthen frameGesture.test.ts:151: viewStart 40, viewEnd 1040, start 100, end 1050 -> 100 - (40 + 24)
B2S37. [frameGesture] start on a frame missing from disk, settle with no gesture, and a resize nudge during a move gesture are untested | evidence: frameGesture.ts:80 ConditionalExpression + NoCoverage block, :186 ConditionalExpression + NoCoverage, :102 ConditionalExpression survived (5) | action: strengthen frameGesture.test.ts:90: start for id 'gone' -> gesture undefined; settleFrameGesture({gesture: undefined}) -> undefined; a kind 'resize' nudge on the active move returns the same gesture
B2S38. [commentPopover] a generation-1 artboard is never submitted: `< 1` -> `<= 1` blocks comments on every fresh artboard | evidence: commentPopover.ts:135 EqualityOperator survived | action: strengthen commentPopover.test.ts:76: canSubmit with generation 1 -> true
B2S39. [pageStart] the comments list handed to a page is never asserted | evidence: pageStart.ts:52:7 ConditionalExpression and :52:37 NoCoverage survived (3) | action: strengthen pageStart.test.ts:57: nextPageStart with comments -> result.comments is that list; without -> no comments key
B2S40. [canvasFrames] toChromeFrames' geometry and withGestureOverride with no gesture are unasserted | evidence: canvasFrames.ts:249 ObjectLiteral, :241 OptionalChaining survived | action: strengthen canvasFrames.test.ts:200 (deepEqual the three chrome frames) and :180 (gesture undefined returns equal frames)
B2S41. [editDrafts] a pick without edit fields and an 8-digit hex swatch are untested | evidence: editDrafts.ts:67 LogicalOperator/ConditionalExpression, :85, :87, :295 survived (5); :253 Regex x2 | action: strengthen editDrafts.test.ts:67 (startDraft with pickWith(undefined) -> undefined; fieldValue with pick undefined -> pickValue) and :298 (swatchValue for '#aabbcc80' -> the computed swatch)
B2S42. [editRequests] error keys and the unchanged answer are under-asserted: a dropped edit's copy keeps its key, an edit refusal's copy keeps the commit key, an unmatched answer reloads nothing; the step cap counts only steps | evidence: editRequests.ts:141 ObjectLiteral, :210 x2, :182 ArrayDeclaration, :78 x2 survived (6) | action: strengthen editRequests.test.ts:164 (deepEqual error with key), :117 (error.key is the commit key), :139 (reloadFrameIds []), :327 (MAX_HISTORY_STEPS - 1 steps plus one edit waiting still accepts a step)
B2S43. [pins] jumpTarget with no live answer and a null stored rect is untested (`box === null` -> false calls clipRect(null)) | evidence: pins.ts:297 ConditionalExpression survived | action: strengthen pins.test.ts:342: comment rect null, live undefined -> fit undefined, outline undefined
B2S44. [commentPopover] placePopover's flip and clamp margins are never hit on the boundary (anchors land far past the edge) | evidence: commentPopover.ts:306 x2, :309 x2, :313 x2, :314 x2 survived (8) | action: strengthen commentPopover.test.ts:229: an anchor whose popover ends 4px inside the right edge (inside the 8px margin) flips; a too-large popover clamps to the margin
B2S45. [editInspector] select option values (what a choice saves) are asserted only for Bold and the overflow count: a typo in a weight value or in 'solid' / 'uppercase' survives | evidence: editInspector.ts:220-237 StringLiteral/ObjectLiteral/ArrayDeclaration survived (41; the label half is copy and dies with the same assertion) | action: strengthen editInspector.test.ts:315: deepEqual the value list of font-weight, text-transform, overflow and border-style
B2S46. [small one-liners] one-char reply and comment (commentActions.ts:112, commentPopover.ts:151 EqualityOperator); sameRect(rect, null) (pickTarget.ts:42); saved zoom 0 rejected (savedState.ts:25 x2); no 'null' text node in head without meta charset (stampArtboardHtml.ts:61); pickAnnouncementText in Edit mode for a pick with no edit fields (editInspector.ts:583) | evidence: those 7 survivors | action: strengthen: canSubmitReply('a') and canSubmit body 'a' true (commentActions.test.ts:43, commentPopover.test.ts:76); sameRect(rect, null) false (pickTarget.test.ts:192); parseSavedStageView zoom 0 undefined (savedState.test.ts:7); `withoutCharset.head.firstChild` is the policy meta (stampArtboardHtml.test.ts:43); pickWith(undefined) in edit mode -> 'h1 element selected' (editInspector.test.ts:118)
B2S47. [frame/runtime] remake the two source-grep tests: most asserts lock implementation text ('overflowY', '2e4', 'x: event.clientX', 'passive: false', event-name and API-name lists) and pass with the behavior broken; browser picking.spec.ts:192 and editMode.spec.ts:126 own input blocking | evidence: runtime.test.ts:49-58, :90-122 (by reading; subject not mutated) | action: remake: keep in runtime.test.ts:24 only the invariants (no '</', init order parent < wheel < picking < anchors < ready, the 7 posted types, the forbidden DOM-mutator list, one setAttribute, finder bundled) and in :85 only `event.source !== host` plus ready-after-listeners; delete the rest (see B2P2) (Correction, audit F-03: those specs cover click, `<details>` and Arrow keys only; Enter and Space keydown blocking got its own browser test, `picking.spec.ts` 'Comment mode: Enter and Space on a focused design button do not act'; `submit`, `dblclick`, `auxclick` and `contextmenu` blocking still has no dedicated test (known gap).)

#### M: tests to move to exported behavior

B2M1. [editInspector] tautology: test asserts inspectorView deepEquals `{kind, target, ...editableSections(same args)}`, so a bug in editableSections changes both sides (`styleTooLong: false` -> true survives under this deepEqual); every other test reaches the `/** @internal */` editableSections | evidence: editInspector.ts:554 BooleanLiteral survived; assertion editInspector.test.ts:88-92; @internal export editInspector.ts:490-491 | action: move to inspectorView: `sectionsOf` calls inspectorView(pick, drafted) and narrows kind 'editable'; replace the :88 deepEqual with kind/target plus `styleTooLong === false`; un-export editableSections
B2M2. [selector] isGeneratedName (`/** @internal */`) is tested on its own while buildSelector's use of it for ids is not: `idName: () => undefined` (ids never used) and `!isGeneratedName` -> `isGeneratedName` both survive | evidence: frame/selector.ts:28 ArrowFunction, ConditionalExpression, BooleanLiteral survived (3); selector.test.ts:157 kills none-unique | action: move to buildSelector: in selector.test.ts:85 add an element with a word id (selector is '#hero') and one with id 'css-1x2y3z' (selector excludes it); delete :157 and un-export isGeneratedName (frame/selector.ts:17-18)

#### P: notes for 11c / 11d / browser lane

B2P1. [hostMessages] comment and reply field re-validation of our own host's comments:updated (37 survivors: reply guards, every PostedComment typeof guard, rect null, the bad-reply drop, the reply filter, ui:error message type) | evidence: hostMessages.ts:316-321, :337-351, :358, :360, :375, :405 | action: 11d (shrinking the host guard deletes most of these; no new tests here)
B2P2. [frame/runtime] the runtime's parent-trust (chrome-to-frame accepted only from the captured parent) has no behavioral test, only the grep `event.source !== host` | evidence: runtime.test.ts:86; no browser spec posts cd:mode or cd:edit-apply from the design to its own window | action: browser lane: one spec where a design script posts cd:edit-apply and cd:mode to itself and nothing changes; then the grep can go
B2P3. [stampArtboardHtml] the detached parse (slice before head/body/style, `root.remove()`) exists to avoid a chrome-CSP violation that happy-dom cannot show | evidence: stampArtboardHtml.ts:30 x5, :33 survived | action: browser-owned by frameCsp.spec.ts:117 ('log no violation'); Lane A may probe it
B2P4. [frameGesture] SCROLL_SINK_CENTER feeds canvasState.svelte.ts (no unit test) | evidence: frameGesture.ts:276 ArithmeticOperator survived | action: browser-owned (commentsPanel.spec.ts:618 scroll-sink window); no unit test

#### Equivalent mutants (152 of 437, grouped)

Of the 437: 237 die with an S item, 4 with an M item, 44 are under P (37 for 11d, 7 browser-owned), 152 are equivalent:

- 79 unreachable or no observable difference:
  - editInspector 12: `?.` on lookups that always hit (FIELD_NAMES for every non-segment field :386-387, exec after a matching exec :71), `?? []` for fields that always have options (:295), `'' -> 'Stryker'` fallbacks that match nothing either way (:319, :321, :364, :525), `[] -> [undefined]` in a Set never read for undefined (:270), `computed !== undefined -> true` (the `some` already fails, :299).
  - canvasFrames 11: newRecord initial hash, flags, kind, tile fields and replacedHashes (:63-76) are all overwritten by mergeRecord; `record.kind === 'iframe'` in isStalePreWrite (:83) and `override !== undefined` (:241) only change identity.
  - frameGesture 10: the pointer-move narrowing (:157-158) and `source === 'pointer'` (:90) cannot differ, keyboard events never reach the move branch.
  - frameMessages 7: `typeof x === 'string' / 'number' -> true` before a length, regex or isSafeInteger check that already rejects non-strings (:181, :259, :292, :328, :406); removing `default: return undefined` (:452, :477) still returns undefined.
  - commentActions 6: guards already decided by canSubmitReply or replyPending (:101, :125), `?.` on a pending that the requestId match guarantees (:278:41, :299), kind '' falls to the batch wording (:253).
  - selector 6: finder throws on a detached element anyway (:62 x2), finder never returns '' (:79 x2), computed values have no edge spaces (:108), NoCoverage '' default (:143).
  - editDrafts 4: `pick === undefined` covered by `edit === undefined` (:67, :223), style fallback unused by text drafts (:78), case-insensitive compare is harmless for normalized non-colour values (:173).
  - pageStart 3, savedState 2, stageGeometry 3, pickTarget 3, hostMessages 2, pins 2, and 1 each in commentPick, commentPopover, commentsPanel, editRequests, anchorRects, stampArtboardHtml, pickPath, zoomChoices: an `undefined` key versus an absent key (pageStart :52, :54, :56), typeof checks shadowed by isSafeInteger (savedState :57) or a regex (:46), `first.x + first.width` re-maxed by the loop over first (stageGeometry :169-170), `bounds === null` after fit is already undefined (:363), the transparent-overlay slice and trim and 'i' flag on Chromium's lowercase computed colours (pickTarget :33, :116, :111), the last parse type with no other candidates and isInteger after typeof number (hostMessages :469, :471), flags the host always sets together and an always-false some (pins :139, :319:2), a repost first-pick already returned earlier (commentPick :133), selector null already blocked by canSubmit (commentPopover :167), `undefined > 0` false (commentsPanel :91), a new object with the same value (editRequests :225), a length check that already ran (anchorRects :35), the runtime attribute value is matched by presence (stampArtboardHtml :49), a pick path is never empty (pickPath :14), equal-percent zooms already matched (zoomChoices :21).
- 44 UI copy (labels, accessible names, glyphs, placeholder fallback, Reset label, blocked-target and not-saved copy): editInspector 40, commentPopover 3, editRequests 1. Visible text, owned by browser roles and the gallery, not by unit tests.
- 14 constant table: the REPLACED_OR_CONTROL element set (pickTarget.ts:121-136); a test would restate the list.
- 13 boundary values no real input hits: surrogate edges 0xd800 / 0xdbff (frameMessages :193 x2, selector :94 x2), MAX_* `<=` vs `<` on untrusted caps (frameMessages :208, :262, selector :79), the 1000 ms and MAX_STEP edges of the scroll sink (frameGesture :312-314), growth exactly 0 or exactly 1px apart (stageGeometry :255, :261:30), saved generation 0 (savedState :59).
- 2 Chromium serialization: the `^` / `$` anchors of COMPUTED_RGB (editInspector :43); computed colours are always the whole rgb()/rgba() string.

### Cross-check

### 11f cross-check: lanes A, B1, B2

Read-only against recorded evidence: `test-results/11f-mutation/before/mutation.json` (killedBy / coveredBy replayed with node, test ids mapped through `testFiles` by file and start line), the lane probe results, and the tests and code named. No probes, no edits to src or tests.

Rule applied to D: confirm when the test is the sole killer of no mutant and the sole coverer of none (replay), or a lane probe shows another test fails on the same break or the test stays green with its code broken, and the behavior is not worth a remake. Rule applied to S: keep only behavior that matters to the user, the disk, the Agent or data integrity; cut UI copy, constant tables, unreachable boundaries and duplicates.

#### B (product bugs)

none claimed: CONFIRM none. All three lanes traced every candidate to correct shipped code; nothing I read contradicts that.

#### D: Lane A

AD1: CONFIRM | probe: update writes a constant, test stayed green; three other tests killed it; 245 kills, 0 unique
AD2: CONFIRM | probe: set writes "", stayed green; seedArtboard asserts success in every other test; 0 unique
AD3: CONFIRM | probe: read returns "", stayed green; killed by contract :488 and unit :191; 0 unique
AD4: CONFIRM | probe: export returns {}, stayed green; contract :370, :592 and commentTools :338 killed it; 0 unique
AD5: CONFIRM | asserts only frames.length > 0 and non-empty canvas.json; probe killed by five artboardTools.test placement tests; 0 unique
AD6: CONFIRM | same artboards [] / frames [] asserted in commentTools.contract :338; 0 unique; follow-up (inline the two remaining happyPath bodies, drop happyPath, HappyPathArgs, ARTBOARD_TOOL_NAMES) is sound
AD7: CONFIRM | tests the test's own table; tsc already enforces Record<ArtboardToolName>; 0 kills; moot once AD6 drops happyPath
AD8: CONFIRM | commentTools.contract :206 asserts the full 11-tool list; 0 kills
AD9: CONFIRM | same assertions as contract :488; rule 09 prefers the contract test; 0 unique
AD10: CONFIRM | both unit tests duplicate contract :433 (same authored body); 0 kills
AD11: CONFIRM | probe killers only this and contract :443; 0 unique
AD12: CONFIRM | probe killers only this and contract :443; 0 unique
AD13: CONFIRM | 0 kills; contract :443 sees the schema refusal
AD14: CONFIRM | probe killers this and contract :443; 0 kills
AD15: CONFIRM | contract :394 asserts INVALID_ROOT plus roots; 0 unique
AD16: CONFIRM | contract :386 asserts NO_WORKSPACE; 0 unique
AD17: CONFIRM | rootPath equals the first root so it cannot see a wrong match; :27 ("exact rootPath match wins", second root) caught the probe
AD18: CONFIRM | same assertion as :133; the mkdir'd layout folders are never read
AD19: CONFIRM | single root is both first and last; probe stayed green
AD20: CONFIRM | editHistory.test.ts:74 owns the cap; 22 real disk edits for no unique kill (486 kills, 0 unique)
AD21: CONFIRM | editHistory.test.ts:86 and :179 own it; disk bytes after undo pinned by panelEdit.history :140; 0 unique
AD22: CONFIRM | same postAnswer-before-ready branch and assertion as :139; 0 kills
AD23: CONFIRM | memo hit asserted by :155 and :176; 0 kills
AD24: CONFIRM | pageId 'page-2' asserted by :90, :94 (read failure) and others; 0 kills
AD25: CONFIRM | probes A and B each killed by another test (:315, :242); 0 unique

#### D: Lane B1

B1D1: CONFIRM | 0 unique kills, 0 unique coverage; handoff.test.ts:278 asserts the never-exported case exactly
B1D2: CONFIRM | 0 unique; :278 covers same set, reorder and hash case fold
B1D3: CONFIRM | 0 unique; :278 asserts change, add, remove, unreadable and swap
B1D4: CONFIRM | 0 unique; :314 example covers the legacy one-frame rule
B1D5: CONFIRM | identical literal at openPage.test.ts:270; MIGRATION_CONFLICT code also asserted at openPage.test.ts:239
B1D6: CONFIRM | identical literal ARTBOARDS_CONFLICT_MESSAGE at openPage.test.ts:284
B1D7: CONFIRM | 0 kills (the `code` fields are not mutated); WORKSPACE_BUSY by value at artboardTools.contract.test.ts:482, FRAME_MOVED at artboardFs.test.ts:798
B1D8: CONFIRM | :140 runs the same setup 15 rounds x 6 callers with the same three asserts; 0 unique
B1D9: CONFIRM | stale break covered by :140 and :156 (result plus empty lock dir); 0 unique
B1D10: CONFIRM | :43 asserts the empty lock dir, :118 starts without .cursor-design; 0 unique
B1D11: CONFIRM | :578 asserts page-1 and readdir [] through resolveRequestedPage, which calls resolveOpenPage; 0 unique (borderline: owner-level twin, but evidence meets the spec rule)
B1D12: CONFIRM | 0 unique; openPage.test.ts:407 case 2 pins the class plus writes nothing; the code value stays asserted at errors.test.ts:51
B1D13: CONFIRM | canvasView.test.ts:208 builds the same weird.html dir and asserts listArtboards ids; 0 unique
B1D14: CONFIRM | :232 hits the same ArtboardNotFound path; 0 unique, 0 unique coverage
B1D15: CONFIRM | kill and cover sets identical to :186 (namespaced attribute edit), which is the harder case
B1D16: CONFIRM | kill and cover sets identical to :28; quote normalization comes from parse5 serialization
B1D17: CONFIRM | all 4 kills also by :272; an uncheckable match has no tagName so the tag check already returns false
B1D18: CONFIRM | handoff.test.ts:465 asserts exported.exportId === FIXED_EXPORT_ID from the same fixed clock

#### D: Lane B2

B2D1: CONFIRM | 33 kills all shared with the property :550 or :34/:111; the property is the stronger form
B2D2: CONFIRM | 15 kills shared with :111, :121, :550, frameGesture :169
B2D3: CONFIRM | :60 asserts zoomStageTo 0 and 1000 clamps; anchor rule held by :550; 0 unique
B2D4: CONFIRM | asserts only finite; :111 pins the zero-zoom path exactly; 0 unique
B2D5: CONFIRM | frameBounds has no production caller besides layoutCanvasChrome; :151 and :172 assert union and null bounds; the property's `union` lines only check null for []. Note: stageGeometry.ts is an `?iife` entry, so un-exporting frameBounds drops `exports.frameBounds` from the handoffCanvasHtml snapshot: update that snapshot on purpose
B2D6: CONFIRM | all 4 kills also by frameGesture.test.ts:169 (same exact pan)
B2D7: CONFIRM | integer plus range only; :692 and :702 pin rounding, -0 and the ±100000 clamp exactly; 0 unique
B2D8: CONFIRM | :679 pins 119/120/3840/3841 and 5.4/3.6 rounding; 0 unique
B2D9: CONFIRM | panelItems tests :84 and :100 hit the same three frameLabel branches; 0 unique
B2D10: CONFIRM | pickCounts table interact row plus :101 cover the drop; picking.spec.ts:416 proves the forged Interact pick end to end; 0 unique
B2D11: CONFIRM | 108 kills all shared with cd:pick (:150, :291) and savedState tests (the only other caller); 0 unique coverage
B2D12: CONFIRM | generation also asserted by the stale pre-write and adopt tests (:260, :275, :311, :335); 0 unique

#### S: Lane A

AS1: KEEP | wrong page: three handlers hard-wired to page-1 kept all 836 green; the Agent's write landing on page-1 is the worst-ranked failure
AS2: KEEP | dropping `base` lets a panel drag overwrite an Agent placement; swapped x/y misplaces every drag; one deepEqual
AS3: KEEP | leaked path: foreign error text to the Agent (rule 06); distinct from B1S9 (different function)
AS4: KEEP | last-read-wins guard: an older comment list posted over a newer one; probe green with guard removed
AS5: KEEP | trust boundary: untrusted Open, refresh and frame:place must not reach the resolver (it can migrate or create files); assert no call, not the copy
AS6: KEEP | overwrite: an existing artboard.html with no manifest must keep its bytes
AS7: CUT | only which of two error banners wins when the layout is already corrupt; copy precedence, no disk or Agent effect
AS8: KEEP | lost edit: the text route is never proven on disk; remake in panelEdit.history, then delete panelEdit.test.ts:125 (replay: its 12 kills are all shared)
AS9: MERGE into AM2 | the folded y/label rows must move with the :383 table into artboardFs.test.ts; today :477 is the only killer of artboardFs.ts:460:37 and :462:39 StringLiteral, so the moved rows must keep both
AS10: KEEP | removes a tautology (line 81 asserts the test's own factory, used nowhere else) and a trivial default (line 82); pure deletion
AS11: CUT | the fetch probe plus `abortedRequests() === 1` is the positive control that proves the counter counts; without it `abortedRequests() === 0` could pass vacuously

#### S: Lane B1

B1S1: KEEP | lost edit: the disk base check is the only guard (handler passes args through); no-base and malformed-base refusals plus bytes unchanged
B1S2: KEEP | corrupt file: an empty or oversize reply makes the next read CORRUPT_COMMENTS for the whole page
B1S3: KEEP | corrupt file: invalid new-comment fields brick comments.json; separate code path from B1S2 (validateNewComment vs reply)
B1S4: KEEP | a non-JSON canvas.json (likely hand edit) must not blank the canvas; assert CORRUPT_CANVAS and bytes unchanged
B1S5: KEEP | stored frameId "../x" feeds an uncontained workspaceJoin read; data-integrity guard on shared disk data
B1S6: KEEP | ids "." and ".." pass the id charset and become handoff folder names; write outside the intended folder
B1S7: KEEP | non-JSON manifest.json: Agent-visible CORRUPT_MANIFEST plus the documented set_active_artboard recovery path, both dead in tests
B1S8: KEEP | one hand-broken meta must not block read_artboard / update_artboard for that frame
B1S9: KEEP | leaked path or "[object Object]" to the Agent on every fs failure; cause must survive (rule 06)
B1S10: KEEP | list_artboards' `active` flag tells the Agent which artboard is active; asserted by no test
B1S11: KEEP | lost edit: `style = "..."` misread as valueless drops the user's declarations
B1S12: KEEP | corrupt file: the guard is never decisive, so broken markup could be written unnoticed
B1S13: KEEP | clearing an element's text is a real user action that would be refused; one line
B1S14: KEEP | disk: a no-op status change must not create .cursor-design/ in the user's folder; strengthens :338
B1S15: KEEP | Agent-visible error codes: top-level null gives a TypeError instead of CORRUPT_*; one parse table
B1S16: KEEP | lost edit: a locked title write between scan and export tail overwritten by the default title
B1S17: KEEP | the `.lock.break` exclusion keeps two writers apart; no test holds a live breaker
B1S18: KEEP | owner check proven only with a hand-written token; make it deterministic (A's operation awaits until B holds the lock), no sleeps
B1S19: KEEP | a page with artboards but no manifest crashes readCanvasView if `?.` drops; reachable after a manual delete
B1S20: KEEP | an invalid-id `.html` listed would be refused by every tool; one more file in canvasView.test.ts:208
B1S21: KEEP | security: createArtboard writes manifest/meta through a symlink without a prior read
B1S22: CUT | unreachable: editArtboard's only caller is panelEdit, and chromeMessages.ts:101 (`z.int().check(z.gte(0))`) already refuses "0", 1.5 and -1, tested at chromeMessages.test.ts:334-336
B1S23: KEEP | tautology: expected message computed by the code under test; the copy stays pinned by literals at openPage.test.ts:270 and :284 (B1D5/B1D6)

#### S: Lane B2

B2S1: KEEP | broken message contract: every text edit could post a field the host refuses
B2S2: KEEP | lost edit: clearErrorOnPick can drop waiting and inFlight, or crash on every pick
B2S3: KEEP | a sent step left in the queue is re-sent (double undo)
B2S4: KEEP | lost edit: a changed colour reads as unchanged and never saves
B2S5: KEEP | Escape on a text draft must revert the frame to the saved text
B2S6: KEEP | broken message contract (Resolve type) and lost typed reply on a status answer
B2S7: KEEP | silent failure: a failed Copy for Agent stays pending forever
B2S8: KEEP | frame-to-chrome contract: every on-screen anchor dropped, pins never follow
B2S9: KEEP | host-to-chrome contract: comment:added accept path and ui:error requestId untested
B2S10: KEEP | a wrong vertical delta persists a wrong y to canvas.json; jitter cancel and frozen preview in the same test
B2S11: KEEP | accessibility: keyboard nudge right and down; one table
B2S12: KEEP | pins stay put after a horizontal shift; shorter list never compared
B2S13: KEEP | negative-height rect drops the whole anchor-rects post (pins vanish)
B2S14: KEEP | narrowed to the cross-frame cd:ready keeping frame A's pick; drop the hover-sends and keepLiveFrames-hover asserts (no user effect)
B2S15: KEEP | any comments update with two pins closes the open thread; one line
B2S16: KEEP | narrowed to computed italic: pressed state (aria) and the toggle value written to disk; cut the set-dot asserts (indicator only)
B2S17: KEEP | remake replaces the direction-only :46; every wheel step hitting the cap is user-visible
B2S18: KEEP | hidden webview (zero viewport) must not shift the user's saved view
B2S19: KEEP | group heading placed over the wrong frames whenever the Agent places frames out of order; strengthens :151
B2S20: KEEP | frame frozen at its old height on the first 1px growth (clipped content)
B2S21: KEEP | crash on the common no-slot save
B2S22: KEEP | a standing ui:error attaching to an idle draft or Copy button (message routing)
B2S23: MERGE into B2S6 | same status-answer path in commentActions; assert the error-only entry survives in the same test
B2S24: CUT | UI copy: relativeTime buckets are display text only
B2S25: KEEP | a top/right/bottom-only border (divider) is not pickable; each side is a separate tuple mutant, so the loop tests behavior, not a table
B2S26: KEEP | message contract: dropping 'sent' or 'resolved' hides those comments; one line
B2S27: KEEP | a one-char computed value (opacity 1) drops the whole styles record
B2S28: KEEP | trust boundary: negative height from an untrusted frame accepted; zero-size must stay accepted
B2S29: KEEP | narrowed to commitDraft refusing an over-cap style; cut the exactly-at-cap rows (Lane B2 itself classes MAX_* `<=` vs `<` as unreachable boundaries)
B2S30: KEEP | narrowed to a tip past top, right and bottom being hidden; drop the within-tolerance boundary row
B2S31: KEEP | crash while comments or frames are still loading
B2S32: CUT | constant table: deepEqual of every section's field list restates config; gallery and browser roles own the visible fields
B2S33: CUT | constant table: looping every ALIGN_PRESSED key restates the map
B2S34: KEEP | text ending in an emoji leaves a lone surrogate in the pick; one line
B2S35: KEEP | horizontal-only scroll pans dropped; Home/End x jump recentres
B2S36: KEEP | reveal arithmetic wrong whenever the view is not at 0
B2S37: KEEP | start on a frame the Agent just removed (race) and settle with no gesture; one test
B2S38: KEEP | silent refusal: comments blocked on every fresh (generation 1) artboard
B2S39: KEEP | comments list dropped on a page start
B2S40: KEEP | chrome frame geometry never asserted; crash on the no-gesture path
B2S41: KEEP | crash on a pick without edit fields in Edit mode; 8-digit hex swatch is the value the colour input commits
B2S42: KEEP | narrowed to error keys and an unmatched answer reloading no frame; cut the MAX_HISTORY_STEPS boundary row
B2S43: KEEP | crash jumping to a page comment (rect null) with no live answer
B2S44: CUT | visual boundary arithmetic; the flip and clamp branches already die with the far-past-edge tests
B2S45: CUT | constant table: deepEqual of option value lists restates editInspector's tables
B2S46: KEEP | narrowed: one-char reply and comment (silent refusal), sameRect(rect, null) (vanished anchor never reposted), zoom 0 rejected, no 'null' text node in the stamped head; cut the pickAnnouncementText row (copy)
B2S47: KEEP | removes source-grep asserts that pass with behavior broken; keeps the invariants; the parent-trust grep stays until B2P2 lands

#### M

AM1: CONFIRM | malformedRequestMessage is owned by panelRequestCopy.ts; panelRequestCopy.test.ts:77 lacks comment:copy and comment:copy-open
AM2: CONFIRM | placement and arg rules live in placeFrame / listArtboards (artboardFs.ts:460, :462); keep artboardTools.test.ts:288 as the handler test; absorbs AS9
B2M1: CONFIRM | editInspector.test.ts:88-92 expects `...editableSections(same args)`: a tautology that let editInspector.ts:554 survive
B2M2: CONFIRM | isGeneratedName tested alone while buildSelector's use for ids survives (selector.ts:28); replay: deleting :157 loses no kill

#### Replay

Removed together: all 55 D items (56 tests: AD10 is two) plus the tests other items delete: stageGeometry.test.ts:46 (B2S17 remake), panelEdit.test.ts:125 (AS8), selector.test.ts:157 (B2M2), artboardTools.test.ts:477 (AS9/AM2). 7,252 killed mutants checked.

- Without :477: 59 tests removed, 0 killed mutants left without a killer, 0 covered mutants left without a coverer.
- With :477: 2 lost (artboardFs.ts:460:37 and :462:39 StringLiteral, killed only by :477), so the AM2 moved table must carry the y and label rows before :477 goes.

Lane-only replays: A 0, B1 0, B2 0. No D test is one of the six tests skipped in the Stryker copy.

#### Applied list

- D confirmed (55 items, 56 tests): AD1, AD2, AD3, AD4, AD5, AD6, AD7, AD8, AD9, AD10, AD11, AD12, AD13, AD14, AD15, AD16, AD17, AD18, AD19, AD20, AD21, AD22, AD23, AD24, AD25, B1D1, B1D2, B1D3, B1D4, B1D5, B1D6, B1D7, B1D8, B1D9, B1D10, B1D11, B1D12, B1D13, B1D14, B1D15, B1D16, B1D17, B1D18, B2D1, B2D2, B2D3, B2D4, B2D5, B2D6, B2D7, B2D8, B2D9, B2D10, B2D11, B2D12
- S kept after merges (71): AS1, AS2, AS3, AS4, AS5, AS6, AS8, AS10, B1S1, B1S2, B1S3, B1S4, B1S5, B1S6, B1S7, B1S8, B1S9, B1S10, B1S11, B1S12, B1S13, B1S14, B1S15, B1S16, B1S17, B1S18, B1S19, B1S20, B1S21, B1S23, B2S1, B2S2, B2S3, B2S4, B2S5, B2S6 (+B2S23), B2S7, B2S8, B2S9, B2S10, B2S11, B2S12, B2S13, B2S14 (narrowed), B2S15, B2S16 (narrowed), B2S17, B2S18, B2S19, B2S20, B2S21, B2S22, B2S25, B2S26, B2S27, B2S28, B2S29 (narrowed), B2S30 (narrowed), B2S31, B2S34, B2S35, B2S36, B2S37, B2S38, B2S39, B2S40, B2S41, B2S42 (narrowed), B2S43, B2S46 (narrowed), B2S47
- S cut (8): AS7, AS11, B1S22, B2S24, B2S32, B2S33, B2S44, B2S45. Merged (2): AS9 into AM2, B2S23 into B2S6.
- M confirmed (4): AM1, AM2 (+AS9), B2M1, B2M2
- B: none
- Replay: 0 killed mutants left without a killer (with AM2 carrying the y and label rows from artboardTools.test.ts:477).

Cleanup the deletions imply: B1D1-B1D4 leave the fast-check arbitraries at handoff.test.ts:330-365 (and possibly the `fc` import) unused; AD6 drops happyPath, HappyPathArgs and ARTBOARD_TOOL_NAMES; B2D5 and B2M2 un-export frameBounds and isGeneratedName (B2D5 changes the handoffCanvasHtml snapshot on purpose); B2M1 un-exports editableSections.

### Applied (Step 5)

Four Opus 5.5 high workers, each in its own probe copy on disjoint files, then patches merged into the main tree; AM2's remaining move (five placement-rule tests from `artboardTools.test.ts` into `artboardFs.test.ts`, merged with the y/label rows) by one Opus 5.5 medium worker with 8 probes. Every S and M item carries a probe: target mutant or one-line break applied, test red, product file restored, test green. No product bug found; the only product changes are three `@internal` un-exports (`frameBounds`, `isGeneratedName`, `editableSections`) and the `handoffCanvasHtml` snapshot losing `exports.frameBounds` plus the `/** @internal */` comment lines above `frameBounds` and above `var isGeneratedName` in the four inlined runtime copies (both un-exports reach it; corrected after audit F-04). No browser spec changed.

#### W1: disk

#### W1 status (11f Step 5, Lane B1 + AM2 disk rows)

Patch: test-results/11f-patches/W1.patch (src/disk/*.test.ts only; no product file, no snapshot changed). `vp test src/disk`: 20 files, 311 -> 302 tests, all green. `vp check` on the 12 changed files: clean.

B1D1: done | deleted handoff.test.ts "property: never-exported lastExport is not stale"
B1D2: done | deleted "property: same id set and hashes is not stale"
B1D3: done | deleted "property: hash change, add, remove, or unreadable hash is stale"
B1D4: done | deleted "property: legacy lastExport behaves as a one-frame set"; cleanup: dropped the fast-check arbitraries, foldHashCase, flipHash and the `fc` import (now unused)
B1D5: done | deleted errors.test.ts MigrationConflictError JSON-copies test
B1D6: done | deleted errors.test.ts MigrationConflictError artboards-folder test
B1D7: done | deleted workspaceLock.test.ts "the new errors are CursorDesignErrors with stable codes" (CursorDesignError, FrameMovedError imports dropped)
B1D8: done | deleted workspaceLock.test.ts two-caller stale race
B1D9: done | deleted workspaceLock.test.ts single stale-lock break
B1D10: done | deleted workspaceLock.test.ts "creates .cursor-design/, runs the operation, and removes the lock"
B1D11: done | deleted openPage.test.ts "a fresh read returns page-1 and creates nothing"
B1D12: done | deleted parse.test.ts "project version 2 is UNSUPPORTED_PROJECT_VERSION" (unused import dropped)
B1D13: done | deleted artboardFs.test.ts "directory named like html is skipped by list"
B1D14: done | deleted artboardEditFs.test.ts "an unknown artboard is ARTBOARD_NOT_FOUND"
B1D15: done | deleted commentTarget.test.ts attribute-edit fingerprint test
B1D16: done | deleted commentTarget.test.ts single-to-double-quote fingerprint test
B1D17: done | deleted commentTarget.test.ts "targetAgrees is false when the match is not checkable"
B1D18: done | deleted handoff.test.ts "makeCanvasExportId strips ISO punctuation" (import dropped; makeCanvasExportId stays, exportFs.ts uses it)

B1S1: done (new test in artboardFs.test.ts: no base, baseGeneration 0 / 1.5 / "1", baseHash "sha256:zz" -> InvalidArgsError, HTML and meta bytes unchanged) | probe: artboardFs.ts:321 cond->false red->green; :328 guard->false red->green; :332 guard->false red->green
B1S2: done (replyToComment keeps the status test: "   ", 42, MAX+1 chars -> INVALID_ARGS with COMMENT_BODY_MESSAGE, bytes unchanged; MAX chars with edge spaces stored trimmed) | probe: comments.ts:60 cond->false red->green; :64 cond->false red->green; :64 `>` -> `>=` red->green; :63 drop .trim() red->green
B1S3: done (comments.test.ts:216 remade: seeded hero; body "   " -> COMMENT_BODY_MESSAGE; rect null, isPage true with selector p, tagName "P!", generation 0 -> fields message; comments.json stays absent) | probe: commentsFile.ts:341 cond->false red->green; :348 `!parsed.success`->false red->green; :349 `!hasConsistentTarget`->false red->green; :351 `generation < 1`->false red->green. Note: :350 `!Number.isInteger` -> false stays green (generation 0 is caught by :351; no non-integer row added, the item asked for generation 0 only)
B1S4: done (canvasView corrupt-canvas test: listArtboards error.cause is SyntaxError; layoutErrorMessage pinned as a literal instead of computed by the class) | probe: layoutFs.ts:273 catch block emptied red->green; :273 {cause} -> {} red->green. placeFrame-on-corrupt row not added: artboardTools.test.ts:398 already asserts it through the handler
B1S5: done (commentsFile.test.ts:161: frameId "../x" and "" are CORRUPT_COMMENTS) | probe: commentsFile.ts:226 parseArtboardId call removed red->green
B1S6: done (handoff.test.ts read-failures test: the dot-id case is now a loop over "." and "..", each DISK_ERROR with the rename message and no leaf) | probe: exportFs.ts:142 `artboardId === '..'` -> false red->green; -> `=== ''` red->green
B1S7: done (artboardFs.test.ts "corrupt manifest still fails list and default read": error.pageId and SyntaxError cause asserted; then setActiveArtboard overwrites the corrupt manifest and the default read returns hero active. createArtboard-on-corrupt already covered by "corrupt manifest does not block create or explicit read") | probe: layoutFs.ts:217 {cause} -> {} red->green; :217 {pageId} -> {} red->green; artboardFs.ts:519 rethrow guard -> true red->green
B1S8: done (new artboardFs test: meta "{" and a foreign-id meta read as defaults, update at baseGeneration 1 rewrites a valid meta with id hero, generation 2) | probe: layoutFs.ts:291 rejectUnparsable default -> true red->green; :304 if (rejectUnparsable) -> true red->green. :303 isBenignMetaParseError -> true stays green: equivalent (every error parseMetaFromJsonText can throw is benign)
B1S9: done (new errors.test.ts test: throwDiskError on an EACCES Error -> DiskError, DISK_ERROR, authored message without the path, cause kept; a domain error is rethrown as the same instance) | probe: errors.ts:220 typeof check -> true red->green; :464 instanceof -> false red->green. :223 cond -> false stays green: equivalent today (no caller passes both a message and a cause)
B1S10: done (canvasView "unreadable meta maps generation to 0 and keeps the active flag": adds readable mobile; active flags [false, true], then setActiveArtboard hero -> [true, false]; covers the readable entry and the unreadable-meta entry) | probe: canvasView.ts:244 -> true red->green, -> false red->green; :122 -> true red->green, -> false red->green. :222 (unreadable-HTML branch) not covered, outside the item's action
B1S11: done (artboardEdit style test: `style = "color: red"` + margin 0 -> `style = "color: red; margin: 0px"`) | probe: artboardEdit.ts:270 whitespace skip removed red->green; :275 whitespace skip removed red->green
B1S12: done (artboardEdit refusal test: `style=font-family:"x"` is refused unsupported-style) | probe: artboardEdit.ts:315 guard -> false red->green
B1S13: done (artboardEdit empty-element test: text('<p>Hi</p>', 0, '', 'Hi') -> ok('<p></p>')) | probe: artboardEdit.ts:186 `expectedText === ''` -> false red->green
B1S14: done (comments.test.ts:338 now also asserts setCommentStatus -> COMMENT_NOT_FOUND and markCommentsSent -> [], readdir(root) still []) | probe: comments.ts:209 pre-lock check -> false red->green; :241 -> false red->green
B1S15: done (new parse.test.ts table: null, [], manifest version "1" and 1.5 -> CorruptManifestError; null, [] -> CorruptMetaError; null added to the CORRUPT_PROJECT table; null added to the commentsFile corrupt table, since parseCommentsFile is private and reached through readCommentsFile) | probe: parse.ts:25 drop `value !== null &&` red->green; :119 -> false red->green; :122 -> false red->green; :136 -> false red->green; :148 -> false red->green; commentsFile.ts:285 -> false red->green
B1S16: done (new handoff.test.ts test via exportAroundLockedWrite: hero with no meta, the locked write creates meta titled "Renamed", export keeps it) | probe: exportFs.ts:164 `scanned === current` -> true red->green
B1S17: done (new workspaceLock test: stale .lock plus a fresh .lock.break -> LockTimeoutError, operation not run, both files byte-unchanged) | probe: workspaceLock.ts:87 -> if (false) red->green; :91 -> true red->green; :94 return false -> true red->green (spins until the 5 s test timeout)
B1S18: done (remade "release is owner-checked": holder A (staleMs 50) awaits until B has broken its lock and holds it; after A's release B's .lock is still there; after B ends the dir is empty; no sleeps; 6 repeat runs green) | probe: workspaceLock.ts:136 token -> `` red->green; :114 owner check -> true red->green
B1S19: done (new canvasView test: manifest.json deleted by hand; readCanvasView returns hero, activeArtboardId "", handoffStale false) | probe: canvasView.ts:273 `manifest?.lastExport` -> `manifest.lastExport` red->green
B1S20: done (canvasView skip test also writes `my page.html`; list and canvas still show only hero) | probe: canvasView.ts:163 parseArtboardId call removed red->green
B1S21: done, narrowed (new artboardFs test uses a symlink at the new artboard's meta path, not manifest.json: createArtboard reads the manifest first and readUtf8IfExists already refuses a manifest symlink, so the manifest case never reaches writeUtf8; the meta write has no prior read. DiskError, link still a symlink, target unchanged) | probe: layoutFs.ts:182 guard -> false red->green (the manifest-symlink variant stayed green under the same probe)
B1S22: not applied | cut by the cross-check (unreachable: chromeMessages.ts:101 refuses it first)
B1S23: done (openPage.test.ts per-entry conflict test no longer compares a message computed by MigrationConflictError; assertConflict's message is optional) | probe: errors.ts:426 " Then retry." -> " Retry." red->green (only the literal pins at "two JSON conflicts..." and "a stale 0.4 artboards folder..." went red; the copy stays pinned)

AM2 (disk rows, absorbs AS9): done (new artboardFs test: placeFrame with y null and label 3 -> InvalidArgsError whose message starts with the field name; canvas.json absent) | probe: artboardFs.ts:460 'y' -> '' red->green; :462 'label' -> '' red->green. src/mcp untouched (artboardTools.test.ts:477 deletion belongs to another worker)

Real bugs found: none.

Process note: the shared scratchpad/probe.sh was overwritten mid-run by W4's copy (it cds into w4-wt). Four of my workspaceLock probes (lines 136, 87, 91, 114) briefly ran in W4's tree; each was restored with `git checkout` ("restored clean"), and `git -C w4-wt status src/disk` was clean afterwards. All W1 results above were re-run with a private script in scratchpad/w1-tools/.

#### W2: host, MCP

#### W2 status (11f Step 5: host, MCP, panel)

Patch: test-results/11f-patches/W2.patch (13 test files, 1 new: src/mcp/mcpToolResult.test.ts). No product file changed. Tests: 28 deleted, 7 added, net -21. `vp test src/host src/mcp src/panel`: 19 files, 181 passed. `vp check` and `knip` (both modes) clean.

AD1: done | deleted artboardTools.contract.test.ts update_artboard happy path
AD2: done | deleted set_artboard happy path
AD3: done | deleted read_artboard happy path
AD4: done | deleted export_artboard happy path
AD5: done | deleted place_frame contract happy path
AD6: done | deleted list_artboards empty-root test; set_active_artboard and handoff_status bodies inlined; happyPath, HappyPathArgs, ARTBOARD_TOOL_NAMES, ArtboardToolName, sortedUnique, assertSortedSetEqual and the canvasPathSegments import dropped
AD7: done | deleted happyPath keys test
AD8: done | deleted artboard-only listTools test
AD9: done | deleted artboardTools.test.ts concurrent update test
AD10: done | deleted both export_artboard artboardId unit tests
AD11: done | deleted wrong-typed html unit test
AD12: done | deleted wrong-typed baseGeneration unit test
AD13: done | deleted schema passthrough unit test (artboardToolInputSchemas import dropped; export kept, agentSkill.test.ts still uses it)
AD14: done | deleted non-string rootPath unit test
AD15: done | deleted unknown rootPath unit test
AD16: done | deleted no-workspace unit test
AD17: done | deleted resolveWorkspaceRoot.test.ts explicit rootPath test
AD18: done | deleted two-folders test
AD19: done | deleted single-root test
AD20: done | deleted panelEdit.history cap test
AD21: done | deleted panelEdit.history edit-after-undo test
AD22: done | deleted panelOutbox artboard:edited variant | probe: `if (chromeReady)` in postAnswer forced true, panelOutbox.test.ts answer-before-ready test red->green
AD23: done | deleted canvasSnapshot panelFrameHtml identical-string test
AD24: done | deleted artboardDisk good-read test | probe: snapshot `pageId: page.pageId` -> '', two other artboardDisk tests red->green
AD25: done | deleted panelComments each-copy test | probe: getComment given `{ ...page }`, page-2 location test red->green
AS1: done | new commentTools.contract.test.ts test, page-2 open (set, update, read, list_comments, resolve_comment, export), page-1 bytes identical | probes, each handler given `{ workspaceRoot, pageId: 'page-1' }`: update_artboard, read_artboard, export_artboard, set_artboard, resolve_comment, list_comments, each red->green
AS2: done | artboardDisk.test.ts frame:place test deepEquals the whole placeFrame arg | probe: removed `base: message.base` red->green; probe: `x: message.y` red->green
AS3: done | new src/mcp/mcpToolResult.test.ts: foreign Error gives the authored DISK_ERROR body, its text and stack on stderr | probe: fallback message `String(error)` red->green; probe: dropped the fallback `logMcpError(error)` red->green
AS4: done | new panelComments.test.ts test: slow older read, one post with the newer list | probe: `token === readGeneration` forced true red->green
AS5: done | two new artboardDisk.test.ts tests (isTrusted now a getter) | probe: removed the untrusted guard in placeFrameFromChrome red->green; probe: loadActiveSnapshot guard `if (false)` red->green; probe: malformed branch no longer sets MALFORMED_FRAME_PLACE_MESSAGE red->green
AS6: done | new artboardDisk.test.ts test on a real temp workspace (real createArtboard and setActiveArtboard via vi.importActual for that one call each) | probe: dropped the setActiveArtboard call red->green; probe: ArtboardExistsError rethrown red->green
AS8: done | new panelEdit.history.test.ts text edit test (disk bytes, then undo restores ORIGINAL); panelEdit.test.ts:125 deleted | probe: toArtboardEdit `value: message.liveText` red->green; probe: `liveText: message.value` red->green
AS10: done | dropped canvasSnapshot.test.ts lines 81-82 and the snapshotWithFrames factory (pure deletion, no probe)
AM1: done | malformedRequestMessage('comment:copy-open') moved from chromeMessages.test.ts into panelRequestCopy.test.ts, comment:copy added | probe: isCopyType(type) -> `type === 'comment:copy-open'` red->green; probe: -> `type === 'comment:copy'` red->green
AM2: done (deletion side only) | deleted artboardTools.test.ts:477 (y and label rows go to src/disk/artboardFs.test.ts via the disk worker). Not deleted, outside my brief: the other AM2 handler tests in artboardTools.test.ts (:320 orphans, :383 arg types, :398 corrupt canvas, :443 group "", :457 later id); they stay until their rows are in artboardFs.test.ts
AS7: not applied | cut by the cross-check
AS9: not applied | merged into AM2 (rows moved by the disk worker)
AS11: not applied | cut by the cross-check
AP1-AP6: not applied | informational for 11c

#### W3: webview geometry, frame, messages

#### W3 status (11f Step 5)

Patch: `test-results/11f-patches/W3.patch` (15 files, all in src/webview). `pnpm exec vp test src/webview`: 26 files, 314 passed (was 323: 11 deleted, 2 added, net -9). `vp check` and `knip` clean in the copy. Every probe below: product line mutated in the copy, `vp test <test file>` red, restored, green.

Lead TODO: B2D5 drops `exports.frameBounds` and the `/** @internal */` lines from the stageGeometry iife, so `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` fails until updated on purpose (`vp test src/disk/handoffCanvasHtml.test.ts -u`). Checked: the snapshot diff is only those lines (the runtime bundle already inlines it as a local `var`). (Correction, audit F-04: the B2M2 un-export does change it; the merged snapshot also drops the `/** @internal */` line above `var isGeneratedName` in each of the four inlined runtime copies. The update was made on purpose.)

##### D
B2D1: done | deleted stageGeometry.test.ts 'the stage point under the cursor stays under it while zooming'
B2D2: done | deleted 'zoomStageTo keeps the screen anchor fixed at the target zoom'
B2D3: done | deleted 'zoomStageTo clamps the target zoom at both ends'
B2D4: done | deleted 'a zero input zoom still yields a finite view'
B2D5: done | deleted 'frame bounds are the union rect, or null for no frames', dropped the `union` lines in the fit property, un-exported frameBounds (stageGeometry.ts); snapshot update left to the lead
B2D6: done | deleted 'pan moves the view against the wheel delta and keeps zoom'
B2D7: done | deleted 'property: dragFrame lands on a whole px within ±MAX_FRAME_COORDINATE' plus its now-unused arbitraries (MAX_COORDINATE, gestureCoordinate, gestureView, stageDeltaOf, screenPoint)
B2D8: done | deleted 'property: resizeFrameWidth lands on a whole px within 120..3840'
B2D11: done | deleted frameMessages.test.ts 'parsePickFields keeps the pick fields...' and its import
B2D12: done | deleted canvasFrames.test.ts 'each post carries the frame generation onto its record'

##### S
B2S8: done | probe: frameMessages.ts:422 `box === null` -> true, red->green
B2S9: done | probe: hostMessages.ts:440 `data.type === 'comment:added'` -> false, red->green; :408 `data.requestId === undefined` -> true, red->green
B2S10: done | probe: frameGesture.ts:162 `{ gesture }` -> {}, red->green; :171 `now.y - startStage.y` -> `+`, red->green; :161 `gesture.override === undefined` -> true, red->green
B2S11: done | probe: frameGesture.ts:212 ArrowRight dropped, red->green; :219 ArrowDown step negated, red->green; :216 ArrowDown check -> true, red->green
B2S12: done | probe: anchorRects.ts:13 x check -> false, red->green; :15 `>` -> `>=`, red->green; :29 length check -> false, red->green; :10 `last !== next` -> true, red->green
B2S13: done | probe: pickTarget.ts:81 `top >= bottom` -> false, red->green; `>=` -> `>`, red->green
B2S15: done | probe: pins.ts:319 `pins.some` -> `pins.every`, red->green
B2S17: done | remade stageGeometry.test.ts:46 as exact exp(+-0.1) | probe: stageGeometry.ts:134 `* ZOOM_SENSITIVITY` -> `/`, red->green
B2S18: done | probe: stageGeometry.ts:301 `viewportWidth <= 0` -> false, red->green; `viewportHeight <= 0` -> false, red->green; :338 fitZoom `height <= 0` -> false, red->green; :340 `viewportHeight <= 2 * FIT_PADDING` -> false, red->green
B2S19: done | new test beside :151 (heading over out-of-order frames, empty group) | probe: stageGeometry.ts:213 minX -> false, :216 minY -> false, :219 maxRight -> true, :200 `group.length === 0` -> false, each red->green
B2S20: done | probe: stageGeometry.ts:261 `state.lastGrowth > 0` -> true, red->green
B2S25: done | probe: pickTarget.ts:185, :186, :187 each border tuple -> [], red->green (left was already pinned)
B2S26: done | probe: hostMessages.ts:328 'sent' -> false, red->green; 'resolved' -> false, red->green
B2S27: done | probe: frameMessages.ts:205 `(?=.*[^ ])` -> `(?=.[^ ])`, red->green
B2S28: done | probe: frameMessages.ts:221 `0 > height` -> false, red->green; `0 > width` -> `0 >= width`, red->green; `0 > height` -> `0 >= height`, red->green
B2S30: done (narrowed: top, right, bottom past the edge; no tolerance row) | probe: pins.ts:181, :182, :183 each clause -> false, red->green
B2S31: done | probe: pins.ts:346 `comment !== undefined` -> true, red->green; `liveFrameIds !== undefined` -> true, red->green; `&&` -> `||`, red->green
B2S34: done | probe: selector.ts:94 `last <= 0xdbff` -> true, red->green
B2S35: done | probe: frameGesture.ts:308 `deltaX === 0` -> true, red->green; :313 `|deltaX| <= MAX_STEP` -> true, red->green
B2S36: done (numbers changed: the item's end 1050 does not reach the too-large branch, 950 < 952; used end 1060) | probe: frameGesture.ts:239 `viewEnd - viewStart` -> `+`, red->green; `2 * REVEAL_MARGIN` -> `2 / REVEAL_MARGIN`, red->green
B2S37: done | probe: frameGesture.ts:80 `base === undefined` -> false, red->green; :186 `gesture === undefined` -> false, red->green; :102 `gesture.kind === event.kind` -> true, red->green (needs a keyboard move gesture: a pointer gesture already fails the source check)
B2S39: done (new 6-line test in pageStart.test.ts) | probe: pageStart.ts:52 `comments === undefined` -> true, red->green; -> false, red->green
B2S40: done | probe: canvasFrames.ts:249 `{ id, x, y, width, height }` -> {}, red->green; :241 `gesture?.override` -> `gesture.override`, red->green; control: :250 empty-group guard dropped, red->green (the strict deepEqual replaced the `'group' in` asserts)
B2S43: done | probe: pins.ts:297 `box === null` -> false, red->green
B2S46 (pickTarget, savedState, stampArtboardHtml parts): done | probe: pickTarget.ts:42 `right === null` -> false, red->green; savedState.ts:25 `zoom <= 0` -> `< 0`, red->green, and -> false, red->green (the old rejected rows had no pageId, so isPageId rejected them first; gave the number rows a valid pageId); stampArtboardHtml.ts:61 `charsetMeta !== null` -> true, red->green (asserts firstChild nodeName 'META': an assert.equal on two happy-dom nodes hangs the worker when it fails)
B2S47: done | runtime.test.ts kept only call order, no '</', the 7 posted types plus 7 postMessage calls, the forbidden-mutator list, one setAttribute, finder bundled; second test keeps the parent-trust grep (now counted: 2, one per message listener) and ready-after-listeners | probe: runtime.ts picking/anchors install swapped, red->green; a listener added after cd:ready, red->green; `document.body.classList.add` added, red->green; commentPicking.ts:425 and pinAnchors.ts:116 trust check -> false, each red->green (the old `includes` grep stayed green when only one listener lost it)

##### M
B2M2: done | moved to buildSelector in selector.test.ts:85 ('#hero' used; word-like 'css-header' skipped: 'css-1x2y3z' from the item is already rejected by finder's own word check, so it would not test isGeneratedName); deleted the isGeneratedName test; un-exported isGeneratedName | probe: selector.ts:28 `idName: () => undefined`, red->green; `!isGeneratedName` -> `isGeneratedName`, red->green; `&& !isGeneratedName(name)` removed, red->green

##### Real bugs
none

#### W4: webview edit, comments

#### W4 status (11f Step 5)

Files: the 7 test files below, plus `src/webview/editInspector.ts` (B2M1 un-export only). Probes ran in the W4 probe copy: mutant applied to the product file, `pnpm exec vp test <test file>` red, product file restored, green. Final `pnpm exec vp test src/webview`: 26 files, 321 tests green; `vp check` clean.

B2D9: done | deleted commentsPanel.test.ts 'frameLabel: the label, or the id...' (frameLabel import dropped; export kept, used by product)
B2D10: done | deleted commentPick.test.ts 'hover and pick posted in Interact mode are ignored'
B2S1: done | probe: editRequests.ts:153 'text' -> '' red->green
B2S2: done | probe: editRequests.ts:229 {...state, error: undefined} -> {} red->green; editRequests.ts:224 state.error?.key -> state.error.key red->green
B2S3: done | probe: editRequests.ts:133 slice(index + 1) -> waiting red->green; editRequests.ts:120 {state, send: undefined} -> {} red->green
B2S4: done | probe: editDrafts.ts:174 toLowerCase compare -> true red->green; editDrafts.ts:170 previous === undefined -> false red->green
B2S5: done | probe: editDrafts.ts:161 draft.field === 'text' -> false red->green
B2S6 (+B2S23): done | probe: commentActions.ts:158 'comment:set-status' -> '' red->green; :156 pending object -> {} red->green; :301 {...action, pending: undefined} -> {} red->green; B2S23 :51 delete condition -> true red->green
B2S7: done | probe: commentActions.ts:278 answer.type !== 'ui:error' -> true red->green; 'ui:error' -> '' red->green
B2S14 (narrowed): done | cross-frame cd:ready keeps frame a's pick | probe: commentPick.ts:100 state.pick?.frameId === frameId -> true red->green
B2S16 (narrowed): done | computed 'italic' pressed and toggles to 'normal'; set-dot asserts cut | probe: editInspector.ts:320 fontStyle === 'italic' -> false red->green; 'italic' -> '' red->green
B2S21: done | probe: commentPopover.ts:250 slot?.pageId -> slot.pageId red->green; :215 draft !== undefined -> true red->green
B2S22: done | probe: commentActions.ts:269 requestId === undefined -> false red->green; :272 pending?.requestId -> pending.requestId red->green; :247 state.pending === undefined -> false red->green; :34 action?.pending -> action.pending red->green; commentPopover.ts:196 requestId === undefined -> false red->green
B2S29 (narrowed): done | commitDraft of an over-cap style -> complex-style; exactly-at-cap rows cut | probe: editDrafts.ts:133 {error:'complex-style'} -> {} red->green; 'complex-style' -> '' red->green
B2S38: done | probe: commentPopover.ts:135 < 1 -> <= 1 red->green
B2S41: done | probe: editDrafts.ts:67 drop `edit === undefined ||` red->green; :85 pick !== undefined -> true red->green; :87 pick.edit?.sourceNumber -> pick.edit.sourceNumber red->green; :253 drop `$` from SWATCH_HEX red->green
B2S42 (narrowed): done | error keys and unmatched answer; MAX_HISTORY_STEPS row cut | probe: editRequests.ts:141 {key: commit.key} -> {} red->green; :210 commit.key -> undefined red->green; :182 reloadFrameIds [] -> ["Stryker was here"] red->green
B2S46 (commentActions + commentPopover parts): done | probe: commentActions.ts:112 length >= 1 -> > 1 red->green; commentPopover.ts:151 length >= 1 -> > 1 red->green
B2M1: done | sectionsOf now goes through inspectorView (narrowed to kind 'editable'); :88 tautology replaced by kind/target/styleTooLong === false; editableSections un-exported (its @internal tag and comment removed) | probe: editInspector.ts:552 (was :554) styleTooLong: false -> true red->green
B2S24: not applied | CUT in cross-check (UI copy)
B2S32: not applied | CUT in cross-check (constant table)
B2S33: not applied | CUT in cross-check (constant table)
B2S44: not applied | CUT in cross-check (visual boundary arithmetic)
B2S45: not applied | CUT in cross-check (constant table)

Real product bugs found: none. Net tests: -2 (two deleted, none added; every S and M item strengthened an existing test).

## After

**Run:** same Stryker config and the same six skips, in a fresh probe copy carrying the uncommitted Step 5 diff (`git -C <wt> diff --name-only` matched the main tree; the new `mcpToolResult.test.ts` copied in). Mutate scope stayed the full 47 files because the changed tests reach 45 of them. 8,770 mutants, 97 min 8 s (slower than before: stronger tests run more per mutant). Raw: `test-results/11f-mutation/after/`.

**No-drop check: pass.** Matched by file, line, column, mutator and replacement, then by source text for the three files whose un-exports shifted lines (`editInspector.ts`, `frame/selector.ts`, `stageGeometry.ts`, 474 mutants rematched): 0 mutants killed before and not killed after. The one text mismatch is the `isGeneratedName` block mutant, whose line lost `export`; it is killed after. Nothing was reverted.

**Totals:**

| | Before | After |
|---|---|---|
| Mutation score | 85.0 | 87.9 |
| Survived + no coverage | 1315 | 1060 |
| Newly caught mutants | | 224 |
| Unit tests (`pnpm test`) | 64 files, 836 | 65 files, 794 |
| Browser tests | 209 | 209 (no spec changed) |

| File | Score before | Score after | Survived + no coverage before | after |
|---|---|---|---|---|
| `src/disk/errors.ts` | 48.1 | 52.7 | 67 | 61 |
| `src/disk/workspaceLock.ts` | 58.1 | 65.3 | 52 | 43 |
| `src/disk/commentsFile.ts` | 66.1 | 77.0 | 81 | 55 |
| `src/disk/layout.ts` | 68.3 | 70.0 | 19 | 18 |
| `src/disk/canvasView.ts` | 68.5 | 75.0 | 63 | 50 |
| `src/disk/inlineStyle.ts` | 75.1 | 75.1 | 124 | 124 |
| `src/disk/artboardFs.ts` | 76.5 | 80.4 | 60 | 50 |
| `src/disk/commentViews.ts` | 76.8 | 76.8 | 23 | 23 |
| `src/disk/layoutFs.ts` | 77.0 | 84.2 | 45 | 31 |
| `src/webview/stampArtboardHtml.ts` | 77.1 | 80.0 | 8 | 7 |
| `src/webview/editInspector.ts` | 78.4 | 78.9 | 117 | 114 |
| `src/disk/artboardEdit.ts` | 78.5 | 81.2 | 95 | 83 |
| `src/disk/parse.ts` | 81.8 | 89.4 | 24 | 14 |
| `src/disk/exportFs.ts` | 82.1 | 85.0 | 31 | 26 |
| `src/disk/sourceTags.ts` | 84.0 | 84.0 | 16 | 16 |
| `src/disk/hash.ts` | 84.2 | 84.2 | 3 | 3 |
| `src/disk/handoffCanvasHtml.ts` | 85.3 | 85.3 | 11 | 11 |
| `src/disk/openPage.ts` | 85.9 | 85.9 | 32 | 32 |
| `src/webview/pageStart.ts` | 86.0 | 95.3 | 6 | 2 |
| `src/webview/frameGesture.ts` | 86.3 | 93.5 | 34 | 16 |
| `src/webview/frame/pickTarget.ts` | 86.4 | 89.9 | 23 | 17 |
| `src/disk/editValues.ts` | 86.5 | 86.5 | 37 | 37 |
| `src/disk/commentTarget.ts` | 88.0 | 88.0 | 20 | 20 |
| `src/webview/commentsPanel.ts` | 88.0 | 88.0 | 20 | 20 |
| `src/disk/artboardEditFs.ts` | 88.1 | 88.1 | 5 | 5 |
| `src/webview/hostMessages.ts` | 88.2 | 90.7 | 51 | 40 |
| `src/disk/comments.ts` | 88.4 | 94.9 | 32 | 14 |
| `src/webview/frame/selector.ts` | 89.3 | 92.6 | 13 | 9 |
| `src/webview/frame/anchorRects.ts` | 89.4 | 98.5 | 7 | 1 |
| `src/webview/stageGeometry.ts` | 90.6 | 96.9 | 27 | 9 |
| `src/disk/canvasLayout.ts` | 91.4 | 91.4 | 12 | 12 |
| `src/webview/editDrafts.ts` | 92.2 | 96.5 | 22 | 10 |
| `src/webview/commentPopover.ts` | 92.5 | 94.7 | 17 | 12 |
| `src/webview/editRequests.ts` | 92.6 | 98.3 | 13 | 3 |
| `src/webview/canvasFrames.ts` | 92.7 | 94.4 | 13 | 10 |
| `src/webview/commentActions.ts` | 93.1 | 97.9 | 20 | 6 |
| `src/disk/selectorMatch.ts` | 93.6 | 93.9 | 20 | 19 |
| `src/webview/pins.ts` | 94.6 | 97.3 | 14 | 7 |
| `src/webview/frame/pickPath.ts` | 94.7 | 94.7 | 1 | 1 |
| `src/disk/handoff.ts` | 95.0 | 95.0 | 6 | 6 |
| `src/webview/savedState.ts` | 95.5 | 97.3 | 5 | 3 |
| `src/webview/commentPick.ts` | 96.2 | 96.7 | 7 | 6 |
| `src/webview/frame/frameMessages.ts` | 96.5 | 97.5 | 18 | 13 |
| `src/webview/zoomChoices.ts` | 96.7 | 96.7 | 1 | 1 |
| `src/disk/conflict.ts` | 100.0 | 100.0 | 0 | 0 |
| `src/disk/effectiveMeta.ts` | 100.0 | 100.0 | 0 | 0 |
| `src/webview/undoRedo.ts` | 100.0 | 100.0 | 0 | 0 |

**Left for later:** the remaining survivors are equivalent mutants (classified in Ranked), the 11d `hostMessages` comment re-validation, and P items for 11c (host tests that need ports to assert disk and panel outcomes instead of mock calls). `inlineStyle.ts`, `openPage.ts`, `commentViews.ts` and `editValues.ts` did not move: their survivors were judged equivalent or cut.
