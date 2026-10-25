# Fix: Fewer pick re-posts on scroll

**Type:** Fix
**Status:** verified
**Branch:** fix/fewer-pick-re-posts-on-scroll
**Fixes:** F-46

## The problem

In Comment mode, the frame runtime (`src/webview/frame/commentPicking.ts`) re-posts the full `cd:pick` on every `scroll` event (a capture listener, so every scroll box counts) and every `resize`, through `repostRects` → `postPick`:

- The payload is the whole pick: selector up to 1000 chars, text up to 200, up to 13 style values of up to 200 chars. That's about 4 KB worst case.
- Chrome structured-clones it, runs `parseFramePick` over all of it, and replaces its `$state` pick on every event.
- Scrolling a box that doesn't contain the picked element still re-posts an identical pick.
- Scrolls of different boxes, or a scroll plus a resize, in the same animation frame each re-post.
- While the picked element is removed by the design, every re-post runs `describeElement` again (the F-56 repair stores a new description each time).

It isn't visibly slow today. The user chose the cheap fix: fewer re-posts, with the `cd:pick` contract unchanged. A smaller re-post message is 8f2's job (`cd:anchors` / `cd:anchor-rects`).

## The fix

### Pure rule (`src/webview/frame/pickTarget.ts`, no DOM)

- Move `sameRect(left, right)` from `commentPicking.ts` into `pickTarget.ts` and export it. `postHover` imports it, with its behavior unchanged.
- Add `isUnchangedPick({ last, next })`. Each of `last` and `next` is `{ element: T; described: object; rect: FrameRect | null; point: { x: number; y: number } }`, generic over the element type like `pickTarget`. It returns `true` only when all four hold:
  - `last.element === next.element`;
  - `last.described === next.described` (the same description object);
  - `sameRect(last.rect, next.rect)`;
  - `last.point.x === next.point.x` and `last.point.y === next.point.y`.

### Runtime (`commentPicking.ts`)

1. **One post path.** `postPick({ force }: { force: boolean })` keeps the single `host.postMessage` call for `cd:pick`, so `runtime.test.ts`'s count of 5 `host.postMessage` call sites stays true.
   - Order:
     1. Resolve `anchor`, `current` and `described` (return early as today).
     2. Compute `rect = visibleRect(current)` and `point = pickPoint(anchor, current)`.
     3. If `!force`, `lastPosted !== undefined` and `isUnchangedPick({ last: lastPosted, next })`, return without posting.
     4. Otherwise post, then set `lastPosted = { element: current, described, rect, point }`, after `host.postMessage` returns.
   - A click and every ↑/↓ step (keys and `cd:pick-parent` / `cd:pick-child`) call `postPick({ force: true })`, so chrome still gets a post on every step even when nothing changed.
   - Store the description object itself in `lastPosted`, never a field or property spelled `.styles`. The runtime test forbids the substring `.style`.
2. **A removed target is described again once.** The F-56 re-describe in `postPick` runs only while the cached description still has a non-null selector: `!current.isConnected && described.selector !== null`. A page pick never gets here, because `body` stays connected. The first post after removal therefore sends `selector: null` with `rect: null`, and later re-posts compare equal and go quiet.
3. **At most one re-post per animation frame.**
   - `repostRects` (the scroll and resize listener) only schedules: if `pendingRepost === undefined`, `pendingRepost = requestAnimationFrame(repostFrame)`.
   - `repostFrame`:
     1. clears `pendingRepost = undefined` first;
     2. returns unless `mode === 'comment'`;
     3. reads `hover` at callback time and re-posts it as today (`postHover` already skips unchanged rects);
     4. calls `postPick({ force: false })` when `path` is non-empty.
   - A `scroll` event fires before that frame's rAF callbacks, so batching adds no visible lag.
   - `setMode` also cancels `pendingRepost` (`cancelAnimationFrame`, then `undefined`), next to `cancelPendingHover`.
   - `lastPosted` needs no reset: an empty `path` stops re-posts, and the next click or step forces a post.

### Must not break

- **Pick posts:** every click and step posts exactly once, immediately (no rAF).
- **Moved picks:** a scroll that moves the pick still re-posts in the next frame, with the new `rect` and `point`.
- **Hover:** posting rules unchanged.
- **Contract:** `cd:pick` is unchanged; rule 02 and chrome are untouched.
- **Design DOM:** the runtime still never writes to it.

## Build steps

- [x] **1. Skip unchanged re-posts, describe a removed target once, batch re-posts per frame.**
  - `pickTarget.ts`: export `sameRect`, and add `isUnchangedPick`.
  - `pickTarget.test.ts` covers `isUnchangedPick`:
    - all the same → `true`;
    - a new description object with equal fields → `false`;
    - a rect moved 1px → `false`;
    - point `x`, then point `y`, differs → `false`;
    - `null` vs `null` rect → `true`;
    - `null` vs a rect → `false`;
    - a different element → `false`.
  - `commentPicking.ts` as above.
  - Rule 05 catalog: add `sameRect` and `isUnchangedPick` to the `pickTarget.ts` entry.
  - `runtime.test.ts`: the `host.postMessage` count stays 5 and the forbidden list is unchanged. Add `cancelAnimationFrame(pendingRepost` to the required strings as a smoke check.
  - Update `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` deliberately. Expect 4 identical runtime hunks, HTML-escaped, and nothing else.
  - **Done when:** the new `pickTarget.test.ts` cases pass; reverting the skip in `postPick` or removing a field from `isUnchangedPick` makes a test fail; `pnpm verify` is green.

- [x] **2. Audit repairs (2026-10-25 `/audit current`).**
  - F-59: `isUnchangedPick`'s test also changes only the rect's `y`, `width` and `height`.
  - F-60: the removed-target guard in step 1 (`described.selector !== null`) became a per-pick `removed` `WeakSet`, reset with `descriptions`. That covers a replaced `body` page pick, and a target finder never resolved.
  - In `repostRects`, schedule only in Comment mode, so Interact mode does no work on scroll.
  - **Done when:** dropping `sameRect`'s `y` check fails the test; `pnpm verify` is green (307 tests); `pnpm knip` is clean.

## Verify

- `pnpm verify`.
- **Behavior:** the runtime listeners have no unit tests (rule 09: iframe behavior is proven in a browser). The 8d3 Playwright suite takes over the behavior check:
  - with a pick made, scrolling a box that doesn't contain it sends no `cd:pick`;
  - scrolling the frame sends at most one per frame, with the moved rect;
  - a removed target posts once, then goes quiet.

  Until then, F5 with the picking fixture (`fixtures/picking.html`) copied into the dev workspace and Comment mode on:
  1. Pick the third card in "Five identical cards".
  2. Scroll the scroll-box list, which doesn't contain the card: the pick outline stays put and the chip doesn't flicker.
  3. Scroll the frame so the card moves: the outline follows smoothly.
  4. Press ↑, then ↓, with nothing moving: the chip updates each time. Click the same card again: the chip still updates.
  5. Pick, scroll, press ↑ then ↓, scroll again: the pick still follows.
- **Mark F-46:** when this step lands, `/implement` marks F-46 `fixed`, and `/audit` closes it.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":7282,"specSha256":"e189f48a5f16cd57f7e6aff2acb6225df220bddb10d8602fad069f5501c9832b","branch":"refs/heads/fix/fewer-pick-re-posts-on-scroll","head":"c7be646d3dc6e03c425f89b770d04b5f6071781c","baseRef":"refs/heads/main","baseCommit":"c7be646d3dc6e03c425f89b770d04b5f6071781c","sourceTree":"edd65a4b1549c14fab5877adff2712b90c97d2d6","landing":"local-merge","absentOptional":[]} -->

## Findings

### fewer-pick-re-posts-on-scroll/F-46 [P3] closed - Every scroll and resize re-post carries the full pick payload

**File:** src/webview/frame/commentPicking.ts:127
**Found:** 2026-10-24 by /audit (scope: current; lens: performance)
**Why it matters:** `postPick` spreads `described` (selector up to 1000 chars, text up to 200, up to 13 style strings of 200) into every post, and `repostRects` runs it on each `scroll` event (capture, so any nested scroller too). Chrome structured-clones it, runs `parseFramePick` on all of it (a regex per style value plus control-character scans) and replaces the `$state` pick object per event. Before 8d2 the scroll post was one rect. It is cheap in the common case (hundreds of bytes) but bounded only by the caps (about 4 KB) at scroll rate. The spec asks for this ("Every post recomputes rect and point", kept data included), so it is design, not a slip.
**Suggested fix:** None required now. If scroll jank shows up in F5, post a smaller `cd:pick-rect { rect, point }` on scroll and keep the full `cd:pick` for click and step; that changes the spec and rule 02, so the user decides.
**Resolution:** 2026-10-25 /implement (fix/fewer-pick-re-posts-on-scroll): the `cd:pick` contract is unchanged, but re-posts are now fewer. `repostRects` schedules at most one `requestAnimationFrame` re-post per frame (cancelled by `cd:mode`); `postPick({ force: false })` skips a re-post when `isUnchangedPick` (`pickTarget.ts`) finds the same element, description object, rect and point as the last post; clicks and steps still post with `force: true`; a removed target is described again only while its cached selector is non-null, so it posts once and then goes quiet. Pinned by `pickTarget.test.ts` and the handoff snapshot; listener behavior is left to the 8d3 browser suite.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `commentPicking.ts`, `pickTarget.ts` and the tests against the spec; closed. Evidence: (1) click (`commentPicking.ts:260`) and every step (`:228`, keys and `cd:pick-parent` / `cd:pick-child` through `stepPick`) pass `force: true`, so each posts immediately; only `repostFrame` (`:330`) passes `force: false`. (2) `postPick` computes `next`, compares with `lastPosted` (`:173`), posts (`:176`), then stores `lastPosted = next` (`:186`); a throwing `postMessage` leaves the old value, so a later re-post is not wrongly skipped. (3) A removed element with a selector is described once: the new description has `selector: null` and `rect: null`, the next re-post has the same object, rect and point, and is skipped. A page pick on a connected `body` never enters the guard. (4) `repostRects` schedules one rAF; `repostFrame` clears `pendingRepost` first, so a throw cannot wedge it; `setMode` cancels it, so a mode change while pending cannot re-post into the new mode (a `cd:mode` repeat also empties `path` and `hover`). A scroll or resize event fires before that frame's rAF callbacks, so no lag. (5) Hover: `repostFrame` still calls `postHover(hover.element)`, which skips unchanged rects as before. (6) `host.postMessage` call sites in `src/webview/frame`: `commentPicking.ts:176,196`, `runtime.ts:26,80,123` (five), and `runtime.test.ts:29` passes. (7) The chrome counts each post in `sequence` (`commentPick.ts`), so fewer re-posts also stop the Toolbar live region re-announcing on scroll. (8) Snapshot: 52 changed lines in 4 identical runtime hunks, all inside the embedded runtime; `sameRect` / `isUnchangedPick` are IIFE-private `var`s; no change to `stageGeometry`, `clampNumber` or any other global. (9) Mutation check in a scratch copy (repo untouched): dropping the element, description, rect or point.y comparison from `isUnchangedPick` fails `pickTarget.test.ts`; removing the `!force &&` skip or making the click non-forced fails the handoff snapshot (a text mirror, as the spec accepts). Two corners are filed separately: F-59 (`sameRect` fields), F-60 (removed-target guard). Browser behavior is still unproven here (F5 steps in the spec; 8d3).

## Quality gates

- Audit: `/audit current` (2026-10-25, Sonnet 5.5 high) closed F-46 and raised F-59 and F-60 (both P3, fixed in step 2; they stay `fixed` in the live ledger for the next audit).
- Independent review: not selected. `when-sensitive` doesn't apply: the fix changes how often the frame runtime re-posts an unchanged `cd:pick`; the message contract, its guards and every trust boundary are untouched.
- Verify: `pnpm verify` exit 0 (307 tests); `pnpm knip` clean.

## Try it now

1. `cp fixtures/picking.html fixtures/dev-workspace/.cursor-design/artboards/picking.html`, run `pnpm compile`, then F5 and open the artboard.
2. Click **Comment**, then the third card in "Five identical cards".
3. Scroll the scroll-box list (it doesn't contain the card): the outline stays put and the chip doesn't flicker.
4. Scroll the frame so the card moves: the outline follows smoothly.
5. Press ↑ then ↓, then click the same card again: the chip updates every time.
