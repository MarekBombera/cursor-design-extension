# 11g Zod at every boundary: research and decisions

Research 2026-11-28: two read-only Opus 5.5 agents (host / disk / MCP; webview) grounded in the zod 4
docs MCP, with prototypes and bundle builds in scratch copies. Decisions: Bombic 2026-11-28. Read
before `/feature 11g`. Code wins over this note once shipped (rule 00).

## Goal

Every trust boundary is parsed once by a schema; the type is inferred from that schema (no hand
type beside a hand guard); malformed input is rejected with an authored, actionable error, never
silently defaulted (rule 04). No new dependency: zod ^4.6.7 is installed.

## Decisions (Bombic 2026-11-28)

- **D1 Unknown keys are rejected** (`z.strictObject`) on wire messages and MCP tool args, with an
  authored error naming the key (`place_frame does not take artboardId. Fix args and retry.`).
  Agents that send extra keys today start getting `INVALID_ARGS`; the Agent skill says so.
- **D2 One bad entry rejects the whole message**, logged with the zod issue. Host, chrome and
  runtime ship in one `.vsix`, so a bad entry is a bug, not user data.
- **D3 `comments.json` on disk stays lenient** for a style key or pin we no longer allow (drop /
  clamp on read, so a user's file never turns `CORRUPT_COMMENTS`); fresh panel input is strict.
- This reverses 11d's "no zod in the chrome bundle" for the host→chrome guard only (measured cost
  below); the frame runtime stays zod-free.

## Measured facts

- `zod/mini` never uses `new Function` (no CSP `unsafe-eval`). Classic `zod` runs a `new F("")`
  probe when an object schema is built and would trip the chrome CSP: only `zod/mini` in webview.
- chrome.js baseline 227,252 B (73.0 kB gzip). zod/mini floor +3.8 kB gzip; host→chrome guard in
  zod +23.9 kB raw / +7.9 kB gzip; plus frame→chrome parse +2.7 kB raw more.
- Frame runtime IIFE 35,878 B → 83,816 B with zod (+134%); it is inlined into every artboard blob
  and every exported `canvas.html`, and zod's writable `globalThis.__zod_globalConfig` would sit in
  a page the design's script controls. Top-level schemas with `.check()` are not tree-shaken: zod
  must live only in modules the runtime never value-imports.
- MCP SDK 2.4: `inputSchema` validation failure returns `isError` with plain SDK text, losing our
  `{code:"INVALID_ARGS"}` (16 contract-test asserts). zod/mini lacks `~standard.jsonSchema`
  (SDK warns on stderr). zod/mini default message is "Invalid input": every field needs `{ error }`.
- `dist/mcp.js` already bundles zod classic + mini + `toJSONSchema`: MCP change ≈ +2.3 KB.
- `import type` of zod-inferred types into the webview adds 0 zod bytes to chrome.js (verified).
  The webview tsconfig (`types: []`) fails on any value import chain reaching node (e.g.
  `hash.ts` → `node:crypto`).

## Changes (ranked)

1. **MCP tool args.** `zodToolInput(schema)` in `mcpToolResult.ts` returns a `StandardSchemaWithJSON`
   whose `jsonSchema.input` is `z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' })`
   and whose `validate` passes through; `parseToolArgs` `safeParse`s inside `runQueued` /
   `runOnOpenPage` and throws `InvalidArgsError` (cause kept), so errors keep our code and wording.
   `z.strictObject` + `z.describe`. Deletes the disk lib's typeof arg checks (`requireHtmlString`,
   `requireOptionalString`, `requireOptionalFiniteNumber`, typeof part of `requireArtboardIdString`,
   `updateArtboard` base checks, comment status literals → `z.enum(COMMENT_STATUSES)`, the
   `beforeResolve` hook, export's stray-`artboardId` special case). Keep `parseArtboardId`,
   `requirePageId`, body / note trim rules (shared with the panel). Advertised schemas gain `type`,
   `required`, `additionalProperties: false`: Agent skill + `agentSkill.test.ts` + contract tests.
2. **Chrome→host types inferred.** Schemas move to a node-free `src/host/chromeMessageSchema.ts`
   (imports only zod/mini, `disk/layout`, `frame/frameMessages`); `hostMessages.ts` derives the
   request types with `Extract<z.output<…>, { type }>` via `import type`. Move `isArtboardHash`'s
   pattern from `hash.ts` to `layout.ts`; `z.readonly` the edit `styles`; comment `styles` as
   `z.partialRecord(z.enum(COMMENT_STYLE_KEYS), safeStyleValue)`. Deletes ~107 lines of hand types
   and the `Compared` / `Flat` drift test. Rules 04, 05, 08 catalogs.
3. **Host→chrome guard in zod/mini.** `hostMessageGuard.ts`: `z.discriminatedUnion('type', …)` over
   strict objects; `hostMessages.ts` host→chrome types become `z.infer`. Comment entries get a full
   schema, ending rule 04's `comments:updated` cast exception (share field schemas with
   `commentsFile.ts` only via a node-free module). Fixes: malformed `artboard:error` no longer
   falls back to fixed copy; bad frame / page entries no longer vanish silently; `comments:[null]`
   rejected. Bounds where the disk has caps (x, y, width, generation).
4. **Frame→chrome parse in zod/mini, chrome-only.** New `frame/frameMessageSchema.ts`; the runtime
   keeps `import type` only. Cross-field rules via `.check(z.refine(...))`; `savedState` reuses the
   pick schema. Chrome→frame (`parseChromeFrameMessage`) stays a hand guard (runtime-side).
5. **Guards against regression.** Lint `no-restricted-imports` for `'zod'` in `src/webview/**`
   (zod/mini only); a test that the runtime `?iife` string has no `__zod_globalConfig`.
6. **Disk.** `canvasLayout.ts` to zod with `CanvasFrame` / `CanvasLayout` inferred (version
   dispatch first, width clamp via transform, `''` group → undefined, unique-id refine).
   `commentsFile.ts` `Comment` / `CommentReply` inferred (drop the redundant `finiteNumber` refine;
   D3 keeps read leniency). `createArtboard` overwriting a corrupt manifest (drops `lastExport`)
   logs and gets a `ponytail:`; a corrupt meta read as missing logs.
7. **Small, no zod.** `checkedPanelMessage` logs the zod issue (`{ cause }`). `savedState.ts` zoom
   range-checked like the stage clamp (0.05–10). `inspectorFocus` `dataset.cdSection` checked with
   `includes`, not cast. `VIBEBOARD_WORKSPACE_ROOTS` malformed → authored `NO_WORKSPACE` instead of
   a silent fallback.

## Skipped (with reason)

- zod for chrome→frame or anything the runtime imports: +48 kB per frame copy, writable global.
- zod for `savedState` as a whole: own storage, per-key recovery is right; `z.record` drops a
  `__proto__` key.
- metaSchema `z.catch(viewport, DEFAULT_VIEWPORT)`: deliberate for old metas; strict would reset
  generation to 1.
- A JSON-parse codec helper for the 5 `JSON.parse` sites: doesn't pay.

Prototypes (scratch, may be cleaned): `…/scratchpad/zod-a/repo` (MCP + chrome→host), `zod-b/repo`
(webview bundle builds).
