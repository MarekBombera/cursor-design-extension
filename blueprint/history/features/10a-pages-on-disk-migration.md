# Feature: Pages on disk + migration

**From build-plan:** feature 10a
**Build attempt:** 1
**Status:** verified
**Branch:** `feature/pages-on-disk-migration`

## Goal

Move today's one design folder into page one of a project, with no visible change. `.cursor-design/project.json` names the open page. Each page's per-design files live in `.cursor-design/pages/<pageId>/`. One resolver, `resolveOpenPage`, runs at every entry point. It migrates a 0.4 folder (resumable, never overwrites), rebuilds a lost index, and creates a fresh project only when a valid write needs one. A tombstone file makes a still-running 0.4 MCP fail instead of writing where 0.5 no longer reads. This is the disk base for 10b to 10e. No new tool, message or UI ships here.

Plan: `blueprint/reference/0.5-pages-plan.md` (D2 to D5, the 10a section and the error table) over the Notion 0.5 outline (Scope: disk layout, migration). Bombic answered the plan's open questions on 2026-11-21, every one as the plan proposed:
- one open page, stored on disk;
- `create_page` opens the page it makes;
- a deleted page goes to `deleted/`;
- no `pageId` guard on the write tools;
- a migrated page is titled "Page 1".

Fit-all on a page switch (Q4) stays as the plan proposed. It belongs to 10b.

## In scope

- `layout.ts`: page constants and builders. The six existing per-page builders become functions of `pageId`.
- `parse.ts`: `isPageId`, `parseProject`, `serializeProject`.
- `layoutFs.ts`: `PageLocation`, `assertDirOwned`, `readProjectFile`.
- Four new error classes. The seven per-page error classes name the page path.
- `src/disk/openPage.ts`: `resolveOpenPage`, with its internal jobs (classify, migrate, rebuild, fresh create, tombstone, page-folder scan).
- Every disk op and per-page helper works on a `PageLocation`. Root files keep `workspaceRoot`.
- `assertLayoutDirsOwned` gets the new directory set. `createArtboard` creates only `artboards/`, non-recursively, inside an existing page folder.
- `validateNewArtboardArgs` runs before `set_artboard` resolves, so a refused call writes nothing.
- Every MCP tool handler and every host entry point resolves the open page once per call.
- Path text in tool descriptions, `IMPLEMENT.md`, the comment-count message, `SKILL.md` (every `.cursor-design/` path, MCP-denied fallback, new codes, tombstone, old handoffs) plus one guard assertion, README, rules 02 and 05, the system map and `project-plan.md` §4 Data.
- A local 0.4 fixture copy plus the 0.4 MCP bundle, both gitignored, for the before/after and stale-0.4 stdio checks.

## Out of scope

- New MCP tools (`list_pages`, `create_page`, `open_page`), `page` in tool results, the `COMMENT_NOT_FOUND` page hint, and the `IMPLEMENT.md` page line. All of these are 10c.
- `pageId` on any panel message, per-page chrome state, undo history keyed by page, and the stage view on a switch. These are 10b.
- The next-id rule over `deleted/`, `createPage`, `renamePage`, `deletePage`, the `deleted/` folder and `DELETED_DIR` (10c). The Pages menu (10d).
- README update note, downgrade note, real-Cursor `.vsix` run, Notion status. These are 10e.
- Keying `frameCacheKey`, the tagged-copy memo or the comment parse cache by page. They compare HTML before reuse (plan "Repo facts"), so they stay keyed by root and frame id.
- Any `pageId` argument on existing tools (Bombic, 2026-11-21: cut).
- Panel copy for the new codes on `artboard:edit` / `artboard:history` (see Entry points).

## Build loop

Build one step at a time. `workflow.stepReview` is `feature`: one review packet after all steps. Checkpoint commits are disabled. `/complete` makes the feature commit. Never accept a review packet you have not read. Split any diff too large to review. Each step ends with `pnpm test` and `vp check` green. Step 3 is a refactor with no behavior change; step 4 is the behavior change. Review them separately.

## Build steps

- [x] **Step 1 - Baseline, new names, parsers, errors** - First, before any code change, run `pnpm package` on the untouched branch. Then:
  - copy `fixtures/dev-workspace/.cursor-design` to `fixtures/legacy-0.4-workspace/.cursor-design`;
  - copy the 0.4 `dist/mcp.js` to `fixtures/legacy-0.4-workspace/dist/mcp.js` (both gitignored, by `.cursor-design/` and `dist`);
  - run that bundle over stdio (see Notes) on a temp copy of the fixture;
  - save the four JSON results as `fixtures/legacy-0.4-workspace/dist/baseline.json`: `list_artboards({})`, `read_artboard({})`, `list_comments({})` (0.4 has no `'all'` status; `{}` lists every unresolved comment) and `handoff_status({})`.

  Then add only names that do not exist today:
  - `layout.ts`: every new constant and the new builders (`pageDirSegments`, `rootEntrySegments`, `pageEntrySegments`, `projectPathSegments`, `pagesDirSegments`, `artboardsTombstoneSegments`), plus `PAGE_ENTRIES` and `ARTBOARDS_TOMBSTONE_TEXT`;
  - `parse.ts`: `isPageId`, `parseProject`, `serializeProject`;
  - `errors.ts`: the four new classes;
  - `SKILL.md`'s error section: the four codes.

  The six existing builders, the seven existing error classes and the parsers stay as they are. Nothing calls the new code yet.

  *Done when:*
  - `git status` shows no new tracked or untracked file under `fixtures/`, and every `baseline.json` result has no `isError`;
  - the baseline has at least 2 artboards and at least 1 comment;
  - `parse.test.ts` covers every `parseProject` rule in Data / contracts and the `serializeProject` round trip, and a new `src/disk/errors.test.ts` pins the two exact `MigrationConflictError` messages;
  - `agentSkill.test.ts` passes with the four new codes, and `pnpm test` and `vp check` pass.
- [x] **Step 2 - `resolveOpenPage`** - In `layoutFs.ts`:
  - add `PageLocation`;
  - add `assertDirOwned(workspaceRoot, segments)`, which `assertLayoutDirsOwned` now loops over, keeping the same behavior;
  - add `readProjectFile(workspaceRoot)`.

  Add `src/disk/openPage.ts`, exactly as in Data / contracts. Nothing calls it from an entry point yet.

  *Done when:* `src/disk/openPage.test.ts` (temp dirs, real fs) passes for every Resolver test in Testing, and `pnpm test` and `vp check` pass.
- [x] **Step 3 - Thread `PageLocation` (no behavior change)** - every per-page helper and disk op takes a `PageLocation` (signature rule below) and uses `page.workspaceRoot` with the existing root-path builders. Paths stay where they are.
  - Every entry point passes the placeholder `{ workspaceRoot, pageId: FIRST_PAGE_ID }`. Step 4 replaces it.
  - Existing tests change only their arguments: `{ workspaceRoot: root, pageId: FIRST_PAGE_ID }` where they passed `workspaceRoot`. No pinned string changes.

  *Done when:* `pnpm test` and `vp check` pass, and no assertion other than call arguments changed. Check with `git diff --stat` and a diff read.
- [x] **Step 4 - Pages on disk** - the behavior change:
  - the six per-page builders become functions of `pageId`;
  - the seven per-page error classes and their four parsers take the page id;
  - `assertLayoutDirsOwned(page)` checks the new set;
  - `createArtboard` makes `artboards/` with a non-recursive `mkdir` and throws `PAGE_NOT_FOUND` when the page folder is missing;
  - `IMPLEMENT.md` step 2 and `commentCountMessage` name the page path;
  - `validateNewArtboardArgs` is exported, and the `set_artboard` handler calls it before resolving;
  - every MCP handler and host entry point replaces the placeholder with `resolveOpenPage` (Entry points);
  - tests seed through `resolveOpenPage({ workspaceRoot: root, createIfFresh: true })`, and every pinned root path moves to page paths.

  *Done when:*
  - `pnpm test` passes, including every Op test in Testing;
  - `vp check` passes;
  - `grep -rn "\.cursor-design/" src --include='*.ts' | grep -v "\.test\.ts"` finds only comments and the tool-description prose that step 5 rewrites (Agent-facing text, like `SKILL.md`).
- [x] **Step 5 - Docs, skill, map, checks** - update:
  - tool descriptions (`list_artboards`, `place_frame`, `list_comments`) to the open page's paths, keeping `READ_ONLY_ANNOTATIONS` and "Does not write" (Notes);
  - `SKILL.md`: every `.cursor-design/` path, including line 76's direct-edit path; the MCP-denied fallback; the tombstone bullet; the first-call-moves note; the old-handoff note;
  - `agentSkill.test.ts`: one assertion that `SKILL.md` does not contain `.cursor-design/artboards/`;
  - every `.cursor-design/` path in README;
  - rule 02 (MCP tools prose, the `.cursor-design/` file list, Disk and lock; `resolveOpenPage` joins the "never call inside `withWorkspaceLock`" list) and the rule 05 catalog;
  - `blueprint/context/system-map.md` (Disk node, every per-page path, Export section, a new "Open page and migration (10a)" chart that passes the Chart checklist, the Last-verified line);
  - `blueprint/project-plan.md` §4 Data;
  - every root path quoted in `tests/browser/**` (find them with `grep -rn "\.cursor-design/" tests/browser`).

  Run the stdio checks in Testing.

  *Done when:*
  - `pnpm verify` exits 0, and `pnpm test:browser` passes;
  - the before/after results deep-equal `baseline.json`;
  - the 0.4 bundle fails every tool with `DISK_ERROR` on the migrated copy and on a fresh folder created by the 0.5 bundle's `set_artboard`, and nothing on disk changes;
  - every changed chart passes `mermaid.parse`.

- [x] **Step 6 - Audit repairs (F-01 to F-07)** - repair the open findings in `blueprint/context/findings.md` as each one's **Suggested fix** says:
  - F-01: a test that fails without the in-lock re-classify;
  - F-02: host tests for a rejected resolve (one `ui:error`) and the comment resolve rules;
  - F-03: the fixture copy paths;
  - F-04: carry `names` / `pageIds` in `FolderState` and drop the bare `Error`;
  - F-05: the missing branch tests;
  - F-06: `assertDirOwned` on `pages/page-1` before the conflict check;
  - F-07: a `ponytail:` on `writeUtf8`'s tmp.

  No behavior change beyond F-06's message. *Done when:* `pnpm test` and `vp check` pass, each repaired entry is marked `fixed` with its Resolution filled, and the F-01 test fails when `settleFolderLocked` reuses the lock-free state (checked in a scratch copy).

## Files / areas

- **New:**
  - `src/disk/openPage.ts`, `src/disk/openPage.test.ts`;
  - local-only `fixtures/legacy-0.4-workspace/` (ignored).
- **Disk:**
  - `layout.ts`, `parse.ts`, `errors.ts` (with a new `errors.test.ts`);
  - `layoutFs.ts` (`PageLocation`, `assertDirOwned`, `readProjectFile`, the helpers, `assertLayoutDirsOwned`);
  - `artboardFs.ts` (incl. `validateNewArtboardArgs`), `artboardEditFs.ts`, `canvasView.ts`;
  - `canvasLayout.ts` (`parseCanvasLayout` takes the page id);
  - `exportFs.ts`, `handoff.ts` (`buildCanvasImplementMarkdown` takes `pageId`);
  - `comments.ts` (`commentCountMessage`), `commentsFile.ts`, `commentViews.ts`.
- **MCP:** `artboardTools.ts` (8 handlers), `commentTools.ts` (3 handlers).
- **Host:**
  - `host/artboardDisk.ts` (`loadActiveSnapshot`'s manifest gate, `initializeDefaultArtboard`, `snapshotFromCanvasView`, `placeFrameFromChrome`);
  - `host/panelEdit.ts` (`answerEditRequest`, `answerHistoryRequest`);
  - `host/panelComments.ts` (`postPanelComments`, `answerCommentRequest`);
  - `commands/exportHandoff.ts`.

  Unchanged: `commands/revealDesignFolder.ts`, `watchArtboardDisk.ts` (it reaches the resolver through `readActiveArtboardFromDisk`), `workspaceLock.ts`, `editHistory.ts`, `canvasSnapshot.ts`, `panelRequestCopy.ts`, `src/webview/**`.
- **Tests:** every test that seeds or pins root paths:
  - `src/disk/`: `artboardFs.test.ts`, `canvasView.test.ts`, `comments.test.ts`, `commentsFile.test.ts`, `handoff.test.ts` and its snapshots, `workspaceLock.test.ts`, `artboardEditFs.test.ts`, `parse.test.ts`, `canvasLayout.test.ts`;
  - `src/mcp/`: `artboardTools.test.ts`, `artboardTools.contract.test.ts`, `commentTools.contract.test.ts`, `resolveWorkspaceRoot.test.ts`, `agentSkill.test.ts`;
  - `src/host/panelEdit.history.test.ts`;
  - the browser harness strings.
- **Docs:** `skills/cursor-design/SKILL.md`, `README.md`, `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`, `blueprint/context/system-map.md`, `blueprint/project-plan.md`.

## Data / contracts

### Disk layout (persisted, shared by the MCP process and the extension host)

```txt
.cursor-design/
  project.json              # NEW, root: { version, openPageId, pages }
  pages/<pageId>/           # NEW: the per-page files, schemas unchanged
    manifest.json  canvas.json  comments.json  artboards/<id>.html + <id>.meta.json
  artboards                 # NEW: tombstone FILE (regular file, never a directory)
  handoff/  tokens.json  assets/  .lock  .ensure-panel   # root, unchanged
  <unknown entries>         # left where they are (e.g. picking-harness/)
```

`manifest.json`, `canvas.json`, `comments.json` and the meta files keep their schemas and version 1, byte for byte. The migration moves them and does not rewrite them.

### `layout.ts`

**New in step 1:**
- `PROJECT_FILE = 'project.json'`, `PAGES_DIR = 'pages'`, `PROJECT_SCHEMA_VERSION = 1`, `FIRST_PAGE_ID = 'page-1'`, `MAX_PAGES = 100` (`ponytail:` the 10d menu lists every page; search is 0.5.1), `MAX_PAGE_TITLE_CHARS = 80`, `PAGE_ID_PATTERN = /^page-[1-9][0-9]{0,5}$/`.
- `PAGE_ENTRIES = [ARTBOARDS_DIR, MANIFEST_FILE, CANVAS_FILE, COMMENTS_FILE] as const`, with `export type PageEntry = (typeof PAGE_ENTRIES)[number]`. These are the four per-page names, in migration order (`artboards` first). The conflict check, the migration and the Legacy test use this one list. The JSON steps iterate it, skipping `ARTBOARDS_DIR`.
- Root builders:
  - `projectPathSegments`, `pagesDirSegments`;
  - `artboardsTombstoneSegments` (`[CURSOR_DESIGN_DIR, ARTBOARDS_DIR]`);
  - `rootEntrySegments(name: PageEntry)`, giving `[CURSOR_DESIGN_DIR, name]`: the legacy location of a page entry.
- Page builders:
  - `pageDirSegments(pageId)`, giving `[CURSOR_DESIGN_DIR, PAGES_DIR, pageId]`;
  - `pageEntrySegments(pageId, name: PageEntry)`, giving `[...pageDirSegments(pageId), name]`.
- `ARTBOARDS_TOMBSTONE_TEXT` is the tombstone's exact contents:

  ```txt
  cursor-design keeps artboards in .cursor-design/pages/<page id>/artboards/ now.
  Do not delete or replace this file. It stops an older cursor-design MCP server from writing artboards here, where the extension no longer reads them.
  If a cursor-design tool fails with ".cursor-design/artboards must be a directory (symlinks rejected).", quit and reopen Cursor.
  ```

**Flipped in step 4.** The existing builders become:
- `manifestPathSegments(pageId)`, `canvasPathSegments(pageId)` and `commentsPathSegments(pageId)`, each `pageEntrySegments(pageId, <file>)`;
- `artboardsDirSegments(pageId)`;
- `artboardHtmlPathSegments(pageId, artboardId)` and `artboardMetaPathSegments(pageId, artboardId)`.

`ensurePanelPathSegments`, `handoffRootSegments`, `handoffDirSegments` and `workspaceTokensPathSegments` stay as they are.

### `project.json` (version 1)

```json
{
  "version": 1,
  "openPageId": "page-1",
  "pages": [{ "id": "page-1", "title": "Page 1" }]
}
```

- **Text reader.** `readProjectFile(workspaceRoot): Promise<Project | undefined>` in `layoutFs.ts`, next to `readManifestFile`. It reads through `readUtf8IfExists`, which applies the regular-file rule. A missing file returns `undefined`. `JSON.parse` failing (including an empty file) throws `CorruptProjectError({ cause })`. Otherwise it returns `parseProject(parsed)`. The resolver test covers "not JSON" through the resolver.
- **`parseProject(value: unknown): Project`** in `parse.ts`, using zod/mini like `manifestSchema`. Version dispatch comes first, as `parseManifest` does it. Unknown keys are dropped on parse, as for the manifest. 10a never rewrites an existing `project.json`.
  - Not an object, or a `version` that is not an integer: `CORRUPT_PROJECT`.
  - Any integer `version` other than 1: `UNSUPPORTED_PROJECT_VERSION`.
  - `pages`: an array of 1 to `MAX_PAGES` entries. Each entry is `{ id, title }`.
    - `id` passes `isPageId`, and ids are unique.
    - `title` is a string with `title === title.trim()`, 1 to `MAX_PAGE_TITLE_CHARS` UTF-16 code units, and `!hasControlChars(title)`.
  - `openPageId` equals one of the ids.
  - Any other violation: `CORRUPT_PROJECT`.
- **`isPageId(value: unknown): value is string`** is the one page-id check, over `PAGE_ID_PATTERN`. It covers `project.json` entries and the folder scan here, and MCP args and chrome messages in 10b/10c. Each caller throws its own error or skips.
- **Order.** Array order is menu order. 10a writes it ascending by page number.
- **Serializing.** `serializeProject` uses the existing `toPrettyJson`: 2-space JSON plus a newline. Write it through `writeUtf8` (tmp plus rename; the watcher skips `*.tmp`).
- **Titles** are user data. In 10a every title is `Page <n>`, where `<n>` is the decimal digits of the id after `page-`. There is no padding, and the pattern forbids leading zeros.

### `PageLocation` and the signature rule

- `export type PageLocation = { workspaceRoot: string; pageId: string }` lives in `src/disk/layoutFs.ts`. That is the lowest module that takes it, so there is no import cycle with `openPage.ts`. Added in step 2.
- A helper that today takes `workspaceRoot` for a per-page file takes `page: PageLocation` in its place, positionally where it is positional today. That covers:
  - `readManifestFile(page)`, `readManifestFileLenient(page)`, `readCanvasLayoutFile(page)`;
  - `readStoredMeta(page, artboardId, opts)`, `requireArtboardHtml(page, artboardId)`, `requireExactHtmlFileName(page, artboardId)`;
  - `assertLayoutDirsOwned(page)`;
  - `readCommentsFile(page)`, `commentsTextIfExists(page)`, `writeCommentsFile(page, file)`;
  - `withCommentViews(page, comments)`, `loadArtboardDocument(page, frameId)`, `loadFramePresence(page, frameId)`, `documentsFor(page, comments)`;
  - `resolveLayoutOrEmpty(page)`.
- Object-argument helpers and public ops take `page` in place of `workspaceRoot`:
  - `createArtboard({ page, artboardId, html, ... })`, `scanArtboardFiles({ page, tolerateHtmlDiskError })`;
  - `writeManifestActive({ page, ... })`, `writeManifestLastExport({ page, ... })`;
  - and every op in `artboardFs`, `artboardEditFs`, `canvasView`, `exportFs` and `comments`.
- Root files and the lock use `page.workspaceRoot`: `withWorkspaceLock`, handoff, tokens and `.ensure-panel`. `cachedArtboardDocument`, `frameCacheKey` and `panelFrames` keep `workspaceRoot`; they are cache keys only.

### Per-page error classes (step 4)

- The seven per-page classes take a first argument object that carries the page id, plus the existing `options`:
  - `CorruptManifestError({ pageId })`;
  - `UnsupportedSchemaVersionError({ pageId, version })`;
  - `CorruptCanvasError({ pageId })`;
  - `UnsupportedCanvasVersionError({ pageId, version })`;
  - `CorruptMetaError({ pageId, artboardId })`;
  - `CorruptCommentsError({ pageId })`;
  - `UnsupportedCommentsVersionError({ pageId, version })`.
- Each keeps its existing public `readonly` properties, `version` and `artboardId`, because `toMcpToolError` copies `artboardId` into the error body. Each gains `readonly pageId`, which is not copied into MCP bodies in 10a.
- Each keeps its code and its message template, with the path from the per-page builder: `Artboard manifest is invalid. Fix or restore .cursor-design/pages/page-1/manifest.json (version 1).`
- The parsers that throw them take the page id as a second parameter: `parseManifest(value, pageId)`, `parseMeta(value, pageId)`, `parseCanvasLayout(value, pageId)`, `parseCommentsFile(value, pageId)`. Each has exactly one non-test caller, its read helper.
- Other per-page path text follows the same rule:
  - `requireHtmlFile` and `regularFileRequiredMessage` users;
  - `exportFs.ts`'s "cannot be exported as a folder" message;
  - `COMMENT_COUNT_MESSAGE`, which becomes `commentCountMessage(pageId)`: `comments.json already holds 500 comments. Remove resolved comments from .cursor-design/pages/page-1/comments.json, then retry.`

### New error classes (`errors.ts`, Agent-visible codes, step 1)

Every path in these messages comes from the segment builders. The examples use `page-1`. `PageNotFoundError(pageId)` is positional on purpose, like `ArtboardNotFoundError(artboardId)`.

| Class | `code` | Message |
|---|---|---|
| `PageNotFoundError(pageId)` | `PAGE_NOT_FOUND` | `Page "page-1" has no folder. Restore .cursor-design/pages/page-1/, or delete .cursor-design/project.json to rebuild the page list from the page folders.` |
| `CorruptProjectError(options?)` | `CORRUPT_PROJECT` | `Project index is invalid. Fix .cursor-design/project.json (version 1), or delete it to rebuild the page list from the page folders. Page titles then reset to "Page <n>".` |
| `UnsupportedProjectVersionError(version, options?)` | `UNSUPPORTED_PROJECT_VERSION` | `Project index version 2 is unsupported (expected 1). Update the cursor-design extension, or fix .cursor-design/project.json.` |
| `MigrationConflictError({ pageId, names })` | `MIGRATION_CONFLICT` | built as below |

**`MigrationConflictError({ pageId, names })`.** `names` is a non-empty `readonly PageEntry[]` in `PAGE_ENTRIES` order. The message is:

`Cannot move the existing design into <pageDir>/: ` + clauses joined by `; ` + `.` + the steps that apply + ` Then retry.`

- `<pageDir>` is `pageDirSegments(pageId).join('/')`.
- The `artboards` clause: `<root artboards>/ is a folder, but artboards now live in <page artboards>/`.
- A JSON clause for name `n`: `<root n> and <page n> both exist`.
- The steps that apply:
  - when `artboards` is in `names`: ` Move the files you want from <root artboards>/ into <page artboards>/, then delete <root artboards>/ (quit and reopen Cursor first if an older cursor-design MCP server may still be running).`
  - when any JSON name is in `names`: ` Keep one copy of each JSON file: move or delete the other by hand.`

The two pinned examples (also in Testing):

- `names: ['manifest.json', 'comments.json']`: `Cannot move the existing design into .cursor-design/pages/page-1/: .cursor-design/manifest.json and .cursor-design/pages/page-1/manifest.json both exist; .cursor-design/comments.json and .cursor-design/pages/page-1/comments.json both exist. Keep one copy of each JSON file: move or delete the other by hand. Then retry.`
- `names: ['artboards']`: `Cannot move the existing design into .cursor-design/pages/page-1/: .cursor-design/artboards/ is a folder, but artboards now live in .cursor-design/pages/page-1/artboards/. Move the files you want from .cursor-design/artboards/ into .cursor-design/pages/page-1/artboards/, then delete .cursor-design/artboards/ (quit and reopen Cursor first if an older cursor-design MCP server may still be running). Then retry.`

**Where the codes show.**
- The MCP returns them through `toMcpToolError`.
- The panel snapshot (`loadActiveSnapshot`) and the comment requests show them through `toSafeArtboardErrorMessage`, as authored `CursorDesignError` copy.
- `artboard:edit` / `artboard:history` keep `editRequestErrorMessage`'s allowlist, so these four codes show the existing generic edit fallback. That is accepted: with `project.json` corrupt or a conflict, the snapshot already shows the real message and posts no frames to edit. No `panelRequestCopy.ts` change.

### `resolveOpenPage({ workspaceRoot, createIfFresh }): Promise<PageLocation>` (`src/disk/openPage.ts`)

`resolveOpenPage` is the only export. Its internal functions, one job each:
- `classifyFolder`;
- `migrateLegacyFolder`;
- `rebuildProjectIndex`;
- `createFreshProject`;
- `writeArtboardsTombstone`;
- `scanPageFolders`: `readdir(pages/)`, keep names that pass `isPageId` and are a real directory (lstat), sort ascending by page number, cap at `MAX_PAGES` (`ponytail:` folders past the cap stay on disk, unlisted, with one `logStderr` line).

**Guard.** At the start of every classify, including the one inside the lock, `assertDirOwned` checks `.cursor-design/` and `.cursor-design/pages/`. Each must be a real directory or missing. Otherwise it throws the existing directory `DiskError` (`… must be a directory (symlinks rejected).`).

**Classify** reads: `lstat` of root `artboards`, `manifest.json`, `canvas.json` and `comments.json`; `readProjectFile`; and `scanPageFolders` only when the Index lost row needs it. The first match wins:

| Kind | Condition | Lock-free result |
|---|---|---|
| Indexed | `project.json` exists | `parseProject` through `readProjectFile`. Then check root `artboards`: missing, write the tombstone; a real directory, throw `MigrationConflictError({ pageId: openPageId, names: ['artboards'] })`; anything else, keep it. Return `{ workspaceRoot, pageId: openPageId }`. There is no page-folder check. |
| Legacy | root `artboards` is a real directory, or any of root `manifest.json`, `canvas.json`, `comments.json` exists (any kind) | take the lock |
| Index lost | `scanPageFolders` is non-empty | take the lock |
| Fresh | none of the above | `createIfFresh` false: return `{ workspaceRoot, pageId: FIRST_PAGE_ID }`, write nothing, create no directory. `createIfFresh` true: take the lock |

Notes on the table:
- A tombstone, or any non-directory at root `artboards`, is never Legacy.
- Legacy beats Index lost whenever any legacy entry is present.
- For a Fresh read, the returned page-1 folder does not exist. Every per-page read then answers exactly as today for an empty folder. Every write tool other than `set_artboard` refuses with today's code before it writes:
  - `update_artboard`, `place_frame`, `set_active_artboard`: `ARTBOARD_NOT_FOUND`;
  - `export_artboard`: `NoArtboardsToExportError`'s `ARTBOARD_NOT_FOUND`;
  - `resolve_comment`: `COMMENT_NOT_FOUND`;
  - the host's `markCommentsSent`: `[]`.
- Indexed with a missing tombstone writes one file on a read. This is the only write on an Indexed path. It restores D5's guard after someone deleted the tombstone.

**Under `withWorkspaceLock({ workspaceRoot })`:** run the Guard and the classify again, then run that kind's job and return the open page. Indexed inside the lock returns as above. Fresh inside the lock with `createIfFresh` false returns page-1 and writes nothing.

- **Legacy, `migrateLegacyFolder`.** Steps a to f, in order:
  - **a. Conflict check.** For each name in `PAGE_ENTRIES` present at `rootEntrySegments(name)` by the Legacy rule (`artboards` a real directory, a JSON name any kind), check whether `pageEntrySegments(FIRST_PAGE_ID, name)` exists (any kind). Any hits throw `MigrationConflictError({ pageId: FIRST_PAGE_ID, names: hits })`, and nothing moves.
  - **b. Page folder.** `mkdir pages/` (recursive), then `mkdir pages/page-1` (non-recursive). `EEXIST` is fine only when lstat shows a real directory. Anything else throws the directory `DiskError`.
  - **c. Artboards.** If root `artboards` is a real directory, `rename` it to `pageEntrySegments(FIRST_PAGE_ID, ARTBOARDS_DIR)`.
  - **d. Tombstone.** `writeArtboardsTombstone`.
  - **e. JSON files.** Iterate `PAGE_ENTRIES` without `ARTBOARDS_DIR`, and `rename` each one present at the root into `pages/page-1/`.
  - **f. Index.** Write `project.json`: `pages` comes from `scanPageFolders`, which includes `page-1` from step b, each titled `Page <n>`, with `openPageId` `page-1`.
- **Index lost, `rebuildProjectIndex`.** `writeArtboardsTombstone`, then `project.json` from `scanPageFolders`, titled `Page <n>`. The open page is the first, lowest number.
- **Fresh with `createIfFresh`, `createFreshProject`.** `writeArtboardsTombstone`, then `mkdir pages/` (recursive) and `pages/page-1` (non-recursive, the same rule as b), then `project.json` with only `page-1` "Page 1". The caller then writes its artboard. The resolver itself never creates an artboard.

**`writeArtboardsTombstone`.** Write `ARTBOARDS_TOMBSTONE_TEXT` to `artboardsTombstoneSegments` with `writeFile(..., { flag: 'wx' })`.
- On `EEXIST`, `lstat` the entry. A non-directory is kept as it is.
- A directory throws `DiskError` with the message: `${artboardsTombstoneSegments.join('/')} became a folder while cursor-design was replacing it. An older cursor-design MCP server may still be running: quit and reopen Cursor, then retry.`
- `ponytail:` 0.4's `createArtboard` takes no lock, so it can race this window. In create and rebuild the tombstone comes first, so nothing else was written. In a migration, the next call's conflict check names the folder. Upgrade path: none needed while the tombstone exists.

**Resume and idempotency.** A crash after any step leaves a state that the next call classifies as Legacy (some root entry is left) or Index lost (everything moved, no index). Both end in the same `project.json` (page-1 titled "Page 1", open). Moved entries are skipped, and nothing is overwritten. A second call on a migrated folder is Indexed and writes nothing.

**Never.**
- Called inside `withWorkspaceLock`. It takes the lock itself, and the lock is not re-entrant. Every write inside its own lock section uses only `mkdir`, `rename`, `writeFile wx` and `writeUtf8`, never a lock-taking disk op.
- Run before a host trust check.
- Moving or deleting an unknown root entry.
- Overwriting.

**`ponytail:` (D5).** A 0.4 `addComment` or `placeFrame` already waiting on the lock when a migration runs re-reads "missing = empty". It then writes an orphan root file afterwards, which 0.5 ignores while `project.json` exists.

### Ops on a page (step 4)

- `assertLayoutDirsOwned(page)` calls `assertDirOwned` for `.cursor-design/`, `pages/`, `pages/<id>/`, `pages/<id>/artboards/` and `handoff/`: each is a real directory or missing. It never checks root `artboards` (the tombstone).
- `createArtboard` replaces `ensureDir(artboardsDir)` with `mkdir(pages/<id>/artboards, { recursive: false })`:
  - `EEXIST` is fine;
  - `ENOENT` (no page folder) throws `PageNotFoundError(pageId)` and creates nothing;
  - other errors go to `throwDiskError`.
- No other op creates a directory under `pages/` (the lock's `mkdir` makes only `.cursor-design/`). So no page-scoped write recreates a missing page folder.
- `ponytail:` a `writeUtf8` into a page folder deleted by hand mid-call surfaces as the generic `DISK_ERROR`, not `PAGE_NOT_FOUND`. 10c's delete revisits it.
- `validateNewArtboardArgs({ artboardId, html, title, viewport })` is exported from `artboardFs.ts`. It holds today's `requireArtboardIdString`, `requireHtmlString` and the two `requireOptionalString` checks, and returns the validated values. `createArtboard` calls it first, as today. The `set_artboard` handler also calls it before `resolveOpenPage`, so invalid args (`INVALID_ARGS` / `INVALID_ARTBOARD_ID`) on a fresh root create nothing.
- `exportArtboard({ page })` scans, reads and writes the page's files and records `lastExport` in that page's manifest. It writes `handoff/` and reads `tokens.json` at the root. `buildCanvasImplementMarkdown` takes `pageId`, so its step 2 names `.cursor-design/pages/<pageId>/artboards/<id>.meta.json` and `.cursor-design/pages/<pageId>/artboards/*.html`. Steps 5 and 7 (root `.cursor-design/`, root `assets/`) are unchanged.

### Entry points (each resolves once, per call; step 4)

**MCP.** Each of the 11 handlers calls `resolveOpenPage({ workspaceRoot, createIfFresh })` first, inside its `runQueued` operation, and passes the page to its op.
- `set_artboard` runs `validateNewArtboardArgs` first, then passes `createIfFresh: true`. Every other handler passes `false`.
- A page switch during a call never moves that call's write.
- Results are unchanged (`page` in results is 10c).

**Host.** Every resolver call sits after the existing trust check, inside the `try` that already produces the request's one answer, so a resolver error becomes that answer.

| Entry | `createIfFresh` | Change |
|---|---|---|
| `loadActiveSnapshot` via `initAndLoadArtboard` (Open Artboard) | `true` | resolve inside its `try`, then the manifest gate becomes `fileExists(joinWorkspace(folder, manifestPathSegments(page.pageId)))`. A missing manifest runs `initializeDefaultArtboard(page)`: `createArtboard`, and on `ArtboardExistsError` `setActiveArtboard`, on the page. |
| `loadActiveSnapshot` via `readActiveArtboardFromDisk` (panel visible, folders changed, watcher refresh, after `frame:place`) | `false` | same gate. A missing manifest posts the empty snapshot as today. |
| `placeFrameFromChrome` | `false` | `placeFrame({ page, ... })` |
| `answerEditRequest`, `answerHistoryRequest` | `false` | after `checkedWorkspaceRoot` returns a root, inside the same `try`: `editArtboard` / `updateArtboard` on the page |
| `postPanelComments`, `answerCommentRequest` | `false` | the comment ops on the page. Copy uses one page for `getComment` / `listComments` and `markCommentsSent`. |
| Export Handoff command | `false` | `exportArtboard({ page })` |

- The untrusted workspace path stays as it is: no resolve, no migration, no write.
- A resolver error is logged once and shown through the existing channel: the snapshot `errorMessage`, `ui:error`, or `showErrorMessage`.
- `revealDesignFolder` and the watcher glob (`.cursor-design/**`) are unchanged. A migration's renames fire the watcher, and its refresh resolves an Indexed folder.

### Agent skill (`SKILL.md`, shipped)

- **Codes (step 1).**
  - `PAGE_NOT_FOUND` / `CORRUPT_PROJECT` / `UNSUPPORTED_PROJECT_VERSION`: tell the user which file the message names, and never delete `project.json` yourself.
  - `MIGRATION_CONFLICT`: show the user the message, and never move or delete either copy yourself.
- **Paths (step 5).** Every `.cursor-design/` path follows the layout above. Line 76's direct edit becomes `.cursor-design/pages/<openPageId>/artboards/<id>.html`, with `openPageId` read from `.cursor-design/project.json`.
- **MCP-denied fallback.** If `.cursor-design/project.json` is missing, the folder has not moved to pages yet. Ask the user to open the panel once (**Cursor Design: Open Artboard**), which moves it. Never create `pages/` or `project.json` by hand.
- **Tombstone.** Never delete or replace the file `.cursor-design/artboards`. A tool failing with `.cursor-design/artboards must be a directory (symlinks rejected).` means an older cursor-design MCP server is still running: ask the user to quit and reopen Cursor.
- **First call.** The first cursor-design call after an update may move a 0.4 folder into `pages/page-1/`, once. That is expected.
- **Old handoffs.** A handoff exported before pages names the old artboards folder in its MCP-unavailable step. Use `.cursor-design/pages/<openPageId>/artboards/` instead, or re-export.
- **Guard.** The skill text never contains `.cursor-design/artboards/` (the tombstone path with a slash). `agentSkill.test.ts` asserts it.

## Testing

Runner: `pnpm test` (Vitest, temp dirs from `mkdtemp`, never `fixtures/dev-workspace`, rule 09). Gates: `pnpm verify`, and `pnpm test:browser`, because harness strings change.

**Parser and error tests (step 1).**
- `parse.test.ts`:
  - the happy file, and `serializeProject` round-tripping it;
  - each `CORRUPT_PROJECT` case: `"{"` (a string, not an object); array; missing or float `version`; missing or empty `pages`; 101 pages; id `../x`; id `page-0`; id `page-1234567`; duplicate id; title `""`; title `" a"`; an 81-character title; a title with `\n`; `openPageId` not listed;
  - version 2 gives `UNSUPPORTED_PROJECT_VERSION`;
  - `isPageId` true for `page-1` and `page-999999`, false otherwise.
- The two pinned `MigrationConflictError` messages above, byte for byte.

**Resolver tests (`openPage.test.ts`, step 2, real fs).**
- Each Legacy subset migrates to the same layout: `artboards/` only; `manifest.json` only; all four; `artboards/` plus `comments.json`. Afterwards:
  - files are byte-identical at the new paths;
  - `project.json` deep-equals the contract;
  - the tombstone holds the exact text.
- Resume: build each intermediate state by hand, then resolve. Each ends equal to a clean migration, title "Page 1". The states:
  - after b: empty `pages/page-1`;
  - after c: artboards moved, no tombstone;
  - after d: tombstone present, JSONs at the root;
  - after a partial e;
  - after e: Index lost.
- Conflicts throw `MIGRATION_CONFLICT` with the pinned message and move nothing (the directory listing and file bytes before and after are equal). The cases:
  - each of the four names in both places;
  - `manifest.json` plus `comments.json` together;
  - a root `artboards/` directory present alongside `pages/page-1/artboards` with no tombstone (a stale 0.4 write between c and d).
- Indexed with a root `artboards/` directory throws `MIGRATION_CONFLICT` (`artboards` message, `pageId` = `openPageId`). Indexed with the tombstone deleted rewrites it, returns the open page and writes nothing else.
- Unknown root entries stay, byte-identical: `picking-harness/`, `handoff/`, `tokens.json`, `assets/`, `.ensure-panel`.
- A second resolve on a migrated folder writes nothing (every mtime unchanged) and returns page-1.
- The tombstone is not Legacy: tombstone plus `pages/page-1` with no `project.json` rebuilds, never migrates.
- Rebuild: folders `page-3`, `page-1`, `notes/`, a symlinked `page-2` and a file `page-4` give pages `[page-1 "Page 1", page-3 "Page 3"]`, with open `page-1` and the tombstone written. With only `page-3` on disk, the pages are `[page-3 "Page 3"]`, open `page-3`.
- A corrupt `project.json` gives `CORRUPT_PROJECT` with `cause` set when the text is not JSON, and version 2 gives `UNSUPPORTED_PROJECT_VERSION`. Neither writes anything.
- Fresh with `createIfFresh: false` returns page-1 and creates no `.cursor-design/`.
- Fresh with `createIfFresh: true` leaves exactly `project.json`, the tombstone and an empty `pages/page-1/`, with no `.lock` left.
- `.cursor-design` as a file, and `pages` as a symlink, each give the directory `DiskError`.
- Race: `Promise.all` of two resolves on one Legacy folder, one with `createIfFresh: true` and one with `false`. Neither throws, both return page-1, and the final tree deep-equals a clean migration. The lock is file-based, so this runs the same path as the MCP and host race.

**Op tests (step 4).**
- MCP contract tests on a fresh temp root call `list_artboards`, `read_artboard`, `list_comments`, `get_comment`, `handoff_status`, `update_artboard`, `place_frame`, `set_active_artboard`, `export_artboard` and `resolve_comment`. Each returns the result or code listed under Classify, and `.cursor-design/` still does not exist afterwards.
- `set_artboard` with an invalid id, and with no html, on a fresh root returns `INVALID_ARTBOARD_ID` / `INVALID_ARGS` and leaves no `.cursor-design/`.
- `set_artboard` on a fresh root creates `project.json`, the tombstone and `pages/page-1/artboards/<id>.html`.
- `set_artboard` after `rm -r pages/page-1` (Indexed) gives `PAGE_NOT_FOUND` and leaves `pages/page-1` absent.
- A root tombstone file does not trip 0.5's `assertLayoutDirsOwned`, while `pages/page-1/artboards` as a file does (the pinned message is updated).
- An export on page-1 writes `handoff/<exportId>/` at the root, `lastExport` in `pages/page-1/manifest.json`, and the `IMPLEMENT.md` snapshot with page paths.
- `CORRUPT_META` MCP results still carry `artboardId`.
- Every pinned root-path string in the tests moves to page paths. Derived assertions follow the builders.

**Stdio checks (step 5, agent-run, local).**
- **Before/after.** Run the new `dist/mcp.js` over stdio on a fresh temp copy of `fixtures/legacy-0.4-workspace/.cursor-design`, with the same four calls as the baseline. Their results deep-equal `baseline.json`; any differing key fails the check and is reported. Afterwards the copy has the migrated layout, and `picking-harness/` and `handoff/` are untouched.
- **Stale 0.4.** Run `fixtures/legacy-0.4-workspace/dist/mcp.js` on that migrated copy, and on a folder the new bundle's `set_artboard` just created. Call each of its 11 tools with valid args built from `baseline.json`:
  - an existing artboard id and its generation (`update_artboard` with the baseline HTML, `read_artboard`, `place_frame` with x 0 and y 0, `set_active_artboard`);
  - a new id with small HTML (`set_artboard`);
  - a comment id from the baseline (`get_comment`, `resolve_comment` with a note);
  - empty args for the rest.

  Each returns `DISK_ERROR` naming `.cursor-design/artboards`, and the tree listing and file hashes before and after are equal.

Real Cursor (panel shows the migrated stage, F-135 stale process) is 10e's case A/B, not claimed here.

## Notes for the AI

- Read `blueprint/reference/0.5-pages-plan.md` D2 to D5 before step 2. Where it and this spec differ, this spec wins. The differences:
  - `DELETED_DIR` and the never-reuse id rule are moved to 10c;
  - `PageLocation` lives in `layoutFs.ts`;
  - `isPageId` is a guard rather than a throwing parser;
  - page-scoped writes give `PAGE_NOT_FOUND` only where 10a can create a directory (`createArtboard`);
  - an Indexed folder rewrites a missing tombstone and refuses a root `artboards/` directory.
- **The lock is not re-entrant.** `resolveOpenPage` takes it, so no caller may hold it. Check every new call site: the comment ops and `updateArtboard` take it after the resolver returns, never around it.
- **Resolve once per call.** Pass the `PageLocation` down; never re-resolve inside an op. The host's post-write snapshot (`readActiveArtboardFromDisk`) is a separate call and resolves again, which is correct.
- **Wire values are `unknown` until a guard checks them.** `project.json` goes only through `readProjectFile` and `parseProject`. Never cast.
- **No literal paths in source.** Every path and every message path comes from `layout.ts` builders (rule 04), including the tombstone race `DiskError`. Tests may pin literal page paths.
- **Step 3 is a pure refactor.** If an assertion other than a call argument wants to change there, the step is doing step 4's work. Seed tests in step 4 with `const page = await resolveOpenPage({ workspaceRoot: root, createIfFresh: true })` in each file's local `makeTempRoot`. Add no shared fixture helper (rule 09: no fixtures).
- **Read tools keep `READ_ONLY_ANNOTATIONS` and "Does not write".** The one-time migration moves files without changing design data, and clients must keep auto-approving read tools. The skill's first-call note covers it.
- **Host.** Keep `vscode.workspace.fs` for the manifest `fileExists` gate (rule 07). The resolver and ops use the disk lib's `node:fs`, as every other disk op does.
- **Skill.** `agentSkill.test.ts` fails as soon as a new code exists in `errors.ts` without `SKILL.md`, so step 1 adds the codes. Tool descriptions change in step 5 together with the rest of `SKILL.md` (rule 02).
- **Fixture.** F5 opens `fixtures/dev-workspace` and migrates it on the first panel open with this build. That is expected, and step 1's copy is the 0.4 reference.
- **Stdio harness.** Set `CURSOR_DESIGN_WORKSPACE_ROOT` (and `CURSOR_DESIGN_WORKSPACE_ROOTS`, `src/mcp/mcpIdentity.ts`) to the temp root. Spawn `node <bundle>`. Send JSON-RPC `initialize`, `notifications/initialized`, then one `tools/call` per tool over stdin, reading one JSON line per answer from stdout. Keep the script in the scratchpad, never in the repo.
- **Ponytail marks** go in the code where this spec names them: `MAX_PAGES`, the scan cap, the tombstone race, the D5 orphan, the mid-call `DISK_ERROR`.
- `pnpm verify` after the work, and `pnpm test:browser` once (no parallel browser runs, shared `dist/`).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":43487,"specSha256":"dfaed817a515d1cbe6f129b002d951d799146b904b5697b8d24cfd9c1b53d90d","branch":"refs/heads/feature/pages-on-disk-migration","head":"a7af7dcd4959ede6381e34c11232a731ba29348e","baseRef":"refs/heads/main","baseCommit":"5b3930707def124e676ccb6797f7295b78080e75","sourceTree":"d4bd616d4864567a82be08257b1c85b58e0fde31","landing":"local-merge","absentOptional":[]} -->

## Findings

### 10a/F-01 [P2] closed - The in-lock re-classify has no test that fails without it

**File:** src/disk/openPage.ts:244
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Sonnet 5.5)
**Why it matters:** The spec requires `resolveOpenPage` to classify again under the lock. That re-check is what stops a second concurrent caller from re-running a job over a folder another process already settled, for example `createFreshProject` rewriting an existing `project.json`. A mutation probe made `settleFolderLocked` reuse the stale lock-free state, and all 16 `openPage.test.ts` tests still passed. The race test passes either way, because a repeated migration is idempotent.
**Suggested fix:** Add one test in `openPage.test.ts` that fails without the re-check. For example: two concurrent `createIfFresh: true` resolves on a Fresh root, plus a project whose title was edited by hand, and assert that `project.json` keeps its bytes. No production change.
**Resolution:** The in-lock classify is now pinned by `openPage.test.ts` "a folder settled while this call waited on the lock is opened under the lock, not created". A `vi.mock` of `./workspaceLock` (passthrough plus an `onLocked` hook) writes an Indexed folder with a hand-edited title once the resolver holds the lock, after its lock-free classify saw Fresh; with `createIfFresh: true` the test asserts `project.json` keeps its bytes. Mutation proof in a scratch copy: making `settleFolderLocked` take the lock-free state fails this test (title rewritten to "Page 1"), plus the legacy race test and the 101-folder test; the real code passes. No production change. Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): a mutation that reuses the lock-free state fails the new test on 5 of 5 runs, and the real code passes 19/19 on 6 runs. The workspaceLock mock passes through to the real lock.

### 10a/F-02 [P2] closed - Host tests mock resolveOpenPage; the resolver-error answer and the one-resolve rules are unproven

**File:** src/host/panelComments.test.ts:44
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Sonnet 5.5)
**Why it matters:** The spec says every host resolve sits inside the `try` that produces the request's one answer, and that a comment copy uses one page for the read and for `markCommentsSent`. In `panelEdit.test.ts` (line 30) and `panelComments.test.ts`, the mock always resolves, so no test makes it reject and checks for exactly one `ui:error`. `panelComments.test.ts` also never asserts `createIfFresh: false`, one resolve per `comment:copy`, or no resolve when the workspace is untrusted. `loadActiveSnapshot` has no unit test; that gap predates this feature.
**Suggested fix:** In each of the two files, make the mocked `resolveOpenPage` reject once with `MigrationConflictError`, and assert one `ui:error` answer and no disk op. In `panelComments.test.ts`, also assert `createIfFresh: false`, one call per copy, and zero calls when untrusted.
**Resolution:** `panelEdit.test.ts` "a resolver error is logged and answered once, and nothing is edited" (resolve rejects once with `MigrationConflictError`: one `ui:error` with `EDIT_FALLBACK_MESSAGE`, calls `log`, `answer:ui:error`, no `editArtboard`). `panelComments.test.ts`: "a resolver error posts one ui:error with its message and writes nothing"; "each copy resolves the page once, never creating, and reads and marks on that page" (`comment:copy` and `comment:copy-open`: `createIfFresh: false`, one resolve before the answer and the refresh's own read after it, the read and `markCommentsSent` get the same page); both untrusted tests now assert zero resolves. `loadActiveSnapshot` still has no unit test (predates 10a). Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): both host test files cover a rejected resolve (one ui:error, no write), createIfFresh false, one resolve per copy, and zero resolves when untrusted. The one log-assertion gap is recorded as F-10.

### 10a/F-03 [P3] closed - Fixture copy instructions point at the tombstone path

**File:** fixtures/picking.html:12
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Sonnet 5.5)
**Why it matters:** `fixtures/picking.html:12` and `fixtures/pins.html:15` say `cp … fixtures/dev-workspace/.cursor-design/artboards/<name>.html`. After 10a that path is the tombstone FILE, so following the instruction fails, or someone "fixes" it by removing the tombstone.
**Suggested fix:** Change both lines to `.cursor-design/pages/page-1/artboards/<name>.html`.
**Resolution:** `fixtures/picking.html:12` and `fixtures/pins.html:15` now copy to `fixtures/dev-workspace/.cursor-design/pages/page-1/artboards/<name>.html`. No test (comment text). Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): both fixture lines point at pages/page-1/artboards/; git grep finds no other live use of the old path.

### 10a/F-04 [P3] closed - The resolver repeats its reads, and its scan-race error is a bare Error

**File:** src/disk/openPage.ts:162
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Sonnet 5.5)
**Why it matters:** `classifyFolder` computes `legacyRootEntries` and `scanPageFolders`, then throws both away. `migrateLegacyFolder` and `writeIndexFromFolders` redo them, so the `MAX_PAGES` cap line logs twice on a rebuild. If a page folder vanishes between the two scans under the lock, `writeIndexFromFolders` throws a bare `Error`, which is not authored copy. `entryExists` (line 42) also duplicates `layoutEntryKind(...) !== 'missing'`.
**Suggested fix:** Carry `names` and `pageIds` in the `FolderState` variants (`{ kind: 'legacy', names }`, `{ kind: 'indexLost', pageIds }`), and pass them to the jobs. That removes the second reads and the bare `Error`. Optionally reuse `layoutEntryKind`. Behavior stays the same.
**Resolution:** `openPage.ts`: `FolderState` carries `{ kind: 'legacy', names }` and `{ kind: 'indexLost', pageIds }` (a non-empty `PageIds` tuple); `migrateLegacyFolder(workspaceRoot, names)` and `rebuildProjectIndex(workspaceRoot, pageIds)` take them from the in-lock classify, so the legacy-entry lstats and the rebuild scan no longer run twice. `writeIndexFromFolders` takes `pageIds` and the bare `Error` is gone; the migration keeps its one post-move scan (page-1 first). `entryExists` is replaced by `layoutEntryKind(...) !== 'missing'`. Same writes, order and errors. Covered by the existing resolver tests and "a rebuild over 101 page folders lists the lowest 100 and logs the rest" (the cap line logs once per classify, two in all, not three). Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): FolderState carries names and pageIds, there is no second read, and the bare Error is gone. Writes and their order are unchanged, and the cap line logs twice (pinned).

### 10a/F-05 [P3] closed - Some resolver and error branches have no direct test

**File:** src/disk/openPage.ts:116
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Sonnet 5.5)
**Why it matters:** These branches have no test:
- `writeArtboardsTombstone`'s "became a folder" `DiskError` (line 116);
- the `MAX_PAGES` scan cap and its log line;
- the `CorruptProjectError` and `UnsupportedProjectVersionError` messages, which are not pinned byte for byte;
- `MIGRATION_CONFLICT` and `CORRUPT_PROJECT` through the MCP contract layer.

None is in the spec's test list, and the risk is low.
**Suggested fix:** Pin the two message strings in `errors.test.ts`. Add a rebuild test with 101 page folders. Test the folder race by creating root `artboards/` before the tombstone write. The MCP-level cases are optional.
**Resolution:** `errors.test.ts` "the project index errors name project.json and the next step" pins both messages and codes byte for byte. `openPage.test.ts` "a rebuild over 101 page folders lists the lowest 100 and logs the rest" (pages `page-1`..`page-100`, open `page-1`, the cap stderr line). `artboardTools.contract.test.ts` "a project.json that is not JSON is CORRUPT_PROJECT and is left as it was" (MCP layer, message pinned). Not done: `writeArtboardsTombstone`'s "became a folder" `DiskError` is reachable only by a race (any root `artboards` directory classifies as Legacy and is moved first), so a test needs fs fault injection; skipped. `MIGRATION_CONFLICT` through MCP is not added (optional); the resolver tests pin its messages. Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): the messages are pinned, the 101-folder rebuild test and the MCP CORRUPT_PROJECT test exist, and the race branch is skipped with a correct reason.

### 10a/F-06 [P3] closed - A file at pages/page-1 during migration gives the generic DISK_ERROR, not the directory message

**File:** src/disk/openPage.ts:184
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Opus 5.5)
**Why it matters:** In a Legacy folder where `.cursor-design/pages/page-1` is a regular file, the conflict check lstats `pages/page-1/<name>` before step b. That fails with `ENOTDIR`, and `lstatOrUndefined` maps only `ENOENT`, so the user sees "Could not read or write artboard files…" instead of the spec's `… must be a directory (symlinks rejected).`. Nothing moves, so no data is at risk. Confirmed by a real-fs probe.
**Suggested fix:** Call `assertDirOwned(workspaceRoot, pageDirSegments(FIRST_PAGE_ID))` at the start of `migrateLegacyFolder`, before the conflict loop, and add one test.
**Resolution:** `migrateLegacyFolder` calls `assertDirOwned(workspaceRoot, pageDirSegments(FIRST_PAGE_ID))` before the conflict loop (`openPage.ts:184`). Test: `openPage.test.ts` "a file at pages/page-1 in a legacy folder is the directory DiskError and moves nothing" (message `.cursor-design/pages/page-1 must be a directory (symlinks rejected).`, tree unchanged); it fails with the guard removed (checked in the scratch copy). Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): removing the guard in a scratch copy fails exactly the new test, and nothing moves before the throw.

### 10a/F-07 [P3] closed - A crash during the project.json write can leave an orphan project.json.<pid>.tmp

**File:** src/disk/openPage.ts:154
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Opus 5.5)
**Why it matters:** `writeUtf8` unlinks only its own process's tmp file. A crash between writing the tmp and the rename leaves `.cursor-design/project.json.<pid>.tmp` behind, and the resume runs in another pid. The watcher and the readers ignore `*.tmp`, so this is clutter, not a correctness bug. Every `writeUtf8` user already behaves this way.
**Suggested fix:** None needed for 10a. At most, add a `ponytail:` on `writeUtf8` naming the ceiling: orphan tmp files after a crash, upgrade path a startup sweep.
**Resolution:** `layoutFs.ts` `writeUtf8`: a `ponytail:` on the per-pid tmp name (ceiling: a crash between the write and the rename leaves an orphan `*.tmp`; upgrade path: sweep stale `*.tmp` files on startup). No behavior change, no test. Closed 2026-11-22 by an /audit re-review (fresh Opus 5.5, scope: current): the ponytail on writeUtf8's tmp name is accurate (the watcher and the readers ignore *.tmp).

### 10a/F-08 [P3] accepted - Reads can now write, so a read-only .cursor-design fails reads that 0.4 served

**File:** src/disk/openPage.ts:236
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Opus 5.5)
**Why it matters:** On an Indexed folder with the tombstone missing, every read runs the tombstone `writeFile wx`. A 0.4 folder also migrates on its first read. On `EROFS` or `EACCES` both become `DISK_ERROR`, so read tools and the panel snapshot fail where 0.4 reads worked. The spec chose writes on reads. Whether read-only workspaces matter has not been checked.
**Suggested fix:** If it matters: make the Indexed tombstone write best-effort (log it and return the page). Leave the migration as it is.
**Resolution:** Accepted by Bombic on 2026-11-22: keep the spec's choice. Reads may move a 0.4 folder and restore a deleted tombstone; read-only `.cursor-design/` folders are not a supported case.

### 10a/F-09 [P3] accepted - An index whose open page folder is missing shows a silently empty stage

**File:** src/host/artboardDisk.ts:121
**Found:** 2026-11-21 by /audit (scope: current; lens: all; reviewer: Opus 5.5)
**Why it matters:** This matches the spec ("no page-folder check"). The watcher refresh and the panel-visible reload post an empty snapshot with no message. Only Open Artboard or `set_artboard` surfaces `PAGE_NOT_FOUND`. In 10a only hand deletion reaches it; 10c's delete makes it reachable. Not checked in real Cursor.
**Suggested fix:** Revisit in 10b/10c: a read that finds an indexed open page without its folder could post the `PAGE_NOT_FOUND` message as the snapshot `errorMessage`.
**Resolution:** Accepted by Bombic on 2026-11-22 for 10a: only hand deletion reaches it here. It is carried to 10b/10c (note in `blueprint/reference/0.5-pages-plan.md`, 10c section), where page delete makes it reachable.

### 10a/F-10 [P3] closed - The comment resolver-error test does not assert the log-once half of its rule

**File:** src/host/panelComments.test.ts:134
**Found:** 2026-11-22 by /audit re-review (scope: current; lens: all; reviewer: Opus 5.5)
**Why it matters:** The spec says a resolver error is logged once and shown through the existing channel. In `panelComments.test.ts`, `logDiskError` is a bare `vi.fn()` that no test asserts, so dropping the log would pass. The production code is correct.
**Suggested fix:** Assert that `logDiskError` was called once with the conflict error.
**Resolution:** The test "a resolver error posts one ui:error with its message and writes nothing" now asserts that the `logDiskError` calls' errors deep-equal `[conflict]`, and `vp test src/host/panelComments.test.ts` passes 14/14. It is fixed by the lead and awaits re-review, which the independent review will cover. Closed 2026-11-22 by the independent review (fresh subagent, claude-opus-5-5, scope: current, a7af7dc): `panelComments.test.ts:144` asserts the logged errors deep-equal `[conflict]`, so a missing or doubled log fails. Mutation proof in a scratch copy: removing `logDiskError` from `refuse` (`panelComments.ts:108`) fails exactly this test (1 failed, 13 passed); the real code passes 14/14. Test-only change, no new defect.

## Independent review

**Status:** passed
**Target commit:** a7af7dcd4959ede6381e34c11232a731ba29348e
**Base commit:** 5b3930707def124e676ccb6797f7295b78080e75
**Base ref:** main
**Spec hash:** dfaed817a515d1cbe6f129b002d951d799146b904b5697b8d24cfd9c1b53d90d
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-22T15:01:49Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-22T15:16:00Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Handoff

Review the active spec and the complete `5b3930707def124e676ccb6797f7295b78080e75..a7af7dcd4959ede6381e34c11232a731ba29348e` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

### Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain --untracked-files=all`: pass. They match the target, the base and the spec hash, and only `review.md` differed before this pass.
- `pnpm verify`: pass. vp check is clean, agent rules pass, svelte-check reports 0 errors and 0 warnings, tsc passes, 62 test files and 803 tests pass, and pack and the webview build succeed.
- `pnpm knip`: pass (no findings).
- `pnpm test:browser`: pass. 196 passed; 208 skipped are the `gallery.spec.ts` cases, which run only with `CD_GALLERY=1`.
- Scratch stdio probe (`node stdio-check.mjs`, in the scratchpad, never in the repo): pass. The new `dist/mcp.js` on a temp copy of `fixtures/legacy-0.4-workspace` deep-equals `baseline.json` for all 4 calls. All 11 tools of the 0.4 bundle return `DISK_ERROR` naming `.cursor-design/artboards`, on the migrated copy and on a fresh folder made by the 0.5 `set_artboard`, and both trees stay byte-identical.
- Scratch mutation probe (`vp test src/host/panelComments.test.ts` with `logDiskError` removed from `refuse`): the F-10 test fails, 1 failed and 13 passed. The real code passes 14/14.

### Evidence

- Reviewed the whole `5b39307..a7af7dc` delta of 58 files. The core files: `src/disk/openPage.ts` (classify, the in-lock re-classify, migration steps a–f, rebuild, fresh create, tombstone race), `layout.ts`, `layoutFs.ts`, `parse.ts`, `errors.ts`, `artboardFs.ts` (`validateNewArtboardArgs`, the non-recursive `makeArtboardsDir` mapping `ENOENT` to `PAGE_NOT_FOUND`), and every per-page op (`canvasView`, `canvasLayout`, `exportFs`, `handoff`, `comments`, `commentsFile`, `commentViews`, `artboardEditFs`).
- Entry points: the 11 MCP handlers each resolve once inside `runQueued`, and only `set_artboard` uses `createIfFresh: true`, after `validateNewArtboardArgs`. The host's `loadActiveSnapshot`, `placeFrameFromChrome`, `answerEditRequest`, `answerHistoryRequest`, `postPanelComments`, `answerCommentRequest` and `exportHandoff` all resolve after the trust check, inside the `try` that gives the one answer, and never inside `withWorkspaceLock`.
- Security: `openPageId` and the scanned folder names pass `isPageId` (`^page-[1-9][0-9]{0,5}$`), so `project.json` cannot steer a path. `.cursor-design/`, `pages/` and `pages/<id>/` must be real directories (lstat, symlinks rejected). The migration only renames after the conflict check, under the lock, and never overwrites. Error copy is authored, holds only relative paths, and leaves `pageId` out of MCP bodies.
- Performance: an Indexed folder costs a few lstats plus one small JSON read per call, with no lock. The watcher ignores `.lock` and `*.tmp`, and the one Indexed write (the tombstone `wx`) does not repeat, so a refresh cannot loop.
- Tests: `openPage.test.ts` (19 resolver tests, including resume, conflicts, race, in-lock re-classify and the 101-folder cap), `errors.test.ts` (pinned messages), the MCP contract tests for a fresh root, `CORRUPT_PROJECT`, `PAGE_NOT_FOUND` and `CORRUPT_META`, and host tests for a rejected resolve. No `.only`, `.skip` or `.todo` was added in the delta.
- Docs: `SKILL.md` (codes, tombstone, MCP-denied fallback, first-call and old-handoff notes, with a guard test), README, rules 02 and 05, `project-plan.md` §4 and the system map all match the code.

### Findings

- F-10 [P3]: closed. The re-review and a mutation probe confirm the log-once assertion.
- F-11 [P3]: open, new. The host snapshot, frame-place and export entry points have no test of their resolver wiring (`src/host/artboardDisk.ts:125`). It does not block.
- No P0 or P1 finding is open or fixed.

### Remaining risk

- `pnpm check`: not run on its own. `pnpm verify` covers it.
- The Mermaid charts in `blueprint/context/system-map.md` were not re-parsed here: no local `mermaid.parse` tool exists in the repo.
- Real-Cursor behavior (panel shows the migrated stage, a stale 0.4 process in a live window, CSP, the watcher refresh after a migration) was not exercised. That is 10e's case A/B by spec.
- The host resolver wiring in `artboardDisk.ts` and `exportHandoff.ts` is checked only by reading the code until F-11 is addressed.

## Try it now

Run or do:

Press F5 (opens `fixtures/dev-workspace`), then run **Cursor Design: Open Artboard**.

Expected:

The stage shows the same frames and comments as before. `fixtures/dev-workspace/.cursor-design/` now holds `project.json` (`openPageId` `page-1`, title "Page 1"), `pages/page-1/` with `manifest.json`, `canvas.json`, `comments.json` and `artboards/`, and a small text file named `artboards`.

This proves:

An existing 0.4 folder moves into page one on first open with no visible change.
