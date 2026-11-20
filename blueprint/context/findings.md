# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-16 [P3] open - Extension Host never proved the new module load or CSP

**File:** src/panel/artboardChromeHtml.ts:206
**Found:** 2026-10-21 by /audit (scope: current; lens: tests)
**Why it matters:** Unit tests cover the shell HTML (nonce, `asWebviewUri` stubs, `#svelte-root`, module-after-inline). Verify built `dist/webview/chrome.js` (22 kB) + `chrome.css` with no `eval` / `new Function`. The compiled Svelte runtime assigns a static template via `template.innerHTML` (not user HTML). Spec Testing and step 4 done-when still require F5: hello root present, zero CSP violations, 0.2 parity, and a missing-bundle failure path. Implement recorded F5 not run. Without that, a webview CSP or `type=module` miss would not have been caught.
**Suggested fix:** Run F5 against `fixtures/dev-workspace` as the spec Testing section lists. Record the hello marker, CSP console, 0.2 toolbar/zoom/pan/edit, and the deleted-`chrome.js` path. No product change unless F5 fails.
**Resolution:**
2026-10-22 /audit (scope: current; 8c) user-reported F5 in `fixtures/dev-workspace` (B1-B13 plus retests, not re-run by this audit) reports no CSP errors in the webview console, with zoom tracking, drag/resize persistence and watcher updates working. That covers the module-load, CSP console and 0.2 parity parts of this lead. Still unproven: the deleted-`chrome.js` failure path. Stays `unverified` (never gates `/complete`); close it when that one path is exercised.
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): confirmed. The module-load and CSP parts pass on the installed `.vsix` in Cursor 3.29.9 (case A: `hero` renders, 0 CSP violations, no `chrome.js` error, chrome assets loaded from the installed extension). The deleted-`chrome.js` path (launch 4) opens a blank Artboard tab: `#svelte-root` is empty, `body.innerText` is `""`, there is no notification toast, and the "Cursor Design" Output channel is empty. The only trace is a webview-console 404. Not repaired; a visible "panel failed to load" fallback in the shell (for example `<noscript>` or a module `onerror`) is a separate `/fix`, or Bombic may accept it (the trigger is a broken package, which the `.vsix` listing check guards).
2026-11-20 accepted by Bombic ("no fix F-16, F-137 and F-161", then "maybe update the skill to fix some issues"): no code fix. The trigger is a broken package, which the `.vsix` listing check guards. The skill cannot see a blank panel.
2026-11-20 reopened by Bombic ("alright lets do both"): the acceptance is withdrawn and a `/fix` follows after 9g lands.

### F-90 [P3] unverified - The open panel rebuilds every item on each cd:anchor-rects and drag move

**File:** src/webview/App.svelte:186
**Found:** 2026-11-16 by /audit (scope: current; lens: performance)
**Why it matters:** `panelItems` returns new objects whenever `anchors` or `displayFrames` change: up to once per animation frame per frame while a target moves, and on every pointermove during a drag. Each keyed card then gets a new `item` and a fresh `target={{…}}` literal (up to `MAX_COMMENTS` = 500), and both focus effects re-run. The closed panel costs nothing. No profile shows a dropped frame yet.
**Suggested fix:** None now. If profiling shows it, keep item identity when badge, label and `canJump` are unchanged, or pass `frameLabel` / `canJump` as scalar props instead of a fresh object.
**Resolution:**
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): stays `unverified`. Re-read App.svelte `commentItems` and CommentsPanel: unchanged since the finding; no profile was run in this pass.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 583bb93..9304fec): stays `unverified`. 8h passes three more props per card (`copyBlocked`, `copied`, `onCopy`) and adds the Copy all open row but leaves `commentItems` / `panelItems` unchanged; no profile was run in this pass.
2026-11-18 /audit current (fresh reviewer, all lenses): still unverified. App now builds `panelItems` from the committed `frames`, not `displayFrames`, so a drag move no longer rebuilds the list; the per-`cd:anchor-rects` rebuild remains.
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): measured in the browser harness on the packaged chrome. One frame with 500 open comments, the Comments panel open with 500 items, and a 3 s scroll inside the frame; three identical runs. 180 `cd:anchor-rects` (about 60 per second) and 0 long tasks during the scroll. The only long task, 136–146 ms, happens once when the panel opens (the first render of 500 items), not on each rebuild. Judged on the scroll window. This is evidence for `accepted`, which needs Bombic's decision.

### F-125 [P3] unverified - parse5's tree can differ from the frame's Chromium tree on rare markup

**File:** src/disk/commentTarget.ts (`parseArtboardDocument`)
**Found:** 2026-11-18 by /audit (scope: current; both fresh reviewers; predates this change, same under css-select)
**Why it matters:** A file without a doctype parses in quirks mode on disk (`<p>a<table>`: `p > table`) but the frame copy is re-serialized with `<!DOCTYPE html>`; `<template shadowrootmode>` is removed by Chromium but kept by parse5; Chromium keeps a `div` inside `<select>` that parse5 8.1.1 drops. Comments on such pages can read missing or shift by one. Not traced against real artboards.
**Suggested fix:** None in this fix. Track; a later fix could parse the disk file the way the frame copy is built.
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): case M in real Cursor. On `quirks` and `select`, a comment on the `h2` after the construct reads `stale: false`, `targetMissing: false`, `hint: null`. As written, `shadow` hides its `h2`: the template is a direct child of `body`, so Chromium attaches a slotless shadow root and the `h2` cannot be clicked. A `shadow2` variant with the template inside a `div` reads clean. The trees do diverge as predicted (an extra untagged `<p></p>` in quirks, an untagged `div` in `select`, the template removed). Only the unique `h2` was commented, so a selector that depends on position was not exercised. Weak evidence for accepting; one comment on the `p` after the table and one on the `div` in `select` would settle it.

### F-144 [P3] unverified - A style preview re-reads the picked element's whole innerText on every keystroke

**File:** src/webview/frame/commentPicking.ts:159
**Found:** 2026-11-19 by /audit independent (scope: current; lens: performance; fresh subagent claude-opus-5-5)
**Why it matters:** Every `cd:edit-apply` on the picked element runs `refreshCurrent`, which calls `describeContent` (`selector.ts:137`: `element.innerText` of the whole subtree, a forced layout, then `getComputedStyle`) plus `describeEditTarget` (a document-wide `querySelectorAll`), and re-posts the pick. One `input` event = one preview, so typing a padding or font-size value on a large container (a `<main>` with most of the page) repeats that per keystroke, where 9d did it once per click. The text excerpt cannot change from a style-only preview. Not measured; on typical leaf elements the cost is small.
**Suggested fix:** Measure in the F5 check (type into Padding with a large section picked). If noticeable, keep the cached `text` excerpt in `refreshCurrent` after a `style` apply and recompute only `styles` and `edit`. Otherwise accept under a `ponytail:` note.
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): case N in real Cursor, on a `<main>` with 2,800 descendants and 72k characters of `innerText`. The spec's listener-pair method read 0 ms, because on `window` Chromium fires listeners in registration order. With `t0` taken from the runtime's own `setAttribute('style')` and `t1` from a later listener, on the Margin field with the same keystrokes: 20 previews, median 5.5 ms, max 7.5 ms, 0 long tasks, 0 long animation frames. Measured on an M4. This is evidence for `accepted` under a `ponytail:` note, which needs Bombic's decision.

### F-161 [P3] open - Export writes artboard meta and manifest.json outside the workspace lock

**File:** src/disk/exportFs.ts:236 (meta refresh loop; `writeManifestLastExport` around :244)
**Found:** 2026-11-20 by /audit current (9g; lens: quality; from the 9g step 2 code read, confirmed by fresh subagent claude-sonnet-5-5); code fact, not reproduced
**Why it matters:**
- `exportArtboard` scans the artboards and metas, writes the handoff leaf across many awaits, then rewrites `artboards/<id>.meta.json` when the stored meta is missing or stale, and rewrites `manifest.json` from the earlier scan.
- Neither write holds `withWorkspaceLock`: `runQueued` serializes only within one MCP process, and `commands/exportHandoff.ts` takes no lock.
- A locked `update_artboard`, panel edit or Undo can land between the scan and the meta write. The export then writes a meta computed from the older HTML: the generation the Agent was handed is no longer current, so its next update gets a spurious `conflict`.
- The manifest write can revert a concurrent `activeArtboardId` change.
- HTML is never lost. The window is narrow: the meta must already be stale and then race a locked write.
**Suggested fix:**
- Put the meta refresh and the manifest write in one short `withWorkspaceLock` block.
- Inside it, re-read and write only if the meta is still stale, and skip it when a newer generation has already landed. The leaf writes stay outside the lock.
- Add one colocated test.
- This is a separate `/fix`, or Bombic may accept it as documented in README Limits.
**Resolution:**
2026-11-20 accepted by Bombic ("no fix F-16, F-137 and F-161", then "maybe update the skill to fix some issues"): no code fix. Its only Agent-visible effect, a spurious `conflict` on the next `update_artboard`, is already handled by the skill's conflict rule (re-read, re-apply, retry once). Documented in README Limits.
2026-11-20 reopened by Bombic ("alright lets do both"): the acceptance is withdrawn and a `/fix` follows after 9g lands.
