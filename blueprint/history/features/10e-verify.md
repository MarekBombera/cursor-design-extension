# Feature: Verify

**From build-plan:** feature 10e
**Build attempt:** 1
**Status:** verified (2026-11-26; steps 4a/4b revised to stdio stand-ins, see Build steps)

**Branch:** `feature/verify`
**Planned archive:** `blueprint/history/features/10e-verify.md`
**Parent:** 10. **0.5 Projects + pages**. This is the last child; 10a–10d are on local `main`.
**Create-from:** local `main` at `9241f71` or a later local `main`; step 1 records the sha. Since 10d (`e4bf587`), `main` has gained:
- the rename to Vibeboard (`79b88ac`);
- agent-agnostic MCP registration (`c8bd62f`);
- MCP workspace from client roots (`460e751`);
- the new README and `docs/` pages (`9241f71`).

Nothing is pushed.
**Review:** dual spec review 2026-11-24, then a second one on 2026-11-26 after the rename (Breaker Opus 5.5, Literalist Sonnet 5.5, both NEEDS-FIXES both times). The judge's rewrite is below. Case B was split by Bombic's decision on 2026-11-26: there is no product change; a patched copy of the 0.4 server proves the tombstone, and the real 0.4 server is shown to leave `.vibeboard/` untouched.

**Sources:**
- Notion 0.5 page (fetched 2026-11-24): 5 "Done when" lines, plus "Shipped decisions" for 11a, 10c and 10d. https://app.notion.com/p/405500344e088195914ed9092813184c
- `blueprint/build-plan.md` 10e.
- `blueprint/reference/0.5-pages-plan.md`: the 10e section (cases A–H, Docs), D5 (tombstone), D6 (existing tools act on the open page), D8 (no pin of page A on page B's same-id frame; one comment-draft slot that a new draft on another page replaces).
- `blueprint/context/findings.md`: F-20, the only lead left `unverified`.
- `fixtures/legacy-0.4-workspace/` (local, gitignored), made by 10a step 1. It holds:
  - the 0.4 `.cursor-design` copy;
  - the 0.4 `dist/mcp.js`, which has 11 tools, hard-codes `.cursor-design` and reads `CURSOR_DESIGN_WORKSPACE_ROOT(S)`;
  - `dist/baseline.json`.
- The post-10d commits above. They set every current name: `.vibeboard/`, MCP server `vibeboard`, `VIBEBOARD_WORKSPACE_ROOT(S)` (`src/mcp/mcpIdentity.ts`), commands `vibeboard.*`, `skills/vibeboard/`, extension `bombic.vibeboard`. Client roots are resolved in `src/mcp/resolveWorkspaceRoot.ts`. The activate-time rename `migrateLegacyDesignFolders` (`src/host/hostFs.ts`) uses `migrateLegacyDesignDir` (`src/disk/layoutFs.ts`) and leaves no tombstone at `.cursor-design/`.
- Method precedent: 9g Verify (`blueprint/history/features/09g-verify.md`), the real-Cursor CDP rig with a stdio stand-in Agent.

## Goal

Prove 0.5 Projects + pages is done, with agents doing every check and Bombic doing none.

The checks run on the packaged `vibeboard-0.1.0.vsix`, installed in a scratch Cursor driven over CDP. Stdio MCP stand-ins act as the Agent:
- the packaged 0.5 `mcp.js`;
- the real 0.4 server;
- a patched copy of the 0.4 server that uses the Vibeboard folder and env names.

The run must show:
- a 0.4 folder moves to `.vibeboard/` and migrates to Page 1 unchanged;
- a stale server with the current folder name fails on the tombstone and writes nothing;
- the real 0.4 server, still running after the rename, never touches `.vibeboard/`;
- the Agent's page tools move the panel;
- a page switch never leaks frames, comments, pins, inspector state, edits or undo history;
- rename, delete, the Copy prompt and export work per page.

The run also measures the F-20 lead.

Afterwards, README, `docs/`, the Agent skill, the system map, rule 02, `project-plan.md` and the overview are brought in line with shipped code. No product behavior change.

## Manual testing

None for Bombic. He does not test manually, and agents test everything they can. A check an agent cannot do is recorded as **not run: <reason>**. It is never faked and never turned into a request to Bombic.

## In scope

1. A done-when evidence table (Testing) covering the 5 Notion "Done when" lines, every case A–H in the 10e plan section, and the F-20 lead.
2. Docs checked against shipped code and corrected where they drift:
   - README: a short Pages section, and the update notes.
   - `docs/limits.md`: the update and downgrade notes, plus one line for people coming from cursor-design 0.4.
   - `docs/edit-mode.md`.
   - `skills/vibeboard/SKILL.md`.
   - Rule 02.
   - The four 0.5 system map sections.
   - `blueprint/project-plan.md` §3, §5 and §7, which predate 0.3–0.5 (drift recorded at 10a `/complete`).
   - `project-overview.md`, regenerated with the repo's `/overview` command.
3. `vibeboard-0.1.0.vsix` packaged and listed, then installed into a **scratch** Cursor extensions directory, never Bombic's `~/.cursor/extensions`.
4. Two real Cursor launches on that package with the 9g rig (rules in step 4a): launch 1 on a copy of the 0.4 folder (step 4a), launch 2 on a fresh folder (step 4b). Cases A–H.
5. Three stand-in Agents, all Node stdio MCP clients:
   - the **0.5 Agent** on the packaged `<S>/vsix/extension/dist/mcp.js`;
   - the **0.4 Agent** on a copy of `fixtures/legacy-0.4-workspace/dist/mcp.js`;
   - the **stale Agent** on a patched copy of that file.
6. The F-20 lead: `list_pages` timed over stdio on a folder of 100 pages × 10 frames, with a recorded verdict.
7. A drafted Notion 0.5 page patch in Notes, applied only after Bombic says yes in chat.
8. Final gates: `pnpm verify` (includes `knip` and `knip --production`) and one full `pnpm test:browser`.

## Out of scope

- Any `src/` or `tests/` change, product or test. A failing case, or a lead that turns out to be a defect, goes under Testing → "Failures and new issues" with its output. The other cases continue, and the repair is a separate `/fix`.
- A tombstone at `.cursor-design/` or any other change to the rename migration (Bombic, 2026-11-26).
- New committed tests or probes. Every script lives in `<S>`.
- Driving Cursor's Agent chat (an LLM). The scratch profile is not signed in, and the agent never signs in, copies credentials, or accepts any sign-in or OAuth prompt. Agent behavior is proven at the protocol level by the stand-ins. Whether a model follows the skill's wording is checked as text only.
- Bombic's own Cursor:
  - installing anything into his profile;
  - opening or closing his windows;
  - killing a process the agent did not start;
  - reading his clipboard beyond the save and restore around case G;
  - touching anything under his real `~/.cursor/`.

  There is no real-`HOME` fallback. If Cursor fails to start with the scratch `HOME`, stop and report.
- Writing to `findings.md`. Lead statuses and new findings are `/audit`'s job, from this spec's evidence.
- Left to others: the build-plan checkbox and the system map's "Last verified against code" line (both `/complete`).
- Pushing, publishing, writing to Notion without a yes, and repackaging the `.vsix` after step 3.
- Changing `fixtures/legacy-0.4-workspace/` in place. Every case works on a copy in `<S>`.

## Build loop

- `workflow.stepReview: feature`: one review at the end, not per step.
- `workflow.checkpointCommits: disabled`: no commits until `/complete`.
- The lead runs each step through subagents (model and effort per the Notes). The lead checks that the evidence files exist and match before ticking a step.
- Only one scratch Cursor instance runs at any time (relaunch protocol, step 4a).
- Each step records its results in Testing as it finishes. A failure stops only that case. A case that depends on a failed case is recorded `not run: depends on <case>`, not as a failure.

## Build steps

> **Revised 2026-11-26 (Bombic, in chat): no real-Cursor launch.** Cursor 3.32 refuses `--remote-debugging-port` ("Debugger switches work only in development builds"), so the 9g rig cannot drive a scratch Cursor. A first 4a attempt then copied Cursor.app into `<S>` and patched the copy's `out/main.js`. Launching that copy made macOS show Bombic a "Cursor is damaged" alert. The attempt was stopped, and `/Applications/Cursor.app` was never modified: `codesign --verify --deep --strict` passes, and the app is now 3.32.10 through Cursor's own update. Bombic chose to finish without the Cursor window. Steps 4a and 4b now run on stdio stand-ins only, on the packaged `mcp.js`:
> - The activate-time rename is reproduced with `mv .cursor-design .vibeboard`, the same move `migrateLegacyDesignDir` makes.
> - Every panel or workbench check (A Panel, D, E, F, G's Copy click, C's "panel shows") is recorded `not run: Cursor 3.32 blocks CDP`, and the existing browser tests stand in for it (evidence table column 3).
> - Real-Cursor evidence for the Agent path: Bombic's own Cursor session on 2026-11-26 21:20 called `list_pages` and `list_artboards` on the installed Vibeboard and got results, with no `NO_WORKSPACE` (screenshot in chat).


- [x] **1. Branch, preconditions and evidence table skeleton**
  - Create `feature/verify` from local `main`, and record `git rev-parse HEAD`. The uncommitted `current-feature*.md` and `feature-review.md` carry over.
  - Run `pnpm verify` and record its test file and test counts as the baseline.
  - Check that the stand-in dependencies resolve: `createRequire(<repo>/package.json).resolve(...)` on `@modelcontextprotocol/client` and `@playwright/test`. If either fails, stop and report it; adding a dependency is out of scope.
  - Check the 0.4 reference:
    - `fixtures/legacy-0.4-workspace/.cursor-design/` holds a root `artboards/` directory, `manifest.json`, `canvas.json` and `comments.json`.
    - `fixtures/legacy-0.4-workspace/dist/baseline.json` parses as an array of four `{ name, arguments, result }` entries.
    - Started as the 0.4 Agent (step 4a rules) on a scratch copy of the folder, a copy of the fixture's `mcp.js` answers `listTools` with 11 tools.
    - Record that `mcp.js`'s sha256.
    - Check every row of the B argument table (step 4a) against that `listTools` `inputSchema`. Fix a mismatched argument name in the table before step 4a and record the fix.
    - If anything here is missing, stop and report it. The 0.4 commit is `5a31aa2^`; rebuilding the reference needs Bombic's yes.
  - Make the stale server: copy the fixture's `mcp.js` to `<S>/stale/mcp.js`, then in the copy replace:
    - the literal `` `.cursor-design` `` (the folder constant) with `` `.vibeboard` ``;
    - every `CURSOR_DESIGN_WORKSPACE_ROOT` with `VIBEBOARD_WORKSPACE_ROOT` (this also covers `ROOTS`).

    In the copy, `` `.cursor-design` `` and `CURSOR_DESIGN_WORKSPACE` then have 0 matches. It answers `listTools` with 11 tools. Record its sha256.
  - In Testing, fill the evidence table's "Existing automated evidence" column for every row:
    - Read the suites under `src/disk/` (open page, migration, page ops, `layoutFs.test.ts` for the rename move), `src/mcp/` (page tools, client roots and contract tests), `src/host/` (`panelPages`, `refreshPanel`, `editHistory`), `src/webview/commentPopover.test.ts`, the handoff/export tests, and `tests/browser/` (pages and page-scoping specs).
    - Use `ls` for the real names.
    - Cite test names, not line numbers.
    - Leave "Real-run evidence" for steps 4–5.
  - **Done when:**
    - `feature/verify` exists, and its recorded `HEAD` equals `git rev-parse main`.
    - The baseline `pnpm verify` counts are recorded.
    - Both packages resolve.
    - The 0.4 reference checks pass and are recorded with the `mcp.js` sha256.
    - The stale copy's grep counts and sha256 are recorded.
    - Every table row names existing tests or says "none".
    - `git status --short` lists only `blueprint/context/current-feature.md`, `current-feature-overview.md` and `feature-review.md`.
    - Check: those commands.

- [x] **2. Docs checked against shipped code (before packaging)**
  For each doc, change only sentences that disagree with code, or record "checked, no drift". Every changed sentence cites the code that backs it in Testing → Docs. Read the code for each item, never this list.
  - **README: a short `## Pages` section** after `## Edit mode`, in the style of `## Comments for the agent` and `## Edit mode`. Add it to `## Contents` too. The `## Why Vibeboard` bullet already says what pages are, so the section covers how they work:
    - the page button and menu, with last-edited times;
    - New blank page;
    - Rename (Enter saves, Escape cancels, the title limit);
    - Delete (the confirm dialog, `.vibeboard/deleted/`, and that the last page cannot be deleted);
    - that the Agent's `open_page` / `create_page` move the panel;
    - keyboard use, taken from what `PagesMenu.svelte` and `pagesMenuState.svelte.ts` handle.
  - **README `## MCP tools`, `## Commands`, `## Limits` and the Quick start "Updating?" note.** Check every sentence against code. The tools table already names all 14 tools; check it, don't duplicate it.
  - **`docs/limits.md`.**
    - Check the Pages, Updating in Cursor and Older server bullets against code (`ARTBOARDS_TOMBSTONE_TEXT` in `src/disk/layout.ts`, `openPage.ts`).
    - Add the downgrade fact in one sentence, worded from code: 0.4 neither reads `.vibeboard/` nor `pages/`.
    - Add one line for people coming from cursor-design 0.4:
      - On activate, Vibeboard moves `.cursor-design/` to `.vibeboard/` once (`migrateLegacyDesignFolders`).
      - When both folders exist, it warns and uses `.vibeboard/`.
      - The cursor-design extension is a separate extension: uninstall it, then quit and reopen Cursor. Otherwise its still-running server writes to a new `.cursor-design/` that Vibeboard ignores.

      Word the line from code and the case B-pre-rename result. If step 4a shows a different outcome, word the line from that outcome.
  - **`docs/edit-mode.md`.** Check the undo / redo and inspector prose against the per-page history (`editHistory.ts`, system map 10b).
  - **`skills/vibeboard/SKILL.md`.** Check every tool, argument, result shape, error code and limit against `src/mcp/*` and `src/disk/errors.ts`. Check the Pages and tombstone prose against `pageOps.ts` and `openPage.ts`. `agentSkill.test.ts` guards names, codes and limits; the prose is ours.
  - **Rule 02** (`.claude/rules/02-mcp-webview.md`). Check the pages, tombstone, `page:*` and page-bound request lines against `src/host/*` and `src/disk/*`.
  - **System map.** Check the prose of Open page and migration (10a), Page-scoped panel (10b), Agent page tools (10c) and Pages menu (10d) against code. `frameMessages.test.ts` already guards the message-table names. Fix drift in place, and leave the "Last verified against code" line alone.
  - **`blueprint/project-plan.md` §3, §5 and §7.** Bring them to the shipped 0.5 state (pages, menu, the 14 tools, migration, tombstone, the `.vibeboard/` name), taken from code and the 10a–10d archives. Do not change §1 or §2 product direction, and add no new scope.
  - **Done when:**
    - Each doc above is changed with traceable sentences, or recorded as checked with no drift.
    - `pnpm run check` and `pnpm exec vp test src/mcp/agentSkill.test.ts` pass.
    - Check: those commands plus `git diff --stat`.

- [x] **3. Package and list the `.vsix`**
  - Run `pnpm vsix`. It needs network and runs `vscode:prepublish` → `package`, which rewrites `dist/` minified with no sourcemaps. That is expected. If it cannot run, stop the step and report it; never fake a listing.
  - The result is `vibeboard-0.1.0.vsix` at the repo root. A stale `cursor-design-0.1.0.vsix` from before the rename also sits there: never list, extract or install it.
  - `unzip -l vibeboard-0.1.0.vsix` and extract it to `<S>/vsix/`, where `<S>` is `<implementing session's scratchpad>/10e`.
  - **Done when:**
    - The listing has `extension/package.json` (name `vibeboard`, publisher `bombic`, version `0.1.0`), `extension/readme.md`, `extension/dist/extension.js`, `extension/dist/mcp.js`, `extension/dist/webview/chrome.js`, `extension/dist/webview/chrome.css` and `extension/skills/vibeboard/SKILL.md`.
    - The listing has no `node_modules` or `fixtures/`.
    - `cmp` shows the extracted SKILL.md equals `skills/vibeboard/SKILL.md`.
    - The packaged `mcp.js`, started by a client **without** the `roots` capability and with `VIBEBOARD_WORKSPACE_ROOTS` set to a scratch folder, answers `listTools` with 14 tools, and `list_pages` on that folder succeeds. This is the env-fallback evidence.
    - Check: those commands.

- [x] **4a. Real Cursor run, launch 1: rig, A, B-pre-rename, B-tombstone**

  **Rig rules** (the 9g rig; they apply to both launches, in 4a and 4b).

  **Setup.**
  - Create `<S>/home` empty.
  - Link the profile with `ln -sfn <S>/profile /tmp/vb10e`, then check `readlink /tmp/vb10e`. The link is needed because macOS limits IPC socket paths to 103 characters.
  - Record `stat -f '%m %N'` of Bombic's `~/.cursor/extensions` and `~/.cursor/skills/vibeboard` (read-only; record "absent" if missing). Step 4b compares them.

  **Scratch env prefix** (`<ENV>`), for **every** Cursor binary or CLI call, the install and `--version` included:
  ```
  env -i PATH="$PATH" HOME=<S>/home USER="$USER" LOGNAME="$LOGNAME" SHELL="$SHELL" TMPDIR="$TMPDIR" LANG="$LANG"
  ```
  - `env -i` drops the inherited `ELECTRON_RUN_AS_NODE`, `VSCODE_*` and `VSCODE_IPC_HOOK_CLI`. Without that, the CLI can forward to Bombic's running instance.

  **Launch line:**
  ```
  <ENV> /Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=<port> --user-data-dir /tmp/vb10e --extensions-dir <S>/extensions --use-mock-keychain --classic <workspace>
  ```
  - `--use-mock-keychain` stops a keychain dialog from appearing on Bombic's screen.
  - Never launch without the scratch `--user-data-dir`. Without it, the launch joins Bombic's running Cursor.

  **Install** once:
  ```
  <ENV> /Applications/Cursor.app/Contents/Resources/app/bin/cursor --user-data-dir /tmp/vb10e --extensions-dir <S>/extensions --install-extension <repo>/vibeboard-0.1.0.vsix
  ```
  - The result is `<S>/extensions/bombic.vibeboard-0.1.0/`.
  - If the CLI refuses, launch with `--extensionDevelopmentPath=<S>/vsix/extension` instead and record which path ran.

  **Profile settings** (`<S>/profile/User/settings.json`):
  ```json
  {"security.workspace.trust.enabled": false, "window.dialogStyle": "custom", "update.mode": "none", "window.restoreWindows": "none"}
  ```
  - Trust off: MCP registers only in a trusted workspace.
  - Custom dialogs: the delete confirm (`showWarningMessage` with `modal: true`, `panelPages.ts`) renders in the workbench DOM, where CDP can click it. If it still opens natively:
    - case F stops at that dialog, and the rest of F is `not run: native dialog`;
    - kill the instance at once by the relaunch protocol;
    - never click the dialog through System Events.
  - Updates off: the scratch instance must never update the shared `/Applications/Cursor.app`.
  - No window restore: launch 2 must not reopen `ws-legacy`.

  **Relaunch protocol.**
  - Before every launch, the previous scratch instance must be gone.
  - Just before quitting, record the instance's full PID tree, including any `mcp.js` Cursor spawned for the registered server.
  - Quit with `kill -TERM <recorded main PID>`, then check with `ps -p` that no recorded PID remains.
  - `kill` only PIDs the agent started or recorded in that tree. Never `pkill Cursor`.
  - Pick a free loopback port per launch (`lsof -i :<port>`). Confirm `http://127.0.0.1:<port>/json/version` answers before driving.
  - Record per launch: port, PID tree, workspace, Cursor version (`<ENV> .../bin/cursor --version`), and which extension copy loaded.

  **First launch.**
  - Dismiss onboarding without signing in. Hide `.onboarding-v2-overlay` through the DOM if needed.
  - Toasts are suppressed for about 10 minutes in a fresh profile; read the Notifications center instead.

  **Driving.**
  - Use Playwright `chromium.connectOverCDP`. Resolve `@playwright/test` from the repo with `createRequire`.
  - Find the chrome frame by its `[data-cd-frame-id]` content. Reach each artboard iframe through it.
  - Use `locator.fill()` for text fields.
  - Read state from `aria-*` attributes and visible text, never from internals.
  - Find workbench dialog buttons by role and visible text (`Delete`, `Cancel`).
  - Before the run, read the exact command title from `package.json` `contributes.commands` (today **Vibeboard: Open Artboard**). Read the menu labels and the empty-inspector markers from `PagesMenu.svelte` and `Inspector.svelte`.
  - **Waits.** "Within N s" means: poll every 100 ms for up to N s. Record the observed latency. A timeout is a failure.

  **Stand-ins.** Each uses `Client` from `@modelcontextprotocol/client` and `StdioClientTransport` from its `@modelcontextprotocol/client/stdio` subpath (both resolved from the repo; step 1 found the transport is not on the main entry), with `command: process.execPath`. Each has its own env:
  - **0.5 Agent** (`<S>/vsix/extension/dist/mcp.js`).
    - It declares the `roots` capability and answers `roots/list` with `[{ uri: pathToFileURL(<ws>).href }]`. This is the path Cursor uses.
    - `env` = `PATH`, `HOME=<S>/home`, `VIBEBOARD_WORKSPACE_ROOTS=JSON.stringify([<ws>])`.
    - It never passes `rootPath` (one root).
  - **0.4 Agent** (a copy of the fixture's `mcp.js`). No `roots` capability. `env` = `PATH`, `HOME=<S>/home`, `CURSOR_DESIGN_WORKSPACE_ROOT=<ws>`, `CURSOR_DESIGN_WORKSPACE_ROOTS=JSON.stringify([<ws>])`.
  - **Stale Agent** (`<S>/stale/mcp.js`). No `roots` capability. `env` = `PATH`, `HOME=<S>/home`, `VIBEBOARD_WORKSPACE_ROOT=<ws>`, `VIBEBOARD_WORKSPACE_ROOTS=JSON.stringify([<ws>])`.
  - On `WORKSPACE_BUSY`, retry up to 5 times, 200 ms apart.
  - Each child PID joins the "PID tree is gone" check.
  - A tool's payload is `JSON.parse(result.content[0].text)`. Below, "→" names fields of that payload.

  **B argument table.** B-pre-rename, B-tombstone and B-fresh each call all 11 0.4 tools, in this order, with these exact arguments (corrected in step 1 if `listTools` disagrees). Every argument passes the server's input validation, so a failure comes from disk, not from validation.

  | Tool | Arguments |
  |---|---|
  | `list_artboards` | `{}` |
  | `read_artboard` | `{ artboardId: 'artboard' }` |
  | `set_artboard` | `{ artboardId: 'b-probe', title: 'B probe', html: <p1.html bytes> }` |
  | `update_artboard` | `{ artboardId: 'artboard', html: <p1.html bytes>, baseGeneration: 3 }` |
  | `place_frame` | `{ id: 'artboard', x: 0, y: 0, width: 1280 }` |
  | `set_active_artboard` | `{ artboardId: 'artboard' }` |
  | `list_comments` | `{}` |
  | `get_comment` | `{ id: '2686c08a-ec9f-4742-8365-2120377d4eb3' }` (first id in the fixture's `comments.json`; its status is `resolved`, so on an intact 0.4 copy `resolve_comment` answers `COMMENT_RESOLVED`. That is not a validation failure, and B's outcome is decided by disk) |
  | `resolve_comment` | `{ id: '2686c08a-ec9f-4742-8365-2120377d4eb3', note: 'B probe' }` |
  | `export_artboard` | `{}` |
  | `handoff_status` | `{}` |

  **Fixture HTML.** Write these files to `<S>/html/` before launch 1 and pass their exact bytes:
  - `p1.html` (page 1 `artboard`, title `P1`):
    ```html
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>P1</title></head><body><h1>Page one</h1><p>First paragraph</p><button>One</button></body></html>
    ```
  - `p1-extra.html` (page 1 `p1-extra`, title `P1 extra`):
    ```html
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>P1 extra</title></head><body><h1>Page one extra</h1><p>Extra paragraph</p></body></html>
    ```
  - `p2.html` (page 2 `artboard`, title `P2`):
    ```html
    <!DOCTYPE html><html><head><meta charset="utf-8"><title>P2</title></head><body><h1>Page two</h1><p>Second paragraph</p></body></html>
    ```

  **Clipboard (case G, step 4b).** The scratch Cursor writes the real macOS clipboard.
  - Right before G's Copy click, run `osascript -e 'clipboard info'`. If the clipboard holds anything but plain text:
    - skip the click, because a restore from `pbpaste` would destroy it;
    - record G step 2 as `not run: non-text clipboard`;
    - G steps 3–4 still run, since they do not need the comment sent.
  - Otherwise, save `pbpaste` to `<S>/clipboard-backup.txt`.
  - Right after the click, read the clipboard into the evidence, then restore at once with `pbcopy < <S>/clipboard-backup.txt`, in a `finally` that runs on every exit path from G. Nothing else happens between the save and the restore.
  - Delete `<S>/clipboard-backup.txt` at the end of step 4b, whether G passed or failed, and record whether every restore ran.

  **Evidence per case:**
  - Tree listings: `find <ws> -type f ! -path '*/.vibeboard/.lock' | sort | xargs shasum -a 256`, always over the **whole workspace root** so a write into `.cursor-design/` shows. A case that names a subtree compares that subtree, still cut from the whole-root listing.
  - A screenshot.
  - Each stand-in payload.
  - One line in `<S>/results.jsonl`: `{ case, pass: true | false | "not-run", note }`. Case keys are `A`, `B-pre-rename`, `B-tombstone`, `B-fresh`, `C`, `D`, `E`, `F`, `G`, `H`. Sub-case notes go in `note`.

  **Source-tag grep** (case H): the regexes `data-cd-src="[0-9]+"` and `data-cd-src=&quot;[0-9]+&quot;`, never the bare string. 9g found that `canvas.html` embeds the runtime's selector template.

  **Launch 1: the 0.4 folder (`<S>/ws-legacy`)**
  1. Copy `fixtures/legacy-0.4-workspace/.cursor-design` to `<S>/ws-legacy/.cursor-design`, and save tree listing `T0`. Count `T0`'s `comments.json` comments by status (the fixture has 15: 3 `open`, 7 `sent`, 5 `resolved`; record what is there).
  2. Start the 0.4 Agent on `<S>/ws-legacy` and keep it running through B-pre-rename.
     - Handshake (11 tools), then `list_artboards({})`. It succeeds, which proves the process is alive on the 0.4 layout.
     - The tree still equals `T0`.
  3. Launch Cursor on `<S>/ws-legacy`. Activation runs the rename.
  4. Run **Vibeboard: Open Artboard** from the command palette.

  - **A. Migration.**
    - **A0, rename.** Within 5 s of launch:
      - `<ws>/.cursor-design` is gone;
      - `<ws>/.vibeboard` exists;
      - before Open Artboard, `.vibeboard/` holds `T0` byte for byte, by relative path under the folder. If the page migration has already run (an MCP call from Cursor can trigger it), record that and check A's Disk bullets only.
      - The both-folders branch (`'both'` warning) is covered by `layoutFs.test.ts` only. Record it in the table as auto, and in the real run as `not run: launch 1 has one folder`.
    - **Disk.**
      - Within 5 s of Open Artboard, `.vibeboard/project.json` exists, naming `page-1` / "Page 1".
      - Each of `T0`'s root `manifest.json`, `canvas.json`, `comments.json` and `artboards/*` sits byte-identical under `.vibeboard/pages/page-1/` (sha by relative path).
      - `picking-harness/` and `handoff/` keep their `T0` shas under `.vibeboard/`.
      - `.vibeboard/artboards` is a regular file; its text equals `ARTBOARDS_TOMBSTONE_TEXT` (`src/disk/layout.ts`).
    - **Panel.**
      - The stage's `[data-cd-frame-id]` set equals the ids in `baseline.json`'s `list_artboards` payload.
      - Comments panel:
        - the `Unresolved` section heading's count equals the comment count in the baseline `list_comments` payload;
        - the `Resolved` count equals `T0`'s `resolved` count;
        - the Copy button reads the label `commentsPanel.ts` builds for `T0`'s `open` count (today `Copy 3 open comments for Agent`).

        Read the heading markup from `CommentsPanel.svelte` (`{title} · {count}`).
      - The page button shows "Page 1".
      - The webview console shows zero CSP violations.
    - **Baseline calls.** The 0.5 Agent makes the four baseline calls with the baseline's exact `arguments`: `list_artboards`, `read_artboard`, `list_comments`, `handoff_status`.
      - For each, parse both payloads and delete the top-level `page` key from the new one.
      - The new `page` must equal `{ id: 'page-1', title: 'Page 1' }`.
      - The rest must deep-equal the baseline.
      - A difference that code from 10a–10d, the rename (`79b88ac`), agent-agnostic (`c8bd62f`) or client roots (`460e751`) names (cite file and line) is recorded as `pass` with a note. Any other difference is a failure, recorded with the diff.
  - **B-pre-rename** (the real 0.4 server, still running after the rename).
    - Save the whole-root listing; call it `L0`.
    - The 0.4 Agent calls all 11 tools per the B argument table. Record each result: success or `isError`, and the message.
    - `.vibeboard/`'s part of the listing equals `L0`'s.
    - Record every file the calls created or changed outside `.vibeboard/`. The expected place is a new `.cursor-design/`. These are observations, not failures; step 2's `docs/limits.md` line is worded from them.
    - Close the 0.4 Agent.
  - **B-tombstone** (the stale Agent: a server with the current folder name that predates pages).
    - Save the whole-root listing; call it `L1`.
    - Start the stale Agent on `<S>/ws-legacy` and handshake (11 tools).
    - It calls all 11 tools per the B argument table. Each returns `isError` with `DISK_ERROR` naming `.vibeboard/artboards`. Record each message.
    - The whole-root listing equals `L1`.
    - Close the stale Agent.
  - Quit launch 1 by the relaunch protocol.

  - **Done when:**
    - `A`, `B-pre-rename` and `B-tombstone` each have their `results.jsonl` line, screenshots, stand-in payloads and tree listings.
    - Each passes, is `not-run` with a reason, or is listed under "Failures and new issues" with its output.
    - Every recorded PID from launch 1 and its stand-ins is gone.
    - Check: the files under `<S>` plus `ps -p <recorded PIDs>`.

- [x] **4b. Real Cursor run, launch 2: B-fresh, C, D, E, G, H, F**

  Same rig rules as 4a.

  **Launch 2: a fresh folder (`<S>/ws-fresh`)**
  1. Create an empty `<S>/ws-fresh/`.
  2. Start the stale Agent on it: handshake only, no tool call. A call here would create the pre-pages layout.
  3. Launch Cursor on `<S>/ws-fresh` and run **Vibeboard: Open Artboard**. The 0.5 host creates `.vibeboard/project.json`, `.vibeboard/pages/page-1/` and the tombstone. Record the whole-root listing.

  - **B-fresh.**
    - The stale Agent calls all 11 tools per the B argument table. Each fails with `DISK_ERROR` naming `.vibeboard/artboards`.
    - The whole-root listing is unchanged.
    - Close it.
  - **C. Agent page tools** (0.5 Agent):
    0. `list_artboards` on page 1.
       - If `artboard` is absent, `set_artboard({ artboardId: 'artboard', title: 'P1', html: p1.html })`.
       - Else `read_artboard({ artboardId: 'artboard' })`, then `update_artboard` with `p1.html` and that base.
       - Record which branch ran.
    1. `list_pages` → one page, `openPageId: 'page-1'`.
    2. `create_page({ title: 'Second' })` → `page.id` `page-2`, `artboardId: 'artboard'`, `generation`, `hash`. Within 2 s, the page button reads "Second" and the stage shows exactly the `artboard` frame.
    3. `update_artboard({ artboardId: 'artboard', html: p2.html, baseGeneration: <that generation> })` → success, `page.id` `page-2`. The frame shows "Page two".
    4. `list_pages` → two pages, `openPageId: 'page-2'`, each with an ISO `updatedAt`.
    5. `open_page({ pageId: 'page-1' })` → within 2 s, the panel shows "Page 1" and page 1's frames.
    6. `set_artboard({ artboardId: 'p1-extra', title: 'P1 extra', html: p1-extra.html })`:
       - the file lands under `.vibeboard/pages/page-1/artboards/`;
       - `page.id` is `page-1`;
       - the frame appears on the stage;
       - the `.vibeboard/pages/page-2/` part of the whole-root listing is unchanged.
  - **D. No leaks on a switch.** Page 1 and page 2 both hold a frame with id `artboard`; D uses that pair.
    - **D1, comments and draft (Comment mode).**
      1. On page 1, add comment `c-p1` on the page 1 `artboard` `h1` through the panel; its pin shows.
      2. Pick the page 1 `artboard` `p`, type `draft-p1` into the popover, and do not submit.
      3. Switch to page 2 through the Pages menu. Check:
         - the `[data-cd-frame-id]` set equals page 2's `list_artboards` ids;
         - no pin shows on page 2's `artboard`;
         - the Comments panel lists no `c-p1`;
         - no popover shows `draft-p1`.
      4. Switch straight back to page 1 through the menu. Check:
         - the popover returns with `draft-p1` (the rule is `keptCommentDraft` in `commentPopover.ts`; App owns the slot; a mismatch is a failure);
         - `c-p1` and its pin show.
      5. Press Escape to cancel the draft.
      6. Pick the page 1 `artboard` `p` again and type `draft-p1b`; do not submit. Switch to page 2.
      7. Add comment `c-p2` on the page 2 `artboard` `h1`. Its pin shows on page 2.
      8. Switch back to page 1. Check:
         - no popover shows `draft-p1b`: a new draft on another page replaces the one slot (D8; `keptCommentDraft`);
         - `c-p1` and its pin show;
         - `c-p2` is not listed.
    - **D2, inspector (Edit mode).**
      1. On page 1, enter Edit mode and pick the page 1 `artboard` `h1`. The inspector shows it, with a Content field reading "Page one".
      2. Switch to page 2 through the menu. The mode stays Edit (`pageStart.ts`).
      3. The inspector is mounted with its empty view: no Content field, and Select parent / Select child `aria-disabled="true"` (confirm the markers in `Inspector.svelte`).
    - **D3, Agent switch.**
      1. On page 2, in Edit mode, check that the `c-p2` pin shows. Pins render in every mode: `Pins` is mounted unconditionally in `DesignPage.svelte`. This is the positive control. If the pin does not show, record that and run step 3's pin check in Comment mode instead.
      2. Pick the page 2 `artboard` `h1`. The inspector shows "Page two".
      3. The 0.5 Agent calls `open_page({ pageId: 'page-1' })`. Within 2 s:
         - the frame set is page 1's;
         - the inspector shows the empty view;
         - no `c-p2` pin or listing shows.
  - **E. Edits and undo stay on their page.**
    1. Switch to page 2 through the menu. Save:
       - the `.vibeboard/pages/page-1/` part of the whole-root listing (`P1`);
       - the sha of `.vibeboard/pages/page-2/artboards/artboard.html` (`h0`).
    2. In Edit mode, pick the page 2 `h1`, then `fill('Page two edited')` + Enter. Check:
       - In the whole-root listing, exactly two files change: `.vibeboard/pages/page-2/artboards/artboard.html` and `.vibeboard/pages/page-2/artboards/artboard.meta.json`. Any other changed file is a failure, recorded with its diff.
       - The HTML diff (`diff -u`) touches only the `h1` text.
       - The meta's `hash` equals the code's hash of the new HTML (read `hashHtml`).
       - The generation rose.

       Save the HTML sha `h1`.
    3. Undo → the HTML sha equals `h0`. Redo → it equals `h1`. These sha checks are on the `.html` only; the meta changes on each step.
    4. Switch to page 1 and back to page 2 through the menu.
       - Record Undo's `aria-disabled` right after the switch, under Testing → Observations. It is not part of E's pass. The code (the per-page history target resets on remount; only a focused Edit-mode pick sets it) predicts `"true"`.
       - Click the page 2 `h1` in Edit mode so the frame takes focus and the pick lands. Undo now reads `aria-disabled="false"`, and its name is `Undo in <frame label>`.
       - Undo → the HTML sha equals `h0`. E passes on this host-side history surviving the round trip.
    5. The `.vibeboard/pages/page-1/` part of the listing still equals `P1`.
  - **G. Copy prompt across pages.**
    1. On page 2, add comment `c-g` on the page 2 `artboard` `p` through Comment mode.
    2. Copy it with the panel's Copy prompt (clipboard rule, step 4a).
       - The clipboard text names the comment.
       - `list_comments` on page 2 shows its status `sent`.
    3. Switch to page 1 through the menu. The 0.5 Agent calls `get_comment({ id: <c-g id> })` (read the argument name from `commentTools.ts`). It returns `isError` with `COMMENT_NOT_FOUND`, and the message names `page-2`; record it verbatim.
    4. `open_page({ pageId: 'page-2' })`. Then:
       - `get_comment` succeeds with `page.id` `page-2`;
       - `resolve_comment` succeeds;
       - the panel shows the comment resolved.
  - **H. Export per page.**
    1. `open_page({ pageId: 'page-1' })`, then `export_artboard`. Check:
       - `IMPLEMENT.md` has `page:` and `pageTitle:` lines for page 1 and lists only page 1's frames (`artboard`, `p1-extra`);
       - each `<group or ungrouped>/<id>/index.html` byte-equals its disk file;
       - neither source-tag regex matches any handoff file;
       - `canvas.html` contains none of `data-cd-inspector`, `aria-label="Inspector"`, `Undo in `, `Redo in `.

       Then `handoff_status` → not stale, with this export's id.
    2. `open_page({ pageId: 'page-2' })`, then `handoff_status` → `stale: true` with no `lastExport`: the tool counts a never-exported page as stale (`readHandoffStatus`, `src/disk/exportFs.ts`; SKILL.md "Never exported counts as stale"). Also record that the panel's `handoffStale` flag for page 2 is off (`compareCanvasHandoff`, `handoff.ts`). Corrected in step 1: the earlier `exported: false, stale: false` described `compareCanvasHandoff`, not the tool.
    3. `export_artboard` → a new handoff whose `IMPLEMENT.md` names page 2 and lists only `artboard`.
    4. `open_page({ pageId: 'page-1' })`, then `handoff_status` → still not stale, with step 1's export id.
    5. `read_artboard({ artboardId: 'p1-extra' })`, then `update_artboard` with a one-word text change and that base, then `handoff_status` → page 1 stale.
    6. `open_page({ pageId: 'page-2' })`, then `handoff_status` → page 2 not stale.
  - **F. Rename and delete** (last, because it removes pages). Pages at start: page-1, page-2.
    1. **Rename** page 2 through the menu:
       - `fill('Renamed')` + Enter → `project.json` has the title, and the page button and menu row read "Renamed".
       - Rename with Escape → no change on disk.
       - Rename to `''` + Enter → the panel shows the title error copy (read it from the code). Nothing is written.
    2. **New blank page** → `page-3` opens.
    3. **Delete page 3, the open page,** through the menu. The workbench dialog shows `Delete "<title>"?` (if it opens natively instead, follow the step 4a profile rule). Click Delete. Check:
       - `.vibeboard/pages/page-3/` is gone;
       - `.vibeboard/deleted/page-3-<stamp>/` holds its files;
       - `project.json` no longer lists it;
       - its previous neighbour opens, page 2 by `deletePage` in `pageOps.ts`.
    4. **Delete page 2, then click Cancel** → the whole-root listing is unchanged.
    5. **New blank page** → its id is `page-4`, never `page-3`.
    6. **Delete down to one page:** delete `page-4`, then `page-2`, each confirmed in the dialog. `page-1` remains.
    7. **Last page.** On page 1's row, Delete reads `aria-disabled="true"`. Clicking it shows no dialog, and the whole-root listing and `project.json` stay unchanged.
    8. Quit launch 2 by the relaunch protocol.

  - **Done when:**
    - Every 4b case key has its `results.jsonl` line, screenshots, stand-in payloads and tree listings.
    - Each case passes, is `not-run` with a reason, or is listed under "Failures and new issues" with its output.
    - Every recorded PID (Cursor trees and stand-ins) is gone.
    - The clipboard backup file is deleted, whatever G's result.
    - `/tmp/vb10e` is removed, after `readlink` confirms it points to `<S>/profile`.
    - The `stat` of Bombic's `~/.cursor/extensions` and `~/.cursor/skills/vibeboard` equals the step 4a record. If it differs, record whether his own Cursor started during the run, and list it under "Failures and new issues".
    - Check: the files under `<S>` plus `ps -p <recorded PIDs>`.

- [x] **5. F-20 lead: `list_pages` cost**
  1. **Build the folder.** Stdio only, no Cursor. On an empty `<S>/ws-perf`, the 0.5 Agent makes 100 `create_page({ title: 'P<n>' })` calls. `MAX_PAGES` is 100, and the first call fills the blank Page 1 (10c), so the folder ends with exactly 100 pages: `page-1` … `page-100`. Record the final `list_pages` count. Right after each `create_page`, while that page is open, the Agent makes 9 `set_artboard` calls with ids `f2` … `f10`, each with a 2 KB document. Each page then holds 10 artboards (`artboard`, `f2`–`f10`).
  2. **Time the calls.**
     - 7 `list_pages` calls from the client. Drop the first; report the median and max of the other 6.
     - The same for `list_artboards`, as a reference.
     - The queueing cost F-20 names: 5 times, send `list_pages` and then, without awaiting it, `list_artboards`, in that order. `enqueueDiskOp` serializes them. Record `list_artboards`'s latency against its solo median, and the send order.
  3. **Record** the machine (`sysctl -n machdep.cpu.brand_string`) and the folder's file count. The panel builds the same list on every `canvas:updated`, so the number also bounds that cost.
  4. **Verdict.** `supports accepting` if the `list_pages` median is under 100 ms, else `confirms the risk`. 100 ms is a chosen heuristic, not from F-20 or the plan: below what a person notices on a menu, and far under the 2 s lock wait. Report the ratio to `list_artboards` as well. `/audit` decides the status.
  - **Done when:** Testing → Leads has the method, numbers and verdict, and no stand-in process remains. Check: Testing plus `ps`.

- [x] **6. Overview, clean-up and final gates**
  - **Overview.** Run the repo's `/overview` command to regenerate `blueprint/context/project-overview.md` from the step 2 `project-plan.md`.
    - If it proposes a `build-plan.md` or `findings.md` edit, discard it and record that in Notes.
    - If it raises a question that needs Bombic, stop the step and ask.
  - **Gates.** Run `pnpm verify` (rebuilds the dev `dist/` and replaces the minified pack), then one full `pnpm test:browser`. Record their counts against the step 1 baseline.
  - **Record.** Fill the evidence table's last column, the drafted Notion patch and **Status**.
  - **Done when:**
    - Both commands exit 0, or a failure is recorded with its output and the run stops for the lead.
    - `dist/mcp.js.map` exists.
    - `git status --short` lists changes only in:
      - `README.md`, `docs/limits.md`, `docs/edit-mode.md`;
      - `skills/vibeboard/SKILL.md`, `.claude/rules/02-mcp-webview.md`, `blueprint/project-plan.md`;
      - these files under `blueprint/context/`: `project-overview.md`, `system-map.md`, `current-feature.md`, `current-feature-overview.md` and `feature-review.md`.

      It lists no untracked file.
    - Check: those commands.

- [x] **7. Repair the 10e audit findings F-30–F-36** (Bombic, 2026-11-26: "fix all the [findings]"; F-36 is the one `src/` change, which Out of scope had excluded, approved by that ask)
  - F-30, F-31, F-34, F-35: `project-plan.md` §3/§5/§7, `docs/limits.md`, system-map Stale node, and the overview lines from the reference plan (edited in place, source-hash recomputed, 19,990 bytes).
  - F-32: the system-map Pages menu focus condition names the page button.
  - F-33: README Pages qualifiers.
  - F-36: the six read tools' descriptions in `artboardTools.ts`, `commentTools.ts` and `pageTools.ts`; `ponytail:` on `READ_ONLY_ANNOTATIONS` (`mcpToolResult.ts`). `readOnlyHint` is kept (product call for Bombic). SKILL.md unchanged: it already says the first call may move an older folder.
  - Re-review rounds (Opus 5.5, fresh context each) closed F-30–F-36. Two of the six description rewrites had missed (a pattern needed a trailing space), so all six now carry one sentence. F-30 also fixed the same "0.4 fails on the tombstone" framing in `layout.ts`, two `openPage.ts` comments and an `openPage.test.ts` test name. The reviews raised F-37 (the `build-plan.md` 10e line, Bombic's) and F-38 (the D5 note, reworded in `openPage.ts` and the system map, `fixed`).
  - **Done when:** each finding is `fixed` with a Resolution; `pnpm run check`, `vp test src/mcp` (10 files, 77 tests) and `pnpm verify` (73 files, 879 tests) pass; the overview is under 20,000 bytes (19,993).

## Files / areas

- **Changed:**
  - `README.md`
  - `docs/limits.md`, `docs/edit-mode.md` (drift, plus the two `limits.md` lines)
  - `skills/vibeboard/SKILL.md` (drift only)
  - `.claude/rules/02-mcp-webview.md` (drift only)
  - `blueprint/context/system-map.md` (drift only)
  - `blueprint/project-plan.md` (§3, §5, §7)
  - `blueprint/context/project-overview.md` (regenerated)
  - `blueprint/context/current-feature.md`
  - `blueprint/context/current-feature-overview.md`
- **Read, not changed:** `src/**`, `tests/browser/**`, `package.json`, `fixtures/legacy-0.4-workspace/**`, `blueprint/build-plan.md`, `blueprint/context/findings.md`.
- **Temporary, never committed:** `vibeboard-0.1.0.vsix` at the repo root (gitignored). Leave `cursor-design-0.1.0.vsix` alone.
- **Scratch:** `<S>` = `<implementing session's scratchpad>/10e/`. It holds:
  - `home/`, `profile/` (`/tmp/vb10e` → it, removed in 4b), `extensions/`, `vsix/`, `stale/`;
  - `html/`, `ws-legacy/`, `ws-fresh/`, `ws-perf/`;
  - the stand-in `.mjs` scripts, CDP helpers, `results.jsonl`, tree listings, screenshots and diffs.

## Data / contracts

No contract changes. This run exercises the following shipped contracts; read each from code before use.

- **MCP over stdio.** `dist/mcp.js` (server `vibeboard`, 14 tools).
  - Workspace: a client that declares `roots` is the authority: its `roots/list` answer, re-fetched after `roots/list_changed`. No answer or no folders means `NO_WORKSPACE`, never the env. Only a client without `roots` gets `VIBEBOARD_WORKSPACE_ROOTS` (preferred) or `VIBEBOARD_WORKSPACE_ROOT` (`allowedWorkspaceRoots`, `resolveWorkspaceRoot.ts`).
  - Every success payload of the 11 non-page tools carries `page: { id, title } | null`. Error results and the page tools (`list_pages`, `create_page`, `open_page`) carry none.
  - `list_pages()` → `{ openPageId, pages: [{ id, title, updatedAt }] }`. `updatedAt` comes from file mtimes (`pageUpdatedAt`), or `null` for an unreadable page.
  - `create_page({ title })` → `{ page, artboardId, generation, hash }`, and opens the page. In a never-opened folder, the first call fills the blank Page 1.
  - `open_page({ pageId })` → `{ page }`.
  - `handoff_status` on a page never exported reports `stale: true` with no `lastExport` (`readHandoffStatus`, `exportFs.ts`). The panel's `handoffStale` flag uses `compareCanvasHandoff` and is off for a never-exported page.
- **0.4 MCP.** `fixtures/legacy-0.4-workspace/dist/mcp.js`:
  - It has 11 tools and works on root `artboards/` under the hard-coded `.cursor-design/`.
  - It reads `CURSOR_DESIGN_WORKSPACE_ROOT(S)` only, and does not use client roots.
  - With a tombstone file at its `artboards` path, each tool fails with `DISK_ERROR` naming that path (10a evidence, archive line 600).
  - The stale copy (step 1) is the same code with the folder constant and env names swapped, so it names `.vibeboard/artboards`.
  - `baseline.json` is `[{ name, arguments, result }]`. Each `result` is an MCP envelope with its payload in `content[0].text`.
- **Disk.**
  - Activate: `migrateLegacyDesignFolders` renames `.cursor-design/` to `.vibeboard/` in each workspace folder when only the old one exists (`'moved'`). When both exist, it warns once and ignores the old one (`'both'`). It leaves nothing at `.cursor-design/`.
  - `project.json`: `{ version: 1, openPageId, pages: [{ id, title }] }`.
  - `pages/<id>/{manifest.json, canvas.json, comments.json, artboards/}`. Each artboard is `<id>.html` plus `<id>.meta.json`.
  - Root `artboards` is a tombstone file holding `ARTBOARDS_TOMBSTONE_TEXT`.
  - `deleted/<id>-<stamp>/`.
  - Page ids are never reused.
  - Deleting the open page opens its previous neighbour, else the next.
  - A panel edit, undo or redo writes the artboard HTML and its meta (generation, hash) through `updateArtboard`.
  - Handoffs are at the root and export the open page. `IMPLEMENT.md` has `page:` / `pageTitle:` lines. `lastExport` is in the page's manifest.
- **Panel.**
  - `canvas:updated` carries `pageId` and `pages`.
  - `page:open|create|rename|delete` are each answered once by `page:saved` or `ui:error`, then `refreshPanel`.
  - Delete asks `showWarningMessage(…, { modal: true, detail: … })`. The detail names `.vibeboard/deleted/`; read the exact text from `panelPages.ts`.
  - Undo history is host-side, keyed by page and frame, and forgotten on delete.
  - The chrome's Undo target is per page and set only by a focused Edit-mode pick.
  - The inspector mounts only in Edit mode. Pins render in every mode.
  - The comment-draft slot is App-owned and holds one draft. `keptCommentDraft` keeps it across a switch, and a new draft on another page replaces it.
  - Comments panel sections: `Unresolved` and `Resolved`, each headed `{title} · {count}`.
- **Comments.** `get_comment` / `resolve_comment` on an id held by another page return `COMMENT_NOT_FOUND` naming that page. `list_comments({})` lists unresolved comments only.
- **Markers.** Source tags `data-cd-src="N"` exist only in the posted frame copy. The inspector root is `<aside aria-label="Inspector" data-cd-inspector>`, in the chrome only.

## Testing

### Done-when evidence table

Dispositions: **auto** = a named existing test (step 1); **real** = this run's case (steps 4–5); **not run** = with a reason.

| # | Clause | Existing automated evidence (step 1) | Real-run evidence (steps 4–5) |
|---|---|---|---|
| N1 | Existing single-design folders migrate to page one automatically | `src/disk/openPage.test.ts` › "each legacy subset migrates into page-1 byte for byte", "every interrupted migration resumes to the clean result", "a second resolve on a migrated folder writes nothing"; `src/mcp/artboardTools.contract.test.ts` › "a 0.4 folder migrates on the first call, whose result names page-1"; `src/disk/layoutFs.test.ts` › "migrateLegacyDesignDir moves only the old folder, never over a new one". The activate wrapper `migrateLegacyDesignFolders` (log line, `'both'` warning) has no test; the 10a baseline.json deep-equal was a scratch probe, not committed. | A pass (stand-ins): `mv` rename + first 0.5 call migrates to page-1 byte-identical; baseline calls deep-equal. Activate-time rename not run (Cursor 3.32 blocks CDP; `layoutFs.test.ts`). |
| N2 | Pages menu lists pages with last-edited times; New blank page, rename and delete work | List and times: `src/disk/pageOps.test.ts` › "listPages keeps index order; updatedAt is the newest design file, else the folder"; `src/webview/pagesMenu.test.ts` › "pageRows keeps order, marks the open page and times each row"; `tests/browser/pagesMenu.spec.ts` › "the menu lists pages in order with their times and marks the open page"; `src/host/artboardDisk.test.ts` › "the page list rides on the frames, empty and failed snapshots of the resolved page". New / rename / delete: `pageOps.test.ts` › "createPage next to a page-1 with a manifest appends a page, opens it, and omits to \"Page <n>\"", "renamePage retitles in place and refuses a bad id, a bad title and an unlisted id", "deletePage moves the folder to deleted/ and opens the previous neighbour, else the next"; `src/host/panelPages.test.ts` › "each request type answers page:saved after its write, then refreshes", "a confirmed delete deletes, forgets only that page's histories, answers page:saved"; `pagesMenu.spec.ts` › "New blank page posts page:create", "rename posts the raw draft; an error shows under the editable field", "delete posts page:delete; a cancel closes, a confirm drops the row", "the whole flow works from the keyboard". | C pass: `list_pages` ISO `updatedAt`, `create_page`. Menu, New blank page, rename, delete (F) not run: Cursor 3.32 blocks CDP; stand-ins `pagesMenu.spec.ts`, `panelPages.test.ts`, `pageOps.test.ts`. |
| N3 | Switching page loads that page's frames and comments only | `tests/browser/pages.spec.ts` › "switching drops the pins, the open thread and the reply composers", "switching drops the pick, the inspector draft and the hover and pick outlines", "comments for A never draw on B, and B's early list shows once B is staged", "an answer to an A edit arriving after the switch to B changes nothing on B"; `src/webview/pageStart.test.ts` › "only a real page other than the staged one is a page change", "a comment list applies to its own page or as a no-page list, never to another page"; `src/host/canvasSnapshot.test.ts` › "the same frame id on another page keeps its own memo entry"; `src/host/panelComments.test.ts` › "a request for page-2 while page-1 is open acts on page-2's location"; `src/host/artboardDisk.test.ts` › "a frame:place for page-1 while page-2 is open places on page-1's location". | Partial: C step 6 and H keep MCP writes/exports on the open page. Panel switch (D, E) not run: Cursor 3.32 blocks CDP; stand-ins `pages.spec.ts`, `editHistory.test.ts`. |
| N4 | Agent can `list_pages`, `create_page` and `open_page`; other MCP tools stay scoped to the open page | `src/mcp/pageTools.contract.test.ts` › "create_page, list_pages and open_page success shapes", "after open_page(\"page-2\") the artboard and comment tools act on page-2 only", "a fresh folder: list_pages is empty, open_page is PAGE_NOT_FOUND, a bad title refuses; nothing is written"; `src/mcp/commentTools.contract.test.ts` › "listTools returns the 8 artboard, 3 comment and 3 page names", "with page-2 open, every tool reads and writes page-2 and leaves page-1 byte-identical"; `src/mcp/artboardTools.contract.test.ts` › "every artboard tool success carries the open page read before the op"; `src/mcp/agentSkill.test.ts` › "every registered MCP tool is documented in the skill". The panel following an Agent `open_page` is covered only at the refresh level (`src/host/refreshPanel.test.ts` › "a slow read overtaken by a newer refresh posts nothing; the newer posts snapshot then comments"); no committed test drives Cursor. | C, G (steps 3–4), H pass: `list_pages`/`create_page`/`open_page` work; other tools act on the open page; `get_comment` names page-2. |
| N5 | F5 dogfood passes; export/handoff still clean | F5 dogfood: none (real run only). Export/handoff clean: `src/disk/handoff.test.ts` › "canvas export writes one tree, pristine frames, and lastExport.frames", "comments.json does not change export files or bytes", "status turns stale on any frame HTML change, add, or delete"; `src/disk/handoffCanvasHtml.test.ts` › "decoded srcdoc is exactly the preview copy and its tail is the frame HTML"; `src/host/canvasSnapshot.test.ts` › "the posted hash is the disk html hash, not the tagged copy hash"; `tests/browser/frameCsp.spec.ts` › "under the chrome CSP, a styled frame and its pin log no violation". | Partial: A, B-*, C, G (MCP), H pass on the packaged `mcp.js`; export/handoff clean (H). No F5/real-Cursor dogfood: Cursor 3.32 blocks CDP; Bombic's 2026-11-26 21:20 session is the only real-Cursor Agent call. |
| A | 0.4 workspace moves to `.vibeboard/` and migrates unchanged: same stage, comments, flags, `handoff_status` | `src/disk/openPage.test.ts` › "each legacy subset migrates into page-1 byte for byte", "every interrupted migration resumes to the clean result", "unknown root entries stay where they are, byte for byte"; `src/mcp/artboardTools.contract.test.ts` › "a 0.4 folder migrates on the first call, whose result names page-1"; `src/disk/layoutFs.test.ts` › "migrateLegacyDesignDir moves only the old folder, never over a new one" (covers the `'moved'` and `'both'` results; this is the only coverage of the both-folders branch). None for: the activate-time wrapper and its warning, the baseline.json deep-equal (10a scratch probe only), stage/comments/flags parity after migration, and the Comments panel counts. | Pass: A0 by `mv` (activate path not run), Disk all bullets, baseline 4/4 equal with `page` = page-1; Panel not run (disk supports 21 frames, 10/5 comments, Copy 3). Both-folders not run: launch 1 has one folder. |
| B | A stale server fails on the tombstone, after a migration and in a fresh folder; the real 0.4 server never touches `.vibeboard/` | Tombstone and layout: `src/disk/openPage.test.ts` › "a fresh write creates the index, the tombstone and an empty page-1", "an indexed folder rewrites a deleted tombstone and nothing else", "a stale artboards folder between the move and the tombstone is a conflict"; `src/disk/artboardFs.test.ts` › "the root tombstone passes the dir check; a symlink or a file at the page artboards dir is refused"; `src/mcp/artboardTools.contract.test.ts` › "set_artboard on a fresh root creates the project, the tombstone and the page-1 artboard"; `src/disk/errors.test.ts` › "the project index errors name project.json and the next step". None for: an actual older server failing on the tombstone, and the real 0.4 server leaving `.vibeboard/` untouched (10a scratch probe only; this run proves them). | B-pre-rename pass (`.vibeboard/` untouched; 0.4 recreated `.cursor-design/`), B-tombstone pass (11/11 `DISK_ERROR`, tree = L1), B-fresh pass (11/11 `DISK_ERROR`, tree unchanged). |
| C | Agent page tools drive the panel; existing tools stay on the open page | `src/mcp/pageTools.contract.test.ts` › "create_page, list_pages and open_page success shapes", "after open_page(\"page-2\") the artboard and comment tools act on page-2 only", "create_page writes .ensure-panel only for the first root"; `src/mcp/commentTools.contract.test.ts` › "with page-2 open, every tool reads and writes page-2 and leaves page-1 byte-identical"; `src/mcp/artboardTools.contract.test.ts` › "every artboard tool success carries the open page read before the op"; `src/disk/pageOps.test.ts` › "createPage on a folder never opened fills page-1 with the title and the default artboard", "openPage writes openPageId, and leaves project.json alone when the page is already open"; `src/mcp/resolveWorkspaceRoot.test.ts` › "a client with roots: tools act on its root, not the env root, and rootPath must be one of them", "a client without roots: the env roots are used". The panel moving on an Agent page tool: none. | Pass on MCP steps 0–6; panel bullets not run: Cursor 3.32 blocks CDP. |
| D | No frame, comment, pin or inspector leak on a switch (same-id frames); the comment draft returns with its page and a draft on another page replaces it | Comments, draft, pins: `tests/browser/pages.spec.ts` › "a comment draft on A is gone on B and comes back on A", "a new draft on B replaces A's slot, and B's request names B", "switching drops the pins, the open thread and the reply composers", "comments for A never draw on B, and B's early list shows once B is staged"; `src/webview/commentPopover.test.ts` › "the draft slot: a page writes its own draft and clears only its own slot", "a held draft comes back only in Comment mode on a live iframe frame"; `src/webview/pageStart.test.ts` › "a held draft starts only on its own page, and then wins over the saved thread", "the mode carries over from the leaving page, else from the staged start". Inspector: `pages.spec.ts` › "switching drops the pick, the inspector draft and the hover and pick outlines", "the mode and the comments panel's open state carry across a switch"; `src/webview/editInspector.test.ts` › "no pick, or a pick without edit fields, shows the empty inspector". Same-id frames: `src/webview/pins.test.ts` › "a forged cd:anchor-rects from frame A with a frame B id moves nothing in B". The Agent-driven switch through real Cursor and Select parent/child `aria-disabled` on the empty view: none. | Not run: Cursor 3.32 blocks CDP (stand-ins `pages.spec.ts`, `commentPopover.test.ts`). |
| E | Edit and undo on page 2 leave page 1 byte-identical; history survives a round trip | `src/host/panelEdit.history.test.ts` › "undo for page-2 while page-1 is open steps page-2 and reads and records its history only", "a page-2 step's conflict forgets page-2's history and keeps page-1's for the same frame id", "undo restores the exact original bytes, redo the edited ones"; `src/host/editHistory.test.ts` › "the same frame id on two pages keeps two independent histories", "A's history survives an A → B → A round trip when A's hashes are unchanged", "a snapshot of page B neither forgets nor reads page A's history"; `src/disk/artboardEditFs.test.ts` › "a style edit writes only that declaration and returns the new hash and generation"; `src/host/panelOutbox.test.ts` › "canvas:updated reads the flags of the posted page only"; `src/webview/undoRedo.test.ts` › "historyTarget names the frame and its flags, or nothing without one". Page 1 byte-identical through a page-2 edit through the panel in real Cursor, and Undo's `aria-disabled` after a round trip: none. | Not run: Cursor 3.32 blocks CDP (stand-ins `editHistory.test.ts`, `pages.spec.ts`, `editMode.spec.ts`). |
| F | Rename; delete (dialog, `deleted/`, neighbour opens, last page blocked, ids not reused) | Rename: `src/disk/pageOps.test.ts` › "renamePage retitles in place and refuses a bad id, a bad title and an unlisted id"; `src/host/panelRequestCopy.test.ts` › "pageRequestErrorMessage: panel copy by reason and type, domain copy for busy and disk"; `tests/browser/pagesMenu.spec.ts` › "rename posts the raw draft; an error shows under the editable field", "Escape in the rename field cancels, posts nothing and focuses Rename". Delete: `pageOps.test.ts` › "deletePage moves the folder to deleted/ and opens the previous neighbour, else the next", "createPage never reuses an id: unindexed pages/ names of any kind, past 100, and deleted pages"; `src/host/panelPages.test.ts` › "delete of an unlisted id, with no project.json, or of the last page refuses before the modal", "a cancelled modal answers page:saved, deletes nothing and refreshes", "a confirmed delete deletes, forgets only that page's histories, answers page:saved"; `src/webview/pagesMenu.test.ts` › "pageRows: the last page cannot be deleted, and an unlisted open id marks no row"; `pagesMenu.spec.ts` › "Delete is disabled on the last page", "delete posts page:delete; a cancel closes, a confirm drops the row". The real workbench modal (custom dialog click): none. | Not run: Cursor 3.32 blocks CDP (stand-ins `pagesMenu.spec.ts`, `panelPages.test.ts`, `pageOps.test.ts`). |
| G | Copy prompt on page 2 with page 1 open; `get_comment` names page 2; resolves after `open_page` | `src/mcp/commentTools.contract.test.ts` › "get_comment and resolve_comment name the page holding a comment missing from the open page", "a comment id on no page keeps the plain COMMENT_NOT_FOUND text past a corrupt page"; `src/disk/errors.test.ts` › "CommentNotFoundError names the page holding the id when found elsewhere"; `src/host/panelComments.test.ts` › "copy writes the clipboard, then marks sent, then answers, then refreshes", "a request for page-2 while page-1 is open acts on page-2's location"; `src/host/commentPrompt.test.ts` › "single prompt is the locked Notion template, word for word"; `src/disk/comments.test.ts` › "markCommentsSent marks only open comments and skips unknown ids", "resolveComment on resolved throws, appends a trimmed agent reply otherwise"; `tests/browser/commentsPanel.spec.ts` › "Copy for Agent posts one copy, blocks every other copy, and shows the answer". The real clipboard write: none. | Steps 3–4 pass with a comment seeded by file edit (verbatim `COMMENT_NOT_FOUND` naming page-2; resolves after `open_page`); steps 1–2 and the panel bullet not run: Cursor 3.32 blocks CDP. |
| H | Export per page clean; `IMPLEMENT.md` names its page; `handoff_status` per page | `src/disk/handoff.test.ts` › "buildCanvasImplementMarkdown orders sections and frames, collapses newlines, lists paths" (page:/pageTitle: lines), "canvas export writes one tree, pristine frames, and lastExport.frames", "export titles the page by its default name when project.json has no entry for it", "status is stale=false right after a canvas export and keeps active fields", "status turns stale on any frame HTML change, add, or delete", "never exported is stale without lastExport" (the tool returns stale true here, see the discrepancy above), "compareCanvasHandoff covers never exported, unchanged, changed, added, removed, unreadable, order"; `src/mcp/commentTools.contract.test.ts` › "with page-2 open, every tool reads and writes page-2 and leaves page-1 byte-identical" (export writes page-2's `lastExport` only); `src/disk/canvasView.test.ts` › "handoffStale is off before export and right after it, on after an HTML change"; `src/disk/handoffCanvasHtml.test.ts` › "one sandboxed srcdoc iframe per frame with title and data-cd-frame". None for: the two source-tag regexes over a real export, and the `canvas.html` inspector markers (`data-cd-inspector`, `aria-label="Inspector"`, `Undo in `, `Redo in `); `src/disk/sourceTags.test.ts` and `canvasSnapshot.test.ts` cover only the posted copy. | Pass, steps 1–6 (per-page `IMPLEMENT.md`, byte-equal `index.html`, no source tags, no chrome markers, per-page `handoff_status`). |
| F-20 | `list_pages` cost at 100 pages × 10 frames | none (only the `ponytail:` comment above `listPages` in `src/disk/pageOps.ts` names the O(pages x frames) lstat cost; the 100-page tests, e.g. `pageOps.test.ts` › "createPage refuses a full project with nothing written", check the cap, not timing) | step 5: `supports accepting` (`list_pages` median 26.45 ms at 100 pages × 10 frames; see Leads) |

### Preconditions (step 1)

- Branch `feature/verify` from local `main`; recorded `HEAD` `9241f71b7745bf446476f87ae6e4b4f0f83f4e17` = `git rev-parse main`.
- Baseline `pnpm verify`: exit 0, **73 test files, 879 tests** passed (log `<S>/baseline-verify.log`).
- Stand-in deps resolve from the repo: `@modelcontextprotocol/client` 2.4.0 (`dist/index.cjs`; `StdioClientTransport` from the `/stdio` subpath, `dist/stdio.cjs`) and `@playwright/test` 1.65.1.
- 0.4 reference: `.cursor-design/` holds root `artboards/`, `manifest.json`, `canvas.json`, `comments.json` (plus `handoff/`, `picking-harness/`); `baseline.json` = 4 entries (`list_artboards`, `read_artboard`, `list_comments`, `handoff_status`, all with `{}` arguments). The fixture `mcp.js` (sha256 `f68210ace1ec9db628566a3f3f91bcc9f979e54756c485ea81b6d9586bb47a0d`), started as the 0.4 Agent on a scratch copy, lists 11 tools. Comments: 15 (3 `open`, 7 `sent`, 5 `resolved`).
- B argument table vs `listTools`: no name mismatch (0.4 schemas are untyped `additionalProperties: true`; names checked against the descriptions and a dry run on a throwaway copy: all 11 pass validation, `resolve_comment` answers `COMMENT_RESOLVED` because the table's id is resolved; table kept, note added).
- Stale server `<S>/stale/mcp.js`: `` `.cursor-design` `` 1 → 0, `CURSOR_DESIGN_WORKSPACE` 3 → 0, `VIBEBOARD_WORKSPACE_ROOT` 0 → 3. Remaining `cursor-design` strings are tool-description prose, stderr/error prefixes and the server name, none a path or env name. sha256 `756c3f71e758a8e11a8db20ee06fa538ceed48f988eec529c7cbfd31e861af45`; lists 11 tools on an empty folder (handshake only; the folder stayed empty).
- Spec corrections from code, made before any run: the stand-in transport import (rig rules); case H step 2 and the matching Data / contracts bullet (`handoff_status` counts never exported as stale).
- Every step 1 child PID is gone (`ps -p`).

### Docs

- **README `## Pages`** (new, after `## Edit mode`, in `## Contents`): page button + menu with last-edited times (`PagesMenu.svelte`, `pageRows` in `pagesMenu.ts`, `pageUpdatedAt` in `pageOps.ts`); New blank page = one blank artboard titled `Page <n>`, up to 100 (`createPage`, `pageTitle`, `MAX_PAGES` in `layout.ts`); Rename Enter/Esc, 1–80 chars (`handleRenameKeydown`, `parsePageTitle` in `parse.ts`, `MAX_PAGE_TITLE_CHARS`); Delete confirm, `.vibeboard/deleted/` never emptied, open page → previous neighbour else next, last page blocked (`confirmAndDeletePage` in `panelPages.ts`, `deletePage`, `deletedDirSegments`); Agent `open_page`/`create_page` move the panel (`pageTools.ts`); keys (`toggle`, `cancelRename` in `pagesMenuState.svelte.ts`, `nextRowIndex`, `handleMenuKeydown`).
- **README `## Commands`:** Export Handoff exports "every frame on the open page", not "on the canvas" (`exportHandoff.ts` → `resolveOpenPage`).
- **README `## MCP tools`, `## Limits`, Quick start "Updating?":** checked, no drift (14 tools match `toolNames.ts`, `artboardTools.ts`, `commentTools.ts`, `pageTools.ts`).
- **`docs/limits.md`:** new Setup bullet "Coming from cursor-design 0.4" (`migrateLegacyFolders` in `hostFs.ts` inside `syncHostRuntime`, trusted only, `extension.ts`; `migrateLegacyDesignDir` `'both'` in `layoutFs.ts`; the 0.4 `mcp.js` `mkdir {recursive:true}` on `.cursor-design`; confirmed by B-pre-rename in 4a); Pages bullet gains the downgrade sentence (0.4 `mcp.js` hard-codes `.cursor-design` and a root `artboards/`); Older server bullet drops the outdated "may take no lock" and says a pre-pages server on `.vibeboard/` fails on the root `artboards` file with `DISK_ERROR` (`ARTBOARDS_TOMBSTONE_TEXT`, `artboardsTombstoneSegments` in `layout.ts`, `writeArtboardsTombstone` in `openPage.ts`); Updating in Cursor: no drift.
- **`docs/edit-mode.md`:** undo history is per page (`HistoryKey`, `keyText` in `editHistory.ts`), kept until the panel closes, the folders change or its page is deleted (`forgetPageHistories` in `panelPages.ts`); after a page switch Undo/Redo stay disabled until a new Edit-mode pick (`historyFrameId` in the per-page `EditState`, `editState.svelte.ts`, remounted under `{#key}`). Inspector prose: no drift.
- **`skills/vibeboard/SKILL.md`:** checked, no drift (tools, arguments, result shapes, limits vs `src/mcp/*`, `layout.ts`, `parse.ts`; codes vs `errors.ts`; Pages/tombstone prose vs `pageOps.ts`, `openPage.ts`; "Never exported counts as stale" vs `readHandoffStatus`).
- **Rule 02:** root list adds `deleted/<id>-<stamp>/` (`deletedPageDirSegments`); `createIfFresh` callers are `set_artboard`, `createPage` and Open Artboard (`pageOps.ts`); only `page:open|rename|delete` carry a target `pageId`, `page:create` none (`PageCreateMessage` in `hostMessages.ts`).
- **System map:** 10a chart adds host caller `answerPageRequest (10d)` (`panelPages.ts`); 10a Writes: every write tool but `set_artboard` and `create_page` refuses in a fresh folder; stale node renamed "stale pre-pages MCP process on .vibeboard/"; new "Pre-rename folder" bullet (`migrateLegacyDesignFolders`, `migrateLegacyDesignDir`); 10c "panel learns of an Agent's page change only through the watcher" (`answerPageRequest` → `refreshPanel`). 10b, 10d: no drift. "Last verified" line untouched.
- **`blueprint/project-plan.md`:** §3 adds 0.3 Comments and 0.5 Projects + pages paragraphs (archives 08e, 10a–10d, `build-plan.md`); §5 Host drops the esbuild fallback, MCP = two `vp pack` outputs, server `vibeboard`, 14 tools, client roots then env, Verify = `pnpm verify` + `pnpm test:browser` + F5, chrome tokens `--cd-*` in `theme.css`; §7 lists the real toolbar (`Toolbar.svelte`) and a 0.5 paragraph (system map 10b, `pagesMenu.ts`). §1, §2, §4 untouched.
- Checks: `pnpm run check` pass (first run failed on README table alignment; `vp check --fix` realigned only that table); `pnpm exec vp test src/mcp/agentSkill.test.ts` 1 file, 9 tests pass. Diff stat: rule 02 6, README 30, system-map 15, project-plan 16, edit-mode 2, limits 5.

### Package (step 3)

- `pnpm vsix`: exit 0, `vibeboard-0.1.0.vsix` (13 files, 376.17 KB; sha256 `8eab4dab168fb2e2118f7868bbaf33b9d88b1a33e2d10dfee9bf116150e9ddcd`). Listing `<S>/vsix-listing.txt`: `extension/package.json` (`vibeboard`, `bombic`, `0.1.0`), `extension/readme.md`, `extension/dist/{extension.js,mcp.js}`, `extension/dist/webview/{chrome.js,chrome.css}`, `extension/skills/vibeboard/SKILL.md`; 0 `node_modules` / `fixtures/` entries. The stale `cursor-design-0.1.0.vsix` is no longer at the repo root (moved to Trash earlier on 2026-11-26).
- Extracted to `<S>/vsix/`; `cmp` extracted SKILL.md = `skills/vibeboard/SKILL.md`. Packaged `mcp.js` sha256 `cc9f46f78e0b60105a0ad35bdd280b78da483632165b0738523dd01ff5b1e8cf`.
- Env fallback: the packaged `mcp.js`, started by a client without `roots` and `VIBEBOARD_WORKSPACE_ROOTS=[<S>/ws-envfallback]`, logs "workspace roots from env fallback (client has no roots capability)", lists 14 tools, and `list_pages` returns `{"openPageId":null,"pages":[]}` (no error, nothing written). PID 70761 gone (`<S>/envfallback.json`).

### Real run

- **Rig.** Revised 4a/4b: no Cursor launch (Cursor 3.32 blocks CDP). One Node orchestrator (`<S>/r4/run4.mjs`) drives five stdio stand-ins in sequence: 0.4 Agent pid 87634 (ws-legacy), 0.5 Agent pid 87658 (ws-legacy), stale Agent pid 87717 (ws-legacy), stale Agent pid 87729 (ws-fresh), 0.5 Agent pid 87734 (ws-fresh); plus a handshake re-check stale pid 88027 (`<S>/r4/ws-hs`). `ps -p` on all six: gone. `pgrep -f scratchpad/10e`: none.
- **A** — pass. T0: 421 files, comments 15 (3 `open`, 7 `sent`, 5 `resolved`). 0.4 Agent: 11 tools, `list_artboards` ok, tree = T0.
  - A0: rename reproduced by `mv .cursor-design .vibeboard`; activate-time `migrateLegacyFolders` covered by `layoutFs.test.ts` › "migrateLegacyDesignDir moves only the old folder, never over a new one" only, not run: Cursor 3.32 blocks CDP. After the move `.cursor-design` is gone, `.vibeboard/` = T0 byte for byte by relative path (0 added / removed / changed), nothing outside `.vibeboard/`. Both-folders: not run: launch 1 has one folder.
  - Disk: the 0.5 Agent's first call (`list_artboards`, 17 ms round trip) migrated. `project.json` = `{version:1, openPageId:'page-1', pages:[{id:'page-1', title:'Page 1'}]}`; all 45 root `manifest.json`/`canvas.json`/`comments.json`/`artboards/*` files byte-identical under `pages/page-1/`; all 376 `picking-harness/` + `handoff/` files keep their T0 sha; `.vibeboard/artboards` is a regular file whose text equals `ARTBOARDS_TOMBSTONE_TEXT`; the only new files are `project.json` and the tombstone; no root JSON left.
  - Baseline calls (`list_artboards`, `read_artboard`, `list_comments`, `handoff_status`, all `{}`): each `page` = `{id:'page-1', title:'Page 1'}`, the rest deep-equals `baseline.json` for all four (no difference to explain). The four reads changed no file (`A-after-first-call` = `A-after-baseline-calls`).
  - Panel: not run: Cursor 3.32 blocks CDP. Supporting, from disk/MCP: `list_artboards.frames` ids = the 21 baseline artboard ids (`canvas.json` itself holds a stale `t5-mobile` and lacks `utility-f40`; the resolved frame list matches the baseline); Unresolved would read 10 (= baseline `list_comments` count = 3 open + 7 sent), Resolved 5, Copy label `Copy 3 open comments for Agent` (`commentsPanel.ts`).
- **B-pre-rename** — pass (`.vibeboard/` part of the listing = L0). The 0.4 Agent, alive since before the move: `list_artboards` ok `{"activeArtboardId":"","artboards":[],"frames":[]}`; `read_artboard`, `update_artboard`, `place_frame`, `set_active_artboard` `ARTBOARD_NOT_FOUND`; `set_artboard` b-probe ok (generation 1, `panelEnsured: true`); `list_comments` ok `{"comments":[]}`; `get_comment`, `resolve_comment` `COMMENT_NOT_FOUND` ("Comment not found. Call list_comments to see current comment ids."); `export_artboard` ok (`.cursor-design/handoff/canvas-20261126T203110650Z`); `handoff_status` ok (not stale, b-probe). Writes outside `.vibeboard/`: see Observations.
- **B-tombstone** — pass. Stale Agent: 11 tools; all 11 B-table calls `isError` `DISK_ERROR` ".vibeboard/artboards must be a directory (symlinks rejected)."; whole-root listing = L1.
- **B-fresh** — pass. Empty `ws-fresh`; stale handshake only (11 tools), listing empty. The host's Open Artboard was replaced by the 0.5 Agent's `set_artboard({artboardId:'artboard', title:'P1', html:p1.html})`, also a `createIfFresh` call (`artboardTools.ts`); it wrote `project.json`, `pages/page-1/{manifest.json, artboards/artboard.{html,meta.json}}`, the tombstone and `.ensure-panel` (Open Artboard would instead write `initializeDefaultArtboard`'s starter, not p1.html). Stale Agent: all 11 calls `DISK_ERROR` naming `.vibeboard/artboards`; listing unchanged. (`run4.json` says `B-fresh.pass: false`: my script read the folder for "empty after handshake" only after the 0.5 create; the handshake listing `F-after-stale-handshake.txt` is empty, and `<S>/r4/hs.mjs` re-ran a stale handshake on an empty folder: `find` shows only the root.)
- **C** — pass (MCP steps; "panel shows" bullets not run: Cursor 3.32 blocks CDP). 0: `artboard` present (from B-fresh), so `read_artboard` → `update_artboard` p1.html base 1 (generation stays 1: same HTML). 1: one page, `openPageId` page-1. 2: `create_page({title:'Second'})` → page-2, `artboardId` artboard, generation 1, hash. 3: `update_artboard` p2.html → generation 2, `page.id` page-2, disk = p2.html. 4: two pages, `openPageId` page-2, both `updatedAt` ISO. 5: `open_page(page-1)` → `{page:{page-1}}`, `project.json` openPageId page-1. 6: `p1-extra` lands in `pages/page-1/artboards/` (only page-1 files change: p1-extra pair + page-1 `manifest.json`), `page.id` page-1, page-2 part unchanged.
- **D, E, F** — not run: Cursor 3.32 blocks CDP. Stand-in tests: see the evidence table rows.
- **G** — pass on the MCP part. Steps 1–2 not run: Cursor 3.32 blocks CDP (no panel comment, no Copy click; clipboard never read or written). Comment `c-g` (id `ffcea42b-9167-4b57-99fc-4f8943155815`) seeded by file edit: a new `pages/page-2/comments.json` `{version:1, comments:[…]}` with schema from `src/disk/commentsFile.ts` (`status: 'sent'`, the post-Copy state; frameId artboard, version = page-2 generation 2, selector `body > p`), written with no lock while no other writer ran. Step 3 (page-1 open since C step 5): `get_comment({id})` → `isError`, `COMMENT_NOT_FOUND`, verbatim: `Comment "ffcea42b-9167-4b57-99fc-4f8943155815" is on page page-2, which is not open. Call open_page("page-2"), then get_comment again.` Step 4: `open_page(page-2)` ok; `get_comment` ok, `page.id` page-2; `resolve_comment` ok; disk status `resolved` with one agent reply; `list_comments` on page-2 then empty. Panel shows resolved: not run.
- **H** — pass, all six steps. 1: page-1 export `canvas-20261126T203111360Z`: `IMPLEMENT.md` `page: page-1` / `pageTitle: Page 1`, frames `artboard`, `p1-extra` only; both `ungrouped/<id>/index.html` byte-equal their disk file; neither source-tag regex matches any file under `.vibeboard/handoff/`; `canvas.html` has none of `data-cd-inspector`, `aria-label="Inspector"`, `Undo in `, `Redo in `; `handoff_status` stale false with that id. 2: page-2 `stale: true`, no `lastExport` (page-2 manifest has none; panel `handoffStale` off per `compareCanvasHandoff`, from code, not observed). 3: page-2 export `canvas-20261126T203111391Z` names `page: page-2` / `pageTitle: Second`, lists only `artboard`. 4: page-1 not stale, step 1's id. 5: `p1-extra` "Extra" → "Changed" (generation 2) → page-1 stale. 6: page-2 not stale (step 3's id).
- **Bombic's Cursor dirs** (read-only `stat -f '%m %N'`, end of run): `1795630106 ~/.cursor/extensions`, `1795552684 ~/.cursor/skills/vibeboard`, equal to `<S>/real-cursor-stat-4a.txt` and the lead's record.
- **`/tmp/vb10e`**: `readlink` = `<S>/profile`, removed.

### Observations

- **B-pre-rename, what the real 0.4 server did after the rename.** It never touched `.vibeboard/`. It answered as if on an empty 0.4 workspace (read tools: empty lists or `*_NOT_FOUND`) and its write tools recreated `.cursor-design/`: `.ensure-panel`, `manifest.json`, `artboards/b-probe.html`, `artboards/b-probe.meta.json`, `handoff/canvas-20261126T203110650Z/{IMPLEMENT.md, canvas.html, tokens.json, ungrouped/b-probe/index.html}`. No `.cursor-design/.lock` left. This confirms `docs/limits.md` ("its MCP server keeps running and can write a new `.cursor-design/`, which Vibeboard ignores"); "ignores" rests on code (the 0.5 server only reads `.vibeboard/`; on the next activate `migrateLegacyDesignDir` returns `'both'`, warns, and moves nothing), not on a run. Also: a still-running 0.4 Agent reports zero artboards and comments after the move, so the Agent sees an empty design rather than an error.
- **The migrating call is a read tool.** The first `list_artboards` (described "Does not write", `readOnlyHint: true`) performed the whole 0.4 → page-1 migration (known; Failures and new issues #1).
- **C step 0:** `update_artboard` with byte-identical HTML returned generation 1 unchanged (no bump on a same-content write).
- **C step 3:** `update_artboard` has no title argument, so page 2's `artboard` keeps the `create_page` title "Artboard" (the spec's "title P2" for p2.html cannot be set by this step).
- **Undo's state after a page round trip (E4):** not observed (E not run).

### Leads

**F-20 `list_pages` cost (step 5, run before the Cursor launches so nothing else loaded the CPU).**
- **Method.** 0.5 Agent stand-in on the packaged `<S>/vsix/extension/dist/mcp.js` (pid 70956), `roots` capability answering `roots/list` with `<S>/ws-perf` (server logged "workspace roots from client"), no `rootPath`. On an empty folder: 100 `create_page({ title: 'P<n>' })`, each followed by 9 `set_artboard` (`f2`…`f10`, 1733-byte HTML). Build: 1000 calls in 883 ms, no `WORKSPACE_BUSY` retry. Latency = client round trip (`performance.now()` around `callTool`, stdio + JSON included), warm file cache.
- **Machine / folder.** Apple M4. Final `list_pages` count **100** (`openPageId` `page-100`); 2103 files in 203 directories (each page `manifest.json` + 10 artboards × `.html`/`.meta.json`, plus `project.json` and the tombstone).
- **`list_pages`** (7 calls, first dropped): 26.54, 26.52, 26.38, 26.33, 26.35, 26.54 ms → median **26.45 ms**, max **26.54 ms**.
- **`list_artboards`** (reference): 1.23, 1.13, 1.12, 1.10, 1.15, 1.13 ms → median **1.13 ms**, max **1.23 ms**. Ratio ≈ **23.4×**.
- **Queue** (5 rounds, `list_pages` sent first, then `list_artboards` without awaiting): `list_artboards` 29.21, 27.81, 27.63, 31.44, 27.48 ms (median 28.51, max 31.44) vs 1.13 ms solo: it waits for `list_pages` (`enqueueDiskOp` serializes them) plus ~1 ms of its own.
- **Verdict: `supports accepting`** (median 26.45 ms < 100 ms, ~4× headroom). The panel's per-`canvas:updated` page list is the same call, so it is bounded by the same number. `/audit` decides the status.
- `ps -p 70956` and `pgrep -f vsix/extension/dist/mcp.js`: none left. Evidence: `<S>/step5.md`, `<S>/step5.json`, `<S>/perf.mjs`.

### Failures and new issues

- None from 4a/4b's stand-in cases: every run case met its expected result; none was adjusted.
- Coverage gap (not a failure): no real-Cursor evidence for A0 (activate-time rename), A Panel, C's panel bullets, D, E, F, G steps 1–2 and G/H panel bullets. Each is `not run: Cursor 3.32 blocks CDP`, with the browser/unit tests named in the evidence table as the stand-ins. The only real-Cursor Agent-path evidence remains Bombic's own session (2026-11-26 21:20, `list_pages` + `list_artboards`, no `NO_WORKSPACE`).
- Run-script defect, corrected in the record: `run4.json` `B-fresh.pass: false` came from my "empty after handshake" check reading the folder after the 0.5 create; the listing and the `hs.mjs` re-check show the stale handshake wrote nothing. B-fresh recorded as pass.

New issues found while checking docs (not fixed here; `src/` is out of scope, `/audit` decides):
1. Read-only tool descriptions (`list_pages`, `list_artboards`, `read_artboard`, `list_comments`, `get_comment`, `handoff_status`) say "Does not write" and carry `readOnlyHint: true`, but each resolves the open page first, which can migrate a 0.4 folder, rebuild `project.json` or restore a deleted tombstone (`settleFolderLocked`, `openIndexedPage`). Known; needs a `/fix`.
2. `src/disk/errors.ts` `logStderr` comment still says "Cursor Design Output channel".
3. Outside this step's sections: the system map Runtime map's Disk node omits `deleted/`; `project-plan.md` §4 still says "MCP serializes writes per artboard id" (the code has one process-wide queue, `mcpQueue.ts`).
4. `legacyDesignDirWarned` is module-level: with two workspace folders that both hold both folders, only the first gets the `'both'` warning (the old folder is still ignored). Probably intended.

### Final gates

- `pnpm verify` (after steps 2–5): exit 0, **73 test files, 879 tests**, equal to the step 1 baseline (no `src/` or `tests/` change). `dist/mcp.js.map` exists again.
- `pnpm test:browser` (one full run): exit 0, **231 passed, 224 skipped** (the gallery and showcase specs, which run only through `pnpm gallery` / `pnpm showcase`), 2.2 min.
- `/overview`: `project-overview.md` regenerated (19,931 bytes, source-hash `8ae08b95180c4f2383fcc65c3e2b004f706514887fc11d02040b4c87bf031ab6`); no `build-plan.md` or `findings.md` edit proposed; `pnpm run check` pass. Plan contradictions it reported (for Bombic, not fixed): the quality pass and 9h/9i are only in `build-plan.md`; `project-plan.md` §3 0.4 scope excludes border, which 9h added; §4 still calls the 0.4 compare-and-write unlocked and says "MCP serializes writes per artboard id"; §3 0.3 says "Copy for Agent" where the UI says "Copy prompt"; §5 "esbuild through 0.2" is historical; §3 describes 0.5 as shipped while `build-plan.md` item 10 is unchecked.
- The run-state helper was not called for the nested `/overview`, so the `/implement` activity stayed current.

## Notes for the AI

- Read the code behind every case before running it. This spec names behavior; the code names the exact strings, labels and functions. Never adjust a case's expected result to match what happened: a mismatch goes to "Failures and new issues".
- Run the cases in the order written: A, B-pre-rename, B-tombstone (launch 1), then B-fresh, C, D, E, G, H, F (launch 2). C creates page 2, which D–H need. F removes pages, so it runs last.
- `.cursor-design` appears in this spec only for the 0.4 fixture, the 0.4 server and the rename. Every current path is under `.vibeboard/`.
- The 9g rig and its lessons are in the 9g archive (step 4 and Notes). 9g's helper scripts may survive in old scratchpads: copy what helps, but don't depend on them. Their names predate the rename.
- `pnpm vsix` leaves a minified `dist/` with no sourcemaps. Step 6's `pnpm verify` rebuilds the dev build.
- `agentSkill.test.ts` must still pass after any SKILL.md edit.
- Lean test runs: no browser suite until step 6, and then once.
- Subagents:
  - Sonnet 5.5 high for mechanical checks (steps 1, 3, 5).
  - Opus 5.5 high for the docs (step 2) and the Cursor run (steps 4a, 4b).
  - Always pass `effort`. Never Fable, never xhigh.
  - One browser-driving agent at a time.

### Drafted Notion 0.5 page patch (apply only after Bombic's yes)

- Status callout: "Shipped <date> on local main: 10a–10d, then the rename to Vibeboard and MCP client roots, verified by 10e (agent-run: real Cursor instance over CDP on the packaged .vsix, stdio Agent stand-ins for 0.5, the real 0.4 server and a patched stale server; no manual run). Where this page and shipped code disagree, the code wins."
- "Done when": tick each line that has a passing case, citing its case keys (N1 → A; N2 → C, F; N3 → D, E; N4 → C, G, H; N5 → A–H). Leave a line unticked if its case failed.
- Shipped decisions: add "Verified in 10e", with what the run pinned that the page does not yet state:
  - deleting the open page opens its previous neighbour;
  - the stale server's error text;
  - after the rename, the tombstone guards only a server with the current folder name; the real 0.4 server writes into a new `.cursor-design/` that Vibeboard ignores, so 0.4 users uninstall cursor-design and quit Cursor (Bombic, 2026-11-26: no product change);
  - Undo after a page round trip needs a fresh pick;
  - the F-20 numbers.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":88095,"specSha256":"89873a6cc4a6b7c745dcef4d8e434c215dfcf5ac1a9495df1dae1ce1bdd93407","branch":"refs/heads/feature/verify","head":"9241f71b7745bf446476f87ae6e4b4f0f83f4e17","baseRef":"refs/heads/main","baseCommit":"9241f71b7745bf446476f87ae6e4b4f0f83f4e17","sourceTree":"cc6db5ba3c338809f9a48d2c8c42e792c71086f2","landing":"local-merge","absentOptional":[]} -->

## Findings

### 10e/F-20 [P3] invalid - `listPages` stats sequentially inside the MCP queue

**File:** src/disk/pageOps.ts:142
**Found:** 2026-11-24 by /audit (scope: current; lens: performance)
**Why it matters:** about pages × (3 + 2 × frames) awaited `lstat`s (≈2,500 at 100 pages × 10 frames) while other MCP calls queue. Already marked `ponytail:`; no measurement.
**Suggested fix:** none now; `Promise.all` per page if it ever shows.
**Resolution:** 2026-11-26 /audit (10e): measured, not a defect at the ceiling. 10e step 5 built 100 pages × 10 frames (2103 files) over stdio on the packaged `mcp.js` (Apple M4, warm cache): `list_pages` median 26.45 ms, max 26.54 ms; `list_artboards` median 1.13 ms (23.4×); a `list_artboards` queued behind `list_pages` waits ~28.5 ms. Under the 100 ms threshold with ~4× headroom at `MAX_PAGES`, so the queueing risk named here does not materialize. The `ponytail:` stays as the upgrade path.

### 10e/F-29 [P3] closed - System map rename answer lines omit the focus condition

**File:** blueprint/context/system-map.md:395
**Found:** 2026-11-24 by /audit independent (scope: current; lens: quality)
**Why it matters:** the Pages menu chart says a rename `ui:error` leaves the field "editable and refocused" (`:395`) and a rename `page:saved` focuses "that row's Rename" (`:398`) unconditionally. Since the F-22 repair, `handleAnswer` (`pagesMenuState.svelte.ts:170-183`) moves focus on both only when `focusInMenu({ orBody: true })` holds; the open / create / delete line (`:384`) already states that condition. Docs drift in the normative system map, no behavior impact.
**Suggested fix:** append "if focus was in the menu or on body" to the chart lines at `:395` and `:398` (or one sentence under the Chrome answers bullet). Nothing is deleted; no requirement lost.
**Resolution:** 2026-11-24 /complete (10d): both chart lines in the system map "Pages menu (10d)" section now say "if focus was in the menu or on body", matching `handleAnswer`. Not yet re-reviewed.
2026-11-26 /audit (10e): re-reviewed `system-map.md` Pages menu chart against `handleAnswer` (`pagesMenuState.svelte.ts:170-183`): both lines are now conditional, so the original defect is gone. The condition still omits the page button (`focusInMenu` matches `[data-cd-page-button]` too); tracked separately as F-32.

### 10e/F-30 [P2] closed - Tombstone prose still says it stops cursor-design 0.4

**File:** blueprint/context/project-overview.md:100
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** since the rename (`79b88ac`), every older server a user can have is cursor-design 0.4, which reads and writes only `.cursor-design/`. The `.vibeboard/artboards` tombstone never meets it. 10e B-pre-rename proved it on the real 0.4 server: after the rename, every write recreated `.cursor-design/` and `.vibeboard/` stayed byte-identical. Three lines in this diff still say otherwise. `project-overview.md:100` says "A still-running 0.4 MCP then fails every tool". `project-overview.md:163` says "A downgrade to 0.4 fails on it until it is removed by hand"; the real outcome is an empty 0.4 workspace, and this line could lead someone to delete the tombstone for nothing. `project-plan.md:39` says the tombstone "makes a still-running older server fail". These contradict the correct new lines in `docs/limits.md:10,20` and the system map's "Pre-rename folder" bullet.
**Suggested fix:** in `project-plan.md:39`, say the tombstone guards a stale server that uses `.vibeboard/`, and that cursor-design 0.4 writes to `.cursor-design/`, which Vibeboard ignores. Then rerun `/overview` so lines 100 and 163 follow. Nothing is deleted; no requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): `project-plan.md` §3 now says the tombstone stops a stale server that still expects a root `artboards/` folder, and that cursor-design 0.4 only uses `.cursor-design/`, which Vibeboard ignores. Overview `:100` and `:163` are reworded to match: a 0.4 downgrade sees an empty workspace. The source-hash was recomputed (19,990 bytes). Not yet re-reviewed.
2026-11-26 second re-review: every in-scope doc line is fixed except the overview 10e line (`:44`), which copies `build-plan.md`; that is split into F-37. It also found the same framing in code comments. Third repair: `layout.ts` (tombstone comment), `openPage.ts` (the D5 `ponytail:` and the `openIndexedPage` comment) and the `openPage.test.ts` test name now say "stale server". The D5 ponytail now says that server goes away when the editor quits, not with a reload. The system-map 10a changelog line (`:10`) is left as history, true when it was written. Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): the defect is gone from every in-scope doc and from `src/`; each changed line was checked against the code. Closed. The review found the D5 note still framed as a live 0.4 race, so it is tracked as F-38.
2026-11-26 re-review kept it open: the same claim was still in `project-plan.md:54`, rule 02 `:24`, system-map `:152`, `docs/limits.md:20` and overview `:163` ("the tombstone covers that window"). Second repair: each now names a stale server that still expects a root `artboards/` folder, and says cursor-design 0.4 uses only `.cursor-design/`. Overview `:163` now says the old server after an update already knows pages; source-hash recomputed (19,993 bytes). Left for Bombic, who owns the plan: `build-plan.md` 10e and its overview echo (`:44`) still say "a stale 0.4 MCP fails after a migration". 10e B-pre-rename showed the real 0.4 server never meets the tombstone. Not yet re-reviewed.

### 10e/F-31 [P3] closed - Docs describe a pre-pages server on `.vibeboard/` that never shipped

**File:** docs/limits.md:26
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** `.vibeboard` first appears in `79b88ac`, after 10a–10d, so no released server uses `.vibeboard/` without pages. `docs/limits.md:26` ("A server from before pages that uses `.vibeboard/`") and `system-map.md:162` ("stale pre-pages MCP process on .vibeboard/") describe a hypothetical. The tombstone still guards a hand-built or dev stale server (10e B-tombstone used a patched copy). Misleading, not harmful.
**Suggested fix:** reword both as "a stale server that still expects a root `artboards/` folder (a dev build)", or drop the `limits.md` sentence and keep the cursor-design one. No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): `docs/limits.md` Older server and the system-map Stale node now describe a stale server that still expects a root `artboards/` folder (a dev build). Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): the defect is gone and the repair adds no new inaccuracy. Closed.

### 10e/F-32 [P3] closed - System map Pages menu focus condition omits the page button

**File:** blueprint/context/system-map.md:408
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** the chart lines at `:397`, `:408` and `:411` say "if focus was in the menu or on body". `focusInMenu` (`pagesMenuState.svelte.ts:35-41`) also matches focus inside `[data-cd-page-button]`. A rename `page:saved` also falls back to the page button when the row's Rename button is gone (`:181`).
**Suggested fix:** "if focus was on the page button, in the menu or on body" on all three lines, plus the fallback clause on `:411`. No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): system-map lines 397, 408 and 411 now say "if focus was on the page button, in the menu or on body", and 411 names the page-button fallback. Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): the defect is gone and the repair adds no new inaccuracy. Closed.

### 10e/F-33 [P3] closed - README Pages section lacks qualifiers

**File:** README.md:126
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** each line below is true but incomplete:
- `Page <n>` uses the next never-reused id number, not the page count (`pageOps.ts:56-72`).
- A title is trimmed and may hold no control characters (`parse.ts:80-84`).
- Blur also cancels a rename and drops the draft (`PagesMenu.svelte` `handleRenameBlur`).
- `open_page` / `create_page` move the panel only for the first workspace folder (SKILL.md says so).
- Esc does nothing while a page request is in flight (`pagesMenuState.svelte.ts:84`).
**Suggested fix:** add the blur clause and the first-folder qualifier. The rest are optional. No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): the README Pages section adds all five qualifiers: next unused number, trim and no control characters, click-elsewhere cancels, first workspace folder, and Esc not while saving. Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): the defect is gone and the repair adds no new inaccuracy. Closed.

### 10e/F-34 [P3] closed - Plan and overview say no undo history carries over a page switch

**File:** blueprint/project-plan.md:96
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** the new §7 0.5 line and the overview's "0.5:" UI bullet say no "edit or undo step carries over". Only the chrome's Undo target resets: `EditState` is rebuilt under `{#key}`. The host keeps each page's history (`editHistory.ts:30,41-60`), and Undo works again after a pick. 10e step 4 confirmed it, and `docs/edit-mode.md:44` already states it correctly.
**Suggested fix:** "no undo button state carries over; each page keeps its own history". No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): `project-plan.md` §7 and the overview "0.5:" bullet now say the Undo target resets and each page keeps its own undo history. Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): the defect is gone and the repair adds no new inaccuracy. Closed.

### 10e/F-35 [P3] closed - Small plan and overview drift found in the 10e docs pass

**File:** blueprint/context/project-overview.md:109
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:**
- Overview `:109` lists the `createIfFresh` callers as `set_artboard` and Open Artboard. It omits `createPage` (`pageOps.ts:345`), which rule 02 and the system map now name.
- `project-plan.md:71` lists the `pnpm verify` steps without the agent-rules check and `tsc -p tsconfig.webview-tests.json` (`package.json:32`).
- `docs/limits.md:10` says the rename runs "on activate". It also runs on a trust grant and on every folder change (`extension.ts:35-37,74-91`), and it warns once per process, not once per folder (`hostFs.ts:46`).
**Suggested fix:** correct the three lines (the overview through `/overview` after the plan fix). No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): fixed in three places. Overview `createIfFresh` callers add `create_page`. `project-plan.md` Verify list adds the agent rules check and the webview-tests typecheck. `docs/limits.md` says the rename also runs on a trust grant and on folder changes, and warns once per session. Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): the defect is gone and the repair adds no new inaccuracy. Closed.

### 10e/F-36 [P2] closed - Read-only tools can write: "Does not write" and `readOnlyHint` are wrong

**File:** src/mcp/pageTools.ts:52
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** `list_pages`, `list_artboards`, `read_artboard`, `list_comments`, `get_comment` and `handoff_status` say "Does not write" and carry `readOnlyHint: true`. Each resolves the open page first, and that can:
- migrate a 0.4 folder;
- rebuild `project.json`;
- restore a deleted tombstone (`settleFolderLocked`, `openIndexedPage`).

In 10e case A, the first `list_artboards` performed the whole migration. A client that auto-approves read-only tools then lets a "read" move the user's design folder. This was found before 10e (2026-11-26 cleanup) and confirmed by this run; the code predates 10e.
**Suggested fix:** a `/fix`. Either reword the six descriptions ("may first move an older design folder into pages, once") and drop `readOnlyHint` from those that can write, or keep the hint and make reads never migrate. The second option changes behavior and needs Bombic's decision.
**Resolution:** 2026-11-26 /implement (10e step 7, Bombic: "fix all"): the six descriptions no longer say "Does not write". They now say "The first call may move an older design folder into pages, once; otherwise it does not write." `readOnlyHint: true` is kept on purpose, with a `ponytail:` comment above `READ_ONLY_ANNOTATIONS` in `mcpToolResult.ts` naming the ceiling and the upgrade path. Dropping the hint could make agents ask approval for every read, a product call left to Bombic. No behavior change; SKILL.md already says the first call may move an older folder. Not yet re-reviewed.
2026-11-26 /audit re-review (Opus 5.5, fresh context): all six descriptions carry the new sentence, which matches `openPage.ts` (Indexed restores a missing tombstone; Legacy migrates; a lost index is rebuilt; Fresh with `createIfFresh: false` writes nothing). The `ponytail:` comment is accurate and nothing contradicts SKILL.md. Closed.
2026-11-26 re-review kept it open: `list_artboards` (`artboardTools.ts:219`) and `get_comment` (`commentTools.ts:117`) still said "Does not write.", and the new wording covered only the one-time move. Second repair: all six now say "May first settle the design folder (move an older one into pages once, or restore a missing project.json or artboards file); otherwise does not write." The `ponytail:` comment now names the migration, the `project.json` rebuild and the tombstone restore. Also fixed: system-map HostOther (`:116`) notes `createPage` resolves with `createIfFresh: true`; README says "next never-used page number"; `project-plan.md:39` names activate, trust grant or folder change. Not yet re-reviewed.

### 10e/F-37 [P3] closed - Build plan 10e says a stale 0.4 MCP fails on the tombstone

**File:** blueprint/build-plan.md:83
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** the 10e item says "a stale 0.4 MCP fails after a migration and in a fresh folder". The overview copies this (`project-overview.md:44`). 10e B-pre-rename showed the real 0.4 server never meets the tombstone after the rename: it writes to `.cursor-design/`. Only a server that uses `.vibeboard/` and expects a root `artboards/` folder fails (B-tombstone, B-fresh). Bombic owns `build-plan.md`, so this audit does not edit it.
**Suggested fix:** Bombic rewords 10e to "a stale server fails on the tombstone after a migration and in a fresh folder; the real 0.4 server never touches `.vibeboard/`", then reruns `/overview`. Or leave it, since 10e is done and `/complete` checks it off. No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7; Bombic: "do whatever you think is the best decision"): the `build-plan.md` 10e line and its overview copy now say "a stale server fails on the tombstone after a migration and in a fresh folder (the real 0.4 server never touches `.vibeboard/`)", matching B-tombstone, B-fresh and B-pre-rename. Overview source-hash recomputed. Closed 2026-11-27 by /audit re-review (Sonnet 5.5): build-plan line matches 10e cases B-tombstone, B-fresh and B-pre-rename and the system map; no new error.

### 10e/F-38 [P3] closed - D5 ponytail describes a lock race no shipped build can hit

**File:** src/disk/openPage.ts:178
**Found:** 2026-11-26 by /audit (scope: current; lens: quality)
**Why it matters:** the D5 note in `openPage.ts` and its system-map copy (`:181-182`) say a 0.4 (or stale) `addComment` / `placeFrame` waiting on `.vibeboard/.lock` during a migration writes an orphan root file. Only pages-aware builds take that lock: 10a–10d landed before the rename. cursor-design 0.4 locks `.cursor-design/`, and a current server re-settles to Indexed. No shipped build can hit the race. The code comment also said only "goes away when the editor quits"; a hand-added agent's server goes away when the agent restarts.
**Suggested fix:** frame it as hypothetical: only a pre-pages build on `.vibeboard/` (none shipped). No requirement lost.
**Resolution:** 2026-11-26 /implement (10e step 7): both notes now say "only a pre-pages build on `.vibeboard/` (none shipped; 0.4 locks `.cursor-design/`)", and the code comment adds "or the agent restarts". Comment-only. Closed 2026-11-27 by /audit re-review (Sonnet 5.5): the lock lives in `.vibeboard/` (`workspaceLock.ts`), 0.4 locked `.cursor-design/`, and the activation move never overwrites; no shipped build can hit the race; no new error.
