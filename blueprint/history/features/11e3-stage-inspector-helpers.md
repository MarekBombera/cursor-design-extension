# Feature: Stage + Inspector helpers

**From build-plan:** feature 11e3
**Build attempt:** 1
**Branch:** feature/stage-inspector-helpers
**Status:** verified (Steps 1-6 done; `pnpm verify` 75 files, 927 tests; `pnpm test:browser` 233 passed, 224 gallery/showcase skipped)

## Goal

Move `Stage.svelte`'s gesture glue and `Inspector.svelte`'s focus handoff out of the two views into two `.svelte.ts` helpers (rule 08: stateful glue out of views; Stage's `<script>` is 336 lines). Then re-measure the 11e1 Baseline with the report's Method (`blueprint/reference/11e-comments-review.md`) and record the result in that report. Behavior unchanged: every existing unit and browser test passes unedited; one missing browser guard (empty-stage drag pan) is written first.

## In scope

Line numbers are at `fa399a4`.

### A. `stageGestures.svelte.ts`: class `StageGestures`

Moves, verbatim in logic, from `Stage.svelte`:

- Frame gestures by pointer: `GestureTarget` type, `captured`, `viewportPoint`, `isCaptured`, `startFrameGesture`, `moveFrameGesture`, `endFrameGesture` (`:80`, `:86-90`, `:120-159`).
- The Escape-cancel `$effect` while a pointer gesture is captured (`:161-187`).
- `releaseOnRemove` attachment (`:189-196`).
- Frame gestures by keyboard: `heldArrows`, `handleFrameKeydown`, `handleFrameKeyup`, `handleFrameBlur` (`:118`, `:226-262`).
- The wheel listener attachment `attachWheel` (`:264-282`).
- Empty-stage drag pan: `dragging`, `lastPointerX/Y`, `startDrag`, `moveDrag`, `endDrag` (`:82-84`, `:307-335`).

Contract:

- Constructor: `new StageGestures({ viewport, onFrameGesture, onDragPan, onWheel })` with `viewport: () => HTMLDivElement | undefined`, `onFrameGesture: (gesture: StageFrameGesture) => void`, `onDragPan: (deltaX: number, deltaY: number) => void`, `onWheel: (wheel: StageWheel) => void` (`StageFrameGesture`, `StageWheel` from `frameGesture.ts`). Stage passes `() => viewportElement` and arrows that read the prop at call time (`(gesture) => onFrameGesture(gesture)`, likewise the other two); never capture a prop value in the constructor.
- Public: getter `captured: GestureTarget | undefined`, which returns `this.#captured` as is (declared type narrowed to `{ id, kind }`; the backing `#captured` `$state` also holds `pointerId` and `element`); getter `dragging: boolean` (backing `#dragging = $state(false)`); arrow-function fields `startFrameGesture`, `moveFrameGesture`, `endFrameGesture`, `handleFrameKeydown`, `handleFrameKeyup`, `handleFrameBlur`, `startDrag` (event type `PointerEvent & { currentTarget: HTMLDivElement }`, as today), `moveDrag`, `endDrag`, and the attachments `releaseOnRemove: Attachment<Element>` and `attachWheel: Attachment<HTMLDivElement>` (as today). Everything else is `#private` (`#captured`, `#dragging`, `#heldArrows`, `#lastPointerX/Y`, `#viewportPoint`, `#isCaptured`). `GestureTarget` stays a module-local type, not exported: Stage's template builds `{ id, kind: 'move' as const }` itself, and an export nobody imports is a knip finding. Only `StageGestures` is exported.
- The Escape `$effect` is created in the constructor. Stage constructs the instance once (`const gestures = new StageGestures(...)`) at top level of its `<script>`, after its own frame-focus poll `$effect`, so effect creation order matches today (poll first, then Escape).
- The comments that explain each piece move with it (capture cleared before end/cancel; release outside commits; Escape listener; removed label teardown; holding two arrows; wheel in an iframe never bubbles; non-passive listener; empty stage includes a viewport child).
- `Stage.svelte` keeps: props, `MODE_HINTS`, `HANDLE_SCREEN_WIDTH`, frame-focus tracking (`focusedFrameId`, `trackFrameFocus`, the poll `$effect`, its `ponytail:` comment), `revealFocused` (focus reveal, not a gesture; it calls `onDragPan` itself), `focusViewport` (still `export const` on the component: `PinThread` and `CommentPicker` call it through `bind:this`), `attachViewport`, `attachResize`. The template swaps each moved name for `gestures.<name>` and reads `gestures.dragging` / `gestures.captured?.kind` / `gestures.captured?.id` where it reads `dragging` / `captured` today. Markup, classes, ARIA, attachment order and handler set per element are unchanged. Remove the imports Stage no longer uses (`arrowNudge`, `FrameGestureKind`); `StageWheel`, `StageFrameGesture`, `revealOffset` and `Attachment` stay (props, `revealFocused`, `attachViewport` / `attachResize`).

### B. `inspectorFocus.svelte.ts`: class `InspectorFocus`

Moves from `Inspector.svelte`:

- Add border's Width focus: `widthFocus` (plain field, not state, as today) and its `$effect` (`:118-120`, `:135-153`).
- Section focus handoff: `sectionOf`, `focusedSection` and its `$effect.pre`, `tabbed`, `recordTab`, and the handoff `$effect` (`:155-192`).
- `actionId` (`:116`). The handoff `$effect` calls `this.actionId(section)` instead of building `${fieldId}-${section}-action` by hand (`:190`), so the header-button id has one owner.

Contract:

- Constructor: `new InspectorFocus({ fieldId, view, pick })` with `fieldId: string` (Inspector's `$props.id()`), `view: () => unknown` (Inspector passes `() => view`; the effects call it where they `void view` today) and `pick: () => ChromePick | undefined` (`() => pick`).
- The three effects are created in the constructor in today's order: Width focus `$effect`, `focusedSection` `$effect.pre`, handoff `$effect`. The Width effect must run before the handoff effect, or Add border's focus can pass through the section header first.
- Public: `actionId = (section: SectionId): string`, `recordTab = (event: FocusEvent & { currentTarget: HTMLElement }): void`, `armWidthFocus = (target: { frameId: string; sourceNumber: number }): void` (sets the plain field). Everything else `#private`.
- The comments on `widthFocus`, `focusedSection`, `tabbed` and the handoff move with them.
- `Inspector.svelte` keeps `runAction`; where it assigns `widthFocus` today it calls `handoff.armWidthFocus({ frameId: pick.frameId, sourceNumber })` under the same condition. The instance is `const handoff = new InspectorFocus(...)` (not `focus`, which shadows `window.focus`), created after `view`. Template: `onblurcapture={handoff.recordTab}`, `id={handoff.actionId(section.id)}`. Remove imports Inspector no longer uses.
- The Width field id stays built by `entryProps` (`${fieldId}-${field}`); the helper looks it up as `${fieldId}-border-width` as today. No other id moves.

### C. Re-measure against the 11e1 Baseline

Append `## Re-measure (11e3)` to `blueprint/reference/11e-comments-review.md` after Picks, and add "Re-measure" to the section list on its line 3. Rerun every Method command unchanged (checked: 11e2 `fa399a4` renamed no instance or file) on this branch after Steps 1-4, and give each Baseline figure as `baseline → now`: size table, DesignPage wiring, save path and `savable` range, exports table, test-only exports, class interfaces, cross-class uses (Map recipe; hand-read hits), order constraints (hand read), browser tests (Baseline 231 gating; 11e2 added one, this item one), unit, `vi.mock(`, files touched (add 11e2 `fa399a4`). Record what the commands print; where 11e2 already moved a figure, the row shows it.

The 11e3 inputs table gets four rows: `Stage.svelte`, `Inspector.svelte`, `stageGestures.svelte.ts`, `inspectorFocus.svelte.ts`. For the two `.svelte.ts` files the `<script>`-lines column reads "n/a (whole file is script; see Lines)". The `$effect` grep also counts `$effect.pre`. One line under the table says what the handler regex counts: `^\s*(const|function) (handle|on)[A-Z]` misses class fields (`handleFrameKeydown = …`) but matches inner `const`s, so expect Stage 0, `stageGestures` 3 (`handleKeydown`, `handleWheel`, `onEmptyStage`), Inspector 0, `inspectorFocus` 0; a different output is recorded as printed and explained.

Close with exactly two lines: (1) the plan's 11e question (one comments module?): answered "no" in Picks, unchanged by 11e2/11e3; (2) the Stage and Inspector extraction: `<script>` lines and `$effect` / handler counts before → after, and where they went. No new verdicts.

### D. Catalog, map, comment

- Rule 08 owner catalog (`.claude/rules/08-svelte-chrome.md`, State and I/O), same change: `stageGestures.svelte.ts` → frame move / resize by pointer and keyboard, empty-stage drag pan, the stage wheel listener; `inspectorFocus.svelte.ts` → Add border's Width focus, the one section-header focus handoff, the header id `actionId`.
- `blueprint/context/system-map.md:525-526` says "Stage's non-passive listener": reword to name `StageGestures.attachWheel` (attached by Stage). Nothing else in the map names a moved member.
- `src/webview/Pins.svelte:37` comment "Stage's startDrag treats …": reword to `StageGestures.startDrag`. Comment only.

## Out of scope

- Any behavior, look, focus, ARIA, live-region or timing change; any message, disk, MCP, Agent skill or CSP change.
- Frame-focus tracking, `revealFocused`, `focusViewport`, `attachResize` (not gesture glue; they stay in Stage).
- New pure `.ts` rules or unit tests for the moved code: the moved logic is glue (capture bookkeeping, DOM focus), and Vitest here does not compile runes (`vite.config.ts` has no Svelte plugin), so the browser suites are the check.
- D1 (stage focus handle off `PinThread`) and every other 11e1 item not picked.
- `project-overview.md` (refreshed at `/complete`), gallery (no look change).

## Build loop

`workflow.stepReview: feature` (one review at the end), `checkpointCommits: disabled` (`/complete` makes the one commit). Per step: change, narrow checks (`pnpm test`, `pnpm run check`; browser: `vp build -c vite.webview.config.ts`, then `playwright test -c tests/browser <spec> --grep "<test>"`), Done when, next. One full `pnpm test:browser` at the end. Every `.svelte` / `.svelte.ts` edit goes through `svelte-autofixer` until clean (rule 08; in Claude Code delegate to `svelte-file-editor`). After reverting a probe, rebuild `dist` before the next browser run.

## Build steps

1. [x] **Pan guard test.** In `tests/browser/stage.spec.ts`, new test "a pointer drag on the empty stage pans, and stops on release". The page is 1280x800 (`playwright.config.ts`), so the whole path stays inside `.viewport`, moving up-left:
   1. `openSeededStage(page)`; `const stage = await stageBox(page)`; `start = { x: stage.x + stage.width - 40, y: stage.y + stage.height - 40 }`; `release = { x: start.x - 80, y: start.y - 60 }`.
   2. Assert `document.elementFromPoint` at `start` and at `release` is the `.viewport` element (if not, move both points left or up, never drop the assertion).
   3. `before = await frameBox(page, 'a')`; `mouse.move(start)`, `mouse.down()`, `mouse.move(release, { steps: 8 })`, `mouse.up()`; `nextAnimationFrame`; A's box equals `before` shifted by (-80, -60) (`expectBoxNear`).
   4. `mouse.move(release.x - 30, release.y - 30, { steps: 4 })` with no button; `nextAnimationFrame`; A's box is unchanged from step 3.
   No `harness.ts` change.
   Done when: passes on current code; a probe making `moveDrag` a no-op fails it; a probe making `endDrag` a no-op fails it (step 4); probes reverted, `dist` rebuilt.
2. [x] **`StageGestures`** (A). Done when: `pnpm run check` clean; `stage.spec.ts` passes in full, plus the Step 1 test and `pins.spec.ts` "a pointer drag starting on a pin does not pan"; each probe fails its test, then is reverted:
   - Escape effect never adds its listener → "Escape mid-drag returns the frame and posts nothing on release".
   - `releaseOnRemove` body emptied → "a frame removed mid-drag does not block the next drag".
   - `handleFrameKeyup` commits on every arrow release (drop the `#heldArrows.size === 0` check) → "arrow keys on a focused label nudge and commit once on release" (its two-arrow hold).
3. [x] **`InspectorFocus`** (B). Done when: `pnpm run check` clean; `editMode.spec.ts` passes in full; each probe fails its test, then is reverted:
   - `armWidthFocus` empty → "Add border saves width and style once, focuses Width and announces it".
   - Handoff `$effect` body emptied → "Tab out of an emptied border Width saves once and focuses Add border".
   - `$effect.pre` always sets `focusedSection = undefined` → "an emptied border field stays while drafted; Enter saves once and focuses Add border".
4. [x] **Catalog, map, comment** (D). Done when: rule 08 lists both helpers; the map line names `StageGestures.attachWheel`; `Pins.svelte:37` names `StageGestures.startDrag`; `pnpm run check` (agent rules check included) passes.
5. [x] **Re-measure** (C). Done when: the report's new section has every Baseline figure as `baseline → now`, the four 11e3 input rows with the handler-regex line, the two closing lines, and "Re-measure" on line 3.
6. [x] **Full checks.** `pnpm verify` green; one full `pnpm test:browser` green: 233 gating (232 at `fa399a4` + the Step 1 test). Done when both pass, counts recorded here. Recorded 2026-11-27 after F-01 to F-03: `pnpm verify` green (75 files, 927 tests); `pnpm test:browser` 233 passed (224 gallery / showcase skipped).

## Files / areas

- New: `src/webview/stageGestures.svelte.ts`, `src/webview/inspectorFocus.svelte.ts`.
- Edit: `src/webview/Stage.svelte`, `src/webview/Inspector.svelte`, `src/webview/Pins.svelte` (comment), `tests/browser/stage.spec.ts`, `.claude/rules/08-svelte-chrome.md`, `blueprint/context/system-map.md`, `blueprint/reference/11e-comments-review.md`.
- Unchanged: `DesignPage.svelte` (Stage and Inspector props unchanged), `frameGesture.ts`, `canvasState.svelte.ts`, `editState.svelte.ts`, `harness.ts`.

## Data / contracts

No message, disk, MCP or persisted-data change. The only new contracts are the two class interfaces in A and B; Stage's and Inspector's `Props` and Stage's `focusViewport` export are unchanged.

## Testing

- Existing: every unit and browser test unedited and green.
- New: Step 1's pan guard (browser), written before the move.
- Probes: Steps 1-3, each against the one test named.
- No unit test: no pure rule is added; rune classes are not compiled under Vitest here.

## Notes for the AI

- Read the Svelte docs sections for `$effect`, `$state` in classes and attachments before writing (rule 08 MCP steps). The repo's `pinThread.svelte.ts` and `commentPicker.svelte.ts` already create `$effect` / `$effect.pre` in constructors: same pattern.
- `#captured` must stay `$state` (the template's classes and `lifted` read it through the getter); `widthFocus`, `focusedSection`, `tabbed`, `heldArrows`, `lastPointerX/Y` stay plain fields as today.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":14617,"specSha256":"5f131000c8a1bc9c83547e98286b59ef8904cef938a26aca200479973b49c05d","branch":"refs/heads/feature/stage-inspector-helpers","head":"fa399a4f3062eca2676855c00074da8564877477","baseRef":"refs/heads/main","baseCommit":"fa399a4f3062eca2676855c00074da8564877477","sourceTree":"08417481fa2d630d5a639969d678c53bb6333266","landing":"local-merge","absentOptional":[]} -->

## Findings

### 11e3/F-01 [P3] closed - Step 6 unchecked and its counts not recorded

**File:** blueprint/context/current-feature.md:96
**Found:** 2026-11-27 by /audit (scope: current; lens: all)
**Why it matters:** Step 6's Done when asks for the Verify and browser counts in the spec; `/complete` archives it, so the final-gate record would be missing.
**Suggested fix:** Run the final gates after repairs, tick Step 6, record the counts.
**Resolution:** fixed - Step 6 ticked, counts recorded in the spec (verify 75 files / 927 tests; browser 233 passed). Closed by /audit re-review 2026-11-27: Step 6 `[x]`, counts recorded, no new defect.

### 11e3/F-02 [P3] closed - System-map edit leaves a ragged short line

**File:** blueprint/context/system-map.md:526-527
**Found:** 2026-11-27 by /audit (scope: current; lens: quality)
**Why it matters:** The reworded wheel-input sentence wraps to a short line ("frame, and the root scroll sink. Chromium"); plain-text readers see a broken paragraph.
**Suggested fix:** Reflow the paragraph to its width.
**Resolution:** fixed - paragraph reflowed to 100 columns; wording unchanged. Closed by /audit re-review 2026-11-27: lines 525-531 reflowed (49-100 columns), wording unchanged.

### 11e3/F-03 [P3] closed - Plain `Set` for held arrows has no why comment

**File:** src/webview/stageGestures.svelte.ts:26
**Found:** 2026-11-27 by /audit (scope: current; lens: quality)
**Why it matters:** svelte-autofixer suggests `SvelteSet` for `#heldArrows`; the plain `Set` is deliberate (nothing reads it reactively), but nothing says so, so a later editor may follow the suggestion and add needless reactivity.
**Suggested fix:** One-line comment above `#heldArrows`: not reactive on purpose, only the key handlers read it.
**Resolution:** fixed - one-line why comment above `#heldArrows`. Closed by /audit re-review 2026-11-27: comment accurate (only the three key handlers touch the Set); its extra line staled one report figure, filed as 11e3/F-04.

### 11e3/F-04 [P3] closed - Re-measure row for `stageGestures.svelte.ts` stale after F-03

**File:** blueprint/reference/11e-comments-review.md:400
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: quality)
**Why it matters:** F-03 added a comment line, so `wc -l` prints 234, but the archived 11e3 record said 233.
**Suggested fix:** `new: 233` → `new: 234`; note the rows were re-checked after the audit fixes.
**Resolution:** fixed - row reads 234; the Measured line says the 11e3 inputs rows were re-checked after 11e3/F-01 to 11e3/F-05. Closed by /audit re-review 2026-11-27: all four 11e3 input rows re-run and match (stageGestures 234).

### 11e3/F-05 [P3] closed - Pan test does not assert its post-release point is on the stage

**File:** tests/browser/stage.spec.ts:715
**Found:** 2026-11-27 by /audit re-review (scope: current; lens: tests)
**Why it matters:** If `(release.x - 30, release.y - 30)` ever lands on an iframe, the move never reaches the viewport and the "stops on release" half passes with `endDrag` broken.
**Suggested fix:** Assert `onViewport` for that point before the move.
**Resolution:** fixed - `after` point asserted on `.viewport` before the buttonless move; test and `endDrag` probe re-run. Closed by /audit re-review 2026-11-27: `after` asserted on `.viewport` (`.pins` is pointer-events none); `endDrag` no-op still caught.
