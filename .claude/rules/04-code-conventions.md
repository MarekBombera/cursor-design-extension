---
description: Names, single source of truth, wire values, TypeScript, object args. Lint enforces the mechanical parts.
globs: src/**,scripts/**,tests/browser/**,vite.config.ts
paths:
  - src/**
  - scripts/**
  - tests/browser/**
  - vite.config.ts
alwaysApply: false
---

# Code conventions

Lint (`vite.config.ts`) fails the mechanical parts (arrow functions, `catch (error)`, short or denylisted names, export return types, `any`, `@ts-*`, `console`); fix the code, never the rule.

## Names

Full words, strings too (`artboard = readArtboard(artboardId)`, `{ type: 'artboardUpdated' }`, not `ab` / `t: 'u'`); `raw` only for unvalidated input; wire names (tool args, disk keys, message `type`) stay as the contract defines them; a rename updates every call site in the same change.

## Single source of truth

Import, never re-type:

- `.cursor-design/` path segments, file names, schema versions, defaults: `src/disk/layout.ts`
- MCP tool names: `src/mcp/toolNames.ts`. MCP server name and env names: `src/mcp/mcpIdentity.ts`
- Command ids: `src/commands/commandIds.ts`
- Webview message types: `src/webview/hostMessages.ts` (host ↔ chrome, `import type`d by the host) and `src/webview/frame/frameMessages.ts` (frame ↔ chrome)

## Wire values are `unknown` until a guard checks them

Disk JSON, MCP tool args, and webview messages go through a parser (`src/disk/parse.ts`, `src/disk/canvasLayout.ts`, zod/mini) before use: `parseManifest(JSON.parse(text) as unknown)`, never `as ArtboardManifest` or `as SomeUnion`. Reject an unknown or malformed value with an authored error; never silently default it.

## Types

A named type only when used in 2+ places or a real domain type; it lives next to its owner, no `types.ts` dump.

## Object arguments (3+)

Helpers with 3+ parameters take one object, so named keys catch omitted flags and swapped ids: `writeArtboard({ artboardId, html, generation, workspaceRoot })`, not positional.

Exceptions: ordered coordinates, stdlib-shaped callbacks `(value, index)`, platform APIs (`fs.readFile(path, encoding)`, `webview.postMessage(message)`, command handlers), local test factories.

## Comments

Comment the why (non-obvious decision, gotcha, why a value is what it is, spec link), never the what. No banners or step narration; exported helpers get at most a one-line purpose doc. `ponytail:` marks a deliberate ceiling.
