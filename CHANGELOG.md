# Change Log

All notable changes to the "cursor-design" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.0] - 2026-09-13

- Artboard panel (host chrome + sandboxed HTML iframe)
- Seven MCP tools against disk SoT (`set_artboard`, `update_artboard`, `read_artboard`, `list_artboards`, `set_active_artboard`, `export_artboard`, `handoff_status`)
- Generation/hash conflict on `update_artboard`
- MCP-unavailable banner
- Export handoff + stale badge
- `.vsix` build (`pnpm vsix`)
