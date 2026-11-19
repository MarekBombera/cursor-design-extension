# Feature: Edit mode + selection

**From build-plan:** feature 9d
**Build attempt:** 1
**Branch:** feature/edit-mode-selection
**Status:** verified

## Goal

Give the panel an Edit mode next to Interact and Comment. In Edit mode the 0.3 picker picks an
element (click, Alt+click, ↑ / ↓, parent / child buttons) and the frame reports what the edit
core needs to know about it: its source number, its full text, whether it holds anything other
than one text node, and its `style` attribute as the live page holds it. A small inspector, shown
only in Edit mode, fills its fields from that report (the inline value as typed, the computed
value as placeholder) and keeps them disabled (9e enables them and saves). Elements the file
can't place read "not editable"; mixed content shows the "ask the Agent" hint instead of a text
field. Nothing is written to disk and no chrome → host message is added.

Source of truth: Notion 0.4 Decisions (https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d),
read 2026-11-19, and build-plan item 9d. Shipped code wins where they differ (Notion callout).
Reviewed by Breaker (Opus 5.5) and Literalist (Sonnet 5.5); this is the post-review spec.

## In scope

- `FrameMode` gains `'edit'`. The chrome holds one `mode: FrameMode` instead of
  `commentMode: boolean`; every live frame gets `cd:mode {mode}` on each change and on `cd:ready`.
- The frame runtime's picker (`commentPicking.ts`) blocks the design's input, hovers and picks in
  Comment **and** Edit mode (same events, same keys, same re-posts). In Edit mode each `cd:pick`
  carries a new `edit` object (Data / contracts); in Comment mode it never does.
- New frame module `src/webview/frame/editTarget.ts` (`describeEditTarget`), DOM reads only and
  kept small: the exported `canvas.html` embeds the runtime. A runtime size budget in
  `runtime.test.ts`; its "never touches the artboard" forbidden list stays as it is.
- Chrome guard for `edit` in `parseFrameMessage`; `parseChromeFrameMessage` accepts
  `cd:mode {edit}`. One acceptance rule (`pickCounts`) decides whether a `cd:hover` / `cd:pick`
  counts in the current mode, for the pick state and the comment draft alike.
- Toolbar mode group: Interact, Edit, Comment (toggle buttons in the existing "Mode" group).
  Stage mode hint for Edit mode. Escape leaves Edit mode; `C` from Edit mode goes to Comment mode.
- Edit mode survives a tab switch (webview state key `mode` replaces `commentMode`); the pick
  does not.
- Inspector: new pure rules `src/webview/editInspector.ts` and view `src/webview/Inspector.svelte`,
  rendered only in Edit mode at the right edge of the workspace. Fields filled and disabled.
  Parent / child buttons step the pick. Leaving Edit mode with focus inside it moves focus to the
  stage viewport.
- `theme.css`: global text-`input` rules matching `textarea`, the disabled look for both, the
  `--cd-inspector-w` token; an `edit` icon in `icons.ts`.
- Constants moved to or added in `src/disk/layout.ts` so the frame and chrome bundles never import
  parse5: `SOURCE_TAG_ATTRIBUTE` (from `sourceTags.ts`), `RAW_TEXT_ELEMENTS` (from
  `artboardEdit.ts`'s `RAW_TEXT_NAMES`), new `VOID_ELEMENTS`, `EDIT_STYLE_FIELDS` (`EDIT_FIELDS`
  built from it) and `MAX_PICK_STYLE_CHARS`.
- Browser spec `tests/browser/editMode.spec.ts` with fixture `fixtures/edit.html`; harness
  locators; gallery states for the inspector and the Edit-pressed toolbar.
- Rule 02 (cd:mode, cd:pick, the acceptance rule), rule 05 owner catalog. No Agent skill change.

Unchanged in Edit mode (stated so nobody "fixes" them): pins stay visible and clickable (a pin
click opens its thread, as in every mode); an open thread stays open; the comments panel and its
toggle are unchanged; the hover and pick outlines draw from the same picker state as in Comment
mode (`Overlay` unchanged).

## Out of scope

- Enabling fields, live preview, saving, `artboard:edit` sender, adopting `artboard:edited` (9e).
- Undo / redo buttons and history (9f).
- Mode switch opening a panel (0.4.1). An `E` shortcut (not in the plan).
- Restoring the edit pick after a tab switch or a frame reload.
- Renaming `commentPick.ts`, `CommentPicker`, `commentPicking.ts`, `installCommentPicking` or the
  `'toggle'` mode-key action (they now serve both modes; a rename is churn with no behavior).
- System map edits (shipped flows only; `/complete` merges this feature's flows).
- Classes, style blocks, border, per-side spacing, alpha colours (0.4 out of scope).

## Build loop

`workflow.stepReview` is `feature`: build all steps, run `pnpm verify` after each step, present
one review at the end (it lists the reversible choices in Notes once). `workflow.checkpointCommits`
is `disabled`: no commits until `/complete`. Every `.svelte` / `.svelte.ts` edit follows rule 08
(Svelte MCP docs first, `svelte-autofixer` until clean). Run `pnpm test:browser` after steps 3, 4
and 5.

## Build steps

- [x] **1. Shared constants and the frame contract.**
  - `src/disk/layout.ts`: add `EDIT_STYLE_FIELDS = ['font-size', 'color', 'padding', 'margin'] as const`
    and rebuild `EDIT_FIELDS = ['text', ...EDIT_STYLE_FIELDS] as const` (same order and values as
    today). Move `SOURCE_TAG_ATTRIBUTE` here from `sourceTags.ts`, and `RAW_TEXT_NAMES` from
    `artboardEdit.ts` as `RAW_TEXT_ELEMENTS` (`iframe`, `noembed`, `noframes`, `noscript`, `xmp`,
    `plaintext`). Add `VOID_ELEMENTS` (`area`, `base`, `br`, `col`, `embed`, `hr`, `img`,
    `input`, `link`, `meta`, `source`, `track`, `wbr`) and `MAX_PICK_STYLE_CHARS = 5000`. Update
    every import (`sourceTags.ts`, `artboardEdit.ts`, `sourceTags.test.ts`,
    `commentTarget.roundtrip.test.ts`); no re-export barrel.
  - `src/webview/frame/frameMessages.ts`: `FrameMode = 'interact' | 'comment' | 'edit'`;
    `parseChromeFrameMessage` accepts `cd:mode {mode: 'edit'}`. New exported types
    `EditStyleField` and `PickEditFields` (Data / contracts); `FramePickMessage` gains
    `edit?: PickEditFields`. `parseFramePick` parses `record.edit` when it is not `undefined`
    with a new `parsePickEdit` (any guard failure rejects the whole message) and rebuilds it.
    `parsePickFields` keeps its checks; its return type becomes
    `Omit<FramePickMessage, 'type' | 'repost' | 'edit'>` (the saved comment draft never carries
    `edit`).
  - The `handoffCanvasHtml` snapshot embeds the runtime: update it on purpose (Vitest `-u` on
    `src/disk/handoffCanvasHtml.test.ts`) and check the diff touches only runtime code.
  - Done when: `frameMessages.test.ts` covers `cd:mode {edit}` accepted and `{mode: 'Edit'}`
    rejected; a `cd:pick` with a valid `edit` round-trips rebuilt (an extra key inside `edit` is
    dropped); each guard in Data / contracts rejects the message (`sourceNumber` -1, 1.5, '3',
    `MAX_SAFE_INTEGER + 1`; `sharedNumber: true` with a null number; unknown `textState`;
    non-empty `text` with `'children'`; `text` of `MAX_EDIT_TEXT_CHARS + 1`; `style` a number or
    `MAX_PICK_STYLE_CHARS + 1` chars); a `style` with a newline is accepted; a `cd:pick` without
    `edit` still parses unchanged; `sourceTags` and `artboardEdit` tests pass untouched apart
    from imports; `pnpm verify` green.

- [x] **2. The frame picks in Edit mode.**
  - New `src/webview/frame/editTarget.ts`: `describeEditTarget(element: Element): PickEditFields`
    per Data / contracts. Reads only through `getAttribute(SOURCE_TAG_ATTRIBUTE)`,
    `getAttribute('style')`, `childNodes`, `nodeType`, `data` and
    `ownerDocument.querySelectorAll`. Never `.style`, `.dataset` or any setter: the runtime
    test's forbidden list (`'.style'`, `'.dataset'`, `setAttribute`, ...) stays unchanged and must
    keep passing. Imports only from `../../disk/layout` and `./frameMessages` (never
    `sourceTags.ts` or `artboardEdit.ts`: they pull parse5 into the runtime).
  - `commentPicking.ts`: every `mode !== 'comment'` gate becomes `mode === 'interact'`: the
    blocking listener, `updateHover`, `pointermove`, `mouseout`, `repostFrame` and `repostRects`.
    One local `describe(element)` replaces both `describeElement(current, isRoot(current))`
    calls: in Edit mode it returns
    `{ ...describeElement(element, isRoot(element)), edit: describeEditTarget(isRoot(element) ? document.body ?? element : element) }`,
    otherwise `describeElement(...)` alone. `PickDescription` (in `selector.ts`) gains
    `edit?: PickEditFields`. Rename `blockInComment` to `blockWhilePicking`; the header comment
    says the picker serves Comment and Edit mode.
  - `runtime.test.ts`: assert `runtimeSource.length` stays under a named budget constant: the
    length measured at the start of this step (after step 1) plus 4,096. `ponytail:` comment: a
    soft ceiling for the exported `canvas.html`; a toolchain bump that changes the unminified
    output may need a re-baseline. The step review records both numbers.
  - Update the `handoffCanvasHtml` snapshot on purpose again (runtime code only).
  - Done when: `runtime.test.ts` passes with the budget and the unchanged forbidden list;
    `pnpm verify` green (no chrome sends `cd:mode {edit}` yet, so behavior is unchanged; step 5
    proves the frame side in Chromium).

- [x] **3. Chrome Edit mode.**
  - `commentPick.ts`: `CommentPickState.commentMode: boolean` → `mode: FrameMode`;
    `INITIAL_COMMENT_PICK.mode = 'interact'`.
    - Replace `toggleCommentMode` with `chooseMode({ mode, frameIds })`: clears hover and pick and
      sends `cd:mode {mode}` to every frame id. Its one caller, `CommentPicker.#setMode`, skips
      the same mode (refactor review: one guard, not two).
    - Add `pressedMode(current, pressed)`: `pressed === current ? 'interact' : pressed`.
    - Add `pickCounts({ mode, message })` for `cd:hover` / `cd:pick`: false in Interact mode; a
      `cd:pick` with `edit` counts only in Edit mode, one without only in Comment mode; a
      `cd:hover` counts in Comment and Edit mode.
    - `applyPickMessage`: `cd:ready` sends `cd:mode {state.mode}`; a `cd:hover` / `cd:pick` for
      which `pickCounts` is false returns `{ state, sends: [] }`; the previous frame's reset and
      `clearPick` send `cd:mode {state.mode}`.
    - `keepLiveFrames`: an empty stage sets `mode: 'interact'`.
    - `modeKeyAction`: input `commentMode` → `mode`; `C` → `'toggle'` (when frames exist; it
      means "press Comment": `pressedMode(mode, 'comment')`), Escape → `'exit'` when
      `mode !== 'interact'`; the popover rule is unchanged.
  - `commentPicker.svelte.ts`:
    - Constructor param `commentMode: boolean` → `mode: FrameMode`; `App.svelte` passes
      `savedCommentUi.mode`.
    - One private `#setMode(next: FrameMode)` is the only path that changes the mode
      (`handleChooseMode(pressed)` = `#setMode(pressedMode(mode, pressed))`, mode key `'toggle'` =
      `handleChooseMode('comment')`, `'exit'` = `#setMode('interact')`). It does nothing when
      `next` equals the current mode. Otherwise it drops the draft and the held draft, applies
      `chooseMode`, and, when leaving Edit mode while `document.activeElement` is inside
      `[data-cd-inspector]`, first calls `this.#pinThread.stage?.focusViewport()`.
    - `keepLiveState` applies the same focus check before `keepLiveFrames` takes an empty stage
      out of Edit mode. Stage is hidden then, so `focusViewport` cannot take focus and focus falls
      to `body` (accepted: no frame means no stage to focus, and the mode buttons are disabled).
    - `handlePickMessage` opens or retargets the draft only when `mode === 'comment'` and
      `pickCounts` accepts the message (the same verdict `applyPickMessage` uses).
    - `keepLiveDraft` / `resolveHeldDraft` get `commentMode: picking.mode === 'comment'` (their
      signatures stay).
  - Webview state: `SavedCommentUi.commentMode` → `mode: FrameMode`. `parseSavedCommentUi` reads
    `record.mode`: `'comment'` or `'edit'` kept, anything else (missing, bogus, or only the old
    `commentMode` key) → `'interact'`. The old key is practically unreachable (no webview
    serializer: state does not survive a window reload); the mapping just keeps the parser total.
    `saveCommentUi` removes both `mode` and `commentMode` from the previous record before the
    write, then writes `mode` only when it is not `'interact'`. `hostBridge.svelte.ts`'s state
    comment updated.
  - `Toolbar.svelte`: props `mode: FrameMode` and `onChooseMode(pressed: FrameMode)` replace
    `commentMode` / `onToggleComment`. Buttons in order Interact (`aria-pressed` = interact),
    Edit (new `edit` icon in `icons.ts`, a pencil; accessible name "Edit", no title: it would only
    repeat the label, as on Interact; `aria-pressed` = edit), Comment (unchanged shortcut and
    title). The pick announcement runs in
    Comment and Edit mode.
  - `Stage.svelte`: prop `mode: FrameMode` replaces `commentMode`; Edit mode shows the same hint
    shape with the `edit` icon and "Click an element to edit · Esc to leave".
  - `App.svelte`: wires the renamed props; the comment-UI save passes `mode`.
  - `tests/browser/harness.ts`: shared locators `editButton` (the Mode group's "Edit" button) and
    `inspector` (`[data-cd-inspector]`); existing specs that pass `commentMode` or use the old
    toolbar props follow the rename.
  - Done when: `commentPick.test.ts` covers `chooseMode` (sends to every frame, resets; same mode
    sends nothing), `pressedMode` (all nine pairs), `pickCounts` (every mode × hover / pick with
    and without `edit`), an empty stage leaving Edit mode, `applyPickMessage` keeping an
    Edit-mode pick with `edit` and dropping one without, dropping a Comment-mode pick with `edit`,
    keeping hover in Edit mode, `cd:ready` re-sending `edit`, Escape → `'exit'` in Edit mode,
    `C` → `'toggle'` in Edit mode; `savedState.test.ts` covers `mode` `'edit'`, `'comment'`,
    missing, bogus and a lone `commentMode: true` (→ `'interact'`); `commentPopover.test.ts`
    still green; existing browser specs green; `pnpm verify` green.

- [x] **4. Inspector.**
  - `src/webview/editInspector.ts` (pure, colocated test): `inspectorView(pick)` returning the
    view model in Data / contracts, `editability(edit)` (`'editable' | 'no-number' |
    'shared-number'`), `inlineValue(style, property)` and `toHexColor(value)`. Imports `asciiTrim`
    and `splitStyleDeclarations` from `../disk/inlineStyle` (parse5-free) and the element sets
    from `../disk/layout`.
  - `src/webview/Inspector.svelte` (view: props in, callbacks out; no domain state):
    `<aside aria-label="Inspector" data-cd-inspector>`.
    - Head: the title "Inspector"; when a pick exists, the target line `{frameLabel} › {target}`
      (App computes `frameLabel(canvas.frames, pick.frameId)` only when a pick exists); two
      `IconButton`s, `arrow-up` "Select parent element" and `arrow-down` "Select child element"
      (the popover's labels), always rendered, `aria-disabled="true"` without a pick (a click
      then does nothing), so focus on them survives a pick clear.
    - Body per the view model, copy exactly as in Data / contracts. `empty`: `EmptyState` with
      icon `edit`, no example. `not-editable`: `Message` (`inline`, tone `info`). `editable`:
      native fields, each with a `<label for>`, every field `disabled`. Text: `<textarea rows="3">`
      (value = the trimmed text), or the hint `Message`, or nothing. Font size, padding, margin:
      `<input type="text">` with `value` = inline, `placeholder` = computed. Color:
      `<input type="color">` with `color.hex`, then `color.value` as text, in the placeholder
      colour (`--cd-placeholder`) when it is the computed value.
    - No `{@html}`; frame text reaches the DOM only as field values and text nodes.
    - Scoped style (rule 08: layout CSS lives in the view, as `CommentsPanel.svelte` does): CSS
      `order: 2` draws it at the right edge, after the comments panel (`order: 1`); `flex: none`,
      `width: var(--cd-inspector-w)`, `max-width: 30%`, left divider and chrome background like
      the comments panel.
  - `App.svelte`: `{#if picker.picking.mode === 'edit'}` renders `<Inspector>` first inside
    `.workspace` (Tab order inspector → comments panel → stage), with `pick`, the frame label,
    and `onParent` / `onChild` → `picker.stepPick(...)`.
  - `Toolbar.svelte`: in Edit mode the pick announcement appends ", not editable" when
    `editability(pick.edit)` is not `'editable'`; the text comes from the pure rule
    `pickAnnouncementText({ mode, pick })` in `editInspector.ts` (rule 08), and the `pick` prop is
    `Pick<ChromePick, 'tagName' | 'isPage' | 'sequence' | 'edit'>`.
  - `theme.css` section 4: `input:not([type]), input[type='text']` share the `textarea` rule
    (except `display` / `resize`), plus their `::placeholder` and `:focus` rules; a
    `textarea:disabled, input:disabled` rule with `color: var(--cd-fg-disabled)`. Section 1:
    `--cd-inspector-w: 240px`. `theme.test.ts` tables change only if its guard flags the new
    rules.
  - Done when: `editInspector.test.ts` covers every row of the view model (no pick and a pick
    without `edit` → empty; null number → `no-number`; shared → `shared-number`; `target` `page`
    for a page pick in both `not-editable` and `editable`; plain → value `asciiTrim`med and raw
    `liveText` kept; empty plain (`text: ''`) → Text field with `''`; `'children'` → hint;
    `'too-long'` → hint; `img` / `input` / `iframe` → `none` even with `'children'` or
    `'too-long'`; inline value + computed placeholder for each style field, computed missing →
    placeholder `''`), `inlineValue` (`'font-size: 32px; color: #ff0000'` → `'32px'` / `'#ff0000'`;
    the last of two `padding` declarations wins; `PADDING: 4px` matches; a longhand-only
    `padding-left: 4px` gives `''` for `padding`; `null` style → `''`; a value with
    `!important` or a comment comes back as typed, trimmed), and `toHexColor`
    (`rgb(255, 0, 0)` → `#ff0000`, `rgba(0, 0, 255, 0.5)` → `#0000ff`; `rgb(256, 0, 0)`,
    `rgb(255 0 0)`, `#ff0000`, `red`, `oklch(0.7 0.1 200)`, `''` → `undefined`); colour hex
    falls back to `#000000`; `svelte-autofixer` clean; `pnpm verify` green. (Focus is proven in
    step 5.)

- [x] **5. Browser proof, gallery, docs.**
  - `fixtures/edit.html`, exactly this markup (the spec tags it with
    `sourceTaggedHtml({ html, document: parseArtboardDocument(html) })` before posting, as the
    host does; elements are found by id):

    ```html
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <title>Edit fixture</title>
    <style>
      body { margin: 0; padding: 24px 24px 200px; font: 16px/1.4 sans-serif; }
      #padded { background: #eeeeee; }
    </style>
    </head>
    <body>
    <h1 id="title" style="font-size: 32px; color: #ff0000">Title</h1>
    <p id="spaced">
        Spaced text
    </p>
    <button id="mixed" type="button"><span id="go">Go</span> now</button>
    <span id="clicks">0</span>
    <p id="commented">Before<!-- note -->after</p>
    <img id="picture" alt="" width="40" height="40" style="background: #cccccc">
    <div id="padded" style="padding: 8px 16px">Padded</div>
    <p id="cloned">Cloned text</p>
    <script>
      document.getElementById('mixed').addEventListener('click', () => {
        const counter = document.getElementById('clicks');
        counter.textContent = String(Number(counter.textContent) + 1);
      });
      const made = document.createElement('div');
      made.id = 'made';
      made.textContent = 'Made by script';
      document.body.append(made);
      const copy = document.getElementById('cloned').cloneNode(true);
      copy.id = 'cloned-copy';
      document.body.append(copy);
    </script>
    </body>
    </html>
    ```

  - `tests/browser/editMode.spec.ts`, each through the harness locators:
    - Edit button → `aria-pressed="true"`, inspector visible with its empty state, Stage hint shown.
    - Click `#title` → a `cd:pick` whose `edit` has `#title`'s `data-cd-src` number,
      `sharedNumber: false`, `textState: 'plain'`, `text: 'Title'`,
      `style: 'font-size: 32px; color: #ff0000'`; the inspector shows disabled fields: Text
      `Title`, Font size `32px`, Color swatch `#ff0000` with text `#ff0000`, Padding and Margin
      empty with the computed placeholders.
    - Click `#mixed` in Edit mode → `#clicks` stays `0`; back in Interact mode a click makes it `1`.
    - `#spaced` → the Text field shows `Spaced text` while `edit.text` keeps the newlines and
      indentation.
    - `#mixed` and `#commented` → the "Contains other elements" hint and no Text field; `#picture`
      → no Text field and no hint; `#padded` → Padding `8px 16px`.
    - `#made` → the `no-number` copy; `#cloned` and `#cloned-copy` → the `shared-number` copy.
    - A click in the empty space below the content → target `page` (body).
    - Click `#go` (frame focus), press ↑ → the pick steps to `#mixed` with a fresh `edit`; the
      Select parent button does the same from `#go`.
    - Escape with chrome focus leaves Edit mode and hides the inspector. Escape with focus on the
      Select parent button does the same and focus lands on the stage viewport, not `body`.
    - `C` in Edit mode enters Comment mode (no inspector), and a Comment-mode pick carries no
      `edit`.
    - A design script's forged `cd:pick` carrying `edit` (posted from inside the frame with
      `window.parent.postMessage`) in Comment mode opens no comment popover and draws no pick
      outline.
    - A `canvas:updated` with new HTML for the frame clears the inspector's pick, and a focused
      Select parent button keeps focus.
    - A webview reload with saved `mode: 'edit'` comes back in Edit mode with the empty inspector;
      Edit → Interact → reload comes back in Interact mode.
  - Gallery: new `tests/browser/gallery/states/inspector.ts` (empty, editable plain text,
    mixed-content hint, not editable) registered with the other state files, and an Edit-pressed
    toolbar state; `pnpm gallery` contrast report has no new failure.
  - Docs: rule 02 (`cd:mode { mode: interact|comment|edit }`; `cd:pick` gains `edit?` with its
    guards; the `pickCounts` acceptance rule replaces "chrome drops cd:hover and cd:pick outside
    Comment mode"); rule 05 owner catalog (`editTarget.ts`, `editInspector.ts`,
    `Inspector.svelte`, `chooseMode` / `pressedMode` / `pickCounts`, the moved and new constants
    in `layout.ts`, the picker and `CommentPicker` serving both modes, the `editButton` /
    `inspector` harness locators).
  - Done when: `pnpm test:browser` green including `editMode.spec.ts`; `pnpm gallery` run and its
    contrast result recorded in the review; `pnpm verify` green.

## Files / areas

- Disk constants: `src/disk/layout.ts`, `src/disk/sourceTags.ts` (+ test), `src/disk/artboardEdit.ts`.
- Frame runtime: `src/webview/frame/frameMessages.ts` (+ test), `commentPicking.ts`,
  `selector.ts` (`PickDescription` type), new `editTarget.ts`, `runtime.test.ts`,
  `commentTarget.roundtrip.test.ts` (import only); `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap`
  (updated on purpose, runtime code only).
- Chrome rules and state: `src/webview/commentPick.ts` (+ test), `commentPicker.svelte.ts`,
  `savedState.ts` (+ test), `hostBridge.svelte.ts`, new `editInspector.ts` (+ test).
- Chrome views: `App.svelte`, `Toolbar.svelte`, `Stage.svelte`, new `Inspector.svelte`,
  `ui/icons.ts`, `ui/theme.css`, maybe `ui/theme.test.ts`.
- Browser: `fixtures/edit.html`, `tests/browser/editMode.spec.ts`, `tests/browser/harness.ts`,
  `tests/browser/gallery/states/inspector.ts` + its registration, existing specs that use the old
  toolbar props.
- Rules: `.claude/rules/02-mcp-webview.md`, `.claude/rules/05-single-job.md`.

## Data / contracts

**Chrome → frame `cd:mode`:** `{ type: 'cd:mode', mode: 'interact' | 'comment' | 'edit' }`.
Every `cd:mode`, even a repeat, still forgets the frame's pick and hover.

**Frame → chrome `cd:pick`:** unchanged fields plus `edit?: PickEditFields`, present iff the
frame is in Edit mode. The edit target is the picked element, or `document.body` (falling back
to the element) for a page pick.

```ts
type EditStyleField = 'font-size' | 'color' | 'padding' | 'margin'; // (typeof EDIT_STYLE_FIELDS)[number]
type PickEditFields = {
	// The target's data-cd-src (getAttribute) as a canonical non-negative integer
	// (/^(0|[1-9]\d*)$/, safe integer); null when absent, malformed, or the target is disconnected.
	sourceNumber: number | null;
	// Another element in the target's document has the same data-cd-src value
	// (querySelectorAll count > 1). false when sourceNumber is null.
	sharedNumber: boolean;
	// 'plain': no child nodes, or exactly one Text node. 'children': anything else (an element,
	// a comment, two text nodes). 'too-long': plain, but the text is over MAX_EDIT_TEXT_CHARS.
	textState: 'plain' | 'children' | 'too-long';
	// The Text node's full data, unmodified (whitespace, newlines kept) iff 'plain'; '' for an
	// empty element and for the other states.
	text: string;
	// getAttribute('style') as the live page holds it (character references decoded; a script's
	// style change re-serialized by the browser). null when absent or over MAX_PICK_STYLE_CHARS.
	style: string | null;
};
```

Chrome guard (`parsePickEdit`), any failure rejects the whole `cd:pick`: a plain object;
`sourceNumber` `null` or `Number.isSafeInteger` and `>= 0`; `sharedNumber` boolean and `false`
when `sourceNumber` is `null`; `textState` one of the three; `text` a string of at most
`MAX_EDIT_TEXT_CHARS` and `''` unless `textState === 'plain'`; `style` `null` or a string of at
most `MAX_PICK_STYLE_CHARS`. Control characters are allowed in `text` and `style`: both are the
page's own text, shown only as field values and never put in an Agent prompt. Rebuilt; extra keys
dropped.

Computed values are the pick's existing `styles` (`COMMENT_STYLE_KEYS` already holds the four
fields; a page pick reads `body`, the same target).

**Pick acceptance** (`pickCounts`, used by `applyPickMessage` and by the comment draft):

| mode | `cd:hover` | `cd:pick` without `edit` | `cd:pick` with `edit` |
|---|---|---|---|
| interact | dropped | dropped | dropped |
| comment | counts | counts (pick + draft) | dropped (no pick, no draft) |
| edit | counts | dropped | counts (pick, inspector) |

A dropped message changes no state and sends nothing.

**Mode changes:** `FRAME_MODES` / `isFrameMode` (frameMessages.ts) are the one mode list, used
by the `cd:mode` guard and the saved state. `pressedMode(current, pressed)`; Toolbar Interact = `'interact'`, Edit =
`'edit'`, Comment = `'comment'`; key `C` = `'comment'`; Escape (no popover) = `'interact'`. All
go through `CommentPicker.#setMode`.

| from \ action | Interact button | Edit button | Comment button / C | Escape |
|---|---|---|---|---|
| interact | interact (no send) | edit | comment | nothing |
| edit | interact | interact | comment | interact |
| comment | interact | edit | interact | interact (popover rule first) |

Leaving Edit mode with focus inside `[data-cd-inspector]` moves focus to the stage viewport
first; on an empty stage it falls to `body`.

**Webview state:** key `mode: 'comment' | 'edit'`, omitted for `'interact'`. Each save removes
both `mode` and `commentMode` from the previous record first.

**Inspector view model** (`inspectorView(pick)`, `pick` = the chrome's Edit-mode pick or
`undefined`; `target` = `'page'` for a page pick, else `tagName`, in every kind that has one):

```ts
type InspectorView =
	| { kind: 'empty' } // no pick, or a pick without `edit`
	| { kind: 'not-editable'; reason: 'no-number' | 'shared-number'; target: string }
	| {
			kind: 'editable';
			target: string;
			text:
				| { state: 'plain'; value: string; liveText: string } // value = asciiTrim(edit.text), liveText = edit.text
				| { state: 'children' | 'too-long' }
				| { state: 'none' }; // tagName in VOID_ELEMENTS or RAW_TEXT_ELEMENTS: wins over every textState
			fields: Array<{ field: 'font-size' | 'padding' | 'margin'; value: string; placeholder: string }>;
			color: { hex: string; value: string; computed: boolean };
	  };
```

- `fields` in that order; `value` = `inlineValue(edit.style, field)`, `placeholder` =
  `pick.styles[field] ?? ''`.
- `inlineValue(style, property)`: `''` for a `null` style; else the last
  `splitStyleDeclarations(style)` segment whose `property` equals it, its `value` (the raw text
  after the tokenizer's own colon, so a colon inside a comment never starts it: F-138),
  `asciiTrim`med, as typed (a longhand such as `padding-left` never fills `padding`).
- `color.value` = `inlineValue(style, 'color')` when not `''` (`computed: false`), else
  `pick.styles.color ?? ''` (`computed: true`). `color.hex` = `toHexColor(pick.styles.color) ??
  '#000000'`: the swatch shows the rendered colour.
- `toHexColor` accepts only Chromium's computed serialization, `rgb(r, g, b)` /
  `rgba(r, g, b, a)` with `, ` separators and integer channels 0-255 (alpha dropped); anything
  else is `undefined` (`ponytail:` a computed colour in a modern colour space falls back to
  black; upgrade: a canvas-based normalizer in the chrome).

**Copy** (exact):

- Stage hint: "Click an element to edit · Esc to leave" (`Esc` in `<kbd>`).
- Empty: title "No element selected", body "Click an element to edit its text and style."
- `no-number`: "Not editable here: this element can't be matched to the artboard file. Ask the
  Agent to change it."
- `shared-number`: "Not editable: a script copied this element, so the file can't tell the
  copies apart. Ask the Agent to change it."
- `children`: "Contains other elements: ask the Agent to change this text."
- `too-long`: "This text is over 5,000 characters: ask the Agent to change it."
- Field labels: "Text", "Font size", "Color", "Padding", "Margin".
- Toolbar announcement in Edit mode: "`{tag}` element selected" / "Whole frame selected", plus
  ", not editable" when `editability` is not `'editable'`.

No host message, disk write, MCP or skill change.

## Testing

Unit (Vitest, `pnpm test` inside `pnpm verify`): the tests named in steps 1-4, plus the
`handoffCanvasHtml` snapshot updated on purpose. Browser (`pnpm test:browser`, local):
`editMode.spec.ts` is the proof of the frame side (Chromium is the real runtime), the acceptance
rule against a forged pick, the focus rule and the inspector; the existing picking, popover,
pins and gallery specs stay green. Gallery (`pnpm gallery`, local) for the new states' contrast.
F5 (Cursor-only, user): optional smoke in `fixtures/dev-workspace`: Edit mode picks an element of
a real artboard, the inspector fills, Escape leaves, a tab switch keeps Edit mode. No disk or MCP
evidence applies.

## Notes for the AI

- The frame text the host checks is `edit.text`, raw. 9e must send that as `liveText`, never the
  trimmed field value or the 200-character `text` excerpt; the view model keeps it as `liveText`.
- Handed to 9e: `style: null` means both "no style attribute" and "over
  `MAX_PICK_STYLE_CHARS`", so an over-cap style shows empty fields. Display-only in 9d; before 9e
  enables the style fields it must tell the two apart (a flag on the wire, or a hint).
- Handed to 9e: `edit.text`, `sharedNumber` and `style` are snapshots taken when the element was
  described, and scroll re-posts reuse them. A script that changes the text or clones the element
  after the pick leaves them stale, so the save must re-describe the target (a fresh `cd:pick`)
  before sending `liveText`.
- The fields show the inline value as typed (Notion "Units"), so in 9e an unchanged field equals
  its declaration and saves nothing.
- `edit` is present iff the frame is in Edit mode. The runtime decides by its own mode, the chrome
  by its own; `pickCounts` covers the window where they differ (a pick in flight across a mode
  change) and forged posts, for the pick and the draft alike.
- Never import `sourceTags.ts` or `artboardEdit.ts` from `src/webview/**`: both import parse5.
  `layout.ts` and `inlineStyle.ts` are parse5-free.
- The exported `canvas.html` embeds the runtime but never sends `cd:mode`, so the Edit code there
  stays dormant. `editTarget.ts` reads the design DOM only.
- A removed target is described once more (the existing removed-element path) and then reads
  `sourceNumber: null`.
- `ponytail:` finder still runs on every Edit-mode pick (up to its 200 ms timeout) because the
  description is shared with Comment mode; upgrade: skip `buildSelector` when the mode is edit.
- A design script can set `data-cd-src` or post a forged `cd:pick`; the inspector only shows text
  and values, and 9c's host checks (hash, number, live text) stay the authority.
- `RAW_TEXT_ELEMENTS` / `VOID_ELEMENTS` only hide a text field the host would refuse; the host
  stays the authority (the core still checks namespace and re-parses). An empty element keeps
  its Text field: the 9b core inserts text into it.
- Choices made here (reversible, not in Notion): Escape leaves Edit mode and `C` goes from Edit to
  Comment; the Edit button toggles like Comment; Edit mode survives a tab switch; the inspector
  sits at the right edge, 240 px (at most 30%), after the comments panel, with Parent / Child
  buttons; no `E` shortcut.
- Svelte: rule 08 container / view split; `Inspector.svelte` holds no domain state;
  `svelte-autofixer` after every edit.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":33517,"specSha256":"8e556e4ff09427636aa4e7284e40f7c39e65cc34f90384e76e9a68bde0c98df5","branch":"refs/heads/feature/edit-mode-selection","head":"149b30243d2e16366c13179c6be23e4f2c91b302","baseRef":"refs/heads/main","baseCommit":"fc9a091350e7ffdeaf08e6af0abc75fffcfafccb","sourceTree":"e3420938218c76b4b9bafc76c5fc29f0ad52632e","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9d/F-138 [P3] closed - Inspector reads a style value from the first colon in the raw text, so a colon in a leading comment shifts it

**File:** src/webview/editInspector.ts:56
**Found:** 2026-11-19 by /audit independent (scope: current; lens: quality; fresh reviewer claude-opus-5-5)
**Why it matters:** `inlineValue` matches the segment by the scanner's `property` (taken before the first colon outside comments and strings) but slices the value at `segment.text.indexOf(':')`, the first colon anywhere in the raw text. For `style="/* note: brand */ color: #ff0000"` it returns `brand */ color: #ff0000`; for `color/*a:b*/: red` it returns `b*/: red` (probed with the exact function body under Node). The two disagree whenever a comment (or escaped name) before the real colon holds a `:`. In 9d the fields are disabled, so it is display only; 9e relies on "an unchanged field equals its declaration and saves nothing", which this breaks for such attributes. Rare in hand-written HTML. The spec wording ("its text after the first `:`") matches the code, so this is spec-level too.
**Suggested fix:** Take the value from the scanner's own colon: have `splitStyleDeclarations` expose the colon end (or the raw value text from it, keeping `!important` as typed) and slice there; add the two cases above to `editInspector.test.ts`. No current requirement is lost.
**Resolution:** Fixed in the 9d refactor pass: `splitStyleDeclarations` now returns each segment's `value` from the tokenizer's own colon (`valueStart`, after its whitespace, as typed through the segment end), and `inlineValue` reads `asciiTrim(segment.value)`. Both cases are tests in `inlineStyle.test.ts` and `editInspector.test.ts`. Awaiting re-review.
2026-11-19 /audit independent (9d re-review at 149b302, fresh subagent claude-opus-5-5): closed. Re-read `src/disk/inlineStyle.ts:107-138,143-236` and `src/webview/editInspector.ts:48-56`. `scanStyle` records `colonEnd` only for a `:` outside comments, strings and brackets, `valueSpan` starts after its leading whitespace, and `splitStyleDeclarations` slices `value` from that offset to the segment end; `inlineValue` returns `asciiTrim(segment.value)`. Both original cases (`/* note: brand */ color: #ff0000`, `color/*a:b*/: red`) and the `!important` / comment-kept cases pass in `pnpm verify`. `setStyleProperty` still uses its own `valueStart` / `valueEnd` unchanged, so the edit core is unaffected. No new defect.

## Independent review

**Status:** passed
**Target commit:** 149b30243d2e16366c13179c6be23e4f2c91b302
**Base commit:** fc9a091350e7ffdeaf08e6af0abc75fffcfafccb
**Base ref:** main
**Spec hash:** 8e556e4ff09427636aa4e7284e40f7c39e65cc34f90384e76e9a68bde0c98df5
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-19T16:40:07Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-19T16:44:26Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain --untracked-files=all`: pass (HEAD = target, merge base = base, spec hash matches, only `blueprint/context/review.md` modified; spec tracked, no snapshot field)
- `pnpm verify`: pass (vp check, agent-rules check, svelte-check, webview-tests tsc, 52 test files / 667 tests, vp pack, webview build)
- `pnpm test:browser`: pass (147 passed, 192 gallery states skipped by design without `CD_GALLERY=1`; all 11 `editMode.spec.ts` tests ran)
- `pnpm gallery`: not run (local evidence only, not a gate)

## Evidence

- Full `fc9a091..149b302` delta read: 41 files (disk constants, frame runtime `editTarget.ts` / `commentPicking.ts` / `frameMessages.ts`, chrome rules `commentPick.ts` / `editInspector.ts` / `savedState.ts`, `CommentPicker`, `hostBridge`, views `Inspector` / `Toolbar` / `Stage` / `App`, `theme.css`, `icons.ts`, unit + browser tests, fixture, gallery states, rules 02 / 05 / 09).
- Security: `parsePickEdit` rejects the whole `cd:pick` on any bad `edit` field and rebuilds it; `pickCounts` drops mode-mismatched picks for both pick state and draft (browser test posts a forged edit pick from inside the frame); frame text reaches the DOM only as field values / text nodes (no `{@html}`); `describeEditTarget` uses only `getAttribute` / `childNodes` and a selector built from a validated integer; runtime forbidden-list test unchanged and passing; `dist/webview/chrome.js` has no parse5.
- Performance: per-element description cache now holds the edit fields too; `querySelectorAll` once per described element; runtime size budget 35,135 chars enforced; finder cost in Edit mode carries a `ponytail:` note.
- `handoffCanvasHtml` snapshot diff hunks sit only inside the embedded runtime script.
- F-138 re-examined against `inlineStyle.ts` / `editInspector.ts` and closed.

## Findings

- F-139 [P3] open: `saveCommentUi` keeps a legacy `commentMode` key the spec says each save removes
- F-140 [P3] open: spec / owner-catalog drift (computed colour token, stale `chooseMode` done-when, `input` rules missing from rule 05)
- F-138 [P3] fixed → closed
- No P0 or P1 finding open or fixed.

## Remaining risk

- `pnpm gallery` not run: the new inspector and Edit-toolbar states' contrast was not measured by this review.
- F5 (Extension Development Host) not run: Cursor-only behaviour (webview CSP with the new inspector, tab switch keeping Edit mode in a real panel) unproven by this review; spec lists it as optional.
- `/check` not run (not required by the request).

## Try it now

Run or do:

F5 (Run Extension) opens `fixtures/dev-workspace` (`dist/` is built by `pnpm verify`; if F5 says "did not start in 10 seconds", launch the Extension Development Host from the Cursor CLI). Run **Cursor Design: Open Artboard**, click **Edit** in the toolbar, use **Fit all** to find the frame labelled "Canvas 6a dogfood", and click its red heading "Café11".

Expected:

**Edit** is pressed and the stage hint reads "Click an element to edit · Esc to leave". An **Inspector** panel at the right edge shows "Canvas 6a dogfood › h1" with disabled (greyed) fields: Text `Café11`, Color with a red swatch and the text `red`, and Font size, Padding and Margin empty with the computed values as grey placeholders. Escape returns to Interact and the inspector disappears.

This proves:

Edit mode picks an element in a real Cursor webview and the inspector shows the frame's text, inline colour and computed values for it. It does not prove saving (9e).

User walked the Cursor F5 path on 2026-11-19 (8 steps: open panel, Edit, pick, blocked design click, Escape, tab switch keeps Edit mode, C to Comment): all passed.
