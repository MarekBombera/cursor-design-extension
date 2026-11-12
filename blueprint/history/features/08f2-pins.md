# Feature: Pins

**From build-plan:** feature 8f2
**Build attempt:** 1
**Branch:** feature/pins
**Status:** verified

## Goal

Every comment in `comments.json` shows a pin on the canvas. The pin is anchored to its element in
the live frame and follows it through scroll, resize, DOM changes, transitions, frame drag, zoom
and pan. A pin looks different when it is open, sent or resolved. It carries one badge when its
target is stale, missing or unchecked. Page comments pin to a fraction of their frame. Clicking a
pin opens a read-only thread popover.

Notion done-when lines advanced (0.3 brief): "Adding a comment … shows a pin that survives
reload, zoom and pan"; "pin states, pins following elements, page comments"; "Stale and
target-missing cases are reported, never guessed"; "Pins render in the chrome layer, so the HTML
on disk stays untouched".

## In scope

1. **Flags on the wire.** `comments:updated` comments gain `stale: boolean | null` and
   `targetMissing: boolean | null`, computed by the host through the disk lib's existing
   `commentFlags` (the same rules as `get_comment`). Cost decisions:
   - parsed artboard documents are cached per workspace root and frame id, keyed by the exact
     HTML text;
   - each flag read has a 200 ms target-check budget, shared by every caller (panel and MCP).
     Comments not checked within the budget report unchecked (`null`) with a hint that says so.
2. **Anchor channel (D4).** Chrome → frame `cd:anchors {anchors: [{id, selector}]}` and frame →
   chrome `cd:anchor-rects {anchors: [{id, box, visible}]}`. The runtime resolves selectors and
   re-measures on its triggers. It posts at most once per animation frame, and only when something
   moved more than 0.5px.
3. **Pins in chrome.** A screen-space pin layer with constant-size pins, 3 status looks, 1 badge
   (missing, stale or unchecked), page pins, and hiding when the target is clipped out.
4. **Thread popover (read-only).** A pin click opens a popover with the target chip, status,
   badge text, body and replies, plus a Close button. 8g adds Reply and Resolve/Reopen to it, and
   8h adds Copy.
5. Rule 02 message line, rule 05 owner catalog, the 0.3 plan's message contract and the
   build-plan 8f2 line, in the same change.

## Out of scope

- Reply, Resolve, Reopen, `comment:reply`, `comment:set-status` (8g). Copy, `comment:copy*`,
  `ui:copied`, marking sent (8h). The thread popover has no action buttons besides Close.
- Comments panel and click to jump (8g).
- Pins for comments whose frame is not on the stage, or whose frame is an error tile: no pin. 8g's
  panel lists them.
- Following an element *during* a CSS animation or transition. Pins update on `transitionend` /
  `animationend` and on any other trigger (`ponytail:` below).
- `load` (images) and `document.fonts` triggers from the 0.3 plan. `FRAME_CSP`
  (`default-src 'none'`) blocks every image and web font in a frame since 8e, so those events
  never shift layout. A blocked `<img>` takes its final size at once. Recorded as a plan
  deviation in Notes.
- An HTML byte cap, or moving the parse to a worker (see the step 1 `ponytail:`).
- Any MCP tool, error code, runtime limit or frame CSP change. `skills/cursor-design/SKILL.md`
  is unchanged: it already says "`null` flags mean the target cannot be checked from disk;
  `hint` says why", which covers the budget hint.
- Numbered pins, avatars, drag-to-draw comments, hiding pins.

## Build loop

`workflow.stepReview: feature`: build every step, then one review at the end. Checkpoint commits
are disabled; `/complete` makes the commit. After each step: `pnpm exec vp test` on the touched
tests. After steps 3 and 4: `pnpm test:browser`. Every `.svelte` edit follows rule 08 (Svelte MCP
docs before writing, `svelte-autofixer` until clean; prefer the `svelte-file-editor` agent).
Before handoff: `pnpm verify` and `pnpm test:browser`, both green. Work on `feature/pins`
(create it from `main` first; the spec edits are uncommitted on `main`).

## Build steps

- [x] **1. Flags on `comments:updated`.**
  - `src/disk/comments.ts`:
    - `readComments` returns `CommentView[]` for every status through the existing
      `withCommentViews`.
    - `loadArtboardDocument` keeps one cached parse per `${workspaceRoot}\0${frameId}`, reused
      only when the HTML text is byte-identical. A `'missing'` or `'unreadable'` result deletes
      that key. Because `matchCommentTarget` caches matches per document (`WeakMap`), an
      unchanged HTML also reuses every selector match.
    - `loadFramePresence` catches `DiskError` the same way `loadArtboardDocument` does: log once
      with `logTargetReadError`, return `'unreadable'`. One unreadable artboard path must never
      reject the whole read.
    - `withCommentViews` takes a 200 ms budget for the read (`CHECK_BUDGET_MS`, module constant),
      measured with `performance.now()` from after `documentsFor` (parse time never spends it). Comments are flagged in file
      order. Once the budget is spent, each remaining fingerprinted element comment whose frame
      parsed gets `{stale: null, targetMissing: null, hint: HINT_CHECK_BUDGET}` without calling
      `commentFlags`. Page comments and presence-only comments are still flagged (they cost no
      css-select). Add `HINT_CHECK_BUDGET = 'Too many comments to check at once; read again to
      check this one.'` in `commentTarget.ts` next to the other hints.
    - Replace the `documentsFor` `ponytail:` with the real ceiling: parse5 parses the whole file
      before `commentTarget`'s 64-deep / 20,000-element caps apply, so parse time grows with
      HTML size (no byte cap exists). It runs on the extension host thread once per HTML change
      per frame. css-select is bounded by the read budget. Upgrade path: a worker thread for the
      host read.
  - `src/host/chromeMessages.ts` `toPostedComment`: its parameter type becomes `CommentView`. It
    adds `stale` and `targetMissing`, and never `hint`, `artboard`, `version`, `styles` or
    `targetFingerprint`.
  - `src/webview/hostMessages.ts`: `PostedComment` gains both fields. `parsePostedComment`
    requires each one to be `true`, `false` or `null`, and drops the comment otherwise.
  - Done when unit tests pass for:
    - `readComments` returns resolved comments with flags;
    - an edit inside a fingerprinted target between two reads flips `stale` to `true` (the cache
      is keyed by HTML, not reused across an edit);
    - a deleted frame file gives `targetMissing: true`, and a later re-created file is parsed
      fresh;
    - an `lstat` failure other than `ENOENT` on a page comment's frame yields unchecked flags for
      that comment, and the rest of the read still resolves;
    - with `performance.now` mocked to jump past the budget after the first check, the second
      fingerprinted comment gets `null` flags with `HINT_CHECK_BUDGET`, and a page comment in the
      same read still gets real flags;
    - `toPostedComment` emits exactly the listed fields;
    - `parseHostMessage` drops a comment with `stale: "yes"` or a missing `targetMissing`, and
      keeps `null`.

- [x] **2. Anchor channel in the frame runtime.**
  - `src/disk/layout.ts`: move `COMMENT_ID_PATTERN` here from `comments.ts` (single source; the
    frame bundle cannot import `comments.ts`). `comments.ts` imports it.
  - `src/webview/frame/frameMessages.ts`:
    - add `FRAME_ANCHORS_MESSAGE = 'cd:anchors'` (chrome → frame) and
      `FRAME_ANCHOR_RECTS_MESSAGE = 'cd:anchor-rects'` (frame → chrome);
    - export the types `AnchorRequest = {id: string; selector: string}` and
      `AnchorRect = {id: string; box: FrameRect | null; visible: FrameRect | null}`, plus the
      message types, and add guards in `parseChromeFrameMessage` / `parseFrameMessage` (contract
      in Data / contracts).
  - `src/webview/frame/commentPicking.ts`:
    - lift `visibleRect` (and the `isRoot` it uses) out of the `installCommentPicking` closure
      into module-level exports;
    - the `message` listener handles `cd:mode`, `cd:pick-parent` and `cd:pick-child` by explicit
      type checks and ignores every other type. Today it treats every non-`cd:mode` message as a
      step, so a `cd:anchors` would step an open pick to its child and retarget the draft.
  - New `src/webview/frame/anchorRects.ts` (pure):
    - `anchorsMoved({ last, next }: { last: readonly AnchorRect[] | undefined; next: readonly
      AnchorRect[] }): boolean` with the 0.5px rule;
    - `capAnchorRect(rect: FrameRect): FrameRect` clamps to the `parseFrameRect` bounds so a
      measured rect never fails its own guard. It is applied to both `box` and `visible`.
  - New `src/webview/frame/pinAnchors.ts`: `installPinAnchors(host: Window): void`, called by
    `runtime.ts` after `installCommentPicking(host)` and before `cd:ready`. It adds its own
    `message` listener with the same `event.source !== host` check and `parseChromeFrameMessage`,
    and acts only on `cd:anchors`. Behavior in Data / contracts.
  - `src/webview/frame/runtime.test.ts` is updated, not just re-run:
    - the `host.postMessage` count becomes 7;
    - `installPinAnchors(host);` sits between `installCommentPicking(host);` and the `cd:ready`
      post;
    - `cd:anchor-rects` is in the posted-type checks;
    - the forbidden design-DOM mutator check also covers `pinAnchors.ts`.
  - Done when unit tests pass for:
    - the guards: a bad id, a `__proto__` id is accepted only as data, over `MAX_COMMENTS`
      entries, an over-cap selector, a non-array, `box: null` with `visible` non-null rejected,
      extra fields dropped;
    - `anchorsMoved`: exactly 0.5px is not a move, 0.51px is, a null↔rect flip, a `visible`-only
      change, a changed id set, empty to empty;
    - `capAnchorRect` on a 150000px box;
    - a `cd:anchors` delivered while a Comment-mode pick exists posts no `cd:pick` (the pick and
      its draft stay put);
    - the updated `runtime.test.ts`.

- [x] **3. Pins in chrome.**
  - New `src/webview/pins.ts` (pure). Signatures:
    - `type AnchorState = ReadonlyMap<string, ReadonlyMap<string, {box: FrameRect | null;
      visible: FrameRect | null}>>`, keyed by frame id, then comment id. Never a plain object,
      because ids come from an untrusted frame.
    - `applyAnchorRects({ state, frameId, anchors }): AnchorState` replaces that frame's inner
      map. A duplicate id in `anchors` keeps the last one.
    - `dropFrameAnchors({ state, frameId }): AnchorState`.
    - `anchorSends({ comments, frameIds }): {frameId: string; anchors: AnchorRequest[]}[]` builds
      one `cd:anchors` per live frame, with `[]` for a frame that has no element comments.
    - `pinBadge({ comment, live }): 'missing' | 'stale' | 'unchecked' | undefined`.
    - `pinPoint({ comment, live, frame }): {x: number; y: number}` (frame-local).
    - `layoutPins({ comments, anchors, frames, view }): PlacedPin[]` with
      `PlacedPin = {id, x, y, status, badge, label}` (x, y in screen px). `frames` are the drawn
      frames (`displayFrames`), `view` is `committedView`. A comment is placed only when its
      frame is a live iframe frame in `frames`.
    - `pinLabel({ comment, badge }): string`.
    - `keepOpenThread({ openThreadId, pins }): string | undefined` returns the id while that pin
      is placed, else `undefined`.
  - `src/webview/canvasFrames.ts` or `pins.ts`: no new frame-list helper. Reuse `liveIframeIds`
    and the `displayFrames` App already derives.
  - `src/webview/App.svelte` (container; every decision stays in `pins.ts`):
    - holds `anchors: AnchorState` `$state`;
    - on each `comments:updated`, sends `anchorSends` to every live iframe frame through
      `postToFrame`;
    - on a frame's `cd:ready`, sends that frame's `cd:anchors` right after `cd:mode` and drops
      its live anchors;
    - applies `cd:anchor-rects` from a registered frame in any mode, keyed by the sending frame's
      id;
    - drops a frame's anchors when it leaves the stage or becomes a tile (inside the existing
      `keepLiveCommentState`);
    - derives `pins` from `layoutPins`.
  - New `src/webview/Pins.svelte` (view):
    - a wrapper `<div data-cd-pins>` holds one native `<button data-cd-pin={id}>` per placed pin,
      rendered with a keyed `{#each pins as pin (pin.id)}`. The wrapper is required: Stage's
      `startDrag` treats a direct child of the viewport as empty stage, so a bare pin button
      would start a pan;
    - wrapper CSS: `position: absolute; inset: 0; overflow: clip; pointer-events: none`. Pins
      get `pointer-events: auto`. Use `clip`, not `hidden`: a `hidden` wrapper is a scroll
      container, so focusing an off-screen pin would scroll it under the stage math;
    - the wrapper is `inert` while a comment draft is open, so a click there picks the element
      under the pin and retargets the draft, keeping its text;
    - rendered in Stage's `children` before the popovers.
  - Browser fixture (`fixtures/pins.html` or inline in the spec):
    - a scroll box with a target inside;
    - a `position: absolute` target a script moves by changing its `style.left` (no size change
      on the target or the root, so only the MutationObserver sees it);
    - a target with a `transform`-only transition (invisible to ResizeObserver, so only
      `transitionend` sees it);
    - a target a script can remove.
  - Done when:
    - `pins.test.ts` covers the rules below, including a forged `cd:anchor-rects` from frame A
      carrying a comment id of frame B, which moves nothing in B;
    - new `tests/browser/pins.spec.ts` passes. "On its element" means the pin center is within
      1px of the element's own screen box from the frame locator (`boundingBox`) × the stored
      fraction. It never compares against `pinPoint`. The cases:
      - the pin sits on its element;
      - it follows a scroll inside a box, and hides when that box scrolls the target out;
      - it follows zoom, pan, a frame drag preview and a frame width resize;
      - it moves after the script changes the absolute target's `style.left`;
      - it moves after the transform-only transition ends;
      - it shows `missing` after a script removes the target;
      - a page pin sits at its fraction of the frame;
      - `stale`, `unchecked` and resolved looks come from `comments:updated` flags;
      - after a frame reload, the frame answers with a forced `cd:anchor-rects` and the pin
        returns;
      - a static page goes quiet: after the forced answer settles, no further `cd:anchor-rects`
        arrives over several animation frames;
      - a pointer drag starting on a pin does not pan;
      - with a draft open, a click at a pin's position retargets the draft.

- [x] **4. Read-only thread popover.**
  - New `src/webview/CommentThread.svelte` (view):
    - placed with `placePopover` at the pin's screen point, measured like `CommentPopover`;
    - `role="dialog"`, `aria-label="Comment"`;
    - contents: chip text from `targetChipText` (widen its parameter to
      `Pick<DraftTarget, 'isPage' | 'text' | 'tagName'>`), status text, badge text, body,
      replies, and a native Close button;
    - all text is rendered as text, never `{@html}`;
    - Escape (handled with `preventDefault`) and Close close it and return focus to the pin with
      `focus({ preventScroll: true })`;
    - focus moves to Close on open.
  - App: `openThreadId` `$state`.
    - A pin click opens that pin's thread, swaps to another pin's, or closes when it is the same
      pin.
    - Implicit close: the `comments:updated`, `cd:anchor-rects` and `keepLiveCommentState`
      handlers set `openThreadId = keepOpenThread(...)` after updating their state. So the
      thread closes when its comment leaves the list, or its pin is no longer placed (frame gone,
      tile, clipped out). It does not come back when the pin returns. No `$effect`.
    - Opening a draft closes it.
    - On an implicit close or a draft open while focus is inside the thread, focus moves to the
      stage viewport (`focus({ preventScroll: true })`), never to `body`.
    - No other close triggers: no outside click. Toggling the mode does not close it. Escape
      with focus outside the thread still goes to the mode-key rule.
  - Done when browser tests pass:
    - click opens with the comment body and the reply authors as text;
    - Escape closes and focuses the pin;
    - a `comments:updated` without that comment closes it, and focus lands on the stage viewport;
    - a pick in Comment mode closes it and opens the draft;
    - a body containing `<img src=x onerror=…>` shows as literal text.

- [x] **5. Docs and gates.**
  - Rule 02 message line: `cd:anchors`, `cd:anchor-rects`, and the `comments:updated` flags.
  - Rule 05 catalog: the `readComments` flags and budget, `visibleRect`, `installPinAnchors`,
    the `anchorRects.ts` and `pins.ts` rules, and the `Pins.svelte` / `CommentThread.svelte`
    views. Drop "without flags" from the `readComments` entry.
  - `blueprint/reference/0.3-comments-plan.md`: 8f2 contract notes (the deviations in Notes).
  - `blueprint/build-plan.md` 8f2 line: "(resize, scroll, load, font, animation)" becomes
    "(resize, scroll, DOM changes, transition/animation end)".
  - Done when: `pnpm verify` and `pnpm test:browser` are green, `pnpm knip` reports no new
    findings, and the `canvas.html` export snapshot change is limited to the runtime source.

## Files / areas

- Disk: `src/disk/comments.ts` (+ test), `src/disk/commentTarget.ts` (one hint constant),
  `src/disk/layout.ts`.
- Host: `src/host/chromeMessages.ts` (+ test). `src/host/panelComments.ts` is unchanged (it
  already posts what `readComments` returns).
- Frame runtime: `src/webview/frame/frameMessages.ts` (+ test), `commentPicking.ts` (+ a test
  for the ignored `cd:anchors`), new `anchorRects.ts` (+ test), new `pinAnchors.ts`,
  `runtime.ts`, `runtime.test.ts`.
- Chrome: `src/webview/hostMessages.ts` (+ test), new `pins.ts` (+ test), `commentPopover.ts`
  (`targetChipText` parameter only), `App.svelte`, new `Pins.svelte`, new `CommentThread.svelte`.
- Browser: new `tests/browser/pins.spec.ts` and its fixture. `tests/browser/harness.ts` is
  reused, and extended only if a helper is missing. It already captures frame → chrome messages,
  which is how the reload and quiet-page cases assert.
- Export snapshot `src/disk/__snapshots__/*` (runtime source only).
- Added during `/check` from the F5 run: the `Pins.svelte` badge look (below), and
  `src/webview/stampArtboardHtml.ts` (+ test) with `tests/browser/frameCsp.spec.ts` and the
  harness's opt-in `chromeCsp`, so artboard `<style>` blocks stop logging chrome CSP violations
  (F-90).
- Docs: `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`,
  `blueprint/reference/0.3-comments-plan.md`, `blueprint/build-plan.md`.

## Data / contracts

**`comments:updated` (host → chrome).** Each comment is
`{id, frameId, selector, tagName, text, rect | null, pin: {x, y}, body, isPage, status,
createdAt, replies[], stale: boolean | null, targetMissing: boolean | null}`. The flags come
from `commentFlags`, so they match `get_comment`:

- `null` means unchecked (script-affected, an uncheckable selector or page, an unreadable file,
  or past the read budget);
- page comments are never stale, and are `targetMissing: true` only when the frame file is gone.

Held and replayed exactly as today.

**`cd:anchors` (chrome → frame).** `{type: 'cd:anchors', anchors: [{id, selector}]}`.
`installPinAnchors` accepts it only from its captured parent (its own `event.source !== host`
check), through `parseChromeFrameMessage`:

- `anchors` is an array of at most `MAX_COMMENTS` entries;
- `id` matches `COMMENT_ID_PATTERN`;
- `selector` uses the existing non-null selector guard (≤ `MAX_SELECTOR_CHARS`, no control
  characters);
- any bad entry rejects the whole message.

Chrome sends only element comments (`isPage: false`) of that frame, every status. Each one
replaces the frame's previous list. `installCommentPicking` ignores it.

**`cd:anchor-rects` (frame → chrome, untrusted).**
`{type: 'cd:anchor-rects', anchors: [{id, box: FrameRect | null, visible: FrameRect | null}]}`.

- `box` is the target's unclipped border box in frame-local CSS px.
- `null` means the selector matched 0 or 2+ elements, threw, or hit a disconnected node.
- `visible` is `visibleRect(target)`: clipped by scrolling ancestors and the frame viewport.
  `null` means fully clipped, zero-area (`clipRect` returns `null` for an empty intersection),
  or `box` is `null`.
- Guard: at most `MAX_COMMENTS` entries, ids pass `COMMENT_ID_PATTERN`, both rects use
  `parseFrameRect`, and `box: null` requires `visible: null`. Any bad entry drops the message.
- Chrome stores it under the sending frame's id only (`AnchorState`). `layoutPins` reads
  `anchors.get(comment.frameId)?.get(comment.id)` only for element comments in the current
  `comments` list, so ids the chrome did not send are never read. A design script can forge
  this message; it only moves or hides its own frame's pins (geometry, rule 02 point 6).

**Runtime (`installPinAnchors`).**

- With no anchors, it installs no observers.
- With a non-empty list, it installs:
  - one `ResizeObserver`, observing `documentElement` and each resolved target. After each
    measurement it diffs a `Set` of observed elements: `observe` only newly resolved
    elements, `unobserve` ones no longer resolved, and never re-observe an element already
    observed (`observe()` fires an initial notification, so re-observing would loop forever);
  - `MutationObserver` on `documentElement` (`childList`, `subtree`, `attributes`,
    `characterData`);
  - capture `scroll`, `transitionend` and `animationend` on `window`;
  - `resize`.
- An empty list disconnects all of it, clears the observed set, and cancels a pending
  `requestAnimationFrame`.
- Each trigger schedules one `requestAnimationFrame` measurement, at most one pending.
- A measurement resolves each selector with `document.querySelectorAll` in a `try`, and needs
  exactly one match. It measures, caps `box` and `visible` with `capAnchorRect`, then posts the
  full list only when `anchorsMoved` says so.
- A `cd:anchors` forces one post after its first measurement, even when nothing changed (also
  for `[]`).
- The runtime never writes to the design DOM.
- `ponytail:` it re-resolves every selector on every measurement (≤ 500 `querySelectorAll` per
  frame); the upgrade is to re-resolve only after a mutation.

**`anchorsMoved({ last, next })`.** True when any of these hold:

- the ordered id lists differ;
- for any id, `box` or `visible` changes between null and non-null;
- any of `x`, `y`, `width`, `height` of `box` or `visible` differs by more than 0.5.

`last` undefined is always true.

**Pin rules (`pins.ts`).**

- Placed only for a comment whose `frameId` is a live iframe frame in the drawn frames.
- Frame-local point:
  - page comment: `(pin.x × frame.width, pin.y × frame.height)` of the drawn frame record;
  - element comment with a live answer whose `box` is non-null:
    `box.x + pin.x × box.width`, `box.y + pin.y × box.height`;
  - otherwise (no answer yet, or `box: null`): the stored `rect` the same way. Pins are
    multiplied fractions, so a zero-size box or rect gives its origin and never NaN.
- Hidden (not placed) when:
  - the live answer has `box` non-null and either `visible` is `null` or the point lies outside
    `visible` by more than 0.5px (a target whose box collapses to zero area is hidden by design);
  - or the frame-local point lies outside `[0, frame.width] × [0, frame.height]` by more than
    0.5px (a genuine answer never does, since `visible` is clipped to the frame viewport; this
    stops forged rects drawing a pin over a neighbor frame).
- Screen point: `stageToScreen` with `frame.x + point.x`, `frame.y + point.y`, from the drawn
  frame (drag preview included) and `committedView`.
- `pinBadge`:
  - none for `resolved` (a fixed comment is stale by definition);
  - otherwise `missing` when the live answer has `box: null` or `targetMissing === true`;
  - else `stale` when `stale === true`;
  - else `unchecked` when `stale === null && targetMissing === null`;
  - else none.
- `pinLabel`: `<Open | Sent | Resolved> comment[, target missing | , stale | , unchecked]:
  <excerpt>`. The excerpt is the body with whitespace collapsed and trimmed, cut to 60
  characters with `…` appended only when cut. Example: `Open comment, stale: Make this bolder`.
- Known ceilings (`ponytail:` in `pins.ts`):
  - the stored-`rect` fallback applies a fraction of the unclipped pick-time box to the clipped
    `rect`, so a target partly clipped at pick time draws its fallback and missing pin slightly
    off (no stored box exists; upgrade: store `box` on the comment);
  - a page pin uses the frame record's size, while 8f1 stored the fraction of the
    `documentElement` box; when the reported frame height differs (body taller than html,
    `MAX_FRAME_HEIGHT`, growth guard) the page pin drifts (upgrade: anchor page comments to
    `documentElement` through the channel).

**Pin view.**

- Marker: 20 screen px, centered on the point, constant at any zoom.
- Look by status, not color alone:
  - open: filled `--vscode-button-background`;
  - sent: hollow ring in the same token;
  - resolved: `--vscode-disabledForeground` at reduced opacity, with a ✓ glyph, and a lower
    `z-index` than open and sent pins, so they stack above it.
- Badge: a 14px filled disc on the pin's corner, with a 1px ring and a 10px glyph, both in
  `--vscode-editor-background` (a bare glyph was too faint on artboard content). The fill:
  - `!` for stale, `--vscode-editorWarning-foreground`;
  - `×` for missing, `--vscode-editorError-foreground`;
  - `?` for unchecked, `--vscode-descriptionForeground`.
- Glyphs (✓ ! × ?) are `aria-hidden="true"`; `aria-label` from `pinLabel` carries the state.
  Focus ring `--vscode-focusBorder`. DOM order follows `comments.json`.

**Thread popover copy.**

- Status: `Open` / `Sent to Agent` / `Resolved`.
- Badges:
  - `Target missing: the element is gone or no longer unique.`
  - `Stale: the element changed since this comment.`
  - `Unchecked: this target can't be checked from disk (made by script, too complex, or the file
    can't be read).`
- Reply authors: `You` / `Agent`.

## Testing

- Unit (`vp test`): the step 1–3 cases above. Edge cases over volume (rule 09). The cases that
  must fail when their guard is deleted:
  - cache keyed by HTML;
  - presence `DiskError` caught;
  - budget yields `null` with the budget hint;
  - flag tri-state parse;
  - anchors `box: null` + `visible` rect;
  - `cd:anchors` does not step the pick;
  - 0.5px boundary;
  - zero-size box gives no NaN;
  - resolved shows no badge;
  - live `box: null` beats disk `stale: true`;
  - hidden when outside `visible`, and when outside the frame;
  - cross-frame forged id moves nothing.
- Browser (`pnpm test:browser`, local, not Verify): `tests/browser/pins.spec.ts` as listed in
  steps 3–4, through roles, element boxes from frame locators, `data-cd-pin` boxes and captured
  `cd:*` messages, never pixels. The mutation and transition cases use the fixture targets that
  only their own trigger can see, and the quiet-page case guards the ResizeObserver diff.
- F5 (Cursor-only, recorded in `/check`):
  - pins survive panel hide/show (webview reload) and a fresh `comments.json` write from the MCP
    `resolve_comment`;
  - an Agent `update_artboard` that changes a target flips its badge to stale;
  - no CSP violation in the webview console.
- Not claimed: real image or web-font load shifts (blocked by `FRAME_CSP`), and VoiceOver.

## Notes for the AI

- Plan deviations, all recorded in step 5:
  - the `cd:anchor-rects` payload is an array with `box` + `visible`, not an id-keyed `rect`
    map (untrusted keys, plus 8g needs the box);
  - the `load` / fonts triggers are dropped (`FRAME_CSP`);
  - pins live in a new `Pins.svelte`, not in `Overlay.svelte`: pins take clicks and focus, and
    the Overlay is `pointer-events: none`;
  - the thread popover is read-only until 8g/8h own its actions;
  - resolved pins show no badge;
  - flag reads have a 200 ms target-check budget (the upgrade `comments.ts` already named).
- `visibleRect` already treats `html` / `body` as non-clip boxes; reuse it, do not re-derive it.
- `toNewComment` already stores `pin` as a fraction of the unclipped `box`; pins are not
  re-stored.
- `logTargetReadError` writes to `process.stderr`, which in the extension host lands in the
  extension host log, not the Output channel. That is acceptable for an unreadable artboard
  (rare). Do not add a second logger.
- `App.svelte` is already ~585 lines (rule 08 aims for ~300). Add wiring only; every rule
  (layout, badge, label, thread keep/close) lives in `pins.ts` with tests.
- `canvas.html` export embeds `runtime.ts?iife`, so `installPinAnchors` ships there dormant. The
  preview controller never sends `cd:anchors`, and no observer installs without anchors. Update
  the snapshot on purpose.
- Never render frame or comment data with `{@html}`. Pins and the thread are text and geometry
  only.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":29284,"specSha256":"e2429203a93e3d2194c4ab5727c0021652225580900223a734b4eb0d00b56f49","branch":"refs/heads/feature/pins","head":"7e7b609469c175891df07961ae8fee6d61e7172d","baseRef":"refs/heads/main","baseCommit":"293ff9cf3f37343076ef4345424ac00a262f15ba","sourceTree":"a7baf81b00909c01274dd2c4babcf7711e25f583","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8f2/F-60 [P3] closed - The "describe a removed target once" guard keys on selector !== null, which two cases defeat

**File:** src/webview/frame/commentPicking.ts:155
**Found:** 2026-10-25 by /audit (scope: current; lens: performance, quality)
**Why it matters:** The guard assumes that after the re-describe the cached selector is `null`. (1) A page pick: `describeElement(element, true)` returns `selector: 'body'` before it checks `isConnected` (`selector.ts:116-125`). If the design replaces `document.body`, the picked old `body` is disconnected, the guard fires on every re-post, and each call builds a new object, so `isUnchangedPick` never matches and the full pick posts once per frame of scroll or resize with `rect: null`, the F-46 symptom the spec says a page pick cannot reach. (2) An element that never had a selector (finder threw, or the selector passed 1000 chars) skips the re-describe after removal, so chrome gets its old `text` and `styles` beside `selector: null` and `rect: null`, the stale pairing F-56 meant to remove. Both need an uncommon design (a script swapping the body, or a very deep or odd node removed after a pick), and the cost is one small post per frame, so it is P3.
**Suggested fix:** Key the guard on a flag, not the selector: keep `const removed = new WeakSet<Element>()` next to `descriptions`, reset it wherever `descriptions = new Map()` is, and re-describe only when `!current.isConnected && !removed.has(current)`, adding `current` after the `descriptions.set`. No requirement is lost. Alternatively accept it for now: page-body replacement is not something the picking fixture exercises.
**Resolution:** 2026-10-25 /implement (audit repair): the removed-target guard uses a per-pick `removed` `WeakSet` (reset with `descriptions` on click and `cd:mode`) instead of `selector !== null`: any disconnected path element, a replaced `body` page pick or a target finder never resolved included, is described again exactly once, so later re-posts carry the same description object and compare equal, and stale text/styles never pair with `selector: null`.
2026-10-27 /audit (scope: current; lens: quality, security, performance, tests): re-read `postPick` in `commentPicking.ts` (the 8f2 diff touched this file). The `removed` WeakSet guard is present, reset beside `descriptions` on click and `cd:mode`, and a disconnected target (page pick included) is described once and then posts one stable object. The 8f2 changes (hoisting `visibleRect`, explicit message types in the listener) do not touch this path. Closed.

### 8f2/F-85 [P3] closed - A budget-skipped comment stays "unchecked" with nothing to retry, and the budget clock includes the parse

**File:** src/disk/comments.ts:553 (hint at src/disk/commentTarget.ts:53, skill text at skills/cursor-design/SKILL.md)
**Found:** 2026-10-27 by /audit (scope: current; lens: performance, quality)
**Why it matters:** `withCommentViews` starts `started` before `documentsFor`, so one slow parse (parse5 on a large artboard has no byte cap) can spend the whole 200 ms and every fingerprinted comment of every frame reads `stale: null, targetMissing: null, hint: HINT_CHECK_BUDGET` on that read. The parse is cached afterwards, so a second read would resolve them in microseconds, but `postPanelComments` runs only on a watcher event, so the panel shows `?` pins until something else changes. The Agent sees the same on `list_comments` / `get_comment`, and the shipped skill says `null` flags mean "the target cannot be checked from disk", which is wrong for this case (a repeat call would work). The spec chose this budget and "unchecked with a hint that says so", so this is a copy and a retry gap, not a contract break.
**Suggested fix:** Word the hint so it tells the reader to read again ("Too many comments to check at once; read again to check this one."), and add that case to the one skill sentence about `null` flags (the `agentSkill.test.ts` guard covers names and codes only). Optional: start the clock after `documentsFor` so parse time does not eat the css-select budget. A panel-side retry is not worth adding.
**Resolution:** 2026-10-27 /implement (audit repair): `HINT_CHECK_BUDGET` now reads "Too many comments to check at once; read again to check this one." (`commentTarget.ts`), the shipped skill's `null`-flags step tells the Agent to call `get_comment` again on that hint (`skills/cursor-design/SKILL.md`), and `withCommentViews` starts the budget clock after `documentsFor`, so parse time no longer spends it; the spec's budget text and hint quote are updated to match. `comments.test.ts` budget test and `agentSkill.test.ts` pass unchanged.
2026-11-09 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `withCommentViews`, `HINT_CHECK_BUDGET` and the skill step: the clock starts after `documentsFor`, the hint says to read again, and the skill tells the Agent to call `get_comment` once more. No new defect. Closed.

### 8f2/F-86 [P3] closed - The parsed-document cache is never evicted

**File:** src/disk/comments.ts:462
**Found:** 2026-10-27 by /audit (scope: current; lens: performance)
**Why it matters:** `parsedDocuments` is a module-level Map holding the HTML string and the full parse5 tree for every frame a fingerprinted comment ever pointed at, in both the long-lived extension host and the MCP process. An entry is deleted only when a later read finds that frame file missing or unreadable. Deleting the frame's last comment, resolving it (resolved comments are still flagged, so those stay), or a workspace switch leaves the tree held for the process lifetime. Bounded by frames x HTML size (a parse tree is several times its source), so it grows with the artboards a session touched, not unboundedly, and it is only a risk for large multi-frame workspaces.
**Suggested fix:** Drop keys that `documentsFor` did not ask for in this call (`for (const key of parsedDocuments.keys()) if (!wanted.has(key)) parsedDocuments.delete(key)`), or cap the Map at a few entries (delete the oldest on insert, a Map keeps insertion order). One loop, no new module.
**Resolution:** 2026-10-27 /implement (audit repair): `parsedDocuments` is capped at `MAX_PARSED_DOCUMENTS` (32), evicting the oldest insert (`ponytail:` FIFO ceiling, LRU upgrade path). Pruning to the keys of one call was rejected: `get_comment` reads one comment and would evict every other frame. New test `the parse cache keeps at most MAX_PARSED_DOCUMENTS frames` fails with the eviction loop disabled (mutation-checked, file restored).
2026-11-09 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `loadArtboardDocument`: the Map is capped at `MAX_PARSED_DOCUMENTS` with a `ponytail:` naming the FIFO ceiling, and the test re-parses after the 33rd frame evicts the first (by reading; not mutation-run in this pass). No new defect. Closed.

### 8f2/F-87 [P3] closed - Nothing fails if the parsed-document cache is removed

**File:** src/disk/comments.test.ts:773
**Found:** 2026-10-27 by /audit (scope: current; lens: tests)
**Why it matters:** The spec lists "cache keyed by HTML" as a case that must fail when its guard is deleted. The new test (`an edit inside the target between two reads flips stale`) only proves an edit is not missed; it passes with no cache at all. The cache's whole job (an unchanged HTML is parsed once, so its css-select matches are reused) has no assertion: deleting `parsedDocuments.set` / the `cached?.html === html` reuse leaves every comment test green (by reading the assertions; not mutation-run), and the 200 ms budget would then be spent again on every panel refresh.
**Suggested fix:** In `comments.test.ts`, `vi.mock('./commentTarget', async (importOriginal) => ({ ...(await importOriginal()), parseArtboardDocument: vi.fn(actual) }))` (or a spy through the module namespace), read twice with identical HTML and assert one parse call, then edit the file and assert a second. No product change.
**Resolution:** 2026-10-27 /implement (audit repair): `comments.test.ts` mocks `./commentTarget` with the real `parseArtboardDocument` behind `vi.fn`; new test `an unchanged frame is parsed once across reads, and again after an edit` asserts one parse for two identical reads and a second after the edit. Fails with the `cached?.html === html` reuse disabled (mutation-checked, file restored).
2026-11-09 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read the test: it counts real parses through the `vi.fn` wrapper across two identical reads and one edit, so removing the reuse changes the count (by reading; not mutation-run in this pass). No new defect. Closed.

### 8f2/F-89 [P3] closed - A pin toggles a dialog but exposes no expanded state

**File:** src/webview/Pins.svelte:48
**Found:** 2026-10-27 by /audit (scope: current; lens: quality)
**Why it matters:** A pin button opens and closes the thread popover (a second click on the open pin closes it), but it has no `aria-haspopup="dialog"` or `aria-expanded`, so a screen reader hears only the comment label and never learns that activation toggles a dialog or whether it is open. Spec says state must be in the label, not color, and that is met; this is the toggle state. Not claimed by the spec's "VoiceOver not claimed".
**Suggested fix:** Pass `openId` from App to `Pins` and set `aria-haspopup="dialog"` and `aria-expanded={pin.id === openId}` on the button. Two attributes and one prop.
**Resolution:** 2026-10-27 /implement (audit repair): `Pins.svelte` takes `openId` (App passes `openThreadId`) and sets `aria-haspopup="dialog"` and `aria-expanded={pin.id === openId}` on each pin; the `Escape closes the thread` browser case asserts both attributes before, during and after the thread is open.
2026-11-09 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `Pins.svelte` and the browser case: both attributes are set from `openId`, and the case passes in this pass's `pnpm test:browser`. No new defect. Closed.

### 8f2/F-90 [P2] closed - Every artboard's `<style>` block logs a chrome CSP violation

**File:** src/webview/stampArtboardHtml.ts:27
**Found:** 2026-11-09 by /check (F5 webview console; predates 8f2, from the 8b Svelte port)
**Why it matters:** `DOMParser` connected each artboard `<style>` to a document whose CSP is the chrome's, before the nonce was stamped, so each frame load logged `Applying inline style violates ... style-src`. Only the throwaway parse was blocked, so frames still rendered correctly, but the console was a wall of red and the spec's "no CSP violation" check failed. The harness had no chrome CSP, so no browser test could see it.
**Suggested fix:** Parse into a detached `<html>` in an inert document, so no `<style>` is connected before it has the nonce.
**Resolution:** 2026-11-09 /check repair: `stampArtboardHtml` parses with `innerHTML` on a detached root from a DOMParser document, and reads the `<html>` attributes from the text before head, body or style (`ponytail:` ceiling in the code). In Chromium under the chrome policy: violations 22 to 0 across 33 inputs, stamped output byte-identical for every real artboard. `openHarness` gained an opt-in `chromeCsp`; `frameCsp.spec.ts` asserts no violation under it (failed on the old build) and that parsing loads nothing from the chrome document (failed when the root was adopted into the live document). The `chrome.js.map` console line is dev-build only, since `pnpm package` ships no source map.
2026-11-09 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read `stampArtboardHtml` as a trust boundary. The fragment parse with an `html` context still creates a head first, so FRAME_CSP and the runtime stay ahead of every artboard script; `meta[http-equiv]` removal and nonce stamping run on the same tree; the owner document has no browsing context, so scripts stay disabled and nothing loads. The prefix parse never contains a `<style` start tag. `frameCsp.spec.ts` passes in this pass's `pnpm test:browser`. The lost `<html>` attributes are the declared `ponytail:` ceiling. No new defect. Closed.

## Independent review

**Status:** passed
**Target commit:** 7e7b609469c175891df07961ae8fee6d61e7172d
**Base commit:** 293ff9cf3f37343076ef4345424ac00a262f15ba
**Base ref:** origin/main
**Spec hash:** e2429203a93e3d2194c4ab5727c0021652225580900223a734b4eb0d00b56f49
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-09T18:14:21Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-09T18:25:03Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Handoff

Review the active spec and the complete `293ff9cf3f37343076ef4345424ac00a262f15ba..7e7b609469c175891df07961ae8fee6d61e7172d` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

### Commands

- `git rev-parse HEAD`, `git merge-base origin/main 7e7b609`, `shasum -a 256 blueprint/context/current-feature.md`, `git status --short`: pass (all Phase B confirmations held before the review and again before this receipt)
- `pnpm verify`: pass (36 test files, 451 tests; check, agent rules, svelte-check, webview test types, pack and webview build)
- `pnpm test:browser`: pass (79 tests)
- `pnpm knip`: pass (no findings)

### Evidence

- Reviewed the whole delta: disk flags, parse cache and budget (`src/disk/comments.ts`, `commentTarget.ts`), wire mapping and guards (`chromeMessages.ts`, `hostMessages.ts`, `frameMessages.ts`), frame runtime (`pinAnchors.ts`, `anchorRects.ts`, `commentPicking.ts`, `runtime.ts`), chrome (`pins.ts`, `App.svelte`, `Pins.svelte`, `CommentThread.svelte`, `Stage.svelte`), `stampArtboardHtml.ts`, the shipped skill, the docs, and every new or changed test.
- Followed callers and neighbors: `watchArtboardDisk.ts` and `panelComments.ts` (an artboard edit re-posts flags through the `.cursor-design/**` watcher), `hostBridge.svelte.ts` `routeMessage`, `Frame.svelte`, `parseCommentsFile` (frame id, comment id, selector, reply uniqueness and `MAX_COMMENTS` guards match what the frame guards require).
- Trust boundaries: `cd:anchor-rects` is rebuilt field by field and stored only under the sending frame's id in Maps, a forged rect cannot draw outside its own frame, and all comment and frame data renders as text. `stampArtboardHtml` keeps FRAME_CSP and the runtime ahead of every artboard script.
- Tests: spec guards checked by reading the assertions. `cd:anchors` forcing an answer is pinned by the `picking.spec.ts` case (`[]` to `[]` posts only because of `force`). Mutation runs were not repeated in this pass.
- The `canvas.html` snapshot diff is limited to runtime source text.

### Findings

- F-88 [P3] open (reopened: the thread can still be hidden but open through `cd:frame-height`)
- F-91 [P3] open (`capAnchorRect` duplicates the shared clamp)
- F-92 [P3] open (`postToFrame`'s wildcard-origin comment is out of date)
- Closed after re-review: F-85, F-86, F-87, F-89, F-90
- No P0 or P1 finding is open or fixed

### Remaining risk

- F5 Extension Development Host: unavailable to this reviewer. Pins across panel hide/show, a real `update_artboard` flipping a badge to stale, and the webview console under the real CSP were not exercised here.
- `pnpm test` (Electron `vscode-test` suite): not run; it needs a display and is not part of Verify.
- F-88's remaining path was found by reading the code and was not reproduced in a browser.
- The `observed`-set diff in `pinAnchors.ts` and the observer teardown on an empty `cd:anchors` have no test that fails if they are removed; Chromium makes a repeated `observe()` a no-op, as the quiet-page test notes, so the spec's claim that this test guards the diff does not hold.
- Parse5 runs synchronously on the extension host with no HTML byte cap (declared `ponytail:` in `comments.ts`); no profiling was done.
- No dependency vulnerability scan was run.

## Try it now

Run or do:

Press **F5** (Extension Development Host opens `fixtures/dev-workspace`), run **Cursor Design: Open Artboard**, press `C`, click an element in a frame, type a note and press Enter. Zoom and pan the stage, click the new pin, then press Escape.

Expected:

A 20px filled pin appears on the element you clicked and stays on it through zoom and pan. Clicking it opens a small popover with the target, `Open`, your note and a Close button. Escape closes the popover and focus returns to the pin.

This proves:

A new comment gets a pin anchored to its element in the live frame, the pin follows the stage, and it opens the read-only thread.
