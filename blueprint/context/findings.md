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
