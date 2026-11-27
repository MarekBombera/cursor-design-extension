# Feature: Host message guard

**From build-plan:** feature 11d
**Build attempt:** 1
**Branch:** feature/host-message-guard
**Status:** verified (steps 1-2 built; probes A and B red, restored, `cmp` clean; `pnpm test:browser` 231 passed; `pnpm verify` passed 2026-11-27: 75 files, 926 tests)

## Goal

Shrink the chrome's `parseHostMessage` to what it is: a drift guard on our own host's messages,
not a trust boundary. Drop the field-by-field re-validation of each posted comment (the host's
strict `comments.json` parse already checks those fields, with one named exception below), keep
every envelope check, and move the parser and `routeMessage` out of the message types file so
`src/webview/hostMessages.ts` holds only wire types. No zod in the chrome bundle. No wire change.

Why the move is unconditional although the plan says "if it stays large": after the cut the parser
and router are still about 190 of about 490 lines, a runtime job inside a file the host imports
only for types (rule 03: split a file that mixes concerns; rule 05).

## In scope

- `parseCommentsUpdated` keeps its envelope checks (`pageId`, `comments` is an array, optional
  string `error`) and passes the `comments` array through without per-entry checks.
- Delete `parsePostedComment`, `parseReply`, `isCommentStatus`, `isFlag` and the per-entry loop
  (about 70 lines, `src/webview/hostMessages.ts:371-455` today).
- Un-export `parseFrameRect` in `src/webview/frame/frameMessages.ts` (its last outside importer
  goes; knip's `exports` check in Verify fails otherwise).
- Every other `parseHostMessage` branch stays exactly as it is: `canvas:updated` (frame and page
  entry guards, a bad entry dropped), `artboard:error`, `ui:status`, `comment:added`,
  `comment:saved`, `page:saved`, `ui:error`, `artboard:edited`, `ui:copied`.
- Move `parseHostMessage`, `routeMessage`, `MessageRoute` and their private helpers to a new
  `src/webview/hostMessageGuard.ts`; move their tests to `src/webview/hostMessageGuard.test.ts`.
  `hostMessages.ts` keeps only types (no runtime export, only `import type`).
- Docs: rule 04 (the one cast exception), rule 08 catalog, rule 02 item 5, system map (routing
  paragraph and the `comments:updated` contract row).

## Out of scope

- Any change to the wire shape of any message, the host's `comments.json` parse (`rectSchema`
  included), `toPostedComment`, `parseChromeMessage` (chrome → host), `parseFrameMessage` /
  `parseChromeFrameMessage`, or `routeMessage`'s logic.
- Shrinking the `canvas:updated` frame or page guards (kept as the drift guard; the plan names only
  the comment re-validation).
- zod or any new dependency in the chrome bundle.
- 11e comments deep review.

## Build loop

Steps run in order on `feature/host-message-guard`. `workflow.stepReview` is `feature`: one review
at the end of the feature, not per step. `workflow.checkpointCommits` is `disabled`: no commits
until `/complete`. Each step ends green on `pnpm verify`.

Agent test runs stay short (AGENTS.md): iterate with `vp test src/webview/hostMessage`, run
`pnpm verify` at the end of each step, and the full `pnpm test:browser` once at the end of step 2.

## Build steps

- [x] **1. Drop the comment re-validation.** In `src/webview/hostMessages.ts`:
  - `parseCommentsUpdated` keeps its envelope `if` and returns `comments: data.comments as
    PostedComment[]` in both return shapes (with and without `error`). This cast is rule 04's one
    sanctioned exception (recorded in rule 04 in this step). If `vp check` rejects the direct cast
    of the narrowed array, write `data.comments as unknown[] as PostedComment[]`; no other form.
  - Delete `parsePostedComment`, `parseReply`, `isCommentStatus`, `isFlag` and the loop, and the
    imports only they used (`hasControlChars`, `isTagName`, `parseFrameRect`). Keep `isRecord`,
    `isFiniteNumber`, `type FrameRect`, `type CommentStyles`.
  - Replace the comment above `parseCommentsUpdated` ("A malformed comment is dropped, like a
    malformed frame; a malformed list or error drops all.") with exactly:

    ```ts
    // A malformed list or error drops all. Entries are not re-checked (rule 04's one cast): the host
    // posts only comments that passed parseCommentsFile, where one bad entry fails the whole file
    // (posted as `error`, no comments), and routeMessage keeps frames out. A comment's rect is finite
    // but not capped at MAX_FRAME_COORDINATE; the panel renders comment text as Svelte text only.
    ```

  - In `src/webview/frame/frameMessages.ts`, drop `export` from `parseFrameRect` (its body and its
    in-file user stay). `anchorRects.ts:43` keeps its comment (it names the function's bounds,
    which stay).
  - `.claude/rules/04-code-conventions.md`, section "Wire values are `unknown` until a guard checks
    them": append to the paragraph: "One exception: the chrome checks only the envelope of host →
    chrome `comments:updated` and casts its entries, which the host's `comments.json` parse
    checked (`parseCommentsUpdated`)."

  Tests in `src/webview/hostMessages.test.ts`: delete `comments:updated drops a malformed comment
  and keeps the valid one` and `comments:updated keeps true, false and null flags and drops anything
  else`. Add one test `comments:updated passes the host's comments through with no per-entry check`
  whose list is, in order: `validComment` (id `c1`), `{ ...validComment, id: 'c2', status: 'sent' }`,
  `{ ...validComment, id: 'c3', status: 'resolved' }`, `{ ...validComment, id: 'c4', isPage: true,
  selector: 'body', tagName: 'body', rect: null, replies: [], stale: null, targetMissing: null }`,
  and `{ ...validComment, id: 'c5', selector: 'h1\nh2' }` (an entry the old guard dropped: it pins
  "no per-entry check"); assert `deepEqual` with `{ type: 'comments:updated', pageId: 'page-1',
  comments: <the same list> }`; then parse the same list with `error: 'x'` and assert the list and
  `error` come back (audit F-05). Keep `comments:updated with a bad pageId, a non-array list or a
  non-string error is rejected` unchanged. The file goes from 17 tests to 16.

  **Done when:**
  - `pnpm verify` passes;
  - `grep -cE "parsePostedComment|parseReply|isCommentStatus|isFlag" src/webview/hostMessages.ts`
    prints 0;
  - probe A and probe B each fail the named test, and the source is restored: before the probes,
    `cp src/webview/hostMessages.ts <scratchpad>/hostMessages.ts.keep`; probe A (replace
    `data.comments as PostedComment[]` with `[]` in the no-`error` return) fails the pass-through
    test; probe B (delete `!Array.isArray(data.comments) ||`) fails the kept rejection test; after
    each probe, restore from the copy and `cmp` it against the file (no output).

- [x] **2. Move the guard out of the types file.** Create `src/webview/hostMessageGuard.ts` holding
  `parseHostMessage`, `routeMessage`, `type MessageRoute` and the helpers only they use
  (`ARTBOARD_ERROR_FALLBACK`, `isOptionalString`, `isPostedPageId`, `parsePostedFrame`,
  `parsePostedPage`, `parseCanvasUpdated`, `parseCommentsUpdated`, `parseUiError`), moved verbatim
  with their comments as they stand after step 1 (the step 1 trust comment moves with
  `parseCommentsUpdated`). Its imports:
  - `import type { CanvasUpdatedMessage, CommentsUpdatedMessage, HostMessage, PostedCanvasFrame,
    PostedComment, PostedPage, UiErrorMessage } from './hostMessages'`;
  - `isPageId` from `../disk/layout`; `isRecord`, `isFiniteNumber` from `./frame/frameMessages`.

  `hostMessages.ts` keeps every type and the DOM-free note; its imports become `import type` only
  (`StyleChange`, `HISTORY_STEPS`, `FrameRect`, `CommentStyles`).
  `git mv src/webview/hostMessages.test.ts src/webview/hostMessageGuard.test.ts`, then point its
  import at `./hostMessageGuard`; no test body changes.
  `src/webview/hostBridge.svelte.ts`: split today's mixed import from `./hostMessages` into the
  types from `./hostMessages` and `{ parseHostMessage, routeMessage }` from `./hostMessageGuard`
  (`vp check --fix` may reorder them). `tests/browser/harness.ts` needs no change (type imports
  only; its `routeMessage` mention is a comment).
  Docs in the same step:
  - `.claude/rules/08-svelte-chrome.md:62`: the bullet becomes "`hostMessages.ts` → host ↔ chrome
    message types; `hostMessageGuard.ts` → host message parse and routing; `savedState.ts` → saved
    stage view and comment UI parse."
  - `.claude/rules/02-mcp-webview.md:40`: "Shapes and per-message rules: `src/webview/hostMessages.ts`"
    becomes "Shapes: `src/webview/hostMessages.ts`; host → chrome parse: `src/webview/hostMessageGuard.ts`;"
    with the rest of the line unchanged.
  - `.claude/rules/04-code-conventions.md`: the step 1 exception names `hostMessageGuard.ts`
    (`parseCommentsUpdated` in `hostMessageGuard.ts`). Line 27 stays (types, still true).
  - `.claude/rules/05-single-job.md:53` stays (host reuses `hostMessages.ts` for message types).
  - `blueprint/context/system-map.md`: in "Agent edit to live frame", the sentence ending "the rest
    goes to `parseHostMessage`." gains ", which checks only message envelopes for comments (the
    entries come from the host's strict `comments.json` parse)"; the `comments:updated` row of
    "Message contract (shipped)" gains "the chrome checks the envelope only, 11d".

  **Done when:**
  - `grep -nE "^export (const|function)" src/webview/hostMessages.ts` prints nothing;
  - `grep -rnE "import .*(parseHostMessage|routeMessage)|(parseHostMessage|routeMessage)," src tests`
    hits only `src/webview/hostBridge.svelte.ts` and `src/webview/hostMessageGuard.test.ts`;
  - `pnpm verify` passes, with 16 tests in `hostMessageGuard.test.ts` and the total equal to
    step 1's;
  - the full `pnpm test:browser` passes once (comments panel, pins and pages specs exercise
    `comments:updated` through the real bridge).

## Files / areas

- `src/webview/hostMessages.ts` (types only after step 2)
- `src/webview/hostMessageGuard.ts` (new: `parseHostMessage`, `routeMessage`)
- `src/webview/hostMessages.test.ts` → `src/webview/hostMessageGuard.test.ts`
- `src/webview/hostBridge.svelte.ts` (import path)
- `src/webview/frame/frameMessages.ts` (`parseFrameRect` un-exported)
- `.claude/rules/04-code-conventions.md`, `.claude/rules/08-svelte-chrome.md`,
  `.claude/rules/02-mcp-webview.md` (`.cursor/rules/*.mdc` are symlinks: edit the `.claude` file
  only)
- `blueprint/context/system-map.md`
- `.cursor/skills/audit/SKILL.md` (critical-diff list names `hostMessageGuard.ts`, audit F-02)
- Unchanged, checked: `tests/browser/harness.ts`, `.claude/rules/05-single-job.md`

## Data / contracts

- **No wire change.** Every host → chrome message keeps its shape (system map "Message contract
  (shipped)"). `HostMessage`, `PostedComment` and every other type keep their definitions.
- **Trust reason.** The host posts only comments that passed `parseCommentsFile`'s zod schema
  (`src/disk/commentsFile.ts`: selector and text without control characters and within their caps,
  `isTagName`, finite rect and pin, status and author enums, reply cap, unique ids); one bad entry
  fails the whole file, which the host posts as `error` with an empty list. `stale` and
  `targetMissing` are computed by the host (`withCommentViews`). `toPostedComment` picks the posted
  fields. `routeMessage` drops every opaque-origin sender that is not a registered frame, so a
  design script cannot reach `parseHostMessage`. The chrome renders comment text only as Svelte
  text (no `{@html}` in `src/webview`), and selectors sent on to a frame are re-checked there by
  `parseChromeFrameMessage`.
- **Kept envelope rule.** `comments:updated` is `undefined` (dropped) when `pageId` is neither `''`
  nor a page id, `comments` is not an array, or `error` is present and not a string. An accepted
  message carries the host's `comments` array as-is (same entries, same order).
- **Behavior delta (accepted).** Before: a comment entry failing a field check was dropped and the
  rest kept. After: entries pass through. The host covers every dropped check (its parse, plus
  `stale` and `targetMissing`, which it computes) except one: rect coordinates are finite on the
  host but not capped at `MAX_FRAME_COORDINATE` (100,000). The panel's own `comment:create` path
  caps them (`chromeMessages.ts` `coordinate` and `size`), so only a hand-edited `comments.json` can
  hold a larger rect. Such a comment used to be hidden; now it shows in the panel, and its pin and
  jump follow the usual stored-rect rules (`layoutPins`, `jumpTarget` in `pins.ts`). With no live
  box, its jump flash outline is the whole stored rect, unclipped, so it can run across neighbouring
  frames. Harmless, so accepted; capping `rectSchema` would change which stored files load (out of
  scope).

## Testing

- Unit (Vitest): the pass-through test (including one entry the old guard dropped, and the same list
  with `error`) and the kept envelope rejection test in `hostMessageGuard.test.ts`; every other
  existing parse and route test moved unchanged (17 → 16 tests).
- Mutation probes A and B in step 1, each restored and `cmp`-checked.
- Browser (`pnpm test:browser`, once at the end of step 2): proves the bridge still delivers
  comments to the panel and pins; no new browser spec.
- No F5 or real-Cursor check: nothing Cursor-only changes.

## Notes for the AI

- 11f's mutation review (`blueprint/reference/11f-test-review.md` B2P1) left 37 surviving mutants in
  this comment re-validation for 11d to delete. B2S26 (statuses) is retired by the deletion; the
  pass-through test keeps `sent` and `resolved` fixtures.
- Root `tsconfig.json` excludes `src/webview`; `hostMessages.ts` is type-checked by the root config
  only through host `import type`s, which is why it must stay DOM-free and why the guard (chrome
  runtime only) may leave it. `hostMessageGuard.ts` is checked by `svelte-check` and
  `tsconfig.webview-tests.json` in Verify.
- No Agent skill change: no MCP tool, error code, limit, sandbox or CSP changes.
- Comment edits here are factual claims: the step 1 code comment must match the Trust reason above.
- Notion: the quality-pass page gets a one-line "Shipped in 11d" note at `/complete` (needs
  Bombic's yes, as before).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":14265,"specSha256":"7212f2ab937de6d4b4315a757746086f7f015425acd460d5aa0a32649a87b5de","branch":"refs/heads/feature/host-message-guard","head":"b94834f9325ac26ce12e8096778abdecc13af278","baseRef":"refs/heads/main","baseCommit":"b94834f9325ac26ce12e8096778abdecc13af278","sourceTree":"dc2b565924967f1dc064cfd21ab5bdd4d7023c41","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11d/F-01 [P3] closed - Trust comment's "Their" has no clear antecedent

**File:** src/webview/hostMessageGuard.ts:106
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** "Their rect is finite…" and "renders their text" follow "routeMessage keeps frames out", so read literally "their" points at frames, not comments. The literalist's second claim (the pin is uncapped too) is disproved: the old chrome guard never capped the pin (finite only) and the host clamps it to 0..1, so the pin is not part of the delta.
**Suggested fix:** "A comment's rect is finite but not capped at MAX_FRAME_COORDINATE; the panel renders comment text as Svelte text only." Same text in the spec's step 1 block.
**Resolution:** Fixed: comment reads "A comment's rect is finite but not capped at MAX_FRAME_COORDINATE; the panel renders comment text as Svelte text only."; the spec's step 1 block matches. Closed 2026-11-27 by fresh Opus + Sonnet re-review: defect gone, no new problem.

### 11d/F-02 [P3] closed - Audit skill's critical-diff list misses hostMessageGuard.ts

**File:** .cursor/skills/audit/SKILL.md:120
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** The host → chrome parse now lives in `hostMessageGuard.ts`; a later change to it alone would not trigger the dual review that message contracts get.
**Suggested fix:** Add `src/webview/hostMessageGuard.ts` to the "message contracts" bullet.
**Resolution:** Fixed: `src/webview/hostMessageGuard.ts` added to the message-contracts bullet. Closed 2026-11-27 by fresh Opus + Sonnet re-review: defect gone, no new problem.

### 11d/F-03 [P3] closed - Rule 02 item 5 groups frameMessages.ts under the host → chrome parse label

**File:** .claude/rules/02-mcp-webview.md:40
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: literalist)
**Why it matters:** "host → chrome parse: `hostMessageGuard.ts`; `frameMessages.ts` and the table" reads as if the frame ↔ chrome file were a host → chrome parser.
**Suggested fix:** Name each file with its job: `hostMessages.ts` (host ↔ chrome types), `hostMessageGuard.ts` (host → chrome parse), `frame/frameMessages.ts` (frame ↔ chrome), then the table.
**Resolution:** Fixed: item 5 names each file with its job (host ↔ chrome types, host → chrome parse, frame ↔ chrome), then the table. Closed 2026-11-27 by fresh Opus + Sonnet re-review: defect gone, no new problem.

### 11d/F-04 [P3] closed - Spec Behavior delta misdescribes where an oversized-rect pin shows

**File:** blueprint/context/current-feature.md (Data / contracts, "Behavior delta (accepted)")
**Found:** 2026-11-27 by /audit (scope: current; lens: all) (found by: breaker)
**Why it matters:** The spec says the pin shows "with the pin centre clamped into the frame". In code, `layoutPins` (`src/webview/pins.ts:248`) hides a pin whose stored-rect point lies outside the frame until the frame reports a live box; the clamp is only `jumpTarget`'s pan centre, and the stored rect is only the jump flash outline when no live box exists. The archive would record wrong behavior; the overview repeats it.
**Suggested fix:** Reword the spec sentence and the overview: the comment shows in the panel; its pin stays hidden until the frame reports the element's live box (then sits there); a jump to it pans to the clamped centre and flashes nothing visible.
**Resolution:** Fixed: spec Behavior delta and overview now say the pin stays hidden until a live box arrives (`layoutPins`), the jump pans to the clamped centre, the flash outline is the stored rect only with no live box. Re-review (Opus; Sonnet as its N-02/N-03) kept it open: the new wording held only when the rect's origin lies outside the frame. An origin inside with an oversized size shows the pin at once (`pinPoint` uses the origin), the jump centres the clipped part (`clipRect`), and with no live box the flash outline is the whole stored rect, unclipped (`frameOutline`), across neighbouring frames. Fixed again: spec and overview now say the pin and jump follow the usual stored-rect rules and the unclipped outline can run across neighbouring frames. Closed 2026-11-27 by a fresh Opus closure review: every oversized-rect case checked against `pins.ts` and `canvasFrames.ts`; spec and overview agree.

### 11d/F-05 [P3] closed - No test covers the `error` return branch with a non-empty list

**File:** src/webview/hostMessageGuard.test.ts (comments:updated tests)
**Found:** 2026-11-27 by /audit (scope: current; lens: tests) (found by: breaker)
**Why it matters:** A mutant returning `comments: []` in the `error` branch of `parseCommentsUpdated` survives. Equivalent today (the host always posts `[]` with `error`), but the branch's pass-through is unpinned.
**Suggested fix:** In the pass-through test, also parse the same list with `error: 'x'` and assert the list and `error` come back.
**Resolution:** Fixed: the pass-through test also parses the list with `error: 'x'`. Probe (error branch returns `[]`) fails that test; source restored, `cmp` clean; `pnpm verify` 75 files, 926 tests. Closed 2026-11-27 by fresh Opus + Sonnet re-review: defect gone, no new problem.

### 11d/F-06 [P3] closed - Spec Behavior delta line left unwrapped by the F-04 rewrite

**File:** blueprint/context/current-feature.md (Data / contracts, "Behavior delta (accepted)")
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: quality) (found by: literalist)
**Why it matters:** One ~161-character line in a file wrapped at 100; the archive keeps it.
**Suggested fix:** Rewrap the paragraph.
**Resolution:** Fixed: the F-04 rewrite rewrapped the whole tail of the paragraph at 100. Closure review kept it open (one 113-character line remained). Fixed again: the whole Behavior delta paragraph is rewrapped at 100. Closed 2026-11-27 by a fresh Opus closure review: lines at most 100 characters, every claim checked against the code.

### 11d/F-07 [P3] closed - Spec does not record the audit-driven test assertion and audit skill edit

**File:** blueprint/context/current-feature.md (step 1 tests, Testing, Files / areas)
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: quality) (found by: literalist)
**Why it matters:** The F-05 `error` assertion and the F-02 audit skill edit shipped but the verified spec described neither, so spec and code drift in the archive.
**Suggested fix:** One clause for the `error` assertion in step 1 and Testing; list `.cursor/skills/audit/SKILL.md` in Files / areas.
**Resolution:** Fixed: step 1 and Testing name the `error` assertion (audit F-05); Files / areas lists the audit skill (audit F-02). The overview chart's "(11d, planned)" label is left for `/complete`'s polish, as the workflow defines. Closed 2026-11-27 by a fresh Opus closure review: spec matches the test and the skill edit.

### 11d/F-08 [P3] closed - Spec Testing bullet has a ragged line break

**File:** blueprint/context/current-feature.md (Testing)
**Found:** 2026-11-27 by /audit closure review (scope: current; lens: quality) (found by: breaker)
**Why it matters:** The F-07 edit left "…and the kept" on its own short line; the archive keeps it.
**Suggested fix:** Rewrap the bullet.
**Resolution:** Fixed: bullet rewrapped at 100. Closed 2026-11-27 by a fresh Opus closure review: lines at most 100 characters, every claim checked against the code.

### 11d/F-09 [P3] closed - Behavior delta names only `coordinate` as the create-path cap

**File:** blueprint/context/current-feature.md (Data / contracts, "Behavior delta (accepted)")
**Found:** 2026-11-27 by /audit closure review (scope: current; lens: quality) (found by: breaker)
**Why it matters:** `coordinate` caps only x and y; width and height are capped by `size` (`src/host/chromeMessages.ts:35,59`), and the huge-size case depends on it.
**Suggested fix:** "(`chromeMessages.ts` `coordinate` and `size`)".
**Resolution:** Fixed as suggested. Closed 2026-11-27 by a fresh Opus closure review: lines at most 100 characters, every claim checked against the code.

### 11d/F-10 [P3] closed - Behavior delta says the host's parse covers the flags

**File:** blueprint/context/current-feature.md (Data / contracts, "Behavior delta (accepted)")
**Found:** 2026-11-27 by /audit closure review (scope: current; lens: quality) (found by: breaker)
**Why it matters:** `stale` and `targetMissing` (the old `isFlag` checks) are computed by the host (`withCommentViews`), not parsed, so "the host's parse covers every dropped check" is imprecise.
**Suggested fix:** "The host covers every dropped check (its parse, plus `stale` and `targetMissing`, which it computes) except one:".
**Resolution:** Fixed as suggested. Closed 2026-11-27 by a fresh Opus closure review: lines at most 100 characters, every claim checked against the code.

## Gates

- Audit: dual review (Breaker Opus 5.5, Literalist Sonnet 5.5), no P0-P2; F-01..F-05 (P3) fixed and closed by a fresh Opus + Sonnet re-review, which raised F-06/F-07; two Opus closure rounds raised and closed F-08..F-10. All ten findings P3, all closed.
- Independent review: not selected (`when-sensitive`; the chrome parser is a drift guard, not a trust boundary; the only visible change is the oversized-rect edge Bombic accepted 2026-11-27).
- Verify: `pnpm verify` passed at /complete 2026-11-27 (75 files, 926 tests). Browser: `pnpm test:browser` 231 passed at the end of step 2. Probes A, B and the F-05 probe each failed their test; source restored, `cmp` clean.
- Try it now: skipped; no safe direct observation (only a hand-edited oversized rect differs).
