# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to merge while any P0 or P1
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
**Resolution:**
