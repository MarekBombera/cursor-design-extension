# Feature: Pack spike

**From build-plan:** feature 7a
**Build attempt:** 1
**Branch:** feature/pack-spike
**Status:** verified (F5 passed 2026-10-20)

## Goal

Prove whether Vite+ `vp pack` (tsdown) can replace `esbuild.js` for both extension bundles with no
product behavior change. On pass, `vp pack` builds `dist/extension.js` and `dist/mcp.js`, and esbuild
is removed. On fail, esbuild stays for the bundle only, and the reason is recorded. Either way, the
repo ends with `vite-plus` installed, a root `vite.config.ts`, and a tsconfig that tolerates it, so
7b can build on top.

Time box: about two hours of spike work (Notion 0.2.1 phase 1). Past that without a pass, take the
fail path.

Source: Notion [0.2.1 — Tooling](https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc) phase 1
and `blueprint/reference/0.2.1-tooling-review.md` § 7a (read it before step 1).

## In scope

- Add `vite-plus` as an exact-pinned devDependency; scripts call the local `vp` binary.
- Root `vite.config.ts` with only a `pack` block (no `lint`, `fmt`, `test`; those are 7b/7c). On fail
  it is an empty `defineConfig({})`, kept on purpose as the seed 7b adds `lint` / `fmt` to.
- Parity with `esbuild.js` (see Data / contracts).
- Re-point `compile`, `package` (and so `vscode:prepublish`), `watch:esbuild` and the `.vscode/tasks.json`
  watch task + problem matcher to `vp pack`.
- `tsconfig.json` fix so a root-level `vite.config.ts` does not break `tsc`.
- Pass path: delete `esbuild.js`, the `esbuild` devDependency, `allowBuilds: esbuild` (only if nothing
  else still needs it), the `connor4312.esbuild-problem-matchers` recommendation if the new matcher
  does not use it, and update live docs that name esbuild as the bundler.
- Spike result recorded in this spec (Notes) and, with user approval, on the Notion 0.2.1 page.

## Out of scope

- `vp check`, oxlint/oxfmt migration, removing `check-types` / `lint` / `watch:tsc` / `pretest` (7b).
- Vitest, the `out/` test build, `compile-tests` / `watch-tests` / `.vscode-test.mjs` (7c / 7d).
- Type-aware lint, knip (7e); new tests (7f / 7g); Verify command, CI, AGENTS.md Commands (7h).
- Any product source change under `src/`. If parity seems to need one, stop and ask.
- Historical archives under `blueprint/history/` (never rewritten).

## Build loop

`workflow.stepReview: feature`: implement all steps, then present one review packet.
`workflow.checkpointCommits: disabled`: no checkpoint commits; `/complete` makes the feature commit.

## Build steps

- [x] **1. Baseline + install.** On `feature/pack-spike`, record the current esbuild output as the
  parity baseline:
  - dev sizes (`node esbuild.js`): `dist/extension.js`, `dist/mcp.js`, and their `.map` files
  - production sizes (`node esbuild.js --production`)
  - the first lines of each file (CJS wrapper)
  - the MCP handshake result (step 3's command) against the esbuild build

  Then:
  - Add `vite-plus` at an exact version and record it.
  - Note whether pnpm reports ignored build scripts, and whether `vite-plus` needs `vite` / `vitest`
    peers or overrides. Do not touch the existing `overrides` block unless install fails without it.
  - Add `"include": ["src"]` to `tsconfig.json`.

  Done when `pnpm exec vp --version` prints the pinned version, `pnpm check-types` and `pnpm lint` stay clean,
  and the baseline numbers are recorded in Notes.
- [x] **2. `vite.config.ts` pack block.** Create the config with a `pack` block that meets every
  bundle contract below. Prefer a two-config array (one per entry) so each entry keeps its own
  options and no shared chunk is emitted. If the `pack` block rejects an array, record that and use
  another supported shape **only if it still meets every row of the bundle table** (vscode
  external on extension only, define on mcp only, no shared chunk). If no shape meets the table, take
  the fail path.
  - Set `clean: false` so one entry's build never deletes the other's output. Before **each** variant
    (dev, production) run `rm -rf dist` so a production run never inherits dev `.map` files.
  - Set `dts: false` and disable any package `exports` generation.
  - Production switch: prefer `vp pack` CLI flags (minify on, sourcemap off). If those are not
    supported, read one flag from `process.argv` in the config. Record which one.

  Done when, after `rm -rf dist`, `vp pack` (dev) and the production variant each leave exactly
  `dist/extension.js` and `dist/mcp.js` (+ `.map` in dev only), both start with a CJS wrapper (no
  top-level `import`/`export`), and no dev `.map` contains a `sourcesContent` key. The exact production
  argv is pinned in Notes and reused verbatim by `package`.
- [x] **3. Prove the bundles.**
  - **No stray imports:** in each output, every `require(...)` specifier must be a Node built-in
    (with or without `node:`) or, in `extension.js` only, `vscode`. Fail on any other specifier
    (relative paths included), any `node_modules` string inside a `require`, and any `import(`.
  - **Version injected:** `mcp.js` contains the literal `package.json` version, not
    `process.env.CURSOR_DESIGN_VERSION`.
  - **MCP handshake (isolated):** copy only `dist/mcp.js` into a fresh scratch dir outside the repo
    (no parent `node_modules`), then run it there. MCP stdio framing is newline-delimited JSON (one
    message per line, no `Content-Length` headers). Write this single line plus `\n` to stdin, then
    close stdin:
    `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}`
    Kill the process after 5 seconds if it has not exited. Capture stdout and stderr separately.
    - Pass: stdout's lines are all valid JSON, one of them has `id: 1` and `result.serverInfo.name`
      equal to `CURSOR_DESIGN_MCP_SERVER_NAME` (`src/mcp/mcpIdentity.ts`), and its `version` equals
      the `package.json` version.
    - Any non-JSON stdout line is a fail: Cursor needs clean stdout.
    - If the server answers with a different `protocolVersion`, record it; that's still a pass.
    - Record stderr as-is.
    - Use the same command for the step 1 esbuild baseline. A small node script under the scratchpad
      is fine; do not add it to the repo.
  - **Sizes:** compare against the step 1 baseline and record them. Growth over 25% is a
    pass-with-reason (one line, for example "zod locales no longer tree-shaken"), not a fail.

  Done when the import, version and handshake checks are recorded as pass in Notes for both dev and
  production builds, and the sizes are recorded.
- [x] **4. Re-point scripts and tasks.** In `package.json`:
  - `compile` = `pnpm run check-types && pnpm run lint && vp pack`. F5's `preLaunchTask` stays
    `compile`, so F5 gating is unchanged.
  - `package` = the same gates + the exact production argv pinned in step 2. `vscode:prepublish` keeps
    calling `package`.
  - `watch:esbuild` is replaced by `watch:pack` = `vp pack --watch`, and `watch` still runs `watch:*`.

  In `.vscode/tasks.json` (exact fields):
  - In the background npm task, set `"script": "watch:pack"` and `"label": "npm: watch:pack"`.
  - In the composite `watch` task, set `dependsOn` to `["npm: watch:tsc", "npm: watch:pack"]`.
    `npm: watch:tsc` stays as it is; 7b removes it.
  - Set the problem matcher `owner`, `pattern.regexp`, `background.beginsPattern` and
    `background.endsPattern` against the real `vp pack --watch` output, captured once and pasted into
    Notes.
  - No other `tasks.json` entry changes; `watch-tests` / `tasks: watch-tests` are 7c/7d.
  - Afterwards, `rg -n watch:esbuild` over the repo (excluding history and reference) finds nothing. If the output has no stable markers, wrap the watch
    in a tiny `scripts/` node script that prints the old `[watch] build started` /
    `[watch] build finished` lines. Record which approach.

  Done when:
  - `pnpm compile` exits 0 and writes both files.
  - `pnpm watch` rebuilds `dist/mcp.js` after a whitespace touch of `src/mcp/server.ts`, and rebuilds
    `dist/extension.js` after one of `src/extension.ts` (check mtimes, then revert both touches).
  - The VS Code `watch` task reaches "ready" (it does not spin forever).
- [x] **5. F5 + `.vsix` smoke.**
  - F5 (Run Extension) opens `fixtures/dev-workspace` with no activation error. Open Artboard shows
    the stage, and the Cursor Design MCP server appears in Cursor's MCP list and lists its 8 tools.
    One `list_artboards` call from Cursor Agent succeeds.
  - `pnpm vsix`, then `unzip -l` on the new `.vsix`: `extension/dist/extension.js` and
    `extension/dist/mcp.js` are present, with no `node_modules/`, no `.map`, no `vite.config.ts`, and
    no `scripts/`. If step 4 added a `scripts/` wrapper, add `scripts/**` to `.vscodeignore`.
    `esbuild.js` absence is checked by step 6's rebuild, after its deletion.
  - Update `.vscodeignore` only if the listing shows a new file leaking. Delete the built `.vsix`
    afterwards; the tracked-ignored `cursor-design-0.1.0.vsix` stays untouched.

  Done when both smokes are recorded in Notes. F5 evidence is manual: say so, don't claim it unrun.
- [x] **6. Decide and clean up.** **Pass** means steps 2–5 all passed. Then:
  - Delete `esbuild.js` and the `esbuild` devDependency.
  - Remove `allowBuilds: esbuild` from `pnpm-workspace.yaml` only if `pnpm why esbuild` shows nothing
    needs its build script; otherwise keep it and say why.
  - Update the live esbuild references to name `vp pack` / tsdown (`deps.neverBundle` instead of
    `external`): `blueprint/context/coding-standards.md` § Stack and the zod/mini tree-shaking note,
    `.cursor/rules/02-mcp-webview.mdc`, `.cursor/rules/07-vscode-extension.mdc`,
    `.cursor/skills/cursor-design-build/SKILL.md` (the two-builds rule), and `.vscode/extensions.json`
    if the matcher extension is no longer used.
  - Do not edit `notes.md`, history archives, the plans, or the generated `project-overview.md` (it
    already says "esbuild through 0.2" and is regenerated from the plans).
  - Rebuild and re-list the `.vsix` as in step 5, and confirm `esbuild.js` is absent.

  **Fail** means the time box ran out or a contract can't be met. Then:
  - Restore `esbuild.js`, the scripts and the tasks to their `main` state.
  - Keep `vite-plus`, the tsconfig `include`, and a `vite.config.ts` with an empty `defineConfig({})`
    plus a one-line comment naming the failed contract.
  - Record the failure reason in Notes.

  Either way, ask the user before updating the Notion 0.2.1 page with the result.

  Done when, **on pass**, `rg -n -i esbuild --glob '!node_modules' --glob '!.pnpm-store'` hits only
  this allowlist: `blueprint/history/**`, `blueprint/reference/**`, `blueprint/context/current-feature*.md`,
  `blueprint/context/project-overview.md`, `blueprint/project-plan.md`, `blueprint/build-plan.md`,
  `notes.md`, `pnpm-lock.yaml` (only if a transitive dep still pulls it), `pnpm-workspace.yaml` (only
  if `allowBuilds` was kept with a recorded reason). Any other hit is a fail.

  Done when, **on fail**, `esbuild.js`, the `package.json` scripts and `.vscode/tasks.json` match
  `main` byte-for-byte (`git diff main -- esbuild.js .vscode/tasks.json` is empty, and the scripts
  block is unchanged), and Notes name the failed contract.

  In both cases, `pnpm compile`, `pnpm check-types`, `pnpm lint` and the unit tests (see Testing)
  pass.

- [x] **7. Repair F-13 (`.vscodeignore` leak).** Add `.pnpm-store/**`, `.cursor-design/**`,
  `notes.md` and `*.vsix` to `.vscodeignore`.

  Done when a rebuilt `.vsix` lists only `extension.vsixmanifest`, `[Content_Types].xml`, and
  `extension/{package.json,readme.md,LICENSE.txt,changelog.md,media/artboard-panel.png,dist/extension.js,dist/mcp.js}`.

## Files / areas

- `package.json` - devDependency `vite-plus`; `compile`, `package`, `watch:pack`; pass: drop `esbuild`
- `vite.config.ts` (new, root) - `pack` block only
- `tsconfig.json` - add `include: ["src"]`
- `.vscode/tasks.json` - watch task label + matcher
- `scripts/` (new, only if step 4 needs the watch wrapper)
- `esbuild.js` - deleted on pass
- `pnpm-workspace.yaml`, `pnpm-lock.yaml` - deps / `allowBuilds`
- `.vscodeignore` - only if the `.vsix` listing shows a leak, or `scripts/**` when a watch wrapper exists
- Pass docs: `blueprint/context/coding-standards.md`, `.cursor/rules/02-mcp-webview.mdc`,
  `.cursor/rules/07-vscode-extension.mdc`, `.cursor/skills/cursor-design-build/SKILL.md`,
  `.vscode/extensions.json`
- Read-only references: `src/extension.ts`, `src/mcp/server.ts`, `src/mcp/registerCursorDesignMcp.ts`
  (loads `dist/mcp.js` via `context.extensionUri`), `.vscode/launch.json`

## Data / contracts

Bundle contract (must equal today's `esbuild.js`):

| | `dist/extension.js` | `dist/mcp.js` |
|---|---|---|
| Entry | `src/extension.ts` | `src/mcp/server.ts` |
| Format / platform | CJS, Node | CJS, Node |
| Exact filename | `.js` (`fixedExtension: false`; never `.cjs`) | same |
| External | `vscode` only (`deps.neverBundle: ['vscode']`) | none |
| Bundled deps | everything else | everything, incl. `@modelcontextprotocol/server` (+ `/stdio`) and `zod` (`deps.alwaysBundle`; tsdown skips `dependencies` by default) |
| Define | none | `process.env.CURSOR_DESIGN_VERSION` = JSON string of `package.json` `version` |
| Dev | sourcemap, no `sourcesContent`, not minified | same |
| Production | minified, no sourcemap | same |

- `dist/` holds exactly these two JS files (+ maps in dev). No chunk files, no `.d.ts`, no extra
  entries. `registerCursorDesignMcp.ts` resolves `dist/mcp.js` by that exact path.
- The `.vsix` is built with `--no-dependencies`, so any dependency left external breaks the shipped
  MCP server at runtime even though F5 (with `node_modules` present) works. Step 3's `require` grep
  is the guard.
- tsdown 0.23 uses `deps.neverBundle` / `deps.alwaysBundle`. The deprecated `external` / `noExternal`
  must not be used, and the two forms can't be mixed.
- No persisted data, MCP tool, disk layout or webview contract changes.

## Testing

- No declared Test command yet (7c adds it). Use the existing runner:
  `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`.
  Baseline on `main` (`e5a5275`): **177 pass, 0 fail**. It must stay 177 / 0 after the
  tsconfig `include` change. `out/` is unaffected because `rootDir` stays `src`.
- `pnpm check-types` and `pnpm lint` are clean at baseline and must stay clean.
- Bundle evidence is the step 3 checks (scripted, repeatable). F5 and Cursor MCP evidence is manual
  (step 5) and must be labeled manual.
- No new unit tests: this item changes no `src/` logic.

## Notes for the AI

- Read `blueprint/reference/0.2.1-tooling-review.md` § 7a first. The traps it lists are the
  acceptance criteria above.
- The Vite+ docs confirm that packaging goes in the `pack` block of `vite.config.ts`, imported via
  `defineConfig` from `'vite-plus'`. Don't add a `tsdown.config.ts`. The docs don't confirm array
  configs, `fixedExtension`, `define` or the CLI minify flags; prove each one empirically.
- tsdown may warn that CJS is legacy. That's expected; VS Code needs CJS.
- Watch out for tsdown's `clean` default: two builds into one `dist/` can wipe each other.
- Do not make F5 depend on formatting. `compile` keeps today's `check-types && lint` gates, and only
  the bundler changes.
- Keep the zod `import * as z from 'zod/mini'` pattern. If `mcp.js` grows a lot, report it; don't
  change `src/`.
- The plan, review notes and Notion say 178 unit tests. The real count is **177**; the 178 included
  the sample mocha test in `src/test/`. Mention this in the review packet so 7c uses 177.

### Spike record (fill during build)

- vite-plus version: `1.3.0` (exact). `vp --version`: vite 8.3.4, rolldown 1.2.14, tsdown 0.23.1,
  vitest 5.0.5, oxlint 1.88.0, oxfmt 0.73.0.
- pnpm build-script / peer notes: no ignored-build report. `pnpm peers check`: unmet `vite` peer for
  `vitest@5.0.5` / `@vitest/mocker@5.0.5` (wants `^6 || ^7 || ^8`, gets vite-plus-core 1.3.0). Harmless
  for 7a; 7c owns Vitest. `overrides` untouched. Lockfile: +76 packages, direct deps unchanged.
- Baseline sizes (bytes, esbuild): dev ext 157525 (+map 92018) / mcp 863945 (+map 534295);
  prod ext 92393 / mcp 442841. CJS wrapper `"use strict"; var __create = ...`.
- vp pack sizes (bytes): dev ext 134950 (-14%, map 67640) / mcp 913250 (+6%, map 494680);
  prod ext 83834 (-9%) / mcp 433403 (-2%). None over 25%. Wrapper:
  `Object.defineProperty(exports, Symbol.toStringTag, ...)` + rolldown runtime; no top-level import/export.
- Config shape used: two-config array in `pack` (typed `PackUserConfig | PackUserConfig[]`). Works;
  no shared chunk. `deps.alwaysBundle` must be **regexes** (`/^zod(\/|$)/` etc.): plain strings
  match the bare name only and left `zod/mini`, `zod/v4`, `@modelcontextprotocol/server/stdio` external
  (caught by the isolated handshake: `Cannot find module 'zod/v4'`). `sourcesContent` off via
  `outputOptions.sourcemapExcludeSources: true` (tsdown has no direct option).
- Production switch: CLI flags `vp pack --minify --no-sourcemap` (override both array entries).
  Pinned verbatim in `package`. Like `esbuild.js --production`, it does not clear `dist/`, so stale dev
  maps can remain locally; `.vscodeignore` `**/*.map` keeps them out of the `.vsix`.
- Watch output markers / wrapper: no wrapper. Begin `Build start` | `<file> changed, rebuilding...`;
  end `Rebuilt in <n>ms.` | `error: Build failed with N error:`; errors print `[PARSE_ERROR] message`
  (plus ANSI). pnpm's `[ELIFECYCLE]` excluded from the error regexp. Matcher regexes checked against
  the captured log with ANSI stripped. `pnpm watch`: mcp touch rebuilt only `dist/mcp.js`, extension
  touch rebuilt only `dist/extension.js` (mtimes), both touches reverted. VS Code task "ready": manual,
  not run by the agent.
- Import check note: the spec's literal `require(...)` grep fails the **esbuild baseline** too: ajv
  emits code strings like `t.code='require("ajv/dist/runtime/uri").default'`. The check counts only
  `require(` not directly preceded by a quote/backtick, and lists codegen strings separately. Dev builds
  keep JSDoc `@param {import('...')}` comments, so `import(` on comment lines is ignored; prod (minified,
  no comments) has zero `import(`. Real requires: ext = node:crypto, node:fs/promises, node:path, vscode;
  mcp = node:crypto, node:fs/promises, node:path, node:process. Pass dev + prod.
- Version injected: no `process.env.CURSOR_DESIGN_VERSION` in either build; `"0.1.0"` (dev) /
  `` `0.1.0` `` (prod) literal present. Pass.
- Handshake (esbuild baseline / vp pack): isolated temp dir, newline JSON, stdin closed. esbuild dev +
  prod: pass. vp pack dev + prod: pass. All: 1 stdout line, `serverInfo {name: cursor-design, version:
  0.1.0}`, `protocolVersion 2025-06-18`, stderr empty, exit 0.
- F5 smoke (manual): **pass, reported by the user 2026-10-20** ("running well"). Not observed by the agent.
- `.vsix` listing: built with `--out` to the scratchpad so the ignored `cursor-design-0.1.0.vsix` stays
  byte-identical (sha1 unchanged). Contains `extension/dist/extension.js` + `extension/dist/mcp.js`; no
  `node_modules/`, `.map`, `vite.config.ts`, `scripts/`, `esbuild.js` (re-checked after deletion).
  Not from 7a: it also ships `extension/.pnpm-store/v11/index.db`, `extension/.cursor-design/**` and
  `extension/notes.md`. These come from local untracked dirs and `.vscodeignore` gaps already on `main`,
  so they were left for a separate fix.
- Result: **pass** (automated steps 2-4 and the `.vsix` half of 5). Esbuild removed. `allowBuilds:
  esbuild` kept: `pnpm why esbuild` shows `@voidzero-dev/vite-plus-core@1.3.0` still installs it, so its
  install script still runs. `.vscodeignore` dropped its dead `esbuild.js` line; `.vscode/extensions.json`
  dropped `connor4312.esbuild-problem-matchers` (new matcher is inline). F5 smoke passed (user), so pass is final.
- F-13 repair: `.vscodeignore` now excludes `.pnpm-store/**`, `.cursor-design/**`, `notes.md`, `*.vsix`.
  Rebuilt `.vsix` (scratchpad `--out`) lists 9 entries, the same set as the 09-13 `cursor-design-0.1.0.vsix`:
  manifest, content types, package.json, readme, LICENSE, changelog, media png, both dist files.
- Allowlist note: `rg -i esbuild` also hits `blueprint/context/feature-review.md` (the spec review
  report for this feature), which isn't on the step 6 allowlist. It's a workflow file, not live docs; left unedited.
- Test count: 177 / 0 at baseline and at the end (not 178; see above).


<!-- blueprint:completion {"schemaVersion":1,"specBytes":20644,"specSha256":"374484ebd3b0cd722dc726f77cd41e3d696d410e4423a44fc7b7219b2d9b4539","branch":"refs/heads/feature/pack-spike","head":"e5a52752a65122110dabf039fcaf0a0524a51ed7","baseRef":"refs/heads/main","baseCommit":"e5a52752a65122110dabf039fcaf0a0524a51ed7","sourceTree":"3bf355d40251ca79e906aab49c3c2d9ec89270a2","absentOptional":[]} -->


## Findings

### 7a/F-12 [P3] closed - README export trial still names the 0.1 handoff tree

**File:** README.md:76
**Found:** 2026-10-18 by /audit independent current (scope: current; lens: quality)
**Why it matters:** The Commands list now says Export Handoff writes every frame, but the trial still tells the reader to confirm `.cursor-design/handoff/<exportId>/{index.html,IMPLEMENT.md,tokens.json}`. Canvas export no longer writes a root `index.html`; it writes `canvas.html` plus `<group>/<id>/index.html`. Someone following the trial looks for a file that is not there.
**Suggested fix:** Point step 3 at `IMPLEMENT.md`, `canvas.html`, `tokens.json`, and one `<group>/<id>/index.html`, plus `lastExport.frames`.
**Resolution:** Closed 2026-10-19 by /audit (scope: current; lens: quality). README.md:76 now names `IMPLEMENT.md`, `canvas.html`, `tokens.json`, one `<group-folder>/<frame-id>/index.html` per frame, and `lastExport.frames`. Limits no longer claim one-active-artboard or a single root `index.html`. The 0.2 trial note is present. No new defect in the reviewed README.

### 7a/F-13 [P2] closed - vsce still packages gitignored local store, design folder, and notes

**File:** .vscodeignore:26
**Found:** 2026-10-19 by /audit (scope: current; lens: security)
**Why it matters:** `pnpm vsix` uses `--no-dependencies` and `.vscodeignore`, not `.gitignore`. `.gitignore` already excludes `.cursor-design/` and `.pnpm-store/`, but `.vscodeignore` does not. This feature's own `.vsix` listing confirmed those paths plus `notes.md` shipped under `extension/`. The 7a diff only dropped the dead `esbuild.js` ignore line; the leak was already on `main`. A shared `.vsix` can include local artboard HTML, a pnpm store index, and private notes. Not a 7a pack-contract miss (`node_modules/`, maps, `vite.config.ts`, and `scripts/` were absent).
**Suggested fix:** Add `.pnpm-store/**`, `.cursor-design/**`, and `notes.md` to `.vscodeignore`. Consider `*.vsix` as well. Rebuild with `pnpm vsix` and re-list. No `src/` change.
**Resolution:** Closed 2026-10-20 by /audit (scope: current; lens: security). `.vscodeignore` now has `.pnpm-store/**`, `.cursor-design/**`, `notes.md`, and `*.vsix`. Those paths exist locally and are covered. `vite.config.ts` stays out via `**/*.ts`. The repair adds no new ignore hole in the reviewed file. This pass did not rebuild the `.vsix` (`pnpm vsix` uses network `dlx`).
