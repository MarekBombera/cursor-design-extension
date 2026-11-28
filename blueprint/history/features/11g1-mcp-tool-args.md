# Feature: MCP tool args

**From build-plan:** feature 11g1
**Build attempt:** 1
**Branch:** feature/mcp-tool-args
**Status:** verified

## Goal

Every MCP tool's arguments are parsed once, in the handler, by a strict `zod/mini` schema whose
output type the handler uses. The advertised `inputSchema` gains real types, `required` and
`additionalProperties: false`, so clients can see the contract. Unknown keys and wrong types
return `INVALID_ARGS` with an authored message that names the field and the fix; the SDK's own
validation never answers (it would drop our `{ code }` body). The disk lib's `typeof` arg checks,
which only exist because MCP args arrived as `unknown`, go. A malformed
`VIBEBOARD_WORKSPACE_ROOTS` stops falling back silently and returns an authored `NO_WORKSPACE`.

Source: `blueprint/reference/11g-zod-boundaries.md` change 1, decision D1, and the
`VIBEBOARD_WORKSPACE_ROOTS` item of change 7. Build plan item 11g1.

## In scope

- `zodToolInput(schema)` and `parseToolArgs({ tool, schema, args })` in `src/mcp/mcpToolResult.ts`.
- `runQueued` / `runOnOpenPage` take `{ tool, schema, args }`, parse first, and hand typed args to
  the operation. `toolInputSchema` and `optionalRootPath` go. `runOnOpenPage`'s `beforeResolve`
  hook stays, now receiving the parsed args (set_artboard's pre-resolve id check).
- All 14 tools (`artboardTools.ts`, `commentTools.ts`, `pageTools.ts`) declare `z.strictObject`
  schemas; descriptions unchanged, attached with `z.describe`.
- Disk functions reached by MCP or the panel take typed args; their dead arg checks go:
  `requireHtmlString`, `requireOptionalString`, `requireOptionalFiniteNumber`, the `typeof` part of
  `requireArtboardIdString` (the helper itself goes; callers call `parseArtboardId`),
  `updateArtboard`'s `baseGeneration` integer / ≥ 1 and `baseHash` format checks (the schema owns
  them; panel hashes are host-computed), `validateNewArtboardArgs`, `requireCommentId`,
  `SET_STATUS_MESSAGE` and `setCommentStatus`'s status check, the `typeof` branches of
  `requireCommentBody` / `requireNote`, `listComments`'s status check, `namingCommentPage`'s
  `typeof id` check, export's stray-`artboardId` special case.
- `parseWorkspaceRootsEnv`: malformed `VIBEBOARD_WORKSPACE_ROOTS` throws `NoWorkspaceError` with an
  authored message instead of falling back to `VIBEBOARD_WORKSPACE_ROOT`.
- Agent skill (`skills/vibeboard/SKILL.md`), `README.md` roots line, contract tests, rules 02 / 04
  / 05, `system-map.md`.

## Out of scope

- Chrome ↔ host messages, the host→chrome guard, `checkedPanelMessage` (11g2).
- Frame → chrome parse, webview lint and runtime guards, `savedState`, `inspectorFocus` (11g3).
- `canvasLayout.ts`, `commentsFile.ts` types, corrupt manifest / meta logging (11g4).
- `place_frame` `x` / `y` bounds: MCP stays unbounded as today (the panel caps at
  `MAX_FRAME_COORDINATE`); not part of 11g1.
- The `baseHash` pattern moving to `layout.ts` (11g2); here the schema refines with `isArtboardHash`.
- Kept as they are: `parseArtboardId` (`INVALID_ARTBOARD_ID` for a string with bad characters),
  `requirePageId`, `parsePageTitle`, the body / note trim and length rules (shared with the panel),
  `updateArtboard`'s "needs `baseGeneration` and/or `baseHash`" rule.
- No new dependency (`zod` ^4.6.7 is installed and already bundled in `dist/mcp.js`).

## Build loop

`workflow.stepReview: feature`: build all steps, then present the whole feature for review.
`checkpointCommits: disabled`: no commits per step; `/complete` makes the one feature commit.
After each step run `pnpm test` (or the narrowed Vitest file) and `pnpm run check`; run
`pnpm verify` (adds knip in both modes) at the end of steps 2, 4 and 6. No browser tests: nothing in
the chrome or frame changes.

## Build steps

1. [x] **Arg helpers.** In `src/mcp/mcpToolResult.ts` add `zodToolInput(schema)` and
   `parseToolArgs({ tool, schema, args })` per Data / contracts. `parseToolArgs` is
   `/** @internal */` permanently (its only production caller is `runQueued` in the same file);
   `zodToolInput` is `@internal` only until step 2 uses it. Unit tests in
   `src/mcp/mcpToolResult.test.ts`: `{ artboardId: 'hero' }` against a strict schema whose required
   `id` is missing → "`<tool>` does not take artboardId." (the unknown-key issue wins over the
   missing field); two unknown keys listed; five unknown keys → first 3 plus "and 2 more"; a 200-char
   key cut to 64 chars; a field whose schema carries `{ error }` → that message; `args` `undefined`
   parses as `{}`; `args` `'x'` → the root message; an object-level refine issue (path `[]`, code
   `custom`) → its own message, not the root message;
   `zodToolInput(...)['~standard'].jsonSchema.input({ target: 'draft-2020-12' })` returns
   `type: 'object'`, `additionalProperties: false`, `required` (absent when no key is required)
   and each description; its `validate` returns the input unchanged. Confirm `toJSONSchema` from
   `zod/mini` handles the `describe` check and `z.optional` as the research prototype did.
   **Done when:** the new unit tests pass and `pnpm run check` is clean.

2. [x] **Tools on schemas.** `runQueued` and `runOnOpenPage` take `{ server, tool, schema, args }`
   (generic signature in Data / contracts) and call `parseToolArgs` first inside the `try` (before
   `allowedWorkspaceRoots`), then pass the parsed args to `operation` and use `parsed.rootPath`.
   `runOnOpenPage`'s `beforeResolve(parsed)` runs after the parse and before `resolveOpenPage`;
   `set_artboard` passes `(parsed) => parseArtboardId(parsed.artboardId)`. Replace every
   `toolInputSchema(...)` with a `z.strictObject` schema per Data / contracts, registered through
   `zodToolInput`; handlers pass the raw `args` through. Export `NOTE_MESSAGE` (`comments.ts`),
   `PAGE_ID_MESSAGE` (`pageOps.ts`) and `PAGE_TITLE_MESSAGE` (`parse.ts`) for the schemas; the
   `COMMENT_ID_MESSAGE` and `LIST_STATUS_MESSAGE` strings move to `commentTools.ts` (sole owner;
   step 4 removes the disk uses). Delete `toolInputSchema`, `optionalRootPath`,
   `EXPORT_TAKES_NO_ARTBOARD_ID_MESSAGE` and the export handler's special case. Keep the exported
   `artboardToolInputSchemas` / `commentToolInputSchemas` / `pageToolInputSchemas` maps (now of zod
   schemas) for `agentSkill.test.ts`. Move `mcpToolResult.test.ts`'s `runOnOpenPage` calls to the
   new signature. Update the contract tests whose messages or codes change (Data / contracts,
   "Behavior changes").
   **Done when:** `pnpm verify` passes, including these contract asserts:
   - `place_frame({ artboardId: 'hero' })` (no `id`) → `INVALID_ARGS`
     `place_frame does not take artboardId. Fix args and retry.`
   - `set_artboard({ artboardId: 'hero', html: 42 })` on a fresh root → `INVALID_ARGS`
     `html must be a string. Fix args and retry.`, `readdir(root)` empty.
   - `set_artboard({ artboardId: 'has space!', html: '' })` on a fresh root →
     `INVALID_ARTBOARD_ID`, `readdir(root)` empty (existing test at
     `artboardTools.contract.test.ts:406` passes unchanged).
   - `export_artboard({ artboardId: 'hero' })` → `INVALID_ARGS`
     `export_artboard does not take artboardId. Fix args and retry.`
   - `list_artboards({ rootPath: {} })` → `INVALID_ARGS` `rootPath must be a string. Fix args and retry.`

3. [x] **Advertised schemas and no SDK rejection.** One contract test (new
   `src/mcp/toolSchemas.contract.test.ts`) calls `client.listTools()` and asserts: exactly the 14
   tools; for each, `inputSchema.type === 'object'`, `additionalProperties === false`,
   `inputSchema.required ?? []` equals the Data / contracts list (as a set), and every property has
   a `type` (or `enum`) and a `description`. Spot-check `update_artboard.baseGeneration` is
   `type: 'integer'` with `minimum: 1` and `list_comments.status` has `enum`
   `['open', 'sent', 'resolved']`. Then, for every listed tool, call it with only
   `{ notAnArg: 1 }` and assert the result is our JSON body with `code: 'INVALID_ARGS'` and message
   starting `<tool> does not take notAnArg` (proves the SDK's own validation never answered).
   **Done when:** the test passes, and fails when one schema is registered as a raw `z.object` (or
   as `zod/mini` without `zodToolInput`).

4. [x] **Disk args typed, dead checks gone.** Arg types per Data / contracts "Typed disk args" for
   `createArtboard`, `updateArtboard`, `readArtboard`, `placeFrame`, `setActiveArtboard`
   (`artboardFs.ts`) and `listComments`, `getComment`, `resolveComment`, `replyToComment`,
   `setCommentStatus` (`comments.ts`); `namingCommentPage`'s `id` (`commentTools.ts`) becomes
   `string`. Delete the checks listed in In scope. `createArtboard`, `updateArtboard`,
   `readArtboard` (when `artboardId` is given), `setActiveArtboard` and `placeFrame` call
   `parseArtboardId`. `requireCommentBody` / `requireNote` keep trim + length, take `string`.
   Fix every host caller the type change breaks (`artboardDisk.ts`, `panelEdit.ts`,
   `panelComments.ts`, `artboardEditFs.ts`, `pageOps.ts`) by passing values the chrome message
   schema (`chromeMessages.ts`) already typed, never with a cast. Disk unit tests that called these
   functions with wrong-typed args go when an MCP contract test already covers the case, else move
   to one.
   **Done when:** `pnpm verify` passes; `grep -nE "typeof [a-zA-Z]+ !== '(string|number)'" src/disk/artboardFs.ts src/disk/comments.ts src/mcp/commentTools.ts`
   finds no arg check; the host tests for panel place / edit / comment reply / set-status pass.

5. [x] **Malformed workspace roots env.** `parseWorkspaceRootsEnv`: `VIBEBOARD_WORKSPACE_ROOTS`
   unset or `''` → use `VIBEBOARD_WORKSPACE_ROOT` as today. Set, non-empty and not valid JSON, or
   not an array of non-empty strings → `logStderr` the cause once per throw, then throw
   `NoWorkspaceError` with the message in Data / contracts; `cause` is the `JSON.parse` error, or
   `new Error('expected a JSON array of non-empty strings')` for the wrong shape. Never fall back to
   ROOT then. `NoWorkspaceError` gains an optional `message` (default unchanged). Drop the
   log-once flag and its `ponytail:` comment. Rewrite `resolveWorkspaceRoot.test.ts` "invalid ROOTS
   falls back to ROOT": `not json` and `["", "x"]` → `NO_WORKSPACE` with the authored message and a
   stderr line; `''` with a valid ROOT → ROOT; `[]` keeps the default message.
   **Done when:** those tests pass and a valid ROOTS still wins over ROOT.

6. [x] **Skill, README, rules, map.** `skills/vibeboard/SKILL.md`: the Tools intro says unknown
   argument names and wrong types return `INVALID_ARGS` naming the field; the `INVALID_ARTBOARD_ID`
   line says it is a string id with bad characters (a missing or non-string id is `INVALID_ARGS`);
   the `NO_WORKSPACE` line adds "or fix the vibeboard server env the message names". Never put the
   env name in backticks in the skill (`agentSkill.test.ts` reads backticked `UPPER_SNAKE` as an
   error code). `README.md` roots bullet (about line 185): a malformed ROOTS value returns
   `NO_WORKSPACE`. Rule 02 MCP tools: args are `zod/mini` strict schemas parsed by `parseToolArgs`
   in `runQueued`; unknown keys are `INVALID_ARGS`. Rule 04 parser line: name `parseToolArgs` as
   the MCP args parser. Rule 05 owner catalog: `mcpToolResult.ts` → `zodToolInput` (advertised
   schema) and `parseToolArgs` (the one MCP arg parse) replace `toolInputSchema`; remove
   `validateNewArtboardArgs` from the `artboardFs.ts` line. `system-map.md`: the open-page
   flowchart's `MCPSet` node says `parseToolArgs, then parseArtboardId (beforeResolve)`, and a
   schema error from any tool reaches `ArgErr` before roots ("resolver not called, nothing written"
   stays true); the workspace-roots paragraph says a malformed `VIBEBOARD_WORKSPACE_ROOTS` is
   `NO_WORKSPACE`. Re-run the map's Chart checklist on both edits.
   **Done when:** `agentSkill.test.ts` passes, `pnpm verify` passes, and the edited mermaid parses.

## Files / areas

- `src/mcp/mcpToolResult.ts`, `mcpToolResult.test.ts`: helpers, `runQueued`, `runOnOpenPage`.
- `src/mcp/artboardTools.ts`, `commentTools.ts`, `pageTools.ts`: schemas, handlers.
- `src/mcp/*.contract.test.ts`: changed messages and codes; new `toolSchemas.contract.test.ts`.
- `src/mcp/resolveWorkspaceRoot.ts`, `resolveWorkspaceRoot.test.ts`; `src/disk/errors.ts`
  (`NoWorkspaceError` message option).
- `src/disk/artboardFs.ts`, `comments.ts`, `pageOps.ts`, `parse.ts` and their tests.
- Host callers if the types demand: `src/host/artboardDisk.ts`, `panelEdit.ts`,
  `panelComments.ts`; `src/disk/artboardEditFs.ts`.
- `skills/vibeboard/SKILL.md`, `README.md`, `.claude/rules/02-mcp-webview.md`,
  `04-code-conventions.md`, `05-single-job.md`, `blueprint/context/system-map.md`.

## Data / contracts

### Helpers (`src/mcp/mcpToolResult.ts`)

- `zodToolInput(schema)` returns the SDK's standard-schema-with-JSON object: `~standard.version 1`,
  `vendor 'vibeboard'`, `validate: (value) => ({ value })` (pass-through, so the SDK never rejects),
  `jsonSchema.input` and `jsonSchema.output` both
  `() => z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' })` (they accept and ignore
  the SDK's `{ target }` option). Its output type is `Record<string, unknown>`, so a handler cannot
  read a parsed field without `parseToolArgs`. Use the SDK's exported type name for the return if
  it has one (`StandardSchemaWithJSON` or what `fromJsonSchema` returns); confirm in step 1.
- `parseToolArgs({ tool, schema, args })`: `schema.safeParse(args ?? {})`. On success returns
  `data`. On failure throws `InvalidArgsError` with `cause` = the zod error. The message comes
  from one issue, chosen and mapped in this order (zod lists field issues before
  `unrecognized_keys`, and both that issue and a root type issue have `path: []`):
  1. If any issue has `code === 'unrecognized_keys'`, use it:
     `` `${tool} does not take ${listed}. Fix args and retry.` `` where `listed` is the first 3 keys,
     each cut to 64 characters, joined with `, `, plus ` and N more` when there are more.
  2. Else the first issue; if `code === 'invalid_type' && path.length === 0`:
     `` `${tool} args must be an object. Fix args and retry.` ``
  3. Else that issue's `message` (every field schema sets `{ error }`, so it is authored).
- Signatures (one generic shape for both):
  `runQueued<Schema extends z.ZodMiniType<{ rootPath?: string }>>({ server, tool, schema, args }, operation: (parsed: z.output<Schema>, workspaceRoot: string, isFirstRoot: boolean) => Promise<unknown>)`
  and
  `runOnOpenPage<Schema …>({ server, tool, schema, args, createIfFresh, beforeResolve?: (parsed: z.output<Schema>) => void, operation: (parsed, page, isFirstRoot) => Promise<object> })`.
  Adjust the constraint to whatever the installed zod/mini types accept; the shape stays.
- Order inside `runQueued`'s `try`: `parseToolArgs` → `allowedWorkspaceRoots` → queue →
  `resolveWorkspaceRoot(parsed.rootPath)` → (runOnOpenPage) `beforeResolve(parsed)` →
  `resolveOpenPage` → operation. A schema error therefore answers before `roots/list` and never
  creates a fresh project; `set_artboard`'s bad-character id answers before `resolveOpenPage`.
- Shared field: `rootPath: z.optional(z.string({ error: 'rootPath must be a string. Fix args and retry.' }))`
  with the existing `ROOT_PATH_DESCRIPTION`.

### Tool schemas (all `z.strictObject`, descriptions unchanged)

Message strings are the current ones unless marked **new**. `S(msg)` = `z.string({ error: msg })`.

| Tool | Required | Fields (type, error message) |
| --- | --- | --- |
| `set_artboard` | artboardId, html | artboardId S(`artboardId must be a string. Fix args and retry.`); html S(`html must be a string. Fix args and retry.`); title S(`title must be a string. Fix args and retry.`); viewport string min 1 (`viewport must be a non-empty string. Fix args and retry.` for both wrong type and empty, **new** for wrong type); rootPath |
| `update_artboard` | artboardId, html | artboardId, html, title, viewport as above; baseGeneration `z.int()` ≥ 1 (`baseGeneration must be an integer >= 1. Fix args and retry.`); baseHash string refined by `isArtboardHash` (`baseHash must be sha256: plus 64 hex characters. Fix args and retry.`); rootPath. Neither base sent stays the disk rule (`update_artboard requires baseGeneration and/or baseHash. Fix args and retry.`) |
| `read_artboard` | none | artboardId (optional), rootPath |
| `list_artboards` | none | rootPath |
| `set_active_artboard` | artboardId | artboardId, rootPath |
| `export_artboard` | none | rootPath |
| `handoff_status` | none | rootPath |
| `place_frame` | id | id S(`id must be a string. Fix args and retry.` **new**); x, y, width `z.number()` (`<field> must be a finite number. Fix args and retry.`); label, group S(`<field> must be a string. Fix args and retry.`); rootPath |
| `list_comments` | none | status `z.enum(COMMENT_STATUSES)` (`status must be open, sent, or resolved. Omit it for all unresolved comments.`); rootPath |
| `get_comment` | id | id S(`id must be a comment id string from list_comments.`); rootPath |
| `resolve_comment` | id, note | id as get_comment; note S(`NOTE_MESSAGE`); rootPath |
| `list_pages` | none | rootPath |
| `create_page` | title | title S(`PAGE_TITLE_MESSAGE`), then `parsePageTitle` (trim + rule) in the handler; rootPath |
| `open_page` | pageId | pageId S(`PAGE_ID_MESSAGE`), then `requirePageId` in the handler; rootPath |

"none" means `required` is absent from the advertised schema. `z.number()` in zod 4 rejects `NaN`
and `±Infinity`, matching today's finite check. The width clamp (120–3840) stays in
`placeCanvasFrame`. `z.int()` advertises `maximum: 9007199254740991`; that is expected.

### Typed disk args

- `artboardFs.ts`: `artboardId` / `id` / `html`: `string`; `title`, `viewport`, `label`, `group`:
  `string | undefined`; `x`, `y`, `width`, `baseGeneration`: `number | undefined`; `baseHash`:
  `string | undefined`. `readArtboard`'s `artboardId`: `string | undefined`.
- `comments.ts`: `id`, `body`, `note`: `string`; `listComments` `status`: `CommentStatus | undefined`;
  `setCommentStatus` `status`: `'open' | 'resolved'` (the type `chromeMessages.ts`'s
  `z.enum(['open', 'resolved'])` produces).
- Panel callers already hold these types from the zod-checked chrome message
  (`src/host/chromeMessages.ts`) or compute them (history / edit hashes).

### `VIBEBOARD_WORKSPACE_ROOTS`

- Unset or `''` → `VIBEBOARD_WORKSPACE_ROOT` as today.
- Set, non-empty and malformed (invalid JSON, not an array, or any item not a non-empty string) →
  `NoWorkspaceError` with message **new**, built from `VIBEBOARD_WORKSPACE_ROOTS_ENV`
  (`mcpIdentity.ts`), never retyped:
  `` `${VIBEBOARD_WORKSPACE_ROOTS_ENV} must be a JSON array of folder paths. Fix the vibeboard MCP server env.` ``
  The cause goes to `logStderr` (`toMcpToolError` does not log a non-disk error's cause).
- `[]` → default `NoWorkspaceError` message as today.
- Reached only by clients without the MCP `roots` capability.

### Behavior changes an Agent can see

- Unknown keys (any tool) → `INVALID_ARGS` "`<tool>` does not take `<keys>`." (was: ignored),
  even when a required field is missing too.
- `export_artboard` with `artboardId` → the generic unknown-key message (was its own wording).
- `place_frame` with a missing or non-string `id` → `INVALID_ARGS` (was `INVALID_ARTBOARD_ID`).
  A string with bad characters is still `INVALID_ARTBOARD_ID`, for every tool.
- Schema errors (type, unknown key, missing field) win over `NO_WORKSPACE` / `INVALID_ROOT`. The
  rules that run after roots keep their place: `parseArtboardId` (except set_artboard, which runs
  it before the resolver but after roots), `parsePageTitle`, `requirePageId`, the body / note trim
  rules and update_artboard's "needs a base" rule.
- Malformed `VIBEBOARD_WORKSPACE_ROOTS` → `NO_WORKSPACE` (was: silently used ROOT only).
- `tools/list` advertises types, `required` and `additionalProperties: false`.

## Testing

- Unit: `mcpToolResult.test.ts` (step 1), `resolveWorkspaceRoot.test.ts` (step 5).
- Contract (in-memory MCP client, real temp disk): updated message / code asserts (step 2), the
  listTools + unknown-key-per-tool test (step 3).
- Mutation probes: step 1, return the first issue's message without preferring
  `unrecognized_keys` → the `{ artboardId: 'hero' }` unit test fails; step 3, register one tool
  with a raw `z.object` → the contract test fails; step 2, drop set_artboard's `beforeResolve` →
  the fresh-root bad-id test fails.
- No browser tests, no gallery (no chrome change).
- **Real client (required, at `/check`):** the advertised schema changes what clients validate on
  their side, which the in-memory client cannot show. In Cursor (F5, `fixtures/dev-workspace`,
  `dist/mcp.js` rebuilt) confirm all 14 vibeboard tools list and a normal `set_artboard` then
  `place_frame` call succeeds, and `place_frame` with `artboardId` returns the authored
  `INVALID_ARGS`. An agent first runs the same three calls from Claude Code against the built
  `dist/mcp.js` (a scratch `.mcp.json` server entry); Bombic runs only the Cursor half.

## Notes for the AI

- `zod/mini` only (functional API: `z.optional(...)`, `.check(z.minLength(1))`, the `describe`
  check per the installed version). Classic `zod` is fine in the MCP bundle but keep one style:
  `src/disk/parse.ts` already uses `zod/mini`.
- The SDK must never see a failing `validate`: its rejection text replaces our `{ code, message }`
  body (16 contract asserts depend on the body).
- In `parseToolArgs`, the `unrecognized_keys` check must come before the root `invalid_type` check;
  reordering them gives unknown keys the "args must be an object" text.
- Export only `NOTE_MESSAGE`, `PAGE_ID_MESSAGE`, `PAGE_TITLE_MESSAGE` beyond today's exports;
  knip `--production` fails test-only exports. `parseToolArgs` and the `*ToolInputSchemas` maps
  are `/** @internal */` test seams.
- Research prototype (may be cleaned): scratchpad `zod-a/repo`. Do not copy it blindly; the code
  here wins.
- Skill and contract tests change in the same diff as the tools (AGENTS.md Agent skill rule).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":22257,"specSha256":"0a042c6c6bfaf49260cba7695963ab80320d65051a6b74d5445520f009572f46","branch":"refs/heads/feature/mcp-tool-args","head":"32c4eec00607a1d5ffd2efdff30d756f045952d2","baseRef":"refs/heads/main","baseCommit":"676e8c3000037f85ff8f2adb5771c2729e1686d3","sourceTree":"c60517d671f762a0f3d2e662bf64dd172556047f","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11g1/F-01 [P2] closed - Coding standards still describe passthrough MCP inputs

**File:** blueprint/context/coding-standards.md:16
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** The always-read standards say MCP tool inputs stay passthrough `fromJsonSchema`; an agent following it would rebuild the deleted design.
**Suggested fix:** Replace the sentence with: MCP tool inputs are strict `zod/mini` schemas per tool (`zodToolInput` advertises, `parseToolArgs` parses; 11g1).
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-02 [P3] closed - Two comment test titles name deleted assertions

**File:** src/disk/comments.test.ts:377
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** `setCommentStatus rejects sent ...` (377) and `listComments ... rejects a bad status` (712) no longer test a reject; the titles mislead.
**Suggested fix:** Rename to `setCommentStatus applies the status machine` and `listComments filters by status`.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-03 [P3] closed - artboardFs test comment points at the wrong contract test

**File:** src/disk/artboardFs.test.ts:108
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** The base-format rejections live in `artboardTools.contract.test.ts`, not `toolSchemas`.
**Suggested fix:** Name only `artboardTools.contract.test.ts`.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-04 [P3] closed - System map: a schema error from the other tools has no ArgErr edge

**File:** blueprint/context/system-map.md:118
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** The label says any tool's schema error reaches ArgErr, but the edge hangs only on `MCPSet`; Chart checklist rule 2.
**Suggested fix:** Add `MCPOther -->|"schema error (parseToolArgs, before roots)"| ArgErr` and keep the MCPSet label set_artboard-only.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-05 [P3] closed - Malformed-base contract test asserts only the code

**File:** src/mcp/artboardTools.contract.test.ts
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** The baseGeneration / baseHash message strings are spec'd but unlocked.
**Suggested fix:** Assert `body.message` per case.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-06 [P3] closed - baseHash format is invisible in the advertised schema

**File:** src/mcp/artboardTools.ts
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** `z.refine` has no JSON Schema form, so clients see a bare string.
**Suggested fix:** Add `sha256: plus 64 hex characters` to the field description.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-07 [P3] closed - Advertised and parsed schema are named separately per tool, untested for drift

**File:** src/mcp/toolSchemas.contract.test.ts
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: breaker)
**Why it matters:** If a tool advertised schema A but parsed B, valid client calls would be rejected; the contract test would still pass.
**Suggested fix:** Per tool, one minimal valid call with no workspace must answer `NO_WORKSPACE` (parse passed), never `INVALID_ARGS`.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-08 [P3] closed - Skill says a missing id is INVALID_ARGS, but read_artboard's id is optional

**File:** skills/vibeboard/SKILL.md
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: breaker)
**Why it matters:** Read literally, an Agent may think omitting read_artboard's id fails.
**Suggested fix:** Say `a missing required id or a non-string id is INVALID_ARGS`.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-09 [P3] closed - Malformed-roots message suggests opening a folder, which cannot help

**File:** src/mcp/resolveWorkspaceRoot.ts:8
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: breaker)
**Why it matters:** Only no-roots clients reach it; for them the env is the fault.
**Suggested fix:** Drop `, or open a workspace folder`; update the test and spec contract line.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-10 [P3] closed - Rule 02 claims every unknown key is INVALID_ARGS; the SDK drops `__proto__` first

**File:** src/mcp/mcpToolResult.ts
**Found:** 2026-11-28 by /audit (scope: current; lens: all) (found by: breaker)
**Why it matters:** The SDK's `arguments` record parse silently drops `__proto__` (no pollution); the rule overstates.
**Suggested fix:** One clause in rule 02: the SDK drops a `__proto__` key before the parse.
**Resolution:** Fixed 2026-11-28 on feature/mcp-tool-args (pnpm verify green, 938 tests); Closed 2026-11-28 by dual re-review (breaker + literalist): defect gone, no new defect.

### 11g1/F-12 [P3] closed - Overview heading still says planned

**File:** blueprint/context/current-feature-overview.md:28
**Found:** 2026-11-28 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** Spec is verified; the chart is no longer planned.
**Suggested fix:** Drop `, planned`.
**Resolution:** Fixed 2026-11-28 (pnpm verify green, 938 tests); Closed 2026-11-28 by re-review (Opus): defect gone, no new defect.

### 11g1/F-13 [P3] closed - Overview counts two new messages; the spec has three

**File:** blueprint/context/current-feature-overview.md
**Found:** 2026-11-28 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** The wrong-type viewport message is new too.
**Suggested fix:** Say three and name viewport.
**Resolution:** Fixed 2026-11-28 (pnpm verify green, 938 tests); Closed 2026-11-28 by re-review (Opus): defect gone, no new defect.

### 11g1/F-14 [P3] closed - Wrong-typed baseGeneration asserts only the code

**File:** src/mcp/artboardTools.contract.test.ts
**Found:** 2026-11-28 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** The `'1'` case does not lock the message.
**Suggested fix:** Assert the baseGeneration message.
**Resolution:** Fixed 2026-11-28 (pnpm verify green, 938 tests); Closed 2026-11-28 by re-review (Opus): defect gone, no new defect.

### 11g1/F-15 [P3] closed - MCPSet edge label lists schema errors that no longer fail there

**File:** blueprint/context/system-map.md:118
**Found:** 2026-11-28 by /audit re-review (scope: current; lens: all) (found by: literalist)
**Why it matters:** html, title and viewport now fail in the schema before roots; only the id characters fail at beforeResolve.
**Suggested fix:** Label it `bad-character artboardId (beforeResolve)`; schema errors are the MCPOther-style edge.
**Resolution:** Fixed 2026-11-28 (pnpm verify green, 938 tests); Closed 2026-11-28 by re-review (Opus): defect gone, no new defect.

### 11g1/F-16 [P3] closed - Env stubs and stderr spy set outside the try

**File:** src/mcp/toolSchemas.contract.test.ts:30
**Found:** 2026-11-28 by /audit re-review (scope: current; lens: all) (found by: breaker)
**Why it matters:** If connect() throws, stubs and the muted stderr persist for the file.
**Suggested fix:** File-level afterEach that unstubs envs and restores mocks.
**Resolution:** Fixed 2026-11-28 (pnpm verify green, 938 tests); Closed 2026-11-28 by re-review (Opus): defect gone, no new defect.

### 11g1/F-17 [P3] closed - Schema-drift test sends only required fields

**File:** src/mcp/toolSchemas.contract.test.ts:12
**Found:** 2026-11-28 by /audit re-review (scope: current; lens: all) (found by: breaker)
**Why it matters:** An advertised optional field the parse schema lacks would pass unnoticed.
**Suggested fix:** Send every advertised property per tool and assert the sent keys equal the advertised keys.
**Resolution:** Fixed 2026-11-28 (pnpm verify green, 938 tests); Closed 2026-11-28 by re-review (Opus): defect gone, no new defect.


## Independent review

**Status:** passed
**Target commit:** 32c4eec00607a1d5ffd2efdff30d756f045952d2
**Base commit:** 676e8c3000037f85ff8f2adb5771c2729e1686d3
**Base ref:** main
**Spec hash:** 0a042c6c6bfaf49260cba7695963ab80320d65051a6b74d5445520f009572f46
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-28T12:14:17Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-28T12:18:46Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Handoff

Review the active spec and the complete `676e8c3000037f85ff8f2adb5771c2729e1686d3..32c4eec00607a1d5ffd2efdff30d756f045952d2` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

### Commands

- `pnpm exec vp test src/mcp src/disk/artboardFs.test.ts src/disk/comments.test.ts src/host`: pass (27 files, 344 tests)
- `pnpm exec vp test`: pass (76 files, 938 tests)
- `pnpm exec vp check`: pass (format, lint, type check)
- `pnpm exec knip` and `pnpm exec knip --production`: pass
- `node scripts/check-agent-rules.mjs`: pass
- Scratch-copy probes (`vitest run` in a `git archive` copy of the target): arg-message probe over every schema; mutation probes (drop the unknown-key preference, make `validate` reject, drop set_artboard's `beforeResolve`): each caught by its intended test
- `pnpm verify`, `vp pack`, `vp build`, `pnpm test:browser`: not run (writes `dist/`; out of reviewer bounds)

### Evidence

- Phase B preflight: HEAD, merge base with `main`, spec SHA-256 (tracked spec, no snapshot) and a clean tree except `review.md` all match the request.
- Whole delta read: `mcpToolResult.ts` (zodToolInput, parseToolArgs, runQueued / runOnOpenPage order), the 14 schemas in `artboardTools.ts`, `commentTools.ts`, `pageTools.ts`, typed disk args in `artboardFs.ts` / `comments.ts`, `resolveWorkspaceRoot.ts`, `errors.ts`, every non-MCP caller of the retyped disk functions (`artboardDisk.ts`, `panelEdit.ts`, `panelComments.ts`, `artboardEditFs.ts`, `pageOps.ts`), tests, skill, README, rules 02 / 04 / 05, system map, coding standards, build plan.
- Probe: every field error returns its authored message (incl. `baseGeneration` 0 / 1.5 / 2^60 / '1', malformed `baseHash`, empty and non-string `viewport`, `null` title, bad `status`, non-finite `x`); unknown keys win over field errors; non-object args get the root message.
- Panel paths keep their guards: `frame:place` x / y / width pass `chromeMessages.ts` `z.number()` bounds (rejects NaN / Infinity); `comment:set-status` is `z.enum(['open','resolved'])`; panel bases are host-computed hashes.
- SDK 2.4.0 calls `jsonSchema.input({ target: 'draft-2020-12' })` and runs `validate`; the pass-through keeps our `{ code, message }` body (toolSchemas contract test, mutation-proven).
- Every documented tool-call shape in the skill, README and source matches the strict schemas.

### Findings

- None new. F-11 (P3, unverified) re-examined and left unverified.

### Remaining risk

- `pnpm verify` (adds svelte-check, webview tsc, `vp pack`, `vp build`) not run by this reviewer: it writes `dist/`.
- Real-client acceptance of the strict 2020-12 advertised schema (Cursor, Copilot) is unverified (F-11); the spec's required real-client run belongs to `/check`, which this request did not require.
- `pnpm test:browser` not run; no chrome or frame change in the delta.

## Gates

- Verify: `pnpm verify` passed at completion (76 files, 938 tests); stdio smoke test of the built `dist/mcp.js` (14 strict tools, set_artboard + place_frame succeed, unknown key gets the authored `INVALID_ARGS`, no SDK stderr warning).
- Audit: explicit `/audit current`, dual (Opus 5.5 breaker + Sonnet 5.5 literalist), plus two re-review rounds; 0 P0/P1; F-01..F-10, F-12..F-17 closed.
- Independent review: selected (`when-sensitive`: MCP args are untrusted Agent input); automatic fresh subagent, passed on checkpoint 32c4eec.
- Check: `manual`, not requested. F-11 (real-client schema acceptance) stays `unverified` in the live ledger until the Cursor run below.

## Try it now

1. `pnpm vp pack` (or `pnpm verify`) so `dist/mcp.js` is current, then F5 (`fixtures/dev-workspace`).
2. In the dev host's Cursor Agent, open the MCP tools list: all 14 vibeboard tools are listed and enabled.
3. Ask the Agent to `set_artboard` a small artboard, then `place_frame` it: both succeed and the panel shows the frame.
4. Ask the Agent to call `place_frame` with `{ artboardId: "hero" }`: it gets `INVALID_ARGS` "place_frame does not take artboardId. Fix args and retry."
5. Wrong result: a tool missing from the list, or a client-side schema error before the call reaches the server (that is F-11: drop `$schema` in `zodToolInput`).
