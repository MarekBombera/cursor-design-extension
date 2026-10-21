---
name: feature-review
description: Dual-subagent review of the active current-feature.md spec for bugs, edge cases, security, and plan correctness. Writes both full reports to feature-review.md and stops. Use for /feature-review or pre-implementation spec review. Does not rewrite the spec.
---

# feature-review - two Grok 4.6 reviewers (Breaker + Literalist), then stop

**Context reuse:** Reuse any required file already loaded in project instructions or the current session. Read it again only if absent, changed, or exact current bytes or line references are needed.

**First action:** Before project inspection, preflight, or any other tool call, publish `running` to `blueprint/.state/run.json` using the dashboard activity contract in `AGENTS.md` with boundary `reviewed`.

Where this sits in the workflow:

    /feature or /fix  ->  [feature-review]  ->  /feature-review-fix  ->  /implement
    (spec exists)         (two Grok reviews,    (Claude is judge:        (build the
                           write reports,        research, push back,     fixed spec)
                           STOP)                 rewrite spec)

This skill reviews the spec itself: `blueprint/context/current-feature.md`. It never reviews code (`/audit` does that), never rewrites the spec (`/feature-review-fix` is the judge), and never implements. Two isolated Grok 4.6 subagents — Breaker and Literalist — review in parallel through the same four lenses. After both reports validate, this skill writes them in full to `blueprint/context/feature-review.md` and stops. Two same-model reviewers still disagree usefully: Breaker hunts breakage; Literalist hunts Opus-implementer ambiguity.

## Step 0 - preflight (fail fast)

1. Read `blueprint/config.json` when present. Invalid configuration stops all mutating work and points to `/doctor`.
2. Require an active spec: `blueprint/context/current-feature.md` must exist and must not be the reset stub. On a stub or missing file, stop and point to `/feature`, `/fix`, or `/rollback`. Never review an empty spec.
3. Require both reviewer files, each with a `model:` line containing `grok-4.6`:
   - `.cursor/agents/feature-review-breaker.md`
   - `.cursor/agents/feature-review-literalist.md`
   A missing file or a `model:` line pointing elsewhere stops the command: explain exactly which file and line, make no packet write. Runtimes without these subagents stop here too — never silently downgrade to a single-pass self-review.

## Step 1 - gather the packet

Read the smallest packet that judges the spec (distill, do not dump):

- `blueprint/context/current-feature.md` (full — this is the review target)
- `blueprint/build-plan.md`: the feature's checklist line, its parent, and nearby hierarchy only
- `blueprint/context/project-overview.md`: the feature passage plus only the passages it directly depends on
- `blueprint/context/coding-standards.md`: applicable sections only
- `.claude/rules/`: all rules (this project's hard constraints)
- `AGENTS.md` Commands section when judging test/verify claims

Do not read source, findings, review records, or history. This review judges the spec against plans, overview, standards, and rules — not against code.

## Step 2 - spawn both reviewers in parallel

One message, two subagent calls, foreground blocking. Pass the exact file paths from Step 1 to both. Do not summarize the spec for them — each reviewer reads the raw files with its own tools for an independent read. When the runtime allows a model override, pass `cursor-grok-4.6-xhigh-fast` for both (that is the xhigh 4.6 fast slug).

- `/feature-review-breaker`: review the spec through your four lenses, return your report contract.
- `/feature-review-literalist`: review the spec through your four lenses, return your report contract.

## Step 3 - validate both reports (fail fast)

Each report must contain all five sections: `Model`, `Verdict`, `Findings`, `Nits`, `Not reviewed`.

- Spawn error, timeout, or missing/malformed report from either reviewer: stop immediately, write no packet, and shortly explain what went wrong and which reviewer failed.
- `Model` must contain `grok-4.6` for both. An explicitly different family (e.g. muse-spark, or grok-4.7 as the only id with no grok-4.6) is a fallback: stop, write no packet, explain the fallback and the likely cause (plan limits, team block, Max Mode). The exact value `unknown (runtime did not expose exact model)` is not a mismatch: continue and mark the review `model unverified` in the final report.
- Never persist a single report. Never rewrite the spec from this skill.

## Step 4 - write both full reports

Write `blueprint/context/feature-review.md` once, with both reports in full — not summaries. Keep these headings stable so `/feature-review-fix` can parse them.

Canonical shape:

```markdown
# Feature Review

> **Generated file.** Dual-reviewer packet for the active spec. Written by
> `/feature-review` after both Breaker and Literalist reports validate. Consumed
> by `/feature-review-fix`. Reset by `/feature`, `/fix`, `/rollback`, and
> `/complete` like other current-* files.

**Title:** <first heading of the spec, without the leading #>
**From build-plan:** <copied when the spec has this field>
**Build attempt:** <copied when the spec has this field>
**Branch:** <copied when the spec has this field>
**Type:** <copied when the spec has this field>

## Breaker

### Model

<verbatim Model value>

### Verdict

<verbatim Verdict value>

### Findings

<verbatim Findings body>

### Nits

<verbatim Nits body>

### Not reviewed

<verbatim Not reviewed body>

## Literalist

### Model

<verbatim Model value>

### Verdict

<verbatim Verdict value>

### Findings

<verbatim Findings body>

### Nits

<verbatim Nits body>

### Not reviewed

<verbatim Not reviewed body>
```

Copy feature identity from the spec header. Omit `From build-plan`, `Build attempt`, `Branch`, or `Type` when the spec does not have that field. Do not invent ids.

Paste each reviewer's five sections verbatim under the matching `###` heading. Do not summarize, merge, rank, or drop a finding or nit. If a section is empty, keep the heading and the reviewer's empty text (`none`, `_none_`, or an empty list).

Do not invent a findings ledger here (`findings.md` stays for `/audit`). Do not rewrite `current-feature.md` or `current-feature-overview.md`.

## Step 5 - report

Set activity to `ready` (reports written, awaiting `/feature-review-fix`) and report, scannable:

- Both verdicts and models (or `model unverified`)
- Packet path: `blueprint/context/feature-review.md`
- Next action: `/feature-review-fix`

Do not decide clashes, accept or reject findings, or rewrite the spec. That is `/feature-review-fix`.

## Rules

- This skill writes the dashboard activity record plus `blueprint/context/feature-review.md`. Never edit source, tests, config, findings, review records, `current-feature.md`, or `current-feature-overview.md`. Never commit, branch, merge, or implement.
- Fail fast, always: any reviewer failure stops the command with a short explanation and no packet write.
- Two reports or nothing. A silent single-pass is a bug in this skill, not a fallback.
- Findings first. Ground P0/P1 in a spec quote or a named missing contract — that is the reviewers' job; this skill only persists what they returned.
- Respect existing project patterns over generic advice.

## Formatting

Format the output to match the project's conventions in `blueprint/context/ai-interaction.md`: concise, scannable markdown, with lists for enumerations and tables for matrices rather than dense paragraphs.
