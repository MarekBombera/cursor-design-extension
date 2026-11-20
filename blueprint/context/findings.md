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

### F-90 [P3] unverified - The open panel rebuilds every item on each cd:anchor-rects and drag move

**File:** src/webview/App.svelte:186
**Found:** 2026-11-16 by /audit (scope: current; lens: performance)
**Why it matters:** `panelItems` returns new objects whenever `anchors` or `displayFrames` change: up to once per animation frame per frame while a target moves, and on every pointermove during a drag. Each keyed card then gets a new `item` and a fresh `target={{…}}` literal (up to `MAX_COMMENTS` = 500), and both focus effects re-run. The closed panel costs nothing. No profile shows a dropped frame yet.
**Suggested fix:** None now. If profiling shows it, keep item identity when badge, label and `canJump` are unchanged, or pass `frameLabel` / `canJump` as scalar props instead of a fresh object.
**Resolution:**
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): stays `unverified`. Re-read App.svelte `commentItems` and CommentsPanel: unchanged since the finding; no profile was run in this pass.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 583bb93..9304fec): stays `unverified`. 8h passes three more props per card (`copyBlocked`, `copied`, `onCopy`) and adds the Copy all open row but leaves `commentItems` / `panelItems` unchanged; no profile was run in this pass.
2026-11-18 /audit current (fresh reviewer, all lenses): still unverified. App now builds `panelItems` from the committed `frames`, not `displayFrames`, so a drag move no longer rebuilds the list; the per-`cd:anchor-rects` rebuild remains.

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

### F-144 [P3] unverified - A style preview re-reads the picked element's whole innerText on every keystroke

**File:** src/webview/frame/commentPicking.ts:159
**Found:** 2026-11-19 by /audit independent (scope: current; lens: performance; fresh subagent claude-opus-5-5)
**Why it matters:** Every `cd:edit-apply` on the picked element runs `refreshCurrent`, which calls `describeContent` (`selector.ts:137`: `element.innerText` of the whole subtree, a forced layout, then `getComputedStyle`) plus `describeEditTarget` (a document-wide `querySelectorAll`), and re-posts the pick. One `input` event = one preview, so typing a padding or font-size value on a large container (a `<main>` with most of the page) repeats that per keystroke, where 9d did it once per click. The text excerpt cannot change from a style-only preview. Not measured; on typical leaf elements the cost is small.
**Suggested fix:** Measure in the F5 check (type into Padding with a large section picked). If noticeable, keep the cached `text` excerpt in `refreshCurrent` after a `style` apply and recompute only `styles` and `edit`. Otherwise accept under a `ponytail:` note.
**Resolution:**
