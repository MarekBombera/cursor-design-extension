---
description: Typed errors, edge cases, safe messages. Never leak stacks or paths; MCP failures are isError tool results.
globs: src/**
paths:
  - src/**
alwaysApply: false
---

# Error handling

Every public surface (command, MCP tool, disk read/write, webview message) names what can go wrong and how the caller learns it; a flow is done when at least one failure path is exercised or reasoned. Lint fails thrown literals, empty `catch`, `neverthrow` / Effect / fp-ts and `@sentry/*` (no crash reporter).

## Principles

1. **Expected vs unexpected.** Recoverable conditions (no or ambiguous folder, missing / half-written / corrupt / wrong-version `.vibeboard/` data, missing artboard, stale `baseGeneration`, malformed or unknown messages, export with nothing to export) return a typed, actionable error; programmer bugs and broken invariants throw.
2. **Preserve `cause`.** `new ArtboardNotFoundError(artboardId, { cause: error })`, never `new XError(error.message)`: foreign text goes on `cause`.
3. **A deliberate silent path logs first** and carries a `// ponytail:` comment naming the ceiling.
4. **Log once, at the boundary.** Logging helpers never throw (a crashing logger hides the original failure).
5. **Catch new async work.** Watchers, timers, fire-and-forget promises: `.catch` and log; child processes and streams get an `'error'` listener.
6. **Artboard iframe or CSP failure** renders an error state; never run artboard code as extension code.

## Channels

| Audience | Channel | Content |
|----------|---------|---------|
| Bombic (UI) | `showErrorMessage` / panel banner | short, human, next step, no stack |
| Cursor Agent (MCP) | tool result `isError: true` | actionable fix hint |
| Developer | `OutputChannel` via `logDiskError` / MCP stderr | full detail: stack, paths, codes |

Tool execution failures (validation, disk, stale generation) return a tool result with `isError: true` (`toMcpToolError`) so the agent can self-correct; only protocol errors (unknown tool, bad JSON-RPC) stay protocol-layer. MCP stdout is the protocol: never log there.

## Safe messages

Never in UI strings, MCP `content`, or webview posts: `error.stack`, absolute paths outside the workspace (home, extension dir, temp), secrets / tokens / env values, full artboard HTML or handoff bodies, raw `ENOENT` / `EACCES` text as the only message, dependency versions or hostnames. Never pipe `error.message` to the user or agent unless we authored it.

Do include: a stable `code` (`ARTBOARD_NOT_FOUND`, `conflict`, `NO_WORKSPACE`), the artboard id, the path relative to `.vibeboard/`, expected vs actual generation, and the next step (always for MCP): `Artboard "hero" not found. Call list_artboards, then set_artboard.`
