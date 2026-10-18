# Feature: Canvas export

**From build-plan:** feature 6e
**Build attempt:** 1
**Branch:** feature/canvas-export
**Status:** verified (F5 passed 2026-10-18)

## Goal

Turn `export_artboard` (MCP) and **Export Handoff** (command) from "export the active artboard" into "export the whole canvas": one `handoff/<exportId>/` that holds every frame as its own pristine `index.html` under `<group-folder>/<frame-id>/`, one `IMPLEMENT.md` index, a view-only `canvas.html` layout preview, and `tokens.json`. Record the exported frame set in `manifest.lastExport.frames`, and make `handoff_status` plus the chrome stale badge report stale when any frame's HTML changed, or a frame was added or removed since that export.

Sources: build-plan 6e; `project-overview.md` "Manifest", "Handoff", "0.2 canvas model"; Notion 0.2 page (hard locks: pristine export, assert clean; locked 2026-10-13); current code in `src/disk/handoff.ts`, `src/disk/artboardFs.ts`, `src/host/artboardDisk.ts`.

## In scope

- Whole-canvas export from both entry points (`export_artboard`, **Export Handoff**). Neither entry point reads or requires an active artboard to decide what to export.
- **Frame set:** `resolveCanvasFrames` over a strict artboard-file scan. This is the same list `list_artboards` returns: stored `canvas.json` entries whose artboard file exists, then auto-placed artboards. `resolveCanvasFrames` already drops orphan `canvas.json` entries (for example the fixture's `t5-mobile`), so orphans never reach the tree, `IMPLEMENT.md`, `canvas.html`, or `lastExport.frames`.
- Handoff tree: `IMPLEMENT.md`, `canvas.html`, `tokens.json`, `<group-folder>/<frame-id>/index.html` per frame, `ungrouped/<frame-id>/index.html` for frames without a group, numeric suffix for colliding group folders.
- Every exported `index.html` is byte-equal to its disk HTML, using the string read once by the export's scan. Nothing is stripped or injected.
- `manifest.lastExport.frames` (additive; manifest stays version 1; single-artboard fields kept and filled for older readers).
- Adopt `zod` as a direct dependency and use it for the disk JSON parsers in `src/disk/parse.ts` (manifest, meta, `lastExport` including `frames`). This is behavior-preserving except for the new `frames` field; see Data / contracts "Validation with zod".
- Stale rule shared by `handoff_status` (MCP) and the chrome badge (host). Legacy `lastExport` without `frames` is handled.
- `export_artboard` description and result updated, and a provided `artboardId` is rejected. **Export Handoff** error mapping updated.
- `.cursor/rules/02-mcp-webview.mdc` export/status line replaced (exact text in step 6). `.cursor/skills/cursor-design-agent-loop/` and `README.md` are updated only if they state that export is active-only.

## Out of scope

- 6f reference dogfood (desktop + mobile + two sections) and its export-clean proof. This feature runs its own F5 check only.
- Exporting one frame or a subset; any new MCP tool; any `canvas.json` schema change.
- Layout-only changes (move, width, label, group, `canvas.json` order) marking the handoff stale. The locked rule is hash/added/removed only.
- Pan/zoom in `canvas.html`. Pinch / ctrl+wheel inside the preview is ignored, and plain wheel scrolls the page.
- Copying `assets/` into the handoff, deleting old handoffs, generating real `tokens.json`.
- Changing `handoff_status`'s active-artboard requirement or its `activeArtboardId` / `activeHash` fields.
- Fixing `parseArtboardId` accepting `.` / `..` globally (export guards locally; see Data / contracts).
- Zod anywhere else:
  - `canvas.json` parsing (`src/disk/canvasLayout.ts`) is a follow-up candidate once `parse.ts` proves the pattern.
  - MCP tool `inputSchema`s and the `require*` arg helpers in `artboardFs.ts`.
  - Host webview message checks.
  - The chrome inline script (no bundler).
- Declaring the test runner in `AGENTS.md` (that is `/tests`).

## Build loop

`workflow.stepReview` is `feature` and `workflow.checkpointCommits` is `disabled`: implement all steps in order, run the test runner and `pnpm check-types` / `pnpm lint` after each step, and present one review packet after the last step. No checkpoint commits. `/complete` creates the feature commit.

Test runner (unofficial: not declared in `AGENTS.md`; same as 6c/6d): `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`. Baseline at spec time on `main` (`1349a05`): 155 pass, 0 fail; `pnpm check-types` and `pnpm lint` clean.

## Build steps

- [x] **0. Adopt zod in `parse.ts` (behavior-preserving).**
  - Run `pnpm compile` and record `ls -l dist/extension.js dist/mcp.js` first.
  - `pnpm add zod@^4.2.0`. That is the MCP SDK's own range, so pnpm keeps the single `zod@4.5.4` already in the lockfile; confirm exactly one `zod@` package entry in `pnpm-lock.yaml` afterwards.
  - Rewrite `parseManifest`, `parseLastExport` and `parseMeta` in `src/disk/parse.ts` as zod schemas behind the same exported functions and error classes, per Data / contracts "Validation with zod".
  - Derive `ArtboardManifest`, `LastExport` and `ArtboardMeta` with `z.infer`, keeping the exported names. Do not change any caller.
  - Add the coding-standards Stack line (see Files / areas).
  - Done when:
    - Every existing parse/manifest/meta test passes unedited.
    - Round-trip tests: complete canonical inputs, written with today's `serializeManifest` / `serializeMeta` from an object literal in the test, come back byte-equal after `serialize(parse(text))`. Cover a manifest with and without `lastExport`, and a full meta.
    - A meta input with no `viewport` parses to `viewport: DEFAULT_VIEWPORT`, and serializes with that `viewport` key present. That is today's emit, because `parseMeta` always sets it.
    - A corrupt file's thrown error has exactly the authored message (no zod issue text) and a `ZodError` as `cause`.
    - `pnpm compile` passes, and the review packet lists before/after sizes of `dist/extension.js` and `dist/mcp.js`.
    - Runner, `pnpm check-types` and `pnpm lint` pass.

- [x] **1. Manifest `lastExport.frames`.**
  - In the zod `LastExport` schema add optional `frames: ExportedFrame[]`, where `ExportedFrame = { artboardId: string; artboardHash: string }`.
  - When present, `frames` must be a non-empty array of records whose `artboardId` passes the artboard-id rule and whose `artboardHash` passes `isArtboardHash`, with no duplicate `artboardId`. Check uniqueness with a schema-level refine. Any violation is `CorruptManifestError`.
  - Absent `frames` stays valid (legacy).
  - Serialized key order: `lastExport` is `exportId, artboardId, artboardHash, exportedAt, frames`; each `frames[]` item is `artboardId, artboardHash`.
  - Confirm every manifest writer that carries `existing.lastExport` forward (`writeManifestActive`, and the create/update paths near `artboardFs.ts:499`) keeps `frames` intact.
  - Done when:
    - Tests cover a valid `frames` round-trip, legacy without `frames`, and each corrupt case: not an array, empty, bad id, bad hash, duplicate id.
    - A test shows `setActiveArtboard` and `updateArtboard` preserve `lastExport.frames` byte-for-byte.
    - Runner passes.

- [x] **2. Pure handoff planning in `src/disk/handoff.ts`** (no fs). Signatures are locked:
  - `makeCanvasExportId({ now }: { now: Date }): string` → `canvas-<compact ISO>`, using the existing compaction.
  - `assignGroupFolders(frames: readonly { id: string; group?: string }[]): Map<string, string>`: a frame id → folder name, per the folder rule in Data / contracts.
  - `buildCanvasImplementMarkdown({ exportId, exportedAt, frames }: { exportId: string; exportedAt: string; frames: readonly { id: string; label: string; width: number; group?: string; folder: string; artboardHash: string }[] }): string`. `frames` arrives in resolved order.
  - `compareCanvasHandoff({ lastExport, frames }: { lastExport: LastExport | undefined; frames: readonly { artboardId: string; hash: string | undefined }[] }): { exported: boolean; stale: boolean }`. An `undefined` hash means unreadable.
  - Done when:
    - Folder tests: lowercasing, punctuation runs, edge trimming, the 64-char cap, the empty-slug fallback (including a whitespace-only group), `ungrouped` reservation, `-2`/`-3` first-free suffixes, and the same group string mapping to one folder.
    - IMPLEMENT.md tests: section and frame order, the no-group section heading, newline collapsing in labels and group names, widths, and listed paths.
    - `compareCanvasHandoff` tests: never exported, unchanged, one hash changed, frame added, frame removed, unreadable frame, the same set in a different order (not stale), and legacy `lastExport` (one-frame equal, one-frame changed, extra frame present).
    - Runner passes.

- [x] **3. `canvas.html` builder (self-measuring preview).** New pure module `src/disk/handoffCanvasHtml.ts`.
  - It exports `buildCanvasPreviewHtml({ exportId, frames }: { exportId: string; frames: readonly { id: string; label: string; x: number; y: number; width: number; group?: string; folder: string; html: string }[] }): string` and `buildPreviewFrameHtml({ html, folder, id }): string`. The second builds one frame's preview copy.
  - Both build what Data / contracts "`canvas.html`" describes.
  - Import the plain-JS string sources `ARTBOARD_CANVAS_RUNTIME_SOURCE` and `FRAME_HEIGHT_MESSAGE`/`FRAME_WHEEL_MESSAGE` (`src/panel/artboardCanvasRuntime.ts`) and `STAGE_GEOMETRY_SOURCE` (`src/panel/stageGeometry.ts`) as-is. They import nothing and touch no DOM at module load. Do not copy their logic.
  - Mirror the label band (24), heading band (32) and padding (48) as constants, with a one-line comment naming `layoutCanvasChrome`.
  - Done when (tests in a co-located `handoffCanvasHtml.test.ts`):
    - `<`, `>`, `&`, `"` and `'` in labels and group headings are escaped, so a label `<img src=x onerror=alert(1)>` appears only as text.
    - There is exactly one iframe per frame, with `sandbox="allow-scripts"`, a `srcdoc`, a `title` and `data-cd-frame="<id>"`, and no `src`.
    - Decoding each `srcdoc` gives exactly `buildPreviewFrameHtml(...)`. Its tail after the injected block is byte-equal to the frame HTML, for inputs that contain `"`, `&amp;`, `</script>` and no `<head>`, and for an empty string.
    - Injection lands right after the first `<head…>` tag when there is one, else right after the first `<html…>` tag, else at the very start.
    - Frames with negative x/y are offset so every box starts at or after the 48px padding.
    - There is one heading per distinct non-empty `group`, and none for frames without a group.
    - The parent document has exactly one `<script>` element (the preview controller), and it is free of `</`.
    - Runner passes.

- [x] **4. Export writes the canvas.** Rework `exportArtboard` in `src/disk/artboardFs.ts`.
  - **Read phase (no writes):**
    - `assertLayoutDirsOwned`, then a strict artboard scan (`tolerateHtmlDiskError: false`), then `readCanvasLayoutFile`. A missing `canvas.json` is an empty layout, and every artboard is auto-placed. Corrupt or unsupported throws its authored error.
    - Resolve frames. Zero frames (no artboards dir, or no artboard files) throws `NoArtboardsToExportError`. A frame id of `.` or `..` throws its `DiskError`.
    - For each frame, `readStoredMeta`. A missing meta file is success (`undefined`), and only an existing unparsable meta file throws `CorruptMetaError`. Then compute `effectiveArtboardMeta({ html, meta, artboardId })` from the scan's HTML string.
    - Run `assignGroupFolders` and the tokens read. Build `IMPLEMENT.md` and `canvas.html` text in memory, passing each frame's scan HTML to `buildCanvasPreviewHtml`.
    - No file is read twice. The scan HTML string is the only source for `index.html`, the hash, the meta stamp, and `lastExport.frames`.
  - **Write phase:**
    1. Create the leaf with the existing non-recursive `mkdir` and its collision error.
    2. Write `IMPLEMENT.md`, `canvas.html`, `tokens.json`, then each `<folder>/<id>/index.html`, ensuring `<folder>/<id>/` with the existing `ensureDir` under the leaf.
    3. Stamp meta for each frame where `storedMeta === undefined || normalizeHash(storedMeta.hash) !== effective.hash`, writing `serializeMeta({ ...effective, updatedAt: exportTime })`. That is today's rule, unchanged. A missing meta is created with generation 1, title `Artboard`, viewport `1280x800` from `effectiveArtboardMeta`; an out-of-band HTML edit gets the bumped generation `effectiveArtboardMeta` already computes.
    4. Write the manifest last.
  - **Inputs:**
    - `ExportArtboardArgs` drops `artboardId`.
    - `export_artboard`'s `inputSchema` stays the passthrough `toolInputSchema` (`additionalProperties: true`), with `artboardId` removed from `properties`. The handler sees an extra `artboardId`, and rejects any provided value (`!== undefined`) with `InvalidArgsError` before calling disk.
    - Update the description and result shape in `src/mcp/artboardTools.ts`.
  - **Command:** `src/commands/exportHandoff.ts` keeps its no-folder and untrusted checks, and calls `exportArtboard({ workspaceRoot })` with no active-id pre-check. Delete `NO_ACTIVE_MESSAGE` and the `ArtboardNotFoundError` branch. Every `CursorDesignError` (`NoArtboardsToExportError` included) shows its authored `error.message`. Anything else is logged, and the existing generic message is shown. The success message stays `Handoff exported to ${handoffPath}/.`
  - Replace the single-artboard export tests in `src/disk/handoff.test.ts` with canvas ones. Keep the tokens, collision, symlink and no-meta tests, adapted.
  - Done when (temp-workspace tests):
    - The happy-path workspace has four artboard files: `a` and `b` with `canvas.json` rows `group: "Desktop"`, `c` with a row and no group, and `d` with no row (auto-placed).
    - It gives exactly `IMPLEMENT.md`, `canvas.html`, `tokens.json`, `desktop/a/index.html`, `desktop/b/index.html`, `ungrouped/c/index.html` and `ungrouped/d/index.html`.
    - Each `index.html` is byte-equal to its disk HTML, and contains no `data-cd-` or `cd:frame-`. `canvas.html` is the only file that contains `cd:frame-height`.
    - `lastExport.frames` is `[a, b, c, d]` with `hashHtml` hashes and correct legacy fields, and active is unchanged.
    - With no `canvas.json` at all, the same four files export under `ungrouped/`.
    - With no meta for `d`, the export succeeds and `d.meta.json` is created.
    - Each of these leaves no `handoff/<exportId>/` leaf, and its error has the right code: an empty artboards dir (`ARTBOARD_NOT_FOUND`, exact message); corrupt `canvas.json` (`CORRUPT_CANVAS`); corrupt meta on one frame (`CORRUPT_META`); an artboard file `..html` (id `.`, `DISK_ERROR`).
    - With no manifest, the manifest is created with active = the legacy frame.
    - An MCP test shows `export_artboard` called with `artboardId` returns `isError: true` with code `INVALID_ARGS` and the exact message.
    - Runner passes.

- [x] **5. One stale rule everywhere.**
  - `readHandoffStatus` keeps its active-artboard requirement and fields. It computes `stale` with `compareCanvasHandoff` over a tolerant artboard scan (`tolerateHtmlDiskError: true`; no `canvas.json` read, because layout never affects staleness). Each frame passes `hash: hashHtml(html)`, or `undefined` when the scan marked that file unreadable. Never exported stays `stale: true`.
  - In `src/host/artboardDisk.ts` `snapshotFromCanvasView`, replace `lastExportHandoffStale` with `compareCanvasHandoff`:
    - `lastExport` is the `readManifest(manifestUri).lastExport` that function already reads.
    - `frames` are `view.frames`, each with `hash: hashHtml(frame.html)`, or `undefined` when `frame.errorMessage` is set.
    - Compute it whenever the view has frames, not only when the active frame exists.
    - Badge = `exported && stale`, so never exported keeps the badge off. The existing catch (log, badge on) stays.
  - Update the `handoff_status` description in `artboardTools.ts` to say stale means any frame's HTML changed, or a frame was added or removed since the last export.
  - Delete `compareHandoff` and `lastExportHandoffStale` if they have no callers left.
  - Done when:
    - `handoff_status` is `stale: false` right after a canvas export.
    - It is `true` after `update_artboard` on any one frame, after `set_artboard` of a new id, after deleting one artboard file, and after writing one artboard's HTML directly on disk without touching its meta.
    - It is `false` after `place_frame` moves or relabels a frame, and after `set_active_artboard`.
    - It is `true` against a legacy `lastExport` (no `frames`) when a second artboard exists.
    - Runner passes, and `pnpm check-types` is clean. The host path compiles; the badge is verified at F5 in step 6.

- [x] **6. Docs and F5.**
  - In `.cursor/rules/02-mcp-webview.mdc` replace the line `- export_artboard / handoff_status` with:

    ```
    - export_artboard — exports every frame to handoff/<exportId>/ (IMPLEMENT.md, canvas.html, tokens.json, <group>/<id>/index.html); takes no artboardId
    - handoff_status — stale when any frame's HTML changed or a frame was added or removed since the last export
    ```

  - Update `cursor-design-agent-loop` / `README.md` only where they say export is active-only.
  - F5 on `fixtures/dev-workspace`. Its active artboard must be an existing artboard file; it is `t5-tall` today.
    1. Run **Export Handoff** and inspect the new `handoff/canvas-*/` tree.
    2. Open its `canvas.html` in Chrome from disk.
    3. Edit one frame's HTML and watch the badge.
    4. Call `place_frame` on a frame and watch the badge.
  - Done when:
    - The info message names the new handoff path.
    - The tree has one folder per group plus `ungrouped/` for the fixture, and one `index.html` per artboard file (orphan `t5-mobile` absent).
    - In Chrome, opened from disk (`file://`), `canvas.html` shows labeled frames and group headings at their layout positions.
    - Each frame grows to its full content height with no inner scrollbar, and stacked frames don't overlap. `t5-tall` is fully visible, and `t5-vhhero` freezes instead of growing to 20000.
    - Wheel over a frame scrolls the page.
    - Missing images from relative `assets/` are expected and not a failure.
    - After the watcher refresh that follows the export's manifest write (wait about a second), the stale badge is hidden.
    - The badge appears after editing one frame's HTML, and does not appear after a `place_frame` move.
    - `pnpm compile` passes and `dist/mcp.js` exists. Runner, `pnpm check-types` and `pnpm lint` pass.

- [x] **7. Repair F-10: export fails on an unparsable meta.**
  - In the export read phase only, an existing meta file that is not JSON, or fails `parseMeta` (including a bad id), throws `CorruptMetaError(frameId)` with the parse error as `cause`. A missing meta stays `undefined`, and a foreign-id meta stays `CorruptMetaError`. Every other `readStoredMeta` caller keeps today's tolerant behavior.
  - Done when:
    - A temp-workspace test with one frame's meta replaced by `{ not json` rejects with `CORRUPT_META` for that id and leaves no `handoff/<exportId>/` leaf. So does a meta with `generation: 0`, and its meta file stays byte-unchanged.
    - The existing foreign-id and missing-meta tests still pass. Runner, `pnpm check-types` and `pnpm lint` pass.

## Files / areas

- `package.json`, `pnpm-lock.yaml` (`zod` direct dependency)
- `src/disk/parse.ts` (zod schemas for manifest, meta, `LastExport`; `frames`)
- `src/disk/errors.ts` (`NoArtboardsToExportError`)
- `src/disk/handoff.ts` (export id, group folders, IMPLEMENT.md, `compareCanvasHandoff`)
- `src/disk/handoffCanvasHtml.ts` + `src/disk/handoffCanvasHtml.test.ts` (new)
- `src/disk/artboardFs.ts` (`exportArtboard`, `writeHandoffLeaf`, `writeManifestLastExport`, `readHandoffStatus`, result types)
- `src/disk/layout.ts` (`CANVAS_PREVIEW_FILE = 'canvas.html'`, `UNGROUPED_FOLDER = 'ungrouped'`)
- `src/disk/handoff.test.ts`, `src/mcp/artboardTools.test.ts`
- `src/mcp/artboardTools.ts` (`export_artboard` schema properties/description/handler, `handoff_status` description)
- `src/commands/exportHandoff.ts`
- `src/host/artboardDisk.ts` (`lastExportHandoffStale` → `compareCanvasHandoff`)
- `.cursor/rules/02-mcp-webview.mdc`. Also `.cursor/skills/cursor-design-agent-loop/` and `README.md`, only if they state active-only export.
- `blueprint/context/coding-standards.md` "Stack (locked)": add `- **Validation:** \`zod\` v4 (same range as the MCP SDK) via \`import * as z from 'zod/mini'\` for disk JSON files in \`src/disk/parse.ts\`. MCP tool inputs stay passthrough \`fromJsonSchema\` + authored errors; chrome stays dependency-free.`
- Imported unchanged by `handoffCanvasHtml.ts`: `src/panel/artboardCanvasRuntime.ts` (`ARTBOARD_CANVAS_RUNTIME_SOURCE`, message types) and `src/panel/stageGeometry.ts` (`STAGE_GEOMETRY_SOURCE`, used for `nextFrameHeight`).
- Reference only: `src/disk/canvasLayout.ts` (`resolveCanvasFrames`, `parseFrameGroup`), `src/disk/effectiveMeta.ts`, `src/panel/artboardChromeScript.ts` (message allowlist and height-guard wiring to mirror)

## Data / contracts

**Validation with zod (`src/disk/parse.ts`):**
- Import `* as z` from `zod/mini` (decided 2026-10-18 after measuring: classic `zod` added ~430 KB to the minified host bundle, mostly locales). Schemas are module-level constants next to the functions that use them.
- Each exported `parse*` calls `safeParse`, and on failure throws the existing authored error with the `ZodError` as `cause` only. A zod message never reaches UI or MCP text (`06-error-handling.mdc` safe messages).
- **Manifest:**
  - A non-record value, or a `version` that isn't an integer, throws `CorruptManifestError`. `version !== 1` throws `UnsupportedSchemaVersionError(version)`. This dispatch is a small pre-check before the object schema, so the two error classes stay distinct.
  - `activeArtboardId` is a required string. Empty or invalid-charset values become `''` (transform); a non-string is corrupt.
  - `workspaceFolder` and `updatedAt` are non-empty strings. `lastExport` is optional.
- **`LastExport`:**
  - `exportId` and `exportedAt` are non-empty strings, and `exportedAt` must parse with `Date.parse`.
  - `artboardId` must match the artboard-id regex. `artboardHash` is refined with `isArtboardHash`.
  - `frames` is added in step 1.
- **Meta:**
  - `id` goes through `parseArtboardId` first, so `InvalidArtboardIdError` stays the error for a bad id. Everything after that throws `CorruptMetaError(id)`.
  - `title` is a string, `generation` an integer ≥ 1, `hash` refined with `isArtboardHash`, `updatedAt` a non-empty string.
  - `viewport` uses `.catch(DEFAULT_VIEWPORT)`, so any non-string or empty value defaults, exactly as today.
- **Output:**
  - Objects strip unknown keys (the zod default, same as today's hand-built objects).
  - Key order follows the schema shape and equals today's serialized order.
  - Absent optional keys (`lastExport`, `frames`) stay absent, never `undefined`. `viewport` is always present after parse.
- **Not used at the MCP tool boundary:** a strict zod `inputSchema` makes `@modelcontextprotocol/server` 2.2.0 answer with its own `Input validation error: Invalid arguments for tool …` text instead of this repo's authored `{ code, message }` results, so tool schemas stay passthrough `fromJsonSchema`.

**Export id:**
- Format: `canvas-<now.toISOString() with - : . removed>`, for example `canvas-20261018T101500123Z`.
- A same-millisecond collision keeps today's authored `DiskError`: "Handoff folder already exists. Retry export_artboard."

**Frame set and order:**
- The set is `resolveCanvasFrames({ stored, artboards })` over the strict scan, and drops orphans.
- Each frame's `label`, `x`, `y`, `width`, `group` come from the resolved frame. Auto-placed frames get `width` 1280 and the title (or id) as label.
- Folder order, IMPLEMENT.md order, `canvas.html` order and `lastExport.frames` order all follow resolved order.

**Handoff tree** (`.cursor-design/handoff/<exportId>/`):

```
IMPLEMENT.md
canvas.html
tokens.json                      (workspace tokens.json copied byte-for-byte, else today's stub)
<group-folder>/<frame-id>/index.html
ungrouped/<frame-id>/index.html
```

**Group folder rule (`assignGroupFolders`):**
1. A frame has no group when `group` is absent. `parseCanvasLayout` already turns `""` into absent. Any other string, including whitespace-only, is a group, matching the panel, which draws a heading for it.
2. If any frame has no group, reserve `ungrouped` first.
3. Walk distinct `group` strings (exact match, case-sensitive) in first-appearance order. Build the base slug:
   - lowercase;
   - replace each run of characters outside `[a-z0-9]` with `-`;
   - trim edge `-`;
   - cap at 64 characters and re-trim a trailing `-`;
   - if the result is empty, use `group`.
4. Use the base slug when it's free, otherwise the first free `<base>-2`, `<base>-3`, …. A folder is taken when it's reserved or already assigned. So `Desktop` and `desktop` become `desktop` and `desktop-2`, and a group named `Ungrouped` becomes `ungrouped-2` when frames without a group exist.
5. The frame folder is the frame id, verbatim. Ids `.` and `..` (accepted by `parseArtboardId`) throw an authored `DiskError`, for example `Artboard id ".." cannot be exported as a folder. Rename artboards/...html.` (id and file shown). Nothing is written.

**`IMPLEMENT.md`** (labels and group names go through the existing `collapseMarkdownHeaderValue`; otherwise plain text):

```markdown
# Implement this canvas

exportId: <exportId>
exportedAt: <ISO>
frames: <count>

## Frames

### <group name> (`<folder>/`)

- <label> - id `<id>`, width <width>, hash `<artboardHash>`, file `<folder>/<id>/index.html`

### (no group) (`ungrouped/`)

- …

## Files

- canvas.html - view-only preview of the canvas layout; open it in a browser. It embeds preview copies with a measuring script; never implement from it
- tokens.json
- <folder>/<id>/index.html - one complete document per frame

## Instructions

1. Call `handoff_status` first. If `stale` is true, call `export_artboard` again (it exports the whole canvas) before implementing.
2. If MCP is unavailable, compare each frame's `hash` above with `.cursor-design/artboards/<id>.meta.json` `hash`, and the frame list with `.cursor-design/artboards/*.html`. On any difference, re-export, or ask the user to run **Export Handoff**.
3. Implement each frame from its own `index.html` (HTML+CSS+JS inline), not from screenshots or `canvas.html`.
4. Frames are separate documents. Never merge their CSS or JS into one document. Each frame's `width` is the viewport it was designed at.
5. Target the user's app entry files. Never copy `.cursor-design/` into the app.
6. Keep semantic structure, classes, and behavior.
7. Assets referenced as `assets/...` resolve against `.cursor-design/assets/`. Copy them manually.
```

- Sections appear in first-appearance order over resolved frames, with the no-group section counted like any group. This is listing order only; the folder rule still reserves `ungrouped` first.
- Frames within a section keep resolved order.
- The no-group heading is always `(no group)`, so it never collides with a stored group named `Ungrouped`, whose heading is `Ungrouped` with folder `ungrouped-2/`.

**Pristine lock scope (Bombic 2026-10-18):** "export HTML stays pristine / no canvas code" covers every frame's `index.html`, which stays byte-equal to disk. The view-only `canvas.html` may embed *preview copies* of frames with the height runtime injected. `IMPLEMENT.md` already says never to implement from `canvas.html`.

**`canvas.html`** (self-measuring view-only preview at scale 1, no external resources, all lengths in CSS `px`):
- **Document:** `<!DOCTYPE html>`, `<meta charset="UTF-8">`, `<title>Canvas preview <exportId></title>`, one inline `<style>` and one inline `<script>` (the preview controller) at the end of `<body>`.
  - Structure (absolute positioning, sizes) is contracted. Colors and fonts are neutral system styling, checked only at F5. It's a preview page, not chrome, so it uses no `--vscode-*` tokens.
  - No CSP meta: `srcdoc` frames inherit the parent's CSP, and one would block the designs' own inline scripts and styles. Frames stay isolated by the sandbox (opaque origin).
- **Boxes** (frame height starts at the provisional 800, the same as the panel's `PROVISIONAL_FRAME_HEIGHT`, and then follows measurements):
  - Each frame's label is at `(x, y - 24)`, sized `width × 24`.
  - Each frame is at `(x, y)`, sized `width × height`.
  - Each non-empty group gets one heading at `(minX, minY - 24 - 32)`, sized `(maxRight - minX) × 32`, taken over that group's frames. This is the `layoutCanvasChrome` rule; frames without a group get no heading.
  - Every box shifts by `(48 - minLeft, 48 - minTop)` over labels, headings and frame tops. These depend only on x/y/width, so they're computed once at build time.
  - The body is `position: relative`. Its height is `max(shifted frame bottom) + 48`, and its width is `max(shifted right) + 48`. The controller recomputes both when a height changes, so the page scrolls normally.
- **Frame markup:**
  - `<iframe data-cd-frame="<id>" sandbox="allow-scripts" scrolling="no" title="<label>" srcdoc="<escaped preview copy>">`, absolutely positioned, with no `src`.
  - Labels and headings are `<div>` text. Every interpolated label, group name, id and title is HTML-escaped (`& < > " '`). The `srcdoc` value is the preview copy, attribute-escaped the same way.
- **Preview copy (`buildPreviewFrameHtml`):** the frame's exact HTML with one block inserted:
  - The block is `<base href="<folder>/<id>/"><script data-cd-canvas-runtime>` + `ARTBOARD_CANVAS_RUNTIME_SOURCE` + `</script>`. Path segments go through `encodeURIComponent`.
  - The block goes right after the first `<head…>` start tag (case-insensitive), else right after the first `<html…>` start tag, else at the very start.
  - The base makes relative URLs resolve as they would for that frame's own `index.html`.
  - String insertion only: no parsing and no other change. The runtime source is already guaranteed free of `<`, so it can't close its script.
- **Preview controller** (plain JS in the parent `<script>`, free of `</`):
  - It inlines `STAGE_GEOMETRY_SOURCE` for `nextFrameHeight`, and holds a frame table `[{ id, height: 800, guard: { lastGrowth: 0, frozen: false } }]` built from the frames.
  - On `message`, it accepts only events whose `event.source` is the `contentWindow` of an iframe in that table, and whose `data` is a record with an allowlisted `type`. Everything else is ignored.
  - `cd:frame-height` with a finite `height`: apply `nextFrameHeight` (the same 20000 clamp and `100vh` freeze as the panel), set the iframe's height, then recompute the body size.
  - `cd:frame-wheel` with finite `deltaX`/`deltaY`: when `ctrlKey` is false, `window.scrollBy(deltaX, deltaY)`; ctrl / pinch is ignored. That keeps page scroll working over frames, since the runtime cancels the in-frame wheel.
  - Nothing is ever posted to frames.
- `ponytail:` notes in the module:
  - `canvas.html` carries every frame's HTML a second time, with no size cap.
  - If scripts are off or a frame never reports, it stays 800 tall.
  - `assets/` is not copied, so relative images may be missing.
  - An empty artboard file previews as an empty frame (no error tile).

**`manifest.lastExport` after a canvas export:**

```json
{
  "exportId": "canvas-…",
  "artboardId": "<legacy frame id>",
  "artboardHash": "<that frame's hash>",
  "exportedAt": "<ISO>",
  "frames": [{ "artboardId": "<id>", "artboardHash": "sha256:<hex>" }]
}
```

- The legacy frame is the active artboard if it's in the exported set, else the first exported frame. A 0.1 reader therefore still sees a valid single-artboard record.
- `frames[].artboardHash` = `hashHtml(scan html)`, which equals `effectiveArtboardMeta(...).hash`.
- Manifest `activeArtboardId` = the existing active id if non-empty, else the legacy frame id. That's today's "export activates when empty" rule, applied on both entry points. `updatedAt` = `exportedAt`, and `version` stays 1.

**Stale rule (`compareCanvasHandoff`):**
- With no `lastExport` it returns `{ exported: false, stale: false }`. `handoff_status` still reports `stale: true` in that case (today's behavior), and the badge stays off.
- The recorded set is `lastExport.frames`, or `[{ artboardId, artboardHash }]` when `frames` is absent (legacy).
- Current and recorded entries are paired by `artboardId`; order is ignored.
- `stale` is true when:
  - the current id set differs from the recorded id set, or
  - any current entry's `hash` is `undefined`, or
  - any current entry's `hash` differs from its recorded hash under `normalizeHash`.
- Both callers pass `hashHtml` of the HTML they just read, never a stored meta hash. Layout fields are never compared.

**`export_artboard`:**
- Input: `{ rootPath? }`, with the schema still passthrough.
- Any provided `artboardId` gives `isError: true`, code `INVALID_ARGS`, message `export_artboard exports every frame. Omit artboardId and retry.`
- Description: `Export every frame on the canvas to .cursor-design/handoff/<exportId>/ (IMPLEMENT.md, canvas.html, tokens.json, <group>/<id>/index.html) and record lastExport. Takes no artboardId. Call this before implementing from a handoff. Does not bump generation. Pass rootPath when more than one folder is open.`
- Result:

```json
{
  "exportId": "canvas-…",
  "exportedAt": "<ISO>",
  "handoffPath": ".cursor-design/handoff/<exportId>",
  "frames": [{ "artboardId": "hero", "artboardHash": "sha256:…", "path": "desktop/hero/index.html" }]
}
```

**Errors** (all `CursorDesignError` subclasses with authored, safe copy: no absolute paths, no HTML bodies):
- **No artboards** (dir missing or zero frames): the new `NoArtboardsToExportError extends CursorDesignError`, `code = 'ARTBOARD_NOT_FOUND'`, message `No artboards to export. Ask the agent to \`set_artboard\` first.` `ArtboardNotFoundError` is unchanged.
- **Corrupt or unsupported `canvas.json`:** the existing `CorruptCanvasError` / `UnsupportedCanvasVersionError`.
- **Unreadable HTML, symlink, or non-regular file:** the existing strict-scan `DiskError`, with the relative path.
- **Corrupt existing meta:** `CorruptMetaError`.
- **`.`/`..` id, or leaf collision:** as above.
- The command shows `error.message` for every `CursorDesignError`, and for anything else logs it and shows the generic message.

**Write safety:**
- Every read error fires before the leaf `mkdir`, so a failed read writes nothing.
- A write failure mid-tree may leave a partial leaf. The existing `ponytail:` no-journal note stays: orphan dirs are harmless and never deleted.
- The manifest is written last, so `lastExport` never points at a leaf whose write failed before the manifest write.

**Trust boundaries:**
- The only writers are the MCP process (stdio, workspace root resolved by the existing `runQueued`) and the host command (trusted-workspace check unchanged).
- Labels and group names are Agent-controlled text. They are HTML-escaped in `canvas.html` and newline-collapsed in `IMPLEMENT.md`, and they never become paths: folders come from the slug rule and validated ids.

## Testing

- Zod migration: the existing parse/manifest/meta tests are the regression net and must pass unedited. New tests add the canonical round-trips, the missing-viewport default, and the no-zod-text-in-message check.
- Pure tests:
  - `assignGroupFolders`, `makeCanvasExportId`, `buildCanvasImplementMarkdown` and `compareCanvasHandoff` in `src/disk/handoff.test.ts`.
  - `buildCanvasPreviewHtml` and `buildPreviewFrameHtml` in the new `src/disk/handoffCanvasHtml.test.ts`: escaping, `srcdoc` round-trip, injection point, layout offsets, and the single parent script. The controller's message handling and the height growth run only in a browser, so they're verified at F5. `nextFrameHeight` itself is already unit-tested in `stageGeometry.test.ts`.
  - The `parseLastExport` frames cases.
- Disk integration on temp workspaces (the existing `mkdtemp` pattern in `handoff.test.ts`): the four-artboard tree, a missing `canvas.json`, a missing meta, byte-equality, legacy fields, error cases that write nothing, status transitions (including an HTML edit without a meta write), and `lastExport.frames` preserved by other writers.
- MCP: `export_artboard` rejects `artboardId` with the authored result. Update description/schema assertions if `artboardTools.test.ts` makes them.
- Not unit-tested: the host badge wiring and `canvas.html` rendering and measuring in a browser. Both are verified at F5 in step 6. Do not claim browser rendering or badge behavior until F5 has run.

## Notes for the AI

- Measured 2026-10-18: the SDK's zod was tree-shaken out of `dist/mcp.js`, so zod is new weight in both bundles. With `import * as z from 'zod/mini'`, production sizes are `dist/extension.js` 56 KB → 92 KB and `dist/mcp.js` 426 KB → 442 KB (classic `zod`: 489 KB / 757 KB).
- Ponytail: reuse `scanArtboardFiles`, `resolveCanvasFrames`, `readCanvasLayoutFile`, `readStoredMeta`, `effectiveArtboardMeta`, `readTokensJsonForExport`, `writeUtf8`, `ensureDir`, `workspaceLayoutFile`, `collapseMarkdownHeaderValue`, `normalizeHash`, `hashHtml`. Add no new runtime dependency besides `zod`. Don't add a frame-count or payload ceiling; if one is tempting, leave a `ponytail:` note instead.
- Pristine is identity, not filtering: write the exact `html` string from the scan to each `index.html`. Only `buildPreviewFrameHtml` may produce a modified copy, and its output goes only into `canvas.html`'s `srcdoc`.
- Importing the two `src/panel/` string-source modules into `src/disk/` is deliberate reuse. They're plain string exports with no `vscode` or DOM dependency, and they bundle into `dist/mcp.js` too. If either later gains such a dependency, move the shared string to `src/disk/` instead of copying it.
- Paths are always built from `handoffDirSegments(exportId)` plus the validated folder and id segments.
- Old handoff folders and their old-style `IMPLEMENT.md` (which say "re-export that artboardId") stay untouched. An Agent following one gets the `INVALID_ARGS` next step.
- MCP disk ops stay serialized by the existing `runQueued` / `enqueueDiskOp`. Export runs as one queued op covering the whole read and write.
- The fixture's `canvas.json` contains the orphan `t5-mobile` and duplicate labels across ids (`Tall`, `VH Hero`). Folders use ids, so duplicate labels are fine. `.cursor-design/` is git-ignored, so the fixture state is local; F5 needs its active artboard to be an existing file.
- Keep error copy free of absolute paths. `handoffPath` stays workspace-relative.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":38928,"specSha256":"e750b6e5333bbaf013f2e2f4275d5f73aeb25846f7f0acf91d8217d99af50406","branch":"refs/heads/feature/canvas-export","head":"eee1a216f30b3d65e5859128bdfeeb799acd6a51","baseRef":"refs/heads/main","baseCommit":"1349a054b3b1034e51a5bd212fbb36868d6a8933","sourceTree":"f274f522477e041a22e330cb9c8778196ddf201a","absentOptional":[]} -->

## Findings

### 6e/F-07 [P3] invalid - PANEL_CSP.md Files section names the pre-extraction file

**File:** PANEL_CSP.md:76-77
**Found:** 2026-09-12 by /audit (scope: current; lens: quality)
**Why it matters:** The doc says the CSP fix lives in `src/panel/openArtboardPanel.ts` only, but `stampArtboardHtml` and the chrome template were extracted to `src/panel/artboardChromeHtml.ts`. A reader looking for the stamping code opens the wrong file.
**Suggested fix:** Name both files: `openArtboardPanel.ts` (`cspNonce` message, flush attach) and `artboardChromeHtml.ts` (chrome template, `stampArtboardHtml`).
**Resolution:** Invalid 2026-10-18 by /audit (scope: current): `PANEL_CSP.md` is absent from the repo (glob 0 matches). The cited lines no longer exist, so the stale Files pointer is not reproducible.

### 6e/F-10 [P1] closed - Export overwrites unparsable meta instead of failing CORRUPT_META

**File:** src/disk/artboardFs.ts:441
**Found:** 2026-10-18 by /audit (scope: current; lens: quality)
**Why it matters:** Feature 6e requires an existing unparsable meta file to throw `CorruptMetaError` and write no `handoff/<exportId>/` leaf. `readStoredMeta` still treats `SyntaxError`, `CorruptMetaError`, and `InvalidArtboardIdError` as missing (`undefined`). `exportArtboard` then stamps a new meta and writes the leaf. Only a foreign-id meta fails export. A broken `*.meta.json` is silently replaced, and the spec's unparsable-meta case is untested (the suite uses foreign-id and comments that unparsable is treated as missing).
**Suggested fix:** In the export read phase only, if the meta file exists and parse fails, throw `CorruptMetaError` (do not reuse the list-tolerant swallow). Keep a missing file as `undefined`. Add the unparsable-meta temp-workspace test the spec already names.
**Resolution:** Closed 2026-10-18 by /audit (scope: current; lens: quality). Re-reviewed `readStoredMeta` (`src/disk/artboardFs.ts:429`) and `exportArtboard` (`:1151`): export-only `{ rejectUnparsable: true }` wraps benign parse failures as `CorruptMetaError` with cause before `writeHandoffLeaf`; missing meta stays `undefined`; foreign-id still throws; other callers stay tolerant. Test `unparsable or invalid meta fails export with CORRUPT_META and writes nothing` covers `{ not json` and `generation: 0`, asserts no leaf and byte-unchanged meta. Repair introduced no new defect.

### 6e/F-11 [P2] closed - Canvas preview controller and host badge are unproven pending F5

**File:** src/disk/handoffCanvasHtml.ts:143
**Found:** 2026-10-18 by /audit (scope: current; lens: tests)
**Why it matters:** Step 6 is still unchecked. Unit tests cover `canvas.html` build contracts (escape, srcdoc, injection, offsets, one parent script) and `handoff_status` stale transitions. They do not run the preview controller (`cd:frame-height` / `cd:frame-wheel`), height freeze, `file://` layout, or the chrome stale badge after export / HTML edit / `place_frame`. The spec says those are F5-only and must not be claimed until F5 runs.
**Suggested fix:** Run the step 6 F5 checklist on `fixtures/dev-workspace` (Export Handoff, open `canvas.html` from disk, edit one frame, `place_frame`) before treating preview measuring or the badge as done.
**Resolution:** Closed 2026-10-18 by /audit (scope: current; lens: tests). Spec status is `verified` with step 6 checked (F5 2026-10-18). Recorded F5 evidence: export tree (desktop/, mobile/, ungrouped/, 14 frames, orphan t5-mobile absent), `file://` canvas.html (positions, t5-tall 2222px, t5-vhhero froze at 1600, wheel scrolls page), badge hidden after export, shown after update_artboard, `handoff_status` stale:false after `place_frame`. This pass re-reviewed `handoffCanvasHtml.ts` (escape, sandbox, srcdoc, allowlisted messages) and host `compareCanvasHandoff` badge wiring; unit contracts still hold. This audit did not re-run F5.

## Independent review

**Status:** passed
**Target commit:** eee1a216f30b3d65e5859128bdfeeb799acd6a51
**Base commit:** 1349a054b3b1034e51a5bd212fbb36868d6a8933
**Base ref:** refs/heads/main
**Spec hash:** e750b6e5333bbaf013f2e2f4275d5f73aeb25846f7f0acf91d8217d99af50406
**Prepared by:** cursor
**Builder model:** Cursor Grok 4.6
**Requested reviewer:** cursor
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-18T15:07:32Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** cursor
**Reviewer model:** Cursor Grok 4.6
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-18T15:09:57Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `pnpm check-types`: pass
- `pnpm lint`: pass
- `./node_modules/.bin/tsc -p . --outDir out && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`: pass (177 pass, 0 fail)
- `pnpm test` (Electron): unavailable
- F5 Extension Development Host: unavailable
- `oxfmt --check` / `pnpm fmt:check`: unavailable
- dependency vulnerability scan: unavailable
- `pnpm compile`: unavailable (not run; writes `dist/`)

## Evidence

- Preflight: HEAD `eee1a216f30b3d65e5859128bdfeeb799acd6a51`; merge-base of `refs/heads/main` with target `1349a054b3b1034e51a5bd212fbb36868d6a8933`; SHA-256 of `blueprint/context/current-feature.md` `e750b6e5333bbaf013f2e2f4275d5f73aeb25846f7f0acf91d8217d99af50406`; dirty paths only `blueprint/context/review.md`.
- Reviewed committed delta `1349a05..eee1a21` plus tracked spec: export planning (`handoff.ts`), `canvas.html` builder, `exportArtboard` / `readHandoffStatus`, zod parsers, MCP/command/host wiring, colocated tests.
- Security: labels/srcdoc escaped; iframe `sandbox="allow-scripts"` without `src`; preview controller allowlists `event.source` plus `cd:frame-height` / `cd:frame-wheel`; parent script rejects `</`; export writes `index.html` from scan HTML only; `.` / `..` ids fail before mkdir; unparsable meta is `CORRUPT_META` with no leaf; MCP `artboardId` rejected with authored `INVALID_ARGS`; no zod text in thrown messages.
- Tests: unofficial runner 177/177; covers frames round-trip, folder/IMPLEMENT/stale rules, pristine tree, error-writes-nothing, F-10 unparsable meta, MCP `artboardId` reject. Host badge and live `canvas.html` measuring remain F5-only (spec step 6 claimed 2026-10-18; this pass did not re-run F5).

## Findings

- F-09 [P3] open (leftover Blueprint manifest drift; not re-examined; not required to pass)
- F-12 [P3] open (README trial still names the 0.1 root `index.html` tree)
- F-07 invalid, F-10 closed, F-11 closed (unchanged)

## Remaining risk

- `pnpm test` Electron (`vscode-test`) was not run; `AGENTS.md` does not declare the Blueprint test gate.
- F5 Extension Development Host / `file://` canvas.html / chrome stale badge not re-run in this reviewer session.
- `oxfmt --check` / `pnpm fmt:check` not run.
- No dependency or advisory scan; `zod` added as a direct dependency (lockfile has one `zod@4.5.4`).
- `pnpm compile` not run (writes `dist/`); production bundle size not re-measured.
- `canvas.html` duplicates every frame with no size cap (documented ponytail); host snapshot hashes every frame on each refresh; unverified without profiling.
- Chrome `srcdoc` injection is string-based, so a hostile `<head>` in comments can mis-inject the preview copy only (exported `index.html` stays pristine).
