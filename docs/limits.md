# Known limits (v1)

Facts, not a roadmap. The ones most people meet are in the [README](../README.md#limits); this is the full list.

## Setup

- **MCP registration:** `vscode.cursor.mcp.registerServer` in Cursor, else `vscode.lm.registerMcpServerDefinitionProvider` in VS Code, never both. An editor with neither registers nothing (a line in Output → Vibeboard, and the panel shows MCP unavailable) and still renders `.vibeboard/` from disk; add the server to your agent by hand (see [Use with any agent](../README.md#use-with-any-agent)). The Agent skill is copied to `~/.cursor/skills/` only in Cursor; every agent gets it as MCP instructions.
- **Distribution:** not on the Marketplace yet; install from `.vsix` (**Extensions: Install from VSIX…**).
- **Updating in Cursor:** MCP settings may show **0 tools** until the server is toggled off/on. That fixes the tool count, not the version: after updating the extension, quit and reopen Cursor. Toggling the server or reloading the window keeps the old MCP server process running, so the Agent's tools run the old code, with the old descriptions, until Cursor quits.
- **Coming from cursor-design 0.4:** on activate, on a trust grant and on every workspace-folder change, in a trusted workspace, Vibeboard renames `.cursor-design/` to `.vibeboard/` in each workspace folder that has only the old one; the first tool call or panel open then moves it into pages (see **Pages** below). When both folders exist, it uses `.vibeboard/` and warns once per session. cursor-design is a separate extension: uninstall it, then quit and reopen Cursor. Until then its MCP server keeps running and can write a new `.cursor-design/`, which Vibeboard ignores.
- **Agent skill file:** on start in Cursor the extension copies `skills/vibeboard/SKILL.md` to `~/.cursor/skills/vibeboard/` when it differs. In a remote window that is the remote home, which Cursor may not read. Two extension versions running at once (F5 host plus an installed `.vsix`) overwrite each other's copy; the last window started wins. Uninstalling leaves the file; it tells Agents to ignore it when the tools are missing.
- **Brain:** your agent over MCP: no in-panel chat, no model API keys, no `vscode.lm` model, chat or tool APIs (only its MCP server registration).

## Workspace

- **Workspace folders:** the panel uses the first workspace folder only (`hostFs.ts`). MCP tools see every open folder and take an optional `rootPath` when more than one is open.
- **Trust:** untrusted workspaces are unsupported (`capabilities.untrustedWorkspaces.supported: false`); artboard HTML is executable workspace content.
- **Shared server in Cursor:** because Cursor shares one server across windows, a window's agent can write `.vibeboard/` into its own folder even when that window's workspace is untrusted; the writes stay inside `.vibeboard/` and symlinks there are rejected.
- **Server runtime:** Cursor and VS Code spawn `dist/mcp.js` with their own Electron binary (`ELECTRON_RUN_AS_NODE=1`); with a plain `node` command that variable is not needed.
- **Pages:** one open page per workspace folder: `.vibeboard/project.json` names it, and its files (`manifest.json`, `canvas.json`, `comments.json`, `artboards/`) live in `.vibeboard/pages/<pageId>/`. Handoffs, `tokens.json`, `assets/` and the lock stay at the `.vibeboard/` root. The first call or panel open moves a 0.4 folder into `pages/page-1/` once, and leaves a file named `artboards` at the root so a stale server that still expects a root `artboards/` folder fails instead of writing there (see **Older server** below). There is no way back: cursor-design 0.4 reads neither `.vibeboard/` nor `pages/`. Every artboard file on the open page is a frame on its canvas. `set_active_artboard` still picks the frame that `read_artboard` and `handoff_status` default to.

## Writes and locking

- **Queue:** one process-wide MCP queue for every tool, reads included (`mcpQueue.ts`; recorded drift vs the overview's "MCP serializes writes per artboard id").
- **Lock:** `update_artboard`, panel edits and Undo / Redo (HTML + meta), and every `canvas.json` and `comments.json` read-modify-write run under a cross-process lock (`.vibeboard/.lock`, `workspaceLock.ts`) shared by every MCP process and the panel.
- **Older server:** after an update, until Cursor is quit, the older MCP server keeps running (see **Updating in Cursor** above). A cursor-design server writes only to `.cursor-design/`. A stale server that still expects a root `artboards/` folder in `.vibeboard/` (a development build) fails on the `artboards` file there (`DISK_ERROR`) instead of writing artboards.
- **Unlocked writes:** a write that skips the lock (an editor save, the Agent's direct file edit) can still land between `update_artboard`'s compare and its write and be overwritten (`artboardFs.ts` ponytail). `manifest.json` writes from `set_artboard` and `set_active_artboard` take no lock: across windows the last writer wins (`artboardFs.ts`).
- **Export:** export's meta refresh and manifest write run under the lock and re-read first, so the meta refresh no longer overwrites a newer locked meta write, and an unlocked `set_active_artboard` change is reverted only if it lands during the locked tail (`exportFs.ts`).
- **Failures:** failed multi-file writes leave partial files (no journal/rollback); orphan handoff dirs are never deleted.

## Artboards, handoff and comments

- **Artboard sandbox:** `sandbox="allow-scripts"`. CSP blocks inline event handlers and external subresources in the artboard (`artboardChromeHtml.ts`); `style=""` attributes render (`style-src-attr 'unsafe-inline'`, 0.4). Each frame also gets a second, inline-only policy (`FRAME_CSP` in `stampArtboardHtml.ts`), so even a `<script src>` that carries the stamped nonce, or one artboard JS adds at runtime, never loads. Chromium's CSP does not govern WebRTC or DNS prefetch hints. The exported `canvas.html` preview is opened in your own browser and is not restricted.
- **Handoff:** each frame's `index.html` carries its whole document (no CSS/JS split; recorded Phase 3 lock vs overview "HTML+CSS+JS"); `.vibeboard/assets/` is copied manually; `tokens.json` is passed through without validation.
- **Comment flags** are checked against the static artboard HTML on disk. A target that the artboard's own script creates at runtime reads as unchecked (`null`), never guessed (`commentTarget.ts`).
