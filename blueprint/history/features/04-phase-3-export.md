# Feature: Phase 3 Export

**From build-plan:** feature 4
**Build attempt:** 1
**Branch:** `feature/phase-3-export`
**Status:** verified

## Goal

Cursor Agent (via MCP) or Bombic (via **Export Handoff** command) can export an artboard into `.cursor-design/handoff/<exportId>/` with an `IMPLEMENT.md` a second Agent session can implement from. `manifest.json` records `lastExport`; `handoff_status` and the panel badge mark the handoff stale as soon as the active artboard hash differs from the exported hash. Old handoffs are never deleted. DoD trial (rule 01): hero+CTA designed via Agent, exported, implemented into a tiny Vite + plain HTML sample in the dev fixture; the trial is performed manually in F5 and recorded in README before `/complete`.

## In scope

- Two new MCP tools, names in `src/mcp/toolNames.ts` only: `export_artboard`, `handoff_status`. Both run behind the existing global `enqueueDiskOp` queue (it already serializes all MCP disk ops, including the manifest). Same permissive `fromJsonSchema` + authored `INVALID_ARGS` pattern. Same `rootPath` handling. Host-vs-MCP manifest writes stay last-writer-wins (existing `ponytail:`).
- `export_artboard({ artboardId?, rootPath? })`: defaults to the active artboard. Reads HTML + meta (strict manifest reader in both id modes, because export writes the manifest back). Writes `handoff/<exportId>/index.html` (byte-identical copy of `artboards/<id>.html`), `IMPLEMENT.md`, `tokens.json`, then rewrites `manifest.json` with every existing field preserved, `updatedAt` bumped, and `lastExport` replaced. Does not bump artboard `generation`. Does not change an existing `activeArtboardId`. Manifest absent with explicit `artboardId` → create the manifest with that id active (no active existed; mirrors `set_artboard`). Never deletes or overwrites a previous handoff directory. Success body: `{ exportId, artboardId, artboardHash, exportedAt, generation, handoffPath }`, `handoffPath` = workspace-relative `.cursor-design/handoff/<exportId>`. No HTML in the body.
- Exporting a non-active id is allowed and records that id in `lastExport`. Because staleness compares the **active** hash with `lastExport.artboardHash`, the badge and `handoff_status.stale` then read stale until the Agent either sets that id active or exports the active one. Intended: the handoff on record must match what the panel shows.
- `handoff_status({ rootPath? })`: read-only, strict manifest reader. Body: `{ stale, activeArtboardId, activeHash, lastExport? }`. `activeHash` = active meta `hash` (never recomputed from HTML in MCP). `lastExport` is the manifest object when present, omitted otherwise. `stale = lastExport === undefined || hashes differ` (normalized). No active artboard or active HTML missing → `ARTBOARD_NOT_FOUND`; active HTML present but meta missing/unparseable → `CORRUPT_META` (same as `read_artboard`).
- Meta is optional on disk but the MCP leaf already treats HTML-without-meta as `CORRUPT_META` (Phase 2 contract, `readMetaForHtml`). Export and status keep that: no defaults, no ad-hoc HTML hashing in MCP. The host leaf goes through `reconcileMeta`, which mints meta, so the host always has `title`, `viewport`, `generation`, `hash`.
- Manifest schema gains optional `lastExport` (schema version stays `1`). `parseManifest` validates it when present: `exportId`, `artboardId`, `artboardHash`, `exportedAt` are non-empty strings; `artboardId` passes `parseArtboardId`; `artboardHash` passes `isArtboardHash`; `exportedAt` satisfies `!Number.isNaN(Date.parse(exportedAt))`; otherwise `CORRUPT_MANIFEST`. `serializeManifest` writes it. **Every manifest rewrite preserves `lastExport`**: `writeManifestActive` in `src/disk/artboardFs.ts` (used by `set_artboard` / `set_active_artboard`) must copy `existing?.lastExport`. Host `initializeDefaultArtboard` runs only when the manifest is missing, so nothing to preserve; do not add a second host manifest writer that drops the field.
- Pure module `src/disk/handoff.ts` (no fs, no vscode). Signatures in Data / contracts. Both I/O leaves call it: MCP via `node:fs` in `artboardFs.ts`, host via `vscode.workspace.fs` in `src/host/artboardDisk.ts`. Tokens bytes are read by the leaf and passed in; the pure module never touches disk. Do not import node:fs CRUD into the host or `vscode` into `src/disk/`.
- Host **Export Handoff** command (`cursor-design.exportHandoff`, already contributed) replaces the stub. Guards, in order, each a safe message and no write: no workspace folder → `Open a workspace folder to export a handoff.`; untrusted → existing untrusted copy; first workspace folder only (matches Open Artboard / Reveal); no manifest, no active id, or active HTML missing → `No active artboard to export. Run Cursor Design: Open Artboard first.`; corrupt manifest/meta → existing `toSafeArtboardErrorMessage` text; other failures → `Could not export handoff. Check the Output panel: Cursor Design.` plus `logDiskError`. Success → `Handoff exported to .cursor-design/handoff/<exportId>/.` Works with the panel closed; when open, the watcher refreshes it.
- Host leaf follows the same write recipe as the MCP leaf: `createDirectory(handoff/)`, leaf dir must not exist (`stat` succeeds → treat as collision → generic failure message above, logged), write `index.html`, `IMPLEMENT.md`, `tokens.json`, then manifest (preserved fields + `updatedAt` + `lastExport`).
- Partial failure (either leaf): files before the failure stay on disk, nothing is cleaned up, the manifest is written last so `lastExport` never points at an incomplete dir. `ponytail:` no journal / rollback; orphan dirs are harmless and never deleted.
- Two distinct booleans, both derived from one pure compare:
  - MCP `handoff_status.stale`: true when never exported or hashes differ (Agent must export first).
  - Host snapshot `handoffStale` → `ui:status.handoffStale`: badge visibility = `lastExport !== undefined && hashes differ`. False when never exported, false for empty/error snapshots.
- `ui:status` becomes `{ type: 'ui:status', mcpAvailable: boolean, handoffStale: boolean }` (Notion §5). `postUiStatusToPanel` takes a partial `{ mcpAvailable?, handoffStale? }` merged into a pending status whose `handoffStale` defaults to `false`; flush only once `mcpAvailable` has been set (current behavior), so the MCP banner never flashes and the badge cannot appear before a real snapshot.
- Chrome badge copy: `Handoff out of date. Re-export.` Shown only when `handoffStale === true`. Uses the existing `.badge` class and `var(--vscode-*)` tokens; badge container gets `aria-live="polite"`.
- Badge needs no new watcher: export writes `manifest.json`; later saves change meta hash; both already flow `watchArtboardDisk` → `readActiveArtboardFromDisk` → panel. `handoff/**` writes also hit the `.cursor-design/**` watcher; that is a debounced no-op reload, acceptable.
- `IMPLEMENT.md` (authored template, no artboard HTML inlined): header block `exportId`, `artboardId`, `artboardHash`, `exportedAt`, `title`, `viewport`, `generation`; file list (`index.html`, `tokens.json`); instructions: call `handoff_status` first and re-export if `stale`; if MCP is unavailable, compare the header `artboardHash` with `.cursor-design/artboards/<artboardId>.meta.json` `hash` and re-export (or ask the user to run **Export Handoff**) when they differ; implement from `index.html` (HTML+CSS+JS live inline in that document), not from screenshots; target `fixtures/dev-workspace/sample-app/index.html` in the demo (or the user's named app); never copy `.cursor-design/` into the app; keep semantic structure, classes, and behavior; assets referenced as `assets/…` resolve against `.cursor-design/assets/` (copy manually).
- Second-session entry point: `manifest.json.lastExport.exportId` → `.cursor-design/handoff/<exportId>/IMPLEMENT.md`; `export_artboard` also returns `handoffPath`. No `list_handoffs` tool.
- `tokens.json` in the handoff: `.cursor-design/tokens.json` missing → stub `{ "version": 1, "tokens": {} }`; regular file → byte copy without JSON validation (`ponytail:`); present but symlink / non-file / unreadable → `DISK_ERROR` (consistent with `layoutEntryKind`).
- Sample implement target: hand-written `fixtures/dev-workspace/sample-app/` with `package.json` (`"private": true`, `"scripts": { "dev": "vite" }`, `vite` pinned to the exact current version from `pnpm view vite version` at implement time) and a minimal `index.html`. No scaffolder. Root `.gitignore` adds `fixtures/dev-workspace/sample-app/node_modules/` and `fixtures/dev-workspace/sample-app/pnpm-lock.yaml`. Bombic runs `pnpm install` inside it manually. One Vite-served plain HTML app is the locked DoD stack (Notion §15 "Vite + plain HTML").
- README: list the seven tools; add an "Export to implement trial" section (F5 steps: design hero+CTA via Agent → `export_artboard` → second Agent session implements from `IMPLEMENT.md` into `sample-app/index.html` → edit artboard → badge shows stale → re-export clears it) and record the performed trial date.
- Chrome stays the existing nonce'd vanilla script shipped in Phases 1-2. Overview / rule 02 still say Svelte 5 + Vite; that migration is recorded drift, not this feature. Do not rewrite the panel.
- Tests: `src/disk/handoff.test.ts` (`node:test`, temp dirs, no `vscode`), plus one MCP case in `artboardTools.test.ts`.

## Out of scope

- Splitting inline CSS/JS into `styles.css` / `main.js` (Notion §15: "simple; refine later"). Handoff carries the full document in `index.html`. `ponytail:` no HTML parsing in v1.
- Copying `.cursor-design/assets/` into the handoff. `IMPLEMENT.md` names the manual step.
- Chrome → host `ui:export` / `ui:reveal` buttons, screenshots, MIT/README polish beyond the trial section. Out of this feature; not assigned to a later plan item.
- Migrating chrome to Svelte 5 + Vite.
- Design checks / `run_design_checks`, `apply_brand`, prompts library.
- Deleting or pruning old handoffs; a `list_handoffs` tool.
- MCP writing anything into `sample-app/`; implementation is the Agent's normal file tools.
- Changing `pnpm test`, `.vscode-test.mjs`, or adding a Blueprint Verify command / AGENTS.md test gate (Phase 2 precedent).

## Build loop

`workflow.stepReview: feature` → implement all steps, then one review packet. `checkpointCommits: disabled` → no step commits; `/complete` creates the feature commit. Per step: `pnpm check-types && pnpm lint`, plus the named check. Step 3 additionally needs F5 in `fixtures/dev-workspace`. Do not claim live MCP or pixel evidence for Steps 1-2. Step 4's trial must be performed and dated in README before `/complete`.

## Build steps

- [x] **Step 1 - Disk SoT: `lastExport`, pure handoff builder, node:fs export/status** - `layout.ts`: `HANDOFF_DIR = 'handoff'`, `TOKENS_FILE = 'tokens.json'`, `HANDOFF_INDEX_FILE = 'index.html'`, `IMPLEMENT_FILE = 'IMPLEMENT.md'`, `handoffDirSegments(exportId)`, `workspaceTokensPathSegments` (the `.cursor-design/tokens.json` source). `parse.ts`: `LastExport` type, optional `lastExport` on `ArtboardManifest`, strict parse when present. `handoff.ts`: `makeExportId`, `buildHandoffFiles`, `compareHandoff` (pure). `errors.ts`: `DiskError` gains an optional authored `message` (class count unchanged). `artboardFs.ts`: `exportArtboard`, `readHandoffStatus`; `writeManifestActive` preserves `lastExport`; `mkdir(handoff/, { recursive: true })` then leaf `mkdir(..., { recursive: false })`; leaf `EEXIST` → `DiskError('Handoff folder already exists. Retry export_artboard.')` (`ponytail:` ms timestamp + id makes collision practically impossible). *Done when:* `pnpm compile-tests && node --test out/disk/handoff.test.js out/disk/conflict.test.js` pass (`compile-tests` is an existing package.json script, not a Blueprint gate), covering: export writes three files + `lastExport`, `updatedAt` bumped, generation unchanged; status `stale=false` right after export; `updateArtboard` with new HTML → `stale=true` and old handoff dir still present; `setActiveArtboard` keeps `lastExport`; export of a non-active id → status `stale=true`; never exported → `stale=true`, `lastExport` omitted, `compareHandoff` reports `exported=false`; malformed `lastExport` (bad hash, bad date) → `CorruptManifestError`; export with unknown id → `ArtboardNotFoundError`; export with omitted id and no active → `ArtboardNotFoundError`; export with HTML but no meta → `CorruptMetaError`; tokens missing → stub, tokens present → byte copy.

- [x] **Step 2 - MCP tools** - Add `EXPORT_ARTBOARD_TOOL`, `HANDOFF_STATUS_TOOL` to `toolNames.ts`; register both in `artboardTools.ts` via `runQueued`; add schemas to `artboardToolInputSchemas`. Descriptions tell the Agent: export before implementing, re-export when `stale`. README tool list updated. *Done when:* `pnpm compile` writes `dist/mcp.js` and `rg 'require\("vscode"\)' dist/mcp.js` finds nothing; `artboardTools.test.ts` gains one case (`export_artboard` with non-string `artboardId` → JSON `INVALID_ARGS`) and the existing suites (`conflict`, `resolveWorkspaceRoot`, `artboardTools`) still pass.

- [x] **Step 3 - Host: stale badge + Export Handoff command** - `artboardDisk.ts`: snapshot gains `handoffStale: boolean` (badge semantics; false for empty/error snapshots); `exportActiveArtboardHandoff({ workspaceFolder, outputChannel })` using `vscode.workspace.fs` + the pure builder with the host recipe above. `exportHandoff.ts`: guards + messages from In scope, calls it. `openArtboardPanel.ts`: `UiStatusMessage.handoffStale`, partial `postUiStatusToPanel` with `handoffStale` default `false`, badge element + copy, `aria-live="polite"`. `handleOpenArtboard.ts` / `watchArtboardDisk.ts`: post `handoffStale` from each snapshot alongside the artboard update. *Done when:* `pnpm compile` passes; F5 in `fixtures/dev-workspace`: Open Artboard → no badge; run **Export Handoff** → `.cursor-design/handoff/<exportId>/{index.html,IMPLEMENT.md,tokens.json}` exists and `manifest.json` has `lastExport`; still no badge; edit `artboards/<id>.html` and save → badge `Handoff out of date. Re-export.` within ~200ms; re-export → badge gone. No CSP errors in the webview console. Running the command with no folder open shows the no-folder message and writes nothing.

- [x] **Step 4 - Sample app + README trial** - Add `fixtures/dev-workspace/sample-app/{package.json,index.html}`; root `.gitignore` entries. README: seven tools, allowlist note unchanged, "Export to implement trial" section with exact F5 steps and the expected badge. *Done when:* `pnpm check-types && pnpm lint` pass; `cd fixtures/dev-workspace/sample-app && pnpm install && pnpm dev` serves `index.html` (record observed result only); README section present; the hero+CTA export → implement trial has been performed in F5 and its date recorded in README (blocks `/complete` until done).

## Files / areas

- `src/disk/layout.ts` - handoff/tokens/implement names + segments (single source of truth)
- `src/disk/parse.ts` - `LastExport`, manifest optional field, strict parse
- `src/disk/errors.ts` - `DiskError` optional authored message
- `src/disk/handoff.ts` (new) - pure export id, file builder, compare
- `src/disk/handoff.test.ts` (new) - `node:test`, temp dir
- `src/disk/artboardFs.ts` - `exportArtboard`, `readHandoffStatus`, `writeManifestActive` preserves `lastExport`
- `src/mcp/toolNames.ts`, `src/mcp/artboardTools.ts`, `src/mcp/artboardTools.test.ts`
- `src/host/artboardDisk.ts` - `handoffStale` on snapshot; host export writer
- `src/commands/exportHandoff.ts` - real command
- `src/panel/openArtboardPanel.ts` - `ui:status.handoffStale`, badge
- `src/host/handleOpenArtboard.ts`, `src/host/watchArtboardDisk.ts` - post `handoffStale`
- `fixtures/dev-workspace/sample-app/` (new), root `.gitignore`, `README.md`

## Data / contracts

- `exportId = \`${artboardId}-${compact}\`` where `compact` is `exportedAt` ISO with `-`, `:`, `.` removed (e.g. `hero-20260911T173900123Z`). Charset stays `[A-Za-z0-9._-]`, a safe single path segment. `exportedAt = now.toISOString()`; `now: Date` is injected (test seam for the nondeterministic value).
- Pure module signatures (`src/disk/handoff.ts`):

```ts
export type LastExport = { exportId: string; artboardId: string; artboardHash: string; exportedAt: string }

export const makeExportId = ({ artboardId, now }: { artboardId: string; now: Date }): string

export type BuildHandoffFilesArgs = {
	artboardId: string
	html: string
	meta: ArtboardMeta            // title, viewport, generation, hash
	tokensJson: string | undefined // leaf-read bytes of .cursor-design/tokens.json, undefined → stub
	now: Date
}
export type HandoffFiles = {
	exportId: string
	lastExport: LastExport
	indexHtml: string
	implementMd: string
	tokensJson: string
}
export const buildHandoffFiles = (args: BuildHandoffFilesArgs): HandoffFiles

export type HandoffCompare = { exported: boolean; stale: boolean } // stale === hashes differ; false when !exported
export const compareHandoff = ({ lastExport, activeHash }: { lastExport: LastExport | undefined; activeHash: string }): HandoffCompare
```

  MCP `stale = !exported || stale`; host badge `handoffStale = exported && stale`.
- Leaf signatures: `exportArtboard({ workspaceRoot, artboardId?, now? }): Promise<ExportArtboardResult>`; `readHandoffStatus({ workspaceRoot }): Promise<HandoffStatusResult>`; host `exportActiveArtboardHandoff({ workspaceFolder, outputChannel }): Promise<{ exportId: string }>` (throws domain errors; the command maps them to messages).
- `manifest.json.lastExport`: optional `LastExport`; absent = never exported. Invalid shape → `CORRUPT_MANIFEST`. Export rewrites the manifest with `version`, `activeArtboardId`, `workspaceFolder` preserved, `updatedAt` = `now`, `lastExport` replaced.
- Handoff dir: `.cursor-design/handoff/<exportId>/` with exactly `index.html`, `IMPLEMENT.md`, `tokens.json`. Never removed by the extension.
- `export_artboard` success: `{ exportId, artboardId, artboardHash, exportedAt, generation, handoffPath }`. Error codes: `ARTBOARD_NOT_FOUND` (unknown id, omitted id with no active, active HTML missing), `CORRUPT_META`, `CORRUPT_MANIFEST`, `UNSUPPORTED_SCHEMA_VERSION`, `INVALID_ARGS`, `INVALID_ARTBOARD_ID`, `NO_WORKSPACE`, `ambiguous_workspace`, `INVALID_ROOT`, `DISK_ERROR` (incl. authored collision text). No new error classes.
- `handoff_status` success: `{ stale: boolean, activeArtboardId: string, activeHash: string, lastExport?: LastExport }`. Error codes: `ARTBOARD_NOT_FOUND`, `CORRUPT_META`, `CORRUPT_MANIFEST`, `UNSUPPORTED_SCHEMA_VERSION`, `INVALID_ARGS`, `NO_WORKSPACE`, `ambiguous_workspace`, `INVALID_ROOT`, `DISK_ERROR`.
- `ui:status`: `{ type: 'ui:status', mcpAvailable: boolean, handoffStale: boolean }` (host always sends both; pending state merges partials, `handoffStale` default `false`).
- Security: tool bodies, UI messages, and `IMPLEMENT.md` never include absolute paths outside the workspace, stacks, or artboard HTML. `handoffPath` is workspace-relative. `exportId` derives only from a validated artboard id + timestamp. Tokens bytes are copied as opaque text, never parsed or executed.

## Testing

No Verify command; no Blueprint test gate (Phase 2 precedent, kept). Prove with `pnpm check-types`, `pnpm lint`, `pnpm compile`, and `pnpm compile-tests && node --test out/disk/handoff.test.js out/disk/conflict.test.js out/mcp/resolveWorkspaceRoot.test.js out/mcp/artboardTools.test.js`. Step 3 pixels and Step 4 trial via F5 only. Do not add browser tests.

## Notes for the AI

- Follow `05-single-job`: pure builder in `src/disk/handoff.ts`; two I/O leaves; MCP handlers stay thin.
- Object args for 3+ params; arrow functions; `error` not `err`; explicit return types on exported disk/MCP helpers.
- `writeManifestActive` preserves `lastExport`; the export paths replace it. Those are the only MCP manifest writers.
- `readManifestFileLenient` swallows `CORRUPT_MANIFEST` for id-addressed reads; export and status use the strict reader because they write or report the manifest.
- Chrome stays the nonce'd vanilla script on purpose (see In scope); badge reuses `.badge`.
- `IMPLEMENT.md` is authored copy: short, imperative; the second Agent session reads it cold.
- No em dashes in generated content (coding standards).

## Recorded decisions

- Handoff keeps CSS/JS inline in `index.html`; split files deferred (Notion §15).
- Badge hidden before the first export; `handoff_status.stale` is `true` in that state so the Agent exports first.
- Exporting a non-active id is allowed and reads stale until active matches.
- Missing meta on the MCP leaf is `CORRUPT_META` (Phase 2 contract), not defaulted.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":20696,"specSha256":"8d77efc846f40c2e9d15fe4defcc55d894c357231d736fea7d718356cf7a1b34","branch":"refs/heads/feature/phase-3-export","head":"f3f32ef754a042a01590cdd5eaf14415bb99d9b6","baseRef":"refs/heads/main","baseCommit":"f3f32ef754a042a01590cdd5eaf14415bb99d9b6","sourceTree":"59a549351d68f9c3b7afc83b1b21cba3c25cf655","absentOptional":[]} -->

## Findings

### 4/F-01 [P3] closed - Explicit-id export with absent manifest has no test

**File:** src/disk/handoff.test.ts (gap covers src/disk/artboardFs.ts:692-760)
**Found:** 2026-09-12 by /audit (scope: current; lens: tests)
**Why it matters:** The spec requires export with an explicit artboardId and no manifest to create the manifest with that id active (`writeManifestLastExport` fallback at `artboardFs.ts:707`). The branch is implemented but no test builds that state (artboard files present, manifest deleted), so a regression that throws or writes the wrong active id would pass the suite.
**Suggested fix:** Add one `node:test` case: create artboard, delete `manifest.json`, export with the explicit id, assert success plus manifest `activeArtboardId` and `lastExport`. Keep the temp-dir pattern already used in the file.
**Resolution:** Added `export with explicit id and no manifest creates the manifest active on that id` in `src/disk/handoff.test.ts`: create hero, delete `manifest.json`, export with `artboardId: 'hero'`, assert success plus `activeArtboardId` and `lastExport`. Waiting on a later `/audit` to close. 2026-09-12 `/audit` (scope: current; all lenses): re-read `src/disk/handoff.test.ts:244-259`; the case builds the exact state and asserts `activeArtboardId` and the full `lastExport` object; `node --test out/**/*.test.js` passes it. Closed.

### 4/F-02 [P1] closed - Host export records meta hash/generation without reconciling against the HTML it copies

**File:** src/host/artboardDisk.ts:329-347 (`readMetaForHostExport`), 373-377 (call site)
**Found:** 2026-09-12 by /audit (scope: current; lens: quality, error handling)
**Why it matters:** The spec states the host leaf "goes through `reconcileMeta`, which mints meta", and the command "works with the panel closed". The leaf instead reads raw meta and only checks `meta.id`. `watchArtboardDisk.refreshWatchedArtboard` returns early when no panel is open, so after a hand edit of `artboards/<id>.html` with the panel closed the meta `hash`/`generation` are stale. Export then writes `index.html` = new bytes but `lastExport.artboardHash` and the `IMPLEMENT.md` header = old hash/generation. On the next panel open `reconcileMeta` bumps the hash, so the badge and `handoff_status` read stale for a handoff that is byte-identical to the active HTML, and `IMPLEMENT.md` step 2 tells the Agent to re-export. Secondary: a missing meta file makes the command fail with the corrupt-meta message even though Open Artboard would heal that state.
**Suggested fix:** In `exportActiveArtboardHandoff` replace `readMetaForHostExport` with the existing `reconcileMeta({ artboardId, html, metaUri, titleFallback: DEFAULT_ARTBOARD_TITLE })` and build `meta` from the returned snapshot plus `hashHtml(html)` (or have `reconcileMeta` return the `ArtboardMeta`). Delete `readMetaForHostExport`. No new helper.
**Resolution:** Agreed. `exportActiveArtboardHandoff` now calls existing `reconcileMeta`, then builds `ArtboardMeta` from the snapshot plus `hashHtml(html)`. Deleted `readMetaForHostExport`. Missing or stale meta is healed the same way Open Artboard does; generation bumps only when the HTML hash actually changed. Re-review 2026-09-12 `/audit` (scope: current; all lenses): export calls `reconcileMeta` at `src/host/artboardDisk.ts:331-336` and builds meta from the snapshot plus `hashHtml(html)`; `readMetaForHostExport` has zero references; stale/missing meta heals before the handoff write, generation bumps only on real HTML change, manifest still written last; no new defect. Closed.

### 4/F-03 [P3] closed - Host handoff collision check reimplements `fileExists`

**File:** src/host/artboardDisk.ts:390-401
**Found:** 2026-09-12 by /audit (scope: current; lens: quality)
**Why it matters:** `stat(leafUri)` then `throw new DiskError()` inside the same `try`, with a `catch` that rethrows its own `DiskError`, is the module's `fileExists` written inline. It reads as an error path and hides the actual intent (dir must not exist). Ponytail rung 2.
**Suggested fix:** `if (await fileExists(leafUri)) { throw new DiskError(); }`.
**Resolution:** Agreed. Collision check is `if (await fileExists(leafUri)) { throw new DiskError(); }`. Unexpected `stat` errors still wrap as `DiskError` in the outer catch. Re-review 2026-09-12 `/audit` (scope: current; all lenses): confirmed at `src/host/artboardDisk.ts:357-358`; unexpected `stat` errors propagate from `fileExists` to the outer catch (logged once, wrapped); no new defect. Closed.

### 4/F-04 [P3] closed - `DiskError` first argument is `string | { cause }`; tokens.json non-file failures stay generic

**File:** src/disk/errors.ts:141-147; src/disk/artboardFs.ts:646-648; src/host/artboardDisk.ts:313-315
**Found:** 2026-09-12 by /audit (scope: current; lens: quality, error handling)
**Why it matters:** The `typeof message === 'string'` overload is the only error class in the module with a positional shape switch; readers must open the constructor to know which arg is which. The one authored message it enables is the collision text. Meanwhile the new tokens.json symlink/directory path throws the default "fix folder permissions" copy, which sends the user/Agent to the wrong fix.
**Suggested fix:** Keep one shape: `constructor(options?: { message?: string; cause?: unknown })`, and pass an authored message for the tokens case (e.g. `'.cursor-design/tokens.json must be a regular file.'`).
**Resolution:** Partial. Authored tokens message added on both leaves (`.cursor-design/tokens.json must be a regular file.`) plus a node:test for a directory at that path. Constructor overload kept: spec Step 1 documents positional `DiskError('Handoff folder already exists. Retry export_artboard.')`, and that is the only extra shape beyond `new DiskError()` / `new DiskError({ cause })`. Re-review 2026-09-12 `/audit` (scope: current; all lenses): authored message confirmed at `src/disk/artboardFs.ts:638` and `src/host/artboardDisk.ts:295`, directory case covered by `node:test` (suite 44/44 green); the overload remainder is spec-mandated (spec Step 1 documents the positional call), so changing it would violate the spec; no new defect. Closed.

### 4/F-05 [P3] closed - Explicit-id export leaves an empty `activeArtboardId` empty

**File:** src/disk/artboardFs.ts:706 (`existing?.activeArtboardId ?? artboardId`)
**Found:** 2026-09-12 by /audit (scope: current; lens: bugs/edge cases)
**Why it matters:** `parseActiveArtboardId` accepts `''`, so a manifest with no active is a reachable disk state. The spec says an export with an explicit id when "no active existed" should make that id active; `??` only covers the manifest-absent case. After such an export `handoff_status` returns `ARTBOARD_NOT_FOUND` even though `lastExport` was just written.
**Suggested fix:** Treat empty as absent: `existing?.activeArtboardId || artboardId` (add one test alongside the explicit-id case).
**Resolution:** Agreed. `writeManifestLastExport` uses `existing?.activeArtboardId || artboardId`. Test: manifest with `activeArtboardId: ''`, export explicit `hero`, then `activeArtboardId` / `handoff_status` succeed on `hero`. Non-active export still preserves a real active id (`??` vs `||` only differs on `''`). Re-review 2026-09-12 `/audit` (scope: current; all lenses): confirmed at `src/disk/artboardFs.ts:691`; the empty-active test passes and asserts `handoff_status` succeeds, and the non-active-export test confirms a real active id is still preserved; no new defect. Closed.

### 4/F-06 [P3] closed - Dead `ArtboardHtmlMissingError` branch and duplicated domain-error lists in the export command path

**File:** src/commands/exportHandoff.ts:37; src/host/artboardDisk.ts:418-425
**Found:** 2026-09-12 by /audit (scope: current; lens: quality)
**Why it matters:** `exportActiveArtboardHandoff` never throws `ArtboardHtmlMissingError` (missing HTML is `ArtboardNotFoundError`), so the command branch is unreachable. The same six-class `instanceof` list is written in both files; a seventh domain error would have to be added in two places.
**Suggested fix:** Drop the dead class from the command. Either keep the lists but remove the dead entry, or export one `isArtboardDomainError` predicate from `artboardDisk.ts` next to `toSafeArtboardErrorMessage` and use it in both places.
**Resolution:** Agreed on the dead branch: removed `ArtboardHtmlMissingError` from `exportHandoff.ts` and from the host export rethrow list (missing HTML is `ArtboardNotFoundError`). Declined a shared `isArtboardDomainError` predicate: the remaining lists are not the same (`toSafeArtboardErrorMessage` still needs `ArtboardHtmlMissingError` for Open Artboard snapshots). Re-review 2026-09-12 `/audit` (scope: current; all lenses): `exportHandoff.ts` imports and both export lists no longer reference the class; remaining references are the definition plus `toSafeArtboardErrorMessage` (`src/host/artboardDisk.ts:88`) and `loadExistingArtboard` (`src/host/artboardDisk.ts:229`), both live snapshot paths; no dead code, no new defect. Closed.
