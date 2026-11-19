# Feature: Checked write + edit message

**From build-plan:** feature 9c
**Build attempt:** 1
**Branch:** feature/checked-write-edit-message
**Status:** verified

## Goal

Make the artboard HTML write safe for two writers, then give the panel a way to ask for one
Edit-mode change. `updateArtboard` reads, compares and writes under the cross-process workspace
lock, so two callers of `updateArtboard` (the Agent through MCP, the panel through the host) can
never both pass the same base. Every `canvas:updated` frame carries the exact content hash of
its disk HTML. A typed, guarded chrome → host message `artboard:edit` runs the 9b edit core
against that hash and gets exactly one answer: the new hash, generation and frame HTML, or a
refusal. Nothing in the chrome sends it yet (9e does).

Source of truth: Notion 0.4 Decisions (https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d),
read 2026-11-19 (content hash wording settled), and build-plan item 9c. Shipped code wins where
they differ (Notion callout). Two deliberate divergences: the edit parses before the lock and
lets `updateArtboard` re-check the same hash under it (see Notes), and the system map is updated
at `/complete` (it holds shipped flows only), not during the build.

## In scope

- `updateArtboard` (`src/disk/artboardFs.ts`): the HTML read, meta read, conflict compare and both
  writes run inside one `withWorkspaceLock` hold; the exact-case file name check is added before
  the lock. MCP `update_artboard` gets both through it. New Agent-visible outcome:
  `WORKSPACE_BUSY` from `update_artboard`. The tool description, the shipped Agent skill and the
  contract test say so.
- `hash` on every posted frame: `hashHtml` of the **disk** HTML, never the tagged copy. The
  chrome parses it (required) and keeps it on the frame record. Every existing frame fixture
  (unit and browser) gains it.
- Disk operation `editArtboard` (new `src/disk/artboardEditFs.ts`, imported directly, not
  re-exported): size check, hash check, shared cached parse, `editArtboardHtml`, then write
  through `updateArtboard` with `baseHash`. New domain error `EditRefusedError` owning its panel
  copy.
- Chrome → host `artboard:edit` and host → chrome `artboard:edited` types in `hostMessages.ts`;
  zod guard, attempt check, shared `claimedRequestId` and panel copy in `chromeMessages.ts`; host
  glue `answerEditRequest` (new `src/host/panelEdit.ts`); routing and the
  `setArtboardPanelOnEditRequest` setter in `openArtboardPanel.ts`; wiring in `extension.ts`.
- One answer per attempt with a usable `requestId`, posted with no awaited I/O after the write
  resolves. Refused in untrusted workspaces.
- Rule 02 (messages, lock sentence, `update_artboard` bullet), rule 05 catalog, `ponytail:`
  comments at the `updateArtboard` lock and in `workspaceLock.ts`.

## Out of scope

- Any chrome sender, Edit mode, inspector, live preview or adopting the answer (9d, 9e). The
  chrome does not parse `artboard:edited` yet; `parseHostMessage` keeps dropping it.
- The chrome's in-flight and stale-snapshot rules (Notes hand them to 9e).
- Undo/redo and the "last hash the extension wrote" history rule (9f).
- Locking `createArtboard` / `setActiveArtboard` (unchanged: `wx` create, manifest-only write).
- System map edits (shipped flows only; `/complete` merges this feature's flows).
- Classes, style blocks, border, per-side spacing (0.4 out of scope).

## Build loop

`workflow.stepReview` is `feature`: build all steps, run `pnpm verify` after each step, present
one review at the end. `workflow.checkpointCommits` is `disabled`: no commits until `/complete`.

## Build steps

- [x] **1. Lock the checked write.** In `updateArtboard`:
  - Before the lock (unchanged order, plus one call): arg validation, `assertLayoutDirsOwned`,
    `requireHtmlFile`, then `requireExactHtmlFileName(workspaceRoot, resolvedId)` (a case
    variant such as `HERO` for `hero.html` → `ArtboardNotFoundError`). Pre-lock checks keep a
    missing artboard from creating `.cursor-design/` through the lock's `mkdir`.
  - Inside one `withWorkspaceLock({ workspaceRoot, operation })`: `readUtf8IfExists` (undefined →
    `ArtboardNotFoundError`), `readStoredMeta`, `effectiveArtboardMeta`, `conflictFields`, both
    `writeUtf8` calls. Return value unchanged.
  - `ponytail:` at the lock: one global lock, 2 s wait then `WORKSPACE_BUSY`; writes that skip
    the lock (the Agent's direct file edit, an editor save) can still land between the compare
    and the rename and be overwritten. Update the `workspaceLock.ts` stale-age `ponytail:` (a
    hold is now also one artboard HTML + meta write, still far below 30 s).
  - `update_artboard` description adds: "WORKSPACE_BUSY when another Cursor Design write holds
    the lock: retry; after a crashed write it can last up to 30 s." `SKILL.md`: the
    `update_artboard` line and Edit workflow step 4 say the same (the error list entry for
    `WORKSPACE_BUSY` already exists; keep `agentSkill.test.ts` green).
  - Done when: a disk test runs two `updateArtboard` calls with the same `baseGeneration` through
    `Promise.allSettled` **without** `enqueueDiskOp`; exactly one is fulfilled, the other
    rejected with `ConflictError`, and the file holds the fulfilled one's HTML (fails on today's
    unlocked code); a disk test: `updateArtboard({ artboardId: 'HERO' })` on `hero.html` →
    `ArtboardNotFoundError`, `hero.html` and its meta byte-identical; a contract test with a
    fresh foreign `.cursor-design/.lock` gets `WORKSPACE_BUSY` from `update_artboard` and the
    artboard HTML and meta are unchanged; existing `update_artboard` tests pass; `pnpm verify`
    green.

- [x] **2. Hash on every posted frame.**
  - `CanvasViewFrame` gains `hash: string`, set in `readCanvasView`:
    `scannedFrame !== undefined && scannedFrame.errorMessage === undefined ? hashHtml(scannedFrame.html) : ''`
    (the same rule as `compareScannedHandoff`; never the stored meta hash, whose hex case is
    not normalized).
  - Extract the per-frame body of `panelFrames` into an exported
    `panelFrameHtml({ workspaceRoot, frameId, html, onTagError }): { html: string; errorMessage?: string }`
    (size cap on disk HTML, memo lookup and seed, tag; a tag failure reports once and returns
    the untagged copy, as today). `panelFrames` keeps its signature: for each frame it skips
    frames with an `errorMessage` or empty html as today, else spreads `panelFrameHtml`'s result
    over the frame, then prunes the memo.
  - `postedFrameFromSnapshot` copies `hash`. `PostedCanvasFrame` gains `hash: string`;
    `parsePostedFrame` requires `typeof entry.hash === 'string'` (an entry without one is dropped
    like any malformed frame, rule 04: no silent default). `StageFrame` gains `hash`
    (`newRecord` `''`, `mergeRecord` copies it). The too-large tile keeps the real hash.
  - Every existing fixture that builds a `CanvasViewFrame`, `PostedCanvasFrame` or `StageFrame`
    gets a `hash` (unit tests under `src/`, and under `tests/browser/`: `harness.ts`, every
    `*.spec.ts` that posts frames, `gallery/scene.ts`, `gallery/states/*`). Prefer one default
    in each existing local factory over per-literal edits.
  - Done when: a `canvasSnapshot` test shows the posted `hash` equals `hashHtml(diskHtml)` and
    differs from `hashHtml(postedHtml)` for a tagged frame; a `canvasView` test: an unreadable
    frame gets `''`, a stored meta with an upper-case hash still yields the lower-case
    `hashHtml`; two `panelFrameHtml` calls with the same disk HTML return the identical string;
    `hostMessages` tests: a frame with a `hash` keeps it, one without is dropped; `canvasFrames`
    test: merge copies `hash`; `pnpm verify` green; `pnpm test:browser` green (it is the proof
    that no chrome frame path dropped its frames).

- [x] **3. Disk `editArtboard`.** New `src/disk/artboardEditFs.ts`:
  `editArtboard({ workspaceRoot, artboardId, baseHash, edit }): Promise<{ artboardId; generation; hash; html }>`
  (`html` = disk HTML). Move `MAX_POSTED_ARTBOARD_HTML_CHARS` from `canvasSnapshot.ts` to
  `src/disk/layout.ts` (the host imports it from there). Order:
  1. `parseArtboardId`; `baseHash` must pass `isArtboardHash` (else `InvalidArgsError`).
  2. `assertLayoutDirsOwned`, `requireArtboardHtml` (throws `ArtboardNotFoundError`).
  3. `html.length > MAX_POSTED_ARTBOARD_HTML_CHARS` → `EditRefusedError('too-large')`, no parse
     (such a frame is a tile and has no numbers).
  4. `hashHtml(html) !== normalizeHash(baseHash)` → `ConflictError(artboardId, { expectedHash,
     actualHash })`, no parse.
  5. `cachedArtboardDocument({ workspaceRoot, frameId: artboardId, html })`, then
     `editArtboardHtml`. A refusal throws `EditRefusedError(refusal)`. A result over
     `MAX_POSTED_ARTBOARD_HTML_CHARS` throws `EditRefusedError('too-large')`, nothing written.
  6. Result identical to `html` → read `readStoredMeta`, return
     `{ generation: effectiveArtboardMeta(...).generation, hash: hashHtml(html), html }`, no
     write (no watcher echo, no meta bump).
  7. Else `updateArtboard({ workspaceRoot, artboardId, html: next, baseHash })`, which re-checks
     the hash under the lock (a write landing between step 2 and the lock → `ConflictError`).
     Return `{ artboardId, generation, hash }` from it plus `html: next`. Never wrap it in
     `withWorkspaceLock` (the lock is not re-entrant).
  - `edit` is built from `field`: `{ sourceNumber, field: 'text', value, liveText }` for text,
    `{ sourceNumber, field, value }` for a style field (the `ArtboardEdit` union).
  - `EditRefusedError` in `errors.ts`: `code = 'EDIT_REFUSED'`,
    `readonly reason: EditRefusal | 'too-large'` (`EditRefusal` imported as a type from
    `artboardEdit.ts`), message from a `Record` in `errors.ts` (the refusal rows of the copy
    table in Data / contracts; this is the only place those strings live).
  - Done when: unit tests over a temp workspace show: a font-size edit writes only that
    declaration (whole-file string compare), generation + 1, returned `hash === hashHtml(file)`;
    stale `baseHash` → `ConflictError`, file untouched; each `EditRefusal` kind surfaces as
    `EditRefusedError` with that `reason` (one table-driven test); a disk file over the cap and
    an edit whose result crosses the cap → `reason: 'too-large'`, file untouched; a same-value
    edit returns without writing (meta `updatedAt` and file mtime unchanged); unknown artboard
    → `ArtboardNotFoundError`; a file changed after the pre-read but before the lock →
    `ConflictError` and the outside bytes stay (test seam: `vi.mock('./commentViews')`
    partially, so `cachedArtboardDocument` rewrites the file with `writeFileSync` once before
    returning the real parse); `pnpm verify` green.

- [x] **4. The edit message.**
  - `hostMessages.ts`: `ArtboardEditMessage` (chrome → host) added to `ChromeMessage`;
    `ArtboardEditedMessage` (host → chrome) added to `HostMessage`. Shapes in Data / contracts.
  - `chromeMessages.ts`:
    - `artboardEditSchema` in `chromeMessageSchema`: `requestId` regex `REQUEST_ID_PATTERN`,
      `frameId` `z.string()`, `sourceNumber` `z.int().check(z.gte(0), z.lte(Number.MAX_SAFE_INTEGER))`,
      `hash` `z.string().check(z.refine(isArtboardHash))`, `field` `z.enum(EDIT_FIELDS)`,
      `value` `z.string().check(z.maxLength(MAX_EDIT_TEXT_CHARS))`, `liveText`
      `z.optional(...)` same cap; the cross-field rule (`liveText` present iff
      `field === 'text'`) as a `.check(z.refine(...))` on that object (the discriminated union
      keeps plain object members).
    - `isArtboardEditAttempt(value)` = `claimsType(value, 'artboard:edit')`.
    - `claimedRequestId(value)`: only `value.requestId` when it is a string matching
      `REQUEST_ID_PATTERN`, else undefined. `commentRequestId(value)` becomes
      `commentRequestType(value) === undefined ? undefined : claimedRequestId(value)`.
    - Exported copy constants `MALFORMED_EDIT_MESSAGE`, `EDIT_FALLBACK_MESSAGE`,
      `EDIT_CONFLICT_MESSAGE`, `EDIT_FRAME_GONE_MESSAGE` and `editRequestErrorMessage(error)`,
      checked in this order: `ConflictError` → conflict copy; `ArtboardNotFoundError` → frame-gone
      copy; `InvalidArgsError` or `InvalidArtboardIdError` → malformed copy; `EditRefusedError`,
      `LockTimeoutError`, `DiskError` → their own message; anything else (including
      `CorruptMetaError` and every other domain error, whose copy is written for the Agent) →
      fallback.
  - `src/host/panelEdit.ts`: `answerEditRequest({ value, outputChannel })`, never rejects,
    shaped like `answerCommentRequest` with a local `refuse(message, error)` helper:
    `claimedRequestId` undefined → log only (scope `panelEdit.answer`), no answer; untrusted →
    `UNTRUSTED_WORKSPACE_MESSAGE`; no folder → `NoWorkspaceError` message; parse fails or claims
    another type → `MALFORMED_EDIT_MESSAGE`; else `editArtboard(...)`, then
    `panelFrameHtml({ workspaceRoot, frameId, html, onTagError })` with `onTagError` logging
    through `logDiskError` (scope `panelEdit.sourceTags:<frameId>`), then post
    `artboard:edited` with that `html`. Any throw → log once, `ui:error` with
    `editRequestErrorMessage(error)`. No `await` between `editArtboard` resolving and the post;
    `ponytail:` there (see Notes).
  - `openArtboardPanel.ts`: `setArtboardPanelOnEditRequest(handler)`; in `onDidReceiveMessage`,
    `isArtboardEditAttempt` routes to it before the comment check (so a malformed edit is
    answered, never mistaken for a missing `artboard:ready`); `postAnswerToPanel` and the
    outbox's `postAnswer` accept `ArtboardEditedMessage` (never held, never replayed).
    `extension.ts` wires `answerEditRequest` like `answerCommentRequest`. Confirm
    `answerCommentRequest`'s exhaustive `switch` still compiles with the wider `ChromeMessage`.
  - Rule 02: message list gains `artboard:edit` / `artboard:edited` (same boundary sentence as
    comment requests: untrusted, `parseChromeMessage`, refused in untrusted workspaces, one
    answer per attempt with a valid `requestId`, never replayed), `canvas:updated` frames carry
    `hash`; the lock sentence covers `update_artboard`'s HTML + meta write; the
    `update_artboard` bullet says `baseGeneration` and/or `baseHash`. Rule 05: catalog entries
    for `editArtboard` (and why it is imported directly, not through `artboardFs.ts`),
    `EditRefusedError`, `panelFrameHtml`, `MAX_POSTED_ARTBOARD_HTML_CHARS` in `layout.ts`,
    `claimedRequestId`, `isArtboardEditAttempt`, `editRequestErrorMessage` and its constants,
    `answerEditRequest`, `setArtboardPanelOnEditRequest`.
  - Done when: `chromeMessages` tests accept a valid text and a valid style edit and reject:
    unknown field, text without `liveText`, style with `liveText`, `value` or `liveText` over
    `MAX_EDIT_TEXT_CHARS`, `sourceNumber` negative / fractional / over `MAX_SAFE_INTEGER`, a
    `hash` failing `isArtboardHash`, a bad `requestId`; `claimedRequestId` answers an
    `artboard:edit` and `commentRequestId` still ignores it; `editRequestErrorMessage` maps every
    row in its order (a `CorruptMetaError` → fallback); a `panelEdit` test (vscode mocked like
    `panelComments.test.ts`, disk mocked) shows one answer per attempt for success, conflict,
    refusal, malformed, untrusted, no folder, and none for a missing `requestId` (one log), with
    the call log `editArtboard` → `answer:artboard:edited` and the answer `html` equal to
    `panelFrameHtml`'s output; a `panelOutbox` test: an `artboard:edited` posted before
    `artboard:ready` is dropped; `pnpm verify` green.

- [x] **5. Close-out.** Re-read the rule 02 / 05 entries against the code, `SKILL.md` against the
  tool description; `pnpm verify` and `pnpm test:browser` once more. Optional F5 smoke (no lock
  claim; the contract test proves `WORKSPACE_BUSY`): in `fixtures/dev-workspace`, ask the Agent
  for two `update_artboard` edits; both land and the frame refreshes each time.
  - Done when: both commands green; the review states that the edit message is proven by unit
    tests only (no sender exists) and whether the F5 smoke ran.

- [x] **6. Audit follow-ups (2026-11-19).** F-136: pin `editArtboard`'s pre-parse size and hash
  guards with tests. F-134: reword the memo-prune test comment. Audit risk: `editArtboard` also
  calls `requireExactHtmlFileName` (after `assertLayoutDirsOwned`), so a case-variant id is
  `ArtboardNotFoundError` on the same-bytes path too. The answer-before-echo `ponytail:` names the
  lock release. The case-variant tests say they guard only on a case-insensitive disk (macOS,
  Windows); on Linux CI the file is simply not found.
  - Done when: removing the size check, the hash check or the exact-name check in `editArtboard`
    each fails one test; `pnpm verify` green.

- [x] **7. Refactoring review fixes (2026-11-19, Opus 5.5 + Sonnet 5.5 reviews).** `editArtboard`
  reads the file before the exact-name check (a missing artboards dir is `ArtboardNotFoundError`,
  not `DiskError`); one per-artboard hash rule `scannedHashes` in `canvasView.ts`, hashed once per
  `readCanvasView` and shared with `compareScannedHandoff`; one `PanelAnswer` type in
  `panelOutbox.ts`; `toArtboardEdit` refuses text without `liveText` as malformed instead of
  defaulting it; tests for a missing artboards dir and a malformed `baseHash`; comment cleanups.
  - Done when: the missing-dir test fails with the old check order; `pnpm verify` and
    `pnpm test:browser` green.

## Files / areas

- `src/disk/artboardFs.ts` (lock and name check in `updateArtboard`) + its test
- `src/disk/artboardEditFs.ts` (new) + `artboardEditFs.test.ts` (new)
- `src/disk/errors.ts` (`EditRefusedError`), `src/disk/layout.ts` (moved cap)
- `src/disk/canvasView.ts` (+ test): `hash` on `CanvasViewFrame`
- `src/disk/workspaceLock.ts` (comment only)
- `src/host/canvasSnapshot.ts` (+ test): `panelFrameHtml`, `hash` copy, cap import
- `src/host/chromeMessages.ts` (+ test), `src/host/panelEdit.ts` (new) + `panelEdit.test.ts`
- `src/host/panelOutbox.ts` (+ test), `src/host/panelComments.ts` (`commentRequestId` caller only
  if its import changes)
- `src/panel/openArtboardPanel.ts` (`setArtboardPanelOnEditRequest`, routing, answer union),
  `src/extension.ts`
- `src/webview/hostMessages.ts` (+ test), `src/webview/canvasFrames.ts` (+ test)
- Existing fixtures gaining `hash`: unit tests under `src/` that build frames (e.g.
  `canvasSnapshot`, `panelOutbox`, `panelComments`, `canvasView`, `canvasFrames`, `pins`,
  `commentsPanel`, `frameGesture`, `savedState`), and `tests/browser/` (`harness.ts`, the
  `*.spec.ts` that post frames, `gallery/scene.ts`, `gallery/states/*`)
- `src/mcp/artboardTools.ts` (description), `src/mcp/artboardTools.contract.test.ts`
- `skills/cursor-design/SKILL.md`
- `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`

## Data / contracts

**Chrome → host `artboard:edit`** (untrusted):

```ts
type ArtboardEditMessage = {
  type: 'artboard:edit';
  requestId: string;       // REQUEST_ID_PATTERN, same as comment requests
  frameId: string;         // artboard id; charset and exact file name enforced by the disk lib
  sourceNumber: number;    // integer, 0..Number.MAX_SAFE_INTEGER (9a data-cd-src N)
  hash: string;            // isArtboardHash: the frame's posted hash
  field: 'text' | 'font-size' | 'color' | 'padding' | 'margin';   // EDIT_FIELDS
  value: string;           // max MAX_EDIT_TEXT_CHARS (5000); the core applies the 200-char style cap
  liveText?: string;       // present iff field === 'text'; max MAX_EDIT_TEXT_CHARS
};
```

The guard checks shape and size only; text encoding, control characters, style value safety and
the live-text compare stay in `editArtboardHtml` (one owner).

**Host → chrome `artboard:edited`** (success answer):

```ts
type ArtboardEditedMessage = {
  type: 'artboard:edited';
  requestId: string;
  frameId: string;
  hash: string;        // hashHtml(new disk HTML)
  generation: number;  // meta generation after the write (unchanged on a no-op edit)
  html: string;        // panelFrameHtml(...).html of the new disk HTML: the echo's exact string
};
```

Failure answer: existing `ui:error { message, requestId }`. Exactly one answer per attempt that
has a valid `requestId`; none (one log line) without one. Never held before `artboard:ready`,
never replayed.

**`canvas:updated` frames**: `PostedCanvasFrame.hash: string` = `hashHtml` of the disk HTML as
read, `''` when the frame has no readable HTML.

**`updateArtboard`**: pre-lock checks (args, layout ownership, `requireHtmlFile`,
`requireExactHtmlFileName`), then one lock hold covering read → compare → HTML write → meta
write. Lock wait over 2 s → `LockTimeoutError` (`WORKSPACE_BUSY`), nothing written. Write order
and generation rule unchanged.

**Panel copy** (UI only; refusal rows live in `EditRefusedError`, the rest in `chromeMessages.ts`):

| Cause | Message |
|-------|---------|
| malformed message, `InvalidArgsError`, `InvalidArtboardIdError` | Could not save the edit. Try again. |
| `ConflictError` | This artboard changed on disk. Make the edit again. |
| `ArtboardNotFoundError` | This frame no longer exists. |
| refusal unknown-number / shared-number | This element cannot be edited here. Ask the Agent to change it. |
| refusal not-plain-text | This element contains other elements. Ask the Agent to change its text. |
| refusal text-changed | A script on the page changed this text. Ask the Agent to change it. |
| refusal invalid-value | That value cannot be saved. Check it and try again. |
| refusal unsupported-style | This element's style cannot be edited here. Ask the Agent to change it. |
| refusal too-large | This artboard is too large to edit here. Ask the Agent to change it. |
| `LockTimeoutError`, `DiskError` | their own message |
| anything else (incl. other domain errors) | Could not save the edit. Check the Output panel: Cursor Design. |
| untrusted workspace | `UNTRUSTED_WORKSPACE_MESSAGE` |
| no folder | `NoWorkspaceError` message |

Log scopes: `panelEdit.answer` (every refusal and throw, full error), `panelEdit.sourceTags:<id>`.

## Testing

Unit (Vitest, `pnpm test` inside `pnpm verify`): the tests named in each step's Done when.
Browser (`pnpm test:browser`, local): no new spec; the existing suite must stay green after its
fixtures gain `hash` (steps 2 and 5). The edit message has no live evidence in 9c (no sender);
one-answer-per-attempt and answer ordering are unit-proven only. The optional F5 smoke covers
only the Agent's `update_artboard` path.

## Notes for the AI

- The hash compare is exact content (`hashHtml`), never generation. `editArtboard` parses
  before taking the lock and lets `updateArtboard` re-check the same hash under it: equal hash
  means equal bytes, so the parse is of the locked content. Notion says "re-reads under the
  lock"; same guarantee, one lock owner.
- `withWorkspaceLock` is not re-entrant: nothing that calls `updateArtboard` may hold the lock.
- `artboardEditFs.ts` imports `updateArtboard` from `./artboardFs`; `artboardFs.ts` does not
  import it back (no cycle). Callers import `editArtboard` from `../disk/artboardEditFs`.
- Answer before echo: the answer is posted in the same microtask chain as `editArtboard`'s
  resolution (`panelFrameHtml` is synchronous); the watcher refresh needs a 200 ms timer after
  the fs event. `ponytail:` at the post naming both ceilings: (1) an HTML-then-meta write gap
  over 200 ms lets the echo arrive first; (2) a watcher refresh or a `frame:place` snapshot that
  read disk before this write can post the old `hash` / `generation` after the answer. Neither
  loses data; 9e handles both (below).
- Handed to 9e (chrome rules, not built here): at most one `artboard:edit` per frame in flight,
  and the next edit uses the answered `hash` (two quick commits with the same base would
  otherwise conflict with the user's own save); a `canvas:updated` frame whose `generation` is
  below the last answered one for that frame is a stale pre-write read and does not replace the
  adopted copy.
- `panelFrameHtml` seeds the tagged-copy memo, so the echo's `panelFrames` reuses the same string
  and the chrome sees identical `html`, `hash` and `generation`.
- `cachedArtboardDocument` is the comment flags' and source tags' shared parse (keyed by
  workspace, frame id and identical HTML): reuse it, never a second parse path.
- Agent-facing copy (`ConflictError`'s "Call read_artboard…", `CorruptMetaError`'s
  "set_artboard a new id") never reaches the panel: `editRequestErrorMessage` is an allowlist.
- The Agent skill change is a contract change (AGENTS.md): `agentSkill.test.ts` guards codes;
  the prose is on you.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":24819,"specSha256":"14fb9f8f43ce84492ba725d3cd54f2bd3762c5d4642caf1485e813e50dfa84d0","branch":"refs/heads/feature/checked-write-edit-message","head":"ec80ca5b24df79d3e8e0fe30912e2e8a326c817c","baseRef":"refs/heads/main","baseCommit":"ec80ca5b24df79d3e8e0fe30912e2e8a326c817c","sourceTree":"4a04d73274043d065b94888f824bc6879a3f58f9","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9c/F-134 [P3] closed - The memo reset comment says "this root" but panelFrames prunes every root

**File:** src/host/canvasSnapshot.test.ts
**Found:** 2026-11-19 by /audit re-review (scope: current; lens: quality)
**Why it matters:** The `beforeEach` comment says `panelFrames` with no frames "prunes every memo entry of this root", but the prune deletes every key not in the call, across all roots. Harmless (one workspace folder in practice), but the comment and the spec's "previous workspace" wording describe the semantics loosely. Also noted, not separate defects: the untrusted-path prune in `artboardDisk.ts` has no test (the file imports `vscode`; the semantics are covered by `panelFrames([])`), and the shared parse cache is not cleared on the untrusted path (bounded, stated in F-127's comment).
**Suggested fix:** Reword the comment to "prunes every memo entry".
**Resolution:** 2026-11-19 /implement (9c): comment reworded to "prunes every memo entry (every root's: the prune keeps only the keys posted)".
2026-11-19 /audit re-review (scope: 9c follow-ups; lens: quality, tests; fresh reviewer claude-sonnet-5-5): src/host/canvasSnapshot.test.ts was in the reviewed set. The reworded `beforeEach` comment now matches `panelFrames` (src/host/canvasSnapshot.ts:96-100), which deletes every memo key not in the call, across all roots. Original defect gone, no new one. `pnpm verify` passed (51 files, 650 tests). Closed.

### 9c/F-136 [P3] closed - editArtboard's pre-lock size and hash guards are not pinned by any test

**File:** src/disk/artboardEditFs.ts:46
**Found:** 2026-11-19 by /audit (scope: current; lens: all; fresh reviewer claude-opus-5-5)
**Why it matters:** Rule 09: a test earns its place when deleting its guard makes it fail. Two of `editArtboard`'s guards can be deleted with every test still green:
- The disk-size guard (line 46). The over-cap case runs `fontSize(0, '12')` on a `<p>` over the cap. Without the guard the parse runs, the edit makes the file longer, and the result-size guard (line 63) still throws `too-large`, so the test passes. The guard's job (no parse of a tile-sized file) is never observed. The over-cap seed also never asserts the file is untouched.
- The pre-parse hash check (line 51). The stale-hash test still passes without it because `updateArtboard` re-checks under the lock. But the same-bytes path (line 66) never reaches `updateArtboard`, so this check is its only guard. Without it, a same-value edit on a stale base would answer `artboard:edited` with the current hash and HTML. Its `sourceNumber` would have been resolved against bytes the chrome never saw. No test sends a stale base with a same-value edit.
**Suggested fix:** In the over-cap case, use an edit the core would refuse differently without the guard (for example `fontSize(9, '12')`, which gives `unknown-number`), and assert the file is unchanged. Add one case: a stale `baseHash` with an edit that returns the same bytes rejects with `ConflictError`.
**Resolution:** 2026-11-19 /implement (9c): the over-cap case now sends `fontSize(9, '12')` (unknown-number without the pre-parse size check) and asserts the file is unchanged; new test: a same-value edit on a stale base rejects with `ConflictError`. Removing either guard fails its test (checked).
2026-11-19 /audit re-review (scope: 9c follow-ups; lens: quality, tests; fresh reviewer claude-sonnet-5-5): src/disk/artboardEditFs.test.ts and artboardEditFs.ts were in the reviewed set. Deleted each guard in turn and ran `pnpm exec vp test src/disk/artboardEditFs.test.ts` (baseline 9 passed): without the pre-parse size check, "a file over the preview cap, or an edit that would cross it, is refused unwritten" fails; without the pre-parse hash check, "a same-value edit on a stale base is a conflict, not a success" fails; without the new `requireExactHtmlFileName` call, "a case variant id is ARTBOARD_NOT_FOUND, even for a same-value edit" fails (macOS case-insensitive disk; on Linux that one passes trivially, as its comment says). The file was restored byte-identical (sha1 da5d7387... before and after). The repair introduced no new defect: the exact-name check runs before the read, so a missing id is still ARTBOARD_NOT_FOUND (the "unknown artboard" test stays green), and `updateArtboard` re-running the same check on the write path costs one extra readdir, harmless. `pnpm verify` passed (51 files, 650 tests). Closed.
