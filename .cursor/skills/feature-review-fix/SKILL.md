---
name: feature-review-fix
description: Judge both dual-reviewer reports, research as needed, and rewrite the active spec. Use for /feature-review-fix. Does not implement product code.
---

# feature-review-fix - Claude is the judge: research, push back, rewrite the spec

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

**First action:** Before project inspection, preflight, or any other tool call, publish `running` to `blueprint/.state/run.json` using the dashboard activity contract in `AGENTS.md` with `--command feature-review-fix` and boundary `reviewed`.

Where this sits in the workflow:

    /feature or /fix  ->  /feature-review  ->  [feature-review-fix]  ->  /implement
    (spec exists)         (two Grok reviews,    (this skill:             (build the
                           write reports,        research, push back,     fixed spec)
                           STOP)                 rewrite spec)

This agent is the **final judge and implementor of spec fixes**. It is not the product builder — `/implement` still builds. It reads both stored reports in full, researches claims that depend on current code, accepts or pushes back, and rewrites the spec once.

## Step 0 - preflight (fail fast)

1. Read `blueprint/config.json` when present. Invalid configuration stops all mutating work and points to `/doctor`.
2. Require an active spec: `blueprint/context/current-feature.md` must exist and must not be the reset stub. On a stub or missing file, stop and point to `/feature`, `/fix`, or `/rollback`.
3. Require a complete packet at `blueprint/context/feature-review.md`. It must exist and must not be the reset stub. It must contain both `## Breaker` and `## Literalist`, and each of those must contain all five subsections: `### Model`, `### Verdict`, `### Findings`, `### Nits`, `### Not reviewed`. Missing or malformed packet: stop, point to `/feature-review`. Do not self-review. Do not spawn Breaker or Literalist from this skill.

## Step 1 - read both reports in full

Read `blueprint/context/feature-review.md` in full. Every finding and every nit from both lenses. Do not skim. Do not summarize the packet into a private shortlist and discard the rest.

## Step 2 - read the spec and judging packet (source allowed)

Read the spec in full and the same small judging packet `/feature-review` uses:

- `blueprint/context/current-feature.md` (full)
- `blueprint/build-plan.md`: the feature's checklist line, its parent, and nearby hierarchy only
- `blueprint/context/project-overview.md`: the feature passage plus only the passages it directly depends on
- `blueprint/context/coding-standards.md`: applicable sections only
- `.claude/rules/`: all rules (this project's hard constraints)
- `AGENTS.md` Commands section when judging test/verify claims

This time the judge **may read source** when a claim depends on current code (for example "does this file exist", "is this already true"). That is the own research this skill exists for. Do not implement product code. Do not expand into a repo survey.

## Step 3 - judge every finding and nit

For each finding and each nit from both reports: **accept**, **adjust**, or **reject**, with a one-line why.

- Ground P0/P1 accepts in a spec quote or a named missing contract.
- Push back on wrong, out-of-scope, or later-feature findings. Never broaden scope or invent contracts.
- Never silently ignore a P0 or P1. A reject still needs the one-line why.
- On a clash (both reviewers claim opposite things, or overlapping claims that cannot both stand): re-read both claims against the packet and, when needed, the source. Pick a winner. Record both claims, the winner, and one line why in the chat report. Do not add a decisions ledger to the spec.

Unresolved **product** choices (user-visible, security, persisted data, interoperability) go under `Open questions` **and** this agent **asks Bombic before rewriting** if implementation cannot start safely. Set activity to `blocked` with resume `/feature-review-fix` while waiting. Do not guess.

Reversible internal details with no user-visible, security, persisted-data, or interoperability consequence: pick the simplest repository-native option, record it in the spec, and continue.

## Step 4 - rewrite the spec once

Rewrite `blueprint/context/current-feature.md` **once**. Draft and merge in context, write once; a later write only for a mechanical correction.

- Keep the spec's canonical headings and branch/attempt identity intact.
- Apply accepted and adjusted findings and nits. Omit rejected ones from the spec change; they live in the chat report.
- Never broaden scope, invent contracts, or pull in later features to satisfy a finding.
- If this step rewrites the spec, also refresh `blueprint/context/current-feature-overview.md` so it stays the trimmed readable version of the new spec (same sections and constraints as `/feature`). Never leave the overview stale or as a stub after a spec rewrite.

Do not edit the packet. `blueprint/context/feature-review.md` stays as `/feature-review` wrote it until `/feature`, `/fix`, `/rollback`, or `/complete` resets it.

## Step 5 - report

Set activity to `ready` (spec fixed, awaiting `/implement`) and report, scannable:

- Both verdicts and models (or `model unverified`) used
- Per-item accept / adjust / reject, grouped by lens (Breaker, Literalist), with spec sections
- Clashes: claims, winner, why
- Nits count (accepted / adjusted / rejected)
- Questions asked of Bombic
- Anything neither reviewer covered
- Next action: `/implement`, or the `/fix`/decision if judging surfaced a blocker that is not a spec edit

## Rules

- This skill writes `blueprint/context/current-feature.md`, and when that spec is rewritten `blueprint/context/current-feature-overview.md`, plus the dashboard activity record. Never edit source, tests, config, findings, review records, or the feature-review packet. Never commit, branch, merge, or implement.
- Do not self-review. A missing packet is `/feature-review`, not a second Grok pass from here.
- No silent ignore of a P0/P1 without a reject reason.
- Ask Bombic when a product decision is needed; do not guess.
- Findings first. Respect existing project patterns over generic advice.

## Formatting

Format the output to match the project's conventions in `blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for enumerations and tables for matrices rather than dense paragraphs.
