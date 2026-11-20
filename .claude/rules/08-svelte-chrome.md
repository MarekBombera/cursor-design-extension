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

Cursor's `svelte` and Claude Code's `svelte@svelte` plugin (`.claude/settings.json`) provide the `svelte` MCP server, `svelte-core-bestpractices` skill and `svelte-file-editor` agent.

1. **Before writing:** `list-sections`, then `get-documentation` for every matching section; write from the docs, not Svelte 4 memory.
2. **After every edit** to a `.svelte` / `.svelte.ts` file: `svelte-autofixer` on the full file until clean.
3. Claude Code: delegate Svelte edits to `svelte-file-editor`.
4. Never `playground-link` repo files.
5. No MCP (Codex, CI): `npx -y @sveltejs/mcp --help`; never skip the autofixer.

If `svelte-check` fails, never weaken lint, remove `typeAware` / `typeCheck` or downgrade a package; fallbacks: `cursor-design-build` skill.

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

Rule 05's contract: grep before writing a helper, extend the owner, update this list in the same change.

**State and I/O.** `src/webview/App.svelte` is the composition root: it creates one `*.svelte.ts` class per domain in dependency order, routes host and frame messages, and owns the one comment-UI save `$effect`. Host I/O only in `src/webview/hostBridge.svelte.ts` (`postToFrame`, `postCommentRequest`, `postEditRequest`, `saveStageView`, `saveCommentsPanelOpen`, `saveCommentUi`, `readSavedCommentUi`).

- `CanvasState` (`src/webview/canvasState.svelte.ts`): frames, the view's one write path `commitStageView`, gesture, scroll sink, `sendToFrame` (every chrome to frame send), `adoptEditAnswer`.
- `CommentsState` (`src/webview/commentsState.svelte.ts`): comments, panel, reply / status / copy requests.
- `PinThread` (`src/webview/pinThread.svelte.ts`): anchors (`sendAnchors`), pins, open thread, the one focus gate `canTakeFocus`.
- `CommentPicker` (`src/webview/commentPicker.svelte.ts`): the mode through one setter, hover and pick, add-comment draft, `isTextEntry`.
- `EditState` (`src/webview/editState.svelte.ts`): inspector drafts, the one-in-flight edit queue, undo / redo.

**Pure rules:**

- `src/webview/hostMessages.ts`: `parseHostMessage`, `routeMessage`, guards `isRecord`, `isFiniteNumber`. `src/webview/savedState.ts`: `parseSavedStageView`, `parseSavedCommentUi`.
- `src/webview/frame/frameMessages.ts`: `parseFrameMessage`, `parseChromeFrameMessage`, `parsePickFields`, `PickEditFields`, `FRAME_MODES`, `isFrameMode`, `FrameKey`, `hasControlChars`, the one prompt line `toOneLine`, `isSafeStyleValue`, `isTagName`, `parseFrameRect`.
- `src/webview/stampArtboardHtml.ts`: `stampArtboardHtml`, frame policy `FRAME_CSP`.
- `src/webview/stageGeometry.ts` (embedded whole in `canvas.html`): `frameRectToScreen`, the one fit-zoom rule `fitZoom` (`fitStageView`, `jumpStageView`). Chrome-only zoom menu: `src/webview/zoomChoices.ts` (`ZOOM_PRESETS`, `zoomChoices`).
- `src/webview/frameGesture.ts`: `stepFrameGesture`, `settleFrameGesture`, `failFrameGesture`, `arrowNudge`, `revealOffset`, `wheelToView` (both wheel paths), `scrollSinkStep`.
- `src/webview/canvasFrames.ts`: `mergeCanvasFrames`, `liveIframeIds`, `adoptEditAnswer`, `reloadFrame`, `applyFrameHeight`, `frameSizeText`, `demoteToTile`, `withGestureOverride`, `toChromeFrames`, `frameOutline`.
- `src/webview/commentPick.ts`: the one pick type `ChromePick`, `applyPickMessage`, `chooseMode`, `pressedMode`, the one counts-in-mode verdict `pickCounts`, `keepLiveFrames`, `clearPick`, `modeKeyAction`.
- Edit mode: `src/webview/editInspector.ts` (`inspectorView`, `editability`, `inlineValue`, `toHexColor`, `pickAnnouncementText`); `src/webview/editDrafts.ts` (`startDraft`, `fieldValue`, `draftPreview`, `baselinePreview`, `commitDraft`, `FIELD_ERROR_COPY`, `draftFate`, `textMaxLength`); `src/webview/editRequests.ts` (`enqueueEdit`, `enqueueStep`, `nextSend`, `answerEdit`, `notSaved`, `NOT_SAVED_COPY`, `clearErrorOnPick`); `src/webview/undoRedo.ts` (`historyTarget`, the one flag read `canStep`, `historyKeyStep`, `forwardedHistoryStep`).
- `src/webview/pins.ts`: `AnchorState`, `applyAnchorRects`, `dropFrameAnchors`, `anchorSends`, `pinBadge`, `pinPoint`, the one live-answer lookup `liveAnchor`, `layoutPins`, `pinLabel`, `keepOpenThread`, `resolveHeldThread`, `jumpTarget`, `JUMP_FLASH_MS`, the one comment number `commentNumber`, `statusBadge`, `flagBadge`.
- `src/webview/commentsPanel.ts`: `panelItems`, the one frame name `frameLabel`, `panelSummary`, `summaryParts`, `handoffCopy`, `relativeTime`, the one count wording `commentsText`, `liveRegionText`.
- `src/webview/commentActions.ts`: `openReply`, `editReply`, `closeReply`, `replyPending`, `canSubmitReply`, `submitReply`, `submitStatus`, `answerAction`, `keepLiveActions`, `copyPending`, `submitCopy`, `submitCopyOpen`, `answerCopyOpen`, `copyAnnouncement`, `COPY_FEEDBACK_MS`.
- `src/webview/commentPopover.ts`: `popoverKeyAction`, `draftFromPick`, `editDraftBody`, `resolveHeldDraft`, `canSubmit`, `blockedTargetCopy`, `submitDraft`, `answerDraft`, `keepLiveDraft`, `targetChipText`, `popoverAnchor`, `placePopover`.

**Views:** `Stage.svelte` (focused-frame ring, `focusViewport`), `Overlay.svelte` (hover and pick outlines), `Pins.svelte`, `CommentThread.svelte`, `CommentsPanel.svelte`, `CommentCard.svelte` (panel and thread, via `shell`), the one composer `Composer.svelte`, `CommentPopover.svelte`, `Inspector.svelte`, `PinChip.svelte`, `TargetRef.svelte`.

**Frame runtime** (`src/webview/frame/`, inside the iframe; writes the design DOM only via `cd:edit-apply`): `src/webview/frame/commentPicking.ts` (`installCommentPicking`, `visibleRect`), `src/webview/frame/editTarget.ts` (`describeEditTarget`, DOM reads only), `src/webview/frame/pinAnchors.ts` (`installPinAnchors`), `src/webview/frame/anchorRects.ts` (`anchorsMoved`, `capAnchorRect`), `src/webview/frame/pickTarget.ts` (`pickTarget`, `clipRect`, `paintsFromStyle`, `pointInTarget`, `sameRect`, `isUnchangedPick`), `src/webview/frame/pickPath.ts` (`stepToParent`, `stepToChild`), `src/webview/frame/selector.ts` (`buildSelector`, `describeElement`, `describeContent`, `isGeneratedName`, `textExcerpt`, `readStyles`).

**Design system** (`src/webview/ui/`, one primitive per job): `theme.css` (tokens, reduced motion, host-competing element rules, the one `:focus-visible` ring, `.visually-hidden`, `cd-spin`); `icons.ts` (`ICONS`, `IconName`, `IconShape`) with `Icon.svelte` for every icon; `Button.svelte` (`primary`, `secondary`, `ghost`, `segment`; `tone="agent"` on `ghost` only) every text button; `IconButton.svelte` every icon-only button; `Badge.svelte` (props in `src/webview/ui/badge.ts`) every status pill; `Message.svelte` every notice and inline error; `EmptyState.svelte` every empty view; `Avatar.svelte` every thread entry; `Widget.svelte` every floating widget.

**Inline scripts:** `scripts/iifeStringPlugin.ts` (`import source from './x.ts?iife'` is the module as an IIFE string). `src/disk/handoffCanvasHtml.ts` embeds `frame/runtime.ts?iife` and `stageGeometry.ts?iife` (with `layoutCanvasChrome`); never hand-copy either.
