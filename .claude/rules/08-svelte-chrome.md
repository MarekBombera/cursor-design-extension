---
description: Svelte 5 webview chrome - container vs view, runes with one job each, --cd-* design tokens and shared ui/ primitives, a11y
globs: **/*.svelte,**/*.svelte.ts,src/webview/**
paths:
  - "**/*.svelte"
  - "**/*.svelte.ts"
  - src/webview/**
alwaysApply: false
---

# Svelte chrome

Chrome is Svelte 5 + Vite (no Kit), running inside the webview. It renders what the host posts. It never talks to MCP or the workspace fs, and never imports `vscode` (02, 05, 07). Artboard HTML stays in the sandboxed iframe; chrome never renders it with `{@html}`.

## Svelte MCP: required for every Svelte change

The official Svelte tooling is installed per tool: the Cursor `svelte` plugin, and the Claude Code `svelte@svelte` plugin (enabled in `.claude/settings.json`; accept the install prompt). Both provide the `svelte` MCP server, the `svelte-core-bestpractices` skill, and the `svelte-file-editor` agent.

1. **Before writing:** call `list-sections`, then `get-documentation` for every section whose use case matches the task (runes, `$props`, snippets, events, `{#each}` keys). Write from those docs, not from Svelte 4 memory.
2. **After every edit** to a `.svelte` / `.svelte.ts` file: run `svelte-autofixer` on the full file and repeat until it returns no issues or suggestions.
3. In Claude Code, prefer delegating Svelte file edits to the `svelte-file-editor` agent (it saves main-context tokens).
4. Never call `playground-link` for files in this repo.
5. MCP unavailable (Codex, CI, plugin not installed): use the CLI, `npx -y @sveltejs/mcp --help`, for the same docs and autofixer. Do not skip the autofixer.

The feature that adds Svelte also adds `svelte-check` to `pnpm verify` (tsc does not type-check `.svelte` files). Oxlint already lints `<script>` blocks.

## Toolchain

- `typescript` package is `~6.0.3` (`ponytail:` TS 6 only until `svelte-check` supports TS 7, then `^7`). Lint and type-aware check still run on TS 7 via tsrs (bundled with vite-plus); do not remove `typeAware` / `typeCheck`.
- Webview build: `vp build -c vite.webview.config.ts` (`-c` is honored). Outputs `dist/webview/chrome.js` and `dist/webview/chrome.css`.
- Type gate: `svelte-check --tsconfig ./tsconfig.webview.json --fail-on-warnings`. If `svelte-check` fails on TS 6, fall back to `svelte-check-native` and record it here; do not downgrade lint.
- Webview tests type gate: `tsc -p tsconfig.webview-tests.json` (DOM lib + node types over `src/webview/**/*.test.ts`), in Verify right after `svelte-check`. `src/types/css.d.ts` types the side-effect stylesheet import in `main.ts`. `src/webview/tsconfig.json` is a solution-style file referencing both webview configs so type-aware lint (tsrs) finds them; it has no options of its own.
- `?iife` imports: `scripts/iifeStringPlugin.ts`, registered in `vite.webview.config.ts`, the top-level `plugins` in `vite.config.ts` (`vp test`) and the shared `pack` options. It runs Vite `build` (from `vite-plus`, `write: false`, `configFile: false`, lib `iife`, unminified, no sourcemap), escapes every `</` as `<\/`, and `addWatchFile`s each bundled module so `pnpm watch` rebuilds. Lint rule `import/default` is off because its resolver cannot see the virtual default export; type checking still catches a missing one.
- `happy-dom` is a per-file Vitest environment (`// @vitest-environment happy-dom`) for pure DOM helpers only (`stampArtboardHtml.test.ts`). ponytail: never for components or iframe behavior; those are proven by the browser tests (09), not F5.

## Container vs view

- **One container** owns the host bridge: `acquireVsCodeApi()` once, the `message` listener, message validation (unknown `type` or malformed payload is ignored), and chrome state. Keep the bridge in one `*.svelte.ts` module; components never call `postMessage` or add `message` listeners themselves.
- **Rules are a third layer.** Logic that decides (state transitions, message tables, gesture and geometry math) lives in a pure `*.ts` module beside the container, with a colocated test: `frameGesture.ts`, `commentPick.ts`, `stageGeometry.ts`. The container holds the `$state`, calls the rule, applies the result, and does the I/O (posting returned sends, `setState`). Components can't be unit-tested (09), so a rule left inside a `.svelte` file is a rule only the browser tests or F5 can catch. A container past ~300 lines, or with 2+ jobs, extracts its rules this way first.
- **View components** are props in, callbacks out. Tiny visual state (open / hover / focus) is fine; domain state and host messages stay in the container.
- No dummy wrappers: a component that only forwards props to another one is deleted, and the parent renders the child directly.
- A chunky branch (toolbar, banner, empty state) becomes a sibling component in the same folder. A one-line `{#if}` stays inline.
- Folders: `src/webview/` plus one level, then flat. `src/webview/ui/` is the one shared kit: `theme.css`, `icons.ts` and domain-free primitives (`Icon`, `Button`, `IconButton`, ...) used by 2+ surfaces. One-use chrome and comment-specific views stay flat in `src/webview/`. No barrel: import each primitive by path. A primitive is added in the change that first uses it.

## Runes: one job each

- `$state` for owned state, `$derived` for anything computed from it. An `$effect` that only copies state into other state is a `$derived`.
- Each `$effect` does one job (subscribe, sync to `vscodeApi.setState`, measure) and returns its cleanup. Listeners, observers, and timers die with the component.
- `$props()` with a typed destructure. Callbacks are props (`onSelect`), not `createEventDispatcher`.
- Shared reactive logic goes in a `*.svelte.ts` module, not a store library.

## Styling and a11y

- **Tokens.** `src/webview/ui/theme.css` maps the host's `var(--vscode-*)` values to semantic `--cd-*` tokens (the groups are numbered in the file). It is the only file that reads `--vscode-*`; every component reads `--cd-*` only. Tokens are declared on `body`, where VS Code puts its theme classes, so the dark and high-contrast overrides re-resolve the derived tokens. No hardcoded colour, no Tailwind / CSS framework. Padding, margin and gap use the value-named `--cd-space-*` scale (px), repeated sizes a size token. A tint is a named token in `theme.css` (badge tones, overlay fills, avatar, tile error edge, agent reply), never a component `color-mix`, so the high-contrast block drops it in one place. `--cd-accent` is the button blue for generic accents; `--cd-open` (the open-comment colour) derives from it. `--cd-stage-zoom` is set by Stage on its scaled layer; anything drawn inside divides by it.
- **One global stylesheet, no cascade layers.** Cursor prepends its own unlayered `_defaultStyles` to every webview (body padding and colour, `kbd`, `a/input/select/textarea:focus`). Layered rules would lose to it; `theme.css` is unlayered and loads after it (imported first in `main.ts`, bundled into `chrome.css`), so plain selectors win by order. Its sections are the numbered headings in `theme.css`. Nothing else is global; no new global classes.
- **Component styles** are a scoped `<style>` per `.svelte` file, reading only `--cd-*` (a component may declare its own local `--cd-*` token). A primitive's look lives in the primitive; surfaces keep layout CSS only (grid, gap, position). Focus, disabled and pending looks belong to the primitives: outside `ui/` there is no `:focus-visible`, `:disabled` or `[aria-disabled` rule and no `outline: none` / `all: unset`. No `:global(` outside `ui/` either. The exceptions are the named tables at the top of `theme.test.ts`; each names a selector and the only properties its rules may set.
- **Reuse before writing control CSS:** a button is `Button` (variants `primary`, `secondary`, `ghost`, and `segment` for one option of a segmented group, which has one size; `tone="agent"` only on `ghost`; `pending` shows a spinner and the caller says it in words, e.g. "Adding…") or `IconButton` (its count badge is visual only: the `label` says any count it shows, e.g. "Comments, 3 unresolved"), an icon is `Icon` (inline SVG from typed shapes in `icons.ts`; never `{@html}`, never a `data:` mask). Need a new look? Add a prop to the primitive instead of copying its markup and classes.
- **CSP:** no `style="..."` attribute in any `.svelte` file (convention: the chrome sets dynamic values through CSSOM; the chrome CSP allows style attributes since 0.4 only so artboard frames render them); dynamic values use `style:` directives (CSSOM) only.
- **Guard:** `src/webview/ui/theme.test.ts` fails on a `--vscode-*` outside `theme.css`, an undeclared `--cd-*`, a colour literal in a colour property (or in any custom property outside `theme.css`), a control-state rule or `:global(` outside `ui/`, a meaning colour on text outside `ui/` (`color: var(--cd-warning|error|info|agent|resolved|open|accent)`, directly or through a local custom property; the text goes through `Message` / `Badge`, and only the listed icon wrappers may colour a glyph), and a `style=` attribute or colour-literal `style:` value. Each exemption names its selector and the only properties that selector's rules may set. Fix the code, not the guard.
- Native elements first (`<button>`, `<input>`). Keyboard order and ARIA roles / live regions survive every extraction; a shorter component never drops them.
