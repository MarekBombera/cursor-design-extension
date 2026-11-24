---
description: Svelte 5 webview chrome - container vs view, runes with one job each, --cd-* design tokens and shared ui/ primitives, a11y, and the chrome owner catalog
globs: **/*.svelte,**/*.svelte.ts,src/webview/**
paths:
  - "**/*.svelte"
  - "**/*.svelte.ts"
  - src/webview/**
alwaysApply: false
---

# Svelte chrome

Chrome (Svelte 5 + Vite, no Kit) renders what the host posts; no MCP, workspace fs or `vscode`. Artboard HTML stays in the sandboxed iframe, never `{@html}` in chrome.

## Svelte MCP: required for every Svelte change

1. **Before writing:** `list-sections`, then `get-documentation` for every matching section; write from the docs, not Svelte 4 memory.
2. **After every edit** to a `.svelte` / `.svelte.ts` file: `svelte-autofixer` on the full file until clean.
3. Claude Code: delegate Svelte edits to `svelte-file-editor`.
4. Never `playground-link` repo files.
5. No MCP (Codex, CI): `npx -y @sveltejs/mcp --help`; never skip the autofixer. If `svelte-check` fails, follow the `vibeboard-build` skill (never weaken lint).

## Container vs view

- **One container** owns the host bridge (`src/webview/hostBridge.svelte.ts`): `acquireVsCodeApi()` once, the `message` listener, validation (unknown or malformed: ignored). Components never `postMessage` or listen for `message`.
- **Rules are a third layer.** Logic that decides (transitions, message tables, gesture and geometry math) lives in a pure `*.ts` module with a colocated test; the container holds `$state`, calls the rule, applies the result, does the I/O. Only browser tests catch a rule left in a `.svelte` file. A container past ~300 lines or 2+ jobs extracts its rules first.
- **Views** are props in, callbacks out; only tiny visual state (open, hover, focus).
- No wrapper that only forwards props. A chunky branch (toolbar, banner) is a sibling component; a one-line `{#if}` stays inline.
- Folders: `src/webview/` plus one level, then flat. `src/webview/ui/` is the one shared kit of domain-free primitives used by 2+ surfaces; one-use and comment-specific views stay flat. No barrel. A primitive is added in the change that first uses it.

## Runes: one job each

- `$state` for owned state, `$derived` for anything computed; an `$effect` that copies state is a `$derived`.
- Each `$effect` does one job (subscribe, `vscodeApi.setState`, measure) and returns its cleanup.
- `$props()` with a typed destructure; callbacks are props (`onSelect`), not `createEventDispatcher`. Shared reactive logic: a `*.svelte.ts` module, no store library.

## Styling and a11y

- **Tokens.** `src/webview/ui/theme.css` (numbered sections) is the only reader of `--vscode-*`; it declares the `--cd-*` tokens on `body`, where VS Code puts its theme classes. Components read `--cd-*` only. No hardcoded colour, no CSS framework. Spacing uses `--cd-space-*`; repeated sizes a size token; a tint a named token, never a component `color-mix`. `--cd-accent` is the generic accent. Inside Stage's scaled layer, divide by `--cd-stage-zoom`.
- **No cascade layers:** Cursor's unlayered `_defaultStyles` would beat them; `theme.css`, imported first in `main.ts`, wins by order. Nothing else is global.
- **Component styles:** one scoped `<style>` per `.svelte` file, layout only (grid, gap, position); a look lives in its primitive. Outside `ui/`: no `:focus-visible`, `:disabled`, `[aria-disabled`, `outline: none`, `all: unset` or `:global(`, and no meaning colour on text (`--cd-warning`, `--cd-error`, ...; use `Message` / `Badge`), except the named exemption tables atop `theme.test.ts` (selector plus allowed properties).
- **Reuse primitives** (catalog below); a new look is a new prop, never copied markup. With `pending` the caller says it in words ("Adding…"); an `IconButton` `label` says any count its badge shows. Icons never use `{@html}` or a `data:` mask.
- **CSP:** no `style="..."` attribute in any `.svelte` file; dynamic values use `style:` directives (CSSOM).
- **Guard:** `src/webview/ui/theme.test.ts` fails on a break of the token, colour-literal, control-state, `:global(`, meaning-colour or `style=` rules above. Fix the code, not the guard.
- Native elements first (`<button>`, `<input>`). Keyboard order, ARIA roles and live regions survive every extraction.

## Owner catalog (chrome)

Rule 05's contract: grep before writing a helper, extend the owner, never add a twin, update this list in the same change. "The one X" means no second implementation. Disk constants and the page-id guard `isPageId` come from `src/disk/layout.ts`; style apply and text rules from `src/disk/editValues.ts`.

**State and I/O.**

- `App.svelte` → what spans pages (host bridge, staged page id, status, latest comments, comment draft slot, mode handed on, the one comment-UI save `$effect`, the `PagesMenuState` and page-answer routing); `DesignPage.svelte` → one page under `{#key}`: per-page state classes, toolbar, banners, workspace, live region. Page-switch behavior: system-map "Page-scoped panel (10b)".
- `hostBridge.svelte.ts` → all host I/O; its page-bound post functions are the only place a request gets its `pageId`; `postPageRequest` posts a `page:*` as built (its `pageId` is the target page, none added).
- `canvasState.svelte.ts` → frames, the one view write path `commitStageView`, gesture, the one chrome-to-frame send `sendToFrame`.
- `commentsState.svelte.ts` → comments, panel, reply / status / copy requests. `pinThread.svelte.ts` → anchors, pins, open thread, the one focus gate `canTakeFocus`. `commentPicker.svelte.ts` → mode (one setter), hover, pick, add-comment draft.
- `pagesMenuState.svelte.ts` → `PagesMenuState`, created once by App: all page-menu state (list, open, rename draft, the one in-flight page request, error), the one page-answer rule `handleAnswer`, the switch rule `pageChanged`.
- `editState.svelte.ts` → inspector drafts, the one save path for choices / Reset / Add border `handleStyleChanges`, the one-in-flight edit queue, undo / redo, the one live region `announcement`.

**Pure rules** (`src/webview/`):

- `hostMessages.ts` → host message parse and routing; `savedState.ts` → saved stage view and comment UI parse.
- `frame/frameMessages.ts` → frame message parse, pick fields, the one prompt line `toOneLine`, `isFiniteNumber`, the one array-accepting record guard `isRecord`; `stampArtboardHtml.ts` → nonce stamping, `FRAME_CSP`.
- `stageGeometry.ts` → stage math, the one fit-zoom rule `fitZoom`, the one pre-report frame height `PROVISIONAL_FRAME_HEIGHT` (embedded in `canvas.html`); `zoomChoices.ts` → zoom menu; `frameGesture.ts` → drag / resize / wheel steps; `canvasFrames.ts` → frame merge and per-frame updates.
- `commentPick.ts` → `ChromePick`, mode choice, the one counts-in-mode verdict `pickCounts`.
- `editInspector.ts` → inspector sections; `editDrafts.ts` → draft lifecycle, the one multi-change save rule `stylesCommit`, field error copy; `editRequests.ts` → edit queue; `undoRedo.ts` → the one flag read `canStep`.
- `pins.ts` → pin layout, the one live-answer lookup `liveAnchor`, the one comment number `commentNumber`; `commentsPanel.ts` → panel items, the one frame name `frameLabel`, the one count wording `commentsText`; `commentActions.ts` → reply / status / copy actions; `commentPopover.ts` → add-comment draft, the one draft-slot rule `keptCommentDraft`.
- `pageStart.ts` → what App hands a page: the one page-change test `isPageChange`, the one start rule `nextPageStart`, the comment-list guard `isPageComments`.
- `pagesMenu.ts` → the one page-row rule `pageRows`, the one menu focus step `nextRowIndex`, the in-flight text `PAGE_REQUEST_PENDING_TEXT`.

**Views** (props in, callbacks out; callbacks named `on*`): `Stage`, `Overlay`, `Pins`, `CommentThread`, `CommentsPanel`, `CommentCard` (panel and thread, via `shell`), the one composer `Composer`, `CommentPopover`, `Inspector`, `PinChip`, `TargetRef`, `PagesMenu` (page button and Pages menu; DesignPage renders it into Toolbar's `pagesMenu` snippet).

**Frame runtime** (`src/webview/frame/`, inside the iframe; writes the design DOM only via `cd:edit-apply`): `runtime.ts` entry, `commentPicking.ts`, `editTarget.ts` (DOM reads only), `pinAnchors.ts`, `anchorRects.ts`, `pickTarget.ts`, `pickPath.ts`, `selector.ts`.

**Design system** (`src/webview/ui/`, one primitive per job): `theme.css` (tokens, the one `:focus-visible` ring, `.visually-hidden`); `Icon.svelte` + `icons.ts` every icon; `Button.svelte` every text button (`tone="agent"` on `ghost` only); `IconButton.svelte` every icon-only button; `Badge.svelte` every status pill; `Message.svelte` every notice and inline error; `Field.svelte` every inspector field (recorded exception to "2+ surfaces": its control-state and meaning-colour styles may live only in `ui/`); `keyRepeat.ts` the one held-key guard `ignoreKeyRepeat`; `EmptyState.svelte`, `Avatar.svelte`, `Widget.svelte`.

Inline scripts (`?iife`, `scripts/iifeStringPlugin.ts`): rule 05 (`handoffCanvasHtml.ts`).
