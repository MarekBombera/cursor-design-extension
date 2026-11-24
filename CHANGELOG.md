# Change Log

All notable changes to the "vibeboard" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Renamed from cursor-design to Vibeboard Design (extension id `bombic.vibeboard`): commands `vibeboard.*`, MCP server `vibeboard`, env `VIBEBOARD_WORKSPACE_ROOT(S)`, Agent skill `skills/vibeboard/`, workspace folder `.vibeboard/`. On activation a trusted workspace's `.cursor-design/` is moved to `.vibeboard/` once; when both exist, `.vibeboard/` is used and a warning says the old folder was ignored.
- README: VS Code setup (add the bundled MCP server to your agent by hand).
- Agent-agnostic: any MCP-capable agent drives the artboard. VS Code now registers the MCP server itself (`mcpServerDefinitionProviders`, Cursor keeps its own API, never both); the server sends the Agent skill as MCP instructions to every agent; panel copy says "your agent" instead of Cursor Agent.
- MCP server takes the workspace folder from the client (MCP roots), so with several Cursor windows open the agent writes into its own window's folder; `VIBEBOARD_WORKSPACE_ROOT(S)` is now the fallback for clients without roots support. A window with no folder open no longer replaces the server registration, and closing a Cursor window no longer unregisters the server the other windows use.
- Upgrading from cursor-design: uninstall the old `cursor-design.cursor-design` extension and quit Cursor first (an old extension or MCP process recreates `.cursor-design/`), delete `~/.cursor/skills/cursor-design/`, and allowlist the `vibeboard` MCP server. If you committed `.cursor-design/`, commit the move to `.vibeboard/`.

## [0.1.0] - 2026-09-13

- Artboard panel (host chrome + sandboxed HTML iframe)
- Seven MCP tools against disk SoT (`set_artboard`, `update_artboard`, `read_artboard`, `list_artboards`, `set_active_artboard`, `export_artboard`, `handoff_status`)
- Generation/hash conflict on `update_artboard`
- MCP-unavailable banner
- Export handoff + stale badge
- `.vsix` build (`pnpm vsix`)
