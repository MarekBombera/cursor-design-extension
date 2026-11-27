# Feature: Comments review report

**From build-plan:** feature 11e1
**Build attempt:** 1
**Branch:** feature/comments-review-report
**Status:** verified (Steps 1-4 done; Bombic picked C1, C2, C3, C4a, C5 on 2026-11-27; `pnpm verify` 75 files, 926 tests)

## Goal

Answer one question with evidence, before anyone refactors: can `CommentsState`, `PinThread` and `CommentPicker` become one comments module with a small interface, and what else in the comments chrome is shallow or order-coupled? Measure a baseline first, then write a ranked report of candidates (deletion test, Strong / Worth exploring / Speculative), then stop for Bombic's pick. 11e2 builds what Bombic picks; 11e3 re-measures against this baseline with the same Method.

No product code, test, config or rule changes. The only new file is the report. `/complete` commits it.

## In scope

- **Report** at `blueprint/reference/11e-comments-review.md`. Sections in this order: Baseline, Method, Map, Candidates, Disputed, Not proposed, Merge log, Picks. Format precedent: `blueprint/reference/11f-test-review.md`.
- **Baseline** (Steps 1 and 2): the numbers 11e2 and 11e3 compare against, measured on the branch.
- **Method:** for every Baseline row, the exact command or recipe, file glob, test exclusion and type rule, so 11e3 reruns it unchanged; plus the reviewer models, effort and inputs (Step 3).
- **Map** (Step 2): what each comments file does today, the three classes' public members and who uses them, every cross-class use, every order constraint in `DesignPage.svelte`, the comment-UI save path, and the browser tests that guard each class, each with `file:line`.
- **Review** (Step 3): two independent reviewers propose candidates; the implementing agent checks every claim against the code and merges.
- **Pick stop** (Step 4): Bombic picks; the picks are recorded in the report.

### Measured set (the comments code)

Selected by glob, not a fixed list, so 11e3's rerun finds merged or renamed files: every file matching `src/webview/{comment*,pin*,Comment*,Pin*,Composer,TargetRef}.*`. Today that is 21 files:

- State classes (3): `commentsState.svelte.ts`, `pinThread.svelte.ts`, `commentPicker.svelte.ts`.
- Pure rules (5): `commentActions.ts`, `commentPick.ts`, `commentPopover.ts`, `commentsPanel.ts`, `pins.ts`.
- Rule tests (5): their `*.test.ts`.
- Views (8): `CommentCard.svelte`, `CommentPopover.svelte`, `CommentThread.svelte`, `CommentsPanel.svelte`, `Composer.svelte`, `PinChip.svelte`, `Pins.svelte`, `TargetRef.svelte`.

This set replaces the plan's "21 files, about 4,800 lines" estimate: the Baseline records its real line totals with and without tests.

**Wiring, measured separately:** `DesignPage.svelte` (comments lines, counted as in Step 1) and the comment-UI save path (counted as in Step 1).

**Read-only context, never a candidate:** the frame runtime (`src/webview/frame/commentPicking.ts`, `pinAnchors.ts`, `anchorRects.ts`; a separate document, embedded in `canvas.html`), `Overlay.svelte`, `editState.svelte.ts` (it takes `CommentPicker`; the Map records that dependency), `canvasState.svelte.ts`.

## Out of scope

- Any change under `src/`, `tests/`, `scripts/`, `.claude/`, `.cursor/`, `skills/`, `package.json`, the lockfile or config. Measurement scripts run from the session scratchpad and are pasted into Method, never saved in the repo. No spike branches, no probe copies: the deletion test is argued from the code with `file:line` evidence, not run.
- Building any candidate (11e2), `Stage.svelte` and `Inspector.svelte` extraction (11e3). Stage and Inspector appear only as Baseline numbers.
- Host-side comments (`src/disk/comments.ts`, `src/host/panelComments.ts`; 11b deduped them) and the comment message contract: a candidate that needs a message, disk or MCP change goes under Not proposed with why.
- Reviving ideas dropped on 2026-11-23: branded ids, host singleton factories, clock or id injection.
- `project-overview.md` (`/overview`'s job), Notion, `system-map.md`; `blueprint/context/findings.md` beyond `/audit`'s ledger entries.

## Build loop

`workflow.stepReview: feature`, `checkpointCommits: disabled`: run Steps 1 to 3, then the pick stop (Step 4) is the one review point. Bombic's pick is the review; there is no code to check. Step 4 ends the work item; `/complete` commits and lands it.

**Scope gate** (used by every done-when): `git status --porcelain --untracked-files=all` lists only paths in the allowed set: `blueprint/reference/11e-comments-review.md`, `blueprint/build-plan.md`, `blueprint/context/current-feature.md`, `blueprint/context/current-feature-overview.md`, `blueprint/context/feature-review.md`, `blueprint/context/findings.md` (the `/audit` ledger), and `blueprint/.state/` if it is tracked.

## Build steps

1. **Branch + Baseline.** Create `feature/comments-review-report` from `main` (the uncommitted 11e1/11e2/11e3 lines in `blueprint/build-plan.md` and the current-* files come along). Create the report with Baseline and Method sections. Every row below gets its number in Baseline and its command or recipe in Method:
   - **Size:** per measured-set file, `wc -l`; totals for state classes, pure rules, rule tests, views; grand total with and without tests.
   - **DesignPage wiring:** total lines of `DesignPage.svelte`, and its non-comment lines naming a comments class, instance or view: `grep -vE '^\s*(//|<!--)' src/webview/DesignPage.svelte | grep -cE '\b(CommentsState|PinThread|CommentPicker|comments|pinThread|picker|CommentsPanel|CommentThread|CommentPopover|Pins)\b'`. 11e3 reruns this pattern and also a pattern updated to 11e2's new names, and records both.
   - **Comment-UI save path:** `grep -cE '\b(draftSlot|latestComments|keptCommentDraft|savedCommentUi|readSavedCommentUi|saveCommentUi)\b' src/webview/App.svelte`, and the `DesignPage.svelte` `savable` line range.
   - **Exports used outside their own file:** run a scratchpad Node script (pasted verbatim into Method) over the measured set minus tests. Per file: exported names from `export (const|function|class|let) Name` (value) and `export (type|interface) Name` (type), plus `default` for each `.svelte` view; for each name, the count of non-test files under `src/` (`.ts`, `.svelte.ts`, `.svelte`; excluding `*.test.ts`, `tests/` and the file itself) whose `import … from '<relative path>'` statement (multi-line, `import type` included) resolves to that file and names it. Report value and type exports separately: exported, used outside, test-only.
   - **Test-only exports:** `grep -rn '@internal' src --include='*.ts'` (8 today; `knip --production` skips `@internal`, so it cannot measure this); list the measured-set ones (`pins.ts` `pinPoint`, `pinLabel`).
   - **Class interfaces:** per class, public members (fields, getters and methods without `#`, plain and `$state` fields alike; the constructor not counted), and how many are used outside the class file: "Step 2" here, filled from the Map.
   - **Cross-class uses and order constraints:** "Step 2" here, filled from the Map.
   - **Repo-wide quality-pass metrics:** unit test files and tests (`pnpm test`; 75 / 926 on `main` at `374d2ed`); browser tests with the same method as the 11f Baseline (`pnpm exec playwright test -c tests/browser --list`, deduplicated across the `parallel` and `serial` projects, gallery entries counted separately); `vi.mock(` calls (`grep -rc --include='*.test.ts' 'vi.mock(' src`, non-zero files only); files touched per feature, all files as in the plan's "10b: 61" (`git show --stat --format= <sha> | tail -1` for `f8c842b` 10b, `b94834f` 11c4, `374d2ed` 11d).
   - **11e3 inputs:** `Stage.svelte` and `Inspector.svelte` total lines and `<script>` block lines, `$effect` count (`grep -c '\$effect'`) and handler count (`grep -cE '^\s*(const|function) (handle|on)[A-Z]'`) in each.
   - Done when: every row has a measured number with its recorded command, or says "Step 2"; the scope gate holds.

2. **Map.** Read the measured set and the read-only context and write the Map section, one line per entry:
   - **Files:** each measured-set file's job today, in rule 08 catalog wording where it matches; a mismatch is noted (e.g. `CommentPicker` also owns Edit mode's mode, hover and pick).
   - **Members:** per class, each public member, its kind (state, derived, method, view handle), and every use outside the class file (`file:line`), or "none outside". Recipe: `grep -nE '\b<instance>\.<member>\b'` over non-test `src/webview` files that hold an instance (`DesignPage.svelte`, the other two classes, `editState.svelte.ts`), where `<instance>` is how that file names it (`comments`, `pinThread`, `picker`, `#pinThread`, `#picker`, …); a name collision is checked by reading the line. The Baseline "used outside" count = members with at least one use.
   - **Cross-class uses:** every distinct (reader file, member) pair where `DesignPage.svelte`, `editState.svelte.ts` or one of the three classes uses a member of one of the three classes it does not own, plus module-level helpers imported from one class file into another (`canTakeFocus`). Each pair is tagged **write** (assigns a field, or `bind:this` into it), **read** (reads a field or derived) or **call**, with `file:line`. Known starting points: `commentPicker.svelte.ts` writes `pinThread.heldThreadId`, calls `closeThreadImplicitly`, reads `pinThread.stage`, imports `canTakeFocus`; `DesignPage` `handlePinOpen` writes `picker.heldDraft`; `bind:this={pinThread.stage}`, `bind:this={pinThread.pinsView}`, `bind:this={picker.popover}`. The Baseline counts pairs in total and per tag.
   - **Order constraints:** every place in `DesignPage.svelte` where the order of construction or of calls matters, with what breaks if swapped (starting points: `PinThread` after `CanvasState` and `CommentsState` because its `$effect.pre` reads both; `applyCanvas` order; `cd:ready` → `picker.handlePickMessage` before `pinThread.resetFrameAnchors` before `edit.handleFrameReady`; the `ui:error` fan-out to four handlers). Each cites the comment or code that states it, or says "not stated in code". The Baseline counts them.
   - **Save path:** the comment-UI save path end to end (`App.svelte` draft slot and save `$effect`, `hostBridge.svelte.ts` `readSavedCommentUi` / `saveCommentUi`, `savedState.ts` comment UI parse, `pageStart.ts` `isPageComments`, `DesignPage.svelte` `savable`), so a candidate that moves it is sized against it.
   - **Guards:** the browser tests that exercise each class. Candidate specs from `grep -lE 'comment|Comment|pin|Pin' tests/browser/*.spec.ts tests/browser/harness.ts`; each hit is classified to a class (or "none") by the grep pattern recorded per class in the Map (the class's user-visible hooks, e.g. `data-cd-comment-thread`, pin and popover locators, Comment-mode keys). `gallery.spec.ts` and `showcase.spec.ts` are listed as evidence-only (never gates).
   - Done when: every public member of the three classes is listed with its uses, every "Step 2" Baseline row has its number, and the scope gate holds.

3. **Review + candidates.** Dispatch two reviewers at the same time with `subagent_type: Plan` (read-only: no Edit or Write tools), `effort: high` set explicitly: one Opus 5.5 (`model: opus`), one Sonnet 5.5 (`model: sonnet`). Neither sees the other's output. Each gets: the report so far (Baseline, Method, Map), the measured-set and read-only-context paths with "read the code yourself; cite `file:line`", rules 03, 05 and 08, the Quality pass text from `blueprint/build-plan.md`, this spec's Out of scope list, the tier rules and the candidate format (Data / contracts). Each must answer the plan's question (merge the three classes: yes, partly, or no, and why) and may propose other candidates in the measured set. Record models, effort and inputs in Method.
   - **Deletion test** for every candidate: imagine the module (or the seam) deleted; does its complexity vanish (it was a pass-through: a signal to merge or inline) or reappear across N callers (it earns its keep: keep or deepen)? The answer names the callers with `file:line`.
   - **Merge:** the implementing agent reads every `file:line` claim in both reports against the code. A claim that does not hold is dropped or corrected. Candidates both reviewers propose in substance become one, crediting both. The raw reports are not kept; every dropped or corrected claim gets one line in Merge log (claim, reviewer, dropped or corrected, why).
   - **Tiers:**
     - **Strong:** the deletion test shows a pass-through or a cross-class write, the change shrinks a Baseline row measurably, it moves no focus, restore, live-region, ordering or page-switch behavior, and both reviewers agree on it.
     - **Worth exploring:** a real win that moves such behavior (it names the guards from the Map, or the missing guard 11e2 must add first), or the reviewers agree it is right but differ on its size (both sizes recorded).
     - **Speculative:** the gain is mostly naming or file count, or rests on an assumption the code does not show.
     - A candidate that needs a user-visible behavior change goes under Not proposed (11e2 is behavior-unchanged); Bombic may still ask for it as its own `/fix`.
     - **Disputed** (not a tier): one reviewer's claim contradicts the other's (one says pass-through, the other shows it earns its keep), or the merge check finds the claim only partly true. Both reasons recorded.
   - **Ranking:** Candidates ordered by tier (Strong, Worth exploring, Speculative), then size (S, M, L), then fewest files touched. Ids `C1`, `C2`, … are assigned after ranking and never change. `D<n>` for Disputed, `N<n>` for Not proposed.
   - **The plan's question:** a paragraph at the top of Candidates with each reviewer's answer (yes, partly, no) and the implementing agent's verdict with the candidate ids behind it. If the reviewers' answers differ, the split also gets a D-id.
   - Done when: each candidate has every field of the format, every `file:line` was checked, the plan's question is answered, Disputed, Not proposed and Merge log are present (empty says "none"), and the scope gate holds.

4. **Pick stop.** Show Bombic in chat the plan's-question answer and the ranked list (id, tier, one line, size), and ask which to build in 11e2. Bombic may pick, merge or split ids, or change a candidate. Record in Picks: date, picked ids, merges, splits or changes, and ids explicitly not picked. If Bombic picks none, Picks says 11e2 is to be removed from the build plan through `/fix` and the build plan stays unchanged here. If the answer to the plan's question is "no", Picks notes that `/complete` softens item 11's "comments behind one small interface" wording.
   - Done when: Picks names Bombic's choice with the date, `pnpm verify` passes, and the scope gate holds.

## Files / areas

- New: `blueprint/reference/11e-comments-review.md`.
- Changed: `blueprint/build-plan.md` (the 11e1 to 11e3 lines, already written by `/feature`).
- Read only: the measured set, `DesignPage.svelte`, `App.svelte`, `hostBridge.svelte.ts`, `savedState.ts`, `pageStart.ts`, `editState.svelte.ts`, `canvasState.svelte.ts`, `Overlay.svelte`, the frame runtime files named above, `Stage.svelte` and `Inspector.svelte` (counts only), `tests/browser/*.spec.ts`, `tests/browser/harness.ts`, rules 03, 05, 08, `blueprint/reference/11f-test-review.md` (format and browser-count method), `blueprint/context/system-map.md` (Comment mode and popover, Pins, Comments panel, Page-scoped panel sections).
- Not changed: everything under `src/`, `tests/`, `scripts/`, `.claude/`, `.cursor/`, `skills/`, `package.json`, lockfile, config, `system-map.md`, `findings.md` (except `/audit`'s ledger entries).

## Data / contracts

No product contract, message, MCP tool, error code, disk format or CSP changes; the Agent skill and system map are untouched.

Candidate format in the report (no em dashes):

```
### C<n>. <short name> [Strong | Worth exploring | Speculative]
- Today: files and members involved, with file:line.
- Deletion test: what vanishes or reappears, and where (file:line).
- Proposal: the module(s) after, and the members DesignPage (or another caller) would use.
  If it touches CommentPicker: where mode, hover and pick live afterwards and what EditState reads.
- Measured win: Baseline rows it changes, before -> expected after.
- Behavior risk: focus, restore, live region, ordering or page-switch behavior it moves,
  and the Map guards that cover it (or the missing guard).
- Size: S / M / L and the files it would touch.
- Source: Opus, Sonnet, or both; any size disagreement in one line.
```

Ids are stable once assigned; 11e2's spec cites them.

## Testing

- No code changes, so no new tests. The evidence is the `file:line` citations, each checked by the implementing agent in Step 3.
- `pnpm verify` passes at the end (it passed on `main` at `374d2ed`: 75 files, 926 tests). Browser tests are not run: nothing they cover changes.
- Every Baseline number comes from a command recorded in Method, or is a count of a Map list whose entries carry `file:line`.

## Notes for the AI

- The 2026-11-23 plan review found the first plan overclaimed. Treat every reviewer claim as unverified until you read the cited line. An unchecked claim never enters Candidates.
- Rule 08 shapes the answer: logic that decides lives in pure `*.ts` rules with tests; containers hold `$state` and do I/O; a container past about 300 lines or with 2+ jobs extracts rules first. A merged class that breaks this is not Strong.
- `CommentPicker` is shared with Edit mode (`EditState` takes it). Any proposal touching it says where mode, hover and pick live afterwards and what `EditState` reads.
- Subagents: Opus 5.5 or Sonnet 5.5 only, `effort: high` explicit; never Fable, never xhigh.
- **Recorded at implement (2026-11-27):** C2 keeps the Strong tier although only its privatizing half had both reviewers' agreement; the dead-path half is Opus's, verified end to end by the implementing agent and the 11e1 audit, and moves no runtime behavior. The report's C2 Source records the override.
- Keep the report short and scannable: agents are its main reader. One line per Map entry; no prose recap.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":18217,"specSha256":"b08165991f049a7800df389b8c002f967a97afe4c0a8cbc50baa99a93fc65d71","branch":"refs/heads/feature/comments-review-report","head":"374d2ed7d6ea87d357ce31f86b80e0b3bf6abd8d","baseRef":"refs/heads/main","baseCommit":"374d2ed7d6ea87d357ce31f86b80e0b3bf6abd8d","sourceTree":"45caabf94116f658f549ead6f98351774fd7047d","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11e1/F-01 [P2] closed - C2 is tiered Strong without both reviewers agreeing on its dead-path half

**File:** blueprint/reference/11e-comments-review.md:241
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** The spec's Strong tier requires both reviewers to agree. Only C2's privatizing half was proposed by both; the dead-path deletion is Opus's, and Sonnet's proposals (releaseHeldDraft, D3) assumed the hold is live. The claim itself is correct (traced by the builder and this audit), so 11e2 is not misled, but the tier departs from the rule silently.
**Suggested fix:** State in C2's Source which half each reviewer backed and record the tier override explicitly with its evidence.
**Resolution:** C2's Source now states each reviewer's half (privatizing: both; dead paths: Opus, Sonnet assumed live) and records the tier override with its evidence. Re-review 2026-11-27 (fresh Opus 5.5): closed. Dead-path claim re-traced and holds; the override is honest; re-tiering would not change the pick. The override is now also recorded in the spec (F-11).

### 11e1/F-02 [P3] closed - C1's deletion test does not name a pass-through or cross-class write

**File:** blueprint/reference/11e-comments-review.md:234
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Strong needs the deletion test to show a pass-through or a cross-class write; C1's text argues rule knowledge moves to its owner instead.
**Suggested fix:** Phrase it as: DesignPage's two-call fan-out is a pass-through of a CommentsState rule.
**Resolution:** C1's deletion test now names the two-call fan-out as a pass-through of a CommentsState rule. Re-review 2026-11-27: closed. Deletion test names the pass-through; answerCopyOpen at commentActions.ts:240-245 confirmed.

### 11e1/F-03 [P3] closed - C2's expected wiring count is 105, should be about 106

**File:** blueprint/reference/11e-comments-review.md:245
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Deleting DesignPage.svelte:206-207 removes 2 matching lines, but :347 changes to onOpen={pinThread.handlePinOpen}, which then matches the wiring pattern (+1).
**Suggested fix:** Change to 107 -> ~106.
**Resolution:** C2's wiring estimate is 107 -> ~106, with the :347 reason. Re-review 2026-11-27: closed. -2 (:206, :207) +1 (:347) from 107 gives ~106.

### 11e1/F-04 [P3] closed - savable range differs between Baseline and Save path, and the Method recipe prints no range

**File:** blueprint/reference/11e-comments-review.md:22
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Baseline says 189-197, Save path 191-197 (189-190 is the comment); Method's grep -n savable prints only 191.
**Suggested fix:** Use 191-197 in both; Method: from grep -n 'export const savable' to the next '});'.
**Resolution:** Baseline says 191-197; Method gives the range recipe (from 'export const savable' to the next tab-indented '});', line 197). Re-review 2026-11-27: closed. Recipe gives 191-197; Baseline and Save path agree.

### 11e1/F-05 [P3] closed - Class-member recipe cannot be rerun unchanged

**File:** blueprint/reference/11e-comments-review.md:76
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Read literally it counts comment lines, readonly #x lines and closers: 48 for CommentsState against the true 23. The spec requires 11e3 to rerun every row unchanged.
**Suggested fix:** Give an exact regex for declaration lines that excludes # fields and the constructor.
**Resolution:** Method gives the exact member regex; it reproduces 23 / 20 / 20. Re-review 2026-11-27: closed. Regex reran: 23 / 20 / 20, names match the Map.

### 11e1/F-06 [P3] closed - harness.ts guard hit not classified

**File:** blueprint/reference/11e-comments-review.md:215
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** The Guards grep lists tests/browser/harness.ts (CS 1, PT 5, CP 4), and the spec says each hit is classified; Guards omits it.
**Suggested fix:** Add a harness.ts line: shared locators, not a guard by itself.
**Resolution:** Guards lists harness.ts (1 / 5 / 4) as shared locators, not a guard by itself. Re-review 2026-11-27: closed. 1 / 5 / 4 and all six helpers exist (harness.ts:386-426).

### 11e1/F-07 [P3] closed - C3, C6 and C7 omit the required CommentPicker line

**File:** blueprint/reference/11e-comments-review.md:250
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Each touches commentPicker.svelte.ts; the candidate format requires saying where mode, hover and pick live afterwards and what EditState reads.
**Suggested fix:** Add the line (unchanged, with what EditState reads) to each.
**Resolution:** C3, C6 and C7 each state where mode, hover, pick and the draft live and what EditState reads. Re-review 2026-11-27: closed. Lines accurate; C3's placement is F-10.

### 11e1/F-08 [P3] closed - Merge log uses reviewer-local candidate numbers that collide with report ids

**File:** blueprint/reference/11e-comments-review.md:318
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** "Opus C3" is the report's C4(b) and "Opus C5" is D1; 11e2 cites the report's stable ids.
**Suggested fix:** Write reviewer numbers as Opus #n / Sonnet #n with the report id they map to.
**Resolution:** Merge log uses Opus #n / Sonnet #n with the report id; every candidate's Source names its reviewer numbers. Re-review 2026-11-27: closed. Opus #1-#7 and Sonnet #1-#5 map consistently.

### 11e1/F-09 [P3] closed - Small wording overclaims in O1 and the Candidates intro

**File:** blueprint/reference/11e-comments-review.md:196
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** O1: not every constructor takes all previous ones (CommentsState takes only post; CommentPicker not comments). Intro: the ~58 are DesignPage's pairs, not all view props; EditState's 2 pairs include the isTextEntry import.
**Suggested fix:** Reword O1 and the intro to the exact dependencies.
**Resolution:** O1 names each constructor's real dependencies; the intro and N2 say DesignPage's 58 pairs (view props and message routing) and EditState's 2 (picking, isTextEntry). Re-review 2026-11-27 kept it open: N2 was not reworded and O1's "takes only post" was inexact (it takes replyDrafts too). Now: N2 and the intro name view props, message routing and the 4 savable reads; O1 says CommentsState takes no class. Second re-review kept it open: "4 savable reads" miscounts (savable has 4 fields reading 6 members). Now: no numeral, "the savable reads", said once in the intro. Third re-review 2026-11-27 (fresh Opus 5.5): closed. Intro, N2 and O1 exact against DesignPage.svelte:72-76,191-197 and the Baseline counts.

### 11e1/F-10 [P3] closed - C3's CommentPicker line breaks the candidate field order

**File:** blueprint/reference/11e-comments-review.md:257
**Found:** 2026-11-27 by /audit (scope: current; lens: all; re-review)
**Why it matters:** The candidate format puts the CommentPicker statement inside Proposal; C3 had it as its own bullet between Behavior risk and Size, unlike C2, C6, C7.
**Suggested fix:** Fold it into C3's Proposal bullet.
**Resolution:** Moved into C3's Proposal bullet. Re-review 2026-11-27: closed. Fields in format order; citations hold.

### 11e1/F-11 [P3] closed - C2's tier override is recorded only in the report

**File:** blueprint/context/current-feature.md:79
**Found:** 2026-11-27 by /audit (scope: current; lens: all; re-review)
**Why it matters:** Rule 00 records a deliberate departure from the plan in the spec; the spec's Strong rule still requires both reviewers to agree, and its Status mentions only the picks. Bombic picked before the override was written.
**Suggested fix:** One line in the spec's Notes or Status, and tell Bombic at the handoff.
**Resolution:** Spec Notes records the override (2026-11-27); the handoff tells Bombic. Also a mechanical spec fix: the scope gate's allowed set now names `blueprint/context/findings.md`, the /audit ledger. Re-review 2026-11-27: closed. Spec Notes records the override; scope gate names findings.md; git status lists only allowed paths.

### 11e1/F-12 [P3] closed - Spec lists findings.md as out of scope and not changed while the scope gate allows it

**File:** blueprint/context/current-feature.md:44
**Found:** 2026-11-27 by /audit (scope: current; lens: all; re-review)
**Why it matters:** After the F-11 repair the scope gate allows `blueprint/context/findings.md`, but Out of scope and Files / areas "Not changed" still list it, so the spec contradicts itself.
**Suggested fix:** Say in both places that the work item does not edit it beyond `/audit`'s ledger entries.
**Resolution:** Both lines now exempt `/audit`'s ledger entries. Re-review 2026-11-27: closed. Out of scope, scope gate and Not changed agree; git status lists only allowed paths.

### 11e1/F-13 [P3] invalid - editState.svelte.ts:57 cited for the CommentPicker field, which is :56

**File:** blueprint/reference/11e-comments-review.md:155
**Found:** 2026-11-27 by /audit (scope: current; lens: all; re-review)
**Why it matters:** Line 57 is `readonly #post`; the `#picker: CommentPicker` field is line 56. Cited twice (Map Files, Candidates intro).
**Suggested fix:** Cite `:56`.
**Resolution:** Invalid: `grep -n '#picker: CommentPicker' src/webview/editState.svelte.ts` prints line 57 (line 56 is `readonly #canvas`), so the original `:57` citations were right; the brief edit to `:56` was reverted.
