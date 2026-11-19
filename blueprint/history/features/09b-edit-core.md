# Feature: Edit core

**From build-plan:** feature 9b
**Build attempt:** 1
**Branch:** feature/edit-core
**Status:** verified

## Goal

A pure disk module (no I/O, no `vscode`, no DOM) that takes an artboard's disk HTML, its
`ArtboardDocument` (parse5 parse with source locations), a source number `N` (the 9a
`data-cd-src` numbering), a field (text, `font-size`, `color`, `padding`, `margin`) and a value,
and returns the new HTML with only that element's text or its inline declarations for that one
property changed, byte for byte the same everywhere else; or a typed refusal. Nothing calls it
yet: 9c wires it into the checked write and the panel edit message.

Source of truth: Notion 0.4 Decisions (https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d),
read 2026-11-19, and build-plan item 9b.

## In scope

- One shared numbering walk: `sourceTags.ts` exposes the numbered elements so the edit core and
  `sourceTaggedHtml` can never disagree on what `N` means.
- `src/disk/inlineStyle.ts`: in-house inline-style tokenizer and the two operations the edit
  core needs (set one property, remove one property) over a `style` attribute's text as written.
- `src/disk/artboardEdit.ts`: `editArtboardHtml` for the five fields, with every refusal below,
  including a runtime field allowlist and the text re-parse check.
- Text encoding rules from Notion; safe values, length caps.
- Diff-exact unit tests (expected output written as a literal string) plus one fast-check property.
- Rule 05 owner catalog entries for what each step adds.

## Out of scope

- Any caller: no host wiring, no lock, no hash, no generation, no chrome message (9c).
- Frame-side checks: script-created elements (no number), numbers shared by two live elements
  (a script clone), the "contains other elements" hint, how the frame reads `liveText` (9d). The
  core only refuses what the disk can prove.
- Live preview, save triggers, undo/redo (9e, 9f).
- Classes, style blocks, border, per-side spacing, editing one text piece inside mixed content
  (0.4 out of scope).
- Agent skill, MCP tools, system map: unchanged (no tool, message, or cross-process flow changes).
- A Chromium agreement test for the style parser (9g proves edits on a real frame).

## Build loop

`workflow.stepReview` is `feature`: build all steps, then present the whole feature for review.
`workflow.checkpointCommits` is `disabled`: no commits per step; `/complete` makes the one commit.
After each step run `pnpm test`; after the last step run `pnpm verify`. Each step updates the
rule 05 owner catalog for the exports it adds.

## Build steps

- [x] **1. Shared numbering.** Export `ArtboardElement` (today a local type,
  `DefaultTreeAdapterMap['element']`) from `src/disk/commentTarget.ts`. In
  `src/disk/sourceTags.ts`, replace the private `startOffsets` walk with one exported walk,
  `numberedElements(document: ArtboardDocument): ArtboardElement[][]`: index `N` holds every
  element whose start tag sits at the `N`th distinct start offset, in ascending offset order
  (same rules as today: childNodes only, template content never walked, SVG `text` and its
  subtree skipped, `script`/`style`/`title`/`textarea` never numbered, explicit stack, one push
  per child). Usually one element per entry; misnested reconstructions share their source start
  tag and their entry. Order inside an entry is the walk's (deterministic); all members share
  one start offset, and `sourceTaggedHtml` reads it from `entry[0]`. Export `tagNameEnd` for
  the edit core. `sourceTaggedHtml`'s output must not change. Update the rule 05 `sourceTags.ts`
  line (`numberedElements`, `tagNameEnd`).
  **Done when:** every existing `sourceTags.test.ts` case passes unchanged, and one new test
  shows that for the existing misnesting case (`<p><b>x</p><p>y</p>`) entry 1 (the `b` start
  tag) holds two elements while the tagged copy gives them the one shared number 1.

- [x] **2. Inline-style tokenizer and operations** (`src/disk/inlineStyle.ts`).
  `splitStyleDeclarations`, `setStyleProperty`, `removeStyleProperty`, `PADDING_LONGHANDS`,
  `MARGIN_LONGHANDS` per Data / contracts. Add the rule 05 catalog line.
  **Done when:** `inlineStyle.test.ts` covers, with literal expected strings: set in place
  (spacing and `!important` kept); every append and remove example in Data / contracts; last
  duplicate updated; `;` inside `"..."`, `'...'`, `url(a;b)`, `var(--x, a;b)`, `/* ; */` and
  `\;` not splitting; `&quot;`-quoted strings and `&semi;` read as their characters; `endsOpen`
  true for each open state (string, comment, escape, bracket); a `font` after `font-size`
  forcing remove-and-append; `padding` dropping every entry of `PADDING_LONGHANDS` (ten) and
  nothing else; plus one fast-check property: for any generated style text, the segments'
  `text + separator` joined give back the input exactly.

- [x] **3. Text edits** (`src/disk/artboardEdit.ts`, `field: 'text'`). Input guards, number
  lookup, the plain-text pre-check, value rules, the live-text check, the splice and the
  re-parse check. Add `MAX_EDIT_TEXT_CHARS` and the rule 05 catalog line.
  **Done when:** `artboardEdit.test.ts` shows with literal expected HTML: a plain `<p>` edit;
  leading/trailing source whitespace kept (`<p>\n  Old\n</p>`); `&copy;` elsewhere in the edited
  node coming back as `©`; `&`, `<`, `>`, U+00A0 encoded; a newline becoming a space; empty
  elements getting text (`<p></p>`, `<pre>\n</pre>` gives `<pre>\nHi</pre>`, and `<li>` with no
  end tag); a CRLF file and `<pre>\nx</pre>` edited byte-exactly; and each refusal: unknown
  number (negative, fractional, out of range), a field outside the allowlist, a non-string value,
  shared number, element child, comment child, raw-text element (`noscript`), live text differing
  from the source text, live text over the cap, control character, lone surrogate, text over the
  cap, and the re-parse check refusing `<head></head>`, an empty `<table>`, `<br>`, `<param>`
  and `<svg><circle/></svg>`.

- [x] **4. Style edits** (`artboardEdit.ts`, the four style fields). Value rules, find or create
  the `style` attribute on the element's start tag, then `inlineStyle.ts` does the declaration
  work.
  **Done when:** tests show with literal expected HTML: set on an element with no `style`
  (attribute inserted right after the tag name), on `style=""`, double-quoted, single-quoted,
  `STYLE="..."`, unquoted, `style=` with an empty value, and valueless `style` (the last three
  rewritten double-quoted); clear removing the declaration (for `padding`, also its longhands)
  and clear on a missing one returning the input unchanged; bare number to `px` (`12`,
  `8 16` to `8px 16px`, `calc(8px + 2px)` untouched); colour accepted only as `#rrggbb`; and each
  refusal: unsafe characters, unbalanced parentheses, `/*`, a value over the cap after `px`,
  unquoted attribute containing `"`, append onto style text that `endsOpen`, a `<body>` whose
  `style` came from a later duplicate `<body>` tag, and a misnested element. `pnpm verify`
  passes.
- [x] **5. Audit repairs (F-136 to F-141).** The wrong-document guard anchors on the start tag's
  `<` and `>` instead of its name (parse5 renames `<image>` to `img`); the re-parse check drops
  the newline HTML drops after `<pre>` / `<listing>` from the expected text; an append after a
  reference left without its `;` writes ` ;` so the reference cannot take the separator;
  `entryOffset` is shared from `sourceTags.ts`; the text branch reads the narrowed `edit`.
  **Done when:** tests cover `<image>` and `<IMAGE src=x>` edits, `<pre>\n  Old\n</pre>`,
  `<pre>\r\n  Old</pre>` and `<listing>\n\nOld</listing>`, appends after `A&copy` and `x&#38`, and
  the guards F-140 named (liveText surrogate, DEL, `*/`, text after `</body>`); `pnpm verify`
  passes.

## Files / areas

- `src/disk/commentTarget.ts`: export the existing `ArtboardElement` type.
- `src/disk/sourceTags.ts` (+ `sourceTags.test.ts`): export `numberedElements` and `tagNameEnd`;
  `sourceTaggedHtml` reuses the walk.
- `src/disk/inlineStyle.ts` + `inlineStyle.test.ts` (new).
- `src/disk/artboardEdit.ts` + `artboardEdit.test.ts` (new).
- `src/disk/layout.ts`: `MAX_EDIT_TEXT_CHARS = 5000` next to the pick caps (a plan choice; Notion
  only says "length cap"). Style values reuse `MAX_STYLE_VALUE_CHARS` (200). Both count UTF-16
  code units, like the other caps.
- `.claude/rules/05-single-job.md`: owner catalog (the `.cursor/rules` symlink follows).

## Data / contracts

### API

```ts
// src/disk/artboardEdit.ts
export const EDIT_FIELDS = ['text', 'font-size', 'color', 'padding', 'margin'] as const;
export type StyleField = 'font-size' | 'color' | 'padding' | 'margin';
export type ArtboardEdit =
  | { sourceNumber: number; field: 'text'; value: string; liveText: string }
  | { sourceNumber: number; field: StyleField; value: string }; // '' (after trim) = clear

export type EditRefusal =
  | 'unknown-number'    // not a safe integer in [0, numberedElements.length)
  | 'shared-number'     // that start tag produced more than one element (misnesting)
  | 'not-plain-text'    // text edit on an element that cannot hold just this text
  | 'text-changed'      // liveText differs from the source text
  | 'invalid-value'     // field, value or liveText fails its rule or cap
  | 'unsupported-style'; // style attribute the core cannot edit safely

export type EditResult = { ok: true; html: string } | { ok: false; refusal: EditRefusal };

export const editArtboardHtml = (args: {
  html: string;
  document: ArtboardDocument; // parseArtboardDocument(html)
  edit: ArtboardEdit;
}): EditResult;
```

- Pure and deterministic. `document` must be the parse of `html` (9c passes the
  `cachedArtboardDocument` hit, like `panelFrames`). Programming-error guard (throws, like
  `sourceTaggedHtml`): `html` at the element's start offset must start with `<` plus its
  `tagName` (ASCII case-insensitive), and every source span the edit uses must lie within
  `html.length`.
- `ok: true` with `html` identical to the input is a no-op (clear on an absent declaration,
  same value); the caller decides whether to write.
- Everything outside the changed spans is byte-identical: no re-serialization, only string
  splices at parse5 source offsets.
- Refusals are a result union, not thrown `CursorDesignError`s (one style per module, rule 06).

### Refusal order

The first failing check wins, in this order:

1. **Input shape** (the core guards it even though 9c also parses the message): `field` is one
   of `EDIT_FIELDS`, `value` is a string, and for text `liveText` is a string; else
   `invalid-value`. `sourceNumber` not a safe non-negative integer: `unknown-number`.
2. **Number lookup:** `N >= numberedElements(document).length`: `unknown-number`. An entry with
   more than one element: `shared-number`.
3. **Field rules,** in the order listed under Text field or Style fields below.

### Text field

1. **Plain-text pre-check.** Refuse `not-plain-text` when the element is a raw-text element that
   9a still numbers (`iframe noembed noframes noscript xmp plaintext`), or has any child node
   other than one text node (element or comment children). Zero children passes on to the
   re-parse check, which refuses void, template, foreign self-closing and table-like cases.
2. **Live text.** `liveText` is the element's `textContent` exactly as the frame read it when
   picked, before any live preview: no trim, no whitespace collapse, never the 200-character
   pick excerpt (9d owns producing it). Refuse `invalid-value` if it is longer than
   `MAX_EDIT_TEXT_CHARS` or contains a lone surrogate (`/\p{Cs}/u`).
3. **Value.** Each `\r\n`, `\r` or `\n` becomes one space; then trim ASCII whitespace
   (`\t \n \f \r` and space). Refuse `invalid-value` if it contains a C0 control other than tab,
   U+007F, or a lone surrogate (`/\p{Cs}/u`; Node would write it as U+FFFD, so the file and the
   hashed string would differ), or is longer than `MAX_EDIT_TEXT_CHARS` after this step. Empty is
   allowed.
4. **Source text** = the text node's parse5 `value` (decoded), or `''` when there is none.
   `liveText` must equal it exactly, else `text-changed`.
5. **Encoding.** `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, U+00A0 → `&nbsp;`; nothing else.
6. **Splice.** With a text node: take its source span (`sourceCodeLocation` start/end). Refuse
   `not-plain-text` if the span is not inside the element's start-tag end .. end-tag start (or
   the element's `sourceCodeLocation.endOffset` when there is no end tag). Keep the span's
   leading and trailing ASCII-whitespace runs (an all-whitespace span is all leading) and replace
   only the middle with the encoded value. Any other character reference or ignored stray end
   tag inside the middle (`<p>a</x>b</p>` is one text node) is replaced along with it.
   Without a text node: insert the encoded value at the end tag's start offset when the element
   has an end tag in the source (so `<pre>\n</pre>` keeps its dropped newline), else at the start
   tag's end offset. An empty value with no text node is a no-op.
7. **Re-parse check.** Parse the new HTML with `parseArtboardDocument` and refuse
   `not-plain-text` unless (a) `numberedElements` gives the same start offsets as before, those
   after the splice shifted by the length change, and (b) entry `N` is one element whose child
   nodes are exactly one text node whose value equals leading + value + trailing (with `\r\n`
   and `\r` read as `\n`), or no child nodes when that string is empty. This catches every case
   where the text would change the page structure or land outside the element: `<head>` (the
   implied `<body>` takes over and renumbers), empty table parts (foster-parenting), void
   elements, `template`, and self-closing foreign elements (`<svg><circle/></svg>`).
   `ponytail:` one full re-parse per text edit (files up to the 1.5 MB posting cap). Upgrade
   path: hand the new document to 9c's parse cache instead of discarding it.

### Style fields

Checked in this order:

1. **Value rules** (after trimming ASCII whitespace and collapsing ASCII-whitespace runs to one
   space):
   - `color`: exactly `#` + 6 hex digits, written as given. Anything else is `invalid-value`.
   - `font-size`, `padding`, `margin`: only `A-Z a-z 0-9 . % + - * / ( ) ,` and space;
     parentheses balanced (depth never negative, ends at 0); no `/*` or `*/`. Each
     space-separated part outside parentheses that is a bare number (`[+-]?(\d+(\.\d*)?|\.\d+)`)
     gets `px`. The written value (after `px`) must be at most `MAX_STYLE_VALUE_CHARS`. Failing
     any rule is `invalid-value`. Anything else is kept as typed (`1.5rem`, `var(--x)`,
     `calc(...)`); a value the browser ignores (`abc`, `1e3`) is accepted by design (Notion
     "kept as typed"; any validity hint belongs to 9d/9e).
   - Empty value = clear.

   These rules guarantee the written value never contains a quote, `&`, `<`, `>`, `;`, `:`, `\`,
   `!`, `{`, `}` or a comment, so it is safe in any attribute quoting and cannot end or swallow
   another declaration.
2. **Attribute.** parse5's `sourceCodeLocation.startTag.attrs.style` gives the raw span of the
   first `style` attribute (its key is lowercase whatever the source case; parse5 drops
   duplicates). The value span is read from that raw text: the 5-character name, optional
   whitespace, `=`, optional whitespace, then a `"`- or `'`-quoted value (inner span) or an
   unquoted value.
   - `element.attrs` has `style` but the start tag has no `style` location (a `<body>` / `<html>`
     style merged in from a later duplicate tag): `unsupported-style`.
   - No `style` attribute, setting: insert ` style="<prop>: <value>"` right after the tag name
     (`tagNameEnd`, the boundary 9a uses). Clearing: unchanged.
   - Valueless (`<div style>`), empty unquoted (`style=`) or unquoted: rewrite the whole
     attribute as `style="<new style text>"`, keeping the source name's case. Unquoted raw value
     containing `"`: `unsupported-style`.
   - Quoted: splice inside the quotes only.
3. **Declarations.** `setStyleProperty` / `removeStyleProperty` on the style text. A set that
   would append onto style text that `endsOpen` (`setStyleProperty` returns `undefined`):
   `unsupported-style`. Clearing `padding` or `margin` also removes its longhands, like a set
   does (Notion's reason for dropping longhands, "or the edit would look ignored", applies to a
   clear too); `removeStyleProperty` owns that.

### `inlineStyle.ts` (over the style text as written in the attribute)

```ts
export const PADDING_LONGHANDS: readonly string[]; // the ten padding-* longhands below
export const MARGIN_LONGHANDS: readonly string[];  // the same ten with margin-

export type StyleSegment = {
  text: string;      // raw text from after the previous separator up to this one
  separator: string; // the raw separator (';', '&semi;', '&#59;', ...) or '' for the last
  property?: string; // decoded name before the first top-level ':', trimmed, ASCII-lowercased
};
export const splitStyleDeclarations = (styleText: string):
  { segments: StyleSegment[]; endsOpen: boolean };

// rule 04: three parameters take one object
// undefined: the value would have to be appended onto style text that endsOpen
export const setStyleProperty = (args: { styleText: string; property: string; value: string }): string | undefined;
// also drops PADDING_LONGHANDS / MARGIN_LONGHANDS for padding / margin
export const removeStyleProperty = (styleText: string, property: string): string;
// ASCII whitespace helpers shared with artboardEdit.ts (rule 05: no twins)
export const asciiTrim, leadingWhitespaceLength, trailingWhitespaceLength;
```

Longhand lists: `padding-top padding-right padding-bottom padding-left padding-block
padding-block-start padding-block-end padding-inline padding-inline-start padding-inline-end`,
and the same ten with `margin-`.

**Tokenizer:**

- A character reference (`&#\d+;`, `&#x[0-9a-fA-F]+;`, `&[A-Za-z][A-Za-z0-9]*;`) is one unit.
  Numeric references and `&quot; &apos; &semi; &colon; &lpar; &rpar; &lsqb; &rsqb; &lcub;
  &rcub; &sol; &bsol; &ast;` are read as their character; any other named reference is an
  ordinary character. `ponytail:` other named references and legacy `&quot` without `;` are
  read as ordinary characters; a style that spells CSS syntax that way may mis-split. Upgrade
  path: the full HTML entity table.
- `\` escapes the next unit. `"` or `'` opens a string until the same quote or the end
  (`ponytail:` CSS also ends a bad string at a newline; ignored). `/*` opens a comment until
  `*/` or the end. `(`, `[`, `{` raise depth; `)`, `]`, `}` lower it (not below 0).
- A `;` at depth 0, outside strings and comments, is a separator. Joining every segment's
  `text + separator` gives back the input exactly (fast-check property).
- `endsOpen` is true when the input ends inside a string, a comment, after a lone `\`, or at
  depth above 0.
- A segment's `property` is set only when it has a `:` at depth 0 outside strings/comments.
  Segments without one (malformed, empty, comment-only) are never matched and never changed.
  Its value span is the raw text after that `:`, with leading/trailing whitespace excluded and a
  trailing `!important` (`!` + optional whitespace + `important`, case-insensitive) excluded and
  kept.

**`setStyleProperty`:**

1. When setting `font-size` and a `font` segment follows the last `font-size` segment: remove
   every `font-size` segment (as `removeStyleProperty`) and append, so a later `font` cannot
   override the new value.
2. Otherwise, if the property occurs: replace the value span of its **last** occurrence with
   `value` (whitespace around it and `!important` kept). Earlier duplicates stay. `ponytail:` an
   earlier `!important` duplicate still wins in the browser; upgrade path: drop earlier
   duplicates on set.
3. Otherwise append (examples are style text before → after setting `font-size: 12px`):
   - `` → `font-size: 12px`; `   ` → `font-size: 12px   ` (inserted before trailing whitespace)
   - `color: red` → `color: red; font-size: 12px`
   - `color: red;` → `color: red; font-size: 12px;`
   - `color: red; ` → `color: red; font-size: 12px; ` (trailing whitespace stays at the end)
4. Then for `padding`: remove every `PADDING_LONGHANDS` segment; for `margin`, every
   `MARGIN_LONGHANDS` segment. Nothing else changes.

**`removeStyleProperty`:** remove every segment whose `property` matches (for `padding` /
`margin`, also every longhand segment), each with its own separator. When no kept segment precedes a removed one, the next kept segment's leading
whitespace goes too. Absent property: input unchanged. An emptied attribute stays `style=""`.
Examples (removing the named property):

- `color: red; font-size: 12px; margin: 0`, remove `font-size` → `color: red; margin: 0`
- same, remove `color` (first) → `font-size: 12px; margin: 0`
- `color: red; margin: 0`, remove `margin` (last, no separator) → `color: red;`
- `color: red; margin: 0;`, remove `margin` (last, with separator) → `color: red;`
- `margin: 0`, remove `margin` (only) → `` (attribute becomes `style=""`)
- `color: red; color: blue`, remove `color` → ``

## Testing

- Unit (`pnpm test`): `sourceTags.test.ts` (one new case), `inlineStyle.test.ts`,
  `artboardEdit.test.ts`. Expected outputs are literal strings, so a test fails if any byte
  outside the edited span moves. Edge cases over volume (rule 09): one happy path per rule, then
  the case that would break each guard. A refusal test triggers exactly one fault unless it is
  testing the refusal order.
- One fast-check property: tokenizer segments plus separators rebuild the input.
- No browser test and no F5 check: nothing is wired yet.
- Final gate: `pnpm verify`.

## Notes for the AI

- Build the edit core on parse5 source offsets and string slices only. Never call
  `serialize`/`serializeOuter` on the edit path.
- Reuse `parseArtboardDocument` / `ArtboardDocument` / `ArtboardElement` (`commentTarget.ts`) and
  `numberedElements` / `tagNameEnd` (`sourceTags.ts`); do not copy them.
- Do not reuse `isSafeStyleValue` (`src/webview/frame/frameMessages.ts`): it allows quotes, lives
  in the chrome tree, and is the pick guard, not the write guard.
- `String.prototype.isWellFormed` is not in the project's ES2022 lib; use `/\p{Cs}/u` for lone
  surrogates.
- Name the attribute value `styleText`, not `raw` (rule 04 keeps `raw` for unvalidated input).
- `editArtboardHtml` and `inlineStyle.ts` have no production caller until 9c; that is expected
  (`pnpm knip` is not part of Verify).
- Notes for later items (not this feature): 9c, the Notion "Element mapping" decision still says
  an edit sends `N` plus the generation, while the Scope and build-plan 9c say content hash; 9b
  takes neither, but it must be settled before `/feature 9c`. 9c, a text edit can grow the file
  by up to `MAX_EDIT_TEXT_CHARS`, so a file near `MAX_POSTED_ARTBOARD_HTML_CHARS` can tip into the
  too-large tile. 9d, `liveText` must be the full unmodified `textContent`, never the capped pick
  text.
- Follow rules 04 (conventions), 05 (catalog), 06 (one error style per module), 09 (tests). Mark
  the entity, bad-string, `!important` duplicate and re-parse simplifications with `ponytail:`
  comments as written above.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":23381,"specSha256":"f41740084bbd1a947b5084e432bcebe4e29ec55022c7de90b21bb446f60e488c","branch":"refs/heads/feature/edit-core","head":"e25b0edba3f9ee566fdf7e67d37b0369be6f9841","baseRef":"refs/heads/main","baseCommit":"e25b0edba3f9ee566fdf7e67d37b0369be6f9841","sourceTree":"716e4632ec54162ec704e2eb6b0659b51b5e699c","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9b/F-136 [P1] closed - The wrong-document guard throws on valid HTML whose tag name parse5 rewrites

**File:** src/disk/artboardEdit.ts:87
**Found:** 2026-11-19 by /audit (scope: current; lens: all, with a fresh Opus reviewer)
**Why it matters:** `assertParsedFrom` compares the source text after `<` with `element.tagName`. parse5 renames `<image>` to `img` and turns a NUL in a tag name into U+FFFD, while 9a still numbers those elements. `'<p>a</p><image>'` with number 1 and a colour edit throws "the document was not parsed from this HTML" (also `<IMAGE src=x>`, `<di\0v>`). The spec allows the throw only for a document parsed from other HTML; in 9c it would surface as an unexpected error on a user click.
**Suggested fix:** Drop the tag-name comparison and anchor the guard on the start tag's own bounds, like `sourceTaggedHtml`: `<` at `startTag.startOffset`, `>` at `startTag.endOffset - 1`, and the element's `endOffset` within `html.length`. Add the `<image>` case to the tests.
**Resolution:** 2026-11-19 /implement: fixed. `assertParsedFrom` checks `<` at the start tag's start and `>` at its end (plus `endOffset` within the HTML), never the name; tests edit `<image>` and `<IMAGE src=x>`. Closed 2026-11-19 by /audit re-review (fresh Opus reviewer): a colour edit on every unshared numbered element of 12 samples (`<image>`, NUL tag name, `<p a=">">`, self-closing SVG, template content, unquoted value ending in `/`) never throws; `<div>` vs `<p>` documents still throw; a same-shape mismatch is impossible in 9c (cache keyed by identical HTML) and a text edit on one is still refused by the re-parse check.

### 9b/F-137 [P2] closed - An appended declaration completes a trailing reference without `;` and merges into the previous value

**File:** src/disk/inlineStyle.ts:256
**Found:** 2026-11-19 by /audit (scope: current; lens: all, with a fresh Opus reviewer)
**Why it matters:** HTML decodes numeric references and legacy named references without a `;`. When the style text ends in one (`font-family: A&copy`, `content: x&amp`, `content: x&#38`), `appendDeclaration` writes `; font-size: 12px` straight after it, the `;` completes the reference, and CSS reads one declaration: `font-family: A© font-size: 12px`. The edit returns ok:true and an unrelated declaration stops applying.
**Suggested fix:** When the text before the append point ends in `&` plus a reference name or number (`/&(#x?[0-9a-f]+|[a-z][a-z0-9]*)$/i`), insert a space before the `;`. Extend the entity `ponytail:` comment to name numeric references without `;`.
**Resolution:** 2026-11-19 /implement: fixed. `appendDeclaration` writes ` ;` when the text before it ends in `&` plus a reference name or number (`UNTERMINATED_REFERENCE`); the entity `ponytail:` names references without `;`; tests for `A&copy`, `x&#38` and the complete `x&#38;`. Closed 2026-11-19 by /audit re-review: `A&copy`, `x&#38`, `x&#x26`, `x&notin`, `&AMP`, `d&lt` and trailing whitespace all get ` ;` and parse5 decodes two declarations; complete references and non-references keep `;`; in-place splice and removal cannot form a reference. `Tom&Jerry` gets a harmless extra space (accepted conservative default).

### 9b/F-138 [P2] closed - `<pre>` / `<listing>` text that starts with a newline and then whitespace is refused

**File:** src/disk/artboardEdit.ts:147
**Found:** 2026-11-19 by /audit (scope: current; lens: all, with a fresh Opus reviewer)
**Why it matters:** When the newline HTML drops after `<pre>` is tokenized together with the following whitespace, parse5's text location starts at the start tag's end and includes that newline, but the node's value does not. `leading`, and so `expectedText`, then carries a newline the re-parse never yields, and the re-parse check refuses the edit: `<pre>\n  Old\n</pre>`, `<pre>\r\n  Old</pre>`, `<pre>\n\nOld</pre>` all return `not-plain-text`. Fails safe, but refuses the usual way a `<pre>` is written.
**Suggested fix:** In `spliceText`, for an HTML `pre` or `listing` whose text location starts at the start tag's end, drop one leading `\n` from the normalized `leading` in `expectedText` only; the written bytes stay as they are. Test `<pre>\n  Old\n</pre>`.
**Resolution:** 2026-11-19 /implement: fixed. `spliceText` drops one leading `\n` from the expected text (only) for an HTML `pre` / `listing` whose text location starts at the start tag's end; tests for `<pre>\n  Old\n</pre>`, `<pre>\r\n  Old</pre>`, `<listing>\n\nOld</listing>`. Closed 2026-11-19 by /audit re-review: `<pre>\n  Old\n</pre>`, `<pre>\r\n  Old</pre>`, `<pre>\n\n</pre>`, `<pre>\r\rOld</pre>`, `<pre>\f\n Old</pre>`, `<listing>`, `<pre>` in a table cell all edit byte-exactly; `<div>\n  Old</div>` unaffected; the drop changes only the expected text, the numbering and one-text-node checks still apply.

### 9b/F-139 [P3] closed - `startOffsetOf` duplicates `sourceTags.ts`'s private `entryOffset`

**File:** src/disk/artboardEdit.ts:80
**Found:** 2026-11-19 by /audit (scope: current; lens: all, with a fresh Opus reviewer)
**Why it matters:** Two copies of "start offset of a numbered entry" (rule 05: a twin helper is a bug).
**Suggested fix:** Export `entryOffset` from `sourceTags.ts` and reuse it in the edit core.
**Resolution:** 2026-11-19 /implement: fixed. `entryOffset` is exported from `sourceTags.ts` (takes a missing entry) and used by the edit core; `startOffsetOf` removed. Closed 2026-11-19 by /audit re-review: `entryOffset` exported and used by both modules; no twin left.

### 9b/F-140 [P3] closed - Several edit-core guards have no test that fails without them

**File:** src/disk/artboardEdit.test.ts
**Found:** 2026-11-19 by /audit (scope: current; lens: all, with a fresh Opus reviewer)
**Why it matters:** Deleting any of these leaves every test green: the lone-surrogate check on `liveText`, the U+007F refusal, the `*/` value check, and the `spliceText` out-of-element span refusal (reachable: `<body></body>Old`, where body's text sits after its end tag; refusing it is safe).
**Suggested fix:** One assertion each in the existing refusal tests.
**Resolution:** 2026-11-19 /implement: fixed. Assertions added for the liveText surrogate, U+007F, `1px*/`, and `<body></body>Old` (refused `not-plain-text`). Closed 2026-11-19 by /audit re-review: each new assertion fails when its guard is deleted.

### 9b/F-141 [P3] closed - `editArtboardHtml` re-checks `liveText` after the input guard

**File:** src/disk/artboardEdit.ts:415
**Found:** 2026-11-19 by /audit (scope: current; lens: all, with a fresh Opus reviewer)
**Why it matters:** `liveText: typeof liveText === 'string' ? liveText : ''` repeats the guard a few lines up because the untrusted record is used instead of the narrowed `edit`.
**Suggested fix:** After the guards, branch on `edit.field` and pass `edit.liveText` from the narrowed union.
**Resolution:** 2026-11-19 /implement: fixed. The final branch reads `edit.field` / `edit.value` / `edit.liveText` from the narrowed union. Closed 2026-11-19 by /audit re-review: the final branch reads the narrowed `edit`; no second `typeof`.
