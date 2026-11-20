# AGENTS.md

**cursor-design** is a Cursor/VS Code extension (WebviewPanel + local MCP), not a Next.js app. Brain = Cursor Agent only. Disk SoT = `.cursor-design/`.

**Notion:** hub (locks, MCP/disk, Interact vs Edit) https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4 ; active 0.4 Edit-lite (its Decisions section is the plan) https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d

**After work:** run `pnpm verify`; never skip it.

**Agent skill:** changing MCP tools or their args, error codes, artboard runtime limits, or the frame CSP updates `skills/cursor-design/SKILL.md` (shipped to users' `~/.cursor/skills/`) in the same change. `src/mcp/agentSkill.test.ts` guards names, codes and limits; the prose is on you.

Claude Code, Codex, and every other AI tool must not add AI attribution to
commits or pull requests, including AI `Co-Authored-By` trailers or generated-by
signatures. Preserve genuine human attribution. Tool settings:
[Commit and PR attribution](blueprint/context/ai-interaction.md#commit-and-pr-attribution).

## Agent files

One copy of everything; never copy files between adapter trees.

- **Rules:** author `.claude/rules/<name>.md` (`paths:`); `.cursor/rules/<name>.mdc` is a relative symlink to it (`globs:`, same patterns). Always-on: `00`, `03`; the rest load on matching files. Codex loads no rules: read `00`, `03` and the rule matching each file you edit.
- **Skills and agents:** author under `.cursor/{skills,agents}`; `.claude/{skills,agents}` and `.agents/skills` symlink into it.
- Verify's `scripts/check-agent-rules.mjs` fails on a plain `.mdc` (Cursor's "New rule" makes one), a broken link, or `globs:` / `paths:` drift.

[AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint) 1.16.1 is the workflow
overlay, not the product stack. Never run a framework scaffolder here. Its updater
refuses the symlinked adapter trees: updates are a manual three-way merge.

## Proportional engineering

Build for established requirements, not hypothetical scale, threats, or flexibility.
Reuse existing code, the standard library, platform features, and installed
dependencies before adding machinery.

- Unknown scale or extensibility defaults to the smaller reversible design; do not
  infer enterprise, multi-tenant, hostile-user, or compliance requirements.
- Derive trust and data-integrity boundaries from actual reachability: untrusted
  input, auth/ownership, shared persisted data, destructive operations, payments,
  secrets, sensitive data.
- Ask only when an unknown materially changes behavior, architecture, persisted
  data, interoperability, a real security boundary, or cost; otherwise pick the
  simplest repo-native option.
- Add an abstraction, dependency, service, config surface, compatibility layer,
  or security mechanism only for a current requirement.
- Simplicity never removes real trust-boundary validation, data-loss prevention,
  accessibility, explicit security requirements, configured tests, or project rules.
- Stack-specific template standards apply only to this project's stack.

## Read these when relevant

- `blueprint/config.json` - workflow policy (gates, `git.landing`); if invalid, run `/blueprint-doctor`. It never grants permission to commit, merge, push, deploy, publish, delete data, waive a failing check, or accept a finding.
- `blueprint/workflow.md` - managed workflow reference
- `blueprint/context/project-overview.md` - product context
- `blueprint/context/system-map.md` - processes, messages, disk; read before changing a cross-process flow
- `blueprint/context/coding-standards.md` - stack, testing, writing
- `blueprint/context/ai-interaction.md` - Blueprint workflow
- `blueprint/context/current-feature.md` - the active spec

## Workflow

One feature or fix at a time:
`/feature` (or `/fix`) -> `/feature-review` -> `/feature-review-fix` -> `/implement` -> `/check` -> `/audit current` -> `/complete`

Approve the spec `/feature-review-fix` rewrote before Implement. Open P0/P1 findings
in `blueprint/context/findings.md` block `/complete`. `/explore`, `/brief`,
`/blueprint-status`, `/blueprint-doctor` and `/check guide` are read-only. Remove a
shipped feature with `/fix`. Skills are chat commands (`$feature` in Codex, `/feature`
elsewhere).

Approval boundaries:

- `autopilot` and `continuous` are explicit-only. Autopilot stops before
  `/complete`; Continuous works locally and never pushes, deploys, or publishes.
- `/complete` follows `git.landing` (`local-merge`): squash merge needs an
  explicit yes, pushing a separate yes.
- The product ships as a `.vsix`; never deploy, publish, or push without a separate yes in the current chat.
- Parallel work: one Git worktree or clone per work item, each on its own branch.
  Never replace another worker's active spec.

## Dashboard activity

Tracked commands (plus `feature-review`, `feature-review-fix`) write
`blueprint/.state/run.json` only via `node .cursor/skills/blueprint-doctor/scripts/run-state.mjs`,
never by hand. Contract: `blueprint/workflow.md` → Dashboard activity.

## Automatic verification

`.github/workflows/verify.yml` runs `pnpm verify` on pull requests and pushes to
`main` (`contents: read`). `/ci` owns it.

## Commands

- Install: `pnpm install`
- Check: `pnpm run check` (`vp check`, then the agent rules check)
- Verify: `pnpm verify` (`vp check && node scripts/check-agent-rules.mjs && svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings && tsc -p tsconfig.webview-tests.json && vp test && vp pack && vp build -c vite.webview.config.ts`)
- Test: `pnpm test` (`vp test`: Vitest over `src/**/*.test.ts`). No Electron suite (plain VS Code lacks the Cursor API).
- Coverage: `pnpm coverage` (report only, no thresholds)
- Fix: `pnpm exec vp check --fix`
- Compile: `pnpm compile` (lint, type check, build `dist/`)
- Watch: `pnpm watch` (pack + webview)
- Debug: **F5** opens `fixtures/dev-workspace` in the Extension Development Host for Cursor-only checks (CSP, MCP registration, webview hide/show, Cursor focus). Confirm `dist/mcp.js` exists first.
- Package: `pnpm package`
- TypeScript: package `typescript` is `~6.0.3` (svelte-check peer); lint and type-aware check run TS 7 (tsrs, in vite-plus)
- Package `.vsix`: `pnpm vsix`
- Knip: `pnpm knip` (unused files/deps; not Verify)

Lint (`vite.config.ts`) enforces the mechanical conventions. Fix the code, not the rule.

Browser tests: `pnpm test:browser` (builds chrome, then Playwright Chromium over `tests/browser/` proves chrome and frame behavior; first run needs `pnpm exec playwright install chromium`; local only, not Verify or CI).

Gallery: `pnpm gallery` (every chrome state, both themes, WCAG contrast, into `test-results/gallery/`; local only).
