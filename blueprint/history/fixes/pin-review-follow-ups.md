# Fix: Pin review follow-ups

**Type:** Fix
**Status:** verified
**Branch:** fix/pin-review-follow-ups
**Fixes:** F-88, F-91, F-92

Follow-ups from the independent review of 8f2 Pins. The user approved this exact scope and goes straight to `/implement`: there is no spec-review round, so every step below is literal.

## The problem

1. **F-88 [P3]: the thread can be hidden but still open.**
   - `App.svelte` renders the thread while `openPin !== undefined` (`openPin` = the open id's entry in `pins`).
   - `openThreadId` is cleared only by explicit `keepThread()` calls, in 5 places: `comments:updated`, `keepLiveCommentState`, `cd:ready`, `cd:anchor-rects` and `handleFrameGesture`.
   - Other changes to the inputs of `pins` (`comments`, `anchors`, `displayFrames`, `committedView`) never call it:
     - the `cd:frame-height` branch;
     - `settleFrameGesture` in `applyCanvasUpdated`, which runs after `keepLiveCommentState`;
     - `failFrameGesture` in the `artboard:error` branch.
   - When one of those unplaces the open pin, the thread unmounts with `openThreadId` still set. Focus falls to `body`. When the pin comes back, the thread remounts and takes focus.
   - **Reproduced** on `main` (`a816338`) with a temporary probe, since deleted:
     1. open the `#doomed` thread;
     2. `document.body.replaceChildren()` in the frame;
     3. focus is on `BODY`;
     4. grow the page again: the thread is back (count 1).
   - Root cause: a per-caller guard. Every new path that moves pins has to remember to call `keepThread()`. The review found it missing twice.
2. **Flaky 8f2 test, found while reproducing F-88. Not in the ledger.**
   - The test `a removed target shows the missing badge at its stored rect` fails 3 of 8 runs on `main` (`--repeat-each 8`).
   - Removing `#doomed` shrinks the page from about 345px to about 305px.
   - `DOOMED.rect` (y 300, pin at y 312) then falls outside the frame, so the pin is correctly unplaced after the 100ms height debounce.
   - The test passes only when it reads the pin box inside that window.
   - This is test data, not product behavior. It is fixed here because the final `pnpm test:browser` must be green.
3. **F-91 [P3]: a duplicate clamp.**
   - `src/webview/frame/anchorRects.ts` has private `clampCoordinate` and `clampSize`.
   - They duplicate `clampNumber` in `src/webview/stageGeometry.ts`.
4. **F-92 [P3]: a stale comment.**
   - The `postToFrame` comment in `src/webview/hostBridge.svelte.ts` says the payload is "only a mode or a step command".
   - `cd:anchors` now also sends comment ids and selectors.
5. **Pin observer test gap. No ledger id.**
   - Nothing fails if either of these is removed from `installPinAnchors` (`src/webview/frame/pinAnchors.ts`):
     - the `observed`-set diff (`unobserve` of targets that are gone, `observe` only of new ones);
     - the `stop()` teardown on an empty `cd:anchors`.
   - The quiet-page test cannot catch the diff, because Chromium makes a repeated `observe()` a no-op.

## The fix

### F-88: close at the shared root, once

- Replace the `keepThread` function in `App.svelte` with one `$effect.pre` that runs the same check. Keep it where `keepThread` is now, after `closeThreadImplicitly`.
- Delete all 5 `keepThread()` call sites. The effect re-runs whenever `pins` or `openThreadId` changes, so every path that can unplace the pin is covered, including the 3 that are missing today and any future one.

```svelte
	// Closes the open thread whenever its pin is no longer placed, whatever moved it (comments,
	// a frame's answer, its height, a reload, a drag preview or its settle). Pre: it runs before the
	// thread leaves the DOM, so focus inside it still moves to the stage viewport, never body.
	$effect.pre(() => {
		if (keepOpenThread({ openThreadId, pins }) === undefined) {
			closeThreadImplicitly();
		}
	});
```

- **Why an effect and not `$derived`:**
  - Closing is sticky: the thread must not come back when the pin returns. A derived `openThreadId` would bring it back.
  - Closing has a DOM side effect: it moves focus.
  - So this is the "escape hatch" case the Svelte docs allow. The effect does one job.
- **Why `.pre`:** `$effect.pre` runs before the DOM updates scheduled after it. The thread's `{#if}` lives in Stage's `children` snippet, which is created after App's script. So `threadHasFocus()` still sees focus inside the thread, and `stage.focusViewport()` runs before the thread unmounts. A plain `$effect` would run after the unmount and lose the focus fallback.
  - Proved: a temporary build of exactly this change (since reverted) passed the full `pnpm test:browser` (81 tests, including the probe below and the existing `cd:ready`, `comments:updated`, Escape and draft-closes-thread cases), and focus landed on `.viewport`.
- **Autofixer:** `svelte-autofixer` on the result reports `issues: []`. It adds two suggestions, "calling `closeThreadImplicitly` / `keepOpenThread` inside an $effect". Both are expected and acknowledged: the state write is the deliberate close described above. `main` already carries the `SvelteMap` suggestion for `iframes`. This is the one sanctioned departure from rule 08's "repeat until no suggestions". Fix any other suggestion.
- **Leave unchanged:**
  - `closeThreadImplicitly` (still called directly by `applyPickToDraft`);
  - `handleThreadClose`, `handlePinOpen`;
  - `keepOpenThread` in `pins.ts`;
  - the render condition.
- **Must not break:**
  - Escape / Close focuses the pin.
  - A draft closes the thread.
  - A pin click swaps or toggles the thread.
  - Toggling Comment mode keeps the thread open.
  - A `comments:updated` without the comment closes it and focuses the stage.
  - A reload that unplaces the pin closes it for good.
- **Contracts:** none change. There is no new message, rule module or helper, so the rule 05 catalog is unchanged.

### Flaky test data

- In `tests/browser/pins.spec.ts`, change `DOOMED.rect` from `{ x: 24, y: 300, width: 80, height: 24 }` to `{ x: 24, y: 200, width: 80, height: 24 }`. Keep the comment above it.
- The fallback pin is then at y 212, inside the page after the removal (about 305px), and is still placed after the shrink.
- Every other use of `#doomed` goes through the live element (`elementBox`), so no other test changes.

### F-91: one clamp

- **Semantics checked equal:**
  - Both helpers are `Math.min(max, Math.max(min, value))`, with the same argument order.
  - The bounds are the same: `±MAX_FRAME_COORDINATE` for x/y, and `[0, MAX_FRAME_COORDINATE]` for width/height.
  - NaN gives NaN in both, and ±Infinity gives the bound in both.
- **Bundling is already accepted:**
  - `pickTarget.ts` (in the runtime through `commentPicking.ts`) already imports `clampNumber` from `../stageGeometry`.
  - Each embedded runtime in the canvas snapshot already has a `//#region src/webview/stageGeometry.ts` holding only `clampNumber`, because tree-shaking drops the rest.
  - No new module enters the frame IIFE.
- **Code:** in `anchorRects.ts`:
  - delete `clampCoordinate` and `clampSize`;
  - add `import { clampNumber } from '../stageGeometry';`;
  - write `capAnchorRect` as:

```ts
// Into parseFrameRect's bounds, so a measured rect never fails the chrome's own guard.
export const capAnchorRect = (rect: FrameRect): FrameRect => ({
	x: clampNumber({ value: rect.x, min: -MAX_FRAME_COORDINATE, max: MAX_FRAME_COORDINATE }),
	y: clampNumber({ value: rect.y, min: -MAX_FRAME_COORDINATE, max: MAX_FRAME_COORDINATE }),
	width: clampNumber({ value: rect.width, min: 0, max: MAX_FRAME_COORDINATE }),
	height: clampNumber({ value: rect.height, min: 0, max: MAX_FRAME_COORDINATE }),
});
```

- **Snapshot:**
  - Update `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` on purpose: `vp test -u src/disk/handoffCanvasHtml.test.ts`. Never use a blanket `-u`.
  - Expect 4 identical hunks, one per embedded runtime copy, HTML-escaped. Each hunk deletes the two `var clamp…` lines and makes `capAnchorRect` call `clampNumber`. The order of `//#region` blocks may change, because `anchorRects.ts` now depends on `stageGeometry.ts`, which is already emitted earlier.
  - Any other diff (a new region, other stageGeometry code, a changed `stageGeometry.ts` IIFE copy) means stop and report.
- **Tests:** the existing `capAnchorRect` test in `anchorRects.test.ts` (150000px box) must pass unchanged. No new test is needed: this is a one-line swap that behaves identically.

### F-92: comment only

`'*'` is still acceptable, and required:

- A frame is `sandbox="allow-scripts"` with no `allow-same-origin`, so its origin is opaque. There is no origin string to target.
- The frame can only navigate to `blob:`: the chrome CSP has `frame-src blob:` (`artboardChromeHtml.ts`). So any document that can receive the post is one the design's own script made.
- The payload holds nothing the frame does not already have: a mode, a step command, and this frame's own comment ids and selectors. Selectors describe its own DOM. Comment bodies, other frames' data and host state are never sent.

Replace the comment above `postToFrame` with:

```ts
// The only chrome → frame send. '*' because a sandboxed frame has an opaque origin, so there is
// nothing to target; the frame can only navigate to blob: (chrome CSP frame-src), a document its
// own script made. The payload is a mode, a step command, or this frame's own comment ids and
// selectors (cd:anchors), never comment bodies or another frame's data.
```

No code change.

### Observer test: a justified departure from rule 09

- **Why it departs:** rule 09 asserts through roles, `data-cd-*` hooks, messages and boxes. But the set of elements a `ResizeObserver` watches is invisible to the page. And Chromium makes a repeated `observe()` a no-op, so no message or box differs when the diff is deleted.
- **The smallest check that fails** is a wrapper on `ResizeObserver.prototype` inside the frame, installed with the existing `inFrame` helper:
  - It is installed after the runtime's height observer already observed `html`/`body`, and before the first non-empty `cd:anchors`, so it sees only the pin observer.
  - It needs no new harness helper, fixture or framework.
- **Fixture:** `openPinStage(page, [])` makes the chrome send `cd:anchors []`. The runtime answers once (forced), so the existing `anchorAnswers > 0` wait in `openPinStage` still holds. Every later `comments:updated` also forces one answer, so each step waits for a captured message, not a sleep.
- **Probe values on `main`, all stable across 3 repeats:**
  - `[TITLE, MOVER]` observes `HTML`, `mover`, `title`.
  - Sending the same comments again leaves the observe calls at 3 (3 → 3).
  - `[TITLE]` leaves `HTML`, `title`.
  - `[]` leaves nothing observed.
- **What it guards:**
  - Deleting the `unobserve` loop leaves `mover` observed.
  - Deleting the `!observed.has(element)` check makes the re-send add 3 observe calls.
  - Deleting the `stop()` call leaves `HTML` observed.
- **Ceiling:** deleting only `mutationObserver.disconnect()` inside `stop()` is not caught. Accepted: that is one line inside a function whose call is guarded.

## Build steps

- [x] **1. F-88: close the thread at the shared root (plus the flaky test data).**
  - `src/webview/App.svelte`:
    - replace `keepThread` with the `$effect.pre` above;
    - delete the 5 `keepThread();` lines (in `comments:updated`, `keepLiveCommentState`, the `cd:ready` branch, the `cd:anchor-rects` branch and `handleFrameGesture`);
    - add the `$effect.pre` comment above.
  - Svelte MCP:
    - before writing, run `list-sections` and `get-documentation` for `$effect`;
    - after writing, run `svelte-autofixer` on the full file until it reports `issues: []` and only the 3 suggestions listed in The fix.
  - `tests/browser/pins.spec.ts`:
    - change `DOOMED.rect` to y 200;
    - add this test right after `a reload that unplaces the open pin closes its thread, and it does not come back`:

    ```ts
    test('a page shrink that unplaces the open pin closes its thread, and it does not come back', async ({
    	page,
    }) => {
    	await openPinStage(page, [DOOMED]);
    	await expectPinOn({ page, id: DOOMED.id, selector: '#doomed', pin: DOOMED.pin });
    	await openThread(page, DOOMED.id);
    	// The target goes (box: null, so the pin falls back to the stored rect at y 200), then the page
    	// shrinks to its padding. Only cd:frame-height reports the shrink; the frame's answer is unchanged.
    	await inFrame(page, `document.body.replaceChildren()`);
    	await expect(pinOf(page, DOOMED.id)).toHaveCount(0);
    	await expect(thread(page)).toHaveCount(0);
    	await expect(page.locator('.viewport')).toBeFocused();
    	await inFrame(page, `document.body.style.height = '400px'`);
    	await expect(
    		page.getByRole('button', { name: 'Open comment, target missing: Doomed' }),
    	).toBeVisible();
    	await expect(thread(page)).toHaveCount(0);
    });
    ```

  - `blueprint/context/system-map.md`:
    - in the pins section (around line 317), replace the sentence "Open finding F-88: a `cd:frame-height` shrink that unplaces a fallback pin hides the thread without closing it." with "One `$effect.pre` in App closes it whenever `pins` no longer holds it, before it unmounts, so it never stays open while hidden.";
    - change **Last verified against code** to name this fix.
  - Ledger: set F-88 to `fixed`. Append to its Resolution: the date, `/implement`, the `$effect.pre` root fix, the 5 call sites deleted, and the new browser case with its mutation check.
  - **Done when:**
    - On `main` code with only the new test added, the new test fails at the `.viewport` focus assertion. The probe saw focus on `BODY`.
    - With the fix, it passes.
    - `pnpm exec playwright test -c tests/browser -g "removed target|page shrink" --repeat-each 10` passes every run, after `vp build -c vite.webview.config.ts`.
    - All of `tests/browser/pins.spec.ts` passes.
    - Mutation check: restore the 5 `keepThread()` calls and the old function in place of the effect, and the new test fails. Then restore the fix.
  - **Step notes:**
    - Old code + new test only: fails at `await expect(page.locator('.viewport')).toBeFocused()` ("Received: inactive").
    - With the fix: passes. `-g "removed target|page shrink" --repeat-each 10`: 20 passed. All of `pins.spec.ts`: 18 passed.
    - `svelte-autofixer` on `App.svelte`: `issues: []`, exactly the 3 sanctioned suggestions (`closeThreadImplicitly` / `keepOpenThread` in an $effect, `SvelteMap` for `iframes`).
    - Mutation (old `keepThread` function + 5 calls restored from HEAD): the new test fails at the `.viewport` focus assertion. Fix restored (`grep -c keepThread` = 0).

- [x] **2. F-91: one clamp in `capAnchorRect`.**
  - `src/webview/frame/anchorRects.ts` as in The fix.
  - Snapshot updated on purpose with `vp test -u src/disk/handoffCanvasHtml.test.ts`. Read the diff: it has only the 4 identical `anchorRects` hunks and possibly region order.
  - Ledger: set F-91 to `fixed`, with a Resolution line.
  - **Done when:**
    - `grep -n "Math.min\|Math.max" src/webview/frame/anchorRects.ts` prints nothing;
    - `anchorRects.test.ts` and `handoffCanvasHtml.test.ts` pass;
    - the snapshot diff matches the description above.
  - **Step notes:** the grep prints nothing. `anchorRects.test.ts` + `handoffCanvasHtml.test.ts`: 2 files, 12 tests passed. Snapshot diff: exactly 4 identical hunks (deletes the two `var clamp…` lines, `capAnchorRect` calls `clampNumber`), no `//#region` reorder, nothing else.

- [x] **3. F-92: reword the `postToFrame` comment.**
  - `src/webview/hostBridge.svelte.ts`: replace the 2-line comment with the 4 lines in The fix. Change nothing else.
  - Run `svelte-autofixer` on the file. It is a `.svelte.ts` module: expect no new issues.
  - Ledger: set F-92 to `fixed`, with a Resolution line.
  - **Done when:** the diff is comment lines only (`git diff src/webview/hostBridge.svelte.ts` shows no code line changed).
  - **Step notes:** diff is 2 comment lines replaced by 4. `svelte-autofixer`: `issues: []`, and the same 8 "function inside an $effect" suggestions as on the HEAD copy, so none new.

- [x] **4. Pin observer test.**
  - In `tests/browser/pins.spec.ts`, after `a static page goes quiet after its forced answer`, add the test below.
  - In that quiet-page test's comment, change "so this cannot catch a missing observed-set diff; it catches any other self-trigger." to "so this cannot catch a missing observed-set diff (the observer test below does); it catches any other self-trigger."

    ```ts
    // Departure from rule 09: a ResizeObserver's targets are invisible to the page, and Chromium makes
    // a repeated observe() a no-op, so no message or box shows the observed-set diff. This wraps the
    // prototype inside the frame after the height observer started and before the pin observer does.
    const TRACK_RESIZE_OBSERVER = `(() => {
    	const proto = ResizeObserver.prototype;
    	const { observe, unobserve, disconnect } = proto;
    	window.__cdObserved = new Set();
    	window.__cdObserveCalls = 0;
    	proto.observe = function (target, options) {
    		window.__cdObserveCalls += 1;
    		window.__cdObserved.add(target);
    		return observe.call(this, target, options);
    	};
    	proto.unobserve = function (target) {
    		window.__cdObserved.delete(target);
    		return unobserve.call(this, target);
    	};
    	proto.disconnect = function () {
    		window.__cdObserved.clear();
    		return disconnect.call(this);
    	};
    })()`;

    test('the pin observer watches only current targets and stops on empty anchors', async ({
    	page,
    }) => {
    	await openPinStage(page, []);
    	await inFrame(page, TRACK_RESIZE_OBSERVER);
    	const frame = await frameOf(page, 'a');
    	// Every comments:updated makes the frame answer once (a forced measurement).
    	const sendComments = async (comments: PostedComment[]): Promise<void> => {
    		const answers = await anchorAnswers(page);
    		await postToChrome(page, { type: 'comments:updated', comments });
    		await expect.poll(() => anchorAnswers(page)).toBeGreaterThan(answers);
    	};
    	const observed = (): Promise<unknown> =>
    		frame.evaluate(
    			`[...window.__cdObserved].map((element) => element.id || element.tagName).sort()`,
    		);
    	await sendComments([TITLE, MOVER]);
    	expect(await observed()).toEqual(['HTML', 'mover', 'title']);
    	// A measurement with the same targets observes nothing again.
    	const calls = await frame.evaluate('window.__cdObserveCalls');
    	await sendComments([TITLE, MOVER]);
    	expect(await frame.evaluate('window.__cdObserveCalls')).toBe(calls);
    	// A target that is no longer requested is unobserved.
    	await sendComments([TITLE]);
    	expect(await observed()).toEqual(['HTML', 'title']);
    	// Empty anchors tear the observer down.
    	await sendComments([]);
    	expect(await observed()).toEqual([]);
    });
    ```

  - Lint applies to the TypeScript, not the string. If `vp check` objects to anything in the test, fix the test, never the rule.
  - **Done when:**
    - the test passes;
    - each of 3 one-at-a-time mutations of `pinAnchors.ts`, restored after each, makes it fail:
      1. delete the `unobserve` loop;
      2. drop the `!observed.has(element)` condition, so every resolved element is observed;
      3. replace `stop();` with nothing.
    - Record the 3 results in the step notes.
  - **Step notes:**
    - The test passes (`--repeat-each 3`: 3 passed).
    - Mutation 1 (unobserve loop deleted): fails at `expect(await observed()).toEqual(['HTML', 'title'])` (`mover` stays observed). Restored.
    - Mutation 2 (`!observed.has(element)` dropped): fails at the observe-call count (expected 6, received 9: the re-send adds 3 calls). Restored.
    - Mutation 3 (`stop();` removed): fails at `expect(await observed()).toEqual([])`. Restored.
    - After each, `git diff --quiet src/webview/frame/pinAnchors.ts` was clean.

- [x] **5. Verify.**
  - Run `pnpm verify`.
  - Run `pnpm test:browser` (it rebuilds the chrome bundle first; the `dist/webview` left from the spec probe is stale).
  - **Done when:** both are green, and the ledger shows F-88, F-91 and F-92 as `fixed`.
  - **Step notes:** `pnpm verify` exit 0 (vp check: 118 files clean; agent rules OK; svelte-check 106 files, 0 errors, 0 warnings; `vp test` 36 files, 451 tests passed; pack and webview build OK). `pnpm test:browser` exit 0: 81 passed, including both new `pins.spec.ts` cases. Ledger: F-88, F-91, F-92 `fixed`.

## Verify

- `pnpm verify` is green.
- `pnpm test:browser` is green, with 2 new cases in `pins.spec.ts`: `a page shrink that unplaces the open pin…` and `the pin observer watches only current targets…`.
- The `--repeat-each 10` run from step 1 is stable.
- Optional F5 in `fixtures/dev-workspace`:
  1. open a comment's thread on an element near the bottom of a page;
  2. have the design script delete it and shorten the page;
  3. the thread closes and focus lands on the stage (not body);
  4. lengthening the page brings the pin back without the thread.

## Departures and open questions

- **Rule 08 (autofixer).** The two "function inside an $effect" suggestions are acknowledged, not fixed. The close has to write state and move focus. See The fix.
- **Rule 09 (asserting through roles, hooks, messages and boxes).** The observer test instruments `ResizeObserver.prototype` inside the frame. This is justified in its comment; it is the only way to see the diff.
- **Scope addition.** The `DOOMED.rect` test-data change was not in the review. It is a flaky 8f2 test (3/8 failures on `main`) with the same mechanism as F-88, and it would block step 5.
- **Open questions:** none.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":21767,"specSha256":"506c7a4ef023f349e7d6ba039c91ac7b801070caab061cf4acc7b241cf9087e5","branch":"refs/heads/fix/pin-review-follow-ups","head":"224d0d348be16d38953de9a82ae6830d345f35a0","baseRef":"refs/heads/main","baseCommit":"a816338cf4aaa726da34650c3fee2705e28d2f64","sourceTree":"414a1ae19712b947c353afc9b583b802e5bfa8d9","landing":"local-merge","absentOptional":[]} -->

## Findings

### pin-review-follow-ups/F-88 [P3] closed - The thread can be hidden but still "open" after a frame reload or a frame-width preview

**File:** src/webview/App.svelte:454 (render condition at :638)
**Found:** 2026-10-27 by /audit (scope: current; lens: quality)
**Why it matters:** The thread renders while `openPin !== undefined`, but it is closed (`keepThread`) only from `comments:updated`, `cd:anchor-rects` and `keepLiveCommentState`. The `cd:ready` branch drops the frame's anchors, which moves its pins to the stored-rect fallback, and does not call `keepThread`; a width drag preview changes `displayFrames` and does not either. If the fallback point (or the narrowed frame) leaves the pin unplaced, the thread disappears while `openThreadId` is still set, focus inside it falls to body (the thing `closeThreadImplicitly` exists to prevent), and it reappears when the pin comes back, which the spec says it must not. Narrow: it needs a stored rect outside the frame after a reload, or a shrink past the pin during a resize drag.
**Suggested fix:** Call `keepThread()` after the `dropFrameAnchors` in the `cd:ready` branch and in `handleFrameGesture` after it updates `gesture`. Alternatively render from `keepOpenThread({ openThreadId, pins })` so the hidden state and the closed state cannot differ. A browser case (reload with the open pin's frame shrunk) would pin it.
**Resolution:** 2026-10-27 /implement (audit repair): `App.svelte` calls `keepThread()` after `dropFrameAnchors` in the `cd:ready` branch and after `handleFrameGesture` updates `gesture`. New browser case `a reload that unplaces the open pin closes its thread, and it does not come back` (stored rect outside the frame) fails without the `cd:ready` call (mutation-checked, file restored).
2026-11-09 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): both named `keepThread()` calls are present, but the defect is still reachable after a reload, so this goes back to `open`. The `cd:frame-height` branch (App.svelte:454) updates the frame record and never calls `keepThread`. Path: the open thread's pin has a stored-rect position (a live `box: null`, shown as missing); a reload or script makes the page shorter, and `nextFrameHeight` applies a shrink at once. `layoutPins` then puts the point outside the frame, so `openPin` is undefined and the thread unmounts with `openThreadId` still set. The runtime's `resize` measurement sends nothing, because `anchorsMoved` sees `box: null` unchanged, so `keepThread` is not called. Focus falls to body, and if the frame later grows the thread remounts and `focusOnOpen` takes focus. `applyCanvasUpdated` has the same order problem: `keepLiveCommentState` (:194) runs before `settleFrameGesture` (:195). Found by reading the code; not reproduced in a browser. New suggested fix: add `keepThread()` after `updateFrame` in the `cd:frame-height` branch and move or repeat it after `settleFrameGesture`, or render from `keepOpenThread({ openThreadId, pins })` so hidden and closed cannot differ.
2026-11-12 /implement (fix/pin-review-follow-ups): root fix. `App.svelte` replaces `keepThread` with one `$effect.pre` that closes the thread whenever `keepOpenThread({ openThreadId, pins })` is undefined, so every change to `pins` or `openThreadId` is covered (including `cd:frame-height`, `settleFrameGesture` and `failFrameGesture`). Pre, so it runs before the thread unmounts and focus still moves to the stage viewport. All 5 `keepThread()` call sites deleted. New browser case `a page shrink that unplaces the open pin closes its thread, and it does not come back` fails at the `.viewport` focus assertion on the old code and with the old `keepThread` function and its 5 calls restored (mutation-checked, fix restored); passes with the fix, and `--repeat-each 10` with the removed-target case is stable.
2026-11-12 independent /audit (fresh subagent, claude-sonnet-5-5; scope: current; lens: quality, security, performance, tests): closed. Re-read `App.svelte`: the one `$effect.pre` (:264) closes the thread through `closeThreadImplicitly` whenever `keepOpenThread({ openThreadId, pins })` is undefined, and no `keepThread` reference remains in `src/` or the rules. `pins` is the shared input, so `cd:frame-height`, `settleFrameGesture` and `failFrameGesture` are covered. The effect reads and writes only `openThreadId` (plus `stage` in the focus branch), so it cannot loop, and `.pre` runs before the thread unmounts. The new browser case and the whole `pnpm test:browser` run (81 passed) pass. No new defect found in the repair.

### pin-review-follow-ups/F-91 [P3] closed - capAnchorRect adds a third copy of the frame-coordinate clamp

**File:** src/webview/frame/anchorRects.ts:42
**Found:** 2026-11-09 by independent /audit (scope: current; lens: quality)
**Why it matters:** `clampCoordinate` and `clampSize` hand-write `Math.min` / `Math.max`, while `stageGeometry.ts` already owns `clampNumber` and a private `clampCoordinate` with the same name and bounds (:359). Rule 03 calls a twin helper a bug, and rule 05 says to extend the owner. The frame bundle already imports `clampNumber` (`pickTarget.ts:5`), so the shared helper is available there. No behavior differs today.
**Suggested fix:** Delete both local helpers and call `clampNumber({ value, min, max })` from `stageGeometry.ts` in `capAnchorRect`, or export `clampCoordinate` from there. `clampNumber` replaces them. Current requirement lost: None.
**Resolution:** 2026-11-12 /implement (fix/pin-review-follow-ups): `anchorRects.ts` deletes `clampCoordinate` and `clampSize`; `capAnchorRect` calls `clampNumber` from `../stageGeometry` with the same bounds (`±MAX_FRAME_COORDINATE` for x/y, `[0, MAX_FRAME_COORDINATE]` for width/height). The existing `capAnchorRect` test passes unchanged. The canvas snapshot was updated on purpose (`vp test -u src/disk/handoffCanvasHtml.test.ts`): 4 identical hunks, one per embedded runtime, and no other change.
2026-11-12 independent /audit (fresh subagent, claude-sonnet-5-5; scope: current; lens: quality, security, performance, tests): closed. `anchorRects.ts` no longer has its own clamps; `capAnchorRect` calls `clampNumber` (`Math.min(max, Math.max(min, value))`, same arguments and bounds as the deleted helpers). The snapshot diff is exactly 4 identical hunks, and `anchorRects.test.ts` plus `handoffCanvasHtml.test.ts` pass in `pnpm verify`.

### pin-review-follow-ups/F-92 [P3] closed - postToFrame's wildcard-origin justification no longer describes the payload

**File:** src/webview/hostBridge.svelte.ts:53
**Found:** 2026-11-09 by independent /audit (scope: current; lens: security, quality)
**Why it matters:** The comment says the `'*'` target is safe because "the payload is only a mode or a step command, nothing private". `cd:anchors` now sends comment ids and selectors through the same call. The risk is small: selectors describe the frame's own DOM, and comment bodies are not sent. But a design script can navigate its own frame, and a `'*'` post then reaches that page, so the next change to this payload would be weighed against a false statement.
**Suggested fix:** Reword the comment to say what is sent and why it is acceptable: mode, step commands, and this frame's own comment ids and selectors, never comment bodies. Comment only.
**Resolution:** 2026-11-12 /implement (fix/pin-review-follow-ups): the comment above `postToFrame` now says why `'*'` is required (a sandboxed frame's opaque origin; the frame can only navigate to `blob:` under the chrome CSP `frame-src`) and what is sent (a mode, a step command, or this frame's own comment ids and selectors, never comment bodies or another frame's data). Comment lines only; no code changed.
2026-11-12 independent /audit (fresh subagent, claude-sonnet-5-5; scope: current; lens: quality, security, performance, tests): closed. The new `postToFrame` comment matches the code: `Frame.svelte:85` is `sandbox="allow-scripts"` (opaque origin) and `artboardChromeHtml.ts:35` has `frame-src blob:`; `cd:anchors` sends only ids and selectors. The diff changes comment lines only.

## Independent review

**Status:** passed
**Target commit:** 224d0d348be16d38953de9a82ae6830d345f35a0
**Base commit:** a816338cf4aaa726da34650c3fee2705e28d2f64
**Base ref:** origin/main
**Spec hash:** 506c7a4ef023f349e7d6ba039c91ac7b801070caab061cf4acc7b241cf9087e5
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-sonnet-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-12T15:59:49Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-sonnet-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-12T16:20:00Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `pnpm verify`: pass (vp check 118 files clean, agent rules check, svelte-check 106 files with 0 errors and 0 warnings, `vp test` 36 files and 451 tests, pack and webview build)
- `pnpm test:browser`: pass (81 passed, including `a page shrink that unplaces the open pin closes its thread, and it does not come back` and `the pin observer watches only current targets and stops on empty anchors`)
- `pnpm knip`: pass (exit 0, no unused files or dependencies reported)

### Evidence

- Preconditions confirmed before review: adapter `claude`, runtime model `claude-sonnet-5-5`, `HEAD` equals the target, `git merge-base origin/main HEAD` equals the base commit, `current-feature.md` SHA-256 equals the spec hash (spec is tracked, no snapshot), and the only path differing from the target was `blueprint/context/review.md`.
- Reviewed the full `a816338..224d0d3` delta: `src/webview/App.svelte`, `src/webview/frame/anchorRects.ts`, `src/webview/hostBridge.svelte.ts`, `tests/browser/pins.spec.ts`, the canvas snapshot, and the spec, overview and system-map edits. Followed `keepOpenThread` and `layoutPins` (`src/webview/pins.ts`), `focusViewport` (`Stage.svelte`), `CommentThread.svelte`, `installPinAnchors`, `clampNumber` (`stageGeometry.ts`), `Frame.svelte` and the chrome CSP.
- `$effect.pre` in `App.svelte`: reads `openThreadId` and `pins`, writes only `openThreadId`, so it cannot loop. It runs before the thread unmounts, so focus moves to the viewport. No `keepThread` reference remains in `src/` or the rules.
- `capAnchorRect` now calls `clampNumber` (`Math.min(max, Math.max(min, value))`) with the bounds of the deleted helpers. The snapshot diff is exactly 4 identical hunks, one per embedded runtime copy, with no other change.
- The rewritten `postToFrame` comment matches the code (`sandbox="allow-scripts"` at `Frame.svelte:85`, `frame-src blob:` at `artboardChromeHtml.ts:35`, `cd:anchors` carries ids and selectors only).
- Tests: the new shrink case and the observer case assert through boxes, counts, focus and captured messages. The observer case's departure from rule 09 is justified in its comment. The `DOOMED.rect` change removes a real timing dependency. No skipped, focused or placeholder tests in the delta.
- Findings F-88, F-91 and F-92 re-examined against the new code and moved from `fixed` to `closed`. No new finding was raised.

### Findings

- No new findings. Closed this pass: F-88, F-91, F-92. No P0 or P1 finding is open or fixed.

### Remaining risk

- Not run: the optional F5 check in `fixtures/dev-workspace` (Cursor-only focus behavior); the browser harness stands in for it.
- Ceiling accepted by the spec: deleting only `mutationObserver.disconnect()` inside `stop()` in `pinAnchors.ts` is not caught by the observer test.
- Carried-over open findings unrelated to this delta (F-09, F-14, F-15, F-28, F-38, F-39, F-75, F-76, F-83, F-84) and unverified/fixed P3 leads (F-16, F-25, F-56, F-57, F-59) were not re-reviewed beyond what the delta touches; none is P0 or P1.

## Try it now

Run or do:

1. `pnpm test:browser`. It rebuilds the chrome bundle, then runs the Playwright suite.
2. Optional F5 (Extension Development Host, `fixtures/dev-workspace`): add a comment on an element near the bottom of a design and open its pin's thread. Have the design's script delete that element and shorten the page, then lengthen the page again.

Expected:

1. 81 passed, including `a page shrink that unplaces the open pin closes its thread, and it does not come back`, `the pin observer watches only current targets and stops on empty anchors`, and `a removed target shows the missing badge at its stored rect`.
2. When the page shrinks, the thread closes and focus lands on the stage, not the page body. When the page grows back, the pin returns as "target missing" and the thread stays closed.

This proves:

The open thread closes whenever its pin stops being placed, whatever moved it, and it never reopens by itself. The pin observer watches only the current targets and stops on empty anchors.
