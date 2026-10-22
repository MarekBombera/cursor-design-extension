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
| Webview chrome | `src/webview/`: Svelte 5 components, `hostBridge.svelte.ts`, pure modules `stageGeometry.ts`, `hostMessages.ts`, `stampArtboardHtml.ts`, `frame/` (iframe runtime + frame messages). The host keeps the shell `src/panel/artboardChromeHtml.ts` | render what the host posts. No MCP, no workspace fs |

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

- **Domain errors:** `src/disk/errors.ts` (`ArtboardNotFoundError`, `ConflictError`, `InvalidArgsError`, `NoWorkspaceError`, `CorruptManifestError`, ...). New failure = new subclass there.
- **Logging and safe copy:** host `logDiskError` (`src/host/hostFs.ts`), UI copy `toSafeArtboardErrorMessage` (`src/host/artboardDisk.ts`) and `canvasSnapshotErrorMessage` (`src/host/canvasSnapshot.ts`). MCP: `toMcpToolError` / `logMcpError` (`src/mcp/artboardTools.ts`) and stderr in `src/mcp/server.ts`.
- **Disk layout and constants:** `src/disk/layout.ts` (`*PathSegments`, `artboardHtmlFileName`, defaults, frame width limits).
- **Parse / serialize:** `src/disk/parse.ts` (`parseManifest`, `parseMeta`, `parseArtboardId`, `serialize*`), `src/disk/canvasLayout.ts` (`parseCanvasLayout`, `placeCanvasFrame`, `resolveCanvasFrames`).
- **Artboard operations:** `src/disk/artboardFs.ts` (create / update / read / list / place / setActive / export / `readHandoffStatus`). `generation.ts`, `hash.ts`, `conflict.ts` for concurrency. `handoff.ts`, `handoffCanvasHtml.ts`, `effectiveMeta.ts` for export.
- **Host I/O:** `fileExists`, `isFileNotFound` (`src/host/hostFs.ts`), `ensureArtboardWatcher` / `replaceArtboardWatcher`, snapshots in `src/host/canvasSnapshot.ts`.
- **MCP plumbing:** `enqueueDiskOp` (`mcpQueue.ts`), `resolveWorkspaceRoot`, `toolNames.ts`, `mcpIdentity.ts`.
- **Panel:** `openArtboardPanel` + `post*ToPanel`, `buildArtboardChromeHtml` (shell). Chrome: `parseHostMessage` / `parseSavedStageView` (`src/webview/hostMessages.ts`), `parseFrameMessage` (`src/webview/frame/frameMessages.ts`), `stampArtboardHtml`, stage math in `src/webview/stageGeometry.ts`, host I/O only in `hostBridge.svelte.ts`.
- **Inline scripts:** `scripts/iifeStringPlugin.ts` (`import source from './x.ts?iife'` = the module bundled as an IIFE string). `src/disk/handoffCanvasHtml.ts` embeds `frame/runtime.ts?iife` and `stageGeometry.ts?iife` into the exported `canvas.html`; never hand-copy either as a string.
