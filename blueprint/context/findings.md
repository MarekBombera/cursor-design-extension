# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-37 [P3] fixed - Build plan 10e says a stale 0.4 MCP fails on the tombstone

**File:** blueprint/build-plan.md:83
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** the 10e item says "a stale 0.4 MCP fails after a migration and in a fresh folder". The overview copies this (`project-overview.md:44`). 10e B-pre-rename showed the real 0.4 server never meets the tombstone after the rename: it writes to `.cursor-design/`. Only a server that uses `.vibeboard/` and expects a root `artboards/` folder fails (B-tombstone, B-fresh). Bombic owns `build-plan.md`, so this audit does not edit it.
**Suggested fix:** Bombic rewords 10e to "a stale server fails on the tombstone after a migration and in a fresh folder; the real 0.4 server never touches `.vibeboard/`", then reruns `/overview`. Or leave it, since 10e is done and `/complete` checks it off. No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7; Bombic: "do whatever you think is the best decision"): the `build-plan.md` 10e line and its overview copy now say "a stale server fails on the tombstone after a migration and in a fresh folder (the real 0.4 server never touches `.vibeboard/`)", matching B-tombstone, B-fresh and B-pre-rename. Overview source-hash recomputed. Not yet re-reviewed.

### F-38 [P3] fixed - D5 ponytail describes a lock race no shipped build can hit

**File:** src/disk/openPage.ts:178
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** the D5 note in `openPage.ts` and its system-map copy (`:181-182`) say a 0.4 (or stale) `addComment` / `placeFrame` waiting on `.vibeboard/.lock` during a migration writes an orphan root file. Only pages-aware builds take that lock: 10a–10d landed before the rename. cursor-design 0.4 locks `.cursor-design/`, and a current server re-settles to Indexed. No shipped build can hit the race. The code comment also said only "goes away when the editor quits"; a hand-added agent's server goes away when the agent restarts.
**Suggested fix:** frame it as hypothetical: only a pre-pages build on `.vibeboard/` (none shipped). No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): both notes now say "only a pre-pages build on `.vibeboard/` (none shipped; 0.4 locks `.cursor-design/`)", and the code comment adds "or the agent restarts". Comment-only. Not yet re-reviewed.
