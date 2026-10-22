# AGENTS.md

**cursor-design** is a Cursor/VS Code extension (WebviewPanel + local MCP), not a Next.js app. Brain = Cursor Agent only. Disk SoT = `.cursor-design/`.

**Notion:**

- Hub (locks, MCP/disk, Interact vs Edit): https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4
- Active build brief **0.3 Comments for Agent**: https://app.notion.com/p/3fd500344e088171925dd51bc542c00c
- 0.2 Interact (shipped): https://app.notion.com/p/3da500344e0881c5a245e9b912559b8e
- 0.1 archive (shipped, don’t re-litigate): https://app.notion.com/p/3da500344e0881e884dcc828fc49a395

**Status:** 0.2 shipped; building 0.3 Comments for Agent (build-plan item 8, plan in `blueprint/reference/0.3-comments-plan.md`).

**After work:** run `pnpm verify`. Do not skip it.

Claude Code, Codex, and every other AI tool must not add AI attribution to
commits or pull requests, including AI `Co-Authored-By` trailers or generated-by
signatures. Preserve genuine human attribution. See
[Commit and PR attribution](blueprint/context/ai-interaction.md#commit-and-pr-attribution)
for optional tool settings.

## Agent files

One copy of everything; never copy files between adapter trees.

- **Rules:** author `.claude/rules/<name>.md` (Claude Code reads only `.md`, scoped by `paths:`). `.cursor/rules/<name>.mdc` is a relative symlink to it (Cursor, scoped by `globs:`). A scoped rule lists the same patterns in both keys. Always-on rules: `00-cursor-design-core`, `03-ponytail`. The rest load when matching files are touched. Codex does not read rules; this file and the skills carry the workflow there.
- **Skills and agents:** author under `.cursor/{skills,agents}`. `.claude/{skills,agents}` and `.agents/skills` are symlinks into `.cursor`.
- `pnpm verify` runs `scripts/check-agent-rules.mjs`, which fails on a plain `.mdc` file (Cursor's "New rule" creates one), a broken link, or `globs:` / `paths:` drift.

This repo also uses [AI Blueprint](https://github.com/aiblueprinthq/ai-blueprint)
1.13.0 as a file-backed workflow overlay (plans, specs, review gates). Blueprint
does not define the product stack. Never run a framework scaffolder inside this
directory; the extension scaffold already exists. The official updater refuses the
symlinked adapter trees, so Blueprint updates are a manual three-way merge.

## Proportional engineering

Build for established requirements, not hypothetical scale, threats, or future
flexibility. Reuse existing code, the standard library, native platform features,
and installed dependencies before adding machinery.

- Unknown scale or extensibility defaults to the smaller reversible design. Do
  not infer enterprise, multi-tenant, hostile-user, or compliance requirements.
- Derive trust and data-integrity boundaries from actual reachability: untrusted
  input, auth/session/ownership, shared persisted data, destructive operations,
  payments, secrets, and sensitive data.
- Ask only when an unknown materially changes behavior, architecture, persisted
  data, interoperability, a real security boundary, or cost. Otherwise choose the
  simplest repository-native implementation.
- Add an abstraction, dependency, service, configuration surface, compatibility
  layer, or security mechanism only for a current requirement.
- Simplicity never removes real trust-boundary validation, data-loss prevention,
  accessibility, explicit security requirements, configured tests, or project rules.
- Stack-specific template standards apply only when the project uses that stack.

## Read these when relevant

- `blueprint/config.json` - workflow policy: review cadence, quality gates, branch prefixes, `git.landing`. Skills read it themselves; an invalid file stops mutating commands and points to `/doctor`. Configuration never grants permission to commit, merge, push, deploy, publish, delete data, waive a failing check, or accept a finding.
- `blueprint/context/project-overview.md` - durable product context from the plans
- `blueprint/context/coding-standards.md` - stack, testing, and writing standards (code rules live in `.claude/rules/`)
- `blueprint/context/ai-interaction.md` - read when running the Blueprint workflow
- `blueprint/context/current-feature.md` - the one feature, fix, or rollback being built in this checkout

Reuse relevant context already loaded in the session; skills load the rest on demand.

## Workflow

Build one feature, fix, or rollback at a time, behind review gates:

`/feature` (or `/fix`, `/rollback`) -> `/feature-review` -> `/feature-review-fix` ->
`/implement` -> `/check` -> `/audit current` -> `/complete`

Approve the spec `/feature-review-fix` rewrote before Implement. Check proves
behavior; Audit reviews code and records findings in `blueprint/context/findings.md`
(open P0/P1 findings block `/complete`). Audit is not mandatory unless the
configured gates select it. `/check guide` only generates manual instructions.
`/explore`, `/brief`, `/status`, and `/doctor` are read-only orientation.

In Codex, invoke skills as `$feature`; in Claude Code and Cursor, as `/feature`.
These are chat commands, not terminal commands.

Approval boundaries:

- `autopilot` and `continuous` are explicit-only. Autopilot stops before
  `/complete`; Continuous works locally and never pushes, deploys, or publishes.
- `/complete` follows `git.landing` (`local-merge`): squash merge needs an
  explicit yes, and pushing needs a separate yes.
- `/release` prepares Render/Vercel config only. This product ships as a `.vsix`;
  never deploy, publish, or push without a separate yes in the current chat.
- Parallel work uses one Git worktree or clone per work item, each on its own
  branch. Never replace another worker's active spec.

## Dashboard activity

Tracked commands record progress in `blueprint/.state/run.json` (generated, ignored
by Git): `onboard`, `adopt`, `discovery`, `overview`, `feature`, `fix`,
`feature-review`, `feature-review-fix`, `rollback`, `implement`, `debug`, `check`,
`audit`, `tests`, `ci`, `prototype`, `autopilot`, `continuous`, `complete`, and
`release`. `explore`, `brief`, `status`, `doctor`, and `check guide` never write it.

Writing the initial record is the first action of a tracked command, before any
other tool call. It does not authorize product changes or bypass a safety check.
Never create or edit `run.json` directly; use the helper from the project root:

```text
node .cursor/skills/doctor/scripts/run-state.mjs <action> <options>
```

- `start --command <skill> --summary <truthful-summary> --boundary <boundary>`
- `update` at milestones; for a blocker add `--status blocked --resume <exact-command>`
- `finish --status ready|completed --summary <truthful-summary>`

`status`: `running`, `blocked`, `ready` (reached its review handoff), or
`completed`. `boundary`: `read-only`, `reviewed`, or `local-only`. Optional:
`--detail`, progress, feature id/title. The helper validates every field. If it
is missing or fails, report the warning and continue without a manual fallback.
Never put secrets, raw logs, prompts, or user content in this file.

## Automatic verification

`.github/workflows/verify.yml` runs `pnpm verify` on pull requests and pushes to
the default branch, with `contents: read` only. `/ci` owns changes to it. Branch
protection is a separate remote setting.

## Commands

- Install: `pnpm install`
- Check: `pnpm run check` (`vp check`: format, lint, type check; then the agent rules layout check)
- Verify: `pnpm verify` (`vp check && node scripts/check-agent-rules.mjs && svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings && tsc -p tsconfig.webview-tests.json && vp test && vp pack && vp build -c vite.webview.config.ts`)
- Test: `vp test` (unit suite via Vite+ / Vitest; not `pnpm test`)
- Coverage: `pnpm coverage` (`vp test --coverage`; report only, no thresholds; not Verify)
- Fix: `pnpm exec vp check --fix`
- Compile: `pnpm compile` (`vp check --no-fmt` for lint + type check, no format gate, then `vp pack && vp build -c vite.webview.config.ts`; writes `dist/extension.js`, `dist/mcp.js`, and `dist/webview/chrome.js` + `chrome.css`)
- Watch: `pnpm watch` (`pnpm run --parallel "/^watch:/"` — `watch:pack` and `watch:webview`)
- Debug: **F5** (Run Extension): Extension Development Host opens `fixtures/dev-workspace`
- Package: `pnpm package` (`vp check --no-fmt && vp pack --minify --no-sourcemap && vp build -c vite.webview.config.ts --sourcemap false`)
- TypeScript: package `typescript` is `~6.0.3` (svelte-check peer); lint / type-aware check still run on TS 7 via tsgolint
- Package `.vsix`: `pnpm vsix`
- Knip: `pnpm knip` (unused files/deps; not Verify)

Lint config lives in `vite.config.ts` and enforces the mechanical code conventions
(arrow functions, names, `catch (error)`, return types, banned libraries, `vscode`
only in host code). Fix the code, not the rule.

Confirm `dist/mcp.js` exists after compile/watch before testing MCP in the Extension Development Host.

The unit Test command is `vp test` (Vite+ / Vitest; `src/**/*.test.ts` excluding `src/test/**`). It is not `pnpm test` (`vscode-test`, Electron). Build Electron with `pnpm compile-electron-tests` (writes `out/test/**/*.test.js`), then `pnpm test`; that suite needs a display and is not Verify.

Browser testing is opt-in: `/tests browser` adds a harness and records its exact
command here as `Browser tests`.
