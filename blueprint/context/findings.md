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

### F-12 [P3] open - README export trial still names the 0.1 handoff tree

**File:** README.md:76
**Found:** 2026-10-18 by /audit independent current (scope: current; lens: quality)
**Why it matters:** The Commands list now says Export Handoff writes every frame, but the trial still tells the reader to confirm `.cursor-design/handoff/<exportId>/{index.html,IMPLEMENT.md,tokens.json}`. Canvas export no longer writes a root `index.html`; it writes `canvas.html` plus `<group>/<id>/index.html`. Someone following the trial looks for a file that is not there.
**Suggested fix:** Point step 3 at `IMPLEMENT.md`, `canvas.html`, `tokens.json`, and one `<group>/<id>/index.html`, plus `lastExport.frames`.
**Resolution:**
