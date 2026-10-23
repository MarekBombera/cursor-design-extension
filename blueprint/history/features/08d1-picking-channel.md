# Feature: Picking channel

**From build-plan:** feature 8d1
**Build attempt:** 1
**Branch:** `feature/picking-channel`
**Status:** verified

## Goal

This is the first half of the Notion requirement "Element picking must feel precise". In Comment
mode, a click inside a frame never reaches the design. It picks the element under the cursor
instead, using `elementsFromPoint` and our overlay rules. Chrome draws the hover and pick outlines in
screen space. ↑/↓ (or Alt+click) step to the parent or child. The feature adds the first chrome →
frame messages (D4) and guards every new frame → chrome payload. It adds no comment storage, no
selectors and no popover. The chrome shows the current pick (a tag chip and an outline) so that
precision can be judged in F5.

Sources: `blueprint/reference/0.3-comments-plan.md` § D3, D4, Libraries, message contract, 8d1
(read in full before implementing); Notion 0.3 brief (hub link in `AGENTS.md`).

## In scope

- Chrome → frame channel (D4): `cd:mode`, `cd:pick-parent`, `cd:pick-child`. The runtime accepts
  them only when `event.source` is the `window.parent` it captured at load.
- Frame → chrome: `cd:ready`, `cd:hover`, `cd:pick`. The existing bridge matches them by source,
  and `parseFrameMessage` guards them.
- Comment-mode click blocking in the frame runtime. The listeners are capture-phase, on `window`,
  and registered before any artboard script.
- Hit testing with `document.elementsFromPoint` and a pure `pickTarget`. It applies the
  transparent-overlay rule, resolves SVG internals to the outermost `<svg>`, and turns an
  html/body-only stack into a page pick.
- Parent/child stepping in a pure `pickPath`: Alt+click, ↑/↓ (in the frame and in chrome), and the
  Parent/Child buttons.
- Hover and pick outlines, drawn by chrome in a screen-space `Overlay.svelte`
  (`pointer-events: none`). They come from frame-local rects clipped to scrolling ancestors.
- A minimal Comment toggle button in the toolbar (`aria-pressed`) plus the pick chip. Without them
  the feature cannot be judged in F5.
- Rule 02 message lines and untrusted-input note; rule 05 owner catalog.
- A tracked picking fixture at `fixtures/picking.html` for F5. 8d2 reuses it for its round-trip
  test.

## Out of scope

- Selectors (`@medv/finder`), the text excerpt, computed styles and the pick `point`, with their
  guards and sanitizers. These belong to 8d2, which extends `cd:pick` to the full
  `{selector, tagName, text, rect, point, styles, isPage}`.
- `cd:key` forwarding, the `C` shortcut, Escape semantics, the "Click to comment." hint, the
  popover, and drag/resize inertness in Comment mode. These belong to 8f1; 8c locked
  "Comment-mode inertness is 8f1's job". In 8d1, frame drag and resize keep working in Comment
  mode.
- `cd:anchors` / `cd:anchor-rects` and pins (8f2).
- `comments.json`, MCP tools and host messages (8e and later). The host and MCP are untouched.
- Hover and pick inside a nested `<iframe>` of the design (see ceilings).
- Stage zoom limits are unchanged (0.05–10). Presets stop at 200%; ctrl+wheel or pinch reaches
  10% and 400%.

## Build loop

`workflow.stepReview` is `feature`: build all steps in order, run each step's check, then present
one review at the end. `workflow.checkpointCommits` is `disabled`, so there are no per-step
commits; `/complete` makes the feature commit. Each step leaves `pnpm verify` green.

Every `.svelte` / `.svelte.ts` edit follows rule 08:
- Before writing, call Svelte MCP `list-sections` and `get-documentation`.
- After writing, run `svelte-autofixer` on the full file until it is clean.
- Prefer the `svelte-file-editor` agent.

## Build steps

- [x] **1. Wire contract and pure helpers (no runtime or UI change yet).**
  - `src/disk/layout.ts`: `MAX_TAG_NAME_CHARS = 64`.
  - `src/webview/frame/frameMessages.ts`:
    - Add `FrameRect = { x, y, width, height }`.
    - Add the frame → chrome types and extend `parseFrameMessage`.
    - Add the chrome → frame types and `parseChromeFrameMessage(data)`, which the runtime uses.
    - Shapes and guards are in Data / contracts.
    - Keep the file DOM-free, because the root tsconfig imports it.
  - `src/webview/frame/pickTarget.ts`: `pickTarget`, `clipRect`, `paintsFromStyle` and
    `isTransparentColor`. Contracts are in Data / contracts.
  - `src/webview/frame/pickPath.ts`: `stepToParent` and `stepToChild` (Data / contracts).
  - `src/webview/stageGeometry.ts`: `frameRectToScreen({ view, frame, rect })`, which returns a
    viewport-local screen rect and is built on `stageToScreen`.
  - Rules:
    - In rule 02, replace the current messages bullet (5) with the two bullets in Data /
      contracts (5 and 6). Pin bullet 5 with the literal test in `frameMessages.test.ts`.
    - In the rule 05 catalog, add `pickTarget` / `clipRect` / `paintsFromStyle`,
      `stepToParent` / `stepToChild`, `parseChromeFrameMessage` and `frameRectToScreen`. Add
      `postToFrame` next to the hostBridge entry, and `Overlay.svelte` under chrome.
  - **Done when:** `vp test` passes the new colocated tests listed under Testing (pickTarget,
    clipRect, paintsFromStyle, pickPath, guards, frameRectToScreen, rule-line literal), and
    `pnpm verify` is green.

- [x] **2. Frame runtime: channel, click blocking, hover and pick.** `src/webview/frame/runtime.ts`.
  - **State.** `mode` starts as `'interact'`. `path` (the pick path) starts empty, and so does
    the last-posted hover (element and rect). There is also a pending hover
    `requestAnimationFrame` id.
  - **Channel.**
    - `host = window.parent` is captured first (unchanged).
    - Then a `message` listener drops anything where `event.source !== host` or that
      `parseChromeFrameMessage` rejects.
    - `cd:ready` is posted once, after every listener is registered (still synchronous in the
      head script).
  - **`cd:mode`.** Every `cd:mode`, including a repeat of `comment`:
    - sets `mode`;
    - empties `path` and the last hover;
    - cancels the pending hover rAF.

    Chrome relies on this reset (step 3).
  - **Blocking.**
    - One capture-phase `window` listener function, `blockInComment`, is registered for
      `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `dblclick`, `auxclick`,
      `contextmenu` and `submit`.
    - It is also registered for `keydown`, but there it acts only on `Enter`, `' '`, `ArrowUp` and
      `ArrowDown`.
    - In Interact mode it returns immediately. In Comment mode it calls `preventDefault()` and
      `stopImmediatePropagation()`.
  - **Picking.** Picking happens inside `blockInComment` itself, never in a second listener:
    - **Click** (`button === 0`):
      1. `elementsFromPoint(clientX, clientY)`, then `pickTarget`.
      2. Set `path = [picked]`, or `[document.body]` for a page pick.
      3. If Alt is held, apply `stepToParent` once, so ↓ returns to the clicked element.
      4. Post `cd:pick`, then block.
    - **`ArrowUp` / `ArrowDown` keydown**, with no Ctrl/Meta/Alt/Shift and a non-empty `path`:
      apply `stepToParent` / `stepToChild`, then post `cd:pick`. This works with focus inside the
      frame, which is where focus is after a click.
    - **`cd:pick-parent` / `cd:pick-child` messages** run the same step and post. With an empty
      path they do nothing.
    - A step always posts a fresh `cd:pick`, even when the path did not change.
  - **Hover.** It runs only in Comment mode.
    - A capture `pointermove` listener stores `clientX`, `clientY` and `altKey`.
    - One rAF per frame then computes the target a click would pick there (Alt included, so
      hover == click target).
    - It posts `cd:hover` only when the element or rect changed.
    - `mouseout` with `relatedTarget === null` posts `{ rect: null }`.
  - **Re-posts.** A capture `scroll` listener and a `resize` listener, in Comment mode only:
    - re-post the hover rect when a hover is set;
    - re-post the current pick as `cd:pick` only when `path` is non-empty.

    After a `cd:mode` reset the frame therefore re-posts nothing.
  - **Rects** are in frame-local CSS px, from `getBoundingClientRect` (client coordinates, same as
    `cd:frame-wheel`). Each rect goes through `clipRect` against:
    - every ancestor whose computed `overflowX` or `overflowY` is not `visible` (its
      `getBoundingClientRect`);
    - then `{ x: 0, y: 0, width: innerWidth, height: innerHeight }`.

    An empty intersection gives `null`. An element that is no longer connected posts `rect: null`.
  - **Page pick.**
    - The current path entry is `document.body`.
    - The posted rect is `document.documentElement.getBoundingClientRect()`, clipped to the
      viewport.
    - The message carries `tagName: 'body'` and `isPage: true`.
  - **DOM predicates (in the runtime):**
    - `isRoot` = `localName` is `html` or `body`;
    - `contains(a, b)` = `a.contains(b)`;
    - `resolve` walks `ownerSVGElement` up to the outermost `<svg>`. An element whose
      `ownerSVGElement` is `null` (an `<svg>` root or a non-SVG element) is returned as is;
    - `paints(el)` = `paintsFromStyle(...)`, using `el.localName`, the `getBoundingClientRect`
      size, whether any direct child Text node has non-whitespace data, and `getComputedStyle(el)`.
  - The runtime still never writes to the design DOM: no `.style`, no `classList`, no
    `setAttribute`, no injected nodes.
  - Update `runtime.test.ts` (string assertions, existing style).
  - Update the `handoffCanvasHtml.test.ts.snap` snapshot deliberately, because it embeds the
    runtime.
  - Confirm that the export preview controller still ignores the new types. It allowlists height
    and wheel, and nobody sends it `cd:mode`, so exported frames stay in Interact mode.
  - **Done when:**
    - `runtime.test.ts` asserts:
      - `event.source !== host`;
      - `cd:ready`;
      - every blocked event name;
      - `ArrowUp`, `ArrowDown`, `stopImmediatePropagation`, `elementsFromPoint`,
        `requestAnimationFrame` and `cancelAnimationFrame`;
      - the unchanged forbidden list.
    - The snapshot diff shows only the runtime text.
    - `pnpm verify` is green.

- [x] **3. Chrome: toggle, outlines, stepping.**
  - **`hostBridge.svelte.ts`:**
    - Add `postToFrame(iframe, message: ChromeFrameMessage)`. It calls
      `iframe.contentWindow?.postMessage(message, '*')` and is the only chrome → frame send
      (rule 08).
    - The target is `'*'` because sandboxed frames have an opaque origin. The payload is only a
      mode or a step command.
  - **Frame registry.** The registry is App's existing `iframes: Map<frameId, HTMLIFrameElement>`.
    `Frame.svelte` fills it through `onIframe` → `handleIframe`: it adds the iframe on attach,
    before `src` is set, and removes it on detach. "Registered" means present in that map. Every
    chrome → frame send looks up the iframe there (toggle, `cd:ready` reply, arrows, buttons).
  - **`App.svelte` state:**
    - `commentMode = false`;
    - `hover: { frameId, rect: FrameRect } | undefined`;
    - `pick: { frameId, tagName, rect: FrameRect | null, isPage } | undefined`.
  - **Frame messages** (`cd:hover` and `cd:pick` are dropped while `commentMode` is false):

    | Message from frame F | App does |
    |---|---|
    | `cd:ready` | Clears `hover` and `pick` if they belong to F, then sends F `{ type: 'cd:mode', mode }` for the current mode. This covers first load and every reload. |
    | `cd:hover`, non-null rect | Sets `hover = { frameId: F, rect }`. |
    | `cd:hover`, `rect: null` | Clears `hover` only if it belongs to F. |
    | `cd:pick`, `pick` belongs to another frame A | Sends A `{ type: 'cd:mode', mode: 'comment' }` first (A empties its path), then sets `pick` as below. |
    | `cd:pick` | Sets `pick = { frameId: F, tagName, rect, isPage }`, including when `rect` is `null`. |

    A null pick rect hides the pick outline but keeps the chip, the tag and `isPage`.
  - **Toggle.** Flip `commentMode`, clear `hover` and `pick`, and send `cd:mode` to every iframe in
    the map.
  - **`applyCanvasUpdated`.**
    - Drop `hover` and `pick` whose frame left the stage.
    - When `frames` becomes empty, set `commentMode = false` and clear both.
  - **Keyboard fallback.** A `<svelte:window onkeydown>` handler covers ↑/↓ when focus is in
    chrome:
    - It acts only in Comment mode with a pick.
    - ArrowUp sends `{ type: 'cd:pick-parent' }` and ArrowDown sends `{ type: 'cd:pick-child' }`
      to the pick's frame, with `preventDefault()`.
    - It ignores events that are already `defaultPrevented` (label nudges), that have
      Ctrl/Meta/Alt/Shift held, or that target an `input`, `textarea`, `select` or
      `contenteditable` element.
    - When focus is in a frame, the runtime handles the keys (step 2).
  - **Outlines.** `hoverOutline` and `pickOutline` (`StageRect | undefined`) are `$derived` via
    `frameRectToScreen`:
    - The inputs are `hover`, `pick`, `displayFrames` and `committedView`.
    - They use the frame's stage `x` / `y` from `displayFrames`, the same values that position the
      frame wrapper, including the in-drag override. They never use the label box, and never
      `iframe.getBoundingClientRect()`.
    - A null rect, a missing frame or an undefined `committedView` gives `undefined`.
  - **`Toolbar.svelte`:**
    - A "Comment" `<button aria-pressed={commentMode}>`. It is disabled through the existing
      `disabled` prop, which covers no frames and untrusted workspaces (where the host posts
      `frames: []`).
    - In Comment mode with a pick, a chip with `aria-live="polite"`. It shows the tag name as
      text, or "Whole frame" for `isPage`.
    - Next to the chip, "Parent" and "Child" buttons. They have `aria-label`s ("Select parent
      element", "Select child element") and the arrow keys in `title`. Both call App callbacks
      that send `cd:pick-parent` / `cd:pick-child` to the pick's frame.
    - Parent is disabled for `isPage`. Child stays enabled, because chrome does not know the path
      depth; at the bottom it re-posts the same pick.
    - Theme tokens and `:focus-visible`, like the existing controls.
  - **New `Overlay.svelte`** (view only):
    - Props are `{ hover: StageRect | undefined; pick: StageRect | undefined }`.
    - It is positioned absolutely over the stage viewport, with `pointer-events: none` and
      `aria-hidden="true"`.
    - Hover is 1px dashed `var(--vscode-focusBorder)`. Pick is 2px solid
      `var(--vscode-focusBorder)`. Both show when set, at constant screen thickness at any zoom.
    - Position and size use Svelte `style:` directives (CSSOM, allowed by the nonce CSP), never a
      `style=""` string.
    - `Stage.svelte` renders it inside the viewport after the layer, and receives `hoverOutline` /
      `pickOutline` props.
  - **Done when:**
    - `svelte-autofixer` is clean on every touched Svelte file.
    - `pnpm verify` is green.
    - In F5 on an existing fixture:
      1. Toggle Comment mode on.
      2. The hover outline follows the cursor.
      3. A click picks, and the chip shows the tag.
      4. ↑ with focus still in the frame steps to the parent.
      5. Link clicks do nothing.
      6. Toggle Comment mode off: the outlines are gone and clicks work again.

- [x] **4. Picking fixture and F5 matrix.**
  - `fixtures/picking.html` is tracked. `.vscodeignore` already excludes `fixtures/**`, and the
    dev-workspace `.cursor-design/` is gitignored.
  - It must render under the blob CSP (Notes) and contain:
    - **Structure:** nested sections, and a row of five identical cards.
    - **Scroll box:** an `overflow: auto` box with more items than fit.
    - **Hit-test traps:** a transparent full-width overlay over a sibling, a
      `pointer-events: none` decorative layer, and an absolutely positioned badge.
    - **SVG and generated content:** an 8px inline-SVG icon, an inline SVG with `<path>`s, and an
      element appended by a script.
    - **Media and nested frame:** `<video controls>` with no source, and a static
      `<iframe srcdoc>` inside a padded wrapper.
    - **Interactive controls:** a link, a `<button>` whose script handler changes visible text, a
      `<form>` with a text input and a submit button, a `<select>`, and a `<details>`.
    - **Empty area:** at least 200px of empty `body` at the bottom, where the stack is only
      `html` / `body`.
  - For F5, copy the fixture into the dev workspace, then Run Extension:
    `cp fixtures/picking.html fixtures/dev-workspace/.cursor-design/artboards/picking.html`.
  - **Done when:** every F5 line under Testing passes at 10%, 100% and 400% zoom, and the result
    is recorded in the review handoff. The human runs this; the agent does not claim it.

## Files / areas

- `src/disk/layout.ts`: `MAX_TAG_NAME_CHARS`
- `src/webview/frame/frameMessages.ts` (+ `.test.ts`)
- `src/webview/frame/pickTarget.ts` (+ `.test.ts`), new
- `src/webview/frame/pickPath.ts` (+ `.test.ts`), new
- `src/webview/frame/runtime.ts` (+ `runtime.test.ts`)
- `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` (deliberate update)
- `src/webview/stageGeometry.ts` (+ `.test.ts`): `frameRectToScreen`
- `src/webview/hostBridge.svelte.ts`: `postToFrame`
- `src/webview/App.svelte`, `Toolbar.svelte`, `Stage.svelte`, and the new `Overlay.svelte`
- `.claude/rules/02-mcp-webview.md` (messages bullets), `.claude/rules/05-single-job.md` (catalog)
- `fixtures/picking.html`, new

The host (`src/host/**`, `src/panel/**`), MCP, and every disk library other than `layout.ts` stay
untouched.

## Data / contracts

### Frame → chrome guards (`parseFrameMessage`)

An unknown `type`, a non-object or a failed guard returns `undefined`. Extra fields are dropped by
building a new object.

- `FrameRect`: an object whose `x`, `y`, `width` and `height` are finite, with `width` and
  `height` ≥ 0 and every absolute value ≤ `MAX_FRAME_COORDINATE` (100000, `layout.ts`).
- `cd:ready`: `{ type }`.
- `cd:hover`: `rect` is a valid `FrameRect` or `null`.
- `cd:pick`:
  - `tagName` is a string of 1..`MAX_TAG_NAME_CHARS` characters matching `^[a-z][a-z0-9-]*$`. The
    runtime sends `localName`.
  - `rect` is a valid `FrameRect` or `null`.
  - `isPage` is a boolean.

### Chrome → frame (`parseChromeFrameMessage`)

The posted objects are `{ type: 'cd:mode', mode: 'interact' | 'comment' }`,
`{ type: 'cd:pick-parent' }` and `{ type: 'cd:pick-child' }`. A known type with valid fields is
accepted, and extra fields are dropped (same policy as `parseFrameMessage`). Any other mode, any
other type, or a non-object returns `undefined`. The runtime also requires `event.source === host`.

### `pickTarget<T>({ stack, resolve, isRoot, paints, contains }): T | undefined`

`stack` is topmost first (the `elementsFromPoint` order); `undefined` means a page pick.

1. Map each entry through `resolve` (SVG internals become the outermost `<svg>`).
2. Walk in order and skip roots.
3. Skip a candidate when `!paints(candidate)` and some later stack entry `below` exists with
   `!contains(below, candidate)`, meaning a non-ancestor is underneath. Otherwise return the
   candidate.
4. An empty stack, or one with nothing but roots and skipped candidates, returns `undefined`.

### `paintsFromStyle(input): boolean`

The input is:

```text
{ localName, width, height, hasOwnText, style: { backgroundColor, backgroundImage, boxShadow,
  borderTopWidth, borderRightWidth, borderBottomWidth, borderLeftWidth,
  borderTopColor, borderRightColor, borderBottomColor, borderLeftColor } }
```

The values are computed-style strings.

1. If `width` or `height` is 0, return `false`.
2. Return `true` if any of these holds:
   - `localName` is one of `img, svg, video, audio, canvas, iframe, embed, object, picture,
     input, textarea, select, button, progress, meter, hr`;
   - `hasOwnText` is true;
   - `!isTransparentColor(backgroundColor)`;
   - `backgroundImage !== 'none'`;
   - some side has `parseFloat(width) > 0` and `!isTransparentColor(color)`;
   - `boxShadow !== 'none'`.
3. Otherwise return `false`.

`isTransparentColor(value)` is true for `'transparent'` and for any value whose alpha is zero. That
means an `rgba(...)` / `hsla(...)` value ending in `, 0)`, or a modern syntax ending in `/ 0)`,
including `0.0` and `0%`. Every other value counts as painted. Treating unknown formats as painted
is deliberately safe: it keeps the element.

### `clipRect(rect, clips: readonly FrameRect[]): FrameRect | null`

Intersects `rect` with each clip in turn. Zero area returns `null`.

### `pickPath`

This is generic. Path index 0 is the clicked element and the last entry is the current pick. The
runtime builds a new path on every click (step 2), so `pickPath` exports only the steps:

- `stepToParent({ path, parentOf, isRoot })`: returns `path` unchanged when `isRoot(current)`
  (`html` or `body`) or when `parentOf(current)` is `null`. Otherwise it appends the parent.
- `stepToChild(path)`: when the length is greater than 1, drops the last entry; otherwise returns
  `path` unchanged.

A current entry that is `body` posts `isPage: true`.

### `frameRectToScreen({ view, frame: { x, y }, rect })`

Returns:

```text
{ x: (frame.x + rect.x) * zoom + view.x, y: (frame.y + rect.y) * zoom + view.y,
  width: rect.width * zoom, height: rect.height * zoom }
```

### Rule 02

Replace the current messages bullet (5) with these two bullets. `frameMessages.test.ts` pins
bullet 5.

```text
5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: `parseChromeMessage`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure); canvas:updated (frames carry `generation`)|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed (`parseFrameMessage`): cd:frame-height { height }, cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y }, cd:ready, cd:hover { rect|null }, cd:pick { tagName, rect|null, isPage } (frame-local CSS px; chrome drops cd:hover and cd:pick outside Comment mode). Chrome → iframe (runtime accepts only from the parent it captured at load, `parseChromeFrameMessage`): cd:mode { mode: interact|comment }, cd:pick-parent, cd:pick-child.
6. A design's own script can post any cd:* message. Chrome renders frame data as text or geometry only (never `{@html}`), and anything that will reach an Agent prompt is sanitized first (8h `commentPrompt`).
```

This feature adds no persisted data and changes no host or MCP contract.

## Testing

### Unit (`vp test`, colocated, pure; no happy-dom needed)

- **`pickTarget.test.ts`.** Uses plain objects with predicate stubs.
  - `pickTarget`:
    - A transparent overlay above an unrelated sibling picks the sibling.
    - A transparent section whose stack below holds only its ancestors is kept.
    - A `path` inside an `svg` picks the `svg`.
    - An empty stack is a page pick, and so is an html/body-only stack.
    - A zero-size element over a sibling picks the sibling.
    - A painting element on top picks itself.
  - `clipRect`: a rect inside, partly outside and fully outside (`null`), zero-size (`null`), and
    multiple clips.
  - `paintsFromStyle`:
    - Returns `false` for a zero size and for an all-transparent style (`rgba(0, 0, 0, 0)`,
      borders `0px`, `none`).
    - Returns `true` for:
      - each of `rgb(255, 0, 0)`;
      - `rgba(0, 0, 0, 0.5)`;
      - a `background-image` URL;
      - a `1px` border with color `rgb(0, 0, 0)`;
      - a box-shadow;
      - own text;
      - `svg`;
      - `button`.
    - A `2px` border whose color is `rgba(0, 0, 0, 0)` returns `false`.
  - `isTransparentColor`:
    - `transparent`, `rgba(1, 2, 3, 0)`, `color(srgb 1 0 0 / 0)` and `oklch(0.5 0.1 20 / 0%)` are
      true.
    - `rgb(1, 2, 3)` and `oklch(0.5 0.1 20)` are false.
- **`pickPath.test.ts`:**
  - Up, up, down returns the first parent.
  - Down at the bottom stays.
  - Up at body stays.
  - When `parentOf` returns `null` (removed node), the path stays.
- **`frameMessages.test.ts`:**
  - Each new type's happy path, with extra fields dropped. This covers both parsers.
  - `cd:pick` is rejected for:
    - a tag over 64 characters;
    - an uppercase tag;
    - a tag with a control character or newline;
    - an empty tag.
  - Rect values that are `NaN`, `Infinity`, a negative width, or over 100000 are rejected.
  - `rect: null` is accepted.
  - A non-boolean `isPage` is rejected.
  - `parseChromeFrameMessage` rejects an unknown mode and unknown types.
  - The rule-02 literal for bullet 5.
- **`stageGeometry.test.ts`:** `frameRectToScreen` at zoom 0.1, 1 and 4 with a panned view.
- **`runtime.test.ts`:** the string assertions from step 2.

Two wrong-`event.source` cases are enforced in code rather than unit tests: a sibling frame posting
`cd:mode` to another frame, and a frame posting as if it were another. `event.source !== host` in
the runtime and the existing `frameIdForSource` in the bridge stop them. They are asserted as
runtime source strings and proven in F5, because rule 09 bans unit tests of iframe behavior.

### F5 (human, `fixtures/picking.html`)

Run at 10%, 100% and 400%. Use ctrl+wheel or pinch for 10% and 400%.

1. Hover outline == the element a click then picks, for every fixture element except the nested
   iframe (line 14).
2. The transparent overlay is skipped (the covered sibling is picked), and the
   `pointer-events: none` layer is never hovered.
3. The 8px icon and the badge can be picked. Clicking an SVG `<path>` picks the `<svg>`.
4. Clicking the third identical card picks that card (outline on card 3).
5. Scroll box: hover, then scroll the box, and the outline re-posts. A picked item scrolled out of
   view loses its outline but keeps its chip.
6. The script-generated element can be picked.
7. In Comment mode nothing in the design fires:
   - the link does not navigate;
   - the button text does not change;
   - the form does not submit;
   - the select does not open;
   - the details does not toggle;
   - the video does not play.

   Enter and Space on a focused control do nothing. All of them work again in Interact mode.
8. Alt+click picks the parent, and ↓ then returns to the clicked element. ↑/↓ step both with focus
   in the frame (right after a click) and with focus in chrome. Parent/Child step too. ↑ at the
   top stays on "Whole frame".
9. Clicking the empty bottom area gives "Whole frame" and an outline around the frame.
10. Pan, zoom and drag the frame by its label (still enabled in 8d1) with a pick: the outline stays
    glued to the element, including during the drag preview.
11. Pick in frame A, then click in frame B: only B's outline remains. ↑ steps B. Scrolling inside A
    afterwards does not bring A's pick back.
12. The Agent edits `picking.html` while it is picked: the frame reloads, and its outline and chip
    clear.
13. Toggle off: the outlines and chip are gone. In an untrusted workspace the toggle is disabled.
14. Nested iframe (ceiling): hovering or clicking inside it neither moves the outline nor is
    blocked, whether or not its `srcdoc` renders. Its wrapper can be picked by clicking the
    wrapper's padding.
15. Open the exported `canvas.html` (export from the Agent, then open it): frames render, scroll
    and click normally.

## Notes for the AI

- **Deviations from the 0.3 plan, recorded on purpose.**
  - The plan's 8d1 section also lists `cd:anchors`, `cd:key`, and the selector and style guards.
    Each ships with the code that produces or consumes it:
    - `cd:anchors` / `cd:anchor-rects` in 8f2;
    - `cd:key` in 8f1;
    - selector, text, styles and `point`, with their guards, in 8d2.

    Shipping a message nobody sends is dead contract.
  - ↑/↓ with focus in a frame are handled locally by the runtime, not forwarded, so `cd:key`
    stays in 8f1.
  - The toolbar toggle is pulled forward from 8f1 because 8d1 must be judgeable in F5. 8f1 adds
    `C`, Escape, the hint, the popover and drag inertness.
- **Ceilings to mark with `ponytail:` comments:**
  - Pointer events inside a nested design `<iframe>` go to that document. Its interior therefore
    cannot be hovered or picked, its own clicks are not blocked, and the iframe element itself
    cannot be clicked into. Upgrade: inject the runtime into nested frames.
  - Hover updates on the next pointer move, not on wheel-pan.
  - `paintsFromStyle` is a heuristic: it ignores `::before` / `::after`, `outline` and filters.
    Upgrade: add pseudo-element checks.
  - The cross-frame switch can still flip back if A's `cd:pick` was already in flight when chrome
    sent A the reset. After the reset A posts nothing, so the window is a single message.
- Clip boxes use each ancestor's `getBoundingClientRect`, which is the border box. That slightly
  over-approximates the padding box, which is fine for an outline.
- **Blob CSP.** The policy is `default-src 'none'`, nonce'd `script-src` / `style-src`, and
  `frame-src blob:`. It blocks `style=""` attributes, inline handlers, images and media.
  - The fixture uses `<style>` blocks with classes and inline SVG only.
  - `<script>` gets its nonce from `stampArtboardHtml`.
  - The nested `<iframe srcdoc>` may or may not render under this policy. F5 line 14 expects the
    same result either way.
- **Chrome CSP.** It has no `'unsafe-inline'` styles, so dynamic geometry uses `style:`
  directives (`Frame.svelte` does the same).
- **Exported `canvas.html`.** The runtime is embedded there too. Its new `message` listener answers
  only its captured parent, which in the export never sends `cd:mode`, so exported frames behave
  exactly as before. Add nothing export-specific.
- **No logging.** `console` is lint-banned in chrome and the runtime. Rejected frame messages are
  silent, matching the existing `ponytail:` note in `hostBridge.svelte.ts`.
- Follow rule 04: object args for 3+ params, and full names. Follow rule 08 (container vs view):
  `Overlay` and `Toolbar` take props in and send callbacks out, and only App calls `postToFrame`.
- **Handoff for Projects Manager after 8d1** (this feature does not do it): update the Notion hub
  "Host ↔ webview" lines with the D4 messages.
- **Implementation refinements (accepted 2026-10-22, after `/implement`):**
  - A `click` with `detail === 0` (keyboard or script) is blocked but does not pick. It has no
    pointer position, so it would pick at (0, 0). Enter and Space stay blocked by `keydown`.
  - Clip boxes skip `html` and `body`. Their overflow applies to the viewport, which is clipped
    last.
  - The runtime's `parentOf` resolves SVG. So ↑ from HTML inside a `<foreignObject>` lands on the
    outer `<svg>`, never on a camelCase tag that the guard rejects.
  - A current pick of `html` is a page pick: `isPage: true` with `tagName: 'body'`.
  - The toolbar `.fit` class is now `.action`, shared by Comment, Parent, Child and Fit all.
  - The export snapshot also changed in step 1, because `canvas.html` embeds `stageGeometry`, which
    now includes `frameRectToScreen`.
  - After a real pointer pick the runtime calls `window.focus()`. The blocked `mousedown` never
    moved focus, so with the Cursor chat open ↑/↓ went to the chat (F5, 2026-10-23).
- **Verification (2026-10-23):**
  - Chrome harness (real runtime IIFE, blob frames): F5 lines 1–13 and 15 pass. The pan pixel
    check was noisy, and pan was confirmed in F5.
  - F5 (human): Agent edit clears the pick; ↑/↓ right after a click (with the Cursor chat open,
    after the focus fix); pan glue; pick, Parent/Child and toggle-off match Chrome; forms inert.
    The untrusted-workspace toggle was skipped.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":31708,"specSha256":"e81efe6d8260193b01492a0cac52e2269efab3cf190bdbcf7a4aa16fac920882","branch":"refs/heads/feature/picking-channel","head":"60de57fb78877ac15bef9ca2ee95a5adebf54d72","baseRef":"refs/heads/main","baseCommit":"12fac872a7c170d44eb8fb8a2c256aef8c1d7619","sourceTree":"a27fbb8db8da170646d8532268bc0282d8bb7ff1","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8d1/F-24 [P3] closed - Parent button disables itself while focused

**File:** src/webview/Toolbar.svelte:47
**Found:** 2026-10-23 by /audit (scope: current; lens: quality, security, performance, tests)
**Why it matters:** A keyboard user who steps up with the focused Parent button reaches "Whole frame". The button then gets `disabled={pick?.isPage}` while it holds focus. Chromium drops focus from a disabled element to `body`, so the next Tab starts over from the top of the webview. That breaks the keyboard flow rule 08 asks to preserve. ↑ and the Child button still work, so nothing is blocked.
**Suggested fix:** Keep the button focusable and use `aria-disabled={pick?.isPage}` instead of `disabled`, with `.action[aria-disabled='true']` sharing the dimmed style. `stepPick` is already a no-op at the top (the runtime re-posts the same page pick), so no guard is needed. No current requirement is lost.
**Resolution:** 2026-10-23: Parent now uses `aria-disabled={pick?.isPage}`, and `.action[aria-disabled='true']` shares the `:disabled` dim style (`Toolbar.svelte`). `svelte-autofixer` is clean and `pnpm verify` is green. Needs a review pass to close.
2026-10-23 independent review (claude-opus-5-5): re-examined `Toolbar.svelte` at 60de57f. Parent keeps focus via `aria-disabled` with `onclick` unset at Whole frame; no `disabled` attribute, dim style shared. Defect gone, no new one. Closed.

## Independent review

**Status:** passed
**Target commit:** 60de57fb78877ac15bef9ca2ee95a5adebf54d72
**Base commit:** 12fac872a7c170d44eb8fb8a2c256aef8c1d7619
**Base ref:** refs/heads/main
**Spec hash:** e81efe6d8260193b01492a0cac52e2269efab3cf190bdbcf7a4aa16fac920882
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-10-23T13:32:43Z
**Workflow:** regular
**Check required:** no

## Handoff

Review the active spec and the complete `12fac872a7c170d44eb8fb8a2c256aef8c1d7619..60de57fb78877ac15bef9ca2ee95a5adebf54d72` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-23T13:36:30Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD` / `git merge-base refs/heads/main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain=v1`: pass (all match request; only review.md dirty)
- `git diff 12fac87..60de57f`: reviewed (35 files)
- `pnpm verify`: pass

## Evidence

- Frame -> chrome: `routeMessage` matches `event.source` against registered iframe `contentWindow`s (null source never matches); unregistered `origin === 'null'` senders are dropped before the host parser.
- `parseFrameMessage` rebuilds every payload: rects bounded by `MAX_FRAME_COORDINATE` with non-negative size, `tagName` limited to `/^[a-z][a-z0-9-]*$/` and 64 chars, `isPage` boolean; extra fields dropped.
- Untrusted data reaches UI only as Toolbar chip text (Svelte text interpolation) and Overlay geometry; no `{@html}` in chrome.
- Chrome -> frame: single `postToFrame` sink, only `cd:mode` / `cd:pick-parent` / `cd:pick-child`, sent only to registered iframes; runtime accepts only `event.source === host` (captured parent) and parses via `parseChromeFrameMessage`.
- `cd:hover` / `cd:pick` ignored outside Comment mode (`applyPickMessage`); `cd:ready` only re-sends `cd:mode` to the same frame.
- Pure rules (`commentPick`, `pickTarget`, `pickPath`, `canvasFrames`, `frameGesture`, `routeMessage`, frame parsers) have colocated edge-case tests.

## Findings

- F-28 [P3] open: exported canvas.html carries the inert Comment-picking runtime
- F-24 [P3] closed: Parent button focus repair re-examined

## Remaining risk

- A design script can post `cd:pick` in Comment mode from its own frame, which makes chrome reset another frame's pick (one-pick-across-frames rule). Spoofed picks are bounded and text-only; acknowledged by rule 02 item 6, sanitization deferred to 8h `commentPrompt`.
- Check not run (not required); iframe runtime behavior (blocking, focus, hover rAF, scroll repost) is proven only by F5, not by unit tests.
- Existing unverified F-25 / F-26 not re-proven here.

## Try it now

1. `cp fixtures/picking.html fixtures/dev-workspace/.cursor-design/artboards/picking.html`, then F5 (Run Extension).
2. Click **Comment** in the toolbar. A dashed outline follows the cursor over the `picking` frame.
3. Click card 3: a solid outline and a `article` chip appear; the card's link and button do nothing.
4. Press ↑ (or **Parent**) to step to the parent, ↓ (or **Child**) to step back; Alt+click picks the parent directly.
5. Click **Comment** again: outlines and chip disappear and the design's controls work again.
