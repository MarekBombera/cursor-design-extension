# AGENTS.md

**cursor-design** is a Cursor/VS Code extension (WebviewPanel + local MCP), not a Next.js app. Brain = Cursor Agent only. Disk SoT = `.cursor-design/`.

**Notion:** hub (locks, MCP/disk, Interact vs Edit) https://app.notion.com/p/3d5500344e0881019a9fd659ccb7ffb4 . The active plan is named in `blueprint/build-plan.md` (0.5: `blueprint/reference/0.5-pages-plan.md`).

**After work:** run `pnpm verify`; never skip it.

**Agent skill:** a change to an MCP tool or its args, an Agent-visible error code, an artboard runtime limit, the frame sandbox or either CSP updates `skills/cursor-design/SKILL.md` (shipped; `syncAgentSkill` copies it to `~/.cursor/skills/` on activate) in the same change. `src/mcp/agentSkill.test.ts` guards: frontmatter, every registered tool named and no unknown snake_case name, every Agent-visible error code in `src/disk/errors.ts` named and no unknown code, the frame width / gap / height / posted-HTML limits, the `Frame.svelte` `sandbox` value, and no `.cursor-design/artboards/` path. The CSP and all other prose are on you.

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

## Read these when relevant

- `blueprint/config.json` - workflow policy (gates, `git.landing`); if invalid, run `/blueprint-doctor`. It never grants permission to commit, merge, push, deploy, publish, delete data, waive a failing check, or accept a finding.
- `blueprint/context/project-overview.md` - product context
- `blueprint/context/system-map.md` - processes, messages, disk; read before changing a cross-process flow
- `blueprint/context/coding-standards.md` - stack, testing, writing
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

**Dashboard activity:** tracked commands (plus `feature-review`, `feature-review-fix`) write `blueprint/.state/run.json` only via `node .cursor/skills/blueprint-doctor/scripts/run-state.mjs`, never by hand (contract: `blueprint/workflow.md`).

**Automatic verification:** `.github/workflows/verify.yml` runs `pnpm verify` on pull requests and pushes to `main` (`contents: read`); `/ci` owns it.

## Commands

- Install: `pnpm install`
- Check: `pnpm run check` (`vp check`, then the agent rules check)
- Verify: `pnpm verify`
- Test: `pnpm test` (`vp test`: Vitest over `src/**/*.test.ts`). No Electron suite (plain VS Code lacks the Cursor API).
- Fix: `pnpm exec vp check --fix`
- Debug: **F5** opens `fixtures/dev-workspace` in the Extension Development Host for Cursor-only checks (CSP, MCP registration, Extension Host, webview hide/show, Cursor focus). Confirm `dist/mcp.js` exists first.
- Package `.vsix`: `pnpm vsix`
- Other scripts: `package.json` (coverage, compile, watch, package, knip; Verify also runs `knip` and `knip --production`).

Lint (`vite.config.ts`) enforces the mechanical conventions. Fix the code, not the rule.

Browser tests: `pnpm test:browser` (builds chrome, then Playwright Chromium over `tests/browser/` proves chrome and frame behavior; first run needs `pnpm exec playwright install chromium`; local only, not Verify or CI). Two projects: `parallel` (5 workers, `CD_BROWSER_WORKERS=n` to change) then `serial` (tests tagged `@serial`: quiet window, CDP pan, gallery; one worker; skipped when a parallel test fails).

Gallery: `pnpm gallery` (every chrome state, both themes, WCAG contrast, into `test-results/gallery/`; local only; `--no-deps` so only the gallery runs).

Agent test runs (keep cycles short):

- Iterate on one spec or one test (`vp build -c vite.webview.config.ts`, then `playwright test -c tests/browser <file> --grep "<test>"`); run the full `pnpm test:browser` once per round, at the end.
- Mutation probes target the one test meant to catch them; prefer probes on pure `.ts` rule modules (Vitest).
- `pnpm gallery` only when the chrome's look changed.
- Reviewers reuse the last green full run on the same commit and only run probes. Test- or config-only work gets one reviewer.
- Parallel agents never share one tree's `dist/`: one browser-running agent per tree, probes in a scratch copy.
