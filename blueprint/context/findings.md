# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to merge while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-07 [P3] open - PANEL_CSP.md Files section names the pre-extraction file

**File:** PANEL_CSP.md:76-77
**Found:** 2026-09-12 by /audit (scope: current; lens: quality)
**Why it matters:** The doc says the CSP fix lives in `src/panel/openArtboardPanel.ts` only, but `stampArtboardHtml` and the chrome template were extracted to `src/panel/artboardChromeHtml.ts`. A reader looking for the stamping code opens the wrong file.
**Suggested fix:** Name both files: `openArtboardPanel.ts` (`cspNonce` message, flush attach) and `artboardChromeHtml.ts` (chrome template, `stampArtboardHtml`).
**Resolution:**

### F-08 [P3] open - No test pins the finite-deltaY guard on untrusted iframe messages

**File:** src/panel/artboardChromeHtml.ts:151
**Found:** 2026-10-12 by /audit (scope: current; lens: tests)
**Why it matters:** `handleCanvasMessage` is the only validation on iframe → chrome input. If `Number.isFinite(data.deltaY)` is dropped, one spoofed `{ type: 'canvas:wheel', deltaY: NaN }` makes `canvasView.zoom` NaN (the `Math.min`/`Math.max` clamp passes NaN through), and every later multiply stays NaN, so zoom is dead until the chrome reloads. No test in `artboardChromeHtml.test.ts` fails if the guard is removed.
**Suggested fix:** Add `assert.ok(chrome.html.includes('Number.isFinite(data.deltaY)'))` to the existing listener-order or wheel test. The 6b zoom-math module can replace it with a real unit test.
**Resolution:**

### F-09 [P3] open - Blueprint manifest still hashes the replaced adapter copies

**File:** blueprint/.state/manifest.json:6
**Found:** 2026-10-12 by /audit (scope: current; lens: quality)
**Why it matters:** Commit f4c9edd replaced the `.agents/skills` and `.claude/skills` trees with symlinks into `.cursor/skills`, but the tracked manifest still lists both adapter paths as separate managed files with their old hashes. 28 entries no longer match (all 23 `.claude/skills` entries, plus `.agents/skills` complete, doctor, feature, fix, rollback). `/doctor` reports this manifest, and a Blueprint update that writes each adapter path in turn would write through both symlinks into the same `.cursor` file, so the last adapter written wins.
**Suggested fix:** Record the symlink layout as an intended local customization (for example a note in `AGENTS.md` or the doctor skill telling update tooling to target `.cursor` once), or refresh the manifest through the Blueprint updater rather than by hand. No product code change.
**Resolution:**
