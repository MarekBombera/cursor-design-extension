# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-09 [P3] open - Blueprint manifest still hashes the replaced adapter copies

**File:** blueprint/.state/manifest.json:6
**Found:** 2026-10-12 by /audit (scope: current; lens: quality)
**Why it matters:** Commit f4c9edd replaced the `.agents/skills` and `.claude/skills` trees with symlinks into `.cursor/skills`, but the tracked manifest still lists both adapter paths as separate managed files with their old hashes. 28 entries no longer match (all 23 `.claude/skills` entries, plus `.agents/skills` complete, doctor, feature, fix, rollback). `/doctor` reports this manifest, and a Blueprint update that writes each adapter path in turn would write through both symlinks into the same `.cursor` file, so the last adapter written wins.
**Suggested fix:** Record the symlink layout as an intended local customization (for example a note in `AGENTS.md` or the doctor skill telling update tooling to target `.cursor` once), or refresh the manifest through the Blueprint updater rather than by hand. No product code change.
**Resolution:**

### F-14 [P2] open - Watch matcher misses the `vp pack` success line

**File:** .vscode/tasks.json:41
**Found:** 2026-10-20 by /audit (scope: current; lens: quality)
**Why it matters:** The `npm: watch:pack` matcher is `activeOnStart: true` and ends only on `Rebuilt in <n>ms` or `Build failed`. Both `vp pack` and `vp pack --minify --no-sourcemap` in this pass printed `Build start` then `✔ Build complete in <n>ms` (once per pack config). That success line does not match `endsPattern`. If the first watch cycle uses the same logger as one-shot pack, the VS Code `watch` task never becomes ready until a later incremental `Rebuilt in` (the spec captured that string after a file touch; this pass could not re-run watch outside the sandbox). F5 still uses `preLaunchTask: compile`, so the Extension Host path is not blocked.
**Suggested fix:** Add `Build complete` to `endsPattern`, or wrap `watch:pack` so it prints the old `[watch] build started` / `[watch] build finished` lines the spec already allowed. Confirm the VS Code `watch` task reaches ready without a file touch.
**Resolution:** 2026-10-21 /audit (scope: current; 7b vp check) re-read `.vscode/tasks.json:41`. `endsPattern` is still `Rebuilt in \\d+ms|Build failed`. 7b dropped `watch:tsc`, so the VS Code `watch` task now depends only on this matcher. This pass's `pnpm compile` printed `Build start` then `✔ Build complete in 38ms` / `79ms` and no `Rebuilt in`. Defect remains. VS Code watch ready still not observed.
2026-10-21 /audit (scope: current; 7d Electron suite home) re-read `.vscode/tasks.json:41` after the watch-tests deletion. `endsPattern` is unchanged (`Rebuilt in \\d+ms|Build failed`). 7d left the matcher as the spec required. This pass's `vp pack` printed `✔ Build complete in 36ms` / `78ms` and no `Rebuilt in`. Defect remains. Watch task ready still not observed.
2026-10-21 /audit (scope: current; 8a Svelte toolchain) re-read `.vscode/tasks.json:41` after `watch` gained `npm: watch:webview`. `endsPattern` is still `Rebuilt in \\d+ms|Build failed`. This pass's `vp pack` printed `Build start` then `✔ Build complete in 31ms` / `70ms` and no `Rebuilt in`. Defect remains. The composite watch task now also waits on this matcher, so 8a's webview watcher cannot make `watch` ready by itself. VS Code watch ready still not observed.

### F-15 [P2] open - Watch:webview matcher reports every Vite line as a problem

**File:** .vscode/tasks.json:59
**Found:** 2026-10-21 by /audit (scope: current; lens: quality)
**Why it matters:** 8a added `npm: watch:webview` with `pattern.regexp` `^.*$` and `message: 0`. VS Code applies that pattern to task output, so every Vite log line becomes a Problem (`transforming...`, `built in`, rebuilds). The background `beginsPattern` / `endsPattern` already match this pass's one-shot Vite output (`transforming...`, `built in`). F5 uses `compile`, so the Extension Host path is not blocked, but the new watch task 8a added is noisy as soon as someone runs `watch`.
**Suggested fix:** Use a never-matching regexp (`^$`) or an error-only pattern. Keep the existing background begins/ends. Confirm the Problems panel stays clean during `watch:webview`.
**Resolution:**

### F-16 [P3] unverified - Extension Host never proved the new module load or CSP

**File:** src/panel/artboardChromeHtml.ts:206
**Found:** 2026-10-21 by /audit (scope: current; lens: tests)
**Why it matters:** Unit tests cover the shell HTML (nonce, `asWebviewUri` stubs, `#svelte-root`, module-after-inline). Verify built `dist/webview/chrome.js` (22 kB) + `chrome.css` with no `eval` / `new Function`. The compiled Svelte runtime assigns a static template via `template.innerHTML` (not user HTML). Spec Testing and step 4 done-when still require F5: hello root present, zero CSP violations, 0.2 parity, and a missing-bundle failure path. Implement recorded F5 not run. Without that, a webview CSP or `type=module` miss would not have been caught.
**Suggested fix:** Run F5 against `fixtures/dev-workspace` as the spec Testing section lists. Record the hello marker, CSP console, 0.2 toolbar/zoom/pan/edit, and the deleted-`chrome.js` path. No product change unless F5 fails.
**Resolution:**
2026-10-22 /audit (scope: current; 8c) user-reported F5 in `fixtures/dev-workspace` (B1-B13 plus retests, not re-run by this audit) reports no CSP errors in the webview console, with zoom tracking, drag/resize persistence and watcher updates working. That covers the module-load, CSP console and 0.2 parity parts of this lead. Still unproven: the deleted-`chrome.js` failure path. Stays `unverified` (never gates `/complete`); close it when that one path is exercised.

### F-23 [P3] fixed - Crashed-breaker recovery in the workspace lock has no test

**File:** src/disk/workspaceLock.ts:99
**Found:** 2026-10-22 by /audit (scope: current; lens: tests)
**Why it matters:** The new break protocol adds one recovery branch: a `.lock.break` older than `staleMs` (left by a breaker that crashed) is removed so the next attempt can break the stale lock. If that branch regressed, one crash would leave every writer on `WORKSPACE_BUSY` permanently (the sub-lock would never age out of the way). The stress test and the stale-lock tests only ever see a live breaker, so nothing fails if lines 99-102 are deleted. Rule 03: non-trivial logic leaves one runnable check.
**Suggested fix:** Add one test next to the existing stale-lock ones: write a foreign `.lock` and a foreign `.lock.break`, both with `utimes` 60s ago, then assert `withWorkspaceLock` runs the operation (give it a `timeoutMs` of about 1000) and `lockDirEntries` is empty afterward. No product change.
**Resolution:** 2026-10-22 /implement: added the suggested test to `src/disk/workspaceLock.test.ts`. A foreign `.lock` and a foreign `.lock.break`, both aged 60s with `utimes`: the operation runs and `.cursor-design/` ends empty. No product change.
