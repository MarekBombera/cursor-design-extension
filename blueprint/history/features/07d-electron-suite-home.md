# Feature: Electron suite home

**From build-plan:** feature 7d
**Build attempt:** 1
**Branch:** feature/electron-suite-home
**Status:** verified

## Goal

`@vscode/test-electron` still runs, but it no longer depends on compiling the whole `src/` tree to `out/`. Unit tests already run from TypeScript via `vp test` (7c). This feature gives the Electron sample its own minimal `tsc` emit, takes mocha types off the product tsconfig, and deletes the dead full-tree test scripts and watch glue. F5 and product behavior stay the same. The Electron suite stays out of Verify (7h will add Verify later, without Electron).

Source: Notion [0.2.1 — Tooling](https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc) and `blueprint/reference/0.2.1-tooling-review.md` § 7d. Rule for the whole 0.2.1 release: **no product features and no behavior changes.**

## In scope

- **Locked build home (Notion open decision):** a second tsconfig that emits **only** `src/test/**` to `out/` with `tsc`. Do **not** add a `vp pack` Electron entry (that would land under `dist/` and force a `.vscode-test.mjs` glob change).
- Keep `.vscode-test.mjs` as `defineConfig` from `@vscode/test-cli` with `files: 'out/test/**/*.test.js'`.
- Keep `src/test/extension.test.ts` as the mocha sample (the `suite` / `test` / `assert` sample that imports `vscode`). Do not rewrite it to `vite-plus/test`, do not add product Extension Host cases, do not delete it (an empty `files` glob is the empty state this feature refuses).
- Keep `package.json` `"test": "vscode-test"`, `@vscode/test-cli`, and `@vscode/test-electron`. `test-cli` is **not** dead: `pnpm test` invokes `vscode-test`.
- Keep `@types/mocha` as a devDependency (Electron tsconfig only). Remove `"mocha"` from the **main** `tsconfig.json` `compilerOptions.types`. Leave that array as `["node"]` — do not omit `types` (TypeScript would then auto-include every `@types/*`, including mocha).
- Exclude `src/test` from the main TypeScript program (this is **not** already true: `tsconfig.json` is `include: ["src"]` with no `exclude`). Add `src/test` to `vite.config.ts` `lint.ignorePatterns` so `vp check` does not type-check mocha globals. F5 stays safe: `pnpm compile` / pack / `launch.json` already target `dist/`, and nothing in the product graph imports `src/test`.
- Add `"compile-electron-tests": "tsc -p tsconfig.test.json"`. Remove `"compile-tests"` and `"watch-tests"`.
- Remove `npm-run-all` once `watch` no longer needs `-p`. Set `"watch": "vp pack --watch"`. Keep `"watch:pack": "vp pack --watch"` and the existing `.vscode/tasks.json` `npm: watch:pack` matcher (7a).
- Remove the `.vscode/tasks.json` `watch-tests` task and the `tasks: watch-tests` aggregator.
- `.npmrc` currently contains only `enable-pre-post-scripts = true` (7c deferred this line). Delete the file. Do not add other npmrc keys. `pretest` is already gone (7b).
- Add `tsconfig.test.json` to `.vscodeignore` (the existing `**/tsconfig.json` line does not match that filename). Do not add any other ignore lines.
- Update the existing `AGENTS.md` Test paragraph so it names `pnpm compile-electron-tests` then `pnpm test` for Electron, and says that suite is not the Test command and not Verify. Do not add a new Commands bullet.
- Keep the `typescript` devDependency.

## Out of scope

- 7e type-aware Oxlint rules and knip (including knip `src/test/**` entries).
- 7f fast-check, snapshots, coverage / `@vitest/coverage-v8`.
- 7g MCP client + `InMemoryTransport` contract tests.
- 7h Verify command, README CI blurb, `.github/workflows/verify.yml`. Do not add any of them. When 7h adds Verify it must omit the Electron suite.
- Bundling `src/test/*.test.ts` as a `vp pack` / `dist/` entry.
- Changing `launch.json` (F5 stays `preLaunchTask: "compile"`, `outFiles` stay `dist/**/*.js`).
- Changing `pnpm compile`, `pnpm package`, `vscode:prepublish`, or the `watch:pack` problem matcher.
- Changing the `vite.config.ts` `test` block (`include` / `exclude` / `pool` / `passWithNoTests`) or any of the 13 unit files.
- Product modules, MCP tools, disk SoT, panel HTML, artboard behavior.
- Adding a `mocha` runtime package, `vite-plus/test/globals`, a `vitest` dependency, or a `watch-electron-tests` task.
- Restoring `tsc --outDir out && node --test out/disk|mcp|panel`.
- Running `/tests` or `/ci`. Editing `blueprint/build-plan.md` or `blueprint/context/project-overview.md`.
- Running `pnpm vsix` / claiming a `.vsix` listing as 7d evidence. Adding `noEmit` on the main tsconfig. Changing `fmt.ignorePatterns`.

## Build loop

`workflow.stepReview: feature`: implement every step, then present one review packet.
`workflow.checkpointCommits: disabled`: no checkpoint commits. `/complete` makes the feature commit.

## Build steps

- [x] **1. Electron-only `tsc` home.** Create `feature/electron-suite-home` from `feature/vp-test` (7c tip; `main` is still 7b). Do not branch from `main`.

  Add `tsconfig.test.json` at the repo root:

  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "types": ["node", "mocha"],
      "rootDir": "src",
      "outDir": "out",
      "noEmit": false
    },
    "include": ["src/test/**/*.ts"],
    "exclude": []
  }
  ```

  Do not inherit the parent `include: ["src"]` (that would emit the unit tree again). The child `include` must be only `src/test/**/*.ts`. `"exclude": []` is required: a child that omits `exclude` inherits the parent's `"exclude": ["src/test"]` and the program is empty. Do not set `rootDir` to `src/test` (that emits `out/extension.test.js` and misses the `.vscode-test.mjs` glob).

  In `tsconfig.json`, in this order: add `"exclude": ["src/test"]`; then set `compilerOptions.types` to `["node"]` (drop `mocha`). Keep `include: ["src"]`, `rootDir: "src"`, and the rest of the file. Drop mocha only after the exclude is in place so a mid-step `pnpm run check` does not fail on `suite`/`test`.

  In `vite.config.ts` `lint.ignorePatterns`, add `'src/test'` next to the existing `dist` / `out` / `node_modules` / `.vscode-test` entries **before** dropping mocha. Do not change `fmt`, `pack`, or `test`.

  In `.vscodeignore`, add a `tsconfig.test.json` line next to `**/tsconfig.json`. Do not broaden that glob. Do not run `pnpm vsix`.

  In `package.json` `scripts`, add `"compile-electron-tests": "tsc -p tsconfig.test.json"`. Leave `compile-tests` / `watch-tests` in place until step 2 so this step is only the new home. Do **not** run `compile-tests` after the clean emit below (`tsc -p . --outDir out` would rewrite the full tree into `out/` again).

  Do not edit `src/test/extension.test.ts` or `.vscode-test.mjs`.

  *Done when:* `out/` was deleted, then `pnpm compile-electron-tests` exits 0. `out/test/extension.test.js` exists. `out/` has no `disk`, `mcp`, `panel`, `host`, or `commands` directories (inherited `.js.map` files under `out/test/` are fine). `.vscode-test.mjs` is still `files: 'out/test/**/*.test.js'`. `tsconfig.test.json` has `"exclude": []`. `tsconfig.json` `types` is `["node"]` and contains `"exclude": ["src/test"]`; it has no `mocha`. `.vscodeignore` lists `tsconfig.test.json`. `src/test/extension.test.ts` is byte-unchanged. `package.json` `"test"` is still `vscode-test`. `pnpm run check` passes. `vp test` prints **177** passed, **0** failed, **0** skipped (non-root) or **175** passed, **2** skipped, **0** failed (root). `pnpm compile` writes `dist/extension.js` and `dist/mcp.js`.

  **Stop and ask** — do not add Vitest globals, a mocha Oxlint plugin, or a `vp pack` test entry — if `pnpm run check` still fails only on `src/test/**` after both the tsconfig `exclude` and the lint ignore, or if this `tsc -p tsconfig.test.json` run (after a clean `out/`) recreates `out/disk`, `out/mcp`, or `out/panel`.

- [x] **2. Remove the full-tree emit and dead watch glue.**

  From `package.json` `scripts`, delete `compile-tests` and `watch-tests`. Set `"watch": "vp pack --watch"`. Keep `"watch:pack": "vp pack --watch"`.

  Remove the `npm-run-all` devDependency (`pnpm remove npm-run-all`) so it leaves `package.json` and `pnpm-lock.yaml`.

  In `.vscode/tasks.json`, delete the `npm` `watch-tests` task and the `tasks: watch-tests` aggregator. Leave `compile`, `watch` (dependsOn `npm: watch:pack`), and `npm: watch:pack` (matcher included) as they are.

  Delete `.npmrc` (it is only `enable-pre-post-scripts = true`). If the file has gained other keys since this spec, stop and ask instead of deleting those keys.

  In `AGENTS.md`, keep `Test: vp test` as the Commands line. Extend the paragraph under Commands that already says the unit Test command is `vp test` and `pnpm test` is Electron so it also says: build Electron with `pnpm compile-electron-tests` (writes `out/test/**/*.test.js`), then `pnpm test`; that suite needs a display and is not Verify. Do not add a Verify command.

  In `blueprint/context/coding-standards.md` § Testing, keep `vp test` as the Blueprint gate. Add one sentence: the Electron sample is compiled with `pnpm compile-electron-tests` and run with `pnpm test`; it is not this gate and stays out of Verify.

  *Done when:* `package.json` has no `compile-tests`, `watch-tests`, or `npm-run-all`. `pnpm-lock.yaml` has no `npm-run-all`. `.vscode/tasks.json` has no `watch-tests`. `.npmrc` is gone. `AGENTS.md` still has no Verify command and no new Commands bullet. `@vscode/test-cli`, `@vscode/test-electron`, `@types/mocha`, and `typescript` remain devDependencies. `launch.json` is unchanged. `pnpm run check` passes. `vp test` matches the same locked totals as step 1. `pnpm compile` still writes both `dist/` files. Do **not** run `pnpm test` as a gate (needs a display; not Verify). Do **not** start `pnpm watch`.

## Files / areas

- `tsconfig.json` — drop mocha from `types`; exclude `src/test`
- `tsconfig.test.json` — new; Electron emit only; `exclude: []`
- `package.json` — new compile script; remove `compile-tests` / `watch-tests`; flatten `watch`; drop `npm-run-all`
- `pnpm-lock.yaml` — `npm-run-all` removal only
- `vite.config.ts` — `lint.ignorePatterns` only
- `.vscode/tasks.json` — delete the two `watch-tests` entries
- `.vscodeignore` — add `tsconfig.test.json` only
- `.npmrc` — delete
- `AGENTS.md` — Test paragraph only
- `blueprint/context/coding-standards.md` — Testing paragraph only
- Leave unchanged: `.vscode-test.mjs`, `src/test/extension.test.ts`, `.vscode/launch.json`, pack entries, the Vitest `test` block, product `src/`

## Data / contracts

- **Git parent:** `feature/electron-suite-home` is created from `feature/vp-test` (7c). `main` does not have 7c.
- **Build home:** `tsc -p tsconfig.test.json` → `out/test/**/*.test.js`. Not `vp pack`, not `dist/`. Child `exclude` is `[]`. `rootDir` is `src`.
- **Discovery:** `.vscode-test.mjs` `files` stays `'out/test/**/*.test.js'`.
- **Runner:** `package.json` `"test": "vscode-test"` stays. `@vscode/test-cli` + `@vscode/test-electron` stay.
- **Sample:** `src/test/extension.test.ts` stays mocha (`suite` / `test` / `assert` / `import * as vscode from 'vscode'`). No product assertions required.
- **Main program types:** `compilerOptions.types` is exactly `["node"]`. Mocha globals live only on `tsconfig.test.json`. Main program `exclude` includes `src/test` (new; was not excluded).
- **Watch:** `pnpm watch` and `watch:pack` are both `vp pack --watch`. No `npm-run-all`. No `watch-tests`.
- **npmrc:** no `enable-pre-post-scripts` file after step 2.
- **Verify:** none. Do not add `scripts.verify` or a workflow. Electron is excluded from any future Verify (7h).
- **.vscodeignore:** already excludes `out/**` and `.vscode-test/**`. Add `tsconfig.test.json` so that new file does not ship. Do not change anything else.
- **Stale `out/`:** gitignored leftovers from `compile-tests` do not count as this feature's emit. Prove the home on a cleaned `out/`.
- **Unit lock (7c, unchanged):** `vp test` 177/0/0 non-root, or 175 + 2 skipped root.

## Testing

The Blueprint test gate is `vp test` (declared `Test` in `AGENTS.md`). Use it after each step. `pnpm test` (`vscode-test`) is not that gate and is not a step done-when.

No Browser tests command. No Verify command — none was run at spec time (`package.json` has no `verify` script; `AGENTS.md` Commands has no Verify line; no `.github/workflows/`).

This feature adds no product logic and no new cases. Proof is the commands in each Done when. Do not claim a live Extension Host, live `pnpm test`, `.vsix`, or MCP handshake as 7d evidence. `pnpm compile` writing both `dist/` files remains the F5 proxy (7a).

## Notes for the AI

- Read `blueprint/reference/0.2.1-tooling-review.md` § 7d first. **No product behavior changes.**
- Planned archive path (frozen, attempt 1): `blueprint/history/features/07d-electron-suite-home.md`. Branch (frozen): `feature/electron-suite-home`. Do not bump the attempt or rename the branch. Create that branch from `feature/vp-test`.
- The Notion brief listed two homes. This spec locks **minimal `tsc`**, not a pack entry. Do not reopen that unless `tsc -p tsconfig.test.json` cannot emit `out/test/extension.test.js` without compiling the unit tree — then stop and ask.
- Do not delete `@vscode/test-cli` because the plan line says "now-dead". It is live.
- `compile-tests` may already fail after the 7c `vite-plus/test` rewrite. Replacing that full-tree emit is the point; do not "fix" it by compiling unit tests to `out/` again.
- 7c is committed on `feature/vp-test` (`3721b3e`) and is **not** on `main`. Do not revert 7c files (`vite.config.ts` `test` block, the 13 unit import rewrites, AGENTS Test command).
- Do not run `vp migrate`. Do not add a Verify command to finish the sentence "stays out of Verify".
- Ponytail: config and script deletion only. Do not restyle the sample or invent an Electron integration suite.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":13805,"specSha256":"40df433dabdcc5e3e6301bf7ef12db7c75b8861552f06f0af080f960cb1e07f7","branch":"refs/heads/feature/electron-suite-home","head":"3721b3e3341d48f9c62733b6fa9e766d0183bec1","baseRef":"refs/heads/main","baseCommit":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","sourceTree":"d02ea3ed8f1bf9236884dc3b20bebc83382a4163","absentOptional":[]} -->
