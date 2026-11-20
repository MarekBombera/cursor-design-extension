# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-16 [P3] unverified - Extension Host never proved the new module load or CSP

**File:** src/panel/artboardChromeHtml.ts:206
**Found:** 2026-10-21 by /audit (scope: current; lens: tests)
**Why it matters:** Unit tests cover the shell HTML (nonce, `asWebviewUri` stubs, `#svelte-root`, module-after-inline). Verify built `dist/webview/chrome.js` (22 kB) + `chrome.css` with no `eval` / `new Function`. The compiled Svelte runtime assigns a static template via `template.innerHTML` (not user HTML). Spec Testing and step 4 done-when still require F5: hello root present, zero CSP violations, 0.2 parity, and a missing-bundle failure path. Implement recorded F5 not run. Without that, a webview CSP or `type=module` miss would not have been caught.
**Suggested fix:** Run F5 against `fixtures/dev-workspace` as the spec Testing section lists. Record the hello marker, CSP console, 0.2 toolbar/zoom/pan/edit, and the deleted-`chrome.js` path. No product change unless F5 fails.
**Resolution:**
2026-10-22 /audit (scope: current; 8c) user-reported F5 in `fixtures/dev-workspace` (B1-B13 plus retests, not re-run by this audit) reports no CSP errors in the webview console, with zoom tracking, drag/resize persistence and watcher updates working. That covers the module-load, CSP console and 0.2 parity parts of this lead. Still unproven: the deleted-`chrome.js` failure path. Stays `unverified` (never gates `/complete`); close it when that one path is exercised.

### F-25 [P3] unverified - First pick may not be announced by the chip live region

**File:** src/webview/Toolbar.svelte:40
**Found:** 2026-10-23 by /audit (scope: current; lens: quality, security, performance, tests)
**Why it matters:** The chip is `aria-live="polite"` but also `hidden` until the first pick. On that pick it becomes visible and gets its text in the same update, and screen readers often skip a live region that just entered the accessibility tree. Later picks change the text of a visible region and should be announced. No screen-reader run backs this up yet.
**Suggested fix:** Check with VoiceOver in F5 first. If the first pick is silent, keep the region in the tree with empty text (drop `hidden`, and hide the empty chip visually with `.chip:empty { padding: 0 }` rather than `display: none`).
**Resolution:**

### F-28 [P3] open - Exported canvas.html now ships the inert Comment-picking runtime

**File:** src/webview/frame/runtime.ts:120
**Found:** 2026-10-23 by /audit independent (scope: current; lens: quality, performance)
**Why it matters:** `runtime.ts` always calls `installCommentPicking(host)` and posts `cd:ready`. `handoffCanvasHtml.ts` embeds the same runtime via `?iife`, so every exported handoff frame now carries the pick listeners, hit-test and paint heuristics (the canvas snapshot grew by ~1.1k lines) although the export page never sends `cd:mode`, so the code stays inert. Harmless today, but it is dead weight in a handoff artifact the Agent reads.
**Suggested fix:** Either accept it (smallest; one runtime), or move the `installCommentPicking` call into the panel-only stamp path so the export bundles only height/wheel. No current requirement is lost either way.
**Resolution:**

### F-56 [P3] fixed - The per-pick description cache never refreshes, so selector, text and styles can go stale

**File:** src/webview/frame/commentPicking.ts:113
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** F-41's repair keeps the description of each visited element until the next click or `cd:mode`. Scroll and resize re-posts reuse it (the spec requires that), but the chrome then pairs a fresh `rect` and `point` with old data: (1) the design script removes or rearranges the element: the cached selector stays non-null while `rect` is null and `:nth-of-type` indexes may point at a different element; (2) the user drags the frame's resize handle (still active in Comment mode until 8f1): media queries change `width`, `height`, `font-size`, `display` but the posted `styles` are from the old width; (3) ↑ then ↓ shows data captured at the first visit. The chrome and 8e never see that the data is old. Bounded by one click, and 8e's disk cross-check catches wrong selectors, but not wrong styles.
**Suggested fix:** Drop the cache on `resize` (`descriptions = new Map()` then `describeCurrent()` in the resize handler before `postPick`), and in `postPick` re-describe when `!current.isConnected` (gives `selector: null`). Needs the user's yes because the spec says resize re-posts never run finder.
**Resolution:** 2026-10-25 /implement (audit repair): partly: `postPick` describes a target again when the design removed it (`!isConnected`), so scroll and resize re-posts send `selector: null` with the null rect instead of a stale selector. Not changed: clearing the cache on `resize` would run finder (up to 200 ms) on every resize step of a frame drag-resize; style staleness after a resize stays until 8f1 makes resize inert in Comment mode. ↑ then ↓ reusing the first visit's data is the intended F-41 cache.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `commentPicking.ts` `postPick`: the disconnected-target re-describe is present and cheap (no finder for a disconnected element). The resize-staleness part is not repaired and has no recorded user acceptance; stays `fixed` (P3, does not block) until the user accepts that part or 8f1 makes resize inert.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests): the removed-target re-describe now runs only while the cached selector is non-null (fix/fewer-pick-re-posts-on-scroll). That keys on the wrong signal for a page pick whose `body` is replaced and for an element that never had a selector; see F-60. The resize-staleness part is unchanged; stays `fixed`.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): re-examined, stays `fixed`. The removed-target part holds (`postPick` re-describes once via the `removed` set, independent of the selector). The resize-staleness part is not repaired: the resize handle is still live in every mode (`Stage.svelte:386-405`, no mode gate) and the `resize` listener re-posts the cached description; no user acceptance is recorded.

### F-57 [P3] fixed - Sink room duplicated in CSS, and clampNumber's export widens the canvas.html stageGeometry global

**File:** src/webview/App.svelte:398
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** (1) `SCROLL_SINK_ROOM` (`frameGesture.ts:276`, not exported) and the literal `10000px` in two `:global(body)` declarations are one number kept in two files; raise the constant and the centre can exceed the real scroll range, and nothing fails (rule 04: single source). (2) F-48's repair exports `clampNumber` from `stageGeometry.ts`. The runtime IIFE tree-shakes it to one line (correct), but the exported `canvas.html` also gains `stageGeometry.clampNumber` on its public global (snapshot line 3208), outside the spec's "diff may contain only runtime text". No behavior change.
**Suggested fix:** Export `SCROLL_SINK_ROOM` and set `--scroll-sink-room` on the root from App (or reference the constant in the comment and add a test that parses the two CSS literals). For (2), accept it, or move the clamp into a tiny `src/webview/frame/` helper that `stageGeometry.ts` imports.
**Resolution:** 2026-10-25 /implement (audit repair): `SCROLL_SINK_ROOM` is exported and `App.svelte` sizes the body from it via CSSOM (`calc(100% + ${SCROLL_SINK_ROOM}px)`, allowed by the nonce CSP); the CSS literal is gone. The `stageGeometry.clampNumber` global in the exported `canvas.html` is accepted (one inert line, no behaviour); the spec note about runtime-only snapshot text is superseded by this resolution.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): part (1) confirmed repaired (App.svelte sizes the body from the exported constant). Part (2) is described as "accepted" by /implement, which is not a user decision; stays `fixed` (P3, does not block) until the user accepts it or it is moved.
2026-11-20 /audit current (fix/backlog-tests-and-dev-tooling, base main 805018a, all lenses): re-examined, stays `fixed`. Part (1) holds (`canvasState.svelte.ts:239-242` sizes the body from the exported `SCROLL_SINK_ROOM`; no CSS literal). Part (2) is unchanged: the exported `canvas.html` still sets `exports.clampNumber` on the `stageGeometry` global (`handoffCanvasHtml.test.ts.snap:4604`); no user acceptance is recorded.

### F-75 [P3] open - getComment reads comments.json twice, and commentsTextIfExists forwards to readUtf8IfExists

**File:** src/disk/comments.ts:371 and :773
**Found:** 2026-10-26 by independent /audit (scope: current; lens: quality, performance)
**Why it matters:** `getComment` calls `commentsTextIfExists` (reads and discards the whole file) and then `readCommentsFile` (reads it again). `readCommentsFile` already returns an empty file when `comments.json` is missing, and `findComment` then throws `CommentNotFoundError`, so the pre-check changes no outcome in `getComment`, which takes no lock and creates nothing. The pre-check is needed in the writers only, to avoid creating `.lock` on a workspace with no comments file. `commentsTextIfExists` is itself a one-line forwarder (`readUtf8IfExists(workspaceLayoutFile(root, commentsPathSegments))`) that `readCommentsFile` repeats inline. Up to 500 comments of 2000 chars means a megabyte read twice per `get_comment`.
**Suggested fix:** Delete the pre-check in `getComment` and drop `commentsTextIfExists` in favour of calling `readUtf8IfExists(workspaceLayoutFile(...))` in the four writers (or keep one tiny helper used by `readCommentsFile` too). No behaviour is lost: a missing file still gives `COMMENT_NOT_FOUND`.
**Resolution:** open

### F-90 [P3] unverified - The open panel rebuilds every item on each cd:anchor-rects and drag move

**File:** src/webview/App.svelte:186
**Found:** 2026-11-16 by /audit (scope: current; lens: performance)
**Why it matters:** `panelItems` returns new objects whenever `anchors` or `displayFrames` change: up to once per animation frame per frame while a target moves, and on every pointermove during a drag. Each keyed card then gets a new `item` and a fresh `target={{…}}` literal (up to `MAX_COMMENTS` = 500), and both focus effects re-run. The closed panel costs nothing. No profile shows a dropped frame yet.
**Suggested fix:** None now. If profiling shows it, keep item identity when badge, label and `canJump` are unchanged, or pass `frameLabel` / `canJump` as scalar props instead of a fresh object.
**Resolution:**
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): stays `unverified`. Re-read App.svelte `commentItems` and CommentsPanel: unchanged since the finding; no profile was run in this pass.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 583bb93..9304fec): stays `unverified`. 8h passes three more props per card (`copyBlocked`, `copied`, `onCopy`) and adds the Copy all open row but leaves `commentItems` / `panelItems` unchanged; no profile was run in this pass.
2026-11-18 /audit current (fresh reviewer, all lenses): still unverified. App now builds `panelItems` from the committed `frames`, not `displayFrames`, so a drag move no longer rebuilds the list; the per-`cd:anchor-rects` rebuild remains.

### F-114 [P3] open - Architecture polish from the critical review

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

### F-125 [P3] unverified - parse5's tree can differ from the frame's Chromium tree on rare markup

**File:** src/disk/commentTarget.ts (`parseArtboardDocument`)
**Found:** 2026-11-18 by /audit (scope: current; both fresh reviewers; predates this change, same under css-select)
**Why it matters:** A file without a doctype parses in quirks mode on disk (`<p>a<table>`: `p > table`) but the frame copy is re-serialized with `<!DOCTYPE html>`; `<template shadowrootmode>` is removed by Chromium but kept by parse5; Chromium keeps a `div` inside `<select>` that parse5 8.1.1 drops. Comments on such pages can read missing or shift by one. Not traced against real artboards.
**Suggested fix:** None in this fix. Track; a later fix could parse the disk file the way the frame copy is built.
**Resolution:**

### F-133 [P3] unverified - Author-written data-cd-src and the single cap producer, leads for 9b-9d

**File:** src/disk/sourceTags.ts:30
**Found:** 2026-11-19 by /audit (scope: current; lens: security, quality)
**Why it matters:** Leads, not defects in 9a (nothing reads the numbers yet):
- An author-written `data-cd-src` stays in the frame copy on elements 9a never numbers (`<script data-cd-src="1">`, template content, SVG `text`) or as a second attribute after ours, so the live frame can show duplicate or out-of-range numbers.
- parse5 parses `<noscript>` with scripting on, `stampArtboardHtml`'s DOMParser with scripting off; neither numbers its content, so it matters only if a later step reads numbers from the stamped DOM.
- The size cap and tagging now live only in `panelFrames`, called only by `snapshotFromCanvasView`; `postedFrameFromSnapshot` is pinned "no cap". A new snapshot producer in 9c-9f that skips `panelFrames` would post uncapped, untagged HTML with nothing failing.
**Suggested fix:** 9b maps N only through the host's own offset list; 9d's duplicate check scans every live element, not only numbered ones; any new snapshot producer goes through `panelFrames` (or a test ties `artboardDisk` to it).
**Resolution:** 2026-11-19 /audit (9b): the 9b lead is done: `editArtboardHtml` maps N only through `numberedElements` of its own disk parse, never a number read from the frame copy. The 9d and snapshot-producer leads stay open as leads. 2026-11-19 /audit independent (9d, fresh reviewer claude-opus-5-5): the 9d lead is done: `describeEditTarget` counts duplicates with `ownerDocument.querySelectorAll('[data-cd-src="N"]')` over every live element (author-written and script-set ones included), so any duplicate reads `shared-number`; the snapshot-producer lead stays open.

### F-135 [P3] unverified - Cursor's Agent keeps old MCP tool descriptions after the server restarts

**File:** src/mcp/registerCursorDesignMcp.ts:67
**Found:** 2026-11-19 by /check F5 (scope: current; lens: quality)
**Why it matters:** In the 9a F5 run, the live `cursor-design` server (PID 90248, `dist/mcp.js`, started by Cursor's mcp-process after a manual restart) answered `tools/list` with the new `update_artboard` `html` description, confirmed by a direct stdio `tools/list` probe of the same binary. A fresh Cursor Agent chat still quoted the old "style="" attributes … do not work" text. Before that, a window reload left the Nov 16 server process running. If Cursor keeps old tool descriptions, an extension update (new `.vsix`) can leave the Agent with stale instructions (here: stripping the user's style attributes) until something Cursor-side refreshes them.
**Suggested fix:** In 9g, install the `.vsix`, update it, and find what refreshes the Agent's tool list (full Cursor quit, MCP settings refresh). If only a full restart works, say so in README and the Agent skill, or bump the server name/version so Cursor sees a new tool list.
**Resolution:**

### F-137 [P3] unverified - A text edit parses the new HTML twice, synchronously, on the extension host

**File:** src/disk/artboardEdit.ts:179
**Found:** 2026-11-19 by /audit (scope: current; lens: performance; fresh reviewer claude-opus-5-5)
**Why it matters:** For a text edit, `editArtboardHtml` re-parses the spliced HTML to prove the numbering survived (`parseArtboardDocument(splice.html)`), then throws that parse away. `answerEditRequest` then calls `panelFrameHtml`, whose `cachedArtboardDocument` misses for the new bytes and parses them again. Both parses run on the extension host thread, for files up to `MAX_POSTED_ARTBOARD_HTML_CHARS` (1.5M chars). Rule 07 says no sync CPU on the host thread, and the existing `panelFrames` ponytail already names a worker thread as the upgrade path. Style edits parse once. The cost is not measured.
**Suggested fix:** Measure one text edit on a file near the cap during 9e's live check. If it is noticeable, return the core's verification document with the result and seed `cachedArtboardDocument` with it (one parse saved), or accept the cost under the existing `panelFrames` ponytail.
**Resolution:**

### F-139 [P3] open - saveCommentUi keeps a legacy commentMode key the spec says each save removes

**File:** src/webview/hostBridge.svelte.ts:55
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** The spec's Webview state contract (current-feature.md:170, and "Each save removes both `mode` and `commentMode` from the previous record first") is not what the code does: `saveCommentUi` destructures `mode`, `commentDraft`, `openThreadId`, `replyDrafts` out of the previous record but not `commentMode`, so an old `commentMode: true` key rides along in `...others` on every save forever. Behaviour is unaffected today (`parseSavedCommentUi` ignores the key and the spec itself calls it practically unreachable, since webview state does not survive a window reload), so this is contract drift, not a user-visible bug. The spec is the archived record of what shipped.
**Suggested fix:** Add `commentMode: _commentMode,` to the destructure in `saveCommentUi` (one line), or reword the spec's Webview state contract to say only `mode` is dropped. No current requirement is lost either way.
**Resolution:**

### F-141 [P3] open - Two ponytail marks the 9e spec requires are missing from the code

**File:** src/webview/Inspector.svelte:178
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** The spec's Notes for the AI (current-feature.md:358-360) and step 5 (line 230) list five `ponytail:` marks to leave in code. Three are present (`editRequests.ts:8` one in flight and no timeout, `editValues.ts:46` the reference-whitespace edge). Two are not: "colour cannot clear" (the native `<input type="color">` has no empty value, so an inline colour can never be removed from the inspector) and "focus falls to the body when a reload that empties the pick unmounts a focused field; the live region still announces the copy". `grep -rn ponytail src/webview` finds neither. Rule 03 says a deliberate ceiling carries a `ponytail:` comment naming it and its upgrade path, so the next reader cannot tell these are known limits.
**Suggested fix:** Add one `ponytail:` comment beside the colour input in `Inspector.svelte` (no clear; upgrade: a Clear button that commits '') and one beside the request-error live region (focus falls to body on a reload that empties the pick; upgrade: move focus to the stage viewport as `CommentPicker`'s mode setter does). Comments only; no requirement lost.
**Resolution:** 2026-11-19 /audit independent (9e, fresh subagent claude-opus-5-5, target 5c8a33a): re-examined, still open. `grep -rn ponytail` over `Inspector.svelte`, `editState.svelte.ts`, `editInspector.ts` finds neither mark; only `editRequests.ts:8` and `editValues.ts:46` carry the spec's marks.

### F-142 [P3] open - An abandoned invalid draft reports "the frame changed" when the user picks another element

**File:** src/webview/editState.svelte.ts:118
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** An invalid commit on Enter or blur keeps the draft with its field error (spec lifecycle "Invalid"). If the user then clicks another element, `#settleDrafts` commits that draft with `keepInvalid: false`, which drops it and sets the request error to `NOT_SAVED_COPY` ("Not saved: the frame changed. Try again."). Nothing about the frame changed: the value was refused by the chrome's own rule, and the field error explaining that is now gone with the old pick. The same happens to an invalid draft left over from a mode switch, on the next pick of another element. No data is lost (nothing was ever sendable), but the copy points the user at the wrong cause. The spec's lifecycle table does not say which copy a pick-change commit of an invalid draft should show.
**Suggested fix:** Drop an invalid draft silently on a pick-change commit (its field error already told the user it was not saved), or show the draft's own `FIELD_ERROR_COPY` as the request error instead of `NOT_SAVED_COPY`. One branch in `#commit`; add the case to the browser "dirty field then click another element" test. No current requirement lost.
**Resolution:** 2026-11-19 /audit independent (9e, fresh subagent claude-opus-5-5, target 5c8a33a): re-examined, still open. `#settleDrafts` (editState.svelte.ts:166) -> `#commit(draft, { keepInvalid: false })` -> `notSaved` (line 118) still sets `NOT_SAVED_COPY` for a draft the chrome itself refused. Same path for an invalid draft carried over a mode switch: App routes every `cd:pick` to `handlePick`, so the first Comment-mode pick of another element drops it with the same copy, shown on the next Edit entry.

### F-144 [P3] unverified - A style preview re-reads the picked element's whole innerText on every keystroke

**File:** src/webview/frame/commentPicking.ts:159
**Found:** 2026-11-19 by /audit independent (scope: current; lens: performance; fresh subagent claude-opus-5-5)
**Why it matters:** Every `cd:edit-apply` on the picked element runs `refreshCurrent`, which calls `describeContent` (`selector.ts:137`: `element.innerText` of the whole subtree, a forced layout, then `getComputedStyle`) plus `describeEditTarget` (a document-wide `querySelectorAll`), and re-posts the pick. One `input` event = one preview, so typing a padding or font-size value on a large container (a `<main>` with most of the page) repeats that per keystroke, where 9d did it once per click. The text excerpt cannot change from a style-only preview. Not measured; on typical leaf elements the cost is small.
**Suggested fix:** Measure in the F5 check (type into Padding with a large section picked). If noticeable, keep the cached `text` excerpt in `refreshCurrent` after a `style` apply and recompute only `styles` and `edit`. Otherwise accept under a `ponytail:` note.
**Resolution:**
