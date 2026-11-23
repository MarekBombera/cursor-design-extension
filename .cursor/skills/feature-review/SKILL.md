---
name: feature-review
description: Dual-subagent review of the active current-feature.md spec for bugs, edge cases, security, and plan correctness. Writes both full reports to feature-review.md and stops. Use for /feature-review or pre-implementation spec review. Does not rewrite the spec.
---

# feature-review - two reviewers (Breaker on Opus 5.5, Literalist on Sonnet 5.5), then stop

**First action:** Before project inspection, preflight, or any other tool call, publish `running` to `blueprint/.state/run.json` using the dashboard activity contract in `blueprint/workflow.md` with boundary `reviewed`.

This skill reviews the spec itself: `blueprint/context/current-feature.md`. It never reviews code (`/audit` does that), never rewrites the spec (`/feature-review-fix` is the judge), and never implements. Two isolated subagents review in parallel through the same four lenses, both at high effort (never xhigh): Breaker on Opus 5.5 hunts breakage; Literalist on Sonnet 5.5 hunts what an Opus implementer would misread, and a model other than the implementer's is the better literal reader. After both reports validate, this skill writes them in full to `blueprint/context/feature-review.md` and stops.

## Step 0 - preflight (fail fast)

1. Read `blueprint/config.json` when present. Invalid configuration stops all mutating work and points to `/blueprint-doctor`.
2. Require an active spec: `blueprint/context/current-feature.md` must exist and must not be the reset stub. On a stub or missing file, stop and point to `/feature` or `/fix`. Never review an empty spec.
3. Require both reviewer files, each with its `model:` line and an `effort: high` line:
   - `.cursor/agents/feature-review-breaker.md`: `model: claude-opus-5-5`
   - `.cursor/agents/feature-review-literalist.md`: `model: claude-sonnet-5-5`
   A missing file or a `model:` line pointing elsewhere stops the command: explain exactly which file and line, make no packet write. Runtimes without these subagents stop here too — never silently downgrade to a single-pass self-review.

## Step 1 - gather the packet

Read the smallest packet that judges the spec (distill, do not dump):

- `blueprint/context/current-feature.md` (full — this is the review target)
- `blueprint/build-plan.md`: the feature's checklist line, its parent, and nearby hierarchy only
- `blueprint/context/project-overview.md`: the feature passage plus only the passages it directly depends on
- `blueprint/context/coding-standards.md`: applicable sections only
- `.claude/rules/`: `00`, `02`, `05` always; `08` when the spec touches `src/webview`; `07` when it touches `src/host`, `src/panel`, `src/commands` or `package.json`; `06` / `09` when it touches errors or tests

Do not read source, findings, review records, or history. This review judges the spec against plans, overview, standards, and rules — not against code.

## Step 2 - spawn both reviewers in parallel

One message, two subagent calls, foreground blocking. Pass the exact file paths from Step 1 to both. Do not summarize the spec for them — each reviewer reads the raw files with its own tools for an independent read. When the runtime takes a model and effort per call (Claude Code's Agent tool), pass them explicitly so a changed default cannot downgrade a reviewer: Breaker `opus` + `high`, Literalist `sonnet` + `high`.

- `feature-review-breaker` agent: review the spec through your four lenses, return your report contract.
- `feature-review-literalist` agent: review the spec through your four lenses, return your report contract.

## Step 3 - validate both reports (fail fast)

Each report must contain all five sections: `Model`, `Verdict`, `Findings`, `Nits`, `Not reviewed`.

- Spawn error, timeout, or missing/malformed report from either reviewer: stop immediately, write no packet, and shortly explain what went wrong and which reviewer failed.
- Breaker's `Model` must contain `opus-5-5`, Literalist's `sonnet-5-5`. Any other model (another family, an older version, or the two swapped) is a fallback: stop, write no packet, explain the fallback and the likely cause (plan or usage limits, a model override in the runtime). The exact value `unknown (runtime did not expose exact model)` is not a mismatch: continue and mark the review `model unverified` in the final report.
- Never persist a single report. Never rewrite the spec from this skill.

## Step 4 - write both full reports

Write `blueprint/context/feature-review.md` once, with both reports in full — not summaries. Keep these headings stable so `/feature-review-fix` can parse them.

Shape, in order (headings and labels exact):

1. `# Feature Review`, then this banner verbatim:

   ```markdown
   > **Generated file.** Dual-reviewer packet for the active spec. Written by
   > `/feature-review` after both Breaker and Literalist reports validate. Consumed
   > by `/feature-review-fix`. Reset by `/feature`, `/fix`, and `/complete` like
   > other current-* files.
   ```

2. Metadata lines: `**Title:** <spec's first heading, without #>`, then `**From build-plan:**`, `**Build attempt:**`, `**Branch:**`, `**Type:**`, each copied from the spec.
3. `## Breaker`, then `## Literalist`, each with `### Model`, `### Verdict`, `### Findings`, `### Nits`, `### Not reviewed`, holding that reviewer's text verbatim.

Copy feature identity from the spec header. Omit `From build-plan`, `Build attempt`, `Branch`, or `Type` when the spec does not have that field. Do not invent ids.

Paste each reviewer's five sections verbatim under the matching `###` heading. Do not summarize, merge, rank, or drop a finding or nit. If a section is empty, keep the heading and the reviewer's empty text (`none`, `_none_`, or an empty list).

Do not invent a findings ledger here (`findings.md` stays for `/audit`).

## Step 5 - report

Set activity to `ready` (reports written, awaiting `/feature-review-fix`) and report, scannable:

- Both verdicts and models (or `model unverified`)
- Packet path: `blueprint/context/feature-review.md`
- Next action: `/feature-review-fix`

Do not decide clashes, accept or reject findings, or rewrite the spec. That is `/feature-review-fix`.

## Rules

- This skill writes the dashboard activity record plus `blueprint/context/feature-review.md`. Never edit source, tests, config, findings, review records, `current-feature.md`, or `current-feature-overview.md`. Never commit, branch, merge, or implement.
- Two reports or nothing. A silent single-pass is a bug in this skill, not a fallback.
