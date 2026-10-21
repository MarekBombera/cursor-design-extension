# Feature: Verify + CI

**From build-plan:** feature 7h
**Build attempt:** 1

**Branch:** `feature/verify-ci`
**Planned archive:** `blueprint/history/features/07h-verify-ci.md`
**Status:** verified

**Parent:** 7. **0.2.1 Tooling** - no product features and no behavior changes.
**Create-from:** `feature/mcp-contract-tests` at `d9b719cefc3b52e0c4ad6b38ecbf5d2d3bcdbd88`. Do not branch from `main` (`43cce2c`, still 7b). Implement steps do not commit, so `git rev-parse HEAD` stays `d9b719c` until `/complete`. The working tree changes after step 1. Later steps must not require a clean tree matching that tip.

**Sources:** Notion 0.2.1 https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc phase 3 CI line; `blueprint/reference/0.2.1-tooling-review.md` § 7h; `blueprint/build-plan.md` 7h; `blueprint/context/project-overview.md` tooling + 7h; `AGENTS.md` Automatic verification + Commands.

## Goal

Add one local Verify command and a GitHub Actions workflow that runs that same command on push to `main` and on pull requests. Verify is check + unit test + unminified pack. Electron, coverage, and knip stay out. Product behavior is unchanged versus 7g.

## In scope

- Create branch `feature/verify-ci` from the 7g tip above (not from `main`).
- Add `package.json` script `verify` only. Exact body: `vp check && vp test && vp pack`.
- Record Verify under `AGENTS.md` Commands (new bullet immediately after Check) and README Develop (new line inside the existing bash fence, immediately after `pnpm compile`). Keep the existing Test paragraph that says Electron is not Verify; add that Verify is `pnpm verify`.
- Add `.github/workflows/verify.yml` matching the contract below. Do not push.
- Final smoke (not part of the Verify script, not part of CI): `pnpm vsix` then `unzip -l` on the produced `.vsix`; F5 in the Extension Development Host.
- Failure handling is command/CI exit status only. No product error UI.

## Out of scope

- Any edit under `src/`. No MCP, disk, panel, or product behavior change.
- `vite.config.ts` test/lint/pack changes (the workflow can exist without them).
- `pnpm-workspace.yaml` (`allowBuilds: esbuild: true` stays).
- Adding a `packageManager` field.
- Changing `compile`, `package`, `test`, `coverage`, `knip`, or F5 `preLaunchTask`. `compile` stays `vp check --no-fmt && vp pack` so F5 does not depend on format.
- Electron in Verify or CI (`pnpm test`, `compile-electron-tests`, xvfb, display jobs).
- Coverage, knip, husky, `act`, Docker, a second test runner, or a workflow unit test.
- Enabling GitHub branch protection or a ruleset.
- Running the `/ci` skill (this feature is the Verify + CI setup).
- 0.3 features, Svelte chrome rewrite.
- Committing `*.vsix` (already gitignored).
- Rewriting `AGENTS.md` Automatic verification or `coding-standards.md`.

## Build loop

`workflow.stepReview` is `feature`. `checkpointCommits` is `disabled`. Implement the four steps on `feature/verify-ci`. `/complete` makes the feature commit. Do not commit in the implement steps. Do not push. Do not enable branch protection.

`/feature` skipped Verify because the command does not exist yet. After step 1, later steps may run `pnpm verify`. `verification.logicTests` is `when-configured` (`vp test` exists). `uiEvidence` is `when-available` (no Browser tests command).

## Build steps

- [x] **1. Branch and add the `verify` script**
  Create `feature/verify-ci` from `feature/mcp-contract-tests` at `d9b719cefc3b52e0c4ad6b38ecbf5d2d3bcdbd88`. Add only `package.json` `scripts.verify`: `vp check && vp test && vp pack`. Match existing tab indentation. Do not add CI or docs yet. Run `pnpm verify`. Record the observed `vp check` / `vp test` / `vp pack` results (do not invent a test count). Confirm `dist/extension.js` and `dist/mcp.js` exist.
  If `pnpm verify` fails on that create-from tip, stop and ask Bombic. Do not change the Verify body. Do not edit `src/` to green it unless Bombic says so. Review-time `vp check` exited 0 on that tip (63 files formatted, 52 lint/type clean); implement should expect green, but treat a later fail as a stop.
  **Done when:** branch `feature/verify-ci` exists and was not created from `main`; `git rev-parse HEAD` is still `d9b719c`; `pnpm verify` exits 0; both dist files exist; observed results are written down; no `.github/` and no Verify docs yet. Check: `pnpm verify`.

- [x] **2. Document Verify in AGENTS.md and README**
  In `AGENTS.md` Commands, add the Verify bullet immediately after Check: `pnpm verify` runs `vp check && vp test && vp pack`. Keep the existing Test paragraph that says the Electron suite is not Verify; add that Verify is `pnpm verify`. Do not retcon the file-count sentence. In README Develop, add `pnpm verify` as the next line inside the existing bash fence, immediately after `pnpm compile`. Do not add a second fence or a sentence outside it. Keep the existing `pnpm install` / `pnpm compile` / F5 instructions.
  **Done when:** Commands lists Verify as `pnpm verify` immediately after Check; the Test paragraph still excludes Electron and now names `pnpm verify`; README Develop fence is `pnpm install` / `pnpm compile` / `pnpm verify`; install/compile/F5 prose remains. Check: read those two sections; `pnpm verify` still exits 0.

- [x] **3. Add `.github/workflows/verify.yml`**
  Add the workflow matching Data / contracts. Pin `actions/checkout`, `actions/setup-node`, and `pnpm/action-setup` to major tag `v4`. Do not invent commit SHAs. Do not add `packageManager`. Do not push.
  **Done when:** the file exists and matches the locked YAML contract (triggers, `contents: read`, Node 24, pnpm 12, frozen install, prove step, `pnpm verify`, ubuntu-latest, no matrix/Electron/coverage/husky/extra jobs); the branch has not been pushed. Check: file contents against the contract; `pnpm verify` still exits 0.

- [x] **4. `.vsix` listing and F5 smoke**
  F5 left to parent (implementer cannot run Extension Host). Bombic waived live F5 in this session (complete + commit requested; no `src/` change; vsix listing passed).
  Run `pnpm vsix` (`pnpm dlx @vscode/vsce@3.9.2 package --no-dependencies`). That needs network and runs `vscode:prepublish` → `package`, which overwrites `dist/` with the minified production pack. F5 `preLaunchTask: compile` then rewrites unminified `dist/`. Inspecting `dist/` between vsix and F5 is not a failure. If vsix/dlx cannot run, stop and ask Bombic. Do not fake the listing.
  Then `unzip -l` on the produced `.vsix`: members `extension/dist/extension.js` and `extension/dist/mcp.js` are present; no `node_modules`. F5: Extension Development Host opens `fixtures/dev-workspace`; Open Artboard; MCP server `cursor-design` registers; no product behavior change versus 7g. If F5 cannot be run in the implement session, stop and ask Bombic. Do not fake F5. Do not commit `*.vsix`. No `src/` edits.
  **Done when:** the zip listing shows `extension/dist/extension.js` and `extension/dist/mcp.js` and does not list `node_modules`; F5 smoke matches 7g or the session stopped for Bombic; `git status` has no staged or tracked `.vsix`. Check: `unzip -l` plus human F5 (or an explicit Bombic stop).

## Files / areas

- `package.json` - add `scripts.verify` only.
- `AGENTS.md` - Commands Verify bullet immediately after Check; keep/extend the existing Electron-is-not-Verify Test paragraph.
- `README.md` - Develop bash fence only (`pnpm verify` after `pnpm compile`).
- `.github/workflows/verify.yml` - new file.

Do not touch `src/`, `vite.config.ts`, `pnpm-workspace.yaml`, `.gitignore`, `compile` / F5 launch, or the `/ci` skill.

## Data / contracts

**Verify command (locked):** `pnpm verify` runs `vp check && vp test && vp pack`.

- `vp check` includes format. CI failing on format drift is intended.
- `vp test` is the unit Test command (Vite+ / Vitest). Never add `pnpm test`, `compile-electron-tests`, coverage, or knip to Verify.
- `vp pack` is the unminified pack (same as compile's pack half). It must write `dist/extension.js` and `dist/mcp.js`. Do not use `--minify` in Verify.
- If inherited format or other drift fails Verify on the create-from tip, stop and ask Bombic. Do not switch Verify to `vp check --no-fmt`. Do not edit `src/` to green it unless Bombic says so.

**Existing scripts (do not change):**

- `check`: `vp check`
- `compile`: `vp check --no-fmt && vp pack` (F5 `preLaunchTask`; must stay fast; must not gain a format gate)
- `package`: `vp check --no-fmt && vp pack --minify --no-sourcemap`
- `vsix`: `pnpm dlx @vscode/vsce@3.9.2 package --no-dependencies` (network; runs `vscode:prepublish` → minified `package`)
- `test`: `vscode-test` (Electron; display; not Verify)
- `coverage`: `vp test --coverage` (not Verify)
- `knip`: `knip` (not Verify)

**Tooling already present:** `vite-plus` is `1.3.0` exact. `node_modules/.bin/vp` exists after `pnpm install`. Local Node v24.18.0, pnpm 12.10.1. No `packageManager` field. Prefer `pnpm/action-setup` `version: 12`. Do not add a second global `vp` install or `pnpm add`.

**Workflow file (locked shape):**

```yaml
name: Verify

on:
  push:
    branches:
      - main
  pull_request:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 12
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: pnpm install --frozen-lockfile
      - name: Prove Vite+
        run: pnpm exec vp --version
      - run: pnpm verify
```

- `on`: push to `main` and `pull_request`.
- `permissions: contents: read` only. No secrets. None are needed; do not add any.
- Vite+ comes from the existing `vite-plus` 1.3.0 dep. The named prove step after install is `pnpm exec vp --version`.
- Same Verify command: `pnpm verify`.
- ubuntu-latest. No version matrix. No Electron. No coverage. No husky. No extra jobs or extra steps.
- Pin those three actions to current major tags (`v4`). Do not invent commit SHAs.
- This feature does not push. A live green GitHub check is not a step-3 done-when. Local `pnpm verify` plus the file matching this contract is the proof.

**Failure / empty / denied (tooling, not product UI):**

- Happy: `pnpm verify` exits 0 locally; CI runs that same command after checkout, frozen install, and the prove step.
- Invalid / failed verify: format drift fails `vp check`; a unit failure fails `vp test`; pack failure fails `vp pack`. The command and the CI job exit non-zero. Do not add product error UI, banners, or MCP `isError` text. Do not weaken Verify to `--no-fmt` to pass.
- Missing workspace: not a product case. CI always has the checkout workspace. Locally, a missing install or missing `vp` binary fails at install or at the prove / Verify step.
- Denied: the workflow cannot write the repo or use secrets (`contents: read` only). Product `untrustedWorkspaces` is unchanged.
- Unexpected: if vsix/dlx or F5 cannot be run, stop and ask Bombic. Do not fake either smoke.

**Final smoke (not Verify, not CI):**

- `pnpm vsix` then `unzip -l`: members `extension/dist/extension.js` and `extension/dist/mcp.js` present, no `node_modules`.
- `pnpm vsix` overwrites `dist/` via `vscode:prepublish` → minified `package`. That is expected. F5 `preLaunchTask: compile` rewrites unminified `dist/` before the host loads the bundle.
- F5: Extension Development Host opens `fixtures/dev-workspace`; Open Artboard; MCP server `cursor-design` registers; no product behavior change versus 7g.
- `.gitignore` already has `*.vsix`. Do not commit a vsix.

## Testing

No new unit tests. This feature adds no product logic. Do not invent a test runner, `act`, Docker, or a workflow unit test.

- Test command stays `vp test`. It runs as the middle of `pnpm verify` after step 1.
- Electron (`pnpm test` / `compile-electron-tests`) stays out of Verify and CI.
- Coverage and knip stay out of Verify and CI.
- No Browser tests command; no Playwright.
- Record observed `pnpm verify` results in step 1. Do not invent a test count in this spec or in later steps.
- F5 is human smoke in step 4, not an automated UI test.

## Notes for the AI

- Do not implement from a later feature. Do not pull 0.3 or Svelte chrome.
- Do not run `/ci`. Do not enable GitHub branch protection.
- Do not weaken Electron-out-of-CI.
- Do not change `compile` so F5 waits on format.
- Do not add `packageManager` unless a workflow step cannot run without it (it can; use `pnpm/action-setup` version `12`).
- Do not touch `pnpm-workspace.yaml`.
- Implement does not commit. `HEAD` stays `d9b719c` until `/complete`. The working tree changes after step 1.
- `/complete` makes the feature commit. Implement steps do not commit. Do not push.
- No em dashes (U+2014). Use hyphens.
- If vsix/dlx or F5 cannot be run, stop and ask Bombic.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":12804,"specSha256":"af41250c16e01ed0a7776fbeb6778e028e2fcc24579a256ce3ea900218743602","branch":"refs/heads/feature/verify-ci","head":"d9b719cefc3b52e0c4ad6b38ecbf5d2d3bcdbd88","baseRef":"refs/heads/main","baseCommit":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","sourceTree":"6ddb976485a9dbbb6cd64a07c17782520649aebb","absentOptional":[]} -->
