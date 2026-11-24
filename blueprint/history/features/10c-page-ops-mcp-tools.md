# Feature: Page ops + MCP tools

**From build-plan:** feature 10c
**Build attempt:** 1
**Branch:** feature/page-ops-mcp-tools
**Status:** verified (2026-11-24: steps 1-8 built; audit F-06..F-28 closed; `pnpm verify` 68 files / 843 unit tests, `pnpm test:browser` 210 passed before the P3 test-and-guard rounds)

## Goal

The Agent can list, create and open pages, and every existing tool tells it which page it acted on. The disk lib gains five page ops: the three MCP tools use `listPages`, `createPage` and `openPage` now; `renamePage` and `deletePage` are built and tested here for the 10d Pages menu. Contract source: `blueprint/reference/0.5-pages-plan.md` D3, D6, D7, D9, D10, D11 and the 10c section, with Bombic's 2026-11-21 answers (one open page that the Agent's tools move, `create_page` opens its page, deleted pages go to `deleted/`, no `pageId` guard on the write tools).

## In scope

- Disk page ops in a new `src/disk/pageOps.ts`: `listPages`, `createPage`, `openPage`, `renamePage`, `deletePage`; ids never reused (D3).
- MCP: `list_pages`, `create_page`, `open_page` in a new `src/mcp/pageTools.ts` with its own input-schema map, registered in `server.ts`.
- `page` in every **existing** tool's success result (D6), through one wrapper. The three page tools return their own page fields instead.
- `PageNotFoundError` gets an "unlisted id" message next to today's "no folder" one.
- `COMMENT_NOT_FOUND` from `get_comment` / `resolve_comment` names the page holding the id when it is on another page (D7).
- `IMPLEMENT.md` names its page (D11).
- 10a audit F-09: the panel snapshot of an indexed open page whose folder is missing shows an error instead of an empty stage.
- Docs in the same change: `skills/cursor-design/SKILL.md`, rule 02, rule 05 catalog, README tool list, system map runtime map and one flow (shipped code only, written last).

## Out of scope

- Any page UI, `page:*` messages, `pages` on `canvas:updated`, the delete modal, forgetting a deleted page's undo histories (all 10d; `renamePage` and `deletePage` have no caller outside tests until then).
- A `pageId` argument or guard on existing tools (Bombic Q6: cut).
- MCP rename or delete (D9: panel actions only).
- Emptying `deleted/`, duplicate page, page search (0.5.1).
- The 11b dedupe beyond the one wrapper this feature needs (see Notes).
- `CHANGELOG.md` (not maintained since 0.1.0).

## Build loop

`workflow.stepReview` is `feature`: build every step, run the step's check, and present the whole feature for review at the end. `workflow.checkpointCommits` is `disabled`: no commits between steps; `/complete` makes the one commit. Run `pnpm test` after each step and `pnpm verify` at the end. No chrome change, so no new browser test; run `pnpm test:browser` once at the end because the host snapshot path changes.

## Build steps

1. **Errors and shared helpers.**
   - `PageNotFoundError(pageId, options?: { reason?: 'noFolder' | 'unlisted'; cause?: unknown })`. `noFolder` (the default) keeps today's text. `unlisted`: `Page "<pageId>" does not exist. Call list_pages for the page ids.` The page id is always a valid `isPageId` string here (callers refuse anything else first). Call sites: `resolveRequestedPage`'s not-indexed check → `unlisted`; its folder check and `artboardFs.ts`'s page-scoped `mkdir` → `noFolder` (unchanged). The panel copy does not change (`panelRequestCopy.ts` maps the class to `PAGE_GONE_MESSAGE`).
   - `CommentNotFoundError(options?: { found?: { id: string; pageId: string; tool: 'get_comment' | 'resolve_comment' }; cause?: unknown })`. With `found`: ``Comment "<id>" is on page <pageId>, which is not open. Call open_page("<pageId>"), then <tool> again.`` Without it, the text is unchanged.
   - `parse.ts`: export `parsePageTitle(value: unknown): string` built on the existing `pageTitleString` rule: a non-string, or a value that is empty after trimming, over `MAX_PAGE_TITLE_CHARS` or holding control characters → `InvalidArgsError(PAGE_TITLE_MESSAGE)`, where `PAGE_TITLE_MESSAGE` = `title must be 1 to ${MAX_PAGE_TITLE_CHARS} characters with no control characters. Fix args and retry.` Returns the trimmed title.
   - `layout.ts`: `DELETED_DIR = 'deleted'`, `deletedDirSegments`, `deletedPageDirSegments(pageId, stamp)`.
   - `handoff.ts`: export `compactIsoTime`.
   - `openPage.ts`: export `pageTitle` (the `Page <n>` rule), `pageNumberText` and `writeProjectFile` for `pageOps.ts`. Do not reuse `scanPageFolders` for the next id (it is capped and filtered); see `nextPageNumber` below.
   Done when: `errors.test.ts` covers both messages of both classes, `parse.test.ts` covers `parsePageTitle` (trim, empty, 80 / 81 chars, control char, non-string), and `pnpm test` is green.

2. **Page ops on disk.** `src/disk/pageOps.ts` with the five ops in Data / contracts.
   Done when: `src/disk/pageOps.test.ts` passes the disk cases under Testing and `pnpm test` is green.

3. **`page` in existing results.** Add `runOnOpenPage({ rootPath, createIfFresh, beforeResolve?, operation })` to `src/mcp/mcpToolResult.ts`. Inside `runQueued`: run `beforeResolve` (set_artboard's `validateNewArtboardArgs`), `resolveOpenPage` once, then `readProjectFile` once (lock-free, **before** the operation, so a corrupt index fails like any other error before any write), then `operation(page)`, then return `{ ...result, page }`. `page` is `{ id, title }` from that read, or `null` when the read found no `project.json` or no entry for the id (a fresh-folder read, or a race). Nothing after the operation can turn a success into an error. Move the 11 existing tool handlers onto it; `export_artboard`'s stray-`artboardId` refusal stays before it.
   Done when: the existing contract tests assert `page` on success (`{ id: 'page-1', title: 'Page 1' }` on a migrated or created folder; `null` for `list_artboards` on an empty folder), no `page` on errors, and `pnpm test` is green.

4. **Page tools.** `pageTools.ts` registers the three tools (table below) with plain `runQueued`, not `runOnOpenPage`. Names in `toolNames.ts`. `artboardTools.ts` exports `shouldWriteEnsurePanelMarker`; `create_page` passes its result as `writeEnsurePanelMarker`. Add `pageToolInputSchemas` to `agentSkill.test.ts`'s tool set and extend `TOOL_NAMES` / the `listTools` test in `commentTools.contract.test.ts` to 14 (11 + 3).
   Done when: `src/mcp/pageTools.contract.test.ts` covers every tool, every listed error and the open-page scoping case, and `pnpm test` is green.

5. **Cross-page comment hint.** `comments.ts` gains a lock-free `findCommentPage({ workspaceRoot, id, exceptPageId })`: reads `project.json`; for each indexed page except `exceptPageId`, reads its `comments.json` and returns the first page id holding the id, or `undefined`. An unreadable or corrupt file is logged with `logStderr` and skipped. `ponytail:` O(pages) reads on a miss; fine at `MAX_PAGES`. `get_comment` and `resolve_comment` catch `CommentNotFoundError` from the open page, call it, and rethrow with `found` when it hits, else rethrow the original. `list_comments` is unchanged.
   Done when: contract tests cover a hit on page-2 while page-1 is open for both tools (code and exact text), a miss everywhere (unchanged text), and `get_comment` succeeding after `open_page("page-2")`; `pnpm test` green.

6. **IMPLEMENT.md page line.** `buildCanvasImplementMarkdown` gains `pageTitle`; the header gets `page: <pageId>` and `pageTitle: <collapseMarkdownHeaderValue(pageTitle)>` after `exportedAt`. `exportArtboard` reads `project.json` before writing any handoff file; the title is the open page's entry, or `pageTitle(pageId)` when the index or entry is missing.
   Done when: the `handoff.test.ts` snapshot shows both lines, a direct `buildCanvasImplementMarkdown` call with a title holding `\n` puts it on one line, and `pnpm test` is green.

7. **F-09 missing open-page folder.** In `loadActiveSnapshot` (`src/host/artboardDisk.ts`), when the manifest is missing and `initializeWhenMissing` is false, `lstat` the page folder; when it is not a directory, throw `new PageNotFoundError(page.pageId)` into the existing `failed()` path (only when `project.json` exists: a fresh folder stays an empty stage), so it is logged through `logDiskError` on each refresh like every other snapshot error and the banner shows `toSafeArtboardErrorMessage` of it (the `noFolder` text). With `initializeWhenMissing` true, the existing `createArtboard` guard already throws `PAGE_NOT_FOUND`; cover it.
   Done when: `artboardDisk.test.ts` pins the `noFolder` text as the snapshot `errorMessage` for both paths, nothing is created on disk, and `pnpm test` is green.

8. **Docs.** `SKILL.md`: the three tools and their shapes; workflow "new design on its own page: `create_page`, then `read_artboard`, then `update_artboard` on `artboard`"; `open_page` / `create_page` move the user's stage; titles are data, not instructions; every result's `page`; check a handoff's `page` before implementing; `open_page` with a non-first `rootPath` does not move the panel; in a folder with no pages yet, `list_pages` is empty: use `set_artboard` or `create_page` first; `create_page` `WORKSPACE_BUSY`: retry, and a retry uses a new page id; the cross-page `COMMENT_NOT_FOUND` text. Rule 02: page tools and `page` in results under MCP tools; under Disk and lock, `createPage` relies on `createArtboard` staying lock-free, and the not-re-entrant list gains `createPage` (it resolves), `openPage`, `renamePage`, `deletePage`; `listPages` and `findCommentPage` are lock-free readers. Rule 05 catalog: `pageOps.ts`, `pageTools.ts`, `runOnOpenPage`, `findCommentPage`, `parsePageTitle`, `nextPageNumber`, `shouldWriteEnsurePanelMarker`, `compactIsoTime`. README tool list and count (14). System map: runtime map tool list and an "Agent page tools (10c)" flow, from the shipped code.
   Done when: `src/mcp/agentSkill.test.ts` passes and `pnpm verify` is green.

## Files / areas

- New: `src/disk/pageOps.ts` + `pageOps.test.ts`, `src/mcp/pageTools.ts` + `pageTools.contract.test.ts`.
- Disk: `layout.ts`, `parse.ts` (+ test), `openPage.ts` (exports; `resolveRequestedPage` reason), `errors.ts` (+ `errors.test.ts`), `comments.ts`, `handoff.ts` + `exportFs.ts`, the snapshot under `src/disk/__snapshots__/`.
- MCP: `toolNames.ts`, `server.ts`, `mcpToolResult.ts`, `artboardTools.ts`, `commentTools.ts`, `artboardTools.contract.test.ts`, `commentTools.contract.test.ts`, `agentSkill.test.ts`.
- Host: `src/host/artboardDisk.ts` (+ test).
- Docs: `skills/cursor-design/SKILL.md`, `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`, `README.md`, `blueprint/context/system-map.md`.

## Data / contracts

**Ids and titles (D3).** Id `page-<n>` (`isPageId`, n ≤ 999999). Titles go through `parsePageTitle`; duplicates allowed; titles appear in results only as fields, never inside an authored sentence.

**`nextPageNumber(workspaceRoot)`** (private to `pageOps.ts`): 1 + the highest n among `project.json` ids, every `pages/` entry name that passes `isPageId` (no directory filter, no cap), and every `deleted/` entry name matching `^page-([1-9][0-9]{0,5})-`. Missing `pages/` or `deleted/` counts nothing. `deleted` present but not a real directory (`assertDirOwned`) → that error, before any write. A candidate that fails `isPageId` → `DiskError` ("No page ids are left. Remove unused folders from .cursor-design/pages/ and .cursor-design/deleted/."), nothing written.

**`listPages({ workspaceRoot })`** → `{ openPageId: string | null, pages: [{ id, title, updatedAt: string | null }] }`. A lock-free reader: it never resolves; the caller resolved first (the `list_pages` handler; the 10d host refresh). No `project.json` → `{ openPageId: null, pages: [] }`, nothing written. Order = `project.json` order. `updatedAt` (`lstat`): ISO 8601 of the newest `mtime` among `pages/<id>/manifest.json`, `canvas.json`, `comments.json`, `artboards/*.html`, `artboards/*.meta.json`; when none exist, the page folder's own `mtime`; `null` when the folder is missing. Any other `lstat` / `readdir` failure for a page is logged (`logStderr`) and gives that page `updatedAt: null`; the list still returns. `ponytail:` O(pages × frames) stats per call; upgrade path: build the list only while the menu is open (D10).

**`createPage({ workspaceRoot, title?, writeEnsurePanelMarker })`** → `{ page: { id, title }, artboardId: 'artboard', generation, hash }`.
1. When `title` is given, `parsePageTitle(title)` before any disk work. Omitted (the 10d New blank page) → `pageTitle(id)` after the claim.
2. `resolveOpenPage({ createIfFresh: true })`.
2a. **Adopt a blank first page** (Bombic 2026-11-24: no empty extra page). When the index lists exactly one page, `page-1`, still titled `Page 1`, and `pages/page-1/manifest.json` does not exist (a folder never opened, which step 2 just created, or a fresh create whose artboard write failed), use `page-1` instead of claiming a new id: `createArtboard` the default artboard into it (`writeEnsurePanelMarker: false`); `ArtboardExistsError` means the host's init filled it meanwhile, so fall through to step 3 and make a new page. Then, under the lock, re-read `project.json`: no index under the lock gives the step-6 "disappeared" `DiskError`; `page-1` no longer listed → `PageNotFoundError('page-1', { reason: 'unlisted' })`; else set its title (when one was given), keep it open, write. Then step 7, and return it.
3. `readProjectFile`; `pages.length >= MAX_PAGES` → `InvalidArgsError` (`A project holds at most ${MAX_PAGES} pages. Delete a page first.`), nothing written.
4. Outside the lock, `n = nextPageNumber(...)`; claim `pages/page-<n>` with a non-recursive `mkdir`; `EEXIST` → n + 1, at most `MAX_PAGES` tries, then `DiskError`.
5. `createArtboard({ page, artboardId: DEFAULT_ARTBOARD_ID, html: DEFAULT_ARTBOARD_HTML, writeEnsurePanelMarker: false })` (lock-free).
6. Under `withWorkspaceLock`: re-read `project.json`. Missing → `DiskError` ("The page list .cursor-design/project.json disappeared. Retry; cursor-design rebuilds it from the page folders.") and never write a new index here. Re-check `MAX_PAGES`. Append `{ id, title }`, set `openPageId` to it, write.
7. After step 6, when `writeEnsurePanelMarker`, write `.ensure-panel` (same write as `createArtboard`'s), so the panel never opens for an unindexed page.
Any failure after step 4 leaves the claimed folder as an orphan (never reused; it returns only on an index rebuild, titled `Page <n>`). `ponytail:` repeated `WORKSPACE_BUSY` at step 6 piles up orphans, each with a default artboard. Upgrade path: remove the claimed folder when step 6 fails before its write. In a folder never opened, step 2a makes the Agent's page `page-1` with its title; no empty extra page.

**`openPage({ workspaceRoot, pageId })`** → `{ page: { id, title } }`. The caller validated `pageId` (`isPageId`). Resolve first (`createIfFresh: false`). Under the lock, re-read `project.json`: missing, or id not listed → `PageNotFoundError(pageId, { reason: 'unlisted' })`; listed but `pages/<id>/` not a directory → `noFolder`. Already open → no write. Otherwise write `openPageId`.

**`renamePage({ workspaceRoot, pageId, title })`** → `{ page: { id, title } }`. Lock-free first: `isPageId(pageId)` else `InvalidArgsError` (no echo), `parsePageTitle(title)`. Never resolves (the 10d host resolved through `resolveRequestedPage`). Under the lock: no `project.json` or id not listed → `unlisted`; same title → no write; else write. Id and folder unchanged.

**`deletePage({ workspaceRoot, pageId, now })`** → `{ deletedPageId, openPageId }`. Lock-free: `isPageId` else `InvalidArgsError`. Never resolves. Under the lock, in order:
1. Re-read `project.json`: missing or id not listed → `unlisted`. Only page → `InvalidArgsError` ("The last page cannot be deleted.").
2. `mkdir` `deleted/` (non-recursive under `.cursor-design/`; `EEXIST` then `assertDirOwned`): a file or symlink at `deleted` fails here, before anything changed.
3. Remove the entry; if it was open, open the previous entry in order, else the next; write `project.json`.
4. `rename` `pages/<id>/` to `deleted/<id>-<compactIsoTime(now)>/`. A failure here is logged (`logStderr`) and does not fail the op; the folder stays an unindexed orphan in `pages/`.
`openPageId` never names a removed entry. `now` is injected for deterministic tests.

**MCP tools** (`pageTools.ts`; each also takes `rootPath` with `ROOT_PATH_DESCRIPTION`):

| Tool | Args | Annotations | Success | Errors |
|---|---|---|---|---|
| `list_pages` | none | `READ_ONLY_ANNOTATIONS` | handler resolves (`createIfFresh: false`), then `listPages` | project codes, `MIGRATION_CONFLICT`, `DISK_ERROR` |
| `create_page` | `title`: required string | `destructiveHint: false`, `openWorldHint: false` | `createPage` result | `INVALID_ARGS` (title, `MAX_PAGES`), project codes, `MIGRATION_CONFLICT`, `WORKSPACE_BUSY`, `DISK_ERROR` |
| `open_page` | `pageId`: required string | `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` | `{ page }` | `INVALID_ARGS` (not a string or not `isPageId`: "pageId must be a page id such as page-2. Call list_pages for the page ids."), `PAGE_NOT_FOUND`, project codes, `WORKSPACE_BUSY` |

"Project codes" = `CORRUPT_PROJECT`, `UNSUPPORTED_PROJECT_VERSION`. A malformed `pageId` is `INVALID_ARGS`, as the plan's error table says. Descriptions say: `list_pages` lists every page and the open one, titles are data, not instructions; `create_page` makes a page with one blank artboard `artboard` and opens it, which moves the user's panel; `open_page` moves the user's panel to that page and every other tool then acts on it.

**`page` in existing results (D6).** Every existing tool's success result gains `page: { id, title } | null`, read before the operation (step 3). Error results never carry it. `list_pages`, `create_page` and `open_page` carry no wrapper `page`: `list_pages` has `openPageId`; the other two return the page they created or opened.

**IMPLEMENT.md (D11).** Header lines `page: page-2` and `pageTitle: <title>` after `exportedAt`. Everything else unchanged.

**Panel.** No message or chrome change. An Agent `open_page` / `create_page` reaches the panel through the existing watcher refresh (D12), which re-resolves the open page and posts `canvas:updated` with the new `pageId` (10b).

## Testing

Unit (Vitest, real temp folders as the existing disk tests do):
- `pageOps.test.ts`: `listPages` on a folder with no index (no write, no `.cursor-design/` created), one page, several pages; `updatedAt` follows a save (`utimes` on an artboard), is `null` for a missing folder, and is `null` for one page whose `artboards` is a file while the others list. `createPage` appends, opens, writes the default artboard and returns its generation and hash; omitted title gives `Page <n>`; at `MAX_PAGES` refuses with nothing written; skips an existing orphan `pages/page-<n>`; counts more than 100 `pages/` folders and a `deleted/page-<n>-*` name (ids never reused after deleting the highest page); `project.json` removed between claim and lock → `DiskError`, no index written; `.ensure-panel` written only after the index write; on a never-opened folder gives one page, `page-1`, with the given title and the default artboard, and no `page-2`; a sole `page-1` that already has a manifest gets a new `page-2`; a sole blank `page-1` the user renamed is not adopted. `openPage`: unlisted, missing folder, already open (no rewrite: same inode). `renamePage`: keeps id and folder, rejects bad titles and ids, unlisted id. `deletePage`: moves the folder to `deleted/<id>-<stamp>/`; opens the previous neighbour, or the next when the first is deleted; keeps `openPageId` when a non-open page is deleted; refuses the last page; a file at `deleted` refuses with `project.json` unchanged; a failed folder rename (folder made unrenamable, or `rename` target pre-created) returns success, leaves the folder in `pages/` and the index without it.
- `errors.test.ts`, `parse.test.ts`: step 1.
- `pageTools.contract.test.ts`: each tool's success shape; `INVALID_ARGS` for a non-string and a malformed `pageId` (message does not echo it) and for a bad title; `PAGE_NOT_FOUND` (unlisted text) for an unknown id; after `open_page("page-2")`, `list_artboards`, `read_artboard`, `update_artboard`, `place_frame` and `list_comments` act on page-2 only and page-1's files stay byte-identical; `create_page` writes `.ensure-panel` only for the first root.
- Existing contract tests: `page` on success, absent on error, `null` on a fresh read (step 3).
- Comment hint (step 5); `handoff.test.ts` (step 6); `artboardDisk.test.ts` (step 7); `agentSkill.test.ts` guards the skill.

Browser: none new; `pnpm test:browser` once at the end. Live Cursor behavior (Agent tools moving the panel) is 10e, not claimed here.

## Notes for the AI

- Ladder: reuse `resolveOpenPage`, `readProjectFile`, `withWorkspaceLock`, `createArtboard`, `writeUtf8`, `assertDirOwned`, `isPageId`, `compactIsoTime`, `collapseMarkdownHeaderValue`, `logStderr`. No new dependency.
- Never call `resolveOpenPage` or any lock-taking op inside `withWorkspaceLock` (rule 02). `createPage` and `openPage` resolve before they take the lock.
- `runOnOpenPage` is the 11b "one MCP open-page wrapper"; it lands here because 10c needs it for `page`. Note at `/complete` that 11b drops that item.
- `pageOps.ts` keeps `openPage.ts` (resolvers) at one job. The function `openPage` and the file `openPage.ts` share a name; the plan accepts it.
- Existing pinned copy in tests changes only where a result now carries `page` and where `resolveRequestedPage` now gives the `unlisted` text to the Agent-facing message (the panel copy is unchanged).
- Verify baseline at spec time (2026-11-24, `main` 573c27e): `pnpm verify` exit 0, 66 files / 801 unit tests pass.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":21871,"specSha256":"2cb512598d7a03752fe12746f6f2ec399bd45f82b8efcde788a28dd2f037a137","branch":"refs/heads/feature/page-ops-mcp-tools","head":"a2c66a8728fd4d5cc676f8efc57a57317d3d85bc","baseRef":"refs/heads/main","baseCommit":"573c27ef23a39646800a27b5a1d9640844f7725e","sourceTree":"08efda39dbce2cb654041013cb7a03deedae6613","landing":"local-merge","absentOptional":[]} -->

## Findings

### 10c/F-06 [P2] closed - `createPage` can append a page id the rebuilt index already lists

**File:** src/disk/pageOps.ts:286
**Found:** 2026-11-24 by /audit (scope: current; lens: correctness)
**Why it matters:** `claimPageFolder` creates `pages/page-<n>/` outside the lock. If `project.json` is deleted before step 6 (the recovery our own error texts suggest), the next `resolveOpenPage` (watcher refresh, panel request) rebuilds the index from the folders, including `page-<n>`. The locked append then adds `page-<n>` a second time; `parseProject`'s duplicate-id check makes every tool and the panel fail with `CORRUPT_PROJECT` until the user deletes `project.json` by hand. Reproduced by a scratch probe through `lockHook.onLocked`.
**Suggested fix:** in the locked op, when `current.pages` already lists `pageId`, update that entry's title (when one was given) and set `openPageId` instead of appending (skip the `MAX_PAGES` re-check there). Add one `pageOps.test.ts` case with `lockHook.onLocked`.
**Resolution:** Closed 2026-11-24 by /audit re-review (Opus): pageOps.ts:315-326 retitles an already-listed claimed id under the lock; probe (always append) fails pageOps.test.ts:372.

### 10c/F-07 [P3] closed - A failed `.ensure-panel` write turns a finished `create_page` into an error

**File:** src/disk/pageOps.ts:327
**Found:** 2026-11-24 by /audit (scope: current; lens: correctness)
**Why it matters:** the marker write runs after the index write. If it fails, the Agent sees an error, retries as the skill says, and makes a second page.
**Suggested fix:** catch and `logStderr` the marker write with a `ponytail:` note (the panel may not open).
**Resolution:** Closed 2026-11-24 by /audit re-review (Opus): pageOps.ts:358-366 logs a failed marker write with a ponytail note; probe (rethrow) fails pageOps.test.ts:397.

### 10c/F-08 [P3] closed - Blank page-1 adoption checks only for a missing manifest

**File:** src/disk/pageOps.ts:203
**Found:** 2026-11-24 by /audit (scope: current; lens: correctness)
**Why it matters:** a sole "Page 1" with `artboards/hero.html` but no `manifest.json` (a `set_artboard` that failed after its HTML write, or a hand-deleted manifest) is adopted: the user's page is retitled and gets an extra `artboard`, while the Agent thinks it has a blank page.
**Suggested fix:** also require `pages/page-1/artboards/` to be missing or empty; add a test.
**Resolution:** Closed 2026-11-24 by /audit re-review (Opus): pageOps.ts:220-225 also requires an empty or missing artboards/; probe fails pageOps.test.ts:224.

### 10c/F-09 [P3] closed - Adoption's locked re-read does not re-check its conditions

**File:** src/disk/pageOps.ts:244
**Found:** 2026-11-24 by /audit (scope: current; lens: correctness)
**Why it matters:** under the lock it checks only that `page-1` is listed, not that it is still the only page titled "Page 1". A concurrent create from another window (or a 10d rename) can be overwritten, or `openPageId` pulled back to `page-1`.
**Suggested fix:** re-run the only-page and title checks under the lock; when they no longer hold, fall through to the normal new-page path.
**Resolution:** Closed 2026-11-24 by /audit re-review (Opus): isSoleUntitledFirstPage re-run under the lock (pageOps.ts:262-265), falls back to a new page; probe fails pageOps.test.ts:260; 3 parallel creates gave page-1..3, no duplicates.

### 10c/F-10 [P3] closed - Export title fallback is untested

**File:** src/disk/exportFs.ts:210
**Found:** 2026-11-24 by /audit (scope: current; lens: tests)
**Why it matters:** replacing `?? pageTitle(page.pageId)` with `?? 'X'` leaves every disk and MCP test green (scratch probe).
**Suggested fix:** one `handoff.test.ts` case exporting with no entry for the open page; assert `pageTitle: Page 1`.
**Resolution:** Closed 2026-11-24 by /audit re-review (Sonnet): handoff.test.ts:492 asserts pageTitle: Page 1; probe on exportFs.ts:212 fails it.

### 10c/F-11 [P3] closed - `nextPageNumber`'s `deleted/` ownership check is untested

**File:** src/disk/pageOps.ts:76
**Found:** 2026-11-24 by /audit (scope: current; lens: tests)
**Why it matters:** deleting the `assertDirOwned(..., deletedDirSegments)` line leaves all `pageOps` tests green; only a symlinked `deleted/` on the `createPage` path reaches it.
**Suggested fix:** one `createPage` case with `deleted` a symlink to a directory: `DiskError`, no new `pages/page-<n>`.
**Resolution:** Closed 2026-11-24 by /audit re-review (Opus): pageOps.test.ts:359 pins the deleted/ symlink refusal; probe (drop the check) fails it.

### 10c/F-12 [P3] closed - One clause of the never-reused-ids test is vacuous

**File:** src/disk/pageOps.test.ts:279
**Found:** 2026-11-24 by /audit (scope: current; lens: tests)
**Why it matters:** the non-directory `pages/page-2` entry is meant to prove "no directory filter", but the `EEXIST` fallback reaches the same answer when the filter is added back.
**Suggested fix:** make the non-directory entry the highest name so only the unfiltered scan yields the expected id.
**Resolution:** Closed 2026-11-24 by /audit re-review (both): non-directory page-5 is the highest name; probes (directory filter, no pages/ names) fail pageOps.test.ts:310.

### 10c/F-13 [P3] closed - The "page folder is a directory" check exists four times

**File:** src/disk/pageOps.ts:348
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** `resolveRequestedPage` (openPage.ts:326), `pageOps.openPage` (:348), `pageUpdatedAt` (:143) and the host F-09 check (artboardDisk.ts) each `lstat` + `isDirectory`; `pageOps.openPage`'s lock-free precheck re-implements `resolveRequestedPage`. Rule 05: one owner per job.
**Suggested fix:** one `pageFolderExists(workspaceRoot, pageId)` in `layoutFs.ts` used by all four.
**Resolution:** Closed 2026-11-24 by /audit re-review (both): one pageFolderExists (layoutFs.ts:91) used by scanPageFolders, resolveRequestedPage, pageOps.openPage, host check; pageUpdatedAt keeps its lstat for the mtime fallback (commented).

### 10c/F-14 [P3] closed - `runOnOpenPage` reads and parses `project.json` a second time per call

**File:** src/mcp/mcpToolResult.ts:130
**Found:** 2026-11-24 by /audit (scope: current; lens: quality, performance)
**Why it matters:** `resolveOpenPage` already parsed the index; the extra read adds no guarantee the resolver does not already give (a corrupt index fails in the resolver). Small cost per call, unmeasured.
**Suggested fix:** keep it as is (simplest), but correct the comment so it does not claim a guarantee it does not add; or return the entry from the resolver.
**Resolution:** Closed 2026-11-24 by /audit re-review (Sonnet): read kept, comment at mcpToolResult.ts:118-120 corrected; forcing page null fails 6 contract tests.

### 10c/F-15 [P3] closed - `create_page`'s title is parsed twice

**File:** src/mcp/pageTools.ts:78
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** the handler parses to make `title` required; `createPage` parses again with `title?: unknown`. Harmless, but a string arrives typed as `unknown`.
**Suggested fix:** type `createPage`'s `title` as `string | undefined` and parse only at the boundaries.
**Resolution:** Closed 2026-11-24 by /audit re-review (both): createPage title is string | undefined (pageOps.ts:348), parsed once at pageTools.ts:78.

### 10c/F-16 [P3] closed - Rule 05 catalog misses new shared helpers

**File:** .claude/rules/05-single-job.md:35
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** `compactIsoTime` (handoff.ts), `requirePageId` (a throwing wrapper over `isPageId`), `writeEnsurePanelFile` (artboardFs.ts) and `pageNumberText` are shared exports not in the catalog, so the next agent may write twins.
**Suggested fix:** add one clause naming them; call `requirePageId` the throwing wrapper of the one guard `isPageId`.
**Resolution:** Closed 2026-11-24 by /audit re-review (Sonnet): rule 05 names compactIsoTime, requirePageId, writeEnsurePanelFile, pageNumberText, pageFolderExists, findCommentPage, runOnOpenPage.

### 10c/F-17 [P3] closed - SKILL.md says "menu order" before the menu exists

**File:** skills/cursor-design/SKILL.md:34
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** the Pages menu ships in 10d; the order is the page-list order in `project.json`.
**Suggested fix:** "in page-list order".
**Resolution:** Closed 2026-11-24 by /audit re-review (Sonnet): SKILL.md says page-list order.

### 10c/F-18 [P3] closed - Spec does not record two shipped choices

**File:** blueprint/context/current-feature.md
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** code > plan: the F-09 host check also requires `project.json` to exist (a fresh folder stays an empty stage; probe-confirmed), and step 2a throws the step-6 "disappeared" `DiskError` when the index is gone under the lock. Neither is in the spec.
**Suggested fix:** record both in the spec's steps 7 and 2a.
**Resolution:** Closed 2026-11-24 by /audit re-review (Sonnet): spec steps 7 and 2a record both choices, matching artboardDisk.ts:153-160 and pageOps.ts:241.

### 10c/F-19 [P3] closed - `open_page` on a listed page whose folder is gone has no contract test

**File:** src/mcp/pageTools.contract.test.ts
**Found:** 2026-11-24 by /audit (scope: current; lens: tests)
**Why it matters:** covered at the disk level only (`pageOps.test.ts:335`); the MCP mapping of the `noFolder` text is unpinned.
**Suggested fix:** add that id to the existing `PAGE_NOT_FOUND` contract case.
**Resolution:** Closed 2026-11-24 by /audit re-review (Sonnet): pageTools.contract.test.ts:237-243 pins the noFolder text; probe fails it.

### 10c/F-21 [P3] closed - `appendNewPage`'s locked `MAX_PAGES` re-check is unpinned

**File:** src/disk/pageOps.ts:277
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: tests)
**Why it matters:** replacing the locked `assertRoomForPage(current)` with nothing leaves every disk and MCP test green; a second window adding a page between the lock-free check and the write would push the project past 100 pages (then `CORRUPT_PROJECT`).
**Suggested fix:** one `lockHook.onLocked` case: 99 pages, the hook writes a 100th; assert `INVALID_ARGS` and no 101st entry.
**Resolution:** 2026-11-24 fixed: pageOps.test.ts lockHook case (99 pages, hook fills to 100) asserts INVALID_ARGS and no page-100; mutation (drop locked re-check) fails it. Closed 2026-11-24 by /audit re-review: mutation probe fails only that test.

### 10c/F-22 [P3] closed - `pageUpdatedAt`'s file-name filter is unpinned

**File:** src/disk/pageOps.ts:144
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: tests)
**Why it matters:** replacing `isNamedFile` with `true` leaves `pageOps.test.ts` green; a stray or temp file in `artboards/` would bump `updatedAt`.
**Suggested fix:** add `artboards/notes.tmp` with the newest mtime to the listPages test and assert `updatedAt` is unchanged.
**Resolution:** 2026-11-24 fixed: listPages test adds a newer `artboards/notes.tmp` and asserts `updatedAt` unchanged; mutation (filter true) fails it. Closed 2026-11-24 by /audit re-review: mutation (filter true) fails only the listPages order test.

### 10c/F-23 [P3] closed - Code comments cite spec and audit ids that stop resolving after `/complete`

**File:** src/disk/pageOps.ts:79
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: quality)
**Why it matters:** "(D3)" (pageOps.ts:79), "(D10)" (:177), "(D7)" (commentTools.ts:60), "F-09" (artboardDisk.ts:153, artboardDisk.test.ts:216), "(0.5.1)" (layout.ts:249) have no durable target once the spec and ledger are archived.
**Suggested fix:** keep the reason, drop the ids (or name the system-map section).
**Resolution:** 2026-11-24 fixed: ids dropped, reasons kept (pageOps.ts D3/D10, commentTools.ts D7, artboardDisk.ts and .test.ts F-09, layout.ts 0.5.1 new line); pre-existing main citations left. Closed 2026-11-24 by /audit re-review: grep finds no new ids; `layout.ts:228` "0.5.1" is pre-existing on main.

### 10c/F-24 [P3] closed - Nothing pins that `runOnOpenPage` reads the title before the op

**File:** src/mcp/mcpToolResult.ts:133
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: tests)
**Why it matters:** moving the `readProjectFile` after `operation(page)` leaves `src/mcp` and `src/disk` green, so the "nothing after a successful op can fail" guarantee is unenforced.
**Suggested fix:** one test whose operation corrupts `project.json` and returns; assert success with a non-null `page`.
**Resolution:** 2026-11-24 fixed: mcpToolResult.test.ts op corrupts project.json, asserts success with page {page-1, Page 1}; mutation (read after op) fails it. Closed 2026-11-24 by /audit re-review: mutation (read after op) fails the test; env stubs and temp dir cleaned.

### 10c/F-25 [P3] closed - `create_page` fails when the sole "Page 1" folder is gone

**File:** src/disk/pageOps.ts:220
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: correctness)
**Why it matters:** with `pages/page-1/` deleted by hand, `isBlankFirstPage` adopts it and `createArtboard` throws `PAGE_NOT_FOUND` for page-1, though a new page-2 could have been made. Nothing is written; the message is actionable.
**Suggested fix:** require `pageFolderExists(workspaceRoot, FIRST_PAGE_ID)` in `isBlankFirstPage`; add a test.
**Resolution:** 2026-11-24 fixed: `isBlankFirstPage` requires `pageFolderExists(page-1)`; test deletes page-1 folder, createPage makes and opens page-2; mutation fails it. Closed 2026-11-24 by /audit re-review: probe fails only the new test; fresh-folder adoption unchanged; guard is lock-free, writes nothing.

### 10c/F-26 [P3] closed - `findCommentPage` follows a symlinked page folder

**File:** src/disk/comments.ts:383
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: security)
**Why it matters:** every other page op calls `assertLayoutDirsOwned` first; this lookup reads `pages/<id>/comments.json` through a symlinked page folder outside the workspace. Exposure is only whether a matching comment id exists there.
**Suggested fix:** call `assertLayoutDirsOwned({ workspaceRoot, pageId })` inside the per-page `try` so a symlinked page is logged and skipped.
**Resolution:** 2026-11-24 fixed: `findCommentPage` calls `assertLayoutDirsOwned` in the per-page try (logged, skipped); comments.test.ts symlinked page-2 not reported; mutation fails it. Closed 2026-11-24 by /audit re-review: probe fails the test; skip is logged via `logStderr`.

### 10c/F-27 [P3] closed - `listPages` follows a symlinked `artboards/` for `updatedAt`

**File:** src/disk/pageOps.ts:149
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: security)
**Why it matters:** `pageUpdatedAt` lstats only the page folder, then reads through a symlinked `artboards/`; a probe got a 2035 mtime of a file outside the workspace into `list_pages`. Read-only, timestamp only.
**Suggested fix:** `assertLayoutDirsOwned` at the top of `pageUpdatedAt`; the per-page catch logs it and lists `updatedAt: null`.
**Resolution:** 2026-11-24 fixed: guard added after the folder check; the listPages "unreadable" test gains a page-4 with symlinked `artboards/` (null, logged); mutation (drop guard) fails it. Closed 2026-11-24 by /audit re-review: probe fails the test; reviewer narrowed the guard to `assertDirOwned(artboards/)` so a symlinked root dir (e.g. `handoff/`) no longer blanks every page; probe re-run on the narrowed guard fails it.

### 10c/F-28 [P3] closed - F-26's test never asserts the skip is logged

**File:** src/disk/comments.test.ts:814
**Found:** 2026-11-24 by /audit re-review (scope: current; lens: tests)
**Why it matters:** rule 06 requires a silent skip to log; removing `logStderr` from `findCommentPage`'s catch left the test green.
**Suggested fix:** assert stderr got "page-2 comments lookup failed".
**Resolution:** 2026-11-24 fixed: assertion added; mutation (drop the log call) fails only that test. Closed 2026-11-24 by /audit re-review: probe confirmed; message matches `logStderr` format.

## Independent review

**Status:** passed
**Target commit:** a2c66a8728fd4d5cc676f8efc57a57317d3d85bc
**Base commit:** 573c27ef23a39646800a27b5a1d9640844f7725e
**Base ref:** main
**Spec hash:** 2cb512598d7a03752fe12746f6f2ec399bd45f82b8efcde788a28dd2f037a137
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-24T12:27:48Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-24T12:31:25Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required


### Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain`: pass (HEAD = target, merge base = base, spec hash matches, only review.md differs; spec is tracked, no snapshot)
- `pnpm verify`: pass (exit 0; vp check 220 files clean, agent rules, knip, knip --production, svelte-check, tsc, 68 files / 843 unit tests, vp pack, webview build)
- `vp test run` mutation probes in a scratch copy (5): 4 killed (host snapshot project.json condition, `nextPageNumber` deleted/ names, `openPage` lock-free pre-check, `deletePage` neighbour order), 1 survived (claim `mkdir` made recursive: F-29)
- `pnpm test:browser`: not run (no chrome change in the delta; Check not required)

### Evidence

- Full `573c27e..a2c66a8` delta read: src/disk (pageOps, errors, parse, layout, layoutFs, openPage, artboardFs, handoff, exportFs, comments), src/mcp (pageTools, mcpToolResult, artboardTools, commentTools, server, toolNames), src/host/artboardDisk.ts, their tests and snapshot, SKILL.md, README, rules 02/05, system map.
- Security: page ids gated by `isPageId` before any path use; titles by `parsePageTitle` (trim, 1-80, no control chars) and `parseProject`; cross-page comment hint echoes the id only when it equals a stored, pattern-checked id; `pageUpdatedAt`, `findCommentPage`, `deletePage` reject symlinked layout dirs or move links without following; error text authored, no paths outside `.cursor-design/`.
- Lock discipline: `createPage` / `openPage` resolve before `withWorkspaceLock`; no lock-taking call inside a locked operation; `runOnOpenPage` reads the title before the op, so a success never turns into an error.
- Performance: extra `project.json` read per tool call (F-14, kept), sequential `listPages` lstats (F-20, unverified), O(pages) comment lookup on a miss only; all bounded by `MAX_PAGES` = 100.
- No `.skip` / `.only` / `.todo` in the new tests.

### Findings

- F-29 [P3] open: `claimPageFolder`'s EEXIST retry is unpinned (src/disk/pageOps.ts:108)
- F-30 [P3] open: `readdirOrEmpty` twins `scanPageFolders`' inline readdir (src/disk/pageOps.ts:68)
- F-31 [P3] open: spec step 2a no longer matches shipped blank-page adoption (blueprint/context/current-feature.md:87)
- No P0 or P1 open or fixed.

### Remaining risk

- `pnpm test:browser` not run by the reviewer (no chrome change; the host snapshot path is unit-tested in artboardDisk.test.ts).
- Live Cursor behavior (Agent `open_page` / `create_page` moving the panel through the watcher) is unverified here; the spec defers it to 10e.
- F-20 `listPages` latency at 100 pages x many frames is unmeasured.
- Cross-process claim race (two MCP processes, later the 10d panel) relies on the EEXIST retry that F-29 says no test pins.

## Try it now

In a workspace with the cursor-design extension (from `pnpm vsix`) and its MCP tools allowed, ask the Cursor Agent:

1. "List my design pages." Expect `list_pages` to return `openPageId` and each page with `id`, `title`, `updatedAt`.
2. "Make a new design page called Pricing." Expect `create_page` to return `page: { id: "page-<n>", title: "Pricing" }` with `artboardId: "artboard"`, and the panel to switch to the new blank page. On a never-opened folder it fills `page-1` instead of adding an empty extra page.
3. "Open page-1." Expect `open_page` to move the panel back; any other tool's result now carries `page: { id: "page-1", ... }`.

Incorrect: a second empty page appearing on a fresh folder, a tool result without `page`, or `open_page("page-99")` not answering `PAGE_NOT_FOUND`.
