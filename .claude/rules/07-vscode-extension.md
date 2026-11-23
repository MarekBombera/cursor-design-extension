---
description: VS Code extension host practices - activation, disposables, panel, URIs, trust
globs: src/extension.ts,src/host/**,src/panel/**,src/commands/**,src/mcp/registerCursorDesignMcp.ts,package.json,vite.config.ts
paths:
  - src/extension.ts
  - src/host/**
  - src/panel/**
  - src/commands/**
  - src/mcp/registerCursorDesignMcp.ts
  - package.json
  - vite.config.ts
alwaysApply: false
---

# VS Code extension host

## Activation and disposables

- Never `"activationEvents": ["*"]`. Activation is `onStartupFinished` (MCP registers on activate); contributed `commands` already activate. Add `onWebviewPanel:<viewType>` only if you register a serializer.
- `activate` registers commands, MCP and watchers, then returns: no workspace walk, network or waiting on the MCP handshake.
- Never open the panel on activate, update or per window; only from the command or MCP `set_artboard`.
- Push every command, watcher, `OutputChannel`, status item and MCP registration to `context.subscriptions`. Panel-local timers and listeners die in `onDidDispose`. One panel: a second open reveals it, never creates another.

## Commands

- Every command: `contributes.commands` **and** `registerCommand`. IDs `cursor-design.*`, `category: "Cursor Design"`.
- Hide with `when` / `enablement`; still guard the handler (the palette can invoke it anyway).

## Webview host

- `enableScripts: true` for chrome. `localResourceRoots` = extension resources only (`dist/webview`), never the workspace (artboards are nested iframes).
- `vscode.Uri.joinPath` + `webview.asWebviewUri`. Never string-concat paths or put `file://` in webview HTML.
- Prefer `getState` / `setState` over `retainContextWhenHidden` (high memory); retain only if iframe state cannot be restored from disk SoT.

## FS, trust, bundle

- The host reaches `.cursor-design/` only through the `src/disk/` lib (`node:fs`), the same code the MCP process runs, so they cannot drift. `vscode.workspace.fs` appears only in `agentSkill.ts` (skill sync), existence stats (`hostFs.ts`, `revealDesignFolder.ts`) and the watcher's `.ensure-panel` marker delete.
- `import * as vscode` only in the extension host, never in webview or MCP process code (lint).
- Artboard HTML is executable workspace code: `package.json` keeps `capabilities.untrustedWorkspaces.supported: false` (never `true`). The `vscode.workspace.isTrusted` guards before disk writes, MCP registration and panel requests stay as defense in depth.
- `extensionKind: ["workspace"]`: needs the folder, not the local UI host.
- `vp pack` `deps.neverBundle: ['vscode']`. Never depend on the `vscode` npm package.
- Watch with `createFileSystemWatcher` + debounce (~200 ms). Do not poll. No sync fs / CPU on the extension host thread.
