# Feature: More edit fields: saving

**From build-plan:** feature 9h
**Build attempt:** 1
**Branch:** feature/more-edit-fields-saving
**Status:** verified (pnpm verify 754 unit, test:browser 169, inspector gallery 27 of 28 byte-identical and 1 antialias-only; F-162 and F-163 closed, F-164 fixed; F5 not run)

## Goal

The save path (edit core, `artboard:edit`, host) and the frame's pick report learn the 15 new
inspector properties agreed with Bombic on 2026-11-20, plus a save that changes several style
properties at once as one write and one undo step, previewed in the frame by the same rule that
saves it. 9i builds the redesigned inspector on top; in 9h the current inspector looks and
behaves exactly as today.

Revised 2026-11-20 after a Fable 5.2 review (R1–R11) and Bombic's decision on border shorthands
(D3, last bullet), then again after the dual spec review (Breaker, Literalist). The 9i items from
the Fable review live in `blueprint/reference/9i-inspector-notes.md`.

## Design reference

None for 9h (no visible change). 9i's reference is `prototypes/inspector.html` with
`prototypes/theme.css` (approved 2026-11-20); 9h only supplies the data and rules its fields need.

## In scope

- 15 new edit style fields, each with its own value check (D1, D2).
- Shorthand handling for the new properties, including Reset of an inline `border` shorthand (D3).
- One parse5-free rule that applies a list of style changes to a style attribute, shared by the
  edit core and the chrome's live preview (D4).
- A multi-field style edit: one `artboard:edit` sets or clears 1..19 style properties on one
  element, one write, one undo step (D4, D5).
- The frame's Edit-mode pick reports the element's content kind (`plain`, `mixed`, `elements`,
  `too-long`) and the computed values of every edit style field (D6).
- The current inspector switches to the new data with no visible change (D7).
- System map and rule catalogs follow the shipped code.

## Out of scope

- Any inspector UI change: sections, new controls, Reset and Add border buttons, set dot,
  tokens, 296px width, per-rule error copy, gallery states (all 9i; see
  `blueprint/reference/9i-inspector-notes.md`).
- Per-side spacing fields, font family, shadow, text shadow, transform, filter, width / height,
  layout controls; `direction` in `computed` (9i assumes left-to-right, marked `ponytail:`).
- MCP tools, Agent skill text, comment style keys (`COMMENT_STYLE_KEYS`), `comments.json`.
- The Notion 0.4 page patch (when 9i completes, per the build plan).

## Build loop

`workflow.stepReview` is `feature`: build all steps, then one review at the end.
`workflow.checkpointCommits` is `disabled`: no step commits; `/complete` makes the one feature
commit. After each step run the narrow tests it names and `pnpm verify` (it must stay green);
run `pnpm test:browser` after steps 2, 3 and 4.

Before step 1, on the untouched branch: `CD_GALLERY=1 pnpm test:browser gallery -g inspector`,
then copy `test-results/gallery/*-inspector-*.png` to the session scratchpad as the baseline
for step 4 (the gallery run wipes `test-results/gallery/`).

## Build steps

- [x] **1. Fields, value rules, shorthands and the shared apply rule (disk, pure).**
  `src/disk/layout.ts`: `EDIT_STYLE_FIELDS` grows to the 19 fields of D1, in that order; its
  comment no longer says the inspector derives its fields from it. `src/disk/editValues.ts`:
  `normalizeStyleValue` applies D2 per field; export the `StyleChange` type and
  `applyStyleChanges` (D4). `src/disk/inlineStyle.ts`: D3 (new longhand lists; the later-parent
  rule generalized from today's `font-size` / `font` special case; the `ponytail:` at the
  `setStyleProperty` doc extended per D3); export `BORDER_PARENTS` and `removeStyleProperties`
  (today's private `removeProperties`, renamed and exported, same `(styleText, properties:
  ReadonlySet<string>)` signature). `src/webview/editInspector.ts`: pin the current inspector's
  own field list (D7): `INPUT_FIELDS` becomes the literal `['font-size', 'padding', 'margin'] as
  const` and `InputField` its member type, so `Inspector.svelte` and its `FIELD_LABELS` stay
  untouched.
  **Done when:** `editValues.test.ts` covers every D2 rule with its edge case (line-height `1.6`
  stays unitless, `1.` and `-1.5` are refused, `24px`, `1.5em` and `normal` are written as typed;
  `24` letter-spacing gets px; opacity `1.5`, `-0.1` and `1.` refused; `ITALIC` written `italic`;
  `#fff`, `#ffff`, `#11223344` and `TRANSPARENT` accepted (the last written `transparent`), `#12345`
  and `red` refused (the existing `normalizeStyleValue('color', '#fff') === undefined` assertion
  flips on purpose); font-weight `450` refused; `underline line-through` accepted and
  `line-through underline` refused; a length input that fits `MAX_STYLE_VALUE_CHARS` collapsed
  but passes it once `px` is added refused; `''` clears every field) and `applyStyleChanges` (two
  changes in order, set and clear together, one invalid value refuses the whole list, a duplicate
  field, an empty list and 20 changes each refused as `invalid-value`, appending onto open text
  refused as `unsupported-style`, changes over `styleText: ''` (no style attribute), clearing all
  three border fields removes an inline `border` and `border-bottom` while clearing two of them
  does not); `inlineStyle.test.ts` proves `gap` drops `row-gap`, `border-width` drops
  `border-top-width` but keeps `border-top-style`, `border-radius` drops `border-top-left-radius`,
  and an in-place `text-decoration-line` / `border-color` / `background-color` before a later
  `text-decoration` / `border` / `background` moves to the end; today's `font-size` behaviour
  unchanged; `pnpm verify` green.

- [x] **2. Multi-field style edit end to end (disk, host, chrome).**
  `src/disk/artboardEdit.ts`: `ArtboardEdit` becomes text | styles (D4); `editArtboardHtml`
  re-checks the untrusted shape per D4; `editStyle` calls `applyStyleChanges`.
  `src/webview/hostMessages.ts`: `ArtboardEditMessage` per D5. `src/host/chromeMessages.ts`: the
  D5 schema form. `src/host/panelEdit.ts`: `toArtboardEdit` builds either variant.
  `src/disk/layout.ts`: the `EDIT_FIELDS` comment says what still uses it (the chrome's
  per-field drafts). Chrome: `EditCommit` per D7; `commitDraft` (`src/webview/editDrafts.ts`)
  sends a style draft as `styles: [{ field, value }]`, and `stylePreview` calls
  `applyStyleChanges` (removing its twin of the set / remove branch), mapping `invalid-value` to
  `'invalid-length'` and `unsupported-style` to `'complex-style'`, with today's
  `MAX_PICK_STYLE_CHARS` check on the result also `'complex-style'`; `nextSend`
  (`src/webview/editRequests.ts`) builds the D5 message.
  **Done when:** `artboardEdit.test.ts` proves (diff-exact) a two-change edit on an element with a
  style attribute, on one without (inserted `style="a: 1; b: 2"` in list order), only clears on an
  element without a style attribute as a no-op, one invalid value refusing the whole edit with
  the HTML unchanged, and a `null` and an array entry in `styles` each refused as `invalid-value`
  without throwing; `chromeMessages.test.ts` proves the text shape unchanged (text still requires
  `liveText`), the styles shape accepted, a message carrying both the text fields and `styles`
  parsed as text, every other chrome message type still parsing, and an empty list, 20 changes, a
  duplicate field, an unknown field, a `value` over `MAX_EDIT_TEXT_CHARS` and the pre-9h
  single-style shape (`field: 'color', value`) all malformed without throwing; a `panelEdit` test
  proves a two-change save writes once and one Undo restores both declarations; the existing
  `editDrafts.test.ts` error-kind cases still pass; every test that builds the old style-edit
  shape moves to the new one (grep `field: 'color'|'padding'|'font-size'|'margin'`; at spec time
  `artboardEdit.test.ts`, `artboardEditFs.test.ts`, `chromeMessages.test.ts`,
  `panelEdit.test.ts`, `panelEdit.history.test.ts`, `editRequests.test.ts`, `editDrafts.test.ts`);
  in `tests/browser/editMode.spec.ts` the assertions on the posted edit's top-level `value` /
  `field` (lines 457, 552, 563 at spec time) read `styles[0]` instead, and the whole spec passes;
  `pnpm verify` green.

- [x] **3. Frame report: content kind and computed values.**
  `src/webview/frame/editTarget.ts`: `describeEditTarget` returns the D6 `textState` and
  `computed` (DOM reads only: `childNodes`, and `window.getComputedStyle(element)` as
  `selector.ts` already does). `src/webview/frame/selector.ts`: `readStyles` takes the key list
  (default `COMMENT_STYLE_KEYS`, return type keyed by the list) so both reads share one sanitizer.
  `src/webview/frame/frameMessages.ts`: `PICK_TEXT_STATES`, `PickEditFields` and `parsePickEdit`
  per D6. Chrome: `src/webview/editInspector.ts` reads placeholders and the computed colour from
  `edit.computed` and maps `mixed` and `elements` to today's hint (D7). Move every `'children'`
  text-state use: `editTarget.ts`, `frameMessages.ts`, `editInspector.ts`, `Inspector.svelte`'s
  `TEXT_HINTS.children` key only if the view type requires it, their tests and `editMode.spec.ts`
  (the `'children'` hits in other `.svelte` files are snippet props, not text states).
  `src/webview/frame/runtime.test.ts`: re-baseline `RUNTIME_SIZE_BUDGET` (at spec time the
  runtime is 35,017 characters against a 35,135 budget, too little room for 9h): new budget =
  the size measured after this step + 4,096, and the `ponytail:` note names that baseline and 9h
  as the reason. `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` (embeds the runtime):
  update on purpose with `vp test -u src/disk/handoffCanvasHtml.test.ts`, then read the diff:
  it holds only the runtime code this step changed.
  **Done when:** `frameMessages.test.ts` proves a pick with `computed` round-trips, a computed
  key outside `EDIT_STYLE_FIELDS`, an empty or unsafe value and a missing `computed` each reject
  the whole pick, the retired `'children'` state rejects it, and `text` must still be `''` unless
  `plain`; `editInspector.test.ts` proves placeholders come from `edit.computed` and both new
  states show the hint; the unit tests that build picks move to the new shape
  (`commentPick.test.ts`, `selector.test.ts` and any other a grep finds); `runtime.test.ts` passes
  at the new budget; `handoffCanvasHtml.test.ts` passes with the reviewed snapshot; in
  `editMode.spec.ts` the exact `edit` object (lines 89–95 at spec time) gains
  `computed: expect.any(Object)`, the `#mixed` / `#commented` expectation (line 135) becomes
  `'mixed'`, the page-pick (body) expectation (line 182) becomes `'elements'`, the forged pick
  (lines 256–259) carries a well-formed `computed`, and a new case (through `lastPick`) proves
  `#title` reports `plain` and `computed` matching `expect.objectContaining({ 'font-size':
  '32px', 'font-weight': '700', 'text-align': 'start' })`; the whole spec passes; `pnpm verify`
  green.

- [x] **4. Docs and gates.**
  `blueprint/context/system-map.md`: the Message contract rows for `artboard:edit` and
  `cd:pick`, the 9c, 9d and 9e sequence lines that print those payloads, and the "Last verified"
  line. Rule 02 bullet 6 (`.claude/rules/02-mcp-webview.md`): Edit mode's `edit.computed` keys
  come from `EDIT_STYLE_FIELDS`, its values use the same style value charset, and it is shown only
  as field values and placeholders, never in an Agent prompt. Rule 05 catalog (`editValues.ts`:
  `StyleChange`, `applyStyleChanges`; `inlineStyle.ts`: `removeStyleProperties`,
  `BORDER_PARENTS`) and rule 08 catalog (`readStyles` takes keys). `skills/cursor-design/SKILL.md`
  needs no change (no tool, argument, error code, limit or CSP change); `agentSkill.test.ts` must
  still pass.
  **Done when:** `pnpm verify` and `pnpm test:browser` green; `CD_GALLERY=1 pnpm test:browser
  gallery -g inspector` shots match the scratchpad baseline: `cmp` per PNG, and any file that
  differs is viewed side by side with its baseline, where a visible difference fails the step;
  the result is recorded as evidence (the existing placeholder assertions in `editMode.spec.ts`
  back this up); the map rows match the shipped types word for word.

## Files / areas

- Disk: `src/disk/layout.ts`, `src/disk/editValues.ts` (+ test), `src/disk/inlineStyle.ts`
  (+ test), `src/disk/artboardEdit.ts` (+ test), `src/disk/artboardEditFs.test.ts`,
  `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap` (reviewed update, step 3).
- Host: `src/host/chromeMessages.ts` (+ test), `src/host/panelEdit.ts` (+ `panelEdit.test.ts`,
  `panelEdit.history.test.ts`).
- Wire types: `src/webview/hostMessages.ts`, `src/webview/frame/frameMessages.ts` (+ test).
- Frame runtime: `src/webview/frame/editTarget.ts`, `src/webview/frame/selector.ts` (+ test),
  `src/webview/frame/runtime.test.ts` (budget re-baseline) (embedded in the exported
  `canvas.html`: keep additions small).
- Chrome: `src/webview/editInspector.ts` (+ test), `src/webview/editDrafts.ts` (+ test),
  `src/webview/editRequests.ts` (+ test), `src/webview/commentPick.test.ts`; `Inspector.svelte`
  only if the text-state rename needs it (Svelte autofixer on any `.svelte` edit, rule 08).
- Browser: `tests/browser/editMode.spec.ts` (fixture `fixtures/edit.html` unchanged).
- Docs: `blueprint/context/system-map.md`, `.claude/rules/02-mcp-webview.md`,
  `.claude/rules/05-single-job.md`, `.claude/rules/08-svelte-chrome.md`.

## Data / contracts

### D1. Fields

`EDIT_STYLE_FIELDS` (order is the list order everywhere it is iterated):
`font-size`, `color`, `padding`, `margin` (unchanged, first), then `font-weight`, `font-style`,
`text-decoration-line`, `text-align`, `line-height`, `letter-spacing`, `text-transform`,
`background-color`, `border-radius`, `overflow`, `opacity`, `gap`, `border-width`,
`border-style`, `border-color`. `EDIT_FIELDS` stays `['text', ...EDIT_STYLE_FIELDS]`.

### D2. Value rules (`normalizeStyleValue`, the one rule for chrome preview and edit core)

The input is collapsed and trimmed first, as today; `''` clears the declaration for every field;
a written value over `MAX_STYLE_VALUE_CHARS` is refused for every field (today's check, now for
every field; a written value is never shorter than the collapsed input, so this caps both). Then
by field, returning the written value or `undefined` (refused):

| Fields | Rule | Written |
|---|---|---|
| `font-size`, `padding`, `margin`, `letter-spacing`, `gap`, `border-radius`, `border-width` | today's length rule unchanged (allowed characters, balanced parentheses, bare numbers outside parentheses get `px`) | as today |
| `color`, `background-color`, `border-color` | `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (hex, any case), or `transparent` (any case) | hex as typed; `transparent` lowercase |
| `line-height` | one unsigned number with a digit after any dot (`1`, `1.6`, `.5`) is kept unitless; any other single bare number (`1.`, `-1.5`, `+2`, anything today's `BARE_NUMBER` matches) is refused, never given `px`; anything else goes through the length rule (`24px`, `1.5em`, `normal`, matched as typed with no lowercasing) | number as typed, else as the length rule |
| `opacity` | one unsigned number with a digit after any dot whose value is 0 to 1 inclusive | as typed |
| `font-weight` | `100` `200` `300` `400` `500` `600` `700` `800` `900` | as typed |
| `font-style` | `normal`, `italic` | lowercase |
| `text-decoration-line` | `none`, `underline`, `line-through`, `underline line-through` | lowercase |
| `text-align` | `left`, `center`, `right`, `justify` | lowercase |
| `text-transform` | `none`, `uppercase`, `lowercase`, `capitalize` | lowercase |
| `overflow` | `visible`, `hidden`, `clip`, `scroll`, `auto` | lowercase |
| `border-style` | `none`, `solid`, `dashed`, `dotted`, `double` | lowercase |

- Keyword fields match after ASCII lowercasing.
- These lists are exactly what 9i's controls offer (Weight names all nine; see the 9i notes). A
  value the design already uses outside a list shows in 9i but saves only after a pick from it.
- Every written value keeps today's guarantee: no quote, `&`, `<`, `>`, `;`, `:`, `\`, `!`, braces
  or comment, so it is safe in any attribute quoting and cannot end or swallow another
  declaration.
- Invariant: no field that can take an image or `url()` (`background`, `background-image`,
  `border-image`, `list-style`, …) may use the length rule; `url(//host/x)` passes the length
  characters, so such a field needs its own rule first.

### D3. Shorthands (`inlineStyle.ts`)

- **Longhands dropped when the shorthand is set or cleared** (today: padding, margin). Add:
  - `gap` → `row-gap`, `column-gap`, `grid-gap`, `grid-row-gap`, `grid-column-gap`
  - `border-radius` → `border-{top-left,top-right,bottom-right,bottom-left}-radius`,
    `border-{start-start,start-end,end-start,end-end}-radius`
  - `overflow` → `overflow-x`, `overflow-y`, `overflow-block`, `overflow-inline`
  - `border-width` → its own `-width` longhands only: `border-{top,right,bottom,left}-width`,
    `border-{block,inline}-width`, `border-{block-start,block-end,inline-start,inline-end}-width`
  - `border-style` → the same ten sides with `-style` only
  - `border-color` → the same ten sides with `-color` only

  Setting `border-width` never touches a `-style` or `-color` longhand, and so on.
- **A later parent shorthand would override an in-place set** (today: `font-size` before a later
  `font`). Generalize to a parent table: `font-size`, `font-weight`, `font-style`, `line-height`
  → `font`; `text-decoration-line` → `text-decoration`; `background-color` → `background`;
  `border-width`, `border-style`, `border-color` → `BORDER_PARENTS`: `border`,
  `border-{top,right,bottom,left}`, `border-block`, `border-inline`,
  `border-{block-start,block-end,inline-start,inline-end}`. When a parent's declaration follows
  the field's last declaration, the field's declaration is removed and appended at the end
  (today's mechanism), else it changes in place.
- Ceiling (extend the `ponytail:` on `setStyleProperty`): a moved declaration loses its own
  `!important`, and a parent marked `!important` still wins after the move; same as today's
  `font-size` / `font` case. Upgrade path: keep the flag on move and compare importance.
- Clearing a field removes only its own declarations and its longhands; an inline `font` or
  `background` parent stays (it also carries the family or an image).
- **Border Reset (Bombic, 2026-11-20):** after the list is applied, a change list that clears all
  three of `border-width`, `border-style` and `border-color` also removes every `BORDER_PARENTS`
  declaration through `removeStyleProperties`, so Reset on Border removes
  `style="border: 1px solid #ddd"` and `border-bottom: …`. Clearing one or two of them leaves
  the parents. 9i shows the set dot on a border field when the field, a longhand of it or a
  border parent is inline; the tables stay in `inlineStyle.ts` for 9i to export.

### D4. The apply rule and the edit core

```ts
// editValues.ts (parse5-free; chrome and host import it)
export type StyleChange = { field: StyleField; value: string };

// Normalizes every value first, then sets or removes in list order (D3, including the border
// Reset rule). `styleText` '' when the element has no style attribute.
export const applyStyleChanges = ({
	styleText,
	changes,
}: {
	styleText: string;
	changes: readonly StyleChange[];
}): { ok: true; styleText: string } | { ok: false; refusal: 'invalid-value' | 'unsupported-style' };

// artboardEdit.ts
export type ArtboardEdit =
	| { sourceNumber: number; field: 'text'; value: string; liveText: string }
	| { sourceNumber: number; styles: readonly StyleChange[] };
```

- `applyStyleChanges`: an empty list, more than `EDIT_STYLE_FIELDS.length` entries or a repeated
  field → `invalid-value`; any value `normalizeStyleValue` refuses → `invalid-value` before
  anything changes; appending onto text that ends open → `unsupported-style`. The chrome's
  `stylePreview` adds its `MAX_PICK_STYLE_CHARS` check on the result as today.
- `editArtboardHtml` re-checks the untrusted shape (as today), in this order:
  1. Variant: `field === 'text'` selects the text variant (today's checks); anything else must be
     the styles shape: `styles` an array whose every entry is a non-null, non-array object with
     `field` in `EDIT_STYLE_FIELDS` and a string `value`. Any failure → `invalid-value`, never a
     throw.
  2. Number lookup, `unknown-number` and `shared-number` as today.
  3. Apply: `unsupported-style` as today for a merged duplicate start-tag style and an unquoted
     value holding `"`; `applyStyleChanges` refusals pass through.
- No style attribute: `applyStyleChanges` over `''`; a non-empty result is inserted as
  ` style="…"` after the tag name; an empty result is a no-op.
- Result equal to the input → `{ ok: true, html }` (the host answers same bytes, no write, no
  history entry, as today).
- One `editArtboard` call writes once, so `recordEdit` records one undo step for the whole list
  (no history change needed).

### D5. `artboard:edit` (chrome → host, untrusted)

```ts
type ArtboardEditMessage = {
	type: 'artboard:edit';
	requestId: string;
	frameId: string;
	sourceNumber: number;
	hash: string;
} & (
	| { field: 'text'; value: string; liveText: string }
	| { styles: StyleChange[] }
);
```

- Schema form: both edit variants share `type: 'artboard:edit'`, so they sit beside the
  discriminated union: `chromeMessageSchema` becomes
  `z.union([z.discriminatedUnion('type', [every other message]), artboardEditTextSchema,
  artboardEditStylesSchema])`. Text: `field: z.literal('text')`, `value` and `liveText` both
  required, each at most `MAX_EDIT_TEXT_CHARS`. Styles: `styles` array, min 1, max
  `EDIT_STYLE_FIELDS.length`, entries `{ field: z.enum(EDIT_STYLE_FIELDS), value: string at most
  MAX_EDIT_TEXT_CHARS }`, a refine for distinct fields. `parseChromeMessage` still never throws.
- The text schema is tried first and unknown keys are stripped, so a message carrying both the
  text fields and `styles` parses as text (the chrome never sends both).
- Anything else is malformed and gets `MALFORMED_EDIT_MESSAGE`, including the pre-9h
  single-style shape: the chrome and host ship in one `.vsix`, so there is no compatibility
  path.
- Answers unchanged: once, `artboard:edited {requestId, frameId, hash, generation, html,
  canUndo, canRedo}` or `ui:error {requestId, message}`; refusal copy unchanged
  (`EDIT_REFUSED_MESSAGES`).

### D6. `cd:pick` `edit` (frame → chrome, untrusted)

```ts
const PICK_TEXT_STATES = ['plain', 'mixed', 'elements', 'too-long'] as const;

type PickEditFields = {
	sourceNumber: number | null;
	sharedNumber: boolean;
	textState: (typeof PICK_TEXT_STATES)[number];
	text: string; // the text node's full data iff 'plain', '' otherwise (unchanged)
	style: string | null; // unchanged
	computed: Partial<Record<EditStyleField, string>>;
};
```

- `plain`: no child nodes or exactly one text node (unchanged). `too-long`: plain but over
  `MAX_EDIT_TEXT_CHARS` (unchanged). Otherwise (today's `children`, the `hasOtherContent` rule,
  comments count as other content): `mixed` when at least one child Text node holds a character
  other than ASCII whitespace (tab, LF, FF, CR, space), else `elements`.
- `computed`: for each `EDIT_STYLE_FIELDS` key, the edit target's value from
  `window.getComputedStyle(element)` through `readStyles` with that key list (control
  characters dropped, space runs collapsed, kept only when `isSafeStyleValue`, which refuses
  `''`, so empty and unsafe values are omitted); `{}` for a disconnected target. A page pick's
  edit target is `body`, as today. Values pass through as Chromium serializes them (`start`,
  `400`, `rgb(…)`, `normal`, multi-value borders); 9i maps them for display.
- Sources: `edit.computed` is the one source of every edit field's current value (9h
  placeholders and the colour swatch, every 9i field). The pick's `styles` stays the comment
  record (`COMMENT_STYLE_KEYS`, feeding `comments.json` and Agent prompts, out of scope) and is
  where `display` lives: 9i's Gap flex / grid check reads `pick.styles.display`, not
  `edit.computed`.
- `parsePickEdit`: `computed` is required and must be a non-array record whose keys are all in
  `EDIT_STYLE_FIELDS` and whose values all pass `isSafeStyleValue`; otherwise the whole `cd:pick`
  is rejected (the `parseStyles` rule). The `edit` record is rebuilt from its known keys (any
  extra key on `edit` is dropped), and `computed` from its allowlisted keys. Values are shown
  only as field values and placeholders, never in an Agent prompt.
- Comment-mode picks, `styles` and `COMMENT_STYLE_KEYS` are unchanged.

### D7. Chrome

- `editInspector.ts` keeps its own field list (`font-size`, `padding`, `margin`, plus the colour
  swatch) instead of deriving it from `EDIT_STYLE_FIELDS`; placeholders and the computed colour
  come from `edit.computed`; view text state `mixed` and `elements` both show today's
  `TEXT_HINTS.children` copy. The rendered inspector is unchanged.
- `EditCommit = { key; field: 'text'; value; liveText } | { key; styles: StyleChange[] }`.
  `commitDraft` sends a style draft as one change; `nextSend` copies the commit's variant onto
  the message. Drafts stay one per field; 9i adds the multi-change commits (Reset, Add border)
  and their preview through `applyStyleChanges`.

### Error and edge behaviour

| Case | Result |
|---|---|
| any change's value refused by D2 | whole edit refused, `invalid-value` copy, no write, no history |
| duplicate field, empty list, over 19 changes | host: malformed copy; the edit core also refuses (`invalid-value`) |
| unknown field, non-object entry, pre-9h single-style shape | host: malformed copy; the edit core refuses (`invalid-value`) without throwing |
| style attribute the core can't safely edit | `unsupported-style` copy (unchanged) |
| result equals the file | `artboard:edited` with no write and no history entry (unchanged) |
| frame posts a bad or missing `computed`, or the old `children` state | whole `cd:pick` dropped (no inspector change) |

## Testing

- Unit (Vitest, `pnpm test`): `editValues.test.ts`, `inlineStyle.test.ts`,
  `artboardEdit.test.ts`, `chromeMessages.test.ts`, a `panelEdit` test for one write and one undo
  step, `frameMessages.test.ts`, `editInspector.test.ts`, `runtime.test.ts` (re-baselined size),
  `handoffCanvasHtml.test.ts` (reviewed snapshot); edge cases as each step's Done when lists, not
  volume. Tests that build the old shapes move to the new ones.
- Browser (`pnpm test:browser`, local): `editMode.spec.ts` assertions move in steps 2 and 3, new
  cases in step 3; the whole spec passes after each.
- Gallery (local evidence): the inspector shots match the pre-step-1 baseline (`cmp`, then a
  visual check of any file that differs).
- Not claimed: no F5 or real-Cursor run in 9h (no visible change); 9i ends with the real-Cursor
  check.

## Notes for the AI

- Rule 05: extend the owners (`normalizeStyleValue`, `setStyleProperty`, `readStyles`,
  `describeEditTarget`, `parsePickEdit`); `applyStyleChanges` is the one apply rule and replaces
  `stylePreview`'s twin. The keyword lists live next to `normalizeStyleValue` in
  `editValues.ts`; the longhand and parent tables in `inlineStyle.ts`.
- Rule 02: no data 9h adds (`computed`) reaches the frame copy, disk or export, and `computed`
  never reaches an Agent prompt. The exported `canvas.html` does embed the changed runtime code;
  that change is expected (snapshot reviewed in step 3). Step 4 updates rule 02 bullet 6.
- The frame runtime is embedded in exported `canvas.html` (rule 05): keep `editTarget.ts`
  additions to a key loop and a whitespace test.
- The line numbers in step 2 and 3 Done-whens are as of spec time; find the assertions by what
  they check if they moved.
- Lint and naming: rule 04 (full words, object args for 3+ params). Svelte edits, if any: the
  Svelte MCP autofixer until clean (rule 08).


<!-- blueprint:completion {"schemaVersion":2,"specBytes":28113,"specSha256":"7e24c7c3eed2d2b4518b8e3fb47a881a91091f9322e9405c52712a89cebc111f","branch":"refs/heads/feature/more-edit-fields-saving","head":"f5d4e3407cab21a25ae8bdbf89ed70daa003f251","baseRef":"refs/heads/main","baseCommit":"17228e03898810b171f48975aef8a148a28320ab","sourceTree":"6f96ba07235140ff1c7f8f9fbaa7b0926daccfaa","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9h/F-90 [P3] accepted - The open panel rebuilds every item on each cd:anchor-rects and drag move

**File:** src/webview/App.svelte:186
**Found:** 2026-11-16 by /audit (scope: current; lens: performance)
**Why it matters:** `panelItems` returns new objects whenever `anchors` or `displayFrames` change: up to once per animation frame per frame while a target moves, and on every pointermove during a drag. Each keyed card then gets a new `item` and a fresh `target={{…}}` literal (up to `MAX_COMMENTS` = 500), and both focus effects re-run. The closed panel costs nothing. No profile shows a dropped frame yet.
**Suggested fix:** None now. If profiling shows it, keep item identity when badge, label and `canJump` are unchanged, or pass `frameLabel` / `canJump` as scalar props instead of a fresh object.
**Resolution:**
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 6097011..d72811d): stays `unverified`. Re-read App.svelte `commentItems` and CommentsPanel: unchanged since the finding; no profile was run in this pass.
2026-11-17 independent /audit (fresh subagent, claude-opus-5-5; scope: current; lens: quality, security, performance, tests; 583bb93..9304fec): stays `unverified`. 8h passes three more props per card (`copyBlocked`, `copied`, `onCopy`) and adds the Copy all open row but leaves `commentItems` / `panelItems` unchanged; no profile was run in this pass.
2026-11-18 /audit current (fresh reviewer, all lenses): still unverified. App now builds `panelItems` from the committed `frames`, not `displayFrames`, so a drag move no longer rebuilds the list; the per-`cd:anchor-rects` rebuild remains.
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): measured in the browser harness on the packaged chrome. One frame with 500 open comments, the Comments panel open with 500 items, and a 3 s scroll inside the frame; three identical runs. 180 `cd:anchor-rects` (about 60 per second) and 0 long tasks during the scroll. The only long task, 136–146 ms, happens once when the panel opens (the first render of 500 items), not on each rebuild. Judged on the scroll window. This is evidence for `accepted`, which needs Bombic's decision.
2026-11-20 accepted by Bombic ("accept them"), on the 9g evidence: 0 long tasks while 500 comment anchors moved at about 60 updates per second. The only long task was a one-time 136–146 ms render when the panel opens. No code change.

### 9h/F-125 [P3] accepted - parse5's tree can differ from the frame's Chromium tree on rare markup

**File:** src/disk/commentTarget.ts (`parseArtboardDocument`)
**Found:** 2026-11-18 by /audit (scope: current; both fresh reviewers; predates this change, same under css-select)
**Why it matters:** A file without a doctype parses in quirks mode on disk (`<p>a<table>`: `p > table`) but the frame copy is re-serialized with `<!DOCTYPE html>`; `<template shadowrootmode>` is removed by Chromium but kept by parse5; Chromium keeps a `div` inside `<select>` that parse5 8.1.1 drops. Comments on such pages can read missing or shift by one. Not traced against real artboards.
**Suggested fix:** None in this fix. Track; a later fix could parse the disk file the way the frame copy is built.
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): case M in real Cursor. On `quirks` and `select`, a comment on the `h2` after the construct reads `stale: false`, `targetMissing: false`, `hint: null`. As written, `shadow` hides its `h2`: the template is a direct child of `body`, so Chromium attaches a slotless shadow root and the `h2` cannot be clicked. A `shadow2` variant with the template inside a `div` reads clean. The trees do diverge as predicted (an extra untagged `<p></p>` in quirks, an untagged `div` in `select`, the template removed). Only the unique `h2` was commented, so a selector that depends on position was not exercised. Weak evidence for accepting; one comment on the `p` after the table and one on the `div` in `select` would settle it.
2026-11-20 accepted by Bombic ("accept them"), on the 9g evidence: comments after quirks-mode tables, shadow-root templates and a `div` in `select` read clean in a real Cursor run. The tree divergence is real but did not affect those comments; the evidence is weak (only unique targets were commented). No code change.

### 9h/F-144 [P3] accepted - A style preview re-reads the picked element's whole innerText on every keystroke

**File:** src/webview/frame/commentPicking.ts:159
**Found:** 2026-11-19 by /audit independent (scope: current; lens: performance; fresh subagent claude-opus-5-5)
**Why it matters:** Every `cd:edit-apply` on the picked element runs `refreshCurrent`, which calls `describeContent` (`selector.ts:137`: `element.innerText` of the whole subtree, a forced layout, then `getComputedStyle`) plus `describeEditTarget` (a document-wide `querySelectorAll`), and re-posts the pick. One `input` event = one preview, so typing a padding or font-size value on a large container (a `<main>` with most of the page) repeats that per keystroke, where 9d did it once per click. The text excerpt cannot change from a style-only preview. Not measured; on typical leaf elements the cost is small.
**Suggested fix:** Measure in the F5 check (type into Padding with a large section picked). If noticeable, keep the cached `text` excerpt in `refreshCurrent` after a `style` apply and recompute only `styles` and `edit`. Otherwise accept under a `ponytail:` note.
**Resolution:**
2026-11-20 /audit current (9g; two fresh subagents, claude-opus-5-5 docs vs code and claude-sonnet-5-5 evidence integrity; evidence under the 9g session scratchpad `9g/`, summarized in the 9g spec Testing section): case N in real Cursor, on a `<main>` with 2,800 descendants and 72k characters of `innerText`. The spec's listener-pair method read 0 ms, because on `window` Chromium fires listeners in registration order. With `t0` taken from the runtime's own `setAttribute('style')` and `t1` from a later listener, on the Margin field with the same keystrokes: 20 previews, median 5.5 ms, max 7.5 ms, 0 long tasks, 0 long animation frames. Measured on an M4. This is evidence for `accepted` under a `ponytail:` note, which needs Bombic's decision.
2026-11-20 accepted by Bombic ("accept them"), on the 9g evidence: a style preview on a `<main>` with 2,800 descendants costs a median of 5.5 ms (max 7.5 ms) per keystroke, with no long tasks. No code change.

### 9h/F-162 [P3] closed - EDIT_FIELDS is a dead runtime value that leaves a stray statement in every exported canvas.html

**File:** src/disk/layout.ts:78
**Found:** 2026-11-20 by /audit (scope: current; lens: quality, performance)
**Why it matters:** 9h moved the host schema and the edit core off `EDIT_FIELDS` (they now use `EDIT_STYLE_FIELDS` and the `styles` shape), so its only remaining use is `import { type EDIT_FIELDS }` in `src/webview/editRequests.ts:2` for the `EditField` type. The value is dead. Because the frame runtime now imports `EDIT_STYLE_FIELDS` as a value, the bundler keeps the side-effect-shaped spread of the dead constant as a bare `[...EDIT_STYLE_FIELDS];` statement in the runtime embedded in every exported `canvas.html` (see `src/disk/__snapshots__/handoffCanvasHtml.test.ts.snap:47`). This is builder deviation 6. It is harmless at runtime and costs a few bytes. It is still dead code that ships to users, and rule 05 lists `EDIT_FIELDS` as a shared constant it no longer is.
**Suggested fix:** Delete `EDIT_FIELDS` from `layout.ts`. In `editRequests.ts`, write `export type EditField = 'text' | StyleField` (from `../disk/editValues`) or `'text' | EditStyleField`. Drop `EDIT_FIELDS` from the rule 05 layout bullet. Then re-run `vp test -u src/disk/handoffCanvasHtml.test.ts` and confirm the `[...EDIT_STYLE_FIELDS];` lines are gone. Requirement lost: none.
**Resolution:**
2026-11-20 fixed before review: `EDIT_FIELDS` deleted from `layout.ts`; `EditField` in `editRequests.ts` is now `'text' | StyleField`; rule 05's layout bullet names `EDIT_STYLE_FIELDS` instead; snapshot re-run with `vp test -u src/disk/handoffCanvasHtml.test.ts`, no `[...EDIT_STYLE_FIELDS];` left; `pnpm verify` exit 0 (754 tests).
2026-11-20 closed by independent review (/audit independent current, fresh subagent, claude-opus-5-5, target 7e625fc): at the target, `rg EDIT_FIELDS` finds nothing in `src/`, `.claude/rules/` or the system map; `src/webview/editRequests.ts:22` reads `export type EditField = 'text' | StyleField`; the snapshot holds `var EDIT_STYLE_FIELDS = [` (used by `computedOf`) and zero `[...EDIT_STYLE_FIELDS];` statements. The repair introduced no new defect.

### 9h/F-163 [P3] closed - A sparse `styles` array makes the edit core throw instead of refusing

**File:** src/disk/artboardEdit.ts:67
**Found:** 2026-11-20 by /audit independent (scope: current; lens: quality, security, tests)
**Why it matters:** D4 says the edit core re-checks the untrusted shape and any failure is `invalid-value`, "never a throw", and `artboardEdit.test.ts` names that contract. `checkedEdit` uses `styles.every(isStyleChange)`, and `Array.prototype.every` skips holes, so `styles: [, { field: 'color', value: '#fff' }]` passes. `applyStyleChanges` (`src/disk/editValues.ts:158-167`) then counts 2 distinct fields (the Set sees the hole as `undefined`) and destructures the hole in `for (const { field, value } of changes)`, which throws a `TypeError`. Checked in Node: `[, {f: 1}].every(...)` is `true` and the `for...of` destructure throws; `structuredClone` keeps the hole. It cannot happen through the shipped path today: `parseChromeMessage`'s zod array schema refuses the hole (checked: `safeParse` is `false`), and `editArtboard` is the core's only caller (via `panelEdit.ts`). So this is defense in depth that does not hold, not a reachable bug.
**Suggested fix:** In `checkedEdit`, check every index rather than every present element, e.g. `Array.from(styles).every(isStyleChange)` (holes become `undefined` and fail `isStyleChange`), and return that copy. Add `{ sourceNumber: 0, styles: [, { field: 'color', value: '#000000' }] }` to the "malformed edit shape is refused without throwing" list in `artboardEdit.test.ts`. Requirement lost: none.
**Resolution:**
2026-11-20 fixed: `checkedEdit` checks `Array.from(styles)` (holes become `undefined` and fail `isStyleChange`) and returns that copy. `artboardEdit.test.ts` adds a list with a hole at index 0 (`Object.assign([], { 1: … })`, since lint bans a sparse literal) to the malformed-shape cases. Without the fix the test throws the `TypeError`; with it, 17 of 17 pass.
2026-11-20 closed by independent review (/audit independent current, fresh subagent, claude-opus-5-5, target c47aedb): `src/disk/artboardEdit.ts:71` copies `Array.from(styles)` before `every(isStyleChange)` and hands that dense copy (never the caller's array) to `applyStyleChanges`, so a hole is `undefined` and refused as `invalid-value`. `src/disk/artboardEdit.test.ts:78-79` holds the hole-at-0 case; `vp test` over `artboardEdit`, `editValues` and `inlineStyle` passes 45 of 45, and `pnpm verify` passes 754 of 754. Separately checked: zod's `styles` array refuses a sparse array of length 10,000,000 in under 1 ms, so the host schema cannot be made to loop over a huge hole-filled list. The repair introduced no new defect.

### 9h/F-164 [P3] closed - The 9i prototype files ship inside the `.vsix`

**File:** .vscodeignore:1
**Found:** 2026-11-20 by /audit independent (scope: current; lens: quality)
**Why it matters:** This delta adds the throwaway mockup `prototypes/inspector.html` and its `prototypes/theme.css` and `prototypes/vscode-host.css` (about 46 KB in total). `.vscodeignore` excludes `blueprint/**`, `fixtures/**` and the other dev trees, but not `prototypes/**`, and `package.json` has no `files` list. `vsce ls --no-dependencies` (the cached `@vscode/vsce` 3.9.2 that `pnpm vsix` uses) lists all three files in the package, next to `dist/`, `media/` and `skills/`. So the next `pnpm vsix` would install a dev-only design mockup in every user's extension folder. It does no harm at runtime and nothing loads it, but it is dead weight that ships.
**Suggested fix:** Add `prototypes/**` to `.vscodeignore`, then confirm `vsce ls --no-dependencies` no longer lists it. Nothing is deleted from the repo. Requirement lost: none.
**Resolution:**
2026-11-20 fixed: `.vscodeignore` adds `prototypes/**` after `fixtures/**`. `vsce ls --no-dependencies` (cached @vscode/vsce 3.9.2, no network) lists 10 files: package.json, README.md, LICENSE, CHANGELOG.md, dist/mcp.js, dist/extension.js, media/artboard-panel.png, skills/cursor-design/SKILL.md, dist/webview/chrome.js and chrome.css; no `prototypes/` path.
2026-11-20 closed by independent review (/audit independent current, fresh subagent, claude-opus-5-5, target f5d4e34): `.vscodeignore:22` holds `prototypes/**`. `vsce ls --no-dependencies` (the cached pnpm dlx @vscode/vsce 3.9.2, run with node, no network) lists 10 files: package.json, README.md, LICENSE, CHANGELOG.md, media/artboard-panel.png, dist/mcp.js, dist/extension.js, skills/cursor-design/SKILL.md, dist/webview/chrome.js and chrome.css; no `prototypes/` path. The repair introduced no new defect.

## Independent review

**Status:** passed
**Target commit:** f5d4e3407cab21a25ae8bdbf89ed70daa003f251
**Base commit:** 17228e03898810b171f48975aef8a148a28320ab
**Base ref:** main
**Spec hash:** 7e24c7c3eed2d2b4518b8e3fb47a881a91091f9322e9405c52712a89cebc111f
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-20T22:10:17Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-20T22:16:02Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Commands

- `git rev-parse HEAD`, `git merge-base main HEAD`, `shasum -a 256 blueprint/context/current-feature.md`, `git status --porcelain`: pass (HEAD = target, merge base = base, spec hash matches, only `blueprint/context/review.md` differs; spec tracked, no snapshot)
- `pnpm verify`: pass (exit 0; vp check clean over 203 files, agent rules, svelte-check, tsc webview tests, 60 files / 754 tests, vp pack, webview build)
- `pnpm test:browser`: pass (exit 0; 169 passed, 198 skipped = the `CD_GALLERY`-gated gallery; 33 `editMode.spec.ts` cases passed)
- `node <cached pnpm dlx @vscode/vsce 3.9.2>/vsce ls --no-dependencies`: pass (10 files, no `prototypes/`)
- Scratch probe of `applyStyleChanges` / `normalizeStyleValue` edge cases via jiti (in the session scratchpad, not the repo): pass (behaviour matches D2 / D3)

## Evidence

- Reviewed the full `17228e0..f5d4e34` delta (44 files): disk (`layout.ts`, `editValues.ts`, `inlineStyle.ts`, `artboardEdit.ts`), host (`chromeMessages.ts`, `panelEdit.ts`), wire types (`hostMessages.ts`, `frameMessages.ts`), frame runtime (`editTarget.ts`, `selector.ts`), chrome (`editDrafts.ts`, `editRequests.ts`, `editInspector.ts`), every changed test, `editMode.spec.ts`, rules 02 / 05 / 08, system map, build plan, `.vscodeignore`; prototypes and 9i notes read as docs only.
- Security: the edit core re-checks the untrusted shape (`checkedEdit`, dense copy via `Array.from`), the zod union strips unknown keys and caps `styles` at 19 distinct fields of at most `MAX_EDIT_TEXT_CHARS`; every written value (hex, `transparent`, keyword lists, unsigned numbers, length rule) is free of quotes, `;`, `:`, `<`, `&`, `!`, braces and comments; colour fields never use the length rule (`url()` only reaches non-image fields, where the browser ignores it); unquoted style attributes are rewritten quoted. `edit.computed` keys are allowlisted and values pass `isSafeStyleValue`, used only as placeholders and the swatch, never in an Agent prompt.
- Snapshot `handoffCanvasHtml.test.ts.snap`: the added and removed lines are only the runtime changes (`EDIT_STYLE_FIELDS` array, `computedOf`, `readStyles(read, keys)`, the mixed / elements test, `NOT_ASCII_WHITESPACE`); no stray statement.
- Probes: border Reset removes `border` and side longhands; `border-color` before a later `border-top` moves to the end; `font-weight` before `font` moves; clearing `text-decoration-line` keeps `text-decoration`; opacity `0.`, `1e0` and a 400-digit value refused; `!important` kept on an in-place set.
- Fixed finding re-examined: F-164 (`.vscodeignore:22`), closed.

## Findings

- None new. F-164 closed (P3). F-162 and F-163 stay closed; F-90, F-125, F-144 stay accepted.

## Remaining risk

- F5 / real-Cursor run not done (spec claims none for 9h; no visible change intended). The inspector gallery (`CD_GALLERY=1 pnpm test:browser gallery -g inspector`) was not re-run by this reviewer; the builder's baseline comparison was not re-verified.
- Performance not profiled: `computedOf` adds one `getComputedStyle` and 19 reads per pick and per style preview (on top of F-144's accepted cost); judged negligible from code, unmeasured.
- `line-height` with several bare numbers (`1.5 2`) is written as `1.5px 2px` per the D2 length fallback; invalid CSS the browser ignores, harmless.
