# Fix: Drop the Electron test suite and css-select

**Type:** Fix
**Status:** verified (2026-11-18, agent-run; audit findings F-118 to F-129 closed)
**Branch:** `fix/drop-the-electron-test-suite-and-css-select`
**Create-from:** local `main` at `08cd755`.

**Found:** 2026-11-18, dependency review with Bombic. Goal: fewer dependencies (supply-chain risk), and a comment-target matcher without css-select's speed caps. Bombic's bar for the matcher: simple, optimized, clean error handling, edge cases handled, tested in depth (edge cases included), independently reviewed. Spec reviewed 2026-11-18 (`/feature-review`: Breaker Opus 5.5, Literalist Sonnet 5.5, both NEEDS-FIXES; rewritten by `/feature-review-fix`).

## The problem

### 1. The Electron suite is dead weight

`pnpm test` (`vscode-test`) runs [src/test/extension.test.ts](../../src/test/extension.test.ts), which is still the scaffold sample (`[1, 2, 3].indexOf(5) === -1`), unchanged since the first commit. It cannot test this extension anyway: `@vscode/test-electron` runs plain VS Code, which has no `vscode.cursor.mcp.registerServer`. Playwright (`pnpm test:browser`) proves chrome and frames, F5 proves Cursor-only behavior. It costs 3 dev dependencies (`@vscode/test-cli`, `@vscode/test-electron`, `@types/mocha`) that pull in about 99 of the 407 installed packages (lockfile count during spec research), plus config files and doc lines that tell everyone "the Test command is not `pnpm test`".

### 2. css-select is the biggest part of what we ship, and needs caps

`src/disk/commentTarget.ts` matches a comment's stored selector against the artboard file with `css-select` over `parse5-htmlparser2-tree-adapter`. Those two account for 9 of the 14 runtime packages in the lockfile closure of `dependencies` (research count). The selectors are only ever our own finder grammar, but css-select is a general engine:

- it backtracks once per descendant combinator per ancestor: `p div div div` took 87 ms at depth 100 and 14 s at depth 400;
- `:nth-child` / `:nth-of-type` rescan siblings per candidate: quadratic (2.2 s at 20,000 siblings).

It runs synchronously in the MCP queue and, for `comment:create`, on the extension host thread, so a slow match freezes every Agent tool call or the panel. Today's guard refuses (flags `null`, "unchecked") any selector with more than 2 descendant steps and any page deeper than 64, larger than 20,000 elements or wider than 5,000 siblings. It also disagrees with Chromium on camelCase SVG tags and attribute names: it lowercases the selector, so `foreignObject` (emitted by the `nthOfTypePath` fallback, which uses `localName`) never matches.

## The fix

1. Delete the Electron suite and everything that exists only for it. `pnpm test` becomes `vp test` (Vite+ runs tests once by default).
2. Replace css-select and the adapter with one small in-house module, `src/disk/selectorMatch.ts`. It parses the finder grammar and matches it over parse5's **own** tree (no adapter) in one linear walk with one work ceiling. Remove the four caps and `documentShape`; keep every other guard. Flags stay the same except where the old code refused to check or disagreed with Chromium.

Parity is proven, not assumed: step 2 records the current css-select results as a golden snapshot **before** anything changes. A fixed case table is run through **real Chromium** (Playwright) and through the new matcher, and the two must agree. Research already checked that parse5's default tree serializes identically to the htmlparser2 adapter: 137 of 137 elements across `fixtures/picking.html`, `fixtures/pins.html` and an edge page (template, svg, foreignObject, table, textarea, pre, quotes and entities in attributes) gave byte-equal `serializeOuter`, so stored `targetFingerprint`s do not flip to stale.

### Contract

```ts
// src/disk/selectorMatch.ts (new, pure: no I/O, no DOM, no vscode, no logging)
import type { DefaultTreeAdapterMap } from 'parse5';

// Every element of `document` that `selector` matches, in document order.
// null when the selector is outside the finder grammar, or when matching would cost more than
// MAX_MATCH_WORK (the caller reports unchecked). Never throws, for any string.
export const selectMatches = (
	document: DefaultTreeAdapterMap['document'],
	selector: string,
): DefaultTreeAdapterMap['element'][] | null;
```

- The matcher also returns `null` past `MAX_SELECTOR_CHARS` (1000, the pick and `comments.json` cap), before any regex runs: V8's regexp stack throws on a token of about 8M characters (F-126).
- `commentTarget.ts` keeps its exports and signatures (`parseArtboardDocument`, `ArtboardDocument`, `matchCommentTarget`, `targetAgrees`, `commentFlags`, the `HINT_*` copy, `CommentMatch`, `CommentFlags`). `ArtboardDocument` becomes parse5's default document type; `parseArtboardDocument` drops the `treeAdapter` option. A `null` from `selectMatches` becomes `{ checkable: false }` (hint `HINT_UNCHECKED`, as the old caps did). `matchCommentTarget`'s per-document cache stays.
- **Error handling (deliberate):** the `try` / `catch` around the match goes. `selectMatches` never throws by contract, proven by a property test. A throw would be a programmer bug, and rule 06 says bugs throw: it fails the read loudly instead of hiding as "unchecked".

### Grammar

Unchanged for every selector the pick and `comments.json` guards allow (they reject control characters). Stricter only on inputs those guards already block.

```text
selector := compound ( " > " compound | " " compound )*
compound := tag simple* | simple+
tag      := ident
simple   := "#" ident | "." ident | "[" ident '="' string '"]'
          | ":nth-child(" digits ")" | ":nth-of-type(" digits ")"
ident    := ( [A-Za-z0-9_-] | escape | any code point >= U+0080 )+
string   := ( any char except '"', '\', LF, CR, FF | escape )*
escape   := "\" hex{1,6} " "?   → that code point; 0, a surrogate or > U+10FFFF → U+FFFD
          | "\" any char except a hex digit, LF, CR or FF → that char
digits   := [0-9]+              → Number(digits); 0, or anything past the sibling count, matches nothing
```

- Tokenize with one sticky regex, one token at a time, in which every character has exactly one reading. A hex escape takes all the hex digits it can (the 7th is a literal) and always the space after them, so a failing token gives up in linear time. The old `IDENT` regex took 67 s on a run of escapes, and a first version of this one backtracked 2^n on `\31 ` inside a value (F-118).
- A hex escape's one trailing **space** belongs to the escape, not a combinator or a value character: `#\31 23 p` is id `123`, then a descendant `p`. A tab after a hex escape makes the selector `null`. A raw NUL or lone surrogate is `null` too: Chromium reads it as U+FFFD, so answering would claim a missing target.
- `null` for: the empty string, other pseudo-classes, `*`, `+`, `~`, `>` without the spaces, double spaces, leading or trailing space, single quotes, unquoted or bare `[attr]`, a `\` at the end or before LF / CR / FF.
- `ident` has no start rule, the same as today's regex, so `#123`, `.1a`, tag `1a` and lone-`-` idents such as `#-` and `.-1` are accepted (Chromium throws on them). finder never emits these, because `CSS.escape` escapes leading digits. Accepting them keeps parity and answers what was meant.

### Matching rules (measured in Chromium, 2026-11-18)

The frame copy always starts with `<!DOCTYPE html>` (`stampArtboardHtml`), so the page finder ran on is an HTML document in no-quirks mode. "HTML element" means `namespaceURI` is the HTML namespace. All case folds use one ASCII-only helper that maps A-Z only, never `toLowerCase()`: U+212A KELVIN SIGN must not match `k`.

| Part | Rule (Chromium) |
|---|---|
| tag | ASCII case-insensitive against `tagName`, for **every** element, SVG and MathML included (`foreignobject`, `foreignObject` and `FOREIGNOBJECT` all match) |
| `#id` | the `id` attribute with no namespace equals the value exactly (case-sensitive) |
| `.class` | the `class` attribute with no namespace, split on ASCII whitespace, contains the value exactly (case-sensitive) |
| `[name="value"]` | an attribute with **no namespace** (`xlink:href` never matches `[href="…"]`) whose name equals ASCII case-insensitively, on every element (`[viewbox=…]` matches SVG `viewBox`). The value matches exactly, except ASCII case-insensitively **on HTML elements only** when the name is one of: `accept`, `accept-charset`, `align`, `alink`, `axis`, `bgcolor`, `charset`, `checked`, `clear`, `codetype`, `color`, `compact`, `declare`, `defer`, `dir`, `direction`, `disabled`, `enctype`, `face`, `frame`, `hreflang`, `http-equiv`, `lang`, `language`, `link`, `media`, `method`, `multiple`, `nohref`, `noresize`, `noshade`, `nowrap`, `readonly`, `rel`, `rev`, `rules`, `scope`, `scrolling`, `selected`, `shape`, `target`, `text`, `type`, `valign`, `valuetype`, `vlink` (HTML spec "case-sensitivity of selectors"; one `Set` constant with that link) |
| `:nth-child(n)` | 1-based index among the parent's element children; the document is the parent of `html` |
| `:nth-of-type(n)` | 1-based index among element siblings with the same `tagName` and `namespaceURI` |
| `" > "` / `" "` | parent element / any ancestor element |
| `<template>` | its `content` is never searched (parse5's default tree keeps it out of `childNodes`) |

Attribute lookup scans parse5's `attrs` array, and nth-of-type counts use a `Map` keyed by namespace and tag. Never use plain-object keys: `<constructor>` and `[__proto__="x"]` are legal artboard HTML.

### Algorithm (linear, bounded)

One iterative top-down walk in document order with an explicit stack, so deep pages cannot overflow the call stack. For each element E, compute which selector steps E **completes**, meaning steps 0..i matched with E as step i:

1. Using only **strict-ancestor** state, for each step i in order, the prefix holds when:
   - i is 0;
   - or step i's combinator is `>` and E's parent completed step i-1;
   - or step i's combinator is a space and `ancestorCount[i-1] > 0`.

   Only when the prefix holds, check whether E matches compound i. E's own completions never feed its own prefix checks: a lone `div` does not match `div div`.
2. Then, for each step E completed, increment `ancestorCount[step]`, push E's frame and visit its children. When E is left, decrement the same counters.
3. Elements that complete the last step are the matches.

State:

- `ancestorCount` is one `Int32Array(steps)`.
- Each stack frame holds its element's completed steps in a `Uint8Array(steps)`. The parent's array answers the `>` prefix.
- Memory is depth × steps bytes, and the work ceiling bounds depth × steps.
- Sibling indexes for `:nth-child` / `:nth-of-type` are computed once per parent, as its children are pushed, and only when the selector contains an nth step.

**Work ceiling.** `MAX_MATCH_WORK = 10_000_000` units. Per element the walk adds the selector's checks (one per compound plus one per simple selector) and the element's attribute count, and returns `null` (unchecked) as soon as the total passes the ceiling. Each element's no-namespace attributes (by folded name) and class set are read once, on first use, so every check is one lookup. That bounds one match at about 0.3 s whatever the selector's length or the page's size (F-120).

The comment on the ceiling must start with `ponytail:` and name the ceiling: one match is uninterruptible up to `MAX_MATCH_WORK`; N distinct selectors on one read mean N walks; parse time still grows with file size. It also names the upgrade path: one pass for all of a document's selectors, or a worker thread.

### What else changes in commentTarget.ts

- `collectedText` becomes iterative (no recursion), same output. `CommentMatch.tagName` stays `tagName.toLowerCase()`, and `hasElementChild` and `fingerprintOf` (`serializeOuter` without the adapter) keep their output.
- Remove `FINDER_SELECTOR`, `COMBINATOR_STEP`, `IDENT` / `SIMPLE` / `COMPOUND`, `isCheckableSelector`, the four caps, `documentShape`, `isCheckableDocument`, the `try` / `catch` and the long cap comment.
- Keep `CHECK_BUDGET_MS` (200 ms per read) and `MAX_PARSED_DOCUMENTS` in `comments.ts`. Update the `comments.ts` comments that name css-select (lines 456, 461, 532, 564, 568). The parse-time ponytail (line 530) keeps its parse-size ceiling but drops the 64-deep / 20,000-element caps it cites.

### Intended changes (the only allowed golden-snapshot diffs)

1. Selectors and pages past the old caps become checkable, with correct results. This includes selectors the old guard refused only because a hex escape's trailing space counted as a descendant step.
2. Any record where the new answer equals Chromium's, proven by a case in the Chromium table (`selectorMatch.cases.ts`) added for it. Known up front:
   - camelCase SVG tags in any case (`foreignObject`, `foreignobject`);
   - SVG attribute names in any case (`[viewbox=…]`).

   Scope note: the pick guard `isTagName` (`^[a-z][a-z0-9-]*$`) rejects a camelCase `localName`, so a `foreignObject` element is never itself a comment target. The tag fix matters for its descendants, through the `nthOfTypePath` ancestor step.

Any other diff is a bug in the new matcher.

## Out of scope

- `@vitest/coverage-v8` stays (not approved for removal). knip stays.
- No change to finder, the pick message, `comments.json`, the stored selector format, the 200 ms budget, `MAX_PARSED_DOCUMENTS`, or the unchecked hint copy.
- No source tags for comments: 0.4's `data-cd-src` numbers change on every file edit, and comments must survive edits.
- History stays as written: `blueprint/history/**`, `blueprint/reference/**`, the shipped 7c / 7d / 8e lines in `build-plan.md` and `project-overview.md` (feature list), `blueprint/context/findings.md`.

## Build steps

### Step 1: Remove the Electron suite

- **Baseline first:** record `pnpm dlx @vscode/vsce@3.9.2 ls --no-dependencies` output and the lockfile's package count in Results.
- Delete `.vscode-test.mjs`, `tsconfig.test.json`, `src/test/`.
- `package.json`:
  - drop the `compile-electron-tests` script, and set `"test": "vp test"`;
  - drop the `@types/mocha`, `@vscode/test-cli` and `@vscode/test-electron` dev dependencies;
  - drop the `overrides` entries for `diff` and `serialize-javascript` (they exist only for the mocha chain);
  - run `pnpm install`.
- Drop the lines that exist only for the suite. First confirm nothing else writes `out/` before dropping its entries.

  | File | Lines to drop |
  |---|---|
  | `knip.json` | `src/test/**/*.ts`, `.vscode-test.mjs`, `ignoreDependencies` |
  | `vite.config.ts` | lint ignore `out`, `.vscode-test`, `src/test`; fmt ignore `**/out/**`, `**/.vscode-test/**`; test `exclude: ['src/test/**']` |
  | `tsconfig.json` | the `src/test` exclude |
  | `.gitignore` | `out`, `.vscode-test/` |
  | `.vscodeignore` | `.vscode-test/**`, `out/**`, `tsconfig.test.json`, `**/.vscode-test.*` |
  | `.vscode/extensions.json` | `ms-vscode.extension-test-runner` |
  | `.vscode/settings.json` | the `out` entries in `files.exclude` / `search.exclude` |
- Docs: `AGENTS.md` (Commands › Test, and the Electron paragraph), `.claude/rules/09-tests.md` (the description and the runner line), `blueprint/context/coding-standards.md` (Testing), `blueprint/project-plan.md` (the Verify line's Electron clause), `blueprint/context/project-overview.md` (line 127, the Tooling line). The Test command becomes `pnpm test` / `vp test`.
- Delete the local, gitignored `.vscode-test/` (downloaded VS Code) and `out/` folders.

**Done when:**
- `git grep -nE "vscode-test|test-electron|test-cli|extension-test-runner|compile-electron|types/mocha|tsconfig\.test|src/test" -- . ':!blueprint/history' ':!blueprint/reference' ':!blueprint/context/current-feature*.md' ':!blueprint/context/feature-review.md' ':!blueprint/context/findings.md' ':!pnpm-lock.yaml'` finds only the shipped 7c / 7d lines in `build-plan.md` and the 7d feature-list line in `project-overview.md`.
- `pnpm test` runs the Vitest suite once and exits.
- `pnpm knip` and `pnpm verify` pass.
- The lockfile no longer lists the three packages.

### Step 2: Record the golden snapshot (css-select still in place)

New `src/webview/frame/commentTarget.golden.test.ts` (`// @vitest-environment happy-dom`). It lives under `src/webview/` because it needs the DOM lib (`tsconfig.webview-tests.json`), like the round-trip test. It records `matchCommentTarget` results with `expect(records).toMatchSnapshot()` into `src/webview/frame/__snapshots__/` (the convention of `src/disk/__snapshots__/`). Records:

- **Real picks:** for every element under `body` in `fixtures/picking.html`, `fixtures/pins.html` and `fixtures/jump.html`, take the selector that `buildSelector(element, 60_000)` makes in happy-dom on the stamped document (as the round-trip test does). The 60 s timeout keeps finder off its timing-dependent fallback. Match it against the parsed file.
- **Edge corpus:** an inline edge page plus a hand list covering:
  - CSS escapes: `#\31 23`, `.a\:b`, `.café`, `\000041`, `\41 B`, out-of-range and surrogate hex;
  - quotes and backslashes in attribute values, `[rel="NoOpener"]`;
  - `:nth-child` / `:nth-of-type` on mixed siblings, `nth` of 0, leading zeros, past the end;
  - template content duplicating a live element;
  - SVG (`svg > circle`, `foreignObject`, `foreignobject`, `[viewbox=…]`), MathML;
  - implied `html` / `head` / `body` / `tbody`, `html:nth-child(1)`, duplicate ids;
  - the `nthOfTypePath` fallback form, and each out-of-grammar form;
  - **over-cap inputs:** a 100-deep page, a 6,000-sibling list, and a 3-descendant-step selector.
- **Each record:** `selector`, `checkable`, `matches`, `tagName`, `text`, `fingerprint`, `hasElementChildren`.

**Done when:** the snapshot is written from the current css-select code, the test passes twice in a row with the same snapshot, and no product code changed.

### Step 3: Add `selectorMatch.ts`, its case table and its tests

- `src/disk/selectorMatch.ts`, built to the Contract, Grammar, Matching rules and Algorithm above. Loop variables follow lint `id-length` (min 2), so write `index` / `step`, never `i`.
- `src/disk/selectorMatch.cases.ts`: the shared case table, pure data: `{ name, html, selector, expected: string[] | null }`.
  - `html` marks elements with `data-t="…"`, and `expected` lists the matched markers in document order.
  - `null` means out of grammar.
  - It covers every Matching-rules row: foreign tags and attribute names in mixed case; `xlink:href` versus `[href]`; the case-insensitive list on HTML elements and **not** on SVG; `html` under the document; template content; `<constructor>` and `[__proto__="x"]`; and a Kelvin-sign tag. It also covers escapes and the intended-change cases.
- `src/disk/selectorMatch.test.ts` (node environment, no DOM):
  - **Case table:** every case through `selectMatches` over `parse5.parse(html)`, mapped to `data-t` markers.
  - **Grammar:** accept and reject lists, **copied** (not moved) from `commentTarget.test.ts`'s out-of-grammar, finder-form and hostile-escape tests. Plus escape decoding:
    - 1 to 6 hex digits, with the 7th digit a literal;
    - the trailing space, and a trailing tab giving `null`;
    - the U+FFFD cases;
    - `\` + space, `\` at the end, `\` + LF / CR / FF;
    - the empty string.
  - **Order:** a lone `div` against `div div` gives 0 matches.
  - **Odd nodes:** a document with a doctype, comments and text around and between `html`, `head` and `body`.
  - **Scale** (timed with `performance.now()`, parse excluded, each bound `< 1000` ms):

    | Page | Selector | Expected |
    |---|---|---|
    | 10,000 deep | `p div div div` | 0 |
    | 10,000 deep | `div div div` | 9,998 |
    | 50,000 `li` siblings | `li:nth-child(3)` | 1 |
    | 50,000 `li` siblings | `li:nth-of-type(49999)` | 1 |
    | 5,000 deep | `'div '.repeat(249) + 'div'` (999 chars, 250 steps) | 4,751 |
    | 39,000 deep | the same 250-step selector (under the ceiling) | 38,751 |
    | 100,000 deep | the same 250-step selector (over the ceiling) | `null` |

    Record the measured times and the 100,000-deep heap in Results; no heap assertion (flaky).
  - **Never throws:** fast-check over arbitrary strings (`fc.string({ unit: 'binary' })`, 2,000 runs), astral and control characters included, on a small fixed document. It returns `null` or an array.
- `tests/browser/selectorMatch.spec.ts`: the **Chromium authority**. For every non-`null` case in `selectorMatch.cases.ts`, `page.setContent(html)` and `querySelectorAll(selector)`, mapped to `data-t` markers, must equal `expected`. Browser tests are local-only, so this step's verification runs `pnpm test:browser`.
- `src/webview/frame/selectorMatch.oracle.test.ts` (`// @vitest-environment happy-dom`): a random-tree cross-check over the subset where happy-dom is known correct.
  - fast-check, 300 runs: well-formed trees of `div` / `span` / `section` / `article` only (no implied-end-tag tags), classes from `a` / `b` / `c`, ids `x` / `y`, `data-k` values `1` / `2`.
  - Selectors are generated from those names with `:nth-child` / `:nth-of-type` 1 to 3 and both combinators.
  - Excluded, because the Chromium table covers them: escapes, foreign elements, case-insensitive attributes, digit-start idents.
  - `selectMatches` element paths must equal happy-dom's `querySelectorAll` paths. Any failing seed becomes a literal case in `selectorMatch.cases.ts`.

**Done when:** `vp test` and `pnpm test:browser` pass, product code does not use the module yet, and `commentTarget.test.ts` is unchanged.

### Step 4: Switch commentTarget.ts and drop css-select

- `commentTarget.ts` uses `selectMatches` over parse5's default tree, with the removals and keeps listed above.
- In `commentTarget.test.ts`:
  - delete the grammar tests copied in step 3;
  - replace the cap tests with their new truth: the old "not checkable" deep, wide and large pages are checkable with the right count;
  - add a test that a selector over `MAX_MATCH_WORK` reads unchecked.
- Run the golden test. Its diff must contain only intended changes. Record each changed record in Results, with the Chromium case that justifies it. Then **delete the golden test and its snapshot**: rule 09 allows snapshots only for generated artifacts. The case table, the Chromium spec, the oracle and the round-trip test carry the regression load from here.
- Remove `css-select` and `parse5-htmlparser2-tree-adapter` from `package.json` and from `alwaysBundle` (`vite.config.ts`), then run `pnpm install`. The `tsconfig.json` comment becomes `// Bundler resolution: vp pack emits CJS; parse5 is ESM-only.`
- Docs:
  - `blueprint/context/system-map.md`: lines 107-108 (the cap sentence becomes "through the in-house `selectMatches` (finder grammar, linear, unchecked past `MAX_MATCH_WORK`)") and line 282 (css-select → the matcher);
  - `.claude/rules/05-single-job.md` owner catalog: add `selectMatches` / `MAX_MATCH_WORK` in `src/disk/selectorMatch.ts`, and the case table;
  - `skills/cursor-design/SKILL.md` and `README.md` carry no cap wording, so confirm and leave them.

**Done when:**
- `vp test` (round-trip, `comments.test.ts` and the MCP contract tests included) and `pnpm test:browser` pass.
- `git grep -nE "css-select|htmlparser2" -- . ':!blueprint/history' ':!blueprint/reference' ':!blueprint/context/current-feature*.md' ':!blueprint/context/feature-review.md' ':!blueprint/build-plan.md' ':!blueprint/context/project-overview.md' ':!pnpm-lock.yaml'` finds nothing.
- After `pnpm compile`, `grep -cE "css-select|htmlparser2-tree-adapter|domhandler|css-what|nth-check|boolbase|domutils" dist/mcp.js dist/extension.js` prints 0 for both.
- `pnpm knip` is clean.

### Step 5: Repair the audit findings (F-118 to F-124)

Found by two fresh reviewers (Opus 5.5 high, Fable 5.2 medium) in `/audit current`; ledger in `blueprint/context/findings.md`.

- **F-118 (P0):** a deterministic escape space in the token regex, so no escape has two readings. Hostile runs of `\aaaaaa`, `\31 `, `\1 ` and `\000031 ` in idents, attribute names, unterminated values and combinators must all return `null` in linear time.
- **F-119 (P1):** `collectedText` pushes children one at a time. A test reads a 200,000-child target.
- **F-120 (P1):** the work ceiling counts checks and attribute reads, and lookups go through per-element maps. Tests cover a 4,000 × 200-attribute page with `#a`×499 and `[b199="1"]`×99, and a 200,000-character selector.
- **F-121 (P2):** the oracle builds selectors from true facts along an ancestor chain. A selector-shaped fuzz runs with a per-run time bound.
- **F-122 (P3):** NUL and lone surrogates read as `null`, and so does a tab after a value escape.
- **F-123 / F-124 (P3):** Results and spec text corrected, and the dead guard and stale comments removed.

**Done when:** `pnpm verify`, `pnpm test:browser` and `pnpm knip` pass, and the findings are `fixed` in the ledger, awaiting a re-review to close them.

Re-review (Fable 5.2 medium) closed F-118, F-119 and F-121 to F-124. It kept F-120 open: a case-insensitive value check still folded the whole attribute (1 MB: 35 s). It also found F-126 to F-129 (P3). Repairs:

- **F-120:** fold only at equal length.
- **F-126:** `null` past `MAX_SELECTOR_CHARS`.
- **F-127:** cases for a lone `xlink:href`, class separators and mid-compound tags; the nth-of-type key is now the tag alone.
- **F-128:** fail-fast hostile runs, no per-run fuzz bound, `LINEAR_BOUND_MS` 5,000.
- **F-129:** the redundant guard is gone, and `decodeEscapes` replaces `unescape`.

Two mutants were checked: removing the length check (6 s, fails) and removing the namespace filter (fails).

Second re-review (Fable 5.2 medium) closed F-126, F-128 and F-129. It kept two open:

- **F-120:** a same-length fold was charged 1 unit but cost the value's length (7.6-27.5 s under the ceiling). Repaired: case-insensitive values are pre-folded at parse, their length is charged in `checks`, and `asciiFold` folds runs.
- **F-127:** foster parenting gives `<mi>` an HTML and a MathML `<mglyph>`. Repaired: the namespace is back in the nth-of-type key, with two Chromium-table rows.

Both were closed by a normal `/audit` pass, because Bombic asked to stop further Fable rounds. The reported shapes now return `null` in 25-186 ms, and the ceiling cases take 277-391 ms.

## Verify

- `pnpm verify`, `pnpm knip` and `pnpm test:browser`.
- `pnpm vsix` builds, and its `vsce ls` list equals the step 1 baseline.
- The MCP contract tests cover the `list_comments` / `get_comment` flags through the real server.
- Record measured counts in Results: lockfile packages before and after, and the runtime closure of `dependencies` before and after.
- Review: this spec went through `/feature-review`. Bombic asked for an independent code review with the selector matcher as its focus: run `/audit current` (independent) before `/complete`.

## Results

Built 2026-11-18 on `fix/drop-the-electron-test-suite-and-css-select` (from `main` `08cd755`). All four steps done.

**Checks run**

- `pnpm verify`: pass (43 files, 569 tests).
- `pnpm knip`: clean.
- `pnpm test:browser`: 135 passed (the 182 gallery shots are skipped as usual). That includes the Chromium case table, which agrees with every non-null case.
- Oracle: 5 runs × 300 random trees, all pass.
- `pnpm vsix`: 12 files, 359 KB. The `vsce ls` list is identical to the Step 1 baseline (10 files).
- The `css-select|htmlparser2` grep finds nothing outside the exempt history files. The bundle grep prints 0 for `dist/mcp.js` and `dist/extension.js`.

**Package counts** (lockfile closure)

| | Before | After |
|---|---|---|
| Installed packages | 407 | 299 (−108: 99 from Step 1, 9 from Step 4) |
| Runtime closure of `dependencies` | 14 | 5: `@modelcontextprotocol/server` + `core`, `parse5` + `entities`, `zod` |

**Golden diff** (Step 2 snapshot vs the new matcher; then deleted per rule 09)

- **Real picks:** all 110 on `picking.html`, `pins.html` and `jump.html` are identical, fingerprints included.
- **Intended 1** (past the old caps):

  | Selector | Before | After |
  |---|---|---|
  | `.caf\e9 ` (hex-escape trailing space) | unchecked | 1 |
  | `html body div span` (3 descendant steps) | unchecked | 2 |
  | deep-100 `div div div` | unchecked | 98 |
  | deep-100 `p div div div` | unchecked | 0 |
  | wide-6000 `li:nth-child(3)`, `li:nth-of-type(5999)` | unchecked | 1 each |
- **Intended 2** (Chromium agrees):

  | Selector | Before | After | Chromium cases |
  |---|---|---|---|
  | `svg > foreignObject > div`, `svg > foreignobject > div` | 0 | 1 | "through foreignObject", "camelCase SVG tag…" |
  | `[viewbox="0 0 10 10"]`, `[viewBox="0 0 10 10"]` | 0 | 1 | "SVG attribute name…" |
- **Not in the spec's list: fingerprint change.** Elements containing an SVG `<a xlink:href="#x" href="#y">` changed fingerprint: the `a` itself, plus `html` and `body` on the edge page. This is not a matcher change. The htmlparser2 tree keyed attributes by local name, so it serialized only one of `xlink:href` / `href`, and an edit to the other never made the comment stale. parse5's own tree keeps both.
  - Effect: a stored comment whose target contains an element with a namespaced and a plain attribute of the same local name reads stale once after the upgrade.
  - A lone `xlink:href` (for example `<use xlink:href>`) serializes identically in both trees, so its fingerprint is unchanged.
  - New test: `editing a namespaced SVG attribute inside the target changes the fingerprint`.

**Measured** (Node 26 alone, Bombic's laptop; the parallel Vitest run is up to 4× slower)

| Page and selector | Time |
|---|---|
| 5,000 deep, 250 steps | 31-52 ms |
| 39,000 deep, 250 steps (9.75M element-steps) | ~250 ms |
| 100,000 deep, 250 steps (past `MAX_MATCH_WORK` → null) | 240-300 ms |
| 39,000 deep, 166 class steps | ~225 ms (1.4 s before the per-element class cache) |

Heap growth for a parse plus walk of the 100,000-deep page: about 55 MB, most of it parse5's tree.

**Golden diff, completed after audit (F-123)**

Opus rebuilt the old matcher from `main` and ran old against new over the case table. These diffs also agree with Chromium and have table cases (Intended 2):

| Selector | Before | After | Why |
|---|---|---|---|
| `#\0`, `#\d800`, `#\110000` | 0 | 1 | U+FFFD id |
| `.\000061\3A b` | 0 | 1 | |
| `\70 ` | unchecked | 4 | |
| `[rel="noopener"]` | 3 | 2 | the old code also folded the SVG `<a>`'s value |
| Kelvin sign | 1 | 0 | the old code matched `<k>` |

One more fingerprint change: the old object-keyed tree serialized integer-like attribute names first (`<p b="1" 1="2">` became `<p 1="2" b="1">`), so targets with such names read stale once, like the `xlink:href` + `href` case above.

**Audit repairs, measured after F-118 to F-120** (Node 26 alone)

| Case | Before | After |
|---|---|---|
| `[a="` + `\31 `×249, `\1 `×330, `\000031 `×100 | never finishes | 0 ms, `null` |
| 4,000 × 200-attribute page, `#a`×499 | 26 s | 108 ms |
| Same page, `[b199="1"]`×99 | | 89 ms |
| `.a`×100,000 on 20,000 elements | 12 s | 104 ms, `null` |
| 39,000 deep, 250 steps (9.75M units) | | 280 ms |
| 100,000 deep, 250 steps (past the ceiling) | | 240 ms, `null` |
| 1,000,000 siblings, `i` | | 270 ms |

The rewritten oracle passed 5 × 500 runs, and it catches both a `>`-as-descendant mutant and an element-counts-as-its-own-ancestor mutant. Its fact-built selectors exposed a happy-dom bug: two ids, or an id after a pseudo-class, are miscounted. Our matcher agreed with Chromium on all of them. Those shapes are now literal cases in the Chromium table, and the generator keeps at most one fact of each kind, in canonical order.

**Deviations from the spec, each simpler or measured**

- **Parser.** The first build hand-parsed char by char: 414 lines for the whole module. After Bombic's "pretty complex" review it is one sticky token regex with an unambiguous escape (a hex escape always takes every hex digit it can), so a failing token gives up in linear time. Hostile-run tests now cover idents, attribute names, attribute values and combinators. After the audit repairs the module is about 290 lines formatted, about 50 of them comments.
- **Completed steps.** Each frame stores them as a `Uint8Array(steps)`, not a `Uint32Array` bitset. The work ceiling bounds frames × steps to 10M bytes, so bitsets saved nothing worth their code.
- **Hot path.** Index loops and one `Target` per element (folded tag, indexes, lazily built attribute map and class set), with no closure or iterator pair per (element, step). `every()`, `forEach` and `entries()` there cost 2-3× on the 39,000-deep case.
- **Scale tests.** The bound is 3,000 ms, not 1,000. The parallel suite measured 1,013 ms for the 39,000-deep case, which runs in 250 ms alone. A return to backtracking costs seconds to minutes, so the looser bound still catches it.

## Notes for the AI

- Rules 03 (ponytail), 04, 05, 06 and 09 apply. The matcher is pure: return `null`, never throw, no logging.
- No new dependency. fast-check, happy-dom and Playwright are already installed.
- Keep `selectorMatch.ts` small and readable: the parser and the walk are the whole module. If it grows much past about 200 lines, stop and ask why.
- 0.4 Edit-lite will map clicks to source with parse5's default tree too (`data-cd-src`), so moving comments onto that tree now leaves one tree format in the disk lib.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":33483,"specSha256":"5fe577b0fe4c9e61e23f3ed64704d4ed6dd6b05fcf4c9a54d5981eb02c4a56da","branch":"refs/heads/fix/drop-the-electron-test-suite-and-css-select","head":"08cd755a4ee97a4f3f575dc71168da292622fe93","baseRef":"refs/heads/main","baseCommit":"08cd755a4ee97a4f3f575dc71168da292622fe93","sourceTree":"513f64c7ab44c43e6295790e193065cc014edbf3","landing":"local-merge","absentOptional":[]} -->

## Findings

### drop-the-electron-test-suite-and-css-select/F-118 [P0] closed - Escapes followed by a space inside an attribute value backtrack exponentially

**File:** src/disk/selectorMatch.ts:45 (`ESCAPE`, reused in the `TOKEN` attribute-value group)
**Found:** 2026-11-18 by /audit (scope: current; all lenses; fresh reviewers Opus 5.5 high and Fable 5.2 medium, both found it independently)
**Why it matters:** Inside `"..."` a space is both a plain value character and the optional terminator of a hex escape, so `\31 ` reads two ways and an unterminated value backtracks 2^n. `[a="` + `\31 `×22 took 141 ms (reproduced), ×26 about 1.2 s, and a 1000-char selector never finishes. It passes the length and control-character guards, so a forged `cd:pick` hangs the extension host in `addComment`, and a hand-edited `comments.json` hangs every MCP comment read and every panel refresh. Regression: the old matcher refused it in 3 ms. The hostile-run test used `\aaaaaa`, which never puts a space after an escape.
**Suggested fix:** Make the escape's trailing space deterministic (`(?: |(?![ \t]))`: a following space is always the escape's, a following tab fails), and add hostile runs with `\31 `, `\1 ` and `\000031 ` inside an unterminated value to the test.
**Resolution:**
2026-11-18 fix/drop-the-electron-test-suite-and-css-select: `ESCAPE` now ends `(?: |(?![ \t]))`, so a hex escape always takes the space after it and every token character has one reading. `[a="` + `\31 `×249 / `\1 `×330 / `\000031 `×100 return `null` in 0 ms (were exponential). Test `hostile runs of escapes are rejected in linear time` covers 4 runs × 7 positions (ident, class, attribute name, unterminated value, combinator).
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): no two-reading escape shape among 19 hostile shapes at 30k and 300k chars (worst 179 ms at 300k); a 200,000-run piece fuzz peaked at 8.7 ms; the `' ?'` mutant hangs the suite.

### drop-the-electron-test-suite-and-css-select/F-119 [P1] closed - `collectedText` throws RangeError on a target with a very wide subtree

**File:** src/disk/commentTarget.ts:65
**Found:** 2026-11-18 by /audit (scope: current; all lenses; both fresh reviewers)
**Why it matters:** `stack.push(...[...node.childNodes].reverse())` spreads a whole child list as call arguments; past about 125,000 children V8 throws `RangeError` (reproduced). The old 5,000-sibling cap kept such pages away; with the caps and the `try`/`catch` gone, one comment on a frame that grows wide fails the whole `list_comments` / `get_comment` / panel read and `comment:create`.
**Suggested fix:** Push children one at a time in reverse with a plain loop; add a test with a 200,000-child descendant list.
**Resolution:**
2026-11-18: `collectedText` starts from the element and pushes children one at a time. Test `a target with a very wide subtree is read without throwing` (200,000 children) fails with RangeError on the old spread (mutation-checked) and passes now.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): 300,000 element children, 300,000 text/comment children and a 50,000-deep target all return (43-227 ms).

### drop-the-electron-test-suite-and-css-select/F-120 [P1] closed - `MAX_MATCH_WORK` counts steps, not checks, so it does not bound one match

**File:** src/disk/selectorMatch.ts:231 (`work += steps.length`), with `attributeValue` at :113
**Found:** 2026-11-18 by /audit (scope: current; all lenses; both fresh reviewers)
**Why it matters:** Each step can hold hundreds of simple selectors, and each `#id`, `.class` or `[attr]` check scans `element.attrs` linearly and folds every name. Reproduced: 4,000 elements × 200 attributes with `#a`×499 took 26 s at a counted work of about 4,000; Fable measured `[a999="1"]`×99 on 2,000 × 1,000-attribute elements at 14 s, and an uncapped 200k-char selector at 12 s. The comment's "about 0.25 s" and "bounds any input regardless" are false. Reachable with a hostile page plus a forged pick (a design's script controls both).
**Suggested fix:** Charge what is evaluated: per element, the selector's total simple-selector count plus the element's attribute count. Make lookups O(1): build a per-element map of no-namespace attributes (folded names) and a class set once, lazily. Re-measure and correct the comment.
**Resolution:**
2026-11-18: `parseSelector` returns `checks` (1 per compound + 1 per simple selector); the walk charges `checks + element.attrs.length` per element. Each element's no-namespace attributes (folded names) and class set are built once on first use (`attributesOf` / `classesOf`), so a check is one lookup. Measured: `#a`×499 on 4,000 × 200 attributes 26 s → 108 ms; `.a`×100,000 → `null` in 104 ms; ceiling cases 240-280 ms. Comment corrected to about 0.3 s. Test `MAX_MATCH_WORK counts every check`.
Re-review 2026-11-18 (Fable 5.2 medium) kept it open: a case-insensitive value check folded the whole attribute value on every failing compare (1 MB values: 35 s at about 20,000 counted units). Repaired: `attributeMatches` folds only when `actual.length === value.length` (ASCII folding keeps length), so a check costs at most the selector's own value. Test `a long attribute value never costs a fold per check` (200 KB values: 6 s before, mutation-checked; under 1 s now). Comments in `selectorMatch.ts` and the spec reworded. Awaits re-review.
Re-review 2026-11-18 (Fable 5.2 medium) kept it open again: a same-length fold was charged 1 unit while costing the value's length (`[type="AAAAAAAAAA"]`×52 on 181,808 `<i type=AAAAAAAAAa>`: 7.6 s; 40-char ×20 on 454,535 elements: 27.5 s). Repaired: `parseSelector` stores each case-insensitive value pre-folded and adds its length to `checks`; `asciiFold` folds runs, not letters. Closed 2026-11-18 by /audit (normal mode, after Bombic asked to stop further Fable rounds): re-ran the reported shapes on the repaired code: 10×52 → `null` in 186 ms, 40×20 → `null` in 103 ms, 988×1 → `null` in 25 ms; a single 10-char fold over 400,000 elements answers in 349 ms; earlier ceiling cases 277-391 ms. Test row added to `MAX_MATCH_WORK counts every check`.

### drop-the-electron-test-suite-and-css-select/F-121 [P2] closed - The random oracle rarely exercises combinators, and the never-throws fuzz never gets past the first token

**File:** src/webview/frame/selectorMatch.oracle.test.ts:47; src/disk/selectorMatch.test.ts:179
**Found:** 2026-11-18 by /audit (scope: current; tests lens; Fable 5.2 medium)
**Why it matters:** Independent random constraints rarely match: only 0.3% of oracle samples had a combinator and a match, so one 300-run execution caught a `>`-as-descendant mutant 7 times in 40 (the case table kills it). The binary-string fuzz dies at the first token, so it could not find F-118, and nothing tests a tab after a hex escape inside a value.
**Suggested fix:** Build oracle selectors from true facts along a random element's ancestor chain (with occasional perturbations for negatives); fuzz with selector-shaped tokens (escapes with spaces, quotes, brackets, combinators) under a time bound.
**Resolution:**
2026-11-18: the oracle builds selectors from true facts along a random element's ancestor chain (one fact per kind, canonical order, an occasional random swap), 500 runs; it now catches the `>`-as-descendant and own-ancestor mutants (mutation-checked). It exposed a happy-dom bug (two ids, or an id after a pseudo-class), now literal Chromium-table cases. New selector-shaped fuzz: 3,000 runs of escape, quote and combinator pieces, each under 100 ms.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): the piece fuzz gets past the first token and the case table kills the combinator mutants; remaining gaps became F-127.

### drop-the-electron-test-suite-and-css-select/F-122 [P3] closed - NUL, lone surrogates and a tab after a value escape disagree with Chromium or the spec

**File:** src/disk/selectorMatch.ts:48 (`TOKEN`), :76 (`parseSelector`)
**Found:** 2026-11-18 by /audit (scope: current; both fresh reviewers, verified in Chromium)
**Why it matters:** Chromium maps a raw NUL or lone surrogate to U+FFFD and matches; the matcher answers `[]`, which reads as "target missing" (lone surrogates pass the control-character guards). `[data-x="\31<TAB>x"]` matches `data-x="1<TAB>x"` where Chromium matches `"1x"` and the spec says `null`.
**Suggested fix:** Return `null` (unchecked) for a selector containing NUL or a lone surrogate; the F-118 escape rule already makes the tab case `null`.
**Resolution:**
2026-11-18: `parseSelector` returns `null` for a raw NUL or lone surrogate; the F-118 escape rule makes a tab after a value escape `null`. Covered in `selectors outside the finder grammar are null`.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): NUL, lone surrogates and tab-after-escape return `null`; raw astral characters still match.

### drop-the-electron-test-suite-and-css-select/F-123 [P3] closed - Results lists only part of the before/after differences

**File:** blueprint/context/current-feature.md (Results › Golden diff)
**Found:** 2026-11-18 by /audit (scope: current; Opus 5.5 high, old matcher rebuilt from `main`)
**Why it matters:** Old vs new over the case table also differs on `#\0` / `#\d800` / `#\110000` (0 → 1), `.\000061\3A b` (0 → 1), `\70 ` (unchecked → 4), `[rel="noopener"]` (3 → 2: the old code folded it on SVG too) and the Kelvin sign (1 → 0). All agree with Chromium and have table cases. Also undocumented: the old object-keyed tree serialized integer-like attribute names first (`<p b="1" 1="2">`), so those fingerprints change too.
**Suggested fix:** List them in Results.
**Resolution:**
2026-11-18: Results › Golden diff completed with the escape, `\70 `, `rel` and Kelvin diffs and the integer-like attribute-name fingerprint change.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): Results lists every named difference.

### drop-the-electron-test-suite-and-css-select/F-124 [P3] closed - Matcher cleanups

**File:** src/disk/selectorMatch.ts:217, :236-246, :148, :48; blueprint/context/current-feature.md
**Found:** 2026-11-18 by /audit (scope: current; quality lens; both fresh reviewers)
**Why it matters:** `if (frame !== root)` is dead (the root's completed array is all zeros); `steps[index]` plus two `undefined` guards where `steps.entries()` reads cleaner; the "no closure per call" comment is contradicted by `attributeValue`'s `find`; the module-level sticky `TOKEN` carries hidden `lastIndex` state; the spec still describes a char-by-char parser and a bitset.
**Suggested fix:** Drop the guard, iterate `entries()`, fix the comment, build the token regex per parse, update the spec text.
**Resolution:**
2026-11-18: dead root guard removed (the document frame pops with all-zero counts); index loops kept on purpose (entries()/forEach measured 2-3× slower) with a comment saying so; stale comments fixed; the token regex is built per parse (no module-level `lastIndex` state); spec Grammar / Algorithm / Work ceiling text matches the code.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): cleanups done; one more redundant guard became F-129.

### drop-the-electron-test-suite-and-css-select/F-126 [P3] closed - `selectMatches` throws RangeError on a selector of about 8.4M characters

**File:** src/disk/selectorMatch.ts (`parseSelector`)
**Found:** 2026-11-18 by /audit re-review (Fable 5.2 medium)
**Why it matters:** V8's regexp stack overflows on one token of about 8.4M characters, so "never throws, for any string" was false; 2M steps also spent 1.7 s in parsing before any work was charged. Unreachable today (every caller caps at 1000 chars), but the matcher claims no cap of its own.
**Suggested fix:** Return `null` past `MAX_SELECTOR_CHARS` before parsing.
**Resolution:**
2026-11-18: `parseSelector` returns `null` when `selector.length > MAX_SELECTOR_CHARS` (imported from `layout.ts`), before any regex runs. Tests: an 8.4M-char selector is `null` in under 1 s; `'.b'.repeat(501)` is in the out-of-grammar list. Awaits re-review.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): the cap is the first operand, so no regex runs past it; removing it is killed by `'.b'.repeat(501)`. Its one gap (nothing pinned that exactly 1000 chars is accepted) is filled: `'.b'.repeat(500)` is in `every finder form parses`.

### drop-the-electron-test-suite-and-css-select/F-127 [P3] closed - Four matcher rules had no test that fails when they break

**File:** src/disk/selectorMatch.test.ts, src/disk/selectorMatch.cases.ts
**Found:** 2026-11-18 by /audit re-review (Fable 5.2 medium, 29-mutant run)
**Why it matters:** These mutants survived every test: dropping the namespace filter (the fixture's plain `href` happened to win), a tag in the middle of a compound, splitting classes on `\s`, the namespace in the nth-of-type key, and the attribute-count part of the work charge.
**Suggested fix:** Add a lone `xlink:href` case, mid-compound tags, NBSP / VT class cases, and test or simplify the nth-of-type key.
**Resolution:**
2026-11-18: case table adds a lone `xlink:href="#z"` (`[href="#z"]` → none; mutation-checked), NBSP / VT / tab class separators (Chromium agrees); the out-of-grammar list adds `:nth-child(1)p` and `[id="a"]p`; the nth-of-type key is now the tag alone (the parser never gives one parent same-tag children from two namespaces), so that branch is gone. Not pinned: the `element.attrs.length` part of the charge, which needs more than 10M attributes (50 MB+) to change a result; a test comment says so. Awaits re-review.
Re-review 2026-11-18 (Fable 5.2 medium) kept it open: the nth-of-type simplification was wrong. Foster parenting puts an HTML `<mglyph>` beside a MathML one under one `<mi>` (parse5 and Chromium agree), and Chromium counts them per namespace. Repaired: the key is namespace plus tag again, with the comment naming the case; two Chromium-table rows pin it (`mi > mglyph:nth-of-type(1)` → both, `:nth-of-type(2)` → none). Closed 2026-11-18 by /audit (normal mode): the Chromium table passes with the new rows, and the other new cases (lone `xlink:href`, NBSP / VT / tab classes, mid-compound tags) kill their mutants per the re-review.

### drop-the-electron-test-suite-and-css-select/F-128 [P3] closed - Timing asserts could flake, and a backtracking regression would hang the suite

**File:** src/disk/selectorMatch.test.ts
**Found:** 2026-11-18 by /audit re-review (Fable 5.2 medium)
**Why it matters:** a per-run 100 ms bound inside a 3,000-run property fails on one GC stall; the scale bound of 3,000 ms was seen at 3,440 ms under memory pressure; the hostile runs (`\31 `×249) would hang instead of failing if F-118 regressed.
**Suggested fix:** Drop the per-run bound, loosen the scale bound, and run short hostile runs first.
**Resolution:**
2026-11-18: the selector-shaped fuzz asserts only that nothing throws; `LINEAR_BOUND_MS` is 5,000; hostile runs go 10×, 28×, 120× per unit, each under 1 s, so a two-reading regression fails within seconds. Awaits re-review.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): no per-run fuzz bound; a two-reading mutant fails at 28× after 8.8 s instead of hanging.

### drop-the-electron-test-suite-and-css-select/F-129 [P3] closed - Redundant empty-compound guard and a name that shadows a global

**File:** src/disk/selectorMatch.ts
**Found:** 2026-11-18 by /audit re-review (Fable 5.2 medium)
**Why it matters:** the combinator branch's empty-compound return duplicated the final check; `unescape` shadowed the deprecated global; the spec's line count was stale; the lone-`-` idents (`#-`, `.-`) were not named next to the digit-start ones.
**Suggested fix:** Delete the guard, rename, update the spec.
**Resolution:**
2026-11-18: guard removed (an empty compound is refused once, after the loop); `unescape` is `decodeEscapes`; spec updated. Awaits re-review.
Closed 2026-11-18 by /audit re-review (Fable 5.2 medium): the single empty-compound check still refuses every empty form; `decodeEscapes` is the only name left.

## Try it now

No UI changed, so the observation is the checks themselves:

1. `pnpm test`: the Vitest suite now runs from the obvious command (574 tests); there is no Electron suite left.
2. `pnpm exec playwright test -c tests/browser selectorMatch`: Chromium answers every case in `src/disk/selectorMatch.cases.ts` the same way the in-house matcher does.
3. `node -e "console.log(Object.keys(require('./package.json').dependencies))"`: `@modelcontextprotocol/server`, `parse5`, `zod` (no `css-select`).
4. In the Extension Development Host, add a comment, edit its target in the artboard file, and call `get_comment`: it reads `stale: true` as before.
