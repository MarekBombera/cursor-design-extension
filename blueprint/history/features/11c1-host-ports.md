# Feature: Host ports

**From build-plan:** feature 11c1
**Build attempt:** 1
**Branch:** feature/host-ports
**Status:** verified (all four steps built; `pnpm verify` passed 2026-11-27: 74 files, 881 tests)

## Goal

The host's panel request and refresh handlers stop importing their I/O. One small `PanelPorts`
object holds every vscode-backed effect they use: trust, workspace root, log, the three panel posts,
clipboard and the modal confirm. It is built once from vscode and passed in. Six modules
(`panelRequest`, `panelEdit`, `panelComments`, `panelPages`, `artboardDisk`, `refreshPanel`) then
load without `vscode`, so their tests drop the `vscode`, `hostFs` and `openArtboardPanel` mocks and
use a fake ports object. Behavior is unchanged except for one recorded detail (the manifest
existence check, see Data / contracts). 11c2 then moves these tests onto a real temp workspace.

Item 11c was split into 11c1 to 11c4 on 2026-11-27 (Bombic chose to split, quality over a small
diff). The preamble `panelRequest` is shared by every handler, so the ports change cannot be cut
per handler without throwaway bridges. The split is by layer instead: 11c1 changes the source and
swaps the glue mocks; 11c2 rewrites the assertions onto real disk.

## In scope

- `PanelPorts` type and its one vscode builder `createPanelPorts(outputChannel)` in
  `src/panel/openArtboardPanel.ts` (it already owns the outbox posts).
- `panelRequest` / `checkedPanelMessage`, `answerEditRequest`, `answerHistoryRequest`,
  `answerCommentRequest`, `postPanelComments`, `answerPageRequest`, `placeFrameFromChrome`,
  `initAndLoadArtboard`, `readActiveArtboardFromDisk` and `refreshPanel` take `ports` in place of
  `outputChannel` and read trust, root, posts, clipboard and modal only through it.
- `artboardDisk`'s manifest existence check moves from `hostFs.fileExists` (vscode stat) to the
  disk lib's `lstatOrUndefined`.
- Pass-through callers: `extension.ts` builds `ports` once; `handleOpenArtboard`, `ensureArtboardWatcher`
  and `replaceArtboardWatcher` take `ports` in place of `outputChannel`, and their own logs go
  through `ports.log`.
- The six test files swap only their `vscode`, `./hostFs` and `../panel/openArtboardPanel` mocks for
  a local fake ports object. Every test keeps its assertions (an `outputChannel` argument in an
  assertion becomes `ports`).
- The three `post*ToPanel` helpers used only by the builder stop being exported.
- Rule `05-single-job.md` owner catalog.

## Out of scope

- Rewriting test assertions onto real disk or removing the remaining disk-lib mocks (11c2).
- The watcher's trust, folder, timer and marker logic (11c3). Only its `outputChannel` becomes
  `ports`.
- Webview post ports (11c4).
- `canvasSnapshot.test.ts`, `hostFs.test.ts` and `openArtboardPanel.test.ts` mocks (they stay: spies
  only, or the vscode edge itself), except that step 1 extends `openArtboardPanel.test.ts`'s mocks
  for its new `createPanelPorts` test.
- `exportHandoff`, `revealDesignFolder`, `syncAgentSkill`, `registerVibeboardMcp`,
  `migrateLegacyDesignFolders`: they keep `outputChannel`.
- Any message, disk format, MCP tool, Agent skill or chrome change.

## Build loop

`workflow.stepReview: feature`: build every step, then present the whole feature for review once.
`workflow.checkpointCommits: disabled`: no commit per step; `/complete` makes the one commit. Each
step leaves `pnpm test` green; run `pnpm verify` once after the last step. No browser run is needed
(no chrome or frame change), and no F5 (the vscode builder is a set of one-line maps; see Testing).

## Build steps

1. [x] **Ports type and builder.** In `src/panel/openArtboardPanel.ts` add `export type PanelPorts` and
   `export const createPanelPorts = (outputChannel: vscode.OutputChannel): PanelPorts` exactly as in
   Data / contracts. Nothing uses them yet. Add one `createPanelPorts` test to
   `src/panel/openArtboardPanel.test.ts` covering the two mappings with a contract weight:
   - The native delete modal (rule 02: the delete confirm is the host's native modal):
     `confirmModal({ message, detail, action })` calls
     `window.showWarningMessage(message, { modal: true, detail }, action)` once, and resolves `true`
     when it returns `action` and `false` when it returns `undefined`.
   - Getters, not values (the ports object is built once in `activate`, possibly before a folder or
     trust exists): flip the mocked `workspace.isTrusted` and the mocked `firstWorkspaceFolder`
     between two calls; `ports.isTrusted()` and `ports.workspaceRoot()` follow each flip
     (`true` / `'/a'`, then `false` / `undefined`).
   The test's `vscode` mock gains `window.showWarningMessage` and a `workspace` with a mutable
   `isTrusted` getter; its `../host/hostFs` mock gains a mutable `firstWorkspaceFolder`
   (`logDiskError` is not needed: the test never logs).
   - Done when: the test passes, and fails if `modal: true` is dropped, if the `=== action` compare
     is removed, or if either getter is captured at build time; `pnpm test` and
     `pnpm exec vp check` pass.

2. [x] **Manifest check through the disk lib.** Done before the ports swap because it needs no ports:
   `readOpenPageSnapshot` already has `page.workspaceRoot`. Replace the
   `fileExists(joinWorkspace(workspaceFolder, manifestPathSegments(page.pageId)))` check with the
   `lstatOrUndefined` check in Data / contracts, with a `ponytail:` comment naming the dangling
   symlink case (Data / contracts); drop `joinWorkspace`, the `fileExists` import, and
   `workspaceFolder` from `readOpenPageSnapshot`'s parameters (its caller stops passing it).
   `artboardDisk.ts` keeps its `vscode` import (trust, types) and `logDiskError` until step 3.
   Before editing, record the test names of the six host test files:
   `pnpm exec vp test run src/host/{panelEdit,panelEdit.history,panelComments,panelPages,artboardDisk,refreshPanel}.test.ts --reporter=verbose`
   saved to a scratch file (strip durations); steps 2 and 3 diff against it.
   Tests, `artboardDisk.test.ts` (these rewrites are allowed; see Testing, rewrite 4):
   - `args` becomes `let args` (`{ workspaceFolder, outputChannel }` with the temp root's
     `fsPath`), reassigned in `beforeEach`, which makes a fresh `mkdtemp` root and writes
     `pages/page-2/manifest.json` (content `{}`: `readCanvasView` is mocked, so only the file's
     existence matters); `afterEach` (imported from `vite-plus/test`) removes the root.
     `host.manifestExists` and the `fileExists` mock go. A test that set
     `host.manifestExists = false` removes that manifest file instead; the three tests that already
     make their own root just drop the flag.
   - The `frame:place` tests keep `'/ws'`: `placeFrameFromChrome` still reads the root from the
     mocked `firstWorkspaceFolder` (step 3: from the fake's `workspaceRoot: () => '/ws'`), and the
     mocked resolvers echo it. Only the loader `args` move to the temp root.
   - "the manifest gate checks the resolved page, not a fixed one" is re-expressed through behavior:
     with the manifest only under `pages/page-1/` (none under `pages/page-2/`),
     `readActiveArtboardFromDisk` returns an empty snapshot of `page-2` and `readCanvasView` is not
     called; with it under `pages/page-2/`, `readCanvasView` is called once with page `page-2`.
   - "the page list rides on the frames...": the top of every loop iteration rewrites
     `pages/page-2/manifest.json` (the twin of today's `host.manifestExists = true` reset), so only
     the `empty` row's `arrange` removes it and the `failed` row's one-shot rejection is always
     consumed. Each row also asserts `readCanvasView` was called once (`frames`, `frames on Open`,
     `failed`) or zero times (`empty`), after a `mockClear` at the top of the row. `listPages` calls
     are asserted with `[{ workspaceRoot: root }]` (the temp root) in place of `'/ws'`.
   - The `vscode` mock loses `Uri` (nothing uses it now); the `./hostFs` mock loses `fileExists`.
   - Done when: `grep -n "fileExists\|joinWorkspace" src/host/artboardDisk.ts` and
     `grep -n "manifestExists\|fileExists" src/host/artboardDisk.test.ts` print nothing; the test-name
     list diffs empty against the recorded one; deleting the manifest write at the top of the
     page-list loop makes its `readCanvasView` count assertion fail on the `failed` row (`beforeEach` already writes the manifest for the first rows);
     `pnpm test` and `pnpm exec vp check` pass.

3. [x] **Every handler on ports, in one step.** The preamble `panelRequest` is called by every
   handler, `refreshPanel` by `panelPages`, the watcher and Open Artboard, and `postPanelComments` by
   `refreshPanel` and `panelComments`. So the signature swap cannot leave a half-converted state
   that typechecks. Do it as one mechanical step, file by file, then run the tests:
   - `panelRequest.ts`: `panelRequest` logs with `ports.log` and posts `ui:error` with
     `ports.postAnswer`; `checkedPanelMessage` gains `ports` because it reads `ports.isTrusted()`
     and `ports.workspaceRoot()` itself (its `refuse` is the caller's: `placeFrameFromChrome` passes
     a local one that posts nothing). Order and copy unchanged: untrusted
     (`UNTRUSTED_WORKSPACE_MESSAGE`), then `workspaceRoot()` undefined (`new NoWorkspaceError()`,
     its message), then malformed.
   - `panelEdit.ts`: both answers take `ports`; `postEdited` posts with `ports.postAnswer` and logs
     tag errors with `ports.log`.
   - `panelComments.ts`: `postPanelComments({ ports })` and `answerCommentRequest({ value, ports })`
     read trust, root, `postComments`, `postAnswer`, `writeClipboard` and `log` from `ports`. The
     clipboard write still comes before `markCommentsSent` (a rejected `writeClipboard` marks nothing
     sent).
   - `panelPages.ts`: `answerPageRequest({ value, ports })`; `confirmAndDeletePage` asks through
     `` ports.confirmModal({ message: `Delete "${entry.title}"?`, detail: 'Its files move to .vibeboard/deleted/.', action: 'Delete' }) ``
     and deletes only on `true`; every `refreshPanel({ outputChannel })` becomes
     `refreshPanel({ ports })`.
   - `artboardDisk.ts`: `placeFrameFromChrome({ value, ports })`; `initAndLoadArtboard` and
     `readActiveArtboardFromDisk` take `{ workspaceRoot: string; ports: PanelPorts }`;
     `loadActiveSnapshot` reads `ports.isTrusted()`; every `logDiskError` and the read-log
     `appendLine` go through `ports.log` (Data / contracts); `WorkspaceDiskArgs` becomes
     `{ workspaceRoot: string; ports: PanelPorts }`; the `vscode` and `./hostFs` imports go.
   - `refreshPanel.ts`: `refreshPanel({ ports, initialize, errorMessage })` reads
     `ports.workspaceRoot()` and `ports.isTrusted()`, passes `workspaceRoot` and `ports` to the
     loader, posts with `ports.postSnapshot`, logs with `ports.log` and calls
     `postPanelComments({ ports })`.
   - `watchArtboardDisk.ts` and `handleOpenArtboard.ts` take `ports` in place of `outputChannel`
     and log with `ports.log`, keeping each function's argument style: `replaceArtboardWatcher`,
     `ensureArtboardWatcher`, `refreshWatchedArtboard` and `handleOpenArtboard` take `{ ..., ports }`;
     `deleteEnsurePanelMarker(markerUri, ports)` stays positional. Everything else in them stays.
   - `extension.ts`: `const ports = createPanelPorts(outputChannel);` right after the output
     channel; passes `ports` to every handler, the watcher calls and Open Artboard; logs
     `extension.framePlace` with `ports.log`; drops imports it no longer uses.
   - `openArtboardPanel.ts`: delete the exported `postArtboardSnapshotToPanel`,
     `postCommentsToPanel` and `postAnswerToPanel`; `createPanelPorts` calls `outbox.postSnapshot`,
     `outbox.postComments` and `outbox.postAnswer` directly. `postUiStatusToPanel` stays exported.
   - Tests: `panelEdit.test.ts`, `panelEdit.history.test.ts`, `panelComments.test.ts`,
     `panelPages.test.ts`, `refreshPanel.test.ts` and `artboardDisk.test.ts` drop their `vscode`,
     `./hostFs` and `../panel/openArtboardPanel` mocks and build a fake ports object that carries
     over every push and capture the removed mocks made (see Testing). The `artboardDisk.test.ts`
     fake's `workspaceRoot` returns `'/ws'`; its loader `args` become `{ workspaceRoot: root, ports }`.
     Only the rewrites listed under Testing are allowed.
   - Done when: none of `panelRequest.ts`, `panelEdit.ts`, `panelComments.ts`, `panelPages.ts`,
     `artboardDisk.ts`, `refreshPanel.ts` has a runtime import of `vscode`, `./hostFs` or
     `../panel/openArtboardPanel`:
     `grep -n "from 'vscode'\|from './hostFs'\|from '../panel/openArtboardPanel'" src/host/{panelRequest,panelEdit,panelComments,panelPages,artboardDisk,refreshPanel}.ts | grep -v ":import type "`
     prints nothing;
     `grep -rn "outputChannel" src/host/{panelRequest,panelEdit,panelComments,panelPages,artboardDisk,refreshPanel,handleOpenArtboard,watchArtboardDisk}.ts`
     prints nothing; `vi.mock(` counts are `panelEdit` 3, `panelEdit.history` 0, `panelComments` 2
     (`../disk/comments`, `../disk/openPage`), `panelPages` 4 (`./refreshPanel`, `../disk/openPage`,
     `../disk/layoutFs`, `../disk/pageOps`), `artboardDisk` 4 (`../disk/openPage`,
     `../disk/artboardFs`, `../disk/canvasView`, `../disk/pageOps`), `refreshPanel` 2
     (`./artboardDisk`, `./panelComments`); the test-name list diffs empty against the one recorded
     in step 2; `pnpm exec vp check` and `pnpm test` pass.

4. [x] **Docs and gate.** Update the rule `05-single-job.md` owner catalog (Data / contracts). Reword
   the build-plan 11c1 line's "behavior unchanged" to "behavior unchanged except the manifest
   existence check (lstat through the disk lib)"; the Notion version page gets the same note at
   `/complete` (rule 00). Check
   `blueprint/context/system-map.md` for any line naming a changed signature or the removed exports
   and fix it from the code (none expected: the map names no `outputChannel` argument or `post*ToPanel`
   helper today). Run `pnpm verify`.
   - Done when: `pnpm verify` passes, and the total `vi.mock(` count over the six host test files is
     15 (was 32): `panelEdit` 3, `panelEdit.history` 0, `panelComments` 2, `panelPages` 4,
     `artboardDisk` 4, `refreshPanel` 2.

## Files / areas

- `src/panel/openArtboardPanel.ts`: `PanelPorts`, `createPanelPorts`; the three exported
  `post*ToPanel` helpers are deleted (the builder calls the outbox).
- `src/panel/openArtboardPanel.test.ts`: one `createPanelPorts` test (modal, getters).
- `src/host/panelRequest.ts`, `panelEdit.ts`, `panelComments.ts`, `panelPages.ts`,
  `artboardDisk.ts`, `refreshPanel.ts`: take `ports`.
- `src/host/watchArtboardDisk.ts`, `handleOpenArtboard.ts`, `src/extension.ts`: pass `ports`
  through.
- Tests: `src/host/panelEdit.test.ts`, `panelEdit.history.test.ts`, `panelComments.test.ts`,
  `panelPages.test.ts`, `artboardDisk.test.ts`, `refreshPanel.test.ts`.
- `.claude/rules/05-single-job.md` (owner catalog); `blueprint/build-plan.md` (the 11c1 line).

## Data / contracts

No message, disk, MCP or Agent-visible contract changes. Internal contract:

```ts
// src/panel/openArtboardPanel.ts
export type PanelPorts = {
	isTrusted: () => boolean; // vscode.workspace.isTrusted, read at call time
	workspaceRoot: () => string | undefined; // firstWorkspaceFolder()?.uri.fsPath, read at call time
	log: (scope: string, error: unknown) => void; // logDiskError({ scope, error, outputChannel })
	postAnswer: (answer: PanelAnswer) => void; // outbox.postAnswer
	postSnapshot: (snapshot: CanvasSnapshot) => void; // outbox.postSnapshot
	postComments: (comments: Omit<CommentsUpdatedMessage, 'type'>) => void; // outbox.postComments
	writeClipboard: (text: string) => Promise<void>; // await vscode.env.clipboard.writeText(text)
	// await vscode.window.showWarningMessage(message, { modal: true, detail }, action) === action
	confirmModal: (prompt: { message: string; detail: string; action: string }) => Promise<boolean>;
};
export const createPanelPorts = (outputChannel: vscode.OutputChannel): PanelPorts;
```

- Getters, not values: trust and folders change while the extension runs (trust grant, folder
  change), and every handler reads them at call time today.
- One `ports` object for the extension's life, built in `activate` right after the output channel.
  No module holds it in a global; each call receives it.
- Host modules import the type with `import type { PanelPorts } from '../panel/openArtboardPanel'`,
  never `import { type PanelPorts } from ...`: the inline form can keep a side-effect import of the
  module, and with it `vscode` (it does under `verbatimModuleSyntax`, which only
  `tsconfig.webview.json` sets today; `import type` is erased under every setting).
  A runtime import of that module, `./hostFs` or `vscode` from the six modules is the defect this
  item removes.
- New signatures (each replaces `outputChannel: vscode.OutputChannel` with `ports: PanelPorts`; all
  other arguments unchanged): `panelRequest`, `answerEditRequest`, `answerHistoryRequest`,
  `answerCommentRequest`, `postPanelComments`, `answerPageRequest`, `placeFrameFromChrome`,
  `refreshPanel`, `handleOpenArtboard`, `ensureArtboardWatcher`, `replaceArtboardWatcher`.
  `checkedPanelMessage` gains `ports: PanelPorts`. `initAndLoadArtboard` and
  `readActiveArtboardFromDisk` take `{ workspaceRoot: string; ports: PanelPorts }` (was
  `{ workspaceFolder, outputChannel }`).
- Log text stays byte-identical. `log(scope, error)` is `logDiskError`, which writes
  `${scope}: ${error.stack ?? error.message}` for an `Error` and `${scope}: ${String(error)}`
  otherwise. So the canvas read-log line `` outputChannel.appendLine(`${readLog.scope}: ${readLog.tileMessage}`) ``
  becomes `ports.log(readLog.scope, readLog.tileMessage)` with the same text.
- Manifest existence (decided; the one behavior detail). `readOpenPageSnapshot` checks
  `(await lstatOrUndefined(workspaceJoin(page.workspaceRoot, manifestPathSegments(page.pageId)))) !== undefined`
  in place of `fileExists(vscode.Uri.joinPath(...))`. Why: rule 07 says the host reaches
  `.vibeboard/` only through the disk lib, and the same function already uses `lstatOrUndefined` for
  `project.json` two lines below. What changes, only in a hand-broken workspace:
  - A regular manifest, a missing one and a live symlinked one behave as today (vscode `stat`
    follows a live symlink, so it already counts as present).
  - A dangling symlinked `manifest.json` now counts as present (lstat does not follow it), so the
    read goes to `readCanvasView`. With no `artboards/` folder that returns an empty view
    (`canvasView.ts`, before the manifest read): an empty stage with no error, on Open and on
    refresh. With an `artboards/` folder, the manifest read's ownership check fails and the snapshot
    shows its error. Today the same file counts as missing: Open calls `initializeDefaultArtboard`,
    whose `createArtboard` throws "must be a regular file" before writing anything, and refresh
    shows an empty stage or `PageNotFoundError`. Nothing is written in either version; the new path
    attempts no write at all.
  - A non-ENOENT error now arrives as the disk lib's `DiskError` (through `throwDiskError`) in place
    of a vscode `FileSystemError`. Both land in `loadActiveSnapshot`'s `failed`, which logs and shows
    `toSafeArtboardErrorMessage`.
  - `hostFs.fileExists` stays (the watcher uses it).
  - The check carries a `ponytail:` comment: a dangling symlinked manifest counts as present, so
    such a page reads as an empty stage or the ownership error instead of failing Open; upgrade
    path: refuse a symlinked manifest at the check.
- Unchanged invariants the reviewers check: one answer per attempt; `ui:error` before
  `afterRefuse`; clipboard before `markCommentsSent`; the modal runs after the last-page check and
  before `deletePage`; no await between the edit write and its answer post (`answerEditRequest`'s
  ponytail); last-started-wins tokens in `refreshPanel` and `postPanelComments`; the untrusted
  snapshot still prunes the `panelFrames` memo.
- Owner catalog (`05-single-job.md`): the Host header's vscode-free list gains `panelRequest`,
  `panelEdit`, `panelComments`, `panelPages`, `artboardDisk`, `refreshPanel`. The
  `src/panel/openArtboardPanel.ts` entry reads "the one panel, the one ports object `PanelPorts`
  and its builder `createPanelPorts` (trust, root, log, panel posts, clipboard, modal; every host
  request and refresh handler takes it, never imports its I/O; the watcher and Open Artboard pass it
  through), `postUiStatusToPanel` and the one handlers object `setArtboardPanelHandlers`". The
  phrase `post*ToPanel` leaves the entry.

## Testing

- `pnpm test` after every step, `pnpm verify` once at the end.
- Each test file builds its own fake ports with a local factory (rule 09: local factories stay in
  the test file), for example:

  ```ts
  const ports = {
  	isTrusted: () => host.isTrusted,
  	workspaceRoot: () => (host.hasFolder ? '/ws' : undefined),
  	log: vi.fn((_scope: string, _error: unknown) => host.calls.push('log')),
  	postAnswer: vi.fn((answer: { type: string }) => host.calls.push(`answer:${answer.type}`)),
  	postSnapshot: vi.fn(),
  	postComments: vi.fn(),
  	writeClipboard: vi.fn(() => Promise.resolve()),
  	confirmModal: vi.fn(() => Promise.resolve(true)),
  } satisfies PanelPorts;
  ```

- Each fake carries over every side effect its removed mock had, so the existing assertions still
  read the same data:
  - `panelComments.test.ts`: `writeClipboard` pushes `'clipboard'`, stores the text in
    `host.clipboard`, and one test makes it reject once (today's `writeText`).
  - `panelPages.test.ts`: `confirmModal` pushes `'modal'` and resolves `host.confirmed` (a boolean
    replacing `host.modalChoice`; rewrite 3).
  - `panelEdit.test.ts`: `log` pushes `'log'`; `workspaceRoot` follows `host.hasFolder`.
  - `panelEdit.history.test.ts`: `log` counts `host.logs`; `workspaceRoot` returns `host.root`.
  - `refreshPanel.test.ts` and `artboardDisk.test.ts`: whatever their `hostFs` / panel mocks
    recorded, read from the fake instead; the `artboardDisk` fake's `workspaceRoot` returns `'/ws'`.
- The six test files together load without `vi.mock('vscode')`. Vitest cannot resolve `vscode`
  outside the extension host and has no alias for it, so a runtime `vscode` import anywhere in their
  unmocked module graph fails the run. That is the check for the "no runtime import" done-whens.
- Kept assertions are the regression net: the same test names, the same expected answers, call
  orders and disk effects. Only these rewrites are allowed:
  1. An argument `outputChannel` becomes `ports`; loader args `{ workspaceFolder, outputChannel }`
     become `{ workspaceRoot, ports }` (in `artboardDisk.test.ts`, the shared `args` and the three
     tests that build their own root).
  2. A read of a removed mock reads the fake instead: `postAnswerToPanel`, `postCommentsToPanel`,
     `postArtboardSnapshotToPanel` and `writeText` calls; `logDiskError({ scope, error, outputChannel })`
     calls become `ports.log` calls `[scope, error]` (for example `artboardDisk.test.ts`'s list-failure
     test, `refreshPanel.test.ts`'s log check, `panelComments.test.ts`'s log check).
  3. Modal assertions: `showWarningMessage(message, { modal: true, detail }, 'Delete')` becomes
     `confirmModal({ message, detail, action: 'Delete' })` with the same strings, and
     `showWarningMessage` call counts become `confirmModal` counts; `host.modalChoice`
     (`'Delete'` / `undefined`) becomes `host.confirmed` (`true` / `false`). `modal: true` itself is
     covered by step 1's `createPanelPorts` test.
  4. Step 2's manifest rewrites in `artboardDisk.test.ts`: `let args` on a temp root, the gate test
     re-expressed, the page-list loop's per-row manifest rewrite, its added `readCanvasView` count
     assertion, and its `'/ws'` → root.
  Any other assertion change means behavior changed: stop and report it.
- `createPanelPorts` gets one unit test (step 1: the modal and the two getters). Its other members
  are one-line maps over vscode; the clipboard write is not exercised against real vscode by any
  automated test here. A `/check` can run Copy prompt and a page delete in the Extension
  Development Host if Bombic wants live evidence.
- No browser tests: no chrome, frame or message change.

## Notes for the AI

- Lint: rule 04 (object args for 3+ params, so `confirmModal` takes one object), export return
  types, no `any`. Keep the file-top comments true: "vscode glue only" on `panelRequest`,
  `panelEdit`, `panelComments` and `panelPages` becomes wrong; reword it to say what is true (for
  example "Panel request handler: all I/O through ports.").
- Do not move `logDiskError` out of `hostFs.ts`; the builder calls it.
- `placeFrameFromChrome`'s local `refuse` keeps posting nothing (its banner copy goes back to the
  caller); it logs through `ports.log`.
- `panelComments`' `afterRefuse` for copy types becomes `() => { void postPanelComments({ ports }); }`;
  `panelPages`' becomes `() => { void refreshPanel({ ports }); }`.
- Run `knip` (part of verify): an import left unused by the deleted post helpers must not trip it.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":25305,"specSha256":"7d1dc67ffc451a50bf7f30436bd44926d11fb86da24826e9b71e6a78c89eb7b3","branch":"refs/heads/feature/host-ports","head":"3d6c3bb19c5c456ac0f54f6a9dc53b91eeae1e5c","baseRef":"refs/heads/main","baseCommit":"3d6c3bb19c5c456ac0f54f6a9dc53b91eeae1e5c","sourceTree":"771b6eefb9aa036c8f405bde74b670fca15630fb","landing":"local-merge","absentOptional":[]} -->
