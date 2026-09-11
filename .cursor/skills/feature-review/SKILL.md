---
name: feature-review
description: Dual-subagent review of the active current-feature.md spec for bugs, edge cases, security, and plan correctness, then fix the spec in place. Use for /feature-review, reviewing the current feature spec, or pre-implementation spec review.
---

# feature-review - two models review the spec, main fixes it

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

**First action:** Before project inspection, preflight, or any other tool call, publish `running` to `blueprint/.state/run.json` using the dashboard activity contract in `AGENTS.md` with boundary `reviewed`.

Where this sits in the workflow:

    /feature or /fix  ->  [feature-review]  ->  /implement
    (spec exists)         (dual review +      (build the fixed
                           fix the spec)       spec)

This skill reviews the spec itself: `blueprint/context/current-feature.md`. It never reviews code (`/audit` does that) and never implements. Two isolated subagents — Muse Spark and Grok — review in parallel through the same four lenses. The main agent merges both reports and rewrites the spec once, deciding any clash itself.

## Step 0 - preflight (fail fast)

1. Read `blueprint/config.json` when present. Invalid configuration stops all mutating work and points to `/doctor`.
2. Require an active spec: `blueprint/context/current-feature.md` must exist and must not be the reset stub. On a stub or missing file, stop and point to `/feature` or `/fix`. Never review an empty spec.
3. Require both reviewer files with the expected models:
   - `.cursor/agents/feature-review-spark.md` with a `model:` line for `muse-spark-1.3`
   - `.cursor/agents/feature-review-grok.md` with a `model:` line for `grok-4.6`
   A missing file or a `model:` line pointing elsewhere stops the command: explain exactly which file and line, make no spec edit. Runtimes without these subagents stop here too — never silently downgrade to a single-pass self-review.

## Step 1 - gather the packet

Read the smallest packet that judges the spec (distill, do not dump):

- `blueprint/context/current-feature.md` (full — this is the review target)
- `blueprint/build-plan.md`: the feature's checklist line, its parent, and nearby hierarchy only
- `blueprint/context/project-overview.md`: the feature passage plus only the passages it directly depends on
- `blueprint/context/coding-standards.md`: applicable sections only
- `.cursor/rules/`: all rules (this project's hard constraints)
- `AGENTS.md` Commands section when judging test/verify claims

Do not read source, findings, review records, or history. This review judges the spec against plans, overview, standards, and rules — not against code.

## Step 2 - spawn both reviewers in parallel

One message, two subagent calls, foreground blocking. Pass the exact file paths from Step 1 to both. Do not summarize the spec for them — each reviewer reads the raw files with its own tools for an independent read.

- `/feature-review-spark`: review the spec through your four lenses, return your report contract.
- `/feature-review-grok`: review the spec through your four lenses, return your report contract.

## Step 3 - validate both reports (fail fast)

Each report must contain all five sections: `Model`, `Verdict`, `Findings`, `Nits`, `Not reviewed`.

- Spawn error, timeout, or missing/malformed report from either reviewer: stop immediately, make no spec edit, and shortly explain what went wrong and which reviewer failed.
- `Model` must contain the expected base id (`muse-spark-1.3` for Spark, `grok-4.6` for Grok). An explicitly different model means Cursor silently fell back: stop, make no spec edit, explain the fallback and the likely cause (plan limits, team block, Max Mode). The exact value `unknown (runtime did not expose exact model)` is not a mismatch: continue and mark the review `model unverified` in the final report.
- Never merge a single report. Never fix the spec from a partial review.

## Step 4 - merge and fix the spec

Consider both reports in full. Then rewrite `blueprint/context/current-feature.md` once: draft and merge in context, write once, a later write only for a mechanical correction.

- Apply agreed findings and all nits.
- On a clash, re-read both claims against the packet, decide, apply the winner. Record each clash in the final chat report as: both claims, the winner, one line why. Do not add a decisions ledger to the spec.
- Keep the spec's canonical headings and branch/attempt identity intact. Never broaden scope, invent contracts, or pull in later features to satisfy a finding — put genuinely unresolved product choices under `Open questions`.

## Step 5 - report

Set activity to `ready` (spec fixed, awaiting `/implement`) and report, scannable:

- Both verdicts and models (or `model unverified`)
- Fixes applied, grouped by lens (bugs, edge cases, security, correctness), with spec sections
- Clash decisions: claims, winner, why
- Nits applied (count + sections, no full dump)
- Anything neither reviewer covered
- Next action: `/implement`, or the `/fix`/decision if the review surfaced a blocker

## Rules

- This skill writes only `blueprint/context/current-feature.md` (Step 4) plus the dashboard activity record. Never edit source, tests, config, findings, or review records. Never commit, branch, merge, or implement.
- Fail fast, always: any reviewer failure stops the command with a short explanation and no spec edit.
- Two reports or nothing. A silent single-pass is a bug in this skill, not a fallback.
- Findings first. Ground P0/P1 fixes in a spec quote or a named missing contract.
- Respect existing project patterns over generic advice.

## Formatting

Format the output to match the project's conventions in `blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for enumerations and tables for matrices rather than dense paragraphs.
