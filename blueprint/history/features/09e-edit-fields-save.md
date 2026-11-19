# Feature: Edit fields + save

**From build-plan:** feature 9e
**Build attempt:** 1
**Branch:** feature/edit-fields-save
**Status:** verified (pnpm verify 695 unit, test:browser 158, gallery 198 incl. contrast; F5 not run)

## Goal

Make the 9d inspector live. In Edit mode the user changes text, font size, colour, padding or
margin in native fields, sees the change in the frame as they type, and the change is saved to
the artboard file on commit through the shipped 9c `artboard:edit` path. After a save the chrome
adopts the answered HTML, hash and generation without reloading the frame (scroll, focus and
page state kept), and the watcher echo changes nothing. A refused save reloads the frame and says
why. An outside change reloads as today; an edit it interrupts is not saved and says so.

Source: build-plan 9e; Notion 0.4 Decisions (Text, Units, Saves on commit, No frame reload after
your own edit, Agent conflicts, style values only from chrome inputs); the 9c and 9d archives'
"handed to 9e" notes (one edit in flight, next edit uses the answered hash, stale pre-write
refresh, `style: null` ambiguity, re-describe before sending `liveText`).

## In scope

- Shared, parse5-free value rules in `src/disk/editValues.ts` (the core's style-value
  normalizer, text normalizer and text refusal check, moved), used by the edit core (unchanged
  behaviour) and by the chrome.
- Frame runtime: `cd:edit-apply` (live preview of one element's text or whole style attribute)
  and `cd:pick-refresh` (re-describe the current pick), Edit mode only; after an apply the
  current pick is refreshed (selector reused) and re-posted.
- `edit.style` tells "no attribute" (`''`) from "over `MAX_PICK_STYLE_CHARS`" (`null`); an
  over-cap style shows a hint instead of the style fields.
- Inspector fields enabled: text (textarea), font size, padding, margin (text inputs), colour
  (native `<input type="color">`, no alpha). Preview on every input; commit rules per field.
- Drafts keyed to the element they started on, with one lifecycle table (commit, revert, end).
- Commit rules in the chrome: unchanged = nothing sent (preview reverted); invalid = inline
  error, nothing sent, preview reverted; valid and changed = queued save.
- One `artboard:edit` in flight per panel; later commits wait and are sent with the answered
  hash; a refusal drops the waiting ones; every dropped or interrupted edit says "Not saved".
- Adopt `artboard:edited` without a frame reload; the watcher echo and stale pre-write
  `canvas:updated` posts change nothing; `ui:error` for an edit reloads that frame (with the
  latest adopted HTML) and shows the copy.
- Parse `artboard:edited` in `parseHostMessage` (typed since 9c, never parsed).
- A pick's announcement `sequence` advances only on new picks, not re-posts.

## Out of scope

- Undo / redo, edit history, Cmd+Z (9f). Escape in a field does not revert: blur always
  commits a valid change; undo arrives in 9f.
- Clearing the colour (the native picker has no empty value). Alpha, per-side spacing, border,
  classes, style blocks, mixed-content text (0.4 out-of-scope list).
- Any host, disk-core, MCP or Agent-skill behaviour change: 9c's host side is used as shipped.
  The `editValues.ts` move is a pure refactor of the core.
- F-137 (double parse on a text edit): measured in the F5 check only.
- 0.4.1 (mode switch opens the matching panel). 9g's verification items (export, Agent conflict
  on a real frame, `.vsix` smoke).

## Build loop

`workflow.stepReview: feature`: build all steps, then present the whole feature for review.
`workflow.checkpointCommits: disabled`: no per-step commits; `/complete` makes the feature
commit. After each step run its named checks; after the last, `pnpm verify` and
`pnpm test:browser`. Every `.svelte` / `.svelte.ts` edit runs `svelte-autofixer` until clean
(rule 08). `qualityGates.regular.independentReview: when-sensitive`: this feature makes the
chrome choose which element of a persisted artboard file a write targets, so treat it as
sensitive and run the independent review before `/complete`.

## Build steps

1. [x] **Shared edit values.** Create `src/disk/editValues.ts` (no parse5, no DOM; its field
   type comes from `EDIT_STYLE_FIELDS` in `layout.ts`, never from `artboardEdit.ts`). Move from
   `artboardEdit.ts`, with the constants they use (`COLOR_VALUE`, `LENGTH_VALUE`,
   `BARE_NUMBER`, `ASCII_WHITESPACE_RUNS`, `NEWLINES`, `LONE_SURROGATE`, the control-character
   rule):
   - `styleValue` as exported `normalizeStyleValue(field, value)`: same rules, same `''` = clear
     / `undefined` = refused contract, same comment.
   - `normalizeEditText(value)` = `asciiTrim(value.replaceAll(NEWLINES, ' '))`, the expression
     `editText` uses today.
   - `isRefusedEditText(text)` = over `MAX_EDIT_TEXT_CHARS`, `hasRefusedControl` or a lone
     surrogate, on the normalized text: exactly the check `editText` runs today.
   - New `previewText({ liveText, value })` = `liveText`'s leading ASCII whitespace +
     `normalizeEditText(value)` + its trailing ASCII whitespace (`leadingWhitespaceLength` /
     `trailingWhitespaceLength` as `spliceText` uses them; all-whitespace text is all leading).
     `ponytail:` edge whitespace written as a reference (`&#32;Hi`) is whitespace in the DOM but
     not in the source span, so the next text save after such a preview reads `text-changed`.
   `artboardEdit.ts` imports these and keeps everything else; `StyleField` stays exported from
   it as an alias if callers need it.
   **Done when:** `artboardEdit.test.ts` passes unchanged; a colocated `editValues.test.ts`
   covers: bare numbers get px outside parentheses only, `calc(1 + 2)` untouched, unbalanced or
   `/*` refused, `#AbCdEf` kept, `rgb(...)` colour refused, collapse and trim, `''` clears;
   `isRefusedEditText` on a tab (allowed), `\u0001`, a lone surrogate, the cap;
   `previewText` on `'  Hi\n'` with `'a\nb'` → `'  a b\n'`, on `''`, on all-whitespace text;
   `pnpm verify` green.

2. [x] **Frame: preview and refresh messages.** In `frameMessages.ts` add chrome → frame
   `cd:edit-apply` and `cd:pick-refresh` (Data / contracts) to `ChromeFrameMessage` and
   `parseChromeFrameMessage`. In `editTarget.ts`, `style` is `''` when the attribute is absent
   and `null` only over `MAX_PICK_STYLE_CHARS` (update the `PickEditFields` comment and
   `parsePickEdit`). In `commentPicking.ts`:
   - `postPick({ force, repost })`: `force` skips the unchanged check, `repost` is the posted
     flag. Callers: click and step `{ force: true, repost: false }`; scroll / resize re-post
     `{ force: false, repost: true }`; refresh `{ force: true, repost: true }`.
   - `refreshCurrent()`: for the current path element `path.at(-1)`, replace its cached
     description with a fresh one that reuses the cached `selector` (never calls
     `buildSelector`) and recomputes `tagName`, `text`, `styles` and `edit`
     (`describeEditTarget` of its edit target: `body` for a root, else itself).
   - `cd:pick-refresh` (Edit mode only): `refreshCurrent()`, then
     `postPick({ force: true, repost: true })`; no pick = nothing.
   - `cd:edit-apply` (Edit mode only): `querySelectorAll('[data-cd-src="N"]')` (N validated);
     exactly one match, else ignore. `text`: only when the element is not in
     `RAW_TEXT_ELEMENTS` / `VOID_ELEMENTS` and has no child nodes or exactly one `Text` child,
     by `textContent =`. `style`: `setAttribute('style', value)`. Then, when the current pick's
     edit target is that element, `refreshCurrent()` and schedule the rAF re-post
     (`repostRects`).
   - Reword the runtime's "never writes to the design DOM" comments to "writes only through
     `cd:edit-apply`, in Edit mode". In `runtime.test.ts`, narrow the `setAttribute` ban to
     exactly one `setAttribute(` occurrence in the runtime string; every other forbidden
     mutator stays forbidden.
   - In `commentPick.ts` `applyPickMessage`, `sequence` advances only for `repost: false`.
   Keep the runtime small: the `runtime.ts?iife` string grows at most 1,500 characters
   (measure its length before and after).
   **Done when:** unit tests for both guards (bad number, negative, non-integer, both or
   neither of `text` / `style`, over-cap strings, extra keys ignored), for `style` `''` vs
   `null`, and for `sequence` on a re-post (unchanged) vs a click (advances) pass;
   `runtime.test.ts` passes with the narrowed guard; a browser test in `editMode.spec.ts` posts
   `cd:edit-apply` from the chrome to the edit fixture and sees the element's text and style
   change and a `cd:pick` re-post with `repost: true` and the new `edit.text` / `edit.style`;
   the same message in Comment mode changes nothing; a page pick (`body`) refreshes too; the
   runtime growth is recorded in the review handoff.

3. [x] **Chrome frame records: adopt without reload.** In `canvasFrames.ts`, `FrameRecord`
   gains `documentHtml` (the HTML the iframe was built from), `documentVersion` (bumped on
   every reload) and `replacedHashes: string[]` (hashes replaced by adopted answers since the
   last real change); `newRecord` starts them `''`, `0`, `[]`. `html` stays the latest known
   tagged copy. Rules:
   - `mergeRecord` reloads exactly as today (tile → iframe, or `entry.html !== record.html`),
     now setting `documentHtml = entry.html` and bumping `documentVersion` when it does.
   - Stale pre-write skip: an iframe entry (no `errorMessage`) whose `hash` is in
     `replacedHashes` and whose `generation < record.generation` keeps the record's `html`,
     `hash`, `generation`, `documentHtml`, `documentVersion` (placement fields still merge).
     An entry with `hash === record.hash` merges as today and keeps `replacedHashes`. Any other
     entry is a real change: merges as today and clears `replacedHashes`.
   - `adoptEditAnswer({ record, answer, baseHash })`: when `record.kind === 'iframe'` and
     `record.hash === baseHash`, set `html`, `hash`, `generation` from the answer and append
     `baseHash` to `replacedHashes`; `documentHtml` / `documentVersion` unchanged (no reload).
     Otherwise unchanged (a newer post already won, or the echo came first).
   - `reloadFrame(record)`: an iframe only; `documentHtml = record.html`, `documentVersion + 1`.
   `Frame.svelte` takes `documentHtml` and `documentVersion` instead of `html` (Stage passes
   them); its blob effect reads both through the existing `$derived` pattern, so adopting an
   answer never re-runs it. `parseHostMessage` parses `artboard:edited` (Data / contracts).
   `CanvasState` gains `adoptEditAnswer(answer, baseHash)` and `reloadFrame(frameId)`; the
   toolbar `generation` comes from the active frame's merged record (so a skipped stale post
   cannot move it back), falling back to the message when that frame has no record.
   **Done when:** `canvasFrames.test.ts` covers: adopt (matching base, mismatched base, tile,
   missing frame); echo after adopt (no version bump); stale entry after adopt skipped; stale
   entry after adopt and echo still skipped; two adopts then a late stale entry with the first
   base skipped; a stale entry with `errorMessage` merges as today; a different entry clears
   `replacedHashes` and reloads; adopt then `reloadFrame` gives `documentHtml === answer.html`
   and one bump; `hostMessages.test.ts` covers `artboard:edited` accepted and each bad field
   rejected; a browser test posts `artboard:edited` then the identical echo `canvas:updated`
   and `loadsOf` is unchanged, while a different `canvas:updated` still reloads.

4. [x] **Edit requests: one in flight.** New pure `src/webview/editRequests.ts` with its test,
   and container `src/webview/editState.svelte.ts` (`EditState`, created in `App.svelte` after
   `CanvasState` and `CommentPicker`). An edit key is `{ frameId, sourceNumber, documentVersion
   }`, taken when a draft starts (step 5), never at commit. Rules:
   - `enqueueEdit(state, { key, field, value, liveText? })` appends.
   - `nextSend({ state, frames, newRequestId })` (the id is injected; `EditState` passes
     `crypto.randomUUID()`): when nothing is in flight, loops over the head: a head whose frame
     is gone, is a tile, or whose `documentVersion` differs from its key's is dropped and the
     request error becomes `NOT_SAVED_COPY`; the first valid head becomes the in-flight
     `artboard:edit` with the frame's current `hash` (remembered as the request's base hash).
     `ponytail:` no timeout: an answer that never arrives (a dropped post) blocks later saves
     until the webview reloads.
   - `answerEdit(state, message)`: only for the in-flight `requestId` (and, for
     `artboard:edited`, the same `frameId`). `artboard:edited` → `CanvasState.adoptEditAnswer`
     with the base hash, then send next. `ui:error` → the request error is the message
     (host allowlist copy; a refusal's copy wins over `NOT_SAVED_COPY` from the same event),
     every waiting commit is dropped, and each frame that had the in-flight or a dropped commit
     is reloaded with `reloadFrame`.
   - The request error clears on the next commit, or on a new pick (`repost: false`) whose
     `(frameId, sourceNumber)` differs from the failed edit's key. An empty pick never clears
     it. It lives in `EditState`, so it survives a mode switch and shows on the next Edit
     entry.
   - `NOT_SAVED_COPY` = "Not saved: the frame changed. Try again." (one constant, beside the
     rules).
   `hostBridge.svelte.ts` gains `postEditRequest` (the only sender). `App.svelte` routes
   `artboard:edited` and `ui:error` to `EditState` (request ids are UUIDs; the comment
   handlers ignore ids they did not send).
   **Done when:** `editRequests.test.ts` covers: two commits → one send, the second sent after
   the answer with the answered hash; a refusal drops the queue, keeps its copy and names the
   frames to reload; an answer with an unknown `requestId` or a different `frameId` ignored; a
   commit whose frame reloaded between draft start and send dropped with `NOT_SAVED_COPY` and
   the next head still sent in the same call; a commit for a removed or tile frame dropped;
   error clearing (other element clears, same element and empty pick do not); `pnpm verify`
   green.

5. [x] **Inspector fields: drafts, preview, commit.** Rules in `editInspector.ts` (tests in
   `editInspector.test.ts`), view in `Inspector.svelte`, draft state in `EditState`.
   Focusing the text or a style field sends `cd:pick-refresh`. A field shows its draft while it
   has one, else the pick's value (so preview re-posts never overwrite typing).

   | Event | Draft |
   |---|---|
   | First `input` in a field | Starts: the edit key from the current pick and its frame record, the field, and the baseline (`liveText` = the pick's raw `edit.text`, never the trimmed field value or the 200-char excerpt; `style` = the pick's `edit.style`). A refresh answer arriving after this does not change the baseline (accepted race: the refresh is sent on focus, a human types later). |
   | `input` | Preview to the draft's key: text → `cd:edit-apply {text: previewText(...)}`; style field → `normalizeStyleValue`, then `''` → `removeStyleProperty(baseline, field)`, a value → `setStyleProperty({ styleText: baseline, property, value })`. A refused value, an `undefined` result or a result over `MAX_PICK_STYLE_CHARS` previews nothing (the last preview stays). |
   | Commit: Enter or Shift+Enter (not while `isComposing`; `preventDefault`, so no newline is typed) or blur, for text, font size, padding, margin; `change` only, for colour | Unchanged (below) → if a preview was sent, `cd:edit-apply` with the baseline; draft ends, nothing sent. Invalid (below) → field error, baseline preview, draft stays. Otherwise enqueue with the draft's key; draft ends. |
   | A new pick (`repost: false`) of a different element (`frameId` or `sourceNumber`) | The open draft commits as above, against its own key (blur may come before or after; whichever is second finds no draft). |
   | The draft frame's `documentVersion` changes, the frame leaves or turns into a tile, or the pick is cleared by that frame's `cd:ready` | Draft ends, nothing sent, request error `NOT_SAVED_COPY` (unless a refusal copy from the same event). |
   | A refreshed pick of the draft's element is not editable (no number, shared number) | Draft ends, baseline preview, `NOT_SAVED_COPY`. |
   | Mode change | `CommentPicker`'s one mode setter moves focus out of the inspector first, so blur commits; keep that order. |

   - Unchanged: text when `normalizeEditText(draft) === normalizeEditText(liveText)`; a style
     field when `normalizeStyleValue` of the draft equals that of the baseline's
     `inlineValue` (an `undefined` baseline counts as changed); colour compared lowercase.
   - Invalid: a style value `normalizeStyleValue` refuses → "Not saved: use a number, a CSS
     length such as 1.5rem, or leave it empty."; an `undefined` `setStyleProperty` result or a
     result over `MAX_PICK_STYLE_CHARS` → "Not saved: this element's style is too complex to
     edit here. Ask the Agent."; text where `isRefusedEditText(normalizeEditText(draft))` →
     "Not saved: the text has control characters. Remove them and try again."
   - The textarea's `maxlength` = `MAX_EDIT_TEXT_CHARS` − the baseline's edge whitespace
     length.
   - `edit.style === null` → no style fields; hint "This element's style attribute is too long
     to edit here: ask the Agent." (the text field still shows when plain).
   - Fields enabled only in the editable view (not-editable, mixed-content and empty views as
     in 9d). Colour value always `#rrggbb`.
   - Errors: a field error is `aria-invalid` plus `aria-describedby` to a `Message tone="error"`
     under the field, cleared on that field's next input; the request error is a
     `Message tone="error"` at the top of the inspector body inside an `aria-live="polite"`
     region, shown in every inspector view. `ponytail:` a reload that empties the pick unmounts
     a focused field and focus falls to the body; the live region still announces the copy.
   - Keys: typing C or Escape in a field never changes the mode (`modeKeyAction`'s
     `inTextEntry`, shipped; prove it).
   **Done when:** rule tests pass (draft vs pick display; unchanged sends nothing and reverts a
   preview; `16` vs inline `16px` unchanged; `#ABCDEF` vs `#abcdef` unchanged; newline-only text
   change unchanged; invalid value, open style, over-cap style and control-character errors;
   preview strings for set, clear and shorthand-drops-longhands; maxlength; every lifecycle
   row); browser tests in `editMode.spec.ts`: typing in Text previews in the frame and blur
   posts one `artboard:edit` with raw `liveText` and the record's `hash`; Enter commits font
   size and focus stays; colour `change` posts `#rrggbb`; invalid padding shows the error,
   posts nothing and restores the frame; a newline-only text change sends nothing, then a real
   text edit posts and is adopted; `artboard:edited` adopted with `loadsOf` unchanged and the
   field showing the normalized value; `ui:error` with the request id reloads the frame once,
   with the earlier adopted edit still in it, and shows the copy; two quick commits post one,
   then the second with the answered hash; a dirty field then a click on another element posts
   the edit for the first element only; a `canvas:updated` with new html while a field is dirty
   posts nothing and shows `NOT_SAVED_COPY`; C typed in a field stays in Edit mode; after
   `pnpm verify`, `grep -c parse5 dist/webview/chrome.js` is `0` (it is `0` on main); svelte-autofixer clean.

6. [x] **Docs, gallery, gates.** Rule 02 (`cd:edit-apply`, `cd:pick-refresh`, `edit.style`
   `''` vs `null`, the chrome sender of `artboard:edit`), rule 05 owner catalog (`editValues.ts`,
   `editRequests.ts`, `EditState`, `postEditRequest`, `adoptEditAnswer` / `reloadFrame`,
   `documentHtml` / `documentVersion` / `replacedHashes`, the picking entry's "writes only
   through `cd:edit-apply`"), the comments in `Inspector.svelte`, `App.svelte` (the 9c "never
   parsed" note) and `panelEdit.ts`'s ponytail ("9e handles both" → where). Gallery: inspector
   with enabled fields, a field error, the request error, the over-cap style hint, both themes.
   Patch the Notion 0.4 page where the build diverged on purpose (over-cap style hint, colour
   cannot be cleared, Escape does not revert) per the code-over-Notion rule. The system map is
   updated at `/complete`, from the shipped code.
   **Done when:** `pnpm verify` green, `pnpm test:browser` green, `pnpm gallery` states render
   with contrast passing, and the F5 checks under Testing are run or listed as not run.

## Files / areas

- New: `src/disk/editValues.ts` (+ test), `src/webview/editRequests.ts` (+ test),
  `src/webview/editState.svelte.ts`.
- Changed: `src/disk/artboardEdit.ts` (moves and imports only),
  `src/webview/frame/frameMessages.ts`, `src/webview/frame/editTarget.ts`,
  `src/webview/frame/commentPicking.ts`, `src/webview/frame/runtime.ts` (comments),
  `src/webview/frame/runtime.test.ts` (narrowed guard), `src/webview/commentPick.ts`
  (`sequence`), `src/webview/canvasFrames.ts`, `src/webview/canvasState.svelte.ts`,
  `src/webview/Frame.svelte`, `src/webview/Stage.svelte` (Frame props),
  `src/webview/hostMessages.ts`, `src/webview/hostBridge.svelte.ts`,
  `src/webview/editInspector.ts`, `src/webview/Inspector.svelte`, `src/webview/App.svelte`, their
  tests, `tests/browser/editMode.spec.ts`, `tests/browser/harness.ts` (helpers only if needed),
  gallery states, `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`,
  `src/host/panelEdit.ts` (comment only).
- Not touched: host and disk write paths, MCP, Agent skill, `sourceTags.ts`.

## Data / contracts

- **`cd:edit-apply`** (chrome → frame, new): `{ type: 'cd:edit-apply', sourceNumber, text }` or
  `{ type: 'cd:edit-apply', sourceNumber, style }`. `sourceNumber`: safe non-negative integer.
  Exactly one of `text` (string, at most `MAX_EDIT_TEXT_CHARS`) or `style` (string, at most
  `MAX_PICK_STYLE_CHARS`). `text` is the element's whole new text node data; `style` the whole
  new style attribute value. Accepted only from the captured parent, only in Edit mode. Display
  only: nothing reaches disk from it.
- **`cd:pick-refresh`** (chrome → frame, new): `{ type: 'cd:pick-refresh' }`. The frame
  refreshes its current pick and posts `cd:pick` with `repost: true`; no pick = nothing.
- **`cd:pick`**: `edit.style` is `''` when the element has no style attribute (was `null`) and
  `null` only over `MAX_PICK_STYLE_CHARS`; otherwise unchanged. The chrome's pick `sequence`
  advances only for `repost: false`.
- **`artboard:edit`** (chrome → host, shipped 9c, first sender): `requestId` from
  `crypto.randomUUID()`; `frameId` / `sourceNumber` from the draft's key; `hash` = the frame
  record's `hash` at send time; `value` = the field's raw draft (the host normalizes);
  `liveText` iff text = the draft's baseline raw `edit.text`.
- **`artboard:edited`** (host → chrome, shipped 9c, now parsed): `{ requestId, frameId, hash,
  generation, html }` with the same guards `parsePostedFrame` uses (`typeof string` for
  `requestId`, `frameId`, `hash`, `html`; `isFiniteNumber` for `generation`). Malformed →
  dropped.
- **`ui:error { message, requestId }`** for an edit: `message` is host allowlist copy
  (`editRequestErrorMessage`), rendered as text.
- **`FrameRecord`** (chrome memory only; nothing persisted, nothing in the webview saved
  state): `+ documentHtml: string`, `+ documentVersion: number`, `+ replacedHashes: string[]`.
- Ordering (from 9c): the answer is posted before the 200 ms watcher echo. Echo first (write
  plus lock release over 200 ms): the frame reloads with the new HTML, the answer is a no-op
  (`record.hash !== baseHash`), and a commit still waiting is dropped with `NOT_SAVED_COPY`;
  no saved data lost (the existing `panelEdit.ts` ponytail).

## Testing

- Unit (`pnpm test`): `editValues.test.ts`, `editRequests.test.ts`, additions to
  `canvasFrames.test.ts`, `hostMessages.test.ts`, `frameMessages.test.ts`,
  `commentPick.test.ts`, `editInspector.test.ts`, `runtime.test.ts`; `artboardEdit.test.ts`
  unchanged and green.
- Browser (`pnpm test:browser`, local): the `editMode.spec.ts` cases named in steps 2, 3 and 5,
  driven through the harness's posted-message log and `postToChrome` (the host is simulated:
  these prove the chrome and frame only; the conflict copy path is proven here with a
  simulated `ui:error` and by 9c's host tests).
- F5 (Cursor only, manual, `fixtures/dev-workspace`): edit each of the five fields on a real
  frame and `git diff` the artboard file after each (only that text node or declaration
  changed); colour: drag the picker, the frame previews, release saves once (no save while the
  picker is open); scroll inside a frame, save, the scroll position stays; with a field dirty,
  save a change to the artboard file in the editor: the frame reloads, "Not saved: the frame
  changed. Try again." shows, and the file holds only the editor's change; time one text edit
  on a large artboard for F-137. Report which were run.
- No claim of Agent-conflict-on-real-frame, export or `.vsix` evidence (9g).

## Build deviations (implement)

- Step 2: the runtime's `cd:edit-apply` keeps the plain-children check but not the
  `RAW_TEXT_ELEMENTS` / `VOID_ELEMENTS` check: the two tag sets pushed the runtime over
  `RUNTIME_SIZE_BUDGET`, and the chrome never sends text for those elements (`inspectorView` gives
  them no text field; script / style / title / textarea carry no number). Comment in
  `commentPicking.ts`.
- Step 2: runtime growth is 2,327 characters (32,533 → 34,860), over this spec's 1,500 target but
  under the shipped gate `RUNTIME_SIZE_BUDGET` (35,135) that `runtime.test.ts` enforces.
- Step 2: `describeElement` split into `describeContent` (everything but the selector) so the
  refresh reuses the cached selector; `describeElement` keeps its signature.
- Step 1: `StyleField` is owned by `editValues.ts` and re-exported from `artboardEdit.ts` so
  `artboardEdit.test.ts` stays unchanged.

## Notes for the AI

- Never import `artboardEdit.ts` or `sourceTags.ts` from `src/webview/**` (parse5).
  `inlineStyle.ts`, `editValues.ts` and `layout.ts` are parse5-free.
- The host stays the authority: chrome validation only decides whether to send and what to show.
  Style values sent come only from inspector inputs, never from frame data; the frame's
  `edit.style` is only the preview baseline.
- A commit targets the draft's key, never the current pick: the pick can move before the blur
  arrives (the frame posts `cd:pick` before it takes focus).
- The preview style uses the core's own `setStyleProperty` / `removeStyleProperty` over the
  live (decoded) attribute, so the re-posted `edit.style` shows the typed value, not a CSSOM
  re-serialization. Never use `element.style` in the runtime.
- Blur-commit on a mode change relies on `CommentPicker`'s mode setter moving focus out of the
  inspector before it unmounts; keep it.
- A tab switch (webview reload) loses drafts and any in-flight answer, like comment requests
  (`postAnswer` never replays); the reload's `canvas:updated` shows what was written.
- `ponytail:` marks to leave in code: one in flight per panel, not per frame (the simplest form
  of the 9c rule); no request timeout; colour cannot clear; `previewText`'s reference-whitespace
  edge; focus falling to the body when a reload unmounts a focused field.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":27644,"specSha256":"e63150a3bd07134f65ce51a97ce56472347b64aba38f1d5a9848c8384b2be41b","branch":"refs/heads/feature/edit-fields-save","head":"5c8a33abbb631a3b96536a826096b686b0da63e6","baseRef":"refs/heads/main","baseCommit":"9ba29bfaa6251aaab57870c0f344b4ad59146fca","sourceTree":"392435ed61a1a2aaaf2f17f16c981d84e81930cd","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9e/F-09 [P3] accepted - Blueprint manifest still hashes the replaced adapter copies

**File:** blueprint/.state/manifest.json:6
**Found:** 2026-10-12 by /audit (scope: current; lens: quality)
**Why it matters:** Commit f4c9edd replaced the `.agents/skills` and `.claude/skills` trees with symlinks into `.cursor/skills`, but the tracked manifest still lists both adapter paths as separate managed files with their old hashes. 28 entries no longer match (all 23 `.claude/skills` entries, plus `.agents/skills` complete, doctor, feature, fix, rollback). `/doctor` reports this manifest, and a Blueprint update that writes each adapter path in turn would write through both symlinks into the same `.cursor` file, so the last adapter written wins.
**Suggested fix:** Record the symlink layout as an intended local customization (for example a note in `AGENTS.md` or the doctor skill telling update tooling to target `.cursor` once), or refresh the manifest through the Blueprint updater rather than by hand. No product code change.
**Resolution:** Accepted 2026-11-19 with the 1.16.1 upgrade. The single `.cursor` tree plus symlinks is deliberate (AGENTS.md: Agent files), so the official updater is never run here; upgrades are a manual three-way merge that regenerates the manifest from pristine template hashes. The remaining drift (local customizations in complete, blueprint-doctor, feature, fix, and the `.claude` flavor's `disable-model-invocation` line) is expected and is the merge base for the next upgrade.

## Independent review

**Status:** passed
**Target commit:** 5c8a33abbb631a3b96536a826096b686b0da63e6
**Base commit:** 9ba29bfaa6251aaab57870c0f344b4ad59146fca
**Base ref:** main
**Spec hash:** e63150a3bd07134f65ce51a97ce56472347b64aba38f1d5a9848c8384b2be41b
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-19T20:06:26Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-19T20:10:57Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `9ba29bfaa6251aaab57870c0f344b4ad59146fca..5c8a33abbb631a3b96536a826096b686b0da63e6` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `pnpm verify`: pass (54 test files, 695 tests; svelte-check, webview-tests tsc, pack and webview build green)
- `grep -c parse5 dist/webview/chrome.js`: pass (0)
- `pnpm test:browser`: fail on first run (157 passed, 1 failed, 198 skipped): `commentsPanel.spec.ts:765` jump flash outline still present at its 3 s timeout under full-suite load; the 9e `editMode.spec.ts` cases all passed
- `npx playwright test -c tests/browser commentsPanel.spec.ts:765` (three reruns): pass 3/3

## Evidence

- Freshness: HEAD = target; `git merge-base main <target>` = base; spec SHA-256 matches; only `blueprint/context/review.md` and `blueprint/context/findings.md` differ from the target.
- Reviewed the full delta (37 files): `src/disk/editValues.ts` is a pure move of the core's value rules (`artboardEdit.test.ts` unchanged and green); frame `cd:edit-apply` / `cd:pick-refresh` are parsed (`parseEditApply`: safe non-negative integer, exactly one of text/style, capped), accepted only from the captured parent and only in Edit mode, and match one `[data-cd-src="N"]` element (integer-only selector, no injection); the runtime's one `setAttribute(` is pinned by `runtime.test.ts`.
- Chrome save path: the draft key (frame, source number, document version) is fixed at the first input; `nextSend` drops heads whose frame left, became a tile or reloaded, and sends with the record's hash at send time; `answerEdit` matches only the in-flight request id (and frame for `artboard:edited`); a refusal clears the queue and reloads affected frames from the latest adopted copy; `adoptEditAnswer` adopts only while `record.hash === baseHash`, so an echo-first race degrades to a reload plus "Not saved" with no data loss.
- `isStalePreWrite` skips only an iframe post whose hash an adopted save replaced and whose generation is older; an outside revert at the same generation still merges (traced against `canvasView.ts:223`, see F-143 for the missing test).
- Security: values sent to the host come only from inspector inputs (`value` raw draft) plus the frame-reported `liveText` and source number, which the host re-checks against the disk hash and the edit core (9c, unchanged); frame data reaches the chrome DOM only as field values and text; `postEditRequest` is the only sender.
- Spec deviations recorded in the spec (runtime growth 2,327 chars vs the 1,500 target, under `RUNTIME_SIZE_BUDGET`; no raw-text/void tag check in the runtime) are display-only and acceptable: the chrome never sends text for those elements and the frame accepts the message only from its parent.

## Findings

- F-143 [P3] open: the stale pre-write skip's generation guard has no test that fails without it (src/webview/canvasFrames.ts:87)
- F-144 [P3] unverified: a style preview re-reads the picked element's innerText on every keystroke (src/webview/frame/commentPicking.ts:159)
- F-141 [P3] open (re-examined, unchanged): two spec-required ponytail marks missing
- F-142 [P3] open (re-examined, unchanged): an abandoned invalid draft reports "the frame changed"
- No P0 or P1 finding is open or fixed.

## Remaining risk

- `pnpm test:browser` full run had one failure outside the 9e delta (`commentsPanel.spec.ts:765`, flash-outline timeout); it passed 3/3 in isolation, so it reads as load-dependent flakiness, not a 9e regression, but the full suite was not re-run green.
- F5 (Cursor-only) checks from the spec's Testing section were not run by this reviewer: real-frame saves with `git diff`, colour picker drag then single save, scroll kept across a save, editor change while a field is dirty, F-137 timing.
- `pnpm gallery` (contrast for the new inspector states) not run by this reviewer.
- The Notion 0.4 page patch (step 6) could not be verified: no network.
