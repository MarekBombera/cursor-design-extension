# 9i Inspector redesign: decisions and review notes

Read before `/feature 9i`. Design reference: `prototypes/inspector.html` + `prototypes/theme.css`
(approved by Bombic 2026-11-20). 9h (`More edit fields: saving`) supplies the fields, value
rules, `applyStyleChanges`, multi-field saves and the pick's `textState` / `computed`.

## Decisions (Bombic, 2026-11-20)

1. **Selection kinds.**
   - Text-only element: a Text section with Content.
   - Text mixed with elements: a Typography section, no Content.
   - Container (`elements`): no font settings.
   - Void and raw-text elements: no text section.
   - Every kind gets Appearance, Spacing and Border.
   - The "Contains other elements" banner goes.
2. **Fields.**
   - Text: Content, Size, Color, Weight, Italic / Underline / Strikethrough, Align, Leading, Case, Tracking.
   - Appearance: Background, Radius, Overflow, Opacity.
   - Spacing: Padding, Margin (two separate rows, one shorthand text box each), and Gap, only when computed `display` is flex or grid.
   - Border: Width, Style, Color.
   - No font family, no "Add:" links: every field is always visible.
3. **Reset.** Each section has a Reset, as one multi-field save and one undo step.
   - Reset on Border also removes an inline `border` / `border-<side>` shorthand (9h D3).
   - The set dot shows on a border field when the field, one of its longhands or a border parent is inline.
4. **Units.** Number fields show the whole value as typed (`0.04em`, `11.5px`, `calc(…)`, `normal`), with no separate unit label. The mockup's grey unit suffix is dropped.
5. **Dropdowns and toggles.**
   - The pressed or selected state always shows the current value (computed), set or inherited.
   - The dot means set on this element (inline).
   - Any click saves that value explicitly, even when it's already showing, `normal` and `none` included.
   - A current value outside a list (weight `350`, overflow `hidden auto`) is added to that dropdown as an extra option. It is shown only: 9h's value rules refuse it, so choosing it saves nothing.
   - Weight lists all nine: Thin 100, Extra Light 200, Light 300, Regular 400, Medium 500, Semibold 600, Bold 700, Extra Bold 800, Black 900.
   - Overflow lists `visible`, `hidden`, `clip`, `scroll`, `auto`.
   - Border Style lists `none`, `solid`, `dashed`, `dotted`, `double`.
6. **Layout.**
   - The inspector is 296px wide (`--cd-inspector-w`), with compact two-column fields and the label inside.
   - Set marker: a blue dot plus full vs secondary text.
   - The swatch is a native `<input type="color">`.
   - Section titles are uppercase, like the comments panel.

## Open points for the 9i spec (Fable 5.2 review, 2026-11-20)

- **Computed forms** (R14). Chromium serializes values differently from what the mockup shows:
  - Leading comes back as `normal` or px. A ratio needs line-height divided by font-size, or just show it.
  - `text-align` is `start` by default. Assume left-to-right, with a `ponytail:` mark (no `direction` in `computed`).
  - Colours come as `rgb()` / `rgba()`. `toHexColor` drops alpha, and `rgba(0, 0, 0, 0)` must read "None".
  - Border width, style and colour can be multi-value when the sides differ.
  - Computed border width can be `0px` when the style is `none`, so Add border should key on computed style.
  - `text-decoration-line` is not inherited: a span inside an underlined link reads `none`.
  - `computed` is Partial: every control needs a missing-key state.
  - Non-hex inline colours (`red`, `var()`) show in a box that refuses them.
  - The native picker has no alpha, so picking on an `#rrggbbaa` value drops it.
- **Error copy per rule kind** (R15). `FIELD_ERROR_COPY['invalid-length']` is wrong for colour, opacity, line-height and keyword fields.
- **Focus and naming** (R16).
  - Keep Reset rendered with `aria-disabled`, so it never unmounts under focus.
  - Add border moves focus to Width; Reset on Border moves it back.
  - Name the fields "Border color" vs "Color", and label each section group.
  - Announce Reset in a live region.
  - Reset first commits or drops that section's open drafts, as `handleHistoryStep` does.
- **Width** (R17). 296px against `Inspector.svelte`'s `max-width: 30%`: decide a minimum width or a one-column fallback.
- **To settle** (R18).
  - Add border defaults: `1px`, `solid`, and the colour left to `currentColor`, so not written.
  - An empty `plain` element (spacer div) reads as text-only and gets font settings.
  - What `too-long` shows.
  - The mixed hint "select a part to change its words" is false for bare text between elements, and nothing points to the Agent any more.
  - Per-field unset exists only for text boxes; toggles, selects and the picker rely on section Reset.
  - Seven segment buttons are seven tab stops; Align is semantically a radio group.
- **U and S** (R13) are one property, `text-decoration-line`. The write combines both toggles, from `underline`, `line-through`, `underline line-through` and `none`.
