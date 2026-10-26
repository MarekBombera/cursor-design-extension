# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to land while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-09 [P3] open - Blueprint manifest still hashes the replaced adapter copies

**File:** blueprint/.state/manifest.json:6
**Found:** 2026-10-12 by /audit (scope: current; lens: quality)
**Why it matters:** Commit f4c9edd replaced the `.agents/skills` and `.claude/skills` trees with symlinks into `.cursor/skills`, but the tracked manifest still lists both adapter paths as separate managed files with their old hashes. 28 entries no longer match (all 23 `.claude/skills` entries, plus `.agents/skills` complete, doctor, feature, fix, rollback). `/doctor` reports this manifest, and a Blueprint update that writes each adapter path in turn would write through both symlinks into the same `.cursor` file, so the last adapter written wins.
**Suggested fix:** Record the symlink layout as an intended local customization (for example a note in `AGENTS.md` or the doctor skill telling update tooling to target `.cursor` once), or refresh the manifest through the Blueprint updater rather than by hand. No product code change.
**Resolution:**

### F-14 [P2] open - Watch matcher misses the `vp pack` success line

**File:** .vscode/tasks.json:41
**Found:** 2026-10-20 by /audit (scope: current; lens: quality)
**Why it matters:** The `npm: watch:pack` matcher is `activeOnStart: true` and ends only on `Rebuilt in <n>ms` or `Build failed`. Both `vp pack` and `vp pack --minify --no-sourcemap` in this pass printed `Build start` then `✔ Build complete in <n>ms` (once per pack config). That success line does not match `endsPattern`. If the first watch cycle uses the same logger as one-shot pack, the VS Code `watch` task never becomes ready until a later incremental `Rebuilt in` (the spec captured that string after a file touch; this pass could not re-run watch outside the sandbox). F5 still uses `preLaunchTask: compile`, so the Extension Host path is not blocked.
**Suggested fix:** Add `Build complete` to `endsPattern`, or wrap `watch:pack` so it prints the old `[watch] build started` / `[watch] build finished` lines the spec already allowed. Confirm the VS Code `watch` task reaches ready without a file touch.
**Resolution:** 2026-10-21 /audit (scope: current; 7b vp check) re-read `.vscode/tasks.json:41`. `endsPattern` is still `Rebuilt in \\d+ms|Build failed`. 7b dropped `watch:tsc`, so the VS Code `watch` task now depends only on this matcher. This pass's `pnpm compile` printed `Build start` then `✔ Build complete in 38ms` / `79ms` and no `Rebuilt in`. Defect remains. VS Code watch ready still not observed.
2026-10-21 /audit (scope: current; 7d Electron suite home) re-read `.vscode/tasks.json:41` after the watch-tests deletion. `endsPattern` is unchanged (`Rebuilt in \\d+ms|Build failed`). 7d left the matcher as the spec required. This pass's `vp pack` printed `✔ Build complete in 36ms` / `78ms` and no `Rebuilt in`. Defect remains. Watch task ready still not observed.
2026-10-21 /audit (scope: current; 8a Svelte toolchain) re-read `.vscode/tasks.json:41` after `watch` gained `npm: watch:webview`. `endsPattern` is still `Rebuilt in \\d+ms|Build failed`. This pass's `vp pack` printed `Build start` then `✔ Build complete in 31ms` / `70ms` and no `Rebuilt in`. Defect remains. The composite watch task now also waits on this matcher, so 8a's webview watcher cannot make `watch` ready by itself. VS Code watch ready still not observed.

### F-15 [P2] open - Watch:webview matcher reports every Vite line as a problem

**File:** .vscode/tasks.json:59
**Found:** 2026-10-21 by /audit (scope: current; lens: quality)
**Why it matters:** 8a added `npm: watch:webview` with `pattern.regexp` `^.*$` and `message: 0`. VS Code applies that pattern to task output, so every Vite log line becomes a Problem (`transforming...`, `built in`, rebuilds). The background `beginsPattern` / `endsPattern` already match this pass's one-shot Vite output (`transforming...`, `built in`). F5 uses `compile`, so the Extension Host path is not blocked, but the new watch task 8a added is noisy as soon as someone runs `watch`.
**Suggested fix:** Use a never-matching regexp (`^$`) or an error-only pattern. Keep the existing background begins/ends. Confirm the Problems panel stays clean during `watch:webview`.
**Resolution:**

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

### F-38 [P3] open - Default-artboard init depends on createArtboard branches no test covers

**File:** src/host/artboardDisk.ts:48
**Found:** 2026-10-23 by /audit independent (scope: current; lens: tests)
**Why it matters:** `initializeDefaultArtboard` now falls back to `setActiveArtboard` only when `createArtboard` throws exactly `ArtboardExistsError`, and the spec's first behavior change (a symlinked or non-file `artboard.html` is refused) rests on `createArtboard`'s `layoutEntryKind` check (src/disk/artboardFs.ts:218-224). No unit test calls `createArtboard` on an existing regular file, a symlink, or a directory: no test in `src/` references `ArtboardExistsError` / `ARTBOARD_EXISTS`, and the symlink test (artboardFs.test.ts:221) covers only read and update. If that branch changed (another error class for an existing file, or following the symlink), first panel open in a workspace that has `artboard.html` but no manifest would show an error banner, or write through a link, and nothing in `pnpm verify` would fail. The host glue itself is `vscode`-bound and F5-only (rule 09), so the disk contract is the place to pin it. F5 after the refactor has not run.
**Suggested fix:** Add one temp-dir test in `src/disk/artboardFs.test.ts`: create `hero`, then `createArtboard` again rejects with `ArtboardExistsError` and leaves html and meta bytes unchanged. Then replace the html with a symlink to an outside file: `createArtboard` rejects with `DiskError` and the target is untouched. No product change.
**Resolution:**

### F-39 [P3] open - Fix spec lists two init behavior changes; a third is unlisted

**File:** blueprint/context/current-feature.md:52
**Found:** 2026-10-23 by /audit independent (scope: current; lens: quality)
**Why it matters:** The spec (and F-30's Resolution) says "Everything else is unchanged" after two stricter init cases. Comparing with the base host code, there are two more. (1) No manifest, `artboard.html` missing, but a valid `artboard.meta.json` (same id) present: the old host kept that meta, so the recreated artboard read at stored generation + 1. `createArtboard` now overwrites it with generation 1, so the generation moves backward (same as MCP `set_artboard`). (2) No manifest, `artboard.html` present, corrupt-JSON meta: the old host rewrote the meta, but the new path leaves the corrupt file. It still reads as missing, so the panel output is the same. Neither is a defect (both match MCP), but this spec is the archived record of what the branch changed. A later generation-conflict report would point at the wrong commit.
**Suggested fix:** Add one bullet to the spec's Behavior changes: "a leftover meta for a deleted `artboard.html` is replaced (generation restarts at 1), and a corrupt meta beside an existing `artboard.html` is left in place." Docs only.
**Resolution:**

### F-56 [P3] fixed - The per-pick description cache never refreshes, so selector, text and styles can go stale

**File:** src/webview/frame/commentPicking.ts:113
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** F-41's repair keeps the description of each visited element until the next click or `cd:mode`. Scroll and resize re-posts reuse it (the spec requires that), but the chrome then pairs a fresh `rect` and `point` with old data: (1) the design script removes or rearranges the element: the cached selector stays non-null while `rect` is null and `:nth-of-type` indexes may point at a different element; (2) the user drags the frame's resize handle (still active in Comment mode until 8f1): media queries change `width`, `height`, `font-size`, `display` but the posted `styles` are from the old width; (3) ↑ then ↓ shows data captured at the first visit. The chrome and 8e never see that the data is old. Bounded by one click, and 8e's disk cross-check catches wrong selectors, but not wrong styles.
**Suggested fix:** Drop the cache on `resize` (`descriptions = new Map()` then `describeCurrent()` in the resize handler before `postPick`), and in `postPick` re-describe when `!current.isConnected` (gives `selector: null`). Needs the user's yes because the spec says resize re-posts never run finder.
**Resolution:** 2026-10-25 /implement (audit repair): partly: `postPick` describes a target again when the design removed it (`!isConnected`), so scroll and resize re-posts send `selector: null` with the null rect instead of a stale selector. Not changed: clearing the cache on `resize` would run finder (up to 200 ms) on every resize step of a frame drag-resize; style staleness after a resize stays until 8f1 makes resize inert in Comment mode. ↑ then ↓ reusing the first visit's data is the intended F-41 cache.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `commentPicking.ts` `postPick`: the disconnected-target re-describe is present and cheap (no finder for a disconnected element). The resize-staleness part is not repaired and has no recorded user acceptance; stays `fixed` (P3, does not block) until the user accepts that part or 8f1 makes resize inert.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests): the removed-target re-describe now runs only while the cached selector is non-null (fix/fewer-pick-re-posts-on-scroll). That keys on the wrong signal for a page pick whose `body` is replaced and for an element that never had a selector; see F-60. The resize-staleness part is unchanged; stays `fixed`.

### F-57 [P3] fixed - Sink room duplicated in CSS, and clampNumber's export widens the canvas.html stageGeometry global

**File:** src/webview/App.svelte:398
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** (1) `SCROLL_SINK_ROOM` (`frameGesture.ts:276`, not exported) and the literal `10000px` in two `:global(body)` declarations are one number kept in two files; raise the constant and the centre can exceed the real scroll range, and nothing fails (rule 04: single source). (2) F-48's repair exports `clampNumber` from `stageGeometry.ts`. The runtime IIFE tree-shakes it to one line (correct), but the exported `canvas.html` also gains `stageGeometry.clampNumber` on its public global (snapshot line 3208), outside the spec's "diff may contain only runtime text". No behavior change.
**Suggested fix:** Export `SCROLL_SINK_ROOM` and set `--scroll-sink-room` on the root from App (or reference the constant in the comment and add a test that parses the two CSS literals). For (2), accept it, or move the clamp into a tiny `src/webview/frame/` helper that `stageGeometry.ts` imports.
**Resolution:** 2026-10-25 /implement (audit repair): `SCROLL_SINK_ROOM` is exported and `App.svelte` sizes the body from it via CSSOM (`calc(100% + ${SCROLL_SINK_ROOM}px)`, allowed by the nonce CSP); the CSS literal is gone. The `stageGeometry.clampNumber` global in the exported `canvas.html` is accepted (one inert line, no behaviour); the spec note about runtime-only snapshot text is superseded by this resolution.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): part (1) confirmed repaired (App.svelte sizes the body from the exported constant). Part (2) is described as "accepted" by /implement, which is not a user decision; stays `fixed` (P3, does not block) until the user accepts it or it is moved.

### F-59 [P3] fixed - sameRect is only pinned on x, so a dropped y, width or height comparison passes every test

**File:** src/webview/frame/pickTarget.test.ts:189
**Found:** 2026-10-25 by /audit (scope: current; lens: tests)
**Why it matters:** `sameRect` (`pickTarget.ts:42`) now decides whether a scroll re-post is skipped, and it is the only thing that sees a vertical scroll: `point` is relative to the target box, so it stays equal when the anchor and target scroll together. The new test moves only `x` (`rect(11, 20, 30, 40)`), and nothing else imports `sameRect`. In a scratch copy, removing the `y`, the `width` or the `height` comparison left all 12 `pickTarget.test.ts` tests green. With `y` dropped, a vertical page or box scroll would be skipped as "unchanged" and the outline would stay behind the moved element; only the snapshot (which mirrors the source text) would notice a source change, and it is regenerated on purpose.
**Suggested fix:** In the existing `isUnchangedPick` test, add three lines that change only `y`, only `width` and only `height` of the rect and expect `false`. No product change.
**Resolution:** 2026-10-25 /implement (audit repair): `isUnchangedPick`'s test now also changes only the rect's `y`, `width` and `height`, each expecting `false`. Dropping `left.y === right.y` from `sameRect` fails it (mutation-checked, file restored byte for byte).

### F-60 [P3] fixed - The "describe a removed target once" guard keys on selector !== null, which two cases defeat

**File:** src/webview/frame/commentPicking.ts:155
**Found:** 2026-10-25 by /audit (scope: current; lens: performance, quality)
**Why it matters:** The guard assumes that after the re-describe the cached selector is `null`. (1) A page pick: `describeElement(element, true)` returns `selector: 'body'` before it checks `isConnected` (`selector.ts:116-125`). If the design replaces `document.body`, the picked old `body` is disconnected, the guard fires on every re-post, and each call builds a new object, so `isUnchangedPick` never matches and the full pick posts once per frame of scroll or resize with `rect: null`, the F-46 symptom the spec says a page pick cannot reach. (2) An element that never had a selector (finder threw, or the selector passed 1000 chars) skips the re-describe after removal, so chrome gets its old `text` and `styles` beside `selector: null` and `rect: null`, the stale pairing F-56 meant to remove. Both need an uncommon design (a script swapping the body, or a very deep or odd node removed after a pick), and the cost is one small post per frame, so it is P3.
**Suggested fix:** Key the guard on a flag, not the selector: keep `const removed = new WeakSet<Element>()` next to `descriptions`, reset it wherever `descriptions = new Map()` is, and re-describe only when `!current.isConnected && !removed.has(current)`, adding `current` after the `descriptions.set`. No requirement is lost. Alternatively accept it for now: page-body replacement is not something the picking fixture exercises.
**Resolution:** 2026-10-25 /implement (audit repair): the removed-target guard uses a per-pick `removed` `WeakSet` (reset with `descriptions` on click and `cd:mode`) instead of `selector !== null`: any disconnected path element, a replaced `body` page pick or a target finder never resolved included, is described again exactly once, so later re-posts carry the same description object and compare equal, and stale text/styles never pair with `selector: null`.

### F-75 [P3] open - getComment reads comments.json twice, and commentsTextIfExists forwards to readUtf8IfExists

**File:** src/disk/comments.ts:371 and :773
**Found:** 2026-10-26 by independent /audit (scope: current; lens: quality, performance)
**Why it matters:** `getComment` calls `commentsTextIfExists` (reads and discards the whole file) and then `readCommentsFile` (reads it again). `readCommentsFile` already returns an empty file when `comments.json` is missing, and `findComment` then throws `CommentNotFoundError`, so the pre-check changes no outcome in `getComment`, which takes no lock and creates nothing. The pre-check is needed in the writers only, to avoid creating `.lock` on a workspace with no comments file. `commentsTextIfExists` is itself a one-line forwarder (`readUtf8IfExists(workspaceLayoutFile(root, commentsPathSegments))`) that `readCommentsFile` repeats inline. Up to 500 comments of 2000 chars means a megabyte read twice per `get_comment`.
**Suggested fix:** Delete the pre-check in `getComment` and drop `commentsTextIfExists` in favour of calling `readUtf8IfExists(workspaceLayoutFile(...))` in the four writers (or keep one tiny helper used by `readCommentsFile` too). No behaviour is lost: a missing file still gives `COMMENT_NOT_FOUND`.
**Resolution:** open

### F-76 [P3] open - Twin stderr logger in the disk lib and a pass-through toolSchema wrapper

**File:** src/disk/comments.ts:449 and src/mcp/artboardTools.ts:55
**Found:** 2026-10-26 by independent /audit (scope: current; lens: quality)
**Why it matters:** Rule 05 names `logMcpError` (`mcpToolResult.ts`) as the MCP stderr logger and `logDiskError` as the host one. `logTargetReadError` in `comments.ts` is a third stderr writer with its own wording inside the disk lib, which the rule says has no I/O policy of its own and which the host will also call from 8f1 (where stderr is not the Output channel). Separately `toolSchema` in `artboardTools.ts` only fixes the generic of `toolInputSchema<ToolArgs>`; it is the forwarder rule 05 says to leave out, and it forced eight renames in the diff.
**Suggested fix:** Export `logMcpError` from `mcpToolResult.ts` or, for the disk lib, let `loadArtboardDocument` return `'unreadable'` without logging and have the MCP/host caller log (8f1 decides). Delete `toolSchema` and call `toolInputSchema<ToolArgs>(...)` directly. No behaviour is lost.
**Resolution:** open
