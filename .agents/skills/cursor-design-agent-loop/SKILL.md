---
name: cursor-design-agent-loop
description: Use when designing UI with Cursor Design MCP tools or implementing from a handoff.
---

# Cursor Design agent loop

## Design

1. Prefer MCP tools: set_artboard, update_artboard (always pass baseGeneration from last read), read_artboard, list_artboards, set_active_artboard.
2. On conflict, re-read then retry. Never force overwrite blindly.
3. Talk in Cursor Agent chat, not the panel.
4. If MCP denied: edit .cursor-design/** files directly and tell the user to allowlist tools.
5. Artboards are real HTML+CSS+JS prototypes in a sandboxed iframe.

## Export to implement

1. Call export_artboard; check handoff_status. If stale, re-export before implementing.
2. Handoff includes HTML+CSS+JS + IMPLEMENT.md — implement from that, not screenshots.
3. MVP sample target: tiny Vite + plain HTML app.
4. MCP never auto-writes production app source.
