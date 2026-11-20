# Fix: Audit code problems (silent catch, dead check, twin helpers)

**Type:** Fix
**Status:** verified
**Branch:** fix/audit-code-problems
**Fixes:** F-76

## The problem

The 2026-11-20 comment audit found code problems it could not fix in a comment-only diff:

1. `src/mcp/resolveWorkspaceRoot.ts` `parseRootsJson`: an invalid `CURSOR_DESIGN_WORKSPACE_ROOTS`
   (bad JSON, not an array, an empty or non-string item) silently falls back to the single ROOT
   env. Rule 06 #5: a deliberate silent path logs first. Our own extension writes that env, so a
   bad value is our bug and should be visible. `parseWorkspaceRootsEnv` runs on every MCP tool
   call (`mcpToolResult.ts` `runQueued`), so the log must fire once per process, not per call.
2. `src/webview/Stage.svelte` `startDrag` (~:318-323): the `closest('[data-cd-frame-label],
   [data-cd-frame-resize]')` guard can never fire. Labels and resize handles render inside
   `.layer` (never the viewport or its direct child), and the empty-stage check above already
   returned.
3. Twin helpers (rule 03: a twin is a bug):
   - `intersectRect` (`src/webview/pins.ts`) is `clipRect` (`src/webview/frame/pickTarget.ts`)
     with one clip; same empty-result rule.
   - `CommentCard.svelte` re-derives `replyPending` and `anythingPending` instead of using
     `commentActions.ts` (`anythingPending` is module-private there).
   - `applyEdit`'s text guard (`src/webview/frame/commentPicking.ts`) repeats the "other content"
     test in `textOf` (`src/webview/frame/editTarget.ts`).
   - `logTargetReadError` (`src/disk/commentViews.ts`) and `logLockError`
     (`src/disk/workspaceLock.ts`) are the same stderr writer (F-76, first half).
   - `toolSchema` (`src/mcp/artboardTools.ts:55`) only fixes the generic of
     `toolInputSchema<ToolArgs>`: the pass-through forwarder rule 05 bans (F-76, second half).
   - The `${workspaceRoot}\0${frameId}` key is built twice in `commentViews.ts` and again as
     `memoKey` in `src/host/canvasSnapshot.ts` (which already uses `commentViews`' cache).

Not a twin: `textExcerpt` (`src/webview/frame/selector.ts`) keeps format characters (`\p{Cf}`)
that `toOneLine` strips. Deliberate: `addComment`'s `targetAgrees` compares the picked text with
the raw disk text (only whitespace removed), so stripping a soft hyphen or ZWJ would stop a
genuine target from agreeing and lose its fingerprint. The prompt path re-sanitizes with
`toOneLine`. Keep it; add a one-line comment saying so.

F-76 also notes the disk lib runs in the extension host too (`withCommentViews` on the panel path,
`withWorkspaceLock` for panel edits and comments), where stderr reaches the Extension Host log, not
the Cursor Design OutputChannel (`logDiskError`). This fix does not change that channel (output is
identical to today); it records it as a `ponytail:` ceiling on `logStderr`. That closes F-76.

## The fix

- **`logStderr(scope: string, error: unknown): void`** in `src/disk/errors.ts` (owner of the fs
  error helpers). Exact body:

  ```ts
  try {
  	process.stderr.write(
  		`cursor-design: ${scope} failed: ${error instanceof Error ? error.message : String(error)}\n`,
  	);
  } catch {
  	// ponytail: ...
  }
  ```

  One-line doc above it: the disk lib has no OutputChannel, so disk-lib failures (and the MCP's ROOTS
  parse) go to stderr. The comment-only `catch` (precedent: `Frame.svelte` stamp catch; lint `no-empty`
  accepts it) carries the `ponytail:` ceiling: a synchronous throw (a throwing `message` getter or
  `toString`, a sync write failure) is dropped so the caller's original failure wins; an async
  EPIPE is a stream `'error'` event and is not covered (same as `logMcpError`); in the extension
  host this lands in the Extension Host log, not the Cursor Design Output channel. Upgrade path:
  host callers log through `logDiskError`.
- `logLockError` / `logTargetReadError` are deleted. Call sites pass `` `workspace lock ${action}` ``
  and `'comment target read'`, so the stderr text is byte-identical. The `workspaceLock.ts` comment
  "The disk lib has no output channel…" goes (its reason now lives on `logStderr`).
  `logMcpError` (stack, `cursor-design MCP:` prefix, tool errors) stays: different content.
- **ROOTS log.** In `resolveWorkspaceRoot.ts`, a module-level `let rootsInvalidLogged = false` (no
  reset export). `parseRootsJson` keeps its one `try`; the not-an-array and bad-item checks become
  one `throw new Error('expected a JSON array of non-empty strings')` inside it, so the one
  `catch (error)` handles all three cases: if the flag is false, set it and call
  ``logStderr(`${CURSOR_DESIGN_WORKSPACE_ROOTS_ENV} parse`, error)`` (the env name imported, never
  typed), then return `undefined` as today. Bad JSON logs the `SyntaxError` message. The fallback
  is unchanged, so with ROOT also missing the line is logged and then `NO_WORKSPACE` is thrown.
  The existing `ponytail:` comment is rewritten: ceiling = only the ROOT folder (the first) is
  served and later invalid values in the same process are not logged; upgrade path = fail the
  tool call with an authored error instead of falling back.
- Delete the dead `closest(...)` guard in `startDrag`.
- `jumpTarget`: `const box = live?.box ?? comment.rect; const fitBox = box === null ? null :
  clipRect(box, [frameRect]);` and `fitBox === undefined` becomes `fitBox === null`;
  `intersectRect` deleted. Inputs are finite (`parseFrameRect`), so the empty-result rule is
  identical (`left >= right` vs `width > 0`).
- `commentActions.ts` exports `anythingPending`. `CommentCard.svelte` imports `replyPending` and
  `anythingPending` and renames its locals to `const isReplyPending =
  $derived(replyPending(action))` and `const isAnythingPending = $derived(anythingPending(action))`,
  updating every use (lines ~92, 105, 120, 231, 258).
- `editTarget.ts` exports `hasOtherContent(element: Element): boolean` (more than one child node,
  or one that is not `Text`; the "comment counts as other content" comment moves onto it).
  `textOf` returns `children` when it is true (keeps `const [only] = element.childNodes` for the
  text); `applyEdit` returns when `hasOtherContent(target)`.
- `commentViews.ts` exports `frameCacheKey(workspaceRoot: string, frameId: string): string`, used
  by `cachedArtboardDocument` and `loadArtboardDocument` and by `canvasSnapshot.ts` (`memoKey`
  deleted).
- `toolSchema` deleted; its eight call sites call `toolInputSchema<ToolArgs>({...})` directly, as
  `commentTools.ts` does.
- `textExcerpt` comment, one line directly above `export const textExcerpt` in `selector.ts`:
  `// Keeps format chars (\p{Cf}) that toOneLine strips: targetAgrees compares it with raw disk text.`
- Catalogs, in the step that adds each helper. Rule 05: `logStderr` on the `src/disk/errors.ts`
  line, `frameCacheKey` on the `src/disk/commentViews.ts` line (`canvasSnapshot.ts` line
  unchanged). Rule 08: `anythingPending` after `replyPending` on the `src/webview/commentActions.ts`
  line; `hasOtherContent` on the frame-runtime `src/webview/frame/editTarget.ts` line (`describeEditTarget`, `hasOtherContent`, DOM reads only).

Must not break: stderr text of the lock and target-read logs; `jumpTarget` results; reply / copy
button states; Edit-mode live preview refusing elements with child elements or comments; the frame
runtime's size and `.style` / `setAttribute(` / `host.postMessage` guards in `runtime.test.ts`
(budget unchanged: measured about 35,020 of 35,135 chars and the extraction is near net zero; if
it trips, stop and report, never raise the budget); the parse cache and tagged-copy memo hits; MCP
tool input schemas.

## Build steps

1. **Stderr writer + ROOTS log.** Add `logStderr` (+ rule 05 line), switch both disk loggers, log
   invalid ROOTS once. Done when: `src/mcp/resolveWorkspaceRoot.test.ts` "invalid ROOTS falls
   back to ROOT" spies `process.stderr.write` (`vi.spyOn(...).mockReturnValue(true)`, restored
   after, as `comments.test.ts` does) across its six invalid values and asserts exactly one call.
   The loop's first value is `'null'` (not an array), so the call's chunk is exactly
   `` `cursor-design: ${CURSOR_DESIGN_WORKSPACE_ROOTS_ENV} parse failed: expected a JSON array of non-empty strings\n` ``.
   This test stays the file's first parse of an invalid ROOTS (the flag is per module, Vitest
   isolates per file). It fails on current code; existing lock and comments tests pass unchanged.
2. **Webview twins and dead check.** `clipRect` in `jumpTarget`, `anythingPending` /
   `replyPending` in `CommentCard` (+ rule 08 line), `hasOtherContent` (+ rule 08 line), delete
   the `startDrag` guard, the `textExcerpt` comment, Svelte autofixer clean on `CommentCard.svelte`
   and `Stage.svelte`. `hasOtherContent` changes the embedded frame runtime, so update the
   `handoffCanvasHtml` snapshot on purpose (`pnpm exec vp test -u src/disk/handoffCanvasHtml.test.ts`);
   its diff is only the new `hasOtherContent` function and the two rewritten checks, once per
   embedded frame. Done when: `pnpm test` passes with `runtime.test.ts` unchanged, and
   `pnpm test:browser` passes: `pins.spec.ts` (jump), `commentsPanel.spec.ts` and
   `commentPopover.spec.ts` (reply / copy states), `editMode.spec.ts` (live preview refusal), and
   `stage.spec.ts` "dragging a label posts one whole-pixel frame:place…" (its post-drag frame box
   proves a label drag does not pan the stage).
3. **Cache key + forwarder.** `frameCacheKey` in `commentViews.ts` and `canvasSnapshot.ts`
   (+ rule 05 line); delete `toolSchema`. Done when: `pnpm verify` passes.

## Verify

- `pnpm verify` green; `pnpm test:browser` green (local only, needs Playwright Chromium; not in
  Verify or CI).
- The ROOTS test fails before step 1 and passes after.
- `git grep -n "intersectRect\|logLockError\|logTargetReadError\|memoKey\|toolSchema" -- src .claude`
  returns nothing.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":9889,"specSha256":"2f6b3269e3a7821a4c9a8a2094bdbc591f41447775bc72e0ee559eb9c6f8901c","branch":"refs/heads/fix/audit-code-problems","head":"23b15fb51cf198e759625e7817eeae68b97efe5c","baseRef":"refs/heads/main","baseCommit":"23b15fb51cf198e759625e7817eeae68b97efe5c","sourceTree":"5063b9fef8015e5d1c9be720f46393685a5fd57b","landing":"local-merge","absentOptional":[]} -->

## Findings

### audit-code-problems/F-76 [P3] closed - Twin stderr logger in the disk lib and a pass-through toolSchema wrapper

**File:** src/disk/comments.ts:449 and src/mcp/artboardTools.ts:55
**Found:** 2026-10-26 by independent /audit (scope: current; lens: quality)
**Why it matters:** Rule 05 names `logMcpError` (`mcpToolResult.ts`) as the MCP stderr logger and `logDiskError` as the host one. `logTargetReadError` in `comments.ts` is a third stderr writer with its own wording inside the disk lib, which the rule says has no I/O policy of its own and which the host will also call from 8f1 (where stderr is not the Output channel). Separately `toolSchema` in `artboardTools.ts` only fixes the generic of `toolInputSchema<ToolArgs>`; it is the forwarder rule 05 says to leave out, and it forced eight renames in the diff.
**Suggested fix:** Export `logMcpError` from `mcpToolResult.ts` or, for the disk lib, let `loadArtboardDocument` return `'unreadable'` without logging and have the MCP/host caller log (8f1 decides). Delete `toolSchema` and call `toolInputSchema<ToolArgs>(...)` directly. No behaviour is lost.
**Resolution:** fixed on fix/audit-code-problems: one `logStderr` in `src/disk/errors.ts` replaces both disk-lib stderr writers (host-side ceiling recorded as a `ponytail:` on it); `toolSchema` deleted.
2026-11-20 /audit (scope: current; all lenses) closed: re-read `src/disk/errors.ts:331`, `src/disk/commentViews.ts`, `src/disk/workspaceLock.ts`, `src/mcp/artboardTools.ts`. `git grep` finds no `logLockError`, `logTargetReadError` or `toolSchema` under `src` or `.claude`; the only stderr writers left are `logStderr`, `logMcpError` (stack, different prefix) and `server.ts`. Call-site scopes keep the old lock and target-read lines byte-identical (`pnpm verify` printed the unchanged `cursor-design: comment target read failed: ...` line). All eight schemas call `toolInputSchema<ToolArgs>` directly; its signature is unchanged, so the schemas are identical. The extension-host channel is the recorded `ponytail:` ceiling. No new defect from the repair.

### audit-code-problems/F-153 [P3] closed - The ROOTS once-guard test depends on running first, with no note in the test

**File:** src/mcp/resolveWorkspaceRoot.test.ts:84
**Found:** 2026-11-20 by /audit (scope: current; lens: tests)
**Why it matters:** `rootsInvalidLogged` in `resolveWorkspaceRoot.ts` is module state with no reset. "invalid ROOTS falls back to ROOT" asserts exactly one stderr call, so it passes only while it is the file's first parse of an invalid ROOTS. The spec says so; the test file does not. A later test added above it (or a shuffled run) makes it fail with zero calls, and nothing in the file points at why.
**Suggested fix:** One why-comment above the spy: the once flag is per module and Vitest isolates per file, so this must stay the first invalid-ROOTS parse in the file. No behaviour is lost.
**Resolution:** 2026-11-20 /implement (audit repair): one why-comment above the stderr spy says the log-once flag is module state with no reset, so the test must stay the file's first invalid-ROOTS parse. No reset export.
2026-11-20 /audit (scope: current; all lenses) closed: re-read `src/mcp/resolveWorkspaceRoot.test.ts:84-102` and `resolveWorkspaceRoot.ts`. The comment sits directly above the spy and names the cause (module flag, no reset) and the constraint; no earlier test in the file parses ROOTS, and the later `'[]'` case is a valid array, so it never logs. The exact-calls assertion still fails if the once guard goes (six calls). Comment-only repair; `pnpm verify` passed.

### audit-code-problems/F-154 [P3] closed - selectorMatch's scale test can time out under a full parallel verify

**File:** src/disk/selectorMatch.test.ts:177
**Found:** 2026-11-20 by /audit (scope: current; lens: tests)
**Why it matters:** The first `pnpm verify` of this pass failed on "scale: deep, wide and long inputs stay linear" (Vitest's 5000 ms default timeout); it takes 609 ms alone, and the next `pnpm verify` passed. Outside this fix's diff, but a flaky Verify gate can stop `/complete` or CI for no code reason. One occurrence; not reproduced.
**Suggested fix:** If it recurs, give that test an explicit timeout argument (the linear-time assertion is the guard, not the wall clock), or shrink its inputs. Otherwise close as a one-off.
**Resolution:** 2026-11-20 /implement (audit repair): confirmed, not a one-off: the 5 s default timeout hit these tests 3 times on 2026-11-20 under the parallel `pnpm verify` (0.4 to 1.1 s each alone). The three heavy-tree tests ("scale: deep, wide and long inputs stay linear", "scale: past MAX_MATCH_WORK the match gives up as null", "MAX_MATCH_WORK counts every check ...") now pass `{ timeout: 30_000 }` with a why-comment; `LINEAR_BOUND_MS` on the match stays the guard. Assertions, `MAX_MATCH_WORK` and the global timeout unchanged.
2026-11-20 /audit (scope: current; all lenses) closed: re-read `src/disk/selectorMatch.test.ts:22-27,180-241`. `HEAVY` is passed as the options argument (Vitest's `test(name, options, fn)`) on exactly the three tree-building tests; `git diff main` shows the third test only re-indented, every assertion and `LINEAR_BOUND_MS` (5000 ms on the timed match) unchanged, so a return to backtracking still fails. No other test or the global config changed. `pnpm verify` passed (59 files, 729 tests).

## Try it now

The only visible change is one stderr line when `CURSOR_DESIGN_WORKSPACE_ROOTS` is invalid; the rest is a behavior-preserving refactor covered by `pnpm verify`. After `pnpm compile` (or `pnpm verify`), from the repo root:

```bash
ws=$(mktemp -d)
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"try","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_artboards","arguments":{}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_artboards","arguments":{}}}'; sleep 2) \
  | CURSOR_DESIGN_WORKSPACE_ROOTS='null' CURSOR_DESIGN_WORKSPACE_ROOT="$ws" node dist/mcp.js >/dev/null
```

Expected: exactly one line on stderr, `cursor-design: CURSOR_DESIGN_WORKSPACE_ROOTS parse failed: expected a JSON array of non-empty strings`, although two tool calls ran, and both calls still answer from the `CURSOR_DESIGN_WORKSPACE_ROOT` folder. Incorrect: no line (the silent fallback is back) or one line per call.
