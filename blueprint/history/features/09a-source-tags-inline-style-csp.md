# Feature: Source tags + inline-style CSP

**From build-plan:** feature 9a
**Build attempt:** 1
**Branch:** feature/source-tags-inline-style-csp
**Status:** verified (agent-run, 2026-11-19: `pnpm verify` 596 unit tests, `pnpm test:browser` 136 passed / 182 gallery skipped; F5 `/check` items not run)

## Goal

Lay the two foundations 0.4 Edit-lite needs before any edit UI exists:

1. **Source tags.** Every element written in an artboard file gets `data-cd-src="N"` in the
   frame copy the host posts to the panel, so a later edit (9b, 9c) can name the exact element and
   the host can find its exact characters on disk. Disk, export, and comment selectors never see
   the tags.
2. **Inline styles render in frames.** The chrome CSP gains `style-src-attr 'unsafe-inline'`, so a
   `style="…"` attribute (what Edit-lite will write) renders instead of vanishing. Both places that
   tell the Agent how to write artboard HTML (the shipped Agent skill and the MCP `html` argument
   description) stop saying style attributes don't work and tell it to keep them, so its next
   update keeps the user's edits.

No user-visible feature yet: frames look the same, except that artboards that already use
`style="…"` now render it, and a page script that reads `outerHTML`, `attributes` or `[data-*]`
now sees `data-cd-src` (accepted by the Notion decision; frame copy only).

Source: Notion 0.4 page, Decisions section (https://app.notion.com/p/3fd500344e0881afac07f81f6d53c17d):
"Element mapping = source tags at load time", "The extension side adds the source tags",
"Source numbers (`data-cd-src`)", "Inline styles must render in frames (CSP)", "Agent skill",
"No new dependencies for 0.4".

## In scope

- Pure numbering and splicing module over parse5 source offsets (`src/disk/sourceTags.ts`).
- `parseArtboardDocument` parses with source locations; the comment flags' parse cache is shared
  with tagging, and the host memoizes each frame's tagged copy so an unchanged frame is never
  re-parsed or re-tagged.
- Host: the size cap checked on the disk HTML, then tagging, before `canvas:updated`; a tagging
  failure posts the untagged HTML and logs once, never blanks the stage.
- Guard: picks in a tagged frame never put `data-cd-src` in a comment selector, and their
  selectors still match the untagged disk HTML.
- Chrome CSP `style-src-attr 'unsafe-inline'`; `FRAME_CSP` unchanged.
- Same-change updates of every place that states the old policy or tells the Agent about style
  attributes: the shipped Agent skill, `ARTBOARD_HTML_RULES` (MCP `html` description), rules 02,
  07 and 08, the `theme.test.ts` guard's stated reason, the `stampArtboardHtml.ts` comment, the
  CSP browser test (and the harness's mirrored policy), the picking fixture comment, README's CSP
  limit line, and rule 05's owner catalog.

## Out of scope

- Anything that reads `data-cd-src` back: edit core and inline-style parser (9b), checked write,
  `hash` on the wire and the edit message (9c), Edit mode, selection and cloned-number detection
  (9d), fields and save (9e), undo/redo (9f).
- Any change to the frame runtime (`src/webview/frame/runtime.ts` and its imports). The exported
  `canvas.html` embeds it.
- Tagging in the chrome (the panel bundle stays parse5-free).
- Exported `canvas.html` CSP: it has none today (README: "not restricted"), so style attributes
  already render there.
- Lifting the chrome's own "no `style=` attribute in `.svelte`" convention: the `theme.test.ts`
  guard stays; only its stated reason changes.
- `system-map.md` (only `/complete` merges shipped flows).

## Build loop

`workflow.stepReview` is `feature`: build all steps, then present one review at the end.
`workflow.checkpointCommits` is `disabled`: no commits between steps. `/complete` makes the
feature commit. Run `pnpm test` after each step; `pnpm test:browser` after step 3; `pnpm verify`
before review.

## Build steps

### 1. Numbering core (disk, pure)

- [x] `src/disk/commentTarget.ts`: `parseArtboardDocument` becomes
      `parse(html, { sourceCodeLocationInfo: true })`. Nothing else in comment matching changes
      (`serializeOuter` ignores locations, so fingerprints stay byte-identical).
- [x] `src/disk/commentViews.ts`: extract the cache lookup from `loadArtboardDocument` into an
      exported synchronous `cachedArtboardDocument({ workspaceRoot, frameId, html })` that returns
      an `ArtboardDocument` under the existing rules (same key `${workspaceRoot}\0${frameId}`, reuse
      only when the HTML text is identical, `MAX_PARSED_DOCUMENTS` FIFO eviction).
      `loadArtboardDocument` calls it after its read; its `missing` / `unreadable` handling is
      unchanged. Extend the `ponytail:` comment above `MAX_PARSED_DOCUMENTS`: the panel's source
      tags share this cache and, on a changed frame, insert into it, so a canvas of more than 32
      changed frames evicts comment documents (the host's tagged-copy memo keeps unchanged frames
      out of it).
- [x] New `src/disk/sourceTags.ts` (no I/O, no DOM, no `vscode`): `SOURCE_TAG_ATTRIBUTE`
      (`'data-cd-src'`) and `sourceTaggedHtml({ html, document }): string`, per **Data /
      contracts → Source numbers**. The tree walk is iterative (explicit stack): a deeply nested
      file must not overflow the call stack.
- [x] `src/disk/sourceTags.test.ts` per **Testing**. Extend `src/disk/comments.test.ts` with the
      shared-cache case.

**Done when:** `pnpm test` passes, including the new `sourceTags` cases and the existing
comment-flag and parse-cache tests unchanged.

### 2. Host posts tagged frames

- [x] `src/host/canvasSnapshot.ts`: new `panelFrames({ workspaceRoot, frames, onTagError })`
      returning `CanvasViewFrame[]`, with the module-level tagged-copy memo, per **Data / contracts
      → Posting**. The size check moves here from `postedFrameFromSnapshot`, which keeps only the
      field mapping (`errorMessage` passed through) and gains a one-line comment: frames arrive
      capped and tagged by `panelFrames`. The `ponytail: 1.5M char ceiling per frame` comment
      names the real posted ceiling: the cap is on disk HTML, and tagging adds about 17 or more
      chars per element on top.
- [x] `src/host/artboardDisk.ts` `snapshotFromCanvasView`: `frames: panelFrames(...)` with
      `workspaceRoot: workspaceFolder.uri.fsPath` (the same root string `panelComments.ts` passes to
      `readComments`, so the shared parse cache keys match), and `onTagError: (frameId, error) =>`
      `logDiskError({ scope: \`artboardDisk.sourceTags:${frameId}\`, error, outputChannel })`.
- [x] `src/host/canvasSnapshot.test.ts`: move the 1.5M-cap test to `panelFrames` and add the
      cases in **Testing**.
- [x] `src/webview/frame/commentTarget.roundtrip.test.ts`: the stamped document is built from the
      tagged fixture; disk-side matching still parses the untagged fixture; add the selector guard.

**Done when:** `pnpm test` passes with the new `panelFrames` cases and the round-trip test on the
tagged fixture. Every existing round-trip assertion still holds unchanged.

### 3. Inline-style CSP, Agent guidance and docs

- [x] `src/panel/artboardChromeHtml.ts`: add `style-src-attr 'unsafe-inline'` right after the
      `style-src` directive (exact string in **Data / contracts → CSP**). Update the pinned string
      in `artboardChromeHtml.test.ts` and `CHROME_CSP` in `tests/browser/harness.ts`.
- [x] `tests/browser/frameCsp.spec.ts`: new test per **Testing**.
- [x] `src/mcp/artboardTools.ts` `ARTBOARD_HTML_RULES`: replace with the exact string in **Data /
      contracts → Agent guidance**. Its comment ("Mirrors skills/cursor-design/SKILL.md …") stays.
- [x] `skills/cursor-design/SKILL.md` line 39: replace with the wording in **Data / contracts →
      Agent guidance**. Line 40 (no inline handlers) stays.
- [x] `src/webview/stampArtboardHtml.ts`: the comment above `stampArtboardHtml` says inline
      handlers stay blocked by the inherited policy and style attributes are allowed by its
      `style-src-attr`. No code change.
- [x] `fixtures/picking.html` and its byte-identical copy
      `fixtures/dev-workspace/.cursor-design/artboards/picking.html`: in the header comment, find
      the sentence starting `Blob CSP: <style> and <script> get the chrome nonce;` (anchor by text,
      not line number) and replace it with `Blob CSP: <style> and <script> get the chrome nonce;
      inline handlers, images and media are blocked, so everything here is classes and inline
      SVG.` Keep both copies identical and change no element (selector tests use `:nth-of-type`
      positions).
- [x] `.claude/rules/02-mcp-webview.md` (`.cursor/rules` links to it): item 2, after "…never
      loads.", add: `The chrome CSP also allows style attributes (style-src-attr 'unsafe-inline'),
      so a style="…" attribute renders in a frame; inline on* handlers stay blocked.` Item 5, right
      after `canvas:updated (frames carry \`generation\`)`, insert: ` (each frame's html is the disk
      HTML with host-added data-cd-src="N" source numbers, sourceTags.ts; disk, export, comment
      flags and read_artboard never carry them)`.
- [x] `.claude/rules/07-vscode-extension.md` line 54: `Chrome CSP: default-src 'none' plus nonce'd
      script-src and style-src via webview.cspSource, and style-src-attr 'unsafe-inline' (style
      attributes in artboard frames, 0.4). No http: resources.`
- [x] `.claude/rules/08-svelte-chrome.md` the **CSP** bullet: keep the rule, change its reason to
      `no style="..." attribute in any .svelte file (convention: the chrome sets dynamic values
      through CSSOM; the chrome CSP allows style attributes since 0.4 only so artboard frames
      render them)`. In `src/webview/ui/theme.test.ts` guard 7's comment, replace `(a CSP
      violation in Cursor)` with `(chrome convention: dynamic values go through style:
      directives)`. The guard's code is unchanged.
- [x] `README.md` line 112: style attributes now render; inline event handlers and external
      subresources stay blocked.
- [x] `.claude/rules/05-single-job.md` owner catalog:
      - In the "Artboard operations" comments-disk passage, reword `commentViews.ts`: its parse
        cache is shared with the panel's source tags through `cachedArtboardDocument`.
      - Add `sourceTags.ts` (`sourceTaggedHtml`, `SOURCE_TAG_ATTRIBUTE`) next to `commentTarget.ts`.
      - In the "Host I/O" `canvasSnapshot.ts` entry, add `panelFrames`: size cap on disk HTML, then
        tags, with the tagged-copy memo.

**Done when:** `pnpm test:browser frameCsp` passes the new test and the existing three;
`pnpm test:browser` passes in full; `pnpm verify` passes; `grep -rn 'style="" attributes'` over
`src/`, `skills/` and `README.md` finds no claim that they do not work.

## Files / areas

| File | Change |
|---|---|
| `src/disk/sourceTags.ts` (+ `.test.ts`) | new: numbering and splicing |
| `src/disk/commentTarget.ts` | parse with source locations |
| `src/disk/commentViews.ts` | export `cachedArtboardDocument`; `ponytail:` text |
| `src/disk/comments.test.ts` | shared-cache case |
| `src/host/canvasSnapshot.ts` (+ `.test.ts`) | `panelFrames` + tagged-copy memo; size check moves here |
| `src/host/artboardDisk.ts` | map frames through `panelFrames`, log tag errors |
| `src/webview/frame/commentTarget.roundtrip.test.ts` | tagged fixture + selector guard |
| `src/webview/frame/frameMessages.test.ts` | pinned rule 02 item 5 line gains the `canvas:updated` sentence (added at implement) |
| `src/panel/artboardChromeHtml.ts` (+ `.test.ts`) | `style-src-attr 'unsafe-inline'` |
| `tests/browser/harness.ts`, `tests/browser/frameCsp.spec.ts` | mirrored policy, new CSP test |
| `src/mcp/artboardTools.ts` | `ARTBOARD_HTML_RULES` wording |
| `skills/cursor-design/SKILL.md` | style-attribute wording |
| `src/webview/stampArtboardHtml.ts`, `src/webview/ui/theme.test.ts` | comments only |
| `fixtures/picking.html`, `fixtures/dev-workspace/.cursor-design/artboards/picking.html` | header comment only |
| `.claude/rules/02-mcp-webview.md`, `07-vscode-extension.md`, `08-svelte-chrome.md`, `05-single-job.md`, `README.md` | contract, policy, reason, catalog, limits |

Zero new dependencies (`parse5` 8.1.1 is installed and already bundled into both entries).

## Data / contracts

### Source numbers

- **Attribute:** ` data-cd-src="N"`: one leading space, the name, `=`, double quotes, and `N` a
  decimal integer from 0 with no leading zeros. It is inserted into the source text right after
  the start tag's name, before any whitespace, attribute, `/` or `>`. The name ends at the first
  `\t`, `\n`, `\f`, `\r`, space, `/` or `>` after `<`, the same boundary parse5's tokenizer uses.
- **Which elements:** walk the parse5 document (parsed with `sourceCodeLocationInfo: true`)
  through `childNodes` only, so `<template>` content (`content`) is never walked. Collect
  `sourceCodeLocation.startTag.startOffset` for every element that has a start tag in the source,
  except:
  - any element named `script`, `style`, `title` or `textarea`, in any namespace (SVG `script`,
    `style` and `title` too);
  - an SVG-namespace `text` element and everything inside it.

  Elements with no start tag in the source get no number: implied `html` / `head` / `body` /
  `tbody` / `colgroup` / `tr`, and the fake elements parse5 inserts for a stray `</p>` or `</br>`
  (`_insertFakeElement`), whose `sourceCodeLocation` is `null`. So an end tag never gets an
  insertion. `<template>` itself is numbered; its content is not.
- **N:** the index of the element's start offset in the ascending list of distinct collected
  offsets. Elements sharing an offset get one number and one insertion. These are formatting
  elements that parse5 reconstructs after misnesting, e.g. the second `b` in
  `<p><b>x</p><p>y</p>`. In the browser's parse of the tagged copy they carry the same `N`; 9b
  refuses a duplicated `N` and 9d shows it as not editable.
- **Offsets** are parse5 `startOffset`s: UTF-16 indices into the exact string the host read
  (a leading BOM counts as one; CRLF and astral characters do not shift them). Tests prove this.
- **Document guard:** `sourceTaggedHtml` throws (before building any output) when any collected
  offset is `>= html.length` or `html[offset] !== '<'`, that is, when `document` was not parsed
  from exactly `html`. A wrong document therefore takes the untagged fallback instead of
  corrupting the frame.
- **Output:** `sourceTaggedHtml({ html, document })` returns `html` with every insertion applied.
  Deleting each inserted ` data-cd-src="N"` gives back `html` byte for byte. The same input always
  returns the same string, so an unchanged frame re-posts identical HTML and the chrome's
  `mergeCanvasFrames` does not reload it. On a direct call, empty `html` returns `''`
  (`panelFrames` never calls it for an empty frame).
- An attribute named `data-cd-src` already in the source stays in place after ours. The browser
  keeps the first one, so the host's number wins in the frame (`data-cd-*` is reserved, 6a).

### Posting

`panelFrames({ workspaceRoot, frames, onTagError }: { workspaceRoot: string; frames: readonly CanvasViewFrame[]; onTagError: (frameId: string, error: unknown) => void }): CanvasViewFrame[]`
returns a new array of new frame objects (never mutates the view's frames). For each frame, in
this order:

1. `frame.html.length > MAX_POSTED_ARTBOARD_HTML_CHARS` (the **disk** HTML): a copy with
   `html: ''` and `errorMessage: ARTBOARD_HTML_TOO_LARGE_MESSAGE` (today's behavior and
   precedence, moved from `postedFrameFromSnapshot`).
2. `frame.errorMessage !== undefined` or `frame.html === ''`: a copy, unchanged (no parse, no
   memo entry).
3. Memo hit (same key `${workspaceRoot}\0${frame.id}` and identical disk `html`): a copy with the
   memoized `html` (no parse, no tagging, no log).
4. Otherwise compute
   `sourceTaggedHtml({ html: frame.html, document: cachedArtboardDocument({ workspaceRoot, frameId: frame.id, html: frame.html }) })`,
   store `{ html: frame.html, posted: <result> }` in the memo, and return a copy with that `html`.
   A tagged copy may exceed the cap; nothing re-checks it (the chrome has no HTML length cap).
5. If step 4 throws: call `onTagError(frame.id, error)` once, memoize `{ html: frame.html, posted:
   frame.html }` (so the same failing HTML is not retried or re-logged on every watcher event),
   and return the untagged copy. The stage keeps every frame.

After the loop, `panelFrames` deletes every memo entry whose key is not one of this call's
`${workspaceRoot}\0${frame.id}` keys, so a removed frame or a previous workspace stops holding
its string. The memo is module state in `canvasSnapshot.ts` (no `vscode`).

`canvas:updated` keeps its shape (`{activeArtboardId, generation, cspNonce, frames[{id, label, x,
y, width, group?, generation, html, errorMessage?}]}`); only `html` content changes. Untrusted
workspaces still post `frames: []`. Disk files, `read_artboard`, comment flags, comment
fingerprints and export read disk HTML and never see a tag.

Cost: one parse plus one linear tag pass per **changed** frame, on the host thread, the same
order as the comment path's parse. Watcher events for `comments.json`, `canvas.json` or handoff
writes re-post unchanged frames from the memo.

### CSP

Chrome CSP, exact order:

```text
default-src 'none'; style-src 'nonce-<nonce>' <cspSource>; style-src-attr 'unsafe-inline'; script-src 'nonce-<nonce>' <cspSource>; frame-src blob:
```

`FRAME_CSP` stays `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'`.
Its `style-src` already allows style attributes, so a frame's `style="…"` now passes both
policies, while a `url(…)` inside one is still a subresource that `FRAME_CSP`'s
`default-src 'none'` blocks. Inline event handlers (`on*` attributes) stay blocked by the chrome
`script-src`. Element-level `style-src-attr` loosens the chrome document too. The chrome renders
host and frame data only as text or geometry (rule 02 item 6), so no untrusted markup reaches it.

### Agent guidance

`skills/cursor-design/SKILL.md` line 39 becomes:

> - **Style attributes work, but keep the user's.** A `style="..."` attribute already in the file may be the user's own edit from the panel: keep it, and keep its value, when you update the artboard. For your own CSS, prefer classes in your `<style>` tag.

`ARTBOARD_HTML_RULES` in `src/mcp/artboardTools.ts` becomes exactly:

```text
The panel renders it in a sandbox: put CSS in <style> and JS in <script> (addEventListener). style="" attributes work: keep any already in the file (the user may have set them in the panel) and prefer classes for your own CSS. Inline on* handlers and anything loaded from outside the document (images, fonts, stylesheets, CDN scripts) do not work. Avoid vh units: frame height follows the content.
```

Both mention a panel edit that only exists from 9e on. That is deliberate: 9a ships ahead of
the feature it prepares, on unpushed `main`, and the wording is already true for hand-written
styles. The skill is synced to `~/.cursor/skills/` on activate when bytes differ (existing).
`agentSkill.test.ts` guards names, codes and limits; the prose is on this change.

## Testing

`pnpm test` (Vitest) for logic; `pnpm test:browser` for the CSP behavior in Chromium; F5 for the
Cursor-only checks (by `/check`).

**`src/disk/sourceTags.test.ts`.** Exact output strings are the per-element oracle for the small
cases (1-8):

1. `<!doctype html><html><head><title>t</title></head><body><div><p>a</p></div></body></html>`:
   html 0, head 1, body 2, div 3, p 4; `title` untouched.
2. `<p>a</p>` returns `<p data-cd-src="0">a</p>` (implied html/head/body get nothing).
3. `<table><tr><td>x</td></tr></table>`: table 0, tr 1, td 2; no implied `tbody` tag.
   `<p>a</br></p>` and `<div></p></div>`: no insertion at either end tag.
4. `<p><b>x</p><p>y</p>`: `<b` gets exactly one attribute. A parse5 re-parse of the output (not
   happy-dom, whose parser does not reconstruct formatting elements to spec) shows two `b`
   elements with the same value.
5. `<script>`, `<style>`, `<textarea>`, `<title>` get none, and a `<div>` written inside their
   raw text stays untouched.
6. `<template><div>x</div></template>`: template numbered, inner div not.
7. `<svg><rect/><style>r{}</style><text>hi<tspan>x</tspan></text></svg>`: svg and rect numbered;
   SVG `style`, `text` and `tspan` not (the "SVG text" reading below).
8. Source shapes: `<DIV>`, `<br/>`, `<input\n  type=text>`, and an element with its own
   `data-cd-src="99"` (ours inserted before it).
9. CRLF line endings, a leading BOM, and an emoji before tags: exact output string.
10. `fixtures/picking.html` and each `fixtures/gallery/*.html`. First assert none contains
    `data-cd-src`. Then:
    - deleting every ` data-cd-src="\d+"` gives back the input byte for byte;
    - two calls return equal strings;
    - oracle: re-parse the output with parse5, collect `[startOffset, value]` for every element
      carrying the attribute, sort by offset, drop repeated offsets, and assert the values are
      exactly `0, 1, …, k-1` (contiguous, ascending) with `k > 0`.
11. Direct call: `''` returns `''`.
12. 20,000 nested `<div>`s: the call returns (no stack overflow) and the strip round-trip holds.
    No rendering is involved.
13. Document guard: passing a `document` parsed from different HTML throws, e.g. the html of case 2
    with the document of case 1 (offset past the end), or `<p>abcdef</p>` with the document of
    `ab<p>x</p>` (no `<` at offset 2). (Corrected at implement: the original example, case 1's html
    with case 2's document, passes the guard because offset 0 is `<`.)

**`src/disk/comments.test.ts`:** `cachedArtboardDocument` for an unchanged frame returns the same
document a later flag read uses: one parse, counted with the file's existing
`parseArtboardDocument` counter (`vi.mock('./commentTarget', …)`, lines 57-63).

**`src/host/canvasSnapshot.test.ts`.** Use the repo's partial-mock pattern (as
`comments.test.ts` lines 57-63):
`vi.mock('../disk/sourceTags', async (importOriginal) => ({ ...actual, sourceTaggedHtml: vi.fn(actual.sourceTaggedHtml) }))`
and the same for `../disk/commentTarget` `parseArtboardDocument`. The real implementations run
unless a case sets `mockImplementationOnce`. Reset the memo between cases by calling
`panelFrames` with `frames: []` for the test's root (that prunes every entry). Cases:
- normal frame: `html` is tagged;
- disk HTML of exactly `MAX_POSTED_ARTBOARD_HTML_CHARS` chars is posted tagged although longer
  than the cap;
- `MAX + 1`: `html: ''` plus the too-large message, zero parse calls;
- a frame with `errorMessage`: returned unchanged, zero parse calls;
- the same frame twice with identical html: the second call makes zero `sourceTaggedHtml` and
  zero parse calls and returns the same tagged string; changed html tags again;
- a frame dropped from the list and then re-added with the same html is tagged again (pruned);
- `sourceTaggedHtml` throws once (`mockImplementationOnce`): untagged copy returned,
  `onTagError` called once with the frame id; a second call with the same html neither retries
  nor calls `onTagError` again;
- a mismatched document (the guard) takes the same untagged path: `cachedArtboardDocument`
  mocked once to return a document parsed from other HTML;
- the input `frames` array and its objects are not mutated.

`postedFrameFromSnapshot` no longer caps.

**`src/webview/frame/commentTarget.roundtrip.test.ts`** (happy-dom): stamp
`sourceTaggedHtml({ html: fixtureHtml, document: parseArtboardDocument(fixtureHtml) })` instead
of the raw fixture. Every existing assertion holds against `parseArtboardDocument(fixtureHtml)`
(untagged disk). New guard: for the elements the existing assertions already pick, plus
`html`, `head` and `body`, assert that the element carries `data-cd-src` and that `buildSelector`
returns a selector without `data-cd`. Not every element: `buildSelector` has a 200 ms timeout
each.

**`tests/browser/frameCsp.spec.ts`**, new test with `openHarness(page, { chromeCsp: true })`. The
frame HTML is exactly:

```html
<!doctype html><html><head>
<script>
	window.__violations = [];
	document.addEventListener('securitypolicyviolation', (event) => {
		window.__violations.push(event.violatedDirective);
	});
</script>
</head><body>
<p class="a" style="color: rgb(4, 5, 6)">a</p>
<p class="b">b</p>
<div class="bg" style="background-image: url(https://cdn.cd-remote.test/bg.png)">bg</div>
<button onclick="window.__inline = true">button</button>
<script>
	document.querySelector('.b').setAttribute('style', 'color: rgb(7, 8, 9)');
	document.querySelector('button').addEventListener('click', () => { window.__listener = true; });
</script>
</body></html>
```

Post it with `canvasUpdated`, wait with `untilHeightReported`, get the frame with `frameOf`, and
read values with `frame.evaluate`, as the existing tests do. Collect console messages that
include `style-src` (not the broader `Content Security Policy` filter the third test uses, and
not `style`: Chromium's blocked-handler message mentions "style attributes" in a trailing note),
and track `requestfailed` URLs starting with `https://cdn.cd-remote.test`. Expect:
- `getComputedStyle` colours of `.a` and `.b`: `rgb(4, 5, 6)` and `rgb(7, 8, 9)`;
- after a click on the button (corrected at implement: the stage shows the frame at about 0.8
  zoom and `locator.click` pans the stage, so the test scales the button's frame-local rect to the
  screen and uses the harness's `clickAt`): `window.__listener` is `true` (the click reached the frame) and
  `window.__inline` is undefined;
- `window.__violations` contains a `script-src…` directive (the inline handler) and no
  `style-src…` directive;
- the background image request is never sent: `harness.abortedRequests()` stays 0 (a request
  that reached the route counts as aborted), and any `requestfailed` for it has `failure()` text
  `csp`;
- the collected `style-src` console messages are empty.

**F5 (`/check`, Cursor-only):** in `fixtures/dev-workspace`, the frame's devtools show
`data-cd-src` on elements, and a hand-added `style="color: red"` renders with no CSP console
error. `git status` shows no change to `.cursor-design/artboards/*.html` from opening the panel. A
fresh `export_artboard` `index.html` contains no `data-cd-src`. An Agent `update_artboard` (or a
fresh tool list) shows the new `html` description.

## Notes for the AI

- Zero new dependencies.
- Tag in the host only; never import parse5 into `src/webview/`. Do not touch the frame runtime.
- `.cursor/rules/*.mdc` are symlinks. Edit the `.claude/rules/` files only.
- `updateArtboard` is unlocked today; 9c adds the lock. 9a writes nothing.
- **Reading of "SVG text" in Notion** (reversible, no persisted data): SVG `text` and its
  subtree. If Bombic meant something else, only the skip rule and test 7 change. The skip list
  (`script`, `style`, `title`, `textarea`) applies in every namespace, matching Notion's plain
  list and `stampArtboardHtml`'s namespace-blind `script, style` query.
- **0-based `N`:** an internal choice; nothing persists it.
- Keep `postedFrameFromSnapshot` sync and `vscode`-free. `panelFrames` lives in
  `canvasSnapshot.ts` (no `vscode`); only `artboardDisk.ts` wires the output channel.
- The MCP process has its own copy of the parse cache (separate process); only the host's cache
  is shared between tagging and the panel's comment flags.
- After the change, `stampArtboardHtml`'s DOMParser step carries the tagged `<html>` attributes.
  No change is needed there.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":27683,"specSha256":"414d80c6bfdfb56df5cdc9e81ce1e977d27ff02a26529bccfdc88d33a894344f","branch":"refs/heads/feature/source-tags-inline-style-csp","head":"4f899d9edf74bfbb992b6e1744909d417483cea5","baseRef":"refs/heads/main","baseCommit":"5942bad77e6aaee65c22393a9a1186630483a3ae","sourceTree":"d7f9d67dfaffa7c6b55dfb2f2337c8c189a16158","landing":"local-merge","absentOptional":[]} -->

## Findings

### 9a/F-126 [P3] closed - Tagging cost and the posted-size ceiling are understated

**File:** src/host/canvasSnapshot.ts:11
**Found:** 2026-11-19 by /audit (scope: current; lens: performance)
**Why it matters:** The 1.5M cap now applies to disk HTML only. A 1.5M-char file of bare `<p>` tags posts 11.9M chars (about 8x), with about 307 ms parse plus 211 ms tagging synchronously on the extension host and a 12M DOMParse in the chrome. The spec accepts that nothing re-checks the tagged size, but the `ponytail:` comment ("about 17 or more chars per element") hides the real ratio, and no `ponytail:` names the first-load cost of parsing and tagging every non-empty frame (the nearest note, `commentViews.ts` `documentsFor`, still describes the comment path only).
**Suggested fix:** State the worst case (about 8x posted, about 0.5 s host time per 1.5M pathological frame) and the first-load parse of every frame in the `ponytail:` text, with the upgrade path (a worker thread for parse and tag). Optionally post untagged when the tagged copy exceeds a multiple of the cap.
**Resolution:** Fixed 2026-11-19: `canvasSnapshot.ts` `ponytail:` comments name the about-8x posted worst case and the synchronous first-load parse and tag (about 0.5 s per pathological 1.5M frame) with the worker-thread upgrade path. Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

### 9a/F-127 [P3] closed - The shared parse cache's memory ceiling is unstated now that every changed frame enters it with locations

**File:** src/disk/commentViews.ts:37
**Found:** 2026-11-19 by /audit (scope: current; lens: performance)
**Why it matters:** The FIFO cache held only comment frames' trees, without locations. Panel tagging now inserts every changed frame, with source locations (measured: a realistic 1.5M-char frame about 34 MB, about 19 MB without locations; the pathological `<p>` file about 134 MB). Up to 32 entries: about 1.1 GB realistic worst case, about 4 GB pathological. Typical 20-200 KB artboards total about 64 MB, which is fine.
**Suggested fix:** Extend the existing `ponytail:` comment with the memory ceiling, or also bound the cache by total HTML chars (for example 8M).
**Resolution:** Fixed 2026-11-19: the `MAX_PARSED_DOCUMENTS` `ponytail:` comment in `commentViews.ts` states the memory ceiling (about 34 MB realistic, 134 MB pathological per 1.5M frame; about 1.1 GB worst case across 32) and the total-chars upgrade path. Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

### 9a/F-128 [P3] closed - The MCP process now parses with source locations it never uses

**File:** src/disk/comments.ts:115
**Found:** 2026-11-19 by /audit (scope: current; lens: performance)
**Why it matters:** `parseArtboardDocument` always records locations now, so the MCP's uncached parse in `comments.ts` and its own flag cache pay about 1.7x time and 1.8x memory for offsets only the host's tagging uses. Not measured on `list_comments` / `get_comment` end to end.
**Suggested fix:** Leave it with a note, or pass `sourceCodeLocationInfo` only from `cachedArtboardDocument` (keep one parse config per cache if the cache stays shared).
**Resolution:** Fixed 2026-11-19 (note, no behavior change): `parseArtboardDocument` carries a `ponytail:` naming the cost the MCP process and addComment's uncached check pay for unused locations, with the locations-flag upgrade path. Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

### 9a/F-129 [P3] closed - The tagged-copy memo is not pruned while the workspace is untrusted

**File:** src/host/artboardDisk.ts:114
**Found:** 2026-11-19 by /audit (scope: current; lens: performance)
**Why it matters:** The untrusted path returns `emptyArtboardSnapshot` without calling `panelFrames`, so the memo keeps every frame's disk HTML and tagged copy until the next trusted snapshot.
**Suggested fix:** Call `panelFrames` with an empty frame list on that path, or accept the hold.
**Resolution:** Fixed 2026-11-19: the untrusted path in `artboardDisk.ts` `loadActiveSnapshot` calls `panelFrames` with no frames, which prunes every memo entry, before returning the empty snapshot. Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

### 9a/F-130 [P3] closed - Unit-test gaps in source tags and panelFrames

**File:** src/host/canvasSnapshot.test.ts:112
**Found:** 2026-11-19 by /audit (scope: current; lens: tests)
**Why it matters:**
- `canvasSnapshot.test.ts:112`: the `broken` frame has both `html: ''` and `errorMessage`, so deleting the `frame.errorMessage !== undefined ||` check in `panelFrames` (`canvasSnapshot.ts:54`) leaves every test green.
- `sourceTags.test.ts:98`: the BOM is a raw U+FEFF byte sequence (EF BB BF) in both input and expected strings; an editor that strips it keeps the test green and no longer tests a BOM.
- `sourceTags.ts:17`: `\t`, `\f`, `\r` in `TAG_NAME_END` have no test; dropping `\t` would splice into `<div\tclass=x>` wrongly.
- No test asserts `panelFrames` calls `cachedArtboardDocument` with `{ workspaceRoot, frameId: frame.id }` (the shared-cache key).
**Suggested fix:** Give `broken` non-empty html; write the BOM as `﻿`; add a `<p\tid=a>` case to test 8; assert the `cachedArtboardDocument` call arguments in "tags a normal frame".
**Resolution:** Fixed 2026-11-19: `broken` frame has non-empty html; `cachedArtboardDocument` call args asserted; BOM written as `\uFEFF`; test 8 covers `\t`, `\f`, `\r` (each removal from `TAG_NAME_END` made it fail). Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

### 9a/F-131 [P3] closed - CSP browser test: url() assertion passes by absence, and a fifth copy of frame-to-screen scaling

**File:** tests/browser/frameCsp.spec.ts:228
**Found:** 2026-11-19 by /audit (scope: current; lens: tests, quality)
**Why it matters:** `remoteFailures.every(... === 'csp')` is vacuously true on an empty list and `abortedRequests() === 0` holds when nothing was attempted, so nothing proves the background `url()` was tried and blocked (the implementer observed `img-src` violations, but the test does not assert them). Separately, lines 203-217 re-implement frame-local-rect-to-screen scaling that `pins.spec.ts`, `commentsPanel.spec.ts`, `picking.spec.ts` and `commentPopover.spec.ts` already each do; rule 09 puts shared helpers in `harness.ts`.
**Suggested fix:** Assert `violations` contains an `img-src` directive (or poll `remoteFailures` to `['csp']` as the first test does). Extract one frame-rect-to-screen helper into `harness.ts`, starting with this spec.
**Resolution:** Fixed 2026-11-19: frameCsp polls the frame's violations to contain `img-src` (fails with the url() removed); the scaling moved to `frameElementBox` in `harness.ts`; the other four specs keep their copies (out of scope). Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

### 9a/F-132 [P3] closed - Comment hygiene and one spec line drift

**File:** src/webview/stampArtboardHtml.ts:13
**Found:** 2026-11-19 by /audit (scope: current; lens: quality)
**Why it matters:** Small drift: `stampArtboardHtml.ts:13-16` ragged reflow; `theme.test.ts:356` a 126-char comment line; `sourceTags.ts:68` `offset >= html.length ||` is redundant with `charAt` (spec-mandated, harmless); the spec's Testing section still says `frame.click('button')` while the test scales the point and uses `clickAt` (the stage zoom makes a plain click miss).
**Suggested fix:** Reflow the two comments; add a "Corrected at implement" note to the spec's frameCsp click line.
**Resolution:** Fixed 2026-11-19: `stampArtboardHtml.ts` and `theme.test.ts` comments reflowed; the spec's frameCsp click line carries a 'corrected at implement' note. The redundant `offset >= html.length` guard stays (spec-mandated). Closed 2026-11-19 by /audit re-review (scope: current; fresh Sonnet 5.5 reviewer): repaired code re-examined, defect gone, no new defect.

## Independent review

**Status:** passed
**Target commit:** 4f899d9edf74bfbb992b6e1744909d417483cea5
**Base commit:** 5942bad77e6aaee65c22393a9a1186630483a3ae
**Base ref:** main
**Spec hash:** 414d80c6bfdfb56df5cdc9e81ce1e977d27ff02a26529bccfdc88d33a894344f
**Prepared by:** claude
**Builder model:** claude-opus-5-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5-5
**Requested execution:** automatic
**Requested at:** 2026-11-19T11:06:04Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-11-19T11:12:02Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

## Handoff

Review the active spec and the complete `5942bad77e6aaee65c22393a9a1186630483a3ae..4f899d9edf74bfbb992b6e1744909d417483cea5` delta in a fresh
session or isolated subagent without the builder conversation. Run all Audit lenses from scratch.
Run Check when required above. Do not edit product code, accept findings, or
reuse the existing findings as the review scope.

## Commands

- `git rev-parse HEAD` / `git merge-base main HEAD` / `shasum -a 256 blueprint/context/current-feature.md` / `git status --porcelain --untracked-files=all`: pass (HEAD = target, merge base = base, spec hash matches, only `blueprint/context/review.md` differs)
- `pnpm verify`: pass (vp check clean over 174 files, agent-rules check, svelte-check, webview-tests tsc, 47 files / 596 unit tests, vp pack, webview build)
- `pnpm test:browser`: pass (136 passed, 182 gallery skipped; includes the new frameCsp style-attribute test)
- Scratch parse5 probe (`node --experimental-strip-types`, scratchpad only) of `sourceTaggedHtml` on 18 edge inputs: pass (tree shape unchanged and strip round-trip exact for adoption agency, foster parenting, duplicate html/body tags, `<image>`, SVG foreignObject/title, MathML annotation-xml, `>` in attribute values, frameset, implied-end `li`/`option`, comments, CDATA)

## Evidence

- `src/disk/sourceTags.ts`: iterative childNodes walk (template content never walked), skip list in every namespace, SVG `text` subtree skipped, distinct sorted offsets, document guard before any output, insertion at the tokenizer's tag-name boundary; matches spec Data / contracts.
- `src/host/canvasSnapshot.ts` `panelFrames`: cap on disk HTML first, error/empty copied without parse or memo, memo hit returns the identical string (so `mergeCanvasFrames` does not reload), failure memoized untagged and reported once, prune after loop; input frames not mutated. `postedFrameFromSnapshot` maps fields only. Only producer of posted frames is `snapshotFromCanvasView` (`panelOutbox.ts:92` maps its output).
- Shared parse cache key: `artboardDisk.ts` and `panelComments.ts:52` both pass `workspaceFolder.uri.fsPath`. No code in `src/disk` mutates a cached parse5 tree.
- Leak paths: comment picks carry `selector, tagName, text, styles` only (`selector.ts` `describeElement`); `@medv/finder`'s default `attr` filter cannot accept `data-cd-src` (its `wordLike` rejects the 2-letter word `cd`, and numeric values), and the roundtrip guard test pins that for html/head/body and the picked elements. Export, `read_artboard` and comments read disk HTML.
- Containment: `dist/webview/chrome.js` has no parse5 code; nothing under `src/webview` or `src/mcp` (non-test) imports `canvasSnapshot` or `sourceTags`; `src/webview/frame/runtime.ts` untouched.
- CSP: chrome policy string matches the spec order exactly; `FRAME_CSP` unchanged; the chrome renders no untrusted markup (no `{@html}`; the only `innerHTML` is the detached DOMParser root in `stampArtboardHtml`), so `style-src-attr 'unsafe-inline'` opens no reachable injection in the chrome document.
- Agent guidance: `ARTBOARD_HTML_RULES` and SKILL.md line 39 match the spec text; no remaining "style attributes do not work" claim in `src/`, `skills/`, `README.md`, `.claude/rules/`. Rules 02/05/07/08, README, picking fixture (dev-workspace copy is gitignored and byte-identical locally) updated as specified.
- Tests: sourceTags cases 1-13, panelFrames cases, shared-cache case and roundtrip guard all present with exact-string or counted assertions; no skipped or focused tests in the delta.

## Findings

- None new from this pass.
- Existing context, re-examined and still accurate: F-133 [P3] unverified (leads for 9b-9d), F-134 [P3] open (test comment says "this root"; prune is across roots). No P0 or P1 finding is open or fixed.

## Remaining risk

- F5 Cursor-only checks from the spec (frame devtools show `data-cd-src`, a hand-added `style` renders with no CSP console error in Cursor's webview, no artboard file changes on panel open, fresh `export_artboard` has no tags, Agent sees the new `html` description) were not run: no Extension Development Host in this reviewer context. Check was not required by the request.
- `/check` not run (not required).
- Notion 0.4 Decisions page not re-fetched; the reviewed spec is the authority used.
- Performance ceilings (synchronous host parse and tag about 0.5 s per pathological 1.5M frame, about 8x posted size, parse cache memory with locations) are documented as `ponytail:` notes, not profiled in this pass.
