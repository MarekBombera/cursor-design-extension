# Feature: Inspector redesign

**From build-plan:** feature 9i
**Build attempt:** 1
**Branch:** feature/inspector-redesign
**Status:** verified (pnpm verify exit 0: 766 unit, svelte-check 0/0; full browser suite 197 passed before F-12 removed one case that could not fail; knip clean; gallery 208 with contrast; real Cursor cases a–h pass; audit plus two re-audits: F-01..F-12 closed, no P0/P1; independent review not selected: chrome-only UI, no sensitive boundary)

## Goal

Replace the five-field Edit-mode inspector with the approved redesign. Sections adapt to what is
selected, every 9h field is shown with compact two-column fields and a "set on this element" dot,
each section has a Reset, and the Border section has Add border. Saving uses the 9h contracts:
`artboard:edit` with a `styles` list, `applyStyleChanges`, `edit.computed` and `edit.textState`.
The host, disk, MCP and every message stay unchanged. The feature ends with an agent-run check in
real Cursor, as in 9g.

## Design reference

- `prototypes/inspector.html` with `prototypes/theme.css` (tokens to port) and
  `prototypes/vscode-host.css`. Bombic approved them on 2026-11-20.
- Decisions and review points: `blueprint/reference/9i-inspector-notes.md` (decisions 1–6,
  R13–R18). This spec settles every open R-point in **Data / contracts → D8**.
- The mockup is the look. The spec departs from it, or from the notes, on purpose in these places:
  - **Units** (decision 4): no grey unit suffix.
  - **Reset** (R16): always rendered, `aria-disabled` when nothing is set, where the mockup hides
    it.
  - **Hint copy**: the mixed-content hint copy (D1).
  - **Colours**: computed colours show as lowercase `#rrggbb`.
  - **Glyphs**: styled with classes, because a `style="…"` attribute is banned in `.svelte` files.
  - **Field order**: Text ends Leading, Tracking, Case, as in the mockup (the notes list Leading,
    Case, Tracking).
  - **Gap**: also shows when it is set on a block element, so it can be cleared (the notes say
    flex or grid only).
  - **Reset names**: each Reset's accessible name names its section ("Reset Text"), so four
    buttons are not all "Reset".

## In scope

- **Selection kinds** (decision 1):
  - Text-only element: **Text** section with Content.
  - Text mixed with elements: **Typography** section, no Content, one hint line.
  - Container (`textState: 'elements'`): no text section.
  - Void or raw-text element: no text section.
  - Every kind gets **Appearance**, **Spacing** and **Border**.
  - The "Contains other elements" message goes.
- **Fields** (decision 2):
  - Text / Typography: Content (Text only), Size, Color, Weight, Text style (Italic, Underline,
    Strikethrough), Align, Leading, Tracking, Case.
  - Appearance: Background, Radius, Overflow, Opacity.
  - Spacing: Padding and Margin, each one shorthand box. Gap shows when the pick's `display`
    (`pick.styles.display`) is flex or grid, or when gap is set (D8).
  - Border: Width, Style, Color. They show when the element has a border; otherwise the section
    offers **Add border**.
  - No font family and no "Add:" links.
- **Controls** (decisions 4–5):
  - **Text boxes** show the whole value as typed, with no unit label. The inline value shows in
    full text, else the computed value as placeholder. They save on Enter or blur, as 9e drafts
    do.
  - **Colour fields** pair a text box with a native swatch.
  - **Selects and toggles** always show the computed value, and every choice saves that value
    explicitly.
  - A current value outside a list is added as a display-only option and saves nothing.
- **Reset and Add border**:
  - Reset per section is one multi-change save, so one undo step. Reset on Border also removes
    border shorthands (9h D3).
  - Add border is one save of `1px` + `solid`.
- **Layout** (decision 6):
  - 296px wide (`--cd-inspector-w`), two-column fields with the label inside.
  - A blue set dot plus full vs secondary text, and uppercase section titles.
  - A one-column fallback when narrow (R17).
  - The mockup's tokens are ported to `src/webview/ui/theme.css`.
- **Errors and accessibility**: per-field error copy (R15), and focus, naming and announcements
  per R16 and D7.
- **One open draft per element** (D5): a new draft, a choice, Reset or Add border first ends the
  element's other open drafts. This removes the stale-baseline preview that 9i's extra save paths
  would otherwise expose.
- **Supporting work**: fixture elements, browser tests, gallery states, docs (README Edit mode,
  rules 05 and 08 catalogs).
- **Real Cursor**: an agent-run check on the packaged `.vsix`.
- **Notion**: a drafted 0.4 patch, applied only after Bombic's yes.

## Out of scope

- **No host, disk, MCP, Agent skill or message-shape change.** 9h already allows a multi-change
  `styles` list; this feature is its first multi-change sender.
- **Reset never removes an inline `font`, `text-decoration` or `background` parent.** That would
  change 9h's edit core (D2 ceiling).
- **Fields left out:** per-side spacing, font family, shadow, text shadow, transform, filter,
  width / height, layout controls, classes and style blocks.
- **`direction` in `computed`:** Align assumes left-to-right (`ponytail:`).
- **Control and picker features left out:**
  - a custom listbox replacing the native selects (see the D8 ceilings);
  - alpha in the colour picker;
  - per-field unset for selects and toggles (section Reset covers it);
  - a roving-focus radio group for Align.
- **Later items:** 0.4.1 (mode switch opens the matching panel) and 0.5 Projects + pages.
- **Docs left alone:** editing `blueprint/context/system-map.md` (`/complete` merges shipped
  flows), and patching the Notion page without a yes.

## Build loop

- `workflow.stepReview` is `feature`. Build the steps in order and run each step's checks before
  starting the next. Present one review at the end of the feature, not after each step.
- `workflow.checkpointCommits` is `disabled`: no step commits. `/complete` creates the feature
  commit.
- Every `.svelte` / `.svelte.ts` change follows rule 08:
  - Svelte MCP `list-sections` / `get-documentation` before writing.
  - `svelte-autofixer` on the full file after every edit, until clean.
  - In Claude Code, delegate Svelte edits to `svelte-file-editor`.
- Each step that adds a shared helper or primitive updates the owner catalog (rule 05 or 08) in
  that same step.
- After each step: `pnpm verify`. From step 2 on, also `pnpm test:browser`; from step 5 on, also
  `pnpm gallery`. Report observed results only.

## Build steps

Progress (tick a box only when that step's **Done when** passes; details in the subsections below):

- [x] 1. Pure inspector model and multi-change commit rule
- [x] 2. Fixture, tokens, `Field` primitive, text-box fields
- [x] 3. Choice controls
- [x] 4. Reset and Add border
- [x] 5. Narrow width, gallery, docs
- [x] 6. Real Cursor check and Notion draft
- [x] 7. Audit repairs (F-01..F-12)

### 1. Pure inspector model and multi-change commit rule

- `src/disk/inlineStyle.ts`: export `clearedProperties(field)`: the field plus the longhands
  `LONGHANDS` gives it. `BORDER_PARENTS` is already exported.
- `src/webview/editInspector.ts`:
  - Add `editableSections` and `colorDisplay` with the D1–D3 / D7 types.
  - `inspectorView` stays unchanged until step 2, so nothing visible changes.
- `src/webview/editDrafts.ts`:
  - Add `stylesCommit` (D5) and `swatchValue` (D2).
  - Add the per-field error kinds and copy (D6).
  - Make `stylePreview`'s refusal mapping per field. Today it maps every refusal to
    `invalid-length`.
- Catalogs:
  - Rule 05 names `clearedProperties`.
  - Rule 08 names `editableSections`, `colorDisplay`, `stylesCommit`, `swatchValue` and the error
    kinds.
- One colocated test file per module, with edge cases over volume:
  - **Selection**: every selection kind.
  - **Set rule**: through a longhand, through a border parent, and an inline `font` /
    `background` parent (which does not count).
  - **Colour display**: `rgb(…)`, `rgba(0, 0, 0, 0)`, `rgba(…, 0.5)`, `oklch(…)` and a missing
    key.
  - **Swatch**: `swatchValue` with a `#rrggbb` draft, a `#abc` draft, and a draft of another
    element.
  - **Align mapping**: `start`, `end`, `-webkit-center` and `match-parent`.
  - **Selects**: extra and missing options.
  - **Text style**: the U/S combine table and the Italic flip.
  - **Gap**: shown for each of the four display values and by a set longhand; hidden for `block`
    and for an absent `display`.
  - **Border presence**: style `none` with width `0px`; a multi-value style; set by a parent only;
    set by `border-width` only.
  - **Actions**: each section's Reset changes, names and announcement, and the Add-border action.
  - **`styleTooLong`** output.
  - **`stylesCommit`**: `none`, `unchanged`, `invalid` and `save`, with a preview equal to
    `applyStyleChanges`.
  - **Error copy**: per field.

**Done when:** the new model and rules pass their unit tests, the rendered inspector is
unchanged, and `pnpm verify` passes.

### 2. Fixture, tokens, `Field` primitive, text-box fields

- `fixtures/edit.html` gains these elements, which later steps and the gallery use. Specs pick by
  selector, so existing picks keep working; re-check any test that clicks by coordinates.
  - `#row`: `display: flex; gap: 12px` from the `<style>` block, holding `<span>One</span>` and
    `<span>Two</span>` (container, Gap computed).
  - `#gapped`: `<div style="gap: 8px">Gapped</div>` (block element, Gap set).
  - `#boxed`: `<p style="border: 1px solid #dddddd">Boxed</p>` (inline border shorthand).
  - `#ruled`: `<p>Ruled</p>` with `border-bottom: 2px solid #999999` from the `<style>` block
    (border from CSS).
  - `#widthonly`: `<p style="border-width: 3px">Width only</p>` (border present only because a
    field is set).
  - `#styled`: `<p style="font-weight: 700; text-decoration-line: underline; letter-spacing:
    0.04em">Styled</p>`.
  - `#heavy`: `<p style="font-weight: 700">Heavy</p>` with `#heavy { font-weight: 400
    !important }` in the `<style>` block.
  - `#picture` (img, inline `background: #cccccc`) and `#title` stay.
- `src/webview/ui/theme.css` section 1:
  - `--cd-inspector-w` becomes `296px`;
  - add `--cd-swatch: 14px`, `--cd-set-dot: 5px` and `--cd-seg-h: 20px`;
  - add `--cd-field-edge-hover`, copying its `color-mix` from `prototypes/theme.css`.
- New `src/webview/ui/Field.svelte` (D9) with the field look and the `text`, `textarea` and
  `color` controls.
- Rule 08 catalog: add the line for `Field.svelte`, with its recorded exception (D9).
- New icons in `src/webview/ui/icons.ts`: `plus`, `align-left`, `align-center`, `align-right`,
  `align-justify`, with paths from the mockup.
- `inspectorView`'s editable variant becomes the D1 `EditableView` (built with
  `editableSections`). Delete the old editable branch, `INPUT_FIELDS` and the old colour view.
- Rewrite `src/webview/Inspector.svelte` to render it:
  - the head as today, plus the history divider and the tag in strong text;
  - the request error;
  - each section with its uppercase title;
  - Content, the too-long and mixed hints, and every text-box and colour field;
  - the per-field error rows (D6);
  - select and segment fields and the header action are not rendered yet.
- `EditState`:
  - A new draft first ends the element's other open drafts (D5 "one open draft").
  - Add the new silent end path `#endDraftSilently`.
- Background and Border color use the 9e colour draft path (D4).
- `tests/browser/editMode.spec.ts`:
  - Existing cases find fields by `data-cd-field` (D9).
  - New cases:
    - each selection kind's sections (`#title`, `#mixed`, `#row`, `#picture`);
    - a Background save of `transparent`;
    - clearing a colour text box sends `{field: 'color', value: ''}`;
    - per-field error copy (Opacity `2`, Color `red`, Leading `-1`);
    - the set dot, the "(set on this element)" name and full text on `#title`'s Size;
    - a placeholder's computed colour equals `--cd-fg-2`;
    - an invalid Padding draft on `#padded`, then typing in Margin, ends the Padding draft
      (error gone, field shows the pick value).

**Done when:**

- The four selection kinds show the right sections.
- Every text-box field previews and saves one change, a colour can be cleared, and a new draft
  ends the element's other open drafts.
- `pnpm verify` and `pnpm test:browser` pass.
- `theme.test.ts` passes with no new exemption.

### 3. Choice controls

- `Field.svelte` gains the `select` and `segments` controls (D9).
- Inspector renders Weight, Text style, Align, Case, Overflow and Border Style from the model.
- `EditState.handleStyleChanges(changes, announcement?)` (D5) is the one path for choices, Reset
  and Add border. App passes it to Inspector as `onStyleChanges`.
- **Selects**:
  - The view drops a `change` to a display-only option.
  - After any change, the view puts the DOM value back to `selected` (D3).
- Browser cases:
  - On `#title`, Weight `Bold` posts one `artboard:edit` `{styles: [{field: 'font-weight',
    value: '700'}]}`. The select keeps showing the computed option, which becomes Bold after the
    re-post.
  - On `#heavy`, choosing Bold posts nothing (`unchanged`), and the select still shows Regular.
  - On `#spaced`, click U, wait for its `aria-pressed="true"`, then click S. The last post is
    `text-decoration-line: underline line-through`. Clicking S again sends `underline`.
  - Clicking the pressed, inherited Align left saves `text-align: left`.
  - Choosing an out-of-list extra option posts nothing.
  - A choice previews in the frame before the answer, and the answer and echo never reload.
  - On `#padded`, an invalid Padding draft, then Weight Bold: the draft ends silently. Typing `4`
    into Padding then previews with `font-weight: 700` still in the frame's `style` attribute.

**Done when:** every choice control saves exactly one change with the D3 value, out-of-list
values show and never save, selects always show the computed value, and Verify and browser tests
pass.

### 4. Reset and Add border

- Every section head renders one header button from `section.action` (D7):
  - Reset, `aria-disabled` when not enabled;
  - Border without a border: Add border, on the same element.
  - The button ignores clicks with `event.detail > 1`.
- Clicks call `onStyleChanges(action.changes, action.announcement)`.
- `EditState.historyAnnouncement` is renamed to `announcement` and serves both undo/redo steps
  and these actions.
- Focus (D7):
  - Add border moves focus to Width once it renders, armed only when the save was enqueued.
  - Reset on Border leaves focus on the same button.
  - Reset never unmounts.
  - A field that loses its place while focused hands focus to its section's header button.
- Browser cases:
  - On `#styled`, Reset Text posts one `artboard:edit` clearing the nine text style fields, and
    announces "Text reset.". Undo then posts one `artboard:history`.
  - A disabled Reset (on `#mixed` Appearance) posts nothing and keeps focus.
  - On `#spaced`, Add border posts `[{border-width: '1px'}, {border-style: 'solid'}]`. Focus lands
    on Width, and "Border added." is announced.
  - On `#boxed`, Reset Border posts the three clears. The button reads Add border, with focus
    kept.
  - Double-clicking Add border posts one edit.
  - On `#widthonly`, clearing Width with Enter unmounts the border fields, and focus is on Add
    border.
  - On `#padded`, an invalid Padding draft, then Reset Spacing: the draft ends silently, and one
    edit posts.

**Done when:**

- Reset and Add border each send one save, which is one undo step.
- Double-clicks never send a second save.
- Focus and announcements behave as listed.
- Verify and browser tests pass.

### 5. Narrow width, gallery, docs

- `Inspector.svelte`:
  - `container-type: inline-size` on the aside;
  - `@container (width < 260px)` turns the field grid to one column;
  - keep `max-width: 30%`.
- A browser case at an 820px-wide viewport (inspector about 246px): Size and Color share one
  left edge (one column).
- `tests/browser/gallery/states/inspector.ts` covers:
  - text (`#title`), mixed (`#mixed`), container with Gap (`#row`) and img (`#picture`);
  - border present (`#boxed`), and Add border (`#spaced`);
  - field error, request error, style too long, not editable, empty;
  - narrow one-column (820px viewport).
- Both themes pass the gallery's WCAG contrast checks.
- `README.md`:
  - The Edit mode section names every field, the set dot, Reset, Add border, and the rule that
    selects and toggles save on click.
  - Line 15 lists the field groups.
- `pnpm gallery` output reviewed by eye for both themes.

**Done when:**

- The inspector is one column below 260px (browser case).
- Every listed gallery state exists and passes contrast in both themes.
- README Edit mode names every field and control above.
- Verify, browser tests and the gallery pass.

### 6. Real Cursor check and Notion draft

- Package with `pnpm vsix` and install into a scratch Cursor driven over CDP (memory: agent Cursor
  CDP rig). On a real artboard, run the cases below. For each case, diff the artboard file before
  and after, and record the result under **Testing → Real Cursor evidence**.
  - **a.** Pick a text-only, a mixed, a container (flex) and an `img` element. Each shows the right
    sections.
  - **b.** Change Size, then Weight. Each diff shows one declaration.
  - **c.** Toggle U then S. The diff shows `text-decoration-line: underline line-through`.
  - **d.** Reset Text. One diff removes the nine listed properties and their longhands; an inline
    `font` / `text-decoration` / `background` parent stays. One Undo restores them, and Redo
    reapplies.
  - **e.** Add border. The diff shows width and style. Reset Border on an element with an inline
    `border:` shorthand removes it.
  - **f.** Set Background to `transparent`, then clear it.
  - **g.** The inspector at a narrow panel width shows one column.
  - **h.** A fresh export holds the edits, no `data-cd-src` and no inspector.
- Write the Notion 0.4 patch draft under **Notes for the AI → Notion 0.4 patch (draft)**: shipped
  9h/9i decisions and the field list. Ask Bombic before applying it.

**Done when:** cases a–h pass in real Cursor, with their evidence recorded in this spec, and the
Notion patch is drafted and awaits a yes.

### 7. Audit repairs (F-01..F-12)

- Repair the open audit findings in `blueprint/context/findings.md` (F-01..F-06) with the fixes
  their entries suggest. Probe the unverified F-07 and F-08, and fix them only if they reproduce.
- Every behaviour fix leaves one test that fails without it.

**Done when:** each repaired finding is marked `fixed` with its Resolution filled in, `pnpm
verify` and `pnpm test:browser` pass, and `pnpm knip` reports no unused exported types.

## Files / areas

- `src/disk/inlineStyle.ts` (+ test): the `clearedProperties` export only.
- `src/webview/editInspector.ts` (+ test):
  - `editableSections`, `colorDisplay` and the D1 types.
  - `inspectorView`'s editable variant becomes `EditableView`.
  - `editability`, `inlineValue`, `toHexColor` and `pickAnnouncementText` stay.
- `src/webview/editDrafts.ts` (+ test): `stylesCommit`, `swatchValue`, and the per-field error
  kinds and copy.
- `src/webview/editState.svelte.ts`: `handleStyleChanges`, `#endDraftSilently`, the one-draft
  rule, and `announcement` (renamed). Decisions stay in the pure modules. Past ~300 lines it is
  wiring only.
- `src/webview/Inspector.svelte`: the rewritten view; props `onStyleChanges` and `announcement`
  replace `historyAnnouncement`.
- `src/webview/App.svelte`: passes `onStyleChanges={edit.handleStyleChanges}` and
  `announcement`.
- `src/webview/ui/Field.svelte` (new), `src/webview/ui/icons.ts`, `src/webview/ui/theme.css`.
  `src/webview/ui/theme.test.ts` gets no new exemption.
- Tests and fixtures:
  - `fixtures/edit.html`;
  - `tests/browser/editMode.spec.ts`;
  - `tests/browser/harness.ts` (helpers only if needed);
  - `tests/browser/gallery/states/inspector.ts`.
- Docs: `README.md`, `.claude/rules/05-single-job.md`, `.claude/rules/08-svelte-chrome.md`.
- Untouched:
  - `src/host/**`, `src/mcp/**`, `src/webview/frame/**`;
  - `src/disk/**` except `inlineStyle.ts` and one `export` of `editValues.ts`'s existing
    `COLOR_FIELDS` set (no behaviour change; the chrome reuses it instead of a twin);
  - `skills/cursor-design/SKILL.md`, and every message type.

## Data / contracts

All inputs come from the 9h pick:

- `pick.edit`: `sourceNumber`, `sharedNumber`, `textState`, `text`, `style`, and `computed`
  (Partial, Chromium serialization).
- `pick.styles.display` (the comment record, `COMMENT_STYLE_KEYS`) for Gap.
- `pick.tagName` and `pick.isPage`.

Frame data stays text in field values, placeholders and option labels, never `{@html}`.

### D1. Types, selection and sections

```ts
// editInspector.ts
type Selection = 'text' | 'mixed' | 'container' | 'no-text';
export type SectionId = 'text' | 'appearance' | 'spacing' | 'border';

type FieldBase = {
	field: StyleField;
	label: string; // visible, inside the field
	name: string; // accessible name before the set suffix (D7 table)
	set: boolean; // D2
	wide: boolean; // spans both grid columns
};
export type SelectOption = { value: string; label: string; change: StyleChange | undefined }; // undefined = display-only
type SegmentButton = { name: string; icon?: IconName; glyph?: 'I' | 'U' | 'S'; pressed: boolean; set: boolean; change: StyleChange };
export type FieldView =
	| (FieldBase & { control: 'text'; value: string; placeholder: string })
	| (FieldBase & { control: 'color'; value: string; placeholder: string; swatch: string; none: boolean; pickerName: string })
	| (FieldBase & { control: 'select'; options: SelectOption[]; selected: string })
	| { control: 'segments'; id: 'text-style' | 'align'; name: string; set: boolean; wide: false; buttons: SegmentButton[] };
export type ContentView = { state: 'plain'; value: string; liveText: string } | { state: 'too-long' };
type SectionAction = {
	kind: 'reset' | 'add-border';
	label: 'Reset' | 'Add border';
	name: string; // "Reset Text", "Add border"
	enabled: boolean;
	changes: StyleChange[];
	announcement: string; // "Text reset.", "Border added."
};
export type SectionView = {
	id: SectionId;
	title: 'Text' | 'Typography' | 'Appearance' | 'Spacing' | 'Border';
	hint: string | undefined; // mixed only
	fields: FieldView[];
	action: SectionAction;
};
type EditableView = {
	kind: 'editable';
	target: string;
	selection: Selection;
	content: ContentView | undefined; // 'text' selection only; first row of Text
	styleTooLong: boolean; // edit.style === null: sections is []
	sections: SectionView[];
};
export const editableSections = ({ pick, edit }: { pick: ChromePick; edit: PickEditFields }):
	Omit<EditableView, 'kind' | 'target'>;
// InspectorView stays { kind: 'empty' } | { kind: 'not-editable'; reason; target } | EditableView.
```

| Selection | Rule (first match) | Sections |
|---|---|---|
| `no-text` | `VOID_ELEMENTS` or `RAW_TEXT_ELEMENTS` has `tagName` | Appearance, Spacing, Border |
| `text` | `textState` `plain` (an empty element too) or `too-long` | Text, Appearance, Spacing, Border |
| `mixed` | `textState` `mixed` | Typography, Appearance, Spacing, Border |
| `container` | `textState` `elements` | Appearance, Spacing, Border |

- **Content**: `plain` gives `{state: 'plain', value: asciiTrim(text), liveText: text}`.
  `too-long` gives `{state: 'too-long'}`, which renders today's too-long copy as an info
  `Message` in the Content row.
- **`styleTooLong`**: no section, title, hint or field renders. Only the Content row (when
  `content` is plain) renders, followed by today's `STYLE_TOO_LONG_COPY` info `Message`. With
  too-long text it is the style message alone.
- **Mixed hint**: "To change these words, ask the Agent or select a part that holds only text."
- **The empty and not-editable views** keep today's copy and rules (`editability`).
- Section fields, in render order (*wide* spans both columns):

| Section | Fields |
|---|---|
| Text / Typography | Size `font-size`, Color `color`, Weight `font-weight` (select), Text style (segments: `font-style`, `text-decoration-line`), Align `text-align` (segments), Leading `line-height`, Tracking `letter-spacing`, Case `text-transform` (select) |
| Appearance | Background `background-color` (*wide*), Radius `border-radius`, Overflow `overflow` (select), Opacity `opacity` (*wide*) |
| Spacing | Padding `padding` (*wide*), Margin `margin` (*wide*), Gap `gap` (*wide*, only when shown, D8) |
| Border | Width `border-width`, Style `border-style` (select), Color `border-color` (*wide*); `[]` without border presence (D7) |

### D2. Set rule and displayed value

- **Set rule.** A field is set when the style attribute holds a declaration that Reset on its
  section removes because of it: a property in `clearedProperties(field)`. For the three border
  fields, `BORDER_PARENTS` counts too, because Reset on Border removes them.
  - Clearing a single border box removes only its own `clearedProperties`. So a Width set only
    through `border:` shows the dot and an empty box; Reset on Border clears it.
  - Reset never removes `font`, `text-decoration` or `background`, so they never set a field. For
    example, `#picture`'s `background: #cccccc` leaves Background unset, with the computed colour
    as placeholder. Neither the box nor Reset can remove it. This is a `ponytail:` ceiling: the
    Agent removes it, and the upgrade path is a 9h edit-core rule.
  - A segment group is set when any of its properties is set. Each button's own `set` changes
    only its pressed look (D9).
- **What a set field shows**: the dot, full text, and the accessible name suffix " (set on this
  element)" (D7 table).
- **Text box value**: `inlineValue(style, field)`, the field's own last declaration as typed.
  - The placeholder is the computed display, else `''`.
  - A field can be set (through a longhand or parent) and still show the placeholder.
  - A draft wins while it exists (`fieldValue`, unchanged).
- **`colorDisplay(computed: string | undefined): { text: string; swatch: string; none: boolean }`**
  owns the colour table. It parses Chromium's `rgb(r, g, b)` / `rgba(r, g, b, a)`, capturing `a`,
  and uses `toHexColor` for the hex. `swatch` is always `#rrggbb`.

| Computed | `text` | `swatch` | `none` |
|---|---|---|---|
| `rgb(…)`, or `rgba(…, a)` with `a` = 1 | `#rrggbb` lowercase | that hex | false |
| `rgba(…, 0)` | `None` | `#000000` | true |
| `rgba(…, a)`, 0 < a < 1 | the computed string as given | hex of the channels | false |
| other (`oklch(…)`) | as given | `#000000` | false |
| missing | `''` | `#000000` | false |

- **Non-colour placeholders** show the computed value as given (`normal`, `16px`,
  `8px 0px 0px`, `1px 0px 0px`).
- **`swatchValue({ draft, pick, swatch }): string`** (in `editDrafts.ts`): the draft's value when
  the draft is for the picked element and its value matches `/^#[0-9a-f]{6}$/i` (lowercased),
  else `swatch`.
- An inline non-hex colour (`red`, `var(--x)`) shows as typed in the text box. Focusing and
  leaving without typing starts no draft and sends nothing. Typing it fresh gets the colour
  error.

### D3. Choice controls

- **Selects**: `selected` is the computed value mapped to an option's `value`.
  - When no option matches, one extra option is added and selected, with `change: undefined`:
    `{value: computed, label: computed}`, or `{value: '', label: '–'}` when `computed` lacks the
    key.
  - Option `change` is `{field, value: option.value}`.
  - On `change`, the view finds the chosen option. When it has a `change`, the view calls
    `onStyleChanges([change])`. Either way, the view then sets the select's DOM value back to
    `selected`.
  - The select therefore always shows the computed value. A save moves it on the next pick
    re-post. A non-save, or a value the stylesheet overrides, leaves it showing the computed
    value.
  - Options:
    - **Weight**: Thin `100`, Extra Light `200`, Light `300`, Regular `400`, Medium `500`,
      Semibold `600`, Bold `700`, Extra Bold `800`, Black `900`. The label is the name; the value
      is the number.
    - **Case**: `none`, `uppercase`, `lowercase`, `capitalize`.
    - **Overflow**: `visible`, `hidden`, `clip`, `scroll`, `auto`.
    - **Border Style**: `none`, `solid`, `dashed`, `dotted`, `double`.
    - For Case, Overflow and Border Style the label equals the value.
- **Text style**: three buttons with glyphs `I`, `U` and `S`.
  - **Italic**: pressed when computed `font-style` is `italic` or starts with `oblique`. Its
    `change` sets `font-style` to `normal` if pressed, else `italic`.
  - **Underline and Strikethrough**: pressed when computed `text-decoration-line`'s
    space-separated tokens include `underline` / `line-through`.
  - The U or S `change` flips that token, then sets `text-decoration-line` from the result:
    - both tokens → `underline line-through`;
    - one token → that token;
    - neither → `none`.
  - Other tokens (`overline`) are dropped (`ponytail:`).
  - Italic's `set` is `font-style`'s, and U/S's is `text-decoration-line`'s.
- **Align**: four icon buttons.
  - Pressed comes from computed `text-align`:
    - `left`, `start`, `-webkit-left` → left;
    - `right`, `end`, `-webkit-right` → right;
    - `center`, `-webkit-center` → center;
    - `justify` → justify;
    - anything else: none pressed.
  - The `ponytail:` notes the LTR assumption.
  - Each button's `change` is `{field: 'text-align', value}`, even when it is pressed.

### D4. Text boxes and colour fields

- Unchanged 9e draft path: `handleFieldFocus`, `handleFieldInput(field, value)`,
  `handleFieldCommit(field)`, and Enter commits. Since F-07, `handleFieldFocus` (the
  `cd:pick-refresh`) fires on focus of any inspector control, not only text boxes (D5).
- Colour fields (Color, Background, Border color):
  - Text box input and swatch input feed the same field draft.
  - The text box commits on Enter or blur.
  - The swatch commits on `change` and never on blur (as today).
  - An empty text box clears the declaration. This retires 9e's "colour cannot be cleared"
    `ponytail:`.

### D5. Multi-change commit and one open draft per element

```ts
// editDrafts.ts
export const stylesCommit = ({ pick, documentVersion, changes }: {
	pick: ChromePick | undefined;
	documentVersion: number;
	changes: readonly StyleChange[];
}):
	| { kind: 'none' } // no editable pick, or edit.style null
	| { kind: 'unchanged' } // applyStyleChanges result equals the baseline style
	| { kind: 'invalid'; error: FieldErrorKind; key: EditKey }
	| { kind: 'save'; preview: EditApplyMessage; commit: EditCommit };
```

- **Baseline**: `pick.edit.style`. Focus entering any inspector control sends `cd:pick-refresh`
  first (the text fields' path), so a choice previews over a design script's later change (F-07).
- **Result**: `applyStyleChanges({styleText: baseline, changes})`.
  - `invalid-value` → `invalid-choice`.
  - `unsupported-style`, or a result over `MAX_PICK_STYLE_CHARS` → `complex-style`.
- **Key**: `{frameId: pick.frameId, sourceNumber, documentVersion}`, where `documentVersion` is the
  same lookup `handleFieldInput` uses (`frame?.documentVersion ?? -1`).
- **Commit**: `{key, styles: changes}`. The raw values go out; the host normalizes.
- **One open draft per element.** `handleFieldInput` starting a new draft, and every
  `handleStyleChanges` call, first ends every other open draft of the picked element:
  - a valid draft commits through `#commit` (it is saved and enqueued first);
  - an invalid or unchanged draft ends through `#endDraftSilently`;
  - `#endDraftSilently(draft)` sends `baselinePreview(draft)` when `draft.previewed`, then
    `#setDraft(draft.field, undefined)`. It never calls `notSaved` (so `#dropDraft` is not reused
    here).
  - This keeps every draft's baseline current: no save lands between a draft's start and its
    commit except a step or an outside change, and both reload the frame and drop it.
- **`handleStyleChanges(changes: readonly StyleChange[], announcement?: string): boolean`**:
  1. End the element's other open drafts, as above. For a choice, that means every draft of the
     element.
  2. Run `stylesCommit`. On `none` or `unchanged`, return false.
  3. On `invalid`, apply `notSaved(requests, {key, message: FIELD_ERROR_COPY[error]})` and return
     false.
  4. On `save`, send `preview` (`sendToFrame`), then `enqueueEdit(commit)` and `#pump()`. Set the
     announcement when given, then return true.
- **Announcement timing**: it is set when the save is enqueued, while the preview already shows.
  A host refusal then also speaks its request error. That is accepted.
- One in flight, answers, adopt-without-reload, refusal reload, and the one undo step are all
  unchanged (9e / 9f / 9h).

### D6. Error copy (R15) and placement

`FieldErrorKind` = `invalid-length` | `invalid-color` | `invalid-opacity` | `invalid-leading` |
`invalid-choice` | `complex-style` | `control-text`. A refused text-box value maps by field:

| Fields | Kind | Copy |
|---|---|---|
| Size, Tracking, Radius, Padding, Margin, Gap, Border width | `invalid-length` | today's: "Not saved: use a number, a CSS length such as 1.5rem, or leave it empty." |
| Color, Background, Border color | `invalid-color` | "Not saved: use a hex color such as #1a2b3c, transparent, or leave it empty." |
| Opacity | `invalid-opacity` | "Not saved: use a number from 0 to 1, or leave it empty." |
| Leading | `invalid-leading` | "Not saved: use a number such as 1.5, a CSS length such as 24px, or leave it empty." |
| selects / segments / Reset / Add border (no UI path; defensive) | `invalid-choice` | "Not saved: choose a value from the list." |

- `complex-style` and `control-text` are unchanged. `invalidDraftCopy` keeps reading
  `FIELD_ERROR_COPY`.
- **Placement**: the Inspector renders a field's error as an error `Message`. It is a full-width
  grid row directly after that field, keyed with it, with id `${fieldId}-${field}-error`. The
  control's `aria-invalid` and `aria-describedby` point to it (as today's `errorId`).

### D7. Reset, Add border, focus, names

- **Reset changes**: every field of the section with value `''`, in the D1 order.
  - Text / Typography: the nine style fields (never Content).
  - Appearance: four fields.
  - Spacing: `padding`, `margin`, `gap`. Gap is listed even when hidden.
  - Border: the three border fields, which triggers 9h's parent removal.
- **Reset enabled** when any listed field is set (D2). Otherwise it is `aria-disabled` and its
  click is ignored. It is never `disabled` and never unmounted.
- **Border presence**: any border field is set, or `computed['border-style']` is present and not
  `none`, or a border field has an open draft for the picked element (revised in /implement: the
  preview of an emptied box must not unmount the field mid-typing; see D8 "Drafted fields stay").
  - With presence: Width, Style and Color render, and `action` is Reset.
  - Without presence: `fields` is `[]`, and `action` is Add border, which is always enabled. Its
    changes are `[{field: 'border-width', value: '1px'}, {field: 'border-style', value:
    'solid'}]`. The colour stays `currentColor` and is not written.
- **The header button**:
  - It is one `Button` (ghost, sm) per section, always mounted. Its label, name and action switch
    in place, so focus survives the switch.
  - It shows the `plus` icon for Add border.
  - It ignores `click` events with `event.detail > 1`, so a double-click never sends a second
    save after the label flips.
  - It prevents the default of a repeated Enter or Space `keydown` (`ui/keyRepeat.ts`
    `ignoreKeyRepeat`, shared with the segment buttons), so a held key never sends a second save
    after the label flips (F-08, F-09).
- **Focus**:
  - **After Add border.** When `onStyleChanges` returns true, an Inspector-local one-shot flag
    moves focus to Width the first time Width renders. The flag clears on use, or when the pick
    moves to another element or becomes undefined (a refusal reload).
  - **After Reset on Border.** Focus stays on the same button, which now reads Add border.
  - **A focused field that leaves.** If a re-render removes the field that holds focus, focus
    moves to that section's header button. Examples: Gap hidden after clearing it on a block
    element; the border fields gone after clearing `#widthonly`'s Width.
    Tab out of such a field counts too: the blur commit re-renders before focus lands, so the
    Inspector records Tab's destination in the capture phase and hands focus over only when that
    destination is gone. A click on a control that stays keeps its focus move (F-01).
- **Announcements**: EditState's one live region, rendered in the Inspector head and renamed
  `announcement`, speaks:
  - `action.announcement` on a saved Reset ("Text reset.", "Typography reset.", …) or Add border
    ("Border added.");
  - undo and redo copy, unchanged.
  - A repeat still speaks (`liveRegionText`).
- **Accessible names** (sections are `<section aria-labelledby>` on an `h3` title):

| Control | Name | Set suffix " (set on this element)" |
|---|---|---|
| text, textarea, select, colour text box | the `name`: Content, Size, Color, Weight, Leading, Tracking, Case, Background, Radius, Overflow, Opacity, Padding, Margin, Gap, Border width, Border style, Border color | yes, when set |
| swatch | `pickerName`: Color picker, Background picker, Border color picker | no |
| segment group (`role="group"`) | Text style, Align | yes, when the group is set |
| segment buttons (`aria-pressed`) | Italic, Underline, Strikethrough, Align left, Align center, Align right, Justify | no (per-button `set` is look only) |
| header button | Reset Text, Reset Typography, Reset Appearance, Reset Spacing, Reset Border, Add border | no |

- The visible labels are the short ones: Width, Style, Color in Border; Reset on every Reset.

### D8. Settled R-points (Fable review, 2026-11-20)

- **R14 computed forms**:
  - Leading and Tracking show the computed value as given (`normal`, `19.2px`). Align follows D3.
    Colours follow D2.
  - Multi-value borders show as given. A select gets them as an extra option.
  - Border presence keys on computed style (D7).
  - `text-decoration-line` reads the element's own computed value. A span inside an underlined
    link reads not pressed; that is accepted.
  - A missing `computed` key gives an empty placeholder, no pressed button, or the `–` extra
    option.
  - A non-hex inline colour shows as typed (D2).
  - The picker drops alpha on `#rrggbbaa` (`ponytail:`).
- **R15**: see D6.
- **R16**: see D5 (one open draft, the silent end path) and D7.
- **R17**: 296px, `max-width: 30%` kept, one column below 260px of inspector width (step 5).
- **R18**:
  - **Add border**: `1px` + `solid`, colour not written.
  - **Empty element**: an empty `plain` element is `text` with empty Content (typing adds text).
  - **Too long**: `too-long` shows the info message in place of Content.
  - **Mixed hint**: the copy in D1 offers both routes, and "ask the Agent" covers bare text
    between elements.
  - **Unset**: text boxes only; selects and toggles reset per section.
  - **Tab stops**: the seven segment buttons stay seven tab stops in labelled groups.
- **R13**: see D3 (Text style).
- **Gap visibility**: `pick.styles.display` is `flex`, `inline-flex`, `grid` or `inline-grid`,
  or Gap is set (D2), or Gap has an open draft for the picked element. An absent `display` hides
  it, unless Gap is set or drafted.
- **Drafted fields stay** (revised in /implement, step 5): a live preview of an emptied box
  removes the declaration from the frame, so the re-posted pick no longer shows it as set.
  `editableSections` takes `drafted: ReadonlySet<StyleField>` (the fields with an open draft for
  the picked element; EditState derives it with `sameElement`), and a drafted Gap or border field
  keeps its field rendered. When the draft ends (Enter, blur, a new pick), the field may leave,
  and the D7 focus hand-off moves focus to the header button.
- **Ceilings** (each gets a `ponytail:` where it lives):
  - **Re-choosing a select's option.** A native `<select>` fires no `change` for its current
    option, so an inherited value can't be pinned by re-choosing it. Choose another option, then
    back.
  - **Arrow keys on a closed select** save every step on platforms that change on arrow.
  - **Choices made within one animation frame.** A choice or toggle reads the latest reposted
    `pick.edit`. A second click within one animation frame of a preview can read the state before
    it. A U-then-S double-click can lose a token, though disk always gets exactly what was sent.
  - **Parents Reset keeps.** `font`, `text-decoration` and `background` parents are never cleared
    from the inspector (D2).

### D9. `ui/Field.svelte` (primitive, recorded exception)

- **Why `ui/`.** Field has one consumer, the Inspector. That is a recorded exception to rule 08's
  "2+ surfaces": its focus ring, invalid edge, set dot (`--cd-accent`), `outline: none` on the
  inner control, and `::placeholder` colour are control-state and meaning-colour rules that only
  `ui/` may hold. Rule 08's catalog line says so.
- **One look**, from the mockup:
  - height `--cd-control-h`, the label inside on the left in `--cd-fs-xs` `--cd-fg-2`;
  - the value right-aligned with tabular numbers;
  - the left pad is the dot's slot (`--cd-set-dot`);
  - `--cd-field-edge-hover` on hover;
  - one `:focus-within` ring (`--cd-focus`, skipped while the swatch draws its own);
  - the invalid edge `--cd-error`;
  - `::placeholder { color: var(--cd-fg-2); opacity: 1 }`, because the global `--cd-placeholder`
    misses 4.5:1 on light themes.
- **Props**:
  - Common: `name`, `set`, `wide`; `label` on every control but `segments`; `invalid` and
    `describedBy` on `text`, `textarea` and `color`.
  - The control is a discriminated union over `text`, `textarea`, `color`, `select` and
    `segments`. Each takes the matching `FieldView` data plus its event callbacks.
  - The control element carries `data-cd-field="<field>"` as the test hook. Browser tests find
    fields by it, because the accessible name changes when a field becomes set.
- **Controls**:
  - **`textarea`**: auto-height, 1 to 6 lines (`field-sizing: content`), left-aligned, `maxlength`
    from the caller.
  - **`color`**: a text box plus a native `<input type="color">` swatch (`--cd-swatch`) with the
    `none` look.
  - **`select`**: a native `<select>` with the `chevron-down` icon. The text is secondary unless
    set.
  - **`segments`**: raw `<button type="button">` elements inside the field, at `--cd-seg-h`.
    - They are part of the field control, not standalone buttons. Their size comes from the
      field, and their pressed look depends on the field's set state. Using `Button` /
      `IconButton` would need two new props on each, which the catalog line also records.
    - Pressed and inherited: `--cd-bg-active`.
    - Pressed and set: `--cd-toggle-on-*`.
    - Glyphs: `I` italic, `U` underline, `S` line-through (classes), or an `Icon`.
    - A repeated Enter or Space `keydown` is ignored (`ignoreKeyRepeat`, D7), so a held key
      toggles once (F-09).
- It renders no `{@html}` and no `style="…"`, so `theme.test.ts` needs no exemption.

### Error and edge behaviour

| Case | Result |
|---|---|
| choice on a pick that is not editable or has `style: null` | control not rendered; `stylesCommit` `none` |
| choice whose result equals the baseline | nothing sent; a select shows `selected` again |
| Reset with nothing set | `aria-disabled`, click ignored |
| double-click on the header button | second click ignored (`detail > 1`) |
| Reset / choice result too long or unsupported | request error `complex-style` copy, nothing sent, returns false |
| host refuses the save | as 9e: `ui:error` copy, frame reloads, drafts of that frame end, the Add-border focus flag clears |
| outside change during a choice save | as 9e: "Not saved: the frame changed. Try again." |
| focused field removed by a re-render | focus moves to the section's header button |
| frame reload mid-pick | pick drops, inspector empty (unchanged) |

## Testing

- **Unit** (Vitest, in `pnpm verify`): one colocated test file per module:
  - `inlineStyle.test.ts` (`clearedProperties`);
  - `editInspector.test.ts` (D1–D3, D7, D8);
  - `editDrafts.test.ts` (D5 `stylesCommit`, `swatchValue`, D6).
  - Cases are the step 1 edge cases, not volume.
- **Browser** (`pnpm test:browser`, local, Chromium): `editMode.spec.ts`. Existing cases move to
  `data-cd-field` hooks; new cases come from steps 2–5. Toggle sequences wait for `aria-pressed`
  between clicks.
- **Gallery** (`pnpm gallery`, local): the step 5 states in both themes with WCAG contrast,
  reviewed by eye.
- **Real Cursor**: step 6 cases a–h, agent-run over CDP on the packaged `.vsix`, with diff
  evidence.
- **Real Cursor evidence** (step 6, 2026-11-21, agent-run): Cursor 3.29.9, a scratch instance
  over CDP (port 9451, `--user-data-dir /tmp/cd9i`, scratch `HOME`, mock keychain), with the
  packaged `cursor-design-0.1.0.vsix` installed. Workspace: one artboard `insp`, created with
  the packaged `mcp.js` through a stdio stand-in. Panel opened with Open Artboard. Evidence:
  `<S>` = this session's scratchpad `cursor9i/` (`results.jsonl`, `diffs/`, `states/`,
  `shots/`).
  - **a. pass.** Sections per pick:
    - `h1`: Text (Content first), Appearance, Spacing (Padding, Margin), Border (Add border).
    - `p` with a link: Typography with the D1 hint and no Content, then Appearance, Spacing,
      Border.
    - flex `div`: Appearance, Spacing with Gap, Border.
    - `img`: Appearance, Spacing, Border.
    - Empty diff.
    - Deviation: in 2 of 3 runs, the first click on the flex `div` right after picking the `p`
      did not pick. It did not reproduce in isolation (see the report).
  - **b. pass.** Size `36` gives one declaration, `style="font-size: 36px"`. Weight Semibold
    gives one more, `font-size: 36px; font-weight: 600`. The select showed `700` before and
    `600` after the re-post.
  - **c. pass.** U gives `text-decoration-line: underline`. S, after U's `aria-pressed="true"`,
    gives `style="text-decoration-line: underline line-through"`. Both buttons end pressed.
  - **d. pass.**
    - Before: all nine text fields read "(set on this element)".
    - One diff removed the nine, leaving
      `style="font: italic 18px/1.6 Georgia, serif; text-decoration: underline; background:
      #eeeeee;"`. The three parents stayed, plus the kept segment's own `;`.
    - "Text reset." was announced, and Reset went `aria-disabled`.
    - One Undo restored the file byte for byte, and Redo reapplied the reset byte for byte.
  - **e. pass.**
    - Add border on a bare `p`: `style="border-width: 1px; border-style: solid"`. Focus went to
      Border width, and "Border added." was announced.
    - Reset Border on `style="border: 1px solid #dddddd"`: `style=""`. Focus stayed on the
      button, which now reads Add border.
  - **f. pass.**
    - `transparent` appended `background-color: transparent`.
    - Clearing it removed it. The net diff is the `;` left after the kept
      `text-decoration-line` declaration.
  - **g. pass.**
    - 296px inspector: two columns.
    - At 250px (View: Zoom In with a 1000px window): Size, Color, Weight and Leading share one
      left edge, in one 212.7px column.
    - At 140px (Agents pane open): also one column, but values and the Appearance Reset label
      are clipped.
    - Empty diff.
  - **h. pass.** Export Handoff (Command Palette) wrote `canvas-20261121T000354729Z`.
    - `ungrouped/insp/index.html` byte-equals the disk file and holds the b–f edits.
    - No tagged element in any file: 0 matches for `data-cd-src="N` or its encoded form.
    - No inspector markers.
    - `canvas.html` contains the text `data-cd-src` only twice, both inside the embedded frame
      runtime's script source (`handoffCanvasHtml.ts`, by design).
  - Screenshots:
    - a: `<S>/shots/a-{title,mixed,row,picture}.png`;
    - d: `<S>/shots/d-{before,after}-reset.png`;
    - g: `<S>/shots/g-narrow-window-zoom-raw.png`, `<S>/shots/g-narrow-window.png`.
- **Not claimed**: Windows / Linux select-arrow behaviour, and screen-reader output beyond the
  DOM names and live-region text the browser tests assert.

## Notes for the AI

- **Rule 05/08 owners**: extend `editInspector.ts` (view model, `colorDisplay`), `editDrafts.ts`
  (commit rule, swatch value, copy), `EditState` (one handler, one silent end path) and
  `inlineStyle.ts` (one export).
- **Reuse primitives**:
  - `Button` (ghost sm) for the header action.
  - `IconButton` for the head, plus `Message`, `Icon` and `EmptyState`.
  - The field look is the one new primitive, `Field`, added in step 2 with its catalog line.
- **No new dependency.** Do not change any message type, host or disk behaviour.
  `applyStyleChanges` is the one apply rule for previews.
- **Rule 08 bans outside `ui/`**: `:focus-visible`, `[aria-disabled`, `outline: none`,
  `--cd-accent` / `--cd-error` reads, `:global(` and `style="…"`. Inspector keeps layout only
  (grid, gaps, section padding, the container query, and the uppercase title, as the current
  `.title` does).
- **Keyed blocks**: key sections by id and fields by field name, so a pick re-post after a
  preview keeps DOM and focus.
- **Modes**: `isTextEntry` already counts `select`, so typing in a select never switches modes. A
  focused segment or header button is a button, as the Undo button is today.
- **README**: its line 59 lists the old five fields. Rewrite the Edit mode section from the
  shipped UI.
- **System map**: no flow change. At `/complete`, the 9d "Inspector fields" bullet is updated to
  the new model (shipped code only).
- **Notion 0.4 page**: patch it only after Bombic's yes (memory: code over Notion).
- **Notion 0.4 patch (draft)**, step 6. Page fetched read-only on 2026-11-21 (last edited
  2026-11-20). Apply only after Bombic's yes.
  - **Status callout**: add "9h (more edit fields) and 9i (inspector redesign) shipped on local
    main <date>, verified by an agent-run real-Cursor check (9i step 6, cases a–h)."
  - **Goal**: replace it with "In Edit mode, click an element and change its text and its
    typography, appearance, spacing and border styles. Each change is saved to the HTML file
    right away."
  - **Scope → Inspector**: replace the bullet with "In-house chrome panel, shown in Edit mode
    only. Its sections adapt to the selection."
  - **Decisions → Editable fields**: replace "first set … Border and more come later" with the
    shipped list:
    - **Text** (an element that holds only text): Content, Size, Color, Weight (Thin to Black,
      100–900), Text style (Italic, Underline, Strikethrough), Align (left, center, right,
      justify), Leading, Tracking, Case.
    - **Typography** (text mixed with elements): the same fields without Content, plus a hint to
      ask the Agent or select a part that holds only text.
    - **Appearance**: Background, Radius, Overflow, Opacity.
    - **Spacing**: Padding and Margin (one shorthand box each), and Gap when `display` is flex or
      grid, or when gap is already set.
    - **Border**: Width, Style, Color when the element has a border; otherwise **Add border**.
    - A container, `img`, or other void or raw-text element gets Appearance, Spacing and Border
      only. The "contains other elements" message is gone.
  - **Decisions → Controls (new bullet)**:
    - Text boxes show the inline value in full text, or the computed value as a grey
      placeholder, with no unit label. They save on Enter or blur.
    - Colour fields pair a text box with the native picker. An empty box removes the
      declaration, which retires "the colour cannot be cleared".
    - Selects and toggles always show the computed value and save on click, writing the chosen
      value explicitly. A value outside a list shows but saves nothing.
    - A blue dot plus full-strength text marks a value set in this element's `style` attribute:
      the property, a longhand of it, or, for border fields, a `border*` parent.
  - **Decisions → Reset and Add border (new bullet)**:
    - Each section's Reset clears that section's fields in one save, one undo step. It is greyed
      (`aria-disabled`) when nothing is set.
    - Reset on Border also removes `border` and `border-<side>` shorthands.
    - Reset never removes an inline `font`, `text-decoration` or `background` shorthand (the
      Agent removes them).
    - Add border is one save of `border-width: 1px` and `border-style: solid`. The colour stays
      `currentColor`.
    - `artboard:edit` carries a list of style changes, so one write is one undo step.
  - **Decisions → Units / value rules (amend)**:
    - Lengths (Size, Tracking, Radius, Padding, Margin, Gap, Border width) keep the 9b rule, and
      a bare number gets `px`.
    - Colours take `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or `transparent`. The picker has no
      alpha.
    - Opacity takes a number from 0 to 1. Leading takes a unitless number or a length.
    - Keyword fields take only their list.
    - Each refusal shows per-field error copy under the field.
    - Setting or clearing radius, overflow, gap or a border field drops its own longhands.
    - A later `font`, `text-decoration`, `background` or `border*` parent makes a new value move
      to the end.
  - **Out of scope (amend)**:
    - Drop "Border and more come later".
    - Add these fields: per-side spacing, font family, shadow, transform, filter, width and
      height, and layout controls.
    - Add a custom listbox, alpha, and per-field unset for selects and toggles (section Reset
      covers it).
  - **Ceilings (new short list)**:
    - Re-choosing a select's current option saves nothing, because a native select fires no
      change.
    - Arrow keys on a closed select save each step where the platform changes on arrow.
    - Two choices within one animation frame can read the pre-preview state.
    - Align assumes left-to-right.
    - The inspector is 296px, `max-width` 30%, and one column below 260px.
  - **Done when**: add "- [x] Inspector redesign: sections by selection, Reset and Add border,
    narrow one column, clean export (9i step 6, cases a–h)."


<!-- blueprint:completion {"schemaVersion":2,"specBytes":54705,"specSha256":"e2967628b43bd37dc3b82612cbdcda3ded324c61c0b9ad743116a10f8a8789ec","branch":"refs/heads/feature/inspector-redesign","head":"468b02339062b38609e6a81c237340f89f058ff9","baseRef":"refs/heads/main","baseCommit":"468b02339062b38609e6a81c237340f89f058ff9","sourceTree":"0b09e1519fafc856fc879241244f21096abe6849","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9i/F-01 [P2] closed - Tab out of an emptied border Width drops focus to body

**File:** src/webview/Inspector.svelte:153-170
**Found:** 2026-11-21 by /audit (scope: current; lens: all; Opus 5.5 reviewer, browser probe)
**Why it matters:** The steps are: on `#widthonly`, empty Width and press Tab.
- The blur commit ends the draft, and the re-posted pick has no border, so the Border fields
  unmount.
- Svelte's flush runs inside the blur dispatch. `document.activeElement` is already `body` when
  `$effect.pre` records `focusedSection`, so it records `undefined`.
- The Style select that Tab was about to focus is removed.

Result: focus ends on `body` (probe: `active = BODY`), and the D7 hand-off to the Add border
button never happens. The Enter path is covered and works. Tab is the other common way a keyboard
user leaves a field, and the same applies whenever the next control in tab order is removed by
the same flush.
**Suggested fix:**
- Add `onfocusout` on the `<aside>`: record the section of `event.target` when `relatedTarget` is
  `null` or inside the inspector.
- In the post-update `$effect`, when `activeElement` is `body` and a recorded section exists,
  focus its `-action` button, then clear the record.
- Add one browser case: empty Width on `#widthonly`, press Tab, and expect Add border to be
  focused.
**Resolution:** Inspector.svelte:180-205, 244: `onblurcapture` on the aside records the left field and Tab's
destination before the blur commit runs; the post-update `$effect` focuses the section's `-action`
when either is gone and focus is on body. Test: editMode.spec.ts "Tab out of an emptied border
Width..." (failed before the fix).
Reopened 2026-11-21 by re-audit (Opus 5.5 high, isolated-copy probe). The Tab case is fixed, but the
repair steals focus on mouse clicks: `recordTab` records any blur whose `relatedTarget` is in the
inspector, and the `$effect` (line ~193) hands off when the *left field* is gone. Empty Width on
`#widthonly`, then click Size: focus lands on Add border, and a Space then queues an unintended
Add border save. The same happens with Select parent, and with Gap then Padding on `#gapped`.
Fix: hand off only when Tab's destination is gone (`tabbed !== undefined && !tabbed.to.isConnected`;
`focusedSection` already covers a removed focused field), plus a browser case: empty Width, click
Size, expect Size focused. Verified in the copy: editMode plus probes 66/66.
Re-fixed: Inspector.svelte:173-187 records only Tab's destination and hands off only when it is
gone. Tests: "a click on another field after emptying Width keeps that focus" (failed with the
old condition) and "Shift+Tab out of an emptied border Width..."; the Tab case still passes.
Closed 2026-11-21 by re-audit 2 (Opus 5.5 high, real tree): probes A–E (a click on Size, Select parent, Gap then Padding, Shift+Tab, a click into the frame) keep or hand off focus correctly. The Tab, Enter and click cases pass; a stale record is overwritten or cleared on the next update.

### 9i/F-02 [P2] closed - The "valid draft saves first" branch of the one-open-draft rule has no test

**File:** src/webview/editState.svelte.ts:136-148
**Found:** 2026-11-21 by /audit (scope: current; lens: tests; Sonnet 5.5 reviewer)
**Why it matters:**
- **Untested branch.** The browser cases only cover an invalid other draft ending silently.
  Deleting the `commitDraft(draft).kind === 'save'` → `#commit` branch would end a valid,
  previewed draft silently and lose its edit, with no test failing. Rule 09 asks for tests that
  fail when a guard is removed.
- **Realistic trigger.** The colour swatch's `input` has no blur commit. A swatch preview,
  followed by a choice or another field's first keystroke, takes exactly this path.
- **Also untested.** The `invalid` return path of `handleStyleChanges` (the `notSaved` wiring) has
  no test.
**Suggested fix:**
- Add one browser case:
  1. Dispatch only an `input` with `#00ff00` on the Color picker, then wait for the frame preview.
  2. `selectOption('700')` on Weight.
  3. Expect two posts in the order colour then weight, and the frame's `style` holding both.
- Optionally, add a case where a choice on an over-cap style result shows the `complex-style`
  request error.
**Resolution:** editMode.spec.ts "a choice saves a valid open draft first..." (swatch `input` only, then
Weight 700: colour posts first, weight after its answer, frame holds both) and "a choice whose style
would pass the cap..." (`complex-style` copy, nothing posted). Both failed with the branches removed.
Closed 2026-11-21 by re-audit (Sonnet 5.5 high): both cases pass; the invalid path is covered.

### 9i/F-03 [P3] closed - knip: four exported types nothing imports

**File:** src/webview/editInspector.ts:78 (`Selection`), :96 (`SegmentButton`), :130
(`SectionAction`), :159 (`EditableView`)
**Found:** 2026-11-21 by /audit (scope: current; lens: quality; Sonnet 5.5 reviewer)
**Why it matters:** `pnpm knip` reports "Unused exported types (4)" and exits 1. It is not in
Verify, so nothing gates this, but it is new dead surface. Spec D1 lists them as exports.
**Suggested fix:** Drop `export` on the four types (they are used only inside the file).
**Resolution:** editInspector.ts:78, 96, 130, 159: `export` dropped (spec D1 updated); `pnpm knip` exits 0.
Closed 2026-11-21 by re-audit (both reviewers): `pnpm knip` exits 0.

### 9i/F-04 [P3] closed - Too-long text plus a too-long style renders both info messages

**File:** src/webview/Inspector.svelte:269-277 and src/webview/editInspector.ts:499-501
**Found:** 2026-11-21 by /audit (scope: current; lens: quality; Opus 5.5 reviewer)
**Why it matters:** Spec D1 says that when `styleTooLong` holds and the text is too long, "it is
the style message alone". The `styleTooLong` branch renders `contentRow(view.content)` for any
content, so `{state: 'too-long'}` shows the text-too-long message above the style message. No test
covers the combination.
**Suggested fix:** In the `styleTooLong` branch, render the Content row only when
`view.content?.state === 'plain'`. Add one unit or browser assertion.
**Resolution:** Inspector.svelte:304: the `styleTooLong` branch renders Content only for `plain`. Test:
editMode.spec.ts "too-long text with a too-long style..." (failed before the fix).
Closed 2026-11-21 by re-audit (both): the case passes, and fails with the guard reverted.

### 9i/F-05 [P3] closed - Select fields carry dead `invalid` / `describedBy` props

**File:** src/webview/Inspector.svelte:332 and src/webview/ui/Field.svelte (the `Labelled` props
type)
**Found:** 2026-11-21 by /audit (scope: current; lens: quality; Sonnet 5.5 reviewer)
**Why it matters:**
- A select can never be invalid: `invalid-choice` has no UI path.
- The caller still has to pass `invalid={false} describedBy={undefined}`.
- Field renders `aria-invalid="false"` on every select.

It is noise in a domain-free primitive.
**Suggested fix:** Limit `invalid` / `describedBy` to the `text`, `textarea` and `color` variants of
Field's props.
**Resolution:** Field.svelte: `invalid` / `describedBy` moved into `TextEntry` (text, textarea, color); the select
renders no `aria-invalid`. Inspector's select call site drops the dead props. svelte-check clean.
Closed 2026-11-21 by re-audit (both): Field.svelte:7-14, 52-58; svelte-check clean.

### 9i/F-06 [P3] closed - handleStyleChanges rebuilds the edit key by hand on the invalid path

**File:** src/webview/editState.svelte.ts:176-186
**Found:** 2026-11-21 by /audit (scope: current; lens: quality; Opus 5.5 reviewer)
**Why it matters:** `stylesCommit` already builds the key for `save`. The `invalid` branch
duplicates it with a defensive `undefined` fallback, which its own comment says can't happen. That
is two places to keep in step.
**Suggested fix:** Return `key` in `stylesCommit`'s `invalid` variant too, and use it.
**Resolution:** editDrafts.ts:219, 231: `stylesCommit`'s `invalid` variant returns `key`; `handleStyleChanges`
(editState.svelte.ts:178) uses it. editDrafts.test.ts `stylesCommit` asserts the key.
Closed 2026-11-21 by re-audit (both): editDrafts.ts:219, 231-241; editState.svelte.ts:176-181.

### 9i/F-07 [P3] closed - Choices preview from a pick baseline that is never refreshed on focus

**File:** src/webview/Inspector.svelte (select / segment / header handlers) and
src/webview/editDrafts.ts (`stylesCommit` baseline `pick.edit.style`)
**Found:** 2026-11-21 by /audit (scope: current; lens: quality; Opus 5.5 and Sonnet 5.5
reviewers)
**Why it matters:**
- Text drafts send `cd:pick-refresh` on focus; choices do not.
- If a design's own script changes the element's inline style after the pick, a choice can
  preview over it, or return `unchanged`, from a stale `pick.edit.style`.
- Within one animation frame of a preview or revert, the same stale read can happen. That window
  is the spec's D8 ceiling.
- Disk stays correct: the host applies the changes to the file bytes.

Not reproduced. It needs a fixture whose script mutates the style.
**Suggested fix:** If reproduced, have a choice's focus or pointerdown send `cd:pick-refresh` as
text fields do. Otherwise leave it inside the documented ceiling.
**Resolution:** Reproduced (a script's `margin: 7px` added after the pick was dropped by a Weight preview).
Inspector.svelte:282: `onfocusin={onFieldFocus}` on the body sends `cd:pick-refresh` for every
control; Field's per-input `onfocus` props removed. Test: "a choice keeps a style change the
design's script made..." (failed before the fix).
Closed 2026-11-21 by re-audit (both): the case fails without `onfocusin`. 11 focus moves sent 11 refreshes (no storm). A refresh answer beat `click` at 0 ms and 50 ms presses, and a repost keeps drafts and error copy.

### 9i/F-08 [P3] closed - Key auto-repeat on Reset Border may save Reset and then Add border

**File:** src/webview/Inspector.svelte (header action button, `event.detail > 1` guard)
**Found:** 2026-11-21 by /audit (scope: current; lens: quality; Opus 5.5 reviewer)
**Why it matters:** The double-click guard covers mouse clicks (`detail > 1`), and a probed
double Enter posted only one edit. A held Enter auto-repeats `click` with `detail` 0. After Reset
flips the label to Add border, a repeat could add the border back: two saves and two undo steps.
Add border then moves focus to Width, which ends the cycle. Not probed with real key repeat.
**Suggested fix:** If reproduced, ignore `keydown` with `event.repeat` on the header button, or
ignore activations while that section's save is waiting or in flight.
**Resolution:** Reproduced (held Enter: Reset saved, then "Border added." and a queued Add border save).
Inspector.svelte:136, 329: the header button prevents a repeated Enter / Space keydown. Test:
"a held Enter on Reset Border saves Reset only" (failed before the fix).
Closed 2026-11-21 by re-audit (both): the case fails without the guard. A held Space saved once; a single Space or Enter still works.

### 9i/F-09 [P3] closed - Held Enter on a segment button saves once per key repeat

**File:** src/webview/ui/Field.svelte:91-97
**Found:** 2026-11-21 by /audit re-audit (scope: current; lens: correctness; Opus 5.5 reviewer)
**Why it matters:** F-08's guard covers only the section header button. A held Enter on I, U, S or
an Align button fires `click` on each repeat, so each repeat is its own save and undo step. Two
repeats within one animation frame read the same pick (the D8 ceiling). Each save is a real edit,
so this is noise, not data loss. Not probed.
**Suggested fix:** Give the segment buttons the same repeat guard as the header button (one shared
handler, no twin), or accept it with a `ponytail:` note.
**Resolution:** Reproduced (held Enter on Underline toggled it off again on the repeat). New
`ui/keyRepeat.ts` `ignoreKeyRepeat`, shared by the header button and the segment buttons
(Field.svelte:97). Test: "a held Enter on a segment button saves once" (failed before the fix).
Closed 2026-11-21 by re-audit 2 (Opus 5.5 high): a single Enter or Space still toggles; Tab and Shift+Tab are unaffected. The test waits for the save answer, so a queued repeat would be caught. `ui/keyRepeat.ts` has two consumers and is in the rule 08 catalog.

### 9i/F-10 [P3] closed - Spec D9 "Props" lists `invalid` / `describedBy` as common after F-05

**File:** blueprint/context/current-feature.md (D9, Props)
**Found:** 2026-11-21 by /audit re-audit (scope: current; lens: quality; Sonnet 5.5 reviewer)
**Why it matters:** D9 says "Common: `label`, `name`, `set`, `invalid`, `wide`, `describedBy`". After
F-05, `invalid` / `describedBy` exist only on text, textarea and color, and `segments` has no
`label`. The spec is the handoff contract and contradicts `Field.svelte`.
**Suggested fix:** "Common: `name`, `set`, `wide`; `label` on every control but `segments`; `invalid`
and `describedBy` on text, textarea and color".
**Resolution:** Spec D9 Props now: common `name`, `set`, `wide`; `label` on all but `segments`;
`invalid` / `describedBy` on text, textarea and color.
Closed 2026-11-21 by re-audit 2 (Opus 5.5 high): D9 Props matches `Field.svelte` (TextEntry/Labelled split).

### 9i/F-11 [P3] closed - Spec D4 still says the focus refresh is text-field only

**File:** blueprint/context/current-feature.md (D4, first bullet)
**Found:** 2026-11-21 by /audit re-audit (scope: current; lens: quality; Sonnet 5.5 reviewer)
**Why it matters:** D4 reads "Unchanged 9e draft path: `handleFieldFocus`...". After F-07,
`handleFieldFocus` fires on focus of any inspector control (D5 says so), so D4 contradicts D5.
**Suggested fix:** Add one clause to D4 pointing to D5 / F-07.
**Resolution:** Spec D4's first bullet notes that since F-07 `handleFieldFocus` fires for any inspector
control (D5).
Closed 2026-11-21 by re-audit 2 (Opus 5.5 high): D4 and D7 match `Inspector.svelte` (`.body onfocusin`, the destination-only hand-off).

### 9i/F-12 [P3] closed - The Shift+Tab hand-off browser case cannot fail

**File:** tests/browser/editMode.spec.ts:1508 (before deletion)
**Found:** 2026-11-21 by /audit re-audit 2 (scope: current; lens: tests; Opus 5.5 reviewer)
**Why it matters:** Shift+Tab from Width already goes to the Border header button, which never
unmounts, so the case passed in a scratch copy with the hand-off disabled. In that copy the Tab
and Enter cases failed, as they should. Rule 09: a test earns its place when deleting its guard
makes it fail.
**Suggested fix:** Delete the case, or keep it with a comment marking it a deliberate no-regression check.
**Resolution:** Deleted the case (test-only deletion; no product code changed).
Closed 2026-11-21 by re-review (Sonnet 5.5 high): the case is gone, the neighbouring Tab, Enter, click and Gap cases are intact, `emptyWhileDrafted` and `sectionAction` are still used, and `vp check` passes on the file.

## Try it now

Run or do:

Press F5 to open `fixtures/dev-workspace`, run **Cursor Design: Open Artboard**, choose **Edit**,
and click a heading.

Expected:

The inspector shows Text (with Content), Appearance, Spacing and Border. Set values have a blue
dot and full-strength text; inherited values are grey. Click Reset on Text, then Undo once, and
every text style comes back.

This proves:

Sections adapt to the selection, and Reset is a single undo step.

Done in an agent-run check (real Cursor cases a–h); the user doesn't need to repeat it.
