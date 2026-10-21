---
description: Typed errors, edge cases, safe messages. Never leak stacks or paths; MCP failures are isError tool results.
globs: src/**
paths:
  - src/**
alwaysApply: false
---

# Error handling

Design for failure paths, not only the happy path. Every public surface (command, MCP tool, disk read/write, webview message) names what can go wrong and how the caller learns it. No Sentry or crash reporter in v1 (lint bans `@sentry/*`).

## Principles

1. **Expected vs unexpected.** Missing artboard, stale `baseGeneration`, invalid tool args, no workspace: recoverable, typed, actionable. Programmer bugs / violated invariants: throw.
2. **Throw only `Error` subclasses** (lint: `no-throw-literal`). Domain failures live in `src/disk/errors.ts` with a `readonly code`.
3. **`catch (error)` then narrow** (`error instanceof Error`). Never type the binding.
4. **Preserve `cause`.** `new ArtboardNotFoundError(artboardId, { cause: error })`. Never `new XError(error.message)`: our message is authored; foreign text goes on `cause`.
5. **No empty `catch`** (lint). A deliberate silent path logs first and carries a `// ponytail:` comment naming the ceiling.
6. **No `neverthrow` / Effect / fp-ts** (lint). Typed throws or a small discriminated return; pick one style per module.
7. **Logging helpers never throw.** A crashing logger hides the original failure.
8. **New async work is caught.** Watchers, timers, fire-and-forget promises: `.catch` and log. Child processes and streams get an `'error'` listener.

## Channels

| Audience | Channel | Content |
|----------|---------|---------|
| Bombic (UI) | `showErrorMessage` / panel banner | short, human, next step, no stack |
| Cursor Agent (MCP) | tool result `isError: true` | actionable fix hint (read then retry, call `list_artboards`) |
| Developer | `OutputChannel` via `logDiskError` / MCP stderr | full detail: stack, paths, codes |

Tool execution failures (validation, disk, stale generation) return a normal tool result with `isError: true` (`toMcpToolError`) so the agent can self-correct. Only protocol errors (unknown tool, bad JSON-RPC) stay protocol-layer. MCP stdout is the protocol: never write logs there.

```ts
// ❌ BAD
throw new Error(fsError.stack);
vscode.window.showErrorMessage(error.message); // may be an absolute path or errno soup

// ✅ GOOD
logDiskError({ scope: 'readArtboard', error, outputChannel });
vscode.window.showErrorMessage('Could not read artboard "hero". Check the Output panel: Cursor Design.');
return { content: [{ type: 'text', text: 'Artboard "hero" not found. Call list_artboards, then set_artboard.' }], isError: true };
```

## Safe messages

Never put these in UI strings, MCP `content`, or webview posts: `error.stack`, absolute paths outside the workspace (home, extension dir, temp), secrets / tokens / env values, full artboard HTML or handoff bodies, raw `ENOENT` / `EACCES` text as the only message, dependency versions or hostnames.

Do include: a stable `code` (`ARTBOARD_NOT_FOUND`, `STALE_GENERATION`, `NO_WORKSPACE`), the artboard id, the path relative to `.cursor-design/`, expected vs actual generation, and the next step. Never pipe `error.message` to the user or agent unless we authored it.

## Edge cases to consider before calling a flow done

- No folder open, multi-root without a clear root, untrusted workspace
- `.cursor-design/` missing, unreadable, or partially written; corrupt or wrong-version JSON
- `update_artboard` with wrong or missing `baseGeneration`
- Races: disk change while the panel is open; MCP write while the UI is stale
- Webview message with unknown `type`, oversized payload, or non-object
- Artboard iframe / CSP failure: render an error state, never run untrusted code as extension code
- Export / handoff with no artboards
- Activate / deactivate / dispose: no dangling watchers, no double `registerServer`

## Checklist

- [ ] Happy path **and** at least one failure path exercised or reasoned
- [ ] Message names the next step (especially MCP)
- [ ] No stack, secret, or sensitive absolute path in user- or agent-facing text
- [ ] Logged once at the boundary
- [ ] Smallest correct handling, not a new error framework
