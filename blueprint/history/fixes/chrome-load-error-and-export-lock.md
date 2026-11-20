# Fix: Chrome load error and export lock

**Type:** Fix
**Status:** verified 2026-11-20. `pnpm verify` passes 742 tests and `pnpm test:browser` 168. A real Cursor run shows the toast when `chrome.js` is missing and none when it is present. `/audit` had two fresh reviewers; there are no P0–P2 findings, and its P3s are repaired.
**Branch:** `fix/chrome-load-error-and-export-lock`
**Fixes:** F-16, F-161
**Create-from:** local `main` at `c5d906b` (9g landed; `pnpm verify` exit 0, 732 tests).
**Decision:** Bombic, 2026-11-20: "alright lets do both" (after the 9g audit confirmed both).

## The problem

**F-16: a blank panel with no message when the chrome bundle is missing.** The 9g real Cursor run (launch 4) loaded the packaged extension without `dist/webview/chrome.js` and opened Open Artboard. The Artboard tab is blank: `#svelte-root` is empty, `body.innerText` is `""`, there is no notification, and the "Cursor Design" Output channel is empty. The only trace is a 404 line in the webview console. This happens with a broken or partial install, and in a dev checkout where the webview was never built.

- Where: `src/panel/openArtboardPanel.ts` (creates the panel and sets `webview.html`), `src/panel/artboardChromeHtml.ts` (the shell that points at `dist/webview/chrome.{js,css}`).

**F-161: export writes artboard meta and `manifest.json` outside the workspace lock.** `exportArtboard` (`src/disk/exportFs.ts`) first scans every artboard, meta and the manifest, then writes the handoff leaf across many awaits. Then, without `withWorkspaceLock`, it does two more writes:

- It rewrites `artboards/<id>.meta.json` for every frame whose stored meta was missing or stale at the scan, using the predicate `storedMeta === undefined || normalizeHash(storedMeta.hash) !== effective.hash`.
- It rewrites `manifest.json` from the manifest it read at the scan (`writeManifestLastExport` with `existing: scanned.manifest`).

So a locked `update_artboard`, panel edit or Undo / Redo (`artboardFs.ts:updateArtboard`) that lands between the scan and those writes gets its meta overwritten by one computed from the older HTML. The meta then disagrees with the file, and the Agent's next `update_artboard` can get a spurious `conflict`. The manifest write can also revert an `activeArtboardId` change made in between. HTML is never lost. Both callers take no lock: the MCP `export_artboard` (`runQueued` serializes only inside one MCP process) and the Export Handoff command (`src/commands/exportHandoff.ts`).

## The fix

### F-16: report a missing chrome bundle when the panel opens

Host-side, without blocking panel creation:

- `src/panel/artboardChromeHtml.ts` exports two path-segment constants, `CHROME_JS_SEGMENTS = ['dist', 'webview', 'chrome.js']` and `CHROME_CSS_SEGMENTS = ['dist', 'webview', 'chrome.css']`, and the shell builder uses them. The module stays free of fs work (rule 05).
- `src/host/hostFs.ts`, the existing owner of `fileExists`, `isFileNotFound` and `NO_FOLDER_MESSAGE`, gains two functions:
  - `missingChromeAssets(extensionUri: vscode.Uri): Promise<string[]>`. It checks both files with the existing `fileExists(vscode.Uri.joinPath(extensionUri, ...segments))`, wrapping each check in `.catch(() => false)`, so a non-not-found stat error also counts as missing. It returns the missing files as display paths joined with `/` (for example `dist/webview/chrome.js`), in the order js then css, and it never rejects. Add a `ponytail:` comment: a non-not-found error is reported as "missing" and not logged, because no Output channel is in reach where the panel is created. Upgrade path: pass the channel and use `logDiskError`. The same comment names the known gap: a `chrome.js` that loads but throws before mounting still shows a blank panel. Upgrade path: shell fallback text revealed after a delay.
  - `chromeLoadErrorMessage(missing: readonly string[]): string`, a pure function. No backticks, because `showErrorMessage` does not render Markdown. Exact texts:
    - One file: `Cursor Design could not load its panel: dist/webview/chrome.js is missing. Reinstall the extension, or run pnpm compile in a development checkout.` The same with `dist/webview/chrome.css` when only the CSS is missing.
    - Both: `Cursor Design could not load its panel: dist/webview/chrome.js and dist/webview/chrome.css are missing. Reinstall the extension, or run pnpm compile in a development checkout.`
- `openArtboardPanel`, in the branch that creates a new panel and right after `panel.webview.html = chrome.html`, adds `void missingChromeAssets(context.extensionUri).then((missing) => { if (missing.length > 0) { void vscode.window.showErrorMessage(chromeLoadErrorMessage(missing)); } });`. That covers the command path and the watcher's auto-open, which both create the panel there. Reusing an existing panel runs no check.
- Not chosen: static fallback text in the shell that `main.ts` removes after mount. The module script runs after first paint, so the text would flash on every normal open.

### F-161: lock the export tail and re-read inside it

In `exportArtboard`:

- Keep the scan, the leaf writes and the result shape unchanged. Compute the refresh predicate once per planned frame at the scan (store it on the plan entry, for example `refreshMeta: boolean`), so the scan and the tail share one rule.
- Run the tail in one `withWorkspaceLock({ workspaceRoot, operation })`, with its default `timeoutMs` of 2000. **All reads and comparisons first, then all writes**, so an error while reading inside the lock writes nothing.
  1. For each planned frame with `refreshMeta`:
     - Re-read its HTML with `readUtf8IfExists(workspaceLayoutFile(workspaceRoot, artboardHtmlPathSegments(id)))`. Skip the frame if the result is `undefined` (deleted) or not exactly the scanned `html`.
     - Re-read its meta with `readStoredMeta(workspaceRoot, id, { rejectUnparsable: true })`, the same strict read the scan uses. A corrupt meta throws.
     - The meta counts as unchanged when both the scan and now saw no meta, or when both saw one with raw-equal `hash` and `generation` (`===` on the parsed fields; both come from the same file format, so no `normalizeHash`). If it changed, skip the frame. Otherwise queue the refreshed meta write, `serializeMeta({ ...effective, updatedAt: exportedAt })` as today.
  2. Re-read the manifest with `readManifestFile(workspaceRoot)`. A corrupt manifest throws.
  3. Write the queued metas, then call `writeManifestLastExport` with `existing:` set to the re-read manifest. `lastExport` keeps naming the scanned active frame and its hash; that is deliberate, so it describes what was exported.
- Every error inside the tail propagates unchanged: `LockTimeoutError` (`WORKSPACE_BUSY`), `CorruptMetaError`, `CorruptManifestError`, `DiskError`. The leaf stays as a complete orphan handoff folder; README already says those are never deleted, and a retry writes a new leaf.
- Add a `ponytail:` comment on the manifest write. The `set_artboard` and `set_active_artboard` manifest writes (`artboardFs.ts:writeManifestActive`) still take no lock, so they can land between the tail's re-read and its write, and `writeManifestActive` can also write back an older `lastExport`. Two exports racing still end last-writer-wins on `lastExport`; `handoff_status` only reads more conservatively. Upgrade path: take the lock in `writeManifestActive`. So for the manifest this fix narrows the window from the whole leaf write to the locked tail. It closes the meta race only against locked writers.

### Docs in the same change

- **Rule 02:** add `exportArtboard` to the list of lock-taking functions that must never run inside `withWorkspaceLock`.
- **Rule 05 catalog:** the `src/host/hostFs.ts` line gains `missingChromeAssets` and `chromeLoadErrorMessage`. Note `CHROME_JS_SEGMENTS` / `CHROME_CSS_SEGMENTS` beside `buildArtboardChromeHtml` on the `src/panel/openArtboardPanel.ts` line, which names the shell.
- **README Limits, Writes bullet:** rewrite both affected sentences.
  - The manifest clause becomes "`manifest.json` writes from `set_artboard` and `set_active_artboard` take no lock: across windows the last writer wins (`artboardFs.ts`)". Drop "export" from that list.
  - The meta-refresh sentence becomes "Export's meta refresh and manifest write run under the lock and re-read first, so they no longer overwrite a newer locked write (`exportFs.ts`)".
  - The existing sentence about a pre-update MCP server running without the lock also covers its export; extend it to say so.
- **`export_artboard` tool description** (`src/mcp/artboardTools.ts`): append `update_artboard`'s exact wording: "WORKSPACE_BUSY when another Cursor Design write holds the lock: retry; after a crashed write it can last up to 30 s." Then add "The handoff folder is still written; a retry writes a new one."
- **`skills/cursor-design/SKILL.md`:** the `export_artboard()` line gains "On `WORKSPACE_BUSY`, retry." `agentSkill.test.ts` must still pass.
- **System map "Export" section:** at `/complete`, say the meta refresh and manifest write run under the lock after a re-read, and update the "Last verified" line.

Out of scope: locking `writeManifestActive` (`set_artboard`, `set_active_artboard`); any chrome UI change for F-16; a version bump.

## Build steps

- [x] **1. F-161: lock the export tail**
  Change `exportArtboard` as above. Tests go in `src/disk/handoff.test.ts`, which already exports with a fixed `now`, so `exportId` and the leaf path `.cursor-design/handoff/<exportId>/` are known before the call. Each race test:
  1. sets up the precondition;
  2. holds the lock with `withWorkspaceLock`;
  3. starts `exportArtboard` without awaiting it;
  4. polls every 5–10 ms until the leaf's last-written file (the last frame's `index.html`) exists;
  5. waits 50 ms, the one quiet window, and asserts the target file is unchanged (on the old code the unlocked write has landed by then);
  6. does its own write inside the held lock, simulating a locked writer with direct `writeUtf8` / `serializeMeta` writes, never `updateArtboard`, because the lock is not re-entrant;
  7. releases, awaits the export, and asserts the final state.

  The whole hold stays well under the 2 s lock timeout; a `WORKSPACE_BUSY` from the export in these tests is a test-timing failure.
  - (a) **HTML guard.** Precondition: artboard `hero` with a stale stored meta (its HTML edited directly). The test writes new HTML plus a matching meta. Final: the meta file equals the test's meta.
  - (d) **Meta guard.** Same precondition. The test writes only a new meta: same HTML, new `title`, `hash` = the HTML's hash, `generation` + 1. Final: the meta file equals the test's meta.
  - (b) **Manifest re-read.** The test rewrites `manifest.json` with a different `activeArtboardId` and no `lastExport`. Final: the manifest has the test's `activeArtboardId` and the export's `lastExport`. On the old code this fails whichever write lands first.
  - (c) **No race.** An export over a stale meta, with no competing write, still ends with the refreshed meta (`generation` and `hash` from the effective meta). Reuse an existing case if one already asserts this.
  - Revert check, recorded under Verify: temporarily restore the unlocked tail. (a), (b) and (d) must fail. Then, with the lock kept, drop each guard on its own (the HTML-equality check, then the meta-unchanged check): (a) must fail without the HTML guard, and (d) without the meta guard. Restore everything.
  - No new 2 s `WORKSPACE_BUSY` test: `withWorkspaceLock`'s timeout is already covered in `workspaceLock.test.ts`.
  Docs: rule 02 lock list, README Writes bullet, `export_artboard` description, SKILL.md export line.
  **Done when:** the new tests pass; the revert check is recorded; `pnpm exec vp test src/disk src/mcp` and `pnpm run check` pass.

- [x] **2. F-16: report a missing chrome bundle**
  Export the segment constants, add the two `hostFs.ts` functions, wire `openArtboardPanel`, and update the rule 05 catalog. New colocated `src/host/hostFs.test.ts`, with `vi.mock('vscode')` providing `Uri.joinPath`, `FileSystemError` (with `code`) and `workspace.fs.stat`:
  - `missingChromeAssets` cases:
    - both present → `[]`;
    - `chrome.js` not found → `['dist/webview/chrome.js']`;
    - both not found → both, js first;
    - stat rejecting with a non-not-found error → that file is counted as missing, and the function still resolves.
  - `chromeLoadErrorMessage`: the exact texts for the js-only, css-only and both cases.
  - The existing `artboardChromeHtml.test.ts` keeps passing, so the shell output is unchanged.
  **Done when:** those tests pass; `pnpm run check` passes.

- [x] **3. Agent-run real check, then Verify**
  Agent-run, with no Bombic step. Use the scratch Cursor rig from 9g: memory `agent-cursor-cdp-rig`, and the launch line in archive `blueprint/history/features/09g-verify.md`, step 4 rig rules (`env -i`, `HOME=<S>/home`, `--user-data-dir` through a short `/tmp` symlink, `--use-mock-keychain`, `--classic`, relaunch protocol). `<S>` is a new folder in this session's scratchpad.
  1. `pnpm vsix` (its prepublish runs `pnpm package`). Unzip the `.vsix` into `<S>/vsix`. Run `cp -R <S>/vsix/extension <S>/ext-nochrome`, then `rm <S>/ext-nochrome/dist/webview/chrome.js`.
  2. Workspace `<S>/ws`: create one artboard `hero` with a stdio MCP `set_artboard` against `<S>/vsix/extension/dist/mcp.js`. The 9g stand-in script, `agent.mjs` in this session's `scratchpad/9g/`, can be copied.
  3. Launch with `--extensionDevelopmentPath=<S>/ext-nochrome` on `<S>/ws`. Run Open Artboard, then read `.notifications-toasts` through CDP: a toast contains "could not load its panel" and names `dist/webview/chrome.js`. Take a screenshot.
  4. Quit by the relaunch protocol. Relaunch with `--extensionDevelopmentPath=<S>/vsix/extension` (`chrome.js` present). Open Artboard renders the `hero` frame, and no toast containing "could not load its panel" appears within 5 s. Take a screenshot.
  5. Quit. Every recorded PID must be gone.
  Then run `pnpm verify`, which rebuilds the dev `dist/`, and `pnpm test:browser`.
  **Done when:** both screenshots and the toast text are summarized under Verify; `pnpm verify` and `pnpm test:browser` exit 0.

## Verify

- `pnpm verify` exits 0, with the new `handoff.test.ts` cases (a)–(d) and `hostFs.test.ts`.
- The step 1 revert check: (a), (b) and (d) fail on the unlocked tail; (a) fails without the HTML guard; (d) fails without the meta guard.
- The step 3 real Cursor run: a toast names `dist/webview/chrome.js` when it is missing; the frame renders with no such toast when it is present.
- `pnpm test:browser` exits 0, because the shell output is unchanged.

### Results (implement, 2026-11-20)

- **Step 1** (Opus 5.5 subagent):
  - `exportFs.ts`: `ExportPlanFrame.refreshMeta` holds the scan predicate. `isSameStoredMeta` compares raw `hash` and `generation`. The tail runs in one `withWorkspaceLock`: the HTML re-read (`!== html`, which also covers a deleted file), then the strict meta re-read, then `readManifestFile`, then the queued meta writes, then `writeManifestLastExport` with the fresh manifest. The `ponytail:` comment on the manifest write names the unlocked `writeManifestActive`.
  - Tests in `handoff.test.ts`:
    - (a) `export keeps a locked HTML + meta write that lands before its tail`. The locked writer restores the original HTML with the scanned meta's `hash` and `generation`, so only the HTML guard can catch it.
    - (d) `export keeps a locked meta-only write that lands before its tail`.
    - (b) `export re-reads the manifest so a write before its tail keeps activeArtboardId`.
    - (c) `export with no competing write refreshes a stale meta`.
  - Revert check:
    - The old unlocked tail fails (a), (b) and (d) at the quiet-window assertion.
    - With the HTML guard dropped, only (a) fails.
    - With the meta guard dropped, only (d) fails.
    - After restoring, 32/32 pass, three times in a row.
  - `pnpm run check` exits 0. `pnpm exec vp test src/disk src/mcp` passes 338/338 with `--maxWorkers=4`. With default workers, under a machine load of about 15 (two agents testing at once), 1–3 timeouts appeared in CPU-heavy tests this fix does not touch (`commentTarget.test.ts`, `selectorMatch.test.ts`).
  - Docs: rule 02 lock list, the README Writes bullet (the lead reworded the version clause to "an older version's `update_artboard` and export may take no lock"), the `export_artboard` description, and the SKILL.md export line.
- **Step 2** (Opus 5.5 subagent):
  - `CHROME_JS_SEGMENTS` / `CHROME_CSS_SEGMENTS` are exported, and the shell output is unchanged.
  - `hostFs.ts` gains `missingChromeAssets` (parallel `fileExists(...).catch(() => false)`, results in js-then-css order) and `chromeLoadErrorMessage`. `openArtboardPanel` calls them in the new-panel branch.
  - The new `hostFs.test.ts` has 5 tests. Lead mutation check: without the `.catch`, the stat-error test fails, and it passes after the restore.
  - The rule 05 catalog is updated. `pnpm exec vp test src/host src/panel` passes 99 tests.

- **Step 3** (Opus 5.5 subagent, scratch `scratchpad/fix-f16/`):
  - `pnpm vsix` succeeded; the packaged `extension.js` carries the new message.
  - Launch 1 (`ext-nochrome`, port 9461): Open Artboard showed the toast "Cursor Design could not load its panel: dist/webview/chrome.js is missing. Reinstall the extension, or run pnpm compile in a development checkout." The Artboard tab stayed blank (`shots/toast.png`).
    - Rig note: Cursor 3.29.9's onboarding hides every toast for 10 minutes on a fresh profile (`cursorai.action.hideNotificationsForMs`). The first three attempts therefore found the text only in the screen-reader alert and the Notifications center. Once the window ended, the toast appeared within 6 ms.
  - Launch 2 (the full package, port 9462): the `hero` frame renders. For 5 s there is no "could not load its panel" toast or alert, and the Notifications center reads "No new notifications" (`shots/no-toast.png`).
  - All recorded PIDs are gone, and `/tmp/cdfix` was removed.
  - `pnpm verify` exits 0: 60 files, 742 tests, including `hostFs.test.ts` and every new `handoff.test.ts` case. `pnpm test:browser` exits 0: 168 passed, 198 skipped.
- **Audit** (two fresh subagents, Opus 5.5 and Sonnet 5.5): no P0–P2 findings.
  - F-165, F-166 and F-167 were repaired, including a new reads-before-writes test that fails when the tail interleaves writes.
  - F-168 is invalid: `localResourceRoots` is a permission folder, not an asset path.

## Notes for the AI

- Read `exportFs.ts` end to end before editing. Change only the tail, plus the stored predicate.
- Rule 07: the chrome-asset check is async and never blocks activation or panel creation.
- Rule 03: reuse `fileExists`; do not write a second stat wrapper.
- Subagents: Sonnet 5.5 high or Opus 5.5 high, always passing `effort`; never Fable. No AI attribution in commits (AGENTS.md).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":18978,"specSha256":"b15dcbad05e3e51d521a85f0654b12929be6ac23b96d21d9a045fd1ca5524061","branch":"refs/heads/fix/chrome-load-error-and-export-lock","head":"c5d906b1980dee95741f24cedd196597c5df9894","baseRef":"refs/heads/main","baseCommit":"c5d906b1980dee95741f24cedd196597c5df9894","sourceTree":"110cadbab70ea9d65e6ad6e3909dce1e3fdb6f97","landing":"local-merge","absentOptional":[]} -->

## Findings

### chrome-load-error-and-export-lock/F-16 [P3] closed - Extension Host never proved the new module load or CSP

**File:** src/panel/artboardChromeHtml.ts:206
**Found:** 2026-10-21 by /audit (scope: current; lens: tests)
**Why it matters:** Unit tests cover the shell HTML (nonce, `asWebviewUri` stubs, `#svelte-root`, module-after-inline). Verify built `dist/webview/chrome.js` (22 kB) + `chrome.css` with no `eval` / `new Function`. The compiled Svelte runtime assigns a static template via `template.innerHTML` (not user HTML). Spec Testing and step 4 done-when still require F5: hello root present, zero CSP violations, 0.2 parity, and a missing-bundle failure path. Implement recorded F5 not run. Without that, a webview CSP or `type=module` miss would not have been caught.
**Suggested fix:** Run F5 against `fixtures/dev-workspace` as the spec Testing section lists. Record the hello marker, CSP console, 0.2 toolbar/zoom/pan/edit, and the deleted-`chrome.js` path. No product change unless F5 fails.
**Resolution:**
2026-10-22 /audit (scope: current; 8c) user-reported F5 in `fixtures/dev-workspace` (B1-B13 plus retests, not re-run by this audit) reports no CSP errors in the webview console, with zoom tracking, drag/resize persistence and watcher updates working. That covers the module-load, CSP console and 0.2 parity parts of this lead. Still unproven: the deleted-`chrome.js` failure path. Stays `unverified` (never gates `/complete`); close it when that one path is exercised.
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): confirmed. The module-load and CSP parts pass on the installed `.vsix` in Cursor 3.29.9 (case A: `hero` renders, 0 CSP violations, no `chrome.js` error, chrome assets loaded from the installed extension). The deleted-`chrome.js` path (launch 4) opens a blank Artboard tab: `#svelte-root` is empty, `body.innerText` is `""`, there is no notification toast, and the "Cursor Design" Output channel is empty. The only trace is a webview-console 404. Not repaired; a visible "panel failed to load" fallback in the shell (for example `<noscript>` or a module `onerror`) is a separate `/fix`, or Bombic may accept it (the trigger is a broken package, which the `.vsix` listing check guards).
2026-11-20 accepted by Bombic ("no fix F-16, F-137 and F-161", then "maybe update the skill to fix some issues"): no code fix. The trigger is a broken package, which the `.vsix` listing check guards. The skill cannot see a blank panel.
2026-11-20 reopened by Bombic ("alright lets do both"): the acceptance is withdrawn and a `/fix` follows after 9g lands.
2026-11-20 /implement repair (fix/chrome-load-error-and-export-lock): `openArtboardPanel` checks `dist/webview/chrome.js` and `chrome.css` on every new panel (`hostFs.ts:missingChromeAssets`, which reuses `fileExists`), and shows `chromeLoadErrorMessage` through `showErrorMessage` when either is missing. `hostFs.test.ts` covers it; a lead mutation check shows the stat-error test fails without the `.catch`. A real Cursor toast check is pending (fix step 3). Known gap, marked `ponytail:`: a `chrome.js` that loads but throws before mounting still shows a blank panel.
2026-11-20 /audit current closure (fix/chrome-load-error-and-export-lock; fresh subagent claude-sonnet-5-5; 56 targeted tests and `pnpm run check` pass): closed. `openArtboardPanel.ts:101-105` runs `missingChromeAssets` on every new panel and shows `chromeLoadErrorMessage`. In the real Cursor run the toast appears when `chrome.js` is missing (`toast.png`), and the `hero` panel renders with no toast when it is present (`no-toast.png`). The known gap (a crash before mount) is marked with a `ponytail:` comment. No new defect.

### chrome-load-error-and-export-lock/F-161 [P3] closed - Export writes artboard meta and manifest.json outside the workspace lock

**File:** src/disk/exportFs.ts:236 (meta refresh loop; `writeManifestLastExport` around :244)
**Found:** 2026-11-20 by /audit current (9g; lens: quality; from the 9g step 2 code read, confirmed by fresh subagent claude-sonnet-5-5); code fact, not reproduced
**Why it matters:**
- `exportArtboard` scans the artboards and metas, writes the handoff leaf across many awaits, then rewrites `artboards/<id>.meta.json` when the stored meta is missing or stale, and rewrites `manifest.json` from the earlier scan.
- Neither write holds `withWorkspaceLock`: `runQueued` serializes only within one MCP process, and `commands/exportHandoff.ts` takes no lock.
- A locked `update_artboard`, panel edit or Undo can land between the scan and the meta write. The export then writes a meta computed from the older HTML: the generation the Agent was handed is no longer current, so its next update gets a spurious `conflict`.
- The manifest write can revert a concurrent `activeArtboardId` change.
- HTML is never lost. The window is narrow: the meta must already be stale and then race a locked write.
**Suggested fix:**
- Put the meta refresh and the manifest write in one short `withWorkspaceLock` block.
- Inside it, re-read and write only if the meta is still stale, and skip it when a newer generation has already landed. The leaf writes stay outside the lock.
- Add one colocated test.
- This is a separate `/fix`, or Bombic may accept it as documented in README Limits.
**Resolution:**
2026-11-20 accepted by Bombic ("no fix F-16, F-137 and F-161", then "maybe update the skill to fix some issues"): no code fix. Its only Agent-visible effect, a spurious `conflict` on the next `update_artboard`, is already handled by the skill's conflict rule (re-read, re-apply, retry once). Documented in README Limits.
2026-11-20 reopened by Bombic ("alright lets do both"): the acceptance is withdrawn and a `/fix` follows after 9g lands.
2026-11-20 /implement repair (fix/chrome-load-error-and-export-lock): `exportArtboard`'s meta refresh and manifest write now run in one `withWorkspaceLock`, with all reads before any write. A meta is refreshed only if its HTML and stored meta are unchanged since the scan, and the manifest is re-read before it is written. `handoff.test.ts` race cases (a)–(d) pass; the revert check shows (a), (b) and (d) fail on the unlocked tail, and each guard's own test fails when that guard is dropped. The manifest race with the unlocked `set_artboard` / `set_active_artboard` is narrowed, not closed (`ponytail:`).
2026-11-20 /audit current closure (fix/chrome-load-error-and-export-lock; fresh subagent claude-sonnet-5-5; 56 targeted tests and `pnpm run check` pass): closed. the export tail runs in `withWorkspaceLock` with reads first: the HTML guard, the strict meta re-read, `isSameStoredMeta`, then `readManifestFile`. Only then come the writes. `refreshMeta` is computed at scan time. The manifest race with the unlocked `set_artboard` / `set_active_artboard` is narrowed and documented (a `ponytail:` comment and the README). No new defect.

### chrome-load-error-and-export-lock/F-165 [P3] closed - The export race-test helper can mask the real failure, and its 1 s poll deadline is tight

**File:** src/disk/handoff.test.ts:604-635 (`exportAroundLockedWrite`)
**Found:** 2026-11-20 by /audit current (fix/chrome-load-error-and-export-lock; fresh subagents claude-opus-5-5 and claude-sonnet-5-5); lens: tests
**Why it matters:**
- `.finally(() => exporting)` rejects with the export's error, which replaces an assertion error raised inside the held lock.
- An export that rejects while the test is still polling has no handler, so it surfaces as an unhandled rejection.
- The 1 s deadline for the leaf's last file is unrelated to the 2 s lock wait and can trip under heavy load (load about 15 was seen during this work).
- Failing runs only; not a correctness problem.
**Suggested fix:** Attach a settle handler as soon as the export starts and report the in-lock error first. Raise the poll deadline to about 5 s.
**Resolution:**
2026-11-20 /implement repair (Opus 5.5 subagent; `handoff.test.ts` + `workspaceLock.test.ts` 44/44, `pnpm run check` pass): `exportAroundLockedWrite` attaches `exportSettled = exporting.catch(() => undefined)` as soon as the export starts. The lock call ends with `.finally(() => exportSettled)`, then `await exporting`, so an in-lock failure is reported first and nothing goes unhandled. The leaf poll deadline is now 5 s.
2026-11-20 /audit current closure (fix/chrome-load-error-and-export-lock; fresh subagent claude-sonnet-5-5; 56 targeted tests and `pnpm run check` pass): closed. `exportSettled` is attached at start, and `.finally(() => exportSettled)` is followed by `await exporting`. An in-lock error is reported first, nothing goes unhandled, and the poll deadline is 5 s.

### chrome-load-error-and-export-lock/F-166 [P3] closed - No test guards "all reads before any write" in the locked export tail

**File:** src/disk/exportFs.ts (tail), src/disk/handoff.test.ts
**Found:** 2026-11-20 by /audit current (fix/chrome-load-error-and-export-lock; fresh subagents claude-opus-5-5 and claude-sonnet-5-5); lens: tests
**Why it matters:** The spec makes "an error while reading inside the lock writes nothing" a data-integrity property. Tests (a)–(d) still pass if a refactor interleaves reads and writes (for example, writing frame 1's meta and then failing on frame 2's strict meta read).
**Suggested fix:** One race test with two stale frames. Corrupt the second frame's meta inside the held lock. Assert the export rejects with the corrupt-meta error, the first frame's meta is unchanged and the manifest gains no new `lastExport`.
**Resolution:**
2026-11-20 /implement repair (Opus 5.5 subagent; `handoff.test.ts` + `workspaceLock.test.ts` 44/44, `pnpm run check` pass): new test `export reads every meta before any write, so a corrupt second meta writes nothing` covers two stale frames, with `side`'s meta corrupted inside the held lock. It expects `CorruptMetaError` (`CORRUPT_META`, `side`), with `hero`'s meta and `manifest.json` bytes unchanged. Mutation check: when the tail writes each meta inside the read loop, the test fails at `handoff.test.ts:727`; `exportFs.ts` was restored byte-identical (`cmp`).
2026-11-20 /audit current closure (fix/chrome-load-error-and-export-lock; fresh subagent claude-sonnet-5-5; 56 targeted tests and `pnpm run check` pass): closed. the corrupt-second-meta test asserts `CORRUPT_META` for `side` and unchanged `hero` meta and manifest bytes. It fails if the tail writes inside the read loop.

### chrome-load-error-and-export-lock/F-167 [P3] closed - The lock-holder lists omit the export tail, and README overstates the manifest gain

**File:** src/disk/workspaceLock.ts:65 (`breakIfStale` ponytail, "every hold (one JSON…"), .claude/rules/02-mcp-webview.md:30 (first lock bullet), README.md:122
**Found:** 2026-11-20 by /audit current (fix/chrome-load-error-and-export-lock; fresh subagents claude-opus-5-5 and claude-sonnet-5-5); lens: quality
**Why it matters:**
- The export tail is now a lock holder (N strict re-reads, N meta writes, one manifest write), but both hold lists still leave it out.
- README says the export's manifest write "no longer overwrite[s] a newer locked write". For `manifest.json`, the gain is a narrower window: `set_artboard` / `set_active_artboard` still write unlocked.
**Suggested fix:** Add the export tail to both lists. README: say the meta refresh no longer overwrites a newer locked meta write, and that an unlocked `activeArtboardId` change is reverted only if it lands during the locked tail.
**Resolution:**
2026-11-20 /implement repair (Opus 5.5 subagent; `handoff.test.ts` + `workspaceLock.test.ts` 44/44, `pnpm run check` pass): three texts updated. The `workspaceLock.ts` `breakIfStale` ponytail now lists "the export tail's N strict meta re-reads, N meta writes and one manifest write". Rule 02's first lock bullet includes "the export tail (meta refresh + manifest write, after a re-read)". The README Writes bullet now says the meta refresh no longer overwrites a newer locked meta write, and that an unlocked `set_active_artboard` change is reverted only if it lands during the locked tail.
2026-11-20 /audit current closure (fix/chrome-load-error-and-export-lock; fresh subagent claude-sonnet-5-5; 56 targeted tests and `pnpm run check` pass): closed. the `breakIfStale` ponytail, rule 02's lock bullet and the README Writes bullet now describe the export tail accurately.

### chrome-load-error-and-export-lock/F-168 [P3] invalid - openArtboardPanel hard-codes the dist/webview path next to CHROME_*_SEGMENTS

**File:** src/panel/openArtboardPanel.ts:93 (`localResourceRoots`)
**Found:** 2026-11-20 by /audit current (fix/chrome-load-error-and-export-lock; fresh subagents claude-opus-5-5 and claude-sonnet-5-5); lens: quality (claude-opus-5-5)
**Why it matters:** It reads like a duplicate of the asset path now held in `CHROME_JS_SEGMENTS` / `CHROME_CSS_SEGMENTS`.
**Suggested fix:** Derive it from the segments, or leave it.
**Resolution:** 2026-11-20 lead verdict: invalid. `localResourceRoots` is the webview's permission root, the directory it may load from, not an asset path. The second reviewer (claude-sonnet-5-5) reached the same reading independently: "a different path (the directory), so it is not a twin". Deriving it from a file's segments would couple two concepts. No change.
