# Feature: Stricter static checks

**From build-plan:** feature 7e
**Build attempt:** 1
**Branch:** feature/stricter-static-checks
**Status:** verified

## Goal

Turn on the Oxlint type-aware rules that 7b held `'off'`, fix every new diagnostic with a pure edit (`void` or an `await` the caller already sequences on), and add knip with explicit entries so the unused-file/dep report is clean. No product features. No behavior changes. F5 still uses `pnpm compile` (`vp check --no-fmt && vp pack`).

Source: Notion [0.2.1 — Tooling](https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc) and `blueprint/reference/0.2.1-tooling-review.md` § 7e. Rule for the whole 0.2.1 release: **no product features and no behavior changes.**

## In scope

- Create `feature/stricter-static-checks` from `feature/electron-suite-home` (7d tip `f5c6500`). Do **not** branch from `main` (`main` is still 7b, `43cce2c`).
- Remove the 15 `'off'` overrides in `vite.config.ts` `lint.rules` so the type-aware catalog 7b recorded is active. Leave `lint.options.typeAware` and `typeCheck` true. Leave `lint.ignorePatterns` (including `src/test`) and the `fmt` / `pack` / `test` blocks unchanged.
- Fix every new `vp check` diagnostic with a **pure** edit only. `no-floating-promises` sites: `void` when the promise is fire-and-forget (today's command handlers, `postMessage`, marker `fileExists`); `await` only when the caller already sequences on that result (`assert.rejects`, `Promise.all`, an existing await chain). Record each site in the Build record. Do not add `await` to `activate` command registrations or other host fire-and-forget paths.
- Existing `void` on a non-Promise is also a diagnostic (`no-meaningless-void-operator`). Rewrite it as an unused binding (`_config`) or drop the binding. Known site today: `void config` in `src/mcp/artboardTools.test.ts`. Do not add `void` on a non-Promise. Do not use directive comments.
- Add knip as a direct `devDependency`. Add a root `knip.json` (not `knip.jsonc`) and a `package.json` `"knip": "knip"` script. Do **not** fold knip into `vp check`, `pnpm compile`, or a Verify command (7h owns Verify: check + test + pack).
- knip config must be exactly the locked JSON in step 3: plan-review entries, a `project` bound to extension TS + vite + vscode-test, ignore the ambient MCP typings, ignore `vscode` / `@types/vscode`, and `include` only the unused-file/dep issue types. That `include` is what "knip clean" means here. Default knip also reports unused exports; do not clean those by deleting or unexporting `src/` symbols.
- Remove a dependency only when knip proves it unused **after** that locked config. Keep `@types/mocha`, `@vscode/test-cli`, `@vscode/test-electron`, and `@types/vscode` (7d locked the Electron trio; the plan forbids dropping `@types/vscode`). If the first knip run names `@types/mocha` or `@vscode/test-electron`, add that name to `ignoreDependencies` with the reason in the Build record. Never `pnpm remove` them.
- Add `knip.json` to `.vscodeignore` next to `tsconfig.test.json`. Do not broaden other ignore lines.
- Document `pnpm knip` under Commands in `AGENTS.md` and add one tooling line in `blueprint/context/coding-standards.md`. Do not add a Verify command.

## Out of scope

- 7f fast-check, snapshots, coverage / `@vitest/coverage-v8`.
- 7g MCP client + `InMemoryTransport` contract tests.
- 7h Verify command, README CI blurb, `.github/workflows/verify.yml`.
- Product modules, MCP tools, disk SoT, panel HTML, artboard behavior, except the minimum `void` / `await` / unused-binding tokens this lint pass requires.
- Rewriting or deleting `src/test/extension.test.ts`. Changing `tsconfig.test.json`, `compile-electron-tests`, `.vscode-test.mjs`, or the Electron `pnpm test` path.
- Changing `launch.json`, the `watch:pack` matcher, `pnpm compile` / `package` / `vscode:prepublish` scripts, or making F5 wait on knip or format.
- Turning on extra lint rules beyond the 15 type-aware ones 7b held off. Changing `lint.ignorePatterns` or linting `src/test`.
- Deleting or unexporting anything under `src/` to silence knip (including `src/disk/layout.ts` constants used only inside that file). Running `knip --fix`, `knip --fix-type`, or `npx @knip/mcp`.
- ESLint, Prettier, Husky, coverage thresholds, Playwright, Svelte chrome rewrite, any 0.3 feature.
- Running `/tests` or `/ci`. Editing `blueprint/build-plan.md` or `blueprint/context/project-overview.md`.
- Claiming live F5 or a `.vsix` listing as 7e evidence. Electron `pnpm test` (needs a display).

## Build loop

`workflow.stepReview: feature`: implement every step, then present one review packet.
`workflow.checkpointCommits: disabled`: no checkpoint commits. `/complete` makes the feature commit.

## Build steps

- [x] **1. Branch from 7d and lock the green baseline.** Create `feature/stricter-static-checks` from `feature/electron-suite-home`. Do not branch from `main`. Re-run the 7d-tip gates and write the observed lines into the Build record. Do not enable the 15 rules in this step. The branch must stay green so a later red `vp check` is only the type-aware pass.

  Count locks (live on `f5c6500`, non-root):

  - `pnpm exec vp fmt --check` ends with `Finished in … on 61 files`.
  - `pnpm exec vp check --no-fmt` prints `pass: Found no warnings, lint errors, or type errors in 51 files`.
  - `pnpm exec vp test` prints `Test Files  13 passed (13)` and `Tests  177 passed (177)`. If `process.getuid() === 0`, the 7d lock is `175 passed` + `2 skipped` (`root ignores chmod` in `artboardTools.test.ts` and `canvasView.test.ts`).
  - `pnpm run check` must exit 0. Do not treat its format-pass wording as the 61 lock; that number is the fmt **checked set** (`on 61 files`), not "files rewritten this run".

  Done when: `git branch --show-current` is `feature/stricter-static-checks`; the three count lines above match (or the root-skip variant); the 15 `typescript/*` rules are still `'off'`.

- [x] **2. Turn the 15 type-aware rules on and fix them purely.** In `vite.config.ts` `lint.rules`, delete these `'off'` lines (do not set them to `'warn'`; they are default-on **correctness** rules, and this repo already sets `categories.correctness` to `error`):

  `typescript/await-thenable`, `typescript/no-array-delete`, `typescript/no-base-to-string`, `typescript/no-duplicate-type-constituents`, `typescript/no-floating-promises`, `typescript/no-for-in-array`, `typescript/no-implied-eval`, `typescript/no-meaningless-void-operator`, `typescript/no-misused-spread`, `typescript/no-redundant-type-constituents`, `typescript/no-unsafe-unary-minus`, `typescript/no-useless-default-assignment`, `typescript/require-array-sort-compare`, `typescript/restrict-template-expressions`, `typescript/unbound-method`.

  Keep `curly` / `eqeqeq` / `no-throw-literal` at `warn` and `correctness: error`. Run `pnpm run check`. For each diagnostic, apply:

  1. `no-floating-promises`: `void` if nothing today waits on the promise; `await` only if a caller already sequences on it. Adding `await` on a fire-and-forget host path is a behavior change and is out of spec.
  2. `no-meaningless-void-operator`: rewrite existing `void` on a non-Promise (known: `void config` in `src/mcp/artboardTools.test.ts`) to `_config` or drop the binding. Do not leave it. Do not add new meaningless `void`.
  3. Other type-aware rules: the smallest type-correct edit that does not change runtime. First choices: `String(...)` for `restrict-template-expressions`; `(value) => owner.method(value)` for `unbound-method` when `this` stays the same; drop a redundant constituent; no directive comments.
  4. If a site cannot be fixed without changing timing, control flow, or user-visible copy, **stop** and ask. Do not bury a product change.

  Enable and fix in this same step. `pnpm compile` is `vp check --no-fmt && vp pack`; F5 `preLaunchTask` is `compile`. Leaving the 15 rules on without the fixes makes F5 red.

  7b recorded `no-floating-promises` failing about 25 test-file lines on the pre-Vitest tree. Re-measure on this branch; do not assume that count or those files. Production paths that already use `void` (command handlers in `src/extension.ts`, `showErrorMessage` in `registerCursorDesignMcp.ts`, `postMessage` in `openArtboardPanel.ts`, `fileExists(...).then` in `watchArtboardDisk.ts`, `startCursorDesignMcpServer().catch` in `src/mcp/server.ts`) stay `void`.

  Fill the per-site table in the Build record (file, rule, `void` or `await` or other pure edit, one-line why). Re-run `pnpm run check`, `pnpm exec vp test`, and `pnpm compile` in this same step.

  Done when: the 15 `'off'` lines are gone; `pnpm run check` passes; `pnpm exec vp test` still matches the step 1 unit lock; `pnpm compile` exits 0 and writes `dist/extension.js` and `dist/mcp.js`; the per-site table lists every diagnostic this step fixed; product command handlers and the other named `void` sites are still `void`.

- [x] **3. knip clean, then document.** Add `knip` with `pnpm add -D knip` and record the resolved version. Write **only** `knip.json` at the repo root (not `knip.jsonc`):

  ```json
  {
    "entry": [
      "src/extension.ts",
      "src/mcp/server.ts",
      "src/**/*.test.ts",
      "src/test/**/*.ts",
      "vite.config.ts",
      ".vscode-test.mjs"
    ],
    "project": ["src/**/*.ts", "vite.config.ts", ".vscode-test.mjs"],
    "ignore": ["src/types/vscode.cursor.d.ts"],
    "ignoreDependencies": ["vscode", "@types/vscode"],
    "include": ["files", "dependencies", "unlisted", "binaries", "unresolved"]
  }
  ```

  The first four entry kinds plus `vite.config.ts` are the plan-review contract. `src/**/*.test.ts` and `.vscode-test.mjs` keep the Vitest files and the Electron runner config in the graph (vite-plus is not a knip plugin name; do not rely on auto-detect). `project` is required so knip does not scan `.cursor`, `.agents`, `.claude`, `blueprint`, or `fixtures`. `include` is required so unused exports/types are not part of "clean". `ignore` is the ambient MCP typings (`src/types/vscode.cursor.d.ts` is not imported). `ignoreDependencies` is the "vscode as external / do not flag `@types/vscode`" contract. Do not ignore `@types/mocha`, `@vscode/test-cli`, or `@vscode/test-electron` in this first JSON.

  Add `"knip": "knip"` to `package.json` scripts. Add `knip.json` to `.vscodeignore` next to `tsconfig.test.json`. Run `pnpm knip` only (no `--fix`, no `--fix-type`, no `npx @knip/mcp`).

  If knip reports unused **files** under `src/`, or any `*.test.ts`: the config is wrong. Fix entries/project/ignore. Never delete a file under `src/`. Never delete a contributed command or a `commandIds.ts` export.

  If knip reports unused **deps**: delete only a dep it names that is not in the keep list. Keep `@types/mocha`, `@vscode/test-cli`, `@vscode/test-electron`, and `@types/vscode`. Expected first-run false positives (add to `ignoreDependencies` with the reason, then re-run until clean):

  - `@types/mocha` — used only as `tsconfig.test.json` `compilerOptions.types`; main `tsconfig.json` is `["node"]`.
  - `@vscode/test-electron` — required by the 7d Electron runner; our entry imports `@vscode/test-cli`, not this package.

  If `@vscode/test-cli` is named unused, the `.vscode-test.mjs` entry is missing or wrong. Fix the entry; do not remove the package.

  In `AGENTS.md` Commands, add one bullet: `Knip: pnpm knip` (unused files/deps; not Verify). Do not change the Check, Test, Compile, or Debug bullets. In `blueprint/context/coding-standards.md` Stack (locked), extend the lint line so it mentions knip as a separate unused-code check. Do not add knip to `pnpm compile` or invent a Verify command.

  Re-run `pnpm exec vp fmt --check`, `pnpm exec vp check --no-fmt`, `pnpm exec vp test`, `pnpm knip`, and `pnpm compile`. fmt may now say **on 62 files** if oxfmt picks up `knip.json`; lint must stay **in 51 files**.

  Done when: `pnpm knip` exits 0 with the locked `include`; `knip.json` is vscodeignored; `package.json` has the `knip` script and a direct `knip` devDependency whose version is in the Build record; check still passes; the unit lock still holds; `pnpm compile` still writes both `dist/` files; `@types/mocha`, `@vscode/test-cli`, `@vscode/test-electron`, and `@types/vscode` are still in `package.json` unless a later user decision says otherwise; AGENTS.md and coding-standards name knip.

## Files / areas

- `vite.config.ts` - `lint.rules` only (drop the 15 `'off'` keys).
- `src/**/*.ts` except `src/test/**` - `void` / `await` / unused-binding / other pure type-aware fixes only. `src/test` stays lint-ignored.
- `knip.json` (new; not `knip.jsonc`), `package.json` scripts + `devDependencies`, `pnpm-lock.yaml`.
- `.vscodeignore` - one `knip.json` line.
- `AGENTS.md` Commands (Knip bullet only), `blueprint/context/coding-standards.md` Stack lint line.
- Not in this feature: `src/test/extension.test.ts`, `tsconfig.test.json`, `.vscode-test.mjs` contents, `launch.json`, pack/test/fmt blocks, `.github/`, any `src/` delete or unexport for knip.

## Data / contracts

- **Type-aware catalog (7b, oxlint 1.88.0 via vite-plus 1.3.0):** the 15 `typescript/*` rules listed in step 2. On-state is "key absent" (default-on correctness). `lint.options` stays `{ typeAware: true, typeCheck: true }`. `categories.correctness` stays `error`.
- **Floating-promise policy:** `void` = fire-and-forget kept as today. `await` = caller already waits. Adding `await` on a previously concurrent host path is forbidden. Meaningless `void` on a non-Promise must be rewritten, not kept.
- **knip report:** unused files, unused deps, unlisted, binaries, unresolved only. Unused exports/types are out of the report. `project` is `src/**/*.ts` + `vite.config.ts` + `.vscode-test.mjs`.
- **knip entries / ignores:** exactly the JSON in step 3, plus only the proven Electron-type ignores named there. Commands in `package.json` `contributes` stay; knip must not be "fixed" by deleting a contributed command or `commandIds.ts` export.
- **Unit lock:** same as 7d. `pnpm exec vp test`: 177 passed, 0 failed, 13 files; or 175 passed + 2 skipped when uid is 0.
- **Check baseline (7d tip, type-aware rules still off):** fmt checked set **on 61 files**; lint/type **in 51 files**. After `knip.json` lands, fmt may be **on 62 files**. Do not add a linted file (lint stays 51).
- **F5 proxy:** `launch.json` `preLaunchTask` is `compile` → `pnpm compile` → `vp check --no-fmt && vp pack`. A red type-aware check fails F5. Do not press F5 as 7e evidence.
- **Verify:** not declared. Do not add it. 7h is check + test + pack, no Electron, no requirement that knip sit inside that command.
- **No disk / MCP / webview contract changes.**

## Testing

No new unit tests. This item changes tooling and (at most) `void` / `await` / unused-binding tokens.

- Logic gate: `pnpm exec vp test` must stay on the unit lock above.
- Static gate: `pnpm run check` must pass with the 15 rules on.
- Unused-code gate: `pnpm knip` must exit 0 with the locked `include`.
- Compile / F5 proxy: `pnpm compile` must still write `dist/extension.js` and `dist/mcp.js`. Do not press F5 as 7e evidence. Do not run Electron `pnpm test`.
- No Browser tests command exists; do not add one.

## Notes for the AI

- `blueprint/reference/0.2.1-tooling-review.md` § 7e is background. Every check there is already a step here.
- Stack on 7d. `main` does not have 7c or 7d.
- `vp` is not on `PATH` in a clean shell; use `pnpm run check` and `pnpm exec vp test`.
- Do not enable the 15 rules in a step that does not also fix them. `pnpm compile` runs `vp check --no-fmt`.
- Do not convert existing `void` host calls to `await`. That changes when the panel opens, when export runs, and when disk reload races the watcher.
- knip is a new package. vite-plus 1.3.0 has no knip block. Keep the script separate from `vp check`.
- Default knip `project` is repo-wide JS/TS. Without the locked `project`, knip will name `.cursor/skills/doctor/scripts/run-state.mjs` unused. Do not delete adapter files.
- Default knip reports unused exports. `src/disk/layout.ts` exports several path constants only used inside that file. Do not unexport them. The locked `include` is the fix.
- If knip wants to delete a file under `src/` that has callers or a test, the config is wrong. Fix entries/project/ignore, do not delete product or test code.
- Per-site table is mandatory. An undocumented `await` is a defect even when tests stay green.
- No em dashes in the files this feature writes.

### Build record (fill during build)

- Branch tip this spec started from: `feature/electron-suite-home` `f5c6500`
- Locked `vp fmt --check` (`on N files`): `Finished in 249ms on 61 files using 10 threads.`
- Locked `vp check --no-fmt` (`in N files`): `pass: Found no warnings, lint errors, or type errors in 51 files`
- Locked `pnpm exec vp test` (177 passed, or 175 + 2 skipped if uid 0): `Test Files  13 passed (13)` / `Tests  177 passed (177)` (uid 501)
- Type-aware diagnostics after enabling the 15 rules (count + rule names): 0. `vp lint --print-config` shows all 15 as `deny` and `typeAware: true`. `pnpm run check` stayed green (51 files). Re-measure vs 7b's ~25 pre-Vitest `no-floating-promises` hits: none on this tree.
- Per-site fixes:

  | File | Rule | Edit (`void` / `await` / other) | Why this is pure |
  |---|---|---|---|
  | `src/mcp/artboardTools.test.ts` | `typescript/no-meaningless-void-operator` (known site; oxlint did not fire because `config` is `unknown`) | unused binding `_config`; dropped `void config` | Stub `registerTool` never uses config. No timing or assertion change. Named host `void` sites left as `void`. |

- knip version: `6.42.1` (`knip` `^6.42.1` in `package.json`)
- knip first-run report (paste unused files/deps, or "clean"): unused devDependency `@vscode/test-electron`. No unused files. Config hints only (locked ignore/entry/project entries); not part of `include`.
- Deps removed (none, or the knip-proven list): none
- Extra knip ignores added after a false positive (none, or name + reason): `@vscode/test-electron` — required by the 7d Electron runner; our entry imports `@vscode/test-cli`, not this package. `@types/mocha` was not named unused.
- `vp fmt --check` after `knip.json` (`on 61` or `on 62`): `Finished in 204ms on 62 files using 10 threads.`
- `pnpm compile` wrote `dist/extension.js` and `dist/mcp.js` (yes/no): yes


<!-- blueprint:completion {"schemaVersion":1,"specBytes":18396,"specSha256":"9637475fe66e514c35a0b6a46378446c582bf6a6dde2b4b5a2138ec95b3a1374","branch":"refs/heads/feature/stricter-static-checks","head":"f5c65003e41709a73effb4fd1a4d9928d1fe5432","baseRef":"refs/heads/main","baseCommit":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","sourceTree":"bc54f779235f5114f7c582307a2b286daf74bb57","absentOptional":[]} -->
