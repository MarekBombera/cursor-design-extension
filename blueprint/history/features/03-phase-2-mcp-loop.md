# Feature: Phase 2 MCP loop

**From build-plan:** feature 3
**Build attempt:** 1
**Branch:** `feature/phase-2-mcp-loop`
**Status:** verified

## Goal

Cursor Agent can create, list, read, switch, and iterate artboards through five MCP tools against disk SoT. `update_artboard` rejects stale `baseGeneration` / `baseHash`. The panel still renders disk when MCP is unregistered, and chrome shows an MCP-unavailable banner. Done when two variant ids exist, switching active updates the iframe, and a wrong generation returns `conflict` without clobbering HTML.

## In scope

- Five tools only: `set_artboard`, `update_artboard`, `read_artboard`, `list_artboards`, `set_active_artboard`. No `open_artboard`. No `export_artboard` / `handoff_status`.
- Tool names live in one TypeScript module (imported by MCP handlers). Env names live next to `CURSOR_DESIGN_WORKSPACE_ROOT_ENV` in `src/mcp/mcpIdentity.ts` (`CURSOR_DESIGN_WORKSPACE_ROOTS_ENV`). Host / MCP / chrome TypeScript must import those constants. README and skills may list the five tool names and the two env names; they must match the module. Do not scatter a third copy in host/MCP/chrome source.
- MCP process uses `node:fs` against the resolved workspace folder. Do not import `vscode` into `src/mcp/server.ts` or the MCP esbuild bundle. Host keeps `vscode.workspace.fs` in `src/host/artboardDisk.ts`. **Two I/O leaves, shared parse/hash/layout/errors only.** Host must not import node:fs CRUD. MCP read/list must not call host `reconcileMeta`. MCP writers are `set_artboard`, `update_artboard`, and `set_active_artboard` (manifest `activeArtboardId` only). Host Open Artboard / watcher still write as today.
- Shared SoT stays in `src/disk/`: layout segments (including ensure-panel filename), schema `1`, parse/serialize, hash, `nextGeneration`, named errors. Add node:fs CRUD beside that, not a second schema.
- `set_artboard` creates a new id (`html` required string; empty string is allowed). **No layout** means the `.cursor-design/` directory is absent: create `.cursor-design/` + `manifest.json` and **only** that id (`generation: 1`, hash of the given HTML). If `.cursor-design/` exists but `manifest.json` is missing, write this id and create the manifest; still do not run Phase 1 default-id `artboard` init. Always set `activeArtboardId` to that id on success. Existence is the `.html` file: create it with exclusive create (`wx` or equivalent). `EEXIST` → `code: "ARTBOARD_EXISTS"`; do not overwrite HTML, do not write the marker, do not ensure the panel. An orphan `.meta.json` without HTML does not count as exists (create may replace that meta). `wx` is in-process only; host-vs-MCP races stay last-writer-wins (`ponytail:`).
- `update_artboard` replaces HTML for an existing id. Requires `baseGeneration` and/or `baseHash` (at least one). Mismatch -> `isError` with `code: "conflict"` plus the compared current generation and/or hash. Agent must `read_artboard` then retry. Missing both, or malformed generation/hash -> `INVALID_ARGS`, not a silent write. HTML exists but meta missing/unparseable -> `CORRUPT_META`; do not write, do not mint, do not treat as generation `0`.
- `read_artboard`: `artboardId` optional, default active. Returns HTML + meta fields below. Does not write. Does not bump generation. Success `html` is allowed in MCP `content`. `isError` results, chrome banners, and other success bodies must not include HTML/JS/handoff bodies. HTML exists but meta missing/unparseable -> `CORRUPT_META` (do not return a partial success object and do not mint). Do not add optional `generation?` on the success body.
- `list_artboards`: only files matching `artboards/*.html`. Include `generation` only when meta parses; omit it when meta is missing or corrupt. `title` is parsed title or `""`. No HTML bodies. Does not write or mint meta. Missing `.cursor-design/` or missing `artboards/` → `{ activeArtboardId: "", artboards: [] }` (not `NO_WORKSPACE`). Missing manifest → still list HTML files with `activeArtboardId: ""`. Present-but-corrupt manifest → `CORRUPT_MANIFEST` (do not guess active).
- `set_active_artboard`: require an id whose `.html` exists (meta not required); rewrite manifest `activeArtboardId` only; host watcher reloads the panel if it is open **and** the write root is the first folder. Does not open the panel.
- MCP serializes **all** disk ops (read, list, and write) on one process-wide queue in the MCP/write leaf, not in `parse.ts` (`ponytail:` coarser than per-id; upgrade if a second writer is proven). This prevents MCP reads from observing an in-process torn HTML/meta pair. Host `vscode.workspace.fs` is **not** on this queue. Agents must still treat same-id writes as ordered.
- Workspace resolution (MCP), in order: (1) `rootPath` if provided must **exactly** equal one host-passed `fsPath` (no prefix, no `.` / `..` rewrite); if it does not, `INVALID_ROOT` and do not `stat` outside that list. (2) Else if exactly one passed folder contains `.cursor-design/`, use it. (3) Else if there is exactly one passed folder, use it. (4) Else `ambiguous_workspace` (two or more passed folders with `.cursor-design/`, or two or more folders and none unique). Do not pick via `manifest.workspaceFolder`. MCP cannot see the active editor; that Notion fallback is out.
- Host passes every `workspaceFolders` `fsPath` into the MCP env without spreading `process.env`. Keep `CURSOR_DESIGN_WORKSPACE_ROOT` as the first folder or `""`. Add `CURSOR_DESIGN_WORKSPACE_ROOTS` as a JSON array of all folder `fsPath`s. Valid `ROOTS`: a JSON **array of non-empty strings**. `null`, `{}`, `[1]`, `[""]`, mixed types → treat as invalid. If `ROOTS` is missing or invalid, fall back to non-empty `CURSOR_DESIGN_WORKSPACE_ROOT`, else `NO_WORKSPACE`.
- On `activate`: if trusted, unregister-then-register stdio; if not, do not register and do not write. `onDidGrantWorkspaceTrust` uses the same split (it does not fire when already trusted). One **replaceable** MCP registration disposable (do not stack unregister disposables on re-register). Re-register on `onDidChangeWorkspaceFolders` and grant-trust; skip when untrusted; after every attempt set `mcpAvailable` and post `ui:status` if chrome is up.
- On activate, grant-trust, and folder change: dispose/recreate the first-folder `.cursor-design/**` watcher when a trusted first folder exists (or `ensure` when a folder appears). Marker-open must not depend on Open Artboard having run.
- No folder / empty roots: MCP `code: "NO_WORKSPACE"`. Host Open Artboard toast stays as Phase 1.
- `package.json` `capabilities.untrustedWorkspaces.supported` stays **`false`**. Do not flip it to `limited` in this feature. With that, the extension typically does not activate until trust, so grant-trust / stripped-chrome paths are defense in depth and may never run. If `isTrusted` is false anyway: no MCP register, no disk write, no iframe HTML (Phase 1 `snapshotForChrome`), ignore the ensure-panel marker. Phase 2 does not ship a separate untrusted Open Artboard UX.
- Missing `dist/mcp.js`: do not `registerServer`; `mcpAvailable: false`; OutputChannel relative `dist/mcp.js` only.
- Panel ensure: only `set_artboard` (and the Open Artboard command) may open/reveal the panel. Ordinary HTML/meta/manifest saves must not. Marker path is layout constant `ENSURE_PANEL_FILE` = `.ensure-panel` at `.cursor-design/.ensure-panel` (not under `artboards/`, not an Agent tool). Existence-only: ignore bytes; never eval/`innerHTML` them. One MCP queue item writes HTML + meta + manifest, **then** the marker.
- Marker watcher algorithm (same ~200ms debounce as Phase 1): keep a sticky `pendingMarkerEnsure` flag. Marker path **create/change** sets the flag. Marker path **delete** clears the flag and must not ensure-panel. Other `.cursor-design/**` events only schedule the debounce (refresh-if-open); they must not set or clear the flag. After debounce: if the flag is set **and** the marker file **still exists** and the workspace is trusted and the written root is `workspaceFolders[0]`, then `openArtboardPanel` singleton + reload active, delete the marker via `vscode.workspace.fs`, and clear the flag. If the flag is set but the marker is gone, untrusted, or not first-folder: clear the flag and do not ensure. Leftover marker + a later HTML save must not open a closed panel (HTML save does not set the flag). Untrusted: ignore marker (do not delete it from the untrusted path).
- `set_artboard` on a resolved root that is **not** `workspaceFolders[0]`: still write disk there; **do not** write the marker; success includes `panelEnsured: false`. On first-folder success: write marker; success includes `panelEnsured: true`. `panelEnsured` means **the marker was written**, not that the panel is visible (host may still be hidden until the watcher runs).
- Chrome (still host-built in `src/panel/openArtboardPanel.ts`, not Svelte): host -> chrome `ui:status` `{ mcpAvailable }`. If `mcpAvailable` is not a boolean, ignore. Banner when `mcpAvailable === false`; textContent copy exactly: `MCP unavailable. Artboard still loads from disk.` `ui:status` must not clear iframe HTML or id/generation badges. Disk `artboard:error` may show at the same time. Do not add handoff-stale UI.
- `mcpAvailable` is host registration outcome only: `vscode.cursor.mcp` missing, skipped untrusted, missing `dist/mcp.js`, or `registerServer` throw -> false. Successful register -> true. Do not heartbeat the stdio child. Do not claim to detect Agent allowlist denial (file fallback stays in the agent-loop skill + README).
- Tool execution failures (validation, conflict, missing files, `node:fs` EACCES/ENOSPC/unexpected) return `isError: true` with authored JSON. Never protocol `-32603` unless the MCP process is dying. Unexpected IO uses `code: "DISK_ERROR"`. No stacks, secrets, install paths, or home paths in MCP `content` or chrome.
- Last-writer-wins applies to **host vscode.fs vs MCP node:fs in one window** and to two windows on the same folder (`ponytail:`). There is no cross-process lock. MCP write order: HTML, then meta, then manifest, then marker (marker only when specified). Tool success only if every file that queue item intended was written. If HTML (or a later file) is written and a subsequent write throws: return `DISK_ERROR`, do not write the marker, do not claim success. Do **not** add a temp+rename journal or two-phase commit (`ponytail:`; Agent `read_artboard` after unexpected `DISK_ERROR` / `conflict`). Phase 1 hash-equality stays: matching hash -> **no** extra generation bump. A torn **host** read may extra-bump meta only.
- Conflict helper is pure (expected vs actual generation and/or hash). One check file `src/disk/conflict.test.ts` covering the helper **and** temp-dir CRUD (wrong generation does not change HTML). Test must not import `vscode`. Run: `pnpm compile-tests && node --test out/disk/conflict.test.js` (not `node --experimental-strip-types` on `src/`; this package is CJS with extensionless imports — verified `ERR_MODULE_NOT_FOUND` on Node 24). Do not add a Blueprint `test` / Verify command or change `pnpm test` / `.vscode-test.mjs`.
- README: replace the Phase 0 "zero tools" line; list the five tools and allowlist + file fallback.
- Keep Phase 1 blob iframe, CSP, debounce ~200ms, first-folder host I/O for Open Artboard / Reveal, engines `^1.128.0`.

## Out of scope

- `export_artboard`, `handoff_status`, `lastExport`, stale badge, `IMPLEMENT.md`, `tokens.json`, `assets/`, size warnings.
- Svelte 5 + Vite + `src/webview/` (Phase 1 host chrome stays).
- Separate `css` payload or `.css` artboard files. CSS lives inside the HTML document.
- Gallery UI, `open_artboard`, CustomTextEditor, aux window, in-panel chat, `vscode.lm`, `@modelcontextprotocol/sdk`.
- Spreading `process.env`; `activationEvents: ["*"]`; opening the panel on activate, on HTML save, or on `set_active_artboard`.
- Blueprint `/tests`, `/ci`, Verify, or treating `pnpm test` as a gate.
- Changing `untrustedWorkspaces.supported`, temp+rename journals, optional `read_artboard` success fields, detecting Agent allowlist denial, heartbeat of the stdio child.

## Build loop

`workflow.stepReview` is `feature`: one review packet after all steps. `workflow.checkpointCommits` is `disabled`. `/complete` creates the final feature commit.

## Build steps

- [x] **Step 1 - Disk CRUD + conflict** - Node:fs readers/writers in `src/disk/` (create, update with generation/hash check, read, list `artboards/*.html`, set active). Named errors including `conflict` / `ARTBOARD_EXISTS` / `ARTBOARD_NOT_FOUND` / `NO_WORKSPACE` / `ambiguous_workspace` / `INVALID_ROOT` / `INVALID_ARGS` / `DISK_ERROR`. Pure conflict helper + `src/disk/conflict.test.ts` (temp dir: wrong generation does not change HTML). Host `artboardDisk.ts` still compiles and still uses `vscode.workspace.fs`; it must not import node:fs CRUD. *Done when:* `pnpm compile-tests && node --test out/disk/conflict.test.js`, `pnpm check-types`, and `pnpm lint` pass.

- [x] **Step 2 - Five MCP tools** - Tool-name module. `src/mcp/server.ts` registers the five tools on `@modelcontextprotocol/server` v2, reads workspace roots from env, runs handlers behind the write queue, maps domain errors to `isError: true`. Do not register export tools. Stderr only for unexpected failures (no `console.log`). Queue lives in the MCP/write leaf, not `parse.ts`. Queue includes read and list. *Done when:* `pnpm compile` writes `dist/mcp.js` and `dist/extension.js`; `dist/mcp.js` has no `vscode` require.

- [x] **Step 3 - Host roots, trust, panel marker** - Register env includes `CURSOR_DESIGN_WORKSPACE_ROOTS`. Activate: register only if trusted. Grant-trust + folder-change: one replaceable MCP disposable; dispose/recreate first-folder watcher. Watcher: sticky marker flag as specified; other `.cursor-design/**` events keep Phase 1 refresh-only. README five-tool allowlist. *Done when:* `pnpm compile` passes. Live marker-open and HTML-save-does-not-open are Step 5.

- [x] **Step 4 - MCP-unavailable banner** - Host posts `ui:status` `{ mcpAvailable }` after every register attempt and when chrome sends `artboard:ready`. Locked banner copy. Iframe still shows disk HTML. *Done when:* `pnpm check-types` and `pnpm lint` pass. Banner pixels are Step 5.

- [x] **Step 5 - Run Extension Phase 2 gate** - F5 -> `fixtures/dev-workspace` -> allowlist `cursor-design` (toggle off/on if Settings still shows 0 tools). Agent or MCP client: `set_artboard` twice (two ids, panel opens/reveals), `set_active_artboard` switches the iframe, `update_artboard` with current `baseGeneration` iterates, wrong `baseGeneration` returns `conflict` and leaves HTML, `list_artboards` / `read_artboard` match disk. Saving `artboards/*.html` does not open a second panel. Banner: `mcpAvailable: false` (missing `dist/mcp.js` or non-Cursor host) shows the locked copy and disk HTML still paints; successful Cursor register hides it. *Done when:* that pass is recorded. Do not claim it without running it. *Evidence 2026-09-11 (Bombic F5 in fixtures/dev-workspace): 8/8 tool steps green (hero + hero-alt created, active switched, generation 1->2, baseGeneration 999 -> conflict with HTML intact, list matches disk); panel opened/revealed, iframe switched, no second panel, banner hidden.*

## Files / areas

- `src/disk/` - layout (`.ensure-panel`), errors, parse, node:fs CRUD, conflict helper + `conflict.test.ts`
- `src/mcp/server.ts`, `src/mcp/mcpIdentity.ts` (ROOT + ROOTS env), new tool-name module, optional `src/mcp/tools/*` if `server.ts` would mix handlers with transport
- `src/mcp/registerCursorDesignMcp.ts` - env roots, untrusted skip, replaceable disposable, folder-change / grant-trust re-register
- `src/host/watchArtboardDisk.ts`, `src/panel/openArtboardPanel.ts` - marker ensure-panel; `ui:status`
- `src/extension.ts` - wire trust + folder change + watcher ensure when a trusted folder exists
- `README.md` - five tools, allowlist, file fallback
- Leave Reveal/Export command stubs, blob iframe CSP, `esbuild.js` dual outfiles, engines `^1.128.0`

## Data / contracts

**MCP tool names (locked):** `set_artboard` | `update_artboard` | `read_artboard` | `list_artboards` | `set_active_artboard`

**Common args:** `rootPath?: string` (workspace folder `fsPath`, exact match). Ids: same charset as `parseArtboardId` (`[a-zA-Z0-9._-]+`).

**Defaults:** `set_artboard` omitted `title` -> `Artboard`; omitted `viewport` -> `1280x800`. `update_artboard` omitted title/viewport keep parsed meta; if meta missing, do not apply defaults (that path is `CORRUPT_META`).

| Tool | Args | Success body (JSON text) |
|---|---|---|
| `set_artboard` | `artboardId`, `html` (required); `title?`, `viewport?`, `rootPath?` | `{ artboardId, generation, hash, title, viewport, active: true, panelEnsured }` |
| `update_artboard` | `artboardId`, `html` (required); `baseGeneration?: number`; `baseHash?: string`; `title?`, `viewport?`; `rootPath?` | `{ artboardId, generation, hash, title, viewport }` |
| `read_artboard` | `artboardId?` (default active); `rootPath?` | `{ artboardId, title, generation, hash, viewport, html, updatedAt, active }` |
| `list_artboards` | `rootPath?` | `{ activeArtboardId, artboards: [{ artboardId, title, active, generation? }] }` |
| `set_active_artboard` | `artboardId` (required); `rootPath?` | `{ activeArtboardId }` |

`update_artboard` is invalid unless `baseGeneration` is an integer `>= 1` and/or `baseHash` matches `sha256:` + 64 hex (same pattern as `parseMeta`: hex may be `A-F` or `a-f`). Normalize hex to lowercase before comparing to disk. If both are sent, both must match disk.

`read_artboard` with omitted id and no valid active, or read/update/set_active whose `.html` is absent: `ARTBOARD_NOT_FOUND` (do not mint). No valid active includes missing manifest and empty/invalid `activeArtboardId`. `ARTBOARD_HTML_MISSING` stays host chrome when manifest points at a missing **active** file (Phase 1). `set_active_artboard` "existing id" means that HTML file exists.

**MCP error JSON** (also `isError: true`; `text` is the JSON string): `{ code, artboardId?, expectedGeneration?, actualGeneration?, expectedHash?, actualHash?, message }` where `message` is authored next-step copy. Do not use a single untyped `{ expected, actual }` pair. On `conflict`, include only the fields that were compared (generation and/or hash).

| `code` | When | Next step in `message` |
|---|---|---|
| `NO_WORKSPACE` | no folder / empty roots / invalid ROOTS with empty ROOT | Open a workspace folder |
| `INVALID_ROOT` | `rootPath` set but not an exact host-passed `fsPath` | Pass a `rootPath` from `CURSOR_DESIGN_WORKSPACE_ROOTS` |
| `ambiguous_workspace` | `rootPath` omitted and two or more candidate roots | Pass `rootPath` |
| `INVALID_ARGS` | missing/non-string `html`; missing `artboardId` where required; both `baseGeneration` and `baseHash` absent; non-integer `baseGeneration`; `baseHash` not `sha256:`+64 hex | Fix args and retry |
| `ARTBOARD_EXISTS` | `set_artboard` id already has HTML | `update_artboard` or a new id |
| `ARTBOARD_NOT_FOUND` | read/update/set_active missing HTML id; read with no valid active | `list_artboards` then `set_artboard` / `set_active_artboard` |
| `conflict` | generation/hash mismatch | `read_artboard`, retry with current `baseGeneration` |
| `INVALID_ARTBOARD_ID` | id charset | Use letters, digits, dot, underscore, hyphen |
| `DISK_ERROR` | unexpected `node:fs` (permissions, space, etc.) | Check Output/stderr; fix folder permissions |
| `CORRUPT_MANIFEST` / `UNSUPPORTED_SCHEMA_VERSION` | same as Phase 1 disk | Fix or restore `.cursor-design/manifest.json` |
| `CORRUPT_META` | read/update when HTML exists but meta is missing or unparseable; same parse failures as Phase 1 when meta is present | Restore `.cursor-design/artboards/<id>.meta.json` or `set_artboard` a new id |

**Disk:** unchanged Phase 1 layout plus `.cursor-design/.ensure-panel`. Do not write `lastExport`. `set_artboard` / updates use the same meta hash (`sha256:` + hex of UTF-8 HTML) and monotonic generation. List/read must not mint files. `ARTBOARD_EXISTS` / `INVALID_ARGS` / `conflict` / `CORRUPT_META`: no HTML overwrite, no marker.

**Host messages:** keep `artboard:updated` / `artboard:error` / `artboard:ready`. Add `ui:status` `{ mcpAvailable: boolean }`. Ignore unknown `type`. Do not add `ui:export` / `ui:reveal` chrome handlers.

**Tenant:** MCP may write any host-passed folder via exact `rootPath`. Host Open Artboard / Reveal / watcher / panel-ensure stay first-folder (`workspaceFolders[0]`) unless that folder is untrusted. `set_artboard` sets `panelEnsured` from whether the marker was written. Two windows, same folder, and host-vs-MCP in one window: last clean writer wins (`ponytail:`).

## Testing

No Verify command in `AGENTS.md` Commands. No Blueprint test gate. Prove with `pnpm compile` / `pnpm check-types` / `pnpm lint`, `pnpm compile-tests && node --test out/disk/conflict.test.js`, and Step 5 F5.

Do not claim live MCP, allowlist, marker-open, banner pixels, or iframe evidence in Steps 1-4. `pnpm test` still runs the sample `vscode-test` suite only; do not put conflict checks there.

## Notes for the AI

- Adjudication vs [spec review](302ddf47-8ec0-48ae-8570-18bb646a2a1e) (2026-09-10), no P0:
  - **Took:** test command cannot be strip-types on `src/` (verified Node 24 `ERR_MODULE_NOT_FOUND`); `ROOTS` must be an array of non-empty strings; conflict payload uses generation/hash-specific fields; marker debounce needs a sticky flag; MCP writers include `set_active_artboard`; README/skills may list tool names; MCP queue includes reads; `set_artboard` HTML uses exclusive create (`wx`); missing meta is a defined error, not a guess.
  - **Rejected:** optional `read_artboard` success fields (use `CORRUPT_META` instead of a half-record). Temp+rename / 2PC for multi-file writes (return `DISK_ERROR` after partial write; Agent re-reads). Cross-process `ARTBOARD_EXISTS` guarantee (host-vs-MCP stays last-writer-wins). Stable-read retry loops. Flipping `untrustedWorkspaces` to `limited`. Renaming `panelEnsured`.
- Notion §12 Phase 2 is the gate: five tools, conflict path, MCP-offline banner, two variants + switch without hand-editing. Prefer Notion over chat when they disagree; this spec freezes Agent-facing arg names Notion left unnamed. Notion “atomic write” here means one queued MCP op that reports success only if every intended file was written — not a journal.
- Disk is SoT. MCP never opens a webview itself. Host never parses MCP JSON-RPC.
- Do not parent-`eval` / `innerHTML` artboard HTML. Keep blob iframe + `sandbox="allow-scripts"` (no `allow-same-origin`).
- Do not migrate chrome to Svelte on this branch.
- Leave Export stub. Do not create `handoff/`.
- Never claim Run Extension evidence that was not run.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":22813,"specSha256":"9c9b32d1fa9a2085f9a259050112e9995f0d1e0511951af18ee7c034fa74e3fd","branch":"refs/heads/feature/phase-2-mcp-loop","head":"01c40f501b66e1afe825ca6cd7a62549e82511f8","baseRef":"refs/heads/main","baseCommit":"01c40f501b66e1afe825ca6cd7a62549e82511f8","sourceTree":"ab91ec6af94e77d520d64c41c7c4a91235575f62","absentOptional":[]} -->

## Findings

### 3/F-01 [P1] closed - Disk CRUD follows symlinks and non-regular paths

**File:** src/disk/artboardFs.ts:133
**Found:** 2026-09-10 by /audit (scope: current; lens: security)
**Why it matters:** `pathExists` uses `stat` (follows links). `readFile` / `writeFile` do too. There is no `lstat` / `realpath` containment check. A trusted workspace can plant `artboards/<id>.html` as a symlink to a file outside `.cursor-design/` (or outside the folder). `read_artboard` then returns that file in the success `html` body; `update_artboard` overwrites the target. `list_artboards` / `set_active_artboard` also accept a directory named `*.html` because existence is `stat`, not "regular file under the layout". Tenant rule is MCP writes the resolved workspace folder via layout paths, not arbitrary targets.
**Suggested fix:** Before HTML/meta/manifest/marker read or write, `lstat` the path (and parents as needed). Reject symlinks and non-regular files. Resolve and confirm the real path stays under `{workspaceRoot}/.cursor-design/`. Return `DISK_ERROR` or `INVALID_ARGS` with authored copy; do not follow the link.
**Resolution:** 2026-09-11 fixed: lstat-based `layoutEntryKind` + `assertLayoutDirsOwned` on every CRUD op; symlink/non-regular HTML/meta/manifest/marker -> `DISK_ERROR` without following; list skips non-file `.html` entries; `wx` kept for create races. Tests: symlinked html rejected + target untouched, dir-as-html skipped, symlinked artboards dir rejected. Closed 2026-09-11 /audit: re-examined guards on all five CRUD ops + leaf read/write checks; 3 symlink tests pass; only the documented check-then-act TOCTOU remains.

### 3/F-02 [P1] closed - Chrome message listener treats iframe posts as host events

**File:** src/panel/openArtboardPanel.ts:203
**Found:** 2026-09-10 by /audit (scope: current; lens: security)
**Why it matters:** Rule 02: iframe → chrome `postMessage` is untrusted. The chrome `window` listener handles `artboard:updated`, `artboard:error`, and `ui:status` with no `event.source` check. The iframe is `sandbox="allow-scripts"` (no `allow-same-origin`), so artboard JS cannot touch `acquireVsCodeApi` or disk, but it can `parent.postMessage` and spoof badges, error copy, iframe HTML, and hide the MCP-unavailable banner. That is a missing guard on an explicit trust boundary, not a disk break.
**Suggested fix:** Ignore messages whose `event.source` is the iframe `contentWindow`. Host `postMessage` still arrives as the webview window.
**Resolution:** 2026-09-11 fixed: chrome message listener returns early when `event.source === iframe.contentWindow`. Closed 2026-09-11 /audit: re-examined listener; `iframe` is defined above the check; host posts cannot carry the iframe WindowProxy as source.

### 3/F-03 [P1] closed - SDK schema rejects typed-wrong args before authored INVALID_ARGS JSON

**File:** src/mcp/artboardTools.ts:55
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Spec locks tool-execution failures to `isError: true` with JSON `{ code, message, ... }`. `INVALID_ARGS` includes non-string `html`. Shared `fromJsonSchema` types `html` as `string`, so `set_artboard` with `html: 42` dies in SDK validation as plain `Input validation error...` and never reaches `toMcpToolError`. The same schema is used for all five tools, so Inspector also shows `html` / `baseGeneration` on list and set_active.
**Suggested fix:** Make each tool's JSON Schema permissive enough (or omit runtime types that collide) so handlers throw `InvalidArgsError`. Prefer per-tool schemas so unused properties are not advertised. Add a focused check that malformed `html` returns JSON `code: "INVALID_ARGS"`.
**Resolution:** 2026-09-11 fixed: five per-tool permissive input schemas (descriptions only, no type constraints); wrong-typed args reach handlers -> authored `INVALID_ARGS` JSON. Tests: set schema accepts `{html: 42}`; set/update handlers return `INVALID_ARGS` JSON. Closed 2026-09-11 /audit: re-examined all five schemas (no type constraints, per-tool props); schema-accept + handler-map tests pass.

### 3/F-04 [P1] closed - Empty or invalid activeArtboardId is CORRUPT_MANIFEST not ARTBOARD_NOT_FOUND

**File:** src/disk/parse.ts:52
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Spec: default `read_artboard` with no valid active, including empty or invalid `activeArtboardId`, is `ARTBOARD_NOT_FOUND`. `parseManifest` runs `parseArtboardId` on `activeArtboardId`; `""` and charset-invalid values become `InvalidArtboardIdError`, which `parseManifestText` maps to `CorruptManifestError`. `readArtboard`'s empty-active branch never runs. `list_artboards` then also fails the whole list instead of listing HTML with `activeArtboardId: ""`.
**Suggested fix:** Allow empty `activeArtboardId` in the manifest (and treat charset-invalid active as empty / not-found, not whole-file corrupt). Default read → `ARTBOARD_NOT_FOUND`. List → HTML files with `activeArtboardId: ""`. Keep truly unparseable JSON / wrong version as `CORRUPT_MANIFEST` / `UNSUPPORTED_SCHEMA_VERSION`.
**Resolution:** 2026-09-11 fixed: `parseActiveArtboardId` allows `""` and normalizes charset-invalid active to `""`; default read -> `ARTBOARD_NOT_FOUND`, list succeeds with `activeArtboardId: ""`. Non-string active and bad JSON/version still corrupt. Test: empty + invalid active. Closed 2026-09-11 /audit: re-examined `parseActiveArtboardId` + read/list branches; strict paths unchanged.

### 3/F-05 [P2] closed - Hash compare does not normalize the on-disk hash

**File:** src/disk/conflict.ts:27
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Spec: hex may be `A-F` or `a-f`; normalize to lowercase before compare. `conflictFields` lowercases `baseHash` only. `updateArtboard` also uses raw `htmlHash === currentMeta.hash` for the no-extra-bump path. `parseMeta` accepts mixed case; writers usually emit lowercase, so this is uncommon, but a valid on-disk hash then false-conflicts or extra-bumps.
**Suggested fix:** `normalizeHash` both operands in `conflictFields`, and compare normalized hashes for the generation-bump equality check. Cover uppercase disk meta in `conflict.test.ts`.
**Resolution:** 2026-09-11 fixed: `conflictFields` normalizes both hashes; update no-bump compares against the normalized disk hash. Tests: case-insensitive both-sides + uppercase disk meta no-conflict/no-bump. Closed 2026-09-11 /audit: re-examined `conflictFields` + no-bump check.

### 3/F-06 [P2] closed - Meta id is not matched to the filename id

**File:** src/disk/artboardFs.ts:192
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** `readMetaForHtml` parses meta and returns it even when `meta.id` is a different artboard id. Read/list/update then attach that record to `hero.html`. Not a locked spec line, but it mixes identities.
**Suggested fix:** If parsed `meta.id !== artboardId`, throw `CorruptMetaError(artboardId)`.
**Resolution:** 2026-09-11 fixed: `readMetaForHtml` throws `CorruptMetaError` on id mismatch; list omits title/generation on mismatch. Test: mismatch reads corrupt + lists blank. Closed 2026-09-11 /audit: re-examined `readMetaForHtml` + list checks.

### 3/F-07 [P2] closed - Corrupt manifest blocks set_artboard and explicit read_artboard

**File:** src/disk/artboardFs.ts:252
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Missing manifest is allowed for create/list. Create parses an existing manifest before `wx`; explicit `read_artboard` loads the manifest before HTML. A junk `manifest.json` therefore blocks creating a new id and reading a valid id whose HTML/meta are fine. Spec recovery copy for `CORRUPT_MANIFEST` is restore-the-file, so this is a recovery gap, not a P1 contract miss. List failing on corrupt manifest is specified and should stay.
**Suggested fix:** Create: on corrupt manifest, treat like missing and write a new manifest for this id. Read with explicit `artboardId`: load HTML/meta even if the manifest is corrupt; only require a valid manifest for omitted-id / `active`.
**Resolution:** 2026-09-11 fixed: create uses `parseManifestTextLenient` (rewrites the manifest); explicit read uses `readManifestFileLenient` (`active: false`). List + default read still strict. Tests: corrupt-manifest create/explicit-read succeed; list/default-read fail. Closed 2026-09-11 /audit: re-examined the lenient/strict split.

### 3/F-08 [P3] closed - Watcher replace clears in-flight marker ensure

**File:** src/host/watchArtboardDisk.ts:46
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Marker create/change sets sticky `pendingMarkerEnsure`. `replaceArtboardWatcher` (activate, grant-trust, folder change) disposes the watcher and sets the flag false without stating a leftover marker. A `set_artboard` marker can be written (`panelEnsured: true`) and then dropped if folders change before the 200ms debounce. Later HTML saves must not re-arm the flag.
**Suggested fix:** After recreate, if the first-folder marker still exists, set `pendingMarkerEnsure = true` and schedule debounce. Do not clear the flag when the first-folder `fsPath` is unchanged.
**Resolution:** 2026-09-11 /audit re-examined: window is the 200ms debounce coinciding with a folder-change or trust-grant event, and the next `set_artboard` rewrites the marker (change event re-arms the flag), so it self-heals. Downgraded P2 -> P3. 2026-09-11 fixed: `replaceArtboardWatcher` re-arms `pendingMarkerEnsure` + debounce from disk when the marker still exists. Closed 2026-09-11 /audit: re-examined the re-arm block; unexpected stat errors are logged, not swallowed.

### 3/F-09 [P2] closed - Boundary logic lacks regression tests

**File:** src/disk/conflict.test.ts:25
**Found:** 2026-09-10 by /audit (scope: current; lens: tests)
**Why it matters:** The four tests cover basic generation conflict only. A runner exists (`pnpm compile-tests && node --test`). Uncovered: uppercase on-disk hash, empty/invalid active id, `resolveWorkspaceRoot` (exact `rootPath`, invalid ROOTS, unique `.cursor-design/`, `ambiguous_workspace`), non-regular files, authored MCP `INVALID_ARGS` JSON. Spec required only the conflict file; the helper is the MCP write-root trust boundary and the P1 contracts above.
**Suggested fix:** Extend `conflict.test.ts` and add a `node:test` file for `resolveWorkspaceRoot` (temp dirs, no `vscode`). Smallest MCP check: malformed `html` → JSON `INVALID_ARGS`. Do not add a Blueprint Verify command or change `pnpm test`.
**Resolution:** 2026-09-11 fixed: 23 tests (13 conflict incl. all boundaries above, 7 resolveWorkspaceRoot, 3 artboardTools INVALID_ARGS/schema). Run: `pnpm compile-tests && node --test out/disk/conflict.test.js out/mcp/resolveWorkspaceRoot.test.js out/mcp/artboardTools.test.js`. No Verify added, `pnpm test` untouched. Closed 2026-09-11 /audit: 23/23 pass; no `vscode` in tests.

### 3/F-10 [P3] closed - Unused getMcpAvailable export

**File:** src/mcp/registerCursorDesignMcp.ts:20
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Exported and never imported. Host already uses the boolean `registerCursorDesignMcp` returns.
**Suggested fix:** Delete `getMcpAvailable`.
**Resolution:** 2026-09-11 fixed: deleted `getMcpAvailable` and the `mcpAvailable` variable; no remaining references. Closed 2026-09-11 /audit: grep confirms zero references.

### 3/F-11 [P3] closed - README uses em dashes

**File:** README.md:3
**Found:** 2026-09-10 by /audit (scope: current; lens: quality)
**Why it matters:** Coding standards: no em dashes (U+2014) in generated docs/READMEs. The Phase 2 README edit introduced them on the tool list and intro lines.
**Suggested fix:** Replace em dashes with commas, colons, or hyphens.
**Resolution:** 2026-09-11 fixed: all em dashes replaced with hyphens; 0 U+2014 remain. Closed 2026-09-11 /audit: grep confirms zero U+2014.

### 3/F-12 [P2] closed - Watcher reads and reconciles disk on every event with no panel open

**File:** src/host/watchArtboardDisk.ts:58
**Found:** 2026-09-11 by /audit (scope: current; lens: performance)
**Why it matters:** Spec: non-marker `.cursor-design/**` events are "refresh-if-open". `refreshWatchedArtboard` calls `readActiveArtboardFromDisk` first and checks `hasCurrentArtboardPanel()` after. `readActiveArtboardFromDisk` -> `reconcileMeta` may write `<id>.meta.json` via `vscode.workspace.fs`. Since Phase 2 the watcher is alive from activate (not only after Open Artboard), so every MCP write now triggers a host read plus a possible host meta write with no panel to show it, widening the host-vs-MCP last-writer-wins race for no UI benefit.
**Suggested fix:** Return early when `!hasCurrentArtboardPanel()` before reading disk (marker path already opens the panel first, so it is unaffected).
**Resolution:** 2026-09-11 fixed: `refreshWatchedArtboard` returns before disk I/O when no panel is open; marker path opens the panel first so it is unaffected. Closed 2026-09-11 /audit: re-examined the early return; the marker path opens the panel before refresh, so it still reads.

### 3/F-13 [P3] closed - Argument validation duplicated between MCP layer and disk lib

**File:** src/mcp/artboardTools.ts:101
**Found:** 2026-09-11 by /audit (scope: current; lens: quality)
**Why it matters:** `requireHtml` / `optionalString` / `optionalBaseGeneration` in `artboardTools.ts` repeat `requireHtmlString` and the title / viewport / baseGeneration / baseHash checks in `artboardFs.ts` (`createArtboard`, `updateArtboard`). Same messages typed twice; a copy edit in one drifts from the other.
**Suggested fix:** Keep validation in the disk lib (the trust boundary that also serves the test) and have tool handlers pass `unknown` through, or the reverse; pick one. Fold into the F-03 schema change.
**Resolution:** 2026-09-11 fixed: disk lib owns all arg validation (args typed `unknown`); tool handlers pass values through. Folded into the F-03 change. Closed 2026-09-11 /audit: re-examined handlers (pass-through) + disk validators (single site); only the MCP-specific `rootPath` check remains in the tool layer.
