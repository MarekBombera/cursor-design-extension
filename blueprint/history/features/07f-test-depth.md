# Feature: Test depth

**From build-plan:** feature 7f
**Build attempt:** 1
**Branch:** feature/test-depth
**Status:** verified

## Goal

Add fast-check properties for stage geometry, the handoff stale check, and zod manifest/meta byte-equal round-trips; add scrubbed snapshots of generated `IMPLEMENT.md` and `canvas.html`; add a coverage script via `@vitest/coverage-v8` with no thresholds. No product features. No behavior changes.

Source: Notion [0.2.1 — Tooling](https://app.notion.com/p/3fd500344e088166afe5e9295bf601fc) (fetched 2026-10-21; page last edited 2026-10-19) and `blueprint/reference/0.2.1-tooling-review.md` § 7f. Rule for the whole 0.2.1 release: **no product features and no behavior changes.**

## In scope

- Create `feature/test-depth` from `feature/stricter-static-checks` (7e tip `380143f`). Do **not** branch from `main` (`main` is still 7b, `43cce2c`). Plan review says 7f is independent of 7e/7g and can follow 7c; 7e is already `[x]` and committed on this line, so stack rather than rewind.
- Add `fast-check` as a direct `devDependency`. Record the resolved version. Import it only from unit tests. Do not add a direct `vitest` dependency. Keep `import { test } from 'vite-plus/test'` and `node:assert/strict` for assertions except where a snapshot API from `vite-plus/test` is required.
- Property tests that **characterise current** helpers. Do not edit `STAGE_GEOMETRY_SOURCE`, `compareCanvasHandoff`, `buildCanvasImplementMarkdown`, `buildCanvasPreviewHtml`, or `parse.ts` / serialize to make a property pass. If a property disagrees with an existing example test, shrink the property.
- Stage geometry properties, evaluated through the same `node:vm` `runInNewContext(STAGE_GEOMETRY_SOURCE)` path as `src/panel/stageGeometry.test.ts`:
  - **Zoom-at-cursor fixed point:** `zoomStageTo` / `zoomStageAt` keep the stage point under the cursor on the same screen pixel (existing 1e-9 tolerance). Generate `view.zoom` already inside `[MIN_STAGE_ZOOM, MAX_STAGE_ZOOM]` so the zero-zoom path stays an example-only case.
  - **Clamps:** result `zoom` is always in `[MIN_STAGE_ZOOM, MAX_STAGE_ZOOM]`. `clampStageView` with positive bounds and viewport still keeps the existing keep-visible rule (48px, or `min(scaledSize, viewport)` when smaller) already locked by example tests.
  - **Fit-all contains every box:** for non-empty frames with positive sizes and viewport sides greater than `2 * 48`, `fitStageView` on `layoutCanvasChrome(...).bounds` maps every frame, label, and heading box inside the viewport (same 1e-9 tolerance as existing `assertClose`). Skip when `bounds` is null. Do not export new constants from the source string.
- Stale-check properties on `compareCanvasHandoff` only (not the MCP wrapper). `lastExport === undefined` always wins:
  - `lastExport === undefined` → `{ exported: false, stale: false }` for any current frame list (including empty, including any `hash === undefined`).
  - When `lastExport` is defined: same id set and same hashes (any order; hash case folded by `normalizeHash`) → `stale: false`.
  - When `lastExport` is defined: one hash changed, one id added, one id removed, or any `hash === undefined` → `stale: true`.
  - Legacy `lastExport` without `frames` behaves as a one-frame set of `artboardId` / `artboardHash`.
  - Current-frame lists in these properties use unique `artboardId`s (today's helper does not treat duplicates as a set difference).
- Zod properties on canonical bytes, using the existing names: `serializeManifest(parseManifest(JSON.parse(serializeManifest(valid)))) === serializeManifest(valid)` and the `serializeMeta` / `parseMeta` twin. Generators must already satisfy today's schemas in `parse.ts`:
  - Manifest: `version` `1`; `activeArtboardId` matching `/^[a-zA-Z0-9._-]{1,64}$/`; `workspaceFolder` minLength 1; `updatedAt` minLength 1; optional `lastExport` with `exportId` minLength 1, `artboardId` the same pattern, `sha256:` + 64 hex, `Date.parse`-able `exportedAt`, optional `frames` non-empty with unique ids.
  - Meta: `id` the same artboard-id pattern; `title` any string; integer `generation >= 1` (`z.int()`, not a float); `sha256:` + 64 hex; `viewport` already present; `updatedAt` minLength 1.
  - Object keys in schema order; no unknown keys (stripped on parse, so extras break byte-equal).
  Do not property-test corrupt input; the existing authored-error tests stay.
- Scrubbed snapshots of **builder output** (not a temp export tree): `buildCanvasImplementMarkdown` and `buildCanvasPreviewHtml`. Reuse the existing four-frame IMPLEMENT.md fixture in `handoff.test.ts` (ids `c` / `a` / `d` / `b`). Use one small fixed multi-frame set for `canvas.html` (may reuse a `handoffCanvasHtml.test.ts` fixture). Keep every current field assert.
- One scrub helper used by both snapshot tests, in the test files (duplicate the few lines or share a `*.test.ts` helper). Replace export ids, ISO `exportedAt` / timestamps, and absolute temp-path prefixes (`os.tmpdir()`, `/var/folders/`, `/tmp/`) with the tokens `<exportId>`, `<exportedAt>`, `<tmp>`. Do not scrub hashes or frame ids.
- Add `@vitest/coverage-v8` as a direct `devDependency`. Record the resolved version. Add a `package.json` coverage script only. **No coverage thresholds** in `vite.config.ts` or the script. Do not set `test.coverage.enabled: true`. Do not fold coverage into `vp check`, `pnpm compile`, `pnpm package`, or a Verify command (7h owns Verify).
- Ignore generated coverage output: add `coverage/` to `.gitignore` and `.vscodeignore`. Add `coverage` to `vite.config.ts` `lint.ignorePatterns` and `**/coverage/**` to `fmt.ignorePatterns` (same style as `dist` / `out`) so `pnpm run check` after `pnpm coverage` cannot lint or rewrite the report.
- Document the coverage script under Commands in `AGENTS.md` and add one Testing line in `blueprint/context/coding-standards.md`. Do not add a Verify command. Do not edit the user-owned plan's "178" wording or `project-overview.md`.
- `pnpm knip` stays exit 0 with the locked 7e `include`. If `@vitest/coverage-v8` is unnamed after it is referenced from `vite.config.ts` `test.coverage`, or unnamed when only the `coverage` script references it, stop and ask before adding ignores. `fast-check` must be imported from a unit test so knip sees it.

## Out of scope

- 7g `@modelcontextprotocol/client` / `InMemoryTransport` contract tests, `listTools` set asserts, or any MCP handler edit.
- 7h Verify command, README CI blurb, `.github/workflows/verify.yml`, F5 or `.vsix` smoke.
- Coverage thresholds, coverage in CI, HTML report as a done-when.
- Product modules, MCP tools, disk SoT writers, panel HTML, artboard behavior, chrome badges.
- Changing `compareCanvasHandoff` so never-exported becomes `stale: true` (`handoff_status` already maps that case; the helper stays `{ exported: false, stale: false }`).
- Changing `IMPLEMENT.md` / `canvas.html` copy, key order, or escape rules to chase a snapshot.
- Importing from `vitest` or adding `vitest` as a direct dependency. Running `/tests`.
- Electron `pnpm test`, `src/test/**`, `tsconfig.test.json`, `.vscode-test.mjs`.
- Changing `launch.json`, watch matcher, `pnpm compile` / `package` / `vscode:prepublish`, or making F5 wait on coverage.
- Playwright, Svelte chrome rewrite, Husky, Stryker, ESLint/Prettier, any 0.3 feature.
- Editing `blueprint/build-plan.md` or `blueprint/context/project-overview.md`.

## Build loop

`workflow.stepReview: feature`: implement every step, then present one review packet.
`workflow.checkpointCommits: disabled`: no checkpoint commits. `/complete` makes the feature commit.

## Build steps

- [x] **1. Branch from 7e and lock the green baseline.** Create `feature/test-depth` from `feature/stricter-static-checks`. Do not branch from `main`. Re-run the 7e-tip gates and write the observed lines into the Build record. Do not add deps in this step.

  Expected starting lock (7e record; re-measure, do not invent a new number here):

  - `pnpm exec vp fmt --check` ends with `Finished in … on 62 files`.
  - `pnpm exec vp check --no-fmt` prints `pass: Found no warnings, lint errors, or type errors in 51 files`.
  - `pnpm exec vp test` prints `Test Files  13 passed (13)` and `Tests  177 passed (177)`. If `process.getuid() === 0`, the lock is `175 passed` + `2 skipped` (`root ignores chmod` in `artboardTools.test.ts` and `canvasView.test.ts`).
  - `pnpm knip` exits 0.
  - `pnpm compile` writes `dist/extension.js` and `dist/mcp.js`.

  Done when: `git branch --show-current` is `feature/test-depth`; the five lines above match (or the root-skip variant); `package.json` still has no `fast-check` or `@vitest/coverage-v8`.

- [x] **2. fast-check properties for geometry, stale, and zod.** `pnpm add -D fast-check` and record the resolved version. Add properties next to the existing example tests (`src/panel/stageGeometry.test.ts`, `src/disk/handoff.test.ts`, `src/disk/parse.test.ts`). Use `fc.assert` with fast-check defaults (repeatable seed is allowed if a run flakes; do not invent a product `numRuns`). Keep `pool: 'forks'`. No product file edits.

  Empty / invalid / unexpected (characterise, do not invent):

  - Geometry: empty frames → `frameBounds` / `layoutCanvasChrome` bounds stay `null`; fit-all property skips. Invalid / non-finite zoom stays the existing example tests (`zoom: 0`, `NaN` height reports).
  - Stale: never exported and empty current list stay `{ exported: false, stale: false }`. Unreadable hash is stale **only when `lastExport` is defined**. Order-only permutation is not stale.
  - Zod: properties run only on valid canonical objects. Corrupt fixtures stay on the existing `CorruptManifestError` / `CorruptMetaError` tests (authored message, `ZodError` as `cause` only).

  Done when: `pnpm exec vp test` is green and the Build record has the new passed count (177 + the properties added, or the root-skip variant plus the new cases); `pnpm run check` passes; each In-scope property has at least one `fc.assert` — (1) zoom-at-cursor fixed point, (2) result zoom clamps + `clampStageView` keep-visible, (3) fit-all contains every box, (4) never-exported, (5) same id set / same hashes, (6) hash-changed / id-added / id-removed / unreadable-hash (one assert may cover these mutations), (7) legacy one-frame, (8) manifest byte-equal, (9) meta byte-equal; no file under `src/` except `*.test.ts` changed.

- [x] **3. Scrubbed snapshots for `IMPLEMENT.md` and `canvas.html`.** `vite-plus/test` re-exports Vitest `expect` / `toMatchSnapshot`. Import those from `vite-plus/test` (not from `'vitest'`) and use `expect(scrubbed).toMatchSnapshot()`. Fall back to adjacent golden files compared with `assert.equal` only if that import fails typecheck. If goldens, use a non-fmt extension (`.snap` or `.golden.txt`) or add the path to `fmt.ignorePatterns` so `vp check` cannot rewrite committed bytes.

  Snapshot the scrubbed builder strings from In scope. Existing structure asserts stay. First run writes the snapshot files; the same command must pass on the second run without rewriting them.

  Done when: `pnpm exec vp test` is green; two committed snapshots (or goldens) exist under `src/disk/`; the stored bytes contain `<exportId>` / `<exportedAt>` where those values appeared and contain no `os.tmpdir()` / `/var/folders/` / `/tmp/` prefixes; hostile-label escape tests are unchanged.

- [x] **4. Coverage script, docs, knip, compile.** `pnpm add -D @vitest/coverage-v8` and record the resolved version. Confirm the Vite+ coverage flag in this step (expected: `vp test --coverage` via `pnpm exec`). Add a `package.json` script (name `coverage`) that runs that command. In `vite.config.ts` `test`, set the v8 provider if the runner requires it. Do **not** add `thresholds`. Do **not** set `enabled: true` (the script passes `--coverage`). Add `coverage` to `lint.ignorePatterns` and `**/coverage/**` to `fmt.ignorePatterns`. Add `coverage/` to `.gitignore` and `.vscodeignore`. Document `pnpm coverage` under AGENTS.md Commands (not Verify). Add one coding-standards Testing line: coverage script exists, no thresholds, not part of Verify. Run `pnpm coverage` once, `pnpm knip`, `pnpm run check`, `pnpm exec vp test`, and `pnpm compile`.

  Done when: the coverage script exits 0 and writes a report under `coverage/` (path recorded); `vite.config.ts` has no `thresholds` key and does not set `coverage.enabled: true`; lint/fmt ignore `coverage`; `pnpm knip` exits 0; `pnpm run check` passes; `pnpm exec vp test` still matches the step 3 count (coverage must not add or skip unit tests); `pnpm compile` writes `dist/extension.js` and `dist/mcp.js`; AGENTS.md and coding-standards mention the script; no Verify command exists.

## Files / areas

- `package.json`, `pnpm-lock.yaml` (`fast-check`, `@vitest/coverage-v8`, `coverage` script)
- `vite.config.ts` (`test` block: coverage provider if required; no thresholds; no `enabled: true`; plus `lint.ignorePatterns` / `fmt.ignorePatterns` for `coverage`, and snapshot/golden paths only if they would be formatted)
- `src/panel/stageGeometry.test.ts` (properties; keep vm eval and example tests)
- `src/disk/handoff.test.ts` (stale properties; IMPLEMENT.md snapshot)
- `src/disk/parse.test.ts` (zod properties; keep fixture round-trips)
- `src/disk/handoffCanvasHtml.test.ts` (`canvas.html` snapshot)
- `src/disk/__snapshots__/` or adjacent golden files (new)
- `.gitignore`, `.vscodeignore` (`coverage/`)
- `AGENTS.md` Commands, `blueprint/context/coding-standards.md` Testing
- Do not edit: `src/panel/stageGeometry.ts`, `src/disk/handoff.ts`, `src/disk/handoffCanvasHtml.ts`, `src/disk/parse.ts`, `src/mcp/**` product files, `knip.json` unless step 4 proves a false positive and this spec is updated first

## Data / contracts

No disk, MCP, or chrome contract changes. Tests lock current behavior:

- **Geometry** lives in the `STAGE_GEOMETRY_SOURCE` string. Tests must eval that string, not a rewritten TS port. Zoom range 0.05–10. Fit padding and keep-visible are 48 in that string and in today's example tests. Fit-all containment uses the existing 1e-9 tolerance.
- **`compareCanvasHandoff`:** `{ exported: boolean; stale: boolean }`. Never exported: `{ exported: false, stale: false }` (wins even when a current `hash` is undefined). With `lastExport`, stale when the current id set differs, a hash is missing, or a normalized hash differs. Order does not count. Layout does not count. Legacy `lastExport` without `frames` is one frame. Current-frame lists in properties use unique ids. `handoff_status` may still report `stale: true` when never exported; do not change either function.
- **Zod round-trip:** `serializeManifest` / `serializeMeta` are `${JSON.stringify(value, null, 2)}\n`. Unknown keys are stripped. Schema key order is the serialized key order. `activeArtboardId` that fails the id pattern becomes `''`. Meta missing `viewport` becomes `DEFAULT_VIEWPORT` and therefore cannot byte-match the input; properties use objects that already include `viewport`. Generators use the required-field list in In scope.
- **Snapshots:** scrub tokens `<exportId>`, `<exportedAt>`, `<tmp>` only. Hashes and frame ids stay. Builders do not emit workspace temp paths today; the `<tmp>` rule is so a later path cannot flake. Snapshot API is `expect` / `toMatchSnapshot` from `vite-plus/test`.
- **Coverage:** report only. No fail-under number. Not Verify. `coverage.enabled` stays unset/false. Lint/fmt ignore the report directory.
- **Unit count:** starting lock is **177** (7c/7e). The plan / Notion "178" mixes in the excluded mocha sample. Do not edit the plan. Record the new `vp test` total in the Build record after steps 2 and 3.
- **Verify:** not declared. This feature does not add it. `/feature` did not run a Verify command.

## Testing

Logic gate: `pnpm exec vp test` (Vite+ / Vitest). `pnpm test` (Electron) is not this gate.

- Step 1 records the 177 (or root-skip) baseline.
- Steps 2–3 add properties and snapshots on that command.
- Step 4 runs `pnpm coverage` once as observed evidence that the script works. Do not treat the report percentages as a gate.
- No Browser tests command exists; do not add one.
- Do not press F5. Do not run Electron `pnpm test`.

## Notes for the AI

- `blueprint/reference/0.2.1-tooling-review.md` § 7f is background. Every check there is already a step here.
- Stack on 7e. `main` does not have 7c–7e.
- `vp` is not on `PATH` in a clean shell; use `pnpm run check`, `pnpm exec vp test`, and `pnpm exec vp` for coverage.
- Existing example tests are the product oracle. A shrinking counterexample that contradicts them means the property is too wide.
- Do not "fix" `handoff_status` vs `compareCanvasHandoff` drift. Characterise the helper the plan named.
- Snapshot the pure builders. Do not snapshot `exportArtboard` temp trees.
- Import snapshot `expect` from `vite-plus/test`. Do not add `vitest` as a package.
- Keep knip's locked `include`. Do not run `knip --fix`.
- No em dashes in the files this feature writes.

### Build record (fill during build)

- Branch tip this spec started from: `feature/stricter-static-checks` `380143f`
- Locked `vp fmt --check` (`on N files`): Finished in 299ms on 62 files
- Locked `vp check --no-fmt` (`in N files`): Found no warnings, lint errors, or type errors in 51 files
- Locked `pnpm exec vp test` before new cases (177 passed, or 175 + 2 skipped if uid 0): Tests  177 passed (177)
- `fast-check` version: 4.10.2
- `pnpm exec vp test` after properties (count): Tests  186 passed (186)
- Snapshot API used (`vite-plus/test` expect, or golden files): `vite-plus/test` expect
- `@vitest/coverage-v8` version: 5.0.5
- Coverage command observed (exact argv) and report path: `pnpm coverage` -> `vp test --coverage`; report `coverage/index.html`
- `pnpm knip` after coverage (exit 0 / paste unused): exit 0 (configuration hints only; no unused)
- `pnpm compile` wrote `dist/extension.js` and `dist/mcp.js` (yes/no): yes


<!-- blueprint:completion {"schemaVersion":1,"specBytes":17951,"specSha256":"de4d409b39a1a0de311573ddd8e11fb12e87b992d0f3e0de9808ba67b9ec7f2c","branch":"refs/heads/feature/test-depth","head":"380143f3d93cb1233d319695f168d8e475b45efd","baseRef":"refs/heads/main","baseCommit":"43cce2cf50f97783d8ad7a9e6da136f8be821d9b","sourceTree":"975c5bfab4a677dacd4f62f3614318120df6f6df","absentOptional":[]} -->
