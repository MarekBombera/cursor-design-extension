# Feature: Contract

**From build-plan:** feature 6b
**Build attempt:** 1
**Branch:** `feature/contract`
**Status:** verified

## Goal

First slice of the 0.2 multi-frame canvas. It lays the data and math foundation that the Stage (6c) and Frames (6d) build on, with no panel UI change:

- `.cursor-design/canvas.json` is read and written through the disk library, with strict parsing and safe failure.
- A new MCP tool `place_frame` positions, sizes, labels, and groups one frame.
- `list_artboards` also returns the resolved layout, so the Agent can arrange frames without overlap.
- A pure, unit-tested stage geometry module covers zoom, clamps, fit-all, and screen↔stage coordinates.

Contracts follow the Notion 0.2 page (rewritten 2026-10-13, "Disk + MCP contract", locked by Tech).

## In scope

- `src/disk/layout.ts`: `CANVAS_FILE = 'canvas.json'`, `canvasPathSegments = [CURSOR_DESIGN_DIR, CANVAS_FILE]`, `CANVAS_SCHEMA_VERSION = 1`, `DEFAULT_FRAME_WIDTH = 1280`, `MIN_FRAME_WIDTH = 120`, `MAX_FRAME_WIDTH = 3840`, `FRAME_GAP = 24`.
- `src/disk/errors.ts`, same shape as the manifest error pair:
  - `CorruptCanvasError` (`CORRUPT_CANVAS`). Message: "Canvas layout is invalid. Fix or restore .cursor-design/canvas.json (version 1), or delete it to auto-place every frame."
  - `UnsupportedCanvasVersionError` (`UNSUPPORTED_CANVAS_VERSION`, `readonly version`). Message: "Canvas layout version N is unsupported (expected 1). Fix .cursor-design/canvas.json or delete it to auto-place every frame."
- New pure module `src/disk/canvasLayout.ts` (no I/O, no `vscode`):
  - Types `CanvasFrame = { id: string; label: string; x: number; y: number; width: number; group?: string }` and `CanvasLayout = { version: 1; frames: CanvasFrame[] }`.
  - Clamp and placement values come from the `layout.ts` constants (`MIN_FRAME_WIDTH`, `MAX_FRAME_WIDTH`, `DEFAULT_FRAME_WIDTH`, `FRAME_GAP`, `CANVAS_SCHEMA_VERSION`). Never re-type `120`, `3840`, `1280`, `24`, or `1` in code, tests, or docs.
  - `parseCanvasLayout(value: unknown): CanvasLayout`. "Record" below means `typeof value === 'object' && value !== null && !Array.isArray(value)` (mirror `isJsonRecord` in `parse.ts`).
    - The root must be a record; otherwise `CorruptCanvasError`. This covers `null`, arrays, and primitives.
    - `version` must satisfy `Number.isInteger`; otherwise `CorruptCanvasError` (so `'1'` and `1.5` are corrupt). An integer other than `CANVAS_SCHEMA_VERSION` throws `UnsupportedCanvasVersionError`.
    - `frames` must be an array; otherwise `CorruptCanvasError`.
    - Each frame must be a record with:
      - a valid artboard `id` (`parseArtboardId` rules; a failure maps to `CorruptCanvasError` with `cause`);
      - a string `label` (the empty string is valid and kept);
      - `x`, `y`, and `width` that satisfy `Number.isFinite`.
      - Otherwise `CorruptCanvasError`.
    - A duplicate `id` is `CorruptCanvasError`.
    - `width` is clamped to `[MIN_FRAME_WIDTH, MAX_FRAME_WIDTH]` on parse. This tolerates hand edits; it is not an error.
    - `group` is kept only when it is a non-empty string. An empty string or a missing key means no group, and the parsed frame has no `group` key. Any other type is `CorruptCanvasError`.
    - Unknown fields are dropped.
  - `serializeCanvasLayout(layout): string` is `JSON.stringify(layout, null, 2) + '\n'`, byte-identical in style to `serializeManifest`. Frames carry `group` only when it is a non-empty string, so an empty or absent group never reaches disk.
  - `resolveCanvasFrames({ stored, artboards })` returns `CanvasFrame[]`.
    - Inputs:
      - `stored: CanvasFrame[]` is the parsed `canvas.json` frames.
      - `artboards: { artboardId: string; title: string }[]` is walked in the order given, with no re-sort.
      - The only caller passes `listArtboards`' existing `artboards` order, which is sorted by `artboardId` with `localeCompare`.
    - Output:
      1. Every stored frame whose id is in `artboards`, in stored order, copied exactly as parsed. `label`, `x`, `y`, `width`, and `group` are unchanged, and the title is never overlaid. Orphans (stored ids with no listed artboard) are omitted from the result but stay in the file.
      2. Then every listed artboard with no stored frame, in the given order, auto-placed:
         - `x` is the greatest right edge (`x + width`) among frames already in the result, plus `FRAME_GAP`. `y` is the `y` of the frame that owns that edge (the earlier frame wins a tie).
         - When the result is still empty, the frame goes at `(0, 0)`.
         - `width` is `DEFAULT_FRAME_WIDTH`, and there is no `group` key.
         - `label` is the title, or the id when `title === ''` (no trim).
    - Auto-placed positions are computed, never written by a read.
  - `placeCanvasFrame({ layout, current, placement })` returns a new `CanvasLayout`.
    - Inputs:
      - `layout` is the **stored** layout parsed from `canvas.json`, never the resolved list.
      - `current` is the frame's resolved entry (stored or auto-placed).
      - `placement` is the partial update. Only keys that are present (not `undefined`) apply.
    - It builds the next frame from `current`, then applies `placement`:
      - `x`, `y`, and `label` replace when given.
      - `width` replaces when given and is clamped to `[MIN_FRAME_WIDTH, MAX_FRAME_WIDTH]`.
      - `group` replaces when given; an empty string deletes the key.
    - It replaces the stored entry with the same id in place, or appends when that id is not stored. Every other stored frame is kept byte-for-byte, orphans included. Unplaced siblings are never added.
    - `placement` with no fields upserts `current` unchanged. For an auto-placed frame, that persists its current auto-placed `x`, `y`, `width`, and `label`.
- `src/disk/artboardFs.ts`:
  - Private `readCanvasLayoutFile(workspaceRoot): Promise<CanvasLayout>`:
    - It reads `canvasPathSegments` through `readUtf8IfExists`, so a symlink or non-file is `DiskError`.
    - A missing file returns `{ version: CANVAS_SCHEMA_VERSION, frames: [] }`.
    - Otherwise it runs `JSON.parse`, where a throw is `CorruptCanvasError` with `cause`, then returns `parseCanvasLayout(parsedJson)`. So a version 2 file, duplicate ids, and bad fields fail the read itself.
  - `listArtboards` result gains `frames: CanvasFrame[]`:
    - When the `artboards/` dir is missing, it keeps today's early return, now `{ activeArtboardId: '', artboards: [], frames: [] }`, and `canvas.json` is not read.
    - Otherwise, after the existing scan, it calls `readCanvasLayoutFile`, even when no artboards were found, so a broken file surfaces early. Then `frames = resolveCanvasFrames({ stored: layout.frames, artboards })`, passing artboards as `{ artboardId, title }` in the sorted list order.
    - A corrupt or unsupported `canvas.json` fails the list with that error, like a corrupt manifest does today.
  - New exported `placeFrame({ workspaceRoot, id, x, y, width, label, group }): Promise<{ frames: CanvasFrame[] }>`. Every input is `unknown`. In order:
    1. Validate the args and write nothing on failure:
       - `id` must be a string passing `parseArtboardId` (`INVALID_ARTBOARD_ID`).
       - Then check in the order `x`, `y`, `width`, `label`, `group`. "Absent" means `=== undefined`. `x`, `y`, and `width` otherwise must satisfy `Number.isFinite`. `label` and `group` otherwise must be strings. `null` and every other type are `INVALID_ARGS`, and the message names the field (for example "x must be a finite number. Fix args and retry."). The first failure wins.
    2. `assertLayoutDirsOwned`, then `requireExactHtmlFileName(workspaceRoot, id)`. A missing artboard is `ARTBOARD_NOT_FOUND` and nothing is written.
    3. `stored = await readCanvasLayoutFile(workspaceRoot)`. A corrupt or unsupported file fails here and is never rewritten.
    4. `listed = await listArtboards({ workspaceRoot })`, and `current` is its `frames` entry for `id`.
    5. `next = placeCanvasFrame({ layout: stored, current, placement: { x, y, width, label, group } })`.
    6. `ensureDir` for `.cursor-design/`, then `writeUtf8` with `serializeCanvasLayout(next)` at `canvasPathSegments` (atomic temp file and rename).
    7. Return `{ frames: resolveCanvasFrames({ stored: next.frames, artboards: listed.artboards }) }`, the same shape as `list_artboards.frames`. The returned list is never what gets written.
- MCP:
  - `src/mcp/toolNames.ts`: `PLACE_FRAME_TOOL = 'place_frame'`.
  - `src/mcp/artboardTools.ts`:
    - Add `id`, `x`, `y`, `width`, `label`, `group` to `ToolArgs`, plus a permissive `placeFrameInputSchema` with field descriptions that state the width clamp, `group: ""` clears, and omitted fields keep their value. Add it to `artboardToolInputSchemas`.
    - `registerTool(PLACE_FRAME_TOOL, …)` through `runQueued`, with annotations `{ destructiveHint: false, idempotentHint: true, openWorldHint: false }`. The description says it updates one frame in `.cursor-design/canvas.json`, returns every frame, and that height is never stored.
    - Update the `list_artboards` description to mention `frames` (stage layout, auto-placed when missing from `canvas.json`).
- Docs:
  - `README.md` tool list gets a `place_frame` line, and the `list_artboards` line mentions layout.
  - `.cursor/skills/cursor-design-agent-loop/SKILL.md` tool list adds `place_frame`, with one line: call `list_artboards` to read `frames` before placing, and avoid overlap.
  - `.cursor/rules/02-mcp-webview.mdc` adds a `place_frame` bullet under MCP tools and `canvas.json` to the Disk line.
- New pure module `src/panel/stageGeometry.ts` exporting `STAGE_GEOMETRY_SOURCE: string`. These are plain JS declarations for 6c to inline raw into the chrome `<script>`; tests evaluate them through `node:vm`. Each function is an arrow function taking one object and returns new values. There is no DOM, and nothing outside the source and `Math` is referenced. The source contains no backtick, no `${`, and no `</`.
  - View `{ x, y, zoom }` maps stage px to screen px: `screen = stage * zoom + translate`. This is exactly CSSOM `translate(x, y) scale(zoom)` with origin `0 0`.
  - Constants inside the source: `MIN_STAGE_ZOOM = 0.1`, `MAX_STAGE_ZOOM = 4`, `ZOOM_STEP_CAP = 0.2`, `ZOOM_SENSITIVITY = 0.01`, `FIT_PADDING = 48`, `KEEP_VISIBLE = 48`.
  - `stageToScreen({ view, stageX, stageY })` and `screenToStage({ view, screenX, screenY })` return `{ x, y }`.
  - `zoomStageAt({ view, deltaY, screenX, screenY })`:
    - Clamp `view.zoom` to `[MIN, MAX]` first, so a zero or negative input zoom cannot divide by zero.
    - `step = clamp(-deltaY * ZOOM_SENSITIVITY, -ZOOM_STEP_CAP, ZOOM_STEP_CAP)`, then `zoom = clamp(fromZoom * Math.exp(step), MIN, MAX)`.
    - The new `x = screenX - (screenX - view.x) * zoom / fromZoom` (same for `y`), so the stage point under `(screenX, screenY)` stays under it.
    - `screenToStage` and `stageToScreen` assume a positive zoom. Callers pass views that came out of these functions.
  - `panStage({ view, deltaX, deltaY })`: `x - deltaX`, `y - deltaY`.
  - `frameBounds({ frames })`, with frames as `{ x, y, width, height }` (6c/6d supply `height`), returns the union rect `{ x, y, width, height }`, or `null` for an empty list.
  - `clampStageView({ view, bounds, viewportWidth, viewportHeight })`:
    - The viewport is `[0, viewportWidth] × [0, viewportHeight]` in screen space (the `stageToScreen` output space).
    - Always clamp `zoom` to `[MIN, MAX]` first.
    - When `bounds === null`, `viewportWidth <= 0`, or `viewportHeight <= 0`, return the clamped zoom with `x` and `y` unchanged.
    - Otherwise, per axis (shown for x; y uses `bounds.y`, `bounds.height`, and `viewportHeight`):
      - `scaledWidth = bounds.width * zoom`
      - `keepX = Math.min(KEEP_VISIBLE, scaledWidth, viewportWidth)`
      - Clamp `x` to `[keepX - scaledWidth - bounds.x * zoom, viewportWidth - keepX - bounds.x * zoom]`.
    - This interval never inverts, because `keepX` is at most `scaledWidth` and at most `viewportWidth`. Frames can never be panned fully out of view, even in a narrow panel.
  - `fitStageView({ bounds, viewportWidth, viewportHeight })`:
    - Return `{ x: 0, y: 0, zoom: 1 }` when any of these hold: `bounds === null`, `bounds.width <= 0`, `bounds.height <= 0`, `viewportWidth <= 2 * FIT_PADDING`, or `viewportHeight <= 2 * FIT_PADDING`.
    - Otherwise `zoom = clamp(Math.min((viewportWidth - 2 * FIT_PADDING) / bounds.width, (viewportHeight - 2 * FIT_PADDING) / bounds.height, 1), MIN, MAX)`. Fit never zooms past 100%.
    - Center the bounds: `x = (viewportWidth - bounds.width * zoom) / 2 - bounds.x * zoom`, and the same for `y`.
- Tests (existing `node:test` setup, files next to source):
  - New `src/disk/canvasLayout.test.ts` (pure):
    - Parse a valid layout, including an empty-string `label`.
    - Each corrupt case is `CORRUPT_CANVAS`:
      - the root is `null`, `[]`, or a string;
      - `version` is `'1'` or `1.5`;
      - `frames` is missing;
      - a frame is `null` or an array;
      - an id is invalid;
      - `x` is non-finite;
      - `group` is a number;
      - an id appears twice.
    - Version 2 is `UNSUPPORTED_CANVAS_VERSION`.
    - Width clamps on read (50 → `MIN_FRAME_WIDTH`, 9999 → `MAX_FRAME_WIDTH`). An empty `group` drops, and the parsed frame has no `group` key.
    - Serialize equals `JSON.stringify(layout, null, 2) + '\n'`, round-trips, and never writes `group` when it is absent or empty.
    - Resolve:
      - Keeps stored order and drops orphans.
      - Copies stored frames unchanged; a title change does not alter a stored label.
      - Auto-places at `(0, 0)` when empty.
      - Auto-places right of the greatest right edge with a 24px gap at that frame's `y`.
      - Places several missing frames in id order, each after the previous.
      - Falls back from title to id for the label.
    - Placement:
      - Partial update keeps the other fields.
      - Width clamps.
      - `group: ""` deletes the key.
      - Appends when not stored.
      - Keeps an orphan stored entry.
      - An empty placement upserts the auto-placed `current`.
  - `src/mcp/artboardTools.test.ts`, through the captured handlers:
    - `place_frame` happy path: the file bytes equal `serializeCanvasLayout` of the expected layout, and the result returns `frames`.
    - With a `canvas.json` holding an orphan id plus two HTML artboards, `place_frame` on one id leaves the orphan entry in the file and does not store the unplaced sibling. The returned `frames` still includes that sibling, auto-placed.
    - `list_artboards` returns `frames` that include an auto-placed artboard.
    - Error cases, each leaving `canvas.json` unchanged or absent:
      - Unknown id is `ARTBOARD_NOT_FOUND` and no file is created.
      - `x: '10'`, `x: null`, and `width: '300'` are `INVALID_ARGS`.
      - A corrupt `canvas.json` is `CORRUPT_CANVAS` and the bytes are unchanged.
      - A version 2 `canvas.json` is `UNSUPPORTED_CANVAS_VERSION` and the bytes are unchanged.
      - A symlinked `canvas.json` is `DISK_ERROR`.
  - New `src/panel/stageGeometry.test.ts` runs `runInNewContext(STAGE_GEOMETRY_SOURCE + '\n;({ … })')`; a fresh vm context already has its own `Math`. It compares fields with a `1e-9` tolerance (vm objects come from another realm, so not `deepStrictEqual`), and every clamp and fit case asserts numeric expected `x`, `y`, and `zoom`:
    - Screen↔stage round-trip at zoom 0.25, 1, and 3.
    - Zoom:
      - direction;
      - step cap (deltaY 100 and 1000 give equal results);
      - exact clamps at 0.1 and 4;
      - the anchor point stays fixed under the cursor;
      - an input zoom of 0 yields a finite view.
    - Pan direction.
    - `frameBounds` union and `null` for empty.
    - `clampStageView`:
      - Large bounds against a 800×600 viewport stop with exactly 48px of bounds visible at each edge.
      - Bounds whose scaled size is under 48 keep their full scaled size visible.
      - A 30×30 viewport keeps 30px.
      - `null` bounds clamp only the zoom.
    - `fitStageView`:
      - centers per the formula;
      - caps at 1 for small bounds;
      - returns the default for `null` bounds, zero-size bounds, and a 50×50 viewport.
    - The source has no backtick, `${`, or `</`.

## Out of scope

- Any panel or chrome change: stage, frames, labels, toolbar, presets, persisted view, `cd:frame-height` / `cd:frame-wheel` (6c/6d). `stageGeometry.ts` is not inlined into chrome yet, and the shipped 6a chrome zoom constants (50–200%) stay as they are until 6c replaces them.
- Canvas export, `lastExport.frames`, `handoff_status` changes (6e).
- Mouse dragging or resizing of frames, frame deletion, pruning orphan entries.
- Writing auto-placed positions on read, or from `set_artboard` / `update_artboard` (they stay unchanged).
- Host watcher changes: `canvas.json` writes may trigger the existing debounced refresh, which re-posts the active artboard; the chrome skips identical HTML.
- `src/panel/**` except the new geometry files, `src/host/**`, `package.json`, manifest schema.

## Build loop

`workflow.stepReview: "feature"`: implement all steps, then one review packet. `checkpointCommits: "disabled"`. `/complete` makes the feature commit on `feature/contract`. Per Bombic, stop after the phase for an F5 check (Step 4) before `/complete`.

## Build steps

- [x] **Step 1 - `canvas.json` contract (pure)** - Layout constants, the two error classes, `canvasLayout.ts` (`parseCanvasLayout`, `serializeCanvasLayout`, `resolveCanvasFrames`, `placeCanvasFrame`), and `canvasLayout.test.ts`. *Done when:* `pnpm check-types`, `pnpm lint`, and `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js` pass, including the new cases. The tests fail if the version check, duplicate-id check, width clamp, orphan drop, or auto-placement rule is broken.
- [x] **Step 2 - Disk + MCP wiring** - `readCanvasLayoutFile`, `frames` in `listArtboards`, `placeFrame`, `PLACE_FRAME_TOOL` registration and schema, the `list_artboards` description, the MCP tests, and the README, agent-loop skill, and rule 02 doc lines. *Done when:* the same three commands pass, and every error case listed in Tests leaves `canvas.json` byte-identical or absent.
- [x] **Step 3 - Stage geometry module** - `stageGeometry.ts` and `stageGeometry.test.ts`. *Done when:* the same three commands pass. The tests fail if the step cap, zoom clamp, anchor math, keep-visible clamp, fit cap, or round-trip is broken.
- [x] **Step 4 - F5 MCP check** - `pnpm compile` (confirm `dist/mcp.js`), then F5 on `fixtures/dev-workspace`. The fixture has five artboards locally: `artboard`, `canvas-6a`, `canvas-6b`, `hero`, and `hero-alt`. `.cursor-design/` is gitignored, so a clean clone has none; create ids with `set_artboard` first, or use the ids the first `list_artboards` returns. Delete `.cursor-design/canvas.json` there if it exists. Ask the Cursor Agent to call `list_artboards`, then `place_frame({ id: "hero", group: "Desktop" })`, then `place_frame({ id: "hero-alt", width: 390, group: "Mobile" })`, then `list_artboards` again. *Done when:*
  - `canvas.json` holds exactly two frames. `hero` keeps its auto-placed `x`, `y`, `width`, and `label` with `group: "Desktop"`. `hero-alt` has `width: 390` and `group: "Mobile"`.
  - The second list returns those two first, then `artboard`, `canvas-6a`, and `canvas-6b` auto-placed to the right. The panel still shows the active artboard exactly as before. A `place_frame` with an unknown id returns `ARTBOARD_NOT_FOUND`.

## Files / areas

- `src/disk/layout.ts`, `src/disk/errors.ts`
- `src/disk/canvasLayout.ts` (new), `src/disk/canvasLayout.test.ts` (new)
- `src/disk/artboardFs.ts`
- `src/mcp/toolNames.ts`, `src/mcp/artboardTools.ts`, `src/mcp/artboardTools.test.ts`
- `src/panel/stageGeometry.ts` (new), `src/panel/stageGeometry.test.ts` (new)
- `README.md`, `.cursor/skills/cursor-design-agent-loop/SKILL.md`, `.cursor/rules/02-mcp-webview.mdc`

## Data / contracts

- `canvas.json` (new, `.cursor-design/canvas.json`, regular file only): `{ "version": 1, "frames": [{ "id", "label", "x", "y", "width", "group"? }] }`.
  - `id` is the artboard id and is unique.
  - `x`, `y`, and `width` are finite numbers in stage px.
  - A hand-edited `width` on disk can be any finite number. Parsed and written values are always in `[MIN_FRAME_WIDTH, MAX_FRAME_WIDTH]`, and a parse never rewrites the file. New frames default to `DEFAULT_FRAME_WIDTH`.
  - `group` is a non-empty string or absent. `label` can be any string, including empty.
  - Height is never stored. A missing file equals an empty layout. Unknown fields are dropped on rewrite.
- `manifest.json` is unchanged.
- `place_frame` args: `{ id: string, x?: number, y?: number, width?: number, label?: string, group?: string, rootPath?: string }`. `id` follows the Notion contract name, unlike other tools' `artboardId`.
  - Success: `{ frames: CanvasFrame[] }`.
  - `place_frame({ id })` with no other fields persists the frame's current resolved values. For an unplaced frame, that pins its auto-placed position.
  - Invalid args are checked in the order `id`, `x`, `y`, `width`, `label`, `group`. `null` is invalid, not absent.
  - Errors (existing JSON error shape, `isError: true`): `INVALID_ARTBOARD_ID`, `INVALID_ARGS`, `ARTBOARD_NOT_FOUND` (with `artboardId`), `CORRUPT_CANVAS`, `UNSUPPORTED_CANVAS_VERSION`, `DISK_ERROR`, `INVALID_ROOT`, `NO_WORKSPACE`. A corrupt or unsupported `manifest.json` also fails the tool (`CORRUPT_MANIFEST`, `UNSUPPORTED_SCHEMA_VERSION`), because `place_frame` resolves frames through `listArtboards`, same as `list_artboards`. Nothing is written.
- `list_artboards` success: `{ activeArtboardId, artboards, frames }`. This is additive, and the existing fields are unchanged.
- Resolved frame order: stored frames (in file order, existing artboards only), then auto-placed frames (in id order). Auto-placement is deterministic for a given disk state. An unplaced frame can shift when a new artboard with an earlier id appears, until it is placed.
- Every write goes through the process-wide `enqueueDiskOp`. The last writer wins against concurrent hand edits, which is the same ceiling as the manifest today.
- Stage view `{ x, y, zoom }`: chrome-only, never on disk. `screen = stage * zoom + (x, y)`.

## Testing

No Verify command is declared. Runner (from 6a): `pnpm compile-tests && node --test out/disk/*.test.js out/mcp/*.test.js out/panel/*.test.js`. If `pnpm` aborts on the no-TTY modules purge prompt, use `./node_modules/.bin/tsc -p . --outDir out && node --test …`. New test files land in the existing globs. Disk and MCP tests use temp workspace roots (the existing `makeTempRoot` / `withWorkspaceRootsEnv` pattern). Geometry is tested by evaluating the exact shipped source string through `node:vm`. The Agent-driven MCP flow is proven only by the Step 4 F5 check. No browser tests.

## Notes for the AI

- Repository facts at spec time:
  - `artboardFs.ts` (913 lines) holds all disk I/O, with private helpers `readUtf8IfExists`, `writeUtf8` (atomic, symlink-safe), `assertLayoutDirsOwned`, `requireExactHtmlFileName`, and `workspaceLayoutFile`. Reuse them, and keep only the pure logic in the new `canvasLayout.ts`.
  - `parse.ts` has `parseArtboardId` and the manifest parse/serialize pattern to mirror.
  - MCP tools use permissive schemas (`additionalProperties: true`) so wrong-typed args reach the handler as authored `INVALID_ARGS`; keep that for `place_frame`.
  - `runQueued` resolves the root and serializes through `enqueueDiskOp`.
  - The host watcher in `src/host/watchArtboardDisk.ts` debounces `.cursor-design/` changes.
- The old superseded 6b work is in `git stash` ("old-6b gestures-zoom-math"). Its well-clamp geometry does not apply to the stage, so do not unstash it here. Its nested-scroll walk is for 6d.
- Source-string geometry follows the 6a pattern: the chrome has no bundler, and minified `toString()` would break cross-function references. `<` is fine in chrome (unlike the blob runtime), so only `</`, backticks, and `${` are banned.
- Zoom range 10–400%, fit capped at 100%, 48px padding, and 48px keep-visible are reversible tuning values, not stored data (see Open questions).
- Label text comes from the Agent or a hand edit. 6b only stores it. 6d must render it as `textContent`, never HTML.
- Security: `place_frame` can only touch `canvas.json` under the resolved workspace root. The `id` charset blocks path segments, and symlinked `.cursor-design/`, `artboards/`, and `canvas.json` are rejected. Nothing from `canvas.json` reaches HTML in 6b.
- Accessibility: no UI in 6b.
- No em dashes in docs or comments.

## Open questions

- **Stage zoom range.** The rewritten Notion page drops the old 50–200% range and names none. This spec defaults to 10–400%, so fit-all can show a desktop page, a mobile page, and sections side by side in a normal panel, with fit capped at 100%. Confirm, or name a range. 6c presets will sit inside it.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":25024,"specSha256":"78658484f4bafdc450e5b057a72b0562041811e15be701add46f8d870ff6f254","branch":"refs/heads/feature/contract","head":"f71f508672e0c39132daccefa20adaa81d2ae291","baseRef":"refs/heads/main","baseCommit":"f71f508672e0c39132daccefa20adaa81d2ae291","sourceTree":"8be4a7ccb3f78263ccda4e91c1b6cfe0f44b442d","absentOptional":[]} -->
