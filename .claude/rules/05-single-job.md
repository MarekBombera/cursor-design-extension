---
description: One job per function, module ownership, and the disk / host / MCP owner catalog to reuse before writing a helper (chrome catalog in rule 08).
globs: src/**
paths:
  - src/**
alwaysApply: false
---

# Single job: host, MCP, disk, chrome

A function does **one job**; its name is that job. A module that grows a second hero (disk write vs MCP tool vs panel HTML) extracts a real job, never a forwarder. Process-global I/O policy (write serialization) lives in the write leaf, not a parse module.

| Kind | Lives in | Owns |
|------|----------|------|
| Extension host | `src/extension.ts`, `src/commands/`, `src/host/`, `src/panel/openArtboardPanel.ts`, `src/mcp/registerCursorDesignMcp.ts` | activate, commands, panel, watchers, MCP registration, `postMessage` |
| MCP process | rest of `src/mcp/` | stdio tool handlers over the disk lib; no UI, no `vscode` |
| Disk SoT | `src/disk/` | `.cursor-design/` CRUD, parse, hash; no MCP transport, DOM, `vscode` |
| Webview chrome | `src/webview/`; shell `src/panel/artboardChromeHtml.ts` | render what the host posts; no MCP, no fs |

## Owner catalog: reuse before writing

Grep this and rule 08's chrome catalog before writing a helper; extend the owner, never add a twin; a new shared helper updates the catalog in that change.

**Disk** (`src/disk/`):

- `src/disk/errors.ts`: domain errors; new failure = new subclass (`ArtboardNotFoundError`, `ConflictError`, `EditRefusedError`, ...); `isErrno`, `throwDiskError`; the one UI copy `toSafeArtboardErrorMessage`.
- `src/disk/layout.ts`: `*PathSegments`, `artboardHtmlFileName`, every shared constant and cap (`MAX_*`, `EDIT_FIELDS`, `HISTORY_STEPS`, `SOURCE_TAG_ATTRIBUTE`, `RAW_TEXT_ELEMENTS`, `VOID_ELEMENTS`, `COMMENT_ID_PATTERN`); constants the frame runtime or chrome import live here, never in a parse5 module.
- `src/disk/parse.ts`: `parseManifest`, `parseMeta`, `parseArtboardId`, `isJsonRecord`, `serialize*`. `src/disk/canvasLayout.ts`: `parseCanvasLayout`, `placeCanvasFrame`, `resolveCanvasFrames`.
- `src/disk/artboardFs.ts`: the one artboard-ops import path (`updateArtboard`). `src/disk/layoutFs.ts`: `readUtf8IfExists`, `writeUtf8`, `assertLayoutDirsOwned`, `readStoredMeta`, `requireExactHtmlFileName`.
- `src/disk/canvasView.ts`: `listArtboards`, `readCanvasView`, the one handoff compare `compareScannedHandoff` over the one hash rule `scannedHashes`. `src/disk/exportFs.ts` (`readHandoffStatus`) with `src/disk/handoff.ts`, `src/disk/handoffCanvasHtml.ts` (embeds `frame/runtime.ts?iife` and `stageGeometry.ts?iife`; never hand-copy either), `src/disk/effectiveMeta.ts`. `src/disk/hash.ts`, `src/disk/conflict.ts`; `src/disk/workspaceLock.ts`: `withWorkspaceLock`, `isLockOrTempPath`.
- Comments: `src/disk/commentsFile.ts` (`parseCommentsFile`, `serializeCommentsFile`, `readCommentsFile`, `writeCommentsFile`, `validateNewComment`, `orderedComment`); `src/disk/comments.ts`, ops that take the lock (`addComment`, `replyToComment`, `setCommentStatus`, `markCommentsSent`, `resolveComment`) and lock-free reads (`listComments`, `getComment`, `readComments`); `src/disk/commentViews.ts`, the one flag path `withCommentViews` and parse cache `cachedArtboardDocument`; `src/disk/commentTarget.ts` (`parseArtboardDocument`, `matchCommentTarget`, `targetAgrees`, `commentFlags`); `src/disk/selectorMatch.ts` (`selectMatches`), `src/disk/selectorMatch.cases.ts`.
- Edit: `src/disk/sourceTags.ts` (`sourceTaggedHtml`, the one numbering walk `numberedElements`, `entryOffset`, `tagNameEnd`); `src/disk/artboardEdit.ts` (`editArtboardHtml`, `EditRefusal`); `src/disk/editValues.ts`, parse5-free and shared with chrome (`normalizeStyleValue`, `normalizeEditText`, `isRefusedEditText`, `hasLoneSurrogate`, `previewText`); `src/disk/inlineStyle.ts` (`splitStyleDeclarations`, `setStyleProperty`, `removeStyleProperty`, `asciiTrim`, `leadingWhitespaceLength`, `trailingWhitespaceLength`); `src/disk/artboardEditFs.ts` (`editArtboard`, imported directly, not via `src/disk/artboardFs.ts`).

**Host** (`src/host/`; no `vscode` in `chromeMessages`, `panelRequestCopy`, `editHistory`, `commentPrompt`, `panelOutbox`):

- `src/host/hostFs.ts`: `fileExists`, `isFileNotFound`, `firstWorkspaceFolder`, `NO_FOLDER_MESSAGE`, `logDiskError`. `src/host/watchArtboardDisk.ts`: `ensureArtboardWatcher`, `replaceArtboardWatcher`.
- `src/host/canvasSnapshot.ts`: `canvasSnapshotErrorMessage`, `panelFrames` over the one-frame job `panelFrameHtml`. `src/host/artboardDisk.ts`: `placeFrameFromChrome`; never re-implement disk I/O.
- `src/host/chromeMessages.ts`: `parseChromeMessage`, `isFramePlaceAttempt`, `isArtboardEditAttempt`, `isArtboardHistoryAttempt`, `commentRequestType`, `claimedRequestId`, `commentRequestId`, `toNewComment`, `toPostedComment`.
- `src/host/panelRequestCopy.ts`: all panel answer copy, never Agent copy (`editRequestErrorMessage`, `malformedRequestMessage`, `commentRequestErrorMessage`, `*_MESSAGE`, `isCopyType`).
- `src/host/panelComments.ts` (`postPanelComments`, `answerCommentRequest`), `src/host/panelEdit.ts` (`answerEditRequest`, `answerHistoryRequest`): never reject, one answer per attempt, never wrap the disk lock; copy writes the clipboard before `markCommentsSent`.
- `src/host/editHistory.ts`: `recordEdit`, `historyStepTarget`, `recordStep`, `forgetHistory`, `keepUnchangedHistories`, `clearEditHistories`, `historyFlags`. `src/host/commentPrompt.ts`: locked prompts `singleCommentPrompt`, `openCommentsPrompt`.
- `src/host/panelOutbox.ts`: `createPanelOutbox`, holds sends until `artboard:ready`, replays state on reload, never replays `PanelAnswer`. `src/panel/openArtboardPanel.ts`: `openArtboardPanel`, `post*ToPanel`, `setArtboardPanelOn*`; shell `buildArtboardChromeHtml` (`src/panel/artboardChromeHtml.ts`).

**MCP** (`src/mcp/`): `enqueueDiskOp` (`src/mcp/mcpQueue.ts`), `resolveWorkspaceRoot`, `src/mcp/toolNames.ts`, `src/mcp/mcpIdentity.ts`; `src/mcp/mcpToolResult.ts`: `toMcpToolError`, `runQueued`, stderr `logMcpError`, `src/mcp/server.ts`.

**Chrome reused by host or disk** (rest: rule 08): `src/webview/frame/frameMessages.ts` (`hasControlChars`, `isTagName`, `isSafeStyleValue`, `toOneLine`), message types `src/webview/hostMessages.ts`, `src/webview/stageGeometry.ts` (`layoutCanvasChrome`).
