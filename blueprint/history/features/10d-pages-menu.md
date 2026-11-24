# Feature: Pages menu

**From build-plan:** feature 10d
**Build attempt:** 1
**Branch:** feature/pages-menu

## Goal

The user switches, creates, renames and deletes pages from the panel. A toolbar button shows the open page's title and opens a Pages menu: every page in `project.json` order with its last-edited time, New blank page, inline Rename, and Delete behind a native modal (disabled on the last page). The page list rides on `canvas:updated`; four `page:*` chrome → host requests are each answered once (`page:saved` or `ui:error`) and then followed by a direct panel refresh. Contract source: `blueprint/reference/0.5-pages-plan.md` D8, D10, the error table and the 10d section, with Bombic's 2026-11-21 answers (one open page shared with the Agent, deleted pages go to `.cursor-design/deleted/`, fit-all on a switch). The disk ops exist since 10c (`src/disk/pageOps.ts`); this feature adds no disk format, MCP tool or Agent skill change.

## In scope

- `pages: [{ id, title, updatedAt }]` on every `canvas:updated` (D10), built by every snapshot read through `listPages`.
- Chrome → host `page:open`, `page:create`, `page:rename`, `page:delete`; host → chrome `page:saved`. Untrusted-input guards, one answer per attempt, then `refreshPanel`.
- Native delete modal on the host (`showWarningMessage`, `modal: true`) naming where the page goes; a cancel is answered `page:saved` and writes nothing.
- Forget a deleted page's undo histories (D8: "Deleting a page forgets its histories"; deferred from 10c).
- `PageNotFoundError` keeps its `reason` as a field, so the panel can tell a missing folder from an unlisted id.
- Chrome: page button in the toolbar, Pages menu view, one page-menu state class owned by App, keyboard and focus rules, the focus target after a page switch the user caused (the 10b `ponytail:` in `App.svelte` names 10d as its owner).
- Browser tests, gallery states (both themes, WCAG contrast), unit tests.
- Docs in the same change: system map message table rows (step 1, with the drift guard), rule 08 catalog, rule 05 catalog, rule 02 message invariant line, a system map "Pages menu (10d)" section (shipped code only, written last).

## Out of scope

- MCP rename or delete (D9: panel only); any new MCP tool, argument or error code; `SKILL.md` (no tool, arg, Agent-visible error code, runtime limit, sandbox or CSP change; `PageNotFoundError`'s text and code are unchanged).
- Building the page list only while the menu is open (D10 `ponytail:`, already in `listPages`).
- Duplicate page, page search, links between frames (0.5.1), emptying `deleted/`, restoring a deleted page from the UI.
- Cmd/Ctrl shortcuts for pages; drag-reordering pages.
- README, `project-plan.md`, overview and Notion prose (10e owns the docs pass; see Notes for the Notion rule).
- The 11b handler-object refactor: this feature adds one more `setArtboardPanelOn*` setter, as the plan's contracts line says.

## Build loop

`workflow.stepReview` is `feature`: build every step, run its check, and present the whole feature for review at the end. `workflow.checkpointCommits` is `disabled`: no commits between steps; `/complete` makes the one commit. Run `pnpm test` and `pnpm run check` after each step (the message drift guard and the type-check must hold from step 1 on). Chrome steps iterate on one spec (`vp build -c vite.webview.config.ts`, then `playwright test -c tests/browser <file> --grep "<test>"`); run the full `pnpm test:browser` once at the end, `pnpm gallery` once after step 4, and `pnpm verify` last. Svelte edits go through the `svelte-file-editor` subagent with `svelte-autofixer` clean (rule 08).

## Build steps

1. **Wire contract, drift guard and the page list on `canvas:updated`.**
   - `src/webview/hostMessages.ts`: `PostedPage = { id: string; title: string; updatedAt: string | null }`; `CanvasUpdatedMessage.pages: PostedPage[]`; `PageSavedMessage = { type: 'page:saved'; requestId: string }` in `HostMessage`; `PageOpenMessage { type: 'page:open'; requestId; pageId }`, `PageCreateMessage { type: 'page:create'; requestId }`, `PageRenameMessage { type: 'page:rename'; requestId; pageId; title }`, `PageDeleteMessage { type: 'page:delete'; requestId; pageId }`, their union `PageRequestMessage`, added to `ChromeMessage`. These four are **not** page-bound requests: `pageId` here is the target page, not the staged page, and `PageFree` does not apply.
   - `parseHostMessage`: `canvas:updated` requires `pages` to be an array (else the message is invalid, like a missing `frames`); an entry that is not a record with `isPageId(id)`, string `title`, and `updatedAt` string or `null` is dropped. `page:saved` needs a string `requestId`.
   - `src/host/chromeMessages.ts`: zod schemas for the four requests (`requestIdField`, `pageIdField` for the target id; `title: z.string().check(z.maxLength(MAX_PAGE_TITLE_CHARS * 4))`, a size cap only: the trim and title rule are `parsePageTitle`'s at the disk boundary); `pageRequestType(value)` and `pageRequestId(value)` claim guards beside `commentRequestType` / `commentRequestId`.
   - `src/host/panelOutbox.ts`: `PageSavedMessage` joins the `PanelAnswer` union (posted only while ready, never held or replayed); `pages` is carried into `canvas:updated` and its replay.
   - Host snapshot: `CanvasSnapshot.pages: PostedPage[]` (`canvasSnapshot.ts`; `emptyArtboardSnapshot` gives `[]`). In `artboardDisk.ts` `loadActiveSnapshot`, once `resolveOpenPage` succeeded and **after** the snapshot read (and after `initializeDefaultArtboard` on the initialize path, so a just-created page has its time), list pages once with `listPages({ workspaceRoot })` in its own `try` (a throw is logged through `logDiskError` and lists `[]`) and return `{ ...snapshot, pages }` for every snapshot that names the page: the frames snapshot, the empty one, and the failed one (`PAGE_NOT_FOUND` for a missing open-page folder included, so the menu still offers a way out). Untrusted, no folder and a failed resolve post `pages: []`.
   - Drift guard in the same step: `src/webview/frame/frameMessages.test.ts` `HOST_TO_CHROME` gains `page:saved`, `CHROME_TO_HOST` the four `page:*`; `blueprint/context/system-map.md` "Message contract (shipped)" gains the five rows (payloads as in Data / contracts) and the `pages` field on the `canvas:updated` row, plus one sentence under the table that `page:*` `pageId` is the target page.
   - Browser harness `canvasUpdated(...)` (`tests/browser/harness.ts`) and the gallery scene builders post `pages: [{ id: 'page-1', title: 'Page 1', updatedAt: null }]` by default; `pages.spec.ts`'s `stageOf` lists both test pages.
   - **Done when** unit tests cover: a valid `pages` list, a dropped bad entry (bad id, non-string title, numeric `updatedAt`), a missing `pages` rejecting the message, `page:saved` with and without `requestId`; each `page:*` request valid, with a bad `pageId` (`../x`, `page-0`), a missing or bad `requestId`, a non-string or over-cap `title`; the claim guards on garbage; `loadActiveSnapshot` attaching the list on the frames, empty and missing-folder snapshots, a just-initialized page listed with a non-null `updatedAt`, and `[]` when `listPages` throws; the outbox replaying `pages` and never holding or replaying `page:saved`. `pnpm test`, `pnpm run check` (drift guard included) and the existing browser specs pass.

2. **Host answers `page:*`.**
   - `src/disk/errors.ts`: `PageNotFoundError` stores `readonly reason: 'noFolder' | 'unlisted'`; message and code unchanged.
   - `src/disk/pageOps.ts`: export `listedPage(project, pageId)` (the one listed-page rule; `undefined` project or unlisted id throws `PageNotFoundError` `unlisted`) for the host's delete pre-check; drop the `/** @internal */` tags on `renamePage` and `deletePage` (they gain a production caller; `knip --production` must stay clean). No behavior change.
   - `src/host/panelPages.ts` (new, vscode glue like `panelComments.ts`): `answerPageRequest({ value, outputChannel })`, never rejects, one answer per attempt with a valid `requestId`. No usable `requestId`: log only, no answer and no refresh. Order: claimed type → `requestId` → trust (`UNTRUSTED_WORKSPACE_MESSAGE`) → `firstWorkspaceFolder` (`NoWorkspaceError`'s message) → `parseChromeMessage` (wrong or malformed: `MALFORMED_PAGE_REQUEST_MESSAGE` directly, never through `pageRequestErrorMessage`) → `resolveOpenPage({ workspaceRoot, createIfFresh: false })` once → the op:
     - `page:open`: `openPage({ workspaceRoot, pageId })`.
     - `page:create`: `createPage({ workspaceRoot, writeEnsurePanelMarker: false })` (no title: the disk lib names it "Page <n>").
     - `page:rename`: `renamePage({ workspaceRoot, pageId, title })`.
     - `page:delete`: `listedPage(await readProjectFile(workspaceRoot), pageId)` (throws for an unlisted id or a missing `project.json`); one page listed → `InvalidArgsError`, before any modal; else `vscode.window.showWarningMessage(`Delete "<title>"?`, { modal: true, detail: 'Its files move to .cursor-design/deleted/.' }, 'Delete')`, the title passed as plain text. Anything but `'Delete'` answers `page:saved` and writes nothing. `'Delete'` → `deletePage({ workspaceRoot, pageId, now: new Date() })` (it re-checks the last-page rule under the lock), then `forgetPageHistories(pageId)`.
     - Success answers `page:saved { requestId }`; a throw answers `ui:error { requestId, message: pageRequestErrorMessage({ type, error }) }`, logged once. Every answer (success, cancel, error) is followed by `void refreshPanel({ outputChannel })`, so the list and stage catch up without waiting on the watcher; refresh is last-started-wins, so the watcher echo adds nothing.
     - `createPage` and `openPage` resolve again inside; that is their documented contract (the extra resolve is lock-free after the first and adds no write). `renamePage` and `deletePage` do not resolve: the host's one resolve covers them.
   - `src/host/panelRequestCopy.ts` (panel copy only, an allowlist, never the disk lib's Agent text):
     - `export const MALFORMED_PAGE_REQUEST_MESSAGE = 'Could not change the pages. Try again.'`.
     - `pageRequestErrorMessage({ type, error })`:
       - `PageNotFoundError`: `reason === 'unlisted'` → `PAGE_GONE_MESSAGE` ("That page no longer exists."); `noFolder` → `` `This page's folder is missing. Delete the page to remove it from the list.` ``; for `page:create` either reason → the fallback (a create names no page).
       - `InvalidArgsError` by type: rename → `` `A page title needs 1 to ${MAX_PAGE_TITLE_CHARS} characters and no control characters.` ``; create → `` `This project already has ${MAX_PAGES} pages. Delete one first.` ``; delete → `The last page cannot be deleted.`; open → `MALFORMED_PAGE_REQUEST_MESSAGE`.
       - `LockTimeoutError`, `DiskError` → their own message (as `editRequestErrorMessage` does; `NO_PAGE_IDS_LEFT_MESSAGE` is a `DiskError` and names relative paths only).
       - Anything else (`CorruptProjectError`, `UnsupportedProjectVersionError`, `MigrationConflictError`, unknown) → `Could not change the pages. Check the Output panel: Cursor Design.` (the code and text are in the log; the stage's own snapshot error already shows these on load).
   - `src/host/editHistory.ts`: `forgetPageHistories(pageId)` deletes the histories whose key's page part (the text before the first `/`, as `keyText` builds it) equals `pageId` exactly. `ponytail:` an `artboard:edit` on that page whose write finished just before the delete can record after the forget and leave one orphan history (ids are never reused, so it only holds memory until the panel closes). Upgrade path: bump a per-page epoch.
   - `src/panel/openArtboardPanel.ts`: `setArtboardPanelOnPageRequest(handler)`; routing sends `pageRequestType(message) !== undefined` to it, valid or not (before the `artboard:ready` check, like the comment route). `src/extension.ts` wires it to `answerPageRequest`.
   - **Done when** `src/host/panelPages.test.ts` (vscode mocked as in `panelComments.test.ts`) shows: each type's success answers `page:saved` then refreshes; untrusted, no folder, malformed (gets `MALFORMED_PAGE_REQUEST_MESSAGE`, even for a malformed rename) and no-`requestId` paths (the last: no answer, no refresh); delete of an unlisted id, with `project.json` missing, and of the last page answer `ui:error` without showing the modal; modal cancel (`undefined`) answers `page:saved`, calls no `deletePage`, and refreshes; modal confirm deletes, forgets that page's histories, answers `page:saved`; a `LockTimeoutError` answers its own copy; an Agent-copy `InvalidArgsError` or `PageNotFoundError` text never reaches the panel verbatim. `panelRequestCopy.test.ts` covers each branch of `pageRequestErrorMessage` (both `PageNotFoundError` reasons). `editHistory.test.ts`: forgetting `page-1` keeps `page-10`'s and `page-2`'s histories. `errors.test.ts` or the existing `PageNotFoundError` test: `reason` is set for both constructors' paths.

3. **Chrome: page button, Pages menu, page-menu state.**
   - `src/webview/hostBridge.svelte.ts`: `postPageRequest(message: PageRequestMessage)`, which posts the message as built and adds no staged `pageId`.
   - **State.** New `src/webview/pagesMenuState.svelte.ts`, class `PagesMenuState`, created once by `App.svelte` (it spans pages; rule 08: App owns what spans pages). It holds every piece of menu state so a page remount loses nothing: `pages` (from **every** parsed `canvas:updated`, page change or not, read in App before forwarding), `open: boolean`, `renaming: { pageId: string; draft: string } | undefined`, `request: { requestId: string; type: PageRequestMessage['type']; pageId?: string } | undefined` (one in flight; `crypto.randomUUID()`), `error: { type; pageId?; message } | undefined`, and `now` (read when the menu opens). Methods: `toggle`, `close`, `openPage(pageId)`, `createPage`, `startRename(pageId)`, `editRename(draft)`, `submitRename`, `cancelRename`, `deletePage(pageId)`, `handleAnswer(message): boolean`, `pageChanged()`.
   - **App routing.** App passes `page:saved` and any `ui:error` to `pages.handleAnswer` first. A `page:saved` is never forwarded to the page: one whose `requestId` matches nothing is dropped. A `ui:error` that matches the in-flight page request is consumed; any other `ui:error` goes to the page as today.
   - **Pure rules** in `src/webview/pagesMenu.ts` (+ colocated test):
     - `type PageRow = { id: string; title: string; time: string | undefined; current: boolean; canDelete: boolean }`; `pageRows({ pages, openPageId, now }): PageRow[]` (`time` from `relativeTime({ iso, now })`, `undefined` when `updatedAt` is `null` or unparsable; `canDelete` false when one page is listed).
     - `nextRowIndex({ key, index, count }): number | undefined`: `count` = rows + 1 (the New blank page button is the last stop); ArrowDown / ArrowUp wrap, Home → 0, End → `count - 1`; any other key → `undefined`.
   - **View** `src/webview/PagesMenu.svelte` (props in, callbacks out; no menu state of its own): `Toolbar.svelte` takes a `pagesMenu: Snippet` prop rendered first in the bar; `DesignPage.svelte` (which receives the `PagesMenuState` from App) builds that snippet with `<PagesMenu>` fed from the state's fields and methods. DOM hooks for focus: `data-cd-page-button` on the button, `data-cd-pages-menu` on the popup, `data-cd-page-row="<id>"` on each row's open button, `data-cd-page-rename="<id>"` on each Rename button.
     - **Button.** `page` icon and the open page's title (the staged page id's entry in `pages`; the raw id if it is not listed); a `.visually-hidden` "Page:" prefix; `aria-expanded`, `aria-controls` the popup; ellipsis with the full title in `title`. Disabled only when `pages` is empty (no folder, untrusted, no project yet). It does **not** follow the toolbar's no-frames `disabled`: a page with no frames or a load error must still switch.
     - **Menu.** `Widget`-based popup under the button (it already stops pointerdown and wheel from reaching the stage). Disclosure pattern: `role="dialog"`, `aria-label="Pages"`, not an ARIA `menu` (rows hold several buttons). One row per page in order: an open button (title + time; `aria-current="page"` on the open page's row), Rename (`edit` icon), Delete (new `trash` icon in `ui/icons.ts`; disabled with `canDelete` false). New blank page (`plus`) after the list. Max height with its own scroll.
     - **Actions.** Open another page → `page:open`. Open the open page → close the menu, no request. New blank page → `page:create`. Rename → that row's title becomes a plain `<input>` (not `Field`, which is for the inspector; `maxlength` = `MAX_PAGE_TITLE_CHARS` from `layout.ts`; prefilled and selected): Enter sends `page:rename` with the raw draft (the host trims and checks), Escape cancels and focuses that row's Rename button, blur cancels; Enter and Escape are ignored while `event.isComposing`. Delete → `page:delete` (the host asks the modal).
     - **In flight.** One page request at a time. While one is in flight: every menu button and the page button get `aria-disabled="true"` with click guards (never `disabled`: a disabled focused control drops focus to body, `ui/Button.svelte`); the rename field is `readonly`; the menu does not close (Escape, outside pointerdown and focus-leave are ignored), and blur does not cancel the field. A polite live region inside the menu says "Opening page…", "Creating page…", "Renaming page…" or "Deleting page…" (local to the popup, like the toolbar's and DesignPage's own regions; `editState.announcement` stays the inspector's).
     - **Answers.** `page:saved` for open, create or delete: the request clears, the menu closes, and the page button gets focus only if focus was inside `[data-cd-page-button]`, `[data-cd-pages-menu]` or on `body` (focus lost to a remount); otherwise focus stays where the user moved it. `page:saved` for rename: the field ends and that row's Rename button gets focus under the same condition (the new title arrives with the refresh). `ui:error`: the request clears, the menu stays open, and a `Message` (tone error, `role="alert"`) shows under the rename field for a rename (field editable again and refocused, `aria-invalid`, `aria-describedby` the message) or at the menu's end for the others. The error clears on the next page request, an edit of the rename draft, the user closing the menu, or `pageChanged()`. Focus moves run after `tick()` through the DOM hooks.
     - **Keyboard and focus.** Opening the menu (click, Enter, Space) focuses the open page's row, or the first row when the staged id is not listed. ArrowDown / ArrowUp / Home / End move between rows' open buttons and New blank page (`nextRowIndex`); Tab / Shift+Tab walk every control in order. Escape outside the rename field closes and focuses the button; every Escape the menu or field handles calls `preventDefault()`, so DesignPage's window keys (`commentPick.ts`: Escape leaves Comment and Edit mode) ignore it. A `pointerdown` on `document` in the capture phase whose target is outside the button and menu closes it without moving focus. Focus leaving the button and menu closes it, except when the window itself lost focus (`!document.hasFocus()`, e.g. the native modal) or a request is in flight.
     - **Page switch.** App's `stagePage` calls `pages.pageChanged()`: with no request in flight the menu closes and any rename ends; with one in flight the menu stays open (the new page renders it) so the answer has a surface. When the focused element before `leave()` is inside `[data-cd-page-button]` or `[data-cd-pages-menu]`, the new page's `[data-cd-page-button]` gets focus after `flushSync()`. Otherwise focus is left as today (an Agent switch; the 10b `ponytail:` stays for that case, reworded to say so).
   - **Done when** `tests/browser/pagesMenu.spec.ts` (new; host stub = posted messages, answers posted by the test) passes: the button shows the open title and `aria-expanded`; the menu lists pages in order with times; open another page posts `page:open` with that id, and after `page:saved` + a `canvas:updated` for that page the stage switches and the new page button has focus; open the current page posts nothing; New blank page posts `page:create`; rename with Enter posts the raw draft and focus stays in the (readonly) field until a `ui:error`, which shows the error under the field with `aria-invalid` and the field editable and focused; Escape in the field cancels with nothing posted and focuses Rename; delete posts `page:delete`, then a `page:saved` with no list change (cancel) closes the menu with the page unchanged, and a `page:saved` + `canvas:updated` without that page (confirm) removes its row; Delete is disabled with one page; while a request is in flight a second action posts nothing and Escape does not close the menu; Escape closing the menu in Comment mode leaves the mode on Comment; the whole flow works keyboard-only (Tab to the button, Enter, arrows, Enter, Escape) with focus returning to the button; a `canvas:updated` for another page with focus in the menu lands focus on the new page's button and closes the menu, one with focus elsewhere does not move focus, and one arriving with a request in flight keeps the menu open so a later `ui:error` shows in it; a stray `page:saved` with an unknown `requestId` changes nothing; a `canvas:updated` with `pages: []` disables the button. `pagesMenu.test.ts` covers `pageRows` and `nextRowIndex`. The theme guard (`theme.test.ts`) passes with no new exemption. No existing spec counts toolbar tab stops (checked: the Tab-based specs focus a target first), so none needs updating for the new first control.

4. **Gallery states.**
   - New `tests/browser/gallery/states/pagesMenu.ts` exporting `pagesMenuStates`, spread into the state list in `tests/browser/gallery.spec.ts` beside `toolbarStates`. Six states on surface `pages-menu`: `one-page` (Delete disabled), `many-pages` (scrolling list, one edited "just now", one `updatedAt: null`), `long-title` (button and row ellipsis), `rename-field`, `rename-error`, `request-in-flight`. Both themes, WCAG contrast through the gallery's existing check.
   - **Done when** `pnpm gallery` passes contrast for those six state ids in both themes.

5. **Docs (shipped code only, written last).**
   - Rule 08 owner catalog: `PagesMenuState` (`pagesMenuState.svelte.ts`, all page-menu state, owned by App), `pagesMenu.ts` rules (the one page-row rule `pageRows`, the one menu focus step `nextRowIndex`), the `PagesMenu` view, `postPageRequest` in `hostBridge`.
   - Rule 05 catalog: `panelPages.ts` → answers page requests (never rejects, one answer, refresh after each); `pageRequestErrorMessage` and `MALFORMED_PAGE_REQUEST_MESSAGE` under `panelRequestCopy.ts`; `forgetPageHistories` under `editHistory.ts`; `listedPage` under `pageOps.ts`.
   - Rule 02 message invariants: `page:*` requests carry a target `pageId`, not a page-bound one; each is answered once by `page:saved` or `ui:error`, then the host refreshes; the delete modal is the host's.
   - `blueprint/context/system-map.md`: a "Pages menu (10d)" section with one sequence chart (open, create, rename, delete with modal confirm and cancel, an error, an Agent switch with the menu open) checked with the Chart checklist and `mermaid.parse`; the 10b section's "Focus is not moved" line updated; the "Last verified" line. (The table rows landed in step 1.)
   - **Done when** `pnpm verify` passes (agent rules check, knip both modes, svelte-check, unit tests, pack, webview build) and the full `pnpm test:browser` passes once.

6. **Audit repairs (F-21 to F-28, `blueprint/context/findings.md`).**
   - F-21: three `tests/browser/pagesMenu.spec.ts` tests, one per untested guard: in-flight rename blur keeps the field so a later `ui:error` shows; Escape on the page button with the menu open closes it and keeps Comment mode; blur cancels a rename field.
   - F-22: a rename `ui:error` refocuses the field only under the same focus condition as `page:saved` (`focusInMenu({ orBody: true })`).
   - F-23: `commentsPanel.spec.ts` imports `requestsOf` from the harness.
   - F-24: `pagesMenu.spec.ts` builds its relative times per test.
   - F-25: `answerPageRequest` folds the unreachable no-type branch into the `requestId` guard.
   - F-26: rule 02 notes `openPage` / `createPage` resolve again by contract; the system map says the watcher echo adds no second post.
   - F-28 (independent review): one `pagesMenu.spec.ts` test that fails when the F-22 refocus guard is removed.
   - F-27: `ponytail:` on `listPages`'s per-page `updatedAt` log naming the per-refresh ceiling.
   - **Done when** each new F-21 test fails with its guard removed; `pnpm verify` and the full `pnpm test:browser` pass; F-21 to F-28 are marked `fixed` in the ledger.

## Files / areas

- Wire and parse: `src/webview/hostMessages.ts`, `src/host/chromeMessages.ts`, `src/webview/frame/frameMessages.test.ts` (drift guard lists) (+ tests).
- Disk: `src/disk/errors.ts` (`PageNotFoundError.reason`), `src/disk/pageOps.ts` (export `listedPage`, drop two `@internal` tags).
- Host: `src/host/canvasSnapshot.ts`, `src/host/artboardDisk.ts`, `src/host/panelOutbox.ts`, `src/host/panelPages.ts` (new), `src/host/panelRequestCopy.ts`, `src/host/editHistory.ts`, `src/panel/openArtboardPanel.ts`, `src/extension.ts` (+ tests).
- Chrome: `src/webview/App.svelte`, `src/webview/DesignPage.svelte`, `src/webview/Toolbar.svelte`, `src/webview/PagesMenu.svelte` (new), `src/webview/pagesMenuState.svelte.ts` (new), `src/webview/pagesMenu.ts` (new, + test), `src/webview/hostBridge.svelte.ts`, `src/webview/ui/icons.ts` (`trash`).
- Tests: `tests/browser/harness.ts`, `tests/browser/pages.spec.ts` (builder only), `tests/browser/pagesMenu.spec.ts` (new), `tests/browser/gallery/states/pagesMenu.ts` (new), `tests/browser/gallery.spec.ts` (registration), gallery scene builder.
- Docs: `blueprint/context/system-map.md` (table in step 1, section in step 5), `.claude/rules/08-svelte-chrome.md`, `.claude/rules/05-single-job.md`, `.claude/rules/02-mcp-webview.md`.

## Data / contracts

Host → chrome:

| Message | Payload | Rule |
|---|---|---|
| `canvas:updated` | today's fields + `pages: PostedPage[]` | `PostedPage = { id, title, updatedAt: string \| null }`; `id` passes `isPageId`; `updatedAt` ISO 8601 (newest mtime of the page's files, `listPages`) or `null` when unreadable; `[]` when no page resolved or `listPages` threw. Required; bad entries dropped. Held and replayed by the outbox like the rest of the message. |
| `page:saved` | `{ requestId }` | Answer to any `page:*`, a cancelled delete modal included. A `PanelAnswer`: posted before the refresh it causes, never held, never replayed. The chrome drops one that matches no in-flight request. |
| `ui:error` | `{ requestId, message }` | Existing message; panel copy from `pageRequestErrorMessage` or `MALFORMED_PAGE_REQUEST_MESSAGE`. |

Chrome → host (untrusted, parsed by `parseChromeMessage`; each valid `requestId` answered once):

| Message | Payload | Host op |
|---|---|---|
| `page:open` | `{ requestId, pageId }` | `openPage` (writes `openPageId`; no write when already open) |
| `page:create` | `{ requestId }` | `createPage` (`page-<n>`, "Page <n>", default artboard, opened) |
| `page:rename` | `{ requestId, pageId, title }` | `renamePage` (trim, 1–80 chars, no control chars; duplicates allowed). `title` ≤ `MAX_PAGE_TITLE_CHARS * 4` chars at parse, else malformed. |
| `page:delete` | `{ requestId, pageId }` | `listedPage` pre-check, last-page check, modal, then `deletePage` (index first, folder to `deleted/<id>-<stamp>/`, open page hands off to the previous neighbour, else the next) |

- `pageId` on `page:*` is the **target** page and must pass `isPageId`. It is not the staged-page `pageId` that the 8 page-bound requests carry, and `hostBridge` adds none.
- Titles are user data: rendered as text only (never `{@html}`), passed to the native modal as plain text, never put in an Agent prompt.
- Delete modal: message `Delete "<title>"?`, `detail` `Its files move to .cursor-design/deleted/.`, one action `Delete`; Cancel is the platform's.
- Order per request: answer, then `refreshPanel` (snapshot with `pages`, then comments). No answer (no usable `requestId`) means no refresh. A switch reaches the chrome as a `canvas:updated` with the new `pageId`; the 10b remount and fit-all handle it.
- Panel copy (exact strings): `That page no longer exists.`; `This page's folder is missing. Delete the page to remove it from the list.`; `A page title needs 1 to 80 characters and no control characters.` (from `MAX_PAGE_TITLE_CHARS`); `This project already has 100 pages. Delete one first.` (from `MAX_PAGES`); `The last page cannot be deleted.`; `Could not change the pages. Try again.` (`MALFORMED_PAGE_REQUEST_MESSAGE`); `Could not change the pages. Check the Output panel: Cursor Design.`; `LockTimeoutError` / `DiskError` messages as authored.
- Undo history: a confirmed delete forgets every history whose key's page part equals that page id exactly; other pages' histories stay.

## Testing

- Unit (Vitest): parsers, outbox and drift guard (step 1), `answerPageRequest`, its copy, `PageNotFoundError.reason`, `forgetPageHistories` (step 2), `pagesMenu.ts` rules (step 3). Each new guard gets one test that fails if it is removed.
- Browser (Playwright, local): `pagesMenu.spec.ts` as in step 3's done-when; existing specs keep passing with the `pages` default in the harness.
- Gallery: the six `pages-menu` states, both themes, contrast.
- Not covered here: the real native modal and real Cursor focus behavior (window blur while the modal shows). Those are 10e's agent-run real-Cursor checks. This feature claims no live Cursor evidence.

## Notes for the AI

- Read rule 08 before any chrome work; Svelte edits go to `svelte-file-editor` with the Svelte MCP docs and autofixer.
- Reuse, never twin: `relativeTime` (`commentsPanel.ts`), `isPageId` and `MAX_*` (`layout.ts`), `refreshPanel`, `resolveOpenPage`, `listedPage` and the page ops, `IconButton`, `Button`, `Message`, `Icon`, `Widget` as the popup container. The rename input is a plain `<input>`. A new primitive only if two surfaces use it.
- The chrome does **not** validate titles; the host's `parsePageTitle` is the one rule and its refusal comes back as panel copy. `maxlength` and the parse cap are size limits, not a second rule.
- Answer ordering: `page:saved` arrives before the refresh's `canvas:updated`, so the menu has closed and focus sits on the page button when the remount happens; the switch rule then moves focus to the new button. A watcher refresh that beats the answer remounts with the request in flight, so the menu stays open on the new page and the answer still lands.
- 10b already drops stale page-bound answers after a switch and keeps the comment draft slot; an inspector draft is committed by the blur that a click on the page button causes (D8). Do not add page-switch cleanup beyond `pageChanged()`.
- Known corner: in a folder whose sole `page-1` was never opened (no manifest), New blank page fills that page instead of adding one (10c's adopt rule) and answers `page:saved`. The panel's Open Artboard initializes `page-1` first, so this needs a hand-made folder; no extra handling.
- Decisions this spec adds to the plan (record them on the Notion 0.5 page at `/complete`, code > plan): opening the current page sends nothing; the last-page check runs before the modal; every answer, error included, is followed by a refresh; the panel's exact error copy, including the missing-folder copy; the menu stays open across a switch while a request is in flight; the focus rules; page-menu state lives in one App-owned class.
- `ponytail:` already on `listPages` covers the per-refresh stat cost; do not add a second one.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":31873,"specSha256":"4dace8bf13d52efde4f327bbcf62b6f021ce4d8a61b75349e2afd1ba9bad6c5d","branch":"refs/heads/feature/pages-menu","head":"06658d01b2988e1cdd4d0a674fb56bc95dd50325","baseRef":"refs/heads/main","baseCommit":"051c55e135695d4cb91e959a547424d4fcec74b4","sourceTree":"5dd9f9bd0fdf03a38e85f0dbf4d7b16f9aabf994","landing":"local-merge","absentOptional":[]} -->

## Findings

### 10d/F-21 [P2] closed - Three Pages menu guards have no test that fails when removed

**File:** src/webview/pagesMenuState.svelte.ts:146
**Found:** 2026-11-24 by /audit (scope: current; lens: tests)
**Why it matters:** the spec requires one failing test per new guard. Removing any of these leaves all 17 `pagesMenu.spec.ts` tests green: (1) `cancelRename` ignoring a cancel while a request is in flight (`pagesMenuState.svelte.ts:146`); without it, rename → Enter → Tab ends the field and the later `ui:error` is shown nowhere (`menuError` excludes rename errors); (2) `handleButtonKeydown` Escape + `preventDefault()` on the page button (`PagesMenu.svelte:94-100`); without it, Escape with focus on the button while the menu is open also leaves Comment mode; (3) blur cancelling the rename field (`PagesMenu.svelte:143-147`). Auditor probes: a temporary spec with the three scenarios passed clean and failed under each mutation.
**Suggested fix:** three small tests in `tests/browser/pagesMenu.spec.ts`: rename, Enter, Tab, post `ui:error`, expect the alert; Comment mode, open menu, Shift+Tab, Escape, expect menu hidden and Comment still `aria-pressed`; start rename, Tab, expect no textbox.
**Resolution:** 2026-11-24 /implement step 6: three tests added to `pagesMenu.spec.ts`; each failed with its guard removed (in-flight `cancelRename`, button Escape `preventDefault`, rename blur cancel) and passed restored. Full browser 230 pass. 2026-11-24 independent review (claude-opus-5-5, fresh subagent): the three tests are at `pagesMenu.spec.ts:256`, `:271`, `:290`. Probe: removing the in-flight guard in `cancelRename` (`pagesMenuState.svelte.ts:146`) fails `a rename error that lands after Tab leaves the field is still shown`; restored byte-for-byte. Closed.

### 10d/F-22 [P3] closed - A rename `ui:error` pulls focus back from where the user moved it

**File:** src/webview/pagesMenuState.svelte.ts:171
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** while a rename is in flight a click outside keeps the menu open but moves focus (stage, inspector field); the error then refocuses the rename field. `page:saved` respects focus the user moved (`focusInMenu({ orBody: true })`), this path does not. Consistency, not a broken contract (spec says "refocused").
**Suggested fix:** gate the refocus on the same `focusInMenu({ orBody: true })` check.
**Resolution:** 2026-11-24 /implement step 6: `handleAnswer` computes `focusInMenu({ orBody: true })` once; a rename `ui:error` refocuses the field only when it holds. No dedicated test. 2026-11-24 independent review: `handleAnswer` (`pagesMenuState.svelte.ts:170-175`) computes `moveFocus` once and gates the rename refocus on it; the defect is gone. The new guard has no test (probe: dropping `&& moveFocus` leaves all 20 `pagesMenu.spec.ts` tests green), tracked as F-28. Closed.

### 10d/F-23 [P3] closed - `requestsOf` declared twice in browser tests

**File:** tests/browser/commentsPanel.spec.ts:88
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** the harness now exports `requestsOf`, identical to the local copy in `commentsPanel.spec.ts`; rule 09 says specs never re-declare harness helpers.
**Suggested fix:** delete the local copy and import from `./harness`.
**Resolution:** 2026-11-24 /implement step 6: local `requestsOf` removed from `commentsPanel.spec.ts`; imported from `./harness`. 2026-11-24 independent review: `requestsOf` is declared once (`tests/browser/harness.ts:126`); `commentsPanel.spec.ts` and `pages.spec.ts` import it, and `lastRequest` moved there from `gallery/interact.ts`. Closed.

### 10d/F-24 [P3] closed - Pages menu spec time assertion depends on module load time

**File:** tests/browser/pagesMenu.spec.ts:24
**Found:** 2026-11-24 by /audit (scope: current; lens: tests)
**Why it matters:** `PAGES` computes `ago(5)` at module load but a test asserts exactly "Home edited 5 minutes ago"; more than 60 s between load and run reads "6 minutes ago". Low risk, latent flake.
**Suggested fix:** build the pages per test (inside `stageOf` or the test).
**Resolution:** 2026-11-24 /implement step 6: `PAGES` became `pagesNow()`, called at test time. 2026-11-24 independent review: `pagesNow()` (`pagesMenu.spec.ts:27`) builds the times per call. Closed.

### 10d/F-25 [P3] closed - Unreachable "no known type" branch in `answerPageRequest`

**File:** src/host/panelPages.ts:64
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** routing calls `answerPageRequest` only when `pageRequestType(message) !== undefined`, so the separate log-and-return branch never runs and has no test; it exists only to narrow `type`.
**Suggested fix:** fold it into the `requestId` guard (`type === undefined || requestId === undefined`) with one log.
**Resolution:** 2026-11-24 /implement step 6: the no-type branch folded into the `requestId` guard (one log, scope `panelPages.answer`). `panelPages.test.ts` 7 pass. 2026-11-24 independent review: one guard `type === undefined || requestId === undefined` with one log (`panelPages.ts:64-73`); `panelPages.test.ts` no-requestId test covers it. Closed.

### 10d/F-26 [P3] closed - Docs: rule 02 "never re-resolve" and "watcher echo adds nothing" are inexact

**File:** .claude/rules/02-mcp-webview.md:26
**Found:** 2026-11-24 by /audit (scope: current; lens: quality)
**Why it matters:** `page:open` / `page:create` resolve in the host and again inside `openPage` / `createPage` (by contract), which rule 02's "never re-resolve inside an op" contradicts. `system-map.md:434` says the watcher echo "adds nothing", but last-started-wins only drops the post; the echo still runs a full snapshot read (resolve, frames, `listPages`).
**Suggested fix:** rule 02: note `openPage` and `createPage` resolve again by contract; system map: "adds no second post" (it still re-reads).
**Resolution:** 2026-11-24 /implement step 6: rule 02 notes `createPage` / `openPage` resolve again by contract; system map says the echo posts nothing new (it still re-reads). 2026-11-24 independent review: rule 02 line 26 and `system-map.md:434` now match `refreshPanel` (last started wins; the echo re-reads and posts no newer state). Closed.

### 10d/F-27 [P3] closed - An unreadable page logs to stderr on every panel refresh

**File:** src/disk/pageOps.ts:185
**Found:** 2026-11-24 by /audit (scope: current; lens: performance)
**Why it matters:** 10d puts `listPages` on every snapshot read, so a page whose `artboards` is a symlink or non-directory logs `page <id> updatedAt` to stderr on every watcher tick and panel request. Log noise only; the page lists with `updatedAt: null`.
**Suggested fix:** leave it, or mark the per-refresh log with a `ponytail:` naming the ceiling (log once per id if it ever shows).
**Resolution:** 2026-11-24 /implement step 6: the `ponytail:` on the per-page `updatedAt` log names the per-refresh ceiling and the upgrade (log once per id). 2026-11-24 independent review: the `ponytail:` at `pageOps.ts:184-185` names the per-refresh ceiling and the upgrade. Closed.

### 10d/F-28 [P3] closed - The F-22 rename refocus guard has no test that fails when removed

**File:** src/webview/pagesMenuState.svelte.ts:173
**Found:** 2026-11-24 by /audit independent (scope: current; lens: tests)
**Why it matters:** the spec's Testing rule is one failing test per new guard. Probe: changing `request.type === 'page:rename' && moveFocus` to `request.type === 'page:rename'` leaves all 20 `pagesMenu.spec.ts` tests green, so a regression that pulls focus back into the rename field from wherever the user moved it would ship unnoticed.
**Suggested fix:** one test in `tests/browser/pagesMenu.spec.ts`: Rename, type, Enter, move focus outside the menu while the request is in flight (e.g. focus the Comment button; an outside pointerdown does not close the menu then), post `ui:error` for the request, expect the alert and `aria-invalid` on the field and focus still on the outside control.
**Resolution:** 2026-11-24 /implement step 6: `pagesMenu.spec.ts` "a rename error leaves focus where the user moved it during the request"; fails with `&& moveFocus` removed (`toBeFocused`), passes restored. pagesMenu spec 21 pass. 2026-11-24 independent review (claude-opus-5-5, fresh subagent, target 06658d0): the test is `pagesMenu.spec.ts:290` and asserts the alert, `aria-invalid` and focus kept on the Comment button. Probe: `request.type === 'page:rename' && moveFocus` → `request.type === 'page:rename'` (`pagesMenuState.svelte.ts:173`) fails it at `:310` (`toBeFocused`); restored byte-for-byte, `dist/webview` rebuilt, passes. The repair is test-only and adds no defect. Closed.

## Independent review

**Status:** passed
**Target commit:** 06658d01b2988e1cdd4d0a674fb56bc95dd50325
**Base commit:** 051c55e135695d4cb91e959a547424d4fcec74b4
**Base ref:** main
**Spec hash:** 4dace8bf13d52efde4f327bbcf62b6f021ce4d8a61b75349e2afd1ba9bad6c5d
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-24T15:54:35Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-24T15:57:44Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `051c55e135695d4cb91e959a547424d4fcec74b4..06658d01b2988e1cdd4d0a674fb56bc95dd50325` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `git rev-parse HEAD`, `git merge-base main HEAD`, `shasum -a 256 blueprint/context/current-feature.md`, `git status --porcelain`: pass (HEAD = target, merge base = base, spec hash matches, only `blueprint/context/review.md` differed)
- `pnpm verify`: pass (check clean over 228 files, agent rules, knip both modes, 70 files / 866 Vitest tests, pack, webview build)
- `pnpm exec vp build -c vite.webview.config.ts` + `pnpm exec playwright test -c tests/browser pagesMenu.spec.ts --grep "a rename error leaves focus where the user moved it"`: fail under the F-28 mutation (as intended), pass restored
- `pnpm test:browser` (full): not rerun; reused the builder's green run on this exact target (231 passed, 220 gallery skipped)
- `pnpm gallery`: not run (no chrome look change in the review; reviewer instructions)

## Evidence

- Freshness verified before review: target 06658d0, base 051c55e (`main`), spec hash 4dace8bf…c6d5d, no other dirty path.
- Full delta read (51 files): host `panelPages.ts`, `panelRequestCopy.ts`, `chromeMessages.ts`, `artboardDisk.ts`, `canvasSnapshot.ts`, `panelOutbox.ts`, `editHistory.ts`, `openArtboardPanel.ts`, `extension.ts`; disk `errors.ts`, `pageOps.ts`; chrome `App.svelte`, `DesignPage.svelte`, `Toolbar.svelte`, `PagesMenu.svelte`, `pagesMenuState.svelte.ts`, `pagesMenu.ts`, `hostMessages.ts`, `hostBridge.svelte.ts`, `icons.ts`; unit and browser tests; rules 02 / 05 / 08 and the system map. Callers traced: `resolveOpenPage` (does not check the open page's folder, so open / delete still escape a broken page), `refreshPanel` / outbox (no dedupe, so a rename-only list change posts), `listPages`, `deletePage` / `renamePage` / `openPage` / `createPage` error types against the copy allowlist (error classes are flat, so `DiskError` never swallows corrupt / migration errors).
- Security: every `page:*` is trust-checked before parse; ids pass `isPageId`; title capped at parse and checked by `parsePageTitle` under the lock; titles render as text and reach the native modal as plain text; the modal is the delete confirmation boundary, and frame scripts cannot reach `acquireVsCodeApi`.
- F-28 probe: dropping `&& moveFocus` at `pagesMenuState.svelte.ts:173` fails `pagesMenu.spec.ts:290` at `:310`; file restored byte-for-byte (`cmp` identical) from the scratchpad backup and `dist/webview` rebuilt from restored source; the test passes again.

## Findings

- F-28 [P3] closed (re-examined; test pins the guard, repair is test-only)
- F-29 [P3] open: system map rename-answer chart lines omit the focus condition (docs only)
- F-20 [P3] unverified (carried; not re-examined beyond confirming the per-refresh `listPages` cost is already marked `ponytail:`)

## Remaining risk

- Full `pnpm test:browser` not rerun by the reviewer; the builder's green run on this exact target was reused.
- `pnpm gallery` not run in this review (contrast evidence is the builder's).
- Real native modal and Cursor focus around it are not covered by automated tests (10e's real-Cursor checks), as the spec states.
- `openArtboardPanel` routing of `page:*` to `answerPageRequest` has no unit test (same as the existing comment and edit routes).
