# Fix: Backlog: small product fixes

**Type:** Fix
**Status:** verified
**Branch:** fix/backlog-small-product-fixes
**Fixes:** F-75, F-114 (remainder), F-139, F-141, F-142; ledger-only (already recorded): F-28, F-56
(remainder), F-57 (remainder)

## The problem

The open findings in `blueprint/context/findings.md` that need product code. Every entry was re-read
in full (Why it matters, Suggested fix, Resolution history) and checked against main `dfad478`; all
five still hold, none is already done. Line numbers below are from `dfad478`; find each site by its
content.

### In scope

| Id | Gap today (verified) |
|---|---|
| F-75 | `getComment` (`src/disk/comments.ts:347-349`) calls `commentsTextIfExists`, which reads all of `comments.json`, then `readCommentsFile` reads it again (`:350`). `readCommentsFile` already returns an empty file when `comments.json` is missing, and `findComment` then throws `CommentNotFoundError`, so the pre-check changes no outcome (an empty file still throws `CorruptCommentsError` inside `readCommentsFile`; a symlink still throws the same `DiskError` from `readUtf8IfExists`). `commentsTextIfExists` (`src/disk/commentsFile.ts:329-330`) is the same `readUtf8IfExists(workspaceLayoutFile(workspaceRoot, commentsPathSegments))` that `readCommentsFile` repeats inline (`:313`). The four writers' pre-checks (`comments.ts:164`, `:207`, `:239`, `:276`) are needed: they keep `.lock` from being created in a workspace with no comments file. |
| F-139 | `saveCommentUi` (`src/webview/hostBridge.svelte.ts:51-66`) strips `mode`, `commentDraft`, `openThreadId`, `replyDrafts` from the previous record but not the pre-9d `commentMode` key, so an old `commentMode: true` rides along in `...others` on every save. Behaviour is unaffected (`parseSavedCommentUi` ignores it; `savedState.test.ts:53` pins that). The spec that promised the drop is archived, so the code is the fix. |
| F-141 | `grep -n ponytail src/webview/Inspector.svelte` finds nothing. Missing: (1) the colour input (`:197-206`) has no clear: `<input type="color">` has no empty value, so an inline colour can never be removed from the inspector, although `''` already means clear in the edit rules (`src/disk/editValues.ts:52`); (2) the request-error live region (`:138`): a reload that empties the pick unmounts a focused field and focus falls to body (only leaving Edit mode moves focus to the stage viewport, `commentPicker.svelte.ts:142-147`); the region still announces the copy. |
| F-142 | A pick of another element ends an invalid draft with `NOT_SAVED_COPY` ("Not saved: the frame changed. Try again."), which names the wrong cause. Two paths reach it, both through `#settleDrafts` (`editState.svelte.ts:240`) → `draftFate` `'commit'` (`editDrafts.ts:203`) → `#commit(draft, { keepInvalid: false })` → `notSaved` (`:136`): **(a)** a refused commit (Enter / blur) kept the draft with `error` set and `previewed: false` after sending the baseline (`#commit`, `:132-133`), then the user picked another element; **(b)** the user typed an invalid value and clicked straight onto another element: the frame posts `cd:pick` before the field's blur (`system-map.md`, Edit drafts bullets), so the draft arrives with `error === undefined` and the user never saw its field error. Same for an invalid draft carried over a mode switch, on the next pick of another element. |
| F-114 (remainder, per its 2026-11-18 Resolution) | `CommentCard.svelte` couples two numbers: (a) `.actions` (`:384-389`) `margin: 0 calc(-1 * var(--cd-space-6)) calc(-1 * var(--cd-space-4))`. Only the **right** outdent re-types a Button number: the last button's label ends on the sm `Button`'s side padding (`Button.svelte:78` `padding: 0 var(--cd-space-6)`). The **left** does not: every `.actions` Button has an icon, so its left padding is `.size-sm.has-icon { padding-left: var(--cd-space-4) }` (4px); the 6px left outdent is that plus the glyph's inset in its box, a same-file choice. The bottom `-4px` is not a Button number either (a ghost Button has no vertical padding); it pulls the row into the card's own bottom inset and stays. (b) `.joined::before` (`:342-350`) `bottom: calc(-1 * var(--cd-space-10))` is the entry gap (`.thread, .replies` `gap: var(--cd-space-12)`, `:322-329`) minus the `--cd-space-2` inset the line keeps at its top; change the gap and the line misses the next avatar. |

### Ledger-only (already recorded; nothing to build)

Bombic's decisions (2026-11-20) are already written in `blueprint/context/findings.md`: F-28, F-56 and
F-57 are `accepted`, each with its reason and "user decision (Bombic, in the session that ran the
backlog fixes)". `/implement` and `/audit` leave these three entries exactly as they are (no status,
title or Resolution edit); `/complete` archives them with the rest of the ledger.

| Id | Recorded reason (for reference only) |
|---|---|
| F-28 | One runtime for the panel and the export; the picking code is inert in `canvas.html` (the export never sends `cd:mode`). |
| F-56 (remaining resize-staleness part) | Cosmetic and self-correcting on the next pick; a re-describe per resize step would run finder (up to 200 ms) per step. |
| F-57 (remaining `clampNumber` part) | One inert line in the exported `stageGeometry` global; no behaviour. |

### Out of scope

- Findings still `unverified` (F-16, F-25, F-90, F-125, F-133, F-135, F-137, F-144): a separate
  triage.
- Anything under `blueprint/history/` (archived specs are never rewritten).
- F-142's sibling: an Undo / Redo step ends open drafts too (`handleHistoryStep`), and an invalid
  draft still ends there silently (the step clears the `NOT_SAVED_COPY` it just set; the copy
  shows only when the step queue is full), whether or not its field error was showing. The
  decision covers a pick of another element only. Unchanged; marked `ponytail:` in fix 3.
- The four writers' pre-read in `comments.ts` (F-75): needed for the no-`.lock` rule; a cheaper
  existence check is a separate change.
- Other negative margins in the chrome (`Pins.svelte:153-154`, `CommentPopover.svelte:179`): not
  named by F-114.

## The fix

No new message, disk format, dependency or module. One new theme token. Every `.svelte` /
`.svelte.ts` edit follows rule 08: in Claude Code it goes to the `svelte-file-editor` agent,
`list-sections` then `get-documentation` for the matching sections first, `svelte-autofixer` on the
full file after every edit until clean.

### 1. F-75: `src/disk/comments.ts`, `src/disk/commentsFile.ts`

- `getComment`: delete the `commentsTextIfExists` pre-check (`:347-349`). A missing file still ends
  in `CommentNotFoundError` via `findComment` on the empty file.
- `commentsFile.ts`: `readCommentsFile`'s first line becomes
  `const text = await commentsTextIfExists(workspaceRoot);`. One owner of the `comments.json` read,
  used by `readCommentsFile` and the four writers' pre-checks; no inline copy left. Do not move
  `commentsTextIfExists` (an arrow const is only called at runtime); move it above
  `readCommentsFile` only if lint flags use-before-define.
- No new test: behaviour is unchanged, and the existing tests pin the outcomes
  (`comments.test.ts:547` `a no-file workspace has no lock file after a missing-comment read`, plus
  the `getComment` cases).

### 2. F-139: `src/webview/hostBridge.svelte.ts`

- Add `commentMode: _commentMode,` to the destructure in `saveCommentUi`.
- Update the comment above it: the previous record's `mode` (and the pre-9d `commentMode` key) is
  dropped first.
- Browser test in `tests/browser/editMode.spec.ts`, after `a tab switch keeps Edit mode; leaving it
  is saved too` (`:289`), e.g. `the first save drops the pre-9d commentMode key`:
  `openHarness(page, { state: { commentMode: true } })`, then
  `await expect.poll(async () => 'commentMode' in (await savedRecord(page))).toBe(false)` and
  `editButton` reads `aria-pressed="false"`. The comment-UI `$effect` saves on mount, so on current
  code the key stays and the poll fails.
- `blueprint/context/system-map.md` (Comment UI across a tab switch bullet, `:637-639`): one clause,
  `saveCommentUi` also drops the pre-9d `commentMode` key.

### 3. F-142: `src/webview/editDrafts.ts` (the rule), `src/webview/editRequests.ts`, `src/webview/editState.svelte.ts` (applies it)

User decision 2026-11-20 (revised by the lead the same day while the user was away, after
`/implement` proved the premise wrong; the user may override): **a pick of another element that
ends an invalid draft shows that field's own copy in the request-error region,
`FIELD_ERROR_COPY[verdict.error]`, never `NOT_SAVED_COPY`.** One rule for both ways a user gets
there:

- Enter / Tab first (the field error was already showing), or a click straight onto another
  element. In Chromium a click into an artboard frame blurs the field before the frame's `cd:pick`
  reaches the chrome (`/implement` probe: `change`, `focusout INPUT`, then `cd:pick`), so at pick
  time both paths look the same: the field has just committed and its error is set. The earlier
  plan (silent drop when the error shows, field copy when it never showed) cannot tell them apart,
  and a silent drop would lose a value the user typed with only a flash of its error.
- `ponytail:` on the rule: a user who already saw the field error sees the same copy once more in
  the request error. Upgrade path: track whether the field's blur went to an artboard iframe
  (`FocusEvent.relatedTarget`) and drop silently only when it did not.
- A valid or unchanged draft is unaffected (saves or ends as today). Undo / Redo is unchanged (out
  of scope; marked below).

Rule, `editDrafts.ts`:

- `draftFate` is unchanged: no `'abandon'` fate. An invalid draft on a pick of another element
  still returns `'commit'`; `#commit` re-validates it and names the cause.
- New export `invalidDraftCopy(error: FieldErrorKind, ending: 'pick' | 'step'): string`:
  `'pick'` returns `FIELD_ERROR_COPY[error]`; `'step'` returns `NOT_SAVED_COPY` (value import from
  `./editRequests`; `editRequests.ts` does not import `editDrafts.ts`, so no cycle). One-line why
  above it: a pick of another element ends the draft, so name the value's own cause, not a frame
  change. On the `'step'` branch a `ponytail:` comment (as shipped, corrected by step 4):
  `ponytail: the step that ends the draft clears this copy at once (enqueueStep), so an invalid
  draft ended by Undo / Redo ends silently; the copy shows only when the step queue is full.
  Upgrade: set the field copy after the step is enqueued.`
- Add `invalidDraftCopy` to the `editDrafts.ts` entry of the rule 08 owner catalog
  (`.claude/rules/08-svelte-chrome.md`; `.cursor/rules/` is a symlink to it).

Request state, `editRequests.ts`:

- `notSaved` takes the copy with the key in one object (rule 04: no third positional argument):
  `notSaved(state, { key, message = NOT_SAVED_COPY })`. Behaviour unchanged: a copy already showing
  wins. Update every call site in the same change.

Container, `editState.svelte.ts`:

- `#commit(draft, { keepInvalid })` becomes `#commit(draft, { ending })` with
  `ending: 'field' | 'pick' | 'step'`: `handleFieldCommit` passes `'field'`, `#settleDrafts`
  (`fate === 'commit'`) `'pick'`, `handleHistoryStep` `'step'`. On an `'invalid'` verdict, `'field'`
  keeps the draft with its error (as today); otherwise the draft ends and
  `this.requests = notSaved(this.requests, { key: draft.key, message: invalidDraftCopy(verdict.error, ending) })`.
  The revert to the baseline is sent first, as today. Remove any `'abandon'` code an earlier
  partial run added.
- Ordering already holds: `handlePick` runs `clearErrorOnPick` before `#settleDrafts`, so the new
  copy is set after the old copy is cleared, keyed to the draft's element; the next pick of another
  element clears it as usual.

Unit test, `src/webview/editDrafts.test.ts` (after `draft lifecycle…`):

- `an invalid draft ended by a pick names its own cause; a step returns the frame copy` (as shipped, corrected by step 4): for each
  `FieldErrorKind`, `invalidDraftCopy(kind, 'pick')` equals `FIELD_ERROR_COPY[kind]`;
  `invalidDraftCopy('invalid-length', 'step')` equals `NOT_SAVED_COPY`. Fails on current code (no
  such export). Remove the earlier `'abandon'` unit test if a partial run added it.

Browser tests, `tests/browser/editMode.spec.ts`, after `a dirty field, then a click on another
element, saves to the first element only`; import `FIELD_ERROR_COPY` from
`../../src/webview/editDrafts`:

- e.g. `an invalid value left by a click on another element names its own cause`:
  `openEditStage`, `enterEditMode`, `clickElement(page, '#padded')`;
  `field(page, 'Padding').fill('4 apples;')` with no Enter and no `.blur()`;
  `clickElement(page, '#title')`; wait until `field(page, 'Text')` has value `Title`; then:
  `inspector(page).locator('.request-error').getByText(FIELD_ERROR_COPY['invalid-length'])` is
  visible; `inspector(page).getByText(NOT_SAVED_COPY)` has count 0; `editsPosted` is empty;
  `await expect(await inFrame(page, '#padded')).toHaveAttribute('style', 'padding: 8px 16px')`.
  On current code `NOT_SAVED_COPY` shows.
- e.g. `a refused value, then a pick of another element, names its own cause`: as above but
  `.press('Enter')` after the fill and assert `FIELD_ERROR_COPY['invalid-length']` is visible
  before the `#title` click; after it, the same assertions. On current code `NOT_SAVED_COPY`
  shows.

`blueprint/context/system-map.md` (Edit drafts bullets): correct the pick-before-blur clause (in
Chromium the field blurs before the frame's `cd:pick` arrives), and one clause: a pick of another
element ends an invalid draft with its field's own copy in the request error.

### 4. F-141: `src/webview/Inspector.svelte` (comments only)

Why-only, no finding ids, each naming the ceiling and the upgrade path; wrap at the repo's line
width, text as given:

- Extend the HTML comment above the colour input (`:197`):
  `ponytail: a colour input has no empty value, so an inline colour cannot be cleared here. Upgrade:
  a Clear button that commits '' (already "clear" in the edit rules).`
- An HTML comment above the request-error region (`:138`):
  `ponytail: a reload that empties the pick unmounts a focused field and focus falls to body; this
  region still announces the copy. Upgrade: move focus to the stage viewport first, as leaving Edit
  mode does.`

### 5. F-114 remainder: `src/webview/ui/theme.css`, `src/webview/ui/Button.svelte`, `src/webview/CommentCard.svelte`

Smallest token decoupling under rule 08, no visual change:

- `theme.css` section 1, beside `--cd-control-h-sm`: `--cd-button-pad-sm: var(--cd-space-6);` (the
  sm Button's side padding, 6px as today).
- `Button.svelte` `.size-sm`: `padding: 0 var(--cd-button-pad-sm);` (`.size-sm.has-icon`'s
  `padding-left: var(--cd-space-4)` is unchanged).
- `CommentCard.svelte` `.actions`: only the right outdent reads the token; the left keeps its
  number, written out as the fourth value:
  `margin: 0 calc(-1 * var(--cd-button-pad-sm)) calc(-1 * var(--cd-space-4)) calc(-1 * var(--cd-space-6));`.
  Replace its comment with the truth, no alignment claim: the right outdent is the sm Button's side
  padding; the left 6px is a same-file number (the icon Button's 4px left padding plus its glyph's
  inset), not that token.
- `CommentCard.svelte` entry gap as a card-local custom property named `--card-entry-gap`: outside
  the `--cd-` namespace, so no `theme.css` token can ever share its name (the `theme.test.ts`
  token guard only reads `--cd-*`, so it neither checks nor blocks this name):
  `.thread { --card-entry-gap: var(--cd-space-12); }`, `.thread, .replies { gap: var(--card-entry-gap); }`
  (`.replies` is inside `.thread`, so it inherits), and
  `.joined::before { bottom: calc(var(--cd-space-2) - var(--card-entry-gap)); }` (-10px, as today;
  the line keeps the same `--cd-space-2` inset at both ends). Update its comment to say so, and say
  in one line where it is declared that it is card-local.
- No new guard: `theme.test.ts` already fails on an undeclared `--cd-*` token. No permanent test: a
  token swap that keeps every value is not logic (rule 03), and rule 09 bans pixel assertions.
  The no-visual-change proof is the one-time before / after measurement in step 3.

Must not break: every existing unit and browser assertion; `vp check` format, lint and type check;
`svelte-check --fail-on-warnings`; the `theme.test.ts` guard.

## Build steps

1. **Disk read (F-75).** Fix 1. Done when:
   - `grep -n commentsTextIfExists src/disk/comments.ts` shows only the import and the four writers;
   - `grep -n commentsPathSegments src/disk/commentsFile.ts` shows exactly three lines: the import,
     the `commentsTextIfExists` body, and `writeCommentsFile`'s path (the write keeps its use);
   - `pnpm verify` passes with Vitest at 731 (unchanged).
2. **Chrome state (F-139, F-142).** Fixes 2 and 3, the rule 08 catalog line, both system-map
   clauses. Done when:
   - `pnpm verify` passes with Vitest at **732** (731 + the one F-142 rule test);
   - `pnpm test:browser editMode` passes the three new tests;
   - seen failing once, then restored (not committed): the F-142 unit test and both F-142 browser
     tests with `invalidDraftCopy`'s `'pick'` branch returning `NOT_SAVED_COPY`; the F-139 browser test with
     `commentMode: _commentMode,` removed;
   - `svelte-autofixer` clean on `editState.svelte.ts` and `hostBridge.svelte.ts`.
3. **Comments and tokens (F-141, F-114).** Fixes 4 and 5. Done when:
   - before any CSS edit, a temporary Playwright spec (not committed, e.g.
     `tests/browser/tmp-card-measure.spec.ts`) records, in the panel card and in the pin thread of
     one comment with two replies: the `getBoundingClientRect()` of `.actions` and of each of its
     buttons, and `getComputedStyle(entry, '::before')` `top`, `bottom` and `height` for every
     `.joined` entry. Setup: copy `THREADED` and `openPinStage` from `tests/browser/pins.spec.ts`
     (around `:446`; they are local there), open the thread with the harness `openThread`, open the
     panel with the harness `panelToggle`. It writes the numbers to a JSON file in the session
     scratchpad; run again after the edits, it compares against that file and the numbers are
     identical; then the spec and the JSON are deleted;
   - `grep -n "ponytail" src/webview/Inspector.svelte` shows the two marks;
   - `svelte-autofixer` clean on `Inspector.svelte`, `Button.svelte` and `CommentCard.svelte`;
   - `pnpm verify` passes (Vitest 732) and `pnpm test:browser` reports **168 passed, 198 skipped**
     (baseline 165 / 198 on `dfad478`, recorded 2026-11-20; +1 F-139, +2 F-142).
4. **Repair F-155 (descriptions only).** The `'step'` branch of `invalidDraftCopy` returns
   `NOT_SAVED_COPY`, which `enqueueStep` clears at once; its `ponytail:`, the unit test title and the
   two notes (Out of scope here, overview) say so. Behaviour unchanged. Done when:
   - `grep -n ponytail src/webview/editDrafts.ts` shows the step mark naming the silent end and the
     full-queue case;
   - `pnpm verify` passes (Vitest 732).

## Verify

- `pnpm verify`: Vitest 732 tests.
- `pnpm test:browser` (local only): 168 passed, 198 skipped.
- Optional eyeball: `pnpm gallery`; the comment card and thread look unchanged (the measurement in
  step 3 is the gate).
- Manual, in the panel (F5 or the browser harness), Edit mode:
  - pick an element, type `4 apples;` in Padding, press Enter: the field error shows. Click another
    element: the banner names the field's cause (same copy as below), not "the frame changed".
  - pick an element, type `4 apples;` in Padding, click straight onto another element (no Enter):
    the banner reads "Not saved: use a number, a CSS length such as 1.5rem, or leave it empty.",
    not "the frame changed".
- Ledger: `/implement` marks F-75, F-114, F-139, F-141, F-142 `fixed`; F-28, F-56 and F-57 are
  already `accepted` in `findings.md` and stay untouched.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":19999,"specSha256":"dd2e22abc4491874b3d1afa9871db7acc9b012dc91b0034811b86747f0330a30","branch":"refs/heads/fix/backlog-small-product-fixes","head":"dfad478ce092b91a3a479aa4044d933a8be12890","baseRef":"refs/heads/main","baseCommit":"dfad478ce092b91a3a479aa4044d933a8be12890","sourceTree":"2c11907cd292073ae587e1b2f9cacf038e6ff5f8","landing":"local-merge","absentOptional":[]} -->

## Completion gates

- Verify: `pnpm verify` passed at completion (`vp check` clean over 202 files; agent rules check; `svelte-check`; Vitest 59 files, 732 tests; pack and webview build).
- Browser: `pnpm test:browser` reported 168 passed, 198 skipped at completion (main `dfad478`: 165 / 198).
- Audit: `/audit current` ran three times; the last pass was clean. F-75, F-114, F-139, F-141, F-142, F-155 and F-156 `closed`; F-28, F-56 and F-57 `accepted` (Bombic's decision 2026-11-20). No P0 or P1.
- Independent review: not selected (`when-sensitive`; small chrome and disk-read refactors, no auth, data, secrets, destructive operation, external effect or trust boundary).
- Check: `manual`, not requested.
- Try guide: `when-testable`; the F-142 copy is directly observable in Edit mode (below).
- Decision note: the F-142 rule (a pick of another element that ends an invalid draft shows the field's own copy, never `NOT_SAVED_COPY`) was revised by the lead on 2026-11-20 while the user was away, after `/implement` proved the earlier premise wrong (in Chromium the field blurs before the frame's `cd:pick` arrives, so "error already shown" and "clicked straight away" look the same at pick time). The user may override; the `ponytail:` on `invalidDraftCopy` names the `FocusEvent.relatedTarget` upgrade.

## Findings

### backlog-small-product-fixes/F-28 [P3] accepted - Exported canvas.html now ships the inert Comment-picking runtime

**File:** src/webview/frame/runtime.ts:120
**Found:** 2026-10-23 by /audit independent (scope: current; lens: quality, performance)
**Why it matters:** `runtime.ts` always calls `installCommentPicking(host)` and posts `cd:ready`. `handoffCanvasHtml.ts` embeds the same runtime via `?iife`, so every exported handoff frame now carries the pick listeners, hit-test and paint heuristics (the canvas snapshot grew by ~1.1k lines) although the export page never sends `cd:mode`, so the code stays inert. Harmless today, but it is dead weight in a handoff artifact the Agent reads.
**Suggested fix:** Either accept it (smallest; one runtime), or move the `installCommentPicking` call into the panel-only stamp path so the export bundles only height/wheel. No current requirement is lost either way.
**Resolution:** 2026-11-20 accepted: user decision (Bombic, in the session that ran the backlog fixes). One runtime for panel and export; the picking code is inert in canvas.html (the export never sends `cd:mode`), so a second runtime entry is not worth maintaining.

### backlog-small-product-fixes/F-56 [P3] accepted - The per-pick description cache never refreshes, so selector, text and styles can go stale

**File:** src/webview/frame/commentPicking.ts:113
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** F-41's repair keeps the description of each visited element until the next click or `cd:mode`. Scroll and resize re-posts reuse it (the spec requires that), but the chrome then pairs a fresh `rect` and `point` with old data: (1) the design script removes or rearranges the element: the cached selector stays non-null while `rect` is null and `:nth-of-type` indexes may point at a different element; (2) the user drags the frame's resize handle (still active in Comment mode until 8f1): media queries change `width`, `height`, `font-size`, `display` but the posted `styles` are from the old width; (3) ↑ then ↓ shows data captured at the first visit. The chrome and 8e never see that the data is old. Bounded by one click, and 8e's disk cross-check catches wrong selectors, but not wrong styles.
**Suggested fix:** Drop the cache on `resize` (`descriptions = new Map()` then `describeCurrent()` in the resize handler before `postPick`), and in `postPick` re-describe when `!current.isConnected` (gives `selector: null`). Needs the user's yes because the spec says resize re-posts never run finder.
**Resolution:** 2026-10-25 /implement (audit repair): partly: `postPick` describes a target again when the design removed it (`!isConnected`), so scroll and resize re-posts send `selector: null` with the null rect instead of a stale selector. Not changed: clearing the cache on `resize` would run finder (up to 200 ms) on every resize step of a frame drag-resize; style staleness after a resize stays until 8f1 makes resize inert in Comment mode. ↑ then ↓ reusing the first visit's data is the intended F-41 cache.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `commentPicking.ts` `postPick`: the disconnected-target re-describe is present and cheap (no finder for a disconnected element). The resize-staleness part is not repaired and has no recorded user acceptance; stays `fixed` (P3, does not block) until the user accepts that part or 8f1 makes resize inert.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests): the removed-target re-describe now runs only while the cached selector is non-null (fix/fewer-pick-re-posts-on-scroll). That keys on the wrong signal for a page pick whose `body` is replaced and for an element that never had a selector; see F-60. The resize-staleness part is unchanged; stays `fixed`.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): re-examined, stays `fixed`. The removed-target part holds (`postPick` re-describes once via the `removed` set, independent of the selector). The resize-staleness part is not repaired: the resize handle is still live in every mode (`Stage.svelte:386-405`, no mode gate) and the `resize` listener re-posts the cached description; no user acceptance is recorded.
2026-11-20 accepted: user decision (Bombic, in the session that ran the backlog fixes) for the remaining resize-staleness part. Cosmetic and self-correcting (any new pick re-describes); re-describing on every resize step would run finder (up to 200 ms) during a drag. The removed-target part stays repaired.

### backlog-small-product-fixes/F-57 [P3] accepted - Sink room duplicated in CSS, and clampNumber's export widens the canvas.html stageGeometry global

**File:** src/webview/App.svelte:398
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** (1) `SCROLL_SINK_ROOM` (`frameGesture.ts:276`, not exported) and the literal `10000px` in two `:global(body)` declarations are one number kept in two files; raise the constant and the centre can exceed the real scroll range, and nothing fails (rule 04: single source). (2) F-48's repair exports `clampNumber` from `stageGeometry.ts`. The runtime IIFE tree-shakes it to one line (correct), but the exported `canvas.html` also gains `stageGeometry.clampNumber` on its public global (snapshot line 3208), outside the spec's "diff may contain only runtime text". No behavior change.
**Suggested fix:** Export `SCROLL_SINK_ROOM` and set `--scroll-sink-room` on the root from App (or reference the constant in the comment and add a test that parses the two CSS literals). For (2), accept it, or move the clamp into a tiny `src/webview/frame/` helper that `stageGeometry.ts` imports.
**Resolution:** 2026-10-25 /implement (audit repair): `SCROLL_SINK_ROOM` is exported and `App.svelte` sizes the body from it via CSSOM (`calc(100% + ${SCROLL_SINK_ROOM}px)`, allowed by the nonce CSP); the CSS literal is gone. The `stageGeometry.clampNumber` global in the exported `canvas.html` is accepted (one inert line, no behaviour); the spec note about runtime-only snapshot text is superseded by this resolution.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): part (1) confirmed repaired (App.svelte sizes the body from the exported constant). Part (2) is described as "accepted" by /implement, which is not a user decision; stays `fixed` (P3, does not block) until the user accepts it or it is moved.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): re-examined, stays `fixed`. Part (1) holds (`canvasState.svelte.ts:239-242` sizes the body from the exported `SCROLL_SINK_ROOM`; no CSS literal). Part (2) is unchanged: the exported `canvas.html` still sets `exports.clampNumber` on the `stageGeometry` global (`handoffCanvasHtml.test.ts.snap:4604`); no user acceptance is recorded.
2026-11-20 accepted: user decision (Bombic, in the session that ran the backlog fixes) for part (2). One inert helper on the export's `stageGeometry` global, no behaviour; moving it is not worth the churn. Part (1) stays repaired.

### backlog-small-product-fixes/F-75 [P3] closed - getComment reads comments.json twice, and commentsTextIfExists forwards to readUtf8IfExists

**File:** src/disk/comments.ts:371 and :773
**Found:** 2026-10-26 by independent /audit (scope: current; lens: quality, performance)
**Why it matters:** `getComment` calls `commentsTextIfExists` (reads and discards the whole file) and then `readCommentsFile` (reads it again). `readCommentsFile` already returns an empty file when `comments.json` is missing, and `findComment` then throws `CommentNotFoundError`, so the pre-check changes no outcome in `getComment`, which takes no lock and creates nothing. The pre-check is needed in the writers only, to avoid creating `.lock` on a workspace with no comments file. `commentsTextIfExists` is itself a one-line forwarder (`readUtf8IfExists(workspaceLayoutFile(root, commentsPathSegments))`) that `readCommentsFile` repeats inline. Up to 500 comments of 2000 chars means a megabyte read twice per `get_comment`.
**Suggested fix:** Delete the pre-check in `getComment` and drop `commentsTextIfExists` in favour of calling `readUtf8IfExists(workspaceLayoutFile(...))` in the four writers (or keep one tiny helper used by `readCommentsFile` too). No behaviour is lost: a missing file still gives `COMMENT_NOT_FOUND`.
**Resolution:**
2026-11-20 /implement (fix/backlog-small-product-fixes): fixed. `getComment` drops the `commentsTextIfExists` pre-check; `readCommentsFile` reads through `commentsTextIfExists`, the one owner of the `comments.json` read, which the four writers' no-`.lock` pre-checks keep using.
2026-11-20 /audit current (fix/backlog-small-product-fixes, base main dfad478, uncommitted work, all lenses): closed. `getComment` has no pre-read: a missing file ends in `CommentNotFoundError` via `findComment` on the empty file, an empty file in `CorruptCommentsError`, a symlink in the same `DiskError` (one `readUtf8IfExists` path); it takes no lock. `readCommentsFile` reads through `commentsTextIfExists`, the only `comments.json` read; the four writers keep their pre-check before `withWorkspaceLock`, so a no-file workspace still gets no `.lock`. Verify: 732 passed.

### backlog-small-product-fixes/F-114 [P3] closed - Architecture polish from the critical review

**File:** several (ui/theme.css, Stage/Frame `--stage-zoom`, Frame lifted shadow, Button segment size, IconButton count label, TargetRef/Stage/Pins button resets, CommentCard layout numbers, `?? 0` number fallbacks, `frameSizeText` on tiles, guard exemptions, spec locator duplication, `STATUS_LABELS` twin)
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:**
- `[hidden]` is fixed four times.
- `--stage-zoom` sits outside the guarded namespace.
- `--cd-lh-xs` equals `--cd-lh-sm`.
- The lifted shadow and the kbd values are literals.
- `segment` ignores `size`.
- The IconButton count is only announced through its label (undocumented).
- Three bare-button resets.
- Layout numbers are coupled to other components.
- Silent `?? 0` hides number mismatches.
- A tile label keeps a stale height.
- An exempt selector exempts its whole rule.
- A meaning colour can pass through a local variable.
- Locators are re-declared across specs.
- The status words are written twice.

**Suggested fix:**
- One global `[hidden]` rule.
- `--cd-stage-zoom`.
- Merge the line heights.
- Tokens for the lifted shadow and kbd.
- `size?: never` on `segment`.
- Document the IconButton label contract.
- One global button reset.
- `calc()` from local tokens.
- Derive numbers where the full list is in hand.
- Gate the size on `kind === 'iframe'`.
- Exemptions list their allowed properties.
- Detect meaning colours through local variables.
- Shared locators in `harness.ts`.
- Derive pin label words from `statusBadge`.

**Resolution:**
2026-11-17 Batch A part: one global `[hidden]` rule and `button` reset, `--cd-stage-zoom`, `--cd-lh-xs` merged into `--cd-lh-sm`, `--cd-shadow-lifted` and kbd tokens, `segment` typed `size?: never`, the IconButton label contract documented, guard exemptions list their properties, meaning colours caught through local custom properties (fixtures for both), `frameSizeText` only for iframes, shared spec locators in `harness.ts`. The CommentCard layout numbers, `?? 0` fallbacks and the status-word twin are Batch B.
2026-11-17 Batch B part: TargetRef's button reset removed; the card's widget props gone (F-100); no `?? 0` numbers (`commentNumber` from the full list in `layoutPins` / `panelItems`, the thread takes its pin's number); `pinLabel` takes its status word from `statusBadge` (labels unchanged).
2026-11-18 /audit current (fresh reviewer, all lenses): re-examined; still open for one part: the layout numbers coupled to other components (`CommentCard.svelte` `.actions` negative margins mirror the ghost `Button` padding; `.joined::before` mirrors the entry gap). Confirmed done: one `[hidden]` rule and one `button` reset, `--cd-stage-zoom`, no `--cd-lh-xs`, lifted-shadow and kbd tokens, `segment` `size?: never`, IconButton label contract, no `?? 0` comment numbers, `frameSizeText` iframe-only, exemptions list their properties, meaning colours caught through local custom properties, shared locators in `harness.ts`, pin label words from `statusBadge`.
2026-11-20 /implement (fix/backlog-small-product-fixes): fixed (the remainder: CommentCard layout numbers). New `--cd-button-pad-sm` (the sm Button's side padding) read by `Button.svelte` and by CommentCard `.actions`' right outdent; the left 6px stays a commented same-file number. The entry gap is the card-local `--card-entry-gap`, read by `.thread, .replies` and the `.joined::before` line. A one-time before / after Playwright measurement (thread and panel card, `.actions` and its buttons' rects, every `.joined::before` top / bottom / height) was identical.
2026-11-20 /audit current (fix/backlog-small-product-fixes, base main dfad478, uncommitted work, all lenses): closed. Re-read: `--cd-button-pad-sm` is declared on `body` beside `--cd-control-h-sm` and read by `Button.svelte` `.size-sm` and CommentCard's right outdent (computed values unchanged: 6px, -10px bottom via `--cd-space-2 - 12px`); `.replies` is always inside `.thread`, so it inherits `--card-entry-gap`; the new comments state the truth (left 6px is a same-file number). `theme.test.ts` passes; `pnpm test:browser theme pins commentsPanel` passed.

### backlog-small-product-fixes/F-139 [P3] closed - saveCommentUi keeps a legacy commentMode key the spec says each save removes

**File:** src/webview/hostBridge.svelte.ts:55
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** The spec's Webview state contract (current-feature.md:170, and "Each save removes both `mode` and `commentMode` from the previous record first") is not what the code does: `saveCommentUi` destructures `mode`, `commentDraft`, `openThreadId`, `replyDrafts` out of the previous record but not `commentMode`, so an old `commentMode: true` key rides along in `...others` on every save forever. Behaviour is unaffected today (`parseSavedCommentUi` ignores the key and the spec itself calls it practically unreachable, since webview state does not survive a window reload), so this is contract drift, not a user-visible bug. The spec is the archived record of what shipped.
**Suggested fix:** Add `commentMode: _commentMode,` to the destructure in `saveCommentUi` (one line), or reword the spec's Webview state contract to say only `mode` is dropped. No current requirement is lost either way.
**Resolution:**
2026-11-20 /implement (fix/backlog-small-product-fixes): fixed. `saveCommentUi` also drops `commentMode`; browser test `the first save drops the pre-9d commentMode key` (failed with the drop removed).
2026-11-20 /audit current (fix/backlog-small-product-fixes, base main dfad478, uncommitted work, all lenses): closed. `saveCommentUi` drops `commentMode` with the other keys; spot-proved: with the line removed, `the first save drops the pre-9d commentMode key` fails; restored, it passes.

### backlog-small-product-fixes/F-141 [P3] closed - Two ponytail marks the 9e spec requires are missing from the code

**File:** src/webview/Inspector.svelte:178
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** The spec's Notes for the AI (current-feature.md:358-360) and step 5 (line 230) list five `ponytail:` marks to leave in code. Three are present (`editRequests.ts:8` one in flight and no timeout, `editValues.ts:46` the reference-whitespace edge). Two are not: "colour cannot clear" (the native `<input type="color">` has no empty value, so an inline colour can never be removed from the inspector) and "focus falls to the body when a reload that empties the pick unmounts a focused field; the live region still announces the copy". `grep -rn ponytail src/webview` finds neither. Rule 03 says a deliberate ceiling carries a `ponytail:` comment naming it and its upgrade path, so the next reader cannot tell these are known limits.
**Suggested fix:** Add one `ponytail:` comment beside the colour input in `Inspector.svelte` (no clear; upgrade: a Clear button that commits '') and one beside the request-error live region (focus falls to body on a reload that empties the pick; upgrade: move focus to the stage viewport as `CommentPicker`'s mode setter does). Comments only; no requirement lost.
**Resolution:** 2026-11-19 /audit independent (9e, fresh subagent claude-opus-5-5, target 5c8a33a): re-examined, still open. `grep -rn ponytail` over `Inspector.svelte`, `editState.svelte.ts`, `editInspector.ts` finds neither mark; only `editRequests.ts:8` and `editValues.ts:46` carry the spec's marks.
2026-11-20 /implement (fix/backlog-small-product-fixes): fixed. Both `ponytail:` marks are in `Inspector.svelte` (colour input with no clear; request-error region after a reload unmounts a focused field).
2026-11-20 /audit current (fix/backlog-small-product-fixes, base main dfad478, uncommitted work, all lenses): closed. Both marks present with ceiling and upgrade path; the colour-input mark matches `editValues.ts` ('' clears) and the focus mark matches `commentPicker.svelte.ts` (only leaving Edit mode moves focus to the viewport).

### backlog-small-product-fixes/F-142 [P3] closed - An abandoned invalid draft reports "the frame changed" when the user picks another element

**File:** src/webview/editState.svelte.ts:118
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** An invalid commit on Enter or blur keeps the draft with its field error (spec lifecycle "Invalid"). If the user then clicks another element, `#settleDrafts` commits that draft with `keepInvalid: false`, which drops it and sets the request error to `NOT_SAVED_COPY` ("Not saved: the frame changed. Try again."). Nothing about the frame changed: the value was refused by the chrome's own rule, and the field error explaining that is now gone with the old pick. The same happens to an invalid draft left over from a mode switch, on the next pick of another element. No data is lost (nothing was ever sendable), but the copy points the user at the wrong cause. The spec's lifecycle table does not say which copy a pick-change commit of an invalid draft should show.
**Suggested fix:** Drop an invalid draft silently on a pick-change commit (its field error already told the user it was not saved), or show the draft's own `FIELD_ERROR_COPY` as the request error instead of `NOT_SAVED_COPY`. One branch in `#commit`; add the case to the browser "dirty field then click another element" test. No current requirement lost.
**Resolution:** 2026-11-19 /audit independent (9e, fresh subagent claude-opus-5-5, target 5c8a33a): re-examined, still open. `#settleDrafts` (editState.svelte.ts:166) -> `#commit(draft, { keepInvalid: false })` -> `notSaved` (line 118) still sets `NOT_SAVED_COPY` for a draft the chrome itself refused. Same path for an invalid draft carried over a mode switch: App routes every `cd:pick` to `handlePick`, so the first Comment-mode pick of another element drops it with the same copy, shown on the next Edit entry.
2026-11-20 /implement (fix/backlog-small-product-fixes): fixed. A pick of another element that ends an invalid draft shows the field's own copy (`invalidDraftCopy(error, 'pick')` = `FIELD_ERROR_COPY[error]`) in the request error, never `NOT_SAVED_COPY`; Undo / Redo keeps `NOT_SAVED_COPY` (`ponytail:`). In Chromium the field blurs before the frame's `cd:pick` arrives, so the click-away and Enter-first paths look the same at pick time (`ponytail:` on the rule). Unit test plus two browser tests, all failing with the pick branch returning `NOT_SAVED_COPY`.
2026-11-20 /audit current (fix/backlog-small-product-fixes, base main dfad478, uncommitted work, all lenses): closed. `#settleDrafts` passes `ending: 'pick'`, `#commit` sets `invalidDraftCopy(verdict.error, 'pick')` = `FIELD_ERROR_COPY[error]` after the baseline revert; `handlePick` clears the old copy first. Every `notSaved` call site moved to the object form. Spot-proved: with the pick branch returning `NOT_SAVED_COPY`, the unit test and both browser tests fail; restored, all pass. The `'step'` branch's claim is wrong (F-155), a separate defect in pre-existing behaviour that does not reopen this one.

### backlog-small-product-fixes/F-155 [P3] closed - The Undo / Redo branch of invalidDraftCopy names a copy that the same handler clears

**File:** src/webview/editDrafts.ts:216
**Found:** 2026-11-20 by /audit (scope: current; lens: quality, tests)
**Why it matters:** `handleHistoryStep` (`editState.svelte.ts:199-202`) runs `#commit(draft, { ending: 'step' })`, which sets `invalidDraftCopy(error, 'step')` = `NOT_SAVED_COPY` through `notSaved`, then at once `enqueueStep`, which sets `error: undefined` (`editRequests.ts:73-87`, pinned by `editRequests.test.ts` `enqueueStep clears the copy`). So an invalid draft ended by Undo / Redo ends silently (preview reverted, no copy); the copy shows only when `MAX_HISTORY_STEPS` steps already wait and the step is ignored. The `ponytail:` comment on the `'step'` branch ("still ends an invalid draft with the frame-changed copy"), the unit test title "a step keeps the frame copy" and the spec's Out of scope note describe a copy the user does not see. Behaviour is unchanged from main; the new comment states it wrongly.
**Suggested fix:** Correct the comment to the truth (a step clears the copy, so an invalid draft ends silently; upgrade: set the field copy after `enqueueStep`), and either keep the `'step'` value only for the full-queue case or drop the `ending` argument from `invalidDraftCopy` if the step path should not set a copy at all. No current requirement lost.
**Resolution:** 2026-11-20 /implement (fix/backlog-small-product-fixes): fixed. Behaviour unchanged (decision: descriptions only). The `ponytail:` on the `'step'` branch now says the step clears the copy so an invalid draft ended by Undo / Redo ends silently (copy shows only with a full step queue; upgrade: set the field copy after `enqueueStep`); the unit test title and the spec's two notes match. The `ending` parameter stays: dropping it touches `editState.svelte.ts` and the test for no gain.

2026-11-20 /audit current (fix/backlog-small-product-fixes, base main dfad478, uncommitted work, all lenses): closed. The new `ponytail:` (`editDrafts.ts:216-218`) holds against the code: `handleHistoryStep` (`editState.svelte.ts:194-203`) runs `#commit(..., { ending: 'step' })`, whose `notSaved` sets `NOT_SAVED_COPY` only when no copy shows, then `enqueueStep` (`editRequests.ts:76-86`) sets `error: undefined` unless `MAX_HISTORY_STEPS` (20) steps already wait, in which case it returns the state unchanged and the copy stays; `#pump`/`nextSend` drop an unsendable step silently and set no copy for it. So the end is silent except with a full queue, as stated. The test title `a step returns the frame copy` is literally what `invalidDraftCopy('invalid-length', 'step')` asserts. Behaviour is identical to main (`keepInvalid: false` → `notSaved` → `enqueueStep`). The spec's Out of scope note (`current-feature.md:44-46`) and the overview (`:45-46`, `:72`) match. The fix-3 section's stale e.g. text is a separate, description-only leftover (F-156). `pnpm verify` passes (Vitest 732).

### backlog-small-product-fixes/F-156 [P3] closed - The spec's fix-3 section still prescribes the old step ponytail and test title

**File:** blueprint/context/current-feature.md:115
**Found:** 2026-11-20 by /audit (scope: current; lens: quality)
**Why it matters:** The F-155 repair corrected the code, the test title, the Out of scope note and the overview, but fix 3's instructions still give the old texts as the example: `:115-117` "ponytail: an Undo / Redo step still ends an invalid draft with the frame-changed copy, not its own cause. Upgrade: use the field copy here too." and `:142` the title "a step keeps the frame copy". This spec is archived under `blueprint/history/` at `/complete` and never rewritten, so a later reader of fix 3 gets the false claim F-155 removed (step 4 supersedes it, but nothing in fix 3 says so). Code is unaffected.
**Suggested fix:** In fix 3, replace the two e.g. texts with the shipped ones (or add "superseded by step 4" beside them). Description-only; no current requirement lost.
**Resolution:** 2026-11-20 /implement (lead, description-only): fix 3 in `current-feature.md` now quotes the shipped step ponytail and the shipped unit-test title, each marked "as shipped, corrected by step 4".
2026-11-20 /audit current (re-review, all lenses): closed. `current-feature.md:115-118` quotes the `'step'` ponytail word for word as `src/webview/editDrafts.ts:216-218`, and `:140` quotes the title exactly as `src/webview/editDrafts.test.ts:212`; both carry the "as shipped, corrected by step 4" marker. The old texts survive only inside the F-155 / F-156 history. No code file changed since the F-155 re-review (last source write 15:39:34). `pnpm verify` passes (Vitest 732).

## Try it now

In the panel (F5 with `fixtures/dev-workspace`, or the browser harness), Edit mode, on an artboard with a padded element:

1. Pick the padded element, type `4 apples;` in Padding, press Enter (the field error shows), then click another element.
2. Pick it again, type `4 apples;` in Padding, and click straight onto another element (no Enter).

- Expected (both): the inspector's request error reads "Not saved: use a number, a CSS length such as 1.5rem, or leave it empty."; the first element's padding is unchanged and nothing is saved to disk.
- Incorrect: "Not saved: the frame changed. Try again." shows (reopens F-142), the banner is empty, or the invalid value reaches the artboard.
