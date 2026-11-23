---
description: One job per function, module ownership, and the disk / host / MCP owner catalog to reuse before writing a helper (chrome catalog in rule 08).
globs: src/extension.ts,src/commands/**,src/host/**,src/panel/**,src/mcp/**,src/disk/**,src/types/**
paths:
  - src/extension.ts
  - src/commands/**
  - src/host/**
  - src/panel/**
  - src/mcp/**
  - src/disk/**
  - src/types/**
alwaysApply: false
---

# Single job: host, MCP, disk

A function does **one job**; its name is that job. A module that grows a second hero (disk write vs MCP tool vs panel HTML) extracts a real job, never a forwarder. Process-global I/O policy (write serialization) lives in the write leaf, not a parse module.

| Kind | Lives in | Owns |
|------|----------|------|
| Extension host | `src/extension.ts`, `src/commands/`, `src/host/`, `src/panel/openArtboardPanel.ts`, `src/mcp/registerCursorDesignMcp.ts` | activate, commands, panel, watchers, MCP registration, `postMessage` |
| MCP process | rest of `src/mcp/` | stdio tool handlers over the disk lib; no UI, no `vscode` |
| Disk SoT | `src/disk/` | `.cursor-design/` CRUD, parse, hash; no MCP transport, DOM, `vscode` |
| Webview chrome | `src/webview/`; shell `src/panel/artboardChromeHtml.ts` | render what the host posts; no MCP, no fs (rule 08) |

## Owner catalog: reuse before writing

Grep the owner before writing a helper; extend it, never add a twin; a new shared helper or owner updates this catalog in that change. "The one X" means no second implementation anywhere.

**Disk** (`src/disk/`):

- `errors.ts` → domain errors (new failure = new subclass with a `code`), `isErrno`, `throwDiskError`; the one disk-lib stderr writer `logStderr`; the one UI copy `toSafeArtboardErrorMessage`.
- `layout.ts` → every path segment builder (per-page ones take `pageId`), shared constant and cap (`MAX_*`, `EDIT_STYLE_FIELDS`, patterns), the one page-id guard `isPageId`; constants the frame runtime or chrome import live here, never in a parse5 module.
- `parse.ts` → manifest / meta / project parse and serialize, disk's array-rejecting record guard `isJsonRecord`; `canvasLayout.ts` → `canvas.json` parse and frame placement.
- `openPage.ts` → the one open-page resolver `resolveOpenPage` (migration, index rebuild, fresh create, tombstone; takes the lock) and the one requested-page resolver `resolveRequestedPage`.
- `artboardFs.ts` → artboard create / update / set-active / place ops and `validateNewArtboardArgs`; `layoutFs.ts` → `PageLocation`, low-level reads / writes / ownership checks.
- `canvasView.ts` → artboard list and canvas view (callers import it directly), the one handoff compare `compareScannedHandoff` over the one hash rule `scannedHashes`; `exportFs.ts` (callers import it directly), `handoff.ts`, `effectiveMeta.ts` → export and handoff status; `handoffCanvasHtml.ts` → exported `canvas.html`, embedding `frame/runtime.ts?iife` and `stageGeometry.ts?iife` (never hand-copy either); `hash.ts`, `conflict.ts`; `workspaceLock.ts` → `withWorkspaceLock`.
- `commentsFile.ts` → `comments.json` parse / validate / read / write; `comments.ts` → comment ops that take the lock and lock-free reads; `commentViews.ts` → the one flag path `withCommentViews` and its parse cache; `commentTarget.ts` → target match and flags; `selectorMatch.ts` → selector matching.
- `sourceTags.ts` → tagged frame copy, the one numbering walk `numberedElements`; `artboardEdit.ts` → HTML edit and refusals; `editValues.ts` → parse5-free, shared with chrome: style / text normalizing, the one apply rule `applyStyleChanges`; `inlineStyle.ts` → `style` attribute edits, the one cleared set `clearedProperties`; `artboardEditFs.ts` → `editArtboard`.

**Host** (`src/host/`; no `vscode` in `chromeMessages`, `panelRequestCopy`, `editHistory`, `commentPrompt`, `panelOutbox`):

- `src/commands/` → `commandIds.ts`, one file per command handler (`exportHandoff`, `revealDesignFolder`); `handleOpenArtboard.ts` → Open Artboard and reload of the visible artboard.
- `hostFs.ts` → folder lookup, `logDiskError`, chrome-asset checks; `watchArtboardDisk.ts` → the disk watcher; `agentSkill.ts` → `syncAgentSkill` (shipped skill to `~/.cursor/skills/`).
- `canvasSnapshot.ts` → panel frames from disk; `artboardDisk.ts` → host disk calls (never re-implement disk I/O).
- `chromeMessages.ts` → `parseChromeMessage` and request guards; `panelRequestCopy.ts` → all panel answer copy, never Agent copy; `commentPrompt.ts` → locked Agent prompts.
- `panelComments.ts`, `panelEdit.ts` → answer panel requests: never reject, one answer per attempt, never wrap the disk lock; copy writes the clipboard before `markCommentsSent`. `editHistory.ts` → undo / redo history.
- `panelOutbox.ts` → holds sends until `artboard:ready`, replays state on reload, never replays a `PanelAnswer`. `src/panel/openArtboardPanel.ts` → the one panel and `post*ToPanel`; `src/panel/artboardChromeHtml.ts` → chrome shell HTML and asset paths.

**MCP** (`src/mcp/`): `server.ts` → stdio entry; `artboardTools.ts`, `commentTools.ts` → tool registration and input schemas; `mcpQueue.ts` → `enqueueDiskOp`; `mcpToolResult.ts` → `toMcpToolError`, `runQueued`, stderr `logMcpError`; `resolveWorkspaceRoot.ts` → root from env / `rootPath`; `toolNames.ts`, `mcpIdentity.ts` → names.

**Chrome reused by host or disk:** `src/webview/frame/frameMessages.ts` (`hasControlChars`, `isTagName`, `isSafeStyleValue`, the one prompt line `toOneLine`, `isFiniteNumber`, the one array-accepting record guard `isRecord`), `src/webview/hostMessages.ts` (message types), `src/webview/stageGeometry.ts` (`layoutCanvasChrome`).
