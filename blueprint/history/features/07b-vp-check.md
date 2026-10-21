# Feature: vp check

**From build-plan:** feature 7b
**Build attempt:** 1
**Branch:** feature/vp-check
**Status:** verified

## Goal

Move the oxlint and oxfmt config into the root `vite.config.ts` and make `vp check` (Oxfmt, Oxlint,
and the tsgolint type check) the one static-check command. It replaces the `check-types`, `lint`,
`lint:fix`, `fmt`, and `fmt:check` scripts. Then remove the rc files, the direct `oxlint` / `oxfmt`
devDependencies, `watch:tsc`, and `pretest`. Formatting drift lands in its own commit, separate from
the config change. Product behavior does not change, and F5 is gated exactly as it is today (types
+ lint, never format).

Source: Notion [0.2.1 — Tooling](https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc) and
`blueprint/reference/0.2.1-tooling-review.md` § 7b. Every § 7b item is already carried into the
steps below. **This spec wins** if the two ever disagree.

## In scope

- `lint` and `fmt` blocks in `vite.config.ts` carrying every setting from `.oxlintrc.json` and
  `.oxfmtrc.json` (exact objects in Data / contracts). Losing the `$schema` lines is fine.
- `lint.options.typeAware: true` + `typeCheck: true`. Without both, `vp check` does not type-check,
  so removing `check-types` would silently drop type checking (Vite+ `guide/check.md`). Each
  type-aware **rule** that step 1's procedure finds stays explicitly `'off'` until 7e.
- One format-only drift commit (step 2), separate from all config changes.
- `package.json` scripts re-pointed or removed; `oxlint` / `oxfmt` devDependencies removed.
- `.oxlintrc.json` and `.oxfmtrc.json` deleted; dead `.vscodeignore` lines for them removed.
- `.vscode/tasks.json`: drop `npm: watch:tsc` from the `watch` task and delete that task.
- Live docs: AGENTS.md Commands and `blueprint/context/coding-standards.md` § Stack.

## Out of scope

- Turning on type-aware lint rules, fixing their violations, knip (7e).
- Vitest, `vp test`, the Test command, `node:test` rewrites, and reconciling 7c's "178" test count
  (7c).
- `compile-tests`, `watch-tests`, `.vscode-test.mjs`, the `test` script, `@types/mocha`,
  `@vscode/test-cli`, `npm-run-all`, `typescript` (still used by `compile-tests`), and
  `.npmrc` `enable-pre-post-scripts` (7d).
- Verify command, CI, README dev commands (7h).
- Editor settings: `.vscode/settings.json` and `.vscode/extensions.json` stay unchanged apart from
  formatting drift. No Vite+ extension-pack switch, no `npm.scriptRunner`.
- Any `src/` change other than step 2's format-only drift. If a lint, type-check, or format parity
  check would need a real `src/` edit, stop and ask.
- User-owned plans (`blueprint/project-plan.md` still names `pnpm check-types` / `pnpm lint` as
  0.2-era Verify; leave it). History archives, `blueprint/reference/**`, `notes.md`.

## Build loop

`workflow.stepReview: feature`: implement all steps, then present one review packet.
`workflow.checkpointCommits: disabled`: no checkpoint commits. **One exception, required by the build
plan:** step 2's format-drift commit. Ask the user before making it. No AI attribution in its message
(AGENTS.md). `/complete` makes the feature commit for everything else. See Open questions for how
`/complete` should land the drift commit.

## Build steps

- [x] **1. Port config into `vite.config.ts`.** On `feature/vp-check`, do these in order. Leave the
  scripts and deps alone in this step.

  **a. Baselines (old tools, rc files in place).** Record in Notes:
  - Unit tests with the Testing command: the printed pass / fail totals. This is the **locked
    count** for the rest of the feature (177 on `main` at `4a25c52`). If the branch prints another
    number, lock that one and say why. Don't reconcile 7c's 178.
  - Old lint **checked set**: the file count from `pnpm lint` (`oxlint`).
  - Old fmt **checked set**: the paths `pnpm fmt:check` considers. Its summary line gives the count,
    "on N files" (62 on `main`). Get the path list from oxfmt's list-files mode if it has one;
    otherwise record the count only.
  - Old fmt **drift set**: the paths `pnpm fmt:check` reports as failing (15 on `main`).
  - Warning exit code: add `if (1 == 1) {}` (an `eqeqeq` warning) to `src/extension.ts`, record
    `pnpm lint`'s exit code (expected 0), then revert. `git diff -- src` must be empty afterwards.

  **b. Add the blocks.** Paste the exact `lint` and `fmt` objects from Data / contracts next to the
  untouched `pack` block. If `vp` rejects a key, stop and ask. Don't rename keys to fit the docs.

  **c. Prove `vite.config.ts` wins over the rc files.** `pnpm exec vp lint --print-config` must show
  `options.typeAware` and `options.typeCheck` set to true, plus the `curly` / `eqeqeq` /
  `no-throw-literal` warnings. If the rc file wins instead, temporarily rename `.oxlintrc.json`
  (and `.oxfmtrc.json` if needed) for the rest of step 1, restore it before step 2, and record this
  in Notes.

  **d. Hold type-aware rules off.** Use the bundled oxlint **1.88.0** as the catalog: its rule docs
  (the oxc rules page https://oxc.rs/docs/guide/usage/linter/rules.html, filtered to type-aware
  rules, checked against the 1.88.0 package). Set a rule to `'off'` in `lint.rules` only if it is
  type-aware in that catalog **and** shows up as enabled in step c's `--print-config` output. Add
  one comment saying 7e turns them on. Record the captured print-config rule names and the
  resulting list in Notes. An empty list is valid only when the capture is recorded. If
  `--print-config` doesn't list effective rules by name, stop and ask.

  **e. `vite.config.ts` under type-aware mode.** The root file sits outside `tsconfig.json`
  `include: ["src"]`, which 7a added on purpose. If type-aware mode rejects it, prefer a lint
  `ignorePatterns` entry for `vite.config.ts`. Use a small `tsconfig.node.json` only if the ignore
  doesn't work. Record which one. Do not change `rootDir` or `include` for `src`.

  Done when:
  - `pnpm exec vp lint` reports 0 errors and 0 warnings. Its checked file count equals the old lint
    checked set. Not counted: `vite.config.ts`, if step e ignores it. If `vp lint` checks extra
    paths, add an ignore for each one and record it. If it checks fewer, stop and ask. Add no other
    ignores.
  - `pnpm exec vp check --no-fmt` exits 0, and `pnpm check-types` stays clean.
  - Type-check proof: temporarily add `const typeProof: number = 'x';` to `src/extension.ts`.
    `pnpm exec vp check --no-fmt` exits non-zero and names the error. Revert, then confirm
    `git diff -- src` is empty.
  - Warning parity: repeat the 1a `==` seed. `pnpm exec vp check --no-fmt` must give the same exit
    code `pnpm lint` gave. If it differs, stop and ask. Revert, and `git diff -- src` is empty.
  - Any diagnostic inside `src/` that `tsc --noEmit` does not report means stop and ask. Do not edit
    `src/` to satisfy it.
  - `pnpm exec vp fmt --check` uses the ported config (it must not print "No config found").
    - **Checked set:** its "on N files" count (and path list, when available) equals the old fmt
      checked set from 1a. That baseline is the source of truth; `4a25c52`'s numbers are history.
      If `vp fmt` checks extra paths, add an `fmt.ignorePatterns` entry for each one and record it.
      If it checks fewer, stop and ask; don't drop a path oxfmt checked.
    - **Drift set:** the failing paths are recorded and may differ from the old 15. Explain each
      difference in Notes, for example oxfmt 0.71 → 0.73 (bundled).
- [x] **2. Format drift, own commit.** Restore any rc file step 1c renamed. Then run
  `pnpm exec vp fmt`, format only. Never use `vp check --fix` here: it also applies lint fixes.
  - Read the whole diff. It must be formatting only: whitespace, wrapping, quotes, trailing commas,
    parentheses. Any token-level change that could alter behavior is a stop-and-ask. Pay attention
    to `AGENTS.md` (Markdown) and `package.json`.
  - Run the gates that exist at this point: the unit tests (Testing), `pnpm check-types`, and
    `pnpm compile` (old scripts are still in place).
  - Ask the user, then commit **only** the files `vp fmt` changed in this step. Exclude the step 1
    config files: `vite.config.ts`, plus `tsconfig.node.json` if step 1e created it. Message:
    `style: apply vp fmt`. No AI attribution trailer.

  Done when:
  - `git show --stat HEAD` lists exactly the files `vp fmt` changed in step 2. That should be step
    1's recorded drift set, minus the excluded config files.
  - `git status --short` shows only the step 1 config files: `vite.config.ts`, plus
    `tsconfig.node.json` if it was created.
  - `pnpm exec vp fmt --check` is clean.
  - Unit tests match the locked count with 0 fail, and `pnpm compile` exits 0.
- [x] **3. Cut over scripts, deps, rc files, and tasks.**
  - `package.json` scripts after cutover (all others byte-identical):
    - `"check": "vp check"` (new)
    - `"compile": "vp check --no-fmt && vp pack"`
    - `"package": "vp check --no-fmt && vp pack --minify --no-sourcemap"`
    - unchanged and confirmed: `"vscode:prepublish": "pnpm run package"` (it inherits the new
      gate) and `"watch": "npm-run-all -p watch:*"`. That glob loses `watch:tsc` when the script
      goes, so only `watch:pack` remains.
    - removed: `check-types`, `lint`, `lint:fix`, `fmt`, `fmt:check`, `watch:tsc`, `pretest`
    - If any remaining script still names a removed command, rewrite only that prefix and record
      it. `package.json` is not on the step 4 allowlist.
  - Run `pnpm remove oxlint oxfmt`; the lockfile updates. `pnpm why oxlint` and `pnpm why oxfmt`
    (two commands) may still show them under `vite-plus`. That's expected; record it.
  - Delete `.oxlintrc.json` and `.oxfmtrc.json`. In `.vscodeignore`, remove the `.oxlintrc.json`,
    `.oxfmtrc.json`, `oxlint*`, and `oxfmt*` lines.
  - `.vscode/tasks.json`: in the `watch` task, set `"dependsOn": ["npm: watch:pack"]`. Delete the
    `npm: watch:tsc` task. No other entry changes. `.vscode/launch.json` doesn't name `watch:tsc`
    (`preLaunchTask: compile`) and stays untouched.

  Done when:
  - `pnpm run check` exits 0. With the rc files gone, this proves the config comes from
    `vite.config.ts`.
  - `pnpm compile` exits 0 and writes `dist/extension.js` and `dist/mcp.js`.
  - Gate proofs, each reverted afterwards with `git diff -- src` empty:
    - Format is not an F5 gate: mis-indent one line in `src/extension.ts`. `pnpm compile` exits 0
      and `pnpm run check` exits non-zero.
    - Types still gate F5: `const typeProof: number = 'x';`. `pnpm compile` exits non-zero. The
      `&&` means `vp pack` doesn't run; no `dist/` check is needed.
    - Lint still gates F5: a `debugger;` statement (correctness rule `no-debugger`). `pnpm compile`
      exits non-zero.
  - `pnpm package` exits 0.
  - `pnpm watch` rebuilds `dist/mcp.js` after a whitespace touch of `src/mcp/server.ts` (check the
    mtime, then revert).
  - The VS Code `watch` task reaches "ready". This is manual: label it so, don't claim it unrun.
  - `rg -n 'watch:tsc' .vscode package.json` finds nothing.
- [x] **4. Docs and final smoke.**
  - AGENTS.md Commands: replace the `Typecheck` and `Lint` lines with:
    - `Check: pnpm run check` (`vp check`: format, lint, type check)
    - `Fix: pnpm exec vp check --fix`

    Change the Compile line to:
    `` - Compile: `pnpm compile` (`vp check --no-fmt` for lint + type check, no format gate, then `vp pack`; writes `dist/extension.js` and `dist/mcp.js`) ``.
    Edit nothing else in AGENTS.md.
  - `blueprint/context/coding-standards.md` § Stack: replace the `Lint / format` line with exactly:
    `` - **Lint / format / type check:** Vite+ `vp check` (Oxlint + Oxfmt + tsgolint type check); config in `vite.config.ts` ``
  - `.vsix`: build with `pnpm vsix --out <scratchpad>/…` so the ignored `cursor-design-0.1.0.vsix`
    stays byte-identical, then `unzip -l`. Delete it afterwards.
  - F5 (Run Extension): `preLaunchTask: compile` finishes and the panel opens with no activation
    error.

  Done when:
  - `rg -n -S 'check-types|watch:tsc|pretest|fmt:check|lint:fix|oxlintrc|oxfmtrc' --glob '!node_modules' --glob '!.pnpm-store'`
    hits only this allowlist: `blueprint/history/**`, `blueprint/reference/**`,
    `blueprint/context/current-feature*.md`, `blueprint/context/feature-review.md`,
    `blueprint/context/project-overview.md`, `blueprint/project-plan.md`, `blueprint/build-plan.md`,
    `notes.md`. Any other hit is a fail. At spec time, README, `.cursor/**` and the other live docs
    have no hits.
  - The `.vsix` lists the same 9 entries as 7a: manifest, content types, and
    `extension/{package.json,readme.md,LICENSE.txt,changelog.md,media/artboard-panel.png,dist/extension.js,dist/mcp.js}`.
  - Final gates pass: `pnpm run check`, `pnpm compile`, and unit tests at the locked count with
    0 fail.
  - F5 is recorded as manual. Don't claim it if it wasn't run.

## Files / areas

- `vite.config.ts` - add `lint` + `fmt` blocks; `pack` block unchanged
- `package.json` - scripts (above); remove `oxlint`, `oxfmt` devDependencies; step 2 formatting
- `pnpm-lock.yaml` - dep removal
- `.oxlintrc.json`, `.oxfmtrc.json` - deleted (possibly renamed temporarily in step 1c)
- `.vscodeignore` - drop 4 dead lines
- `.vscode/tasks.json` - `watch` task + `npm: watch:tsc` removal
- `tsconfig.node.json` (new) - only if step 1e needs it; committed with the feature, never with the drift
- `AGENTS.md` - step 2 formatting; step 4 Commands lines
- `blueprint/context/coding-standards.md` - § Stack lint/format line
- Step 2 drift only: the files `vp fmt` changes (on `main` this includes `src/**` files,
  `.vscode/extensions.json`, `AGENTS.md`, `package.json`)
- Read-only: `.vscode/launch.json` (`preLaunchTask: compile`, no `watch:tsc`), `.npmrc`,
  `.vscode/settings.json`

## Data / contracts

Exact blocks to add to `defineConfig({...})` next to `pack`. Key placement follows the Vite+
`config/lint.md` / `config/fmt.md` examples: format options sit directly on `fmt`, and lint options
sit on `lint.options`.

```ts
lint: {
	plugins: ['typescript'],
	categories: { correctness: 'error' },
	rules: {
		curly: 'warn',
		eqeqeq: 'warn',
		'no-throw-literal': 'warn',
		// + each step 1d type-aware rule: 'off' (7e turns them on)
	},
	ignorePatterns: ['dist', 'out', 'node_modules', '.vscode-test'], // + step 1d/1e entries only
	options: { typeAware: true, typeCheck: true },
},
fmt: {
	semi: true,
	singleQuote: true,
	useTabs: true,
	printWidth: 100,
	ignorePatterns: [
		'**/dist/**',
		'**/out/**',
		'**/node_modules/**',
		'**/.vscode-test/**',
		'**/.agents/**',
		'**/.cursor/**',
		'**/.claude/**',
		'**/blueprint/**',
		'src/types/vscode.cursor.d.ts',
	], // + step 1 checked-set parity entries only
},
```

Gate contract:

| Command | Format | Lint | Types | Bundle |
|---|---|---|---|---|
| `pnpm compile` (F5 `preLaunchTask`) | no | yes | yes | dev |
| `pnpm package` / `vscode:prepublish` (`pnpm run package`) | no | yes | yes | prod |
| `pnpm run check` | yes | yes | yes | no |

- Lint warnings keep today's meaning: reported, not failing (proven by the step 1 `==` seed). Errors
  fail.
- `pnpm test` (`vscode-test`) no longer builds `out/` first because `pretest` is gone. Run
  `pnpm compile-tests && pnpm compile` before it by hand. 7d owns that suite.
- No persisted data, MCP tool, disk layout, webview, or bundle contract changes.

## Testing

- No declared Test command yet (7c adds it). Use the existing runner:
  `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`.
  Baseline on `main` (`4a25c52`): **177 pass, 0 fail**. Step 1a re-runs it on the branch and locks
  the printed count. Steps 2, 3, and 4 must match that count with 0 fail.
- Baseline on `main`: `pnpm check-types` and `pnpm lint` are clean. `pnpm fmt:check` fails on 15 of
  62 files. Step 2 commits that drift, as re-measured by `vp fmt` in step 1.
- The gate proofs in steps 1 and 3 are scripted temporary edits, always reverted. F5 and the VS Code
  watch task are manual.
- No new unit tests: this item changes no `src/` logic.

## Notes for the AI

- `blueprint/reference/0.2.1-tooling-review.md` § 7b is background. Every item in it is already a
  step here.
- Vite+ docs ship in `node_modules/vite-plus/docs` (`guide/check.md`, `guide/lint.md`,
  `config/lint.md`, `config/fmt.md`, `config/check.md`). `vp fmt` does **not** read `.oxfmtrc.json`:
  on `main` it prints "No config found, using defaults" and flags 93 files. That's why the config
  has to live in `vite.config.ts` before step 2's drift is measured. Whether `vp lint` prefers
  `vite.config.ts` over `.oxlintrc.json` is unproven; step 1c checks it.
- Versions: `vite-plus` 1.3.0 bundles oxlint 1.88.0, oxfmt 0.73.0, and `oxlint-tsgolint` 7.0.2004
  (already in the lockfile). The direct devDeps were oxlint ^1.86 and oxfmt ^0.71. A drift set that
  differs from the old 15 files is expected; explain it, don't hide it.
- `typescript` ^7.0.2 is TypeScript Go, the same toolchain tsgolint uses. Type-check parity with
  `tsc --noEmit` is still a check, not an assumption.
- Do not make F5 depend on format (`--no-fmt` in `compile` / `package`).
- `vp lint` prints a "Vite+ built-in command" note. That's not an error.
- `.vscode/settings.json` keeps `source.fixAll.oxc` on save. Whether the Oxc editor extension picks
  up the `vite.config.ts` config after the rc files go is a manual observation for Notes, not a gate.

### Build record (fill during build)

- Locked unit-test count: 177 pass, 0 fail (same as `main`)
- Old lint checked count / old fmt checked set + drift set: lint 52 files; fmt 62 files, drift 15 (`--list-different`, same 15 paths as before)
- rc precedence (step 1c) and any temporary rename: `vite.config.ts` won with rc files in place (`--print-config` showed typeAware/typeCheck true); no rename needed
- Print-config rule names / type-aware rules held `'off'`: print-config lists 85 deny rules with and without typeAware, so it can't tell them apart. Used the oxc type-aware catalog and held 15 `typescript/*` rules off: await-thenable, no-array-delete, no-base-to-string, no-duplicate-type-constituents, no-floating-promises, no-for-in-array, no-implied-eval, no-meaningless-void-operator, no-misused-spread, no-redundant-type-constituents, no-unsafe-unary-minus, no-useless-default-assignment, require-array-sort-compare, restrict-template-expressions, unbound-method. With them on, `no-floating-promises` fails ~25 test-file lines
- `vite.config.ts` type-aware handling: accepted by type-aware mode as is; no ignore or tsconfig.node.json needed (old lint already checked it too)
- `vp lint` / `vp fmt --check` checked counts and any parity ignores: lint 52 files (list identical to old); fmt 62 files; no extra ignores
- `vp fmt --check` drift set and differences: same 15 files as old; no differences. (My first `wc -l` said 14 only because the file had no trailing newline.) Drift included package.json key/keyword reordering by oxfmt 0.73: order only, no value changes
- Warning-only exit codes (`pnpm lint` vs `vp check --no-fmt`): 0 and 0. The spec's `if (1 == 1) {}` seed also trips `no-constant-condition` (an error), so I used `export const eqSeed = (a: number) => a == 1;` for both
- Drift commit SHA: see `git log --grep 'style: apply vp fmt'` on feature/vp-check
- `pnpm why oxlint` / `pnpm why oxfmt`: oxlint 1.88.0 and oxfmt 0.73.0 remain, only under vite-plus (expected)
- Gate proofs: all passed: mis-indent -> compile 0, check 1; type error -> compile 1; `debugger;` -> compile 1; src diff empty after each. `pnpm package` 0. `pnpm watch` rebuilt dist/mcp.js (mtime changed) after a touch of src/mcp/server.ts. `rg watch:tsc .vscode package.json` finds nothing. `vp check` now counts 60 fmt files (the 2 deleted rc JSONs)
- `.vsix` listing: 9 entries, same as 7a; built to scratchpad, deleted; existing cursor-design-0.1.0.vsix untouched
- VS Code watch task "ready" (manual): NOT RUN (manual)
- F5 smoke (manual): NOT RUN (manual)
- Oxc editor extension observation: NOT OBSERVED (manual)

## Open questions

- **How does the drift commit reach `main`?** The build plan wants formatting drift in its own
  commit, but `/complete` squash-merges, which would fold the drift into the feature commit.
  Recommended: at `/complete`, land two commits on `main`, `style: apply vp fmt` then the feature
  commit, instead of one squash. The alternative is to accept the squash, so the drift is separate
  only on the branch and in review. This doesn't block steps 1–4. Decide before `/complete`.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":20627,"specSha256":"7e9af8458163a3ff2cc3df2166d573c37ce6e8856de641af374734c96354420f","branch":"refs/heads/feature/vp-check","head":"47e44fa8aebc2be17afd59cf175b26b07b4296dd","baseRef":"refs/heads/main","baseCommit":"4a25c5200237f43744e48d320097975cc1a07c12","sourceTree":"2b5a2e5b397b53a30ffc1c68fa1a5b604d445767","absentOptional":[]} -->
