---
description: Names, single source of truth, wire values, TypeScript, object args. Lint enforces the mechanical parts.
globs: src/**,scripts/**,vite.config.ts
paths:
  - src/**
  - scripts/**
  - vite.config.ts
alwaysApply: false
---

# Code conventions

Lint (`pnpm run check`, config in `vite.config.ts`) already fails: `function` declarations (class methods excepted), `catch` bindings other than `error`, one-letter names and `err` / `res` / `req` / `opts` / `ctx` / `cb` / `val`, missing return types on exports in `src/**/*.ts`, `any`, `@ts-*` comments, `console`, string concatenation over templates. Fix the code, never the rule. This file covers what lint cannot judge.

## Names: one look must tell you what it is

- Full words that name the thing: `artboard = readArtboard(artboardId)`, not `ab = read(id)`.
- I/O: `response` / `payload` / `requestText`. `raw` only for unvalidated input before a parser checks it.
- Strings name the thing too: `{ type: 'artboardUpdated', payload }`, not `{ t: 'u', d }`.
- Domain abbreviations only when the full name is already in the identifier (`artboardId`, not `abId`).
- Wire/protocol names stay as the contract defines them (MCP tool args, disk JSON keys, webview message `type`).
- When renaming, update all call sites in the same change.

## Single source of truth

Import, never re-type:

- `.cursor-design/` path segments, file names, schema versions, defaults: `src/disk/layout.ts`
- MCP tool names: `src/mcp/toolNames.ts`. MCP server name and env names: `src/mcp/mcpIdentity.ts`
- Command ids: `src/commands/commandIds.ts`
- Webview message types: `src/panel/openArtboardPanel.ts` (host) and `src/panel/artboardCanvasRuntime.ts` (iframe)

## Wire values are `unknown` until a guard checks them

Disk JSON, MCP tool args, and webview messages go through a parser (`src/disk/parse.ts`, `src/disk/canvasLayout.ts`, zod/mini) before use: `parseManifest(JSON.parse(text) as unknown)`, never `JSON.parse(text) as ArtboardManifest` or `value as SomeUnion`. An unknown or malformed wire value is rejected with an authored error, never silently defaulted.

## TypeScript

- Do **not** add `: JSX.Element` on Svelte wrappers.
- Reusable types only if used in 2+ places or a real domain type. Put the type next to its owner; no `types.ts` dump.

## Object arguments (3+)

Helpers with **3 or more** parameters take one object. Named keys catch omitted flags and swapped ids.

```ts
// ❌ BAD: writeArtboard(id, html, generation) silently drops workspaceRoot
export const writeArtboard = (artboardId: string, html: string, generation: number, workspaceRoot: string) => {}

// ✅ GOOD
type WriteArtboardArgs = { artboardId: string; html: string; generation: number; workspaceRoot: string };
export const writeArtboard = ({ artboardId, html, generation, workspaceRoot }: WriteArtboardArgs): void => {};
```

Exceptions: ordered coordinates, stdlib-shaped callbacks `(value, index)`, platform APIs (`fs.readFile(path, encoding)`, `webview.postMessage(message)`, command handlers), local test factories.

## Comments

Comment the why, not the what. `ponytail:` marks a deliberate ceiling.
