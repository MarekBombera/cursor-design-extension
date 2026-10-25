# Feature: Selectors

**From build-plan:** feature 8d2
**Build attempt:** 1
**Branch:** `feature/selectors`
**Status:** verified

## Goal

This is the second half of the Notion requirement "Element picking must feel precise". 8d1 shipped
the pick itself (which element, its outline, parent/child stepping). 8d2 makes each pick carry
everything a comment will store:

- a stable selector that is unique in the frame document, built by `@medv/finder` inside the frame
  runtime with generated class and id names filtered out;
- the lowercased tag name, a short text excerpt, an allowlist of computed styles, and the pick
  point;
- guards and sanitizers for each of those fields, because a design's own script can post any
  `cd:pick`.

The chrome chip shows the selector so precision can be judged in F5. No comment storage, popover
or MCP change.

Sources: `blueprint/reference/0.3-comments-plan.md` § Libraries, message contract, 8d1, 8d2 (read
both sections in full before implementing); Notion 0.3 brief, Comment mode contract and "Lessons
from Claude Design complaints" (hub link in `AGENTS.md`); the 8d1 archive
`blueprint/history/features/08d1-picking-channel.md`. Where the plan and this spec disagree, this
spec wins (see Notes for the AI).

## In scope

- `@medv/finder` 4.0.2 bundled into the frame runtime.
- New `src/webview/frame/selector.ts`: finder configuration, the generated-name filter, the text
  excerpt, the computed-style allowlist reader, and `describeElement` (the pick data for one
  element).
- `cd:pick` grows from `{ tagName, rect, isPage }` to
  `{ selector, tagName, text, rect, point, styles, isPage }`, with guards in `parseFrameMessage`.
- Caps and the style-key allowlist, defined once in `src/disk/layout.ts`.
- The pick point, as an element-relative position (Data / contracts).
- Chrome stores the full pick. The toolbar chip shows the selector instead of the tag.
- `fixtures/picking.html` gains the selector traps the round-trip test needs.
- happy-dom round-trip tests on that fixture.
- Rule 02 (messages bullet and untrusted-input note) and the rule 05 catalog.

## Out of scope

- `comments.json`, `comment:create`, the creation cross-check, and the parse5 + css-select match
  on disk (8e). This feature only feeds 8e: the script-mutated test shows the live selector can
  differ from the static HTML.
- Rejecting selectors that fail to parse. Chrome renders the selector as text and never queries
  with it. The host rejects unparseable selectors at `comment:create` (8e/8f1).
- The popover, the `C` shortcut, `cd:key`, and Comment-mode inertness of drag/resize (8f1).
- Pins, `cd:anchors` / `cd:anchor-rects` (8f2).
- Prompt sanitizing in `commentPrompt` (8h). This feature only guarantees that the values
  arriving from a frame are capped, single-line and character-limited.
- F-28 (the exported `canvas.html` carries the inert picking runtime). Finder rides along in the
  same runtime string, so the export grows by finder's size. The decision on F-28 stays with the
  user. Record the snapshot size delta in the review handoff.
- Picking inside a nested design `<iframe>` (8d1 ceiling, unchanged).

## Build loop

`workflow.stepReview` is `feature`: build all steps in order, run each step's check, then present
one review at the end. `workflow.checkpointCommits` is `disabled`, so there are no per-step
commits; `/complete` makes the feature commit. Each step leaves `pnpm verify` green.

Every `.svelte` edit follows rule 08:

- Before writing, call Svelte MCP `list-sections` and `get-documentation`.
- After writing, run `svelte-autofixer` on the full file until it is clean.
- Prefer the `svelte-file-editor` agent.

## Build steps

- [x] **1. Dependency, caps, `selector.ts`, fixture and round-trip tests (no wire change yet).**
  - Run `pnpm add -D @medv/finder@4.0.2` (exact version). It is a devDependency like `svelte`,
    because it is bundled into the runtime string and never loaded from `node_modules`.
    - This checkout has an unlisted copy of finder in `node_modules`. If pnpm aborts with
      `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, rerun the install from a terminal with a TTY.
      Do not change pnpm config to get past it.
    - `pnpm knip` must stay clean. `selector.ts` is reached through `selector.test.ts`, which is a
      knip entry (`src/**/*.test.ts`), so no knip ignore is needed before Step 2 wires it.
  - `src/disk/layout.ts`: add `MAX_SELECTOR_CHARS`, `MAX_PICK_TEXT_CHARS`,
    `MAX_STYLE_VALUE_CHARS` and `COMMENT_STYLE_KEYS` (Data / contracts).
  - `src/webview/frame/frameMessages.ts`: add only the DOM-free character checks that
    `selector.ts` needs: `hasControlChars` and `isSafeStyleValue` (Data / contracts), and export
    the `CommentStyles` type. The `cd:pick` guard changes in step 2.
  - New `src/webview/frame/selector.ts` (Data / contracts): `isGeneratedName`, `buildSelector`,
    `textExcerpt`, `readStyles`, `describeElement`.
  - `src/webview/frame/pickTarget.ts`: add the pure `pointInTarget` (Data / contracts).
  - `fixtures/picking.html`: add a "Selector traps" section (Testing → Fixture).
  - Tests: `selector.test.ts` (happy-dom), the `pointInTarget` cases in `pickTarget.test.ts`, and
    only the `hasControlChars` / `isSafeStyleValue` cases in `frameMessages.test.ts` (Testing). Every
    `cd:pick` guard case belongs to Step 2.
  - **First, check** that happy-dom 21 provides `CSS.escape`, `Node` and `HTMLElement.innerText`
    under `// @vitest-environment happy-dom`, because finder calls the first two and
    `describeElement` reads the third. If one is missing, stop and report; do not polyfill
    silently.
  - **Done when:** `vp test` passes every case listed for this step (the Testing cases marked
    Step 1), including the fixture round trip, and `pnpm verify` is green. Picking in F5 is
    unchanged.

- [x] **2. Wire: runtime sends the full pick, chrome guards and shows it.**
  - `frameMessages.ts`: extend `FramePickMessage` and `parseFramePick` to the full shape
    (Data / contracts → `cd:pick`). Do not edit the existing `tagName` and `rect` branches.
  - `src/webview/frame/commentPicking.ts`:
    - On a click (`event.detail > 0`, left button), in this order: set `path = pathAt(...)`; set
      the anchor from `path[0]` (Data / contracts → Pick point); describe the current pick; post.
    - Whenever the current pick changes (click, `stepToParent` / `stepToChild` from keys or
      messages), compute `describeElement(current, isRoot(current))` and keep it in a per-pick
      `Map<Element, PickDescription>`, cleared on each click and `cd:mode`. An element already in
      the map is not described again, so ↑/↓ over the same path never reruns finder (audit
      F-41). If describing throws, the map has no entry and `postPick` sends nothing (F-49).
    - "Kept data" is the `describeElement` output only (`selector`, `tagName`, `text`, `styles`).
      Every post (click, step, scroll, resize) recomputes `rect` (`visibleRect`, unchanged) and
      `point` (`pointInTarget`). Scroll and resize re-posts never run finder.
    - `cd:mode` resets the anchor and pick data together with `path` (existing reset).
    - A throw from describing must never escape into `blockInComment`: the click is still blocked
      (`buildSelector` already catches finder; see Notes).
    - The runtime still never writes to the design DOM.
  - `src/webview/commentPick.ts`: `pick` becomes `{ frameId } &` every `cd:pick` field except
    `type`. `applyPickMessage` copies the parsed message as is. Other rules are unchanged.
  - `src/webview/Toolbar.svelte`:
    - The `pick` prop becomes `{ selector: string | null; tagName: string; isPage: boolean }`.
    - The chip text is `Whole frame` for `isPage`, the selector when it is non-null, and
      `<tagName> (no unique selector)` when it is null.
    - The chip has `title` set to the same text, `max-width: 16rem`, and CSS ellipsis
      (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`). The chip is a flex item of
      `.bar`, so `max-width` applies.
    - The chip itself is not a live region. A visually hidden `aria-live="polite"` span (stays
      mounted) announces `<tagName> element selected` or `Whole frame selected`, not a selector
      of up to 1000 characters (audit F-47).
  - `App.svelte` passes `CommentPickState.pick` to `Toolbar`; no new state. `Toolbar` reads only
    `selector`, `tagName` and `isPage` from it.
  - `.claude/rules/02-mcp-webview.md`: replace bullets 5 and 6 with the text in Data / contracts.
    Update the literal pin in `frameMessages.test.ts`.
  - `.claude/rules/05-single-job.md`: in the Picking line, add `buildSelector` /
    `describeElement` / `isGeneratedName` / `textExcerpt` / `readStyles`
    (`src/webview/frame/selector.ts`) and `pointInTarget` (`pickTarget.ts`). In the Panel line, add
    `hasControlChars` / `isSafeStyleValue` next to `parseFrameMessage`.
  - `runtime.test.ts`: the existing forbidden-mutation list still passes with finder bundled. Add
    an assertion that the runtime string contains finder (for example its
    `Can't generate CSS selector` message), so a dropped import fails.
  - Update `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` deliberately. The diff may
    contain only runtime text. Record the size delta (lines and bytes) for the handoff (F-28).
  - **Done when:**
    - `frameMessages.test.ts` passes every `cd:pick` case under Testing, plus the rule-line pin.
    - `selector.test.ts` passes the "described pick passes the guard" cases.
    - `commentPick.test.ts` passes with the wider pick.
    - `svelte-autofixer` is clean on `Toolbar.svelte` and `App.svelte`.
    - `pnpm verify` is green.

- [x] **3. F5 smoke in Cursor, plus two stage bugs found there.**
  - Scope reduced 2026-10-25 (user): the selector matrix (cards, scroll box, shadow host,
    generated names, mutated list, ellipsis, payload caps, export `canvas.html`) was verified by
    an agent in Chrome with real clicks on the exported canvas (2026-10-24, all passed) and moves
    to the 8d3 Playwright suite. Cursor F5 keeps only what Chrome cannot show.
  - F5 surfaced two shipped bugs (both also on `main`, from 8b/0.2), fixed in this branch:
    - **Frame reload loop (F-51):** `Frame.svelte` read `id` / `html` straight from Stage's
      `{#each}` record, so every new record object (height report, drag preview,
      `canvas:updated`) re-ran the blob effect and reloaded the frame, which re-posted its
      height: endless reloads, flicker, and wheel/zoom cut off mid-gesture. Fix: `$derived`
      string copies of `id` and `html`.
    - **Pan stops when a trackpad gesture leaves a frame (F-52):** Chromium latches a gesture
      to the out-of-process frame it starts in; once the frame slides away, the rest arrives
      as native scroll of the chrome page, which `overflow: clip` dropped. Fix: a hidden page
      scroll sink in `App.svelte` (chrome pinned with `position: fixed`) turns that scroll into a
      pan via the pure `scrollSinkStep` (`frameGesture.ts`, tested), only within 1 s of a
      forwarded frame wheel, then re-centres.
  - **Done when:** in Cursor F5 zoom and pan over frames work, no flicker (user confirmed
    2026-10-25), and `pnpm verify` is green.

## Files / areas

- `package.json`, `pnpm-lock.yaml`: `@medv/finder` 4.0.2 (dev)
- `src/disk/layout.ts`: caps and `COMMENT_STYLE_KEYS`
- `src/webview/frame/frameMessages.ts` (+ `.test.ts`)
- `src/webview/frame/selector.ts` (+ `selector.test.ts`), new
- `src/webview/frame/pickTarget.ts` (+ `.test.ts`): `pointInTarget`
- `src/webview/frame/commentPicking.ts`, `src/webview/frame/runtime.test.ts`
- `src/webview/commentPick.ts` (+ `.test.ts`), `src/webview/Toolbar.svelte`,
  `src/webview/App.svelte`
- `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` (deliberate update)
- `fixtures/picking.html`
- `src/webview/Frame.svelte` (F-51), `src/webview/App.svelte` + `src/webview/frameGesture.ts` (+ test) scroll sink (F-52), `blueprint/context/system-map.md` (stage pan inputs)
- `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`

The host (`src/host/**`, `src/panel/**`), MCP, and every disk library other than `layout.ts` stay
untouched. No persisted data changes.

## Data / contracts

### Caps (`src/disk/layout.ts`)

```ts
// Frame → chrome pick fields (8d2); 8e reuses them for comments.json.
export const MAX_SELECTOR_CHARS = 1000;
export const MAX_PICK_TEXT_CHARS = 200;
export const MAX_STYLE_VALUE_CHARS = 200;
export const COMMENT_STYLE_KEYS = [
	'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color',
	'padding', 'margin', 'border-radius', 'display', 'width', 'height', 'gap',
] as const;
```

"Chars" means UTF-16 code units (`string.length`) everywhere. `MAX_FRAME_COORDINATE` (100_000) already
exists in `layout.ts`; `point` reuses it unchanged.

### Character checks (`frameMessages.ts`, DOM-free, shared by the runtime and the guard)

- `hasControlChars(value)`: true when `value` contains a `\p{Cc}` control character (C0, DEL and
  C1: newline, carriage return, tab, U+0085) or U+2028 / U+2029 (audit F-43). No lint
  suppression is needed.
- `isSafeStyleValue(value)`: true when `value` has length ≤ `MAX_STYLE_VALUE_CHARS`, has a
  non-space character, and matches `^[\p{L}\p{N}_ #%.,()'"/+-]+$` (`u` flag). Letters and digits
  in any script keep CJK font names, and `+` keeps `calc(100% + 10px)` (audit F-42). The plan
  writes `[\w\s#%.,()'"/-]`; this uses a plain space instead of `\s`, so no newline or tab can
  pass (plan: "control characters or newlines").

### `selector.ts`

- `FINDER_TIMEOUT_MS = 200` (module constant). Finder runs synchronously in the click handler, and
  its default of 1000 ms would freeze the frame. After the timeout, finder returns its
  `:nth-of-type` fallback path.
- `isGeneratedName(name): boolean` is true when `name` starts with one of these framework scoping
  prefixes, case-insensitively: `css-`, `svelte-`, `sc-`, `jsx-`, `emotion-`, `astro-`.
  - Finder's own `idName` / `className` defaults (exported `wordLike`) already reject any name
    that is not letters and hyphens only, has a part of 2 characters or fewer, or has 4+ consonants
    in a row. That covers `css-1x2y3z`, `svelte-abc123` and ids with digits. It does not cover a
    letters-only hash such as `svelte-abcdef`, which this prefix check adds.
  - `ponytail:` comment: prefix list plus finder's word check; hashes without a known prefix and
    letters-only can still pass. Upgrade: entropy scoring.
- `buildSelector(element, timeoutMs = FINDER_TIMEOUT_MS): string | null`. The `timeoutMs`
  parameter is the test seam for the fallback path.
  1. Return `null` when `!element.isConnected`.
  2. Call
     `finder(element, { root: element.ownerDocument as unknown as Element, idName: (n) => idName(n) && !isGeneratedName(n), className: (n) => className(n) && !isGeneratedName(n), timeoutMs })`.
     `idName` and `className` are finder's exported defaults. `attr` and `tagName` keep finder's
     defaults.
  3. If finder throws a `RangeError` (real browsers: class-heavy markup overflows the stack while
     finder expands candidate paths, before its timeout is checked; audit F-40), retry once with
     `timeoutMs: -1`, which takes finder's `:nth-of-type` fallback path directly. Any other throw,
     or a throw on the retry, returns `null`.
  4. If the result is `''`, longer than `MAX_SELECTOR_CHARS`, or `hasControlChars`, return `null`.
     Otherwise return it.
  - The root is the **document**, not `document.body` as the plan says. Finder's `.d.ts` types
    `root` as `Element`, but its `findRootDocument` accepts a Document at runtime
    (`DOCUMENT_NODE` branch). The cast above is the one allowed type escape; give it a short
    comment saying so. Do not pass `document.body`: finder treats a body that is not its own
    default as a scoped root, so a parsed test document would scope uniqueness to its body while
    the live frame scopes it to the whole document. The document gives the same scope in both, and
    matches what 8e's parse5 + css-select will query.
- `textExcerpt(raw: string): string`:
  1. In one pass (`/[\p{Cc}\s]+/gu`), replace each run of control characters and whitespace with
     one space, then trim (audit F-44).
  3. Cut to `MAX_PICK_TEXT_CHARS`. If the cut leaves a lone high surrogate at the end, drop it.
- `readStyles(read: (property: string) => string): CommentStyles`. For each key of
  `COMMENT_STYLE_KEYS` in order:
  1. `raw = read(key)`. Omit the key when `hasControlChars(raw)` (a newline or tab is never
     converted into a space).
  2. Collapse runs of U+0020 to one space (not `\s+`) and trim.
  3. Include the key only when `isSafeStyleValue(value)`; omit it otherwise (empty, oversized, or
     outside the character set).

  Unsafe values are omitted, never stripped, because stripping changes their meaning.
- `describeElement(element, isPage): { selector: string | null; tagName: string; text: string; styles: CommentStyles }`:
  - Page pick (`isPage`): always `{ selector: 'body', tagName: 'body', text: '' }` with styles read
    from `getComputedStyle(element.ownerDocument.body ?? element)`. The whole page's text is noise;
    8e checks page comments by generation, not text. The disconnected rule below does not apply to
    a page pick.
  - Element (`!isPage`): `buildSelector(element)`, `element.localName`, and `textExcerpt` of
    `innerText` for an `HTMLElement` or `textContent ?? ''` otherwise (SVG). Styles come from
    `readStyles((p) => getComputedStyle(element).getPropertyValue(p))`.
  - A disconnected element (`!isPage`) gives `selector: null`, `text: ''` and `styles: {}`;
    `tagName` stays `element.localName`.

`CommentStyles` is `Partial<Record<(typeof COMMENT_STYLE_KEYS)[number], string>>`, exported from
`frameMessages.ts`.

### Pick point

`point` is where the user clicked, in CSS px relative to the top-left of the **current target's**
unclipped border box, clamped into that box. Pins (8f2) follow elements, so the point must be
element-relative. It stays valid on scroll and on parent/child steps. The other pick fields stay
as 8d1 defined them; `rect` remains frame-local CSS px.

- The runtime stores the anchor on a click, after `path = pathAt(...)`:
  `anchor = { element: path[0], offset: { x: event.clientX - box.x, y: event.clientY - box.y } }`,
  where `box` is `path[0].getBoundingClientRect()` (unclipped). `path[0]` is the resolved clicked
  element before any Alt+click promotion, because stepping only appends to `path`. Do not use
  `event.offsetX/Y` (it is relative to the event target, which can differ from `path[0]`). A click
  that picks the page has `path[0]` = `body` (or `documentElement`), so the anchor is that node.
- At each post: `anchorBox` = the anchor element's current unclipped `getBoundingClientRect()` and
  `targetBox` = the current pick's. For a page pick the target box is
  `document.documentElement`'s, the same box 8d1 uses for the page `rect`, so `point` and `rect`
  agree. The page selector `'body'` is only the page target's label for 8e; a page comment is
  located by `point` inside the documentElement box (the "fraction of the frame" in the plan).
- `pointInTarget({ anchorBox, offset, targetBox }): { x, y }` (pure, in `pickTarget.ts`; imports
  `MAX_FRAME_COORDINATE` from `layout.ts`):
  - `x = clamp(anchorBox.x + offset.x - targetBox.x, 0, min(targetBox.width, MAX_FRAME_COORDINATE))`
  - `y = clamp(anchorBox.y + offset.y - targetBox.y, 0, min(targetBox.height, MAX_FRAME_COORDINATE))`

  So a runtime pick can never fail its own guard on a very tall or wide target.
- If the anchor or the target is disconnected, the point is `{ x: 0, y: 0 }`. The rect is `null`
  in that case anyway.

### `cd:pick` (frame → chrome)

```ts
type FramePickMessage = {
	type: 'cd:pick';
	selector: string | null; // null: no unique selector within the cap, or a disconnected target
	tagName: string;
	text: string;
	rect: FrameRect | null;
	point: { x: number; y: number };
	styles: CommentStyles;
	isPage: boolean;
};
```

`parseFramePick` returns `undefined` (the message is dropped) unless every check passes:

- `selector` is `null`, or a string of 1..`MAX_SELECTOR_CHARS` with `!hasControlChars`.
- `tagName`: the 8d1 rule, unchanged (a string of at most 64 chars matching `/^[a-z][a-z0-9-]*$/`).
  Do not edit that branch.
- `text` is a string of 0..`MAX_PICK_TEXT_CHARS` with `!hasControlChars`.
- `rect`: the 8d1 rule, unchanged (`null`, or finite coordinates within `MAX_FRAME_COORDINATE` with
  `width` and `height` ≥ 0). Do not edit that branch.
- `point`: an object whose `x` and `y` are finite, ≥ 0 and ≤ `MAX_FRAME_COORDINATE`.
- `styles`: a non-null, non-array object. Every own key is in `COMMENT_STYLE_KEYS` and every value
  passes `isSafeStyleValue`. One bad key or value rejects the whole message. The runtime never
  produces one, so only a spoof trips it.
- `isPage` is a boolean. When `isPage` is true, `selector` is `'body'` and `tagName` is `'body'`.

The result is rebuilt field by field, so extra fields are dropped and `styles` is copied key by
key.

### Chrome state

`CommentPickState.pick` becomes `({ frameId: string } & Omit<FramePickMessage, 'type'>) | undefined`.
Chrome renders `selector` and `tagName` only as chip text (never `{@html}`, never as a query).

### Rule 02 (replace bullets 5 and 6; `frameMessages.test.ts` pins bullet 5)

```text
5. Messages: artboard:ready, frame:place { id, x, y, width, base: { x, y, width } } (chrome → host, untrusted: `parseChromeMessage`, refused in untrusted workspaces, every attempt answered with one canvas:updated plus artboard:error on failure); canvas:updated (frames carry `generation`)|artboard:error, ui:status (host → chrome). iframe → chrome, allowlisted by source and typed (`parseFrameMessage`): cd:frame-height { height }, cd:frame-wheel { deltaX, deltaY, ctrlKey, x, y }, cd:ready, cd:hover { rect|null }, cd:pick { selector|null, tagName, text, rect|null, point, styles, isPage } (`rect` is frame-local CSS px; `point` is CSS px relative to the current target's border box; chrome drops cd:hover and cd:pick outside Comment mode). Chrome → iframe (runtime accepts only from the parent it captured at load, `parseChromeFrameMessage`): cd:mode { mode: interact|comment }, cd:pick-parent, cd:pick-child.
6. A design's own script can post any cd:* message. Chrome renders frame data as text or geometry only (never `{@html}`). cd:pick text fields are capped (`layout.ts`) and free of control characters; style keys come from `COMMENT_STYLE_KEYS` and values allow only letters, digits, `_`, space and `#%.,()'"/-`. Anything that will reach an Agent prompt is sanitized again first (8h `commentPrompt`).
```

## Testing

Cases marked **Step 1** land in Step 1; cases marked **Step 2** land in Step 2.

### Unit (`vp test`, colocated)

**`selector.test.ts`** (`// @vitest-environment happy-dom`). It parses `fixtures/picking.html`
with `DOMParser`, so scripts do not run. A round trip means
`doc.querySelectorAll(buildSelector(el))` is exactly `[el]`. Cases (**Step 1**):

- Nested sections: the inner section and a paragraph inside it.
- Five identical cards: card #3 round-trips, and the selector does not match cards 1, 2, 4 or 5.
- Scroll box: the 7th list item.
- Duplicate ids: each of the two `#dup` elements round-trips, and neither selector is `#dup`.
- Escaped ids (`1st`, `a:b`, `price.total`): round trip, and the result is not `null`.
- Hash-like names: an element whose only classes are `css-1x2y3z` and `svelte-abcdef` and an
  element with `id="row-123456"`. Each round-trips, and its selector contains none of those names.
  A sibling with a word-like class (`card-title`) uses it.
- SVG: the outer `<svg class="icon-paths">` round-trips.
- Shadow host: attach an open shadow root with a `<p>` to the host in the test, then round-trip
  the host.
- `<template>`: the template's content holds a `.card`, and card #3's selector still round-trips;
  `querySelectorAll` never sees template content.
- Element removed after pick: `el.remove()`, then `buildSelector(el)` is `null`.
- Timeout fallback: with `timeoutMs = -1`, card #3 still round-trips (finder's fallback path). Do
  not assert `:nth-of-type` or `:nth-child` text in the timeout case.
- Finder overflow: a mocked first finder call throws `RangeError`; card #3 still round-trips
  through the `:nth-of-type` retry.
- Over the cap: 70 nested `<div>`s built in the test, with `timeoutMs = -1`, give `null`.
- Script-mutated DOM (feeds 8e):
  1. In a live copy, insert an `<li>` before the second item of `#mutated-list`, as the fixture
     script does.
  2. Take the selector of "Item B" from the live copy.
  3. In a fresh static parse, that selector matches no element, more than one, or one whose text
     is not "Item B".
- `isGeneratedName`: true for `css-1x2y3z`, `SVELTE-abc123`, `sc-bdVaJa`, `jsx-123`, `emotion-x`,
  `astro-ABCDEF`; false for `card-title`, `cssx`, `hero`.
- `textExcerpt`: collapses `\n\t` and runs of spaces, trims, turns `\u0001` into a space, cuts at
  200, and drops a high surrogate split at index 200.
- `readStyles`: returns only allowlisted keys in allowlist order. It omits an empty value, a value
  of 201 chars, `red; background: url(x)`, `a{b}`, `<x>`, a value with an interior newline and a
  value with a trailing newline (`"red\n"`). It collapses `"Inter",   sans-serif` to one space.
- `describeElement`:
  - Page pick: `selector: 'body'`, `tagName: 'body'`, `text: ''`, styles from the body.
  - Element text source: an HTML element uses `innerText`; an SVG element uses `textContent`.
  - Disconnected element (`isPage` false): `selector: null`, `text: ''`, `styles: {}`, `tagName`
    still the element's `localName`.
  - Element with a style: `styles` holds the allowlisted values read through `getComputedStyle`.

Cases (**Step 2**, after `parseFramePick` is extended): the `describeElement` output for card #3
and for a page pick, with `rect: null` and `point: { x: 0, y: 0 }` added, is accepted by
`parseFrameMessage` (the runtime never fails its own guard).

**`frameMessages.test.ts`:**

- **Step 1.** `hasControlChars`: `\u0000`, `\n`, `\u007f` → true; ` ` and `é` → false.
- **Step 1.** `isSafeStyleValue`: `rgb(0, 0, 0)`, `"Inter", system-ui, -apple-system, sans-serif`,
  `color(srgb 1 0 0 / 0.5)` → true; `;`, `{`, `<`, `\t`, `\n`, empty, 201 chars → false.
- **Step 2.** `cd:pick` accepts the full valid shape, `selector: null`, empty `text`, and empty
  `styles`.
- **Step 2.** `cd:pick` rejects:
  - `selector` of 1001 chars, `''`, or containing `\n`, `\r`, `\u0000` or `\u007f`;
  - `text` of 201 chars or containing a newline;
  - a `styles` key outside the allowlist, an unsafe value, an array, or `null`;
  - a `point` that is non-finite, negative, over `MAX_FRAME_COORDINATE`, or missing;
  - `isPage: true` with `selector: '.card'`, with `selector: null`, or with `tagName: 'div'`;
  - the old 8d1 shape without `selector`, `text`, `point` and `styles`.
- **Step 2.** Extra fields, and extra keys inside `point`, are dropped from the result.
- **Step 2.** Selector of exactly 1000 chars and text of exactly 200 are accepted.
- **Step 2.** Rule 02 bullet 5 literal (updated).

**`pickTarget.test.ts`, `pointInTarget`** (**Step 1**):

- Anchor equals target: returns the offset.
- Target is the anchor's parent: the offset shifts by the box delta.
- A point outside the target clamps to 0 and to width/height.
- A target wider or taller than `MAX_FRAME_COORDINATE` clamps to `MAX_FRAME_COORDINATE`.
- A zero-size target gives `{ x: 0, y: 0 }`.

**`commentPick.test.ts`** (**Step 2**): existing cases use the wider pick. A `cd:pick` with
`selector: null` is stored as is.

**`runtime.test.ts`** (**Step 2**): the forbidden-mutation list still passes, and the runtime
string contains finder.

### Fixture (`fixtures/picking.html`, new "Selector traps" section)

Everything must render under the blob CSP, like the existing fixture (no `style=""` attributes and
no inline handlers; scripts and styles get the nonce). Add:

- two `<p id="dup">`;
- elements with `id="1st"`, `id="a:b"` and `id="price.total"`;
- one element whose only classes are `css-1x2y3z svelte-abcdef`, a sibling with
  `class="card-title"`, and one element with `id="row-123456"`;
- one element with the word-like class `ellipsis-chip-check-with-deliberately-verbose-descriptive-class-name`
  (letters and hyphens only, no part of 2 characters or fewer), so its selector is long enough to
  ellipsize the chip (F5 line 8);
- a custom element host `<cd-shadow-host>`, which the fixture script gives an open shadow root
  containing a styled `<p>`;
- a `<template>` holding an `<article class="card">`;
- `<ul id="mutated-list">` with `<li>Item A</li><li>Item B</li><li>Item C</li>`. The fixture
  script inserts `<li>Inserted by script</li>` before Item B.

### F5 (human; Step 3)

1. Comment mode on. Click card #3. The chip shows a selector, and the Webview devtools console in
   that frame's context returns exactly that card from `document.querySelectorAll(<selector>)`.
2. Click an item scrolled into view inside the scroll box. Its selector resolves to that item
   (same devtools check).
3. Click "Item B" in `#mutated-list`. The selector resolves to Item B in the live frame (it may
   differ from the static HTML, which is expected and is 8e's cross-check).
4. Click the `css-1x2y3z svelte-abcdef` element. Neither name appears in the chip.
5. Click the shadow host. The chip shows the host's selector, not anything inside the shadow root.
6. Click empty space at the bottom. The chip shows "Whole frame".
7. Press ↑ on card #3. The chip changes to the parent's selector; ↓ returns to the card's
   selector.
8. Click the element with the long `ellipsis-chip-check-...` class. The selector is ellipsized in
   the chip, and the full text shows as its tooltip.
9. Toggle Comment mode off and on: the chip clears and picking works again.
10. Run the Export Handoff command (Command Palette, or the `export_artboard` tool) and open the
    exported `canvas.html`: frames still render and scroll (finder bundled, inert).

## Notes for the AI

- **Departures from the 0.3 plan, chosen here as reversible internal details** (this spec wins
  where they conflict):
  - The finder root is the document, not `document.body` (see `buildSelector`).
  - `selector` may be `null` instead of always being a string, so a pick is never dropped just
    because no selector fits.
  - Style values use a space, not `\s`.
  - A page pick's text is empty.
  - `point` is element-relative, and for a page pick it is relative to the `documentElement` box
    (the same box as the page `rect`).
  - The generated-name filter is finder's word check plus a prefix list.
  - Selector parse validation is deferred to the host (8e/8f1).
  - The chip shows the selector instead of the tag.
  - Finder 4.0.2's timeout fallback is `:nth-of-type`, but its normal search also emits
    `:nth-child` (audit F-48). 8e's disk match must handle both.

  Flag any of these in review if they look wrong.
- Finder reads the globals `document`, `Node` and `CSS`. They exist in the frame. In tests they
  come from happy-dom (Step 1 check).
- Finder throws when no unique selector is found, or when its candidate matches 0 nodes (a
  detached element), and a real browser throws `RangeError` on class-heavy markup.
  `buildSelector` retries a `RangeError` once on the fallback path and catches every throw. Do not let a throw escape into
  `blockInComment`: the click must still be blocked.
- Keep finder off the scroll path: describe once per click or step, and recompute only `rect` and
  `point` on every post.
- `describeElement` is the only place that calls `getComputedStyle` for styles. `paints` keeps its
  own call (a different job).
- The runtime must still never write to the design DOM. Finder only reads.
- Imports: `selector.ts` imports `finder`, `idName` and `className` from `@medv/finder`, plus
  layout caps and the frameMessages checks. `frameMessages.ts` must stay DOM-free (the root
  tsconfig imports it).
- Every `cd:pick` field from a frame stays untrusted. Chrome shows it only as text.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":32319,"specSha256":"9b8ff490ebaac9b9eec9d3306b39e6eb2c3542497534b2c2100735d44444ee71","branch":"refs/heads/feature/selectors","head":"269a2d73fab3d866acae0bd56a4a88807317dc94","baseRef":"refs/heads/main","baseCommit":"4c6d1b5911fe6b0b315e5fe7d38309c273f452a4","sourceTree":"bf8c0333dd629983cddd417e765851ae54f08874","landing":"local-merge","absentOptional":[]} -->

## Findings

### 8d2/F-40 [P1] closed - buildSelector returns null on class-heavy markup because finder throws RangeError

**File:** src/webview/frame/selector.ts:39
**Found:** 2026-10-24 by /audit (scope: current; lens: quality, tests, performance)
**Why it matters:** Finder 4.0.2 builds every candidate path eagerly (`paths.push(...combinations(stack))`), a product of the "ties" per ancestor (each word-like class, tag, `:nth-of-type`, `:nth-child`, word-like `role`/`data-*`). Past about 120k combinations the spread throws `RangeError: Maximum call stack size exceeded`, and the bare `catch` turns that into `selector: null` (chip text `div (no unique selector)`). Reproduced in headless Chrome with the exact finder options of `buildSelector`: three sibling `<div>`s per level, each with the utility classes `flex items-center justify-between rounded shadow border relative overflow-hidden bg-white text-gray`, target 5 levels below the nearest unique ancestor and deeper, gives RangeError after about 95 ms (depth 3 and 4 succeed). With 10 or 25 word-like classes per element, 8 and 30 levels deep, it also throws (127-179 ms). A Tailwind or utility-class page is the normal case for generated designs, so on those pages a pick of any element a few levels deep has no selector. The timeout does not help: it is only checked between yielded candidates, never inside the eager expansion. The `catch` is bare, so a bug like this is indistinguishable from "no unique selector". No test reaches the catch (the removed-element test returns before finder runs; the timeout test passes `-1`). 8e needs a non-null selector to store a comment, so this blocks the feature's purpose on such pages.
**Suggested fix:** In `buildSelector`, when the first finder call throws, retry once with `timeoutMs: -1` (finder then yields its first candidate after 3 levels and immediately takes the `:nth-of-type` fallback; verified in Chrome: same 8x10, 8x25 and 30x25 cases return a 215-677 char fallback in 1-8 ms). Keep the cap check on the result. Change the catch to `catch (error)` and swallow only after the retry. Add one test with a 6-level chain of 3 siblings each carrying about 10 word-like classes: it must return a selector that round-trips (happy-dom reproduces the RangeError).
**Resolution:** 2026-10-24 /implement (audit repair): `buildSelector` (src/webview/frame/selector.ts) now uses `catch (error)`; on a `RangeError` it retries once via `runFinder(element, -1)` (finder's `:nth-of-type` fallback); any other throw, or a throw on the retry, returns null; cap check unchanged. happy-dom does not reach the overflow (its slow querySelectorAll hits the 200 ms timeout first; probed 6x3x9, 12x3x9, 30x1x25), so `selector.test.ts` mocks the first finder call to throw `RangeError` and asserts card #3 still round-trips with `:nth-of-type(`. The test fails with the retry removed (mutation-checked). Real-browser overflow is agent/F5-test only.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `selector.ts:37-60`. A `RangeError` retries once through `runFinder(element, -1)`; other throws, a retry throw and `timeoutMs < 0` return null; the cap check runs on the result. Probed in headless Chrome 6x3x10, 8x3x25, 30x3x25 and 8x3x45 class-heavy trees with the repaired logic and the real finder 4.0.2: each returns a 173-677 char `:nth-of-type` fallback in 118-220 ms (before the repair: null). The test (`selector.test.ts`, mocked first call) fails if the retry is removed. Residual, tracked as F-55: the retry runs finder's 3-level seed expansion, so about 50 word-like classes on each of three nested elements still overflow (8x3x50 and 8x3x53 return null in Chrome), and the retry-fails and non-RangeError branches have no test. Closed.

### 8d2/F-41 [P2] closed - Finder blocks the frame for up to 200 ms per click and per arrow step

**File:** src/webview/frame/commentPicking.ts:111
**Found:** 2026-10-24 by /audit (scope: current; lens: performance)
**Why it matters:** `describeCurrent` runs finder (plus `innerText` and `getComputedStyle`) synchronously on the click and on every ↑/↓ step, and `FINDER_TIMEOUT_MS` is a soft bound that is only checked between candidates. In headless Chrome, a plain `<div>` tree 12 or more levels deep with 2 siblings per level takes the full 200 ms timeout per element (`html > body:nth-of-type(1) > div...` fallback of 300-890 chars). Walking ↑ through 20 ancestors of such a tree ran finder 20 times: 11 of them at 201 ms, 2.5 s of main-thread blocking in total. Held arrow keys (key repeat is handled, since every `keydown` is processed) or Parent clicks freeze the design frame and the chip for that time. ↓ then recomputes the same selectors it already computed, and a step that cannot move (`stepToParent` at `body`, `stepToChild` at length 1) reruns finder for the unchanged element; the spec requires this ("A step that leaves the path unchanged still recomputes"), but nothing needs it.
**Suggested fix:** Cache `describeElement` results per element for the life of one pick (a `Map<Element, ...>` cleared in the click branch and in `setMode`), so ↓ and repeat steps cost nothing; skip recomputation when the step left the path unchanged. Optionally lower `FINDER_TIMEOUT_MS` (user decision, the spec fixes 200). Changes the spec sentence about unchanged steps; needs the user's yes.
**Resolution:** 2026-10-24 /implement (audit repair): `commentPicking.ts` keeps `descriptions: Map<Element, PickDescription>` per pick, cleared on each click and `cd:mode`. An element already described is not described again, so ↑/↓ over the same path and no-op steps never rerun finder. A step still posts (chrome relies on it). Spec Step 2 sentence replaced. The first visit of each ancestor can still take up to 200 ms (finder's soft timeout).
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `commentPicking.ts:25,113-117,134,180,218`. `descriptions` is a `Map<Element, PickDescription>` reset on click and in `setMode`; `describeCurrent` skips an element already described, so ↑/↓ over a visited path never reruns finder, and scroll/resize re-posts use the map. Closed. New staleness side effect of the cache is F-56.

### 8d2/F-42 [P2] closed - Legitimate computed styles are silently dropped by the style value pattern

**File:** src/webview/frame/frameMessages.ts:97
**Found:** 2026-10-24 by /audit (scope: current; lens: quality)
**Why it matters:** `STYLE_VALUE_PATTERN` is ASCII-only, and a failing value omits the whole key with no marker, so the comment (and the 8h prompt) cannot tell "no style" from "dropped". Checked against headless Chrome `getComputedStyle`: `font-family: "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN W3", Meiryo, sans-serif` is dropped (non-ASCII font names are the default stack on most CJK sites and appear in Cyrillic and Arabic designs too); `"A&B"` and `"Font:Name!"` are dropped; an unresolved `calc(100% + 10px)` (shown for `display: none` or `display: contents` elements) is dropped because of `+`. The Bootstrap system stack is about 190 chars, so one more family exceeds `MAX_STYLE_VALUE_CHARS` and is dropped. `rgb(0 0 0 / 50%)`, `oklch()`, `color-mix()` (computed to `color(srgb ...)`), `var()` fallbacks (resolved), `normal` and `auto` all pass. Rule 02 bullet 6 documents the ASCII set, so this is spec-compliant but loses design fidelity the comment exists to carry.
**Suggested fix:** Allow Unicode letters and digits and `+`: `/^[\p{L}\p{N}_ #%.,()'"/+-]+$/u`. That adds no markup, quote-break or line-break character and is no riskier for prompt text than ASCII letters (still 200 chars). Update rule 02 bullet 6, its test and the `isSafeStyleValue` cases. Changes a documented contract, so it needs the user's decision; alternatively record the ceiling with a `ponytail:` comment in `readStyles`.
**Resolution:** 2026-10-24 /implement (audit repair): `STYLE_VALUE_PATTERN` is `/^(?=.*[^ ])[\p{L}\p{N}_ #%.,()'"/+-]+$/u`: letters and digits in any script (CJK font names) and `+` (`calc(100% + 10px)`). `&`, `:` and `!` stay excluded (rare in font names; `:` would let a value look like prompt structure). Stacks over 200 chars stay dropped. Rule 02 bullet 6 and the spec are updated; tests cover a CJK stack and `calc()`.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `frameMessages.ts:97-102` and probed the pattern in Node 26: the CJK stack, `calc(100% + 10px)`, `rgb(0 0 0 / 50%)` and Arabic-Indic digits pass; `;`, `&`, `:`, bidi override U+202E, tag characters, U+00A0, U+3000 and whitespace-only fail. Length is checked before the regex and the pattern is linear (1e6 chars in 1-2 ms), so no ReDoS. Ceiling kept: combining marks (`\p{M}`, for example decomposed Vietnamese or Indic vowel signs in a font name) are not allowed, so such a value is dropped. Tests cover the CJK stack and `calc()`. Closed.

### 8d2/F-43 [P3] closed - hasControlChars misses C1 controls and Unicode line separators, and adds the repo's first lint suppression

**File:** src/webview/frame/frameMessages.ts:91
**Found:** 2026-10-24 by /audit (scope: current; lens: quality, security)
**Why it matters:** The guard and the runtime treat U+0000-U+001F and U+007F as "control characters" (rule 02 bullet 6, spec "single-line"). U+0080-U+009F (including U+0085 NEL), U+2028 and U+2029 pass in `text` and `selector`, although the rule says text is free of control characters and the plan's goal is a single-line value for the 8h prompt. They are line terminators in several consumers. The regex also needs the first `oxlint-disable` in `src/` (rule 04: "Fix the code, never the rule"), when `/\p{Cc}/u` expresses the same check without a suppression and also covers C1. A whitespace-only style value (`"   "`) also passes `isSafeStyleValue` (the runtime trims, the guard does not), although the spec table lists empty as invalid.
**Suggested fix:** `const CONTROL_CHARS = /[\p{Cc}  ]/u;` (no suppression), add `U+0085` and `U+2028` cases to the `hasControlChars` test, and require `value.trim() !== ''` in `isSafeStyleValue`.
**Resolution:** 2026-10-24 /implement (audit repair): `CONTROL_CHARS` is `/[\p{Cc}\u2028\u2029]/u` (C0, DEL, C1 including U+0085, and the line/paragraph separators). The `oxlint-disable` is gone and lint passes. `isSafeStyleValue` rejects whitespace-only values. Tests cover U+0085, U+009F, U+2028/2029 and `' '`.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `frameMessages.ts:91-95`. `CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u`, no `oxlint-disable` anywhere in `src/` (grep), `isSafeStyleValue` rejects whitespace-only values. Probed: U+0085, U+2028 true; U+200B, U+202E, U+FEFF and tag characters false (by design; 8h sanitizes again). Tests cover U+0085, U+009F, U+2028/2029 and `' '`. Closed.

### 8d2/F-44 [P3] closed - textExcerpt does O(n) per-character work on the whole innerText

**File:** src/webview/frame/selector.ts:49
**Found:** 2026-10-24 by /audit (scope: current; lens: performance)
**Why it matters:** `describeElement` reads `innerText` of the whole picked subtree (forces layout and builds the full string) and `textExcerpt` then runs `Array.from(raw, ...)` (one regex test and one string per code point), `join`, a global replace and only then `slice(0, 200)`. In headless Chrome, a 20,000-paragraph `<main>` (909 KB) cost 83 ms for `innerText` and 23 ms for `textExcerpt`; one regex pass over the same string takes 3 ms. A body-level wrapper (`main`, `#app`) is the common pick target when stepping up, so this lands in the click and in every arrow step (see F-41).
**Suggested fix:** Replace the `Array.from` pass with `raw.replace(/[\p{Cc}\s]+/gu, ' ')` (one pass; control characters and whitespace collapse together), and cut `raw.slice(0, MAX_PICK_TEXT_CHARS * 4)` first, since 200 collapsed characters never need more. `innerText` cost itself stays (spec).
**Resolution:** 2026-10-24 /implement (audit repair): `textExcerpt` is one `/[\p{Cc}\s]+/gu` replace, then trim and slice; no per-character array. `innerText` itself, the larger cost, is unchanged.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `selector.ts:63-73`. `textExcerpt` is one `/[\p{Cc}\s]+/gu` replace, trim, slice and a lone-high-surrogate drop. Probed in Node: 2.2 MB of text with 300k whitespace runs takes 45 ms, a 5 MB single run 3 ms, so it is linear and no longer per-code-point; `innerText` stays the dominant cost. Test covers the surrogate cut. Closed.

### 8d2/F-45 [P3] closed - Several selector and runtime tests cannot fail on the code they name

**File:** src/webview/frame/runtime.test.ts:40
**Found:** 2026-10-24 by /audit (scope: current; lens: tests)
**Why it matters:** (1) The `classList` forbidden-mutation check was narrowed to `classList.add|remove|toggle|replace`; `classList.value = ...`, `className =`, `removeAttribute`, `dataset` and bracket access are not forbidden, so "never writes to the design DOM" is checked less than before. (2) The required-string `getComputedStyle` is now satisfied by `selector.ts` alone, so dropping `paints` would still pass. (3) The `describeElement` SVG case asserts `text === ''` on an `<svg>` with no text, so it cannot tell `textContent` from any other source. (4) The `cd:pick` guard tests never send a non-string `selector`, `text` or style value, or a styles key that is `__proto__` or `constructor`, so removing those `typeof` / allowlist branches passes. (5) The `buildSelector` catch path and the finder default timeout are untested (F-40). (6) Nothing covers `commentPicking.ts` behavior the spec calls out (kept data reused on scroll, finder not run on re-post, reset on `cd:mode`, anchor/point after a step); that is F5-only per rule 09, so it is a known gap, but the F5 step 3 is still unchecked while the spec status is `implemented`.
**Suggested fix:** Add the missing mutators (`classList.value`, `className =`, `removeAttribute`, `dataset`) to the forbidden list, give the SVG case a `<text>` child with content, and add three guard rows: `{ selector: 5 }`, `{ text: 5 }`, `{ styles: JSON.parse('{"__proto__":"x"}') }` (and a numeric style value). Set the spec status back to `in-progress` until step 3 is run, or record why not.
**Resolution:** 2026-10-24 /implement (audit repair): runtime.test.ts also forbids `classList.value`, `className =`, `removeAttribute`, `.dataset` and `innerHTML` (finder uses none), and its `getComputedStyle` required string became `paintsFromStyle({`, which selector.ts cannot satisfy. Guard tests add a non-string selector, text and style value, `__proto__` and `constructor` style keys, and whitespace-only and C1 values. The SVG text case now has a `<title>` and asserts `tiny icon` from textContent. The F-40 test covers the catch path. `commentPicking.ts` behaviour stays agent/F5-test only (rule 09).
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `runtime.test.ts` and `selector.test.ts`. The forbidden list now includes `classList.value`, `className =`, `removeAttribute`, `.dataset`, `innerHTML`; the required string is `paintsFromStyle({`, which only the call in `commentPicking.ts` contains (the definition is `paintsFromStyle = (`); the SVG case needs `<title>` text from `textContent` (happy-dom SVG has no `innerText`); guard rows cover non-string selector/text/style, `__proto__`, `constructor`, whitespace-only and C1 values; the mocked-RangeError test fails without the retry. `vp test` on the touched files: 63 passed. Closed.

### 8d2/F-47 [P3] closed - Chip live region announces a raw CSS selector, and the full selector is mouse-only

**File:** src/webview/Toolbar.svelte:67
**Found:** 2026-10-24 by /audit (scope: current; lens: quality)
**Why it matters:** The chip keeps `aria-live="polite"`, and its text is now the selector (up to 1000 chars), so every pick and arrow step makes a screen reader read something like `html > body:nth-of-type(1) > div:nth-of-type(2) > div ...`. The chip is not focusable and the truncated text is exposed only through `title`, so a keyboard user cannot read the full selector the way a mouse user can. `svelte-autofixer` is clean; this is a design problem, not a lint one. `title` and visible text are identical, so the tooltip adds nothing to the accessibility tree.
**Suggested fix:** Keep the live region short (`Whole frame` or `<tagName>`) and render the selector in a second, non-live, focusable (`tabindex="0"`) element with `title`, or give the live region a bounded `aria-label`. Needs the user's call because the spec fixes the chip text.
**Resolution:** 2026-10-24 /implement (audit repair): the chip is no longer a live region. A visually hidden, always-mounted `aria-live="polite"` span announces `<tag> element selected` or `Whole frame selected`. svelte-autofixer is clean. The full selector is still only in `title` (not keyboard-reachable); 8f1's popover will show the target.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `Toolbar.svelte:30-50,76-77,160-167`. The chip is no longer live; a mounted visually hidden `aria-live="polite"` span announces `<tag> element selected` / `Whole frame selected`, the CSS is the standard clip pattern (1px, `overflow: hidden`, `clip-path: inset(50%)`, `nowrap`) and works as an absolute flex child. Closed. New finding F-54: consecutive picks with the same tag produce an identical string, so nothing is announced.

### 8d2/F-48 [P3] closed - Small owner-catalog and consistency drift in the 8d2 helpers

**File:** src/webview/frame/pickTarget.ts:59
**Found:** 2026-10-24 by /audit (scope: current; lens: quality)
**Why it matters:** (1) `clamp(value, max)` is a third clamp beside `clampNumber` and `clampCoordinate` in `src/webview/stageGeometry.ts` (rule 05: a twin helper is a bug); the frame runtime cannot import `stageGeometry.ts`, so it is a deliberate local copy but it carries no comment saying so. (2) `describeElement` spells `{ selector; tagName; text; styles }` inline and `commentPicking.ts` rebuilds it with `ReturnType<typeof describeElement>`, while `FramePickMessage` already has these four fields (`Pick<FramePickMessage, ...>` would be one definition). (3) The owner-catalog "Disk layout and constants" line in `.claude/rules/05-single-job.md` does not list the new `MAX_*_CHARS` / `COMMENT_STYLE_KEYS` in `layout.ts`, though the rule says to keep it current. (4) `selector.ts` uses the global `getComputedStyle`, `commentPicking.ts` uses `window.getComputedStyle`. (5) The spec note that finder 4.0.2 emits `:nth-of-type` and not `:nth-child` is only true for the timeout fallback: `tie()` also offers `tag:nth-child(n)` (penalty 50), so normal results can contain `:nth-child`, which 8e must handle.
**Suggested fix:** One-line comment on `clamp`, `Pick<FramePickMessage, 'selector' | 'tagName' | 'text' | 'styles'>` as the `describeElement` return type, add the constants to the catalog line, use one `getComputedStyle` spelling, and correct the spec note for 8e.
**Resolution:** 2026-10-24 /implement (audit repair): `pointInTarget` uses `clampNumber`, now exported from `stageGeometry.ts` (no third clamp). `PickDescription = Pick<FramePickMessage, 'selector' | 'tagName' | 'text' | 'styles'>` replaces the re-spelled return type. selector.ts uses `window.getComputedStyle` throughout. The rule 05 layout line lists the new caps. The spec now says finder emits both `:nth-child` and `:nth-of-type`; 8e must handle both.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read the five points. (1) `pointInTarget` uses `clampNumber`, exported from `stageGeometry.ts` (no third clamp); (2) `PickDescription = Pick<FramePickMessage, ...>` is used by `commentPicking.ts`; (3) rule 05 layout and Picking lines list the caps, `pointInTarget` and the selector helpers (checked in the file); (4) `selector.ts` uses `window.getComputedStyle` throughout; (5) the spec note names both `:nth-child` and `:nth-of-type`. `pnpm knip` is clean. Closed. Side effect of (1) is F-57.

### 8d2/F-49 [P3] closed - A throw inside describeCurrent leaves path and described out of sync

**File:** src/webview/frame/commentPicking.ts:212
**Found:** 2026-10-24 by /audit (scope: current; lens: quality)
**Why it matters:** The spec says a throw from describing "must never escape" the click handler. Only the finder call is guarded. In the click branch `path` and `anchorOffset` are assigned before `describeCurrent()`; if `getComputedStyle`, `innerText` or the style reads ever threw, the exception would escape the listener (the click is still blocked, since blocking now happens first), `window.focus()` would be skipped and `described` would keep the previous pick, so the next scroll re-post would pair the old selector, text and styles with the new element's rect. No such throw was found in Chrome probes, so this is a lead, not a defect.
**Suggested fix:** Compute `const next = describeCurrent-result` first and assign `path`, `anchorOffset` and `described` together, or wrap the call and fall back to a null-selector description. Skip if the user accepts the ceiling.
**Resolution:** 2026-10-24 /implement (audit repair): `describeCurrent` stores into the per-pick map only after `describeElement` returns. `postPick` looks up the current element and sends nothing without an entry, so a throw can never post another element's data.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `commentPicking.ts:113-117,130-150`. The map entry is written only after `describeElement` returns, and `postPick` sends nothing without an entry, so a throw can no longer pair the previous pick's data with the new element's rect. The original defect is gone. Residual (not a regression, no throw found in probes): a throw still propagates out of the click listener after `path` changed, so chrome keeps showing the previous pick until the next step. Closed.

### 8d2/F-50 [P3] closed - pnpm-lock.yaml churn beyond the finder entry

**File:** pnpm-lock.yaml:1
**Found:** 2026-10-24 by /audit (scope: current; lens: quality)
**Why it matters:** The lockfile diff adds `@medv/finder@4.0.2` (expected), but also rewrites peer ids for `@sveltejs/vite-plugin-svelte`, `@vitest/browser`, `@vitest/browser-preview`, `@vitest/mocker` and `vitefu`, drops their `transitivePeerDependencies` lists and adds a `vite` peer entry. That comes from adding the dependency with `--store-dir .pnpm-store` under pnpm 11.24 (no `packageManager` pin). CI runs `pnpm install --frozen-lockfile`; this audit did not run an install (no installs allowed), so whether CI accepts the rewritten peer graph, and whether it resolves the same packages, is unproven. `.pnpm-store` is gitignored, so no stray files.
**Suggested fix:** Regenerate the lockfile with a plain `pnpm install` (default store) after reverting `pnpm-lock.yaml`, and keep only the finder lines unless the peer-id change is wanted; confirm `pnpm install --frozen-lockfile` passes locally.
**Resolution:** 2026-10-24 /implement (audit repair): not regenerated. `pnpm install --frozen-lockfile` (pnpm 11.24, `--store-dir .pnpm-store`) exits 0, and `npx pnpm@12 install --lockfile-only` (CI pins pnpm 12; resolved 12.15.0) reports "Already up to date" and leaves the file unchanged. The peer-id rewrite is the current pnpm format, not store-dir noise. Ready to close on re-audit.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) lockfile evidence holds: `pnpm-lock.yaml:21-23,293,2339` carry `@medv/finder` 4.0.2 with integrity and the importer specifier matches `package.json:47`; the rest of the diff only rewrites peer-id suffixes for the same package versions. `pnpm install --frozen-lockfile --lockfile-only --offline` (pnpm 11.24.0) printed "Already up to date" and left the file byte-identical; the earlier repair recorded the same result under CI's pnpm 12 (`.github/workflows/verify.yml:17`), which this pass did not re-run (no network, no installs). Closed.

### 8d2/F-51 [P1] closed - Frames reload in a loop (flicker, wheel and zoom cut off mid-gesture)

**File:** src/webview/Frame.svelte:44
**Found:** 2026-10-25 by F5 (user) and /debug (8d2 branch; present on `main` since 8b)
**Why it matters:** Stage renders `Frame` from a keyed `{#each}` whose props compile to getters on the frame record, so reading `id` or `html` inside `Frame` subscribed to the whole record. App replaces the record on every height report (`applyFrameHeight`), drag preview and `canvas:updated`, so the blob effect re-ran, set a new blob URL and reloaded the document, whose runtime then re-posted `cd:frame-height`: a self-sustaining loop (harness: about 8 reloads per second per frame from a single `canvas:updated`, same on a `main` build). Each reload dropped the in-flight wheel forwarding and repainted the frame.
**Suggested fix:** Read `id` and `html` through `$derived` copies so the effect only re-runs when the string changes.
**Resolution:** 2026-10-25 /debug: `const frameId = $derived(id); const frameHtml = $derived(html);` used by the attachment, the blob effect and the callbacks. Harness on the rebuilt bundle: 3 loads then none; an identical `canvas:updated` reloads nothing; changing one frame's html reloads only that frame. No unit test (rules 08/09 exclude components; `vp test` cannot compile `.svelte`); the 8d3 Playwright suite owns the regression test. User confirmed in Cursor F5 (no flicker, zoom works).
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read `Frame.svelte:40-70` and its callers. `frameId`/`frameHtml` are `$derived` copies, derived equality is `===`, so the blob effect re-runs only when the html string changes. The other effect inputs cannot carry the record getter: `nonce` is a primitive `$state` in App passed through two prop getters (a repeat of the same string does not notify), `runtimeSource` is a constant import, `onRenderError` is read only on the error path. Grep of `Stage.svelte`, `Overlay.svelte`, `Toolbar.svelte`: no other component runs an effect or attachment over a record prop (Stage's `{#each}` uses `frame.*` only in attributes and handlers, its attachments read props at event time). No regression test exists (rules 08/09 exclude components); the 8d3 Playwright suite owns it. `pnpm verify` green. Closed.

### 8d2/F-52 [P2] closed - Trackpad pan that starts over a frame stops when the frame leaves the pointer

**File:** src/webview/App.svelte
**Found:** 2026-10-25 by F5 (user) and /debug (present on `main`)
**Why it matters:** Chromium latches a scroll gesture to the out-of-process sandboxed frame where it starts. When panning slides that frame from under the pointer, neither the frame nor the chrome gets more wheel events; the remainder bubbles as native scroll of the chrome root, which could not scroll, so it was lost (harness: 98.5 of 600 px). Proven with frame process isolation on vs off (`--disable-features=IsolateSandboxedIframes` panned the full 600 px).
**Suggested fix:** Absorb root scroll as pan (fix option 1, approved by the user).
**Resolution:** 2026-10-25 /debug: the chrome is pinned (`#svelte-root` `position: fixed`) over a 10,000 px hidden-scrollbar page; `scrollSinkStep` (`frameGesture.ts`, regression test mutation-checked three ways) turns each root scroll into a pan through `panStage`, then re-centres, only within 1 s of a `cd:frame-wheel` or an earlier sink pan, so keyboard scrolling never pans. Harness: inside-frame gesture 600.1 of 600 px; empty-stage and gap gestures unchanged at 600 px; zoom, Tab reveal, label nudge and pick outlines identical. `ponytail:` ceiling: a mid-gesture pause over 1 s after leaving the frame ends the pan; a toolbar wheel within 1 s of a frame pan also pans. User confirmed in Cursor F5. 2026-10-25 /implement (audit repair): the follow-up defect the re-audit found (F-53, unbounded jump pans) is fixed; ready to close on re-review.
2026-10-25 /audit (scope: current; lens: quality, security, performance, tests) re-read App.svelte, `frameGesture.ts:270-307` and probed the sink logic replica in headless Chrome over CDP (real `Input.dispatchMouseEvent` wheel, DPR 1, 1.25 and 2): 60 armed wheel events of (3.3, 7.3) pan exactly (198, 438) with no drift, two scroll events per pan (the re-centre scroll reads as zero), rest re-reads exactly at fractional DPR, a wheel 1.3 s after the last gesture pans 0, `focus()` and `scrollIntoView()` of an off-screen label inside the fixed root do not scroll the root. The original defect (pan stops when the frame leaves the pointer) is repaired. NOT closed: the repair introduces F-53 (a large root scroll inside the 1 s window pans by thousands of px: End +5000, Home -5000, PageDown/Space +560, ArrowDown +40, all reproduced). Stays `fixed`; re-review after F-53.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests) re-read App.svelte (sink state, `handleSinkScroll`, keydown reset, `onresize` re-centre, body sizing from `SCROLL_SINK_ROOM`, fixed `#svelte-root`) and `frameGesture.ts` `scrollSinkStep`. Pan sign matches `panStage` and Stage's drag pan; Stage's wheel listener is non-passive with `preventDefault`, so stage wheels never also scroll the root. Repair present, F-53 follow-up repaired. No F5 run in this pass (user F5 confirmation recorded above). Closed.

### 8d2/F-53 [P2] closed - Scroll sink pans by thousands of px on a non-gesture root scroll or a reset scroll position

**File:** src/webview/frameGesture.ts:307
**Found:** 2026-10-25 by /audit (scope: current; lens: quality, tests)
**Why it matters:** `scrollSinkStep` trusts any offset from the stored rest point as a pan once a frame wheel or earlier sink pan happened in the last second, with no upper bound. Replicated the App.svelte logic in headless Chrome (CDP wheel and key events, DPR 1, 1.25, 2): with the gesture window armed, End pans +5000, Home -5000, PageDown and Space +560, ArrowDown +40 (focus in the chrome body, or in a frame whose scroll chains out). The root was not scrollable before this branch, so those keys used to do nothing. Same defect when the root offset is reset behind the sink's back: probe shows an iframe document set to `display: none` and shown again reports `scrollY` 0 and is not restored; the stored rest stays 5000, so the next armed scroll event pans by about -5000 and the next scroll up is lost (it cannot scroll above 0). `clampStageView` limits the damage to "view jumps to the stage edge" (recover with Fit), so not data loss. The trigger needs a key or a reset within 1 s of a pan, and whether Cursor hides a webview with `display: none` (rather than `visibility`) is unverified. Also `recentreScrollSink()` runs once at App init; if the webview loads while hidden (layout absent), the rest point is 0 and the first gesture upward or left is lost.
**Suggested fix:** In `scrollSinkStep`, treat an offset larger than a real frame's worth as a reset: `Math.abs(deltaX) > SCROLL_SINK_ROOM / 4 || Math.abs(deltaY) > SCROLL_SINK_ROOM / 4` returns `{ recentre: true, pan: undefined }` (a trackpad event never moves 2500 px). Add `onresize={recentreScrollSink}` to the `<svelte:window>` so a show after hide restores the centre. Add one `scrollSinkStep` case for a 5000 px jump inside the window (it must not pan). No requirement lost.
**Resolution:** 2026-10-25 /implement (audit repair): `scrollSinkStep` pans only when both offsets are at most `SCROLL_SINK_ROOM / 4` (2500 px); a larger jump (End/Home, a scroll position reset by a hidden-then-shown webview, a lost rest point) re-centres without panning. `App.svelte` re-centres on window `resize` (covers a webview loaded while hidden) and a chrome `keydown` ends the gesture window, so PageDown/Space/arrows with chrome focus never pan. The `frameGesture.test.ts` sink test adds a 9999.5 and a 0 scroll inside the window (fails with the cap removed, mutation-checked). Ceiling kept: a key pressed inside a focused Interact-mode frame within 1 s of a frame wheel can still pan by its small scroll step (keydown never reaches the chrome).
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): `scrollSinkStep` pans only when both offsets are at most `SCROLL_SINK_MAX_STEP` (2500 px) and within 1 s; the 9999.5 and 0 cases in `frameGesture.test.ts` fail without the cap. `onresize={recentreScrollSink}` and the keydown reset are wired in App.svelte. Remaining ceiling is documented in the `ponytail:` comment. Closed.

### 8d2/F-54 [P3] closed - Consecutive picks of the same tag are never announced

**File:** src/webview/Toolbar.svelte:43
**Found:** 2026-10-25 by /audit (scope: current; lens: quality)
**Why it matters:** F-47's repair announces `<tag> element selected`. A live region announces on a DOM change, and Svelte skips the write when the string is equal. Picking one `div`, then another `div`, or pressing ↑ from a `div` to its `div` parent, produces the identical text, so a screen reader says nothing for the second pick. Only a change of tag, or leaving and re-entering Comment mode, is announced. Not backed by a screen-reader run.
**Suggested fix:** Make each pick's string differ, for example append the parent step count or a short structural hint (`div element selected, level 3`), or key the span (`{#key pickSerial}`) so it is re-created per pick. Check with VoiceOver at F5 first.
**Resolution:** 2026-10-25 /implement (audit repair): `applyPickMessage` stores `pick.sequence` (1, 2, ... since the last reset); Toolbar's announcement appends a no-break space on even picks, so two equal announcements in a row still differ and both speak. `commentPick.test.ts` asserts the sequence increments. VoiceOver not run.
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): `applyPickMessage` increments `sequence` from the previous pick (reset with the pick on mode toggle), Toolbar's `pickAnnouncement` alternates a trailing no-break space by parity, the live region stays mounted. `commentPick.test.ts` asserts 2 then 3. VoiceOver still not run (residual risk only). Closed.

### 8d2/F-55 [P3] closed - The RangeError retry can overflow too, and its failure branches have no test

**File:** src/webview/frame/selector.ts:56
**Found:** 2026-10-25 by /audit (scope: current; lens: quality, tests)
**Why it matters:** The retry (`timeoutMs: -1`) still runs finder's seed expansion of the three innermost levels before it yields its first candidate. Probed in Chrome with the real finder: three nested elements with about 50 word-like classes each (`8x3x50`, `8x3x53`) still throw `RangeError` in the retry and the pick gets `selector: null`; with 45 classes the retry works (215 chars, 201 ms total). Rare in practice (Tailwind-style names with digits or colons are not word-like), but the null is indistinguishable from "no unique selector", and every other throw (including finder's own "Can't select any node" error) is swallowed silently with no log (rule 06 asks for a `ponytail:` comment on a deliberate silent path; the comment here does not name the ceiling). No test covers the retry-also-throws branch or the non-RangeError no-retry branch. The worst case runs finder twice in one click (about 2x the 200 ms bound).
**Suggested fix:** Skip finder on the retry: build the `:nth-of-type` path directly (about 8 lines walking `parentElement`, same output as finder's fallback), which cannot overflow, and add a `ponytail:` comment naming the ceiling on the silent null. Add one test where the mocked finder throws a non-RangeError and expect `null` with a single call. Or accept the ceiling in writing.
**Resolution:** 2026-10-25 /implement (audit repair): On a finder `RangeError`, `buildSelector` no longer calls finder again; `nthOfTypePath` builds finder's `:nth-of-type` fallback path directly (linear, no candidate expansion). Any other finder throw returns null under a `ponytail:` comment naming the silent path. The mocked test makes every finder call throw: `RangeError` round-trips card #3 (`html > body:nth-of-type(1) > ... article:nth-of-type(3)`) and the svg; a plain `Error` gives null. It fails with the fallback removed (mutation-checked).
2026-10-25 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests): `buildSelector` builds `nthOfTypePath` directly on `RangeError` (linear walk to `html`, unique by construction, then the shared cap/control-char check); other throws return null under a `ponytail:` comment. `selector.test.ts` covers the RangeError round trip (card #3, svg) and the plain-Error null. Closed. The approved spec text still describes the finder retry; tracked as F-58.

## Independent review

**Status:** passed
**Target commit:** 269a2d73fab3d866acae0bd56a4a88807317dc94
**Base commit:** 4c6d1b5911fe6b0b315e5fe7d38309c273f452a4
**Base ref:** main
**Spec hash:** 9b8ff490ebaac9b9eec9d3306b39e6eb2c3542497534b2c2100735d44444ee71
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-10-25T14:49:02Z
**Workflow:** regular
**Check required:** no

### Handoff

Review the active spec and the complete `4c6d1b5911fe6b0b315e5fe7d38309c273f452a4..269a2d73fab3d866acae0bd56a4a88807317dc94` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-10-25T14:53:00Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `git rev-parse HEAD`: pass (equals Target commit)
- `git merge-base main HEAD`: pass (equals Base commit)
- `shasum -a 256 blueprint/context/current-feature.md`: pass (equals Spec hash)
- `git status --short`: pass (only `blueprint/context/review.md` differed before review)
- `pnpm verify`: pass (exit 0; 28 test files, 306 tests; svelte-check, webview tests tsc, pack and webview build green)
- `pnpm knip`: pass (exit 0, no issues)

### Evidence

- Full delta reviewed (28 files): `selector.ts` (+ test), `frameMessages.ts` guards (+ test), `pickTarget.ts` `pointInTarget` (+ test), `commentPicking.ts` describe cache, anchor and block-before-pick ordering, `commentPick.ts` (+ test), `Toolbar.svelte`, `App.svelte` scroll sink, `Frame.svelte` `$derived` fix, `frameGesture.ts` `scrollSinkStep` (+ test), `stageGeometry.ts` export, `layout.ts` caps, `runtime.test.ts`, fixture, rules 02 and 05, system map, package.json and lockfile.
- Security: every `cd:pick` field is guarded field by field in `parseFramePick` (selector and text capped and control-char free, styles allowlisted by key with a closed character set, `__proto__`/`constructor` keys rejected, point bounded, page label fixed); chrome renders selector only as text and `title` (Svelte-escaped), never `{@html}` or a query. Runtime still never writes the design DOM (forbidden-mutation list passes with finder bundled).
- Performance: finder runs once per element per click/step (cache), never on scroll or resize re-posts; `nthOfTypePath` fallback is linear; sink does one `scrollTo` per root scroll event.
- F-51: `$derived` copies of `id`/`html` only notify on string change; other effect inputs are primitives or constants.
- F-52/F-53: pan sign matches `panStage` and Stage's drag pan; Stage's wheel listener prevents default, so stage wheels never also scroll the root.
- Export (F-28 handoff data): `handoffCanvasHtml.test.ts.snap` grows from 64,556 to 115,736 bytes (+51,180 bytes; +1577/-28 lines), finder bundled unminified in the inert runtime.
- Ledger: F-52, F-53, F-54, F-55 closed after re-examination; F-56, F-57 stay `fixed` (unrepaired parts lack a user acceptance); F-58 added.

### Findings

- F-58 [P3] open: active spec text still describes the pre-repair `buildSelector` finder retry, the old Toolbar pick prop shape and the runtime-only snapshot rule (`blueprint/context/current-feature.md:240`, `:124`, `:144`).
- No P0 or P1 finding is open or fixed.

### Remaining risk

- No Cursor F5 or browser run in this review (Check not required); the scroll sink, frame reload fix and chip ellipsis rely on the user's recorded F5 confirmation and the builder's harness. The 8d3 Playwright suite owns those regressions.
- Screen-reader announcement of consecutive equal picks (F-54) not verified with VoiceOver.
- Runtime picking glue (`commentPicking.ts` cache and anchor) has no behavioral unit test by rule 09 design; only string checks in `runtime.test.ts`.
- Style data can stay stale after a frame resize in Comment mode until 8f1 (F-56).

## Try it now

1. `cp fixtures/picking.html fixtures/dev-workspace/.cursor-design/artboards/picking.html`, run `pnpm compile`, then F5 (Run Extension) and open the artboard.
2. Watch the frames for ten seconds: no flicker (F-51).
3. Start a two-finger trackpad pan with the pointer near a frame's edge so the frame slides away: the pan keeps going to the end (F-52). Pinch over a frame zooms all the way.
4. Click **Comment**, then card 3 in the `picking` frame: the chip shows a selector (for example `article:nth-of-type(3)`); in the frame's devtools console `document.querySelectorAll(<selector>)` returns only that card.
5. Press ↑: the chip shows the parent's selector; ↓ returns to the card. Click empty space: the chip shows "Whole frame".
