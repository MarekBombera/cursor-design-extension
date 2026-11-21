# Fix: System map charts parse

**Type:** Fix
**Status:** verified (15/15 charts parse with mermaid 11.4.1 + jsdom, scratch install; pnpm verify exit 0)
**Branch:** fix/system-map-charts-parse

## The problem

8 of the 15 mermaid charts in `blueprint/context/system-map.md` fail to parse (mermaid 11.4.1
`mermaid.parse`), so Markdown preview and GitHub show an error instead of the diagram:

- **Sequence charts:** 8e Comments for the Agent, Agent edit to live frame, 8d1 Comment-mode
  picking, 9d Edit mode, 9f Undo / redo, 8f1 Comment mode and popover, and Export. A `;` inside a
  message or note text ends the mermaid statement, so the rest of the line is read as a new
  statement.
- **Runtime map (flowchart):** an unquoted edge label holds `(`, which mermaid reads as a node
  shape (`artboard:edit (Edit-mode inspector, 9e)`).

The chart checklist does not say how to avoid either, so new charts can repeat it. The 9e and 9i
charts were fixed during the 9i `/complete`; the overview charts already parse.

## The fix

- **Sequence charts:** replace each `;` in message, note and `alt` / `opt` text with `,`. Change
  the wording only where a comma makes the sentence ambiguous. No arrow, participant or message
  name changes.
- **Runtime map:** quote the edge labels that hold `(`, `)` or `|`: `-->|"…"|`.
- **Chart checklist:** add one item. Mermaid syntax: no `;` in sequence text, quote a flowchart
  label that holds `(`, `)` or `|`, and parse a changed chart before writing it.
- Leave the meaning of every chart and the message contract table unchanged. Do not touch
  `current-feature-system-design.md`, which parses, or the archives.
- No new dependency or Verify gate: the parse check runs from a scratch install of mermaid with
  jsdom, not from the repo.

## Build steps

- [x] 1. Fix the 8 charts and add the checklist item.

**Done when:** every mermaid chart in `system-map.md` passes `mermaid.parse` (mermaid 11.4.1 with
jsdom, scratch install), `git diff` shows only `;` → `,` swaps, quoted labels and the checklist item,
and `pnpm verify` passes.

## Verify

- The scratch parse check prints `ok` for all 15 charts in `system-map.md`.
- Open `blueprint/context/system-map.md` in Markdown preview: every chart renders.
- `pnpm verify` exit 0.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":2273,"specSha256":"a5429b7dcce01743e361fbadf0fe6862869abb9c9c1013c32a024835cd17349d","branch":"refs/heads/fix/system-map-charts-parse","head":"48f3879b652b6dc5e928d1fc6e95444f5f1002e5","baseRef":"refs/heads/main","baseCommit":"48f3879b652b6dc5e928d1fc6e95444f5f1002e5","sourceTree":"5220bd6ed55b7346df3ad0435d1bc27ff0cb0d2e","landing":"local-merge","absentOptional":[]} -->

## Try it now

Run or do:

Open `blueprint/context/system-map.md` in Markdown preview.

Expected:

Every diagram renders, including the Runtime map, Undo / redo (9f) and Export. None shows a parse-error box.

This proves:

The 8 charts that failed now parse.
