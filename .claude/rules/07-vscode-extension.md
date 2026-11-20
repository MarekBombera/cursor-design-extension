---
description: VS Code extension host practices - activation, disposables, panel, URIs, trust
globs: src/extension.ts,src/host/**,src/panel/**,src/commands/**,src/mcp/registerCursorDesignMcp.ts,src/disk/**,package.json,vite.config.ts
paths:
  - src/extension.ts
  - src/host/**
  - src/panel/**
  - src/commands/**
  - src/mcp/registerCursorDesignMcp.ts
  - src/disk/**
  - package.json
  - vite.config.ts
alwaysApply: false
---

# VS Code extension host

## Activation

- Never `"activationEvents": ["*"]`. Activation is `onStartupFinished` (MCP registers on activate); contributed `commands` already activate. Add `onWebviewPanel:<viewType>` only if you register a serializer.
- `activate` registers commands, MCP and watchers, then returns: no workspace walk, network or waiting on the MCP handshake.
- Never open the panel on activate, update or per window; only from the command or MCP `set_artboard`.
- `deactivate` returns a `Promise` only when cleanup is async.

## Disposables

Push every command, watcher, `OutputChannel`, status item and MCP registration to `context.subscriptions`. Panel-local timers and listeners die in `onDidDispose`; no leaked `setInterval`. One panel: a second open reveals it, never creates another.

## Commands

- Every command: `contributes.commands` **and** `registerCommand`. IDs `cursor-design.*`, `category: "Cursor Design"`.
- Hide with `when` / `enablement`; still guard the handler (the palette can invoke it anyway).
- Prefer Command Palette / QuickPick over custom wizard UI.

## Webview host

- `webview.html` is a **complete** HTML document, not a fragment.
- `enableScripts: true` for chrome. `localResourceRoots` = extension resources only (`dist/webview`), never the workspace (artboards are nested iframes).
- Prefer `getState` / `setState` over `retainContextWhenHidden` (high memory); retain only if iframe state cannot be restored from disk SoT.

## URIs, FS, processes

- `vscode.Uri.joinPath` + `webview.asWebviewUri`. Never string-concat paths or put `file://` in webview HTML.
- Host: `vscode.workspace.fs` for workspace files (remote / WSL / Codespaces). The MCP disk lib uses `node:fs` (separate process); the workspace-kind host calls the same disk helpers for `.cursor-design/` so MCP and host cannot drift.
- `import * as vscode` only in the extension host, never in webview or MCP process code (lint).

## Trust, remote, bundle

Artboard HTML is executable workspace code. `capabilities.untrustedWorkspaces` is `false` or `limited` + description, never `true`. Do not write `.cursor-design/` or load artboard scripts until `vscode.workspace.isTrusted`.

- `extensionKind: ["workspace"]`: needs the folder, not the local UI host.
- `vp pack` `deps.neverBundle: ['vscode']`. Never depend on the `vscode` npm package.
- No proposed APIs unless `enabledApiProposals` + matching `engines`.
- Watch with `createFileSystemWatcher` + debounce (~200 ms). Do not poll. No sync fs / CPU on the extension host thread.
