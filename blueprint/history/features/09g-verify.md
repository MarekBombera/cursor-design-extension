# Feature: Verify

**From build-plan:** feature 9g
**Build attempt:** 1

**Branch:** `feature/verify`
**Planned archive:** `blueprint/history/features/09g-verify.md`
**Status:** verified 2026-11-20 (agent-run; no manual run). A–K pass on the installed `.vsix` in Cursor 3.29.9. `pnpm verify` 732 tests, `pnpm test:browser` 168 passed, `pnpm knip` clean. Leads: F-25, F-133 and F-15 support closing; F-90, F-125 and F-144 support accepting; F-16, F-135 and F-137 confirm the risk. One new issue (export meta refresh outside the lock). Independent review not selected (`when-sensitive`; docs and verification only, no product code).

**Parent:** 9. **0.4 Edit-lite**. Last child; 9a–9f are on local `main`.
**Create-from:** local `main` at `75f7929` (observed 2026-11-20: `origin/main` is `dfad478`, `main` 1 ahead / 0 behind; `pnpm verify` exit 0 on `75f7929`).

**Sources:** Notion 0.4 page (Decisions + 4 "Done when" lines; fetched 2026-11-20, page last edited 2026-11-19) https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d; `blueprint/build-plan.md` 9g; `blueprint/context/findings.md` leads left `unverified` for 9g: F-16, F-25, F-90, F-125, F-133, F-135, F-137, F-144; the pending Run Task `watch` check from fix `backlog-tests-and-dev-tooling` (F-15); `README.md`; `AGENTS.md`; `skills/cursor-design/SKILL.md`; `blueprint/context/system-map.md`; `.claude/rules/02-mcp-webview.md`. Method precedents: 8i (headless stdio MCP + `.vsix` listing) and the 9f keyboard spike (a separate Cursor instance driven over CDP with Playwright `connectOverCDP`).

## Goal

Prove 0.4 Edit-lite is done, with agents doing every check and Bombic doing none. Edit, undo and redo all five fields on a real frame in a real Cursor instance running the packaged `.vsix`. Diff the file around each step. Act as the Agent over stdio MCP against the packaged `mcp.js` to prove the stale-base conflict and that a re-read keeps the edits. Export, check comment staleness, then measure or check the eight leads handed to 9g. Bring README, the Agent skill, rule 02 and the system map in line with shipped code. No product behavior change.

## Manual testing

None for Bombic (he does not want to test manually, 2026-11-17; agents test everything they can). A check an agent cannot do is recorded as **not run: <reason>**. It is never faked and never turned into a request to Bombic.

## In scope

1. A done-when evidence table (Testing) covering the 4 Notion "Done when" lines, every clause of the 9g plan line, and the Decisions with observable behavior.
2. Docs checked against shipped code and corrected where they drift: README (0.4 status line, a new Edit mode section, every Limits and Install sentence, plus after the run an F-135 Limits line and the smoke line), `skills/cursor-design/SKILL.md` (one precedence line for F-135, plus drift), rule 02, AGENTS.md Commands, and the system map's 9c–9f and Export sections.
3. The `.vsix` packaged and listed, then installed into a **scratch** Cursor extensions directory, never Bombic's `~/.cursor/extensions`.
4. A real Cursor run on that installed package: a separate Cursor instance driven over CDP, with its own `HOME`, profile and extensions dir in the scratchpad. Cases A–K, plus L–N for three leads.
5. A stand-in Agent: a Node stdio MCP client on the packaged `extension/dist/mcp.js`. It writes to the same scratch workspace while the Cursor instance has it open.
6. Leads: each of F-16, F-25, F-90, F-125, F-133, F-135, F-137, F-144 gets a measurement or check with recorded evidence and a verdict, plus the F-15 Run Task `watch` check.
7. A drafted Notion 0.4 page patch in Notes, applied only after Bombic says yes in chat.
8. Final gates: `pnpm verify`, `pnpm test:browser`, `pnpm knip`.

## Out of scope

- Any `src/` change, product or test. A failing case or a lead that turns out to be a defect is recorded under Testing → "Failures and new issues" with its output. The other cases continue, and the repair is a separate `/fix`. This includes every fix a lead suggests (F-25 live region, F-137 cache seeding, F-144 cached excerpt, F-90 item identity, F-16 missing-bundle message, a server version bump for F-135).
- New committed tests. Probes live in the scratchpad. The two probes that must run inside the repo (step 5) are untracked, never committed, and deleted in step 6.
- Driving Cursor's Agent chat (an LLM). The scratch profile is not signed in, and the agent never signs in, copies credentials or accepts any sign-in or OAuth prompt. "The Agent keeps the edits" is proven at the protocol level (case I). Whether the model follows the skill's wording is checked as text only.
- Installing anything into Bombic's Cursor profile, opening or closing his Cursor windows, killing processes the agent did not start, and editing anything under his real `~/.cursor/` (reading it is allowed).
- VoiceOver or any other screen reader (F-25 gets an accessibility-tree check only).
- Writing to `findings.md`: lead statuses and new findings are `/audit`'s job, from this spec's evidence.
- `project-overview.md` and the build-plan checkbox (`/complete` and `/overview` own them); pushing; publishing; writing to Notion without a yes; repackaging the `.vsix` after step 3.

## Build loop

- `workflow.stepReview: feature`: one review at the end, not per step. `workflow.checkpointCommits: disabled`: no commits until `/complete`.
- The lead runs each step through subagents (model and effort per the Notes). The lead checks the evidence files exist and match before ticking a step.
- Only one scratch Cursor instance runs at any time (relaunch protocol, step 4).
- Each step records its results in Testing as it finishes. A failure stops only that case. A case that depends on a failed case is recorded `not run: depends on <case>`, not as a failure.

## Build steps

- [x] **1. Branch and evidence table skeleton**
  Create `feature/verify` from `75f7929`; the uncommitted `current-feature*.md` and `feature-review.md` carry over. In Testing, fill the evidence table's "Existing automated evidence" column for every row by reading the named suites (`tests/browser/editMode.spec.ts`, `src/disk/artboardEdit.test.ts`, `src/disk/inlineStyle.test.ts`, `src/disk/sourceTags.test.ts`, `src/host/panelEdit*.test.ts`, `src/host/editHistory.test.ts`, `src/mcp/artboardTools*.test.ts`, `src/disk/commentTarget.test.ts`, handoff/export tests). Cite test names, not line numbers. Leave "Real-run evidence" for steps 4–5.
  **Done when:** `git rev-parse HEAD` is `75f7929` on `feature/verify`; every table row names existing tests or says "none"; `git status` shows only `blueprint/context/*` changed. Check: those commands.

- [x] **2. Docs checked against shipped code (before packaging)**
  For each doc, change only sentences that disagree with code, or record "checked, no drift". Every changed sentence cites the code that backs it in Testing → Docs.
  - README `Status`: add a 0.4 line: Edit mode (text, font size, colour, padding, margin of an element, saved straight to the artboard file; Undo / Redo, 20 steps per frame for the panel session); 11 MCP tools unchanged. Keep the v0.1.0 and 0.3 lines.
  - README: a new `## Edit mode` section after `## Comments for the Agent`, in the same numbered style, covering what the shipped code does. Read the code for each item, never this list: how to enter Edit mode (mode switch and its key, if any); click to pick; which fields exist and when each saves (Enter, blur, picker release); plain-text elements only, with the hint on mixed content and "not editable" for script-made or cloned elements; your own edit never reloads the frame, but an Undo or Redo step does; Undo / Redo buttons and Cmd+Z / Cmd+Shift+Z; an outside change (Agent, editor) clears that frame's history; a comment on an edited element reads stale until the text returns; disk and export never get the source tags.
  - README `Limits` and `Install`: check every sentence against code, with sentences about writes, locks, CSP, MCP and the skill sync first. Known drift: the Writes bullet says artboard HTML writes are "still last-writer-wins across windows"; since 9c `updateArtboard` runs under `withWorkspaceLock`. Leave the F-135 Limits line and the "Smoke-tested" line to step 6.
  - `skills/cursor-design/SKILL.md`: check every tool, argument, error code and limit against `src/mcp/*` (`agentSkill.test.ts` guards names, codes and limits; the prose is ours). Check that the style-attribute line still matches 9a–9f. Add one line under the rules near "Style attributes work": "If a tool's description disagrees with this skill, follow this skill: Cursor can keep an older extension's tool descriptions." Reason (F-135): the dev-workspace cache, rewritten 2026-11-20 10:33, still says `style=""` attributes "do not work", and the extension rewrites this skill on every activation.
  - Rule 02 (`.claude/rules/02-mcp-webview.md`): the CSP, lock, edit-message and cd:pick `edit` lines against `src/panel/artboardChromeHtml.ts`, `src/disk/workspaceLock.ts`, `src/host/chromeMessages.ts`, `src/webview/frame/*`.
  - AGENTS.md: the Commands section against `package.json` scripts. There is no status line there; add none.
  - System map: the prose of "Panel edit message (9c)", "Edit mode and selection (9d)", "Edit fields + save (9e)", "Undo / redo (9f)" and "Export" against code (`frameMessages.test.ts` already guards the message-table names). Fix drift in place. Leave the "Last verified against code" line to `/complete`.
  **Done when:** each doc above is changed with traceable sentences or recorded as checked with no drift; `pnpm run check` and `pnpm exec vp test src/mcp/agentSkill.test.ts` pass. Check: those commands plus `git diff --stat`.

- [x] **3. Package and list the `.vsix`**
  Run `pnpm vsix` (`pnpm dlx @vscode/vsce@3.9.2 package --no-dependencies`). It needs network and runs `vscode:prepublish` → `package`, which rewrites `dist/` minified with no sourcemaps; that is expected. If it cannot run, stop the step and report it; never fake a listing. `unzip -l` the result and extract it to `<S>/vsix/`, where `<S>` is `<session scratchpad>/9g`.
  **Done when:** the listing has `extension/package.json` (version `0.1.0`), `extension/readme.md` (vsce lowercases it), `extension/dist/extension.js`, `extension/dist/mcp.js`, `extension/dist/webview/chrome.js`, `extension/dist/webview/chrome.css` and `extension/skills/cursor-design/SKILL.md`, and no `node_modules`. `cmp` of the extracted SKILL.md with the repo copy is equal. `diff` of the extracted `readme.md` with `README.md` shows only vsce's rewrites of relative links (`media/artboard-panel.png`, `./AGENTS.md`, `./LICENSE`). `git status` shows no `.vsix` (gitignored). Check: those commands.

- [x] **4. Real Cursor run on the installed package (launch 1: cases A–N)**
  **Rig rules (every launch in steps 4 and 5):**
  - Isolation: launch with `HOME=<S>/home` (an empty directory created first), `--user-data-dir <S>/profile` and `--extensions-dir <S>/extensions`. Then the extension's skill sync (`homedir()`), Cursor's `~/.cursor/projects/` caches and `~/.cursor/mcp.json` / plugins all resolve under `<S>/home`, and none of Bombic's MCP servers or plugins start. Launch line as built (step 4 found all four needed): run under `env -i PATH=$PATH HOME=<S>/home USER LOGNAME SHELL TMPDIR LANG`, because the agent shell inherits `ELECTRON_RUN_AS_NODE=1` and `VSCODE_*` from Bombic's Cursor. Use `--user-data-dir /tmp/cd9g`, a symlink to `<S>/profile`, because the full path exceeds macOS's 103-character IPC socket limit. Add `--use-mock-keychain`, because a scratch `HOME` has no login keychain and the main process blocks on a macOS keychain dialog. Add `--classic` for the classic workbench, as 9f did. If Cursor fails to start with that `HOME`, fall back to the real `HOME`. Before the first activation, copy Bombic's `~/.cursor/skills/cursor-design/SKILL.md` to `<S>/skill-backup.md`. Record the side effects it causes: the skill rewrite, a new `~/.cursor/projects/<slug>/`, Bombic's plugin MCPs spawning. Close any auth prompt without accepting it, and include those processes in the PID tree.
  - Relaunch protocol: before every launch, the previous scratch instance must be gone. Quit it with `kill -TERM <recorded main PID>` (a full quit) and check with `ps -p <recorded PIDs>` that none remain. Kill leftovers from the recorded tree only, never `pkill Cursor`. Pick a free loopback port with `lsof -i :<port>` for each launch (CDP binds 127.0.0.1 by default; record it). Before driving, confirm `http://127.0.0.1:<port>/json/version` answers. Record per launch: port, PID tree, workspace, and which extension copy loaded (installed package or `--extensionDevelopmentPath` copy).
  - First launch: dismiss Cursor's onboarding or sign-in screens without signing in. Profile settings `<S>/profile/User/settings.json`: `{"security.workspace.trust.enabled": false}` (MCP registers only in a trusted workspace; the trust prompt is not under test).
  - Drive Cursor with Playwright `chromium.connectOverCDP`, resolving `@playwright/test` from the repo with `createRequire` as 9f's `lib.mjs` did. Record the Cursor version (`cursor --version`).
  - Stand-in Agent: a Node `.mjs` in `<S>` using `Client` + `StdioClientTransport` from `@modelcontextprotocol/client` (resolved from the repo). It runs with `command: process.execPath`, `args: [<S>/vsix/extension/dist/mcp.js]`, and `env` = `PATH`, `HOME=<S>/home`, `CURSOR_DESIGN_WORKSPACE_ROOT=<S>/ws`, `CURSOR_DESIGN_WORKSPACE_ROOTS=JSON.stringify(["<S>/ws"])`. On `WORKSPACE_BUSY` it retries up to 5 times, 200 ms apart. It closes its client (and the `mcp.js` child) at the end of each step, and that child's PID joins the "PID tree is gone" check.
  - Evidence per case: `sha256` of `hero.html` before and after, a unified diff (`diff -u`), a screenshot, and one JSON line in `<S>/results.jsonl` (`{case, pass, sha_before, sha_after, note}`). Use `locator.fill()` for text fields, never select-all plus typing (9f: characters were lost). For the colour field, set `.value` and dispatch `input` then `change`, because the macOS colour panel cannot be driven; record that. Undo and Redo are `aria-disabled` buttons named `Undo in <frame label>` / `Redo in <frame label>`: read `aria-disabled`, not `disabled`.
  - Source-tag grep, used in D5 and J: the regexes `data-cd-src="[0-9]+"` and `data-cd-src=&quot;[0-9]+&quot;` (inside `srcdoc`), never the bare string. The exported `canvas.html` embeds the frame runtime, whose source contains the attribute name and the selector template ``[data-cd-src=&quot;${sourceNumber}&quot;]``. Corrected after step 4: the spec's first wording, `data-cd-src=&quot;` with no digit, matched that template.
  **Rig order for launch 1:**
  1. Install: `HOME=<S>/home /Applications/Cursor.app/Contents/Resources/app/bin/cursor --user-data-dir <S>/profile --extensions-dir <S>/extensions --install-extension <the .vsix>`. If the CLI refuses `--extensions-dir` with `--install-extension`, launch with `--extensionDevelopmentPath=<S>/vsix/extension` instead (the same packaged files) and record which path ran.
  2. Create `<S>/ws/`. The stand-in Agent: handshake (`listTools` answers 11 tools), then `set_artboard` with id `hero`. The `hero` HTML has a `<!DOCTYPE html>`, a `<style>` block, an `h1` with plain text, a `p` with plain text and `style="color: #333333; padding-left: 4px"`, a `button` holding `<svg>` plus a label (mixed content), and a page script that sets `window.__cd9g = Date.now()` once at load (the reload marker).
  3. Copy the file `set_artboard` wrote (`<S>/ws/.cursor-design/artboards/hero.html`) to `<S>/hero-0.html`. G compares against this copy.
  4. Before running, derive from `src/disk/inlineStyle.ts` and its tests the exact `style` attribute expected after C, D, E and F. Write the four strings into Testing → Real run. Each case must match its string byte for byte.
  5. Launch: `env -i PATH=$PATH HOME=<S>/home USER LOGNAME SHELL TMPDIR LANG /Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=<port> --user-data-dir /tmp/cd9g --extensions-dir <S>/extensions --use-mock-keychain --classic <S>/ws`.
  **Cases, in this order:**
  - **A. Open.** Run Open Artboard from the command palette. The `hero` frame renders. The webview console shows zero CSP violations and no `chrome.js` load error. MCP: pass if Cursor's MCP settings list `cursor-design` with 11 tools, or `<S>/home/.cursor/projects/<slug>/mcps/*cursor-design*/tools/` holds 11 files. If the unsigned profile shows neither, record `not run: unsigned profile shows no MCP state` with a screenshot, plus partial evidence: no "MCP server was not registered" line in the Output channel "Cursor Design". That is not a failure.
  - **L (F-25, before any pick).** CDP `Accessibility.getFullAXTree` on the chrome document: is the toolbar chip's live region in the tree? Save the snapshot.
  - **K, setup.** In Comment mode, add a comment on the `h1` through the panel (the real UI path; MCP has no add tool). This is the session's first pick: take L's second AX snapshot right after the pick. The stand-in Agent then calls `list_comments` and keeps the comment `id`.
  - **B. Text.** Enter Edit mode, pick the `h1`, change the Text field with `fill()`, press Enter. The diff changes only the bytes of the `h1`'s text node.
  - **K, stale read.** After B and before C, the stand-in Agent's `get_comment(id)` returns `stale: true`.
  - **C. Font size.** Pick the `p`: `32` + Enter. The diff changes only the `p`'s `style` attribute, to C's derived string. The frame's computed `font-size` reads `32px` (inline styles render under the chrome CSP).
  - **D. Colour.** On the `p`: `#ff0000`, then `change`. The diff changes only the `style` attribute, to D's derived string.
  - **E. Padding.** On the `p`: `12`, then `locator.blur()`. The diff changes only the `style` attribute, to E's derived string: `padding: 12px` present and `padding-left: 4px` gone (shorthand drops its longhands).
  - **F. Margin.** On the `p`: `8` + Enter. The diff changes only the `style` attribute, to F's derived string.
  - **H. No reload on own edit.** Across B–F, `window.__cd9g` in the `hero` frame keeps its first value. After each of B–F: Undo `aria-disabled="false"`, Redo `aria-disabled="true"`.
  - **G. Undo / redo.** Use the inspector buttons. Undo five times: after undo k, the sha equals the state before the k-th-from-last edit. After the fifth undo it equals `hero-0.html`'s sha, and the stand-in's `get_comment(id)` returns `stale: false` (K's fresh read). Then Redo five times: after each, the sha equals the state after the matching edit, and after the fifth it equals the post-F sha. A written step reloads the frame (shipped 9f behavior), so `window.__cd9g` changes after every step. Flags: after undo 1–4, both `aria-disabled="false"`; after undo 5, Undo `"true"` and Redo `"false"`; after redo 1–4, both `"false"`; after redo 5, Undo `"false"` and Redo `"true"`.
  - **I. Stale-base Agent.** Re-pick the `h1` (G's reloads dropped the pick). The stand-in calls `read_artboard('hero')` and keeps `generation` g0 and `hash` h0. The panel edits the `h1` text (Enter). Wait until the disk sha changes and Undo reads `aria-disabled="false"`, so the panel's write has landed. Then the stand-in calls `update_artboard` with `baseGeneration: g0` and gets the conflict error; record its exact code and message. It re-reads: the HTML contains the new `h1` text and F's `p` style string. It applies one unrelated change to that re-read HTML (adds a `<footer>` with plain text), keeps every `style` attribute, and calls `update_artboard` with the new base: success. On disk the file has the `h1` edit, the `p` style and the footer. The panel reloads the frame (`window.__cd9g` changes). Within 2 s Undo reads `aria-disabled="true"`, because an outside change clears history.
  - **J. Export.** The stand-in calls `export_artboard`. `<S>/ws/<handoffPath>/ungrouped/hero/index.html` byte-equals the disk `hero.html` (`handoffPath` is workspace-relative, `.cursor-design/handoff/<exportId>`; `hero` has no group). The source-tag regex has no match in any handoff file, in `comments.json`, or in the disk `hero.html` (D5: also grepped after every case A–I). `canvas.html` contains none of the inspector-only markers `data-cd-inspector`, `aria-label="Inspector"`, `Undo in ` or `Redo in `.
  - **M (F-125).** After J, the stand-in uses `set_artboard` to add three artboards to `<S>/ws`: `quirks` (no doctype, `<p>a<table><tr><td>cell</td></tr></table>` then `<h2>after</h2>`), `shadow` (`<template shadowrootmode="open"><p>in</p></template>` then `<h2>after</h2>`) and `select` (`<select><div>x</div><option>o</option></select>` then `<h2>after</h2>`). Comment on each `h2` through Comment mode, then call `list_comments`. Record per artboard: created or refused (and the error the panel shows), `stale`, `targetMissing`, `hint`, `selector`.
  - **N (F-144).** The stand-in adds artboard `big`, whose `<main>` has at least 2,000 descendants and 50,000 characters of text. In the `big` frame (Playwright frame `evaluate`), before typing: register a `PerformanceObserver({type: 'longtask', buffered: true})`. Take `t0` from a wrapped `Element.prototype.setAttribute`, which records the runtime's own `style` write at the start of its apply. Take `t1` from a non-capture `message` listener added after the runtime's, filtered to `cd:edit-apply`. `t1 - t0` covers the apply and the pick refresh. Corrected after step 4: the spec first used a capture-phase `window` listener for `t0`, but on `window` Chromium fires listeners in registration order, so that listener ran after the runtime and every `t1 - t0` read 0. In Edit mode pick `<main>`, focus the empty Padding field, and press `1`, then 19 keys alternating `2` / `Backspace` (values 1, 12, 1, 12, …; each a valid px value), 50 ms apart. End with `locator.blur()`, which saves `padding: 12px` to `big.html`; record that write. Record the per-message median and max of `t1 - t0`, and the frame's long tasks.
  Then quit launch 1 by the relaunch protocol.
  **Done when:** A–K each have a `results.jsonl` line, a screenshot and, for B–I, the diff. Each case passes, is `not run: <reason>`, or is listed under "Failures and new issues" with its output. L, M and N data is saved for step 5's verdicts. The launch's PID tree and the stand-in's children are gone. Check: the files under `<S>` plus `ps -p <recorded PIDs>`.

- [x] **5. Leads and pending checks**
  Each lead records its method, numbers and one verdict in Testing → Leads: `supports closing`, `supports accepting`, `confirms the risk`, or `not run: <reason>`. `/audit` decides statuses. The thresholds below only pick the verdict. Run the Cursor launches by the step 4 rig rules, in this order.
  - **F-25** (data from L). Verdict `confirms the risk` if the chip's live region is absent from the AX tree before the first pick, else `supports closing`. The announcement itself is `not run: no screen reader`.
  - **F-125** (data from M). `confirms the risk` if a comment is refused at creation, or reads `targetMissing: true` or `stale: true` on an unchanged file. `not run: unchecked (<hint>)` for `null` flags or a hint. Otherwise `supports accepting`.
  - **F-144** (data from N). `supports accepting` if the median `t1 - t0` is under 16 ms and the frame logged no long task, else `confirms the risk`.
  - **F-133 (snapshot producers).** Code check: list every code path that posts frame HTML to the chrome (`canvas:updated` and any other message carrying `html`) with `file:function`. Does each one build it through `panelFrames` / `panelFrameHtml` (size cap plus tagging)? `supports closing` if all do, else `confirms the risk`, naming the path.
  - **F-137 (double parse on a text edit).** Untracked probe `src/disk/measure9g.scratch.test.ts`. It lives inside the repo so Vitest's config resolves the `?iife` imports; copy it to `<S>` before step 6 deletes it. Pure functions, no disk (if one proves necessary, use a `mkdtemp` workspace, rule 09). Generator: N blocks `<div class="b"><p>Block <i> text</p></div>\n` inside a minimal document. Choose N so the disk HTML is between 1,350,000 and 1,450,000 characters (under `MAX_POSTED_ARTBOARD_HTML_CHARS` = 1,500,000, checked on the disk HTML). Record N and the length. Each run i first changes block 1's text to `Run <i>`, so every run has unique bytes and a cold memo for the new HTML. It pre-warms `cachedArtboardDocument` with that run's starting HTML, as production has it cached from the last post. It then times `editArtboardHtml` (a text edit on the last `p`) plus `panelFrameHtml` on the result, the same calls `answerEditRequest` makes (read it, do not guess). Report run 1 separately, plus the median of 5 runs, and the same for a style edit on the last `p` for comparison. Run it with `pnpm exec vp test src/disk/measure9g.scratch.test.ts`. `supports accepting` if the text-edit median is under 100 ms, else `confirms the risk`.
  - **F-90 (comments panel rebuild).** Browser harness, untracked probe `tests/browser/measure9g.scratch.spec.ts` (copied to `<S>`, deleted in step 6). Seed the stub host with 500 comments on one frame, open the Comments panel, scroll the frame for 3 s so `cd:anchor-rects` fires, and record long tasks in the chrome document. Run it with `pnpm exec playwright test -c tests/browser measure9g`. `supports accepting` if no long task exceeds 50 ms, else `confirms the risk`.
  - **F-135 (stale tool descriptions).** (a) Read-only baseline, from the shell: the descriptions of `update_artboard` and its `html` argument in Bombic's `~/.cursor/projects/Users-marekbombera-projects-personal-cursor-design-extension-fixtures-dev-workspace/mcps/user-cursor-design.cursor-design-extension-cursor-design/tools/update_artboard.json` (mtime and text), compared with `tools/list` from the repo's `dist/mcp.js`; also `ps` of running `mcp.js` processes (path and start time; observe only). At spec time that cache held pre-9a text, mtime 2026-11-20 10:33. (b) Launch 2: `--extensionDevelopmentPath=<S>/ext-marker` (a copy of `<S>/vsix/extension`) on a new workspace `<S>/ws2`. Pre-flight: once the panel opens, check that `<S>/home/.cursor/projects/<ws2 slug>/mcps/*cursor-design*/tools/update_artboard.json` exists. If Cursor never writes it in the unsigned profile, record `not run: no tool cache in an unsigned profile` with a screenshot and skip the rest of (b). Otherwise record its description. Then edit the copy's `dist/mcp.js`: replace the exact `update_artboard` description string with the same string plus ` [9g-marker]`, and check that the replace matched exactly once. Try, in order, rereading the cache file after each (wait up to 30 s): Cursor's MCP settings toggle off/on for `cursor-design` (skip if not drivable, and record that); Developer: Reload Window; full quit by the relaunch protocol and launch 3 with the same profile and flags. Record the first action after which the marker appears, if any.
  - **F-16 (missing bundle).** Launch 4: `--extensionDevelopmentPath=<S>/ext-nochrome` (a copy of `<S>/vsix/extension` without `dist/webview/chrome.js`) on `<S>/ws2`. Run Open Artboard. Through CDP, read the panel webview document's visible text (`document.body.innerText`) and any workbench notification toast (`.notifications-toasts` text). Save a screenshot, the webview console and the Output channel "Cursor Design". `supports closing` if the panel or a toast shows a failure message. `confirms the risk` if the panel has no visible text and no toast appears, including when the error shows only in the Output channel or the console.
  - **F-15 (Run Task `watch`).** Last, because it rewrites `dist/`. Launch 5 on the repo folder (same profile). Run Tasks: Run Task → `watch`. `presentation.reveal` is `never`, so open the terminal panel and read each task terminal's tab and output: within 60 s `watch:pack` and `watch:webview` each print their watching or built line, and the status bar's problems count is 0 (or the Problems view lists nothing from these tasks). Screenshot both. Then run Tasks: Terminate Task → All, and quit by the relaunch protocol.
  **Done when:** every lead above has its method, numbers and verdict in Testing → Leads; probe files are copied to `<S>`; no scratch Cursor or stand-in process remains. Check: Testing → Leads plus `ps`.

- [x] **6. README run lines, clean-up and final gates**
  - README `Limits`, F-135 line, worded from step 5's result. If the toggle or a reload refreshed the cache: "After updating the extension, toggle `cursor-design` off and on in Settings → MCP (or reload the window) so the Agent gets the new tool descriptions." If only a full quit refreshed it: "After updating the extension, quit and reopen Cursor so the Agent gets the new tool descriptions." If nothing refreshed, or (b) did not run: "Cursor can keep an older version's MCP tool descriptions after an update; the Agent skill tells the Agent to follow the skill." Never claim an action the run did not show.
  - README `Install`: if case A passed, set the "Smoke-tested" line to this run's date and Cursor version.
  - By design the packaged README (step 3) lacks only these two lines. No repackage. (After `/audit`, the F-157–F-160 doc repairs changed README and SKILL.md again, so the tested package carries the earlier wording of both; the product code is unchanged.)
  - Delete `src/disk/measure9g.scratch.test.ts` and `tests/browser/measure9g.scratch.spec.ts`. If the real-`HOME` fallback ran, compare Bombic's `~/.cursor/skills/cursor-design/SKILL.md` with `<S>/skill-backup.md` and record whether it changed. The next activation of his own install rewrites it anyway.
  - Run `pnpm verify` (it rebuilds the dev `dist/`, replacing the minified pack and the F-15 watch output), `pnpm test:browser` and `pnpm knip`; record their counts. Fill the evidence table's last column, the Drafted Notion patch's F-135 line, and **Status**.
  **Done when:** all three commands exit 0, or a failure is recorded with output and the run stops for the lead. `dist/mcp.js.map` exists, proving the dev build replaced the minified pack. `git status` shows no `.vsix`, no untracked file under `src/` or `tests/`, and changes only in `README.md`, `skills/cursor-design/SKILL.md`, the step 2 docs and `blueprint/context/*`. Check: those commands.

## Files / areas

- Changed: `README.md`, `skills/cursor-design/SKILL.md`, `.claude/rules/02-mcp-webview.md` (drift only), `AGENTS.md` (drift only), `blueprint/context/system-map.md` (drift only), `blueprint/context/current-feature.md`, `blueprint/context/current-feature-overview.md`.
- Read, not changed: `src/**`, `tests/browser/**`, `package.json`, `.vscode/tasks.json`, Bombic's `~/.cursor/` (F-135 baseline only).
- Temporary, never committed: `src/disk/measure9g.scratch.test.ts`, `tests/browser/measure9g.scratch.spec.ts`, the `.vsix` at the repo root (gitignored).
- Scratch: `<S>` = `<implementing session's scratchpad>/9g/`: `home/`, `profile/`, `extensions/`, `vsix/`, `ws/`, `ws2/`, `ext-marker/`, `ext-nochrome/`, `hero-0.html`, `skill-backup.md`, the stand-in Agent `.mjs`, the CDP helpers, `results.jsonl`, screenshots, diffs, AX snapshots and probe copies.

## Data / contracts

No contract changes. Shipped contracts this run exercises, each read from code before use:

- MCP over stdio: `dist/mcp.js`; workspace from `CURSOR_DESIGN_WORKSPACE_ROOTS` (preferred) or `CURSOR_DESIGN_WORKSPACE_ROOT`, as `registerCursorDesignMcp.ts` sets them; 11 tools; the server reports `version` = `package.json` version (`0.1.0`, baked in by `vite.config.ts`).
- `read_artboard` → `html`, `generation`, `hash`. `update_artboard` needs `baseGeneration` and/or `baseHash`; a mismatch returns the conflict error without writing, and `WORKSPACE_BUSY` means the lock is held (retry).
- A panel edit writes through `editArtboard` → `updateArtboard` under `withWorkspaceLock`, a disk lock file (`.cursor-design/.lock`) shared by the extension host and every MCP process. It bumps `generation` and changes `hash`, so an Agent holding the old base conflicts.
- The chrome adopts its own edit's answer without reloading the frame (9e). A written Undo or Redo step reloads the frame (9f, `EditState.handleEditAnswer` → `reloadFrame`). An outside change reloads the frame and clears that frame's history.
- Undo / Redo buttons: `aria-disabled` from the host's `canUndo` / `canRedo`; names `Undo in <frame label>` / `Redo in <frame label>`. History holds whole-file snapshots, `MAX_HISTORY_STEPS` = 20 per frame, in extension memory only.
- `get_comment` / `list_comments` → `stale` and `targetMissing` (`null` = unchecked) plus an optional `hint`, checked against the file's text.
- `export_artboard` → `exportId`, `handoffPath` (workspace-relative `.cursor-design/handoff/<exportId>`). Each frame's `<group or ungrouped>/<id>/index.html` is the scanned disk HTML. `canvas.html` embeds the frame runtime, whose source contains the literal `data-cd-src`.
- Source tags `data-cd-src="N"` exist only in the posted frame copy; disk and export never carry them on an element.
- The inspector root is `<aside aria-label="Inspector" data-cd-inspector>` and exists only in the chrome.

## Testing

### Done-when evidence table

Dispositions: **auto** (a named existing test), **real** (this run's case), **not run** (with reason). The C–F, J and N methods were corrected during the build (see Real run and Leads).

| # | Clause | Existing automated evidence (step 1) | Real-run evidence (steps 4–5) |
|---|---|---|---|
| N1 | Text, size, colour, padding, margin edited on a real frame, with undo and redo | partial (stubbed host): `editMode › typing previews; blur saves once…` (text), `› Enter commits font size…; colour commits on change` , `› two quick commits…` (padding, margin); disk: `artboardEdit › a text edit replaces only…`, `› a style edit adds, sets or removes one declaration…`, `artboardEditFs › a style edit writes only that declaration…`; undo/redo: `panelEdit.history › undo restores the exact original bytes, redo the edited ones` (padding only), `editHistory › undo then redo move one entry each way…`, `editMode › Undo posts a step…` | real: **pass**, B–G (installed `.vsix`, Cursor 3.29.9) |
| N2 | A diff shows only the edited element's text or style declaration | full on the disk layer: `artboardEdit › a text edit replaces only the trimmed middle…`, `› CRLF files… byte-exactly`, `artboardEditFs › a style edit writes only that declaration…`, `inlineStyle › segments and separators rebuild any style text exactly`; nothing diffs a real frame's file | real: **pass**, B–F one-line diffs; C–F `style` byte-equal to the pre-derived strings; G shas exact |
| N3 | The Agent's next update keeps the edits | partial (mechanics): `artboardEditFs › a write between the pre-read and the lock is a conflict…`; `agentSkill.test` guards names/codes/limits only; no chained panel edit → stale update → re-read | real: **pass**, I (stale `baseGeneration` 16 → `conflict`; re-read has the edits; update on 17 keeps them). Model behavior: not run (no Agent chat) |
| N4 | Export stays clean | partial: `handoff.test › canvas export writes one tree, pristine frames, and lastExport.frames` (index.html = disk, no `data-cd-`), never on panel-edited HTML; no inspector-marker check on `canvas.html` | real: **pass**, J (`index.html` = disk; no numeric tag; no inspector markers), with the corrected regex |
| P1 | Stale-base `update_artboard` conflicts; re-read HTML contains the edits | partial: `artboardTools.contract › update_artboard stale generation returns conflict`, `artboardTools › concurrent updates on one generation…`, `artboardEditFs › a style edit…` (generation 1→2), `› a stale base hash is a conflict…`; not chained | real: **pass**, I |
| P2 | Fresh export has the edits, no `data-cd-src`, no inspector | partial: as N4; no export after a panel edit | real: **pass**, J |
| P3 | A comment on an edited element reads stale, fresh after undo | partial: `commentTools.contract › happy paths: list, get, stale after update, resolve`, `commentTarget › editing text inside the target changes the fingerprint`; fresh-after-undo not asserted | real: **pass**, K (fresh → stale after B → fresh after the fifth undo) |
| P4 | `.vsix` smoke | none | real: **pass**, step 3 listing + A–K on the CLI-installed package |
| P5 | Docs, Agent skill and system map checked against shipped code | partial: `agentSkill.test` (7 tests: frontmatter, tools, codes, limits, sandbox); doc prose unguarded | **done**, step 2 + step 6 (Docs) |
| D1 | Inline styles render under the chrome CSP | full in the browser harness: `frameCsp › under the chrome CSP, style attributes render…`, `artboardChromeHtml › shell is a complete document whose CSP is exactly the chrome policy`; not in real Cursor | real: **pass**, A (0 CSP violations), C (computed `font-size` 32px) |
| D2 | No frame reload after your own edit; a written undo/redo step reloads | full with stubbed host: `editMode › typing previews…; the answer and echo never reload`, `› Undo posts a step; its answer reloads…`, `› a canvas:updated before the step answer reloads once…` | real: **pass**, H (`__cd9g` kept through B–F), G (reload after each step) |
| D3 | An outside change clears that frame's history | layers only: `editHistory › keepUnchangedHistories…`, `panelOutbox › every new snapshot is checked against the history…`, `panelEdit.history › an outside write makes undo refuse…`; no real watcher → cleared flags path | real: **pass**, I (Undo `aria-disabled="true"` 358 ms after the Agent's write) |
| D4 | Shorthand drops its longhands | full on disk: `inlineStyle › padding drops its ten longhands and nothing else`, `artboardEdit › a clear removes the declaration, with its longhands…`; frame preview not asserted | real: **pass**, E (`padding-left: 4px` removed) |
| D5 | Disk never gets `data-cd-src` | partial: `artboardEditFs` full expected strings, `canvasSnapshot › the posted hash is the disk html hash…`, `handoff.test › canvas export… pristine frames`; no explicit regex on disk / `comments.json` / `srcdoc` after an edit | real: **pass**, 0 numeric tags on disk `hero.html` and `comments.json` after every case A–J, and in every handoff file |

### Docs

Step 2 (Opus 5.5 subagent, 2026-11-20; `pnpm run check` exit 0, `agentSkill.test.ts` 7/7):

- README `Status`: changed. A 0.4 line was added (`layout.ts` `EDIT_FIELDS`, `MAX_HISTORY_STEPS`, `editHistory.ts`, `toolNames.ts` 11 tools).
- README `## Edit mode`: new, six items, each backed by code:
  1. Enter and pick: `Toolbar.svelte`, `commentPick.ts:pressedMode` / `modeKeyAction`. Edit has no key; Esc leaves it.
  2. Fields and when each saves: `Inspector.svelte`, `editInspector.ts`, `editValues.ts:normalizeStyleValue`.
  3. What a save writes: `inlineStyle.ts:LONGHANDS`, `canvasFrames.ts:adoptEditAnswer` (no reload).
  4. Not editable: `frame/editTarget.ts`, `editInspector.ts`.
  5. Undo / Redo: `undoRedo.ts`, `frame/runtime.ts`, `editState.svelte.ts:handleEditAnswer` (a step reloads the frame), `editHistory.ts`, `openArtboardPanel.ts`, `extension.ts`.
  6. Comments and tags: `commentTarget.ts:fingerprintOf`, `canvasSnapshot.ts:panelFrameHtml`, `exportFs.ts`.
- README `Limits`, Writes bullet: changed.
  - Since 9c, `update_artboard`, panel edits and Undo / Redo run under `withWorkspaceLock` (`artboardFs.ts:updateArtboard`).
  - The queue is process-wide for every tool (`mcpQueue.ts`). The drift label now points at the overview / project plan ("per artboard id"); rule 02 no longer says that.
  - Unlocked writes (editor save, direct file edit) can still land mid-compare.
  - `manifest.json` writes and export's meta refresh take no lock.
  - The stale `watchArtboardDisk.ts` ponytail citation is removed.
- README `Limits`, other bullets: checked, no drift (`registerCursorDesignMcp.ts`, `hostFs.ts`, `resolveWorkspaceRoot.ts`, `package.json`, `artboardChromeHtml.ts`, `stampArtboardHtml.ts`, `Frame.svelte`, `agentSkill.ts`, `handoff.ts`, `exportFs.ts`, `commentTarget.ts`).
- README `Install`: checked, no drift.
- `skills/cursor-design/SKILL.md`: changed. The precedence line was added verbatim after "Style attributes work". Tools, arguments, limits, lock timings and error codes were checked against `artboardTools.ts`, `commentTools.ts`, `parse.ts`, `layout.ts`, `workspaceLock.ts` and `errors.ts`; no other drift. (Later moved to the intro bullets and reworded by the F-157/F-158 audit repair.)
- Rule 02: checked, no drift (`artboardChromeHtml.ts`, `stampArtboardHtml.ts`, `workspaceLock.ts`, `artboardFs.ts`, `artboardEditFs.ts`, `comments.ts`, `chromeMessages.ts`, `panelEdit.ts`, `frameMessages.ts:parsePickEdit`, `canvasView.ts`).
- AGENTS.md Commands: checked against `package.json`, no drift.
- System map:
  - "Panel edit message (9c)" and "Edit fields + save (9e)": changed. `artboard:edited` and `adoptEditAnswer` now carry `canUndo, canRedo` (`panelEdit.ts:postEdited` since 9f, `canvasFrames.ts:adoptEditAnswer`).
  - "Edit mode and selection (9d)", "Undo / redo (9f)" and "Export": checked, no drift.
- Spec wording vs code: the fingerprint is the target's whole normalized outer HTML (`commentTarget.ts:fingerprintOf`), so a style edit also turns a comment stale. The README says "until the element is back as it was". Case K is unaffected.
- Drift left for `/overview`: `project-overview.md` and `project-plan.md` still say "MCP serializes writes per artboard id", but the code has one process-wide queue.

Step 6 (lead):
- README `Limits`: a line was added from F-135's result (only a full quit refreshed the cache): "After updating the extension, quit and reopen Cursor so the Agent gets the new tool descriptions: toggling the server in MCP settings or reloading the window keeps the old server process running." (Later merged into the "0 tools" bullet and reworded by the F-157/F-160 audit repair; Install step 2 gained an update note, F-163.)
- README `Install`: "Smoke-tested 2026-11-20, Cursor 3.29.9 (agent-driven run on the packaged `.vsix`)." By design, the packaged README lacks only these two lines. The `/audit` doc repairs (F-157–F-160) changed README and SKILL.md again after packaging; the tested package carries the earlier wording and the same product code.

Bombic's follow-up (2026-11-20, after `/audit`; this adds to the spec's out-of-scope "no `src/` change"): "no fix F-16, F-137 and F-161", then "maybe update the skill to fix some issues". So F-16, F-137 and F-161 are accepted, with no code fix. `skills/cursor-design/SKILL.md` changed in two places:
- The precedence bullet is now "**Tool descriptions can be out of date.**". It still says to follow the skill, and adds: tell the user once to quit and reopen Cursor.
- A new "**File size:**" bullet says to keep each artboard under 1,500,000 characters (`MAX_POSTED_ARTBOARD_HTML_CHARS`). Above that the panel neither previews nor edits the file (`canvasSnapshot.ts:panelFrameHtml`, `artboardEditFs.ts` `too-large`), and edits slow down near it (F-137).

`src/mcp/agentSkill.test.ts` now guards that number. A temporary mutation of the skill's number makes the test fail, and it passes again after the revert. `pnpm run check` passes, and `agentSkill.test.ts` passes 7/7.

### Real run

Step 4, launch 1 (Opus 5.5 subagent, 2026-11-20; evidence under `<S>`):

**Derived C–F `style` strings (written 2026-11-20 before running C–F).** Start: `color: #333333; padding-left: 4px` (the `p` in `hero-0.html`). Derived from `src/disk/inlineStyle.ts` `setStyleProperty` (in-place replace of the last occurrence's value; otherwise `appendDeclaration` = `<before>; <prop>: <value>`; padding/margin then `removeProperties` of their 10 longhands, a removed non-first segment taking its own leading space and separator) and `src/disk/editValues.ts` `normalizeStyleValue` (a bare number gets `px`; colour must be `#rrggbb`, kept as typed). Test backing: `inlineStyle.test.ts` › "a set appends after the last declaration…" (`'color: red'` + font-size → `'color: red; font-size: 12px'`), › "a set changes the last occurrence in place…", › "padding drops its ten longhands and nothing else".

- C (font-size `32`): `color: #333333; padding-left: 4px; font-size: 32px`
- D (color `#ff0000`): `color: #ff0000; padding-left: 4px; font-size: 32px`
- E (padding `12`): `color: #ff0000; font-size: 32px; padding: 12px`
- F (margin `8`): `color: #ff0000; font-size: 32px; padding: 12px; margin: 8px`

**Cursor:** 3.29.9 (commit `306d153d51d714882ab7b1bc49649cab624e8a30`, arm64; Electron 43.8.4, Chrome 150.0.7871.250).

**Install (rig 1):** `HOME=<S>/home …/bin/cursor --user-data-dir <S>/profile --extensions-dir <S>/extensions --install-extension cursor-design-0.1.0.vsix`: "Extension 'cursor-design-0.1.0.vsix' was successfully installed." → `<S>/extensions/cursor-design.cursor-design-0.1.0/`. `diff -r` against `<S>/vsix/extension` differs only by `.vsixmanifest` and package.json `__metadata` (added by the install). `--extensionDevelopmentPath` was not used.

**Launch 1:** `env -i PATH HOME=<S>/home USER LOGNAME SHELL TMPDIR LANG /Applications/Cursor.app/Contents/MacOS/Cursor --classic --use-mock-keychain --remote-debugging-port=9441 --user-data-dir /tmp/cd9g --extensions-dir <S>/extensions <S>/ws` (`/tmp/cd9g` → `<S>/profile`). The deviations and why are in `failures.md` #4. Port 9441 (free per `lsof`; `/json/version` answered). Main PID 11237. Tree (`<S>/launch1-all-pids.txt`, `<S>/logs/launch1-tree-final.txt`): 11237 main; 11243 gpu, 11244 network, 11247 shared-process, 11249/11878/11879 renderers, 11255 mcp-process → 11395 `…/extensions/cursor-design.cursor-design-0.1.0/dist/mcp.js` (the installed package's MCP), 11256/11266/11267/11268 extension hosts (user/retrieval/always-local/agent-exec), 11267 → 11336, 11276 fileWatcher, 11402 pty-host → 11556 `zsh -il`. Workspace `<S>/ws`. Extension copy: **installed package** (chrome assets loaded from `extensions/cursor-design.cursor-design-0.1.0/dist/webview/chrome.{css,js}`). Quit: `kill -TERM 11237`; `ps -p` of all recorded launch PIDs plus the 11 stand-in `mcp.js` PIDs (`<S>/agent-pids.txt`: 10158 12432 12607 12778 12867 12903 13144 13148 13170 13174 13232) returns none; port 9441 free.

Failed launch attempts before launch 1 (all recorded PIDs gone): 10239 (ran as Node: inherited `ELECTRON_RUN_AS_NODE=1`), 10616 (IPC socket path > 103 chars), 10857 tree (blocked on the macOS keychain UI; SIGKILLed 10857/10876/10877/10882).

**Side effects:** none in Bombic's `~/.cursor` (real `HOME` never used for a launch; `~/.cursor/skills/cursor-design/SKILL.md` mtime still 2026-11-19 17:25:27). `cursor --version` ran once with the real env (prints the version only). Symlink `/tmp/cd9g` → `<S>/profile` created (left in place for step 5). Scratch `HOME` gained `.cursor/` (`skills/cursor-design/SKILL.md` synced by the extension, equal to the packaged copy; `projects/<ws slug>/mcps/{cursor-design,cursor-ide-browser,cursor-computer-use}`; `plugins/local`; `computer-use-sidecar/Cursor Computer Use.app`; `ai-tracking`; `argv.json`), `.zsh_history` and `Library/Application Support/Microsoft`. Possible on-screen side effect: attempt 10857's macOS keychain dialog; not verified closed (`failures.md` #4). Onboarding/login overlay (`.onboarding-v2-overlay`) hidden with `style.display='none'`; no sign-in, no auth prompt accepted. Agents pane toggled off (title-bar "Toggle Agents") to give the panel room (window 1000×800; CDP `Browser.getWindowForTarget` unavailable for a resize).

**Colour field:** set `.value = '#ff0000'`, then dispatched `input` and `change` (the macOS colour panel cannot be driven).

**Cases (results in `<S>/results.jsonl`, diffs `<S>/diffs/`, screenshots `<S>/shots/`):**
- A pass. Open Artboard from the palette; the `hero` frame renders (`h1` "Design faster"). The console during open (`logs/A-console.txt`) has 2 messages, 0 CSP violations and no `chrome.js` error. MCP: `<S>/home/.cursor/projects/<slug>/mcps/user-cursor-design.cursor-design-extension-cursor-design/tools/` holds 11 files; the Cursor MCP log shows "Successfully connected to stdio server" (the first `CreateClient` failed `[unauthenticated]`, the mcp-process retry connected). The "Cursor Design" Output channel is empty (no "not registered" line).
- L data. The toolbar pick live region is in the AX tree before the first pick (node 48, not ignored, empty); after the pick it reads "h1 element selected". See `leads/f25-data.md`.
- K setup pass. Comment `be39ab47-2422-4bd2-8755-0a55fc2d427b` added on `h1` through Comment mode; `list_comments`: `stale: false`, `targetMissing: false`, selector `h1`.
- B pass. sha `2c791bfc…` → `2de1f61d…`; diff: one line, `<h1>Design faster</h1>` → `<h1>Ship faster</h1>` (changed bytes "Design" → "Ship", inside the text node).
- K stale read pass. After B, `get_comment(id)` → `stale: true`, `targetMissing: false`.
- C pass. → `342107d0…`; `p` style = `color: #333333; padding-left: 4px; font-size: 32px` (byte-equal); frame computed `font-size` `32px`.
- D pass. → `a7fef14f…`; style = `color: #ff0000; padding-left: 4px; font-size: 32px` (byte-equal).
- E pass. → `c0ddb5fb…`; style = `color: #ff0000; font-size: 32px; padding: 12px` (byte-equal; `padding-left` gone).
- F pass. → `3c8b62c4…`; style = `color: #ff0000; font-size: 32px; padding: 12px; margin: 8px` (byte-equal). Each B–F diff is one hunk with one changed line.
- H pass. `window.__cd9g` stayed 1795188619193 through B–F. After each, Undo `aria-disabled="false"` and Redo `"true"` (names "Undo in Artboard" / "Redo in Artboard").
- G pass. Undo 1–5 landed on E, D, C, B and `hero-0.html` (`2c791bfc…`); redo 1–5 on B, C, D, E and F (`3c8b62c4…`). `__cd9g` changed after every step. Flags exact: undo 1–4 false/false, undo 5 true/false, redo 1–4 false/false, redo 5 false/true. After undo 5, `get_comment` → `stale: false`.
- I pass. Re-picked `h1`; `read_artboard` g0 = 16. The panel set the `h1` to "Launch faster" (generation 17, sha `192814ed…`). `update_artboard(baseGeneration: 16)` → `isError`, `{"code":"conflict","message":"Artboard \"hero\" is stale. Call read_artboard, then retry update_artboard with the current baseGeneration.","artboardId":"hero","expectedGeneration":16,"actualGeneration":17}`, nothing written. The re-read has the new `h1` and F's `p` style; footer added, every `style` kept; `update_artboard(baseGeneration: 17)` → generation 18, sha `c10e312e…`. Disk has the `h1`, `p` style and footer. The frame reloaded (`__cd9g` changed in 355 ms); Undo `aria-disabled="true"` at 358 ms (Redo also true).
- J **fail (spec check)**. `export_artboard` → `canvas-20261120T153409555Z`; `ungrouped/hero/index.html` byte-equals disk; no inspector markers in `canvas.html`. The encoded regex `data-cd-src=&quot;` matches once in `canvas.html`: the embedded runtime's selector template ``[data-cd-src=&quot;${sourceNumber}&quot;]``, not a tag. No numeric tag anywhere. See `failures.md` #1.
- M data. `quirks` and `select`: created; comments on `h2` read `stale: false`, `targetMissing: false`, `hint: null`, selector `h2`. `shadow`: created, but its `h2` does not render (the body shadow root has no slot), so it cannot be commented. See `leads/f125-data.md`.
- N data. The spec's listener pair measures 0 ms (method invalid, `failures.md` #2). Supplementary measure: median 5.5 ms, max 7.5 ms, 0 long tasks. Padding save wrote `<main style="padding: 12px">`. See `leads/f144-data.md`.
- D5: the source-tag regex has 0 hits in disk `hero.html` and `comments.json` after every case A–J.

Deviation: no `skill-backup.md` was taken. The real-`HOME` fallback never ran, and Bombic's `~/.cursor/skills/cursor-design/SKILL.md` mtime is unchanged (2026-11-19 17:25:27).

Lead's ruling on J: the run used the spec's first regex, which was a spec defect. With the corrected regexes (rig rules), J **passes**: there are no numeric tags in any handoff file, in `comments.json` or on disk. The `pass: false` line stays in `results.jsonl` as recorded, followed by an appended `J-corrected` line that points here.

### Leads

**F-25 (first-pick live region).** Method: CDP `Accessibility.getFullAXTree` on the chrome document, before any pick and right after the session's first pick (K setup); raw files in `<S>/leads/f25-*`. `Toolbar.svelte` now keeps the pick announcement in an always-mounted `<span class="visually-hidden" aria-live="polite">`, not the hidden chip the finding describes. Before the pick it is in the tree (`ignored: false`, `live: polite`, empty text); after it, it reads "h1 element selected". The after-pick snapshot came from a rerun a few seconds after the first pick, with no input in between, because the first attempt crashed writing its file. The verdict rests on the before-pick snapshot only. Not run: the announcement itself (no screen reader). **Verdict: supports closing.**

**F-125 (parse5 vs Chromium tree).** Method: case M in launch 1, comments on the `h2` after each construct, then `list_comments` (`<S>/leads/f125-data.md`).
- `quirks` and `select`: created; flags `stale: false`, `targetMissing: false`, `hint: null`.
- `shadow` as worded: not run, because the `h2` never renders (the template sits directly in `body`, so Chromium attaches a slotless shadow root to `body`). A labelled `shadow2` variant (template inside a `div`) gave clean flags.
- The frame trees do diverge as predicted, but no `h2` comment was affected: `quirks` gets an extra untagged `<p></p>` (the frame runs in standards mode), and Chromium keeps an untagged `div` inside `select`.
- **Verdict: supports accepting, weakly.** No false stale or missing flag on these targets, but every commented target was the unique `h2`, whose selector cannot shift. Comments on the divergent nodes themselves (the `p` after the table, the `div` in `select`) were not tried.

**F-144 (per-keystroke refresh).** Method: case N in launch 1, artboard `big` (`<main>`: 2,800 descendants, 72k characters of `innerText`).
- The spec's first method (a capture listener for `t0`) read 0 ms on every message. On `window`, Chromium fires listeners in registration order, so the probe ran after the runtime (`<S>/leads/f144-listener-order.json`).
- Corrected method: `t0` = the runtime's own `setAttribute('style')`, `t1` = a later non-capture listener. Margin field (Padding already held 12px), keys `1` + 19 alternating `2` / `Backspace`, 50 ms apart.
- 20 messages: median 5.5 ms, max 7.5 ms, 0 long tasks, 0 long animation frames.
- The spec'd Padding run saved `<main style="padding: 12px">`.
- **Verdict: supports accepting.**

**F-133 (snapshot producers).** Method: code read of every host→chrome message carrying artboard `html` (`hostMessages.ts`: only `canvas:updated` `PostedCanvasFrame.html` and `artboard:edited` `.html`). Producers: `artboardDisk.ts:snapshotFromCanvasView` → `panelFrames` (all `canvas:updated` paths: `loadActiveSnapshot`, `placeFrameFromChrome`, `watchArtboardDisk.ts`, `handleOpenArtboard.ts`; the untrusted and no-folder paths post `frames: []`); `panelEdit.ts:postEdited` → `panelFrameHtml` (edit and undo/redo answers). `postedFrameFromSnapshot` and `postArtboardSnapshotToPanel` are pass-through mappers. The only `webview.postMessage` is the outbox's in `openArtboardPanel.ts`. Tests: `panelEdit.test.ts` ties `postEdited` to `panelFrameHtml` (mocked call order); nothing ties `snapshotFromCanvasView` to `panelFrames` (no `artboardDisk.test.ts`), and no type brands capped frames. **Verdict: supports closing** (all current producers go through it; the suggested tying test does not exist).

**F-137 (double parse on a text edit).** Method: untracked Vitest probe `src/disk/measure9g.scratch.test.ts` (copy in `<S>/probes/`, deleted from the repo), pure functions, no disk. Document = minimal head + N blocks `<div class="b"><p>Block <i> text</p></div>\n`; N = 31,356, disk HTML = 1,400,019 chars (< MAX_POSTED_ARTBOARD_HTML_CHARS 1,500,000). Each run i rewrites block 1's text to a unique `Run <kind>-<i>`, pre-warms `cachedArtboardDocument` with that run's starting HTML (production has it from the last post), then times, as `answerEditRequest` does, `editArtboardHtml({ html, document: cachedArtboardDocument(...), edit })` (edit on the last `p`, source number from `numberedElements`, `liveText` = its source text) plus `panelFrameHtml` on `result.html` (cold memo, so it parses and tags). Disk read, hash and write are not timed. `performance.now()`, 5 runs each, text then style (`font-size`). Machine: Apple M4, Node via `pnpm exec vp test` (Vitest 5.1.0). Run A: text run 1 = 203.5 ms, median of 5 = 183.4 ms (editArtboardHtml median 96.9 ms, i.e. the verification re-parse; panelFrameHtml median 86.4 ms, the second parse + tagging); style run 1 = 91.2 ms, median 93.8 ms (editArtboardHtml 15.0 ms, panelFrameHtml 78.9 ms). Run B (repeat): text run 1 = 209.0 ms, median 174.5 ms (edit 91.1, frame 83.1); style run 1 = 93.7 ms, median 94.2 ms (edit 12.6, frame 81.6). A text edit near the cap blocks the extension host for about 175–185 ms, roughly twice a style edit; seeding the cache with the verification document would save about 80–90 ms of it. Even a style edit sits at ~94 ms, just under the bar, from the single parse + tag in panelFrameHtml.
**Verdict: confirms the risk**

**F-90 (comments panel rebuild).** Method: untracked Playwright probe `tests/browser/measure9g.scratch.spec.ts` (copy in `<S>/probes/`, deleted from the repo) over the existing harness (`openHarness`, `canvasUpdated`, `postToChrome`, `panelToggle`, `messagesOfType`), loading `dist/webview/` as-is (minified production build from `pnpm vsix`, 16:21 today; not rebuilt). One 800 px frame whose `#box` (600 px tall, `overflow:auto`) holds 500 `<p id="tN">` rows; 500 open comments, each anchored to `#tN` (so every pin/anchor resolves). Panel opened (500 `[data-cd-comment-item]` rendered, asserted), then a `PerformanceObserver({type:'longtask', buffered:true})` plus a rAF counter installed in the chrome document, then a rAF loop inside the frame scrolled `#box` by 8 px per frame, bouncing, for 3 s (window measured 3,326–3,329 ms incl. 300 ms settle). Headless full Chromium (`channel: 'chromium'`, sandboxed blob frame out of process), Apple M4. Three runs, identical: `cd:anchor-rects` during the scroll = 180 (≈ 60/s, continuous; 182 total), chrome animation frames during the scroll = 290, long tasks during the scroll = 0, max = 0 ms. The only long task (buffered, before the scroll window) was 136–146 ms, starting ~35 ms after the panel-toggle click: the one-time render of 500 panel items on open, not the per-`cd:anchor-rects` rebuild the finding describes.
**Verdict: supports accepting**
Deviation from step 5's literal rule, which counts every long task: the verdict is judged on the scroll window only. The buffered observer also caught a one-time 136–146 ms task when the Comments panel opens with 500 items. That is the initial render, not the per-`cd:anchor-rects` rebuild the finding is about, so it is reported here and not counted.

**F-135 (stale tool descriptions).** (a) Baseline, read-only:
- Bombic's dev-workspace cache `update_artboard.json` has mtime 2026-11-20 10:33:53. It still holds the pre-9a `html` text ("style=\"\" attributes … do not work") and the pre-9c description (no `WORKSPACE_BUSY`), while the repo's `dist/mcp.js` has both new texts.
- His Cursor's `mcp.js`, PID 90248, has been running since 2026-11-19 12:36 (`<S>/f135-baseline.txt`).

(b) Launches 2 and 3 (`<S>/leads/f135-data.md`), on `--extensionDevelopmentPath=<S>/ext-marker` and `<S>/ws2`:
- The dev copy loaded: the renderer log says "Loading development extension", and Cursor spawned `ext-marker/dist/mcp.js`.
- Pre-flight: the cache file existed with the unmarked text.
- The marker matched exactly once, and a fresh stdio spawn lists it.

| Action | Marker in cache | Cache rewritten | `mcp.js` |
|---|---|---|---|
| (i) MCP toggle off/on (Customize → MCPs → `extension-cursor-design`) | no | yes, 16:44:03 | same PID 14366, not restarted |
| (ii) Developer: Reload Window | no | yes, 16:44:54 | same PID 14366 (Cursor's MCP process outlives a window reload) |
| (iii) Full quit, then launch 3 | **yes**, 3 s after launch | yes, 16:45:37 | new PID 15538 |

Cursor rewrites the cache from whatever server is still running, and only a full quit restarts it. So after an extension update the Agent keeps the old tool descriptions, and the old server code, until Cursor quits. The original "after a restart" report is consistent with a server that never restarted (Bombic's PID 90248 has run since 2026-11-19 12:36), but that session was not observed directly. **Verdict: confirms the risk.** It is mitigated by docs in 9g (README Limits line, SKILL.md precedence line); a code fix (for example restarting the server on activation) would be a separate `/fix`.

**F-16 (missing bundle).** Launch 4, `--extensionDevelopmentPath=<S>/ext-nochrome` on `<S>/ws2` (`<S>/leads/f16-data.md`): the Artboard tab opens blank, with an empty `#svelte-root` and `body.innerText` `""`. `chrome.css` loads (200) and `chrome.js` fails (404). There is no `.notifications-toasts` entry at open or after 5 s, and the "Cursor Design" Output channel is empty. The only trace is a webview console 404 line. **Verdict: confirms the risk.**

**F-15 (Run Task `watch`).** Launch 5, on the repo folder (`<S>/leads/f15-data.md`): Run Task → `watch` starts `npm: watch:pack` and `npm: watch:webview`. At 18.6 s pack shows "✔ Rebuilt in 124ms." and webview shows "watching for file changes… built in 243ms.". The status bar reads 0 errors, 0 warnings, and Problems reads "No problems have been detected in the workspace." Terminate Task → All Running Tasks left no watch process. `dist/` was rewritten (expected); `git status` did not change. **Verdict: supports closing.**

### Failures and new issues

- **New (step 2, code read; for `/audit` to file):** export's meta refresh runs outside the workspace lock.
  - Where: `exportFs.ts`, the loop after `writeHandoffLeaf`. It rewrites `artboards/<id>.meta` outside `withWorkspaceLock` when the stored meta is missing or its hash differs.
  - Failure: a locked `update_artboard` or panel edit from another window lands between the export's scan and that write, and the meta goes back to the older generation and hash. The likely result is a spurious `conflict` or a generation regression; HTML is not lost.
  - Exposure: the window is narrow. It needs an unlocked file change just before an export that races a locked write.
  - Status: documented in README Limits ("export's meta refresh take no lock"). Not reproduced.
- **Step 4 spec-check defects (corrected in the rig rules):** (1) J's first encoded regex `data-cd-src=&quot;` matched the runtime's selector template in `canvas.html`, not a tag. (2) N's capture-listener `t0` ran after the runtime on `window`. (3) The M `shadow` body as worded cannot render its `h2`. Details in `<S>/failures.md` #1–3.
- **Rig (no product impact):** launching needed `env -i`, a short `--user-data-dir` symlink, `--use-mock-keychain` and `--classic` (`<S>/failures.md` #4). One aborted attempt (PID 10857) blocked on a macOS keychain dialog that may have shown on Bombic's screen; the process was SIGKILLed, and the dialog was not seen to close.
- No product failure in cases A–K.
- **Confirmed by step 5 (for `/audit`):** F-16, a blank panel with no message when `chrome.js` is missing. F-135, cached tool descriptions refresh only on a full Cursor quit. F-137, a ~180 ms text edit near the size cap.
- **Rig (step 5):** launches 2–4 restored the earlier session's Settings and Customize tabs on `ws2`. `terminal.integrated.gpuAcceleration: off` was set in the scratch profile so the terminal text could be read through CDP (`<S>/failures.md` #7).

### Final gates

Step 6 (2026-11-20, on `feature/verify` after the step 2 and step 6 doc edits):
- `pnpm verify`: exit 0. Check, agent rules and svelte-check pass; Vitest 59 files, 732 tests; pack and webview build OK. It rebuilt the dev `dist/`, and `dist/mcp.js.map` exists again.
- `pnpm test:browser`: exit 0. 168 passed, 198 skipped (the gallery cases run only under `pnpm gallery`).
- `pnpm knip`: exit 0, nothing reported.
- `git status`: only `README.md`, `skills/cursor-design/SKILL.md`, `blueprint/context/system-map.md` and `blueprint/context/*` are modified. There is no `.vsix` (gitignored, at the repo root) and no untracked file under `src/` or `tests/`; both probes were deleted after being copied to `<S>/probes/`.

## Notes for the AI

- Read the code behind every case before running it. This spec names behavior; the code names the exact strings, labels and functions. Never adjust a case's expected result to match what happened: a mismatch goes to "Failures and new issues".
- Never launch the scratch Cursor without `--user-data-dir <S>/profile`: without it the launch joins Bombic's running Cursor. Follow the relaunch protocol every time.
- 9f lessons: CDP-injected keys reach the page and Cursor's JS keybinding layer but not the macOS menu layer, so Cmd+Z is not re-tested here (9f plus Bombic's real press cover it). Use `fill()` for text fields. Find the chrome frame by its `[data-cd-frame-id]` content and reach the artboard iframe through it. 9f's `lib.mjs` in `/private/tmp/claude-501/-Users-marekbombera-projects-personal-cursor-design-extension/62cb364e-75a7-4f84-9b7e-f2e2de643e08/scratchpad/f5/` may still exist: copy what helps, but don't depend on it.
- `pnpm vsix` leaves a minified `dist/` with no sourcemaps; step 6's `pnpm verify` rebuilds the dev build. F-15's `watch` also rewrites `dist/`, which is why it runs last.
- The F-135 SKILL.md line is a locked default, backed by evidence already on disk (the stale dev-workspace cache). Bombic may veto it at review. A server version bump or any code change for F-135 is a separate `/fix`.
- `agentSkill.test.ts` must still pass after the SKILL.md edit (names, codes, limits).
- Subagents: Sonnet 5.5 high for mechanical checks (steps 1, 3, F-133), Opus 5.5 high for the docs, the Cursor run and the probes. Always pass `effort`; never use Fable.

### Notion 0.4 page patch (applied 2026-11-20 on Bombic's yes, plus the shipped comment-fingerprint note)

- Status callout: "Shipped 2026-11-20 on local main: 9a–9f, verified by 9g (agent-run: real Cursor instance over CDP on the packaged .vsix, stdio Agent stand-in; no manual run). Where this page and shipped code disagree, the code wins."
- "Done when": tick each line that has a passing case, citing its case letter (N1 → B–G, N2 → B–F, N3 → I, N4 → J). Leave a line unticked if its case failed.
- Decisions, Undo and redo: add "Shipped in 9f: Cmd+Z / Cmd+Shift+Z work from the chrome and from the focused frame; the history frame moves only on a pick from the focused frame; a written undo or redo step reloads the frame."
- F-135 line: "After an extension update, Cursor keeps the old MCP server process (and its tool descriptions) through an MCP toggle and a window reload; only a full quit and reopen refreshes them. The Agent skill tells the Agent to follow the skill when they disagree."


<!-- blueprint:completion {"schemaVersion":2,"specBytes":67495,"specSha256":"0e0cb93dba3a6e3749692f8e82baf97e9b6e7750d7136b9a323bab3ee5af2386","branch":"refs/heads/feature/verify","head":"75f7929509457eea79474b3d298f4c8b954012c4","baseRef":"refs/heads/main","baseCommit":"75f7929509457eea79474b3d298f4c8b954012c4","sourceTree":"03d19999fc6807585753be8c8a9fe2ff9a9b79df","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9g/F-25 [P3] closed - First pick may not be announced by the chip live region

**File:** src/webview/Toolbar.svelte:40
**Found:** 2026-10-23 by /audit (scope: current; lens: quality, security, performance, tests)
**Why it matters:** The chip is `aria-live="polite"` but also `hidden` until the first pick. On that pick it becomes visible and gets its text in the same update, and screen readers often skip a live region that just entered the accessibility tree. Later picks change the text of a visible region and should be announced. No screen-reader run backs this up yet.
**Suggested fix:** Check with VoiceOver in F5 first. If the first pick is silent, keep the region in the tree with empty text (drop `hidden`, and hide the empty chip visually with `.chip:empty { padding: 0 }` rather than `display: none`).
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): the concern is resolved in shipped code. `Toolbar.svelte` keeps the pick announcement in an always-mounted `<span class="visually-hidden" aria-live="polite">`, not a `hidden` chip. CDP `Accessibility.getFullAXTree` before any pick shows it in the tree (`ignored: false`, `live: polite`, empty text); after the first pick it reads "h1 element selected". The spoken announcement is not verified (no screen reader).

### 9g/F-133 [P3] closed - Author-written data-cd-src and the single cap producer, leads for 9b-9d

**File:** src/disk/sourceTags.ts:30
**Found:** 2026-11-19 by /audit (scope: current; lens: security, quality)
**Why it matters:** Leads, not defects in 9a (nothing reads the numbers yet):
- An author-written `data-cd-src` stays in the frame copy on elements 9a never numbers (`<script data-cd-src="1">`, template content, SVG `text`) or as a second attribute after ours, so the live frame can show duplicate or out-of-range numbers.
- parse5 parses `<noscript>` with scripting on, `stampArtboardHtml`'s DOMParser with scripting off; neither numbers its content, so it matters only if a later step reads numbers from the stamped DOM.
- The size cap and tagging now live only in `panelFrames`, called only by `snapshotFromCanvasView`; `postedFrameFromSnapshot` is pinned "no cap". A new snapshot producer in 9c-9f that skips `panelFrames` would post uncapped, untagged HTML with nothing failing.
**Suggested fix:** 9b maps N only through the host's own offset list; 9d's duplicate check scans every live element, not only numbered ones; any new snapshot producer goes through `panelFrames` (or a test ties `artboardDisk` to it).
**Resolution:** 2026-11-19 /audit (9b): the 9b lead is done: `editArtboardHtml` maps N only through `numberedElements` of its own disk parse, never a number read from the frame copy. The 9d and snapshot-producer leads stay open as leads. 2026-11-19 /audit independent (9d, fresh reviewer claude-opus-5-5): the 9d lead is done: `describeEditTarget` counts duplicates with `ownerDocument.querySelectorAll('[data-cd-src="N"]')` over every live element (author-written and script-set ones included), so any duplicate reads `shared-number`; the snapshot-producer lead stays open.
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): the snapshot-producer lead is verified by code read. Every host-to-chrome `html` is built through `panelFrames` / `panelFrameHtml`: `canvas:updated` via `artboardDisk.ts:snapshotFromCanvasView` (every load, watcher, open and place-frame path), and `artboard:edited` via `panelEdit.ts:postEdited` (edits and undo / redo). `postedFrameFromSnapshot` and `postArtboardSnapshotToPanel` only pass frames through. The `data-cd-src` lead was done in 9b and 9d. The `noscript` lead stays moot, because nothing reads numbers from the stamped DOM. Residual: no test ties `snapshotFromCanvasView` to `panelFrames`.

### 9g/F-135 [P3] closed - Cursor's Agent keeps old MCP tool descriptions after the server restarts

**File:** src/mcp/registerCursorDesignMcp.ts:67
**Found:** 2026-11-19 by /check F5 (scope: current; lens: quality)
**Why it matters:** In the 9a F5 run, the live `cursor-design` server (PID 90248, `dist/mcp.js`, started by Cursor's mcp-process after a manual restart) answered `tools/list` with the new `update_artboard` `html` description, confirmed by a direct stdio `tools/list` probe of the same binary. A fresh Cursor Agent chat still quoted the old "style="" attributes … do not work" text. Before that, a window reload left the Nov 16 server process running. If Cursor keeps old tool descriptions, an extension update (new `.vsix`) can leave the Agent with stale instructions (here: stripping the user's style attributes) until something Cursor-side refreshes them.
**Suggested fix:** In 9g, install the `.vsix`, update it, and find what refreshes the Agent's tool list (full Cursor quit, MCP settings refresh). If only a full restart works, say so in README and the Agent skill, or bump the server name/version so Cursor sees a new tool list.
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): confirmed (launches 2–3). Cursor's cached `update_artboard.json` gained the marker only after a full quit and relaunch, which started a new `mcp.js` (PID 15538). The MCP toggle off/on and Developer: Reload Window rewrote the cache with the old text, because Cursor's `mcp.js` (PID 14366) kept running. The same holds on Bombic's machine: his cache was rewritten 2026-11-20 10:33 with pre-9a text, and his `mcp.js` has been running since 2026-11-19 12:36. 9g added the suggested docs (a README Limits line, and a SKILL.md line saying the skill wins over tool descriptions), but F-157 found them understated: the old server code keeps running, not just its descriptions. Stays `open` until that wording is repaired. A code fix (restart the server on update, or bump the server name or version) is a separate `/fix`.
2026-11-20 /implement repair (9g, Opus 5.5 subagent; docs only, `pnpm run check` and `agentSkill.test.ts` pass): the wording is now repaired (see F-157). README Limits now says the toggle and Reload Window keep the old MCP server process running, so the Agent's tools run the old code with the old descriptions until Cursor quits. SKILL.md has a scoped precedence bullet (F-158). No code change; a restart-on-update or version-bump fix stays a separate `/fix`.
2026-11-20 /audit current closure (9g; fresh subagent claude-sonnet-5-5; `agentSkill.test.ts` 7/7, `pnpm verify` 732 tests): closed. README:128 says the toggle and Reload Window keep the old MCP server process running until Cursor quits, and SKILL.md:15 carries the scoped precedence bullet, as the finding suggested. The code fix (restart on update or version bump) stays an optional separate `/fix`.

### 9g/F-137 [P3] accepted - A text edit parses the new HTML twice, synchronously, on the extension host

**File:** src/disk/artboardEdit.ts:179
**Found:** 2026-11-19 by /audit (scope: current; lens: performance; fresh reviewer claude-opus-5-5)
**Why it matters:** For a text edit, `editArtboardHtml` re-parses the spliced HTML to prove the numbering survived (`parseArtboardDocument(splice.html)`), then throws that parse away. `answerEditRequest` then calls `panelFrameHtml`, whose `cachedArtboardDocument` misses for the new bytes and parses them again. Both parses run on the extension host thread, for files up to `MAX_POSTED_ARTBOARD_HTML_CHARS` (1.5M chars). Rule 07 says no sync CPU on the host thread, and the existing `panelFrames` ponytail already names a worker thread as the upgrade path. Style edits parse once. The cost is not measured.
**Suggested fix:** Measure one text edit on a file near the cap during 9e's live check. If it is noticeable, return the core's verification document with the result and seed `cachedArtboardDocument` with it (one parse saved), or accept the cost under the existing `panelFrames` ponytail.
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): measured with pure functions on an Apple M4 (Vitest), on a 1,400,019-character document (31,356 blocks), with the same calls `answerEditRequest` makes. A text edit takes 203.5 ms on the first run and a median of 183.4 ms (a repeat run gave 174.5 ms). Of that, `editArtboardHtml` takes about 97 ms, its verification parse, and `panelFrameHtml` about 86 ms, a second parse plus tagging. A style edit takes about 94 ms. So a text edit near the cap blocks the extension host for about 180 ms. Seeding `cachedArtboardDocument` with the verification document (the existing `ponytail:` in `artboardEdit.ts`) would save about 80–90 ms. Not repaired: a separate `/fix`, or Bombic may accept it under the ponytail.
2026-11-20 accepted by Bombic ("no fix F-16, F-137 and F-161", then "maybe update the skill to fix some issues"): no code fix. Mitigated in the Agent skill: a new "File size" bullet tells the Agent to keep each artboard under 1,500,000 characters, because the panel does not preview or edit a bigger file and editing gets slower near that size. `agentSkill.test.ts` now guards that number against `MAX_POSTED_ARTBOARD_HTML_CHARS`. The existing `ponytail:` in `artboardEdit.ts` names the upgrade path.

### 9g/F-157 [P2] closed - The update note calls it stale tool descriptions; the old MCP server code keeps running

**File:** README.md:129, skills/cursor-design/SKILL.md:40
**Found:** 2026-11-20 by /audit current (9g; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:** F-135's run shows `mcp.js` keeps its PID through an MCP toggle and a window reload, so until Cursor quits the Agent's tools run the old server's code, not just old descriptions. After a 0.3 → 0.4 update without a quit, `update_artboard` is the pre-9c version with no `withWorkspaceLock`, so a panel edit or Undo can race an Agent write and lose one. This contradicts README's Writes bullet ("shared by every MCP process and the panel"). Both new lines only say "tool descriptions", so a user may skip the quit as cosmetic.
**Suggested fix:** README: "After updating the extension, quit and reopen Cursor: toggling the server or reloading the window keeps the old MCP server running, with its old tools and tool descriptions." Also add "until then" to the Writes bullet, and reword the SKILL.md line (F-158).
**Resolution:**
2026-11-20 /implement repair (9g, Opus 5.5 subagent; docs only, `pnpm run check` and `agentSkill.test.ts` pass): README Writes bullet: "After an update, until Cursor is quit, the older MCP server keeps running, and `update_artboard` before 0.4 takes no lock" (the lock arrived in 9c, `fc9a091`). The update line is merged into the "0 tools" bullet and says the old server code runs, with the old descriptions, until Cursor quits.
2026-11-20 /audit current closure (9g; fresh subagent claude-sonnet-5-5; `agentSkill.test.ts` 7/7, `pnpm verify` 732 tests): closed. README:122 and :128 now say the old code keeps running until Cursor quits, and that `update_artboard` before 0.4 takes no lock (`git log -S withWorkspaceLock`: `fc9a091`, 9c). No new defect.

### 9g/F-158 [P3] closed - The SKILL.md precedence line is unscoped, misplaced and can favour an older skill

**File:** skills/cursor-design/SKILL.md:40
**Found:** 2026-11-20 by /audit current (9g; lens: security, quality; fresh subagent claude-opus-5-5)
**Why it matters:**
- "a tool's description" is not scoped to cursor-design tools.
- The skill itself can be the older side: two versions overwrite each other's copy (README Limits).
- The line sits in the "Writing artboard HTML" rules list, the only bullet there without a bold lead-in.
- It is not a security break, because the file is written by the extension, not the workspace.
**Suggested fix:** Move it to the intro bullets as "- **This skill wins over tool descriptions.** If a cursor-design tool's description disagrees with this skill, follow this skill: Cursor keeps the previous version's descriptions until it is quit. What a tool actually returns (results and errors) always wins." Rerun `agentSkill.test.ts`.
**Resolution:**
2026-11-20 /implement repair (9g, Opus 5.5 subagent; docs only, `pnpm run check` and `agentSkill.test.ts` pass): SKILL.md: the line moved out of "Writing artboard HTML" to the last intro bullet: "**This skill wins over tool descriptions.** If a cursor-design tool's description disagrees with this skill, follow this skill: Cursor keeps the previous version's tool descriptions until it is quit. What a tool actually returns (results and errors) always wins."
2026-11-20 /audit current closure (9g; fresh subagent claude-sonnet-5-5; `agentSkill.test.ts` 7/7, `pnpm verify` 732 tests): closed. SKILL.md:15 is in the intro bullets, bold-led and scoped to cursor-design tools, and ends "What a tool actually returns (results and errors) always wins". No new defect.
2026-11-20 reworded at Bombic's request ("update the skill to fix some issues"): now "**Tool descriptions can be out of date.** After the extension updates, Cursor keeps the old cursor-design server running, with its old tools and descriptions, until Cursor is quit. If a cursor-design tool's description disagrees with this skill, follow this skill and tell the user once to quit and reopen Cursor. What a tool actually returns (results and errors) always wins." So the Agent now also prompts the restart that loads the new server (F-135's root cause), instead of only overriding the stale text.

### 9g/F-159 [P3] closed - The README Edit mode section overstates validation and omits three edge cases

**File:** README.md:60-63
**Found:** 2026-11-20 by /audit current (9g; lens: quality; fresh subagent claude-opus-5-5)
**Why it matters:**
- Item 2, "An invalid value shows an error and is not saved": `normalizeStyleValue` refuses only disallowed characters, unbalanced parentheses and over-long values. `abc` is saved as typed (`editValues.ts`).
- Item 6: the fingerprint covers the whole outer HTML (`commentTarget.ts:fingerprintOf`), so editing a child also makes comments on its ancestors stale.
- Item 5: the panel has no `retainContextWhenHidden`, so after a tab switch the webview reloads and `historyFrameId` is lost (`editState.svelte.ts`). Undo reads disabled until a new pick, although the host history survives.
- Item 4: the hint also shows for one child element or one HTML comment with no text (`editTarget.ts:hasOtherContent`), and the style fields are hidden when the `style` attribute is over 5,000 characters.
**Suggested fix:** Reword the four items to match the code (the exact wording is in the 9g audit report).
**Resolution:**
2026-11-20 /implement repair (9g, Opus 5.5 subagent; docs only, `pnpm run check` and `agentSkill.test.ts` pass): Edit mode items reworded to match the code. Item 2: the exact refusal rules (`editValues.ts:normalizeStyleValue`, `MAX_STYLE_VALUE_CHARS` 200), and `abc` is saved as typed. Item 4: other elements or an HTML comment get the hint (`editTarget.ts:hasOtherContent`), and a `style` attribute over 5,000 characters replaces the style fields (`MAX_PICK_STYLE_CHARS`, `STYLE_TOO_LONG_COPY`). Item 5: Undo and Redo are disabled after a panel reload until a new pick (`editState.svelte.ts` `historyFrameId`, no `retainContextWhenHidden`). Item 6: comments on containing elements go stale too (`commentTarget.ts:fingerprintOf`).
2026-11-20 /audit current closure (9g; fresh subagent claude-sonnet-5-5; `agentSkill.test.ts` 7/7, `pnpm verify` 732 tests): closed. Items 2, 4, 5 and 6 match `normalizeStyleValue`, `hasOtherContent`, `MAX_PICK_STYLE_CHARS` / `STYLE_TOO_LONG_COPY`, `historyFrameId` with no `retainContextWhenHidden`, and `fingerprintOf`. One nit: item 2's list leaves out comment markers (`/*`), and it does not claim to be exhaustive.

### 9g/F-160 [P3] closed - The README Limits wording for export's meta refresh and the two MCP update lines

**File:** README.md:122, README.md:128-129
**Found:** 2026-11-20 by /audit current (9g; lens: quality; fresh subagents claude-opus-5-5 and claude-sonnet-5-5)
**Why it matters:** "across windows the last writer wins" is right for `manifest.json`, but export's meta refresh runs in the MCP process and can also interleave with a locked panel edit in the same window. Separately, ":128 toggle off/on fixes 0 tools" and ":129 toggling keeps the old server" read as contradictory, although they address different problems.
**Suggested fix:** Scope the meta-refresh clause ("also against a panel edit in the same window"), and merge or cross-reference the two MCP lines (the toggle fixes the tool count, not the version).
**Resolution:**
2026-11-20 /implement repair (9g, Opus 5.5 subagent; docs only, `pnpm run check` and `agentSkill.test.ts` pass): Writes bullet: `manifest.json` is last writer wins across windows, and export's meta refresh "can also overwrite the meta a panel edit or Undo in the same window just wrote" (export runs from MCP and from the Export Handoff command, `exportFs.ts`). The "0 tools" and update lines are now one bullet: the toggle fixes the tool count, not the version.
2026-11-20 /audit current closure (9g; fresh subagent claude-sonnet-5-5; `agentSkill.test.ts` 7/7, `pnpm verify` 732 tests): closed. The meta-refresh clause is now scoped to "the same window", which matches `exportFs.ts:236-243` and `commands/exportHandoff.ts`. The "0 tools" and update lines are one consistent bullet.

### 9g/F-162 [P3] closed - The 9g spec's evidence lines overstate in five places

**File:** blueprint/context/current-feature.md (Testing: Real run, Leads)
**Found:** 2026-11-20 by /audit current (9g; lens: tests; fresh subagent claude-sonnet-5-5)
**Why it matters:**
- F-90's verdict is judged on the scroll window only, and that is not stated as a deviation.
- F-125 reads stronger than the data supports (only the unique `h2` was commented).
- The `skill-backup.md` rig rule was skipped and not recorded (no harm: the real `HOME` was never used).
- F-135's "the original report was a server that never restarted" is an inference, not an observation.
- F-25's after-pick snapshot came from a rerun a few seconds after the first pick.
- `results.jsonl` keeps J `pass: false` while the spec says pass; the spec rules on it, but the raw file is unannotated.
**Suggested fix:** Add the caveats and deviations to the spec lines (no evidence changes).
**Resolution:**
2026-11-20 /implement repair (9g, lead): spec caveats added. F-90 is judged on the scroll window, stated as a deviation. F-125's verdict is now "supports accepting, weakly". The skipped `skill-backup.md` is recorded. F-135 says "consistent with". F-25 notes the rerun. `results.jsonl` gained a `J-corrected` line that points to the ruling.
2026-11-20 /audit current closure (9g; fresh subagent claude-sonnet-5-5; `agentSkill.test.ts` 7/7, `pnpm verify` 732 tests): closed. The spec carries every caveat (F-90 scroll window, F-125 "weakly", skill-backup, F-135 "consistent with", F-25 rerun), and the `J-corrected` line in `results.jsonl` is valid JSON.

### 9g/F-163 [P3] closed - README Install says "reload" for the update path too

**File:** README.md:42
**Found:** 2026-11-20 by /audit current closure (9g; lens: quality; fresh subagent claude-sonnet-5-5)
**Why it matters:** "Install from VSIX… → reload" is right for a first install. After an update, though, a reload is exactly the step the Limits bullet says does not restart the MCP server.
**Suggested fix:** Add an update note to step 2 that points at Limits.
**Resolution:** 2026-11-20 lead repair: step 2 now ends "Updating an installed version? Quit and reopen Cursor instead (see Limits)."
2026-11-20 /audit closure (9g; fresh subagent claude-sonnet-5-5): closed. README.md:42 now ends "Updating an installed version? Quit and reopen Cursor instead (see Limits)." It agrees with the Limits bullet at :128 and with the F-135 evidence. Install step 4 still fits. No new defect.

### 9g/F-164 [P3] closed - The 9g spec's step 2 and step 6 Docs notes predate the audit repair

**File:** blueprint/context/current-feature.md (Testing → Docs)
**Found:** 2026-11-20 by /audit current closure (9g; lens: quality; fresh subagent claude-sonnet-5-5)
**Why it matters:** The notes still describe the SKILL.md line as sitting after "Style attributes work" and quote the earlier README update wording.
**Suggested fix:** Note that the F-157 to F-160 repair later moved and reworded them.
**Resolution:** 2026-11-20 lead repair: both notes now say they were later moved and reworded by the audit repair.
2026-11-20 /audit closure (9g; fresh subagent claude-sonnet-5-5): closed. The spec's Docs notes now say the precedence line was later moved and reworded (F-157/F-158) and that the README update line was merged into the "0 tools" bullet (F-157/F-160, F-163). The "Bombic's follow-up" paragraph matches SKILL.md:15 and :51 and the 1,500,000 cap. No new defect.
