# Edit mode reference

The short version is in the [README](../README.md#edit-mode). This page has every detail.

Pick **Edit** in the toolbar's mode switch (it has no key; Esc or pressing **Edit** again goes back to Interact), then click an element.

## Picking an element

As in Comment mode, links and buttons don't fire, Alt+click or ↑ picks the parent and ↓ the child; the Inspector's arrow buttons do the same. Clicking empty space in a frame selects its `body`.

## Inspector sections

- **Text**: **Content**, **Size**, **Color**, **Weight**, **Text style** (Italic, Underline, Strikethrough), **Align** (left, center, right, justify), **Leading**, **Tracking** and **Case**. An element that mixes text with other elements gets **Typography** instead: the same fields without Content, and a hint to ask the Agent or select a part that holds only text.
- **Appearance**: **Background**, **Radius**, **Overflow** and **Opacity**.
- **Spacing**: **Padding** and **Margin**, each one shorthand box, and **Gap** when the element is a flex or grid container (or already has a gap).
- **Border**: **Width**, **Style** and **Color** when the element has a border; otherwise **Add border**, which saves `1px` `solid` (the colour stays the text colour).
- An element that holds only other elements, an `img` and the like get Appearance, Spacing and Border only.

## Fields and saving

- A blue dot and full-strength text mark a value set on this element's `style` attribute; grey text is the value the design's CSS computes.
- Text boxes (Content, the lengths, the colours) preview as you type and save on Enter or when the field loses focus; an empty style box removes the declaration.
- A colour field pairs its text box with a picker that saves when you release it.
- Selects (Weight, Case, Overflow, border Style) and the Text style and Align toggles save on click (a select as soon as you choose), and always show the computed value.
- Each section's **Reset** removes every value of that section from the `style` attribute in one save (one Undo step); it is greyed out when nothing is set.

## Values

- A bare number gets `px` in a length (Size, Tracking, Radius, Padding, Margin, Gap, border Width), and a value the browser ignores (`abc`) is saved as typed.
- Colours take a hex such as `#1a2b3c` or `transparent`.
- Opacity takes a number from 0 to 1; Leading a number such as `1.5` or a length.
- A refused value, or one over 200 characters, shows an error under its field and is not saved.

## What a save writes

A save writes only that element's text, or the properties it changed in its `style` attribute, to `.vibeboard/pages/<pageId>/artboards/<id>.html`. A shorthand box replaces its longhands (`padding-left` and so on), and Reset on Border also removes a `border` shorthand; Reset never removes an inline `font`, `text-decoration` or `background` shorthand (ask the Agent). Your own save does not reload the frame.

## What is not editable

Content is editable only when the element holds plain text. Text mixed with elements or an HTML comment gets the Typography hint, and text over 5,000 characters a hint to ask the Agent in place of Content; the style fields still work. A `style` attribute over 5,000 characters replaces the style fields with a hint. An element a script created or copied shows "Not editable": ask the Agent.

## Undo and Redo

**Undo** and **Redo** in the Inspector, or Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z from the panel (outside a text field) or the focused frame, step through your saves in the frame you last picked in. Each step rewrites the file and reloads the frame. History is 20 steps per frame, kept in memory until the panel closes or the workspace folders change. An outside change to the file (the Agent, an editor) clears that frame's history. After the panel reloads (for example when you switch to another tab and back), Undo and Redo stay disabled until you pick an element in that frame again in Edit mode.

## Edits and comments

A comment on an element you edited, or on an element that contains it, reads `stale` until the element is back as it was, for example after Undo. The panel numbers elements in its own copy only (`data-cd-src`); the file on disk, `read_artboard` and the export never get those tags.
