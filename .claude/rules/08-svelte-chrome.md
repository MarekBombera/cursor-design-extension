---
description: Svelte 5 webview chrome - container vs view, runes with one job each, VS Code theme tokens, a11y
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

## Container vs view

- **One container** owns the host bridge: `acquireVsCodeApi()` once, the `message` listener, message validation (unknown `type` or malformed payload is ignored), and chrome state. Keep the bridge in one `*.svelte.ts` module; components never call `postMessage` or add `message` listeners themselves.
- **View components** are props in, callbacks out. Tiny visual state (open / hover / focus) is fine; domain state and host messages stay in the container.
- No dummy wrappers: a component that only forwards props to another one is deleted, and the parent renders the child directly.
- A chunky branch (toolbar, banner, empty state) becomes a sibling component in the same folder. A one-line `{#if}` stays inline.
- Folders: `src/webview/` plus one level, then flat. No `ui/` kit for one-use chrome.

## Runes: one job each

- `$state` for owned state, `$derived` for anything computed from it. An `$effect` that only copies state into other state is a `$derived`.
- Each `$effect` does one job (subscribe, sync to `vscodeApi.setState`, measure) and returns its cleanup. Listeners, observers, and timers die with the component.
- `$props()` with a typed destructure. Callbacks are props (`onSelect`), not `createEventDispatcher`.
- Shared reactive logic goes in a `*.svelte.ts` module, not a store library.

## Styling and a11y

- Colors, fonts, focus rings: `var(--vscode-*)` tokens only. No hardcoded hex, no Tailwind / CSS framework.
- Component `<style>` is scoped; global styles live in one place. Reuse an existing component with a new prop instead of copying its markup and classes.
- Native elements first (`<button>`, `<input>`). Keyboard order and ARIA roles / live regions survive every extraction; a shorter component never drops them.
