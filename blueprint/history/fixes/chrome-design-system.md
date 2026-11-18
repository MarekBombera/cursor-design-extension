# Fix: Chrome design system

**Type:** Fix
**Status:** verified
**Branch:** fix/chrome-design-system

UI/UX pass step 4 (memory plan, 2026-11-17). Bombic approved one direction in the `/prototype` round ("looks decent lets do it"): **native, quiet, editor-grade**. This fix builds it into the real Svelte chrome on a styling architecture meant to last: one token layer, a small global layer, reusable primitives, and a guard test that keeps it that way. Subagents implement step by step. A foundations review follows step 1, and an independent critical review follows step 5 (see Review plan). Spec reviewed by Breaker (Opus 5.5) and Literalist (Sonnet 5.5), both NEEDS-FIXES; this is the rewrite.

**Design reference:** `prototypes/` (untracked today; committed on this branch in step 1, deleted at `/complete` once the tokens live in `src/webview/ui/theme.css`):
- `theme.css`: PART A = the tokens to port; PART B = browser-only theme emulation, never ported to `src/`
- `components.css`: the vocabulary; its `.cd-i--*` rules hold the icon SVGs (URL-encoded data URIs, decode them for `icons.ts`)
- `system.html`, `toolbar-stage.html`, `comments-panel.html`, `popover-thread.html`, `pins.html`

Published viewer: https://claude.ai/artifact/9T8VJg2Vm9XVmPhAhg68WK. Critique (29 items): https://claude.ai/artifact/T1dSw6eHw8LSzrJ6Z4F4qV. The mockups decide the look; this spec decides behavior, names and structure.

## The problem

The chrome works and uses theme tokens, but it reads as unstyled HTML in VS Code colours, and its CSS has no shared layer:

- **No shared vocabulary.**
  - Button CSS (`.action`, `.primary`, the `button` reset) is copied into 5 files.
  - `:focus-visible` is defined in 7 files, with two widths.
  - `[aria-disabled] { opacity: .5 }` is in 3 files, and `:disabled` in a 4th.
  - The `.chip` and `textarea` rules are near-identical in `CommentCard` and `CommentPopover`.
  - `.popover` and `.thread` are near-twin widget shells.
  - `.badge` means three different things in Toolbar, Pins and CommentCard.
- **Raw `--vscode-*` everywhere,** so there is no single place to fix a theme-wide problem. Two real ones:
  - `focusBorder` equals `button.background` in Default Dark/Light Modern, so the 1px ring vanishes on primary buttons and filled pins.
  - In Light Modern, `descriptionForeground` equals `foreground`, so nothing is muted.
- **The only global styles** live in `App.svelte`'s `:global` block: html/body, `#svelte-root` and `.visually-hidden`.
- **Accessibility:**
  - Disabled and pending look the same (opacity .5, 2.2–3.2:1).
  - Error and warning text is colour-only and fails contrast in Light Modern (2.9–3.4:1).
  - The resolved pin's check is 1.68:1.
- **Hierarchy:**
  - Pins are anonymous and can't be matched to cards.
  - The Agent's reply looks like the user's.
  - The handoff to the Agent is the weakest action on screen.

## The fix

### Locked decisions

1. **Restyle, no new behavior.** Messages, state, the keyboard model, focus rules and live regions stay the same. The only logic additions are:
   - the pure display rules under **Rules**, each with a colocated test;
   - these accepted view additions:
     - the Interact button (it leaves Comment mode; a no-op in Interact mode);
     - the Comment-mode hint pill;
     - the lifted look of the frame under a move gesture;
     - the frame size in its label;
     - the copy count kept in the copy feedback state.

   Out of scope:
   - grouping overlapping pins;
   - hiding resolved pins;
   - dismissable banners;
   - one selection shared across pin, card and thread;
   - constant-screen-size frame labels;
   - a Comment-mode cursor inside the artboard iframe;
   - a hover tag label on the outline.
2. **One design-system folder: `src/webview/ui/`.** It holds only domain-free pieces used by 2+ surfaces:
   - `theme.css`, `icons.ts`;
   - `Icon`, `Button`, `IconButton`, `Badge`, `Avatar`, `Message`, `EmptyState`, `Widget`;
   - the guard test `theme.test.ts`.

   Comment-specific shared views stay flat in `src/webview/`: `PinChip.svelte` and `TargetRef.svelte`. There is no barrel file; import each primitive by path. Each primitive is created in the step that first uses it (step 1: `Icon`, `Button`, `IconButton`), so no primitive exists without a caller.
3. **`ui/theme.css` is the one global stylesheet, with no cascade layers.**
   - **Why no layers.** Cursor's webview shell prepends its own **unlayered** `_defaultStyles` to every webview. Verified in `Cursor.app/.../webview/browser/pre/index.html`. It sets:
     - `body`: transparent background, `color: editor-foreground`, `padding: 0 20px`;
     - `kbd`;
     - `a/input/select/textarea:focus`: an outline.

     Layered rules lose to that. Unlayered rules at equal specificity win by source order, because `chrome.css` loads after the injected sheet. Today's unlayered `:global` block wins this way.
   - **Order and contents of `theme.css`:**
     1. **Tokens** on `body`, not `:root`: the `--cd-*` set from `prototypes/theme.css` PART A, built only from `var(--vscode-*)` and `color-mix()`, plus `--cd-dropdown-bg/fg/edge` (from `--vscode-dropdown-*`). Declaring on `body` keeps theme-class overrides correct: VS Code puts `vscode-dark`, `vscode-light`, `vscode-high-contrast` and `vscode-high-contrast-light` on `body`, and derived tokens (`--cd-shadow-widget`, `--cd-shadow-frame`, `--cd-input-edge`) re-resolve against the overridden base tokens only when they are declared on the same element. Drop PART A's `[data-host]` selector (prototype only).
     2. **Theme overrides:**
        - `body.vscode-dark, body.vscode-high-contrast:not(.vscode-high-contrast-light) { --cd-on-agent: var(--vscode-editor-background) }` gives dark ink on purple in every dark theme.
        - The high-contrast block redeclares `--cd-edge`, `--cd-frame-edge`, `--cd-divider` and `--cd-agent-bg`, and every token derived from them.
     3. **Reduced motion:** `@media (prefers-reduced-motion: reduce)` and Cursor's `body.vscode-reduce-motion` (the editor setting, which does not change the media query) both set `--cd-dur: 0ms` and `--cd-spin: none`. Pending buttons say so in words ("Adding…"), so nothing relies on the spin.
     4. **Host-competing element rules,** plain selectors so they win by order:
        - `html`, `body`, `#svelte-root`, moved verbatim from `App.svelte`, with `body { padding: 0 }` kept explicit;
        - `kbd` (token look);
        - `textarea` and `select` (input / dropdown tokens, `--cd-radius-sm`);
        - `textarea:focus-visible, select:focus-visible` (VS Code's inset ring: `outline: 1px solid var(--cd-focus); outline-offset: -1px`).

        These are the only element styles, and they are why `CommentCard` and `CommentPopover` no longer carry textarea CSS.
     5. **The one focus ring:** `:focus-visible { outline: var(--cd-focus-ring); outline-offset: var(--cd-focus-offset) }`. A component that needs a different offset (pins, frame labels) changes only `outline-offset` in its scoped style.
     6. **Utilities:** `.visually-hidden` (moved from App) and the `cd-spin` keyframes.
   - **Component styles:** a scoped `<style>` in each `.svelte` file, reading only `--cd-*` tokens. A primitive's look lives in that primitive. Surfaces compose primitives and keep only layout CSS (grid, gap, position). Svelte's scoped class selectors outrank the global element rules, so no `!important` is ever needed. No new global classes: `.cd-btn` and friends stay prototype-only.
   - **Import:** `theme.css` is imported first in `src/webview/main.ts`, so it lands in the same `chrome.css` the nonce'd `<link>` already loads. No new file reaches the webview, and the CSP doesn't change.
4. **CSP stays clean.**
   - No `style="…"` attribute in any `.svelte` file (they are CSP violations in Cursor). Dynamic values use `style:` directives only, as today.
   - Icons are inline `<svg>` elements rendered by `Icon.svelte` with `{#each}` over typed shapes. Never `{@html}`, never `mask-image: url(data:…)` (the prototype's masks are browser-only).
5. **Guard test `src/webview/ui/theme.test.ts`** (Vitest, node `fs`, no DOM; a static check over files, which rule 09 allows).
   - **Prep.** Strip CSS comments first. Scan `src/webview/**/*.svelte` (their `<style>` blocks, except where noted) and `src/webview/**/*.css`. `ui/theme.css` is exempt from 1 and 4.
   - **It fails when:**
     1. A scanned file mentions `--vscode-`.
     2. A `var(--cd-…)` is used but `--cd-…` is declared neither in `ui/theme.css` nor in the same file's `<style>`. Component-local tokens are allowed; token typos fail.
     3. A **declaration value** of a colour-bearing property (`color`, `background*`, `border*`, `outline*`, `fill`, `stroke`, `box-shadow`, `text-decoration*`, `caret-color`, `accent-color`) contains:
        - `#` + 3, 4, 6 or 8 hex digits;
        - one of `rgb(`, `rgba(`, `hsl(`, `hsla(`, `hwb(`, `lab(`, `lch(`, `oklab(`, `oklch(`, `color(`;
        - or a whole-word CSS named colour, from the full named-colour list pinned in the test.

        `transparent`, `currentColor`, `inherit` and `color-mix(…)` over tokens are allowed. Selectors and other properties (`white-space`, class names, grid areas) are never matched.
     4. Outside `ui/` and the documented exceptions (Pins `.pin`, Stage `.label` and the resize handle), a `<style>` block contains `outline: none`, `outline: 0`, `all: unset`, a `:focus-visible` rule, a `:disabled` rule or an `[aria-disabled` rule. Those states belong to the primitives.
     5. A `.svelte` file (whole file) contains a static `style="` attribute, or a `style:` directive whose quoted value is a colour literal.
   - **Fixtures:** each matcher has one failing fixture string and the colour matcher one false-positive fixture (`white-space: nowrap`, `.red-card {}`), so deleting or loosening a matcher fails the test.
6. **Primitive APIs.** All use Svelte 5 runes and a typed `$props()` destructure, with callbacks as props. Every primitive except `Icon` spreads `...rest` onto its root native element. That passes through `aria-*`, `data-cd-*`, `id`, `title`, `hidden`, event handlers and `{@attach}` attachments: Svelte forwards component attachments through a props spread.

   | Primitive | Props | Notes |
   |---|---|---|
   | `Icon` | `name: IconName`, `size?: 12 \| 14 \| 16 \| 24 \| 32` (default 16) | `<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">`. Size comes **only** from the attributes; no component sizes an icon in CSS. No rest. |
   | `Button` | `variant?: 'primary' \| 'secondary' \| 'ghost' \| 'segment'` (default `'secondary'`; `segment` = one option of a segmented group, pressed = card fill + edge shadow, used by the toolbar mode group); `size?: 'md' \| 'sm'` (default `'md'`); `tone?: 'agent'` (ghost only, enforced by the props type; tints the icon only); `icon?: IconName`; `pending?: boolean`; `block?: boolean`; `children: Snippet`; `...rest: HTMLButtonAttributes` (no `class`: parents position primitives with flex/grid on themselves or a wrapper, never `:global`) | `type="button"` unless rest overrides it. Passes `disabled` and `aria-disabled` through untouched; callers keep their click guards exactly as today. **Disabled look:** `:disabled` and `[aria-disabled='true']` share one style: `--cd-fg-disabled` text, no hover, primary drops to the secondary fill, never opacity. **Pending:** a spinner `Icon` replaces `icon`, `aria-busy="true"`, and it keeps its own fill. Pending wins over the disabled look when both apply (the popover's Add is `aria-disabled` while pending). |
   | `IconButton` | `icon: IconName`, `label: string` (becomes `aria-label`, and `title` unless rest sets one), `count?: number` (badge when > 0), `...rest` (attachments such as focus restore ride on rest; no `element` binding) | 24px, hover `--cd-bg-hover`. `aria-pressed="true"` and `aria-expanded="true"` render VS Code's toggle style (`--cd-toggle-on-*`). |
   | `Badge` | `tone: 'accent' \| 'agent' \| 'success' \| 'warning' \| 'neutral'`, `icon?: IconName`, `label: string`, `description?: string`, `...rest: HTMLAttributes<HTMLSpanElement>` | Pill, 11px. Text stays `--cd-fg`; the tone colours the icon and a 15% tint. `description` renders twice: as `title` for pointer users, and as a `.visually-hidden` span after the label for assistive tech. |
   | `Avatar` | `author: 'you' \| 'agent'`, `...rest` | 20px, `aria-hidden="true"` (the author name always sits next to it). You: neutral initial "Y". Agent: `--cd-agent` fill with the sparkle icon in `--cd-on-agent`. |
   | `Message` | `tone: 'info' \| 'warning' \| 'error'`, `variant?: 'inline' \| 'banner'` (default `'inline'`), `icon?: IconName` (default per tone), `children: Snippet`, `...rest` | Icon + text in `--cd-fg` on the validation tint (`--cd-*-bg`). `banner` is a full-width row with a bottom divider. |
   | `EmptyState` | `icon: IconName`, `title: string`, `children?: Snippet`, `...rest` | VS Code welcome-view style, centred. |
   | `Widget` | `header: Snippet`, `children: Snippet`, `footer?: Snippet`, `left?: number`, `top?: number`, `width?: number` and `height?: number` (both `$bindable`, bound to `offsetWidth` / `offsetHeight` on the root, which feeds `placePopover` exactly as the popover and thread roots do today), `element?` (`$bindable`), `...rest` (`role`, `aria-*`, `tabindex`, `data-cd-comment-popover`, `onkeydown`, `onpointerdown`, `onwheel` on the root) | Editor-widget shell: `--cd-bg-widget`, `--cd-shadow-widget`, `--cd-radius-md`, width `--cd-widget-w` (340px) with today's `max-width: calc(100% - 1rem)` kept; a header row, a scrolling body (`overscroll-behavior: contain`) and a fixed footer. `left`/`top` go through `style:left` / `style:top` in px. |
   | `PinChip` (flat) | `number: number`, `status: PostedComment['status']`, `...rest` | The pin's number in the pin's colour, for cards and the thread header. |
   | `TargetRef` (flat) | `frame: string`, `element: string`, `icon?: IconName` (default `element`), `jumpLabel?: string`, `onjump?: () => void`, `...rest` | `frame`, a chevron `Icon`, then `element` (ellipsis), in the UI font, not monospace. With `onjump` it is a `<button aria-label={jumpLabel}>` with link hover; without it, a `<span>`. |

   **`icons.ts`:**
   - Export `type IconShape = { kind: 'path'; path: string; fill?: true } | { kind: 'circle'; cx: number; cy: number; radius: number; fill?: true } | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number }`.
   - Export `ICONS` as a record of `readonly IconShape[]` per name (`as const satisfies`), and `type IconName = keyof typeof ICONS`.
   - Shapes are stroked by default; `fill: true` fills with `currentColor` and drops the stroke (`dot`, `sparkle`, the dots of `warning` / `info` / `question`).
   - Source: decode each `.cd-i--*` data URI in `prototypes/components.css`. Add an icon only in the step that first renders it; at the end, every name in `ICONS` has a caller.
7. **Agent identity:** `--cd-agent` (`charts.purple`) marks the Agent everywhere: the Agent avatar, the Agent reply tint, sent pins and chips, and the sparkle on "Copy for Agent". Text on purple uses `--cd-on-agent`.
8. **Copy changes.** Approved in the mockups. The locked prompts in `src/host/commentPrompt.ts` are untouched.

   | Today | New |
   |---|---|
   | Card / thread "Copy prompt" | "Copy for Agent" (ghost, sm, `tone="agent"`, sparkle). After success: "Copied" with the check icon, from today's `copiedKey`, same `COPY_FEEDBACK_MS`. |
   | Panel "Copy all open (N)" | `handoffCopy` (Rules): "Copy 1 open comment for Agent" / "Copy N open comments for Agent", primary, block, sparkle. |
   | Panel "Copy all open (0)" | "Nothing new to send" (still rendered, `aria-disabled="true"`). Hint below: "1 comment is with the Agent." / "N comments are with the Agent." when any are sent; otherwise no hint. |
   | Panel copy-open "Copied" | "Copied 1 comment" / "Copied N comments" (secondary, check icon), hint "Now paste into Cursor Agent chat." N is the `count` of that `ui:copied` answer. |
   | Panel headings "Unresolved (n)" / "Resolved (n)" | "Unresolved · n" / "Resolved · n" in section-title style. Uppercase via CSS only; the `·` is in an `aria-hidden` span, so the name reads "Unresolved 3". |
   | (none) | Panel summary line `panelSummary` (Rules): "3 to send · 2 with Agent · 2 resolved". Zero parts are omitted; the line is omitted when all are zero; `·` is `aria-hidden`. |
   | Toolbar "Comments (n)" | Comments `IconButton` with a count badge. `label` is "Comments, 1 unresolved" / "Comments, n unresolved", or "Comments" when 0. Keeps `aria-expanded` and `aria-controls`. |
   | Toolbar "Comment" toggle | Mode group "Interact" \| "Comment" (see Surfaces). |
   | Toolbar readout + "Zoom preset" select | One `<select aria-label="Zoom">` that shows the current zoom (`zoomChoices`). |
   | Toolbar "Click to comment." | Stage hint pill: "Click an element to comment · Esc to leave". |
   | Toolbar "Handoff out of date. Re-export." | Warning `Badge` "Handoff out of date", description "Re-export the handoff to update it." |
   | "No artboard yet." | `EmptyState` "No artboard yet" + "Ask Cursor Agent to design something. It shows up here as you work." |
   | Card flag lines ("Stale: the element changed…" etc.) | `Badge` from `flagBadge` (Rules), placed after the comment body. |
   | Popover "Parent" / "Child" + hint "↑ parent · ↓ child" | `IconButton` arrow-up / arrow-down (labels "Select parent element" / "Select child element"); footer hint `<kbd>↑</kbd> <kbd>↓</kbd> parent / child`. |
   | Thread "Close" button | `IconButton` close, `label` "Close". |
   | Popover / reply textarea (no placeholder) | Placeholders "Comment for the Agent…" / "Reply to the Agent…". |

   **Kept as is:**
   - "MCP unavailable. Artboard still loads from disk." (first sentence bold);
   - the tile copy constants (`RENDER_ERROR_COPY`, `EMPTY_ARTBOARD_COPY`);
   - "Frame not shown.", "You", "Agent";
   - all live-region announcements;
   - every pin aria-label except the added number;
   - the dialog names "Add comment" / "Comment", and the panel landmark "Comments".

### Rules

All rules are pure and colocated with their tests, and the owner catalog is updated for each.

| Rule | Owner | Contract | Edge cases the test must cover |
|---|---|---|---|
| `ZOOM_PRESETS`, `zoomChoices(zoom)` | `src/webview/zoomChoices.ts` (chrome-only; not `stageGeometry.ts`, which `handoffCanvasHtml.ts` embeds whole into the exported `canvas.html`; the presets move out of `Toolbar.svelte`) | `(zoom: number) => { options: readonly { value: string; label: string }[]; selected: string }`. Preset options are `{ value: String(preset), label: '75%' }`. If `Math.round(zoom * 100)` equals a preset's percentage, `selected` is that preset's value. Otherwise a leading option `{ value: String(zoom), label: '63%' }` is added and selected. Toolbar loses `zoomText`, gains `zoom: number`, and calls today's preset handler with `Number(event.currentTarget.value)`. The `selectedIndex = 0` reset is removed. | exact preset; non-preset; rounding onto a preset (0.996 → "1") |
| `commentNumbers(comments)` | `pins.ts` | `Map<id, number>`, 1-based in posted (comments.json) order, every status included, so a number survives a status change. App computes it once (`$derived`) and passes it to `layoutPins` (new `number` on `PlacedPin`), to `panelItems` (new `number` on each item), and to the thread's `CommentCard` (new `number` prop). `ponytail:` numbers are array positions, so a hand-reordered comments.json renumbers; a stored number would need a disk field. | empty list; a resolved comment keeps its number; order follows the array, not the status |
| `pinLabel({ comment, badge, number })` | `pins.ts` (existing) | Adds the number: "Open comment 3: …", "Open comment 3, stale: …". `STATUS_LABELS` / `BADGE_LABELS` stay its own short copy on purpose. | update the existing tests |
| `panelSummary(comments)` | `commentsPanel.ts` | `{ toSend, withAgent, resolved }` = the counts of `open`, `sent` and `resolved` | empty; one of each |
| `handoffCopy({ open, sent, copied })` | `commentsPanel.ts` | `copied?: number` (undefined = no feedback showing). Returns `{ label, hint, disabled }` per the copy table, with singular and plural. Precedence: `copied !== undefined` wins over everything (including `copied = 0`: "Copied 0 comments" never shows; it reads "Nothing new to send" with the sent hint). Otherwise `open > 0` gives the copy label; otherwise "Nothing new to send". `disabled` is true only at `open = 0`. A pending copy keeps today's `copyBlocked` `aria-disabled` on top. | `open 3`; `open 1` (singular); `open 0, sent 2`; `open 0, sent 0`; `copied 3`; `copied 0` |
| `statusBadge(status)`, `flagBadge(badge)` | `pins.ts`. They **replace** `THREAD_STATUS_COPY` and `THREAD_BADGE_COPY` (deleted). | `{ tone, icon, label, description? }`:<br>- open: accent / dot / "Open"<br>- sent: agent / send / "Sent to Agent"<br>- resolved: success / check / "Resolved"<br>- stale: warning / warning / "Target changed", description "The element changed since this comment."<br>- missing: warning / error / "Target missing", description "The element is gone or no longer unique."<br>- unchecked: neutral / question / "Not checked", description "This target can't be checked from disk (made by script, too complex, or the file can't be read)."<br>These sentences are chrome-only (no host or MCP text quotes them). | exhaustive by type; the step says so (no extra test) |
| `frameLabel(frames, frameId)` | `commentsPanel.ts` (extracted from `panelItems`' inline `labels.get(frameId) \|\| frameId`) | The one rule for a frame's display name. `panelItems`, the thread header and the popover header all use it; App passes the result down. | unknown id falls back to the id |

### Surfaces (match the mockups)

- **Toolbar** (`toolbar-stage.html`): title-bar layout.
  - **Left:** the artboard icon + id + "gen N" in `--cd-fg-2` (one group). The stale `Badge` sits in the next slot; it keeps `aria-live="polite"` and is `hidden` when not stale. Then a divider.
  - **Mode group:** `role="group" aria-label="Mode"` holding two toggle buttons:
    - "Interact": `aria-pressed={!commentMode}`, cursor icon;
    - "Comment": `aria-pressed={commentMode}`, comment icon, `aria-keyshortcuts="c"`, `title="Comment (C)"`;
    - then `<kbd>C</kbd>`.

    Comment keeps today's toggle-on-click. Interact leaves Comment mode, and does nothing in Interact mode. Both stay `disabled` with no frames, as Comment is today; App already ends Comment mode when the stage empties (picking.spec), so there is no trap. These are toggle buttons, not radios, on purpose: Comment keeps its `aria-pressed` and toggle contract.
  - **Right:**
    - the zoom `<select>` (the global `select` style, a chevron `Icon` overlay, `zoomChoices`);
    - Fit all `IconButton` (fit icon, `label` "Fit all", same `disabled` rule);
    - a divider;
    - the Comments `IconButton`.

    The toolbar's own pick live region stays.
- **Banners:** each banner is a `Message variant="banner"`:
  - MCP: warning + plug icon;
  - comments.json error: warning;
  - artboard error: error.

  Keep `role="alert"` where it is today, and `data-cd-comments-error`.
- **Stage:**
  - **Viewport:** background `--cd-bg-stage`.
  - **Frames:** they get `--cd-shadow-frame` (edge + soft shadow) and lose the always-on active outline. The active frame (today's `activeId` into Frame/Stage) shows through its label: weight 600, frame icon in `--cd-open`.
  - **Frame labels:** frame icon + name + `width × height` in `--cd-fg-2`. The height is the frame record's reported height; without it, the width only. Hover: `--cd-bg-hover`, `cursor: grab`.
  - **Group headings:** section-title style (11px, 600, uppercase via CSS, letter-spacing).
  - **Resize handle:** a 4×36px rounded `--cd-fg-3` bar on hover and focus; otherwise invisible, as today.
  - **Frame under a move gesture:** it gets a `lifted` class (raised `z-index` + larger shadow). The class is keyed off the gesture state Stage already holds for `frame-gesture-move`.
  - **Comment mode:** a hint pill centred at the top of the viewport (`aria-hidden="true"`; the toolbar live region already announces the mode).
  - **Empty canvas:** `EmptyState` (artboard icon) replaces `.empty`, with the same `hidden` rule.
- **Frame tiles:** error tiles (render error, `errorMessage`) get a solid error-tinted edge and an error icon. The empty-artboard tile gets a dashed neutral edge and a page icon. Same copy constants.
- **Overlay:**
  - hover: 1.5px solid `--cd-open` with a 10% fill;
  - pick: 2px solid with a 16% fill;
  - jump flash: 2px `--cd-focus`.

  Keep `.overlay`, `.outline`, `.hover`, `.pick` and `data-cd-flash`, which the specs read.
- **Comments panel** (`comments-panel.html`):
  - **Header:** sticky (`--cd-bg-chrome`, bottom divider), with the uppercase title "Comments", the summary line, and the handoff block (`handoffCopy`: one primary block `Button` + hint).
  - **List:** section titles, then cards.
  - **Keep:** `ol`/`li`, `data-cd-comment-item`, `data-cd-status`, `data-cd-focus`, `data-cd-copy-open`, `time[datetime]`, the `aside` landmark and `id="cd-comments-panel"`.
- **`CommentCard`** (shared by panel and thread), with `layout: 'card' | 'widget'` (default `'card'`). The card still owns the reply draft state, its errors and `aria-describedby`, the `data-cd-focus` targets and the attachments, as today.
  - **Parts** (internal snippets, written once):
    - **head:** `PinChip`, then `TargetRef` (jump button in the panel when `canJump`; otherwise static, with "Frame not shown." beside it), then the status `Badge`, plus a close `IconButton` in widget layout.
    - **thread:** one entry per comment and reply: `Avatar`, the author (600) and `time` (`--cd-fg-2`), then the body. Entries are joined by a 1px line through the avatars; each entry but the last draws its own segment. Agent entries tint the body with `--cd-agent-bg`. Flag `Badge`s go after the body. Errors are a `Message tone="error"`, linked by today's `aria-describedby`.
    - **footer:** the composer (textarea, kbd hint, Cancel, "Add reply" primary sm) above the action row: ghost sm Reply, Resolve/Reopen (check / reopen icons), and "Copy for Agent" pushed to the end.
  - **Card layout:** an `<article>` with `--cd-bg-card`, a 1px `--cd-edge` border and `--cd-radius-md`. Resolved cards have a transparent background and the body in `--cd-fg-2`.
  - **Widget layout:** the card renders `Widget` itself, passing those parts as `header` / `children` / `footer`. It accepts and forwards `left`, `top`, the bindable `width` / `height`, `onclose` and widget-root rest props.
  - **`CommentThread`:** keeps its placement, Escape and focus jobs, and renders `<CommentCard layout="widget" …>`. The Close button, with today's `focusOnOpen` attachment, moves into the card head.
- **Popover** (`popover-thread.html`): `Widget`, with its rest props on the root.
  - **Header:** `TargetRef` (`frame` = `frameLabel(frames, draft.frameId)`, `element` = `targetChipText(draft)`, icon `page` when `isPage`, else `element`) + parent/child `IconButton`s.
  - **Body:**
    - the textarea with its placeholder;
    - the blocked-target copy as `Message tone="info"`, not error;
    - host errors as `Message tone="error"`.
  - **Footer:** kbd hint + Cancel (secondary sm) + "Add comment" (primary sm, `pending` while waiting for the host).
  - **Placement:** `placePopover` is untouched; it keeps reading the measured size through `Widget`'s bindables.
- **Pins** (`pins.html`):
  - **Shape and position:** a numbered teardrop, 24px, `border-radius: 50% 50% 3px 50%`, with its tip (bottom-right corner) on the same point `pinPoint` computes today. The body grows up and to the left (`transform: translate(-100%, -100%)`), so the clicked spot stays visible. `pinPoint` / `layoutPins` math is unchanged; only the `PlacedPin` doc comment changes from "center" to "tip".
  - **Clipping:** the pins layer clips at the viewport edges as today. A tip within 24px of the viewport's top or left edge is partly clipped, the same class of clipping as today's half-clipped centred pin.
  - **States:**
    - open: `--cd-open` fill + `--cd-on-open` number;
    - sent: `--cd-agent` fill + `--cd-on-agent` number;
    - resolved: an 18px teardrop in `--cd-pin-resolved-*`, with a check `Icon` instead of the number (the aria-label keeps the number);
    - missing target: a ghost pin (ring-coloured fill, a dashed `--cd-open` outline);
    - stale / unchecked: a 14px flag at the top-left with a 12px warning / question icon.
  - **Rings:** all pins keep the 2px `--cd-pin-ring` halo. The pin whose thread is open adds an outer `--cd-focus` ring. Keyboard focus uses the global ring with a pin-specific `outline-offset`.
  - **Hooks:** keep `data-cd-pin`, the status classes (`open`, `sent`, `resolved`) and the flag classes (`badge`, `stale`, `missing`, `unchecked`) the specs read.

### Must not break

- **Every behavior the browser suite asserts:**
  - messages posted;
  - focus moves and restores (`data-cd-focus`, Escape chains, focus never stolen from outside the panel);
  - `aria-pressed`, `aria-expanded`, `aria-controls`, `aria-keyshortcuts`, `aria-disabled` (copy blocking stays `aria-disabled`, not `disabled`);
  - live regions (App's stays a direct child of `#svelte-root`);
  - the dialogs' names;
  - the stage pan / zoom / drag / resize gestures and their `frame-gesture-*` classes;
  - popover placement inside the stage;
  - the thread clear of the open panel.
- **Structural hooks:** keep the `.viewport` and `.layer` class names.
- **CSP:** no inline styles; `frameCsp.spec.ts` and the shell CSP test stay green.
- **Test edits are locators and copy only.** A changed assertion is noted in the step's review with the reason.

### Host emulation for tests and evidence

- **`tests/browser/vscodeHost.ts`** (test-only) exports the Default Dark Modern and Default Light Modern `--vscode-*` values (PART B of `prototypes/theme.css`, sourced from Cursor's bundled theme files plus registry defaults), plus the text of Cursor's `_defaultStyles` (copied from `Cursor.app/.../webview/browser/pre/index.html`).
- **`openHarness`** gains an option `vscodeHost?: 'dark' | 'light'`. When set, the page:
  - prepends the default styles to `<head>`;
  - sets the variables on `<html>`;
  - adds `vscode-dark` / `vscode-light` to `<body>`.

  This is the same order Cursor uses. Without the option nothing changes, so existing specs keep running as they do.
- **`tests/browser/theme.spec.ts`** (behavior through computed styles, rule 09) runs with `vscodeHost: 'light'` and asserts:
  - `body` padding is 0 and its background is not transparent;
  - a primary `Button`'s `:focus-visible` outline is 2px with a 2px offset;
  - the textarea's focus ring is the inset 1px ring;
  - a `kbd` uses the token background.
- **The gallery** is `tests/browser/gallery.spec.ts`. It is skipped unless `CD_GALLERY=1`, and run by a new `package.json` script `gallery` (`CD_GALLERY=1 pnpm test:browser gallery`). It writes to the gitignored `test-results/gallery/` and is not a Verify gate. It reproduces the 90 states of the before-gallery in both themes through `vscodeHost`.

## Build steps

**How every step runs:**
- A subagent implements it. Svelte files go through the `svelte-file-editor` agent: Svelte MCP docs before writing, and `svelte-autofixer` after every edit until clean (rule 08).
- Each step updates the browser tests it breaks in the same step, locators and copy only.
- Each step ends with `pnpm verify` and `pnpm test:browser` green, and adds its new rules and primitives to the 05 owner catalog.

- [x] **1. Foundations.**
  - **Rules and docs first,** in the same commit as the code that follows them:
    - rule 08 "Styling and a11y" and "Folders": the `--cd-*` tokens in `ui/theme.css` are the only place that reads `--vscode-*`; the global sections and why there are no layers; `src/webview/ui/` is the one shared kit of domain-free primitives used by 2+ surfaces, and one-use chrome stays flat; reuse a primitive with a prop before writing control CSS; no `style=` attributes; the guard test;
    - rule 05 catalog: `theme.css` owns the tokens, globals and `.visually-hidden` (no longer App), plus the step-1 primitives;
    - `coding-standards.md` (Chrome vs artboard) and `project-overview.md` (the `var(--vscode-*)` line).
  - **Commit `prototypes/` as-is** (verify already passes with it, formatted).
  - **Then build:**
    - `ui/theme.css` per decision 3, imported first in `main.ts`; App's `:global` block and `.visually-hidden` deleted from App;
    - `icons.ts` with only the step-1 icons;
    - `Icon`, `Button`, `IconButton`;
    - the guard test with its fixtures;
    - `tests/browser/vscodeHost.ts` + the `vscodeHost` harness option + `theme.spec.ts`.
  - **Adopt the primitives for exactly these buttons:**
    - Toolbar: Comment toggle (`Button`, stays a single toggle until step 2), Fit all (`Button`), Comments (`IconButton`);
    - CommentsPanel: Copy all open (`Button`);
    - CommentCard: Reply, Resolve/Reopen, Copy prompt, composer Cancel / Add reply (`Button`; attachments ride on rest);
    - CommentPopover: Parent, Child (`IconButton` arrow-up / arrow-down), Cancel, Add comment (`Button`, `pending`);
    - CommentThread: Close (`IconButton`).

    Delete the copied `.action` / `.primary` / button-reset rules and the button / textarea `:focus-visible` and disabled rules. Pins, frame labels and the resize handle keep their own controls.
  - **Done when:**
    - the guard test passes and each fixture fails its matcher;
    - `grep -rn -- '--vscode-' src/webview --include=*.svelte` is empty;
    - `grep -rnE '\.(action|primary)\b' src/webview --include=*.svelte` is empty;
    - `theme.spec.ts` passes;
    - the Escape and focus-restore specs (commentPopover, commentsPanel, pins thread) pass;
    - `pnpm verify` and `pnpm test:browser` are green.
  - **Then stop for the foundations review** (Review plan) before step 2.
- [x] **2. Toolbar, banners, stage.**
  - **Rules:** `ZOOM_PRESETS` / `zoomChoices` with their test.
  - **Primitives:** `Badge`, `Message`, `EmptyState`, with their icons.
  - **Surfaces:** Toolbar (mode group, zoom select, stale `Badge`), Banners, Stage, Frame tiles, Overlay, the empty stage and the hint pill, per Surfaces.
  - **Also:** a focused artboard iframe gets a visible focus ring that `.frame { overflow: hidden }` cannot clip (inset ring). This existed before the fix; the foundations review found it.
  - **Done when:**
    - the `zoomChoices` tests cover their edge cases;
    - a browser test shows the zoom value in the select at a non-preset zoom (after ctrl+wheel);
    - a browser test shows Interact / Comment `aria-pressed` following the mode, Interact being a no-op in Interact mode, and both disabled with no frames;
    - `pnpm verify` and `pnpm test:browser` are green.
- [x] **3. Comments panel and cards.**
  - **Rules:** `commentNumbers`, `panelSummary`, `handoffCopy`, `statusBadge` / `flagBadge`, `frameLabel`, with tests. App's copy feedback keeps the `ui:copied` count.
  - **Primitives:** `Avatar`, `PinChip`, `TargetRef`.
  - **Surfaces:** CommentsPanel and CommentCard (`layout="card"`) per Surfaces and the copy table.
  - **Done when:**
    - the rule tests cover their edge cases;
    - browser tests show the summary, "Copy 3 open comments for Agent", "Copied 3 comments" after a copy-open, and "Nothing new to send" with `aria-disabled` at zero;
    - a card's flag sentence is the accessible description of its badge (browser test on the hidden text);
    - `pnpm verify` and `pnpm test:browser` are green.
- [x] **4. Popover, thread, pins.**
  - **Primitives:** `Widget`.
  - **Popover:** on `Widget`.
  - **Thread:** `CommentCard layout="widget"`.
  - **Pins:** numbered teardrops; `pinLabel` with numbers.
  - **Artboard canvas:** an artboard that sets no background renders like a browser page, not on the dark editor colour: the frame slot uses `color-scheme: light; background: Canvas` (a system colour, so the guard allows it). Found while reviewing step 3: in dark themes an unstyled artboard showed black text on near-black. The artboard's own styles still win.
  - **Done when:**
    - pin specs locate a pin by its tip (bottom-right of its box) instead of its centre;
    - a new browser case shows a target at a frame's top-left: its pin's tip at the target point, and the pin box inside the viewport;
    - the pin and its panel card show the same number (browser test);
    - the popover placement and thread-clear-of-panel tests pass with unchanged intent;
    - the guard gains a rule: `color: var(--cd-(warning|error|info|agent|resolved|open))` fails outside `ui/` (meaning colours never colour text; steps 2–4 route those texts to `Message` / `Badge`), with a failing fixture;
    - `pnpm verify` and `pnpm test:browser` are green.
- [x] **5. Evidence and cleanup.**
  - **Gallery:** run `pnpm gallery` for the after-shots.
  - **Contrast:** the gallery measures it in both themes, with semi-transparent tokens composited on their actual background:
    - body text and `--cd-fg-2` text, ≥ 4.5:1;
    - badge, message and button text, ≥ 4.5:1;
    - the focus ring against its neighbour, ≥ 3:1;
    - pin fill against the pin ring, ≥ 3:1.

    Exempt: disabled text (WCAG 1.4.3 exemption) and `--cd-fg-3`, which is **non-text only** (icons, dividers, the resize bar; no text uses it).
  - **Publish:** a before/after page (before = the earlier gallery artifact).
  - **Cleanup:**
    - delete dead CSS, and any `ICONS` entry without a caller;
    - `pnpm knip` clean;
    - `blueprint/context/system-map.md` label prose updated (Copy prompt → Copy for Agent, Copy all open (N) → Copy N open comments for Agent, Parent / Child → parent / child icon buttons).
  - **Result (2026-11-17):** 62 named pairs per theme plus a sweep of every visible text. Token fixes after the first run: `--cd-fg-2` 75% → 78% (frame-label size on hover was 4.45), `--cd-fg-3` 55% → 58% (non-text on the light stage was 2.94), resolved pin fill = 70% foreground into the editor background (was `badge.background`, 1.61:1 on white). One accepted exception: the inset focus ring on the zoom select and the textareas in Dark Modern is 2.87:1 (`focusBorder` #0078D4 on `input.background` #313131). That is VS Code's own input focus colour on its own input background; changing it would make these fields differ from every other input in the editor. Disabled text is exempt (WCAG 1.4.3).
  - **Done when:**
    - every measured pair meets its threshold in both themes (any exception listed with its number and reason);
    - no unused file, export or icon;
    - `pnpm verify` and `pnpm test:browser` are green.

- [x] **6. Critical-review fixes** (findings F-94 to F-114 in `blueprint/context/findings.md`; two batches in order, so no two agents edit the same file).
  - **Batch A: tokens, globals, guard, docs, stage, pins.**
    - F-102: value-named spacing scale (`--cd-space-2/4/6/8/10/12/16/24`) replacing every spacing literal in `src/webview/`, plus size tokens (badge / chip height, small control height, widget max height 440px).
    - F-105: named tint tokens with high-contrast overrides, and `--cd-accent` with `--cd-open` derived from it.
    - F-114 globals: one `[hidden]` rule, one button reset, `--cd-stage-zoom`, merged line heights, lifted-shadow and kbd tokens, `segment` with `size?: never`, and the IconButton label contract documented.
    - F-114 guard: exemptions name their allowed properties, and meaning colours are caught through local variables.
    - F-106: rules and docs (rule 07 line, rule 09 gallery exception).
    - F-108: element pins anchor their tip at the target box's top-left corner (page comments keep the stored fraction; `pinPoint` + tests).
    - F-99: pin focus ring touches the halo; a distinct open-thread ring.
    - F-98: frame-to-frame focus tracking, with a two-frame test.
    - F-110: lift during resize.
    - F-111: tile titles.
    - F-112 zoom: insert the current zoom in sorted order.
    - F-113 stage / toolbar polish: the "No artboard" label, the muted kbd when disabled, the empty-stage example prompt, the hover outline offset, the gripper on label hover, no mid-path error wrapping.
    - F-114: `frameSizeText` only for iframes, and shared spec locators in `harness.ts`.
  - **Batch B: comments.**
    - F-94: the panel list is the scroller and the header sits outside it, with an upward-tab browser case.
    - F-96: panel `EmptyState`s.
    - F-101 + F-95: one `Composer.svelte` with Cancel then primary everywhere, and the error between the textarea and the actions (the F-77 focus-order assertion is updated on purpose).
    - F-100: CommentCard `shell` snippet; CommentThread renders `Widget`.
    - F-97 + F-107: short "Sent" label, no icon in card / thread target references, and a frame-absent layout that keeps the element text.
    - F-103: `ui/badge.ts` types.
    - F-104: status-keyed counts, a `summaryParts` rule, and the toolbar count derived from the summary.
    - F-109: widget max height.
    - F-112: Badge description exposed once; "Copied" not disabled-looking (a click guard instead); `aria-hidden` kbd hints; PinChip context; the flag icon asserted by name; tests for reply pending, hint pill `aria-hidden` and the spinner stop.
    - F-113 panel polish: the hint for open > 0, the summary icons, the Copied button padding, the popover hint switching to "⏎ add" once there is text.
    - F-114: numbers derived where the full list is in hand (no `?? 0`); pin label words from `statusBadge`.
  - **Rejected, with reasons:**
    - Banner copy pattern (the host authors those messages; out of the chrome restyle).
    - The default-view stage gutter (stage geometry, out of scope).
    - A segmented-group primitive (one use).
    - A section-title primitive (two small rules).
  - **Done when:**
    - each finding is marked `fixed` in the ledger with a one-line resolution;
    - `pnpm verify`, `pnpm test:browser` and `pnpm gallery` (contrast: only the documented exception fails) are green;
    - `pnpm knip` is clean;
    - Bombic chose the trimmed finish (2026-11-17, option 2): Batch B fixes the P1s, the P2s and only the cheap P3s; instead of a separate re-review agent, the orchestrator checks each fixed P1 / P2 against the code, the tests and the new gallery. The P3 bullets not done stay `open` in F-112 / F-113 / F-114 for a later pass.

- [x] **7. Refactor pass** (requested by Bombic, 2026-11-18).
  - **Lenses:** duplicated logic and DRY, comments, file structure, naming, JS practices and performance, strong typing, Zod.
  - **Reviews:** three reviewers (structure, types / runtime, comments / docs / skills) logged 50 findings. Two validators (Opus, Sonnet) checked each one: 41 verdicts agreed, and the orchestrator decided the 9 splits. Reports live in the session scratchpad `refactor-review/`.
  - **Zod:** not added. The chrome stays dependency-free (zod/mini would add about 13% to `chrome.js`), and `frameMessages.ts` ships inside every frame and the exported `canvas.html`.
  - **Copy:** no wording changes, except that pin labels use the badge words for flags (R1-05).
  - **Deferred:** `noUncheckedIndexedAccess` (repo-wide policy, its own `/fix`), the `gallery.spec.ts` split, an Icon tone prop, new tokens, and R2-01 steps 2–3.
  - **Batches,** run in parallel on disjoint files:
    1. rule modules: `canvasFrames`, `pins`, `commentsPanel` + Frame / Pins / Stage;
    2. App and the comment views;
    3. browser tests, the guard, rules 08 / 09, `system-map.md`, the `cursor-design-build` skill bullet.
  - **Done when:**
    - `pnpm verify`, `pnpm test:browser` and `pnpm knip` are green, and `pnpm gallery` passes if gallery logic changed;
    - no comment points into `prototypes/`.

## Review plan

- **After step 1: foundations review.** One fresh reviewer (Opus 5.5, high) gets the step-1 diff, this spec's decisions 2–6, and `prototypes/theme.css` / `components.css`, and judges the architecture:
  - token naming and completeness;
  - the no-layers global design against the host stylesheet;
  - the primitive APIs (too wide, leaky, or missing a prop the planned steps need);
  - CSP safety;
  - the guard's real failure modes;
  - Svelte 5 idioms.

  Findings are fixed before step 2.
- **After step 5: critical review.** Independent reviewers, each fresh, get the full diff, `prototypes/`, and the after-gallery under `test-results/gallery/`, but not this spec's conclusions:
  1. **Architecture and CSS patterns:** duplication left, specificity, token use, primitive reuse, dead code.
  2. **Accessibility and behavior:** keyboard, focus, ARIA, live regions, the contrast numbers, every browser-test change justified (no weakened assertion).
  3. **Design fidelity:** the after-shots against the mockups in both themes.

  Findings go to `blueprint/context/findings.md`; P0/P1 block `/complete`.

## Verify

- `pnpm verify`: the unit tests, including the guard and rule tests, and svelte-check with no warnings.
- `pnpm test:browser`: all behavior specs plus `theme.spec.ts`.
- `pnpm gallery` and the before/after page: every state looks like the mockups in both themes, and the contrast numbers are listed.
- Bombic looks at the before/after page. No manual F5 testing is asked of him:
  - the earlier per-feature F5 passes cover Cursor-only behavior;
  - `theme.spec.ts` with the real `_defaultStyles` covers the host-stylesheet interaction;
  - the shell CSP test and `frameCsp.spec.ts` cover the stylesheet path.


<!-- blueprint:completion {"schemaVersion":2,"specBytes":45893,"specSha256":"d8c8ee771f6f74a4dd45d199d507823e93a6f7b9fdbd0901bd2dffdc0f6edaa5","branch":"refs/heads/fix/chrome-design-system","head":"f720c27eaa467d81300cabbb5477457bc6c22a43","baseRef":"refs/heads/main","baseCommit":"f720c27eaa467d81300cabbb5477457bc6c22a43","sourceTree":"ea76ccd727781e8bf74b07960b28a9403b9a3a98","landing":"local-merge","absentOptional":[]} -->

## Findings

### chrome-design-system/F-94 [P1] closed - The sticky panel header hides focused controls

**File:** src/webview/CommentsPanel.svelte:260
**Found:** 2026-11-17 by critical review (fresh subagent, claude-opus-5-5; scope: fix/chrome-design-system; lens: accessibility and behavior)
**Why it matters:** `aside` is the scroller and `.head` is `position: sticky`, so the browser scrolls a focused control to the scrollport top, under the header. A probe (500px viewport, 8 comments, Shift+Tab upward) left 8 of 30 focus stops fully covered. WCAG 2.4.11 (focus not obscured). New in this change: the old header was not sticky.
**Suggested fix:** Make `.list` the scroller and keep `.head` outside it (`aside` a flex column with `overflow: hidden`; `.list` `overflow: auto; overscroll-behavior: contain; min-height: 0`), with `aside[hidden] { display: none }`. Add a browser case that tabs upward through a long list and asserts every focused control is below the header.
**Resolution:**
2026-11-17 Batch B: the panel `aside` is a flex column (`overflow: hidden`) with the header outside the scrolling `.list` (`overflow: auto; overscroll-behavior: contain; min-height: 0`); `[hidden]` still hides through the global rule; `commentsPanel.spec.ts` tabs up 8 cards (32 stops) in a 500px viewport and asserts every focused control is below the header.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `CommentsPanel.svelte` aside is a flex column with `overflow: hidden`; `.head` sits outside `.list`, which is the only scroller (`overflow: auto; min-height: 0`); the upward-tab case is in `commentsPanel.spec.ts`. No new defect.

### chrome-design-system/F-95 [P1] closed - The popover footer orders Add before Cancel, the reply composer Cancel before Add

**File:** src/webview/CommentPopover.svelte:173
**Found:** 2026-11-17 by critical review (design fidelity and accessibility lenses)
**Why it matters:** The two composers disagree, and the popover breaks the VS Code and mockup convention (Cancel, then the primary action last). It was kept only because the F-77 spec asserts Tab from the textbox lands on Add.
**Suggested fix:** One composer order everywhere: Cancel, then the primary. Update the F-77 assertion to the new focus order (Tab, Tab) on purpose and note it.
**Resolution:**
2026-11-17 Batch B: every composer is Cancel, then the primary (the shared `Composer.svelte`); the F-77 popover spec now tabs Cancel, then Add, on purpose.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `Composer.svelte` renders the hint, Cancel, then the primary for both callers; the popover spec tabs Cancel then Add on purpose.

### chrome-design-system/F-96 [P1] closed - The Comments panel empty and unavailable states were never restyled

**File:** src/webview/CommentsPanel.svelte:199
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** Both are a plain sentence in the top-left corner with no header, unlike the mockup and the stage, which uses `EmptyState`. Critique item 28 is not fixed.
**Suggested fix:** Keep the panel header and render `EmptyState` (comment icon, "No comments yet", body with `<kbd>C</kbd>`; warning icon, "Comments are unavailable"). Keep today's exact sentences as the bodies so the specs' copy still holds.
**Resolution:**
2026-11-17 Batch B: the empty and unavailable panel keep the "Comments" header and render `EmptyState` (comment icon, "No comments yet", "Press <kbd>C</kbd>, then click an element to add one."; warning icon, "Comments are unavailable", "The notice above the canvas says why.").
2026-11-18 /audit current (fresh reviewer, all lenses): closed. Empty and unavailable panels keep the "Comments" header and render `EmptyState` with the spec copy.

### chrome-design-system/F-97 [P1] closed - The card header truncates the target to a few letters

**File:** src/webview/CommentCard.svelte (head snippet), src/webview/pins.ts (`statusBadge`)
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** At panel width the full "Sent to Agent" badge, the `<>` icon and the frame name leave 4–5 characters for the element ("Lume…", "Creat…"); the old chrome showed about 25. Owner note 3 comes back.
**Suggested fix:** Short badge label "Sent" in card and thread heads (the description keeps the long form); no element icon in card and thread target references (the pin number identifies the target); the popover keeps its icon.
**Resolution:**
2026-11-17 Batch B: the sent badge reads "Sent" (description "Sent to Agent"); card and thread target references drop the element icon (the popover keeps it); the element text keeps `min-width: 4em` and the frame name caps at half the row.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `STATUS_BADGES.sent` is "Sent" with the long form as `description`; card / thread `TargetRef` has no icon; `.frame` caps at 50% and `.element` keeps `min-width: 4em`.

### chrome-design-system/F-98 [P2] closed - The artboard focus ring stays on the wrong frame when focus moves frame to frame

**File:** src/webview/Stage.svelte:94
**Found:** 2026-11-17 by critical review (accessibility and behavior)
**Why it matters:** `trackFrameFocus` runs only on window blur and focus; moving from one iframe straight into another fires neither, so frame A keeps the ring while B has focus (click and Tab paths both reproduced).
**Suggested fix:** While a frame holds focus (the chrome window is blurred), re-check `document.activeElement` on a short interval and stop when the window regains focus; a two-frame browser case for the click and Tab paths.
**Resolution:**
2026-11-17 Batch A (fix/chrome-design-system): while a frame holds focus, Stage re-reads `document.activeElement` every 200ms (stops when focus returns to the chrome or on unmount; `ponytail:` note); `stage.spec.ts` covers the click and Tab paths between two frames.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `Stage.svelte` polls `document.activeElement` every 200ms only while `focusedFrameId` is set (effect cleanup clears the interval; `ponytail:` names the ceiling); the two-frame case is in `stage.spec.ts`.

### chrome-design-system/F-99 [P2] closed - The pin focus ring floats off its halo, and the open-thread ring looks like focus

**File:** src/webview/Pins.svelte:140
**Found:** 2026-11-17 by critical review (accessibility and behavior)
**Why it matters:** `outline-offset: 3px` leaves a 1px strip of artboard content between the 2px halo and the ring, so contrast on either side is not guaranteed. The open-thread state is a 2–4px `--cd-focus` ring nearly identical to keyboard focus.
**Suggested fix:** `outline-offset: 2px` so the ring touches the halo; give the open state a visibly different treatment (a `--cd-fg` ring). Measure the pin focus ring in the gallery contrast set.
**Resolution:**
2026-11-17 Batch A: the `.pin:focus-visible` override is gone, so the pin takes the global 2px offset that touches its halo; the open-thread state is a `--cd-fg` ring; the gallery measures the pin ring on the stage and against its halo.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. No pin focus override, so the global 2px offset meets the 2px halo; the open state is a `--cd-fg` ring in `Pins.svelte`.

### chrome-design-system/F-100 [P2] closed - CommentCard's layout prop carries the Widget's props

**File:** src/webview/CommentCard.svelte:26
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:** `left`, `top`, `width`, `height`, `onclose`, `closeAttachment` and rest only mean something in widget layout and are silently dropped in card layout; `canJump` is three-state; CommentThread mostly forwards 13 props.
**Suggested fix:** CommentCard exposes its parts through a `shell` snippet prop; CommentThread renders `Widget` itself and places the parts and the Close button. The card loses the widget props, the rest spread and the Widget import.
**Resolution:**
2026-11-17 Batch B: CommentCard exposes head / thread / footer through a `shell` snippet prop (its own `<article>` without one); CommentThread renders the `Widget` (placement, bindable size, role / aria / keys, Close with its focus-on-open after the head); the widget props, rest spread and Widget import left the card; `canJump` is a plain boolean.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. CommentCard takes an optional `shell` snippet and has no widget props or rest; `CommentThread.svelte` renders `Widget` and places Close after the head; `canJump` is a boolean (`frameShown`).

### chrome-design-system/F-101 [P2] closed - The comment composer exists twice and has already drifted

**File:** src/webview/CommentCard.svelte:252, src/webview/CommentPopover.svelte:151
**Found:** 2026-11-17 by critical review (architecture and CSS, design fidelity)
**Why it matters:** Same textarea, hint, Cancel / primary row and keydown in two places with duplicated CSS. They drifted: button order, `disabled` vs `aria-disabled` Cancel, and the error placed above the textarea in one and below in the other. Both also repeat textarea rules `theme.css` already sets.
**Suggested fix:** One flat `Composer.svelte` (textarea, hint, error slot between textarea and actions, Cancel then primary with `pending`), used by the popover and the card; keep only `min-height` locally.
**Resolution:**
2026-11-17 Batch B: one flat `Composer.svelte` (text box, message slot between it and the actions, `aria-hidden` key hint, Cancel then the primary with `pending`, both `aria-disabled`) used by CommentPopover and CommentCard; the duplicated textarea / row / hint CSS is gone from both.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. One `Composer.svelte` (textarea, message slot, `aria-hidden` hint, Cancel, primary with `pending`) used by CommentPopover and CommentCard; their textarea / row CSS is gone. Focus keys (`reply-text` / `-cancel` / `-send`) match the pre-change ones.

### chrome-design-system/F-102 [P2] closed - The spacing and size scale is only half used

**File:** src/webview/ui/theme.css:120, many components
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:** 6px and 10px are the working units with no token, 16px was dropped from the scale yet written by hand, and values that have tokens are hand-written next to token uses; control and badge heights are literals.
**Suggested fix:** A value-named spacing scale (`--cd-space-2/4/6/8/10/12/16/24`) replacing every spacing literal, plus size tokens for the badge / chip height, the small control height and the widget max height.
**Resolution:**
2026-11-17 Batch A: value-named `--cd-space-2/4/6/8/10/12/16/24` replaces every padding / margin / gap literal in `src/webview/` (old `-1/2/3/6` renamed), plus `--cd-chip-h`, `--cd-pin-sm`, `--cd-kbd-lh`, `--cd-widget-max-h` (used by Batch B for F-109); badge padding moved 7/5px to 6/4px.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. No padding / margin / gap literal left in the surfaces (grep); remaining px are borders, outlines, shadows and the pin / flag geometry.

### chrome-design-system/F-103 [P2] closed - The Badge props are typed twice

**File:** src/webview/pins.ts (`BadgeCopy`), src/webview/ui/Badge.svelte:10
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:** The tone union is copied by hand between the rule module and the primitive.
**Suggested fix:** One `ui/badge.ts` exporting the tone and prop types, imported by `Badge.svelte` and `pins.ts` (`satisfies`).
**Resolution:**
2026-11-17 Batch B: `ui/badge.ts` exports `BadgeTone` and `BadgeProps`; `Badge.svelte` and `pins.ts` (`STATUS_BADGES` / `FLAG_BADGES` with `satisfies`) import them.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `ui/badge.ts` owns `BadgeTone` / `BadgeProps`; `Badge.svelte` and `pins.ts` (`satisfies`) import them.

### chrome-design-system/F-104 [P2] closed - The panel summary text is built in a view, with two vocabularies and a duplicate count

**File:** src/webview/CommentsPanel.svelte:72, src/webview/commentsPanel.ts:124
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:** Display wording lives in a component (rule 08), `PanelSummary` says `toSend/withAgent` while `handoffCopy` says `open/sent`, and `unresolvedCount` re-derives `toSend + withAgent`.
**Suggested fix:** Counts keyed by status; a tested `summaryParts` rule; the toolbar count derived from the summary; `unresolvedCount` removed.
**Resolution:**
2026-11-17 Batch B: `PanelSummary` is keyed by status; `summaryParts` (tested) returns text, status icon and tone with zero parts left out, drawn with meaning-coloured icon wrappers; the toolbar count is `summary.open + summary.sent`; `unresolvedCount` is removed.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `panelSummary` is keyed by status, `summaryParts` is tested and builds the wording; App passes `summary.open + summary.sent` to the toolbar; `unresolvedCount` is gone.

### chrome-design-system/F-105 [P2] closed - Component tints skip the high-contrast override, and --cd-open doubles as the accent

**File:** src/webview/ui/Badge.svelte:43, Overlay.svelte:52, ui/Avatar.svelte:28, Frame.svelte:158, ui/theme.css:161
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:** `theme.css` says tints drop out in high contrast, but components mix their own `color-mix` tints that the override never reaches; `--cd-open` is also used as the general accent.
**Suggested fix:** Named tint tokens in `theme.css` with high-contrast overrides; `--cd-accent` with `--cd-open` derived from it.
**Resolution:**
2026-11-17 Batch A: `--cd-accent` (button blue) with `--cd-open: var(--cd-accent)`; badge tone fills, overlay hover / pick fills, avatar fill and tile error edge are theme tokens, each dropped (or set to contrastBorder) in the high-contrast block; generic accents read `--cd-accent`.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. Badge, overlay, avatar, tile-edge and agent tints are tokens in `theme.css`, each overridden in the high-contrast block; `--cd-open: var(--cd-accent)`.

### chrome-design-system/F-106 [P2] closed - Rules and docs drift from the build

**File:** .claude/rules/07-vscode-extension.md:47, 05-single-job.md, 09-tests.md
**Found:** 2026-11-17 by critical review (architecture and CSS)
**Why it matters:** Rule 07 still says chrome uses `var(--vscode-*)`; rule 05 says `EmptyState` covers every empty view (the panel did not); rule 09 says never pixels or sleeps while `gallery.spec.ts` takes screenshots with waits.
**Suggested fix:** Update rule 07; record the gallery as rule 09's exception; keep rule 05 true after F-96.
**Resolution:**
2026-11-17 Batch A: rule 07 points chrome to the `--cd-*` tokens; rule 09 records `gallery.spec.ts` as the one screenshot / wait exception (local only) and the shared harness locators; rule 05 left for Batch B to keep true after F-96.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. Rule 07 points chrome at the `--cd-*` tokens; rule 09 records the gallery exception and shared locators; rule 05 says `EmptyState` covers every empty view, now true (App stage, panel).

### chrome-design-system/F-107 [P2] closed - The frame-absent card collapses the element text into the note

**File:** src/webview/CommentCard.svelte:196
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** "archive-2 ›Frame not shown.": `.note` competes with `.element` for flex space, the element shrinks to zero and the chevron touches the note. Worse than before.
**Suggested fix:** `.note` does not shrink and sits where the status badge sits; `.element` keeps a minimum width.
**Resolution:**
2026-11-17 Batch B: "Frame not shown." does not shrink and takes the status badge's place (as in the mockup); the element text keeps a minimum width.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `.note` is `flex: none` in the badge slot; `.element` keeps `min-width: 4em`.

### chrome-design-system/F-109 [P2] closed - A long thread grows to the full stage height

**File:** src/webview/ui/Widget.svelte
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** The widget ran from y=44 to y=793; the mockup caps it and scrolls the body.
**Suggested fix:** A widget max-height token (440px, still capped by the stage) so the body scrolls.
**Resolution:**
2026-11-17 Batch B: `Widget` caps at `min(var(--cd-widget-max-h), calc(100% - var(--cd-space-16)))` and its body scrolls; placement and thread-clear-of-panel specs still pass.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `Widget.svelte` caps at `min(var(--cd-widget-max-h), calc(100% - var(--cd-space-16)))` with a scrolling body.

### chrome-design-system/F-110 [P2] closed - A frame being resized still slides under its neighbour

**File:** src/webview/Stage.svelte / Frame.svelte (`lifted`)
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** The lift applies to move gestures only.
**Suggested fix:** Apply the same lift during a resize gesture.
**Resolution:**
2026-11-17 Batch A: Stage lifts the frame under any captured gesture (move or resize).
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `lifted={captured?.id === frame.id}` covers move and resize gestures.

### chrome-design-system/F-111 [P2] closed - Frame tiles show one raw line with no title

**File:** src/webview/Frame.svelte
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:** The mockup tile has a bold title above the message; the build shows only the message.
**Suggested fix:** A title ("Couldn't render this frame" / "Empty artboard") above today's copy constant, unchanged.
**Resolution:**
2026-11-17 Batch A: the tile shows a bold title ("Couldn't render this frame" / "Empty artboard") above the unchanged copy constant.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. `Frame.svelte` tiles show a bold title above the unchanged copy constant, keyed off `tileKind`.

### chrome-design-system/F-113 [P3] closed - Design polish from the critical review

**File:** several (CommentsPanel, Toolbar, App empty stage, Overlay, CommentPopover, Stage label, ui/Message)
**Found:** 2026-11-17 by critical review (design fidelity)
**Why it matters:**
- The panel header lacks the "Then paste into Cursor Agent chat." hint and the summary icons.
- The no-artboard toolbar has no "No artboard" label, and its C kbd stays at full strength.
- The empty stage lacks the example prompt.
- The "Copied" ghost button's padding is uneven.
- The popover hint doesn't switch to "⏎ add" once there is text.
- The hover outline is square on rounded elements.
- Errors wrap inside paths.
- The frame label has no gripper on hover.

**Suggested fix:** As listed, matching the mockups.
**Resolution:**
2026-11-17 Batch A part: "No artboard" toolbar label, the C kbd muted while the mode buttons are disabled, the empty stage's example prompt (`EmptyState` `example`), the hover / pick outline 2px outside the element, the gripper on label hover, `overflow-wrap: break-word` on messages and tiles. The panel and popover polish is Batch B.
2026-11-17 Batch B part: the handoff hint "Then paste into Cursor Agent chat." while open > 0, the summary icons, even padding on icon buttons (Copied included), the popover hint switching to "⏎ add · ⇧⏎ new line" once there is text.
2026-11-18 /audit current (fresh reviewer, all lenses): closed. Every bullet is in the code: handoff hint while open > 0 and summary icons (`handoffCopy`, `summaryParts`), "No artboard" and the muted C kbd (`Toolbar.svelte`), the empty-stage `example`, even icon-button padding (`Button.svelte` `.has-icon`), the popover hint switching on text (`Composer.svelte`), the outline 2px outside the element (`Overlay.svelte`), `overflow-wrap: break-word` on messages and tiles, the gripper on label hover (`Stage.svelte`).
