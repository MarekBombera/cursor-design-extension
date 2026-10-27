---
description: One job per function, module ownership (host / MCP / disk / chrome), and the owner catalog to reuse before writing a helper.
globs: src/**
paths:
  - src/**
alwaysApply: false
---

# Single job: host, MCP, disk, chrome

A function does **one job**. The name is that job. When a module grows a second hero (disk write vs MCP tool vs panel HTML), extract. Do not keep stacking steps into the owner.

Extract **a real job**, not a forwarder. `const save = (args) => writeArtboard(args)` stays out; call `writeArtboard(args)`. Thin barrels that re-export split modules are fine when callers should still import one path.

| Kind | Lives in | Owns |
|------|----------|------|
| Extension host | `src/extension.ts`, `src/commands/`, `src/host/`, `src/panel/openArtboardPanel.ts`, `src/mcp/registerCursorDesignMcp.ts` | activate, commands, panel lifetime, watchers, MCP registration, `postMessage` |
| MCP process | rest of `src/mcp/` | stdio server + tool handlers over the disk lib. No UI, no `vscode` (lint) |
| Disk SoT | `src/disk/` | artboard / canvas / handoff CRUD, parse, generation, hash. No MCP transport, no DOM, no `vscode` (lint) |
| Webview chrome | `src/webview/`: Svelte 5 components, `hostBridge.svelte.ts`, pure modules `stageGeometry.ts`, `frameGesture.ts`, `hostMessages.ts`, `stampArtboardHtml.ts`, `frame/` (iframe runtime + frame messages). The host keeps the shell `src/panel/artboardChromeHtml.ts` | render what the host posts. No MCP, no workspace fs |

```ts
// ✅ owner wires; jobs are named
export const activate = (context: vscode.ExtensionContext): void => {
	registerCursorDesignMcp(context);
	const panel = openArtboardPanel(context);
	watchArtboardDisk({ workspaceRoot, onChange: panel.postArtboard });
};
```

- Process-global I/O policy (write serialization, latches) lives in the write leaf (`enqueueDiskOp`), not in a pure parse module.
- `*.test.ts` covers the extracted job, not the `activate` wrapper.

## Owner catalog: reuse before writing

Grep this before writing a helper. Extend the owner (new param, variant) instead of adding a twin. Keep it current when you add a shared helper; that is part of the change.

- **Domain errors:** `src/disk/errors.ts` (`ArtboardNotFoundError`, `ConflictError`, `InvalidArgsError`, `NoWorkspaceError`, `CorruptManifestError`, `LockTimeoutError`, `FrameMovedError`, `CorruptCommentsError`, `UnsupportedCommentsVersionError`, `CommentNotFoundError`, `CommentResolvedError`, `PickOutdatedError`, ...). New failure = new subclass there. Fs error helpers `isErrno` / `throwDiskError` live there too.
- **Logging and safe copy:** host `logDiskError` (`src/host/hostFs.ts`), UI copy `toSafeArtboardErrorMessage(error, fallback?)` (`src/host/artboardDisk.ts`; the fallback replaces the default copy for non-domain errors) and `canvasSnapshotErrorMessage` (`src/host/canvasSnapshot.ts`). MCP: `toMcpToolError` / `logMcpError` (`src/mcp/mcpToolResult.ts`) and stderr in `src/mcp/server.ts`.
- **Disk layout and constants:** `src/disk/layout.ts` (`*PathSegments`, `artboardHtmlFileName`, defaults, frame width limits, pick caps `MAX_SELECTOR_CHARS` / `MAX_PICK_TEXT_CHARS` / `MAX_STYLE_VALUE_CHARS` and `COMMENT_STYLE_KEYS`, comment caps `MAX_COMMENT_BODY_CHARS` / `MAX_COMMENTS` / `MAX_COMMENT_REPLIES`).
- **Parse / serialize:** `src/disk/parse.ts` (`parseManifest`, `parseMeta`, `parseArtboardId`, `isJsonRecord`, `serialize*`), `src/disk/canvasLayout.ts` (`parseCanvasLayout`, `placeCanvasFrame`, `resolveCanvasFrames`).
- **Artboard operations:** `src/disk/artboardFs.ts` (create / update / read / place / setActive; the one import path that re-exports the modules below). Layout-safe fs primitives and the shared manifest / meta / canvas.json reads (`readUtf8IfExists`, `writeUtf8`, `assertLayoutDirsOwned`, `readStoredMeta`, ...): `src/disk/layoutFs.ts`. Artboard scan, `listArtboards`, panel `readCanvasView` (with `handoffStale`) and the one handoff compare `compareScannedHandoff`: `src/disk/canvasView.ts`. Export and `readHandoffStatus`: `src/disk/exportFs.ts`. `hash.ts`, `conflict.ts` for concurrency. Cross-process write lock: `withWorkspaceLock` / `isLockOrTempPath` (`src/disk/workspaceLock.ts`). `handoff.ts`, `handoffCanvasHtml.ts`, `effectiveMeta.ts` for export. Comments disk: `comments.ts` (`parseCommentsFile`, `addComment`, `replyToComment`, `setCommentStatus`, `markCommentsSent`, `resolveComment`, `listComments`, `getComment`, panel read `readComments` without flags) and `commentTarget.ts` (`parseArtboardDocument`, `matchCommentTarget`, `targetAgrees`, `commentFlags`).
- **Host I/O:** `fileExists`, `isFileNotFound`, `firstWorkspaceFolder` / `NO_FOLDER_MESSAGE` (`src/host/hostFs.ts`), `ensureArtboardWatcher` / `replaceArtboardWatcher`, snapshots in `src/host/canvasSnapshot.ts`, panel load / default-artboard init and drag commit `placeFrameFromChrome` (`src/host/artboardDisk.ts`, over the disk lib; never re-implement disk reads or writes in the host). Chrome ↔ host parsing and mapping: `parseChromeMessage` / `isFramePlaceAttempt` / `isCommentCreateAttempt` / `commentCreateRequestId`, `toNewComment` (pin from `box`) / `toPostedComment` (explicit field pick) (`src/host/chromeMessages.ts`, no `vscode`). Panel comments glue, never rejecting: `postPanelComments` (read + post, last read wins) / `createCommentFromChrome` (one answer per attempt) (`src/host/panelComments.ts`).
- **MCP plumbing:** `enqueueDiskOp` (`mcpQueue.ts`), `resolveWorkspaceRoot`, `toolNames.ts`, `mcpIdentity.ts`, shared result helpers `toMcpToolError` / `logMcpError` / `runQueued` (`mcpToolResult.ts`).
- **Panel:** `openArtboardPanel` + `post*ToPanel` (vscode glue), what reaches the chrome and when (held until `artboard:ready`, re-sent on reload, status held until `mcpAvailable` is known; `postComments` cached and replayed after view and status, `postAnswer` only while ready and never replayed): `createPanelOutbox` (`src/host/panelOutbox.ts`, no `vscode`), `buildArtboardChromeHtml` (shell). Chrome: `parseHostMessage` / `parseSavedStageView` (`src/webview/hostMessages.ts`), `parseFrameMessage` / `parseChromeFrameMessage` / `hasControlChars` / `isSafeStyleValue` / `isTagName` / `parseFrameRect` (`src/webview/frame/frameMessages.ts`; `comments.ts` reuses the pick guards, `parseHostMessage` the rect guard for `comments:updated`), `stampArtboardHtml` / `FRAME_CSP` (frame's second, inline-only policy), stage math in `src/webview/stageGeometry.ts` (frame-local rect to screen: `frameRectToScreen`), frame move/resize gesture rules `stepFrameGesture` / `settleFrameGesture` / `failFrameGesture` / `arrowNudge` / `revealOffset` / `wheelToView` (zoom-vs-pan for both wheel paths), root scroll sink `scrollSinkStep` (the rest of a trackpad pan that left an out-of-process frame) (`src/webview/frameGesture.ts`), frame list merge per `canvas:updated` `mergeCanvasFrames` / `liveIframeIds`, height guard on a record `applyFrameHeight`, render-error `demoteToTile`, drawn frames `withGestureOverride` / `toChromeFrames`, hover / pick `frameOutline` (`src/webview/canvasFrames.ts`), window message routing `routeMessage` (`src/webview/hostMessages.ts`), Comment-mode picking rules `applyPickMessage` / `toggleCommentMode` / `keepLiveFrames` / `clearPick`, and the C / Escape rule for chrome keys and `cd:key` `modeKeyAction` (`src/webview/commentPick.ts`), comment popover rules `popoverKeyAction` / `draftFromPick` / `canSubmit` / `blockedTargetCopy` / `submitDraft` / `answerDraft` / `keepLiveDraft` / `targetChipText` / `popoverAnchor` / `placePopover` (`src/webview/commentPopover.ts`; the view is `CommentPopover.svelte`, rendered in Stage's `children`), host I/O only in `hostBridge.svelte.ts` (chrome → frame sends only through `postToFrame`). Screen-space hover and pick outlines: `Overlay.svelte`.
- **Picking (frame runtime):** Comment-mode listeners and state `installCommentPicking` (`src/webview/frame/commentPicking.ts`, called by `runtime.ts` after it captures `window.parent`; `runtime.ts` itself forwards C / Escape as `cd:key`), hit-test rules `pickTarget` / `clipRect` / `paintsFromStyle` / `pointInTarget`, rect equality `sameRect`, re-post skip `isUnchangedPick` (`src/webview/frame/pickTarget.ts`), parent/child stepping `stepToParent` / `stepToChild` (`src/webview/frame/pickPath.ts`), pick data `buildSelector` / `describeElement` / `isGeneratedName` / `textExcerpt` / `readStyles` (`src/webview/frame/selector.ts`).
- **Inline scripts:** `scripts/iifeStringPlugin.ts` (`import source from './x.ts?iife'` = the module bundled as an IIFE string). `src/disk/handoffCanvasHtml.ts` embeds `frame/runtime.ts?iife` and `stageGeometry.ts?iife` into the exported `canvas.html`; never hand-copy either as a string. Its label and heading boxes come from `layoutCanvasChrome` imported directly.
